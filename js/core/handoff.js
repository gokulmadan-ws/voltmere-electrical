// js/core/handoff.js: the cross-device handoff with no server. Payloads are plain data in a URL fragment (base64url of compact JSON), carried by
// wa.me deep links the customer or the owner taps "send" on themselves. Everything that comes back is UNTRUSTED: strict validation, length
// limits, no HTML, tolerant of garbage (nothing here throws). Exact shapes: docs/V4-API.md.
// Owner: A4 core. Pure module (no store, no DOM); imports only config, clock, dates, format, utm.
import {
  ENQUIRY_ANSWER_HEADINGS, ENQUIRY_STEPS, HANDOFF_KINDS, HANDOFF_STORAGE_KEY, HANDOFF_VERSION, IMPORT_MAX_AGE_DAYS, INSTALL_DAYS, INSTALL_PARTS,
  QUOTE_DECLINE_REASONS, SITE_BASE_URL, answerLabel, makeDefaultBusiness
} from './config.js';
import { nowStamp } from './clock.js';
import { addMinutes, isDayKey } from './dates.js';
import { firstName, gbp, isValidPostcode, normalisePhone, normalisePostcode, outsideAreaLabel, toWaDigits } from './format.js';
import { normaliseLeadSource } from './utm.js';

// ---------- limits ----------

const MAX_ENCODED = 8000; // anything longer is not one of ours
const QUOTE_LINK_MAX_CHARS = 3200; // above this a quote is not carried in a link (messengers and browsers get unreliable past a few thousand characters)
const QUOTE_MAX_LINES = 14;
const NOTES_MAX = 400;
const ACC_NOTE_MAX = 200;
const DEC_NOTE_MAX = 140;
const NAME_MAX = 60;
const EMAIL_MAX = 100;
const REF_RE = /^EL-\d{1,7}$/;
const QUOTE_ID_RE = /^Q-[A-Za-z0-9-]{1,50}$/;
const STAMP_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const DAY_IDS = INSTALL_DAYS.map((d) => d.id);
const PART_IDS = INSTALL_PARTS.map((p) => p.id);
const WEEKDAYS = 'mon,tue,wed,thu,fri';

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isStamp = (v) => typeof v === 'string' && STAMP_RE.test(v) && isDayKey(v.slice(0, 10));

// ---------- text cleaning (every field that comes from a link passes through here) ----------

// Control characters (except tab, line feed and carriage return), the C1 block, zero-width and bidi override characters, line and
// paragraph separators, the BOM and the interlinear annotation characters: invisible text that could hide or reverse what a person reads.
const hexEscape = (n) => `${String.fromCharCode(92)}u${n.toString(16).padStart(4, '0')}`; // built from code points so no invisible character sits in this source file
const INVISIBLE = new RegExp(`[${[[0, 8], [11, 12], [14, 31], [127, 159], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffc]].map(([from, to]) => `${hexEscape(from)}-${hexEscape(to)}`).join('')}]`, 'g');
const HTML_TAG = /<\/?[A-Za-z!?][^<>]*>/g;

function cutText(text, max) {
  if (text.length <= max) return text;
  let out = text.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1); // never split a surrogate pair
  return out.trimEnd();
}

/**
 * Plain text from anything: non-strings give '', invisible and bidi characters and HTML tags are removed, whitespace is collapsed
 * (a multiline value keeps single line breaks), the result is trimmed and cut to `max` characters.
 */
export function sanitiseText(value, max = 200, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.slice(0, max * 4 + 200).replace(/\r\n?/g, '\n').replace(INVISIBLE, '');
  for (let i = 0; i < 3; i += 1) {
    const stripped = s.replace(HTML_TAG, ''); // up to three passes: '<<b>script>' must not rebuild a tag
    if (stripped === s) break;
    s = stripped;
  }
  s = multiline
    ? s.replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n')
    : s.replace(/\s+/g, ' ');
  return cutText(s.trim(), max);
}

// Cut a longer text at a word boundary and say so with an ellipsis (the quote notes in a link).
function ellipsise(text, max) {
  if (text.length <= max) return { text, cut: false };
  let out = text.slice(0, max - 1).trimEnd();
  const space = out.lastIndexOf(' ');
  if (space > max * 0.6) out = out.slice(0, space).trimEnd();
  return { text: `${out}…`, cut: true };
}

// ---------- the codec: base64url of compact JSON, a checksum on everything else ----------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Throws on anything that is not valid base64url of valid UTF-8 (the callers catch).
function fromBase64Url(text) {
  const std = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// The same JSON whatever order the keys were built in; undefined and functions are skipped as JSON.stringify would.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined || typeof v === 'function' ? 'null' : canonical(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined && typeof value[k] !== 'function').sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  const text = JSON.stringify(value);
  return text === undefined ? 'null' : text;
}

