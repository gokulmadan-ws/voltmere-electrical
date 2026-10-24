// js/dashboard/shared/enquiry.js: enquiry helpers shared by the owner views (answer chips, status wording, price text, quote progress).
// Owner: E2
import { html } from '../../vendor/preact-htm.js';
import { Chip, Icon, StatusPill, cx, loadCss } from '../../ui/index.js';
import { ENQUIRY_ANSWER_KEYS, answerLabel } from '../../core/config.js';
import { gbp, isValidPostcode, normalisePostcode } from '../../core/format.js';
import { customerKeyOf } from '../../core/selectors.js';

// The enquiry styles (en-*) live in bookings.css; every owner view that shows an enquiry imports this file.
if (typeof document !== 'undefined') loadCss('css/bookings.css');

/** The free survey visit booked from the website funnel. */
export const isEnquiry = (b) => !!b && b.serviceId === 'ev_quote';
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

/** Plain-text version of the chips (screen readers, titles). */
export function answerSummaryText(b) {
  const a = answersOf(b);
  if (!a) return '';
  return CHIP_KEYS.filter((k) => a[k]).map((k) => shortAnswer(k, a[k])).filter(Boolean).join(', ');
}

/**
 * The status pill for a booking. A new website enquiry reads "New enquiry" and a pencilled-in survey visit gets a second
 * "Pencilled in" pill; everything else is the kit's StatusPill unchanged (`rest` goes on the main pill).
 */
export function BookingPill({ booking: b, compact, urgentTestid, ...rest }) {
  if (!isEnquiry(b)) return html`<${StatusPill} status=${b.status} paid=${b.paid} urgent=${b.urgent} urgentTestid=${urgentTestid} compact=${compact} ...${rest} />`;
  if (b.status !== 'new') return html`<${StatusPill} status=${b.status} paid=${true} compact=${compact} ...${rest} />`;
  const pencil = isPencilled(b);
  const main = html`<span class=${cx('ui-pill', 'ui-pill--new', compact && 'ui-pill--compact')} ...${rest}>
    <${Icon} name="bell" size=${16} /><span class="ui-pill__label">New enquiry</span>
  </span>`;
  if (!pencil) return main;
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

/** Where a survey visit has got to: has the quote-ready message gone, and is there an install booked for the customer. */
export function quoteProgress(state, b) {
  if (!isEnquiry(b)) return { quoteSent: false, installBooked: false };
  const key = customerKeyOf(b.customer.phone);
  return {
    quoteSent: state.messages.some((m) => m.bookingId === b.id && m.kind === 'customer_quote_ready'),
    installBooked: state.bookings.some((x) => x.serviceId === 'ev' && x.status !== 'cancelled' && customerKeyOf(x.customer.phone) === key)
  };
}

/** The word for a pending item: "enquiry" for the website funnel, "request" for anything else. */
export const pendingWord = (b) => (isEnquiry(b) ? 'enquiry' : 'request');
