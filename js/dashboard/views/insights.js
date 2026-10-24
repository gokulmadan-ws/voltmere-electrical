// js/dashboard/views/insights.js: Insights, money and marketing (collected, owed, quotes out, win rate, lead sources, ad cost, funnel, reply time, weekly money).
// Owner: P1 (was WP7; rebuilt for v3 around money and the Facebook ads he pays for)
import { html, useMemo, useState } from '../../vendor/preact-htm.js';
import {
  Button, Card, Disclosure, EmptyState, Field, Icon, IconButton, MoneyInput, PageHeader, ProgressRing, SampleTag, Segmented,
  Stat, cx, toast, showUndoToast, useBrand, useNow, useStore
} from '../../ui/index.js';
import { AD_CHANNELS, AD_CHANNEL_LABELS } from '../../core/config.js';
import {
  selectCostPerLead, selectInsights, selectLeadSources, selectOwed, selectQuoteStats, selectSla
} from '../../core/selectors.js';
import { sendPaymentNudge, setAdSpend, undo } from '../../core/store.js';
import { MONTH_LONG, addDays, diffDays, monthKeyOf, stampDay, toStamp } from '../../core/dates.js';
import { plural } from '../../core/format.js';
import { waLink } from '../../core/messages.js';
import { navigate, routeHref } from '../router.js';
import { PaidButton } from '../shared/job-actions.js';

export const title = 'Insights';
export const css = ['css/insights.css', 'css/bookings.css'];

// Whole state (identity is stable between mutations); the selectors below build fresh objects, so they run inside useMemo.
const selectState = (state) => state;

const priceOf = (b) => (b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);
const pounds = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;