// cyrb53 (public domain): a fast 53 bit string hash. 36 of its bits become 6 base64url characters. This catches a cut-off, wrapped,
// mistyped or edited link; it is NOT a signature (anybody can compute it), so the owner's screen always shows what will be added.
function hash53(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The 6 base64url characters `k` should hold for `obj` (computed over everything except `k`). */
export function payloadChecksum(obj) {
  const rest = {};
  if (isObject(obj)) for (const key of Object.keys(obj)) if (key !== 'k') rest[key] = obj[key];
  let n = hash53(canonical(rest)) % 68719476736; // 2 ** 36
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out = ALPHABET[n % 64] + out;
    n = Math.floor(n / 64);
  }
  return out;
}

/** base64url (no padding) of the compact JSON of `obj`, with `k` set (or replaced). '' when `obj` is not a plain object or cannot be serialised. */
export function encodePayload(obj) {
  try {
    if (!isObject(obj)) return '';
    const body = { ...obj };
    delete body.k;
    body.k = payloadChecksum(body);
    return toBase64Url(JSON.stringify(body));
  } catch (e) {
    return '';
  }
}

// { ok: true, payload } | { ok: false, reason: 'damaged' | 'unsupported' }
function decodeDetailed(input) {
  try {
    if (typeof input !== 'string') return { ok: false, reason: 'damaged' };
    const s = input.trim().replace(/=+$/, '');
    if (s.length < 16 || s.length > MAX_ENCODED || !B64URL_RE.test(s)) return { ok: false, reason: 'damaged' };
    const json = fromBase64Url(s);
    if (toBase64Url(json) !== s) return { ok: false, reason: 'damaged' }; // not canonical (spare bits changed) or a byte order mark: refuse
    const obj = JSON.parse(json);
    if (!isObject(obj) || typeof obj.k !== 'string' || obj.k.length !== 6 || payloadChecksum(obj) !== obj.k) return { ok: false, reason: 'damaged' };
    if (obj.v !== HANDOFF_VERSION || !HANDOFF_KINDS.includes(obj.t)) return { ok: false, reason: 'unsupported' };
    return { ok: true, payload: obj };
  } catch (e) {
    return { ok: false, reason: 'damaged' };
  }
}

/** The compact payload exactly as it was built, or null: not a string, too long, bad characters, bad base64, bad UTF-8, bad JSON, wrong version or kind, wrong checksum. Never throws. */
export function decodePayload(input) {
  const out = decodeDetailed(input);
  return out.ok ? out.payload : null;
}

// ---------- dates ----------

/**
 * A stamp that can never be in the future and never absurdly old: later than `nowStampStr` gives `nowStampStr`; older than `maxAgeDays`
 * (30) gives exactly that old; anything that is not a stamp gives `nowStampStr`.
 */
export function clampStamp(stamp, nowStampStr, { maxAgeDays = IMPORT_MAX_AGE_DAYS } = {}) {
  const now = isStamp(nowStampStr) ? nowStampStr : nowStamp();
  if (!isStamp(stamp) || stamp > now) return now;
  const oldest = addMinutes(now, -maxAgeDays * 24 * 60);
  return stamp < oldest ? oldest : stamp;
}

// ---------- install preferences and decline reasons ----------

function cleanDays(days) {
  if (!Array.isArray(days)) return [];
  const set = new Set(days.filter((d) => typeof d === 'string').map((d) => d.toLowerCase()));
  return DAY_IDS.filter((id) => set.has(id));
}

const cleanPart = (part) => (PART_IDS.includes(part) ? part : 'any');
const dayLabel = (id) => INSTALL_DAYS.find((d) => d.id === id).label;

/**
 * 'Thu or Fri mornings' (style 'long', for a message) or 'Thu/Fri mornings' (style 'compact', for a heading). No days, or all six, is
 * 'any day'; Monday to Friday is 'any weekday'. The part of the day: 'am' mornings, 'pm' afternoons, 'any' says nothing.
 */
export function describePreferences(days, part, { style = 'long' } = {}) {
  const ids = cleanDays(days);
  const p = cleanPart(part);
  const labels = ids.map(dayLabel);
  let dayText;
  if (ids.length === 0 || ids.length === DAY_IDS.length) dayText = 'any day';
  else if (ids.join(',') === WEEKDAYS) dayText = 'any weekday';
  else if (style === 'compact') dayText = labels.join('/');
  else dayText = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
  if (p === 'any') return dayText;
  if (dayText === 'any day') return p === 'am' ? 'any morning' : 'any afternoon';
  if (dayText === 'any weekday') return p === 'am' ? 'weekday mornings' : 'weekday afternoons';
  return `${dayText} ${p === 'am' ? 'mornings' : 'afternoons'}`;
}

const reasonLabelOf = (id) => {
  const hit = QUOTE_DECLINE_REASONS.find((r) => r.id === id);
  return hit ? hit.label : '';
};

/** The reason as the owner reads it: the chip, then the customer's own words after a colon (max 200). What declineQuote stores. */
export function declineReasonText(reasonId, note) {
  return [reasonLabelOf(reasonId), sanitiseText(note, DEC_NOTE_MAX)].filter(Boolean).join(': ').slice(0, 200);
}

// ---------- builders (pure; the compact payload WITH k, or null; never throw) ----------

