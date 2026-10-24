// js/dashboard/views/today.js: Today, the command centre (needs you with reply countdowns, pipeline bar, next up, money, diary, tomorrow).
// Owner: E3 (v1 by WP4, enquiry wording by E2)
import { html } from '../../vendor/preact-htm.js';
import {
  Avatar, Banner, Button, Card, Chip, EmptyState, Icon, Meter, PageHeader, Stat, Switch,
  copyText, toast, showUndoToast, useNow, useStore
} from '../../ui/index.js';
import {
  quoteTotal, selectBookingsOn, selectBrand, selectInsights, selectNeedsYou, selectNextOpenDay, selectNextUp, selectPipeline,
  selectQuoteStats, selectRepeatInfo, selectSla
} from '../../core/selectors.js';
import {
  bookingEndStamp, bookingWhen, bookingWindowIds, bookingWindowLabel, getDayLoad, getDaySlots, nextFreeSlot
} from '../../core/availability.js';
import {
  addDays, fmtClock, fmtDayShort, fmtRelativeDay, fmtTimeAgo, minutesBetween, stampDay, toStamp, weekDates, weekStart, weekdayOf
} from '../../core/dates.js';
import { EMERGENCY_REASONS, SITE_BASE_URL } from '../../core/config.js';
import { firstName, gbp, outwardCode, plural } from '../../core/format.js';
import { mapsLink, telLink, waLink, waShareLink } from '../../core/messages.js';
import { addDaysOff, setDayFull } from '../../core/store.js';
import { routeHref } from '../router.js';
import { JobActionBar, NeedsYouActions } from '../shared/job-actions.js';
import { AnswerChips, BookingPill, isEnquiry, isOutsideNi, isPencilled, isQuotedInstall, pendingWord, priceLabel } from '../shared/enquiry.js';
import { SlaChip, fmtSpan, slaFor } from '../shared/sla.js';
import { LeadChip } from '../shared/lead.js';

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
    message: res && res.reason === 'not_found' ? 'That booking no longer exists.' : 'That did not work: the diary changed. Please check and try again.',
    tone: 'danger'
  });
}

/** Undo toast when the store gave us a token, plain toast when it did not (a no-op mutation has none). */
function doneToast(message, token) {
  if (token) showUndoToast(message, token);
  else toast({ message });
}

const bookedJobsNote = (n) => (n === 1 ? ' 1 booked job stays in your diary.' : ` ${n} booked jobs stay in your diary.`);

/** A weekday with no open windows (Sunday by default) or a day marked off. */
function isClosedDay(settings, day) {
  return (settings.hours[weekdayOf(day)] || []).length === 0 || settings.daysOff.some((d) => d.date === day);
}

function greeting(nowDate) {
  const hour = nowDate.getHours();
  return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
}

// ---------- Needs you ----------

/** Urgent first, then overdue replies, accepted quotes, replies due soon, then the oldest first. */
function needRank(b, sla) {
  if (b.urgent) return 0;
  if (sla && sla.state === 'overdue') return 1;
  if (isQuotedInstall(b)) return 2;
  if (sla && sla.state === 'due_soon') return 3;
  return 4;
}

