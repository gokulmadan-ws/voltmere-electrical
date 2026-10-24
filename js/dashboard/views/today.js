// js/dashboard/views/today.js: Today, the command centre (greeting, three numbers, next up, needs you ranked by urgency, quotes to write, diary, tomorrow, pipeline).
// Owner: E3 (v1 by WP4, enquiry wording by E2); round 2 (ranking, hero + compact rows, calmer order) by DASH
import { STORAGE_FULL_TEXT } from '../../ui/util.js';
import { html, useState } from '../../vendor/preact-htm.js';
import { Avatar, Card, Chip, EmptyState, Icon, PageHeader } from '../../ui/display.js';
import { Button } from '../../ui/button.js';
import { Switch } from '../../ui/form.js';
import { toast, showUndoToast } from '../../ui/toast.js';
import { useNow, useStore } from '../../ui/hooks.js';
import {
  quoteTotal, selectBookingsOn, selectBrand, selectInsights, selectNeedsYou, selectNextOpenDay, selectNextUp, selectPipeline,
  selectQuoteStats, selectSla
} from '../../core/selectors.js';
import {
  bookingEndStamp, bookingWhen, bookingWindowIds, bookingWindowLabel, getDayLoad, getDaySlots, nextFreeSlot
} from '../../core/availability.js';
import {
  addDays, fmtClock, fmtDayShort, fmtRelativeDay, fmtTimeAgo, minutesBetween, stampDay, toStamp, weekdayOf
} from '../../core/dates.js';
import { EMERGENCY_REASONS } from '../../core/config.js';
import { firstName, gbp, outwardCode, plural } from '../../core/format.js';
import { mapsLink } from '../../core/messages.js';
import { setDayFull } from '../../core/store.js';
import { routeHref } from '../router.js';
import { JobActionBar, NeedsYouActions, NeedsYouMenu, NudgeButton, PaidButton } from '../shared/job-actions.js';
import { BookingPill, answerSummaryLine, answersOf, isEnquiry, isPencilled, isQuotedInstall, pendingWord, priceLabel, shortAnswer } from '../shared/enquiry.js';
import { SlaChip, fmtSpan, replyTone } from '../shared/sla.js';
import { leadOf } from '../shared/lead.js';
import { jumpTo } from '../shared/scroll.js';
import { needRows, stripeOf } from '../shared/needs.js';
import { OutsidePill } from '../shared/outside.js';

export const title = 'Today';
export const css = ['css/today.css', 'css/bookings.css'];

// Selector declared outside the component so useStore gets a stable function (8.8). The whole state is cheap to
// derive from and every mutation hands back a new snapshot, so one re-render per change is exactly what we want.
const selectState = (state) => state;

const JOB_STATUSES = ['confirmed', 'on_the_way', 'done'];
const GCAL = 'google_calendar';

/** Generic failure rule (8.3) for any mutation reason this screen does not handle itself. */
function failToast(res) {
  toast({
    message: res && res.reason === 'not_found' ? 'That booking no longer exists.' : res && res.reason === 'storage_full' ? STORAGE_FULL_TEXT : 'That did not work: the diary changed. Please check and try again.',
    tone: 'danger'
  });
}

/** Undo toast when the store gave us a token, plain toast when it did not (a no-op mutation has none). */
function doneToast(message, token) {
  if (token) showUndoToast(message, token);
  else toast({ message });
}

/** A weekday with no open windows (Sunday by default) or a day marked off. */
function isClosedDay(settings, day) {
  return (settings.hours[weekdayOf(day)] || []).length === 0 || settings.daysOff.some((d) => d.date === day);
}

function greeting(nowDate) {
  const hour = nowDate.getHours();
  return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
}

// ---------- Needs you ----------

/** Only the top item is a full hero card; everything else is one compact row. */
const FULL_CARDS = 1;
/** Compact rows shown before "See all N". */
const ROW_LIMIT = 3;
/** The age of a request in words: "12 min old", "3 h 20 min old". */
function ageText(age) {
  return age < 1 ? 'Just in' : `${fmtSpan(age)} old`;
}

