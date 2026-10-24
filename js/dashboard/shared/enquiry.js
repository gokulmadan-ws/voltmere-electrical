// js/dashboard/shared/enquiry.js: enquiry helpers shared by the owner views (answer chips, status wording, price text, quote progress).
// Owner: E3 (v1 by E2)
import { html } from '../../vendor/preact-htm.js';
import { Chip, Icon, StatusPill, cx, loadCss } from '../../ui/index.js';
import { ENQUIRY_ANSWER_KEYS, answerLabel } from '../../core/config.js';
import { gbp, isValidPostcode, normalisePostcode } from '../../core/format.js';
import { quoteStatus, selectJourney } from '../../core/selectors.js';

// The enquiry styles (en-*) live in bookings.css; every owner view that shows an enquiry imports this file.
if (typeof document !== 'undefined') loadCss('css/bookings.css');

/** The free survey visit booked from the website funnel. */
export const isEnquiry = (b) => !!b && b.serviceId === 'ev_quote';
/** An install made by a customer accepting a quote (it carries the quote id). */
export const isQuotedInstall = (b) => !!b && b.serviceId === 'ev' && !!b.quoteId;
/** A survey visit the engine pencilled in; the owner's Confirm (or a reschedule) clears it in core. */
export const isPencilled = (b) => !!b && b.tentative === true && b.status !== 'cancelled' && b.status !== 'done';

/** The answers object when it holds at least one known answer, else null (so the UI can hide itself). */
export function answersOf(b) {
  const a = b && b.answers;
  if (!a || typeof a !== 'object') return null;
  return ENQUIRY_ANSWER_KEYS.some((k) => a[k]) ? a : null;
}
export const hasAnswers = (b) => !!answersOf(b);

/** A valid UK postcode that is not a BT (Northern Ireland) postcode. */
export function isOutsideNi(postcode) {
  const pc = normalisePostcode(postcode);
  return isValidPostcode(pc) && !pc.startsWith('BT');
}

// Compact chip wording for lists. The full verbatim labels (answerLabel) are used on the booking detail.
const SHORT = {
  parking: { driveway: 'Private driveway', garage: 'Garage', allocated: 'Allocated space', street: 'On-street', other: 'Parking unsure' },
  vehicle: { have: 'Has the car', ordered: 'Car ordered', choosing: 'Choosing a car' },
  timing: { asap: 'ASAP', month: 'Within a month', one_to_three: '1 to 3 months', researching: 'Researching' },
  permission: { yes: 'Can authorise', landlord: 'Needs landlord OK', unsure: 'Permission unsure' }
};
const CHIP_KEYS = ['parking', 'vehicle', 'timing', 'permission'];

export function shortAnswer(key, value) {
  return (SHORT[key] && SHORT[key][value]) || answerLabel(key, value);
}