function NeedCard({ booking: b, autoConfirm, nowStamp, sla, quote }) {
  const first = firstName(b.customer.name);
  const enquiry = isEnquiry(b);
  const install = isQuotedInstall(b);
  const reasons = (b.emergencyReasons || [])
    .map((id) => (EMERGENCY_REASONS.find((r) => r.id === id) || {}).label)
    .filter(Boolean)
    .join(', ');
  let flag = '';
  if (!b.urgent) {
    if (isOutsideNi(b.address.postcode)) flag = 'Outside Northern Ireland: check you can travel before you confirm.';
    else if (!autoConfirm && !enquiry && !install) flag = 'Auto-confirm is off.';
  }
  const unseen = b.seenByOwner === false;
  const outward = outwardCode(b.address.postcode);
  const label = b.urgent ? `${first}, urgent emergency` : `New ${pendingWord(b)}: ${first}${outward ? `, ${outward}` : ''}`;
  const total = quote ? quoteTotal(quote) : b.quotedPrice;
  const when = install ? `Accepted ${quote && quote.acceptedAt ? fmtTimeAgo(quote.acceptedAt, nowStamp).toLowerCase() : ''}`.trim() : fmtTimeAgo(b.createdAt, nowStamp);
  return html`<${Card} as="article" class=${`td-need${b.urgent ? ' td-need--urgent' : ''}${install ? ' td-need--accepted' : ''}${sla && sla.state === 'overdue' ? ' td-need--late' : ''}${unseen ? ' is-unseen' : ''}`}
    data-testid=${`needs-you-card-${b.id}`} aria-label=${label}>
    <div class="td-need__top">
      ${b.urgent
        ? html`<span class="ui-pill ui-pill--urgent"><${Icon} name="siren" size=${16} /><span class="ui-pill__label">URGENT</span></span>`
        : html`<${BookingPill} booking=${b} />`}
      ${unseen ? html`<span class="u-sr-only">Not opened yet</span>` : null}
      <${SlaChip} sla=${sla} class="td-need__sla" data-testid=${`needs-you-sla-${b.id}`} />
    </div>
    ${install ? html`<p class="td-need__amount u-tabular" data-testid=${`needs-you-amount-${b.id}`}>${gbp(total)}</p>` : null}
    <p class="td-need__who"><a class="td-need__link" href=${`#/bookings/${b.id}`} data-testid=${`needs-you-open-${b.id}`}><strong>${first}</strong></a> · ${outward} · ${when}</p>
    ${enquiry ? html`<div class="sh-meta"><${LeadChip} booking=${b} /></div>` : null}
    ${b.urgent
      ? html`<div class="td-need__what">
          ${reasons ? html`<p class="td-need__line">${reasons}</p>` : null}
          ${b.notes ? html`<p class="td-need__note">“${b.notes}”</p>` : null}
        </div>`
      : html`<p class="td-need__line" data-testid=${`needs-you-when-${b.id}`}>${enquiry
        ? `${isPencilled(b) ? 'Free survey pencilled in' : 'Free survey visit'}, ${bookingWhen(b)}`
        : install ? `${isPencilled(b) ? 'Install pencilled in' : 'Install day'}, ${bookingWhen(b)}` : `${b.serviceName}, ${bookingWhen(b)}`}</p>`}
    <${AnswerChips} booking=${b} />
    ${flag ? html`<p class="td-need__flag"><${Icon} name="triangle-alert" size=${16} /><span>${flag}</span></p>` : null}
    <${NeedsYouActions} booking=${b} />
  <//>`;
}

