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
import { SCHEMA_VERSION, STORAGE_KEYS, makeDefaultSettings } from '../../js/core/config.js';
import { SIM_POOL } from '../../js/core/seed.js';
import { bookingWindowIds, getDayLoad, getDaySlots, isSlotFree, isUnscheduled, nextFreeSlot } from '../../js/core/availability.js';
import {
  selectBookingById, selectBookingByRef, selectInsights, selectMessages, selectNeedsYou, selectOwedTotal, selectRepeatInfo, selectPipeline,
  selectUnreadMessageCount, selectCustomers
} from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

const {
  initStore, getState, subscribe, syncFromStorage, getStorageStatus, createBooking, confirmBooking, acceptEmergency, declineBooking,
  markOnTheWay, completeBooking, markPaid, markUnpaid, cancelBooking, rescheduleBooking, updateBooking, markSeen, markAllSeen,
  sendQuickMessage, sendPaymentNudge, sendReviewRequest, sendMessageNow, markMessagesSeen, addBlock, blockRange, removeBlock,
  removeBlockGroup, addDaysOff, removeDayOff, setDayFull, updateSettings, updateService, setTheme, setDemoPhone, resetDemo,
  simulateIncomingBooking, undo,
  createQuote, updateQuote, deleteQuote, sendQuote, recordQuoteViewed, acceptQuote, declineQuote, setConnection, connectWhatsApp,
  submitWhatsAppTemplates, connectGoogle, disconnect, startDomainSetup, checkDomain, rotateWebhookSecret, sendTestEvent, settleConnections,
  setAdSpend, removeAdSpend, addBookingPhotos, removeBookingPhoto
} = store;

const FIXTURE = new Date(2026, 9, 23, 20, 30);
const NOW = '2026-10-23T20:30';
// The v3 seed at the fixture clock: 42 bookings (24 enquiries, 11 installs, 7 phone jobs) and 49 seeded messages.
const SEED_BOOKINGS = 42;
const SEED_MESSAGES = 49;

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
  customer: { name: 'Aoife Magee', phone: '07700 900231' }, address: { line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' }, ...over
});
const eicrDraft = (over = {}) => draftFor({ serviceId: 'eicr', variantId: 'house', date: '2026-10-26', windowId: 0, ...over });
const urgentDraft = (over = {}) => ({
  serviceId: 'emergency', urgent: true, date: '2026-10-23', windowId: null, emergencyReasons: ['no_power'],
  customer: { name: 'Gareth Pryce', phone: '07700 900500' }, address: { line1: '', postcode: 'BT42 6JN' }, ...over
});
const ids = (list) => list.map((b) => b.id);
// The emergency path ships OFF (his business is home EV chargers): tests that exercise it turn it on first.
const emergenciesOn = () => assert.equal(updateSettings({ takingEmergencies: true }).ok, true);
const booking = (id) => selectBookingById(getState(), id);
const kinds = (list) => list.map((m) => m.kind);
const slotStates = (date, blocks = 1, opts = {}) => getDaySlots(getState(), date, blocks, opts).map((s) => s.state);

// ---------- persistence ----------

test('round trip through injected storage: saved as vm_state_v1, reloaded without reseeding', () => {
  const state = getState();
  assert.equal(state.bookings.length, SEED_BOOKINGS);
  assert.equal(state.seededFor, '2026-10-23');
  assert.equal(state.refSeq, 1043);
  const raw = storage.getItem(STORAGE_KEYS.state);
  assert.deepEqual(JSON.parse(raw), JSON.parse(JSON.stringify(state)));

  const made = createBooking(draftFor());
  assert.equal(made.ok, true);
  const rev = getState().meta.rev;
  const reloaded = initStore({ storage, force: true });
  assert.equal(reloaded.bookings.length, SEED_BOOKINGS + 1);
  assert.equal(reloaded.meta.rev, rev);
  assert.equal(selectBookingByRef(reloaded, 'EL-1043').id, made.booking.id);
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
    JSON.stringify({ ...good, v: SCHEMA_VERSION + 1 }), JSON.stringify({ ...good, bookings: 'nope' }), JSON.stringify({ ...good, settings: null }),
    JSON.stringify({ ...good, meta: {} }), 'null', '[]', '42'
  ];
  for (const raw of bad) {
    const s = memStorage({ [STORAGE_KEYS.state]: raw });
    const state = initStore({ storage: s, force: true });
    assert.equal(state.bookings.length, SEED_BOOKINGS, `reseeded from: ${raw.slice(0, 30)}`);
    assert.equal(state.v, SCHEMA_VERSION);
    assert.deepEqual(JSON.parse(s.getItem(STORAGE_KEYS.state)).bookings.length, SEED_BOOKINGS, 'and written back');
  }
});

test('a fresh store takes its theme mirror from vm_theme', () => {
  const s = memStorage({ [STORAGE_KEYS.theme]: 'dark' });
  assert.equal(initStore({ storage: s, force: true }).settings.theme, 'dark');
  const junk = memStorage({ [STORAGE_KEYS.theme]: 'purple' });
  assert.equal(initStore({ storage: junk, force: true }).settings.theme, 'dark', 'dark is the default look');
});

test('storage that throws puts the store in memory mode and everything still works', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  const state = initStore({ storage: broken, force: true });
  assert.equal(state.bookings.length, SEED_BOOKINGS);
  assert.deepEqual(getStorageStatus(), { ok: false, mode: 'memory' });
  const made = createBooking(draftFor());
  assert.equal(made.ok, true);
  assert.equal(made.booking.ref, 'EL-1043');
  assert.equal(getState().bookings.length, SEED_BOOKINGS + 1);
  assert.equal(syncFromStorage(), false);
  assert.equal(confirmBooking('bk_seed_11').ok, true);
});

test('storage that reads but cannot write also falls back to memory', () => {
  const readOnly = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  initStore({ storage: readOnly, force: true });
  assert.equal(getStorageStatus().ok, false);
  assert.equal(createBooking(draftFor()).ok, true);
});

test('a write refused for a blocked reason later switches to memory but the booking still succeeds', () => {
  let failWrites = false;
  const flaky = memStorage();
  const original = flaky.setItem;
  flaky.setItem = (k, v) => { if (failWrites) throw new Error('SecurityError: storage is blocked'); original(k, v); };
  initStore({ storage: flaky, force: true });
  assert.deepEqual(getStorageStatus(), { ok: true, mode: 'local' });
  failWrites = true;
  const made = createBooking(draftFor());
  assert.equal(made.ok, true);
  assert.deepEqual(getStorageStatus(), { ok: false, mode: 'memory' });
  assert.equal(getState().bookings.length, SEED_BOOKINGS + 1);
});

test('a quota error is storage_full: nothing changes, the saved state is intact, and the next write works once there is room', () => {
  let full = false;
  const flaky = memStorage();
  const original = flaky.setItem;
  const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 });
  flaky.setItem = (k, v) => { if (full && k === STORAGE_KEYS.state) throw quota(); original(k, v); };
  initStore({ storage: flaky, force: true });
  const before = getState();
  const raw = flaky.getItem(STORAGE_KEYS.state);
  let calls = 0;
  const off = subscribe(() => { calls += 1; });
  full = true;
  assert.deepEqual(createBooking(draftFor()), { ok: false, reason: 'storage_full' });
  assert.equal(getState(), before, 'the in-memory state is the same object');
  assert.equal(flaky.getItem(STORAGE_KEYS.state), raw, 'the saved state is untouched');
  assert.equal(calls, 0, 'nobody is told about a change that did not happen');
  assert.deepEqual(getStorageStatus(), { ok: true, mode: 'local' }, 'still saving normally: only this write was too big');
  assert.equal(confirmBooking('bk_seed_07').reason, 'storage_full', 'every mutation is guarded');
  assert.equal(updateSettings({ business: { tagline: 'x' } }).reason, 'storage_full');
  full = false;
  assert.equal(createBooking(draftFor()).ok, true);
  assert.equal(getState().bookings.length, SEED_BOOKINGS + 1);
  off();
});

test('a quota error with photos keeps the enquiry and drops the photos', () => {
  const flaky = memStorage();
  const original = flaky.setItem;
  const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 });
  // room for a normal state but not for a state with photo data in it
  flaky.setItem = (k, v) => { if (k === STORAGE_KEYS.state && v.includes('data:image/jpeg')) throw quota(); original(k, v); };
  initStore({ storage: flaky, force: true });
  const photo = { name: 'consumer-unit.jpg', dataUrl: `data:image/jpeg;base64,${'A'.repeat(2000)}` };
  const made = createBooking({ ...draftFor(), photos: [photo, photo] });
  assert.equal(made.ok, true, 'the enquiry is kept');
  assert.equal(made.photosDropped, 2);
  assert.equal(made.booking.photos, undefined);
  assert.equal(getState().bookings.length, SEED_BOOKINGS + 1);
});

