// tests/unit/store.test.mjs: unit tests for js/core/store.js (persistence, every mutation, undo, sync, rollover)
// Owner: WP1
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// A stand-in browser: the store installs its cross-tab listeners only when `window` exists, so this is set up
// BEFORE the store module is first used. Handlers are captured so tests can fire the events by hand.
const handlers = { window: {}, document: {} };
const fakeDocument = { visibilityState: 'visible', addEventListener: (t, fn) => { (handlers.document[t] ||= []).push(fn); } };
globalThis.window = { addEventListener: (t, fn) => { (handlers.window[t] ||= []).push(fn); } };
globalThis.document = fakeDocument;
const fire = (target, type, event = {}) => (handlers[target][type] || []).forEach((fn) => fn(event));

import { setClock, nowStamp as getNowStamp } from '../../js/core/clock.js';
import { STORAGE_KEYS, makeDefaultSettings } from '../../js/core/config.js';
import { SIM_POOL } from '../../js/core/seed.js';
import { bookingWindowIds, getDayLoad, getDaySlots, isSlotFree, nextFreeSlot } from '../../js/core/availability.js';
import {
  selectBookingById, selectBookingByRef, selectInsights, selectMessages, selectNeedsYou, selectOwedTotal, selectRepeatInfo,
  selectUnreadMessageCount, selectCustomers
} from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

const {
  initStore, getState, subscribe, syncFromStorage, getStorageStatus, createBooking, confirmBooking, acceptEmergency, declineBooking,
  markOnTheWay, completeBooking, markPaid, markUnpaid, cancelBooking, rescheduleBooking, updateBooking, markSeen, markAllSeen,
  sendQuickMessage, sendPaymentNudge, sendReviewRequest, sendMessageNow, markMessagesSeen, addBlock, blockRange, removeBlock,
  removeBlockGroup, addDaysOff, removeDayOff, setDayFull, updateSettings, updateService, setTheme, setDemoPhone, resetDemo,
  simulateIncomingBooking, undo
} = store;

const FIXTURE = new Date(2026, 9, 23, 20, 30);
const NOW = '2026-10-23T20:30';

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
}

let storage;
beforeEach(() => {
  setClock(FIXTURE);
  fakeDocument.visibilityState = 'visible';
  storage = memStorage();
  initStore({ storage, force: true });
});
afterEach(() => setClock(null));

const draftFor = (over = {}) => ({
  serviceId: 'fault', date: '2026-10-24', windowId: 0,
  customer: { name: 'Priya Nair', phone: '07700 900231' }, address: { line1: '14 Alder Row', postcode: 'MB3 4QP' }, ...over
});
const eicrDraft = (over = {}) => draftFor({ serviceId: 'eicr', variantId: 'house', date: '2026-10-26', windowId: 0, ...over });
const urgentDraft = (over = {}) => ({
  serviceId: 'emergency', urgent: true, date: '2026-10-23', windowId: null, emergencyReasons: ['no_power'],
  customer: { name: 'Gareth Pryce', phone: '07700 900500' }, address: { line1: '', postcode: 'MB2 6JN' }, ...over
});
const ids = (list) => list.map((b) => b.id);
const booking = (id) => selectBookingById(getState(), id);
const kinds = (list) => list.map((m) => m.kind);
const slotStates = (date, blocks = 1, opts = {}) => getDaySlots(getState(), date, blocks, opts).map((s) => s.state);

// ---------- persistence ----------

test('round trip through injected storage: saved as vm_state_v1, reloaded without reseeding', () => {
  const state = getState();
  assert.equal(state.bookings.length, 15);
  assert.equal(state.seededFor, '2026-10-23');
  assert.equal(state.refSeq, 1043);
  const raw = storage.getItem(STORAGE_KEYS.state);
  assert.deepEqual(JSON.parse(raw), JSON.parse(JSON.stringify(state)));

  const made = createBooking(draftFor());
  assert.equal(made.ok, true);
  const rev = getState().meta.rev;
  const reloaded = initStore({ storage, force: true });
  assert.equal(reloaded.bookings.length, 16);
  assert.equal(reloaded.meta.rev, rev);
  assert.equal(selectBookingByRef(reloaded, 'VM-1043').id, made.booking.id);
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded)), JSON.parse(storage.getItem(STORAGE_KEYS.state)));
});

test('initStore is idempotent and getState returns one reference until something changes', () => {
  const a = getState();
  assert.equal(initStore(), a);
  assert.equal(initStore({ storage: memStorage() }), a, 'without force the injected storage is ignored');
  assert.equal(getState(), a);
  createBooking(draftFor());
  assert.notEqual(getState(), a);
  const b = getState();
  assert.equal(getState(), b);
});

test('the state is an immutable snapshot', () => {
  const state = getState();
  assert.throws(() => { state.bookings.push({}); }, TypeError);
  assert.throws(() => { state.bookings[0].status = 'cancelled'; }, TypeError);
  assert.throws(() => { state.settings.business.name = 'x'; }, TypeError);
  assert.equal(Object.isFrozen(state.meta), true);
});

test('a stored state with a bad schema is discarded and reseeded', () => {
  const good = JSON.parse(storage.getItem(STORAGE_KEYS.state));
  const bad = [
    'not json at all', '{"v": 99}', '{}', JSON.stringify({ ...good, v: undefined }), JSON.stringify({ ...good, v: 0 }),
    JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, bookings: 'nope' }), JSON.stringify({ ...good, settings: null }),
    JSON.stringify({ ...good, meta: {} }), 'null', '[]', '42'
  ];
  for (const raw of bad) {
    const s = memStorage({ [STORAGE_KEYS.state]: raw });
    const state = initStore({ storage: s, force: true });
    assert.equal(state.bookings.length, 15, `reseeded from: ${raw.slice(0, 30)}`);
    assert.equal(state.v, 1);
    assert.deepEqual(JSON.parse(s.getItem(STORAGE_KEYS.state)).bookings.length, 15, 'and written back');
  }
});

test('a fresh store takes its theme mirror from vm_theme', () => {
  const s = memStorage({ [STORAGE_KEYS.theme]: 'dark' });
  assert.equal(initStore({ storage: s, force: true }).settings.theme, 'dark');
  const junk = memStorage({ [STORAGE_KEYS.theme]: 'purple' });
  assert.equal(initStore({ storage: junk, force: true }).settings.theme, 'auto');
});

test('storage that throws puts the store in memory mode and everything still works', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  const state = initStore({ storage: broken, force: true });
  assert.equal(state.bookings.length, 15);
  assert.deepEqual(getStorageStatus(), { ok: false, mode: 'memory' });
  const made = createBooking(draftFor());
  assert.equal(made.ok, true);
  assert.equal(made.booking.ref, 'VM-1043');
  assert.equal(getState().bookings.length, 16);
  assert.equal(syncFromStorage(), false);
  assert.equal(confirmBooking('bk_seed_11').ok, true);
});

test('storage that reads but cannot write also falls back to memory', () => {
  const readOnly = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  initStore({ storage: readOnly, force: true });
  assert.equal(getStorageStatus().ok, false);
  assert.equal(createBooking(draftFor()).ok, true);
});

test('a write that fails later (quota) switches to memory but the booking still succeeds', () => {
  let failWrites = false;
  const flaky = memStorage();
  const original = flaky.setItem;
  flaky.setItem = (k, v) => { if (failWrites && k === STORAGE_KEYS.state) throw new Error('QuotaExceededError'); original(k, v); };
  initStore({ storage: flaky, force: true });
  assert.deepEqual(getStorageStatus(), { ok: true, mode: 'local' });
  failWrites = true;
  const made = createBooking(draftFor());
  assert.equal(made.ok, true);
  assert.deepEqual(getStorageStatus(), { ok: false, mode: 'memory' });
  assert.equal(getState().bookings.length, 16);
});

test('a throwing localStorage property is survived (some browser modes throw on access)', () => {
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  try {
    const state = initStore({ force: true });
    assert.equal(state.bookings.length, 15);
    assert.equal(getStorageStatus().ok, false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('no storage at all: memory mode, status says so', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined');
  initStore({ force: true });
  assert.deepEqual(getStorageStatus(), { ok: false, mode: 'memory' });
});

// ---------- subscribe ----------

test('subscribe: called with (state, prevState) after each mutation, and unsubscribe stops it', () => {
  const calls = [];
  const off = subscribe((state, prev) => calls.push([state, prev]));
  const before = getState();
  const made = createBooking(draftFor());
  assert.equal(made.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], getState());
  assert.equal(calls[0][1], before);
  assert.equal(calls[0][0].bookings.length, calls[0][1].bookings.length + 1);
  off();
  createBooking(draftFor({ date: '2026-10-26', windowId: 1 }));
  assert.equal(calls.length, 1);
});

test('failed mutations and no-ops do not notify or write', () => {
  let calls = 0;
  const off = subscribe(() => { calls += 1; });
  const rev = getState().meta.rev;
  const raw = storage.getItem(STORAGE_KEYS.state);
  assert.equal(createBooking(draftFor({ customer: { name: '', phone: '' } })).ok, false);
  assert.equal(confirmBooking('nope').ok, false);
  assert.equal(markSeen('bk_seed_01').ok, true, 'already seen is a no-op');
  assert.equal(markAllSeen().ok, true);
  assert.equal(markAllSeen().ok, true);
  assert.equal(markMessagesSeen().ok, true, 'already up to date');
  assert.equal(setDayFull('2026-10-27', false).ok, true);
  assert.equal(calls, 1, 'only the first markAllSeen changed anything');
  off();
  assert.equal(getState().meta.rev, rev + 1);
  assert.notEqual(storage.getItem(STORAGE_KEYS.state), raw);
});

test('a subscriber that throws does not stop the others or break the mutation', () => {
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const seen = [];
  const off1 = subscribe(() => { throw new Error('boom'); });
  const off2 = subscribe((s) => seen.push(s.bookings.length));
  try {
    assert.equal(createBooking(draftFor()).ok, true);
  } finally {
    console.error = original;
    off1();
    off2();
  }
  assert.deepEqual(seen, [16]);
  assert.equal(errors.length, 1);
});

// ---------- createBooking ----------

test('createBooking happy path: VM-1043, confirmed, three messages with the owner alert newest', () => {
  const calls = [];
  const off = subscribe((s) => calls.push(s.meta.rev));
  const result = createBooking(eicrDraft());
  off();
  assert.equal(result.ok, true);
  const b = result.booking;
  assert.equal(b.ref, 'VM-1043');
  assert.equal(b.status, 'confirmed');
  assert.match(b.id, /^bk_[0-9a-z]{8}$/);
  assert.equal(b.createdAt, NOW);
  assert.equal(b.serviceId, 'eicr');
  assert.equal(b.serviceName, 'EICR safety report');
  assert.equal(b.variantId, 'house');
  assert.equal(b.variantLabel, 'House, 2–3 bed');
  assert.equal(b.start, '2026-10-26T08:00');
  assert.equal(b.durationMin, 240);
  assert.equal(b.quotedPrice, 195);
  assert.equal(b.urgent, false);
  assert.deepEqual(b.emergencyReasons, []);
  assert.equal(b.source, 'website');
  assert.equal(b.seenByOwner, false);
  assert.equal(b.seed, false);
  assert.equal(b.finalPrice, null);
  assert.equal(b.paid, false);
  assert.deepEqual(b.customer, { name: 'Priya Nair', phone: '07700 900231', email: '' });
  assert.deepEqual(b.address, { line1: '14 Alder Row', postcode: 'MB3 4QP' });
  assert.deepEqual(b.history.map((h) => [h.event, h.by]), [['created', 'customer'], ['confirmed', 'system']]);
  assert.equal(getState().refSeq, 1044);

  assert.deepEqual(kinds(result.messages), ['customer_reminder', 'customer_confirmed', 'owner_new_booking']);
  const [reminder, confirmed, alert] = result.messages;
  assert.equal(reminder.sendAt, '2026-10-25T18:00');
  assert.equal(confirmed.sendAt, null);
  assert.equal(alert.to, 'owner');
  assert.ok(alert.seq > confirmed.seq && confirmed.seq > reminder.seq, 'the owner alert has the highest seq of its group');
  assert.ok(result.messages.every((m) => m.at === NOW && m.bookingId === b.id && m.simulated === true && m.seed === false && /^msg_[0-9a-z]{8}$/.test(m.id)));
  assert.equal(getState().messages.length, 28 + 3);
  assert.equal(getState().meta.msgSeq, 31);
  assert.ok(confirmed.body.startsWith("Hi Priya, it's Dan from Voltmere Electrical. You're booked in: EICR safety report (House, 2–3 bed), Mon 26 Oct, morning, arriving between 8 and 10am"));
  assert.equal(calls.length, 1, 'one notification for the whole booking');
  assert.equal(getState().bookings.at(-1).id, b.id);
  assert.equal(selectUnreadMessageCount(getState()), 1, 'the owner alert is unread');
  assert.deepEqual(selectRepeatInfo(getState(), b), { isRepeat: true, nth: 2 }, 'Priya has booked before');
});

test('createBooking normalises and trims what the customer typed', () => {
  const result = createBooking(draftFor({
    customer: { name: `  ${'N'.repeat(80)}  `, phone: '+44 7700 900231', email: ' priya@home.example ' },
    address: { line1: '  14 Alder Row ', postcode: 'mb34qp' },
    notes: `  ${'x'.repeat(400)}  `
  }));
  assert.equal(result.ok, true);
  const b = result.booking;
  assert.equal(b.customer.name.length, 60);
  assert.equal(b.customer.phone, '07700 900231');
  assert.equal(b.customer.email, 'priya@home.example');
  assert.equal(b.address.line1, '14 Alder Row');
  assert.equal(b.address.postcode, 'MB3 4QP');
  assert.equal(b.notes.length, 300);
});

test('createBooking validation: exact messages, and nothing is written', () => {
  const rev = getState().meta.rev;
  const empty = createBooking({ serviceId: 'fault', date: '2026-10-24', windowId: 0, customer: { name: '', phone: '' }, address: { line1: '', postcode: '' } });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'invalid');
  assert.deepEqual(empty.errors, {
    name: 'Enter your name', phone: 'Enter your mobile number', postcode: 'Enter your postcode', line1: 'Enter your house number and street'
  });
  const wrong = createBooking(draftFor({ customer: { name: 'P', phone: '01234 567890' }, address: { line1: '14 Alder Row', postcode: 'xx' } }));
  assert.deepEqual(wrong.errors, {
    name: 'Enter your name', phone: "That doesn't look like a UK mobile. It should start 07 or +44 7", postcode: 'Enter a UK postcode, like MB3 4QP'
  });
  assert.deepEqual(createBooking(draftFor({ date: 'tomorrow' })).errors, { date: 'Choose a day' });
  assert.deepEqual(createBooking(draftFor({ date: '2026-02-30' })).errors, { date: 'Choose a day' });
  assert.deepEqual(createBooking(draftFor({ windowId: 4 })).errors, { windowId: 'Choose a time' });
  assert.deepEqual(createBooking(draftFor({ windowId: null })).errors, { windowId: 'Choose a time' });
  assert.deepEqual(createBooking(draftFor({ windowId: undefined })).errors, { windowId: 'Choose a time' });
  assert.deepEqual(Object.keys(createBooking(eicrDraft({ windowId: 1 })).errors), ['windowId'], 'a half-day job starts at window 0 or 2');
  assert.deepEqual(Object.keys(createBooking(eicrDraft({ windowId: 3 })).errors), ['windowId']);
  assert.deepEqual(createBooking(draftFor({ serviceId: undefined })).errors, { serviceId: 'Choose a service' });
  assert.deepEqual(createBooking({}).errors.name, 'Enter your name');
  assert.equal(createBooking(undefined).ok, false);
  assert.equal(getState().meta.rev, rev);
  assert.equal(getState().bookings.length, 15);
  assert.equal(getState().refSeq, 1043, 'a failed booking does not use up a reference');
});

test('createBooking: the same window twice gives slot_taken with 3 alternatives, in time order', () => {
  assert.equal(createBooking(draftFor()).ok, true);
  const second = createBooking(draftFor({ customer: { name: 'Tom Hargreaves', phone: '07700 900288' } }));
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'slot_taken');
  assert.equal(second.alternatives.length, 3);
  assert.deepEqual(second.alternatives.map((a) => a.human), ['Mon 26 Oct, 8–10am', 'Mon 26 Oct, 10am–12', 'Thu 29 Oct, 10am–12']);
  assert.ok(second.alternatives.every((a) => 'date' in a && 'windowId' in a && 'blocks' in a && 'label' in a));
  assert.equal(getState().refSeq, 1044, 'the failed attempt did not consume VM-1044');
  assert.equal(getState().bookings.length, 16);
  // a taken half-day pair, a blocked window, a booked window and a full day are all slot_taken
  assert.equal(createBooking(draftFor({ date: '2026-10-27', windowId: 0 })).reason, 'slot_taken', 'Tuesday is full');
  assert.equal(createBooking(draftFor({ date: '2026-10-28', windowId: 0 })).reason, 'slot_taken', 'Van MOT');
  assert.equal(createBooking(draftFor({ date: '2026-10-25', windowId: 0 })).reason, 'slot_taken', 'Sunday is closed');
  assert.equal(createBooking(draftFor({ date: '2026-10-23', windowId: 3 })).reason, 'slot_taken', 'today is over at 20:30');
  assert.equal(createBooking(draftFor({ date: '2026-12-01', windowId: 0 })).reason, 'slot_taken', 'beyond the horizon');
  assert.equal(createBooking(eicrDraft({ windowId: 2 })).reason, 'slot_taken', 'Monday afternoon holds Marcus');
});

