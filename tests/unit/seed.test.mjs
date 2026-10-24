// tests/unit/seed.test.mjs: unit tests for js/core/seed.js (the relative seed diary, fixture totals and invariants)
// Owner: WP1
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultSettings, SOURCE_LABELS } from '../../js/core/config.js';
import { setClock, now } from '../../js/core/clock.js';
import { addDays, addMinutes, stampDay, weekdayOf } from '../../js/core/dates.js';
import { buildSeed, SEED_CUSTOMERS, SAMPLE_CUSTOMER, SIM_POOL } from '../../js/core/seed.js';
import { bookingWindowIds, getDayLoad, nextFreeSlot, nextFreeSlots, occupiedBy } from '../../js/core/availability.js';
import {
  selectNeedsYou, selectOwed, selectOwedTotal, selectInsights, selectCustomers, selectUnseenBookings
} from '../../js/core/selectors.js';
import { postcodeZone } from '../../js/core/format.js';

const FIXTURE = new Date(2026, 9, 23, 20, 30);
const EMOJI = /\p{Extended_Pictographic}/u;

beforeEach(() => setClock(FIXTURE));
afterEach(() => setClock(null));

function seedState(date = FIXTURE, settings = makeDefaultSettings(), existing) {
  setClock(date);
  const seed = buildSeed(now(), settings, existing);
  const top = seed.messages.reduce((m, x) => Math.max(m, x.seq), 0);
  const seededFor = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { v: 1, seededFor, refSeq: seed.refSeq, settings, bookings: seed.bookings, blocks: seed.blocks, messages: seed.messages, meta: { rev: 1, msgSeq: top, messagesSeenSeq: top, simCursor: 0 } };
}

const byId = (state, id) => state.bookings.find((b) => b.id === id);

test('the fixture diary: 15 bookings, refs VM-1028 to VM-1042, one Van MOT group, refSeq 1043', () => {
  const state = seedState();
  assert.equal(state.bookings.length, 15);
  assert.deepEqual(state.bookings.map((b) => b.ref), Array.from({ length: 15 }, (_, i) => `VM-${1028 + i}`));
  assert.deepEqual(state.bookings.map((b) => b.id), Array.from({ length: 15 }, (_, i) => `bk_seed_${String(i + 1).padStart(2, '0')}`));
  assert.ok(state.bookings.every((b) => b.seed === true));
  assert.equal(state.refSeq, 1043);
  assert.equal(state.blocks.length, 4);
  assert.ok(state.blocks.every((b) => b.date === '2026-10-28' && b.label === 'Van MOT' && b.seed === true && b.groupId === 'grp_seed_01'));
  assert.deepEqual(state.blocks.map((b) => b.windowId), [0, 1, 2, 3]);
  assert.equal(new Set(state.blocks.map((b) => b.id)).size, 4);
});

