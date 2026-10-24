// tests/unit/availability.test.mjs: unit tests for js/core/availability.js (windows, half-days, the 9.5 worked examples)
// Owner: WP1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultSettings } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import {
  getDaySlots, getDayStatus, getDayLoad, getBookableDays, nextFreeSlot, nextFreeSlots, isSlotFree, occupiedBy,
  bookingWindowIds, bookingEndStamp, bookingWindowLabel, bookingWhen, windowIdFromStart, slotHuman, describeHours
} from '../../js/core/availability.js';

// A bare state is enough for the engine: settings, bookings and blocks.
function makeState({ bookings = [], blocks = [], settings = makeDefaultSettings() } = {}) {
  return { settings, bookings, blocks };
}

let seq = 0;
function job(start, durationMin, extra = {}) {
  seq += 1;
  return { id: `bk_t${seq}`, status: 'confirmed', urgent: false, start, durationMin, ...extra };
}

const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm);
const states = (slots) => slots.map((s) => s.state);

// ---------- the worked examples of 9.5, verbatim ----------

test('example 1: Friday 09:30, empty diary', () => {
  const now = at(2026, 10, 23, 9, 30);
  const state = makeState();
  assert.deepEqual(states(getDaySlots(state, '2026-10-23', 1, { now })), ['too_soon', 'too_soon', 'free', 'free']);
  setClock(now);
  const fault = nextFreeSlot(state, 'fault');
  assert.equal(fault.date, '2026-10-23');
  assert.equal(fault.windowId, 2);
  assert.equal(fault.blocks, 1);
  assert.equal(fault.human, 'Today, 1–3pm');
  const eicr = nextFreeSlot(state, 'eicr');
  assert.equal(eicr.date, '2026-10-23');
  assert.equal(eicr.windowId, 2);
  assert.equal(eicr.blocks, 2);
  assert.equal(eicr.human, 'Today, afternoon, arrive 1–3pm');
  assert.deepEqual(getDayLoad(state, '2026-10-23'), { free: 2, total: 4, level: 'good' });
  setClock(null);
});

test('example 2: Friday 15:30, one booking on Saturday window 1 (Hannah)', () => {
  const hannah = job('2026-10-24T10:00', 120);
  const state = makeState({ bookings: [hannah] });
  const now = at(2026, 10, 23, 15, 30);
  assert.deepEqual(states(getDaySlots(state, '2026-10-23', 1, { now })), ['past', 'past', 'past', 'too_soon']);
  setClock(now);
  const fault = nextFreeSlot(state, 'fault');
  assert.equal(fault.date, '2026-10-24');
  assert.equal(fault.windowId, 0);
  assert.equal(fault.human, 'Tomorrow, 8–10am');
  const eicr = nextFreeSlot(state, 'eicr');
  assert.equal(eicr.date, '2026-10-26');
  assert.equal(eicr.windowId, 0);
  assert.equal(eicr.blocks, 2);
  assert.equal(eicr.human, 'Mon 26 Oct, morning, arrive 8–10am');
  assert.deepEqual(getDayLoad(state, '2026-10-24'), { free: 1, total: 2, level: 'few' });
  assert.deepEqual(states(getDaySlots(state, '2026-10-25', 1)), ['closed', 'closed', 'closed', 'closed']);
  // Saturday, half-day view: the morning is booked (window 1), the afternoon is closed.
  assert.deepEqual(states(getDaySlots(state, '2026-10-24', 2)), ['booked', 'closed']);
  setClock(null);
});

test('example 3: Friday 09:30, today marked Full and Saturday window 0 blocked "Dentist"', () => {
  const settings = makeDefaultSettings();
  settings.fullDays = ['2026-10-23'];
  const state = makeState({ settings, blocks: [{ id: 'blk_1', date: '2026-10-24', windowId: 0, label: 'Dentist', groupId: null, seed: false }] });
  const now = at(2026, 10, 23, 9, 30);
  assert.deepEqual(states(getDaySlots(state, '2026-10-23', 1, { now })), ['full', 'full', 'full', 'full']);
  assert.deepEqual(states(getDaySlots(state, '2026-10-23', 1, { now, ownerMode: true })), ['free', 'free', 'free', 'free']);
  setClock(now);
  assert.deepEqual(getDayLoad(state, '2026-10-23'), { free: 0, total: 4, level: 'full' });
  const next = nextFreeSlot(state, 'fault');
  assert.equal(next.date, '2026-10-24');
  assert.equal(next.windowId, 1);
  assert.equal(next.human, 'Tomorrow, 10am–12');
  const sat = getDaySlots(state, '2026-10-24', 1);
  assert.deepEqual(states(sat), ['blocked', 'free', 'closed', 'closed']);
  assert.equal(sat[0].blockLabel, 'Dentist');
  assert.equal(sat[1].blockLabel, null);
  setClock(null);
});

