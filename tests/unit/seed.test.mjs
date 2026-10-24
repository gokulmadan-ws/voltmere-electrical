// tests/unit/seed.test.mjs: unit tests for js/core/seed.js (the relative seed diary, the v3 pipeline seed, fixture totals and invariants)
// Owner: WP1 (v1), A3 (v3 updates)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ENQUIRY_STEPS, SCHEMA_VERSION, SOURCE_LABELS, answerLabel, makeDefaultSettings, normaliseAnswers } from '../../js/core/config.js';
import { setClock, now } from '../../js/core/clock.js';
import { addDays, addMinutes, stampDay, weekdayOf } from '../../js/core/dates.js';
import { buildSeed, SEED_CUSTOMERS, SAMPLE_CUSTOMER, SAMPLE_ENQUIRY_ANSWERS, SIM_POOL } from '../../js/core/seed.js';
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
  return { v: SCHEMA_VERSION, seededFor, refSeq: seed.refSeq, settings, bookings: seed.bookings, blocks: seed.blocks, messages: seed.messages, meta: { rev: 1, msgSeq: top, messagesSeenSeq: top, simCursor: 0 } };
}

const byId = (state, id) => state.bookings.find((b) => b.id === id);

test('the fixture diary: 42 bookings (the original 15 keep EL-1028 to EL-1042), one Van MOT group, refSeq 1043', () => {
  const state = seedState();
  assert.equal(state.bookings.length, 42);
  assert.deepEqual(state.bookings.slice(0, 15).map((b) => b.ref), Array.from({ length: 15 }, (_, i) => `EL-${1028 + i}`));
  assert.deepEqual(state.bookings.slice(15).map((b) => b.ref).sort(), Array.from({ length: 27 }, (_, i) => `EL-${1001 + i}`), 'the 27 further bookings take EL-1001 to EL-1027');
  assert.equal(new Set(state.bookings.map((b) => b.ref)).size, 42, 'refs are unique');
  assert.deepEqual(state.bookings.map((b) => b.id), Array.from({ length: 42 }, (_, i) => `bk_seed_${String(i + 1).padStart(2, '0')}`));
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
  assert.deepEqual(row(1), ['2026-10-03T08:00', 120, 'done', 'Aoife Magee', 'fault', 75, 75, true, 'card']);
  assert.deepEqual(row(2), ['2026-10-07T13:00', 240, 'done', 'Padraig Quinn', 'eicr', 150, 150, true, 'bank']);
  assert.deepEqual(row(3), ['2026-10-10T08:00', 240, 'done', 'Niamh Gallagher', 'ev', 1364, 1364, true, 'card'], 'an install carries the total of the quote that led to it');
  assert.deepEqual(row(4), ['2026-10-16T10:00', 120, 'done', 'Roisin Maguire', 'sockets', 85, 170, false, null]);
  assert.deepEqual(row(5), ['2026-10-23T08:00', 120, 'done', 'Declan Rafferty', 'sockets', 85, 85, true, 'cash']);
  assert.deepEqual(row(6), ['2026-10-23T10:00', 120, 'done', 'Orla Hegarty', 'fault', 75, 75, false, null]);
  assert.deepEqual(row(7), ['2026-10-29T10:00', 120, 'new', 'Sinead Doherty', 'ev_quote', 0, null, false, null]);
  assert.deepEqual(row(8), ['2026-10-24T10:00', 120, 'confirmed', 'Eoin McCartney', 'ev_quote', 0, null, false, null]);
  assert.deepEqual(row(9), ['2026-10-26T13:00', 240, 'confirmed', 'Padraig Quinn', 'ev', 1934, null, false, null]);
  assert.deepEqual(row(10), ['2026-10-27T08:00', 120, 'confirmed', 'Niamh Gallagher', 'fault', 75, null, false, null]);
  assert.deepEqual(row(11), ['2026-10-27T10:00', 120, 'new', 'Conor Brennan', 'ev_quote', 0, null, false, null]);
  assert.deepEqual(row(12), ['2026-10-27T13:00', 120, 'confirmed', 'Roisin Maguire', 'ev_quote', 0, null, false, null]);
  assert.deepEqual(row(13), ['2026-10-27T15:00', 120, 'confirmed', 'Declan Rafferty', 'sockets', 85, null, false, null]);
  assert.deepEqual(row(14), ['2026-10-29T08:00', 120, 'confirmed', 'Ciaran Boyle', 'ev_quote', 0, null, false, null]);
  assert.deepEqual(row(15), ['2026-10-30T10:00', 120, 'cancelled', 'Bronagh Hughes', 'ev_quote', 0, null, false, null]);
  const s15 = byId(state, 'bk_seed_15');
  assert.equal(s15.cancelledBy, 'customer');
  assert.equal(s15.cancelReason, 'Customer asked');
  const s02 = byId(state, 'bk_seed_02');
  assert.equal(s02.variantId, 'flat');
  assert.equal(s02.variantLabel, 'Flat');
  assert.deepEqual(s02.address, { line1: '8 Millrace Row', postcode: 'BT28 2LN' });
  const s09 = byId(state, 'bk_seed_09');
  assert.equal(s09.variantLabel, '');
  assert.deepEqual(s09.address, { line1: '31 Rockmount Road', postcode: 'BT20 4DZ' });
  const s07 = byId(state, 'bk_seed_07');
  assert.equal(s07.urgent, false, 'the old seeded emergency is an ordinary pending enquiry now');
  assert.deepEqual(s07.emergencyReasons, []);
  assert.equal(s07.answers.timing, 'asap');
  assert.equal(s07.tentative, true, 'the free survey is pencilled in until he confirms it');
  assert.deepEqual(s07.address, { line1: '', postcode: 'BT42 6JN' }, 'the funnel only collects the postcode');
  assert.equal(s07.createdAt, '2026-10-23T20:18', 'created 12 minutes before seeding');
});

