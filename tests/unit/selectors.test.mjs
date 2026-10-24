// tests/unit/selectors.test.mjs: unit tests for js/core/selectors.js (needs-you, next-up, customers, insights, messages)
// Owner: WP1
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultSettings } from '../../js/core/config.js';
import { setClock, now } from '../../js/core/clock.js';
import { buildSeed } from '../../js/core/seed.js';
import {
  selectBrand, selectServices, selectService, quotedPriceFor, servicePriceLabel, selectBookingById, selectBookingByRef,
  selectBookingsOn, selectNeedsYou, selectNextUp, selectUpcoming, selectOwed, selectOwedTotal, selectUnseenBookings,
  selectNextOpenDay, selectCustomers, selectCustomerByKey, customerKeyOf, selectRepeatInfo, selectMessages,
  selectUnreadMessageCount, selectInsights, isWithinChangeCutoff
} from '../../js/core/selectors.js';

const NOW = '2026-10-23T20:30';

beforeEach(() => setClock(new Date(2026, 9, 23, 20, 30)));
afterEach(() => setClock(null));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

// A mutable fixture state; tests that need it frozen call freeze(). Selectors must never mutate it.
function fixture() {
  const settings = makeDefaultSettings();
  const seed = buildSeed(now(), settings);
  const top = seed.messages.length;
  return { v: 1, seededFor: '2026-10-23', refSeq: seed.refSeq, settings, bookings: seed.bookings, blocks: seed.blocks, messages: seed.messages, meta: { rev: 1, msgSeq: top, messagesSeenSeq: top, simCursor: 0 } };
}
const frozen = () => deepFreeze(fixture());
const ids = (list) => list.map((b) => b.id);

function booking(over = {}) {
  return {
    id: 'bk_new1', ref: 'VM-1043', createdAt: NOW, serviceId: 'fault', serviceName: 'Fault finding and repairs', variantId: null, variantLabel: '',
    start: '2026-10-26T08:00', durationMin: 120, status: 'confirmed', urgent: false, emergencyReasons: [], etaMinutes: null, etaAt: null,
    customer: { name: 'Priya Nair', phone: '07700 900231', email: '' }, address: { line1: '14 Alder Row', postcode: 'MB3 4QP' },
    notes: '', internalNotes: '', source: 'website', quotedPrice: 75, finalPrice: null, paid: false, paidMethod: null, paidAt: null,
    seenByOwner: false, reviewRequested: false, cancelledBy: null, cancelReason: '', seed: false, history: [], ...over
  };
}

test('selectors accept a deeply frozen state and never mutate it', () => {
  const state = frozen();
  const before = JSON.stringify(state);
  selectBrand(state);
  selectServices(state);
  selectNeedsYou(state);
  selectNextUp(state, NOW);
  selectUpcoming(state, NOW);
  selectOwed(state);
  selectOwedTotal(state);
  selectUnseenBookings(state);
  selectNextOpenDay(state, '2026-10-23');
  selectCustomers(state);
  selectMessages(state);
  selectUnreadMessageCount(state);
  selectInsights(state, NOW);
  selectBookingsOn(state, '2026-10-27');
  assert.equal(JSON.stringify(state), before);
});