test('example 4: Friday 20:30, Tuesday window 1 booked plus an EICR in the afternoon; then the EICR is cancelled', () => {
  const fault = job('2026-10-27T10:00', 120);
  const eicr = job('2026-10-27T13:00', 240);
  const state = makeState({ bookings: [fault, eicr] });
  const now = at(2026, 10, 23, 20, 30);
  setClock(now);
  assert.deepEqual(states(getDaySlots(state, '2026-10-27', 1)), ['free', 'booked', 'booked', 'booked']);
  assert.deepEqual(getDayLoad(state, '2026-10-27'), { free: 1, total: 4, level: 'few' });
  assert.deepEqual(states(getDaySlots(state, '2026-10-27', 2)), ['booked', 'booked']);

  eicr.status = 'cancelled';
  assert.deepEqual(states(getDaySlots(state, '2026-10-27', 1)), ['free', 'booked', 'free', 'free']);
  assert.deepEqual(getDayLoad(state, '2026-10-27'), { free: 3, total: 4, level: 'good' });

  // Horizon: today + 13 is the last customer-bookable day; today + 14 is closed for customers, bookable for the owner.
  assert.equal(isSlotFree(state, { date: '2026-11-05', windowId: 0 }), true);
  assert.equal(isSlotFree(state, { date: '2026-11-06', windowId: 0 }), false);
  assert.equal(isSlotFree(state, { date: '2026-11-06', windowId: 0, ownerMode: true }), true);
  assert.deepEqual(states(getDaySlots(state, '2026-11-06', 1)), ['closed', 'closed', 'closed', 'closed']);
  assert.deepEqual(states(getDaySlots(state, '2026-11-06', 1, { ownerMode: true })), ['free', 'free', 'free', 'free']);
  setClock(null);
});

// ---------- rules ----------

test('state precedence follows 9.2: past, booked, closed, blocked, full, too_soon, free', () => {
  const settings = makeDefaultSettings();
  settings.fullDays = ['2026-10-26'];
  settings.daysOff = [{ id: 'off_1', date: '2026-10-27', label: 'Holiday' }];
  const monday = '2026-10-26';
  const state = makeState({
    settings,
    bookings: [job('2026-10-26T08:00', 120)],
    blocks: [
      { id: 'blk_a', date: monday, windowId: 0, label: 'A', groupId: null, seed: false },
      { id: 'blk_b', date: monday, windowId: 1, label: 'B', groupId: null, seed: false },
      { id: 'blk_c', date: '2026-10-27', windowId: 0, label: 'C', groupId: null, seed: false }
    ]
  });
  const now = at(2026, 10, 23, 9, 30);
  // booked beats blocked and full; blocked beats full; full beats free
  assert.deepEqual(states(getDaySlots(state, monday, 1, { now })), ['booked', 'blocked', 'full', 'full']);
  // day off (closed) beats blocked
  assert.deepEqual(states(getDaySlots(state, '2026-10-27', 1, { now })), ['closed', 'closed', 'closed', 'closed']);
  // past beats booked: a booking in a window that has already ended reads past
  const past = makeState({ bookings: [job('2026-10-23T08:00', 120)] });
  assert.equal(getDaySlots(past, '2026-10-23', 1, { now: at(2026, 10, 23, 11, 0) })[0].state, 'past');
  // booked beats closed: a booking in a window the hours no longer cover still shows booked
  const hours = makeDefaultSettings();
  hours.hours[1] = [1, 2, 3];
  const closedBooked = makeState({ settings: hours, bookings: [job('2026-10-26T08:00', 120)] });
  assert.equal(getDaySlots(closedBooked, '2026-10-26', 1, { now })[0].state, 'booked');
  const slot = getDaySlots(state, monday, 1, { now })[0];
  assert.equal(slot.bookingId !== null, true);
});

