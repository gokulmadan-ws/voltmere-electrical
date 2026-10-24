// js/dashboard/shared/needs.js: the order Daniel should work "Needs you" in, and the one urgency-stripe rule. Used by Today and the Bookings list.
// Owner: DASH
import { quoteTotal } from '../../core/selectors.js';
import { minutesBetween } from '../../core/dates.js';
import { isEnquiry, isOutsideNi, isQuotedInstall } from './enquiry.js';
import { slaFor } from './sla.js';

/** An enquiry younger than this is a fresh lead (the one a paid funnel is judged on). */
export const FRESH_MINUTES = 60;

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The Needs-you list in the order Daniel should work it, by urgency first and money second:
 *   0 an emergency; 1 an in-Northern-Ireland enquiry that is fresh (under an hour old) or already overdue; 2 accepted quotes, biggest first;
 *   3 every other enquiry or request, oldest first; 4 enquiries from outside Northern Ireland (they never outrank an in-area one and never
 *   count as a missed lead).
 * Returns rows: { b, sla, quote, outside, age, overdue, soon, fresh, tier, value }.
 */
export function needRows(items, state, replyHours, nowStamp) {
  return items.map((b) => {
    const sla = slaFor(b, replyHours, nowStamp);
    const quote = isQuotedInstall(b) ? state.quotes[b.quoteId] || null : null;
    const enquiry = isEnquiry(b);
    const outside = !b.urgent && enquiry && isOutsideNi(b.address.postcode);
    const age = Math.max(0, minutesBetween(b.createdAt, nowStamp));
    const overdue = !!sla && sla.state === 'overdue' && !outside;
    const soon = !!sla && sla.state === 'due_soon' && !outside;
    const fresh = enquiry && !b.urgent && !outside && age < FRESH_MINUTES;
    const tier = b.urgent ? 0 : outside ? 4 : enquiry && (overdue || fresh) ? 1 : isQuotedInstall(b) ? 2 : 3;
    return {
      b, sla, quote, outside, age, overdue, soon, fresh, tier,
      value: quote ? quoteTotal(quote) : Number(b.quotedPrice) || 0
    };
  }).sort((x, y) => x.tier - y.tier
    || (x.tier === 1 ? (y.overdue ? 1 : 0) - (x.overdue ? 1 : 0) || (x.overdue ? cmpStr(x.b.createdAt, y.b.createdAt) : cmpStr(y.b.createdAt, x.b.createdAt)) : 0)
    || (x.tier === 2 ? y.value - x.value : 0)
    || cmpStr(x.b.createdAt, y.b.createdAt));
}

/** The one stripe rule for the dashboard: urgency only. Overdue (or an emergency) is --danger, due soon is amber, anything else has none. */
export const stripeOf = (row) => (row.b.urgent || row.overdue ? 'danger' : row.soon ? 'soon' : '');