function NeedsYou({ state, items, autoConfirm, nowStamp, replyHours }) {
  if (items.length === 0) {
    return html`<${Card} as="section" class="td-clear td-o1" data-testid="today-all-clear" aria-labelledby="td-clear-title">
      <span class="td-clear__icon"><${Icon} name="circle-check" size=${28} /></span>
      <div class="td-clear__text">
        <h2 class="td-card-title" id="td-clear-title">All caught up</h2>
        <p>No enquiries are waiting for a reply and no accepted quotes need an install day. New ones appear here the moment they arrive.</p>
      </div>
    <//>`;
  }
  const rows = items.map((b) => {
    const sla = slaFor(b, replyHours, nowStamp);
    return { b, sla, rank: needRank(b, sla), quote: isQuotedInstall(b) ? state.quotes[b.quoteId] || null : null };
  }).sort((x, y) => x.rank - y.rank || (x.b.createdAt < y.b.createdAt ? -1 : x.b.createdAt > y.b.createdAt ? 1 : 0));
  const overdue = rows.filter((r) => r.sla && r.sla.state === 'overdue').length;
  const accepted = rows.filter((r) => isQuotedInstall(r.b)).length;
  const enquiries = rows.filter((r) => isEnquiry(r.b)).length;
  return html`<section class="db-section td-section td-o1" data-testid="needs-you" aria-labelledby="td-needs-title">
    <h2 class="db-section__title" id="td-needs-title">
      <span>Needs you</span>
      <span class="td-count" aria-label=${`${items.length} waiting`}>${items.length}</span>
    </h2>
    <div class="sh-meta td-needs__sum" data-testid="needs-you-summary">
      ${enquiries > 0 ? html`<${Chip} icon="bell">${plural(enquiries, 'enquiry', 'enquiries')}<//>` : null}
      ${overdue > 0 ? html`<${Chip} tone="danger" icon="triangle-alert">${`${overdue} overdue`}<//>` : null}
      ${accepted > 0 ? html`<${Chip} tone="ok" icon="badge-check">${`${accepted} accepted ${accepted === 1 ? 'quote' : 'quotes'}`}<//>` : null}
    </div>
    <div class="td-needs">
      ${rows.map((r) => html`<${NeedCard} key=${r.b.id} booking=${r.b} autoConfirm=${autoConfirm} nowStamp=${nowStamp} sla=${r.sla} quote=${r.quote} />`)}
    </div>
  </section>`;
}

// ---------- Quotes to write ----------

function QuotesToWrite({ items }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  return html`<section class="db-section td-section td-o2" data-testid="today-quote-todo" aria-labelledby="td-todo-title">
    <h2 class="db-section__title" id="td-todo-title">
      <span>Quotes to write</span>
      <span class="td-count td-count--quiet" aria-label=${`${items.length} to write`}>${items.length}</span>
    </h2>
    <div class="db-list">
      ${shown.map((it) => {
        const draft = it.quoteStatus === 'draft';
        const href = draft && it.quoteId ? routeHref('quote-detail', { id: it.quoteId }) : routeHref('quote-detail', { id: 'new' }, { booking: it.bookingId });
        return html`<a class="db-list__item td-todo" key=${it.bookingId} href=${href} data-testid=${`today-quote-todo-${it.bookingId}`}>
          <${Avatar} name=${it.customerName} size=${40} />
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

function PipelineBar({ pipeline }) {
  const total = pipeline.stages.reduce((t, s) => t + s.count, 0);
  const label = `Sales pipeline: ${pipeline.stages.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}. Open it.`;
  return html`<a class="td-pipe ui-card td-o3" href=${routeHref('pipeline')} data-testid="today-pipeline" aria-label=${label}>
    <span class="td-pipe__head">
      <span class="td-card-title td-pipe__title">Pipeline</span>
      <span class="td-pipe__value u-tabular">${pipeline.openValue > 0 ? `${gbp(pipeline.openValue)} in play` : 'Nothing open'}</span>
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
    <span class="td-pipe__go">Open pipeline<${Icon} name="chevron-right" size=${18} /></span>
  </a>`;
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

function Tile({ icon, label, href, testid, external }) {
  return html`<a class="td-tile" href=${href} data-testid=${testid}
    target=${external ? '_blank' : undefined} rel=${external ? 'noopener noreferrer' : undefined}>
    <${Icon} name=${icon} size=${22} />
    <span class="td-tile__label">${label}</span>
  </a>`;
}

function NextUp({ booking: b, state, brand, nowStamp, today }) {
  if (!b) {
    return html`<${Card} class="td-next td-next--empty td-o4">
      <${EmptyState} icon="calendar-days" title="No visits or installs coming up. Go put the kettle on." data-testid="today-empty" />
    <//>`;
  }
  const first = firstName(b.customer.name);
  const repeat = selectRepeatInfo(state, b).isRepeat;
  const addressText = [b.address.line1, b.address.postcode].filter(Boolean).join(', ');
  const hello = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name} about your ${isEnquiry(b) ? 'enquiry' : 'booking'} ${b.ref}.`;
  return html`<${Card} as="section" class="td-next td-o4" data-testid="next-up" aria-labelledby="td-next-title">
    <div class="td-next__top">
      <h2 class="td-next__eyebrow" id="td-next-title">Next up</h2>
      <span class="td-next__count">${countdownFor(b, nowStamp, today)}</span>
    </div>
    <p class="td-next__window">${bookingWindowLabel(b)}</p>
    <p class="td-next__service">${b.serviceName}${b.variantLabel ? html`<span class="td-next__variant"> · ${b.variantLabel}</span>` : null}</p>
    <div class="td-next__who">
      <${Avatar} name=${b.customer.name} size=${36} />
      <span class="td-next__name">${b.customer.name}</span>
      ${repeat ? html`<${Chip} tone="accent">Repeat customer<//>` : null}
      ${isEnquiry(b) ? html`<${LeadChip} booking=${b} />` : null}
    </div>
    <a class="td-next__addr" href=${mapsLink(b.address.line1, b.address.postcode)} target="_blank" rel="noopener noreferrer">
      <${Icon} name="map-pin" size=${20} />
      <span>${addressText}</span>
    </a>
    ${b.notes ? html`<p class="td-next__note">“${b.notes}”</p>` : null}
    <${AnswerChips} booking=${b} />
    <p class="td-next__price">${priceLabel(b)}</p>
    <div class="td-next__tiles">
      <${Tile} icon="navigation" label="Navigate" href=${mapsLink(b.address.line1, b.address.postcode)} testid="next-up-navigate" external />
      <${Tile} icon="phone" label="Call" href=${telLink(b.customer.phone)} testid="next-up-call" />
      <${Tile} icon="message-circle" label="WhatsApp" href=${waLink(b.customer.phone, hello, brand.demoPhoneDigits)} testid="next-up-whatsapp" external />
      <${Tile} icon="file-text" label="Details" href=${`#/bookings/${b.id}`} testid="next-up-details" />
    </div>
    <div class="td-next__actions"><${JobActionBar} booking=${b} variant="card" /></div>
  <//>`;
}

// ---------- Money strip and reply promise ----------

function MoneyStrip({ insights, quoteStats }) {
  return html`<section class="td-money td-o5" aria-label="Money" data-testid="today-money">
    <${Stat} label="Collected this month" value=${gbp(insights.collectedMonth)}
      hint=${insights.collectedMonthCount > 0 ? `${plural(insights.collectedMonthCount, 'paid job')}` : 'Nothing paid yet this month'} data-testid="stat-collected" />
    <${Stat} label="Owed to you" value=${gbp(insights.owedTotal)} hint=${plural(insights.owedCount, 'job')} tone=${insights.owedCount > 0 ? 'accent' : undefined}
      href=${routeHref('insights')} data-testid="stat-owed" />
    <${Stat} class="td-money__wide" label="Quotes out" value=${gbp(quoteStats.waitingValue)}
      hint=${quoteStats.waitingCount > 0 ? `${plural(quoteStats.waitingCount, 'quote')} waiting on customers` : 'No quotes waiting on a customer'}
      href=${routeHref('quotes', {}, { f: 'waiting' })} data-testid="stat-quotes-out" />
  </section>`;
}

function ReplyPromise({ sla }) {
  const pct = sla.withinTargetPct;
  const tone = pct === null ? 'neutral' : pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'danger';
  return html`<${Card} as="section" class="td-sla td-o6" data-testid="today-sla" aria-labelledby="td-sla-title">
    <div class="td-sla__head">
      <h2 class="td-card-title" id="td-sla-title">Your reply promise</h2>
      <span class="td-sla__hours">${sla.replyHours} h</span>
    </div>
    ${pct === null
      ? html`<p class="td-sla__text">Reply to your first enquiry and this starts measuring how fast you answer.</p>`
      : html`<${Meter} label=${`Replied within ${sla.replyHours} hours`} value=${pct} max=${100} valueText=${`${pct}%`} tone=${tone} showValue />
        <p class="td-sla__text" data-testid="today-sla-avg">${sla.avgReplyMinutes === null ? '' : `You reply in about ${fmtSpan(sla.avgReplyMinutes)} on average. `}${sla.waitingCount > 0 ? `${plural(sla.waitingCount, 'enquiry', 'enquiries')} waiting now.` : 'Nothing is waiting for a reply.'}</p>`}
  <//>`;
}

// ---------- Availability ----------

function Availability({ settings, today, jobsToday, nextFree }) {
  const tomorrow = addDays(today, 1);
  const closedToday = isClosedDay(settings, today);
  const taking = !closedToday && !settings.fullDays.includes(today);
  const tomorrowOff = isClosedDay(settings, tomorrow);
  const nextWeek = weekDates(addDays(weekStart(today), 7));
  const weekOff = nextWeek.every((d) => settings.daysOff.some((o) => o.date === d));

  const onToggle = (checked) => {
    const res = setDayFull(today, !checked);
    if (!res.ok) { failToast(res); return; }
    doneToast(checked ? 'Taking bookings again today.' : 'Marked full for today. No new survey visits will be pencilled in today.', res.undoToken);
  };
  const takeTomorrow = () => {
    const res = addDaysOff([tomorrow], 'Day off');
    if (!res.ok) { failToast(res); return; }
    doneToast(`Tomorrow marked as a day off. Nothing new can be pencilled in.${res.bookedCount > 0 ? bookedJobsNote(res.bookedCount) : ''}`, res.undoToken);
  };
  const takeWeek = () => {
    const res = addDaysOff(nextWeek, 'Holiday');
    if (!res.ok) { failToast(res); return; }
    doneToast(`Next week marked as days off.${res.bookedCount > 0 ? bookedJobsNote(res.bookedCount) : ''}`, res.undoToken);
  };

  return html`<${Card} as="section" class="td-avail td-o9" data-testid="today-availability" aria-labelledby="td-avail-title">
    <h2 class="td-card-title" id="td-avail-title">Availability</h2>
    <${Switch} id="td-taking-bookings" data-testid="today-taking-bookings" checked=${taking} disabled=${closedToday}
      label="Taking bookings today"
      description=${closedToday ? 'Today is closed.' : taking ? 'Survey visits can be pencilled into your free windows today.' : undefined}
      onChange=${onToggle} />
    ${!closedToday && !taking
      ? html`<${Banner} tone="warn">Full today. No new survey visits can be pencilled in today.${jobsToday === 0 ? '' : jobsToday === 1 ? ' Your 1 job stays in your diary.' : ` Your ${jobsToday} jobs stay in your diary.`}<//>`
      : null}
    <p class="td-avail__next" data-testid="stat-next-free"><${Icon} name="calendar-clock" size=${18} /><span>Next free survey slot: <strong>${nextFree ? nextFree.human : 'none free'}</strong></span></p>
    <div class="td-btnrow">
      <${Button} size="sm" icon="calendar-x" disabled=${tomorrowOff} onClick=${takeTomorrow} data-testid="today-take-tomorrow-off">${tomorrowOff ? 'Tomorrow is off' : 'Take tomorrow off'}<//>
      <${Button} size="sm" icon="calendar-x" disabled=${weekOff} onClick=${takeWeek} data-testid="today-take-week-off">${weekOff ? 'Next week is off' : 'Take next week off'}<//>
    </div>
  <//>`;
}