test('a throwing localStorage property is survived (some browser modes throw on access)', () => {
  Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  try {
    const state = initStore({ force: true });
    assert.equal(state.bookings.length, SEED_BOOKINGS);
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
  assert.deepEqual(seen, [SEED_BOOKINGS + 1]);
  assert.equal(errors.length, 1);
});

// ---------- createBooking ----------

test('createBooking happy path: EL-1043, confirmed, three messages with the owner alert newest', () => {
  const calls = [];
  const off = subscribe((s) => calls.push(s.meta.rev));
  const result = createBooking(eicrDraft());
  off();
  assert.equal(result.ok, true);
  const b = result.booking;
  assert.equal(b.ref, 'EL-1043');
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
  assert.deepEqual(b.customer, { name: 'Aoife Magee', phone: '07700 900231', email: '' });
  assert.deepEqual(b.address, { line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' });
  assert.deepEqual(b.history.map((h) => [h.event, h.by]), [['created', 'customer'], ['confirmed', 'system']]);
  assert.equal(getState().refSeq, 1044);

  assert.deepEqual(kinds(result.messages), ['customer_reminder', 'customer_confirmed', 'owner_new_booking']);
  const [reminder, confirmed, alert] = result.messages;
  assert.equal(reminder.sendAt, '2026-10-25T18:00');
  assert.equal(confirmed.sendAt, null);
  assert.equal(alert.to, 'owner');
  assert.ok(alert.seq > confirmed.seq && confirmed.seq > reminder.seq, 'the owner alert has the highest seq of its group');
  assert.ok(result.messages.every((m) => m.at === NOW && m.bookingId === b.id && m.simulated === true && m.seed === false && /^msg_[0-9a-z]{8}$/.test(m.id)));
  assert.equal(getState().messages.length, SEED_MESSAGES + 3);
  assert.equal(getState().meta.msgSeq, SEED_MESSAGES + 3);
  assert.ok(confirmed.body.startsWith("Hi Aoife, it's Daniel from 180 Electrical. You're booked in: EICR safety report (House, 2–3 bed), Mon 26 Oct, morning, arriving between 8 and 10am"));
  assert.equal(calls.length, 1, 'one notification for the whole booking');
  assert.equal(getState().bookings.at(-1).id, b.id);
  assert.equal(selectUnreadMessageCount(getState()), 1, 'the owner alert is unread');
  assert.deepEqual(selectRepeatInfo(getState(), b), { isRepeat: true, nth: 2 }, 'Aoife has booked before');
});

test('createBooking normalises and trims what the customer typed', () => {
  const result = createBooking(draftFor({
    customer: { name: `  ${'N'.repeat(80)}  `, phone: '+44 7700 900231', email: ' priya@home.example ' },
    address: { line1: '  14 Larkfield Gardens ', postcode: 'bt96qp' },
    notes: `  ${'x'.repeat(400)}  `
  }));
  assert.equal(result.ok, true);
  const b = result.booking;
  assert.equal(b.customer.name.length, 60);
  assert.equal(b.customer.phone, '07700 900231');
  assert.equal(b.customer.email, 'priya@home.example');
  assert.equal(b.address.line1, '14 Larkfield Gardens');
  assert.equal(b.address.postcode, 'BT9 6QP');
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
  const wrong = createBooking(draftFor({ customer: { name: 'P', phone: '01234 567890' }, address: { line1: '14 Larkfield Gardens', postcode: 'xx' } }));
  assert.deepEqual(wrong.errors, {
    name: 'Enter your name', phone: "That doesn't look like a UK mobile. It should start 07 or +44 7", postcode: 'Enter a UK postcode, like BT9 6QP'
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
  assert.equal(getState().bookings.length, SEED_BOOKINGS);
  assert.equal(getState().refSeq, 1043, 'a failed booking does not use up a reference');
});

test('createBooking: the same window twice gives slot_taken with 3 alternatives, in time order', () => {
  assert.equal(createBooking(draftFor()).ok, true);
  const second = createBooking(draftFor({ customer: { name: 'Tom Hargreaves', phone: '07700 900288' } }));
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'slot_taken');
  assert.equal(second.alternatives.length, 3);
  assert.deepEqual(second.alternatives.map((a) => a.human), ['Mon 26 Oct, 8–10am', 'Mon 26 Oct, 10am–12', 'Thu 29 Oct, 1–3pm']);
  assert.ok(second.alternatives.every((a) => 'date' in a && 'windowId' in a && 'blocks' in a && 'label' in a));
  assert.equal(getState().refSeq, 1044, 'the failed attempt did not consume EL-1044');
  assert.equal(getState().bookings.length, SEED_BOOKINGS + 1);
  // a taken half-day pair, a blocked window, a booked window and a full day are all slot_taken
  assert.equal(createBooking(draftFor({ date: '2026-10-27', windowId: 0 })).reason, 'slot_taken', 'Tuesday is full');
  assert.equal(createBooking(draftFor({ date: '2026-10-28', windowId: 0 })).reason, 'slot_taken', 'Van MOT');
  assert.equal(createBooking(draftFor({ date: '2026-10-25', windowId: 0 })).reason, 'slot_taken', 'Sunday is closed');
  assert.equal(createBooking(draftFor({ date: '2026-10-23', windowId: 3 })).reason, 'slot_taken', 'today is over at 20:30');
  assert.equal(createBooking(draftFor({ date: '2026-12-01', windowId: 0 })).reason, 'slot_taken', 'beyond the horizon');
  assert.equal(createBooking(eicrDraft({ windowId: 2 })).reason, 'slot_taken', 'Monday afternoon holds Marcus');
});

test('createBooking: edge postcode, outside postcode and auto-confirm off all wait for the owner', () => {
  // there is no edge zone by default: the owner can add one
  const covered = getState().settings.business.coveredOutward;
  assert.equal(updateSettings({ business: { edgeOutward: ['BT30'], coveredOutward: covered.filter((o) => o !== 'BT30') } }).ok, true);
  const edge = createBooking(draftFor({ address: { line1: 'Mill Cottage', postcode: 'BT30 6AB' } }));
  assert.equal(edge.booking.status, 'new');
  assert.deepEqual(kinds(edge.messages), ['customer_received', 'owner_new_booking']);
  assert.ok(edge.messages[0].body.includes('We just need to check travel to BT30 6AB.'));
  assert.ok(edge.messages[1].body.includes('Needs your OK: outside your usual area (BT30).'));
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
  emergenciesOn();
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
  assert.ok(result.messages[1].body.startsWith('*URGENT: emergency request EL-1043*'));
  assert.equal(JSON.stringify(['2026-10-23', '2026-10-24', '2026-10-26'].map((d) => getDayLoad(getState(), d))), before);
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Tomorrow, 8–10am');
  // the order of Needs you (F3): the emergency first, then the two seeded enquiries oldest first
  assert.deepEqual(ids(selectNeedsYou(getState())), [b.id, 'bk_seed_11', 'bk_seed_34', 'bk_seed_35', 'bk_seed_07']);
  // reasons are required, unknown ones are dropped, a street is optional
  assert.deepEqual(createBooking(urgentDraft({ emergencyReasons: [] })).errors, { emergencyReasons: 'Choose what is happening' });
  assert.deepEqual(createBooking(urgentDraft({ emergencyReasons: ['nope'] })).errors, { emergencyReasons: 'Choose what is happening' });
  assert.deepEqual(createBooking(urgentDraft({ emergencyReasons: ['water', 'water', 'bogus', 'burning'] })).booking.emergencyReasons, ['water', 'burning']);
  assert.equal(createBooking(urgentDraft({ address: { line1: '', postcode: '' } })).errors.postcode, 'Enter your postcode');
});

test('emergencies_off (the default) and service_unavailable', () => {
  assert.equal(getState().settings.takingEmergencies, false, 'the emergency path ships off');
  const off = createBooking(urgentDraft());
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'emergencies_off');
  assert.equal(getState().refSeq, 1043);
  emergenciesOn();
  assert.equal(createBooking(urgentDraft()).ok, true, 'and works once he turns it on');
  updateSettings({ takingEmergencies: false });
  updateSettings({ takingEmergencies: true });
  assert.equal(updateService('ev', { active: false }).ok, true);
  assert.equal(createBooking(eicrDraft({ serviceId: 'ev', variantId: undefined })).reason, 'service_unavailable');
  assert.equal(createBooking(draftFor({ serviceId: 'nonsense' })).reason, 'service_unavailable');
  assert.equal(getState().refSeq, 1044, 'only the one emergency used a reference');
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
  assert.equal(result.booking.tentative, false, 'the pencilled-in survey is firm once the owner confirms it');
  const added = selectMessages(getState(), { bookingId: 'bk_seed_11' }).filter((m) => !m.seed);
  assert.deepEqual(kinds(added), ['customer_confirmed', 'customer_reminder'], 'newest first: the confirmation is on top');
  assert.equal(added[1].sendAt, '2026-10-26T18:00');
  assert.equal(selectMessages(getState())[0].kind, 'customer_confirmed', 'F2: the newest message is the confirmation');
  assert.equal(confirmBooking('bk_seed_11').reason, 'bad_transition');
  assert.equal(confirmBooking('bk_seed_08').reason, 'bad_transition', 'already confirmed');
  emergenciesOn();
  const emergency = createBooking(urgentDraft());
  assert.equal(confirmBooking(emergency.booking.id).reason, 'bad_transition', 'an emergency is accepted, not confirmed');
  assert.equal(confirmBooking('nope').reason, 'not_found');
});

test('acceptEmergency: urgent new -> confirmed with an ETA', () => {
  emergenciesOn();
  const urgent = createBooking(urgentDraft());
  const urgentId = urgent.booking.id;
  const result = acceptEmergency(urgentId, 45);
  assert.equal(result.ok, true);
  assert.equal(result.booking.status, 'confirmed');
  assert.equal(result.booking.etaMinutes, 45);
  assert.equal(result.booking.etaAt, '2026-10-23T21:15');
  assert.ok(result.undoToken);
  const msg = selectMessages(getState())[0];
  assert.equal(msg.kind, 'customer_emergency_accepted');
  assert.ok(msg.body.includes('about 45 minutes away (around 21:15)'));
  assert.ok(!ids(selectNeedsYou(getState())).includes(urgentId));
  assert.equal(acceptEmergency(urgentId, 45).reason, 'bad_transition');
  assert.equal(acceptEmergency('bk_seed_11', 45).reason, 'bad_transition', 'not an emergency');
  for (const eta of [0, -5, 1.5, '45', null, undefined]) assert.equal(acceptEmergency(urgentId, eta).reason, 'invalid', String(eta));
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
  assert.ok(msg.body.includes("Sorry, I can't do the free survey visit on Tue 27 Oct, 10am–12."));
  assert.ok(msg.body.includes('My next free visit is Tomorrow, 8–10am.'), 'never offers the window that was just released');
  assert.ok(!msg.body.includes('Reason:'));
  assert.equal(declineBooking('bk_seed_11').reason, 'bad_transition');
  assert.equal(declineBooking('bk_seed_08').reason, 'bad_transition', 'a confirmed job is cancelled, not declined');
  emergenciesOn();
  const urgent = declineBooking(createBooking(urgentDraft()).booking.id);
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
  assert.ok(msg.body.includes("I'm on my way to BT41 8PY, 30 minutes away (around 21:00)"), 'a postcode-only enquiry falls back to the postcode');
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
  assert.equal(selectOwedTotal(getState()), 3609 + 90, 'F5: owed rises');

  const paid = completeBooking('bk_seed_14', { finalPrice: 85, paid: true, paidMethod: 'cash', sendReview: false });
  assert.equal(paid.ok, true);
  assert.equal(paid.booking.paid, true);
  assert.equal(paid.booking.paidMethod, 'cash');
  assert.equal(paid.booking.paidAt, NOW);
  assert.equal(paid.booking.reviewRequested, false);
  assert.deepEqual(kinds(selectMessages(getState(), { bookingId: 'bk_seed_14' }).filter((m) => !m.seed)), ['customer_completed']);
  assert.ok(selectMessages(getState())[0].body.includes('Paid with thanks, £85.'));
  assert.equal(selectInsights(getState(), NOW).collectedMonth, 3038 + 85, 'F4: collected rises');
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
  assert.equal(selectOwedTotal(getState()), 3609);
  const result = markPaid('bk_seed_06', 'card');
  assert.equal(result.ok, true);
  assert.equal(result.booking.paid, true);
  assert.equal(result.booking.paidMethod, 'card');
  assert.equal(result.booking.paidAt, NOW);
  assert.ok(result.undoToken);
  assert.equal(selectOwedTotal(getState()), 3609 - 75);
  assert.equal(selectInsights(getState(), NOW).collectedMonth, 3038 + 75, 'markPaid then Insights collectedMonth rises');
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
  assert.equal(selectOwedTotal(getState()), 3609);
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
  assert.equal(cancelBooking('bk_seed_07', 'owner').ok, true, 'and a pencilled-in enquiry, which then holds no window');
  assert.equal(booking('bk_seed_07').tentative, false);
  assert.equal(slotStates('2026-10-29')[1], 'free');
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

  // inside the 24 hour cut-off (Eoin's survey, tomorrow 10:00)
  assert.equal(cancelBooking('bk_seed_08', 'customer').reason, 'not_allowed');
  assert.equal(booking('bk_seed_08').status, 'confirmed');
  // an urgent request is always "close"
  emergenciesOn();
  assert.equal(cancelBooking(createBooking(urgentDraft()).booking.id, 'customer').reason, 'not_allowed');
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
  // Eoin's seeded reminder (18:00 tonight) was already due, so it is history; a fresh one is scheduled for the new day
  const scheduled = getState().messages.filter((m) => m.bookingId === 'bk_seed_08' && m.kind === 'customer_reminder' && m.sendAt > NOW);
  assert.equal(scheduled.length, 1, 'exactly one unsent reminder');
  assert.equal(scheduled[0].sendAt, '2026-10-25T18:00');
  assert.ok(!scheduled[0].seed);
  const msg = selectMessages(getState())[0];
  assert.equal(msg.kind, 'customer_rescheduled');
  assert.ok(msg.body.includes('moved your Home EV charger quote from Sat 24 Oct, 10am–12 to Mon 26 Oct, 10am–12 at BT41 8PY'));
  // silent reschedule
  const quiet = rescheduleBooking('bk_seed_08', { date: '2026-10-26', windowId: 0 }, 'owner', { notify: false });
  assert.equal(quiet.ok, true);
  assert.equal(selectMessages(getState())[0].kind, 'customer_reminder');
  // half-day jobs move between their own windows and only to 0 or 2
  const eicr = rescheduleBooking('bk_seed_09', { date: '2026-10-26', windowId: 0 });
  assert.equal(eicr.ok, false, 'Monday morning now holds Eoin');
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
  emergenciesOn();
  assert.equal(rescheduleBooking(createBooking(urgentDraft()).booking.id, { date: '2026-10-29', windowId: 2 }).reason, 'bad_transition', 'urgent');
  assert.equal(rescheduleBooking('nope', { date: '2026-10-29', windowId: 0 }).reason, 'not_found');
  // a `new` booking can be moved too, and gets no reminder until confirmed
  assert.equal(booking('bk_seed_11').tentative, true, 'a pencilled-in survey');
  const moved = rescheduleBooking('bk_seed_11', { date: '2026-10-30', windowId: 0 });
  assert.equal(moved.ok, true);
  assert.equal(moved.booking.status, 'new', 'still waiting for his OK');
  assert.equal(moved.booking.tentative, false, 'but the owner chose the time, so it is no longer a provisional pencil mark');
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
  emergenciesOn();
  assert.equal(rescheduleBooking(createBooking(urgentDraft()).booking.id, { date: '2026-10-26', windowId: 1 }, 'customer').reason, 'not_allowed', 'urgent');
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
  assert.equal(result.booking.customer.name, 'Eoin McCartney');
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
  emergenciesOn();
  const seqs = [];
  const a = createBooking(draftFor());
  const b = createBooking(eicrDraft());
  const c = createBooking(urgentDraft());
  for (const r of [a, b, c]) for (const m of r.messages) seqs.push(m.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  assert.equal(new Set(seqs).size, seqs.length);
  assert.equal(seqs[0], SEED_MESSAGES + 1);
  assert.equal(getState().meta.msgSeq, seqs.at(-1));
  for (const r of [a, b, c]) assert.equal(r.messages.at(-1).seq, Math.max(...r.messages.map((m) => m.seq)), 'the owner alert is the highest of its group');
  assert.equal(selectUnreadMessageCount(getState()), 3);
  assert.equal(markMessagesSeen().ok, true);
  assert.equal(selectUnreadMessageCount(getState()), 0);
  assert.equal(getState().meta.messagesSeenSeq, getState().meta.msgSeq);
  // same frozen minute, after the owner looked: still counts
  assert.equal(createBooking(draftFor({ date: '2026-10-29', windowId: 2 })).ok, true);
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
  assert.equal(addBlock({ date: '2026-10-24', windowId: 1 }).reason, 'booked', 'Eoin is in window 1');
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
  assert.deepEqual(range.added.map((b) => b.windowId), [2, 3], 'Ciaran holds window 0 and Sinead\'s pencilled-in survey window 1');
  assert.deepEqual(range.skipped, [{ date: '2026-10-29', windowId: 0, reason: 'booked' }, { date: '2026-10-29', windowId: 1, reason: 'booked' }]);
  const group = new Set(range.added.map((b) => b.groupId));
  assert.equal(group.size, 1);
  assert.match([...group][0], /^grp_[0-9a-z]{8}$/);
  assert.ok(range.undoToken);
  assert.equal(slotStates('2026-10-29').join(), 'booked,booked,blocked,blocked');
  // until a date, days off excluded by the engine but blocks are still stored per window
  const week = blockRange({ fromDate: '2026-11-09', toDate: '2026-11-11', windowIds: [0, 1], label: 'Holiday' });
  assert.equal(week.added.length, 6);
  assert.equal(new Set(week.added.map((b) => b.groupId)).size, 1);
  // default label and default single day
  assert.equal(blockRange({ fromDate: '2026-11-05', windowIds: [2] }).added[0].label, 'Blocked');
  // blocking again adds nothing new
  const again = blockRange({ fromDate: '2026-11-09', toDate: '2026-11-11', windowIds: [0, 1], label: 'Holiday' });
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
  assert.equal(result.bookedCount, 1, 'Eoin stays in the diary');
  assert.ok(result.undoToken);
  assert.equal(booking('bk_seed_08').status, 'confirmed');
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Mon 26 Oct, 8–10am');
  assert.equal(getDayLoad(getState(), '2026-10-24').level, 'closed');
  const week = addDaysOff(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-24', '2026-10-26'], 'Holiday');
  assert.deepEqual(week.added.map((d) => d.date), ['2026-10-26', '2026-10-27', '2026-10-28'], 'duplicates and existing days are skipped');
  assert.equal(week.bookedCount, 6, 'Monday install, four Tuesday jobs and Eoin on the already-off Saturday; they all stay');
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
  assert.equal(biz.ownerFullName, 'Lee', 'the full name is just the first name, so it follows it');
  assert.equal(biz.phone, '07700 900555');
  assert.equal(biz.tagline, 'Spark joy.');
  assert.equal(biz.email, 'daniel@180electrical.co.uk', 'untouched fields stay');
  assert.deepEqual(biz.coveredOutward.slice(0, 2), ['BT1', 'BT2']);
  assert.deepEqual(biz.credentials, ['Level 3 Electrical Installation', '2391 Inspection and Testing']);
  assert.equal(result.settings, getState().settings);
  // the rebrand reaches the next message
  const made = createBooking(draftFor());
  assert.ok(made.messages[1].body.startsWith("Hi Aoife, it's Lee from Ashby Sparks."));
  assert.equal(made.messages.at(-1).toName, 'Lee');
  assert.equal(made.messages.at(-1).toPhone, '07700 900555');
  updateSettings({ business: { ownerFullName: 'Lee Ashby' } });
  assert.equal(getState().settings.business.ownerFullName, 'Lee Ashby');
  updateSettings({ business: { ownerFirstName: 'Leo' } });
  assert.equal(getState().settings.business.ownerFullName, 'Leo Ashby', 'the first word of a longer full name follows the first name');
  updateSettings({ business: { ownerFirstName: 'Lee' } });
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
  assert.equal(getState().settings.business.tagline, 'Home EV charger installation across Northern Ireland.', 'the valid part was not applied either');
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
  assert.equal(nextFreeSlot(getState(), 'fault').human, 'Mon 26 Oct, 8–10am', 'Saturday window 1 is Eoin and window 0 is now closed');
  updateSettings({ maxDaysAhead: 7 });
  assert.equal(isSlotFree(getState(), { date: '2026-10-29', windowId: 2 }), true);
  assert.equal(isSlotFree(getState(), { date: '2026-10-30', windowId: 1 }), false);
});

test('updateService: prices, variants, headline recompute, free and inactive services', () => {
  const fault = updateService('fault', { price: 80, name: ' Fault finding ', description: 'Found and fixed.', active: true });
  assert.equal(fault.ok, true);
  assert.equal(fault.service.price, 80);
  assert.equal(fault.service.name, 'Fault finding');
  assert.equal(fault.service.description, 'Found and fixed.');
  assert.equal(createBooking(draftFor()).booking.quotedPrice, 80, 'new bookings quote the live price');
  assert.equal(booking('bk_seed_10').quotedPrice, 75, 'existing bookings keep theirs');

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
  assert.equal(s.bookings.length, SEED_BOOKINGS);
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
  assert.equal(s.bookings.find((b) => b.id === 'bk_seed_10').quotedPrice, 99, 'the seed uses the live prices');
  assert.ok(s.messages.every((m) => m.seed));
  assert.equal(s.messages.length, SEED_MESSAGES);
  assert.equal(s.meta.rev, revBefore + 1, 'rev keeps counting up');
  assert.equal(s.meta.msgSeq, SEED_MESSAGES);
  assert.equal(s.meta.messagesSeenSeq, SEED_MESSAGES);
  assert.equal(s.meta.simCursor, 0);
  assert.equal(selectUnreadMessageCount(s), 0);
  assert.equal(createBooking(draftFor()).booking.ref, 'EL-1043', 'F11: the next booking is EL-1043 again');
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
  // the demo ad spend is seeded into the settings, everything else is the factory default
  assert.deepEqual({ ...s.settings, theme: defaults.theme, demoPhoneDigits: '', marketing: { adSpend: [] } }, defaults);
  assert.equal(s.settings.marketing.adSpend.length, 6, 'three months of Facebook and Instagram spend');
  assert.ok(s.settings.marketing.adSpend.every((e) => e.seed === true));
  assert.equal(s.settings.theme, 'light');
  assert.equal(s.settings.demoPhoneDigits, '447700900555');
  assert.equal(s.bookings.length, SEED_BOOKINGS);
});

test('simulateIncomingBooking: standard, approval and emergency, cycling through the pool', () => {
  const standard = simulateIncomingBooking();
  assert.equal(standard.ok, true);
  const b = standard.booking;
  assert.equal(b.ref, 'EL-1043');
  assert.equal(b.source, 'website');
  assert.equal(b.serviceId, 'ev_quote', 'a website enquiry for the free survey');
  assert.equal(b.status, 'new', 'a survey is never auto-confirmed');
  assert.equal(b.tentative, true);
  assert.equal(b.start, '2026-10-24T08:00', 'the next free survey window is pencilled in');
  assert.equal(b.customer.name, SIM_POOL[0].name);
  assert.equal(b.customer.phone, SIM_POOL[0].phone);
  assert.deepEqual(b.address, { line1: '', postcode: SIM_POOL[0].postcode }, 'like the funnel, only the postcode');
  assert.deepEqual(b.answers, { postcode: SIM_POOL[0].postcode, ...SIM_POOL[0].answers });
  assert.equal(b.seenByOwner, false);
  assert.equal(getState().meta.simCursor, 1);
  assert.deepEqual(kinds(standard.messages), ['customer_received', 'owner_new_booking']);
  assert.ok(standard.messages[1].body.includes('Parking: private driveway. Car: has one. Timing: as soon as possible. Permission: yes.'));

  const approval = simulateIncomingBooking({ kind: 'approval' });
  assert.equal(approval.booking.status, 'new');
  assert.equal(approval.booking.address.postcode, 'DG9 8PQ', 'outside Northern Ireland');
  assert.equal(approval.booking.customer.name, SIM_POOL[1].name);
  assert.equal(approval.booking.start, '2026-10-26T08:00', 'Saturday is now full of Eoin and the first sample');
  assert.deepEqual(kinds(approval.messages), ['customer_received', 'owner_new_booking']);
  assert.ok(approval.messages[1].body.includes('Outside Northern Ireland (DG9).'));
  assert.ok(ids(selectNeedsYou(getState())).includes(approval.booking.id));

  // the emergency path ships off, so the simulator says so; once he turns it on it works
  const refused = simulateIncomingBooking({ kind: 'emergency' });
  assert.equal(refused.reason, 'emergencies_off');
  assert.equal(getState().meta.simCursor, 2, 'a refused simulation does not move the cursor');
  emergenciesOn();
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

test('simulateIncomingBooking: an enquiry is never lost when the diary has no free survey window', () => {
  updateSettings({ autoConfirm: false });
  assert.equal(simulateIncomingBooking().booking.status, 'new', 'standard enquiries are pending whatever the auto-confirm setting');
  updateSettings({ autoConfirm: true });
  const cursor = getState().meta.simCursor;
  updateSettings({ hours: [[], [], [], [], [], [], []] });
  const none = simulateIncomingBooking();
  assert.equal(none.ok, true, 'kept, not refused');
  assert.equal(none.booking.durationMin, 0, 'holding no window');
  assert.equal(none.booking.tentative, undefined, 'nothing was pencilled in');
  assert.equal(none.booking.status, 'new');
  assert.equal(getState().meta.simCursor, cursor + 1);
  assert.ok(none.messages[0].body.includes('Daniel will be in touch within 24 hours to arrange your free survey visit.'));
  assert.ok(!none.messages[0].body.includes('pencilled'));
  assert.ok(none.messages[1].body.includes('Survey: time to be arranged'));
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
  emergenciesOn();
  const urgentId = createBooking(urgentDraft()).booking.id;
  const snapshot = () => JSON.stringify({ b: getState().bookings, m: getState().messages, blocks: getState().blocks, s: getState().settings });
  const cases = [
    () => confirmBooking('bk_seed_11'),
    () => acceptEmergency(urgentId, 60),
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
  assert.equal(getState().bookings.length, SEED_BOOKINGS, 'this tab has not looked yet');
  assert.equal(syncFromStorage(), true);
  assert.equal(getState().bookings.length, SEED_BOOKINGS + 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], getState());
  assert.equal(calls[0][1].bookings.length, SEED_BOOKINGS);
  assert.equal(selectBookingByRef(getState(), 'EL-1043').id, made.booking.id);
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
  assert.equal(fromB.booking.ref, 'EL-1043');
  // tab A has NOT synced; its booking must see tab B's and get the next ref, not overwrite it
  const fromA = createBooking(draftFor({ date: '2026-10-26', windowId: 1 }));
  assert.equal(fromA.ok, true);
  assert.equal(fromA.booking.ref, 'EL-1044');
  assert.equal(getState().bookings.length, SEED_BOOKINGS + 2);
  assert.ok(selectBookingByRef(getState(), 'EL-1043'));
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
  const slots = [['2026-10-26', 0], ['2026-10-26', 1], ['2026-10-29', 2], ['2026-10-30', 2], ['2026-10-30', 3], ['2026-10-30', 0], ['2026-10-30', 1]];
  let n = 0;
  const next = () => {
    const [date, windowId] = slots[n];
    n += 1;
    return tabB.createBooking(draftFor({ date, windowId, customer: { name: `Visitor ${n}`, phone: '07700 900288' }, address: { line1: `${n} Road`, postcode: 'BT9 6QP' }, serviceId: 'sockets' })).ok;
  };
  assert.equal(next(), true);
  fire('window', 'storage', { key: 'some_other_key' });
  assert.equal(count(), SEED_BOOKINGS, 'other keys are ignored');
  fire('window', 'storage', { key: STORAGE_KEYS.state });
  assert.equal(count(), SEED_BOOKINGS + 1);
  assert.equal(next(), true);
  fire('window', 'storage', { key: null });
  assert.equal(count(), SEED_BOOKINGS + 2, 'clear() events (key null) re-read as well');
  assert.equal(next(), true);
  fire('window', 'pageshow', {});
  assert.equal(count(), SEED_BOOKINGS + 3);
  assert.equal(next(), true);
  fire('window', 'focus', {});
  assert.equal(count(), SEED_BOOKINGS + 4);
  assert.equal(next(), true);
  fakeDocument.visibilityState = 'hidden';
  fire('document', 'visibilitychange', {});
  assert.equal(count(), SEED_BOOKINGS + 4, 'a tab going to the background does not re-read');
  fakeDocument.visibilityState = 'visible';
  fire('document', 'visibilitychange', {});
  assert.equal(count(), SEED_BOOKINGS + 5, 'coming back to the foreground does');
});

test('garbage written by someone else is ignored, a cleared store keeps the page state', () => {
  storage.setItem(STORAGE_KEYS.state, '{not json');
  assert.equal(syncFromStorage(), false);
  assert.equal(getState().bookings.length, SEED_BOOKINGS);
  storage.setItem(STORAGE_KEYS.state, JSON.stringify({ v: 1 }));
  assert.equal(syncFromStorage(), false);
  storage.removeItem(STORAGE_KEYS.state);
  assert.equal(syncFromStorage(), false);
  assert.equal(createBooking(draftFor()).ok, true, 'and the next write restores storage');
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.state)).bookings.length, SEED_BOOKINGS + 1);
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
  assert.equal(state.bookings.filter((b) => b.seed).length, SEED_BOOKINGS, 'a fresh seed relative to the new today');
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
  assert.equal(state.messages.filter((m) => m.seed).length, 52, 'the seed at 07:30 on the 23rd');
  assert.ok(state.messages.filter((m) => m.seed).every((m) => m.seq > msgSeqBefore), 'seed seq numbers keep increasing');
  assert.equal(state.meta.msgSeq, msgSeqBefore + 52);
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
  assert.deepEqual(seedIds, Array.from({ length: SEED_BOOKINGS }, (_, i) => `bk_seed_${String(i + 1).padStart(2, '0')}`));
  assert.equal(state.messages.some((m) => m.id === 'msg_seed_07_alert'), true);
  // a booking made after the rollover still gets the next ref
  const slot = nextFreeSlot(getState(), 'fault');
  assert.equal(createBooking(draftFor({ date: slot.date, windowId: slot.windowId })).booking.ref, `EL-${refSeqBefore}`);
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
  assert.equal(again.bookings.length, SEED_BOOKINGS + 1);
});

// ---------- flows from the end-to-end list that the data layer must support ----------

test('F1: a landing page EICR booking becomes a repeat customer job card with three messages', () => {
  const made = createBooking(eicrDraft());
  assert.equal(made.booking.ref, 'EL-1043');
  assert.equal(selectCustomers(getState()).length, 27, 'Aoife is an existing customer');
  assert.deepEqual(selectRepeatInfo(getState(), made.booking), { isRepeat: true, nth: 2 });
  const forBooking = selectMessages(getState(), { bookingId: made.booking.id });
  assert.deepEqual(kinds(forBooking), ['owner_new_booking', 'customer_confirmed', 'customer_reminder']);
  assert.equal(forBooking[2].sendAt > NOW, true);
  assert.equal(selectUnreadMessageCount(getState()), 1);
  assert.equal(nextFreeSlot(getState(), 'eicr').human, 'Thu 29 Oct, afternoon, arrive 1–3pm', 'Monday morning is now taken, Monday afternoon and Tuesday are booked, Wednesday is the MOT, Thursday morning holds Ciaran and Sinead');
});

test('F3: an emergency never changes a window, is accepted from the message bubble and leaves Needs you', () => {
  emergenciesOn();
  const loads = () => JSON.stringify(['2026-10-24', '2026-10-26', '2026-10-27'].map((d) => getDayLoad(getState(), d)));
  const before = loads();
  const made = createBooking(urgentDraft({ customer: { name: 'Ngozi Okafor', phone: '07700 900344' }, address: { line1: '9 Orchard Close', postcode: 'BT42 6JN' } }));
  assert.equal(loads(), before, 'Mon 26 Oct load unchanged');
  assert.deepEqual(ids(selectNeedsYou(getState())), [made.booking.id, 'bk_seed_11', 'bk_seed_34', 'bk_seed_35', 'bk_seed_07'], 'the emergency first, then the enquiries and pencilled installs oldest first');
  const accepted = acceptEmergency(made.booking.id, 45);
  assert.equal(accepted.ok, true);
  const top = selectMessages(getState())[0];
  assert.equal(top.kind, 'customer_emergency_accepted');
  assert.ok(top.body.includes('45 minutes'));
  assert.deepEqual(ids(selectNeedsYou(getState())), ['bk_seed_11', 'bk_seed_34', 'bk_seed_35', 'bk_seed_07']);
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
    if (b.tentative) {
      assert.equal(b.status, 'new', `${label}: ${b.id} is tentative so it is still pending`);
      assert.ok(b.serviceId === 'ev_quote' || (b.serviceId === 'ev' && b.quoteId), `${label}: ${b.id} only a survey or an install made by a quote is pencilled in`);
      assert.ok(b.durationMin > 0, `${label}: ${b.id} a pencilled booking holds a window`);
    }
    if (isUnscheduled(b)) {
      assert.equal(b.serviceId, 'ev_quote', `${label}: ${b.id} only an enquiry can be unscheduled`);
      assert.equal(b.status === 'confirmed' || b.status === 'on_the_way', false, `${label}: ${b.id} cannot be confirmed without a window`);
    }
    if (b.answers) for (const k of Object.keys(b.answers)) assert.ok(['postcode', 'parking', 'vehicle', 'timing', 'permission', 'marketingOptIn'].includes(k), `${label}: ${b.id} answers key ${k}`);
  }
  const cancelled = new Set(st.bookings.filter((b) => b.status === 'cancelled').map((b) => b.id));
  for (const m of st.messages) {
    assert.ok(!(cancelled.has(m.bookingId) && m.sendAt && m.sendAt > getNowStamp()), `${label}: ${m.id} is still scheduled for a cancelled booking`);
  }
  // v3: quotes and the pipeline stay consistent with the bookings they belong to
  for (const [id, q] of Object.entries(st.quotes)) {
    assert.equal(q.id, id, `${label}: quote key is its id`);
    assert.ok(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'].includes(q.status), `${label}: ${id} status`);
    assert.ok(st.bookings.some((b) => b.id === q.bookingId), `${label}: ${id} belongs to a booking`);
    assert.ok(q.lines.every((l) => Number.isInteger(l.qty) && Number.isInteger(l.unitPrice) && l.label), `${label}: ${id} lines`);
    if (q.status === 'accepted') {
      const install = st.bookings.find((b) => b.id === q.installBookingId);
      assert.ok(install && install.quoteId === id && install.serviceId === 'ev', `${label}: ${id} accepted means an install booking exists`);
    }
    if (q.sentAt === null) assert.ok(q.status === 'draft', `${label}: ${id} not sent means draft`);
  }
  const pipe = selectPipeline(st, getNowStamp());
  const seen = pipe.stages.flatMap((stage) => stage.items).concat(pipe.lost).map((i) => i.bookingId);
  assert.equal(new Set(seen).size, seen.length, `${label}: a booking sits in one pipeline place only`);
  assert.equal(pipe.totalCount, seen.length);
  for (const stage of pipe.stages) assert.ok(stage.items.every((i) => i.stage === stage.id), `${label}: items sit in their own stage`);
  const adKeys = st.settings.marketing.adSpend.map((e) => `${e.month}|${e.channel}`);
  assert.equal(new Set(adKeys).size, adKeys.length, `${label}: one ad spend entry per month and channel`);
  assert.equal(storage.getItem(STORAGE_KEYS.state), JSON.stringify(st), `${label}: storage mirrors the state`);
  assert.ok(Object.isFrozen(st));
}

test('property: random sequences of every operation, undo included, keep the diary consistent', () => {
  const SERVICES = ['fault', 'eicr', 'consumer', 'sockets', 'ev', 'rewire', 'ev_quote'];
  const PEOPLE = [['Aoife Magee', '07700 900231'], ['Tom Hargreaves', '07700 900288'], ['Zed Ford', '07700 900612'], ['Amy Lowe', '07700 900613']];
  const POSTCODES = ['BT9 6QP', 'BT48 4XJ', 'DG9 8AB', 'BT94 5HD'];
  const origin = new Date(2026, 9, 23, 9, 0);
  for (let seed = 1; seed <= 12; seed += 1) {
    const rand = mulberry32(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const chance = (p) => rand() < p;
    setClock(origin);
    storage = memStorage();
    initStore({ storage, force: true });
    updateSettings({ takingEmergencies: true });
    let tokens = [];
    let minutes = 0;
    for (let step = 0; step < 120; step += 1) {
      const st = getState();
      const day = (n) => {
        const d = new Date(2026, 9, 23 + n, 12);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      const someBooking = () => (st.bookings.length ? pick(st.bookings).id : 'bk_missing');
      const op = Math.floor(rand() * 34);
      let result = { ok: true };
      let name = `op ${op}`;
      if (op <= 2) {
        const sid = pick(SERVICES);
        const half = st.settings.services.find((x) => x.id === sid).blocks === 2;
        const [person, phone] = pick(PEOPLE);
        const pencil = sid === 'ev_quote' && chance(0.6);
        result = createBooking({
          serviceId: sid, variantId: sid === 'eicr' ? pick(['flat', 'house', 'large', undefined]) : undefined,
          ...(pencil ? { pencil: true } : { date: day(Math.floor(rand() * 16)), windowId: half ? pick([0, 2, 1]) : Math.floor(rand() * 4) }),
          customer: { name: person, phone }, address: { line1: sid === 'ev_quote' && chance(0.5) ? '' : '1 Test Road', postcode: pick(POSTCODES) },
          answers: chance(0.5) ? { parking: pick(['driveway', 'garage', 'moon']), timing: pick(['asap', 'month']), permission: 'yes' } : undefined,
          asOwner: chance(0.3), notifyCustomer: chance(0.7), source: pick(['website', 'phone', 'whatsapp'])
        });
        name = pencil ? 'createBooking (pencilled enquiry)' : 'createBooking';
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
      else if (op === 30) {
        const enquiries = st.bookings.filter((b) => b.serviceId === 'ev_quote');
        result = createQuote({ bookingId: enquiries.length ? pick(enquiries).id : 'x', brand: pick(['ZAPPI', 'OHME', 'NOPE']) });
        name = 'createQuote';
      } else if (op === 31) {
        const quotes = Object.values(st.quotes);
        const q = quotes.length ? pick(quotes) : { id: 'x' };
        result = pick([
          () => sendQuote(q.id, { via: pick(['whatsapp', 'email', 'link']) }),
          () => acceptQuote(q.id, { date: day(Math.floor(rand() * 16)), windowId: pick([0, 2, 1]) }),
          () => declineQuote(q.id, { reason: pick(['', 'Too dear']), by: pick(['customer', 'owner']) }),
          () => recordQuoteViewed(q.id),
          () => updateQuote(q.id, { notes: pick(['', 'Thanks']), lines: pick([undefined, [{ label: 'Charger', qty: 1, unitPrice: 800 }], []]) }),
          () => deleteQuote(q.id)
        ])();
        name = 'quote operation';
      } else if (op === 32) {
        result = pick([
          () => setAdSpend(pick(['2026-08', '2026-09', '2026-10']), pick(['facebook', 'google']), pick([0, 100, 250])),
          () => (st.settings.marketing.adSpend.length ? removeAdSpend(pick(st.settings.marketing.adSpend).id) : { ok: true }),
          () => connectGoogle(pick(['calendar', 'email']), { account: 'daniel@gmail.example' }),
          () => disconnect(pick(['domain', 'whatsapp', 'calendar', 'email', 'webhook', 'tracking'])),
          () => setConnection('calendar', { twoWay: chance(0.5) }),
          () => startDomainSetup('www.180electrical.co.uk'),
          () => checkDomain(),
          () => sendTestEvent(pick(['webhook', 'whatsapp', 'email'])),
          () => rotateWebhookSecret(),
          () => settleConnections()
        ])();
        name = 'marketing or connection operation';
      } else if (op === 33) {
        const target = st.bookings.length ? pick(st.bookings) : { id: 'x', photos: [] };
        const photo = { name: 'unit.jpg', dataUrl: `data:image/jpeg;base64,${'QUJD'.repeat(10)}` };
        result = chance(0.7) ? addBookingPhotos(target.id, [photo, photo]) : removeBookingPhoto(target.id, (target.photos || [{ id: 'x' }])[0].id);
        name = 'photos';
      } else if (op === 28) {
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

// ---------- the free-survey enquiry: answers, pencil, tentative, postcode-only addresses ----------

const ANSWERS = { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: false };
const enquiryDraft = (over = {}) => ({
  serviceId: 'ev_quote', pencil: true, customer: { name: 'Sinead Doherty', phone: '07700 900344' },
  address: { line1: '', postcode: 'BT42 6JN' }, answers: ANSWERS, ...over
});

test('createBooking stores answers: unknown keys ignored, invalid values dropped, the postcode filled in', () => {
  const made = createBooking(enquiryDraft({ answers: { ...ANSWERS, parking: 'moon', junk: 1, postcode: 'bt42 6jn' } }));
  assert.equal(made.ok, true);
  assert.deepEqual(made.booking.answers, { postcode: 'BT42 6JN', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: false });
  assert.deepEqual(getState().bookings.at(-1).answers, made.booking.answers, 'persisted with the booking');
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.state)).bookings.at(-1).answers, made.booking.answers);
  // the postcode falls back to the address postcode
  const fallback = createBooking(enquiryDraft({ customer: { name: 'Maeve Corr', phone: '07700 900501' }, address: { line1: '', postcode: 'bt270hd' }, answers: { parking: 'garage' } }));
  assert.deepEqual(fallback.booking.answers, { postcode: 'BT27 0HD', parking: 'garage' });
  // nothing valid: no answers object at all (a booking without answers behaves exactly as before)
  for (const answers of [undefined, null, {}, 'driveway', { parking: 'moon' }]) {
    const plain = createBooking(draftFor({ date: '2026-10-29', windowId: 2, answers }));
    assert.equal(plain.ok, true);
    assert.equal('answers' in plain.booking, false, JSON.stringify(answers));
    cancelBooking(plain.booking.id, 'owner');
  }
  // answers are accepted on any service
  const fault = createBooking(draftFor({ date: '2026-10-30', windowId: 0, answers: { timing: 'month' } }));
  assert.deepEqual(fault.booking.answers, { postcode: 'BT9 6QP', timing: 'month' });
});

test('a free-survey enquiry is never auto-confirmed, needs only a postcode, and {line1} falls back to it', () => {
  assert.equal(getState().settings.autoConfirm, true);
  const made = createBooking(enquiryDraft());
  assert.equal(made.ok, true, JSON.stringify(made));
  const b = made.booking;
  assert.equal(b.status, 'new', 'pending, even for a covered BT postcode with auto-confirm on');
  assert.equal(b.serviceName, 'Home EV charger quote');
  assert.equal(b.quotedPrice, 0);
  assert.deepEqual(b.address, { line1: '', postcode: 'BT42 6JN' });
  assert.deepEqual(b.history.map((h) => [h.event, h.by]), [['created', 'customer']]);
  assert.deepEqual(kinds(made.messages), ['customer_received', 'owner_new_booking'], 'no reminder until he confirms');
  assert.equal(b.seenByOwner, false);
  // the street stays required for every other service
  assert.deepEqual(createBooking(draftFor({ address: { line1: '', postcode: 'BT9 6QP' } })).errors, { line1: 'Enter your house number and street' });
  // and a postcode is always required, a name and a mobile too
  assert.deepEqual(createBooking(enquiryDraft({ address: { line1: '', postcode: '' }, customer: { name: '', phone: '' } })).errors, {
    name: 'Enter your name', phone: 'Enter your mobile number', postcode: 'Enter your postcode'
  });
  // a street typed by the customer (or taken on the phone) is kept and used
  const street = createBooking(enquiryDraft({ customer: { name: 'Maeve Corr', phone: '07700 900501' }, address: { line1: ' 41 Willow Bank ', postcode: 'BT27 5HD' } }));
  assert.equal(street.booking.address.line1, '41 Willow Bank');
  assert.ok(street.messages.at(-1).body.includes('\n41 Willow Bank, BT27 5HD\n'));
});

test('a covered-postcode survey for an owner-entered booking is confirmed at once (only the website enquiry is pending)', () => {
  const made = createBooking(enquiryDraft({ asOwner: true, source: 'phone' }));
  assert.equal(made.booking.status, 'confirmed');
  assert.equal(made.booking.tentative, undefined, 'the owner chose it, so nothing is provisional');
  assert.deepEqual(kinds(made.messages), ['customer_reminder', 'customer_confirmed']);
  assert.ok(made.messages[1].body.includes("You're booked in: Home EV charger quote, Sat 24 Oct, arriving between 8 and 10am, at BT42 6JN."));
});

test('pencil: the next free survey window is taken automatically and marked tentative', () => {
  const first = createBooking(enquiryDraft());
  assert.equal(first.ok, true);
  assert.equal(first.booking.start, '2026-10-24T08:00', 'Saturday 8am is the next free survey window');
  assert.equal(first.booking.durationMin, 120);
  assert.equal(first.booking.tentative, true);
  assert.equal(first.booking.status, 'new');
  assert.equal(slotStates('2026-10-24')[0], 'booked', 'the diary and the website both see the pencilled window as taken');
  // the next enquiry gets the next window, then the next
  const second = createBooking(enquiryDraft({ customer: { name: 'Maeve Corr', phone: '07700 900501' } }));
  const third = createBooking(enquiryDraft({ customer: { name: 'Callum Blair', phone: '07700 900502' } }));
  assert.equal(second.booking.start, '2026-10-26T08:00');
  assert.equal(third.booking.start, '2026-10-26T10:00');
  assert.equal(nextFreeSlot(getState(), 'ev_quote').human, 'Thu 29 Oct, 1–3pm', 'Monday afternoon is booked, Tuesday is full, Wednesday is the MOT');
  // the same through the second argument, and not for other services
  assert.equal(createBooking({ ...enquiryDraft({ customer: { name: 'Owen Mulholland', phone: '07700 900506' } }), pencil: undefined }, { pencil: true }).booking.tentative, true);
  assert.deepEqual(createBooking(draftFor({ date: undefined, windowId: undefined, pencil: true })).errors, { date: 'Choose a day', windowId: 'Choose a time' }, 'only the survey is pencilled in');
  // without `pencil` a window is still required
  assert.deepEqual(createBooking(enquiryDraft({ pencil: undefined })).errors, { date: 'Choose a day', windowId: 'Choose a time' });
  // a window the customer names is theirs to take: no pencil mark, still pending, and it must be free
  const named = createBooking(enquiryDraft({ customer: { name: 'Shane Kelly', phone: '07700 900504' }, date: '2026-10-30', windowId: 1 }));
  assert.equal(named.ok, true);
  assert.equal(named.booking.start, '2026-10-30T10:00');
  assert.equal(named.booking.tentative, undefined);
  assert.equal(named.booking.status, 'new');
  assert.equal(createBooking(enquiryDraft({ date: '2026-10-30', windowId: 1 })).reason, 'slot_taken');
  // `window: { date, windowId }` is the same as naming them
  const viaWindow = createBooking(enquiryDraft({ customer: { name: 'Joanne Moore', phone: '07700 900503' }, window: { date: '2026-10-30', windowId: 2 } }));
  assert.equal(viaWindow.booking.start, '2026-10-30T13:00');
  assert.equal(viaWindow.booking.tentative, undefined);
  // a half-day service is not an enquiry and is not pencilled in
  assert.equal(createBooking(eicrDraft({ pencil: true, date: undefined, windowId: undefined })).ok, false);
});

test('pencil: the owner alert and the customer text carry the answers, the pencilled window and the 24 hour promise', () => {
  const made = createBooking(enquiryDraft());
  const [received, alert] = made.messages;
  assert.equal(received.kind, 'customer_received');
  assert.equal(received.to, 'customer');
  assert.equal(
    received.body,
    'Hi Sinead, thanks for getting in touch with 180 Electrical. Your free survey visit is pencilled in for Sat 24 Oct, 8–10am. This is provisional, so please do not plan around it yet. Daniel will be in touch within 24 hours to confirm it. Ref EL-1043. Need us sooner? Call 07885 496800.'
  );
  assert.equal(alert.kind, 'owner_new_booking');
  assert.equal(alert.to, 'owner');
  assert.equal(
    alert.body.split('\n').slice(0, 8).join('\n'),
    '*New enquiry EL-1043*\nSinead Doherty · 07700 900344\nHome EV charger quote · Free\nSurvey pencilled in: Sat 24 Oct, arriving between 8 and 10am (provisional)\nBT42 6JN\nParking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.\nNeeds you: review the enquiry, then confirm the pencilled-in survey.\nOpen: ' + alert.body.split('\nOpen: ')[1]
  );
  assert.ok(alert.seq > received.seq, 'the owner alert is the newest of its group');
  assert.equal(selectUnreadMessageCount(getState()), 1);
  // outside Northern Ireland: still accepted, flagged on the owner alert, travel check on the customer text
  const far = createBooking(enquiryDraft({ customer: { name: 'Conor Brennan', phone: '07700 900219' }, address: { line1: '', postcode: 'dg9 8ab' } }));
  assert.equal(far.ok, true);
  assert.equal(far.booking.address.postcode, 'DG9 8AB');
  assert.ok(far.messages[1].body.includes('Outside Northern Ireland (DG9). Check you can travel before you confirm the survey.'));
  assert.ok(far.messages[0].body.includes('We just need to check travel to DG9 8AB.'));
  assert.ok(far.messages[0].body.includes('within 24 hours'));
});

test('tentative is cleared when the owner confirms or reschedules, kept when the customer moves it, and undo puts it back', () => {
  const made = createBooking(enquiryDraft());
  const id = made.booking.id;
  assert.equal(booking(id).tentative, true);
  // the owner confirms: firm, confirmation and reminder go out
  const confirmed = confirmBooking(id);
  assert.equal(confirmed.ok, true);
  assert.equal(booking(id).status, 'confirmed');
  assert.equal(booking(id).tentative, false);
  assert.equal(selectMessages(getState(), { bookingId: id })[0].kind, 'customer_confirmed');
  assert.ok(selectMessages(getState(), { bookingId: id })[0].body.includes('at BT42 6JN'), '{line1} is the postcode');
  assert.equal(undo(confirmed.undoToken).ok, true);
  assert.equal(booking(id).tentative, true, 'undo restores the pencil mark');
  assert.equal(booking(id).status, 'new');
  // the owner moves it: his choice, so no longer provisional (and still waiting for his OK)
  const moved = rescheduleBooking(id, { date: '2026-10-26', windowId: 1 });
  assert.equal(moved.ok, true);
  assert.equal(booking(id).tentative, false);
  assert.equal(booking(id).status, 'new');
  assert.equal(selectMessages(getState(), { bookingId: id })[0].kind, 'customer_rescheduled');
  assert.equal(undo(moved.undoToken).ok, true);
  assert.equal(booking(id).tentative, true);
  assert.equal(booking(id).start, '2026-10-24T08:00');
  // the customer moves a second enquiry (Monday, so more than 24 hours' notice): still pending, still provisional
  const other = createBooking(enquiryDraft({ customer: { name: 'Maeve Corr', phone: '07700 900501' } }));
  assert.equal(other.booking.start, '2026-10-26T08:00');
  const byCustomer = rescheduleBooking(other.booking.id, { date: '2026-10-26', windowId: 1 }, 'customer');
  assert.equal(byCustomer.ok, true);
  assert.equal(booking(other.booking.id).tentative, true);
  assert.equal(booking(other.booking.id).start, '2026-10-26T10:00');
  // declining or cancelling drops the pencil mark and frees the window
  const declined = declineBooking(other.booking.id);
  assert.equal(declined.ok, true);
  assert.equal(booking(other.booking.id).tentative, false);
  assert.equal(slotStates('2026-10-26')[1], 'free');
  const again = createBooking(enquiryDraft({ customer: { name: 'Callum Blair', phone: '07700 900502' } }));
  assert.equal(again.booking.start, '2026-10-26T08:00', 'the freed survey window is offered again');
  assert.equal(cancelBooking(again.booking.id, 'customer').ok, true);
  assert.equal(booking(again.booking.id).tentative, false);
});

test('an enquiry is kept (unscheduled) when no survey window is free, and the owner places it before confirming', () => {
  updateSettings({ hours: [[], [], [], [], [], [], []] });
  const made = createBooking(enquiryDraft());
  assert.equal(made.ok, true, 'a lead is never lost to a full diary');
  const b = made.booking;
  assert.equal(b.durationMin, 0);
  assert.equal(b.start, NOW);
  assert.equal(b.status, 'new');
  assert.equal(b.tentative, undefined);
  assert.equal(isUnscheduled(b), true);
  assert.deepEqual(bookingWindowIds(b), []);
  assert.ok(made.messages[0].body.includes('Daniel will be in touch within 24 hours to arrange your free survey visit.'));
  assert.ok(made.messages[1].body.includes('Survey: time to be arranged'));
  assert.equal(confirmBooking(b.id).reason, 'unscheduled', 'confirm needs a window first');
  assert.equal(booking(b.id).status, 'new');
  // the owner places it (opening hours still apply to him, so a day is opened first)
  updateSettings({ hours: [[], [0, 1, 2, 3], [], [], [], [], []] });
  const placed = rescheduleBooking(b.id, { date: '2026-10-26', windowId: 0 });
  assert.equal(placed.ok, true, JSON.stringify(placed));
  assert.equal(booking(b.id).start, '2026-10-26T08:00');
  assert.equal(booking(b.id).durationMin, 120, 'a survey takes one window');
  assert.equal(isUnscheduled(booking(b.id)), false);
  assert.equal(confirmBooking(b.id).ok, true);
  assert.equal(booking(b.id).status, 'confirmed');
});

test('line1 of the postcode-only address appears as the postcode in every customer message kind', () => {
  const made = createBooking(enquiryDraft());
  const id = made.booking.id;
  confirmBooking(id);
  assert.ok(selectMessages(getState(), { bookingId: id }).some((m) => m.kind === 'customer_confirmed' && m.body.includes('at BT42 6JN')));
  markOnTheWay(id, 20);
  assert.ok(selectMessages(getState(), { bookingId: id })[0].body.includes("I'm on my way to BT42 6JN, 20 minutes away"));
  sendQuickMessage(id, 'customer_need_access');
  assert.ok(selectMessages(getState(), { bookingId: id })[0].body.includes("I'm outside BT42 6JN."));
  sendQuickMessage(id, 'customer_quote_ready');
  assert.equal(selectMessages(getState(), { bookingId: id })[0].body, "Hi Sinead, it's Daniel from 180 Electrical. Your written quote is ready. Reply here or call 07885 496800 and I'll talk you through it. Ref EL-1043");
  for (const m of selectMessages(getState(), { bookingId: id })) {
    assert.ok(!/[{}]/.test(m.body) && !m.body.includes('undefined') && !m.body.includes('!'), m.kind);
  }
});

// ---------- settings that belong to the 180 model ----------

test('updateService can show or hide a service on the website; updateSettings keeps credentials and brands', () => {
  assert.equal(updateService('fault', { showOnWebsite: true }).service.showOnWebsite, true);
  assert.equal(getState().settings.services.find((x) => x.id === 'fault').showOnWebsite, true);
  assert.equal(updateService('ev_quote', { showOnWebsite: false }).service.showOnWebsite, false);
  assert.equal(updateService('fault', { showOnWebsite: 0 }).service.showOnWebsite, false);
  assert.equal(updateService('ev', { price: 949 }).service.price, 949, 'the quote-led installation keeps an amount for the owner');
  assert.equal(updateService('ev', { price: -1 }).reason, 'invalid');
  const result = updateSettings({ business: { credentials: [' Level 3 Electrical Installation ', '', 'City & Guilds 2391'], brands: ['ZAPPI', 'OHME'] } });
  assert.equal(result.ok, true);
  assert.deepEqual(getState().settings.business.credentials, ['Level 3 Electrical Installation', 'City & Guilds 2391']);
  assert.deepEqual(getState().settings.business.brands, ['ZAPPI', 'OHME']);
  assert.deepEqual(updateSettings({ business: { brands: 'ZAPPI' } }).ok, true, 'a non-array is ignored');
  assert.deepEqual(getState().settings.business.brands, ['ZAPPI', 'OHME']);
});

// ---------- an older stored state is migrated, not thrown away ----------

function oldShapeState(mutate = () => {}) {
  const old = JSON.parse(JSON.stringify(getState()));
  old.v = 1;
  old.settings.business = { ...old.settings.business, phone: '07700 900412', email: 'hello@180electrical.example', ownerFirstName: 'Dan', ownerFullName: 'Dan', schemeLine: 'Competent person scheme, reg. no. 000000 (sample)', insuranceLine: '£2m public liability cover (sample)' };
  delete old.settings.business.credentials;
  delete old.settings.business.brands;
  old.settings.services = old.settings.services.map(({ showOnWebsite, ...rest }) => rest);
  old.settings.takingEmergencies = true;
  old.settings.theme = 'auto';
  mutate(old);
  return old;
}

test('a stored v1 state is migrated to the 180 model: new fields and services, his real contact details, the customer data kept', () => {
  const mine = createBooking(draftFor({ date: '2026-10-29', windowId: 2 }));
  assert.equal(mine.ok, true);
  const old = oldShapeState((o) => {
    o.settings.services.find((x) => x.id === 'ev_quote').name = 'EV charger quote visit';
    o.settings.services.find((x) => x.id === 'ev').price = 949;
    o.settings.services.find((x) => x.id === 'fault').price = 80;
    o.settings.business.towns = ['Belfast', 'Lisburn'];
  });
  const s = memStorage({ [STORAGE_KEYS.state]: JSON.stringify(old) });
  const state = initStore({ storage: s, force: true });
  assert.equal(state.v, SCHEMA_VERSION);
  assert.equal(JSON.parse(s.getItem(STORAGE_KEYS.state)).v, SCHEMA_VERSION, 'written back as v2');
  assert.equal(STORAGE_KEYS.state, 'vm_state_v1', 'under the same key');
  const biz = state.settings.business;
  assert.equal(biz.phone, '07885 496800');
  assert.equal(biz.email, 'daniel@180electrical.co.uk');
  assert.equal(biz.ownerFirstName, 'Daniel');
  assert.equal(biz.ownerFullName, 'Daniel');
  assert.deepEqual(biz.credentials, ['Level 3 Electrical Installation', '2391 Inspection and Testing']);
  assert.deepEqual(biz.brands, ['ZAPPI', 'OHME', 'SYNC']);
  assert.equal(biz.schemeLine, '');
  assert.equal(biz.insuranceLine, '');
  assert.deepEqual(biz.towns, ['Belfast', 'Lisburn'], 'what the owner edited stays');
  const services = state.settings.services;
  assert.deepEqual(services.map((x) => x.id), ['ev_quote', 'ev', 'fault', 'eicr', 'consumer', 'sockets', 'rewire', 'emergency']);
  assert.equal(services[0].name, 'Home EV charger quote');
  assert.equal(services[0].showOnWebsite, true);
  assert.equal(services[1].priceType, 'quoted');
  assert.equal(services[1].price, 949, 'his own amount for the installation stays');
  assert.equal(services.find((x) => x.id === 'fault').price, 80);
  assert.ok(services.filter((x) => x.id !== 'ev_quote').every((x) => x.showOnWebsite === false));
  assert.equal(state.settings.takingEmergencies, false, 'the emergency path is off in the new model');
  assert.equal(state.settings.theme, 'auto', 'a valid saved theme mirror stays');
  // the customer's booking and its messages survive; the demo diary is re-seeded EV-led
  assert.ok(state.bookings.some((b) => b.id === mine.booking.id && !b.seed));
  assert.equal(state.bookings.filter((b) => b.seed).length, SEED_BOOKINGS);
  assert.equal(state.bookings.length, SEED_BOOKINGS + 1);
  assert.equal(state.seededFor, '2026-10-23');
  assert.ok(state.messages.some((m) => m.bookingId === mine.booking.id));
  assert.ok(state.bookings.find((b) => b.id === 'bk_seed_07').answers, 'the fresh seed has answers');
  assert.equal(state.meta.msgSeq, Math.max(...state.messages.map((m) => m.seq)));
  // and the store works as normal afterwards
  assert.equal(createBooking(enquiryDraft()).ok, true);
});

test('an old generic (MB postcodes) v1 state gets the 180 business wholesale; a v1 state with no services or business still loads', () => {
  const generic = oldShapeState((o) => {
    o.settings.business = { ...o.settings.business, name: 'Voltmere Electrical', shortName: 'Voltmere', phone: '07700 900412', coveredOutward: ['MB1', 'MB2'], edgeOutward: ['MB11'], towns: ['Marlbury'] };
  });
  const state = initStore({ storage: memStorage({ [STORAGE_KEYS.state]: JSON.stringify(generic) }), force: true });
  assert.equal(state.settings.business.name, '180 Electrical');
  assert.equal(state.settings.business.coveredOutward.length, 94);
  assert.deepEqual(state.settings.business.edgeOutward, []);
  assert.equal(state.settings.services[0].id, 'ev_quote');
  // sparse v1 settings do not break the migration
  const sparse = oldShapeState((o) => {
    delete o.settings.services;
    o.settings.business = { name: 'Ashby Sparks', shortName: 'Ashby', ownerFirstName: 'Lee', ownerFullName: 'Lee Ashby' };
  });
  const loaded = initStore({ storage: memStorage({ [STORAGE_KEYS.state]: JSON.stringify(sparse) }), force: true });
  assert.equal(loaded.v, SCHEMA_VERSION);
  assert.equal(loaded.settings.business.name, 'Ashby Sparks', 'a rebrand the owner made is kept');
  assert.equal(loaded.settings.business.ownerFullName, 'Lee Ashby');
  assert.equal(loaded.settings.business.phone, '07885 496800', 'missing fields come from the defaults');
  assert.equal(loaded.settings.services.length, 8);
  assert.equal(loaded.bookings.length, SEED_BOOKINGS);
  // a v1 state that is genuinely broken is still discarded and reseeded
  const broken = oldShapeState((o) => { o.bookings = 'nope'; });
  assert.equal(initStore({ storage: memStorage({ [STORAGE_KEYS.state]: JSON.stringify(broken) }), force: true }).bookings.length, SEED_BOOKINGS);
});

test('every function named in section 8.1 is exported', () => {
  const names = [
    'initStore', 'getState', 'subscribe', 'syncFromStorage', 'getStorageStatus', 'createBooking', 'confirmBooking', 'acceptEmergency',
    'declineBooking', 'markOnTheWay', 'completeBooking', 'markPaid', 'markUnpaid', 'cancelBooking', 'rescheduleBooking', 'updateBooking',
    'markSeen', 'markAllSeen', 'sendQuickMessage', 'sendPaymentNudge', 'sendReviewRequest', 'sendMessageNow', 'markMessagesSeen', 'addBlock',
    'blockRange', 'removeBlock', 'removeBlockGroup', 'addDaysOff', 'removeDayOff', 'setDayFull', 'updateSettings', 'updateService',
    'setTheme', 'setDemoPhone', 'resetDemo', 'simulateIncomingBooking', 'undo',
    // v3 (docs/V3-API.md section 4)
    'createQuote', 'updateQuote', 'deleteQuote', 'sendQuote', 'recordQuoteViewed', 'acceptQuote', 'declineQuote', 'setConnection', 'connectWhatsApp',
    'submitWhatsAppTemplates', 'connectGoogle', 'disconnect', 'startDomainSetup', 'checkDomain', 'rotateWebhookSecret', 'sendTestEvent',
    'settleConnections', 'setAdSpend', 'removeAdSpend', 'addBookingPhotos', 'removeBookingPhoto'
  ];
  for (const name of names) assert.equal(typeof store[name], 'function', name);
  assert.deepEqual(Object.keys(store).sort(), [...names].sort(), 'and nothing else');
});