/** The funnel answers as short chips: "Private driveway · Car ordered · ASAP" (permission only when it is not a plain yes). */
function AnswerRow({ b, testid }) {
  const a = answersOf(b);
  if (!a) return null;
  const keys = ['parking', 'vehicle', 'timing'].concat(a.permission && a.permission !== 'yes' ? ['permission'] : []);
  const items = keys.filter((k) => a[k]).map((k) => ({ key: k, label: shortAnswer(k, a[k]), tone: k === 'timing' && a[k] === 'asap' ? 'accent' : 'neutral' })).filter((i) => i.label);
  if (!items.length) return null;
  return html`<ul class="en-chips td-need__chips" aria-label="Their answers" data-testid=${testid}>
    ${items.map((i) => html`<li key=${i.key}><${Chip} class="en-chip" tone=${i.tone}>${i.label}<//></li>`)}
  </ul>`;
}

/** The first card of Needs you: everything Daniel needs to answer the most important thing right now. */
function NeedHero({ row, autoConfirm, nowStamp }) {
  const { b, sla, quote, outside, age } = row;
  const first = firstName(b.customer.name);
  const enquiry = isEnquiry(b);
  const install = isQuotedInstall(b);
  const reasons = (b.emergencyReasons || [])
    .map((id) => (EMERGENCY_REASONS.find((r) => r.id === id) || {}).label)
    .filter(Boolean)
    .join(', ');
  const outward = outwardCode(b.address.postcode);
  const lead = enquiry ? leadOf(b) : null;
  const leadWord = lead && lead.id !== 'other' ? (lead.id === 'facebook' ? 'Facebook ad' : lead.label) : '';
  const label = b.urgent ? `${first}, urgent emergency` : `New ${pendingWord(b)}: ${first}${outward ? `, ${outward}` : ''}`;
  const total = quote ? quoteTotal(quote) : b.quotedPrice;
  const when = install ? `Accepted ${quote && quote.acceptedAt ? fmtTimeAgo(quote.acceptedAt, nowStamp).toLowerCase() : ''}`.trim() : ageText(age);
  const summary = install ? answerSummaryLine(b) : '';
  const stripe = stripeOf(row);
  const flag = !b.urgent && !enquiry && !install && !autoConfirm ? 'Auto-confirm is off' : '';
  const showSla = !!sla && sla.state !== 'ok';
  const unseen = b.seenByOwner === false;
  return html`<${Card} as="article" class=${`td-need td-need--hero${b.urgent ? ' td-need--urgent' : ''}${install ? ' td-need--accepted' : ''}`} data-stripe=${stripe || undefined}
    data-testid=${`needs-you-card-${b.id}`} aria-label=${label}>
    <div class="td-need__top">
      ${b.urgent
        ? html`<span class="ui-pill ui-pill--urgent"><${Icon} name="siren" size=${16} /><span class="ui-pill__label">URGENT</span></span>`
        : html`<${BookingPill} booking=${b} single />`}
      ${unseen ? html`<span class="u-sr-only">Not opened yet</span>` : null}
      <span class="td-need__age" data-testid=${`needs-you-age-${b.id}`}>${when}</span>
    </div>
    <div class="td-need__head">
      <p class="td-need__who"><a class="td-need__link" href=${`#/bookings/${b.id}`} data-testid=${`needs-you-open-${b.id}`}><strong>${first}</strong></a>${outward ? ` · ${outward}` : ''}${leadWord ? ` · ${leadWord}` : ''}</p>
      <${NeedsYouMenu} booking=${b} hero />
    </div>
    ${showSla ? html`<${SlaChip} sla=${sla} class="td-need__sla" data-testid=${`needs-you-sla-${b.id}`} />` : null}
    ${install ? html`<p class="td-need__amount u-tabular" data-testid=${`needs-you-amount-${b.id}`}>${gbp(total)}</p>` : null}
    ${b.urgent
      ? html`<div class="td-need__what">
          ${reasons ? html`<p class="td-need__line">${reasons}</p>` : null}
          ${b.notes ? html`<p class="td-need__note">“${b.notes}”</p>` : null}
        </div>`
      : html`<p class="td-need__line" data-testid=${`needs-you-when-${b.id}`}>${enquiry
        ? `${isPencilled(b) ? 'Survey pencilled in' : 'Survey visit'}, ${bookingWhen(b)}`
        : install ? `${isPencilled(b) ? 'Install pencilled in' : 'Install day'}, ${bookingWhen(b)}` : `${b.serviceName}, ${bookingWhen(b)}`}</p>`}
    ${enquiry && !b.urgent ? html`<${AnswerRow} b=${b} testid=${`needs-you-answers-${b.id}`} />` : null}
    ${summary ? html`<p class="td-need__summary" data-testid=${`needs-you-answers-${b.id}`}>${summary}</p>` : null}
    ${outside ? html`<p class="td-flag" data-testid=${`needs-you-flag-${b.id}`}><${Icon} name="map-pin" size=${16} /><span>Outside Northern Ireland, check travel first</span></p>` : null}
    ${flag ? html`<p class="td-flag" data-testid=${`needs-you-flag-${b.id}`}><${Icon} name="info" size=${16} /><span>${flag}</span></p>` : null}
    <${NeedsYouActions} booking=${b} hero />
  <//>`;
}