test('selectBrand carries every field the UI reads', () => {
  const state = frozen();
  const brand = selectBrand(state);
  assert.deepEqual(Object.keys(brand).sort(), [
    'areaName', 'areaText', 'coveredOutward', 'demoPhoneDigits', 'descriptor', 'edgeOutward', 'email', 'hoursText', 'insuranceLine', 'name',
    'ownerFirst', 'ownerFull', 'phone', 'phoneDigits', 'schemeLine', 'shortName', 'tagline', 'telHref', 'towns'
  ]);
  assert.equal(brand.name, 'Voltmere Electrical');
  assert.equal(brand.shortName, 'Voltmere');
  assert.equal(brand.ownerFirst, 'Dan');
  assert.equal(brand.ownerFull, 'Dan Mercer');
  assert.equal(brand.phone, '07700 900412');
  assert.equal(brand.phoneDigits, '447700900412');
  assert.equal(brand.telHref, 'tel:+447700900412');
  assert.equal(brand.hoursText, 'Mon to Fri 8am to 5pm, Sat 8am to 12pm');
  assert.equal(brand.demoPhoneDigits, '');
  assert.equal(brand.coveredOutward.length, 10);
  assert.deepEqual(brand.edgeOutward, ['MB11', 'MB12', 'MB13']);
  assert.equal(selectBrand(state), brand, 'the same state gives the same object');
  const rebrand = fixture();
  rebrand.settings.business.name = 'Ashby Sparks';
  rebrand.settings.demoPhoneDigits = '447700900555';
  assert.equal(selectBrand(rebrand).name, 'Ashby Sparks');
  assert.equal(selectBrand(rebrand).demoPhoneDigits, '447700900555');
});

test('services: order, activeOnly, lookup, quoted price and price labels', () => {
  const state = fixture();
  assert.deepEqual(selectServices(state).map((s) => s.id), ['fault', 'eicr', 'consumer', 'sockets', 'ev', 'rewire', 'emergency']);
  state.settings.services.find((s) => s.id === 'ev').active = false;
  assert.ok(!selectServices(state).some((s) => s.id === 'ev'));
  assert.ok(selectServices(state, { activeOnly: false }).some((s) => s.id === 'ev'));
  assert.equal(selectService(state, 'eicr').name, 'EICR safety report');
  assert.equal(selectService(state, 'nope'), null);
  const eicr = selectService(state, 'eicr');
  assert.equal(quotedPriceFor(eicr, 'flat'), 150);
  assert.equal(quotedPriceFor(eicr, 'house'), 195);
  assert.equal(quotedPriceFor(eicr, 'large'), 260);
  assert.equal(quotedPriceFor(eicr, 'bogus'), 150, 'unknown variant falls back to the headline price');
  assert.equal(quotedPriceFor(eicr), 150);
  assert.equal(quotedPriceFor(selectService(state, 'fault'), null), 75);
  assert.equal(servicePriceLabel(selectService(state, 'fault')), 'From £75');
  assert.equal(servicePriceLabel(eicr), 'From £150');
  assert.equal(servicePriceLabel(selectService(state, 'rewire')), 'Free');
  assert.equal(servicePriceLabel(selectService(state, 'emergency')), 'From £95');
  assert.equal(servicePriceLabel({ priceType: 'fixed', price: 120 }), '£120');
});

test('booking lookups by id and ref (case-insensitive) and by day', () => {
  const state = frozen();
  assert.equal(selectBookingById(state, 'bk_seed_08').ref, 'VM-1035');
  assert.equal(selectBookingById(state, 'nope'), null);
  assert.equal(selectBookingByRef(state, 'VM-1035').id, 'bk_seed_08');
  assert.equal(selectBookingByRef(state, 'vm-1035').id, 'bk_seed_08');
  assert.equal(selectBookingByRef(state, ' vm-1035 ').id, 'bk_seed_08');
  assert.equal(selectBookingByRef(state, 'NOPE-0'), null);
  // Tuesday: four jobs by start; the cancelled Friday job only with includeCancelled
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-27')), ['bk_seed_10', 'bk_seed_11', 'bk_seed_12', 'bk_seed_13']);
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-30')), []);
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-30', { includeCancelled: true })), ['bk_seed_15']);
  // today: two done jobs in window order, then the emergency request (start = request time)
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-23')), ['bk_seed_05', 'bk_seed_06', 'bk_seed_07']);
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-22')), []);
});

