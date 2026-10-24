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

/** Day title above the two halves in the picker: 'Tomorrow · Saturday 24 October' or 'Thursday 29 October'. */
export function dayTitle(date, today) {
  const rel = fmtRelativeDay(date, today);
  const long = fmtDayLong(date);
  return rel === 'Today' || rel === 'Tomorrow' ? `${rel} · ${long}` : long;
}

/** 'Thu 29 Oct · Afternoon': the soonest half-day, short enough for one line. */
export function soonestText(date, windowId) {
  return `${fmtDayShort(date)} · ${partOfDay(windowId)}`;
}

/** One line for the window of a chosen half-day: 'Afternoon, arriving 1–3pm'. */
export function windowLine(windowId) {
  const w = WINDOWS[windowId];
  // A word joiner after the dash keeps '1–3pm' together when the line has to wrap on a narrow phone.
  return w ? `${partOfDay(windowId)}, arriving ${w.label.replace('–', '–\u2060')}` : '';
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
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. I have a question about my EV charger quote ${detail.quote.id} (${money(shownTotal(detail))}).`;
}

/** The WhatsApp message asking for an updated quote after one has expired. */
export function refreshText(brand, detail) {
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. My EV charger quote ${detail.quote.id} has expired. Could you send me an updated one?`;
}

/** The WhatsApp message from a customer who turned a quote down and wants to talk again. */
export function reopenText(brand, detail) {
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. About my EV charger quote ${detail.quote.id}: I'd like to talk it over again.`;
}

/** The WhatsApp message from a customer whose link would not open: 'Hi Daniel, I cannot open my quote Q-EL-1043.' (without the reference when the link had none). */
export function plainText(brand, id = '') {
  const ref = String(id || '').trim();
  return `Hi ${brand.ownerFirst}, I cannot open my quote${ref ? ` ${ref}` : ''}.`;
}

/** The WhatsApp message about an accepted quote and its install day. */
export function installText(brand, detail, when) {
  return `Hi ${brand.ownerFirst}, it's ${detail.quote.customerName}. About my EV charger installation${when ? ` on ${when.short}` : ''} (quote ${detail.quote.id}).`;
}

// ---------- the proposal: charger, facts, possible extras ----------

// His own photos of fitted chargers, by brand (config.js business.images keys). Brands with no photo get the local line art.
// (The quote page no longer shows a product picture or any spec line: his site makes no product claims and neither does this page.)
const CHARGER_PHOTOS = { ZAPPI: 'work1', OHME: 'work4' };

const chargerLabelOf = (line) => /charger/i.test(String(line && line.label));

/** The line of the quote that is the charger itself: the one that names the brand and "charger", else any "charger" line. */
export function chargerLine(detail) {
  const brand = String(detail.quote.brand || '').toLowerCase();
  return (brand && detail.lines.find((l) => chargerLabelOf(l) && l.label.toLowerCase().includes(brand)))
    || detail.lines.find(chargerLabelOf) || null;
}

/** 'ZAPPI home charger' (the brand the owner chose), else the charger line's own words, else ''. */
export function chargerName(detail) {
  if (detail.quote.brand) return `${detail.quote.brand} home charger`;
  const line = chargerLine(detail);
  return line ? line.label.replace(/^supply of\s+/i, '') : '';
}

/** The owner's own words on the charger line, or ''. There is NO built-in spec text: the page never makes a product claim of its own. */
export function chargerSpec(detail) {
  const line = chargerLine(detail);
  return line && line.detail ? String(line.detail) : '';
}

/** The business.images key of the photo to show next to this charger, or '' (then the line art is used). */
export function chargerPhotoKey(detail) {
  return CHARGER_PHOTOS[String(detail.quote.brand || '').toUpperCase()] || '';
}

// A line whose label says it only applies "if required" or "if needed" ("only if needed") is a POSSIBLE EXTRA: listed apart, never in the total.
const EXTRA_LABEL_RE = /\b(?:if required|if needed)\b/i;

/** True for a possible extra: flagged `optional` by the owner's builder, or (whatever the data says) a label that says "if required" / "only if needed". */
export function isExtraLine(line) {
  return !!line && (line.optional === true || EXTRA_LABEL_RE.test(String(line.label || '')));
}

const lineAmount = (line) => (typeof line.lineTotal === 'number' ? line.lineTotal : (Number(line.qty) || 0) * (Number(line.unitPrice) || 0));

/**
 * Every line of a quote in the order written, as core gives it: `allLines` when present, else the fixed `lines` plus the owner's flagged `extras`
 * (core keeps the flagged ones apart), else just `lines` (a quote read from an older link, where nothing is flagged).
 */