test('flags: seenByOwner false for the two new enquiries and the install accepted 6 hours ago; reviews requested on the older done jobs', () => {
  const state = seedState();
  const unseen = [7, 11, 35];
  const reviewed = [1, 2, 3, 4, 38, 39, 40, 41];
  for (const b of state.bookings) {
    const n = Number(b.id.slice(-2));
    assert.equal(b.seenByOwner, !unseen.includes(n), b.id);
    assert.equal(b.reviewRequested, reviewed.includes(n), b.id);
  }
  assert.deepEqual(selectUnseenBookings(state).map((b) => b.id), ['bk_seed_07', 'bk_seed_35', 'bk_seed_11'], 'newest first');
});

test('createdAt rules: two days before for past and today jobs, the earlier of now-5min and three days before for future jobs', () => {
  const state = seedState();
  assert.equal(byId(state, 'bk_seed_01').createdAt, '2026-10-01T09:00');
  assert.equal(byId(state, 'bk_seed_05').createdAt, '2026-10-21T09:00');
  assert.equal(byId(state, 'bk_seed_08').createdAt, '2026-10-21T09:00');
  assert.equal(byId(state, 'bk_seed_09').createdAt, '2026-10-23T09:00');
  assert.equal(byId(state, 'bk_seed_14').createdAt, '2026-10-23T20:25');
  assert.equal(byId(state, 'bk_seed_11').createdAt, '2026-10-22T14:30', 'now - 30 hours: overdue against the 24 hour promise');
  assert.equal(byId(state, 'bk_seed_07').createdAt, '2026-10-23T20:18', 'now - 12 minutes');
  for (const b of state.bookings) {
    assert.ok(b.createdAt <= '2026-10-23T20:30', `${b.id} is not created in the future`);
    assert.equal(b.history[0].event, 'created');
    assert.equal(b.history[0].at, b.createdAt);
  }
});