test('selectNeedsYou: urgent first, then oldest first', () => {
  const state = fixture();
  assert.deepEqual(ids(selectNeedsYou(state)), ['bk_seed_07', 'bk_seed_11']);
  state.bookings.push(booking({ id: 'bk_urgent2', urgent: true, status: 'new', createdAt: '2026-10-23T20:30', durationMin: 0, start: NOW }));
  state.bookings.push(booking({ id: 'bk_early', status: 'new', createdAt: '2026-10-22T08:00' }));
  assert.deepEqual(ids(selectNeedsYou(state)), ['bk_seed_07', 'bk_urgent2', 'bk_early', 'bk_seed_11']);
});

test('selectNextUp: on_the_way, then an accepted emergency, then the earliest confirmed job not over', () => {
  const state = fixture();
  assert.equal(selectNextUp(state, NOW).id, 'bk_seed_08', 'Hannah, Sat 24 Oct');
  // a confirmed job whose window has ended is skipped
  const early = fixture();
  early.bookings.find((b) => b.id === 'bk_seed_05').status = 'confirmed';
  assert.equal(selectNextUp(early, NOW).id, 'bk_seed_08');
  assert.equal(selectNextUp(early, '2026-10-23T09:00').id, 'bk_seed_05', 'still running at 09:00');
  assert.equal(selectNextUp(early, '2026-10-23T10:00').id, 'bk_seed_08', 'ends exactly at 10:00 so it is over');
  // an accepted emergency beats a confirmed job
  const urgent = fixture();
  const s07 = urgent.bookings.find((b) => b.id === 'bk_seed_07');
  s07.status = 'confirmed';
  assert.equal(selectNextUp(urgent, NOW).id, 'bk_seed_07');
  // on the way beats everything
  urgent.bookings.find((b) => b.id === 'bk_seed_14').status = 'on_the_way';
  assert.equal(selectNextUp(urgent, NOW).id, 'bk_seed_14');
  // nothing left
  const empty = fixture();
  empty.bookings = empty.bookings.filter((b) => b.status === 'done' || b.status === 'cancelled');
  assert.equal(selectNextUp(empty, NOW), null);
});

test('selectUpcoming: live jobs that are urgent or not over, by start', () => {
  const state = frozen();
  const upcoming = selectUpcoming(state, NOW);
  assert.deepEqual(ids(upcoming), ['bk_seed_07', 'bk_seed_08', 'bk_seed_09', 'bk_seed_10', 'bk_seed_11', 'bk_seed_12', 'bk_seed_13', 'bk_seed_14']);
  assert.ok(upcoming.every((b) => ['new', 'confirmed', 'on_the_way'].includes(b.status)));
  // a job whose window ended at exactly now is still upcoming (>=)
  const edge = fixture();
  edge.bookings.find((b) => b.id === 'bk_seed_05').status = 'confirmed';
  assert.ok(ids(selectUpcoming(edge, '2026-10-23T10:00')).includes('bk_seed_05'));
  assert.ok(!ids(selectUpcoming(edge, '2026-10-23T10:01')).includes('bk_seed_05'));
});

test('selectOwed and selectOwedTotal', () => {
  const state = frozen();
  assert.deepEqual(ids(selectOwed(state)), ['bk_seed_04', 'bk_seed_06']);
  assert.equal(selectOwedTotal(state), 245);
  assert.equal(selectOwedTotal({ bookings: [] }), 0);
});

test('selectUnseenBookings: newest first', () => {
  assert.deepEqual(ids(selectUnseenBookings(frozen())), ['bk_seed_07', 'bk_seed_11']);
  const state = fixture();
  state.bookings.push(booking({ id: 'bk_a', createdAt: NOW }));
  state.bookings.push(booking({ id: 'bk_b', createdAt: NOW }));
  assert.deepEqual(ids(selectUnseenBookings(state)).slice(0, 2), ['bk_b', 'bk_a'], 'equal minute: the one added last is newest');
});