function allLinesOf(detail) {
  if (detail && Array.isArray(detail.allLines)) return detail.allLines;
  const lines = detail && Array.isArray(detail.lines) ? detail.lines : [];
  const extras = detail && Array.isArray(detail.extras) ? detail.extras : [];
  return extras.length ? [...lines, ...extras] : lines;
}

/** The lines of a quote as the customer reads them: { fixed, extras }. `fixed` add up to the total; `extras` are quoted separately (flagged, or labelled "if required"). */
export function splitLines(detail) {
  const lines = allLinesOf(detail);
  return { fixed: lines.filter((l) => !isExtraLine(l)), extras: lines.filter(isExtraLine) };
}

/** The total the customer sees: the fixed lines only (a possible extra is never counted), whole pounds. */
export function shownTotal(detail) {
  return splitLines(detail).fixed.reduce((sum, line) => sum + lineAmount(line), 0);
}

/**
 * The three facts under the total, all true of the document itself: it is written, it is itemised, it has a valid-until day.
 * (The third is the validity line: see validity().) Returns the two fixed ones; the page adds the third from the day.
 */
export function quoteFacts() {
  return ['A written quote', 'Itemised, line by line'];
}

const INCLUDED_CABLE_RE = /up to\s+(\d+)\s*m\b/i;
const isExtraCable = (line) => /extra\s+cable/i.test(String(line && line.label));

/** How many metres an "Extra cable" line adds: its quantity when priced per metre, else the number in its own words, else its quantity. */
function extraCableMetres(line) {
  const text = `${line.label} ${line.detail || ''}`;
  if (/per\s*(?:metre|meter|m)\b/i.test(text)) return line.qty;
  const m = /(\d+)\s*m\b/i.exec(text);
  return m ? Number(m[1]) : line.qty;
}

/**
 * The three-line summary under the total: the charger, the cable, the testing and certificate. Read from the lines of the quote, so
 * it never promises what is not on it: with an "Extra cable" line the cable bullet adds the metres up ("16 m of cable (10 m included,
 * 6 m extra)"), so it always agrees with the breakdown; when a quote has none of these lines it lists its first lines instead.
 */
export function summaryLines(detail) {
  const out = [];
  if (chargerName(detail)) out.push('Charger supplied and fitted');
  const install = detail.lines.find((l) => /install/i.test(l.label) && !chargerLabelOf(l));
  if (install) {
    const m = INCLUDED_CABLE_RE.exec(`${install.label} ${install.detail}`);
    const included = m ? Number(m[1]) : 0;
    const extraLine = detail.lines.find(isExtraCable);
    const extra = extraLine ? extraCableMetres(extraLine) : 0;
    if (extra > 0 && included > 0) out.push(`Installation with ${included + extra} m of cable (${included} m included, ${extra} m extra)`);
    else if (extra > 0) out.push(`Installation, plus ${extra} m of extra cable`);
    else out.push(m ? `Installation with up to ${included} m of cable` : install.label);
  }
  if (detail.lines.some((l) => /test|certif/i.test(l.label))) out.push('Testing and electrical certificate');
  if (out.length) return out;
  return detail.lines.slice(0, 3).map((l) => l.label);
}

// The first prototype wording told the owner to replace it, and a new quote starts with the one-line "Sample terms: Daniel sets his own." The customer
// must never read either as the owner's own notes (the tagged "Sample terms" idea block says it better, and it vanishes under "Only my content").
const PLACEHOLDER_SENTENCE = /to be replaced|^\s*sample terms\b/i;

/** The owner's notes without developer placeholder sentences. '' when nothing is left. */
export function customerNotes(notes) {
  const text = String(notes === undefined || notes === null ? '' : notes).trim();
  if (!text) return '';
  return text.split('\n')
    .map((para) => (para.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [para]).filter((sentence) => !PLACEHOLDER_SENTENCE.test(sentence)).join('').trim())
    .filter(Boolean).join('\n');
}

/** 'Fri 23 Oct': the day the quote was written (sent), or '' when unknown. */
export function quoteDayLabel(detail) {
  const stamp = detail.quote.sentAt || detail.quote.createdAt;
  return stamp ? fmtDayShort(stampDay(stamp)) : '';
}

/** The installation postcode: the enquiry's (store) or the one the link carried. */
export function installPostcode(detail, state) {
  if (detail.fromLink) return detail.fromLink.postcode || '';
  const booking = (state.bookings || []).find((b) => b.id === detail.quote.bookingId);
  return booking && booking.address ? booking.address.postcode || '' : '';
}