test('createBooking: edge postcode, outside postcode and auto-confirm off all wait for the owner', () => {
  const edge = createBooking(draftFor({ address: { line1: 'Mill Cottage', postcode: 'MB12 6AB' } }));
  assert.equal(edge.booking.status, 'new');
  assert.deepEqual(kinds(edge.messages), ['customer_received', 'owner_new_booking']);
  assert.ok(edge.messages[0].body.includes('I just need to check travel to MB12 6AB.'));
  assert.ok(edge.messages[1].body.includes('Needs your OK: outside your usual area (MB12).'));
  assert.deepEqual(edge.booking.history.map((h) => h.event), ['created']);
  const outside = createBooking(draftFor({ date: '2026-10-26', windowId: 0, address: { line1: '1 High St', postcode: 'AB1 2CD' } }));
  assert.equal(outside.booking.status, 'new');
  assert.equal(outside.messages.length, 2, 'no reminder for a request that is not confirmed yet');
  updateSettings({ autoConfirm: false });
  const off = createBooking(draftFor({ date: '2026-10-26', windowId: 1 }));
  assert.equal(off.booking.status, 'new');
  assert.ok(off.messages[1].body.includes('Needs your OK: auto-confirm is off.'));
  // a `new` booking still holds its window
  assert.equal(isSlotFree(getState(), { date: '2026-10-26', windowId: 1 }), false);
});

test('createBooking: no reminder when remindersOn is false or there is no time for one', () => {
  updateSettings({ remindersOn: false });
  const noRem = createBooking(draftFor());
  assert.deepEqual(kinds(noRem.messages), ['customer_confirmed', 'owner_new_booking']);
  updateSettings({ remindersOn: true });
  setClock(new Date(2026, 9, 26, 9, 30));
  initStore({ storage, force: true });
  const sameDay = createBooking(draftFor({ date: '2026-10-26', windowId: 3 }));
  assert.equal(sameDay.ok, true, `${JSON.stringify(sameDay)}`);
  assert.deepEqual(kinds(sameDay.messages), ['customer_confirmed', 'owner_new_booking'], 'booked after 07:00 on the day: nothing to remind');
});

test('urgent bookings never take a window and are never auto-confirmed', () => {
  const before = JSON.stringify(['2026-10-23', '2026-10-24', '2026-10-26'].map((d) => getDayLoad(getState(), d)));
  const result = createBooking(urgentDraft());
  assert.equal(result.ok, true);
  const b = result.booking;
  assert.equal(b.status, 'new');
  assert.equal(b.urgent, true);
  assert.equal(b.start, NOW);
  assert.equal(b.durationMin, 0);
  assert.equal(b.serviceId, 'emergency');
  assert.deepEqual(b.emergencyReasons, ['no_power']);
  assert.equal(b.address.line1, '');
  assert.equal(b.quotedPrice, 95);
  assert.deepEqual(kinds(result.messages), ['customer_emergency_received', 'owner_emergency']);
  assert.ok(result.messages[1].body.startsWith('*URGENT: emergency request VM-1043*'));
  assert.equal(JSON.stringify(['2026-10-23', '2026-10-24', '2026-10-26'].map((d) => getDayLoad(getState(), d))), before);
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Tomorrow, 8–10am');
  // the order of Needs you (F3): seeded Ngozi, the new emergency, seeded Sam
  assert.deepEqual(ids(selectNeedsYou(getState())), ['bk_seed_07', b.id, 'bk_seed_11']);
  // reasons are required, unknown ones are dropped, a street is optional
  assert.deepEqual(createBooking(urgentDraft({ emergencyReasons: [] })).errors, { emergencyReasons: 'Choose what is happening' });
  assert.deepEqual(createBooking(urgentDraft({ emergencyReasons: ['nope'] })).errors, { emergencyReasons: 'Choose what is happening' });
  assert.deepEqual(createBooking(urgentDraft({ emergencyReasons: ['water', 'water', 'bogus', 'burning'] })).booking.emergencyReasons, ['water', 'burning']);
  assert.equal(createBooking(urgentDraft({ address: { line1: '', postcode: '' } })).errors.postcode, 'Enter your postcode');
});

test('emergencies_off and service_unavailable', () => {
  updateSettings({ takingEmergencies: false });
  const off = createBooking(urgentDraft());
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'emergencies_off');
  updateSettings({ takingEmergencies: true });
  assert.equal(updateService('ev', { active: false }).ok, true);
  assert.equal(createBooking(eicrDraft({ serviceId: 'ev', variantId: undefined })).reason, 'service_unavailable');
  assert.equal(createBooking(draftFor({ serviceId: 'nonsense' })).reason, 'service_unavailable');
  assert.equal(getState().refSeq, 1043);
});

test('owner mode: confirmed at once, no owner alert, lead time and full days ignored, price override, notify switch', () => {
  setClock(new Date(2026, 9, 23, 12, 30));
  initStore({ storage, force: true });
  const customer = createBooking(draftFor({ date: '2026-10-23', windowId: 2 }));
  assert.equal(customer.reason, 'slot_taken', 'the 13:00 window is too soon for a customer at 12:30');
  const owner = createBooking(draftFor({ date: '2026-10-23', windowId: 2, asOwner: true, source: 'whatsapp', quotedPrice: 90.4 }));
  assert.equal(owner.ok, true, JSON.stringify(owner));
  assert.equal(owner.booking.status, 'confirmed');
  assert.equal(owner.booking.seenByOwner, true);
  assert.equal(owner.booking.source, 'whatsapp');
  assert.equal(owner.booking.quotedPrice, 90);
  assert.deepEqual(owner.booking.history.map((h) => [h.event, h.by]), [['created', 'owner'], ['confirmed', 'owner']]);
  assert.deepEqual(kinds(owner.messages), ['customer_confirmed'], 'no alert to the owner about his own booking (today: no reminder time left)');
  const silent = createBooking(draftFor({ date: '2026-10-26', windowId: 1, asOwner: true, notifyCustomer: false }));
  assert.equal(silent.ok, true);
  assert.deepEqual(silent.messages, []);
  assert.equal(silent.booking.source, 'phone', 'an owner booking defaults to phone');
  const withReminder = createBooking(draftFor({ date: '2026-10-27', windowId: 0, asOwner: true }));
  assert.equal(withReminder.ok, false, 'Tuesday is taken, even for the owner');
  assert.equal(withReminder.reason, 'slot_taken');
  setDayFull('2026-10-30', true);
  const full = createBooking(draftFor({ date: '2026-10-30', windowId: 0, asOwner: true }));
  assert.equal(full.ok, true, 'owner mode ignores a full day');
  assert.deepEqual(kinds(full.messages), ['customer_reminder', 'customer_confirmed']);
  assert.equal(createBooking(draftFor({ date: '2026-12-01', windowId: 0, asOwner: true })).ok, true, 'and the horizon');
  assert.equal(createBooking(draftFor({ date: '2026-10-28', windowId: 0, asOwner: true })).reason, 'slot_taken', 'but never a block');
  assert.equal(createBooking(draftFor({ date: '2026-10-25', windowId: 0, asOwner: true })).reason, 'slot_taken', 'or a closed day');
});

// ---------- the transition table (7.5): one allowed and one disallowed for every function ----------

test('confirmBooking: new -> confirmed with the confirmation and a scheduled reminder', () => {
  const result = confirmBooking('bk_seed_11');
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'confirmed');
  assert.equal(result.booking.seenByOwner, true);
  assert.ok(result.undoToken);
  assert.deepEqual(result.booking.history.at(-1), { at: NOW, event: 'confirmed', by: 'owner' });
  const added = selectMessages(getState(), { bookingId: 'bk_seed_11' }).filter((m) => !m.seed);
  assert.deepEqual(kinds(added), ['customer_confirmed', 'customer_reminder'], 'newest first: the confirmation is on top');
  assert.equal(added[1].sendAt, '2026-10-26T18:00');
  assert.equal(selectMessages(getState())[0].kind, 'customer_confirmed', 'F2: the newest message is the confirmation');
  assert.equal(confirmBooking('bk_seed_11').reason, 'bad_transition');
  assert.equal(confirmBooking('bk_seed_08').reason, 'bad_transition', 'already confirmed');
  assert.equal(confirmBooking('bk_seed_07').reason, 'bad_transition', 'an emergency is accepted, not confirmed');
  assert.equal(confirmBooking('nope').reason, 'not_found');
});

