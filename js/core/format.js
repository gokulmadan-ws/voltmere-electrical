// js/core/format.js: money, phone, postcode, validators, ids and small text helpers
// Owner: WP1

/** '£195', '£12.50' when not a whole number, '-£5' when negative. */
export function gbp(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '£0';
  const abs = Math.abs(Math.round(num * 100) / 100);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${num < 0 && abs !== 0 ? '-' : ''}£${text}`;
}

/** Any accepted UK mobile spelling -> '07700 900231'; anything else -> null. */
export function normalisePhone(input) {
  const raw = String(input === null || input === undefined ? '' : input).trim();
  if (!raw || /[A-Za-z]/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('44')) {
    d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1); // '+44 (0)7700 ...'
  } else if (d.startsWith('0')) {
    d = d.slice(1);
  } else {
    return null;
  }
  if (!/^7[1-9]\d{8}$/.test(d)) return null; // UK mobiles are 07xxx xxxxxx (070 is not a mobile)
  return `0${d.slice(0, 4)} ${d.slice(4)}`;
}

export function isUkMobile(input) {
  return normalisePhone(input) !== null;
}

/** Digits for wa.me: '00' prefix dropped, leading '0' -> '44', '440...' -> '44...'. '' when no digits. */
export function toWaDigits(input) {
  let d = String(input === null || input === undefined ? '' : input).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `44${d.slice(1)}`;
  else if (d.startsWith('440')) d = `44${d.slice(3)}`;
  return d;
}

/** '' -> ''; a UK mobile or a '+' / '00' international number of 8 to 15 digits -> digits; else null. */
export function normaliseDemoPhone(input) {
  const raw = String(input === null || input === undefined ? '' : input).trim();
  if (!raw) return '';
  if (/[A-Za-z]/.test(raw)) return null;
  if (normalisePhone(raw) !== null) return toWaDigits(raw);
  const compact = raw.replace(/[\s\-().]/g, '');
  if (!/^(\+|00)\d+$/.test(compact)) return null;
  const digits = compact.replace(/^\+|^00/, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** 'mb34qp' -> 'MB3 4QP'. Input under 5 characters comes back trimmed and upper-cased. */
export function normalisePostcode(input) {
  const trimmed = String(input === null || input === undefined ? '' : input).trim().toUpperCase();
  const compact = trimmed.replace(/\s+/g, '');
  if (compact.length < 5) return trimmed;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

// Deliberately lenient: 'AB1 2CD' is valid (and lands in the 'outside' zone).
export function isValidPostcode(input) {
  return /^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$/.test(normalisePostcode(input));
}

/** 'MB3 4QP' -> 'MB3'; '' when invalid. */
export function outwardCode(input) {
  if (!isValidPostcode(input)) return '';
  return normalisePostcode(input).split(' ')[0];
}

/** 'invalid' | 'covered' | 'edge' | 'outside'. `business` carries coveredOutward and edgeOutward arrays. */
export function postcodeZone(input, business) {
  const outward = outwardCode(input);
  if (!outward) return 'invalid';
  if (business && Array.isArray(business.coveredOutward) && business.coveredOutward.includes(outward)) return 'covered';
  if (business && Array.isArray(business.edgeOutward) && business.edgeOutward.includes(outward)) return 'edge';
  return 'outside';
}

// Validators return '' when valid, otherwise the exact message from 13.2.3.
const blank = (v) => String(v === null || v === undefined ? '' : v).trim() === '';

export function validateName(v) {
  return String(v === null || v === undefined ? '' : v).trim().length < 2 ? 'Enter your name' : '';
}

export function validatePhone(v) {
  if (blank(v)) return 'Enter your mobile number';
  return isUkMobile(v) ? '' : "That doesn't look like a UK mobile. It should start 07 or +44 7";
}

export function validatePostcode(v) {
  if (blank(v)) return 'Enter your postcode';
  return isValidPostcode(v) ? '' : 'Enter a UK postcode, like MB3 4QP';
}

export function validateLine1(v) {
  return blank(v) ? 'Enter your house number and street' : '';
}

/** 'Priya Nair' -> 'PN'; one word -> its first two letters; blank -> '?'. */
export function initials(name) {
  const words = String(name === null || name === undefined ? '' : name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** First whitespace-separated word, original case. */
export function firstName(name) {
  return String(name === null || name === undefined ? '' : name).trim().split(/\s+/)[0] || '';
}

/** Stable integer 0 to 5 (sum of char codes mod 6): the avatar tint index. */
export function hashHue(name) {
  let sum = 0;
  for (const ch of String(name === null || name === undefined ? '' : name)) sum += ch.charCodeAt(0);
  return sum % 6;
}

/** prefix + '_' + 8 random base36 characters. Random, never time-based, so a frozen test clock cannot collide. */
export function makeId(prefix) {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += Math.floor(Math.random() * 36).toString(36);
  return `${prefix}_${s}`;
}

/** plural(1, 'job') -> '1 job'; plural(2, 'job') -> '2 jobs'. */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
