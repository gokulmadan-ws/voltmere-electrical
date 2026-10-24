// js/dashboard/views/quotes.js: Quotes list (status filters, totals, "Waiting on customer") plus the small pieces the quote builder shares (pill, ages, brand names).
// Owner: Q1
import { html } from '../../vendor/preact-htm.js';
import { Avatar, Button, EmptyState, Icon, PageHeader, Tabs, cx, useBrand, useNow, useStore } from '../../ui/index.js';
import { selectQuoteList, selectQuoteStats } from '../../core/selectors.js';
import { fmtDayShort, minutesBetween, toStamp } from '../../core/dates.js';
import { firstName, gbp } from '../../core/format.js';
import { quoteShareUrl } from '../../core/quotes.js';
import { waLink } from '../../core/messages.js';
import { navigate, routeHref } from '../router.js';

export const title = 'Quotes';
export const css = ['css/quotes.css'];

const selectAll = (state) => state;

// ---------- shared with the builder (quote-detail.js imports these) ----------

/** Icon and plain word for each EFFECTIVE quote status. Always icon plus word, never colour alone. */
export const QUOTE_STATUS_META = {
  draft: { label: 'Draft', icon: 'pencil' },
  sent: { label: 'Sent', icon: 'send' },
  viewed: { label: 'Viewed', icon: 'eye' },
  accepted: { label: 'Accepted', icon: 'check-check' },
  declined: { label: 'Declined', icon: 'circle-x' },
  expired: { label: 'Expired', icon: 'hourglass' },
  overdue: { label: 'Overdue', icon: 'triangle-alert' }
};

/**
 * The one quote-status pill, used on the Quotes list, the quote header, Pipeline cards and booking detail, so a quote is the same colour everywhere:
 * draft neutral dashed, sent blue, viewed amber, accepted green, declined and expired grey, overdue orange. Never the brand red.
 * `status` is the effective status from quoteStatus() / selectQuoteList().
 */
export function QuotePill({ status, compact, class: cls, ...rest }) {
  const meta = QUOTE_STATUS_META[status] || QUOTE_STATUS_META.draft;
  return html`<span class=${cx('ui-pill', 'q1-pill', `q1-pill--${QUOTE_STATUS_META[status] ? status : 'draft'}`, compact && 'ui-pill--compact', cls)} ...${rest}>
    <${Icon} name=${meta.icon} size=${16} /><span class="ui-pill__label">${meta.label}</span>
  </span>`;
}

/** 'ZAPPI' -> 'Zappi' (brands are stored in capitals like his site). Anything else is left as typed. */
export function brandLabel(brand) {
  const b = String(brand || '').trim();
  if (!b) return 'No charger chosen';
  return /^[A-Z]{4,}$/.test(b) ? b[0] + b.slice(1).toLowerCase() : b;
}