test('acceptEmergency: urgent new -> confirmed with an ETA', () => {
  const result = acceptEmergency('bk_seed_07', 45);
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'confirmed');
  assert.equal(result.booking.etaMinutes, 45);
  assert.equal(result.booking.etaAt, '2026-10-23T21:15');
  assert.ok(result.undoToken);
  const msg = selectMessages(getState())[0];
  assert.equal(msg.kind, 'customer_emergency_accepted');
  assert.ok(msg.body.includes('about 45 minutes away (around 21:15)'));
  assert.ok(!ids(selectNeedsYou(getState())).includes('bk_seed_07'));
  assert.equal(acceptEmergency('bk_seed_07', 45).reason, 'bad_transition');
  assert.equal(acceptEmergency('bk_seed_11', 45).reason, 'bad_transition', 'not an emergency');
  for (const eta of [0, -5, 1.5, '45', null, undefined]) assert.equal(acceptEmergency('bk_seed_07', eta).reason, 'invalid', String(eta));
  assert.equal(acceptEmergency('nope', 60).reason, 'not_found');
  const other = createBooking(urgentDraft());
  assert.equal(acceptEmergency(other.booking.id, 90).booking.etaMinutes, 90, 'any positive whole number is accepted');
});

test('declineBooking: new -> cancelled (declined), frees the window, tells the customer', () => {
  assert.equal(slotStates('2026-10-27')[1], 'booked');
  const result = declineBooking('bk_seed_11');
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'cancelled');
  assert.equal(result.booking.cancelledBy, 'owner');
  assert.equal(result.booking.cancelReason, 'declined');
  assert.ok(result.undoToken);
  assert.equal(slotStates('2026-10-27')[1], 'free');
  const msg = selectMessages(getState())[0];
  assert.equal(msg.kind, 'customer_declined');
  assert.ok(msg.body.includes("Sorry, I can't do Sockets, switches and lights on Tue 27 Oct, 10am–12."));
  assert.ok(msg.body.includes('My next free visit is Tomorrow, 8–10am.'), 'never offers the window that was just released');
  assert.ok(!msg.body.includes('Reason:'));
  assert.equal(declineBooking('bk_seed_11').reason, 'bad_transition');
  assert.equal(declineBooking('bk_seed_08').reason, 'bad_transition', 'a confirmed job is cancelled, not declined');
  const urgent = declineBooking('bk_seed_07');
  assert.equal(urgent.ok, true);
  assert.ok(selectMessages(getState())[0].body.includes("Sorry, I can't do your emergency visit."));
});

test('markOnTheWay: confirmed -> on_the_way with ETA and message', () => {
  const result = markOnTheWay('bk_seed_08', 30);
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'on_the_way');
  assert.equal(result.booking.etaMinutes, 30);
  assert.equal(result.booking.etaAt, '2026-10-23T21:00');
  assert.ok(result.undoToken);
  const msg = selectMessages(getState())[0];
  assert.equal(msg.kind, 'customer_on_my_way');
  assert.ok(msg.body.includes("I'm on my way to 2 Linnet Close, 30 minutes away (around 21:00)"));
  assert.deepEqual(result.booking.history.at(-1), { at: NOW, event: 'on_the_way', by: 'owner', note: '21:00' });
  assert.equal(markOnTheWay('bk_seed_08', 30).reason, 'bad_transition');
  assert.equal(markOnTheWay('bk_seed_11', 30).reason, 'bad_transition', 'still waiting for approval');
  assert.equal(markOnTheWay('bk_seed_01', 30).reason, 'bad_transition', 'done is terminal');
  assert.equal(markOnTheWay('bk_seed_14', 0).reason, 'invalid');
  assert.equal(markOnTheWay('nope', 30).reason, 'not_found');
});

test('completeBooking: confirmed or on_the_way -> done, with money and the review request', () => {
  const unpaid = completeBooking('bk_seed_08', { finalPrice: 90 });
  assert.equal(unpaid.ok, true);
  assert.equal(unpaid.booking.status, 'done');
  assert.equal(unpaid.booking.finalPrice, 90);
  assert.equal(unpaid.booking.paid, false);
  assert.equal(unpaid.booking.paidAt, null);
  assert.equal(unpaid.booking.reviewRequested, true, 'sendReview defaults to true');
  assert.ok(unpaid.undoToken);
  const [completed, review] = selectMessages(getState(), { bookingId: 'bk_seed_08' }).filter((m) => !m.seed);
  assert.equal(completed.kind, 'customer_completed');
  assert.equal(completed.sendAt, null);
  assert.ok(completed.body.includes('The total is £90, payable by card, bank transfer or cash.'));
  assert.equal(review.kind, 'customer_review_request');
  assert.equal(review.sendAt, '2026-10-23T21:30', 'completion + 60 minutes');
  assert.equal(selectOwedTotal(getState()), 245 + 90, 'F5: owed rises');

  const paid = completeBooking('bk_seed_14', { finalPrice: 85, paid: true, paidMethod: 'cash', sendReview: false });
  assert.equal(paid.ok, true);
  assert.equal(paid.booking.paid, true);
  assert.equal(paid.booking.paidMethod, 'cash');
  assert.equal(paid.booking.paidAt, NOW);
  assert.equal(paid.booking.reviewRequested, false);
  assert.deepEqual(kinds(selectMessages(getState(), { bookingId: 'bk_seed_14' }).filter((m) => !m.seed)), ['customer_completed']);
  assert.ok(selectMessages(getState())[0].body.includes('Paid with thanks, £85.'));
  assert.equal(selectInsights(getState(), NOW).collectedMonth, 850 + 85, 'F4: collected rises');
  assert.deepEqual(paid.booking.history.map((h) => h.event).slice(-2), ['done', 'paid']);

  const fromTheWay = markOnTheWay('bk_seed_10', 15);
  assert.equal(fromTheWay.ok, true);
  assert.equal(completeBooking('bk_seed_10', { finalPrice: 75 }).ok, true);

  assert.equal(completeBooking('bk_seed_11', { finalPrice: 85 }).reason, 'bad_transition', 'new');
  assert.equal(completeBooking('bk_seed_01', { finalPrice: 75 }).reason, 'bad_transition', 'done');
  assert.equal(completeBooking('bk_seed_15', { finalPrice: 75 }).reason, 'bad_transition', 'cancelled');
  const noMethod = completeBooking('bk_seed_12', { finalPrice: 75, paid: true });
  assert.equal(noMethod.reason, 'invalid');
  assert.ok(noMethod.errors.paidMethod);
  assert.equal(completeBooking('bk_seed_12', { finalPrice: 75, paid: true, paidMethod: 'bitcoin' }).reason, 'invalid');
  for (const price of [-1, 1.5, '75', null, undefined]) assert.equal(completeBooking('bk_seed_12', { finalPrice: price }).reason, 'invalid', String(price));
  assert.equal(completeBooking('bk_seed_12').reason, 'invalid');
  assert.equal(completeBooking('bk_seed_12', { finalPrice: 0 }).ok, true, 'a free job is fine');
  assert.equal(completeBooking('nope', { finalPrice: 1 }).reason, 'not_found');
});

test('markPaid and markUnpaid', () => {
  assert.equal(selectOwedTotal(getState()), 245);
  const result = markPaid('bk_seed_06', 'card');
  assert.equal(result.ok, true);
  assert.equal(result.booking.paid, true);
  assert.equal(result.booking.paidMethod, 'card');
  assert.equal(result.booking.paidAt, NOW);
  assert.ok(result.undoToken);
  assert.equal(selectOwedTotal(getState()), 170);
  assert.equal(selectInsights(getState(), NOW).collectedMonth, 925, 'markPaid then Insights collectedMonth rises');
  assert.equal(markPaid('bk_seed_06', 'cash').reason, 'bad_transition', 'already paid');
  assert.equal(markPaid('bk_seed_08', 'cash').reason, 'bad_transition', 'not done');
  assert.equal(markPaid('bk_seed_04', 'cheque').reason, 'invalid');
  assert.equal(markPaid('nope', 'cash').reason, 'not_found');

  const unpaid = markUnpaid('bk_seed_06');
  assert.equal(unpaid.ok, true);
  assert.equal(unpaid.booking.paid, false);
  assert.equal(unpaid.booking.paidMethod, null);
  assert.equal(unpaid.booking.paidAt, null);
  assert.equal('undoToken' in unpaid, false, 'markUnpaid is the undo of markPaid and has no token of its own');
  assert.equal(selectOwedTotal(getState()), 245);
  assert.equal(markUnpaid('bk_seed_06').reason, 'bad_transition');
  assert.equal(markUnpaid('bk_seed_08').reason, 'bad_transition');
  assert.equal(markUnpaid('nope').reason, 'not_found');
});

test('cancelBooking by the owner frees the window and tells the customer (or not)', () => {
  const result = cancelBooking('bk_seed_08', 'owner', { reason: "Can't make it" });
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'cancelled');
  assert.equal(result.booking.cancelledBy, 'owner');
  assert.equal(result.booking.cancelReason, "Can't make it");
  assert.ok(result.undoToken);
  assert.equal(slotStates('2026-10-24')[1], 'free', 'the window is free again');
  const msg = selectMessages(getState())[0];
  assert.equal(msg.kind, 'customer_cancelled');
  assert.ok(msg.body.includes("Reason: Can't make it."));
  assert.ok(msg.body.includes('My next free visit is Tomorrow, 8–10am.'));
  assert.ok(!selectMessages(getState(), { bookingId: 'bk_seed_08' }).some((m) => m.kind === 'customer_reminder' && m.sendAt > NOW), "the booking's unsent reminder is deleted");
  const quiet = cancelBooking('bk_seed_14', 'owner', { notify: false });
  assert.equal(quiet.ok, true);
  assert.ok(!selectMessages(getState(), { bookingId: 'bk_seed_14' }).some((m) => !m.seed), 'no message when notify is false');
  assert.equal(cancelBooking('bk_seed_01', 'owner').reason, 'bad_transition', 'done is terminal');
  assert.equal(cancelBooking('bk_seed_08', 'owner').reason, 'bad_transition', 'already cancelled');
  assert.equal(cancelBooking('nope', 'owner').reason, 'not_found');
  assert.equal(cancelBooking('bk_seed_10', 'somebody').reason, 'invalid');
  assert.equal(markOnTheWay('bk_seed_12', 20).ok, true);
  assert.equal(cancelBooking('bk_seed_12', 'owner').ok, true, 'an on_the_way job can be cancelled by the owner');
  assert.equal(cancelBooking('bk_seed_07', 'owner').ok, true, 'and an unaccepted emergency');
});

test('cancelBooking by the customer: refused inside 24 hours, for urgent jobs and other statuses; F8 happy path', () => {
  const made = createBooking(eicrDraft());
  assert.equal(slotStates('2026-10-26', 2)[0], 'booked');
  const result = cancelBooking(made.booking.id, 'customer', { reason: 'Changed my mind' });
  assert.equal(result.ok, true);
  assert.equal(result.booking.cancelledBy, 'customer');
  assert.equal(slotStates('2026-10-26', 2)[0], 'free');
  assert.equal(nextFreeSlot(getState(), 'eicr').human, 'Mon 26 Oct, morning, arrive 8–10am', 'F8: Soonest for an EICR is Monday morning again');
  const alert = selectMessages(getState())[0];
  assert.equal(alert.kind, 'owner_customer_cancelled');
  assert.equal(alert.to, 'owner');
  assert.ok(alert.body.includes('Reason: Changed my mind.'));
  assert.ok(alert.body.includes('That window is free again.'));
  assert.ok(!selectMessages(getState(), { bookingId: made.booking.id }).some((m) => m.kind === 'customer_reminder'), 'the scheduled reminder is gone');

  // inside the 24 hour cut-off (Hannah, tomorrow 10:00)
  assert.equal(cancelBooking('bk_seed_08', 'customer').reason, 'not_allowed');
  assert.equal(booking('bk_seed_08').status, 'confirmed');
  // an urgent request is always "close"
  assert.equal(cancelBooking('bk_seed_07', 'customer').reason, 'not_allowed');
  // statuses other than new / confirmed
  assert.equal(cancelBooking('bk_seed_01', 'customer').reason, 'not_allowed');
  markOnTheWay('bk_seed_14', 20);
  assert.equal(cancelBooking('bk_seed_14', 'customer').reason, 'not_allowed');
  // a `new` booking beyond 24h can be cancelled by the customer
  assert.equal(cancelBooking('bk_seed_11', 'customer').ok, true);
  // exactly 24 hours away is allowed
  setClock(new Date(2026, 9, 25, 12, 0));
  initStore({ storage, force: true });
  const b = createBooking(draftFor({ date: '2026-10-26', windowId: 3, asOwner: true }));
  setClock(new Date(2026, 9, 25, 15, 0));
  assert.equal(cancelBooking(b.booking.id, 'customer').ok, true, 'start is exactly 24h ahead');
  setClock(new Date(2026, 9, 25, 15, 1));
  const c = createBooking(draftFor({ date: '2026-10-26', windowId: 3, asOwner: true }));
  assert.equal(c.ok, true);
  assert.equal(cancelBooking(c.booking.id, 'customer').reason, 'not_allowed', 'less than 24h ahead');
});