/** The decision fact of a compact row: what is being asked, in at most two lines. No ellipsis, it wraps. */
function rowContext(b, install, enquiry) {
  if (b.urgent) {
    const reasons = (b.emergencyReasons || []).map((id) => (EMERGENCY_REASONS.find((r) => r.id === id) || {}).label).filter(Boolean).join(', ');
    return reasons || b.notes || 'Emergency request';
  }
  if (install) return null;
  if (enquiry) {
    const a = answersOf(b);
    const bits = [];
    if (a) {
      ['parking', 'vehicle'].forEach((k) => { if (a[k]) bits.push(shortAnswer(k, a[k])); });
      if (a.timing === 'asap') bits.push('ASAP');
    }
    return bits.map((t, i) => (i === 0 || t === 'ASAP' ? t : t.charAt(0).toLowerCase() + t.slice(1))).join(' · ');
  }
  return `${b.serviceName}`;
}

/** A compact row: avatar, name and outward code, a status pill, the decision fact, ONE verb button and the overflow. */
function NeedRow({ row }) {
  const { b, sla, quote, outside } = row;
  const enquiry = isEnquiry(b);
  const install = isQuotedInstall(b);
  const outward = outwardCode(b.address.postcode);
  const total = quote ? quoteTotal(quote) : b.quotedPrice;
  const stripe = stripeOf(row);
  const ctx = rowContext(b, install, enquiry);
  const showSla = !!sla && (sla.state !== 'ok' || outside);
  const unseen = b.seenByOwner === false;
  return html`<li class="td-crow" data-stripe=${stripe || undefined} data-testid=${`needs-you-card-${b.id}`}>
    <div class="td-crow__head">
      <${Avatar} name=${b.customer.name} size=${32} class="td-crow__av" />
      <a class="td-crow__name" href=${`#/bookings/${b.id}`} data-testid=${`needs-you-open-${b.id}`}><span><strong>${firstName(b.customer.name)}</strong>${outward ? ` · ${outward}` : ''}</span></a>
      ${unseen ? html`<span class="u-sr-only">Not opened yet</span>` : null}
      <span class="td-crow__pill">
        ${b.urgent
          ? html`<span class="ui-pill ui-pill--urgent ui-pill--compact"><${Icon} name="siren" size=${16} /><span class="ui-pill__label">URGENT</span></span>`
          : outside ? html`<${OutsidePill} testid=${`needs-you-flag-${b.id}`} />`
            : html`<${BookingPill} booking=${b} compact single />`}
      </span>
    </div>
    <p class="td-crow__ctx">
      ${showSla ? html`<${SlaChip} sla=${sla} class=${`td-need__sla td-crow__sla${outside ? ' sh-sla--neutral' : ''}`} data-testid=${`needs-you-sla-${b.id}`} />${' '}` : null}
      ${install ? html`<span class="u-tabular td-crow__amount" data-testid=${`needs-you-amount-${b.id}`}>${gbp(total)}</span>${' · '}<span data-testid=${`needs-you-when-${b.id}`}>${isPencilled(b) ? 'Install pencilled in' : 'Install day'}, ${bookingWhen(b)}</span>` : null}
      ${!install && enquiry ? html`<span data-testid=${`needs-you-answers-${b.id}`}>${ctx || 'Free survey visit'}</span>${' · '}<span data-testid=${`needs-you-when-${b.id}`}>${isPencilled(b) ? 'Survey ' : ''}${bookingWhen(b)}</span>` : null}
      ${!install && !enquiry ? html`<span data-testid=${`needs-you-when-${b.id}`}>${ctx}${' · '}${bookingWhen(b)}</span>` : null}
    </p>
    <div class="td-crow__acts">
      <${NeedsYouActions} booking=${b} compact />
      <${NeedsYouMenu} booking=${b} />
    </div>
  </li>`;
}

function NeedsYou({ state, items, autoConfirm, nowStamp, replyHours, rows }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) {
    return html`<${Card} as="section" class="td-clear td-o2" data-testid="today-all-clear" aria-labelledby="td-clear-title">
      <span class="td-clear__icon"><${Icon} name="circle-check" size=${28} /></span>
      <div class="td-clear__text">
        <h2 class="td-card-title" id="td-clear-title">All caught up</h2>
        <p>No enquiries are waiting for a reply and no accepted quotes need an install day. New ones appear here the moment they arrive.</p>
      </div>
    <//>`;
  }
  const cards = rows.slice(0, FULL_CARDS);
  const rest = rows.slice(FULL_CARDS);
  const shown = all ? rest : rest.slice(0, ROW_LIMIT);
  const urgent = rows.filter((r) => r.b.urgent).length;
  const accepted = rows.filter((r) => isQuotedInstall(r.b)).length;
  const enquiries = rows.filter((r) => isEnquiry(r.b)).length;
  const other = rows.length - urgent - accepted - enquiries;
  // The parts add up to the number in the header: every item is in exactly one of them.
  const parts = [
    urgent > 0 ? plural(urgent, 'emergency', 'emergencies') : '',
    enquiries > 0 ? plural(enquiries, 'new enquiry', 'new enquiries') : '',
    accepted > 0 ? `${accepted} accepted ${accepted === 1 ? 'quote' : 'quotes'}` : '',
    other > 0 ? plural(other, 'other request', 'other requests') : ''
  ].filter(Boolean);
  return html`<section class="db-section td-section td-o2" data-testid="needs-you" aria-labelledby="td-needs-title">
    <h2 class="db-section__title" id="td-needs-title">
      <span>Needs you</span>
      <span class="td-count" aria-label=${`${items.length} waiting`} data-testid="needs-you-count">${items.length}</span>
    </h2>
    <p class="td-needs__sum" data-testid="needs-you-summary">${parts.join(' · ')}</p>
    <div class="td-needs">
      ${cards.map((r) => html`<${NeedHero} key=${r.b.id} row=${r} autoConfirm=${autoConfirm} nowStamp=${nowStamp} />`)}
    </div>
    ${shown.length > 0 ? html`<div class="td-rows" data-testid="needs-you-more">
      <ul class="td-crows">
        ${shown.map((r) => html`<${NeedRow} key=${r.b.id} row=${r} />`)}
      </ul>
    </div>` : null}
    ${rest.length > ROW_LIMIT ? html`<button type="button" class="td-seeall" aria-expanded=${all ? 'true' : 'false'} onClick=${() => setAll(!all)} data-testid="needs-you-see-all">
      <span>${all ? 'Show fewer' : `See all ${items.length}`}</span><${Icon} name=${all ? 'chevron-up' : 'chevron-down'} size=${18} />
    </button>` : null}
  </section>`;
}