/** 'just now' | '12 min ago' | '3 h ago' | 'yesterday' | '5 days ago' | '3 weeks ago' */
export function ageText(stamp, nowStampStr) {
  if (!stamp) return '';
  const mins = Math.max(0, minutesBetween(stamp, nowStampStr));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/** The one-line "what happened last" for a quote, by effective status. */
export function whenText(quote, status, nowStampStr) {
  switch (status) {
    case 'draft': return `Started ${ageText(quote.createdAt, nowStampStr)}`;
    case 'sent': return `Sent ${ageText(quote.sentAt || quote.createdAt, nowStampStr)}`;
    case 'viewed': return `Opened ${ageText(quote.viewedAt || quote.sentAt || quote.createdAt, nowStampStr)}`;
    case 'accepted': return `Accepted ${ageText(quote.acceptedAt || quote.sentAt || quote.createdAt, nowStampStr)}`;
    case 'declined': return `Declined ${ageText(quote.declinedAt || quote.sentAt || quote.createdAt, nowStampStr)}`;
    case 'expired': return `Ran out ${quote.validUntil ? fmtDayShort(quote.validUntil) : ''}`.trim();
    default: return '';
  }
}

/** "Expires in 3 days" for a quote still waiting and close to its last day, else ''. */
export function expiryHint(status, expiresInDays) {
  if (status !== 'sent' && status !== 'viewed') return '';
  if (expiresInDays === null || expiresInDays === undefined || expiresInDays > 7) return '';
  if (expiresInDays <= 0) return 'Last day today';
  return expiresInDays === 1 ? 'Expires tomorrow' : `Expires in ${expiresInDays} days`;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The WhatsApp nudge for a quote that is out: a link that opens his own WhatsApp with this message ready. '' when there is no phone number. */
export function nudgeHref({ quote, booking, brand, total }) {
  if (!booking || !booking.customer || !booking.customer.phone) return '';
  const first = firstName(quote.customerName);
  const link = quoteShareUrl(quote, { ownerFirst: brand.ownerFirst, postcode: booking.address ? booking.address.postcode : '' });
  const text = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name}. Just checking you got my quote for your charger install (${gbp(total)}). Any questions, just ask. ${link}`;
  return waLink(booking.customer.phone, text, brand.demoPhoneDigits);
}

// ---------- list ----------

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'viewed', label: 'Viewed' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'expired', label: 'Expired' }
];
const FILTER_IDS = FILTERS.map((f) => f.id);

const isWaiting = (row) => row.status === 'sent' || row.status === 'viewed';
const matchesFilter = (row, f) => (f === 'all' ? true : f === 'waiting' ? isWaiting(row) : row.status === f);
const sumTotals = (rows) => rows.reduce((t, r) => t + r.total, 0);

/** What the total under the filter chips says, in the owner's words. */
function summaryText(filter, rows) {
  const n = rows.length;
  const money = gbp(sumTotals(rows));
  switch (filter) {
    case 'waiting': return `${plural(n, 'quote', 'quotes')} out, ${money} waiting on customers`;
    case 'draft': return `${plural(n, 'draft', 'drafts')}, ${money} still to send`;
    case 'sent': return `${plural(n, 'quote', 'quotes')} not opened yet, ${money}`;
    case 'viewed': return `${plural(n, 'quote', 'quotes')} opened but not decided, ${money}`;
    case 'accepted': return `${plural(n, 'quote', 'quotes')} accepted, ${money} won`;
    case 'declined': return `${plural(n, 'quote', 'quotes')} declined, ${money} lost`;
    case 'expired': return `${plural(n, 'quote', 'quotes')} ran out, ${money}`;
    default: return `${plural(n, 'quote', 'quotes')}, ${money} quoted in all`;
  }
}

function emptyFor(filter) {
  switch (filter) {
    case 'waiting': return { icon: 'send', title: 'Nothing is waiting on a customer.', body: 'Quotes you have sent and not heard back on show here.' };
    case 'draft': return { icon: 'pencil', title: 'No drafts to finish.', body: 'A quote you start and do not send waits here.' };
    case 'sent': return { icon: 'send', title: 'No quotes waiting to be opened.', body: 'Once you send one, it shows here until they open it.' };
    case 'viewed': return { icon: 'eye', title: 'No opened quotes without an answer.', body: 'When a customer opens a quote and has not decided, it shows here.' };
    case 'accepted': return { icon: 'check-check', title: 'No accepted quotes yet.', body: 'When a customer says yes, it shows here with their install day.' };
    case 'declined': return { icon: 'circle-x', title: 'No declined quotes.', body: 'A quote a customer turns down shows here with their reason.' };
    case 'expired': return { icon: 'hourglass', title: 'Nothing has run out.', body: 'A quote past its last day with no answer shows here.' };
    default: return { icon: 'file-text', title: 'No quotes yet.', body: 'Write one for an enquiry once you have seen the property. It takes a couple of minutes.' };
  }
}

/** Groups for the "All" view: what needs sending, what is out, what is decided. Other filters are one flat list. */
function groupsFor(filter, rows) {
  if (filter !== 'all') {
    const list = rows.filter((r) => matchesFilter(r, filter));
    if (filter === 'waiting') list.sort(byExpiry);
    return [{ key: filter, heading: '', list }];
  }
  const drafts = rows.filter((r) => r.status === 'draft');
  const out = rows.filter(isWaiting).sort(byExpiry);
  const decided = rows.filter((r) => !['draft', 'sent', 'viewed'].includes(r.status));
  return [
    { key: 'drafts', heading: 'To finish and send', list: drafts },
    { key: 'out', heading: 'Waiting on customer', list: out },
    { key: 'decided', heading: 'Decided', list: decided }
  ].filter((g) => g.list.length > 0);
}

// Closest to running out first; an opened quote before an unopened one when the days are equal.
function byExpiry(a, b) {
  const ea = a.expiresInDays === null ? 999 : a.expiresInDays;
  const eb = b.expiresInDays === null ? 999 : b.expiresInDays;
  if (ea !== eb) return ea - eb;
  return (a.status === 'viewed' ? 0 : 1) - (b.status === 'viewed' ? 0 : 1);
}

/**
 * One quote. The name takes the width left over and gives way with an ellipsis, the time sits under it, only the amount is on the right,
 * so every row is the same height. A quote that is out also gets a one-tap Nudge (a sibling of the link, never inside it).
 */
function QuoteRow({ row, booking, nowStampStr, brand }) {
  const q = row.quote;
  const hint = expiryHint(row.status, row.expiresInDays);
  const postcode = booking && booking.address ? booking.address.postcode : '';
  const first = firstName(row.customerName);
  const nudge = isWaiting(row) ? nudgeHref({ quote: q, booking, brand, total: row.total }) : '';
  return html`<li class=${cx('ui-row__li', 'q1-row', nudge && 'has-nudge')}>
    <a class="db-list__item ui-row ui-row--interactive q1-row__link" href=${routeHref('quote-detail', { id: q.id })} data-testid=${`q1-row-${q.id}`}>
      <span class="q1-row__avatar"><${Avatar} name=${row.customerName} size=${44} /></span>
      <span class="q1-row__name">${row.customerName}</span>
      <span class="q1-row__amount">${gbp(row.total)}</span>
      <span class="q1-row__when">${whenText(q, row.status, nowStampStr)}${hint ? html` · <span class=${cx('q1-hint', row.expiresInDays !== null && row.expiresInDays <= 2 && 'is-urgent')}>${hint}</span>` : null}</span>
      <span class="q1-row__state">
        <${QuotePill} status=${row.status} compact data-testid=${`q1-row-status-${q.id}`} />
        <span class="q1-row__sub"><span class="q1-row__pc">${postcode}</span>${q.brand ? html`<span class="q1-row__brand"> · ${brandLabel(q.brand)}</span>` : null}</span>
      </span>
    </a>
    ${nudge ? html`<${Button} variant="secondary" size="sm" href=${nudge} class="q1-row__nudge" aria-label=${`Nudge ${first} on WhatsApp`}
      data-testid=${`q1-nudge-${q.id}`}>Nudge<//>` : null}
  </li>`;
}

function Stat({ label, value, hint, testid }) {
  return html`<div class="q1-stat" data-testid=${testid}>
    <p class="q1-stat__label">${label}</p>
    <p class="q1-stat__value">${value}</p>
    ${hint ? html`<p class="q1-stat__hint">${hint}</p>` : null}
  </div>`;
}

export default function QuotesView({ route }) {
  const state = useStore(selectAll);
  const brand = useBrand();
  const nowDate = useNow(60000);
  const nowStampStr = toStamp(nowDate);
  const f = FILTER_IDS.includes(route.query.f) ? route.query.f : 'all';

  const rows = selectQuoteList(state, { nowStamp: nowStampStr });
  const stats = selectQuoteStats(state, '90d', nowStampStr);
  const bookings = new Map(state.bookings.map((b) => [b.id, b]));

  const counts = {};
  FILTER_IDS.forEach((id) => { counts[id] = rows.filter((r) => matchesFilter(r, id)).length; });
  const waiting = rows.filter(isWaiting);
  const opened = waiting.filter((r) => r.status === 'viewed').length;
  const oldest = waiting.reduce((m, r) => Math.max(m, r.ageMinutes), 0);
  const oldestDays = Math.floor(oldest / 1440);

  const selected = rows.filter((r) => matchesFilter(r, f));
  const groups = groupsFor(f, rows);
  const empty = emptyFor(rows.length === 0 ? 'all' : f);

  const setFilter = (id) => navigate(routeHref('quotes', {}, { f: id === 'all' ? '' : id }), { replace: true });
  const newHref = routeHref('quote-detail', { id: 'new' });

  const tabs = FILTERS.map((o) => ({ id: o.id, label: o.label, count: counts[o.id], testid: `q1-filter-${o.id}` }));

  return html`<div class="db-page q1-page" data-testid="q1-quotes">
    <${PageHeader} title="Quotes" subtitle="Written quotes for home charger installs"
      actions=${html`<${Button} variant="primary" size="sm" icon="plus" href=${newHref} data-testid="q1-new">New quote<//>`} />

    ${rows.length > 0 ? html`<section class="q1-summary" aria-label="Quote totals">
      <a class="q1-hero" href=${routeHref('quotes', {}, { f: 'waiting' })} data-testid="q1-waiting" aria-label=${`Waiting on customer: ${gbp(stats.waitingValue)}. Show these quotes.`}>
        <span class="q1-hero__label">Waiting on customer</span>
        <span class="q1-hero__value" data-testid="q1-waiting-value">${gbp(stats.waitingValue)}</span>
        <span class="q1-hero__hint">${stats.waitingCount === 0
          ? 'Nothing out right now.'
          : `${plural(stats.waitingCount, 'quote', 'quotes')} out${opened ? `, ${opened} opened` : ''}${oldestDays >= 2 ? `. Oldest sent ${oldestDays} days ago` : ''}`}</span>
        <span class="q1-hero__go" aria-hidden="true"><${Icon} name="arrow-right" size=${20} /></span>
      </a>
      <${Stat} testid="q1-drafts-stat" label="To finish" value=${plural(stats.draftCount, 'draft', 'drafts')}
        hint=${stats.draftCount ? `${gbp(stats.draftValue)} not sent yet` : 'All sent. Nice.'} />
      <${Stat} testid="q1-winrate-stat" label="Win rate, 90 days" value=${stats.winRatePct === null ? 'None yet' : `${stats.winRatePct}%`}
        hint=${stats.decided ? `${stats.accepted} won of ${stats.decided} decided${stats.sent > stats.decided ? `, ${stats.sent - stats.decided} still waiting` : ''}` : 'Nothing decided yet'} />
    </section>` : null}

    <div class="q1-controls">
      <${Tabs} idPrefix="q1" ariaLabel="Filter quotes by status" value=${f} onChange=${setFilter} tabs=${tabs} variant="pill" panels=${false} data-testid="q1-filters" />
      ${rows.length > 0 ? html`<p class="q1-controls__total" role="status" data-testid="q1-filter-summary">${summaryText(f, selected)}</p>` : null}
    </div>

    <div class="q1-list" data-testid="q1-list">
      ${selected.length === 0
        ? html`<${EmptyState} icon=${empty.icon} title=${empty.title} body=${empty.body} data-testid="q1-empty"
            action=${rows.length === 0 || f === 'draft' || f === 'all'
              ? html`<${Button} variant="primary" size="lg" icon="plus" href=${newHref} data-testid="q1-empty-new">Write a quote<//>` : null} />`
        : groups.map((g) => html`<section class="q1-group" key=${g.key} aria-label=${g.heading || undefined}>
            ${g.heading ? html`<h2 class="q1-group__title"><span>${g.heading}</span><span class="q1-group__sum">${plural(g.list.length, 'quote', 'quotes')} · ${gbp(sumTotals(g.list))}</span></h2>` : null}
            <ul class="db-list q1-rows">
              ${g.list.map((row) => html`<${QuoteRow} key=${row.quote.id} row=${row} booking=${bookings.get(row.bookingId)} nowStampStr=${nowStampStr} brand=${brand} />`)}
            </ul>
          </section>`)}
    </div>
    <p class="q1-foot">Prices in your quotes are samples. Check every figure before you send.</p>
  </div>`;
}