test('rescheduleBooking by the owner: moves the job, replaces the reminder, tells the customer', () => {
  const before = getState().messages.filter((m) => m.bookingId === 'bk_seed_08');
  assert.equal(before.filter((m) => m.kind === 'customer_reminder').length, 1);
  const result = rescheduleBooking('bk_seed_08', { date: '2026-10-26', windowId: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.booking.start, '2026-10-26T10:00');
  assert.equal(result.booking.status, 'confirmed');
  assert.ok(result.undoToken);
  assert.equal(result.booking.history.at(-1).event, 'rescheduled');
  assert.equal(slotStates('2026-10-24')[1], 'free', 'the old window is free');
  assert.equal(slotStates('2026-10-26')[1], 'booked', 'the new one is booked');
  // Hannah's seeded reminder (18:00 tonight) was already due, so it is history; a fresh one is scheduled for the new day
  const scheduled = getState().messages.filter((m) => m.bookingId === 'bk_seed_08' && m.kind === 'customer_reminder' && m.sendAt > NOW);
  assert.equal(scheduled.length, 1, 'exactly one unsent reminder');
  assert.equal(scheduled[0].sendAt, '2026-10-25T18:00');
  assert.ok(!scheduled[0].seed);
  const msg = selectMessages(getState())[0];
  assert.equal(msg.kind, 'customer_rescheduled');
  assert.ok(msg.body.includes('moved your Fault finding and repairs from Sat 24 Oct, 10am–12 to Mon 26 Oct, 10am–12 at 2 Linnet Close'));
  // silent reschedule
  const quiet = rescheduleBooking('bk_seed_08', { date: '2026-10-26', windowId: 0 }, 'owner', { notify: false });
  assert.equal(quiet.ok, true);
  assert.equal(selectMessages(getState())[0].kind, 'customer_reminder');
  // half-day jobs move between their own windows and only to 0 or 2
  const eicr = rescheduleBooking('bk_seed_09', { date: '2026-10-26', windowId: 0 });
  assert.equal(eicr.ok, false, 'Monday morning now holds Hannah');
  assert.equal(eicr.reason, 'slot_taken');
  assert.equal(eicr.alternatives.length, 3);
  // Marcus's EICR reminder was still scheduled (Sun 25 Oct 18:00): moving the job deletes it and schedules a new one
  assert.equal(getState().messages.find((m) => m.id === 'msg_seed_09_rem').sendAt, '2026-10-25T18:00');
  assert.equal(rescheduleBooking('bk_seed_09', { date: '2026-10-29', windowId: 2 }).booking.start, '2026-10-29T13:00');
  const marcusReminders = getState().messages.filter((m) => m.bookingId === 'bk_seed_09' && m.kind === 'customer_reminder');
  assert.equal(getState().messages.some((m) => m.id === 'msg_seed_09_rem'), false, 'the old reminder is deleted');
  assert.deepEqual(marcusReminders.map((m) => m.sendAt), ['2026-10-28T18:00']);
  assert.equal(rescheduleBooking('bk_seed_09', { date: '2026-10-29', windowId: 1 }).reason, 'invalid');
  assert.equal(rescheduleBooking('bk_seed_09', { date: '2026-10-29', windowId: 3 }).reason, 'invalid');
  assert.equal(rescheduleBooking('bk_seed_08', { date: 'nope', windowId: 1 }).reason, 'invalid');
  assert.equal(rescheduleBooking('bk_seed_08', { date: '2026-10-29', windowId: 9 }).reason, 'invalid');
  // a job can "move" within its own windows (the same slot is not a clash with itself)
  assert.equal(rescheduleBooking('bk_seed_09', { date: '2026-10-29', windowId: 2 }).ok, true);
  // owner mode ignores the horizon and lead time but never a block or a booking
  assert.equal(rescheduleBooking('bk_seed_08', { date: '2026-12-01', windowId: 0 }).ok, true);
  assert.equal(rescheduleBooking('bk_seed_08', { date: '2026-10-28', windowId: 0 }).reason, 'slot_taken', 'Van MOT');
  // statuses
  assert.equal(rescheduleBooking('bk_seed_01', { date: '2026-10-29', windowId: 0 }).reason, 'bad_transition', 'done');
  assert.equal(rescheduleBooking('bk_seed_07', { date: '2026-10-29', windowId: 0 }).reason, 'bad_transition', 'urgent');
  assert.equal(rescheduleBooking('nope', { date: '2026-10-29', windowId: 0 }).reason, 'not_found');
  // a `new` booking can be moved too, and gets no reminder until confirmed
  const moved = rescheduleBooking('bk_seed_11', { date: '2026-10-29', windowId: 1 });
  assert.equal(moved.ok, true);
  assert.ok(!getState().messages.some((m) => m.bookingId === 'bk_seed_11' && m.kind === 'customer_reminder' && !m.seed));
});

test('rescheduleBooking by the customer follows the cut-off and customer-mode slot rules', () => {
  const made = createBooking(eicrDraft());
  const ok = rescheduleBooking(made.booking.id, { date: '2026-10-29', windowId: 2 }, 'customer');
  assert.equal(ok.ok, true);
  assert.equal(ok.booking.start, '2026-10-29T13:00');
  assert.equal(selectMessages(getState())[0].kind, 'owner_customer_rescheduled');
  assert.ok(selectMessages(getState())[0].body.includes('moved EICR safety report from Mon 26 Oct, morning, 8–10am to Thu 29 Oct, afternoon, 1–3pm'));
  assert.equal(rescheduleBooking(made.booking.id, { date: '2026-12-01', windowId: 0 }, 'customer').reason, 'slot_taken', 'customers keep the horizon');
  assert.equal(rescheduleBooking('bk_seed_08', { date: '2026-10-26', windowId: 1 }, 'customer').reason, 'not_allowed', 'inside 24 hours');
  assert.equal(rescheduleBooking('bk_seed_07', { date: '2026-10-26', windowId: 1 }, 'customer').reason, 'not_allowed', 'urgent');
  assert.equal(rescheduleBooking('bk_seed_01', { date: '2026-10-26', windowId: 1 }, 'customer').reason, 'not_allowed', 'done');
  assert.equal(rescheduleBooking(made.booking.id, { date: '2026-10-26', windowId: 0 }, 'robot').reason, 'invalid');
});

test('updateBooking: only internalNotes, quotedPrice and finalPrice; no-ops do not write', () => {
  const rev = getState().meta.rev;
  const result = updateBooking('bk_seed_08', { internalNotes: 'Key safe 4411', quotedPrice: 80, finalPrice: 90, status: 'done', customer: { name: 'x' } });
  assert.equal(result.ok, true);
  assert.equal(result.booking.internalNotes, 'Key safe 4411');
  assert.equal(result.booking.quotedPrice, 80);
  assert.equal(result.booking.finalPrice, 90);
  assert.equal(result.booking.status, 'confirmed', 'unknown keys are ignored');
  assert.equal(result.booking.customer.name, 'Hannah Whitfield');
  assert.equal(getState().meta.rev, rev + 1);
  assert.equal(updateBooking('bk_seed_08', { internalNotes: 'Key safe 4411' }).ok, true);
  assert.equal(getState().meta.rev, rev + 1, 'same value: nothing written');
  assert.equal(updateBooking('bk_seed_08', { internalNotes: '' }).booking.internalNotes, '');
  assert.equal(updateBooking('bk_seed_08', { quotedPrice: -5 }).reason, 'invalid');
  assert.equal(updateBooking('bk_seed_08', { quotedPrice: 7.5 }).reason, 'invalid');
  assert.deepEqual(updateBooking('bk_seed_08', { finalPrice: 'lots' }).errors, { finalPrice: 'Enter a whole number of pounds.' });
  assert.equal(updateBooking('nope', { internalNotes: 'x' }).reason, 'not_found');
});

test('markSeen and markAllSeen', () => {
  assert.equal(booking('bk_seed_07').seenByOwner, false);
  assert.equal(markSeen('bk_seed_07').ok, true);
  assert.equal(booking('bk_seed_07').seenByOwner, true);
  assert.equal(booking('bk_seed_11').seenByOwner, false);
  assert.equal(markAllSeen().ok, true);
  assert.equal(booking('bk_seed_11').seenByOwner, true);
  assert.equal(markSeen('nope').reason, 'not_found');
});

test('quick messages, payment nudge and review request', () => {
  for (const kind of ['customer_running_late', 'customer_need_access', 'customer_quote_ready']) {
    const result = sendQuickMessage('bk_seed_08', kind);
    assert.equal(result.ok, true);
    assert.equal(result.message.kind, kind);
    assert.equal(result.message.to, 'customer');
    assert.equal(result.message.sendAt, null);
  }
  assert.deepEqual(booking('bk_seed_08').history.slice(-3).map((h) => [h.event, h.note]), [['message', 'Running late'], ['message', 'Need access'], ['message', 'Quote ready']]);
  assert.equal(sendQuickMessage('bk_seed_08', 'customer_completed').reason, 'invalid');
  assert.equal(sendQuickMessage('nope', 'customer_running_late').reason, 'not_found');

  const nudge = sendPaymentNudge('bk_seed_06');
  assert.equal(nudge.ok, true);
  assert.equal(nudge.message.kind, 'customer_payment_nudge');
  assert.ok(nudge.message.body.includes('£75 is due for Fault finding and repairs on Fri 23 Oct'));
  assert.equal(booking('bk_seed_06').history.at(-1).note, 'Payment reminder');
  assert.equal(sendPaymentNudge('bk_seed_05').reason, 'bad_transition', 'paid');
  assert.equal(sendPaymentNudge('bk_seed_08').reason, 'bad_transition', 'not done');
  assert.equal(sendPaymentNudge('nope').reason, 'not_found');

  assert.equal(booking('bk_seed_05').reviewRequested, false);
  const review = sendReviewRequest('bk_seed_05');
  assert.equal(review.ok, true);
  assert.equal(review.message.kind, 'customer_review_request');
  assert.equal(review.message.sendAt, null, 'logged immediately');
  assert.equal(booking('bk_seed_05').reviewRequested, true);
  assert.equal(sendReviewRequest('bk_seed_05').reason, 'bad_transition', 'not twice');
  assert.equal(sendReviewRequest('bk_seed_01').reason, 'bad_transition', 'already requested at seeding');
  assert.equal(sendReviewRequest('bk_seed_08').reason, 'bad_transition', 'not done yet');
});

test('sendMessageNow turns a scheduled message into a sent one', () => {
  const reminder = getState().messages.find((m) => m.id === 'msg_seed_08_rem');
  assert.equal(reminder.sendAt, '2026-10-23T18:00', 'already due at 20:30');
  const made = createBooking(eicrDraft());
  const scheduled = made.messages[0];
  assert.equal(scheduled.kind, 'customer_reminder');
  setClock(new Date(2026, 9, 23, 21, 5));
  const result = sendMessageNow(scheduled.id);
  assert.equal(result.ok, true);
  assert.equal(result.message.sendAt, null);
  assert.equal(result.message.at, '2026-10-23T21:05');
  assert.equal(selectMessages(getState())[0].id, scheduled.id, 'now the newest');
  assert.equal(sendMessageNow(scheduled.id).ok, true, 'already sent is fine');
  assert.equal(sendMessageNow('msg_nope').reason, 'not_found');
});

test('message seq strictly increases and unread counts follow markMessagesSeen', () => {
  const seqs = [];
  const a = createBooking(draftFor());
  const b = createBooking(eicrDraft());
  const c = createBooking(urgentDraft());
  for (const r of [a, b, c]) for (const m of r.messages) seqs.push(m.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  assert.equal(new Set(seqs).size, seqs.length);
  assert.equal(seqs[0], 29);
  assert.equal(getState().meta.msgSeq, seqs.at(-1));
  for (const r of [a, b, c]) assert.equal(r.messages.at(-1).seq, Math.max(...r.messages.map((m) => m.seq)), 'the owner alert is the highest of its group');
  assert.equal(selectUnreadMessageCount(getState()), 3);
  assert.equal(markMessagesSeen().ok, true);
  assert.equal(selectUnreadMessageCount(getState()), 0);
  assert.equal(getState().meta.messagesSeenSeq, getState().meta.msgSeq);
  // same frozen minute, after the owner looked: still counts
  assert.equal(createBooking(draftFor({ date: '2026-10-29', windowId: 1 })).ok, true);
  assert.equal(selectUnreadMessageCount(getState()), 1);
  assert.equal(getState().messages.at(-1).at, NOW);
});

// ---------- the diary: blocks, days off, full days ----------

test('addBlock, blockRange, removeBlock, removeBlockGroup', () => {
  const one = addBlock({ date: '2026-10-24', windowId: 0, label: 'Dentist' });
  assert.equal(one.ok, true);
  assert.equal(one.block.label, 'Dentist');
  assert.equal(one.block.groupId, null);
  assert.equal(one.block.seed, false);
  assert.ok(one.undoToken);
  assert.equal(slotStates('2026-10-24')[0], 'blocked');
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Mon 26 Oct, 8–10am', 'F7: the landing page moves on');
  assert.equal(addBlock({ date: '2026-10-24', windowId: 1 }).reason, 'booked', 'Hannah is in window 1');
  assert.equal(addBlock({ date: '2026-10-24', windowId: 0 }).reason, 'invalid', 'already blocked');
  assert.equal(addBlock({ date: 'nope', windowId: 0 }).reason, 'invalid');
  assert.equal(addBlock({ date: '2026-10-26', windowId: 9 }).reason, 'invalid');
  assert.equal(addBlock({ date: '2026-10-29', windowId: 3 }).block.label, 'Blocked', 'default label');

  const range = blockRange({ fromDate: '2026-10-26', toDate: '2026-10-27', windowIds: [0, 1, 2, 3], label: 'Course' });
  assert.equal(range.ok, true);
  assert.equal(range.added.length, 2, 'Monday afternoon holds the EICR and Tuesday is full of jobs');
  assert.deepEqual(range.added.map((b) => `${b.date}/${b.windowId}`), ['2026-10-26/0', '2026-10-26/1']);
  assert.deepEqual(range.skipped.map((s) => `${s.date}/${s.windowId}/${s.reason}`), [
    '2026-10-26/2/booked', '2026-10-26/3/booked', '2026-10-27/0/booked', '2026-10-27/1/booked', '2026-10-27/2/booked', '2026-10-27/3/booked'
  ]);
});

test('blockRange: one shared groupId, defaults, validation and unblocking a group', () => {
  const range = blockRange({ fromDate: '2026-10-29', label: 'Training' });
  assert.equal(range.ok, true);
  assert.deepEqual(range.added.map((b) => b.windowId), [1, 2, 3], 'Kwame holds window 0');
  assert.deepEqual(range.skipped, [{ date: '2026-10-29', windowId: 0, reason: 'booked' }]);
  const group = new Set(range.added.map((b) => b.groupId));
  assert.equal(group.size, 1);
  assert.match([...group][0], /^grp_[0-9a-z]{8}$/);
  assert.ok(range.undoToken);
  assert.equal(slotStates('2026-10-29').join(), 'booked,blocked,blocked,blocked');
  // until a date, days off excluded by the engine but blocks are still stored per window
  const week = blockRange({ fromDate: '2026-11-02', toDate: '2026-11-04', windowIds: [0, 1], label: 'Holiday' });
  assert.equal(week.added.length, 6);
  assert.equal(new Set(week.added.map((b) => b.groupId)).size, 1);
  // default label and default single day
  assert.equal(blockRange({ fromDate: '2026-11-05', windowIds: [2] }).added[0].label, 'Blocked');
  // blocking again adds nothing new
  const again = blockRange({ fromDate: '2026-11-02', toDate: '2026-11-04', windowIds: [0, 1], label: 'Holiday' });
  assert.equal(again.ok, true);
  assert.deepEqual(again.added, []);
  assert.equal(again.undoToken, null);
  // validation
  assert.equal(blockRange({ fromDate: 'x' }).reason, 'invalid');
  assert.equal(blockRange({ fromDate: '2026-11-05', toDate: '2026-11-01' }).reason, 'invalid');
  assert.equal(blockRange({ fromDate: '2026-11-05', windowIds: [] }).reason, 'invalid');
  assert.equal(blockRange({ fromDate: '2026-11-05', windowIds: [7] }).reason, 'invalid');
  // remove one, then the whole group
  const gid = week.added[0].groupId;
  assert.equal(removeBlock(week.added[0].id).ok, true);
  assert.equal(getState().blocks.filter((b) => b.groupId === gid).length, 5);
  const gone = removeBlockGroup(gid);
  assert.equal(gone.ok, true);
  assert.equal(getState().blocks.filter((b) => b.groupId === gid).length, 0);
  assert.equal(removeBlock('blk_nope').reason, 'not_found');
  assert.equal(removeBlockGroup('grp_nope').reason, 'not_found');
  assert.equal(removeBlockGroup(null).reason, 'not_found');
  // the seeded Van MOT group can be removed as a whole
  assert.equal(removeBlockGroup('grp_seed_01').ok, true);
  assert.equal(getDayLoad(getState(), '2026-10-28').level, 'good');
});

test('addDaysOff, removeDayOff, setDayFull and what customers see (F9, F10)', () => {
  const result = addDaysOff(['2026-10-24'], 'Day off');
  assert.equal(result.ok, true);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].date, '2026-10-24');
  assert.equal(result.added[0].label, 'Day off');
  assert.match(result.added[0].id, /^off_[0-9a-z]{8}$/);
  assert.equal(result.bookedCount, 1, 'Hannah stays in the diary');
  assert.ok(result.undoToken);
  assert.equal(booking('bk_seed_08').status, 'confirmed');
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Mon 26 Oct, 8–10am');
  assert.equal(getDayLoad(getState(), '2026-10-24').level, 'closed');
  const week = addDaysOff(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-24', '2026-10-26'], 'Holiday');
  assert.deepEqual(week.added.map((d) => d.date), ['2026-10-26', '2026-10-27', '2026-10-28'], 'duplicates and existing days are skipped');
  assert.equal(week.bookedCount, 6, 'Monday EICR, four Tuesday jobs and Hannah on the already-off Saturday; they all stay');
  assert.equal(addDaysOff([]).reason, 'invalid');
  assert.equal(addDaysOff(['nope']).reason, 'invalid');
  assert.equal(addDaysOff('2026-10-24').reason, 'invalid');
  assert.equal(removeDayOff(result.added[0].id).ok, true);
  assert.equal(getState().settings.daysOff.some((d) => d.id === result.added[0].id), false);
  assert.equal(removeDayOff('off_nope').reason, 'not_found');

  // F9: Taking bookings today
  setClock(new Date(2026, 9, 23, 9, 30));
  initStore({ storage, force: true });
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Today, 1–3pm');
  const off = setDayFull('2026-10-23', true);
  assert.equal(off.ok, true);
  assert.ok(off.undoToken);
  assert.deepEqual(getState().settings.fullDays, ['2026-10-23']);
  assert.equal(getDayLoad(getState(), '2026-10-23').level, 'full');
  assert.notEqual(nextFreeSlot(getState(), 'fault').human.slice(0, 5), 'Today');
  assert.equal(setDayFull('2026-10-23', true).ok, true, 'idempotent');
  assert.equal(getState().settings.fullDays.length, 1);
  assert.equal(setDayFull('2026-10-23', false).ok, true);
  assert.deepEqual(getState().settings.fullDays, []);
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Today, 1–3pm');
  assert.equal(setDayFull('nope', true).reason, 'invalid');
});

// ---------- settings ----------

test('updateSettings: trims, normalises the phone, merges business, replaces hours', () => {
  const result = updateSettings({ business: { name: '  Ashby Sparks ', shortName: 'Ashby', ownerFirstName: 'Lee', phone: '07700900555', tagline: ' Spark joy. ' } });
  assert.equal(result.ok, true);
  const biz = getState().settings.business;
  assert.equal(biz.name, 'Ashby Sparks');
  assert.equal(biz.shortName, 'Ashby');
  assert.equal(biz.ownerFirstName, 'Lee');
  assert.equal(biz.ownerFullName, 'Lee Mercer', 'the first word of the full name follows the first name');
  assert.equal(biz.phone, '07700 900555');
  assert.equal(biz.tagline, 'Spark joy.');
  assert.equal(biz.email, 'dan@voltmere.example', 'untouched fields stay');
  assert.deepEqual(biz.coveredOutward.slice(0, 2), ['MB1', 'MB2']);
  assert.equal(result.settings, getState().settings);
  // the rebrand reaches the next message
  const made = createBooking(draftFor());
  assert.ok(made.messages[1].body.startsWith("Hi Priya, it's Lee from Ashby Sparks."));
  assert.equal(made.messages.at(-1).toName, 'Lee Mercer');
  assert.equal(made.messages.at(-1).toPhone, '07700 900555');
  updateSettings({ business: { ownerFullName: 'Lee Ashby' } });
  assert.equal(getState().settings.business.ownerFullName, 'Lee Ashby');
  updateSettings({ business: { ownerFirstName: 'Pat', ownerFullName: 'Patricia Ashby' } });
  assert.equal(getState().settings.business.ownerFullName, 'Patricia Ashby', 'an explicit full name wins');

  const hours = [[], [0, 1], [2, 3, 2], [], [], [], [3, 1]];
  assert.equal(updateSettings({ hours }).ok, true);
  assert.deepEqual(getState().settings.hours, [[], [0, 1], [2, 3], [], [], [], [1, 3]]);
  assert.equal(updateSettings({ leadMinutes: 180, maxDaysAhead: 28, autoConfirm: false, takingEmergencies: false, remindersOn: false }).ok, true);
  const s = getState().settings;
  assert.deepEqual([s.leadMinutes, s.maxDaysAhead, s.autoConfirm, s.takingEmergencies, s.remindersOn], [180, 28, false, false, false]);
  assert.equal(updateSettings({}).ok, true);
});

test('updateSettings validation: exact messages, and a failed patch changes nothing', () => {
  const raw = storage.getItem(STORAGE_KEYS.state);
  const before = getState();
  const bad = updateSettings({ business: { name: '  ', shortName: '', ownerFirstName: ' ', phone: '01234 567890', tagline: 'new' }, leadMinutes: 75, maxDaysAhead: 10 });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid');
  assert.deepEqual(bad.errors, {
    name: "This can't be empty.", shortName: "This can't be empty.", ownerFirstName: "This can't be empty.",
    phone: 'Enter a UK mobile like 07700 900412', leadMinutes: 'Choose 1 hour, 90 minutes, 2, 3 or 4 hours.', maxDaysAhead: 'Choose 7, 14, 21 or 28 days.'
  });
  assert.equal(getState(), before);
  assert.equal(storage.getItem(STORAGE_KEYS.state), raw);
  assert.equal(getState().settings.business.tagline, 'Local electrician. Booked in 60 seconds.', 'the valid part was not applied either');
  for (const lead of [60, 90, 120, 180, 240]) assert.equal(updateSettings({ leadMinutes: lead }).ok, true, String(lead));
  for (const days of [7, 14, 21, 28]) assert.equal(updateSettings({ maxDaysAhead: days }).ok, true, String(days));
  assert.equal(updateSettings({ leadMinutes: '90' }).reason, 'invalid');
  assert.equal(updateSettings({ hours: [[0]] }).reason, 'invalid');
  assert.equal(updateSettings({ hours: [[], [], [], [], [], [], [4]] }).reason, 'invalid');
  assert.equal(updateSettings({ hours: 'always' }).reason, 'invalid');
  assert.equal(updateSettings({ business: { phone: '' } }).errors.phone, 'Enter a UK mobile like 07700 900412');
  assert.equal(updateSettings({ business: { email: '' } }).ok, true, 'email may be blank');
});

test('settings changes reach the availability engine at once (notice, horizon, hours)', () => {
  assert.equal(slotStates('2026-10-24')[0], 'free');
  updateSettings({ hours: [[], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [1]] });
  assert.equal(slotStates('2026-10-24')[0], 'closed');
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Mon 26 Oct, 8–10am', 'Saturday window 1 is Hannah and window 0 is now closed');
  updateSettings({ maxDaysAhead: 7 });
  assert.equal(isSlotFree(getState(), { date: '2026-10-29', windowId: 1 }), true);
  assert.equal(isSlotFree(getState(), { date: '2026-10-30', windowId: 1 }), false);
});

test('updateService: prices, variants, headline recompute, free and inactive services', () => {
  const fault = updateService('fault', { price: 80, name: ' Fault finding ', description: 'Found and fixed.', active: true });
  assert.equal(fault.ok, true);
  assert.equal(fault.service.price, 80);
  assert.equal(fault.service.name, 'Fault finding');
  assert.equal(fault.service.description, 'Found and fixed.');
  assert.equal(createBooking(draftFor()).booking.quotedPrice, 80, 'new bookings quote the live price');
  assert.equal(booking('bk_seed_08').quotedPrice, 75, 'existing bookings keep theirs');

  const eicr = updateService('eicr', { variants: [{ id: 'flat', price: 120 }, { id: 'house', price: 180 }, { id: 'large', price: 240 }] });
  assert.equal(eicr.ok, true);
  assert.deepEqual(eicr.service.variants.map((v) => v.price), [120, 180, 240]);
  assert.equal(eicr.service.price, 120, 'the headline follows the lowest variant');
  assert.equal(createBooking(eicrDraft({ variantId: 'large' })).booking.quotedPrice, 240);
  updateService('eicr', { variants: [{ id: 'flat', price: 300 }, { id: 'unknown', price: 1 }] });
  assert.equal(getState().settings.services.find((s) => s.id === 'eicr').price, 180, 'recomputed across all variants');
  assert.equal(updateService('rewire', { price: 50 }).service.price, 0, 'price is ignored for free services');
  assert.equal(updateService('ev', { active: false }).service.active, false);
  assert.equal(createBooking(eicrDraft({ serviceId: 'ev', variantId: undefined, date: '2026-10-26', windowId: 2 })).reason, 'service_unavailable');

  const raw = storage.getItem(STORAGE_KEYS.state);
  for (const price of [-1, 1.5, 100000, '80', null, NaN]) {
    const bad = updateService('sockets', { price });
    assert.equal(bad.reason, 'invalid', String(price));
    assert.deepEqual(bad.errors, { price: 'Enter a whole number of pounds.' });
  }
  assert.equal(updateService('sockets', { variants: [{ id: 'x', price: 1.5 }] }).reason, 'invalid');
  assert.equal(updateService('sockets', { name: '  ' }).reason, 'invalid');
  assert.equal(updateService('nope', { price: 1 }).reason, 'not_found');
  assert.equal(storage.getItem(STORAGE_KEYS.state), raw, 'failures wrote nothing');
  assert.equal(updateService('sockets', { price: 0 }).ok, true, '0 is a valid whole number');
  assert.equal(updateService('sockets', { price: 99999 }).ok, true);
});

test('setTheme writes vm_theme and the settings mirror; setDemoPhone stores digits only', () => {
  assert.equal(setTheme('dark').ok, true);
  assert.equal(storage.getItem(STORAGE_KEYS.theme), 'dark');
  assert.equal(getState().settings.theme, 'dark');
  assert.equal(setTheme('light').ok, true);
  assert.equal(storage.getItem(STORAGE_KEYS.theme), 'light');
  assert.equal(setTheme('auto').ok, true);
  assert.equal(getState().settings.theme, 'auto');
  assert.equal(setTheme('purple').reason, 'invalid');
  assert.equal(storage.getItem(STORAGE_KEYS.theme), 'auto');
  let calls = 0;
  const off = subscribe(() => { calls += 1; });
  setTheme('dark');
  assert.equal(calls, 1, 'the mirror write notifies, so the other page re-applies the theme');
  off();

  const demo = setDemoPhone('07700 900555');
  assert.deepEqual(demo, { ok: true, digits: '447700900555' });
  assert.equal(getState().settings.demoPhoneDigits, '447700900555');
  assert.equal(setDemoPhone('+1 202 555 0123').digits, '12025550123');
  assert.deepEqual(setDemoPhone(''), { ok: true, digits: '' });
  assert.equal(getState().settings.demoPhoneDigits, '');
  assert.equal(setDemoPhone('hello').reason, 'invalid');
  assert.equal(setDemoPhone('12345').reason, 'invalid');
  assert.equal(getState().settings.demoPhoneDigits, '');
});

// ---------- demo tools ----------

test('resetDemo keeps settings by default and clears days off, full days and messages', () => {
  updateSettings({ business: { name: 'Ashby Sparks', shortName: 'Ashby', ownerFirstName: 'Lee' }, leadMinutes: 120 });
  updateService('fault', { price: 99 });
  setDemoPhone('07700 900555');
  setTheme('dark');
  addDaysOff(['2026-10-24']);
  setDayFull('2026-10-30', true);
  createBooking(draftFor({ date: '2026-10-26', windowId: 1 }));
  simulateIncomingBooking();
  markMessagesSeen();
  const revBefore = getState().meta.rev;
  const result = resetDemo();
  assert.deepEqual(result, { ok: true });
  const s = getState();
  assert.equal(s.bookings.length, 15);
  assert.ok(s.bookings.every((b) => b.seed));
  assert.equal(s.refSeq, 1043);
  assert.equal(s.seededFor, '2026-10-23');
  assert.equal(s.settings.business.name, 'Ashby Sparks');
  assert.equal(s.settings.leadMinutes, 120);
  assert.equal(s.settings.services.find((x) => x.id === 'fault').price, 99);
  assert.equal(s.settings.demoPhoneDigits, '447700900555');
  assert.equal(s.settings.theme, 'dark');
  assert.deepEqual(s.settings.daysOff, []);
  assert.deepEqual(s.settings.fullDays, []);
  assert.equal(s.bookings.find((b) => b.id === 'bk_seed_08').quotedPrice, 99, 'the seed uses the live prices');
  assert.ok(s.messages.every((m) => m.seed));
  assert.equal(s.messages.length, 28);
  assert.equal(s.meta.rev, revBefore + 1, 'rev keeps counting up');
  assert.equal(s.meta.msgSeq, 28);
  assert.equal(s.meta.messagesSeenSeq, 28);
  assert.equal(s.meta.simCursor, 0);
  assert.equal(selectUnreadMessageCount(s), 0);
  assert.equal(createBooking(draftFor()).booking.ref, 'VM-1043', 'F11: the next booking is VM-1043 again');
});

test('resetDemo({ keepSettings: false }) restores defaults except theme and demo phone', () => {
  updateSettings({ business: { name: 'Ashby Sparks', shortName: 'Ashby', ownerFirstName: 'Lee' }, autoConfirm: false });
  updateService('fault', { price: 99 });
  setDemoPhone('07700 900555');
  setTheme('light');
  addDaysOff(['2026-10-24']);
  resetDemo({ keepSettings: false });
  const s = getState();
  const defaults = makeDefaultSettings();
  assert.deepEqual({ ...s.settings, theme: 'auto', demoPhoneDigits: '' }, defaults);
  assert.equal(s.settings.theme, 'light');
  assert.equal(s.settings.demoPhoneDigits, '447700900555');
  assert.equal(s.bookings.length, 15);
});

test('simulateIncomingBooking: standard, approval and emergency, cycling through the pool', () => {
  const standard = simulateIncomingBooking();
  assert.equal(standard.ok, true);
  const b = standard.booking;
  assert.equal(b.ref, 'VM-1043');
  assert.equal(b.source, 'website');
  assert.equal(b.serviceId, 'fault');
  assert.equal(b.status, 'confirmed');
  assert.equal(b.start, '2026-10-24T08:00', 'the earliest free window');
  assert.equal(b.customer.name, SIM_POOL[0].name);
  assert.equal(b.customer.phone, SIM_POOL[0].phone);
  assert.equal(b.seenByOwner, false);
  assert.equal(getState().meta.simCursor, 1);
  assert.equal(kinds(standard.messages).at(-1), 'owner_new_booking');

  const approval = simulateIncomingBooking({ kind: 'approval' });
  assert.equal(approval.booking.status, 'new');
  assert.equal(approval.booking.address.postcode, 'MB11 5HD');
  assert.equal(approval.booking.customer.name, SIM_POOL[1].name);
  assert.equal(approval.booking.start, '2026-10-26T08:00', 'Saturday is now full of Hannah and the first sample');
  assert.deepEqual(kinds(approval.messages), ['customer_received', 'owner_new_booking']);
  assert.ok(ids(selectNeedsYou(getState())).includes(approval.booking.id));

  const emergency = simulateIncomingBooking({ kind: 'emergency' });
  assert.equal(emergency.booking.urgent, true);
  assert.equal(emergency.booking.status, 'new');
  assert.equal(emergency.booking.serviceId, 'emergency');
  assert.deepEqual(emergency.booking.emergencyReasons, ['no_power']);
  assert.equal(emergency.booking.notes, 'Power went off suddenly');
  assert.equal(emergency.booking.customer.name, SIM_POOL[2].name);
  assert.equal(getState().meta.simCursor, 3);

  // eight pool entries, then back to the first
  for (let i = 3; i < 8; i += 1) assert.equal(simulateIncomingBooking().booking.customer.name, SIM_POOL[i].name);
  assert.equal(getState().meta.simCursor, 8);
  assert.equal(simulateIncomingBooking().booking.customer.name, SIM_POOL[0].name, 'the cursor cycles');
  assert.equal(getState().meta.simCursor, 9);
});

test('simulateIncomingBooking follows the settings and reports slot_taken when nothing is free', () => {
  updateSettings({ autoConfirm: false });
  assert.equal(simulateIncomingBooking().booking.status, 'new', 'standard follows the auto-confirm setting');
  updateSettings({ autoConfirm: true, takingEmergencies: false });
  const off = simulateIncomingBooking({ kind: 'emergency' });
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'emergencies_off');
  const cursor = getState().meta.simCursor;
  updateSettings({ hours: [[], [], [], [], [], [], []] });
  const none = simulateIncomingBooking();
  assert.equal(none.ok, false);
  assert.equal(none.reason, 'slot_taken');
  assert.equal(getState().meta.simCursor, cursor, 'a failed simulation does not move the cursor');
});