test('half-day jobs pair windows 0+1 and 2+3 and take the first state of the pair', () => {
  const now = at(2026, 10, 23, 9, 30);
  const empty = makeState();
  const slots = getDaySlots(empty, '2026-10-27', 2, { now });
  assert.equal(slots.length, 2);
  assert.deepEqual(slots.map((s) => s.windowId), [0, 2]);
  assert.deepEqual(slots.map((s) => s.label), ['Morning · arrive 8–10am', 'Afternoon · arrive 1–3pm']);
  assert.deepEqual(slots.map((s) => s.arriveLabel), ['8–10am', '1–3pm']);
  assert.deepEqual(slots.map((s) => s.startsAt), ['2026-10-27T08:00', '2026-10-27T13:00']);
  assert.deepEqual(slots.map((s) => s.endsAt), ['2026-10-27T12:00', '2026-10-27T17:00']);
  assert.deepEqual(states(slots), ['free', 'free']);

  // any booked window makes the pair booked
  const one = makeState({ bookings: [job('2026-10-27T10:00', 120)] });
  assert.deepEqual(states(getDaySlots(one, '2026-10-27', 2, { now })), ['booked', 'free']);
  assert.equal(getDaySlots(one, '2026-10-27', 2, { now })[0].bookingId, one.bookings[0].id);
  // a block in the second window blocks the pair
  const blocked = makeState({ blocks: [{ id: 'b', date: '2026-10-27', windowId: 3, label: 'Dentist', groupId: null, seed: false }] });
  const pair = getDaySlots(blocked, '2026-10-27', 2, { now });
  assert.deepEqual(states(pair), ['free', 'blocked']);
  assert.equal(pair[1].blockLabel, 'Dentist');
  // Saturday afternoon is closed, so half-day Saturday is morning only
  assert.deepEqual(states(getDaySlots(empty, '2026-10-24', 2, { now })), ['free', 'closed']);
  // half-days start only at windows 0 and 2
  assert.equal(isSlotFree(empty, { date: '2026-10-27', windowId: 1, blocks: 2, now }), false);
  assert.equal(isSlotFree(empty, { date: '2026-10-27', windowId: 2, blocks: 2, now }), true);
  assert.equal(isSlotFree(empty, { date: '2026-10-27', windowId: 0, blocks: 2, now }), true);
});

test('serviceOrBlocks accepts a service id or 1 or 2', () => {
  const now = at(2026, 10, 23, 9, 30);
  const state = makeState();
  assert.equal(getDaySlots(state, '2026-10-27', 'fault', { now }).length, 4);
  assert.equal(getDaySlots(state, '2026-10-27', 'eicr', { now }).length, 2);
  assert.equal(getDaySlots(state, '2026-10-27', 'consumer', { now }).length, 2);
  assert.equal(getDaySlots(state, '2026-10-27', 'ev', { now }).length, 2);
  assert.equal(getDaySlots(state, '2026-10-27', 'sockets', { now }).length, 4);
  assert.equal(getDaySlots(state, '2026-10-27', 1, { now }).length, 4);
  assert.equal(getDaySlots(state, '2026-10-27', 2, { now }).length, 2);
  assert.equal(getDaySlots(state, '2026-10-27', 'nope', { now }).length, 4, 'unknown service falls back to one window');
});

test('too_soon boundary: a window starting exactly at now + lead is free', () => {
  const state = makeState();
  // lead 90: at 11:30 the 13:00 window starts exactly at now + 90
  assert.equal(getDaySlots(state, '2026-10-23', 1, { now: at(2026, 10, 23, 11, 30) })[2].state, 'free');
  assert.equal(getDaySlots(state, '2026-10-23', 1, { now: at(2026, 10, 23, 11, 31) })[2].state, 'too_soon');
  assert.equal(isSlotFree(state, { date: '2026-10-23', windowId: 2, now: at(2026, 10, 23, 11, 30) }), true);
  assert.equal(isSlotFree(state, { date: '2026-10-23', windowId: 2, now: at(2026, 10, 23, 11, 31) }), false);
  // a longer lead time moves the boundary
  const settings = makeDefaultSettings();
  settings.leadMinutes = 240;
  const long = makeState({ settings });
  assert.equal(getDaySlots(long, '2026-10-23', 1, { now: at(2026, 10, 23, 9, 0) })[2].state, 'free');
  assert.equal(getDaySlots(long, '2026-10-23', 1, { now: at(2026, 10, 23, 9, 1) })[2].state, 'too_soon');
});