/** One row under the greeting when an in-Northern-Ireland enquiry has waited past the reply promise. */
function LateBanner({ rows }) {
  const late = rows.filter((r) => r.overdue && !r.b.urgent && isEnquiry(r.b));
  if (late.length === 0) return null;
  const top = late[0];
  const first = firstName(top.b.customer.name);
  const text = late.length === 1 ? `${first}: ${fmtSpan(top.sla.minutes)} overdue` : `${late.length} overdue, ${first} longest`;
  return html`<div class="td-late" role="status" data-testid="today-late-banner">
    <${Icon} name="triangle-alert" size=${20} />
    <span class="td-late__text">${text}</span>
    <${Button} size="sm" variant="secondary" class="td-late__btn" href=${`#/bookings/${top.b.id}`} data-testid="today-late-reply">Reply<//>
  </div>`;
}

// ---------- Quotes to write ----------

function QuotesToWrite({ items }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  return html`<section class="db-section td-section td-o3" data-testid="today-quote-todo" aria-labelledby="td-todo-title">
    <h2 class="db-section__title" id="td-todo-title">
      <span>Quotes to write</span>
      <span class="td-count td-count--quiet" aria-label=${`${items.length} to write`}>${items.length}</span>
    </h2>
    <div class="db-list">
      ${shown.map((it) => {
        const draft = it.quoteStatus === 'draft';
        const href = draft && it.quoteId ? routeHref('quote-detail', { id: it.quoteId }) : routeHref('quote-detail', { id: 'new' }, { booking: it.bookingId });
        return html`<a class="db-list__item td-todo" key=${it.bookingId} href=${href} data-testid=${`today-quote-todo-${it.bookingId}`}>
          <${Avatar} name=${it.customerName} size=${36} />
          <span class="td-todo__text">
            <span class="td-todo__name">${firstName(it.customerName)} · ${outwardCode(it.postcode)}</span>
            <span class="td-todo__sub">${it.summary}</span>
          </span>
          <span class="td-todo__go">${draft ? 'Finish quote' : 'Build quote'}<${Icon} name="chevron-right" size=${18} /></span>
        </a>`;
      })}
    </div>
    ${items.length > shown.length ? html`<p class="td-more"><a class="ui-link ui-link--inline" href=${routeHref('pipeline')}>${`and ${items.length - shown.length} more in the pipeline`}</a></p>` : null}
  </section>`;
}

// ---------- Pipeline bar ----------

function PipelineBar({ pipeline, insights }) {
  const total = pipeline.stages.reduce((t, s) => t + s.count, 0);
  const label = `Sales pipeline: ${pipeline.stages.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}. Open it.`;
  return html`<div class="ui-card td-pipe td-o6">
    <a class="td-pipe__link" href=${routeHref('pipeline')} data-testid="today-pipeline" aria-label=${label}>
      <span class="td-pipe__head">
        <span class="td-card-title td-pipe__title">Pipeline</span>
        <span class="td-pipe__value u-tabular">${pipeline.openValue > 0 ? `${gbp(pipeline.openValue)} in play` : 'Nothing open'}<${Icon} name="chevron-right" size=${18} /></span>
      </span>
      <span class="td-pipe__bar" aria-hidden="true">
        ${total === 0
          ? html`<span class="td-pipe__seg td-pipe__seg--none" style="flex: 1 1 0"></span>`
          : pipeline.stages.filter((s) => s.count > 0).map((s) => html`<span key=${s.id} class=${`td-pipe__seg td-pipe__seg--${s.id}`} style=${{ flex: `${s.count} 1 0` }}></span>`)}
      </span>
      <span class="td-pipe__legend" aria-hidden="true">
        ${pipeline.stages.map((s) => html`<span key=${s.id} class="td-pipe__item" data-testid=${`today-pipeline-${s.id}`}>
          <span class=${`td-pipe__dot td-pipe__seg--${s.id}`}></span>
          <span class="td-pipe__n u-tabular">${s.count}</span>
          <span class="td-pipe__l">${s.label}</span>
        </span>`)}
      </span>
    </a>
    <a class="td-collected" href=${routeHref('insights')} data-testid="stat-collected">
      <span class="td-collected__text">
        <span class="td-collected__label">Collected this month</span>
        <span class="td-collected__hint">${insights.collectedMonthCount > 0 ? plural(insights.collectedMonthCount, 'paid job') : 'Nothing paid yet this month'}</span>
      </span>
      <span class="ui-stat__value td-collected__value">${gbp(insights.collectedMonth)}</span>
      <${Icon} name="chevron-right" size=${18} />
    </a>
  </div>`;
}

// ---------- Next up ----------

/** The countdown line of 13.4 item 3. */
function countdownFor(b, nowStamp, today) {
  if (b.status === 'on_the_way') {
    const entry = (b.history || []).filter((e) => e.event === 'on_the_way').pop();
    return entry ? `On the way since ${fmtClock(entry.at)}` : 'On the way';
  }
  if (b.urgent) return b.etaAt ? `Emergency · ETA ${fmtClock(b.etaAt)}` : 'Emergency';
  const day = stampDay(b.start);
  if (day > today) return fmtRelativeDay(day, today);
  if (nowStamp >= b.start && nowStamp < bookingEndStamp(b)) return 'Arriving now';
  if (nowStamp < b.start) {
    const mins = minutesBetween(nowStamp, b.start);
    if (mins < 60) return `In ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `In ${h} h ${m} min` : `In ${h} h`;
  }
  return fmtRelativeDay(day, today);
}

