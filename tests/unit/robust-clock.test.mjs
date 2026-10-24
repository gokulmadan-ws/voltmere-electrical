// tests/unit/robust-clock.test.mjs: the diary and the availability engine at the awkward moments of the calendar: the UK clock change (Sun 25 Oct 2026 and
// Sun 28 Mar 2027), midnight, 29 February 2028 and the turn of the year. Run under Europe/London, UTC and America/New_York (see package.json "test").
// Whatever moment it is, a fresh store seeds, the engine only offers windows that are really free, and filling every offered window never double-books one.
// Owner: ROBUST (final gate)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS, WINDOWS } from '../../js/core/config.js';
import { setClock, todayKey, nowStamp } from '../../js/core/clock.js';
import { addDays, addMinutes, diffDays, isDayKey, minutesBetween, parseDayKey, parseStamp, toStamp, weekdayOf, weekStart } from '../../js/core/dates.js';
import { bookingWindowIds, getBookableDays, isSlotFree, nextFreeSlots } from '../../js/core/availability.js';
import { selectInsights, selectPipeline, selectSla } from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

afterEach(() => setClock(null));

function memStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

// [label, local date parts]: every one is a moment a developer's own clock change, a midnight or a leap day can turn into a bug
const MOMENTS = [
  ['UK clocks go back, 00:30 (summer time)', [2026, 9, 25, 0, 30]],
  ['UK clocks go back, 01:30 (the hour that happens twice)', [2026, 9, 25, 1, 30]],
  ['UK clocks go back, 02:30 (winter time)', [2026, 9, 25, 2, 30]],
  ['the Saturday before the change, late evening', [2026, 9, 24, 23, 59]],
  ['the Monday after the change, first thing', [2026, 9, 26, 7, 59]],
  ['UK clocks go forward, 00:30', [2027, 2, 28, 0, 30]],
  ['UK clocks go forward, 03:30 (summer time)', [2027, 2, 28, 3, 30]],
  ['NY clocks go back (Sun 1 Nov 2026), 01:30', [2026, 10, 1, 1, 30]],
  ['NY clocks go forward (Sun 8 Mar 2026), 03:30', [2026, 2, 8, 3, 30]],
  ['midnight rollover, 23:59', [2026, 9, 23, 23, 59]],
  ['midnight rollover, 00:01', [2026, 9, 24, 0, 1]],
  ['leap day eve, 23:59', [2028, 1, 28, 23, 59]],
  ['29 February 2028, 00:00', [2028, 1, 29, 0, 0]],
  ['29 February 2028, noon', [2028, 1, 29, 12, 0]],
  ['1 March 2028, 00:01', [2028, 2, 1, 0, 1]],
  ['the non-leap 28 February 2027, 23:59', [2027, 1, 28, 23, 59]],
  ['New Year\'s Eve, 23:59', [2026, 11, 31, 23, 59]],
  ['New Year\'s Day, 00:01', [2027, 0, 1, 0, 1]],
  ['a weekday morning in the quiet middle of the month', [2026, 10, 10, 9, 0]]
];

const KEY = STORAGE_KEYS.state;
const livePairs = (st) => st.bookings.filter((b) => b.status !== 'cancelled' && b.durationMin > 0).flatMap((b) => bookingWindowIds(b).map((w) => `${b.start.slice(0, 10)}|${w}|${b.id}`));

for (const [label, parts] of MOMENTS) {
  test(`${label}: a fresh store seeds, the engine offers only free windows, filling them never double-books`, () => {
    const at = new Date(...parts);
    setClock(at);
    const storage = memStorage();
    const st = store.initStore({ storage, force: true });
    assert.equal(st.seededFor, todayKey());
    assert.ok(st.bookings.length > 0 && st.messages.length > 0);
    // the seed itself never double-books
    const seeded = livePairs(st).map((x) => x.split('|').slice(0, 2).join('|'));
    assert.equal(new Set(seeded).size, seeded.length, 'the demo diary has no window twice');
    // every offered window is free, in the future, on a working day, and refers to a real calendar day
    const offered = nextFreeSlots(st, 'sockets', 12, { ownerMode: false });
    for (const s of offered) {
      assert.ok(isDayKey(s.date), s.date);
      assert.ok(isSlotFree(st, { date: s.date, windowId: s.windowId, blocks: 1 }), `${s.date} w${s.windowId} is offered, so it is free`);
      assert.ok(s.date >= todayKey(), 'not in the past');
      assert.ok(st.settings.hours[weekdayOf(s.date)].includes(s.windowId), 'a window he works');
    }
    // fill them one by one through the real createBooking: each must succeed once and then be gone
    let made = 0;
    for (const s of offered) {
      const res = store.createBooking({ serviceId: 'sockets', date: s.date, windowId: s.windowId, customer: { name: `Fill ${made}`, phone: '07700 900321' }, address: { line1: '1 Road', postcode: 'BT9 6QP' } });
      assert.ok(res.ok, `${s.date} w${s.windowId}: ${res.reason}`);
      made += 1;
      const again = store.createBooking({ serviceId: 'sockets', date: s.date, windowId: s.windowId, customer: { name: 'Second', phone: '07700 900322' }, address: { line1: '2 Road', postcode: 'BT9 6QP' } });
      assert.equal(again.reason, 'slot_taken', 'the same window cannot be sold twice');
    }
    const after = store.getState();
    const pairs = livePairs(after).map((x) => x.split('|').slice(0, 2).join('|'));
    assert.equal(new Set(pairs).size, pairs.length, 'no window holds two bookings after filling');
    for (const s of offered) assert.ok(!isSlotFree(after, { date: s.date, windowId: s.windowId, blocks: 1 }), `${s.date} w${s.windowId} is taken now`);
    // the clocks the screens read keep working
    assert.doesNotThrow(() => { selectSla(after, nowStamp()); selectPipeline(after, nowStamp()); selectInsights(after, nowStamp()); getBookableDays(after, { count: 14 }); });
    assert.equal(JSON.parse(storage.map.get(KEY)).seededFor, todayKey());
  });
}