test('window in progress is too_soon, a window that has ended is past', () => {
  const state = makeState();
  const s = getDaySlots(state, '2026-10-23', 1, { now: at(2026, 10, 23, 9, 0) });
  assert.equal(s[0].state, 'too_soon', 'in progress');
  const later = getDaySlots(state, '2026-10-23', 1, { now: at(2026, 10, 23, 10, 0) });
  assert.equal(later[0].state, 'past', 'ends exactly at now');
});

test('horizon: today + maxDaysAhead - 1 is bookable, the next day is closed', () => {
  const now = at(2026, 10, 23, 9, 30);
  const state = makeState();
  assert.equal(isSlotFree(state, { date: '2026-11-05', windowId: 2, now }), true);
  assert.equal(isSlotFree(state, { date: '2026-11-06', windowId: 2, now }), false);
  const settings = makeDefaultSettings();
  settings.maxDaysAhead = 7;
  const week = makeState({ settings });
  assert.equal(isSlotFree(week, { date: '2026-10-29', windowId: 2, now }), true);
  assert.equal(isSlotFree(week, { date: '2026-10-30', windowId: 2, now }), false);
  assert.equal(getDayStatus(week, '2026-10-30', { now }).kind, 'beyond');
  assert.equal(getDayStatus(week, '2026-10-30', { now, ownerMode: true }).kind, 'open');
});

test('a cancelled booking frees its window; an urgent booking never occupies one', () => {
  const now = at(2026, 10, 23, 9, 30);
  const live = job('2026-10-27T08:00', 120);
  const state = makeState({ bookings: [live] });
  assert.equal(isSlotFree(state, { date: '2026-10-27', windowId: 0, now }), false);
  assert.equal(occupiedBy(state, '2026-10-27', 0), live.id);
  live.status = 'cancelled';
  assert.equal(isSlotFree(state, { date: '2026-10-27', windowId: 0, now }), true);
  assert.equal(occupiedBy(state, '2026-10-27', 0), null);

  const urgent = job('2026-10-27T08:00', 0, { urgent: true, status: 'new' });
  const withUrgent = makeState({ bookings: [urgent] });
  assert.equal(isSlotFree(withUrgent, { date: '2026-10-27', windowId: 0, now }), true);
  assert.equal(occupiedBy(withUrgent, '2026-10-27', 0), null);
  assert.deepEqual(bookingWindowIds(urgent), []);

  // a `new` (awaiting approval) booking still holds its window
  const waiting = job('2026-10-27T08:00', 120, { status: 'new' });
  assert.equal(isSlotFree(makeState({ bookings: [waiting] }), { date: '2026-10-27', windowId: 0, now }), false);
});

test('ignoreBookingId lets a job move within its own windows', () => {
  const now = at(2026, 10, 23, 9, 30);
  const eicr = job('2026-10-27T08:00', 240);
  const state = makeState({ bookings: [eicr] });
  assert.equal(isSlotFree(state, { date: '2026-10-27', windowId: 0, blocks: 2, now }), false);
  assert.equal(isSlotFree(state, { date: '2026-10-27', windowId: 0, blocks: 2, now, ignoreBookingId: eicr.id }), true);
  assert.equal(occupiedBy(state, '2026-10-27', 1, { ignoreBookingId: eicr.id }), null);
});