test('selectNextOpenDay skips closed weekdays and days off, and gives up when nothing is open', () => {
  const state = fixture();
  assert.equal(selectNextOpenDay(state, '2026-10-23'), '2026-10-24');
  assert.equal(selectNextOpenDay(state, '2026-10-24'), '2026-10-26');
  assert.equal(selectNextOpenDay(state, '2026-10-25'), '2026-10-26');
  state.settings.daysOff.push({ id: 'off_1', date: '2026-10-26', label: 'Day off' });
  assert.equal(selectNextOpenDay(state, '2026-10-24'), '2026-10-27');
  state.settings.hours = [[], [], [], [], [], [], []];
  assert.equal(selectNextOpenDay(state, '2026-10-23'), null);
});

test('selectCustomers derives 11 customers from the bookings, never stored', () => {
  const state = frozen();
  const customers = selectCustomers(state);
  assert.equal(customers.length, 11);
  assert.ok(!('customers' in state));
  const marcus = customers.find((c) => c.key === '447700900262');
  assert.equal(marcus.name, 'Marcus Tate');
  assert.equal(marcus.phone, '07700 900262');
  assert.equal(marcus.jobs, 2);
  assert.equal(marcus.cancelled, 0);
  assert.deepEqual(marcus.tags, ['Landlord', 'Repeat']);
  assert.equal(marcus.addresses.length, 2);
  assert.deepEqual(marcus.addresses[0], { line1: '31 Hollin Road', postcode: 'MB6 7DZ' }, 'newest address first');
  assert.deepEqual(marcus.bookingIds, ['bk_seed_09', 'bk_seed_02'], 'newest first');
  assert.equal(marcus.totalValue, 150);
  assert.equal(marcus.owed, 0);
  assert.equal(marcus.lastJobAt, '2026-10-07T13:00');
  assert.equal(marcus.nextJobAt, '2026-10-26T13:00');

  const ruth = customers.find((c) => c.name === 'Ruth Calder');
  assert.equal(ruth.owed, 170);
  assert.equal(ruth.totalValue, 170);
  assert.equal(ruth.jobs, 2);
  assert.deepEqual(ruth.tags, ['Repeat']);

  const lena = customers.find((c) => c.name === 'Lena Kowalski');
  assert.equal(lena.jobs, 0);
  assert.equal(lena.cancelled, 1);
  assert.equal(lena.lastJobAt, null);
  assert.equal(lena.nextJobAt, null);
  assert.deepEqual(lena.tags, []);

  const priya = customers.find((c) => c.name === 'Priya Nair');
  assert.deepEqual(priya.tags, [], 'one job is not a repeat customer');
  assert.equal(priya.totalValue, 75);
  const eileen = customers.find((c) => c.name === 'Eileen Doyle');
  assert.equal(eileen.owed, 75);

  // order: the later of nextJobAt and lastJobAt, newest first; a customer with neither is last
  assert.equal(customers[0].name, 'Kwame Mensah');
  assert.equal(customers[customers.length - 1].name, 'Lena Kowalski');
  const recency = (c) => ((c.nextJobAt || '') > (c.lastJobAt || '') ? c.nextJobAt || '' : c.lastJobAt || '');
  for (let i = 1; i < customers.length; i += 1) assert.ok(recency(customers[i - 1]) >= recency(customers[i]), `order at ${i}`);
});