test('each seeded booking lands where 3.4 says (day, window, status, money)', () => {
  const state = seedState();
  const row = (n) => {
    const b = byId(state, `bk_seed_${String(n).padStart(2, '0')}`);
    return [b.start, b.durationMin, b.status, b.customer.name, b.serviceId, b.quotedPrice, b.finalPrice, b.paid, b.paidMethod];
  };
  assert.deepEqual(row(1), ['2026-10-03T08:00', 120, 'done', 'Priya Nair', 'fault', 75, 75, true, 'card']);
  assert.deepEqual(row(2), ['2026-10-07T13:00', 240, 'done', 'Marcus Tate', 'eicr', 150, 150, true, 'bank']);
  assert.deepEqual(row(3), ['2026-10-10T08:00', 240, 'done', 'Alison Reeve', 'consumer', 540, 540, true, 'card']);
  assert.deepEqual(row(4), ['2026-10-16T10:00', 120, 'done', 'Ruth Calder', 'sockets', 85, 170, false, null]);
  assert.deepEqual(row(5), ['2026-10-23T08:00', 120, 'done', 'Tom Hargreaves', 'sockets', 85, 85, true, 'cash']);
  assert.deepEqual(row(6), ['2026-10-23T10:00', 120, 'done', 'Eileen Doyle', 'fault', 75, 75, false, null]);
  assert.deepEqual(row(7), ['2026-10-23T20:30', 0, 'new', 'Ngozi Okafor', 'emergency', 95, null, false, null]);
  assert.deepEqual(row(8), ['2026-10-24T10:00', 120, 'confirmed', 'Hannah Whitfield', 'fault', 75, null, false, null]);
  assert.deepEqual(row(9), ['2026-10-26T13:00', 240, 'confirmed', 'Marcus Tate', 'eicr', 195, null, false, null]);
  assert.deepEqual(row(10), ['2026-10-27T08:00', 120, 'confirmed', 'Alison Reeve', 'fault', 75, null, false, null]);
  assert.deepEqual(row(11), ['2026-10-27T10:00', 120, 'new', 'Sam Wray', 'sockets', 85, null, false, null]);
  assert.deepEqual(row(12), ['2026-10-27T13:00', 120, 'confirmed', 'Ruth Calder', 'fault', 75, null, false, null]);
  assert.deepEqual(row(13), ['2026-10-27T15:00', 120, 'confirmed', 'Tom Hargreaves', 'sockets', 85, null, false, null]);
  assert.deepEqual(row(14), ['2026-10-29T08:00', 120, 'confirmed', 'Kwame Mensah', 'sockets', 85, null, false, null]);
  assert.deepEqual(row(15), ['2026-10-30T10:00', 120, 'cancelled', 'Lena Kowalski', 'fault', 75, null, false, null]);
  const s15 = byId(state, 'bk_seed_15');
  assert.equal(s15.cancelledBy, 'customer');
  assert.equal(s15.cancelReason, 'Customer asked');
  const s02 = byId(state, 'bk_seed_02');
  assert.equal(s02.variantId, 'flat');
  assert.equal(s02.variantLabel, 'Flat');
  assert.deepEqual(s02.address, { line1: '8 Quarry Lane', postcode: 'MB5 2LN' });
  const s09 = byId(state, 'bk_seed_09');
  assert.equal(s09.variantLabel, 'House, 2–3 bed');
  assert.deepEqual(s09.address, { line1: '31 Hollin Road', postcode: 'MB6 7DZ' });
  const s07 = byId(state, 'bk_seed_07');
  assert.equal(s07.urgent, true);
  assert.deepEqual(s07.emergencyReasons, ['no_power']);
  assert.equal(s07.notes, 'No power in kitchen');
  assert.equal(s07.createdAt, '2026-10-23T20:18', 'created 12 minutes before seeding');
});

test('flags: seenByOwner false only for S07 and S11, reviewRequested true for S01 to S04', () => {
  const state = seedState();
  for (const b of state.bookings) {
    const n = Number(b.id.slice(-2));
    assert.equal(b.seenByOwner, n !== 7 && n !== 11, b.id);
    assert.equal(b.reviewRequested, n <= 4, b.id);
  }
  assert.deepEqual(selectUnseenBookings(state).map((b) => b.id), ['bk_seed_07', 'bk_seed_11']);
});

test('createdAt rules: two days before for past and today jobs, the earlier of now-5min and three days before for future jobs', () => {
  const state = seedState();
  assert.equal(byId(state, 'bk_seed_01').createdAt, '2026-10-01T09:00');
  assert.equal(byId(state, 'bk_seed_05').createdAt, '2026-10-21T09:00');
  assert.equal(byId(state, 'bk_seed_08').createdAt, '2026-10-21T09:00');
  assert.equal(byId(state, 'bk_seed_09').createdAt, '2026-10-23T09:00');
  assert.equal(byId(state, 'bk_seed_14').createdAt, '2026-10-23T20:25');
  assert.equal(byId(state, 'bk_seed_11').createdAt, '2026-10-23T19:50', 'now - 40 minutes');
  assert.equal(byId(state, 'bk_seed_07').createdAt, '2026-10-23T20:18', 'now - 12 minutes');
  for (const b of state.bookings) {
    assert.ok(b.createdAt <= '2026-10-23T20:30', `${b.id} is not created in the future`);
    assert.equal(b.history[0].event, 'created');
    assert.equal(b.history[0].at, b.createdAt);
  }
});

