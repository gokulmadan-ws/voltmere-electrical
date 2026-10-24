// js/core/quotes.js: pure quote helpers (totals, effective status, starting lines, line validation, the customer link)
// Owner: A3 core
import { SITE_BASE_URL } from './config.js';
import { nowStamp } from './clock.js';
import { addDays, diffDays, stampDay } from './dates.js';
import { makeId } from './format.js';

/** SITE_BASE_URL + 'quote.html#q=<id>': the link the customer opens on their phone. */
export function quoteUrl(quoteId) {
  return `${SITE_BASE_URL}quote.html#q=${encodeURIComponent(String(quoteId))}`;
}

/** qty * unitPrice (whole pounds; a negative unit price is a discount line). */
export function quoteLineTotal(line) {
  return (Number(line && line.qty) || 0) * (Number(line && line.unitPrice) || 0);
}

/** The pure helper the spec pins: the sum of the line totals, whole pounds. */
export function quoteTotal(quote) {
  const lines = quote && Array.isArray(quote.lines) ? quote.lines : [];
  return lines.reduce((sum, line) => sum + quoteLineTotal(line), 0);
}

/**
 * The EFFECTIVE status. A stored 'sent' or 'viewed' quote whose validUntil day has passed is 'expired' (the last good day is
 * validUntil itself); every other status is returned as stored.
 */
export function quoteStatus(quote, nowStampStr = nowStamp()) {
  if (!quote) return null;
  if ((quote.status === 'sent' || quote.status === 'viewed') && quote.validUntil && stampDay(nowStampStr) > quote.validUntil) return 'expired';
  return quote.status;
}

/** Whole days from today to validUntil: 0 = the last good day, negative = already past. null without a validUntil. */
export function quoteExpiresInDays(quote, nowStampStr = nowStamp()) {
  if (!quote || !quote.validUntil) return null;
  return diffDays(stampDay(nowStampStr), quote.validUntil);
}

const lineFromItem = (item) => ({
  id: makeId('ln'), label: item.label, detail: item.detail || '', qty: Number.isInteger(item.defaultQty) && item.defaultQty > 0 ? item.defaultQty : 1, unitPrice: item.unitPrice
});

/** The starting lines of a new quote from the catalogue: the charger line of `brand`, then every other `suggested` item. */
export function defaultQuoteLines(settings, { brand } = {}) {
  const items = Array.isArray(settings && settings.quoteItems) ? settings.quoteItems : [];
  const brands = settings && settings.business && Array.isArray(settings.business.brands) ? settings.business.brands : [];
  const wanted = brand === undefined || brand === null ? brands[0] || '' : brand;
  const lines = [];
  for (const item of items) {
    if (item.kind === 'charger') {
      if (wanted && item.brand === wanted) lines.push(lineFromItem(item));
    } else if (item.suggested) {
      lines.push(lineFromItem(item));
    }
  }
  return lines;
}

/**
 * The ready-to-edit input for createQuote, without saving anything. Null when the booking does not exist.
 * (Use it to prefill the builder for #/quotes/new?booking=<id>.)
 */
export function buildQuoteDraft(state, bookingId, { brand } = {}) {
  const booking = (state.bookings || []).find((b) => b.id === bookingId);
  if (!booking) return null;
  const settings = state.settings;
  const brands = settings.business && Array.isArray(settings.business.brands) ? settings.business.brands : [];
  const chosen = brand === undefined || brand === null ? brands[0] || '' : brand;
  const defaults = settings.quoteDefaults || { validDays: 30, notes: '' };
  return {
    bookingId: booking.id,
    customerName: booking.customer.name,
    brand: chosen,
    lines: defaultQuoteLines(settings, { brand: chosen }),
    notes: defaults.notes || '',
    validUntil: addDays(stampDay(nowStamp()), defaults.validDays || 30)
  };
}

/**
 * Validate and clean a list of quote lines. Returns { lines, error }: `error` is '' when fine, otherwise a plain sentence and
 * `lines` is null. Missing or duplicate line ids are generated.
 */
