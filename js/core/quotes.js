// js/core/quotes.js: pure quote helpers (totals, effective status, starting lines, line validation, the customer link)
// Owner: A3 core
import { SITE_BASE_URL, makeDefaultBusiness } from './config.js';
import { nowStamp } from './clock.js';
import { addDays, diffDays, fmtDayShort, isDayKey, stampDay } from './dates.js';
import { firstName, gbp, makeId } from './format.js';
import { quoteLink } from './handoff.js';

/** SITE_BASE_URL + 'quote.html#q=<id>': the link the customer opens on their phone. */
export function quoteUrl(quoteId) {
  return `${SITE_BASE_URL}quote.html#q=${encodeURIComponent(String(quoteId))}`;
}

// ---------- the self-contained customer link (quote.html#q=<id>&d=<payload>) ----------
// The prototype has no server, so a link that only held the quote id worked in the one browser that made it. The share link also
// carries a compact copy of what the customer needs to read the quote (base64url of a small JSON), so it opens on ANY phone.
// Keys: v version, r ref (the quote id), n customer first name, c charger label, l lines [label, unitPrice, qty?, detail?],
// t total, u validUntil, m notes, o owner first name, s sent stamp, p installation postcode.

const LINK_VERSION = 1;
const LINK_NOTES_MAX = 600;
const LINK_MAX_CHARS = 8000;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
  const clean = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(clean + (clean.length % 4 ? '='.repeat(4 - (clean.length % 4)) : ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * The compact object a share link carries for `quote`. `extra.ownerFirst` and `extra.postcode` come from the settings and the
 * enquiry (a quote does not hold them); the owner's first name defaults to the business default.
 */
export function quoteLinkPayload(quote, extra = {}) {
  if (!quote || typeof quote !== 'object' || !quote.id) return null;
  // The v3 format has no way to mark a line optional, so a possible extra is left out of it (the v4 link, js/core/handoff.js, carries them).
  const lines = (Array.isArray(quote.lines) ? quote.lines : []).filter((line) => !isOptionalLine(line));
  const out = {
    v: LINK_VERSION,
    r: String(quote.id),
    n: firstName(quote.customerName),
    l: lines.map((line) => {
      const row = [String(line.label || ''), Number(line.unitPrice) || 0];
      const qty = Number.isInteger(line.qty) && line.qty > 0 ? line.qty : 1;
      const detail = String(line.detail || '');
      if (qty !== 1 || detail) row.push(qty);
      if (detail) row.push(detail);
      return row;
    }),
    t: quoteTotal(quote),
    u: quote.validUntil || ''
  };
  if (quote.brand) out.c = String(quote.brand);
  const notes = String(quote.notes || '').trim();
  if (notes) out.m = notes.length > LINK_NOTES_MAX ? `${notes.slice(0, LINK_NOTES_MAX - 1).trimEnd()}…` : notes;
  out.o = String((extra && extra.ownerFirst) || makeDefaultBusiness().ownerFirstName || '');
  const sent = quote.sentAt || quote.createdAt || '';
  if (sent) out.s = String(sent);
  const postcode = String((extra && extra.postcode) || '').trim();
  if (postcode) out.p = postcode;
  return out;
}

/**
 * The link to SEND, COPY or CHASE with. Since v4 this is the V4 self-contained link, quote.html#d=<payload> (js/core/handoff.js quoteLink):
 * it opens on ANY phone, and the customer's accept or decline comes back to the owner through WhatsApp. It falls back to the id-only
 * quoteUrl(id) when the quote is too big to carry (see quoteLinkInfo). `extra` = { postcode?, ref?, booking? } (ownerFirst is ignored now).
 * quoteUrl itself is unchanged; the v3 form is legacyQuoteShareUrl.
 */
export function quoteShareUrl(quote, extra = {}) {
  return quoteLink(quote, extra);
}

/** The v3 link, quote.html#q=<id>&d=<legacy payload> (parseQuotePayload reads it). Kept for links already in the wild and for tests. */
export function legacyQuoteShareUrl(quote, extra = {}) {
  const payload = quoteLinkPayload(quote, extra);
  if (!payload) return quoteUrl(quote && quote.id !== undefined ? quote.id : '');
  return `${quoteUrl(quote.id)}&d=${b64urlEncode(JSON.stringify(payload))}`;
}

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max) : '');

/**
 * Read the d= part of a share link. Returns null for anything malformed (never throws), otherwise
 * { id, customerName (first name), brand, lines: [{ id, label, detail, qty, unitPrice }], total, validUntil, notes, ownerFirst, sentAt, postcode }.
 * The total must match the lines, so a cut-off or edited link is refused rather than shown wrong.
 */