// ---------- Today's diary ----------

function JobRow({ booking: b, compact }) {
  const meta = [firstName(b.customer.name), outwardCode(b.address.postcode), priceLabel(b)].filter(Boolean);
  if (b.urgent && b.etaAt && b.status !== 'done') meta.push(`ETA ${fmtClock(b.etaAt)}`);
  return html`<a class=${`td-row${compact ? ' td-row--compact' : ''}`} href=${`#/bookings/${b.id}`} data-testid=${compact ? undefined : `today-job-${b.id}`}>
    <span class="td-row__head">
      <span class="td-row__when">${bookingWindowLabel(b)}</span>
      <${BookingPill} booking=${b} compact />
    </span>
    <span class="td-row__svc">${b.serviceName}</span>
    <span class="td-row__meta">${meta.join(' · ')}</span>
  </a>`;
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
  return html`<section class="db-section td-section td-o7" aria-labelledby="td-diary-title">
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

function Tomorrow({ state, nowDate, today }) {
  const tomorrow = addDays(today, 1);
  const day = selectNextOpenDay(state, today) || tomorrow;
  const jobs = selectBookingsOn(state, day);
  const free = getDayLoad(state, day, { now: nowDate }).free;
  const shown = jobs.slice(0, 4);
  return html`<section class="db-section td-section td-o8" data-testid="tomorrow-list" aria-labelledby="td-tomorrow-title">
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
      ${jobs.length > shown.length ? html`<span class="td-quiet">${`and ${jobs.length - shown.length} more`}</span>` : html`<span></span>`}
      <${Button} variant="ghost" size="sm" iconRight="chevron-right" href=${`#/calendar/${day}`}>Open calendar<//>
    </div>
  </section>`;
}

// ---------- Share ----------

function Share({ brand }) {
  const url = `${SITE_BASE_URL}index.html`;
  const text = `Get a home EV charger quote from ${brand.name}: ${url}`;
  const onCopy = async () => {
    const ok = await copyText(url);
    toast({ message: ok ? 'Link copied' : 'Could not copy. Select the link and copy it.', tone: ok ? 'default' : 'danger' });
  };
  return html`<${Card} as="section" class="td-share td-o10" data-testid="share-card" aria-labelledby="td-share-title">
    <h2 class="td-card-title" id="td-share-title">Share and promote</h2>
    <p class="td-share__text">Your enquiry page, a QR code for the van and flyers, and a tracked link for each ad.</p>
    <p class="td-share__url u-mono">${url}</p>
    <div class="td-btnrow">
      <${Button} size="sm" icon="send" href=${waShareLink(text)} data-testid="share-whatsapp">Send on WhatsApp<//>
      <${Button} size="sm" icon="copy" onClick=${onCopy} data-testid="share-copy">Copy link<//>
    </div>
    <${Button} variant="primary" size="sm" icon="qr-code" href=${routeHref('share')} data-testid="share-open">QR code and campaign links<//>
  <//>`;
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

  const needText = needs.length === 1 ? '1 needs you' : `${needs.length} need you`;
  const subtitle = `${fmtDayShort(today)} · ${plural(jobsToday.length, 'job')} today · ${needText}`;

  return html`<div class="db-page td-page" data-testid="today-view">
    <${PageHeader} title=${`${greeting(nowDate)}, ${brand.ownerFirst}`} subtitle=${subtitle} />
    <div class="td-layout">
      <div class="td-col td-col--left">
        <${NeedsYou} state=${state} items=${needs} autoConfirm=${state.settings.autoConfirm} nowStamp=${nowStamp} replyHours=${sla.replyHours} />
        <${QuotesToWrite} items=${toWrite} />
        <${NextUp} booking=${nextUp} state=${state} brand=${brand} nowStamp=${nowStamp} today=${today} />
        <${Diary} state=${state} nowDate=${nowDate} today=${today} closedToday=${closedToday} jobsCount=${jobsToday.length} />
        <${Tomorrow} state=${state} nowDate=${nowDate} today=${today} />
      </div>
      <div class="td-col td-col--right">
        <${PipelineBar} pipeline=${pipeline} />
        <${MoneyStrip} insights=${insights} quoteStats=${quoteStats} />
        <${ReplyPromise} sla=${sla} />
        <${Availability} settings=${state.settings} today=${today} jobsToday=${jobsToday.length} nextFree=${nextFree} />
        <${Share} brand=${brand} />
      </div>
    </div>
  </div>`;
}