/** One line of compact chips for a booking's answers (renders nothing when there are none). */
export function AnswerChips({ booking, class: cls }) {
  const a = answersOf(booking);
  if (!a) return null;
  const items = CHIP_KEYS.filter((k) => a[k]).map((k) => ({ key: k, label: shortAnswer(k, a[k]), tone: k === 'timing' && a[k] === 'asap' ? 'accent' : 'neutral' }))
    .filter((i) => i.label);
  if (!items.length) return null;
  return html`<ul class=${cx('en-chips', cls)} aria-label="Their answers" data-testid="enquiry-chips">
    ${items.map((i) => html`<li key=${i.key}><${Chip} class="en-chip" tone=${i.tone}>${i.label}<//></li>`)}
  </ul>`;
}

/**
 * One grey line for a card or row: "Private driveway · car ordered · ASAP". Permission only shows when it is not a plain yes
 * ("needs landlord OK"). Returns '' when the booking has no answers.
 */
export function answerSummaryLine(b) {
  const a = answersOf(b);
  if (!a) return '';
  const keys = ['parking', 'vehicle', 'timing'].concat(a.permission && a.permission !== 'yes' ? ['permission'] : []);
  return keys.filter((k) => a[k]).map((k) => shortAnswer(k, a[k])).filter(Boolean)
    .map((t, i) => (i === 0 || t === 'ASAP' ? t : t.charAt(0).toLowerCase() + t.slice(1))).join(' · ');
}

/** Plain-text version of the chips (screen readers, titles). */
export function answerSummaryText(b) {
  const a = answersOf(b);
  if (!a) return '';
  return CHIP_KEYS.filter((k) => a[k]).map((k) => shortAnswer(k, a[k])).filter(Boolean).join(', ');
}

/**
 * The status pill for a booking. A new website enquiry reads "New enquiry" and a pencilled-in survey visit gets a second
 * "Pencilled in" pill; everything else is the kit's StatusPill unchanged (`rest` goes on the main pill).
 * `single` keeps only the main pill (Today's cards and the Bookings rows show one status chip; "pencilled in" is said in words).
 */
export function BookingPill({ booking: b, compact, urgentTestid, single, ...rest }) {
  const quotedNew = isQuotedInstall(b) && b.status === 'new';
  if (!isEnquiry(b) && !quotedNew) return html`<${StatusPill} status=${b.status} paid=${b.paid} urgent=${b.urgent} urgentTestid=${urgentTestid} compact=${compact} ...${rest} />`;
  if (b.status !== 'new') return html`<${StatusPill} status=${b.status} paid=${true} compact=${compact} ...${rest} />`;
  const pencil = isPencilled(b);
  const main = quotedNew
    ? html`<span class=${cx('ui-pill', 'ui-pill--confirmed', compact && 'ui-pill--compact')} ...${rest}>
        <${Icon} name="badge-check" size=${16} /><span class="ui-pill__label">Quote accepted</span>
      </span>`
    : html`<span class=${cx('ui-pill', 'ui-pill--new', compact && 'ui-pill--compact')} ...${rest}>
        <${Icon} name="bell" size=${16} /><span class="ui-pill__label">New enquiry</span>
      </span>`;
  if (!pencil || single) return main;
  return html`<span class="ui-pill-group">${main}
    <span class=${cx('ui-pill', 'ui-pill--on-the-way', 'en-pencil', compact && 'ui-pill--compact')} data-testid="pencilled-pill">
      <${Icon} name="clock" size=${16} /><span class="ui-pill__label">Pencilled in</span>
    </span>
  </span>`;
}

/** Money text: a free survey reads "Free"; an install with no agreed price yet reads "To quote". */
export function priceLabel(b) {
  if (isEnquiry(b)) return 'Free';
  const amount = b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice;
  if (!amount && b.status !== 'done' && b.serviceId === 'ev') return 'To quote';
  return gbp(amount);
}

/**
 * Where an enquiry has got to: its latest quote (effective status), whether it went out, and the install booking made from it.
 * `quote` and `install` are frozen store records or null; `quoteSent` and `installBooked` keep their v2 meaning.
 */
export function quoteProgress(state, b) {
  const none = { quoteSent: false, installBooked: false, quote: null, quoteState: null, install: null };
  if (!isEnquiry(b)) return none;
  const journey = selectJourney(state, b.id);
  const quote = journey ? journey.quote : null;
  const install = journey ? journey.install : null;
  const quoteState = quote ? quoteStatus(quote) : null;
  const legacySent = state.messages.some((m) => m.bookingId === b.id && m.kind === 'customer_quote_ready');
  return {
    quoteSent: legacySent || (!!quote && quote.status !== 'draft'),
    installBooked: !!install && install.status !== 'cancelled',
    quote, quoteState, install
  };
}

/** The word for a pending item: "enquiry" for the website funnel, "request" for anything else. */
export const pendingWord = (b) => (isEnquiry(b) ? 'enquiry' : isQuotedInstall(b) ? 'install' : 'request');