// ---------- undo ----------

test('undo of a confirm restores the booking and removes the messages it added (F2)', () => {
  const made = simulateIncomingBooking({ kind: 'approval' });
  const id = made.booking.id;
  const messagesBefore = getState().messages.length;
  const confirmed = confirmBooking(id);
  assert.equal(booking(id).status, 'confirmed');
  assert.equal(getState().messages.length, messagesBefore + 2);
  assert.deepEqual(undo(confirmed.undoToken), { ok: true });
  assert.equal(booking(id).status, 'new');
  assert.equal(booking(id).history.length, 1);
  assert.equal(getState().messages.length, messagesBefore);
  assert.equal(selectMessages(getState())[0].kind, 'owner_new_booking', 'the confirmation is gone');
  assert.equal(undo(confirmed.undoToken).reason, 'stale', 'a token works once');
});

test('undo returns stale after a later change to the same record, and for unknown tokens', () => {
  const confirmed = confirmBooking('bk_seed_11');
  updateBooking('bk_seed_11', { internalNotes: 'rang the customer' });
  assert.deepEqual(undo(confirmed.undoToken), { ok: false, reason: 'stale' });
  assert.equal(booking('bk_seed_11').status, 'confirmed', 'nothing was undone');
  assert.deepEqual(undo('undo_nope'), { ok: false, reason: 'stale' });
  assert.deepEqual(undo(undefined), { ok: false, reason: 'stale' });
  // a later change to a touched MESSAGE is stale too
  const paid = markPaid('bk_seed_04', 'cash');
  markUnpaid('bk_seed_04');
  assert.equal(undo(paid.undoToken).reason, 'stale');
});