test('customers: the identity is the phone number, whatever its spelling, and tags follow the rules', () => {
  const state = fixture();
  state.bookings.push(booking({ id: 'bk_p2', createdAt: NOW, customer: { name: 'Priya N.', phone: '+44 7700 900231', email: 'priya@home.example' } }));
  const customers = selectCustomers(state);
  assert.equal(customers.length, 11, 'same phone, same customer');
  const priya = selectCustomerByKey(state, '447700900231');
  assert.equal(priya.name, 'Priya N.', 'name from the most recent booking');
  assert.equal(priya.email, 'priya@home.example');
  assert.deepEqual(priya.tags, ['Repeat']);
  assert.equal(priya.jobs, 2);
  assert.equal(selectCustomerByKey(state, 'nope'), null);
  assert.equal(customerKeyOf('07700 900231'), '447700900231');
  assert.equal(customerKeyOf('+44 7700 900231'), '447700900231');
  // Landlord by phone note
  state.bookings.push(booking({ id: 'bk_l1', source: 'phone', notes: 'Landlord of the flat above', customer: { name: 'Jo Banks', phone: '07700 900370', email: '' } }));
  assert.deepEqual(selectCustomerByKey(state, '447700900370').tags, ['Landlord'], 'a phone booking whose note says landlord');
  state.bookings.find((b) => b.id === 'bk_l1').notes = 'LANDLORD, flat above';
  assert.deepEqual(selectCustomerByKey(state, '447700900370').tags, ['Landlord'], 'case-insensitive');
  state.bookings.find((b) => b.id === 'bk_l1').notes = 'Flat above the shop';
  assert.deepEqual(selectCustomerByKey(state, '447700900370').tags, []);
  state.bookings.find((b) => b.id === 'bk_l1').notes = 'landlord';
  // a website booking with the same note is not enough
  state.bookings.find((b) => b.id === 'bk_l1').source = 'website';
  assert.deepEqual(selectCustomerByKey(state, '447700900370').tags, []);
  // one EICR address is not a landlord; a cancelled EICR does not count
  const m = fixture();
  m.bookings.find((b) => b.id === 'bk_seed_09').status = 'cancelled';
  assert.deepEqual(selectCustomerByKey(m, '447700900262').tags, ['Landlord'], 'the seed note on his phone booking still says landlord');
  m.bookings.find((b) => b.id === 'bk_seed_02').notes = '';
  m.bookings.find((b) => b.id === 'bk_seed_09').notes = '';
  assert.deepEqual(selectCustomerByKey(m, '447700900262').tags, [], 'one live EICR and one cancelled, no landlord note');
  assert.equal(selectCustomerByKey(m, '447700900262').cancelled, 1);
});

test('selectRepeatInfo: nth is the position among non-cancelled bookings by createdAt', () => {
  const state = fixture();
  const priyaFirst = selectBookingById(state, 'bk_seed_01');
  assert.deepEqual(selectRepeatInfo(state, priyaFirst), { isRepeat: false, nth: 1 });
  const second = booking({ id: 'bk_p2', createdAt: NOW });
  state.bookings.push(second);
  assert.deepEqual(selectRepeatInfo(state, second), { isRepeat: true, nth: 2 });
  assert.deepEqual(selectRepeatInfo(state, priyaFirst), { isRepeat: false, nth: 1 });
  const third = booking({ id: 'bk_p3', createdAt: NOW });
  state.bookings.push(third);
  assert.equal(selectRepeatInfo(state, third).nth, 3, 'equal createdAt: insertion order decides');
  assert.equal(selectRepeatInfo(state, second).nth, 2);
  // cancelled bookings do not count
  state.bookings.find((b) => b.id === 'bk_seed_01').status = 'cancelled';
  assert.equal(selectRepeatInfo(state, second).nth, 1);
  // Marcus's second EICR
  const fresh = fixture();
  assert.deepEqual(selectRepeatInfo(fresh, selectBookingById(fresh, 'bk_seed_09')), { isRepeat: true, nth: 2 });
});