// The fixed total: a possible extra (optional: true) is carried and shown but never added up.
const sumLines = (lines) => lines.reduce((t, l) => (l.optional === true ? t : t + l.qty * l.unitPrice), 0);

function withChecksum(payload) {
  payload.k = payloadChecksum(payload);
  return payload;
}

/** The `enq` payload for a stored ev_quote booking (ref, createdAt, customer, address, answers, notes, utm), or null when it cannot be carried. */
export function buildEnquiryPayload(booking) {
  try {
    if (!isObject(booking)) return null;
    const cust = isObject(booking.customer) ? booking.customer : {};
    const addr = isObject(booking.address) ? booking.address : {};
    const answers = isObject(booking.answers) ? booking.answers : {};
    const ref = typeof booking.ref === 'string' ? booking.ref : '';
    const name = sanitiseText(cust.name, NAME_MAX);
    const phone = normalisePhone(cust.phone);
    const postcode = typeof addr.postcode === 'string' && addr.postcode ? addr.postcode : answers.postcode;
    if (!REF_RE.test(ref) || name.length < 2 || !phone || typeof postcode !== 'string' || !isValidPostcode(postcode) || !isStamp(booking.createdAt)) return null;
    const out = { v: HANDOFF_VERSION, t: 'enq', i: ref, c: booking.createdAt, n: name, p: phone };
    const email = sanitiseText(cust.email, EMAIL_MAX);
    if (email && isEmail(email)) out.e = email;
    out.z = normalisePostcode(postcode);
    const a = {};
    for (const step of ENQUIRY_STEPS) if (step.options.some((o) => o.value === answers[step.key])) a[step.key] = answers[step.key];
    if (Object.keys(a).length) out.a = a;
    out.o = answers.marketingOptIn === true ? 1 : 0;
    const notes = sanitiseText(booking.notes, NOTES_MAX, { multiline: true });
    if (notes) out.m = notes;
    if (isObject(booking.utm) && typeof booking.utm.source === 'string') out.u = normaliseLeadSource(booking.utm.source);
    return withChecksum(out);
  } catch (e) {
    return null;
  }
}

// Same test connections.js uses for an email address (kept here so this module has no dependency on it).
const isEmail = (text) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(text) && text.length <= EMAIL_MAX;

const firstOf = (quote) => sanitiseText(typeof quote.customerFirst === 'string' && quote.customerFirst ? firstName(quote.customerFirst) : firstName(quote.customerName), 40);

// { payload, reason, notesTruncated }: reason is '' when the quote can be carried.
function quotePayloadResult(quote, booking, extra) {
  const none = (reason) => ({ payload: null, reason, notesTruncated: false });
  try {
    if (!isObject(quote) || typeof quote.id !== 'string' || !QUOTE_ID_RE.test(quote.id)) return none('no_quote');
    const rows = Array.isArray(quote.lines) ? quote.lines : [];
    if (rows.length === 0) return none('no_lines');
    if (rows.length > QUOTE_MAX_LINES) return none('too_many_lines');
    const lines = [];
    const plain = [];
    for (const row of rows) {
      if (!isObject(row)) return none('bad_line');
      const label = sanitiseText(row.label, 120);
      if (!label || !Number.isInteger(row.qty) || row.qty < 1 || row.qty > 999 || !Number.isInteger(row.unitPrice) || Math.abs(row.unitPrice) > 99999) return none('bad_line');
      const detail = sanitiseText(row.detail, 200);
      const optional = row.optional === true;
      // [label, qty, unitPrice, detail?, 1?]: a possible extra adds a 5th element (1), with '' as its detail when it has none.
      const wire = detail || optional ? [label, row.qty, row.unitPrice, detail] : [label, row.qty, row.unitPrice];
      if (optional) wire.push(1);
      lines.push(wire);
      plain.push({ qty: row.qty, unitPrice: row.unitPrice, optional });
    }
    if (sumLines(plain) <= 0) return none('no_lines');
    if (!isDayKey(quote.validUntil)) return none('no_quote');
    const name = firstOf(quote);
    if (!name) return none('no_quote');
    const e = isObject(extra) ? extra : {};
    const b = isObject(booking) ? booking : isObject(e.booking) ? e.booking : null;
    const ref = typeof e.ref === 'string' && e.ref ? e.ref : b && typeof b.ref === 'string' ? b.ref : '';
    const postcodeRaw = typeof e.postcode === 'string' && e.postcode ? e.postcode : b && isObject(b.address) ? b.address.postcode : '';
    const out = { v: HANDOFF_VERSION, t: 'quo', i: quote.id };
    if (REF_RE.test(ref)) out.r = ref;
    out.n = name;
    if (typeof postcodeRaw === 'string' && isValidPostcode(postcodeRaw)) out.z = normalisePostcode(postcodeRaw);
    const brand = sanitiseText(quote.brand, 40);
    if (brand) out.b = brand;
    out.l = lines;
    const notes = ellipsise(sanitiseText(quote.notes, 1500, { multiline: true }), NOTES_MAX);
    if (notes.text) out.m = notes.text;
    out.x = quote.validUntil;
    const sent = quote.sentAt || quote.createdAt;
    if (isStamp(sent)) out.s = sent;
    out.f = e.sample === false ? 0 : 1;
    return { payload: withChecksum(out), reason: '', notesTruncated: notes.cut };
  } catch (err) {
    return none('no_quote');
  }
}