test('undo of every status change puts everything back exactly', () => {
  const snapshot = () => JSON.stringify({ b: getState().bookings, m: getState().messages, blocks: getState().blocks, s: getState().settings });
  const cases = [
    () => confirmBooking('bk_seed_11'),
    () => acceptEmergency('bk_seed_07', 60),
    () => declineBooking('bk_seed_11'),
    () => markOnTheWay('bk_seed_08', 30),
    () => completeBooking('bk_seed_08', { finalPrice: 95, paid: true, paidMethod: 'card' }),
    () => completeBooking('bk_seed_08', { finalPrice: 95, sendReview: false }),
    () => markPaid('bk_seed_06', 'bank'),
    () => cancelBooking('bk_seed_08', 'owner', { reason: 'Duplicate' }),
    () => cancelBooking('bk_seed_08', 'owner', { notify: false }),
    () => rescheduleBooking('bk_seed_08', { date: '2026-10-26', windowId: 1 }),
    () => rescheduleBooking('bk_seed_09', { date: '2026-10-29', windowId: 2 }),
    () => addBlock({ date: '2026-10-24', windowId: 0, label: 'Dentist' }),
    () => blockRange({ fromDate: '2026-10-29', label: 'Training' }),
    () => removeBlock('blk_seed_01'),
    () => removeBlockGroup('grp_seed_01'),
    () => addDaysOff(['2026-10-24', '2026-10-26']),
    () => setDayFull('2026-10-24', true)
  ];
  for (const run of cases) {
    const before = snapshot();
    const revBefore = getState().meta.rev;
    const result = run();
    assert.equal(result.ok, true, run.toString());
    assert.ok(result.undoToken, `${run.toString()} returns a token`);
    assert.notEqual(snapshot(), before);
    assert.deepEqual(undo(result.undoToken), { ok: true }, run.toString());
    assert.equal(snapshot(), before, `undo restores everything: ${run.toString()}`);
    assert.equal(getState().meta.rev > revBefore, true, 'undo is itself a write');
  }
  // and undoing a day off / full day / block shows up in availability straight away
  const off = addDaysOff(['2026-10-24']);
  assert.equal(getDayLoad(getState(), '2026-10-24').level, 'closed');
  undo(off.undoToken);
  assert.equal(getDayLoad(getState(), '2026-10-24').level, 'few');
});