test('fixture totals at 2026-10-23T20:30', () => {
  const state = seedState();
  assert.equal(state.bookings.length, 15);
  assert.deepEqual(selectNeedsYou(state).map((b) => b.id), ['bk_seed_07', 'bk_seed_11']);
  assert.equal(selectNeedsYou(state).length, 2);
  assert.deepEqual(selectOwed(state).map((b) => b.id), ['bk_seed_04', 'bk_seed_06']);
  assert.equal(selectOwedTotal(state), 245);
  const insights = selectInsights(state, '2026-10-23T20:30');
  assert.equal(insights.collectedMonth, 850);
  assert.equal(insights.collectedMonthCount, 4);
  assert.equal(insights.owedTotal, 245);
  assert.equal(insights.owedCount, 2);
  assert.equal(insights.bookedNext14, 675);
  assert.equal(insights.bookedNext14Count, 7);
  assert.equal(insights.avgJob, 183);
  assert.equal(selectCustomers(state).length, 11);
});

test('day loads: Sat few, Sun closed, Mon good, Tue full, Wed full (blocked windows are not free)', () => {
  const state = seedState();
  assert.equal(getDayLoad(state, '2026-10-24').level, 'few');
  assert.equal(getDayLoad(state, '2026-10-25').level, 'closed');
  assert.equal(getDayLoad(state, '2026-10-26').level, 'good');
  assert.equal(getDayLoad(state, '2026-10-27').level, 'full');
  assert.equal(getDayLoad(state, '2026-10-28').level, 'full');
  assert.equal(getDayLoad(state, '2026-10-29').level, 'good');
  assert.equal(getDayLoad(state, '2026-10-30').level, 'good', 'the cancelled booking does not occupy Friday window 1');
  assert.deepEqual(getDayLoad(state, '2026-10-24'), { free: 1, total: 2, level: 'few' });
});

test('next free slots: fault is Sat window 0, EICR is Mon morning, and the three hero chips', () => {
  const state = seedState();
  const fault = nextFreeSlot(state, 'fault');
  assert.equal(fault.date, '2026-10-24');
  assert.equal(fault.windowId, 0);
  assert.equal(fault.human, 'Tomorrow, 8–10am');
  const eicr = nextFreeSlot(state, 'eicr');
  assert.equal(eicr.date, '2026-10-26');
  assert.equal(eicr.windowId, 0);
  assert.equal(eicr.blocks, 2);
  assert.deepEqual(nextFreeSlots(state, 'fault', 3).map((s) => s.human), ['Tomorrow, 8–10am', 'Mon 26 Oct, 8–10am', 'Mon 26 Oct, 10am–12']);
});

function assertNoOverlaps(state) {
  const taken = new Map();
  for (const b of state.bookings) {
    if (b.status === 'cancelled' || b.urgent) continue;
    for (const w of bookingWindowIds(b)) {
      const key = `${stampDay(b.start)}|${w}`;
      assert.ok(!taken.has(key), `${b.id} overlaps ${taken.get(key)} at ${key}`);
      taken.set(key, b.id);
    }
  }
  for (const k of state.blocks) {
    const key = `${k.date}|${k.windowId}`;
    assert.ok(!taken.has(key), `block ${k.id} overlaps ${taken.get(key)} at ${key}`);
    taken.set(key, k.id);
  }
}

test('no two non-cancelled bookings (or a block) share a window', () => {
  assertNoOverlaps(seedState());
});