/** The `quo` payload for a stored Quote (and its enquiry, for the ref and postcode), or null (see quoteLinkInfo for why). */
export function buildQuotePayload(quote, booking, extra) {
  return quotePayloadResult(quote, booking, extra).payload;
}

const idOnlyQuoteUrl = (id) => `${SITE_BASE_URL}quote.html#q=${encodeURIComponent(String(id === undefined || id === null ? '' : id))}`;

/**
 * The link to SEND, COPY or CHASE a quote with. `url` is `quote.html#d=<payload>` (portable: opens on any phone) or, when the quote cannot
 * be carried, the id-only `quote.html#q=<id>` (this browser only) with `portable: false` and a `reason` (too_many_lines over 14, too_long
 * over 3,200 encoded characters, no_lines, bad_line, no_quote). `chars` is the encoded length. `extra` = { booking?, ref?, postcode?, sample? }.
 */
export function quoteLinkInfo(quote, extra) {
  const built = quotePayloadResult(quote, null, extra);
  const fallback = (reason) => ({ url: idOnlyQuoteUrl(quote && quote.id), portable: false, chars: 0, reason, notesTruncated: false });
  if (!built.payload) return fallback(built.reason);
  const encoded = encodePayload(built.payload);
  if (!encoded) return fallback('no_quote');
  if (encoded.length > QUOTE_LINK_MAX_CHARS) return { ...fallback('too_long'), chars: encoded.length };
  return { url: `${SITE_BASE_URL}quote.html#d=${encoded}`, portable: true, chars: encoded.length, reason: '', notesTruncated: built.notesTruncated };
}

/** quote.html#d=<payload> built from SITE_BASE_URL (the id-only link when the quote cannot be carried: see quoteLinkInfo). */
export function quoteLink(quote, extra) {
  return quoteLinkInfo(quote, extra).url;
}

/** The `acc` payload for { quote, days, part, note }: `quote` is a stored Quote or the `data` of parseQuoteLink. Null when it cannot be carried. */
export function buildAcceptancePayload(input) {
  try {
    const d = isObject(input) ? input : {};
    const quote = isObject(d.quote) ? d.quote : null;
    if (!quote || typeof quote.id !== 'string' || !QUOTE_ID_RE.test(quote.id)) return null;
    const name = firstOf(quote);
    const total = Array.isArray(quote.lines) && quote.lines.length ? sumLines(quote.lines.map((l) => ({ qty: Number(l && l.qty) || 0, unitPrice: Number(l && l.unitPrice) || 0, optional: !!l && l.optional === true }))) : quote.total;
    if (!name || !Number.isInteger(total) || total < 1 || total > 999999) return null;
    const out = { v: HANDOFF_VERSION, t: 'acc', i: quote.id, n: name, d: cleanDays(d.days), w: cleanPart(d.part) };
    const note = sanitiseText(d.note, ACC_NOTE_MAX);
    if (note) out.m = note;
    out.t2 = total;
    return withChecksum(out);
  } catch (e) {
    return null;
  }
}

/** The `dec` payload for { quote, reason, note }. Null when it cannot be carried. */
export function buildDeclinePayload(input) {
  try {
    const d = isObject(input) ? input : {};
    const quote = isObject(d.quote) ? d.quote : null;
    if (!quote || typeof quote.id !== 'string' || !QUOTE_ID_RE.test(quote.id)) return null;
    const name = firstOf(quote);
    if (!name) return null;
    const out = { v: HANDOFF_VERSION, t: 'dec', i: quote.id, n: name };
    if (reasonLabelOf(d.reason)) out.y = d.reason;
    const note = sanitiseText(d.note, DEC_NOTE_MAX);
    if (note) out.m = note;
    return withChecksum(out);
  } catch (e) {
    return null;
  }
}

// ---------- links ----------

/** `dashboard.html#import=<payload>` from SITE_BASE_URL. `payload` is a compact object (it is encoded) or an already encoded string; '' when it is neither. */
export function dashboardImportLink(payload) {
  const encoded = typeof payload === 'string' ? payload.trim() : encodePayload(payload);
  if (!encoded || encoded.length > MAX_ENCODED || !B64URL_RE.test(encoded)) return '';
  return `${SITE_BASE_URL}dashboard.html#import=${encoded}`;
}

// ---------- the WhatsApp texts (plain friendly UK English; the link on its own last line) ----------

const ownerFirstOf = (business) => sanitiseText(business && business.ownerFirstName, 40) || makeDefaultBusiness().ownerFirstName;

const TEXT_HEADINGS = { parking: 'Parking', vehicle: 'Electric car', timing: 'Timing', permission: 'Permission to install' };