test('fixture totals at 2026-10-23T20:30', () => {
  const state = seedState();
  assert.equal(state.bookings.length, 42);
  assert.deepEqual(selectNeedsYou(state).map((b) => b.id), ['bk_seed_11', 'bk_seed_34', 'bk_seed_35', 'bk_seed_07'], 'two enquiries and two pencilled installs need you, oldest first');
  assert.deepEqual(selectOwed(state).map((b) => b.id), ['bk_seed_04', 'bk_seed_41', 'bk_seed_42', 'bk_seed_06']);
  assert.equal(selectOwedTotal(state), 170 + 1970 + 1394 + 75);
  const insights = selectInsights(state, '2026-10-23T20:30');
  assert.equal(insights.collectedMonth, 3038);
  assert.equal(insights.collectedMonthCount, 5, 'the free survey visits are not counted');
  assert.equal(insights.owedTotal, 3609);
  assert.equal(insights.owedCount, 4);
  assert.equal(insights.bookedNext14, 8123);
  assert.equal(insights.bookedNext14Count, 12, 'the jobs and installs booked or pencilled in, plus the pencilled-in enquiries, which are free');
  assert.equal(insights.avgJob, 826, 'the free survey visits are not averaged in');
  assert.equal(selectCustomers(state).length, 27);
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

test('Padraig is the repeat landlord: an EICR, the free survey and an EV install at two addresses', () => {
  const state = seedState();
  const padraig = state.bookings.filter((b) => b.customer.name === 'Padraig Quinn');
  assert.equal(padraig.length, 3);
  assert.deepEqual(padraig.map((b) => b.serviceId), ['eicr', 'ev', 'ev_quote']);
  assert.equal(new Set(padraig.map((b) => b.address.line1)).size, 2);
});

test('the diary is EV-led: free quote visits and EV installs are most of it, the other services fill in around them', () => {
  const state = seedState();
  const count = (id) => state.bookings.filter((b) => b.serviceId === id).length;
  assert.equal(count('ev_quote'), 24);
  assert.equal(count('ev'), 11);
  assert.ok(count('ev_quote') + count('ev') > state.bookings.length / 2, 'most bookings are EV');
  assert.ok(state.bookings.filter((b) => b.serviceId === 'ev_quote').every((b) => b.quotedPrice === 0));
  assert.ok(state.bookings.every((b) => b.ref.startsWith('EL-')));
  assert.ok(state.bookings.every((b) => b.urgent === false), 'no emergency is seeded: the emergency path is off by default');
});

test('every EV booking carries the funnel answers (valid values, the postcode matching the address); others carry none', () => {
  const state = seedState();
  for (const b of state.bookings) {
    if (b.serviceId !== 'ev_quote' && b.serviceId !== 'ev') {
      assert.equal(b.answers, undefined, `${b.id} is a phone job`);
      continue;
    }
    assert.ok(b.answers, `${b.id} has answers`);
    assert.equal(b.answers.postcode, b.address.postcode, `${b.id} postcode`);
    for (const step of ENQUIRY_STEPS) assert.notEqual(answerLabel(step.key, b.answers[step.key]), '', `${b.id} ${step.key}`);
    assert.deepEqual(normaliseAnswers(b.answers), b.answers, `${b.id}: already clean`);
  }
  assert.equal(byId(state, 'bk_seed_07').answers.parking, 'driveway');
  assert.equal(byId(state, 'bk_seed_07').answers.vehicle, 'ordered');
  assert.equal(byId(state, 'bk_seed_11').answers.permission, 'unsure');
  assert.equal(byId(state, 'bk_seed_12').answers.permission, 'landlord');
});

test('pencilled-in enquiries: tentative only while pending, website enquiries have no street, confirmed surveys are the owner\'s doing', () => {
  const state = seedState();
  assert.deepEqual(state.bookings.filter((b) => b.tentative).map((b) => b.id), ['bk_seed_07', 'bk_seed_11', 'bk_seed_34', 'bk_seed_35']);
  assert.ok(state.bookings.filter((b) => b.tentative).every((b) => b.status === 'new'));
  assert.ok(state.bookings.filter((b) => b.tentative && b.serviceId === 'ev_quote').every((b) => bookingWindowIds(b).length === 1));
  assert.ok(state.bookings.filter((b) => b.tentative && b.serviceId === 'ev').every((b) => bookingWindowIds(b).length === 2 && b.quoteId), 'a pencilled install is a half day made by an accepted quote');
  for (const id of ['bk_seed_07', 'bk_seed_08', 'bk_seed_11', 'bk_seed_15']) assert.equal(byId(state, id).address.line1, '', `${id} gave only a postcode`);
  assert.equal(byId(state, 'bk_seed_12').address.line1, '6 Ballydoon Mews', 'a WhatsApp enquiry gave an address');
  const s08 = byId(state, 'bk_seed_08');
  assert.deepEqual(s08.history.map((h) => [h.event, h.by]), [['created', 'customer'], ['confirmed', 'owner'], ['message', 'owner']], 'a survey is never auto-confirmed (then the photos request)');
  assert.equal(s08.tentative, undefined);
  assert.equal(byId(state, 'bk_seed_10').history[1].by, 'system', 'other website jobs still confirm themselves');
});

test('the S07 enquiry alert is msg_seed_07_alert and seed message ids follow msg_seed_<NN>_<role>', () => {
  const state = seedState();
  const ids = state.messages.map((m) => m.id);
  assert.ok(ids.includes('msg_seed_07_alert'));
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ids) assert.match(id, /^msg_seed_(0[1-9]|[1-3]\d|4[0-2])_(alert|conf|rem|done|qsent|qacc|qaccc|photos)$/);
  const alert = state.messages.find((m) => m.id === 'msg_seed_07_alert');
  assert.equal(alert.kind, 'owner_new_booking');
  assert.equal(alert.to, 'owner');
  assert.equal(alert.bookingId, 'bk_seed_07');
  assert.equal(alert.at, '2026-10-23T20:18');
  assert.ok(alert.body.startsWith('*New enquiry EL-1034*\nSinead Doherty · 07700 900344\n'));
  assert.ok(alert.body.includes('\nBT42 6JN\nParking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.\n'));
  assert.ok(alert.body.includes('Survey pencilled in: Thu 29 Oct, arriving between 10am and 12 (provisional)'));
  const conf = state.messages.find((m) => m.id === 'msg_seed_07_conf');
  assert.equal(conf.kind, 'customer_received');
  assert.ok(conf.body.includes('Your free survey visit is pencilled in for Thu 29 Oct, 10am–12. This is provisional'));
  assert.ok(conf.body.includes('Daniel will be in touch within 24 hours'));
  assert.ok(!state.messages.some((m) => m.kind === 'owner_emergency' || m.kind === 'customer_emergency_received'), 'no emergency messages are seeded');
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
  assert.deepEqual(kindsOf(8), ['alert', 'conf', 'photos', 'rem']);
  assert.deepEqual(kindsOf(11), ['alert', 'conf'], 'an approval booking has no reminder');
  assert.equal(state.messages.find((m) => m.id === 'msg_seed_11_conf').kind, 'customer_received');
  assert.equal(state.messages.find((m) => m.id === 'msg_seed_05_done').kind, 'customer_completed');
  const rem = state.messages.find((m) => m.id === 'msg_seed_09_rem');
  assert.equal(rem.kind, 'customer_reminder');
  assert.equal(rem.sendAt, '2026-10-25T18:00', '18:00 the evening before Monday 26 Oct');
  assert.ok(state.messages.every((m) => m.seed === true && m.simulated === true && ['whatsapp', 'email'].includes(m.channel)));
  assert.ok(state.messages.every((m) => m.id.startsWith('msg_seed_')));
  assert.match(state.messages.find((m) => m.id === 'msg_seed_11_alert').body, /Outside Northern Ireland \(DG9\)\. Check you can travel before you confirm the survey\./);
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
  assert.ok(state.bookings.length >= 8 && state.bookings.length < 42);
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
    assert.equal(state.bookings.length, 42, `${label}: ${state.bookings.length} bookings`);
    const statuses = new Set(state.bookings.map((b) => b.status));
    for (const s of ['new', 'confirmed', 'done', 'cancelled']) assert.ok(statuses.has(s), `${label}: has ${s}`);
    assert.ok(!statuses.has('on_the_way'), `${label}: on_the_way is not seeded`);
    assert.equal(state.bookings.filter((b) => b.urgent).length, 0, `${label}: no emergency is seeded`);
    assert.deepEqual(state.bookings.filter((b) => b.status === 'new').map((b) => b.id), ['bk_seed_07', 'bk_seed_11', 'bk_seed_34', 'bk_seed_35'], `${label}: two enquiries and two pencilled installs need you`);
    assert.ok(state.bookings.filter((b) => b.status === 'new').every((b) => b.tentative === true && b.answers && b.answers.timing), `${label}: pencilled in, with answers`);
    assert.ok(selectOwed(state).length >= 1, `${label}: an owed job`);
    const padraig = state.bookings.filter((b) => b.customer.name === 'Padraig Quinn' && b.status !== 'cancelled');
    assert.equal(padraig.length, 3, `${label}: Padraig has three jobs`);
    assert.equal(new Set(padraig.map((b) => b.address.line1)).size, 2, `${label}: at two addresses`);
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
  const keys = ['aoife', 'padraig', 'niamh', 'declan', 'orla', 'sinead', 'eoin', 'ciaran', 'roisin', 'conor', 'bronagh'];
  assert.deepEqual(Object.keys(SEED_CUSTOMERS).slice(0, 11), keys, 'the original customers come first');
  assert.equal(Object.keys(SEED_CUSTOMERS).length, 27);
  assert.equal(SEED_CUSTOMERS.aoife.name, 'Aoife Magee');
  assert.equal(SEED_CUSTOMERS.padraig.addresses.length, 2);
  assert.equal(SEED_CUSTOMERS.conor.addresses[0].postcode, 'DG9 8AB');
  assert.equal(postcodeZone('DG9 8AB', makeDefaultSettings().business), 'outside');
  // every other seeded customer lives in Northern Ireland (a BT postcode inside the area)
  for (const [key, c] of Object.entries(SEED_CUSTOMERS)) {
    if (key === 'conor') continue;
    for (const a of c.addresses) assert.equal(postcodeZone(a.postcode, makeDefaultSettings().business), 'covered', `${key} ${a.postcode}`);
  }
  assert.deepEqual(SAMPLE_CUSTOMER, { name: 'Aoife Magee', phone: '07700 900231', email: '', line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' });

  const phones = [...Object.values(SEED_CUSTOMERS).map((c) => c.phone), ...SIM_POOL.map((p) => p.phone)];
  assert.equal(new Set(phones).size, phones.length, 'no phone is used twice');
  for (const phone of phones) assert.match(phone, /^07700 900\d{3}$/, phone);
  for (const c of Object.values(SEED_CUSTOMERS)) {
    const n = Number(c.phone.slice(-3));
    assert.ok(n >= 200 && n <= 499, `${c.phone} is in the seed range (the simulator uses 500 to 507)`);
    assert.match(c.email, /^[a-z.]+@example\.com$/, 'a sample address at example.com');
  }
  assert.equal(SIM_POOL.length, 8);
  assert.deepEqual(SAMPLE_ENQUIRY_ANSWERS, { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' });
  SIM_POOL.forEach((p, i) => {
    assert.deepEqual(normaliseAnswers(p.answers), { ...p.answers }, `pool answers ${i} are valid`);
    assert.equal(Object.keys(p.answers).length, 4, 'all four funnel answers');
    assert.equal(p.phone, `07700 90050${i}`);
    assert.equal(postcodeZone(p.postcode, makeDefaultSettings().business), 'covered', p.postcode);
    assert.equal(typeof p.notes, 'string');
    assert.ok(p.name.length > 3 && p.line1.length > 3);
  });
  assert.ok(new Set(SIM_POOL.map((p) => p.postcode.split(' ')[0])).size >= 6, 'postcodes are spread over at least six BT districts');
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
  assert.deepEqual(byId(state, 'bk_seed_08').history.map((h) => h.event), ['created', 'confirmed', 'message']);
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
  settings.services.find((s) => s.id === 'ev').price = 949;
  settings.services.find((s) => s.id === 'fault').price = 80;
  settings.remindersOn = false;
  const state = seedState(FIXTURE, settings);
  const priced = seedState(FIXTURE, (() => { const t = makeDefaultSettings(); t.quoteItems.find((i) => i.id === 'install_standard').unitPrice = 500; return t; })());
  assert.equal(byId(priced, 'bk_seed_09').quotedPrice, 1984, 'an install carries its quote total, so the edited catalogue price flows in (+50)');
  assert.equal(byId(state, 'bk_seed_10').quotedPrice, 80);
  assert.equal(byId(state, 'bk_seed_08').quotedPrice, 0, 'a free quote visit stays free');
  assert.ok(state.messages.find((m) => m.id === 'msg_seed_08_conf').body.includes("it's Lee from Ashby Sparks"));
  assert.ok(!state.messages.some((m) => m.kind === 'customer_reminder'), 'reminders off means no scheduled reminders');
});
