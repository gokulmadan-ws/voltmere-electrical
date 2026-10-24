// tests/unit/selectors.test.mjs: unit tests for js/core/selectors.js (needs-you, next-up, customers, insights, messages)
// Owner: WP1 (v1), A3 (v3 updates: the v3 seed numbers, free survey visits, brand address and images)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, makeDefaultSettings } from '../../js/core/config.js';
import { setClock, now } from '../../js/core/clock.js';
import { buildSeed } from '../../js/core/seed.js';
import {
  selectBrand, selectServices, selectService, quotedPriceFor, servicePriceLabel, selectBookingById, selectBookingByRef,
  selectBookingsOn, selectNeedsYou, selectNextUp, selectUpcoming, selectOwed, selectOwedTotal, selectUnseenBookings,
  selectNextOpenDay, selectCustomers, selectCustomerByKey, customerKeyOf, selectRepeatInfo, selectMessages,
  selectUnreadMessageCount, selectInsights, isWithinChangeCutoff, selectWebsiteServices, enquiryAnswerRows, bookingAreaFlag, isFreeVisit
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
  settings.marketing.adSpend = seed.adSpend;
  return { v: SCHEMA_VERSION, seededFor: '2026-10-23', refSeq: seed.refSeq, settings, bookings: seed.bookings, blocks: seed.blocks, messages: seed.messages, quotes: seed.quotes, meta: { rev: 1, msgSeq: top, messagesSeenSeq: top, simCursor: 0 } };
}
const frozen = () => deepFreeze(fixture());
const ids = (list) => list.map((b) => b.id);

function booking(over = {}) {
  return {
    id: 'bk_new1', ref: 'EL-1043', createdAt: NOW, serviceId: 'fault', serviceName: 'Fault finding and repairs', variantId: null, variantLabel: '',
    start: '2026-10-26T08:00', durationMin: 120, status: 'confirmed', urgent: false, emergencyReasons: [], etaMinutes: null, etaAt: null,
    customer: { name: 'Aoife Magee', phone: '07700 900231', email: '' }, address: { line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' },
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
    'address', 'areaName', 'areaText', 'brands', 'coveredOutward', 'credentials', 'demoPhoneDigits', 'descriptor', 'edgeOutward', 'email', 'hoursText',
    'images', 'insuranceLine', 'name', 'ownerFirst', 'ownerFull', 'phone', 'phoneDigits', 'schemeLine', 'shortName', 'tagline', 'telHref', 'towns'
  ]);
  assert.equal(brand.address, '', 'his site gives no street address, so none is invented');
  assert.deepEqual(Object.keys(brand.images), ['logo', 'hero', 'about', 'work1', 'work2', 'work3', 'work4']);
  assert.deepEqual(brand.credentials, ['Level 3 Electrical Installation', '2391 Inspection and Testing']);
  assert.deepEqual(brand.brands, ['ZAPPI', 'OHME', 'SYNC']);
  assert.equal(brand.schemeLine, '', 'his site makes no scheme claim, so none is invented');
  assert.equal(brand.insuranceLine, '');
  assert.equal(brand.name, '180 Electrical');
  assert.equal(brand.shortName, '180');
  assert.equal(brand.ownerFirst, 'Daniel');
  assert.equal(brand.ownerFull, 'Daniel');
  assert.equal(brand.phone, '07885 496800');
  assert.equal(brand.phoneDigits, '447885496800');
  assert.equal(brand.telHref, 'tel:+447885496800');
  assert.equal(brand.hoursText, 'Mon to Fri 8am to 5pm, Sat 8am to 12pm');
  assert.equal(brand.demoPhoneDigits, '');
  assert.equal(brand.coveredOutward.length, 94);
  assert.deepEqual(brand.coveredOutward.slice(0, 3), ['BT1', 'BT2', 'BT3']);
  assert.ok(brand.coveredOutward.includes('BT48') && brand.coveredOutward.includes('BT94'));
  assert.deepEqual(brand.edgeOutward, []);
  assert.equal(brand.areaName, 'Northern Ireland');
  assert.equal(brand.areaText, 'Serving Northern Ireland');
  assert.equal(brand.tagline, 'Home EV charger installation across Northern Ireland.');
  assert.equal(brand.email, 'daniel@180electrical.co.uk');
  assert.equal(selectBrand(state), brand, 'the same state gives the same object');
  const rebrand = fixture();
  rebrand.settings.business.name = 'Ashby Sparks';
  rebrand.settings.demoPhoneDigits = '447700900555';
  assert.equal(selectBrand(rebrand).name, 'Ashby Sparks');
  assert.equal(selectBrand(rebrand).demoPhoneDigits, '447700900555');
});