function withLink(lines, intro, link) {
  return link ? [...lines, '', intro, link].join('\n') : lines.join('\n');
}

/** The message the customer sends Daniel after the funnel: who, how to reach them, where, their answers, notes, then the import link last. '' for a booking that cannot be carried. */
export function enquiryWhatsAppText(booking, { link, business } = {}) {
  try {
    const payload = buildEnquiryPayload(booking);
    if (!payload) return '';
    const lines = [`Hi ${ownerFirstOf(business)}, it's ${payload.n}. I've just asked for a home charger quote on your website.`, ''];
    lines.push(`Ref: ${payload.i}`, `Mobile: ${payload.p}`);
    if (payload.e) lines.push(`Email: ${payload.e}`);
    lines.push(`Postcode: ${payload.z}`);
    for (const step of ENQUIRY_STEPS) {
      const label = payload.a ? answerLabel(step.key, payload.a[step.key]) : '';
      if (label) lines.push(`${TEXT_HEADINGS[step.key]}: ${label}`);
    }
    if (payload.m) lines.push(`Anything else: ${payload.m.replace(/\s*\n\s*/g, ' ')}`);
    const url = link === undefined ? dashboardImportLink(payload) : link;
    return withLink(lines, 'Tap to add my enquiry to your dashboard:', url);
  } catch (e) {
    return '';
  }
}

const quoteTotalOf = (quote) => {
  const rows = Array.isArray(quote && quote.lines) ? quote.lines : [];
  if (rows.length) return rows.reduce((t, l) => (l && l.optional === true ? t : t + (Number(l && l.qty) || 0) * (Number(l && l.unitPrice) || 0)), 0);
  return Number.isInteger(quote && quote.total) ? quote.total : 0;
};

/** "I'd like to go ahead with quote Q-EL-1043 (£1,394). Best: Thu or Fri mornings." then the import link. '' when the quote cannot be carried. */
export function acceptanceWhatsAppText(input, { link, business } = {}) {
  try {
    const payload = buildAcceptancePayload(input);
    if (!payload) return '';
    const lines = [`Hi ${ownerFirstOf(business)}, it's ${payload.n}. I'd like to go ahead with quote ${payload.i} (${gbp(payload.t2)}).`];
    lines.push(`Best: ${describePreferences(payload.d, payload.w)}.`);
    if (payload.m) lines.push(`Note: ${payload.m}`);
    const url = link === undefined ? dashboardImportLink(payload) : link;
    return withLink(lines, 'Tap to mark it accepted on your dashboard:', url);
  } catch (e) {
    return '';
  }
}

/** "Thanks for the quote Q-EL-1043 (£1,394), but I won't be going ahead this time." with the reason, then the import link. '' when the quote cannot be carried. */
export function declineWhatsAppText(input, { link, business } = {}) {
  try {
    const payload = buildDeclinePayload(input);
    if (!payload) return '';
    const total = quoteTotalOf(input.quote);
    const lines = [`Hi ${ownerFirstOf(business)}, it's ${payload.n}. Thanks for the quote ${payload.i}${total > 0 ? ` (${gbp(total)})` : ''}, but I won't be going ahead this time.`];
    const reason = declineReasonText(payload.y, payload.m);
    if (reason) lines.push(`Reason: ${reason}`);
    const url = link === undefined ? dashboardImportLink(payload) : link;
    return withLink(lines, 'Tap to mark it declined on your dashboard:', url);
  } catch (e) {
    return '';
  }
}

// ---------- reading a link: validation and sanitising ----------

const MESSAGES = {
  empty: 'There is nothing to import yet. Open the link from WhatsApp, or paste the whole message here.',
  no_payload: "That doesn't look like a 180 Electrical link. Open the link from the WhatsApp message, or paste the whole message.",
  too_long: 'That is far too long to be one of our links.',
  damaged: 'This link looks cut off or damaged. Ask them to send it again.',
  unsupported: "This link was made by a different version of the site, so it can't be read here. Ask them to send it again.",
  wrong_kind: 'This is not the kind of link that belongs here.'
};

const fail = (reason, extra = {}) => ({ ok: false, reason, message: MESSAGES[reason] || MESSAGES.damaged, ...extra });

const invalid = (errors) => ({
  ok: false, reason: 'invalid', errors,
  message: `The link opened, but its details can't be used: ${Object.values(errors)[0]}`
});

const stampOr = (v, fallback = '') => (isStamp(v) ? v : fallback);

/** Mix the idempotency key an enquiry import uses: the ref, the stamp it was SENT and the mobile digits (every browser numbers its refs from EL-1043). */
export function importIdOf(data) {
  if (!isObject(data)) return '';
  const digits = typeof data.phoneDigits === 'string' && data.phoneDigits ? data.phoneDigits : toWaDigits(data.phone);
  return `${data.ref}|${data.sentAt}|${digits}`;
}