export function parseQuotePayload(encoded) {
  try {
    const raw = String(encoded === undefined || encoded === null ? '' : encoded).trim();
    if (!raw || raw.length > LINK_MAX_CHARS || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    const p = JSON.parse(b64urlDecode(raw));
    if (!p || typeof p !== 'object' || p.v !== LINK_VERSION) return null;
    const id = str(p.r, 60).trim();
    if (!/^Q-[A-Za-z0-9-]{1,50}$/.test(id)) return null;
    const customerName = str(p.n, 60).trim();
    if (!customerName) return null;
    if (!Array.isArray(p.l) || p.l.length < 1 || p.l.length > 40) return null;
    const lines = [];
    for (let i = 0; i < p.l.length; i += 1) {
      const row = p.l[i];
      if (!Array.isArray(row)) return null;
      const label = str(row[0], 120).trim();
      const unitPrice = row[1];
      const qty = row[2] === undefined ? 1 : row[2];
      if (!label || !Number.isInteger(unitPrice) || Math.abs(unitPrice) > 99999 || !Number.isInteger(qty) || qty < 1 || qty > 999) return null;
      lines.push({ id: `ln_${i + 1}`, label, detail: str(row[3], 200).trim(), qty, unitPrice });
    }
    const total = lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
    if (!Number.isInteger(p.t) || p.t !== total || total <= 0) return null;
    if (!isDayKey(p.u)) return null;
    const sentAt = typeof p.s === 'string' && STAMP_RE.test(p.s) ? p.s : '';
    const postcode = /^[A-Za-z0-9 ]{2,10}$/.test(str(p.p, 10)) ? str(p.p, 10).trim().toUpperCase() : '';
    return {
      id, customerName, brand: str(p.c, 40).trim(), lines, total, validUntil: p.u, notes: str(p.m, 1500).trim(),
      ownerFirst: str(p.o, 40).trim(), sentAt, postcode
    };
  } catch (e) {
    return null;
  }
}

/** qty * unitPrice (whole pounds; a negative unit price is a discount line). */
export function quoteLineTotal(line) {
  return (Number(line && line.qty) || 0) * (Number(line && line.unitPrice) || 0);
}

/**
 * A "possible extra": a line that is listed on the quote (the customer sees it under "Possible extras") but is NOT part of the fixed total,
 * because it only applies if the survey or the work finds it is needed (the consumer unit upgrade is the usual one). Stored as `optional: true`
 * on a quote line and on a catalogue item; a line without the flag (every v3 quote) counts in the total as before.
 */
export function isOptionalLine(line) {
  return !!line && line.optional === true;
}

/** The lines that make up the fixed total, in order. */
export function quoteFixedLines(quote) {
  const lines = quote && Array.isArray(quote.lines) ? quote.lines : [];
  return lines.filter((line) => !isOptionalLine(line));
}

/** The possible extras (optional lines), in order. */
export function quoteExtraLines(quote) {
  const lines = quote && Array.isArray(quote.lines) ? quote.lines : [];
  return lines.filter(isOptionalLine);
}

/** What the possible extras would come to if every one were needed. Never part of quoteTotal; shown as "up to" or "if needed" text only. */
export function quoteExtrasTotal(quote) {
  return quoteExtraLines(quote).reduce((sum, line) => sum + quoteLineTotal(line), 0);
}

/** The pure helper the spec pins: the sum of the line totals of the FIXED lines (optional lines are left out), whole pounds. */
export function quoteTotal(quote) {
  return quoteFixedLines(quote).reduce((sum, line) => sum + quoteLineTotal(line), 0);
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

/**
 * The lines of a quote ready to show: { lines, extras, allLines }, each with `lineTotal`. `lines` are the FIXED lines (the ones the total adds up),
 * `extras` the possible extras (shown apart, never counted), `allLines` every line in the order they were written.
 */
export function splitLines(quote) {
  const all = (quote && Array.isArray(quote.lines) ? quote.lines : []).map((line) => ({ ...line, optional: isOptionalLine(line), lineTotal: quoteLineTotal(line) }));
  return { lines: all.filter((l) => !l.optional), extras: all.filter((l) => l.optional), allLines: all };
}

const lineFromItem = (item) => ({
  id: makeId('ln'), label: item.label, detail: item.detail || '', qty: Number.isInteger(item.defaultQty) && item.defaultQty > 0 ? item.defaultQty : 1, unitPrice: item.unitPrice,
  optional: item.optional === true
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
    lines.push({ id, label, detail, qty: raw.qty, unitPrice: raw.unitPrice, optional: raw.optional === true });
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
    items.push({ id, kind, brand: kind === 'charger' ? String(raw.brand === undefined || raw.brand === null ? '' : raw.brand).trim().slice(0, 40) : '', label, detail, unit, unitPrice: raw.unitPrice, defaultQty, suggested: raw.suggested === true, optional: raw.optional === true });
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

// ---------- v4: reading a quote link, and judging a customer's reply that came back through WhatsApp ----------

/**
 * The same shape selectQuoteDetail gives for a stored quote, built from the `data` of parseQuoteLink (js/core/handoff.js), so the customer's
 * quote page can render a quote that only exists in the link. `fromLink` carries the data; `ref` and `address` come from it. Null for non-data.
 */
export function quoteDetailFromLink(link, nowStampStr = nowStamp()) {
  if (!link || typeof link !== 'object' || !Array.isArray(link.lines)) return null;
  const sentAt = link.sentAt || nowStampStr;
  const id = link.id || link.quoteId || '';
  const quote = {
    id, bookingId: '', customerName: link.customerFirst || link.customerName || '', createdAt: sentAt, status: 'sent', brand: link.brand || '', lines: link.lines,
    notes: link.notes || '', validUntil: link.validUntil, sentAt, sentVia: 'link', viewedAt: null, acceptedAt: null, declinedAt: null,
    declineReason: '', installBookingId: null, seed: false
  };
  const status = quoteStatus(quote, nowStampStr);
  const open = status === 'sent' || status === 'viewed';
  return {
    quote,
    status,
    total: quoteTotal(quote),
    ...splitLines(quote),
    customerFirst: firstName(quote.customerName),
    ref: link.ref || '',
    address: link.postcode || '',
    validUntil: link.validUntil,
    validUntilLabel: isDayKey(link.validUntil) ? fmtDayShort(link.validUntil) : '',
    expiresInDays: quoteExpiresInDays(quote, nowStampStr),
    canAccept: open,
    canDecline: open,
    isExpired: status === 'expired',
    installBooking: null,
    installWhen: '',
    fromLink: link
  };
}

const sameFirstName = (a, b) => firstName(String(a || '').normalize('NFC')).toLowerCase() === firstName(String(b || '').normalize('NFC')).toLowerCase();

/**
 * Can a customer's acceptance or decline (`data` from parseImport, kind 'acc' or 'dec') be applied to the quotes held HERE (an object keyed by id)?
 * The ONE place the rules live: the store's importQuoteDecision applies them inside its write and the import screen's preview shows them.
 * -> { state: 'ready' | 'done' | 'blocked', reason, message, quote, localTotal, bookingId, expected?, accepted? }
 * `done` = already applied (the same acceptance or decline again), `blocked` = cannot be applied here; every `blocked` has a `reason` and a plain `message`.
 */
export function assessQuoteDecision(quotes, data, nowStampStr = nowStamp()) {
  const result = (state, reason, message, quote = null, extra = {}) => ({
    state, reason, message, quote, localTotal: quote ? quoteTotal(quote) : null, bookingId: quote && quote.installBookingId ? quote.installBookingId : null, ...extra
  });
  if (!data || (data.kind !== 'acc' && data.kind !== 'dec')) return result('blocked', 'wrong_kind', 'This is not a reply to a quote.');
  const id = data.quoteId;
  const first = data.customerFirst;
  const quote = quotes && Object.prototype.hasOwnProperty.call(quotes, id) ? quotes[id] : null;
  if (!quote) return result('blocked', 'quote_not_found', `You don't have quote ${id} on this device. Open this link on the phone you sent the quote from.`);
  if (!sameFirstName(quote.customerName, first)) {
    return result('blocked', 'quote_mismatch', `Quote ${id} on this device is for a different customer, so ${first}'s reply was not applied. Check the quote number with ${first}.`, quote);
  }
  const status = quote.status;
  if (data.kind === 'acc') {
    if (status === 'accepted') return result('done', '', '', quote);
    if (status === 'declined') return result('blocked', 'quote_declined', `Quote ${id} is marked as declined on this device. To go ahead, send ${first} a new quote.`, quote);
    if (status === 'draft') return result('blocked', 'quote_not_open', `Quote ${id} is still a draft on this device, so it cannot be accepted yet. Send it first.`, quote);
    if (status !== 'sent' && status !== 'viewed') return result('blocked', 'expired', `Quote ${id} has run out. Extend its date, then open this link again.`, quote);
    if (quoteStatus(quote, nowStampStr) === 'expired') {
      return result('blocked', 'expired', `Quote ${id} ran out on ${fmtDayShort(quote.validUntil)}. Extend the date on the quote, then open this link again.`, quote);
    }
    const local = quoteTotal(quote);
    if (Number.isInteger(data.total) && data.total !== local) {
      return result('blocked', 'total_changed', `${first} accepted ${gbp(data.total)}, but quote ${id} on this device is now ${gbp(local)}. Check with ${first} before you go ahead.`, quote, { expected: local, accepted: data.total });
    }
    return result('ready', '', '', quote);
  }
  if (status === 'declined') return result('done', '', '', quote);
  if (status === 'accepted') return result('blocked', 'already_accepted', `Quote ${id} is already accepted on this device, so ${first}'s decline was not applied.`, quote);
  if (status === 'draft') return result('blocked', 'quote_not_open', `Quote ${id} is still a draft on this device, so it cannot be declined yet.`, quote);
  if (status !== 'sent' && status !== 'viewed') return result('blocked', 'expired', `Quote ${id} has already run out, so there is nothing to decline.`, quote);
  return result('ready', '', '', quote);
}
