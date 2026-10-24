// js/core/clock.js: the ONLY place that reads the real time; supports the ?now= test override
// Owner: WP1

// Override state: null (use the real clock) or { fakeStartMs, realStartMs, frozen, stamp }.
let override = null;
let initialised = false;

const pad2 = (n) => String(n).padStart(2, '0');

// Local-time Stamp of a Date. Kept private so clock.js has no import cycle with dates.js.
function stampOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parse 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DDTHH:mm:ss' as LOCAL time; null when malformed or not a real date. */
function parseNowParam(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || '0'].map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s, 0);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rollover such as 2026-02-31 or 25:00 (the Date constructor silently normalises them).
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) return null;
  return date;
}

function readOverrideFromLocation() {
  try {
    const search = globalThis.location && globalThis.location.search;
    if (!search) return null;
    const params = new URLSearchParams(search);
    const date = parseNowParam(params.get('now'));
    if (!date) return null;
    const f = params.get('freeze'); // CONTRACT-GAP: 8.2 says freeze=1; 'true' is accepted too
    return makeOverride(date, f === '1' || f === 'true');
  } catch (e) {
    return null;
  }
}

function makeOverride(date, frozen) {
  return { fakeStartMs: date.getTime(), realStartMs: Date.now(), frozen: !!frozen, stamp: stampOf(date) };
}

function ensureInit() {
  if (initialised) return;
  initialised = true;
  override = readOverrideFromLocation();
}

/** The current moment as a Date: the real time, or the ?now= override (ticking unless &freeze=1). */
export function now() {
  ensureInit();
  if (!override) return new Date();
  if (override.frozen) return new Date(override.fakeStartMs);
  return new Date(override.fakeStartMs + (Date.now() - override.realStartMs));
}

/** Stamp ('YYYY-MM-DDTHH:mm') of now(). */
export function nowStamp() {
  return stampOf(now());
}

/** DayKey ('YYYY-MM-DD') of now(). */
export function todayKey() {
  return nowStamp().slice(0, 10);
}

export function isClockOverridden() {
  ensureInit();
  return override !== null;
}

/** The Stamp the override started at, or null. */
export function clockOverrideStamp() {
  ensureInit();
  return override ? override.stamp : null;
}

// CONTRACT-GAP: for a ticking (non-frozen) override this carries the START stamp, so a second page
// opened from a link restarts the clock at that stamp. Tests and screenshots always use freeze=1.
/** '' or '?now=2026-10-23T20:30&freeze=1', to carry the override across pages. */
export function clockQuery() {
  ensureInit();
  if (!override) return '';
  return `?now=${override.stamp}${override.frozen ? '&freeze=1' : ''}`;
}

/** For tests: pin (or, with null, clear) the clock. A Date is read as an instant; frozen by default. */
export function setClock(dateOrNull, { frozen = true } = {}) {
  initialised = true; // an explicit call always wins over the URL
  if (dateOrNull === null || dateOrNull === undefined) {
    override = null;
    return;
  }
  const date = dateOrNull instanceof Date ? dateOrNull : new Date(dateOrNull);
  override = makeOverride(date, frozen);
}