function cleanEnquiry(raw, now) {
  const errors = {};
  const ref = typeof raw.ref === 'string' && REF_RE.test(raw.ref) ? raw.ref : '';
  if (!ref) errors.ref = 'it has no enquiry reference.';
  const sentAt = stampOr(raw.sentAt);
  if (!sentAt) errors.createdAt = 'it has no time it was sent.';
  const name = sanitiseText(raw.name, NAME_MAX);
  if (name.length < 2) errors.name = 'it has no customer name.';
  const phone = normalisePhone(typeof raw.phone === 'string' ? raw.phone : '');
  if (!phone) errors.phone = 'the mobile number is not a UK mobile.';
  const postcode = typeof raw.postcode === 'string' && isValidPostcode(raw.postcode) ? normalisePostcode(raw.postcode) : '';
  if (!postcode) errors.postcode = 'the postcode is not a UK postcode.';
  if (Object.keys(errors).length) return { errors };
  const email = sanitiseText(raw.email, EMAIL_MAX);
  const answers = {};
  const given = isObject(raw.answers) ? raw.answers : {};
  for (const step of ENQUIRY_STEPS) if (step.options.some((o) => o.value === given[step.key])) answers[step.key] = given[step.key];
  const answerRows = [{ key: 'postcode', heading: ENQUIRY_ANSWER_HEADINGS.postcode, value: postcode, label: postcode }];
  for (const step of ENQUIRY_STEPS) {
    if (answers[step.key]) answerRows.push({ key: step.key, heading: ENQUIRY_ANSWER_HEADINGS[step.key], value: answers[step.key], label: answerLabel(step.key, answers[step.key]) });
  }
  const utmRaw = typeof raw.utmSource === 'string' ? raw.utmSource.trim() : '';
  const data = {
    kind: 'enq',
    ref,
    createdAt: clampStamp(sentAt, now),
    sentAt,
    name,
    firstName: firstName(name),
    phone,
    phoneDigits: toWaDigits(phone),
    email: email && isEmail(email) ? email : '',
    postcode,
    outside: outsideAreaLabel(postcode) !== '',
    outsideLabel: outsideAreaLabel(postcode),
    answers,
    answerRows,
    marketingOptIn: raw.marketingOptIn === true,
    notes: sanitiseText(raw.notes, NOTES_MAX, { multiline: true }),
    utmSource: utmRaw ? normaliseLeadSource(utmRaw) : ''
  };
  data.importId = importIdOf(data);
  return { data };
}

function cleanQuote(raw) {
  const errors = {};
  const id = typeof raw.id === 'string' && QUOTE_ID_RE.test(raw.id) ? raw.id : '';
  if (!id) errors.id = 'it has no quote number.';
  const customerFirst = firstName(sanitiseText(raw.customerFirst, 40));
  if (!customerFirst) errors.name = 'it has no customer name.';
  const validUntil = isDayKey(raw.validUntil) ? raw.validUntil : '';
  if (!validUntil) errors.validUntil = 'it has no valid-until day.';
  const rows = Array.isArray(raw.lines) ? raw.lines : [];
  if (rows.length < 1 || rows.length > QUOTE_MAX_LINES) errors.lines = 'it has no lines, or too many.';
  const lines = [];
  if (!errors.lines) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = Array.isArray(rows[i])
        ? { label: rows[i][0], qty: rows[i][1], unitPrice: rows[i][2], detail: rows[i][3], optional: rows[i][4] === 1 }
        : isObject(rows[i]) ? rows[i] : null;
      const label = row ? sanitiseText(row.label, 120) : '';
      if (!row || !label || !Number.isInteger(row.qty) || row.qty < 1 || row.qty > 999 || !Number.isInteger(row.unitPrice) || Math.abs(row.unitPrice) > 99999) {
        errors.lines = `line ${i + 1} is not valid.`;
        break;
      }
      lines.push({ id: `ln_${i + 1}`, label, detail: sanitiseText(row.detail, 200), qty: row.qty, unitPrice: row.unitPrice, optional: row.optional === true });
    }
  }
  const total = errors.lines ? 0 : sumLines(lines);
  if (!errors.lines && total <= 0) errors.lines = 'the lines have no price.';
  if (Object.keys(errors).length) return { errors };
  const ref = typeof raw.ref === 'string' && REF_RE.test(raw.ref) ? raw.ref : '';
  const postcode = typeof raw.postcode === 'string' && isValidPostcode(raw.postcode) ? normalisePostcode(raw.postcode) : '';
  return {
    data: {
      kind: 'quo', id, quoteId: id, ref, customerFirst, customerName: customerFirst, postcode, brand: sanitiseText(raw.brand, 40), lines, total,
      notes: sanitiseText(raw.notes, NOTES_MAX, { multiline: true }), validUntil, sentAt: stampOr(raw.sentAt), sample: raw.sample === true
    }
  };
}

function cleanDecisionBase(raw) {
  const errors = {};
  const quoteId = typeof raw.quoteId === 'string' && QUOTE_ID_RE.test(raw.quoteId) ? raw.quoteId : '';
  if (!quoteId) errors.id = 'it has no quote number.';
  const customerFirst = firstName(sanitiseText(raw.customerFirst, 40));
  if (!customerFirst) errors.name = 'it has no customer name.';
  return { errors, quoteId, customerFirst };
}