/** "On my way" only becomes the main button on the day of the job, within this many minutes of the slot. */
const ON_MY_WAY_MINUTES = 120;

/**
 * Next up as a thin strip: who, when, town and Navigate. The primary is Navigate (or Confirm for a visit nobody has confirmed). "On my way" is only
 * the primary on the day of the job within two hours of the slot (it opens a sheet that shows the exact message before anything is sent).
 */
function NextUp({ booking: b, nowStamp, today }) {
  if (!b) {
    return html`<${Card} class="td-next td-next--empty td-o1">
      <${EmptyState} icon="calendar-days" title="No visits or installs coming up. Go put the kettle on." data-testid="today-empty" />
    <//>`;
  }
  const first = firstName(b.customer.name);
  const outward = outwardCode(b.address.postcode);
  const sameDay = stampDay(b.start) === today;
  const soon = b.status === 'confirmed' && !b.urgent && sameDay && minutesBetween(nowStamp, b.start) <= ON_MY_WAY_MINUTES;
  const bar = b.status === 'on_the_way' || b.status === 'new' || b.urgent || soon;
  const service = b.serviceId === 'ev_quote' ? '' : `${b.serviceName}${b.variantLabel ? ` (${b.variantLabel})` : ''}`;
  const nav = html`<${Button} variant="secondary" size="sm" icon="navigation" class="td-next__nav" aria-label=${`Navigate to ${first}`} href=${mapsLink(b.address.line1, b.address.postcode)} data-testid="next-up-navigate">Navigate<//>`;
  const where = [bookingWindowLabel(b), outward, service].filter(Boolean).join(' · ');
  return html`<${Card} as="section" class=${`td-next td-o1${bar ? ' td-next--bar' : ''}`} data-testid="next-up" aria-labelledby="td-next-title">
    <div class="td-next__text">
      <div class="td-next__top">
        <h2 class="td-next__eyebrow" id="td-next-title">Next up</h2>
        <span class="td-next__count">${countdownFor(b, nowStamp, today)}</span>
      </div>
      <a class="td-next__who" href=${`#/bookings/${b.id}`} data-testid="next-up-details">
        <strong>${b.customer.name}</strong>
        <span class="td-next__where">${where}</span>
      </a>
    </div>
    ${bar
      ? html`<div class="td-next__acts">${nav}<${JobActionBar} booking=${b} variant="compact" /></div>`
      : html`<div class="td-next__acts td-next__acts--one">${nav}</div>`}
  <//>`;
}