test('owner mode ignores lead time, full days and the horizon but never overrides booked, blocked, day off, hours or past', () => {
  const settings = makeDefaultSettings();
  settings.fullDays = ['2026-10-23', '2026-10-28'];
  settings.daysOff = [{ id: 'off_1', date: '2026-10-29', label: 'Holiday' }];
  const state = makeState({
    settings,
    bookings: [job('2026-10-28T08:00', 120)],
    blocks: [{ id: 'b1', date: '2026-10-28', windowId: 1, label: 'MOT', groupId: null, seed: false }]
  });
  const now = at(2026, 10, 23, 9, 30);
  const owner = { now, ownerMode: true };
  // lead time and full ignored
  assert.deepEqual(states(getDaySlots(state, '2026-10-23', 1, owner)), ['free', 'free', 'free', 'free']);
  // booked and blocked still win on a full day
  assert.deepEqual(states(getDaySlots(state, '2026-10-28', 1, owner)), ['booked', 'blocked', 'free', 'free']);
  // day off still closed
  assert.deepEqual(states(getDaySlots(state, '2026-10-29', 1, owner)), ['closed', 'closed', 'closed', 'closed']);
  // hours still respected (Sunday, Saturday afternoon)
  assert.deepEqual(states(getDaySlots(state, '2026-10-25', 1, owner)), ['closed', 'closed', 'closed', 'closed']);
  assert.deepEqual(states(getDaySlots(state, '2026-10-24', 1, owner)), ['free', 'free', 'closed', 'closed']);
  // past still past
  const evening = { now: at(2026, 10, 23, 16, 30), ownerMode: true };
  assert.deepEqual(states(getDaySlots(state, '2026-10-23', 1, evening)), ['past', 'past', 'past', 'free']);
  assert.equal(isSlotFree(state, { date: '2026-10-22', windowId: 3, now, ownerMode: true }), false);
  // horizon ignored
  assert.equal(isSlotFree(state, { date: '2026-12-01', windowId: 0, now, ownerMode: true }), true);
});

test('getDayStatus kinds and labels', () => {
  const settings = makeDefaultSettings();
  settings.fullDays = ['2026-10-27'];
  settings.daysOff = [{ id: 'off_1', date: '2026-10-28', label: 'Dentist day' }];
  const state = makeState({ settings });
  const now = at(2026, 10, 23, 9, 30);
  assert.deepEqual(getDayStatus(state, '2026-10-22', { now }), { kind: 'past', label: '' });
  assert.deepEqual(getDayStatus(state, '2026-10-23', { now }), { kind: 'open', label: '' });
  assert.deepEqual(getDayStatus(state, '2026-10-25', { now }), { kind: 'closed', label: 'Closed' });
  assert.deepEqual(getDayStatus(state, '2026-10-27', { now }), { kind: 'full', label: 'Full' });
  assert.deepEqual(getDayStatus(state, '2026-10-27', { now, ownerMode: true }), { kind: 'open', label: '' });
  assert.deepEqual(getDayStatus(state, '2026-10-28', { now }), { kind: 'dayoff', label: 'Dentist day' });
  assert.deepEqual(getDayStatus(state, '2026-11-06', { now }), { kind: 'beyond', label: '' });
  // late evening today, every open window past
  assert.deepEqual(getDayStatus(state, '2026-10-23', { now: at(2026, 10, 23, 20, 30) }), { kind: 'closed', label: 'Closed' });
});

test('getDayLoad levels, closed days and a finished today', () => {
  const settings = makeDefaultSettings();
  settings.daysOff = [{ id: 'off_1', date: '2026-10-28', label: 'Holiday' }];
  const now = at(2026, 10, 23, 20, 30);
  const state = makeState({
    settings,
    bookings: [job('2026-10-27T08:00', 120), job('2026-10-27T10:00', 120), job('2026-10-27T13:00', 120), job('2026-10-27T15:00', 120)]
  });
  assert.deepEqual(getDayLoad(state, '2026-10-27', { now }), { free: 0, total: 4, level: 'full' });
  assert.deepEqual(getDayLoad(state, '2026-10-26', { now }), { free: 4, total: 4, level: 'good' });
  assert.deepEqual(getDayLoad(state, '2026-10-25', { now }), { free: 0, total: 0, level: 'closed' });
  assert.deepEqual(getDayLoad(state, '2026-10-28', { now }), { free: 0, total: 0, level: 'closed' });
  assert.deepEqual(getDayLoad(state, '2026-10-22', { now }), { free: 0, total: 0, level: 'closed' });
  assert.deepEqual(getDayLoad(state, '2026-11-06', { now }), { free: 0, total: 0, level: 'closed' });
  assert.deepEqual(getDayLoad(state, '2026-11-06', { now, ownerMode: true }), { free: 4, total: 4, level: 'good' });
  // 20:30 on a weekday: every window of today is past, so today reads closed rather than full
  assert.deepEqual(getDayLoad(state, '2026-10-23', { now }), { free: 0, total: 0, level: 'closed' });
  // blocked windows count in the total but are not free
  const blocked = makeState({ blocks: ['0', '1', '2', '3'].map((w) => ({ id: `b${w}`, date: '2026-10-28', windowId: Number(w), label: 'Van MOT', groupId: 'g', seed: true })) });
  assert.deepEqual(getDayLoad(blocked, '2026-10-28', { now }), { free: 0, total: 4, level: 'full' });
});