test('selectMessages: newest first by at then seq, and the filters', () => {
  const state = fixture();
  const all = selectMessages(state);
  assert.equal(all.length, state.messages.length);
  for (let i = 1; i < all.length; i += 1) {
    const a = all[i - 1];
    const b = all[i];
    assert.ok(a.at > b.at || (a.at === b.at && a.seq > b.seq), `order at ${i}`);
  }
  assert.ok(selectMessages(state, { to: 'owner' }).every((m) => m.to === 'owner'));
  assert.ok(selectMessages(state, { to: 'customer' }).every((m) => m.to === 'customer'));
  assert.deepEqual(selectMessages(state, { bookingId: 'bk_seed_07' }).map((m) => m.id), ['msg_seed_07_conf', 'msg_seed_07_alert']);
  const scheduled = selectMessages(state, { scheduledOnly: true, nowStamp: NOW });
  assert.ok(scheduled.length > 0);
  assert.ok(scheduled.every((m) => m.kind === 'customer_reminder' && m.sendAt > NOW));
  assert.ok(selectMessages(state, { scheduledOnly: true, nowStamp: '2099-01-01T00:00' }).length === 0);
  assert.equal(state.messages.length, JSON.parse(JSON.stringify(state.messages)).length, 'the stored order is not changed');
  // same minute: higher seq first
  state.messages.push({ id: 'm1', at: NOW, seq: 100, to: 'owner', bookingId: 'x', sendAt: null, kind: 'owner_new_booking', seed: false });
  state.messages.push({ id: 'm2', at: NOW, seq: 101, to: 'owner', bookingId: 'x', sendAt: null, kind: 'owner_new_booking', seed: false });
  assert.deepEqual(selectMessages(state, { bookingId: 'x' }).map((m) => m.id), ['m2', 'm1']);
});

test('selectUnreadMessageCount: non-seed owner messages with seq above messagesSeenSeq, even in the same minute', () => {
  const state = fixture();
  assert.equal(selectUnreadMessageCount(state), 0, 'seed alerts are already seen');
  const top = state.meta.msgSeq;
  state.messages.push({ id: 'm_cust', at: NOW, seq: top + 1, to: 'customer', bookingId: 'x', sendAt: null, kind: 'customer_confirmed', seed: false });
  assert.equal(selectUnreadMessageCount(state), 0, 'customer messages are never unread');
  state.messages.push({ id: 'm_owner', at: NOW, seq: top + 2, to: 'owner', bookingId: 'x', sendAt: null, kind: 'owner_new_booking', seed: false });
  state.meta.msgSeq = top + 2;
  assert.equal(selectUnreadMessageCount(state), 1);
  // the owner opens Messages: markMessagesSeen sets messagesSeenSeq = msgSeq
  state.meta.messagesSeenSeq = state.meta.msgSeq;
  assert.equal(selectUnreadMessageCount(state), 0);
  // a message created in the SAME minute (equal `at`) afterwards still counts
  state.messages.push({ id: 'm_owner2', at: NOW, seq: top + 3, to: 'owner', bookingId: 'y', sendAt: null, kind: 'owner_emergency', seed: false });
  state.meta.msgSeq = top + 3;
  assert.equal(selectUnreadMessageCount(state), 1);
  // a seed message above the mark never counts
  state.messages.push({ id: 'm_seed', at: NOW, seq: top + 4, to: 'owner', bookingId: 'z', sendAt: null, kind: 'owner_new_booking', seed: true });
  assert.equal(selectUnreadMessageCount(state), 1);
});