// ---------- Numbers ----------

/** A tappable number: label, value, a hint and a chevron so it reads as a button. */
function Tile({ label, value, hint, hintPill, tone, href, onClick, testid }) {
  return html`<a class=${`ui-stat ui-stat--link td-stat${tone ? ` ui-stat--${tone}` : ''}`} href=${href} onClick=${onClick} data-testid=${testid}>
    <span class="ui-stat__label">${label}</span>
    <span class="td-stat__chev" aria-hidden="true"><${Icon} name="chevron-right" size=${16} /></span>
    <span class="ui-stat__value">${value}</span>
    ${hint ? html`<span class=${`ui-stat__hint${hintPill ? ' td-stat__pill' : ''}`}>${hint}</span>` : null}
  </a>`;
}

/** Owed, Quotes out and Replied in 24 h: the three numbers Daniel opens the app for, in one thin row at the top. */
function Tiles({ insights, quoteStats, sla }) {
  const pct = sla.withinTargetPct;
  const tone = replyTone(pct);
  const go = (hash, id) => (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); jumpTo(hash, id); };
  return html`<section class="td-tiles" aria-label="Money and replies" data-testid="today-money">
    <${Tile} label="Owed" value=${gbp(insights.owedTotal)} hint=${insights.owedCount > 0 ? plural(insights.owedCount, 'job') : 'Nothing due'} hintPill=${insights.owedCount > 0}
      href=${routeHref('insights')} onClick=${go(routeHref('insights'), 'in-h-owed')} testid="stat-owed" />
    <${Tile} label="Quotes out" value=${gbp(quoteStats.waitingValue)}
      hint=${quoteStats.waitingCount > 0 ? plural(quoteStats.waitingCount, 'quote') : 'None waiting'}
      href=${routeHref('quotes', {}, { f: 'waiting' })} testid="stat-quotes-out" />
    <${Tile} label=${`Replied in ${sla.replyHours} h`} value=${pct === null ? '–' : `${pct}%`}
      hint=${pct === null ? 'No replies yet' : 'answered in time'} tone=${tone === 'neutral' ? undefined : tone}
      href=${routeHref('insights')} onClick=${go(routeHref('insights'), 'in-h-reply')} testid="stat-replied" />
  </section>`;
}

// ---------- Availability: one row ----------

function Availability({ settings, today, nextFree }) {
  const closedToday = isClosedDay(settings, today);
  const taking = !closedToday && !settings.fullDays.includes(today);
  const onToggle = (checked) => {
    const res = setDayFull(today, !checked);
    if (!res.ok) { failToast(res); return; }
    doneToast(checked ? 'Taking bookings again today.' : 'Marked full for today. No new survey visits will be pencilled in today.', res.undoToken);
  };
  const description = closedToday ? 'Today is closed.'
    : !taking ? 'Full today. No new survey visits.'
      : nextFree ? `Next free: ${nextFree.human}` : 'No free survey slot soon';
  return html`<${Card} as="section" class="td-avail td-o8" data-testid="today-availability" aria-label="Availability">
    <${Switch} id="td-taking-bookings" data-testid="today-taking-bookings" checked=${taking} disabled=${closedToday}
      label="Taking bookings today" description=${description} onChange=${onToggle} />
  <//>`;
}

// ---------- Today's diary ----------