function cleanAcceptance(raw) {
  const { errors, quoteId, customerFirst } = cleanDecisionBase(raw);
  const total = raw.total;
  if (!Number.isInteger(total) || total < 1 || total > 999999) errors.total = 'it has no valid quote total.';
  if (Object.keys(errors).length) return { errors };
  const days = cleanDays(raw.days);
  const part = cleanPart(raw.part);
  const note = sanitiseText(raw.note, ACC_NOTE_MAX);
  const prefers = describePreferences(days, part, { style: 'compact' });
  return {
    data: {
      kind: 'acc', quoteId, customerFirst, days, part, note, total, prefers, prefersLong: describePreferences(days, part),
      summary: `${customerFirst} accepted quote ${quoteId} (${gbp(total)}), prefers ${prefers}`
    }
  };
}

function cleanDecline(raw) {
  const { errors, quoteId, customerFirst } = cleanDecisionBase(raw);
  if (Object.keys(errors).length) return { errors };
  const reasonId = reasonLabelOf(raw.reasonId) ? raw.reasonId : '';
  const note = sanitiseText(raw.note, DEC_NOTE_MAX);
  const reasonLabel = reasonLabelOf(reasonId);
  return {
    data: {
      kind: 'dec', quoteId, customerFirst, reasonId, reasonLabel, note, reasonText: declineReasonText(reasonId, note),
      summary: `${customerFirst} declined quote ${quoteId}${reasonLabel ? ` (${reasonLabel})` : ''}`
    }
  };
}

// The compact wire object -> the loose long-named object the cleaners read.
function fromWire(p) {
  switch (p.t) {
    case 'enq':
      return { ref: p.i, sentAt: p.c, name: p.n, phone: p.p, email: p.e, postcode: p.z, answers: p.a, marketingOptIn: p.o === 1 || p.o === true, notes: p.m, utmSource: p.u };
    case 'quo':
      return { id: p.i, ref: p.r, customerFirst: p.n, postcode: p.z, brand: p.b, lines: p.l, notes: p.m, validUntil: p.x, sentAt: p.s, sample: Number.isInteger(p.f) && (p.f & 1) === 1 };
    case 'acc':
      return { quoteId: p.i, customerFirst: p.n, days: p.d, part: p.w, note: p.m, total: p.t2 };
    default:
      return { quoteId: p.i, customerFirst: p.n, reasonId: p.y, note: p.m };
  }
}

function cleanByKind(kind, raw, now) {
  switch (kind) {
    case 'enq': return cleanEnquiry(raw, now);
    case 'quo': return cleanQuote(raw);
    case 'acc': return cleanAcceptance(raw);
    case 'dec': return cleanDecline(raw);
    default: return { errors: { kind: 'it is not a kind of link this site makes.' } };
  }
}

// ---------- reading a link: finding the payload in whatever was given ----------