test('Marcus has two EICRs at two addresses', () => {
  const state = seedState();
  const marcus = state.bookings.filter((b) => b.customer.name === 'Marcus Tate');
  assert.equal(marcus.length, 2);
  assert.ok(marcus.every((b) => b.serviceId === 'eicr'));
  assert.equal(new Set(marcus.map((b) => b.address.line1)).size, 2);
});

test('the emergency alert is msg_seed_07_alert and seed message ids follow msg_seed_<NN>_<role>', () => {
  const state = seedState();
  const ids = state.messages.map((m) => m.id);
  assert.ok(ids.includes('msg_seed_07_alert'));
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ids) assert.match(id, /^msg_seed_(0[1-9]|1[0-5])_(alert|conf|rem|done)$/);
  const alert = state.messages.find((m) => m.id === 'msg_seed_07_alert');
  assert.equal(alert.kind, 'owner_emergency');
  assert.equal(alert.to, 'owner');
  assert.equal(alert.bookingId, 'bk_seed_07');
  assert.equal(alert.at, '2026-10-23T20:18');
  assert.equal(state.messages.find((m) => m.id === 'msg_seed_07_conf').kind, 'customer_emergency_received');
});

test('seed messages: which bookings get which, all marked seed and simulated', () => {
  const state = seedState();
  const kindsOf = (n) => state.messages.filter((m) => m.bookingId === `bk_seed_${String(n).padStart(2, '0')}`).map((m) => m.id.split('_').pop()).sort();
  assert.deepEqual(kindsOf(1), [], 'past jobs have no messages');
  assert.deepEqual(kindsOf(4), []);
  assert.deepEqual(kindsOf(15), [], 'cancelled bookings have no messages');
  assert.deepEqual(kindsOf(5), ['alert', 'conf', 'done'], "today's done jobs also get customer_completed");
  assert.deepEqual(kindsOf(6), ['alert', 'conf', 'done']);
  assert.deepEqual(kindsOf(7), ['alert', 'conf']);
  assert.deepEqual(kindsOf(8), ['alert', 'conf', 'rem']);
  assert.deepEqual(kindsOf(11), ['alert', 'conf'], 'an approval booking has no reminder');
  assert.equal(state.messages.find((m) => m.id === 'msg_seed_11_conf').kind, 'customer_received');
  assert.equal(state.messages.find((m) => m.id === 'msg_seed_05_done').kind, 'customer_completed');
  const rem = state.messages.find((m) => m.id === 'msg_seed_09_rem');
  assert.equal(rem.kind, 'customer_reminder');
  assert.equal(rem.sendAt, '2026-10-25T18:00', '18:00 the evening before Monday 26 Oct');
  assert.ok(state.messages.every((m) => m.seed === true && m.simulated === true && m.channel === 'whatsapp'));
  assert.ok(state.messages.every((m) => m.id.startsWith('msg_seed_')));
  assert.match(state.messages.find((m) => m.id === 'msg_seed_11_alert').body, /Needs your OK: outside your usual area \(MB12\)\./);
});

test('seq numbers run 1..n in ascending `at` order and seed alerts are never unread', () => {
  const state = seedState();
  const seqs = state.messages.map((m) => m.seq);
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1));
  for (let i = 1; i < state.messages.length; i += 1) {
    assert.ok(state.messages[i - 1].at <= state.messages[i].at, `at ascending at index ${i}`);
  }
});

test('every seed message body is clean text', () => {
  const state = seedState();
  for (const m of state.messages) {
    assert.ok(!/[{}]/.test(m.body), m.id);
    assert.ok(!m.body.includes('!'), m.id);
    assert.ok(!EMOJI.test(m.body), m.id);
    assert.ok(!m.body.split('\n').some((l) => l.trim() === ''), m.id);
  }
});

test('buildSeed is deterministic', () => {
  setClock(FIXTURE);
  const settings = makeDefaultSettings();
  assert.deepEqual(buildSeed(now(), settings), buildSeed(now(), makeDefaultSettings()));
});

