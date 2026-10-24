// tests/unit/dates.test.mjs: unit tests for js/core/dates.js (DST-safe day maths, stamps, formatters)
// Owner: WP1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../../js/core/clock.js';
import {
  DAY_SHORT, DAY_LONG, MONTH_SHORT, MONTH_LONG, dateKey, parseDayKey, addDays, diffDays, weekdayOf, weekStart, weekDates,
  monthKeyOf, toStamp, parseStamp, stampDay, stampTime, makeStamp, addMinutes, minutesBetween, fmtDayShort, fmtDayLong,
  fmtRelativeDay, fmtClock, fmtTimeAgo, fmtWindow, isDayKey
} from '../../js/core/dates.js';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LONDON = ZONE === 'Europe/London';

test('name tables', () => {
  assert.equal(DAY_SHORT[0], 'Sun');
  assert.equal(DAY_LONG[6], 'Saturday');
  assert.equal(MONTH_SHORT[9], 'Oct');
  assert.equal(MONTH_LONG[0], 'January');
  assert.equal(DAY_SHORT.length, 7);
  assert.equal(MONTH_SHORT.length, 12);
});

test('addDays steps whole calendar days across the 25 Oct 2026 clock change', () => {
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(addDays('2026-10-26', -1), '2026-10-25');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-10-23', 0), '2026-10-23');
});

test('addDays never skips or repeats a day for two years (both clock changes, every zone)', () => {
  let key = '2026-01-01';
  let weekday = weekdayOf(key);
  for (let i = 1; i <= 730; i += 1) {
    const next = addDays(key, 1);
    assert.equal(diffDays(key, next), 1, `${key} -> ${next}`);
    weekday = (weekday + 1) % 7;
    assert.equal(weekdayOf(next), weekday, `weekday of ${next}`);
    assert.equal(addDays(next, -1), key);
    key = next;
  }
  assert.equal(key, '2028-01-01', '730 days after 1 Jan 2026');
});