// 'import=<p>' or 'd=<p>' as a URL parameter or fragment key ('#import=', '#/import?d=', 'quote.html#d=', '&d=').
const PARAM_RE = /(?:^|[#?&/\s])(?:import|d)=([A-Za-z0-9_-]{16,})/g;
const LOOSE_RE = /[#=]([A-Za-z0-9_-]{40,})/g;

function candidatesIn(text) {
  const found = [];
  const add = (token) => {
    if (token && !found.includes(token)) found.push(token);
  };
  const variants = [text];
  if (text.includes('%')) {
    try {
      variants.push(decodeURIComponent(text)); // a wa.me address with the link percent-encoded inside it
    } catch (e) {
      // not percent-encoded text: the plain variant is enough
    }
  }
  for (const variant of variants) {
    const compact = variant.replace(/\s+/g, '');
    if (/^[A-Za-z0-9_-]{16,}={0,2}$/.test(compact)) add(compact.replace(/=+$/, '')); // a bare payload (whitespace from a wrapped paste is ignored)
    for (const re of [PARAM_RE, LOOSE_RE]) {
      re.lastIndex = 0;
      let m = re.exec(variant);
      while (m && found.length < 6) {
        add(m[1]);
        m = re.exec(variant);
      }
    }
  }
  return found;
}

function finish(kind, payloadObject, chars, now) {
  const { data, errors } = cleanByKind(kind, fromWire(payloadObject), now);
  if (errors) return invalid(errors);
  return { ok: true, kind, data, payload: payloadObject, chars };
}

/**
 * Read an import or quote link. `input` is a link, a hash (#import=..., #/import?d=..., #d=...), the bare payload, text that contains one
 * of those (a whole WhatsApp message), or an object parseImport / the builders made. Never throws.
 * { ok: true, kind, data, payload, chars } with `data` sanitised and display-ready, or { ok: false, reason, message, errors? }.
 */
export function parseImport(input, { now } = {}) {
  try {
    const nowStr = isStamp(now) ? now : nowStamp();
    if (isObject(input)) {
      if (input.ok === true && isObject(input.payload)) return parseImport(input.payload, { now: nowStr }); // a parseImport result: read it again
      if (input.ok === true && isObject(input.data)) return parseImport(input.data, { now: nowStr });
      if (input.ok === false) return fail(typeof input.reason === 'string' && MESSAGES[input.reason] ? input.reason : 'damaged');
      if (typeof input.t === 'string') {
        // a compact payload object (a builder's result): it must still carry its own valid checksum
        if (typeof input.k !== 'string' || input.k !== payloadChecksum(input)) return fail('damaged');
        if (input.v !== HANDOFF_VERSION || !HANDOFF_KINDS.includes(input.t)) return fail('unsupported');
        return finish(input.t, input, encodePayload(input).length, nowStr);
      }
      if (typeof input.kind === 'string' && HANDOFF_KINDS.includes(input.kind)) {
        // sanitised `data` handed back in (the long names the cleaners read): re-clean it, nothing unchecked gets through
        const { data, errors } = cleanByKind(input.kind, input, nowStr);
        if (errors) return invalid(errors);
        return { ok: true, kind: input.kind, data, payload: null, chars: 0 };
      }
      return fail('no_payload');
    }
    if (typeof input !== 'string') return fail('empty');
    const text = input.trim();
    if (!text) return fail('empty');
    if (text.length > MAX_ENCODED * 2) return fail('too_long');
    const tokens = candidatesIn(text);
    if (tokens.length === 0) return fail('no_payload');
    let firstFailure = null;
    for (const token of tokens) {
      if (token.length > MAX_ENCODED) {
        firstFailure = firstFailure || fail('too_long');
        continue;
      }
      const out = decodeDetailed(token);
      if (out.ok) return finish(out.payload.t, out.payload, token.length, nowStr);
      firstFailure = firstFailure || fail(out.reason);
    }
    return firstFailure || fail('damaged');
  } catch (e) {
    return fail('damaged');
  }
}

/** parseImport for the customer's quote page: only a quote link (kind 'quo') is ok; any other kind is { ok: false, reason: 'wrong_kind' }. */
export function parseQuoteLink(input, opts) {
  const out = parseImport(input, opts);
  if (out.ok && out.kind !== 'quo') return fail('wrong_kind', { message: 'This is not a quote link.' });
  return out;
}

// ---------- what this browser opened in WhatsApp (best effort; never throws) ----------

const REMEMBER_KINDS = ['enq', 'acc', 'dec'];
const REMEMBER_MAX = 30;
let memoryItems = {};

function handoffStore(opts) {
  if (opts && opts.storage) return opts.storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

function readItems(opts) {
  const s = handoffStore(opts);
  if (s) {
    try {
      const raw = s.getItem(HANDOFF_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (isObject(parsed) && parsed.v === 1 && isObject(parsed.items)) return parsed.items;
    } catch (e) {
      // fall through to the memory copy
    }
  }
  return memoryItems;
}

function writeItems(items, opts) {
  memoryItems = items;
  const s = handoffStore(opts);
  if (!s) return false;
  try {
    s.setItem(HANDOFF_STORAGE_KEY, JSON.stringify({ v: 1, items }));
    return true;
  } catch (e) {
    return false;
  }
}

const rememberKey = (kind, id) => (REMEMBER_KINDS.includes(kind) && typeof id === 'string' && id && id.length <= 80 ? `${kind}:${id}` : '');

function tidyInfo(info) {
  const out = {};
  if (!isObject(info)) return out;
  for (const key of Object.keys(info).slice(0, 12)) {
    const v = info[key];
    if (typeof v === 'string') out[key] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === 'string').slice(0, 8).map((x) => x.slice(0, 40));
  }
  return out;
}

/** Note that this browser opened `kind` ('enq' | 'acc' | 'dec') for `id` (the ref or the quote id) in WhatsApp. `at` (a stamp) is added when `info` has none. Returns whether it was saved. */
export function rememberHandoff(kind, id, info = {}, opts) {
  try {
    const key = rememberKey(kind, id);
    if (!key) return false;
    const entry = tidyInfo(info);
    if (!isStamp(entry.at)) entry.at = nowStamp();
    const items = { ...readItems(opts) };
    delete items[key]; // re-inserted last, so the oldest entries are the ones to go
    items[key] = entry;
    const keys = Object.keys(items);
    for (const old of keys.slice(0, Math.max(0, keys.length - REMEMBER_MAX))) delete items[old];
    return writeItems(items, opts);
  } catch (e) {
    return false;
  }
}

/** What rememberHandoff saved for `kind` and `id`, or null. */
export function recallHandoff(kind, id, opts) {
  try {
    const key = rememberKey(kind, id);
    const hit = key ? readItems(opts)[key] : null;
    return isObject(hit) ? { ...hit } : null;
  } catch (e) {
    return null;
  }
}

/** Forget it (a customer starting again). */
export function forgetHandoff(kind, id, opts) {
  try {
    const key = rememberKey(kind, id);
    if (!key) return;
    const items = { ...readItems(opts) };
    if (key in items) {
      delete items[key];
      writeItems(items, opts);
    }
  } catch (e) {
    // nothing to forget
  }
}