test('undo of a cancel returns stale when another booking has since taken the freed window', () => {
  const cancelled = cancelBooking('bk_seed_08', 'owner');
  assert.equal(slotStates('2026-10-24')[1], 'free');
  const taken = createBooking(draftFor({ date: '2026-10-24', windowId: 1, customer: { name: 'Tom Hargreaves', phone: '07700 900288' } }));
  assert.equal(taken.ok, true);
  assert.deepEqual(undo(cancelled.undoToken), { ok: false, reason: 'stale' });
  assert.equal(booking('bk_seed_08').status, 'cancelled');
  assert.equal(ids(getState().bookings.filter((b) => b.start === '2026-10-24T10:00' && b.status !== 'cancelled')).length, 1, 'never a double booking');
  // the same for a decline
  const declined = declineBooking('bk_seed_11');
  createBooking(draftFor({ date: '2026-10-27', windowId: 1, asOwner: true }));
  assert.equal(undo(declined.undoToken).reason, 'stale');
  // a reschedule cannot be undone into a window somebody has taken since
  const moved = rescheduleBooking('bk_seed_14', { date: '2026-10-26', windowId: 1 });
  createBooking(draftFor({ date: '2026-10-29', windowId: 0, asOwner: true }));
  assert.equal(undo(moved.undoToken).reason, 'stale');
  assert.equal(booking('bk_seed_14').start, '2026-10-26T10:00');
  // a block cannot be put back over a booking made since it was removed
  const unblocked = removeBlock('blk_seed_01');
  createBooking(draftFor({ date: '2026-10-28', windowId: 0, asOwner: true }));
  assert.equal(undo(unblocked.undoToken).reason, 'stale');
  assert.equal(getState().blocks.some((b) => b.id === 'blk_seed_01'), false);
});

test('undo tokens: at most 20 are kept and a reset clears them', () => {
  const first = setDayFull('2026-10-30', true);
  for (let i = 0; i < 20; i += 1) setDayFull(`2026-11-${String(i + 1).padStart(2, '0')}`, true);
  assert.equal(undo(first.undoToken).reason, 'stale', 'the oldest was dropped');
  const tokens = [];
  for (let i = 0; i < 20; i += 1) tokens.push(setDayFull(`2026-12-${String(i + 1).padStart(2, '0')}`, true).undoToken);
  assert.equal(undo(tokens[19]).ok, true, 'the newest is kept');
  const t = setDayFull('2027-01-01', true).undoToken;
  resetDemo();
  assert.equal(undo(t).reason, 'stale');
});

// ---------- cross-tab sync ----------

async function otherTab() {
  return import(`../../js/core/store.js?tab=${Math.random().toString(36).slice(2)}`);
}

test('syncFromStorage picks up an externally written newer rev and notifies subscribers', async () => {
  const tabB = await otherTab();
  tabB.initStore({ storage, force: true });
  const calls = [];
  const off = subscribe((state, prev) => calls.push([state, prev]));
  assert.equal(syncFromStorage(), false, 'nothing changed yet');
  const made = tabB.createBooking(draftFor());
  assert.equal(made.ok, true);
  assert.equal(getState().bookings.length, 15, 'this tab has not looked yet');
  assert.equal(syncFromStorage(), true);
  assert.equal(getState().bookings.length, 16);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], getState());
  assert.equal(calls[0][1].bookings.length, 15);
  assert.equal(selectBookingByRef(getState(), 'VM-1043').id, made.booking.id);
  assert.equal(syncFromStorage(), false, 'the same string again changes nothing');
  assert.equal(calls.length, 1);
  off();
});

test('two tabs that both advanced to the same rev are still told apart (the raw string is compared)', async () => {
  const tabB = await otherTab();
  tabB.initStore({ storage, force: true });
  // tab A writes a change, then tab B overwrites storage with a DIFFERENT state at the same rev
  confirmBooking('bk_seed_11');
  const revA = getState().meta.rev;
  const stored = JSON.parse(storage.getItem(STORAGE_KEYS.state));
  const sibling = { ...stored, settings: { ...stored.settings, business: { ...stored.settings.business, tagline: 'Written by the other tab' } } };
  storage.setItem(STORAGE_KEYS.state, JSON.stringify(sibling));
  assert.equal(sibling.meta.rev, revA);
  assert.equal(syncFromStorage(), true);
  assert.equal(getState().settings.business.tagline, 'Written by the other tab');
  assert.equal(getState().meta.rev, revA);
});

test('every mutation re-reads storage first, so two tabs cannot clobber each other', async () => {
  const tabB = await otherTab();
  tabB.initStore({ storage, force: true });
  const fromB = tabB.createBooking(draftFor());
  assert.equal(fromB.booking.ref, 'VM-1043');
  // tab A has NOT synced; its booking must see tab B's and get the next ref, not overwrite it
  const fromA = createBooking(draftFor({ date: '2026-10-26', windowId: 1 }));
  assert.equal(fromA.ok, true);
  assert.equal(fromA.booking.ref, 'VM-1044');
  assert.equal(getState().bookings.length, 17);
  assert.ok(selectBookingByRef(getState(), 'VM-1043'));
  // and the race of F7: both tabs go for the same window; the second one gets slot_taken
  const clash = tabB.createBooking(draftFor({ date: '2026-10-26', windowId: 1, customer: { name: 'Tom Hargreaves', phone: '07700 900288' } }));
  assert.equal(clash.reason, 'slot_taken');
  assert.equal(clash.alternatives.length, 3);
  // a confirm made in tab A is visible to tab B (F20)
  const approval = tabB.createBooking(draftFor({ date: '2026-10-26', windowId: 0, address: { line1: 'Mill Cottage', postcode: 'MB12 6AB' } }));
  assert.equal(approval.booking.status, 'new');
  assert.equal(confirmBooking(approval.booking.id).ok, true);
  assert.equal(tabB.syncFromStorage(), true);
  assert.equal(selectBookingById(tabB.getState(), approval.booking.id).status, 'confirmed');
});

test('browser events trigger a re-read: storage, pageshow, focus and visibilitychange', async () => {
  const tabB = await otherTab();
  tabB.initStore({ storage, force: true });
  assert.ok(handlers.window.storage?.length >= 1, 'a storage listener is installed');
  assert.ok(handlers.window.pageshow?.length >= 1);
  assert.ok(handlers.window.focus?.length >= 1);
  assert.ok(handlers.document.visibilitychange?.length >= 1);
  const count = () => getState().bookings.length;
  const slots = [['2026-10-26', 0], ['2026-10-26', 1], ['2026-10-29', 1], ['2026-10-29', 2], ['2026-10-29', 3], ['2026-10-30', 0], ['2026-10-30', 1]];
  let n = 0;
  const next = () => {
    const [date, windowId] = slots[n];
    n += 1;
    return tabB.createBooking(draftFor({ date, windowId, customer: { name: `Visitor ${n}`, phone: '07700 900288' }, address: { line1: `${n} Road`, postcode: 'MB3 4QP' }, serviceId: 'sockets' })).ok;
  };
  assert.equal(next(), true);
  fire('window', 'storage', { key: 'some_other_key' });
  assert.equal(count(), 15, 'other keys are ignored');
  fire('window', 'storage', { key: STORAGE_KEYS.state });
  assert.equal(count(), 16);
  assert.equal(next(), true);
  fire('window', 'storage', { key: null });
  assert.equal(count(), 17, 'clear() events (key null) re-read as well');
  assert.equal(next(), true);
  fire('window', 'pageshow', {});
  assert.equal(count(), 18);
  assert.equal(next(), true);
  fire('window', 'focus', {});
  assert.equal(count(), 19);
  assert.equal(next(), true);
  fakeDocument.visibilityState = 'hidden';
  fire('document', 'visibilitychange', {});
  assert.equal(count(), 19, 'a tab going to the background does not re-read');
  fakeDocument.visibilityState = 'visible';
  fire('document', 'visibilitychange', {});
  assert.equal(count(), 20, 'coming back to the foreground does');
});

test('garbage written by someone else is ignored, a cleared store keeps the page state', () => {
  storage.setItem(STORAGE_KEYS.state, '{not json');
  assert.equal(syncFromStorage(), false);
  assert.equal(getState().bookings.length, 15);
  storage.setItem(STORAGE_KEYS.state, JSON.stringify({ v: 1 }));
  assert.equal(syncFromStorage(), false);
  storage.removeItem(STORAGE_KEYS.state);
  assert.equal(syncFromStorage(), false);
  assert.equal(createBooking(draftFor()).ok, true, 'and the next write restores storage');
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.state)).bookings.length, 16);
});

// ---------- day rollover (8.7.3) ----------

test('a new day reseeds the demo records but keeps what the owner and customers made', () => {
  setClock(new Date(2026, 9, 22, 9, 0));
  initStore({ storage, force: true });
  assert.equal(getState().seededFor, '2026-10-22');
  const eicrSlot = nextFreeSlot(getState(), 'eicr');
  const mine = createBooking(draftFor({ date: eicrSlot.date, windowId: eicrSlot.windowId, serviceId: 'eicr', variantId: 'flat', asOwner: true }));
  assert.equal(mine.ok, true, JSON.stringify(mine));
  const faultSlot = nextFreeSlot(getState(), 'fault');
  const customerMade = createBooking(draftFor({ date: faultSlot.date, windowId: faultSlot.windowId }));
  assert.equal(customerMade.ok, true);
  addBlock({ date: '2026-10-29', windowId: 3, label: 'Dentist' });
  addDaysOff(['2026-10-21', '2026-10-22', '2026-10-30'], 'Away');
  setDayFull('2026-10-22', true);
  setDayFull('2026-10-27', true);
  updateSettings({ business: { name: 'Ashby Sparks', shortName: 'Ashby', ownerFirstName: 'Lee' } });
  setDemoPhone('07700 900555');
  const msgSeqBefore = getState().meta.msgSeq;
  const nonSeedMessages = getState().messages.filter((m) => !m.seed).map((m) => m.id);
  assert.ok(nonSeedMessages.length >= 4);
  const refSeqBefore = getState().refSeq;

  setClock(new Date(2026, 9, 23, 7, 30));
  const state = initStore({ storage, force: true });
  assert.equal(state.seededFor, '2026-10-23');
  assert.equal(state.bookings.filter((b) => b.seed).length, 15, 'a fresh seed relative to the new today');
  assert.equal(state.bookings.filter((b) => !b.seed).length, 2, 'the owner booking and the customer booking survive');
  assert.ok(selectBookingById(state, mine.booking.id));
  assert.ok(selectBookingById(state, customerMade.booking.id));
  assert.equal(state.settings.business.name, 'Ashby Sparks');
  assert.equal(state.settings.demoPhoneDigits, '447700900555');
  assert.deepEqual(state.settings.daysOff.map((d) => d.date), ['2026-10-30'], 'days off before today are dropped');
  assert.deepEqual(state.settings.fullDays, ['2026-10-27'], 'full days before today are dropped');
  assert.deepEqual(state.blocks.filter((b) => !b.seed).map((b) => b.label), ['Dentist']);
  assert.equal(state.blocks.filter((b) => b.seed).length, 4);
  assert.equal(state.refSeq, refSeqBefore, 'refSeq = max(stored, seed)');
  assert.ok(nonSeedMessages.every((id) => state.messages.some((m) => m.id === id)), 'non-seed messages are kept');
  assert.equal(state.messages.filter((m) => m.seed).length, 28);
  assert.ok(state.messages.filter((m) => m.seed).every((m) => m.seq > msgSeqBefore), 'seed seq numbers keep increasing');
  assert.equal(state.meta.msgSeq, msgSeqBefore + 28);
  assert.equal(selectUnreadMessageCount(state), 1, 'only the customer booking\'s alert is unread; the re-seeded alerts never are');
  // no double booking: the seed placed itself around the records that were kept
  const taken = new Map();
  for (const b of state.bookings.filter((x) => x.status !== 'cancelled' && !x.urgent)) {
    for (const w of bookingWindowIds(b)) {
      const key = `${b.start.slice(0, 10)}|${w}`;
      assert.ok(!taken.has(key), `window ${key} is held by both ${taken.get(key)} and ${b.id}`);
      taken.set(key, b.id);
    }
  }
  for (const k of state.blocks) assert.ok(!taken.has(`${k.date}|${k.windowId}`), `block ${k.id} sits on a booking`);
  const seedIds = state.bookings.filter((b) => b.seed).map((b) => b.id);
  assert.deepEqual(seedIds, Array.from({ length: 15 }, (_, i) => `bk_seed_${String(i + 1).padStart(2, '0')}`));
  assert.equal(state.messages.some((m) => m.id === 'msg_seed_07_alert'), true);
  // a booking made after the rollover still gets the next ref
  const slot = nextFreeSlot(getState(), 'fault');
  assert.equal(createBooking(draftFor({ date: slot.date, windowId: slot.windowId })).booking.ref, `VM-${refSeqBefore}`);
});

test('the rollover does not run on tab focus or sync, only when the store starts', () => {
  const before = getState();
  setClock(new Date(2026, 9, 24, 9, 0));
  fire('window', 'focus', {});
  assert.equal(syncFromStorage(), false);
  assert.equal(getState(), before);
  assert.equal(getState().seededFor, '2026-10-23');
  // a mutation does not reseed either
  createBooking(draftFor({ date: '2026-10-26', windowId: 1 }));
  assert.equal(getState().seededFor, '2026-10-23');
  assert.equal(initStore({ storage, force: true }).seededFor, '2026-10-24');
});