test('existing records are never double-booked: a day rollover cannot take a window somebody else holds', () => {
  const holding = (start, durationMin, id) => ({ id, status: 'confirmed', urgent: false, start, durationMin, seed: false });
  // Saturday window 1 is S08's preferred window: it must fall back to window 0
  let state = seedState(FIXTURE, makeDefaultSettings(), { bookings: [holding('2026-10-24T10:00', 120, 'bk_mine1')], blocks: [] });
  let s08 = byId(state, 'bk_seed_08');
  assert.equal(s08.start, '2026-10-24T08:00');
  // Saturday window 0 held as well: S08 moves to the next open day (Monday) and keeps its preferred window
  const both = [holding('2026-10-24T08:00', 120, 'bk_mine2'), holding('2026-10-24T10:00', 120, 'bk_mine3')];
  state = seedState(FIXTURE, makeDefaultSettings(), { bookings: both, blocks: [] });
  s08 = byId(state, 'bk_seed_08');
  assert.equal(stampDay(s08.start), '2026-10-26');
  for (const b of state.bookings) {
    for (const w of bookingWindowIds(b)) {
      if (b.status === 'cancelled' || b.urgent) continue;
      assert.ok(!(stampDay(b.start) === '2026-10-24' && (w === 0 || w === 1)), `${b.id} sits in a window that is already held`);
    }
  }
  // the spec's own example: an existing booking holding Saturday window 0
  state = seedState(FIXTURE, makeDefaultSettings(), { bookings: [holding('2026-10-24T08:00', 120, 'bk_mine4')], blocks: [] });
  assert.ok(state.bookings.every((b) => !(stampDay(b.start) === '2026-10-24' && bookingWindowIds(b).includes(0))));
  assertNoOverlaps({ bookings: [...state.bookings, holding('2026-10-24T08:00', 120, 'bk_mine4')], blocks: state.blocks });
  // an existing block and booking on the Van MOT day: those windows are not blocked again
  state = seedState(FIXTURE, makeDefaultSettings(), {
    bookings: [holding('2026-10-28T13:00', 120, 'bk_mine5')],
    blocks: [{ id: 'blk_mine', date: '2026-10-28', windowId: 0, label: 'Dentist', groupId: null, seed: false }]
  });
  assert.deepEqual(state.blocks.map((b) => b.windowId), [1, 3]);
  // a busy diary can drop a job rather than double-book (the contract allows 14 or more)
  const full = [0, 1, 2, 3].flatMap((w) => ['2026-10-24', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02'].map((d) => holding(`${d}T${['08:00', '10:00', '13:00', '15:00'][w]}`, 120, `bk_${d}_${w}`)));
  state = seedState(FIXTURE, makeDefaultSettings(), { bookings: full, blocks: [] });
  assert.ok(state.bookings.length >= 8 && state.bookings.length < 15);
  assert.ok(state.bookings.every((b) => b.urgent || b.status === 'cancelled' || stampDay(b.start) <= '2026-10-23' || !full.some((f) => stampDay(f.start) === stampDay(b.start) && bookingWindowIds(f).some((w) => bookingWindowIds(b).includes(w)))));
});

// Hours of the day the seed must hold its shape at: every weekday at 09:00 and Sunday at 12:00, in several weeks.
const WEEKS = ['2026-10-26', '2026-12-28', '2027-03-22', '2027-07-05'];
const CLOCKS = WEEKS.flatMap((monday) => [0, 1, 2, 3, 4, 5].map((i) => [addDays(monday, i), 9, 0]).concat([[addDays(monday, 6), 12, 0]]));

test('invariants hold at every weekday 09:00 and Sunday 12:00 in four different weeks', () => {
  for (const [day, hh, mm] of CLOCKS) {
    const [y, m, d] = day.split('-').map(Number);
    const when = new Date(y, m - 1, d, hh, mm);
    const state = seedState(when);
    const label = `${day} ${hh}:${String(mm).padStart(2, '0')} (weekday ${weekdayOf(day)})`;
    assert.ok(state.bookings.length >= 14, `${label}: ${state.bookings.length} bookings`);
    const statuses = new Set(state.bookings.map((b) => b.status));
    for (const s of ['new', 'confirmed', 'done', 'cancelled']) assert.ok(statuses.has(s), `${label}: has ${s}`);
    assert.ok(!statuses.has('on_the_way'), `${label}: on_the_way is not seeded`);
    assert.equal(state.bookings.filter((b) => b.urgent && b.status === 'new').length, 1, `${label}: one urgent new`);
    assert.ok(selectOwed(state).length >= 1, `${label}: an owed job`);
    const marcus = state.bookings.filter((b) => b.customer.name === 'Marcus Tate' && b.serviceId === 'eicr' && b.status !== 'cancelled');
    assert.equal(marcus.length, 2, `${label}: Marcus has two EICRs`);
    assert.equal(new Set(marcus.map((b) => b.address.line1)).size, 2, `${label}: at two addresses`);
    assertNoOverlaps(state);
    // the first open day after today has window 0 free for customers
    let first = addDays(day, 1);
    while (weekdayOf(first) === 0) first = addDays(first, 1);
    assert.equal(occupiedBy(state, first, 0), null, `${label}: ${first} window 0 is not booked`);
    assert.ok(!state.blocks.some((b) => b.date === first && b.windowId === 0), `${label}: ${first} window 0 is not blocked`);
    // jobs are never in the past unless done, never on a Sunday (except today itself)
    for (const b of state.bookings) {
      if (b.urgent) continue;
      if (weekdayOf(stampDay(b.start)) === 0) assert.equal(stampDay(b.start), day, `${label}: ${b.id} on a Sunday`);
      if (stampDay(b.start) > day) assert.ok(b.status === 'confirmed' || b.status === 'new' || b.status === 'cancelled', `${label}: ${b.id} future status ${b.status}`);
    }
    // statuses of today's two jobs follow the clock
    const s05 = byId(state, 'bk_seed_05');
    const s06 = byId(state, 'bk_seed_06');
    const ended = (b) => addMinutes(b.start, b.durationMin) <= `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    assert.equal(s05.status, ended(s05) ? 'done' : 'confirmed', `${label}: S05`);
    assert.equal(s06.status, ended(s06) ? 'done' : 'confirmed', `${label}: S06`);
    assert.equal(s05.paid, s05.status === 'done');
    assert.equal(s06.paid, false);
    // every seed message renders without leftover placeholders
    for (const msg of state.messages) assert.ok(!/[{}]/.test(msg.body), `${label}: ${msg.id}`);
  }
  setClock(null);
});

test('a Sunday today still shows its jobs and the diary opens on Monday', () => {
  const state = seedState(new Date(2026, 9, 25, 12, 0));
  assert.equal(stampDay(byId(state, 'bk_seed_05').start), '2026-10-25');
  assert.equal(stampDay(byId(state, 'bk_seed_06').start), '2026-10-25');
  assert.equal(byId(state, 'bk_seed_05').status, 'done');
  assert.equal(stampDay(byId(state, 'bk_seed_08').start), '2026-10-26', 'O1 is Monday');
});

test('the seed survives the 25 Oct clock change (Saturday and Monday around it)', () => {
  const state = seedState(new Date(2026, 9, 24, 9, 0));
  assert.equal(stampDay(byId(state, 'bk_seed_08').start), '2026-10-26');
  assert.equal(stampDay(byId(state, 'bk_seed_09').start), '2026-10-27');
  assertNoOverlaps(state);
});

test('seeded customers, sample customer and simulator pool follow the fictional-data rules', () => {
  const keys = ['priya', 'marcus', 'alison', 'tom', 'eileen', 'ngozi', 'hannah', 'kwame', 'ruth', 'sam', 'lena'];
  assert.deepEqual(Object.keys(SEED_CUSTOMERS), keys);
  assert.equal(SEED_CUSTOMERS.priya.name, 'Priya Nair');
  assert.equal(SEED_CUSTOMERS.marcus.addresses.length, 2);
  assert.equal(SEED_CUSTOMERS.sam.addresses[0].postcode, 'MB12 6AB');
  assert.equal(postcodeZone('MB12 6AB', makeDefaultSettings().business), 'edge');
  assert.deepEqual(SAMPLE_CUSTOMER, { name: 'Priya Nair', phone: '07700 900231', email: '', line1: '14 Alder Row', postcode: 'MB3 4QP' });

  const phones = [...Object.values(SEED_CUSTOMERS).map((c) => c.phone), ...SIM_POOL.map((p) => p.phone)];
  assert.equal(new Set(phones).size, phones.length, 'no phone is used twice');
  for (const phone of phones) assert.match(phone, /^07700 900\d{3}$/, phone);
  for (const c of Object.values(SEED_CUSTOMERS)) {
    const n = Number(c.phone.slice(-3));
    assert.ok(n >= 200 && n <= 399, `${c.phone} is in the seed range`);
    assert.ok(c.email === '' || c.email.endsWith('.example'));
  }
  assert.equal(SIM_POOL.length, 8);
  SIM_POOL.forEach((p, i) => {
    assert.equal(p.phone, `07700 90050${i}`);
    assert.equal(postcodeZone(p.postcode, makeDefaultSettings().business), 'covered', p.postcode);
    assert.equal(typeof p.notes, 'string');
    assert.ok(p.name.length > 3 && p.line1.length > 3);
  });
  assert.ok(new Set(SIM_POOL.map((p) => p.postcode.split(' ')[0])).size >= 6, 'postcodes are spread over MB1 to MB10');
});

test('sources used by the seed are all known', () => {
  const state = seedState();
  for (const b of state.bookings) assert.ok(b.source in SOURCE_LABELS, b.source);
  assert.deepEqual([...new Set(state.bookings.map((b) => b.source))].sort(), ['phone', 'referral', 'website', 'whatsapp']);
});

test('seed history reflects the status (created, confirmed, done, paid, cancelled)', () => {
  const state = seedState();
  assert.deepEqual(byId(state, 'bk_seed_01').history.map((h) => h.event), ['created', 'confirmed', 'done', 'paid']);
  assert.deepEqual(byId(state, 'bk_seed_04').history.map((h) => h.event), ['created', 'confirmed', 'done']);
  assert.deepEqual(byId(state, 'bk_seed_07').history.map((h) => h.event), ['created']);
  assert.deepEqual(byId(state, 'bk_seed_11').history.map((h) => h.event), ['created']);
  assert.deepEqual(byId(state, 'bk_seed_08').history.map((h) => h.event), ['created', 'confirmed']);
  assert.deepEqual(byId(state, 'bk_seed_15').history.map((h) => h.event), ['created', 'cancelled']);
  assert.equal(byId(state, 'bk_seed_01').paidAt, '2026-10-03T10:00', 'paidAt is the window end');
  for (const b of state.bookings) {
    const ats = b.history.map((h) => h.at);
    assert.deepEqual([...ats].sort(), ats, `${b.id} history is chronological`);
  }
});

test('buildSeed honours custom settings (prices and a rebrand flow into the seed)', () => {
  const settings = makeDefaultSettings();
  settings.business.ownerFirstName = 'Lee';
  settings.business.name = 'Ashby Sparks';
  settings.services.find((s) => s.id === 'fault').price = 80;
  settings.remindersOn = false;
  const state = seedState(FIXTURE, settings);
  assert.equal(byId(state, 'bk_seed_08').quotedPrice, 80);
  assert.ok(state.messages.find((m) => m.id === 'msg_seed_08_conf').body.includes("it's Lee from Ashby Sparks"));
  assert.ok(!state.messages.some((m) => m.kind === 'customer_reminder'), 'reminders off means no scheduled reminders');
});