test('services: order, activeOnly, lookup, quoted price and price labels', () => {
  const state = fixture();
  assert.deepEqual(selectServices(state).map((s) => s.id), ['ev_quote', 'ev', 'fault', 'eicr', 'consumer', 'sockets', 'rewire', 'emergency']);
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
  assert.equal(servicePriceLabel(selectService(state, 'ev_quote')), 'Free');
  assert.equal(servicePriceLabel(selectService(state, 'ev')), 'Quoted for your home', 'quote-led: no number is shown');
  assert.equal(servicePriceLabel({ priceType: 'quoted', price: 899 }), 'Quoted for your home');
  assert.equal(selectService(state, 'ev').name, 'EV charger installation');
  assert.equal(selectService(state, 'ev_quote').name, 'Home EV charger quote');
  assert.equal(selectService(state, 'ev_quote').blocks, 1);
  assert.equal(selectService(state, 'ev').blocks, 2);
  assert.equal(servicePriceLabel(selectService(state, 'emergency')), 'From £95');
  assert.equal(servicePriceLabel({ priceType: 'fixed', price: 120 }), '£120');
});

test('booking lookups by id and ref (case-insensitive) and by day', () => {
  const state = frozen();
  assert.equal(selectBookingById(state, 'bk_seed_08').ref, 'EL-1035');
  assert.equal(selectBookingById(state, 'nope'), null);
  assert.equal(selectBookingByRef(state, 'EL-1035').id, 'bk_seed_08');
  assert.equal(selectBookingByRef(state, 'el-1035').id, 'bk_seed_08');
  assert.equal(selectBookingByRef(state, ' el-1035 ').id, 'bk_seed_08');
  assert.equal(selectBookingByRef(state, 'NOPE-0'), null);
  // Tuesday: four jobs by start; the cancelled Friday job only with includeCancelled
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-27')), ['bk_seed_10', 'bk_seed_11', 'bk_seed_12', 'bk_seed_13']);
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-30')), []);
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-30', { includeCancelled: true })), ['bk_seed_15']);
  // today: two done jobs in window order
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-23')), ['bk_seed_05', 'bk_seed_06']);
  // Thursday: the confirmed 8am survey, then the pencilled-in enquiry (S07) at 10am
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-29')), ['bk_seed_14', 'bk_seed_07']);
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-25')), [], 'a Sunday');
  assert.deepEqual(ids(selectBookingsOn(state, '2026-10-22')), ['bk_seed_16'], 'a finished free survey visit');
});

test('selectNeedsYou: urgent first, then oldest first (two enquiries and two pencilled installs, oldest first)', () => {
  const state = fixture();
  assert.deepEqual(ids(selectNeedsYou(state)), ['bk_seed_11', 'bk_seed_34', 'bk_seed_35', 'bk_seed_07'], 'Conor made his enquiry 30 hours ago, Sinead 12 minutes');
  state.bookings.push(booking({ id: 'bk_urgent2', urgent: true, status: 'new', createdAt: '2026-10-23T20:30', durationMin: 0, start: NOW }));
  state.bookings.push(booking({ id: 'bk_early', status: 'new', createdAt: '2026-10-22T08:00' }));
  assert.deepEqual(ids(selectNeedsYou(state)), ['bk_urgent2', 'bk_early', 'bk_seed_11', 'bk_seed_34', 'bk_seed_35', 'bk_seed_07']);
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
  urgent.bookings.push(booking({ id: 'bk_urgent_ok', urgent: true, status: 'confirmed', durationMin: 0, start: NOW, createdAt: NOW }));
  assert.equal(selectNextUp(urgent, NOW).id, 'bk_urgent_ok');
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
  assert.deepEqual(ids(upcoming), ['bk_seed_08', 'bk_seed_09', 'bk_seed_10', 'bk_seed_11', 'bk_seed_12', 'bk_seed_13', 'bk_seed_14', 'bk_seed_07', 'bk_seed_34', 'bk_seed_36', 'bk_seed_35', 'bk_seed_37']);
  assert.ok(upcoming.every((b) => ['new', 'confirmed', 'on_the_way'].includes(b.status)));
  // a job whose window ended at exactly now is still upcoming (>=)
  const edge = fixture();
  edge.bookings.find((b) => b.id === 'bk_seed_05').status = 'confirmed';
  assert.ok(ids(selectUpcoming(edge, '2026-10-23T10:00')).includes('bk_seed_05'));
  assert.ok(!ids(selectUpcoming(edge, '2026-10-23T10:01')).includes('bk_seed_05'));
});