export function normaliseQuoteLines(input) {
  if (!Array.isArray(input)) return { lines: null, error: 'Add the lines of the quote.' };
  if (input.length > 40) return { lines: null, error: 'A quote can have up to 40 lines.' };
  const lines = [];
  const seen = new Set();
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    const n = i + 1;
    if (!raw || typeof raw !== 'object') return { lines: null, error: `Line ${n} is not valid.` };
    const label = String(raw.label === null || raw.label === undefined ? '' : raw.label).trim();
    if (!label) return { lines: null, error: `Line ${n} needs a description.` };
    if (label.length > 120) return { lines: null, error: `Line ${n}: keep the description under 120 characters.` };
    const detail = String(raw.detail === null || raw.detail === undefined ? '' : raw.detail).trim();
    if (detail.length > 200) return { lines: null, error: `Line ${n}: keep the detail under 200 characters.` };
    if (!Number.isInteger(raw.qty) || raw.qty < 1 || raw.qty > 999) return { lines: null, error: `Line ${n}: enter a whole quantity from 1 to 999.` };
    if (!Number.isInteger(raw.unitPrice) || raw.unitPrice < -99999 || raw.unitPrice > 99999) {
      return { lines: null, error: `Line ${n}: enter a whole number of pounds.` };
    }
    let id = typeof raw.id === 'string' && raw.id && !seen.has(raw.id) ? raw.id.slice(0, 40) : makeId('ln');
    while (seen.has(id)) id = makeId('ln');
    seen.add(id);
    lines.push({ id, label, detail, qty: raw.qty, unitPrice: raw.unitPrice });
  }
  return { lines, error: '' };
}

// 'Q-EL-1043' is version 1, 'Q-EL-1043-2' is version 2: the tie-break when two quotes share a createdAt minute.
function quoteVersion(id) {
  const m = /-(\d+)$/.exec(String(id));
  return m && String(id).split('-').length > 3 ? Number(m[1]) : 1;
}

function newerFirst(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return quoteVersion(b.id) - quoteVersion(a.id) || (a.id < b.id ? 1 : -1);
}

/** Validate the editable catalogue. Returns { items, error }: `error` is '' when fine, otherwise a plain sentence and `items` is null. */
export function normaliseQuoteItems(input) {
  if (!Array.isArray(input)) return { items: null, error: 'Add the items for the quote builder.' };
  if (input.length > 60) return { items: null, error: 'The catalogue can have up to 60 items.' };
  const items = [];
  const seen = new Set();
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    const n = i + 1;
    if (!raw || typeof raw !== 'object') return { items: null, error: `Item ${n} is not valid.` };
    const label = String(raw.label === null || raw.label === undefined ? '' : raw.label).trim();
    if (!label) return { items: null, error: `Item ${n} needs a description.` };
    if (label.length > 80) return { items: null, error: `Item ${n}: keep the description under 80 characters.` };
    const detail = String(raw.detail === null || raw.detail === undefined ? '' : raw.detail).trim();
    if (detail.length > 120) return { items: null, error: `Item ${n}: keep the detail under 120 characters.` };
    const unit = raw.unit === undefined ? 'each' : raw.unit;
    if (unit !== 'each' && unit !== 'metre') return { items: null, error: `Item ${n}: choose each or per metre.` };
    const kind = raw.kind === undefined ? 'extra' : raw.kind;
    if (!['charger', 'install', 'extra'].includes(kind)) return { items: null, error: `Item ${n}: choose a type.` };
    if (!Number.isInteger(raw.unitPrice) || raw.unitPrice < 0 || raw.unitPrice > 99999) return { items: null, error: `Item ${n}: enter a whole number of pounds.` };
    const defaultQty = raw.defaultQty === undefined ? 1 : raw.defaultQty;
    if (!Number.isInteger(defaultQty) || defaultQty < 1 || defaultQty > 999) return { items: null, error: `Item ${n}: enter a whole quantity from 1 to 999.` };
    let id = typeof raw.id === 'string' && raw.id && !seen.has(raw.id) ? raw.id.slice(0, 40) : makeId('item');
    while (seen.has(id)) id = makeId('item');
    seen.add(id);
    items.push({ id, kind, brand: kind === 'charger' ? String(raw.brand === undefined || raw.brand === null ? '' : raw.brand).trim().slice(0, 40) : '', label, detail, unit, unitPrice: raw.unitPrice, defaultQty, suggested: raw.suggested === true });
  }
  return { items, error: '' };
}

/** The newest quote of a quotes map (object keyed by id) for a booking: by createdAt, ties by version. */
export function latestQuoteFor(quotes, bookingId) {
  let best = null;
  for (const q of Object.values(quotes || {})) {
    if (q.bookingId === bookingId && (!best || newerFirst(q, best) < 0)) best = q;
  }
  return best;
}

/** Every quote of a booking, newest first. */
export function quotesFor(quotes, bookingId) {
  return Object.values(quotes || {}).filter((q) => q.bookingId === bookingId).sort(newerFirst);
}