test('selectInsights at the fixture clock', () => {
  const state = frozen();
  const ins = selectInsights(state, NOW);
  assert.equal(ins.collectedMonth, 850);
  assert.equal(ins.collectedMonthCount, 4);
  assert.equal(ins.owedTotal, 245);
  assert.equal(ins.owedCount, 2);
  assert.equal(ins.bookedNext14, 675);
  assert.equal(ins.bookedNext14Count, 7);
  assert.equal(ins.avgJob, 183);
  assert.equal(ins.weeks.length, 6);
  assert.deepEqual(ins.weeks.map((w) => w.weekStart), ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
  assert.deepEqual(ins.weeks.map((w) => w.label), ['Mon 14 Sep', 'Mon 21 Sep', 'Mon 28 Sep', 'Mon 5 Oct', 'Mon 12 Oct', 'Mon 19 Oct']);
  assert.deepEqual(ins.weeks.map((w) => w.total), [0, 0, 75, 690, 0, 85], 'paid jobs by paidAt week (Wed 7 Oct and Sat 10 Oct share a week)');
  assert.deepEqual(ins.byService, [
    { serviceId: 'consumer', name: 'New fuse box (consumer unit)', jobs: 1, total: 540 },
    { serviceId: 'sockets', name: 'Sockets, switches and lights', jobs: 2, total: 255 },
    { serviceId: 'eicr', name: 'EICR safety report', jobs: 1, total: 150 },
    { serviceId: 'fault', name: 'Fault finding and repairs', jobs: 2, total: 150 }
  ]);
});

test('selectInsights definitions: this month only, the 14-day window, the 30-day average and urgent exclusion', () => {
  const state = fixture();
  // a job paid last month does not count as collected this month
  state.bookings.find((b) => b.id === 'bk_seed_01').paidAt = '2026-09-30T18:00';
  assert.equal(selectInsights(state, NOW).collectedMonth, 775);
  assert.equal(selectInsights(state, NOW).collectedMonthCount, 3);
  // the next-14 window is today .. today + 13
  state.bookings.push(booking({ id: 'bk_edge13', start: '2026-11-05T08:00', quotedPrice: 100 }));
  state.bookings.push(booking({ id: 'bk_edge14', start: '2026-11-06T08:00', quotedPrice: 1000 }));
  assert.equal(selectInsights(state, NOW).bookedNext14, 775);
  assert.equal(selectInsights(state, NOW).bookedNext14Count, 8);
  // urgent bookings are not "booked work"
  state.bookings.push(booking({ id: 'bk_urg', urgent: true, status: 'new', start: NOW, quotedPrice: 95 }));
  assert.equal(selectInsights(state, NOW).bookedNext14Count, 8);
  // the 30-day average uses done jobs started within the last 30 days
  state.bookings.push(booking({ id: 'bk_old', status: 'done', start: '2026-09-01T08:00', finalPrice: 9000, paid: true, paidMethod: 'cash', paidAt: '2026-09-01T10:00' }));
  assert.equal(selectInsights(state, NOW).avgJob, 183);
  // no done jobs: an average of 0, never NaN
  const none = fixture();
  none.bookings = none.bookings.filter((b) => b.status !== 'done');
  const ins = selectInsights(none, NOW);
  assert.equal(ins.avgJob, 0);
  assert.equal(ins.collectedMonth, 0);
  assert.deepEqual(ins.byService, []);
});

test('selectInsights reads the same at 09:00 as at 20:30 for finished history', () => {
  const state = fixture();
  assert.equal(selectInsights(state, '2026-10-23T09:00').owedCount, 2);
  assert.equal(selectInsights(state, '2026-11-02T09:00').collectedMonth, 0, 'a new month starts at zero');
});

test('isWithinChangeCutoff: less than 24 hours ahead, including a start already in the past', () => {
  const b = (start, extra = {}) => booking({ start, ...extra });
  assert.equal(isWithinChangeCutoff(b('2026-10-26T08:00'), NOW), false);
  assert.equal(isWithinChangeCutoff(b('2026-10-24T20:31'), NOW), false, 'a minute over 24 hours');
  assert.equal(isWithinChangeCutoff(b('2026-10-24T20:30'), NOW), false, 'exactly 24 hours is not less than 24 hours');
  assert.equal(isWithinChangeCutoff(b('2026-10-24T20:29'), NOW), true);
  assert.equal(isWithinChangeCutoff(b('2026-10-24T08:00'), NOW), true);
  assert.equal(isWithinChangeCutoff(b('2026-10-23T20:30'), NOW), true, 'an urgent request is made now');
  assert.equal(isWithinChangeCutoff(b('2026-10-20T08:00'), NOW), true, 'a start in the past');
});