test('selectOwed and selectOwedTotal', () => {
  const state = frozen();
  assert.deepEqual(ids(selectOwed(state)), ['bk_seed_04', 'bk_seed_41', 'bk_seed_42', 'bk_seed_06']);
  assert.equal(selectOwedTotal(state), 3609);
  assert.equal(selectOwedTotal({ bookings: [] }), 0);
  // a free survey visit (an enquiry completed at £0) is never owed
  const free = fixture();
  free.bookings.find((b) => b.id === 'bk_seed_16').paid = false;
  assert.ok(!ids(selectOwed(free)).includes('bk_seed_16'), 'bk_seed_16 is a done free survey with nothing to collect');
  assert.equal(selectOwedTotal(free), 3609);
});

test('selectUnseenBookings: newest first', () => {
  assert.deepEqual(ids(selectUnseenBookings(frozen())), ['bk_seed_07', 'bk_seed_35', 'bk_seed_11']);
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

test('selectCustomers derives 27 customers from the bookings, never stored', () => {
  const state = frozen();
  const customers = selectCustomers(state);
  assert.equal(customers.length, 27);
  assert.ok(!('customers' in state));
  const marcus = customers.find((c) => c.key === '447700900262');
  assert.equal(marcus.name, 'Padraig Quinn');
  assert.equal(marcus.phone, '07700 900262');
  assert.equal(marcus.jobs, 3, 'the safety report, the free survey and the install');
  assert.equal(marcus.cancelled, 0);
  assert.deepEqual(marcus.tags, ['Landlord', 'Repeat']);
  assert.equal(marcus.addresses.length, 2);
  assert.deepEqual(marcus.addresses[0], { line1: '31 Rockmount Road', postcode: 'BT20 4DZ' }, 'newest address first');
  assert.deepEqual(marcus.bookingIds, ['bk_seed_09', 'bk_seed_25', 'bk_seed_02'], 'newest first');
  assert.equal(marcus.totalValue, 150, 'the free survey is worth nothing');
  assert.equal(marcus.owed, 0);
  assert.equal(marcus.lastJobAt, '2026-10-13T08:00', 'the survey visit was the latest finished job');
  assert.equal(marcus.nextJobAt, '2026-10-26T13:00');

  const ruth = customers.find((c) => c.name === 'Roisin Maguire');
  assert.equal(ruth.owed, 170);
  assert.equal(ruth.totalValue, 170);
  assert.equal(ruth.jobs, 2);
  assert.deepEqual(ruth.tags, ['Repeat']);

  const lena = customers.find((c) => c.name === 'Bronagh Hughes');
  assert.equal(lena.jobs, 0);
  assert.equal(lena.cancelled, 1);
  assert.equal(lena.lastJobAt, null);
  assert.equal(lena.nextJobAt, null);
  assert.deepEqual(lena.tags, []);

  const priya = customers.find((c) => c.name === 'Aoife Magee');
  assert.deepEqual(priya.tags, [], 'one job is not a repeat customer');
  assert.equal(priya.totalValue, 75);
  const eileen = customers.find((c) => c.name === 'Orla Hegarty');
  assert.equal(eileen.owed, 75);

  // order: the later of nextJobAt and lastJobAt, newest first; a customer with neither is last
  assert.equal(customers[0].name, 'Darragh Sloan', 'his install on Wed 4 Nov is the latest job in the diary');
  assert.equal(customers[customers.length - 1].name, 'Bronagh Hughes');
  const recency = (c) => ((c.nextJobAt || '') > (c.lastJobAt || '') ? c.nextJobAt || '' : c.lastJobAt || '');
  for (let i = 1; i < customers.length; i += 1) assert.ok(recency(customers[i - 1]) >= recency(customers[i]), `order at ${i}`);
});

test('customers: the identity is the phone number, whatever its spelling, and tags follow the rules', () => {
  const state = fixture();
  state.bookings.push(booking({ id: 'bk_p2', createdAt: NOW, customer: { name: 'Aoife N.', phone: '+44 7700 900231', email: 'aoife@home.example' } }));
  const customers = selectCustomers(state);
  assert.equal(customers.length, 27, 'same phone, same customer');
  const priya = selectCustomerByKey(state, '447700900231');
  assert.equal(priya.name, 'Aoife N.', 'name from the most recent booking');
  assert.equal(priya.email, 'aoife@home.example');
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
  assert.deepEqual(selectCustomerByKey(m, '447700900262').tags, ['Landlord', 'Repeat'], 'the seed note on his phone booking still says landlord; his survey and EICR are two live jobs');
  m.bookings.find((b) => b.id === 'bk_seed_02').notes = '';
  m.bookings.find((b) => b.id === 'bk_seed_09').notes = '';
  m.bookings.find((b) => b.id === 'bk_seed_25').notes = '';
  assert.deepEqual(selectCustomerByKey(m, '447700900262').tags, ['Repeat'], 'one live EICR, a survey and one cancelled install, no landlord note');
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
  assert.deepEqual(selectRepeatInfo(fresh, selectBookingById(fresh, 'bk_seed_09')), { isRepeat: true, nth: 3 }, 'after his safety report and his free survey');
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
  assert.equal(ins.collectedMonth, 3038);
  assert.equal(ins.collectedMonthCount, 5, 'two installs, the sockets job and... the free survey visits are not counted');
  assert.equal(ins.owedTotal, 3609);
  assert.equal(ins.owedCount, 4);
  assert.equal(ins.bookedNext14, 8123);
  assert.equal(ins.bookedNext14Count, 12, 'the jobs and installs booked or pencilled in plus the pencilled-in enquiries (a free survey adds nothing to the value)');
  assert.equal(ins.avgJob, 826, 'the free survey visits are not averaged in');
  assert.equal(ins.weeks.length, 6);
  assert.deepEqual(ins.weeks.map((w) => w.weekStart), ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
  assert.deepEqual(ins.weeks.map((w) => w.label), ['Mon 14 Sep', 'Mon 21 Sep', 'Mon 28 Sep', 'Mon 5 Oct', 'Mon 12 Oct', 'Mon 19 Oct']);
  assert.deepEqual(ins.weeks.map((w) => w.total), [0, 1490, 1684, 1514, 1364, 85], 'paid jobs by paidAt week (Wed 7 Oct and Sat 10 Oct share a week)');
  assert.deepEqual(ins.byService, [
    { serviceId: 'ev', name: 'EV charger installation', jobs: 6, total: 9191 },
    { serviceId: 'sockets', name: 'Sockets, switches and lights', jobs: 2, total: 255 },
    { serviceId: 'eicr', name: 'EICR safety report', jobs: 1, total: 150 },
    { serviceId: 'fault', name: 'Fault finding and repairs', jobs: 2, total: 150 },
    { serviceId: 'ev_quote', name: 'Home EV charger quote', jobs: 18, total: 0 }
  ]);
});

test('selectInsights definitions: this month only, the 14-day window, the 30-day average and urgent exclusion', () => {
  const state = fixture();
  // a job paid last month does not count as collected this month
  state.bookings.find((b) => b.id === 'bk_seed_01').paidAt = '2026-09-30T18:00';
  assert.equal(selectInsights(state, NOW).collectedMonth, 2963);
  assert.equal(selectInsights(state, NOW).collectedMonthCount, 4);
  // the next-14 window is today .. today + 13
  state.bookings.push(booking({ id: 'bk_edge13', start: '2026-11-05T08:00', quotedPrice: 100 }));
  state.bookings.push(booking({ id: 'bk_edge14', start: '2026-11-06T08:00', quotedPrice: 1000 }));
  assert.equal(selectInsights(state, NOW).bookedNext14, 8223);
  assert.equal(selectInsights(state, NOW).bookedNext14Count, 13);
  // urgent bookings are not "booked work"
  state.bookings.push(booking({ id: 'bk_urg', urgent: true, status: 'new', start: NOW, quotedPrice: 95 }));
  assert.equal(selectInsights(state, NOW).bookedNext14Count, 13);
  // the 30-day average uses done jobs started within the last 30 days
  state.bookings.push(booking({ id: 'bk_old', status: 'done', start: '2026-09-01T08:00', finalPrice: 9000, paid: true, paidMethod: 'cash', paidAt: '2026-09-01T10:00' }));
  assert.equal(selectInsights(state, NOW).avgJob, 826);
  // no done jobs: an average of 0, never NaN
  const none = fixture();
  none.bookings = none.bookings.filter((b) => b.status !== 'done');
  const ins = selectInsights(none, NOW);
  assert.equal(ins.avgJob, 0);
  assert.equal(ins.collectedMonth, 0);
  assert.deepEqual(ins.byService, []);
});

test('selectInsights: a free survey visit (ev_quote done at 0 pounds) is neither collected nor part of the average job, even if marked paid', () => {
  const base = fixture();
  const withFree = fixture();
  // three more free surveys finished this month, one of them marked paid by mistake
  for (const [i, paid] of [[1, false], [2, true], [3, false]]) {
    withFree.bookings.push(booking({
      id: `bk_free${i}`, serviceId: 'ev_quote', serviceName: 'Home EV charger quote', status: 'done', start: `2026-10-1${i}T08:00`, quotedPrice: 0, finalPrice: 0,
      paid, paidMethod: paid ? 'cash' : null, paidAt: paid ? '2026-10-12T09:00' : null
    }));
  }
  const a = selectInsights(base, NOW);
  const b = selectInsights(withFree, NOW);
  assert.equal(b.avgJob, a.avgJob, 'the average job ignores free visits');
  assert.equal(b.collectedMonthCount, a.collectedMonthCount, 'a paid free visit is not a collected payment');
  assert.equal(b.collectedMonth, a.collectedMonth, 'and adds no money');
  assert.equal(b.owedCount, a.owedCount, 'a free visit is never owed');
  assert.equal(b.owedTotal, a.owedTotal);
  assert.deepEqual(b.byService.find((x) => x.serviceId === 'ev_quote'), { serviceId: 'ev_quote', name: 'Home EV charger quote', jobs: 21, total: 0 }, 'the survey visits are still counted by service (18 + 3)');
  // a survey the owner DID charge for is a normal job
  const charged = fixture();
  charged.bookings.push(booking({ id: 'bk_charged', serviceId: 'ev_quote', status: 'done', start: '2026-10-12T08:00', quotedPrice: 0, finalPrice: 60, paid: true, paidMethod: 'card', paidAt: '2026-10-12T09:00' }));
  assert.equal(selectInsights(charged, NOW).collectedMonthCount, a.collectedMonthCount + 1);
  assert.equal(selectInsights(charged, NOW).collectedMonth, a.collectedMonth + 60);
  assert.ok(isFreeVisit(withFree.bookings.find((x) => x.id === 'bk_free1')));
  assert.equal(isFreeVisit(charged.bookings.find((x) => x.id === 'bk_charged')), false);
});

test('selectInsights reads the same at 09:00 as at 20:30 for finished history', () => {
  const state = fixture();
  assert.equal(selectInsights(state, '2026-10-23T09:00').owedCount, 4);
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

test('selectWebsiteServices: only the free EV charger quote is on the website by default', () => {
  const state = fixture();
  assert.deepEqual(selectWebsiteServices(state).map((s) => s.id), ['ev_quote']);
  assert.ok(selectServices(state).length > 1, 'the other services stay in the data for phone jobs');
  assert.ok(state.settings.services.filter((s) => s.id !== 'ev_quote').every((s) => s.showOnWebsite === false), 'hidden by default');
  state.settings.services.find((s) => s.id === 'fault').showOnWebsite = true;
  assert.deepEqual(selectWebsiteServices(state).map((s) => s.id), ['ev_quote', 'fault']);
  state.settings.services.find((s) => s.id === 'ev_quote').active = false;
  assert.deepEqual(selectWebsiteServices(state).map((s) => s.id), ['fault'], 'an inactive service is never offered');
});

test('enquiryAnswerRows: the five funnel answers with his verbatim labels, in order', () => {
  const state = frozen();
  const rows = enquiryAnswerRows(selectBookingById(state, 'bk_seed_07'));
  assert.deepEqual(rows.map((r) => r.key), ['postcode', 'parking', 'vehicle', 'timing', 'permission']);
  assert.deepEqual(rows.map((r) => r.heading), ['Postcode', 'Parking', 'Car', 'Timing', 'Permission']);
  assert.deepEqual(rows.map((r) => r.label), ['BT42 6JN', 'Private driveway', "It's ordered or arriving soon", 'As soon as possible', 'Yes']);
  assert.deepEqual(enquiryAnswerRows(selectBookingById(state, 'bk_seed_01')), [], 'a phone job has no answers');
  assert.deepEqual(enquiryAnswerRows(null), []);
  assert.deepEqual(enquiryAnswerRows({ answers: { parking: 'moon', timing: 'month' } }).map((r) => r.label), ['Within the next month'], 'unknown values are skipped');
});

test('bookingAreaFlag: a valid non-BT postcode is flagged outside Northern Ireland', () => {
  const state = frozen();
  assert.equal(bookingAreaFlag(selectBookingById(state, 'bk_seed_11')), 'Outside Northern Ireland');
  assert.equal(bookingAreaFlag(selectBookingById(state, 'bk_seed_07')), '');
  assert.equal(bookingAreaFlag({ address: { line1: '', postcode: 'xx' } }), '', 'an invalid postcode is not flagged here (validation says so)');
  assert.equal(bookingAreaFlag(null), '');
});