test('getBookableDays: per-service freeSlots, not the single-window load', () => {
  const now = at(2026, 10, 23, 20, 30);
  const state = makeState({ bookings: [job('2026-10-24T10:00', 120)] });
  const days = getBookableDays(state, { count: 4, serviceOrBlocks: 'eicr', now });
  assert.equal(days.length, 4);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  assert.equal(days[0].status.kind, 'closed');
  assert.equal(days[1].load.level, 'few');
  assert.equal(days[1].freeSlots, 0, 'Saturday morning half-day is not bookable (window 1 is booked)');
  assert.equal(days[2].status.kind, 'closed');
  assert.equal(days[3].freeSlots, 2);
  const single = getBookableDays(state, { count: 3, serviceOrBlocks: 1, now });
  assert.equal(single[1].freeSlots, 1);
  assert.equal(getBookableDays(state, { now }).length, 14, 'count defaults to maxDaysAhead');
  assert.equal(getBookableDays(state, { now, count: 28, ownerMode: true }).length, 28);
});

test('nextFreeSlots returns distinct slots in time order and nextFreeSlot is the first', () => {
  const now = at(2026, 10, 23, 20, 30);
  const state = makeState({ bookings: [job('2026-10-24T10:00', 120), job('2026-10-26T13:00', 240)] });
  setClock(now);
  const three = nextFreeSlots(state, 'fault', 3);
  assert.deepEqual(three.map((s) => s.human), ['Tomorrow, 8–10am', 'Mon 26 Oct, 8–10am', 'Mon 26 Oct, 10am–12']);
  assert.deepEqual(nextFreeSlot(state, 'fault'), three[0]);
  assert.deepEqual(Object.keys(three[0]).sort(), ['arriveLabel', 'blocks', 'date', 'endsAt', 'human', 'label', 'startsAt', 'windowId']);
  assert.equal(three[0].startsAt, '2026-10-24T08:00');
  assert.equal(three[0].endsAt, '2026-10-24T10:00');
  assert.equal(nextFreeSlots(state, 'fault', 5).length, 5);
  const eicr = nextFreeSlots(state, 'eicr', 2);
  assert.deepEqual(eicr.map((s) => s.human), ['Mon 26 Oct, morning, arrive 8–10am', 'Tue 27 Oct, morning, arrive 8–10am']);
  // nothing free at all
  const settings = makeDefaultSettings();
  settings.hours = [[], [], [], [], [], [], []];
  assert.equal(nextFreeSlot(makeState({ settings }), 'fault'), null);
  assert.deepEqual(nextFreeSlots(makeState({ settings }), 'fault', 3), []);
  setClock(null);
});

test('isSlotFree rejects bad input without throwing', () => {
  const state = makeState();
  const now = at(2026, 10, 23, 9, 30);
  assert.equal(isSlotFree(state, { date: 'nope', windowId: 0, now }), false);
  assert.equal(isSlotFree(state, { date: '2026-10-27', windowId: 7, now }), false);
  assert.equal(isSlotFree(state, { date: '2026-10-27', windowId: 1.5, now }), false);
  assert.equal(isSlotFree(state, { date: '2026-10-27', now }), false);
  assert.equal(isSlotFree(state), false);
});