test('parseDayKey returns 12:00 local and dateKey round-trips', () => {
  const d = parseDayKey('2026-10-25');
  assert.equal(d.getHours(), 12);
  assert.equal(d.getMinutes(), 0);
  assert.equal(dateKey(d), '2026-10-25');
  assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dateKey(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
});

test('isDayKey accepts only real calendar dates', () => {
  assert.equal(isDayKey('2026-10-23'), true);
  assert.equal(isDayKey('2026-02-29'), false);
  assert.equal(isDayKey('2028-02-29'), true);
  assert.equal(isDayKey('2026-13-01'), false);
  assert.equal(isDayKey('2026-10-3'), false);
  assert.equal(isDayKey(''), false);
  assert.equal(isDayKey(undefined), false);
  assert.equal(isDayKey('2026-10-23T08:00'), false);
});

test('diffDays counts whole days, including across the 25-hour day', () => {
  assert.equal(diffDays('2026-10-23', '2026-10-26'), 3);
  assert.equal(diffDays('2026-10-24', '2026-10-27'), 3);
  assert.equal(diffDays('2026-10-26', '2026-10-23'), -3);
  assert.equal(diffDays('2026-10-25', '2026-10-25'), 0);
  assert.equal(diffDays('2026-10-25', '2026-10-26'), 1);
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(diffDays('2026-12-31', '2027-01-01'), 1);
});

test('minutesBetween uses real minutes: the 25 Oct 2026 day is 25 hours in London', () => {
  // Real minutes between two local midnights = 1440 + (UTC offset before - UTC offset after), whatever the zone.
  const realMinutes = (y, m, d) => 1440 + (new Date(y, m, d + 1).getTimezoneOffset() - new Date(y, m, d).getTimezoneOffset());
  assert.equal(minutesBetween('2026-10-25T00:00', '2026-10-26T00:00'), realMinutes(2026, 9, 25));
  assert.equal(minutesBetween('2026-10-25T00:00', '2026-10-26T00:00'), LONDON ? 1500 : realMinutes(2026, 9, 25));
  assert.equal(minutesBetween('2026-11-01T00:00', '2026-11-02T00:00'), realMinutes(2026, 10, 1), 'the US clock change');
  assert.equal(minutesBetween('2026-10-23T00:00', '2026-10-24T00:00'), 1440);
  assert.equal(minutesBetween('2026-10-23T20:30', '2026-10-23T20:00'), -30);
  assert.equal(minutesBetween('2026-10-23T20:30', '2026-10-23T20:30'), 0);
  if (ZONE === 'America/New_York' || ZONE === 'America/Los_Angeles') assert.equal(minutesBetween('2026-11-01T00:00', '2026-11-02T00:00'), 1500);
  if (ZONE === 'UTC') assert.equal(minutesBetween('2026-10-25T00:00', '2026-10-26T00:00'), 1440);
});

test('addMinutes adds real minutes (a 90 minute lead time is 90 minutes across a clock change)', () => {
  assert.equal(addMinutes('2026-10-23T20:30', 90), '2026-10-23T22:00');
  assert.equal(addMinutes('2026-10-23T20:30', -30), '2026-10-23T20:00');
  assert.equal(addMinutes('2026-10-23T23:30', 60), '2026-10-24T00:30');
  // 00:30 BST + 90 real minutes is 01:00 GMT in London (the repeated hour), plain 02:00 where the clocks do not change that night.
  const ukStyleChange = ['Europe/London', 'Europe/Dublin'].includes(ZONE); // clocks go back at 02:00 BST on 25 Oct 2026
  assert.equal(addMinutes('2026-10-25T00:30', 90), ukStyleChange ? '2026-10-25T01:00' : '2026-10-25T02:00');
  if (LONDON) assert.equal(addMinutes('2026-10-25T00:30', 90), '2026-10-25T01:00');
  // (A naive stamp inside the repeated London hour is ambiguous by nature, so it does not round-trip; that is why
  // the app only ever ADDS minutes to a stamp and compares stamps as strings.)
});

test('weekStart: the week starts on Monday and a Sunday belongs to the Monday before', () => {
  assert.equal(weekStart('2026-10-25'), '2026-10-19');
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  assert.equal(weekStart('2026-10-23'), '2026-10-19');
  assert.equal(weekStart('2026-10-26'), '2026-10-26');
  assert.equal(weekStart('2026-11-01'), '2026-10-26');
});

test('weekDates returns 7 keys, Monday first, across the clock change', () => {
  const week = weekDates('2026-10-25');
  assert.equal(week.length, 7);
  assert.equal(week[0], '2026-10-19');
  assert.equal(week[6], '2026-10-25');
  assert.deepEqual(week.map(weekdayOf), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(weekDates('2026-10-26'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
});

test('weekdayOf uses JS numbering', () => {
  assert.equal(weekdayOf('2026-10-23'), 5);
  assert.equal(weekdayOf('2026-10-24'), 6);
  assert.equal(weekdayOf('2026-10-25'), 0);
});

test('monthKeyOf takes a day key or a stamp', () => {
  assert.equal(monthKeyOf('2026-10-23'), '2026-10');
  assert.equal(monthKeyOf('2026-10-23T20:30'), '2026-10');
  assert.equal(monthKeyOf('2027-01-01'), '2027-01');
});

test('stamps: toStamp, parseStamp, stampDay, stampTime, makeStamp', () => {
  const d = new Date(2026, 9, 23, 20, 30, 45);
  assert.equal(toStamp(d), '2026-10-23T20:30');
  const back = parseStamp('2026-10-23T20:30');
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 9);
  assert.equal(back.getDate(), 23);
  assert.equal(back.getHours(), 20);
  assert.equal(back.getMinutes(), 30);
  assert.equal(stampDay('2026-10-23T20:30'), '2026-10-23');
  assert.equal(stampTime('2026-10-23T20:30'), '20:30');
  assert.equal(makeStamp('2026-10-24', '08:00'), '2026-10-24T08:00');
  assert.ok('2026-10-24T08:00' > '2026-10-23T20:30', 'stamps compare as plain strings');
});

test('fmtDayShort and fmtDayLong', () => {
  assert.equal(fmtDayShort('2026-10-24'), 'Sat 24 Oct');
  assert.equal(fmtDayShort('2026-11-01'), 'Sun 1 Nov');
  assert.equal(fmtDayLong('2026-10-24'), 'Saturday 24 October');
  assert.equal(fmtDayLong('2026-12-25'), 'Friday 25 December');
});

test('fmtRelativeDay', () => {
  assert.equal(fmtRelativeDay('2026-10-23', '2026-10-23'), 'Today');
  assert.equal(fmtRelativeDay('2026-10-24', '2026-10-23'), 'Tomorrow');
  assert.equal(fmtRelativeDay('2026-10-22', '2026-10-23'), 'Yesterday');
  assert.equal(fmtRelativeDay('2026-10-26', '2026-10-23'), 'Mon 26 Oct');
  assert.equal(fmtRelativeDay('2026-10-26', '2026-10-25'), 'Tomorrow');
  assert.equal(fmtRelativeDay('2026-10-25', '2026-10-24'), 'Tomorrow');
});

test('fmtRelativeDay defaults to the clock', () => {
  setClock(new Date(2026, 9, 23, 12, 0));
  assert.equal(fmtRelativeDay('2026-10-23'), 'Today');
  assert.equal(fmtRelativeDay('2026-10-24'), 'Tomorrow');
  setClock(null);
});

test('fmtClock reads a stamp or a Date', () => {
  assert.equal(fmtClock('2026-10-23T20:05'), '20:05');
  assert.equal(fmtClock(new Date(2026, 9, 23, 7, 9)), '07:09');
});

test('fmtTimeAgo', () => {
  const now = '2026-10-23T20:30';
  assert.equal(fmtTimeAgo('2026-10-23T20:30', now), 'just now');
  assert.equal(fmtTimeAgo('2026-10-23T20:31', now), 'just now', 'a future stamp reads just now');
  assert.equal(fmtTimeAgo('2026-10-23T20:29', now), '1 min ago');
  assert.equal(fmtTimeAgo('2026-10-23T20:18', now), '12 min ago');
  assert.equal(fmtTimeAgo('2026-10-23T19:31', now), '59 min ago');
  assert.equal(fmtTimeAgo('2026-10-23T19:30', now), '1 h ago');
  assert.equal(fmtTimeAgo('2026-10-23T17:30', now), '3 h ago');
  assert.equal(fmtTimeAgo('2026-10-22T20:31', now), '23 h ago');
  assert.equal(fmtTimeAgo('2026-10-22T20:30', now), 'Yesterday');
  assert.equal(fmtTimeAgo('2026-10-22T09:00', now), 'Yesterday');
  assert.equal(fmtTimeAgo('2026-10-21T09:00', now), 'Wed 21 Oct');
  assert.equal(fmtTimeAgo('2026-10-01T09:00', now), 'Thu 1 Oct');
});

test('fmtTimeAgo defaults to the clock', () => {
  setClock(new Date(2026, 9, 23, 20, 30));
  assert.equal(fmtTimeAgo('2026-10-23T20:18'), '12 min ago');
  setClock(null);
});

test('fmtWindow uses the en dash labels', () => {
  assert.equal(fmtWindow(0), '8–10am');
  assert.equal(fmtWindow(1), '10am–12');
  assert.equal(fmtWindow(2), '1–3pm');
  assert.equal(fmtWindow(3), '3–5pm');
  assert.ok(fmtWindow(0).includes('–'));
});