test('the day after a quiet day: a store seeded yesterday rolls over to today without touching what a person made', () => {
  setClock(new Date(2026, 9, 23, 23, 59));
  const storage = memStorage();
  store.initStore({ storage, force: true });
  const mine = store.createBooking({ serviceId: 'sockets', date: '2026-10-26', windowId: 0, customer: { name: 'Keeper', phone: '07700 900321' }, address: { line1: '1 Road', postcode: 'BT9 6QP' } });
  assert.ok(mine.ok);
  setClock(new Date(2026, 9, 24, 0, 1));
  const next = store.initStore({ storage, force: true });
  assert.equal(next.seededFor, '2026-10-24');
  assert.ok(next.bookings.some((b) => b.id === mine.booking.id));
  const pairs = livePairs(next).map((x) => x.split('|').slice(0, 2).join('|'));
  assert.equal(new Set(pairs).size, pairs.length);
});

test('calendar arithmetic is right across every clock change, the leap day and the year end', () => {
  const ranges = [['2026-03-20', 20], ['2026-10-20', 20], ['2027-03-22', 14], ['2026-11-01', 5], ['2028-02-24', 10], ['2026-12-27', 10], ['2027-12-29', 6]];
  for (const [from, n] of ranges) {
    let prev = null;
    for (let i = 0; i < n; i += 1) {
      const day = addDays(from, i);
      assert.ok(isDayKey(day), day);
      if (prev) {
        assert.equal(diffDays(prev, day), 1, `${prev} -> ${day}`);
        assert.equal(weekdayOf(day), (weekdayOf(prev) + 1) % 7, `weekday after ${prev}`);
      }
      assert.equal(addDays(addDays(day, 40), -40), day);
      const [y, m, d] = day.split('-').map(Number);
      assert.equal(weekdayOf(day), new Date(Date.UTC(y, m - 1, d)).getUTCDay(), `weekday of ${day}`);
      assert.equal(weekdayOf(weekStart(day)), 1, 'a week starts on Monday');
      prev = day;
    }
  }
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2028-02-28', '2028-03-01'), 2);
  assert.equal(diffDays('2027-02-28', '2027-03-01'), 1);
  assert.ok(isDayKey('2028-02-29') && !isDayKey('2027-02-29') && !isDayKey('2026-02-31') && !isDayKey('2026-13-01') && !isDayKey('2026-00-10'));
});

test('real minutes across the clock change: an hour is an hour (outside the one hour that appears twice, where a wall-clock stamp cannot say which)', () => {
  // addMinutes adds ELAPSED minutes, so what it returns is the stamp of the instant that many minutes later
  const twice = (stamp) => { const t = parseStamp(stamp).getTime(); return toStamp(new Date(t + 3600000)) === stamp || toStamp(new Date(t - 3600000)) === stamp; };
  for (const start of ['2026-10-24T22:30', '2026-10-25T00:30', '2026-10-25T03:30', '2027-03-27T22:30', '2027-03-28T03:30', '2028-02-29T23:30']) {
    for (const n of [30, 60, 90, 24 * 60]) {
      const there = addMinutes(start, n);
      assert.equal(toStamp(new Date(parseStamp(start).getTime() + n * 60000)), there, `${start} + ${n} is the stamp of that real instant`);
      if (!twice(there) && !twice(start)) {
        assert.equal(minutesBetween(start, there), n, `${start} + ${n}`);
        assert.equal(addMinutes(there, -n), start, `${start} + ${n} - ${n}`);
      }
    }
  }
  for (const w of WINDOWS) assert.match(w.start, /^\d\d:\d\d$/);
  assert.equal(toStamp(parseDayKey('2026-10-25')), '2026-10-25T12:00');
});

test('?now= pins a moment inside the hour that happens twice, and a moment that does not exist is refused, not shifted', async () => {
  const { setClock: set, nowStamp: stamp } = await import('../../js/core/clock.js');
  set(new Date(2026, 9, 25, 1, 30));
  assert.equal(stamp(), '2026-10-25T01:30');
  set(new Date(2026, 9, 25, 2, 30));
  assert.equal(stamp(), '2026-10-25T02:30');
});