function JobRow({ booking: b, compact }) {
  const meta = [firstName(b.customer.name), outwardCode(b.address.postcode), priceLabel(b)].filter(Boolean);
  if (b.urgent && b.etaAt && b.status !== 'done') meta.push(`ETA ${fmtClock(b.etaAt)}`);
  // A finished job nobody has paid for yet: collect it here instead of a trip to Insights.
  const owed = !compact && b.status === 'done' && !b.paid && !isEnquiry(b);
  return html`<div class=${`td-job${owed ? ' td-job--owed' : ''}`}>
    <a class=${`td-row${compact ? ' td-row--compact' : ''}`} href=${`#/bookings/${b.id}`} data-testid=${compact ? undefined : `today-job-${b.id}`}>
      <span class="td-row__head">
        <span class="td-row__when">${bookingWindowLabel(b)}</span>
        <${BookingPill} booking=${b} compact single />
      </span>
      <span class="td-row__svc">${b.serviceName}</span>
      <span class="td-row__meta">${meta.join(' · ')}</span>
    </a>
    ${owed ? html`<div class="td-job__acts" data-testid=${`today-owed-actions-${b.id}`}>
      <${PaidButton} booking=${b} size="sm" variant="secondary" />
      <${NudgeButton} booking=${b} size="sm" />
    </div>` : null}
  </div>`;
}

/** The day's rows in window order: accepted emergencies first, then each window as a job, a free row or a block. */
function buildDiary(state, today, nowDate) {
  const todays = selectBookingsOn(state, today).filter((b) => !(b.urgent && b.status === 'new'));
  const entries = todays.filter((b) => b.urgent).map((b) => ({ kind: 'job', windowId: -1, booking: b }));
  const windowed = todays.filter((b) => !b.urgent);
  const placed = new Set();
  // Owner mode: lead time and "Full" do not hide a window from the owner. Past windows come back as 'past'.
  for (const slot of getDaySlots(state, today, 1, { ownerMode: true, now: nowDate })) {
    const b = windowed.find((x) => bookingWindowIds(x).includes(slot.windowId));
    if (b) {
      if (!placed.has(b.id)) { placed.add(b.id); entries.push({ kind: 'job', windowId: slot.windowId, booking: b }); }
    } else if (slot.state === 'free') entries.push({ kind: 'free', windowId: slot.windowId, slot });
    else if (slot.state === 'blocked') {
      const block = state.blocks.find((x) => x.date === today && x.windowId === slot.windowId);
      entries.push({ kind: 'blocked', windowId: slot.windowId, slot, gcal: !!block && block.source === GCAL });
    }
  }
  windowed.filter((b) => !placed.has(b.id)).forEach((b) => entries.push({ kind: 'job', windowId: 4, booking: b }));
  return entries;
}

function Diary({ state, nowDate, today, closedToday, jobsCount }) {
  const entries = buildDiary(state, today, nowDate);
  const rows = [];
  let lunchDone = false;
  entries.forEach((e, i) => {
    // Thin Lunch divider between windows 1 and 2, only when there is something on both sides.
    if (!lunchDone && e.windowId >= 2 && i > 0 && entries.slice(0, i).some((p) => p.windowId >= 0 && p.windowId <= 1)) {
      lunchDone = true;
      rows.push(html`<div class="td-lunch" key="lunch"><span>Lunch</span></div>`);
    }
    if (e.kind === 'job') {
      rows.push(html`<${JobRow} key=${e.booking.id} booking=${e.booking} />`);
    } else if (e.kind === 'free') {
      rows.push(html`<a class="td-row td-row--free" key=${`free-${e.windowId}`} href=${`#/new?date=${today}&window=${e.windowId}`} data-testid=${`today-free-${e.windowId}`}>
        <${Icon} name="plus" size=${20} />
        <span class="td-row__when">${e.slot.label}</span>
        <span class="td-row__free">Free · add a job</span>
      </a>`);
    } else {
      rows.push(html`<div class=${`td-row td-row--blocked${e.gcal ? ' td-row--gcal' : ''}`} key=${`blocked-${e.windowId}`}>
        <${Icon} name=${e.gcal ? 'calendar-days' : 'lock'} size=${20} />
        <span class="td-row__when">${e.slot.label}</span>
        <span class="td-row__free">${e.gcal ? 'Google Calendar: busy' : `Blocked: ${e.slot.blockLabel}`}</span>
      </div>`);
    }
  });
  return html`<section class="db-section td-section td-o4" aria-labelledby="td-diary-title">
    <h2 class="db-section__title" id="td-diary-title">
      <span>Today's diary</span>
      <${Chip} data-testid="stat-jobs-today">${plural(jobsCount, 'job')}<//>
    </h2>
    <div class="td-diary" data-testid="today-jobs">
      ${rows.length > 0 ? rows : html`<p class="td-quiet">${closedToday ? 'Closed today.' : 'Nothing in the diary today.'}</p>`}
    </div>
  </section>`;
}

// ---------- Tomorrow ----------

function Tomorrow({ state, nowDate, today, nextUpId }) {
  const tomorrow = addDays(today, 1);
  const day = selectNextOpenDay(state, today) || tomorrow;
  const jobs = selectBookingsOn(state, day);
  // The job already shown as Next up is not listed a second time.
  const others = jobs.filter((b) => b.id !== nextUpId);
  const free = getDayLoad(state, day, { now: nowDate }).free;
  const shown = others.slice(0, 4);
  if (shown.length === 0 && jobs.length > 0) {
    return html`<a class="ui-card td-thin td-o5" href=${`#/calendar/${day}`} data-testid="tomorrow-list">
      <span class="td-thin__text"><strong>${day === tomorrow ? 'Tomorrow' : fmtDayShort(day)}</strong> · nothing else yet</span>
      <span class="td-thin__free">${free > 0 ? `${free} ${free === 1 ? 'slot' : 'slots'} free` : 'Fully booked'}</span>
      <${Icon} name="chevron-right" size=${18} />
    </a>`;
  }
  return html`<section class="db-section td-section td-o5" data-testid="tomorrow-list" aria-labelledby="td-tomorrow-title">
    <h2 class="db-section__title" id="td-tomorrow-title">
      <span>${day === tomorrow ? 'Tomorrow' : fmtDayShort(day)}</span>
      <${Chip} tone=${free > 0 ? 'ok' : 'neutral'}>Free windows: ${free}<//>
    </h2>
    <div class="td-diary">
      ${shown.length > 0
        ? shown.map((b) => html`<${JobRow} key=${b.id} booking=${b} compact />`)
        : html`<p class="td-quiet">Nothing booked yet.</p>`}
    </div>
    <div class="td-tomorrow__foot">
      ${others.length > shown.length ? html`<span class="td-quiet">${`and ${others.length - shown.length} more`}</span>` : html`<span></span>`}
      <${Button} variant="ghost" size="sm" iconRight="chevron-right" href=${`#/calendar/${day}`}>Open calendar<//>
    </div>
  </section>`;
}

// ---------- The view ----------

export default function TodayView() {
  const state = useStore(selectState);
  const nowDate = useNow(30000);
  const brand = selectBrand(state);
  const nowStamp = toStamp(nowDate);
  const today = stampDay(nowStamp);

  const needs = selectNeedsYou(state);
  const nextUp = selectNextUp(state, nowStamp);
  const todays = selectBookingsOn(state, today);
  const jobsToday = todays.filter((b) => JOB_STATUSES.includes(b.status));
  const nextFree = nextFreeSlot(state, 'ev_quote', { now: nowDate });
  const closedToday = isClosedDay(state.settings, today);
  const sla = selectSla(state, nowStamp);
  const pipeline = selectPipeline(state, nowStamp);
  const insights = selectInsights(state, nowStamp);
  const quoteStats = selectQuoteStats(state, 'all', nowStamp);
  const quote = pipeline.stages.find((s) => s.id === 'quote');
  const toWrite = quote ? quote.items.filter((it) => !it.quoteStatus || it.quoteStatus === 'draft') : [];
  const rows = needRows(needs, state, sla.replyHours, nowStamp);

  const needText = needs.length === 1 ? '1 needs you' : `${needs.length} need you`;
  const subtitle = `${fmtDayShort(today)} · ${plural(jobsToday.length, 'job')} today · ${needText}`;

  // Phone order (the .td-o* numbers): greeting, late banner, the three numbers, next up, what needs him, quotes to write, the diary, tomorrow,
  // then the housekeeping. From 1100px two columns: Needs you and Quotes to write on the left, everything about the day on the right.
  return html`<div class="db-page td-page" data-testid="today-view">
    <${PageHeader} title=${`${greeting(nowDate)}, ${brand.ownerFirst}`} subtitle=${subtitle} />
    <${LateBanner} rows=${rows} />
    <${Tiles} insights=${insights} quoteStats=${quoteStats} sla=${sla} />
    <div class="td-layout">
      <div class="td-col td-col--left">
        <${NeedsYou} state=${state} items=${needs} rows=${rows} autoConfirm=${state.settings.autoConfirm} nowStamp=${nowStamp} replyHours=${sla.replyHours} />
        <${QuotesToWrite} items=${toWrite} />
      </div>
      <div class="td-col td-col--right">
        <${NextUp} booking=${nextUp} nowStamp=${nowStamp} today=${today} />
        <${Diary} state=${state} nowDate=${nowDate} today=${today} closedToday=${closedToday} jobsCount=${jobsToday.length} />
        <${Tomorrow} state=${state} nowDate=${nowDate} today=${today} nextUpId=${nextUp ? nextUp.id : ''} />
        <${PipelineBar} pipeline=${pipeline} insights=${insights} />
        <${Availability} settings=${state.settings} today=${today} nextFree=${nextFree} />
      </div>
    </div>
  </div>`;
}
