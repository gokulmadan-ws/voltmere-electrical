// js/core/dates.js: DST-safe local date and stamp helpers plus the hand-written date formatters
// Owner: WP1
import { todayKey, nowStamp } from './clock.js';
import { WINDOWS } from './config.js';

// The ONLY place a milliseconds-per-day constant may exist (7.6 item 8). It is only ever applied to
// Date.UTC values, which have no clock changes, so a 25-hour day still counts as one day.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** True when `key` is a real 'YYYY-MM-DD' calendar date. (Extra export, used by store and availability.) */
export function isDayKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Date -> the DayKey of its LOCAL date. */
export function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** DayKey -> Date at 12:00 local (noon dodges every DST edge). */
export function parseDayKey(key) {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** DayKey + n days (n may be negative). Calendar arithmetic, never milliseconds. */
export function addDays(key, n) {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** Whole days from a to b; negative when b is earlier. */
export function diffDays(a, b) {
  const [ay, am, ad] = String(a).slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = String(b).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

/** 0 (Sunday) to 6 (Saturday). */
export function weekdayOf(key) {
  return parseDayKey(key).getDay();
}

/** The Monday on or before `key` (a Sunday belongs to the week that started the Monday before). */
export function weekStart(key) {
  const wd = weekdayOf(key);
  return addDays(key, -((wd + 6) % 7));
}

/** The 7 keys Monday to Sunday of the week containing `key`. */
export function weekDates(key) {
  const start = weekStart(key);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(start, i));
}

/** '2026-10' from a DayKey or a Stamp. */
export function monthKeyOf(keyOrStamp) {
  return String(keyOrStamp).slice(0, 7);
}

/** Date -> Stamp (local, minute precision). */
export function toStamp(date) {
  return `${dateKey(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Stamp -> Date (local). */
export function parseStamp(stamp) {
  const s = String(stamp);
  const [y, mo, d] = s.slice(0, 10).split('-').map(Number);
  const [h, mi] = s.slice(11, 16).split(':').map(Number);
  return new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0);
}

export function stampDay(stamp) {
  return String(stamp).slice(0, 10);
}

export function stampTime(stamp) {
  return String(stamp).slice(11, 16);
}

export function makeStamp(dayKey, hhmm) {
  return `${dayKey}T${hhmm}`;
}

/** Stamp + n REAL minutes (correct across a clock change). */
export function addMinutes(stamp, n) {
  const d = parseStamp(stamp);
  d.setTime(d.getTime() + n * 60000);
  return toStamp(d);
}

/** Integer real minutes from stamp a to stamp b (negative when b is earlier). */
export function minutesBetween(a, b) {
  return Math.round((parseStamp(b).getTime() - parseStamp(a).getTime()) / 60000);
}

/** 'Sat 24 Oct' */
export function fmtDayShort(key) {
  const d = parseDayKey(key);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** 'Saturday 24 October' */
export function fmtDayLong(key) {
  const d = parseDayKey(key);
  return `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`;
}

/** 'Today' | 'Tomorrow' | 'Yesterday' | fmtDayShort(key) */
export function fmtRelativeDay(key, todayKeyStr = todayKey()) {
  const diff = diffDays(todayKeyStr, key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDayShort(key);
}

/** 'HH:mm' (24-hour) from a Stamp or a Date. */
export function fmtClock(stampOrDate) {
  if (stampOrDate instanceof Date) return `${pad2(stampOrDate.getHours())}:${pad2(stampOrDate.getMinutes())}`;
  return stampTime(stampOrDate);
}

/** 'just now' | '12 min ago' | '3 h ago' | 'Yesterday' | 'Sat 24 Oct' */
export function fmtTimeAgo(stamp, nowStampStr = nowStamp()) {
  const mins = minutesBetween(stamp, nowStampStr);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  const day = stampDay(stamp);
  if (diffDays(day, stampDay(nowStampStr)) === 1) return 'Yesterday';
  return fmtDayShort(day);
}

/** '8–10am' */
export function fmtWindow(windowId) {
  return WINDOWS[windowId].label;
}