test('starting twice on the same day does not reseed (bookings made earlier stay)', () => {
  const made = createBooking(draftFor());
  const again = initStore({ storage, force: true });
  assert.equal(again.seededFor, '2026-10-23');
  assert.ok(selectBookingById(again, made.booking.id));
  assert.equal(again.bookings.length, 16);
});

// ---------- flows from the end-to-end list that the data layer must support ----------

test('F1: a landing page EICR booking becomes a repeat customer job card with three messages', () => {
  const made = createBooking(eicrDraft());
  assert.equal(made.booking.ref, 'VM-1043');
  assert.equal(selectCustomers(getState()).length, 11, 'Priya is an existing customer');
  assert.deepEqual(selectRepeatInfo(getState(), made.booking), { isRepeat: true, nth: 2 });
  const forBooking = selectMessages(getState(), { bookingId: made.booking.id });
  assert.deepEqual(kinds(forBooking), ['owner_new_booking', 'customer_confirmed', 'customer_reminder']);
  assert.equal(forBooking[2].sendAt > NOW, true);
  assert.equal(selectUnreadMessageCount(getState()), 1);
  assert.equal(nextFreeSlot(getState(), 'eicr').human, 'Thu 29 Oct, afternoon, arrive 1–3pm', 'Monday is now full of EICRs, Tuesday is full, Wednesday is the MOT, Thursday morning has Kwame');
});

test('F3: an emergency never changes a window, is accepted from the message bubble and leaves Needs you', () => {
  const loads = () => JSON.stringify(['2026-10-24', '2026-10-26', '2026-10-27'].map((d) => getDayLoad(getState(), d)));
  const before = loads();
  const made = createBooking(urgentDraft({ customer: { name: 'Ngozi Okafor', phone: '07700 900344' }, address: { line1: '9 Orchard Close', postcode: 'MB2 6JN' } }));
  assert.equal(loads(), before, 'Mon 26 Oct load unchanged');
  assert.deepEqual(ids(selectNeedsYou(getState())), ['bk_seed_07', made.booking.id, 'bk_seed_11']);
  const accepted = acceptEmergency('bk_seed_07', 45);
  assert.equal(accepted.ok, true);
  const top = selectMessages(getState())[0];
  assert.equal(top.kind, 'customer_emergency_accepted');
  assert.ok(top.body.includes('45 minutes'));
  assert.deepEqual(ids(selectNeedsYou(getState())), [made.booking.id, 'bk_seed_11']);
});

test('F7: a calendar block moves the landing page on and a taken window is recovered', () => {
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Tomorrow, 8–10am');
  addBlock({ date: '2026-10-24', windowId: 0, label: 'Dentist' });
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Mon 26 Oct, 8–10am');
  const taken = createBooking(draftFor({ date: '2026-10-26', windowId: 1, asOwner: true }));
  assert.equal(taken.ok, true);
  const clash = createBooking(draftFor({ date: '2026-10-26', windowId: 1 }));
  assert.equal(clash.reason, 'slot_taken');
  assert.ok(clash.alternatives.length >= 1);
});

test('undo of an unblock is stale when the window has been blocked again since', () => {
  const first = addBlock({ date: '2026-10-29', windowId: 2, label: 'Dentist' });
  const removed = removeBlock(first.block.id);
  assert.equal(addBlock({ date: '2026-10-29', windowId: 2, label: 'Course' }).ok, true);
  assert.equal(undo(removed.undoToken).reason, 'stale');
  assert.equal(getState().blocks.filter((b) => b.date === '2026-10-29' && b.windowId === 2).length, 1, 'never two blocks on one window');
});

// ---------- a seeded random walk over every operation, checking the diary invariants after each step ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertDiaryInvariants(label) {
  const st = getState();
  for (const key of ['bookings', 'blocks', 'messages']) {
    const list = st[key].map((r) => r.id);
    assert.equal(new Set(list).size, list.length, `${label}: unique ${key} ids`);
  }
  const refs = st.bookings.map((b) => b.ref);
  assert.equal(new Set(refs).size, refs.length, `${label}: unique refs`);
  assert.ok(st.refSeq > Math.max(...refs.map((r) => Number(r.slice(3)))), `${label}: refSeq is ahead of every ref`);
  const seqs = st.messages.map((m) => m.seq);
  assert.equal(new Set(seqs).size, seqs.length, `${label}: unique message seq`);
  assert.ok(Math.max(0, ...seqs) <= st.meta.msgSeq && st.meta.messagesSeenSeq <= st.meta.msgSeq, `${label}: seq bookkeeping`);
  const held = new Map();
  for (const b of st.bookings) {
    if (b.status === 'cancelled' || b.urgent) continue;
    for (const w of bookingWindowIds(b)) {
      const key = `${b.start.slice(0, 10)}|${w}`;
      assert.ok(!held.has(key), `${label}: ${key} is held by ${held.get(key)} and ${b.id}`);
      held.set(key, b.id);
    }
  }
  const blockKeys = st.blocks.map((k) => `${k.date}|${k.windowId}`);
  assert.equal(new Set(blockKeys).size, blockKeys.length, `${label}: one block per window`);
  for (const k of st.blocks) assert.ok(!held.has(`${k.date}|${k.windowId}`), `${label}: block ${k.id} sits on a booking`);
  for (const b of st.bookings) {
    assert.equal(b.paid, !!b.paidMethod && !!b.paidAt, `${label}: ${b.id} paid fields agree`);
    if (b.paid) assert.equal(b.status, 'done', `${label}: ${b.id} is paid so it is done`);
    if (b.status === 'done') assert.ok(Number.isInteger(b.finalPrice), `${label}: ${b.id} has a final price`);
    assert.equal(b.status === 'cancelled', b.cancelledBy !== null, `${label}: ${b.id} cancelledBy`);
  }
  const cancelled = new Set(st.bookings.filter((b) => b.status === 'cancelled').map((b) => b.id));
  for (const m of st.messages) {
    assert.ok(!(cancelled.has(m.bookingId) && m.sendAt && m.sendAt > getNowStamp()), `${label}: ${m.id} is still scheduled for a cancelled booking`);
  }
  assert.equal(storage.getItem(STORAGE_KEYS.state), JSON.stringify(st), `${label}: storage mirrors the state`);
  assert.ok(Object.isFrozen(st));
}

test('property: random sequences of every operation, undo included, keep the diary consistent', () => {
  const SERVICES = ['fault', 'eicr', 'consumer', 'sockets', 'ev', 'rewire'];
  const PEOPLE = [['Priya Nair', '07700 900231'], ['Tom Hargreaves', '07700 900288'], ['Zed Ford', '07700 900612'], ['Amy Lowe', '07700 900613']];
  const POSTCODES = ['MB3 4QP', 'MB12 6AB', 'AB1 2CD', 'MB9 3UE'];
  const origin = new Date(2026, 9, 23, 9, 0);
  for (let seed = 1; seed <= 12; seed += 1) {
    const rand = mulberry32(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const chance = (p) => rand() < p;
    setClock(origin);
    storage = memStorage();
    initStore({ storage, force: true });
    let tokens = [];
    let minutes = 0;
    for (let step = 0; step < 120; step += 1) {
      const st = getState();
      const day = (n) => {
        const d = new Date(2026, 9, 23 + n, 12);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      const someBooking = () => (st.bookings.length ? pick(st.bookings).id : 'bk_missing');
      const op = Math.floor(rand() * 30);
      let result = { ok: true };
      let name = `op ${op}`;
      if (op <= 2) {
        const sid = pick(SERVICES);
        const half = st.settings.services.find((x) => x.id === sid).blocks === 2;
        const [person, phone] = pick(PEOPLE);
        result = createBooking({
          serviceId: sid, variantId: sid === 'eicr' ? pick(['flat', 'house', 'large', undefined]) : undefined,
          date: day(Math.floor(rand() * 16)), windowId: half ? pick([0, 2, 1]) : Math.floor(rand() * 4),
          customer: { name: person, phone }, address: { line1: '1 Test Road', postcode: pick(POSTCODES) },
          asOwner: chance(0.3), notifyCustomer: chance(0.7), source: pick(['website', 'phone', 'whatsapp'])
        });
        name = 'createBooking';
      } else if (op === 3) {
        result = createBooking(urgentDraft());
        name = 'createBooking (urgent)';
      } else if (op === 4) result = confirmBooking(someBooking());
      else if (op === 5) result = acceptEmergency(someBooking(), pick([45, 60, 120]));
      else if (op === 6) result = declineBooking(someBooking());
      else if (op === 7) result = markOnTheWay(someBooking(), pick([15, 30]));
      else if (op === 8) result = completeBooking(someBooking(), { finalPrice: pick([0, 75, 120]), paid: chance(0.5), paidMethod: pick(['cash', 'card', null]), sendReview: chance(0.5) });
      else if (op === 9) result = markPaid(someBooking(), pick(['cash', 'card', 'bank']));
      else if (op === 10) result = markUnpaid(someBooking());
      else if (op === 11) result = cancelBooking(someBooking(), pick(['owner', 'customer']), { reason: pick(['', 'Duplicate']), notify: chance(0.7) });
      else if (op <= 13) result = rescheduleBooking(someBooking(), { date: day(Math.floor(rand() * 16)), windowId: pick([0, 1, 2, 3]) }, pick(['owner', 'customer']), { notify: chance(0.7) });
      else if (op === 14) result = updateBooking(someBooking(), { internalNotes: pick(['', 'x']), quotedPrice: pick([50, 60]) });
      else if (op === 15) result = chance(0.5) ? markSeen(someBooking()) : markAllSeen();
      else if (op === 16) result = [() => sendQuickMessage(someBooking(), 'customer_running_late'), () => sendPaymentNudge(someBooking()), () => sendReviewRequest(someBooking()), () => sendMessageNow(pick(st.messages).id), () => markMessagesSeen()][Math.floor(rand() * 5)]();
      else if (op === 17) result = addBlock({ date: day(Math.floor(rand() * 16)), windowId: pick([0, 1, 2, 3]), label: 'Dentist' });
      else if (op === 18) result = blockRange({ fromDate: day(Math.floor(rand() * 10)), toDate: day(10 + Math.floor(rand() * 5)), windowIds: pick([[0, 1, 2, 3], [0], [2, 3]]), label: 'Course' });
      else if (op === 19) result = st.blocks.length ? (chance(0.5) ? removeBlock(pick(st.blocks).id) : removeBlockGroup(pick(st.blocks).groupId || 'x')) : { ok: true };
      else if (op === 20) result = addDaysOff([day(Math.floor(rand() * 16))]);
      else if (op === 21) result = st.settings.daysOff.length ? removeDayOff(pick(st.settings.daysOff).id) : { ok: true };
      else if (op === 22) result = setDayFull(day(Math.floor(rand() * 16)), chance(0.5));
      else if (op === 23) result = updateSettings(pick([{ leadMinutes: pick([60, 90, 240]) }, { maxDaysAhead: pick([7, 14, 28]) }, { autoConfirm: chance(0.5) }, { remindersOn: chance(0.5) }, { takingEmergencies: chance(0.8) }, { hours: [[], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], pick([[0, 1], [1], [0, 1, 2]])] }]));
      else if (op === 24) result = updateService(pick(SERVICES), pick([{ price: pick([60, 80]) }, { active: chance(0.8) }]));
      else if (op === 25) result = simulateIncomingBooking({ kind: pick(['standard', 'approval', 'emergency']) });
      else if (op <= 27) result = tokens.length ? undo(pick(tokens)) : { ok: true };
      else if (op === 28) {
        minutes += pick([5, 30, 120, 600]);
        setClock(new Date(origin.getTime() + minutes * 60000));
      } else if (chance(0.1)) {
        result = resetDemo({ keepSettings: chance(0.7) });
        tokens = [];
      }
      if (result && result.undoToken) tokens.push(result.undoToken);
      tokens = tokens.slice(-30);
      assertDiaryInvariants(`seed ${seed} step ${step} (${name})`);
    }
  }
});

test('every function named in section 8.1 is exported', () => {
  const names = [
    'initStore', 'getState', 'subscribe', 'syncFromStorage', 'getStorageStatus', 'createBooking', 'confirmBooking', 'acceptEmergency',
    'declineBooking', 'markOnTheWay', 'completeBooking', 'markPaid', 'markUnpaid', 'cancelBooking', 'rescheduleBooking', 'updateBooking',
    'markSeen', 'markAllSeen', 'sendQuickMessage', 'sendPaymentNudge', 'sendReviewRequest', 'sendMessageNow', 'markMessagesSeen', 'addBlock',
    'blockRange', 'removeBlock', 'removeBlockGroup', 'addDaysOff', 'removeDayOff', 'setDayFull', 'updateSettings', 'updateService',
    'setTheme', 'setDemoPhone', 'resetDemo', 'simulateIncomingBooking', 'undo'
  ];
  for (const name of names) assert.equal(typeof store[name], 'function', name);
  assert.deepEqual(Object.keys(store).sort(), [...names].sort(), 'and nothing else');
});