test('booking helpers: window ids, end stamp, labels and when', () => {
  const single = job('2026-10-24T08:00', 120);
  const morning = job('2026-10-26T08:00', 240);
  const afternoon = job('2026-10-26T13:00', 240);
  const second = job('2026-10-24T10:00', 120);
  const urgent = job('2026-10-23T20:30', 0, { urgent: true });
  assert.deepEqual(bookingWindowIds(single), [0]);
  assert.deepEqual(bookingWindowIds(second), [1]);
  assert.deepEqual(bookingWindowIds(morning), [0, 1]);
  assert.deepEqual(bookingWindowIds(afternoon), [2, 3]);
  assert.deepEqual(bookingWindowIds(urgent), []);
  assert.equal(bookingEndStamp(single), '2026-10-24T10:00');
  assert.equal(bookingEndStamp(afternoon), '2026-10-26T17:00');
  assert.equal(bookingEndStamp(urgent), '2026-10-23T20:30');
  assert.equal(bookingWindowLabel(single), '8–10am');
  assert.equal(bookingWindowLabel(second), '10am–12');
  assert.equal(bookingWindowLabel(morning), 'Morning · arrive 8–10am');
  assert.equal(bookingWindowLabel(afternoon), 'Afternoon · arrive 1–3pm');
  assert.equal(bookingWindowLabel(urgent), 'ASAP');
  assert.equal(bookingWhen(single), 'Sat 24 Oct, 8–10am');
  assert.equal(bookingWhen(morning), 'Mon 26 Oct, morning, 8–10am');
  assert.equal(bookingWhen(afternoon), 'Mon 26 Oct, afternoon, 1–3pm');
  assert.equal(bookingWhen(urgent), 'ASAP');
});

test('windowIdFromStart', () => {
  assert.equal(windowIdFromStart('2026-10-24T08:00'), 0);
  assert.equal(windowIdFromStart('2026-10-24T10:00'), 1);
  assert.equal(windowIdFromStart('2026-10-24T13:00'), 2);
  assert.equal(windowIdFromStart('2026-10-24T15:00'), 3);
  assert.equal(windowIdFromStart('2026-10-24T12:00'), null, 'lunch is never a start');
  assert.equal(windowIdFromStart('2026-10-24T09:00'), null);
});

test('slotHuman', () => {
  assert.equal(slotHuman('2026-10-23', 3, 1, '2026-10-23'), 'Today, 3–5pm');
  assert.equal(slotHuman('2026-10-24', 0, 1, '2026-10-23'), 'Tomorrow, 8–10am');
  assert.equal(slotHuman('2026-10-26', 0, 1, '2026-10-23'), 'Mon 26 Oct, 8–10am');
  assert.equal(slotHuman('2026-10-26', 0, 2, '2026-10-23'), 'Mon 26 Oct, morning, arrive 8–10am');
  assert.equal(slotHuman('2026-10-23', 2, 2, '2026-10-23'), 'Today, afternoon, arrive 1–3pm');
  assert.equal(slotHuman('2026-10-24', 1, 1, '2026-10-23'), 'Tomorrow, 10am–12');
});

test('describeHours', () => {
  assert.equal(describeHours(makeDefaultSettings().hours), 'Mon to Fri 8am to 5pm, Sat 8am to 12pm');
  assert.equal(describeHours([[], [], [], [], [], [], []]), 'Closed');
  const all = [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]];
  assert.equal(describeHours(all), 'Mon to Sun 8am to 5pm');
  const monOnly = [[], [0, 1, 2, 3], [], [], [], [], []];
  assert.equal(describeHours(monOnly), 'Mon 8am to 5pm');
  const gap = [[], [0, 1, 2, 3], [0, 1, 2, 3], [], [0, 1, 2, 3], [0, 1, 2, 3], []];
  assert.equal(describeHours(gap), 'Mon to Tue 8am to 5pm, Thu to Fri 8am to 5pm');
  const afternoons = [[], [2, 3], [2, 3], [2, 3], [], [], [0]];
  assert.equal(describeHours(afternoons), 'Mon to Wed 1pm to 5pm, Sat 8am to 10am');
  const sundayToo = [[0, 1], [0, 1, 2, 3], [0, 1, 2, 3], [], [], [], []];
  assert.equal(describeHours(sundayToo), 'Mon to Tue 8am to 5pm, Sun 8am to 12pm');
});
