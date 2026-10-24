// js/quote/format.js: small pure helpers for the customer quote page (money, install-day wording, WhatsApp texts, validity wording).
// Owner: Q2 (customer quote page)
import { WINDOWS } from '../core/config.js';
import { fmtDayLong, fmtDayShort, fmtRelativeDay, stampDay } from '../core/dates.js';
import { bookingWindowIds } from '../core/availability.js';

/** Whole pounds with a thousands separator: 1586 -> '£1,586', -50 -> '-£50'. */
export function money(n) {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toLocaleString('en-GB')}`;
}

/** 'Morning' for window 0, 'Afternoon' for window 2 (the two half-day starts); anything else falls back to its clock label. */
export function partOfDay(windowId) {
  if (windowId === 0) return 'Morning';
  if (windowId === 2) return 'Afternoon';
  return WINDOWS[windowId] ? WINDOWS[windowId].label : '';
}

/** 'between 8 and 10am' (when the installer arrives). */
export function arriveText(windowId) {
  return WINDOWS[windowId] ? WINDOWS[windowId].arrive : '';
}

/** One-line wording for a chosen slot: 'Mon 2 Nov, morning, arriving between 8 and 10am'. */
export function slotSentence(date, windowId) {
  return `${fmtDayShort(date)}, ${partOfDay(windowId).toLowerCase()}, arriving ${arriveText(windowId)}`;
}

/** The same slot, short enough for one line on a phone: 'Mon 2 Nov · Morning, 8–10am'. */
export function slotShort(date, windowId) {
  return `${fmtDayShort(date)} · ${partOfDay(windowId)}, ${WINDOWS[windowId] ? WINDOWS[windowId].label : ''}`;
}

/** Day heading in the picker: 'Tomorrow · Sat 24 Oct' or just 'Mon 26 Oct'. */
export function dayHeading(date, today) {
  const rel = fmtRelativeDay(date, today);
  const short = fmtDayShort(date);
  return rel === short ? short : `${rel} · ${short}`;
}

/** What an install booking says about itself, in words the customer can read: { dayKey, long, short, part, arrive, sentence }. */
export function installWhen(booking) {
  if (!booking || !booking.start) return null;
  const dayKey = stampDay(booking.start);
  const ids = bookingWindowIds(booking);
  const first = ids.length ? ids[0] : null;
  const part = first === null ? '' : partOfDay(first);
  const arrive = first === null ? '' : arriveText(first);
  return {
    dayKey,
    long: fmtDayLong(dayKey),
    short: fmtDayShort(dayKey),
    part,
    arrive,
    sentence: first === null ? fmtDayLong(dayKey) : `${fmtDayLong(dayKey)}, ${part.toLowerCase()}, arriving ${arrive}`
  };
}

/**
 * How long the quote stays good, for the customer: { tone, label, short }.
 * tone 'ok' (more than a week), 'soon' (a week or less), 'last' (today is the last day), 'expired'.
 */
export function validity(detail) {
  const days = detail.expiresInDays;
  const until = detail.validUntilLabel;
  if (detail.isExpired || (typeof days === 'number' && days < 0)) {
    return { tone: 'expired', label: `Valid until ${until}`, short: 'Expired' };
  }
  if (days === 0) return { tone: 'last', label: `Valid until ${until}`, short: 'Last day to accept' };
  if (typeof days === 'number' && days <= 7) {
    return { tone: 'soon', label: `Valid until ${until}`, short: days === 1 ? '1 day left' : `${days} days left` };
  }
  if (typeof days === 'number' && days <= 21) return { tone: 'ok', label: `Valid until ${until}`, short: `${days} days left` };
  return { tone: 'ok', label: `Valid until ${until}`, short: '' };
}

/** The WhatsApp message for a question about this quote. */
export function questionText(brand, detail) {
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. I have a question about my EV charger quote ${detail.quote.id} (${money(detail.total)}).`;
}

/** The WhatsApp message asking for an updated quote after one has expired. */
export function refreshText(brand, detail) {
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. My EV charger quote ${detail.quote.id} has expired. Could you send me an updated one?`;
}

/** The WhatsApp message from a customer who turned a quote down and wants to talk again. */
export function reopenText(brand, detail) {
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. About my EV charger quote ${detail.quote.id}: I'd like to talk it over again.`;
}

/** A neutral message when there is no quote to talk about (an invalid link). */
export function plainText(brand) {
  return `Hi ${brand.ownerFirst}, I'm trying to open my EV charger quote but the link isn't working. Could you send it again?`;
}

/** The WhatsApp message about an accepted quote and its install day. */
export function installText(brand, detail, when) {
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. About my EV charger installation${when ? ` on ${when.short}` : ''} (quote ${detail.quote.id}).`;
}