/** 12 min, 4 h 14 min, 2 days 3 h. */
function spanText(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest && h < 10 ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} ${d === 1 ? 'day' : 'days'} ${h % 24} h` : `${d} ${d === 1 ? 'day' : 'days'}`;
}

// ---------- month arithmetic (ad spend is monthly) ----------

function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
const monthLabel = (key) => `${MONTH_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const monthName = (key) => MONTH_LONG[Number(key.slice(5, 7)) - 1];
const lastDayOf = (key) => addDays(`${shiftMonth(key, 1)}-01`, -1);
const MAX_MONTHS_BACK = 24;

// ---------- periods (lead sources and the funnel) ----------

const PERIODS = [
  { id: 'month', label: 'This month', words: 'this month' },
  { id: 'last_month', label: 'Last month', words: 'last month' },
  { id: '3m', label: '3 months', words: 'over the last three months' },
  { id: 'all', label: 'All time', words: 'across everything so far' }
];

/** Generic failure rule (8.3): a reason this screen does not handle specially. */
function failToast(res) {
  toast({
    message: res && res.reason === 'not_found'
      ? 'That booking no longer exists.'
      : 'That did not work: the diary changed. Please check and try again.',
    tone: 'danger'
  });
}

function daysAgoText(booking, todayDay) {
  const n = diffDays(stampDay(booking.start), todayDay);
  if (n <= 0) return 'today';
  return n === 1 ? '1 day ago' : `${n} days ago`;
}

// ---------- small shared pieces ----------

function SectionHead({ id, title: heading, sub, children }) {
  return html`<div class="in-head">
    <div class="in-head__text">
      <h2 class="db-section__title in-head__title" id=${id}>${heading}</h2>
      ${sub ? html`<p class="in-head__sub">${sub}</p>` : null}
    </div>
    ${children}
  </div>`;
}

/** A table twin of a chart: closed by default, scrolls inside itself, never widens the page. */
function ChartTable({ caption, columns, rows, testid }) {
  return html`<${Disclosure} title="View as a table" class="in-tabledisc" testid=${testid}>
    <div class="in-tablewrap" tabindex="0" role="region" aria-label=${caption}>
      <table class="in-table">
        <caption class="u-sr-only">${caption}</caption>
        <thead><tr>${columns.map((c, i) => html`<th scope="col" key=${c.key} class=${cx(i > 0 && 'is-num')}>${c.header}</th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr key=${r.key}>${columns.map((c, i) => (i === 0
          ? html`<th scope="row" key=${c.key}>${r[c.key]}</th>`
          : html`<td key=${c.key} class="is-num">${r[c.key]}</td>`))}</tr>`)}</tbody>
      </table>
    </div>
  <//>`;
}

// ---------- headline row ----------

function Headline({ ins, quotes }) {
  const quotesOutHint = quotes.waitingCount > 0
    ? `${plural(quotes.waitingCount, 'quote')} with customers${quotes.draftCount ? `, ${pounds(quotes.draftValue)} in drafts` : ''}`
    : quotes.draftCount ? `Nothing sent. ${pounds(quotes.draftValue)} in drafts` : 'No quotes out';
  return html`<div class="in-stats" data-testid="p1-headline">
    <${Stat} label="Collected this month" value=${pounds(ins.collectedMonth)} hint=${plural(ins.collectedMonthCount, 'job')} tone="ok" data-testid="insights-collected" />
    <${Stat} label="Owed to you" value=${pounds(ins.owedTotal)} hint=${plural(ins.owedCount, 'job')} tone=${ins.owedCount > 0 ? 'accent' : undefined} data-testid="insights-owed" />
    <${Stat} label="Quotes out" value=${pounds(quotes.waitingValue)} hint=${quotesOutHint}
      href=${routeHref('quotes', {}, { f: 'waiting' })} data-testid="p1-quotes-out" />
    <${Stat} label="Win rate" value=${quotes.winRatePct === null ? '—' : `${quotes.winRatePct}%`}
      hint=${quotes.decided ? `${quotes.accepted} won of ${quotes.decided} decided, last 90 days` : 'No quotes decided in the last 90 days'} data-testid="p1-win-rate" />
  </div>`;
}

// ---------- owed to you (the existing list, unchanged behaviour) ----------

function OwedRow({ booking, todayDay, brand }) {
  const b = booking;
  const nudge = () => {
    const res = sendPaymentNudge(b.id);
    if (!res || !res.ok) { failToast(res); return; }
    // The message is only logged here; the wa.me link opens the owner's own WhatsApp with the same text.
    window.open(waLink(b.customer.phone, res.message.body, brand.demoPhoneDigits), '_blank', 'noopener,noreferrer');
    toast({ message: 'Payment reminder logged (simulated).' });
  };
  return html`<li class="in-owed__row" data-testid=${`owed-row-${b.id}`}>
    <div class="in-owed__top">
      <a class="in-owed__who" href=${routeHref('bookings', { id: b.id })}>
        <span class="in-owed__name">${b.customer.name}</span>
        <span class="in-owed__meta">${b.serviceName} · ${daysAgoText(b, todayDay)}</span>
      </a>
      <span class="in-owed__amount">${pounds(priceOf(b))}</span>
    </div>
    <div class="in-owed__actions">
      <${Button} size="sm" icon="message-circle" onClick=${nudge} data-testid=${`owed-nudge-${b.id}`}>Nudge<//>
      <${PaidButton} booking=${b} size="sm" />
    </div>
  </li>`;
}

function OwedSection({ owed, todayDay, brand }) {
  return html`<section class="db-section in-sec in-sec--owed" aria-labelledby="in-h-owed">
    <${SectionHead} id="in-h-owed" title="Owed to you" sub=${owed.length ? 'Done jobs that have not been paid yet, oldest first.' : null} />
    ${owed.length === 0
      ? html`<${Card}><${EmptyState} icon="circle-check" title="Nothing to collect. Nice." data-testid="owed-empty" /><//>`
      : html`<ul class="db-list in-owed" data-testid="owed-list">
        ${owed.map((b) => html`<${OwedRow} key=${b.id} booking=${b} todayDay=${todayDay} brand=${brand} />`)}
      </ul>`}
  </section>`;
}

// ---------- reply time vs the promise ----------

function ReplySection({ sla }) {
  const hours = sla.replyHours;
  const pct = sla.withinTargetPct;
  const tone = pct === null ? 'neutral' : pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'danger';
  const avgP = sla.avgReplyMinutes === null ? 0 : Math.min(1, sla.avgReplyMinutes / (hours * 60));
  const avgTone = avgP < 0.5 ? 'ok' : avgP < 1 ? 'warn' : 'danger'; // the average against the promise, drawn to the same scale
  const inside = sla.waitingCount - sla.overdueCount - sla.dueSoonCount;
  const rows = [
    ...sla.overdue.map((r) => ({ ...r, kind: 'overdue', text: `Overdue by ${spanText(r.minutesOverdue)}` })),
    ...sla.dueSoon.map((r) => ({ ...r, kind: 'soon', text: `Due in ${spanText(r.minutesLeft)}` }))
  ];
  return html`<section class="db-section in-sec in-sec--reply" aria-labelledby="in-h-reply" data-testid="p1-reply">
    <${SectionHead} id="in-h-reply" title=${`Reply time vs your ${hours} hour promise`} sub="How fast you answer new enquiries." />
    <${Card} class="in-reply">
      ${pct === null
        ? html`<${EmptyState} icon="timer" title="No replies to measure yet" body="Once you answer your first enquiry, your reply time shows here." data-testid="p1-reply-empty" />`
        : html`<div class="in-reply__top">
            <${ProgressRing} label=${`Replied within ${hours} hours`} value=${pct} max=${100} size=${84} stroke=${8} tone=${tone} valueText=${`${pct}%`} data-testid="p1-reply-ring">${pct}%<//>
            <div class="in-reply__text">
              <p class="in-reply__lead" data-testid="p1-reply-pct"><strong>${pct}%</strong> answered within ${hours} hours</p>
              <p class="in-reply__sub">${plural(sla.repliedCount, 'enquiry', 'enquiries')} replied to${sla.overdueCount ? `, ${sla.overdueCount} waiting too long` : ''}.</p>
            </div>
          </div>
          <div class="in-avg" data-testid="p1-reply-avg">
            <div class="in-avg__row"><span>Average reply</span><strong>${sla.avgReplyMinutes === null ? '—' : spanText(sla.avgReplyMinutes)}</strong></div>
            <div class="in-avg__track" aria-hidden="true"><span class=${cx('in-avg__fill', `in-avg__fill--${avgTone}`)} style=${{ '--p': avgP }}></span></div>
            <div class="in-avg__scale" aria-hidden="true"><span>0</span><span>${hours} h promise</span></div>
          </div>`}
      <div class="in-wait">
        <h3 class="in-sub">Waiting for your reply</h3>
        ${sla.waitingCount === 0
          ? html`<p class="in-wait__none" data-testid="p1-reply-none"><${Icon} name="circle-check" size=${18} />Nothing is waiting for a reply.</p>`
          : html`
            ${rows.length ? html`<ul class="in-wait__list" data-testid="p1-reply-list">
              ${rows.map((r) => html`<li class=${cx('in-wait__row', `is-${r.kind}`)} key=${r.bookingId} data-testid=${`p1-wait-${r.bookingId}`}>
                <span class="in-wait__who"><span class="in-wait__name">${r.customerName}</span>
                  <span class="in-wait__when"><${Icon} name=${r.kind === 'overdue' ? 'triangle-alert' : 'timer'} size=${14} />${r.text}</span></span>
                <${Button} size="sm" icon="message-circle" href=${routeHref('bookings', { id: r.bookingId })} data-testid=${`p1-wait-reply-${r.bookingId}`}>Reply<//>
              </li>`)}
            </ul>` : null}
            ${inside > 0 ? html`<p class="in-wait__more">${rows.length ? `${inside} more ${inside === 1 ? 'is' : 'are'}` : `${plural(inside, 'enquiry', 'enquiries')} ${inside === 1 ? 'is' : 'are'}`} waiting, still inside your promise.</p>` : null}`}
      </div>
    <//>
  </section>`;
}

// ---------- where enquiries come from ----------

function SourcesSection({ data, period, onPeriod }) {
  const rows = data.sources.filter((s) => s.enquiries > 0);
  const max = Math.max(1, ...rows.map((s) => s.enquiries));
  const words = (PERIODS.find((p) => p.id === period) || PERIODS[0]).words;
  return html`<section class="db-section in-sec in-sec--sources" aria-labelledby="in-h-sources" data-testid="p1-sources">
    <${SectionHead} id="in-h-sources" title="Where enquiries come from"
      sub=${data.total.enquiries ? `${plural(data.total.enquiries, 'enquiry', 'enquiries')} ${words}. Counted from the day each one arrived.` : null} />
    <${Segmented} size="sm" ariaLabel="Period for sources and funnel" value=${period} onChange=${onPeriod} class="in-period"
      options=${PERIODS.map((p) => ({ value: p.id, label: p.label, testid: `p1-period-${p.id}` }))} data-testid="p1-period" />
    <${Card} class="in-card">
      ${rows.length === 0
        ? html`<${EmptyState} icon="megaphone" title="No enquiries in this period" body="When someone fills in your funnel, you will see which ad or link brought them." data-testid="p1-sources-empty" />`
        : html`<ul class="in-src" data-testid="p1-sources-list">
          ${rows.map((s) => html`<li class="in-src__row" key=${s.id} data-testid=${`p1-source-${s.id}`}>
            <div class="in-src__head">
              <span class="in-src__name">${s.label}</span>
              <span class="in-src__count"><span data-testid=${`p1-source-n-${s.id}`}>${s.enquiries}</span> <span class="in-src__share">${s.enquiries === 1 ? 'enquiry' : 'enquiries'} · ${s.sharePct}%</span></span>
            </div>
            <div class="in-bar in-bar--full" aria-hidden="true"><span class="in-bar__fill" style=${{ '--p': s.enquiries / max }}></span></div>
            <div class="in-src__foot">
              <span class="in-src__stats">${plural(s.quotes, 'quote')} · ${s.accepted} won · ${s.installs} installed</span>
              <span class=${cx('in-src__rev', s.revenue === 0 && 'is-zero')} data-testid=${`p1-source-rev-${s.id}`}>${s.revenue > 0 ? `${pounds(s.revenue)} in` : 'No money in yet'}</span>
            </div>
          </li>`)}
        </ul>
        <${ChartTable} caption="Enquiries, quotes, wins, installs and money by source" testid="p1-sources-table"
          columns=${[
            { key: 'source', header: 'Source' }, { key: 'enq', header: 'Enquiries' }, { key: 'quotes', header: 'Quotes' },
            { key: 'won', header: 'Won' }, { key: 'inst', header: 'Installed' }, { key: 'rev', header: 'Money in' }
          ]}
          rows=${[...rows.map((s) => ({ key: s.id, source: s.label, enq: s.enquiries, quotes: s.quotes, won: s.accepted, inst: s.installs, rev: pounds(s.revenue) })),
            { key: 'total', source: 'All sources', enq: data.total.enquiries, quotes: data.total.quotes, won: data.total.accepted, inst: data.total.installs, rev: pounds(data.total.revenue) }]} />`}
    <//>
  </section>`;
}

// ---------- what your ads cost ----------

function CostRow({ label, value, hint, blank, blankHint, testid }) {
  return html`<li class="in-cost__row" data-testid=${testid}>
    <span class="in-cost__text"><span class="in-cost__label">${label}</span><span class="in-cost__hint">${value === null ? blankHint : hint}</span></span>
    <span class=${cx('in-cost__value', value === null && 'is-blank')}>${value === null
      ? html`<span aria-hidden="true">—</span><span class="u-sr-only">${blank}</span>`
      : pounds(value)}</span>
  </li>`;
}

function AdsSection({ state, stamp, month, onMonth }) {
  const thisMonth = monthKeyOf(stamp);
  const cost = useMemo(() => selectCostPerLead(state, { from: `${month}-01`, to: lastDayOf(month) }, stamp), [state, month, stamp]);
  const entries = state.settings.marketing.adSpend.filter((e) => e.month === month);
  const stored = Object.fromEntries(entries.map((e) => [e.channel, e.amount]));
  const isSample = entries.some((e) => e.seed);
  const [draft, setDraft] = useState({});     // only the channels that were touched: { channel: number | null }
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const shown = (channel) => (channel in draft ? draft[channel] : (stored[channel] === undefined ? null : stored[channel]));
  const changed = AD_CHANNELS.filter((c) => c in draft && (draft[c] || 0) !== (stored[c] || 0));
  const dirty = changed.length > 0;

  /** Save every changed channel. Returns true when all of them were saved (or nothing changed). */
  const save = ({ quiet = false } = {}) => {
    if (!dirty) return true;
    setSaving(true);
    const tokens = [];
    const bad = {};
    for (const channel of changed) {
      const res = setAdSpend(month, channel, draft[channel] || 0);
      if (res && res.ok) { if (res.undoToken) tokens.push(res.undoToken); } else bad[channel] = (res && res.errors && res.errors.amount) || (res && res.reason === 'storage_full' ? 'This browser has no room left to save that.' : 'That did not save. Try again.');
    }
    setSaving(false);
    setErrors(bad);
    const failed = Object.keys(bad);
    // What was saved leaves the draft; what failed stays on screen to fix.
    setDraft((d) => Object.fromEntries(Object.entries(d).filter(([c]) => failed.includes(c))));
    if (failed.length) {
      toast({ message: 'Some ad spend did not save. Check the amounts and try again.', tone: 'danger' });
      return false;
    }
    if (!quiet && tokens.length) {
      toast({
        message: `Ad spend saved for ${monthName(month)}.`, actionLabel: 'Undo',
        onAction: () => { for (const t of tokens.slice().reverse()) { const r = undo(t); if (!r || !r.ok) { toast({ message: 'Too late to undo.' }); return; } } }
      });
    }
    return true;
  };

  const goMonth = (next) => {
    if (dirty && !save({ quiet: true })) return; // never walk away from numbers that did not save
    setDraft({});
    setErrors({});
    onMonth(next);
  };

  const hasSpend = cost.hasSpend;
  const adWord = (n) => `${plural(n, 'enquiry', 'enquiries')} from ads`;
  const channelRows = cost.byChannel.filter((c) => c.spend > 0 || c.enquiries > 0);
  const spendChannels = cost.byChannel.filter((c) => c.spend > 0).map((c) => c.label);
  const noSpendHint = 'Add what you spent below to see this.';
  const noneYet = (what) => `No ${what} yet from this spend.`;

  return html`<section class="db-section in-sec in-sec--ads" aria-labelledby="in-h-ads" data-testid="p1-ads">
    <${SectionHead} id="in-h-ads" title="What your ads cost" sub="Enter what you spent each month and see what an enquiry, a won quote and an install really cost." />
    <${Card} class="in-card">
      <div class="in-month" data-testid="p1-ad-month">
        <${IconButton} icon="chevron-left" label="Previous month" onClick=${() => goMonth(shiftMonth(month, -1))}
          disabled=${month <= shiftMonth(thisMonth, -MAX_MONTHS_BACK)} data-testid="p1-month-prev" />
        <p class="in-month__label" role="status" aria-live="polite" data-testid="p1-month-label">${monthLabel(month)}${isSample ? html` <${SampleTag} />` : null}</p>
        <${IconButton} icon="chevron-right" label="Next month" onClick=${() => goMonth(shiftMonth(month, 1))}
          disabled=${month >= thisMonth} data-testid="p1-month-next" />
      </div>

      <div class="in-spend">
        <p class="in-spend__value" data-testid="p1-ad-spend">${pounds(cost.spend)}</p>
        <p class="in-spend__sub">${hasSpend
          ? `spent on ${spendChannels.length === 1 ? spendChannels[0] : `${spendChannels.slice(0, -1).join(', ')} and ${spendChannels[spendChannels.length - 1]}`} in ${monthName(month)}`
          : `No ad spend recorded for ${monthName(month)}`}</p>
      </div>

      <ul class="in-cost" data-testid="p1-costs">
        <${CostRow} label="Cost per enquiry" value=${cost.costPerEnquiry} hint=${adWord(cost.adEnquiries)} blank="No figure yet"
          blankHint=${hasSpend ? noneYet('enquiries') : noSpendHint} testid="p1-cost-enquiry" />
        <${CostRow} label="Cost per accepted quote" value=${cost.costPerAccepted} hint=${`${plural(cost.adAccepted, 'quote')} accepted`} blank="No figure yet"
          blankHint=${hasSpend ? noneYet('accepted quotes') : noSpendHint} testid="p1-cost-accepted" />
        <${CostRow} label="Cost per install" value=${cost.costPerInstall} hint=${`${plural(cost.adInstalls, 'install')} done`} blank="No figure yet"
          blankHint=${hasSpend ? noneYet('installs') : noSpendHint} testid="p1-cost-install" />
      </ul>
      ${hasSpend ? html`<p class="in-fine">Only ad enquiries are counted. Word of mouth and phone enquiries are left out, so the cost is not flattered. Installs lag behind enquiries, so recent months look dearer than they will end up.</p>` : null}

      ${channelRows.length ? html`<div class="in-tablewrap in-chan" tabindex="0" role="region" aria-label="Ad spend and enquiries by channel">
        <table class="in-table" data-testid="p1-ad-channels">
          <caption class="u-sr-only">${`Ad spend and enquiries by channel, ${monthLabel(month)}`}</caption>
          <thead><tr><th scope="col">Channel</th><th scope="col" class="is-num">Spent</th><th scope="col" class="is-num">Enquiries</th><th scope="col" class="is-num">Per enquiry</th></tr></thead>
          <tbody>${channelRows.map((c) => html`<tr key=${c.channel}>
            <th scope="row">${c.label}</th>
            <td class="is-num">${c.spend > 0 ? pounds(c.spend) : '—'}</td>
            <td class="is-num">${c.enquiries}</td>
            <td class="is-num">${c.costPerEnquiry === null ? '—' : pounds(c.costPerEnquiry)}</td>
          </tr>`)}</tbody>
        </table>
      </div>` : null}

      <form class="in-form" onSubmit=${(e) => { e.preventDefault(); save(); }} data-testid="p1-ad-form" aria-label=${`Ad spend for ${monthLabel(month)}`}>
        <h3 class="in-sub">What you spent in ${monthName(month)}</h3>
        <div class="in-form__grid">
          ${AD_CHANNELS.map((channel) => html`<${Field} key=${channel} label=${AD_CHANNEL_LABELS[channel]} id=${`p1-ad-${channel}`} error=${errors[channel]}>
            <${MoneyInput} id=${`p1-ad-${channel}`} value=${shown(channel)} allowEmpty max=${99999} placeholder="0"
              onChange=${(n) => { setDraft((d) => ({ ...d, [channel]: n })); setErrors((e) => { const { [channel]: gone, ...rest } = e; return rest; }); }}
              data-testid=${`p1-ad-input-${channel}`} />
          <//>`)}
        </div>
        <div class="in-form__actions">
          <${Button} variant="primary" type="submit" icon="check" loading=${saving} disabled=${!dirty} data-testid="p1-ad-save">Save ad spend<//>
          <p class="in-form__state" role="status">${dirty ? 'You have changes that are not saved yet.' : (entries.length ? 'Saved on this device.' : 'Leave a channel empty if you spent nothing.')}</p>
        </div>
      </form>
    <//>
  </section>`;
}

// ---------- enquiry to install funnel ----------

function FunnelSection({ data, period }) {
  const t = data.total;
  const steps = [
    { id: 'enquiries', label: 'Enquiries', n: t.enquiries, of: null, ofLabel: '' },
    { id: 'quotes', label: 'Quotes sent', n: t.quotes, of: t.enquiries, ofLabel: 'enquiries' },
    { id: 'accepted', label: 'Quotes accepted', n: t.accepted, of: t.quotes, ofLabel: 'quotes sent' },
    { id: 'installs', label: 'Installed', n: t.installs, of: t.accepted, ofLabel: 'accepted' }
  ];
  const max = Math.max(1, ...steps.map((s) => s.n));
  const conv = (s) => (s.of === null ? null : s.of > 0 ? Math.round((100 * s.n) / s.of) : null);
  const words = (PERIODS.find((p) => p.id === period) || PERIODS[0]).words;
  const overall = t.enquiries > 0 ? Math.round((100 * t.installs) / t.enquiries) : null;
  return html`<section class="db-section in-sec in-sec--funnel" aria-labelledby="in-h-funnel" data-testid="p1-funnel">
    <${SectionHead} id="in-h-funnel" title="Enquiry to install funnel" sub=${`Same period as above: ${words}.`} />
    <${Card} class="in-card">
      ${t.enquiries === 0
        ? html`<${EmptyState} icon="filter" title="No enquiries in this period" body="The funnel fills in as enquiries become quotes and installs." data-testid="p1-funnel-empty" />`
        : html`<ol class="in-fun" data-testid="p1-funnel-list">
          ${steps.map((s) => {
            const c = conv(s);
            return html`<li class="in-fun__row" key=${s.id} data-testid=${`p1-funnel-${s.id}`}>
              <div class="in-fun__head">
                <span class="in-fun__label">${s.label}</span>
                <span class="in-fun__num"><strong>${s.n}</strong>${s.of === null ? null : html` <span class="in-fun__pct">${c === null ? '—' : `${c}%`} of ${s.ofLabel}</span>`}</span>
              </div>
              <div class="in-bar in-bar--full" aria-hidden="true"><span class=${cx('in-bar__fill', s.id === 'installs' && 'in-bar__fill--ok')} style=${{ '--p': s.n / max }}></span></div>
            </li>`;
          })}
        </ol>
        <p class="in-fine" data-testid="p1-funnel-overall">${overall === null ? '' : `${overall}% of these enquiries have ended up as an install so far. `}Recent enquiries have not had time to finish yet.</p>
        <${ChartTable} caption="Enquiry to install funnel" testid="p1-funnel-table"
          columns=${[{ key: 'step', header: 'Step' }, { key: 'n', header: 'Count' }, { key: 'conv', header: 'Of the step before' }]}
          rows=${steps.map((s) => ({ key: s.id, step: s.label, n: s.n, conv: s.of === null ? '—' : (conv(s) === null ? '—' : `${conv(s)}% of ${s.ofLabel}`) }))} />`}
    <//>
  </section>`;
}

// ---------- money: collected per week, by service ----------

function WeeklySection({ ins }) {
  const weeks = ins.weeks;
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const none = weeks.every((w) => w.total === 0);
  return html`<section class="db-section in-sec in-sec--weeks" aria-labelledby="in-h-weeks">
    <${SectionHead} id="in-h-weeks" title="Collected per week" sub="Money you marked as paid, by week." />
    <${Card} class="in-card">
      <div class="in-minor">
        <${Stat} label="Booked next 14 days" value=${pounds(ins.bookedNext14)} hint=${plural(ins.bookedNext14Count, 'booking')} data-testid="insights-booked-next" />
        <${Stat} label="Average job" value=${pounds(ins.avgJob)} hint="last 30 days, paid jobs" data-testid="insights-avg" />
      </div>
      ${none
        ? html`<p class="in-fine" data-testid="p1-weeks-empty">No payments marked in the last six weeks. They show here as soon as you mark a job as paid.</p>`
        : html`<div class="in-weeks" data-testid="insights-weeks">
          <ol class="in-weeks__list">
            ${weeks.map((w, i) => html`<li class=${cx('in-week', i === weeks.length - 1 && 'is-current', w.total === 0 && 'is-zero')} key=${w.weekStart} data-testid=${`insights-weekbar-${i}`}>
              <span class="in-week__label">${w.label}</span>
              <span class="in-bar in-bar--money" aria-hidden="true"><span class="in-bar__fill" style=${{ '--p': w.total / max }}></span><span class="in-bar__val">${pounds(w.total)}</span></span>
              <span class="u-sr-only">${pounds(w.total)}</span>
            </li>`)}
          </ol>
          <p class="in-fine">Weeks start on Monday. The last bar is this week so far.</p>
        </div>
        <${ChartTable} caption="Collected per week, weeks starting on the Monday shown" testid="p1-weeks-table"
          columns=${[{ key: 'week', header: 'Week starting' }, { key: 'total', header: 'Collected' }]}
          rows=${weeks.map((w) => ({ key: w.weekStart, week: w.label, total: pounds(w.total) }))} />`}
    <//>
  </section>`;
}

function ServiceSection({ ins }) {
  if (!ins.byService.length) return null;
  return html`<section class="db-section in-sec in-sec--service" aria-labelledby="in-h-service">
    <${SectionHead} id="in-h-service" title="By service" />
    <ul class="db-list" data-testid="insights-by-service">
      ${ins.byService.map((s) => {
        const survey = s.serviceId === 'ev_quote';
        return html`<li class="db-list__item in-svc" key=${s.serviceId}>
          <span class="in-svc__name">${survey ? 'Free surveys' : s.name}</span>
          <span class="in-svc__jobs">${survey ? plural(s.jobs, 'visit') : plural(s.jobs, 'job')}</span>
          <span class="in-svc__total">${survey ? 'Free' : pounds(s.total)}</span>
        </li>`;
      })}
    </ul>
  </section>`;
}

// ---------- view ----------

export default function InsightsView({ route }) {
  const state = useStore(selectState);
  const brand = useBrand();
  const stamp = toStamp(useNow(60000));
  const todayDay = stampDay(stamp);
  const thisMonth = monthKeyOf(stamp);

  const wantedPeriod = route && route.query ? route.query.p : '';
  const period = PERIODS.some((p) => p.id === wantedPeriod) ? wantedPeriod : 'month';
  const setPeriod = (id) => navigate(routeHref('insights', {}, { p: id === 'month' ? '' : id }), { replace: true });
  const [month, setMonth] = useState(thisMonth);

  const ins = useMemo(() => selectInsights(state, stamp), [state, stamp]);
  const owed = useMemo(() => selectOwed(state), [state]);
  const quotes = useMemo(() => selectQuoteStats(state, '90d', stamp), [state, stamp]);
  const sla = useMemo(() => selectSla(state, stamp), [state, stamp]);
  const sources = useMemo(() => selectLeadSources(state, period, stamp), [state, period, stamp]);

  return html`<div class="db-page in-page" data-testid="p1-insights">
    <${PageHeader} title="Insights" subtitle=${`${monthName(thisMonth)} so far`} />
    <${Headline} ins=${ins} quotes=${quotes} />

    <div class="in-cols">
      <div class="in-col in-col--money">
        <${OwedSection} owed=${owed} todayDay=${todayDay} brand=${brand} />
        <${ReplySection} sla=${sla} />
        <${WeeklySection} ins=${ins} />
        <${ServiceSection} ins=${ins} />
      </div>
      <div class="in-col in-col--marketing">
        <${SourcesSection} data=${sources} period=${period} onPeriod=${setPeriod} />
        <${AdsSection} state=${state} stamp=${stamp} month=${month} onMonth=${setMonth} />
        <${FunnelSection} data=${sources} period=${period} />
      </div>
    </div>

    <p class="in-note">Figures come from the sample bookings and sample ad spend in this browser. Your own entries replace them as you go.</p>
  </div>`;
}
