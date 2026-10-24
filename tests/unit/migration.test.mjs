// tests/unit/migration.test.mjs: unit tests for the saved-state migration to schema v3 (from the current v2 state, and the v1 chain)
// Owner: A3 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGES, SCHEMA_VERSION, STORAGE_KEYS, makeDefaultConnections, makeDefaultSettings } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { selectBookingById, selectPipeline } from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

const { initStore, getState, createBooking } = store;

const FIXTURE = new Date(2026, 9, 23, 20, 30);

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

beforeEach(() => setClock(FIXTURE));
afterEach(() => setClock(null));

/**
 * A saved v2 state as the previous build wrote it: a v3 state with everything v3 added taken away, plus a few records a person made.
 * (Built by hand from a fresh state so the test does not depend on a stored fixture.)
 */
function savedV2(mutate = () => {}) {
  const fresh = JSON.parse(JSON.stringify(initStore({ storage: memStorage(), force: true })));
  const v2 = fresh;
  v2.v = 2;
  delete v2.quotes;
  for (const key of ['sla', 'marketing', 'quoteItems', 'quoteDefaults', 'connections']) delete v2.settings[key];
  delete v2.settings.business.address;
  delete v2.settings.business.images;
  // v2 bookings never had utm, quoteId, photos; v2 seed ids were bk_seed_01 to 15
  v2.bookings = v2.bookings.filter((b) => Number(b.id.slice(-2)) <= 15).map((b) => ({ ...b, ref: b.ref }));
  const mine = {
    ...v2.bookings[0], id: 'bk_mine0001', ref: 'EL-1043', seed: false, serviceId: 'ev_quote', serviceName: 'Home EV charger quote', status: 'new', tentative: true, notes: 'made by a customer in v2',
    customer: { name: 'Hannah Boyd', phone: '07700 900777', email: 'h@example.com' }, createdAt: '2026-10-23T18:00', seenByOwner: false, history: [{ at: '2026-10-23T18:00', event: 'created', by: 'customer', note: 'website' }]
  };
  v2.bookings.push(mine);
  v2.refSeq = 1044;
  v2.messages.push({ id: 'msg_mine0001', at: '2026-10-23T18:00', sendAt: null, bookingId: 'bk_mine0001', to: 'owner', toName: 'Daniel', toPhone: '07885 496800', channel: 'whatsapp', kind: 'owner_new_booking', body: 'mine', seq: 999, simulated: true, seed: false });
  v2.meta.msgSeq = 999;
  v2.blocks.push({ id: 'blk_mine0001', date: '2026-11-10', windowId: 1, label: 'Dentist', groupId: null, seed: false });
  mutate(v2);
  return v2;
}

test('a saved v2 state migrates: v3 fields added with defaults, the demo records re-seeded, everything a person made kept', () => {
  const v2 = savedV2((s) => {
    s.settings.business.name = 'Ashby Sparks';
    s.settings.business.tagline = 'My own line';
    s.settings.business.brands = ['KEBA', 'ZAPPI'];
    s.settings.leadMinutes = 120;
    s.settings.theme = 'light';
    s.settings.demoPhoneDigits = '447700900555';
    s.settings.takingEmergencies = true;
    s.settings.daysOff.push({ id: 'off_mine', date: '2026-11-20', label: 'Holiday' });
  });
  assert.equal(v2.v, 2);
  assert.ok(v2.bookings.some((b) => b.seed) && v2.messages.some((m) => m.seed));
  const storage = memStorage({ [STORAGE_KEYS.state]: JSON.stringify(v2) });
  const state = initStore({ storage, force: true });
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(state.v, 3);
  assert.equal(state.seededFor, '2026-10-23');
  // what a person set survives
  assert.equal(state.settings.business.name, 'Ashby Sparks');
  assert.equal(state.settings.business.tagline, 'My own line');
  assert.deepEqual(state.settings.business.brands, ['KEBA', 'ZAPPI']);
  assert.equal(state.settings.leadMinutes, 120);
  assert.equal(state.settings.theme, 'light');
  assert.equal(state.settings.demoPhoneDigits, '447700900555');
  assert.equal(state.settings.takingEmergencies, true);
  assert.deepEqual(state.settings.daysOff.map((d) => d.id), ['off_mine']);
  // the v3 fields arrive with their defaults
  assert.equal(state.settings.business.address, '');
  assert.deepEqual(state.settings.business.images, DEFAULT_IMAGES);
  assert.deepEqual(state.settings.sla, { replyHours: 24 });
  assert.deepEqual(state.settings.quoteDefaults, makeDefaultSettings().quoteDefaults);
  assert.deepEqual(state.settings.connections, makeDefaultConnections());
  assert.deepEqual(state.settings.quoteItems.filter((i) => i.kind === 'charger').map((i) => i.brand), ['KEBA', 'ZAPPI'], 'the catalogue follows the saved brands');
  assert.equal(state.settings.quoteItems.length, 2 + 7);
  assert.equal(typeof state.quotes, 'object');
  // the person's records are there untouched, the v2 demo is replaced by the v3 demo
  assert.deepEqual(selectBookingById(state, 'bk_mine0001'), v2.bookings.find((b) => b.id === 'bk_mine0001'));
  assert.ok(state.messages.some((m) => m.id === 'msg_mine0001'));
  assert.ok(state.blocks.some((b) => b.id === 'blk_mine0001'));
  assert.equal(state.bookings.filter((b) => b.seed).length, 42, 'the v3 seed');
  assert.equal(state.bookings.filter((b) => !b.seed).length, 1);
  assert.equal(Object.keys(state.quotes).length, 17);
  assert.equal(state.settings.marketing.adSpend.length, 6, 'the demo ad spend');
  assert.ok(state.messages.every((m) => m.channel === 'whatsapp' || m.channel === 'email'));
  assert.equal(state.refSeq, 1044, 'refSeq never goes backwards');
  assert.ok(state.messages.filter((m) => m.seed).every((m) => m.seq > 999), 'seed seq numbers keep increasing');
  // no double booking: the v3 seed placed itself around the person's block and bookings
  assert.ok(!state.bookings.some((b) => b.seed && b.start.startsWith('2026-11-10T10:00')));
  // and it is saved as v3
  const saved = JSON.parse(storage.getItem(STORAGE_KEYS.state));
  assert.equal(saved.v, 3);
  assert.ok(saved.quotes && saved.settings.connections && saved.settings.sla);
  // the enquiry a customer made in v2 is a normal pending enquiry in the v3 pipeline
  const pipeline = selectPipeline(state, '2026-10-23T20:30');
  assert.equal(pipeline.stages.find((s) => s.id === 'enquiry').items.some((i) => i.bookingId === 'bk_mine0001'), true);
});

test('migration keeps v3 values that a v2 business already had (address and images typed in a pre-release build)', () => {
  const v2 = savedV2((s) => {
    s.settings.business.address = '1 Real Street';
    s.settings.business.images = { hero: 'img/hero.jpg' };
    s.settings.sla = { replyHours: 12 };
  });
  const state = initStore({ storage: memStorage({ [STORAGE_KEYS.state]: JSON.stringify(v2) }), force: true });
  assert.equal(state.settings.business.address, '1 Real Street');
  assert.deepEqual(state.settings.business.images, { ...DEFAULT_IMAGES, hero: 'img/hero.jpg' });
  assert.deepEqual(state.settings.sla, { replyHours: 12 });
});

test('after migrating, everything works: a new booking gets the next ref and the quote flow runs on the migrated state', () => {
  const storage = memStorage({ [STORAGE_KEYS.state]: JSON.stringify(savedV2()) });
  initStore({ storage, force: true });
  const made = createBooking({ serviceId: 'fault', date: '2026-10-24', windowId: 0, customer: { name: 'Aoife Magee', phone: '07700 900231' }, address: { line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' } });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.booking.ref, 'EL-1044');
  const quote = store.createQuote({ bookingId: 'bk_mine0001' });
  assert.equal(quote.ok, true);
  assert.equal(quote.quote.id, 'Q-EL-1043');
  assert.equal(quote.quote.brand, 'ZAPPI');
  assert.equal(store.sendQuote(quote.quote.id, { via: 'whatsapp' }).ok, true);
  assert.equal(store.setConnection('tracking', { metaPixelId: '1234567890' }).ok, true);
  assert.equal(store.setAdSpend('2026-10', 'google', 100).ok, true);
});

test('a state that is already v3 loads as it is (no reseed on the same day)', () => {
  const storage = memStorage();
  initStore({ storage, force: true });
  const made = createBooking({ serviceId: 'fault', date: '2026-10-24', windowId: 0, customer: { name: 'Aoife Magee', phone: '07700 900231' }, address: { line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' } });
  const raw = storage.getItem(STORAGE_KEYS.state);
  const again = initStore({ storage, force: true });
  assert.equal(storage.getItem(STORAGE_KEYS.state), raw, 'not rewritten');
  assert.ok(selectBookingById(again, made.booking.id));
  assert.equal(again.bookings.length, 43);
});

test('a state from the future (v4) or a v3 state missing its quotes is discarded and reseeded, never trusted', () => {
  const good = JSON.parse(JSON.stringify(initStore({ storage: memStorage(), force: true })));
  const future = { ...good, v: 4 };
  const noQuotes = { ...good };
  delete noQuotes.quotes;
  const noConnections = JSON.parse(JSON.stringify(good));
  delete noConnections.settings.connections;
  for (const [label, saved] of [['v4', future], ['no quotes', noQuotes], ['no connections', noConnections], ['quotes as an array', { ...good, quotes: [] }]]) {
    const storage = memStorage({ [STORAGE_KEYS.state]: JSON.stringify({ ...saved, bookings: saved.bookings.filter((b) => b.id !== 'bk_seed_01') }) });
    const state = initStore({ storage, force: true });
    assert.equal(state.v, 3, label);
    assert.ok(selectBookingById(state, 'bk_seed_01'), `${label}: reseeded from scratch`);
    assert.equal(Object.keys(state.quotes).length, 17, label);
  }
});

test('a v1 state goes through both migrations to v3', () => {
  const v1 = {
    v: 1, seededFor: '2026-10-22', refSeq: 1050,
    settings: { business: { name: 'Voltmere Electrical', shortName: 'Voltmere', ownerFirstName: 'Dan', ownerFullName: 'Dan Mercer', phone: '07700 900412', email: 'dan@voltmere.example', coveredOutward: ['MB1'], edgeOutward: [], towns: [] },
      hours: [[], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1]], leadMinutes: 90, maxDaysAhead: 14, daysOff: [], fullDays: [], autoConfirm: true, remindersOn: true, services: [], templates: {}, theme: 'dark', demoPhoneDigits: '' },
    bookings: [], blocks: [], messages: [], meta: { rev: 3, msgSeq: 4, messagesSeenSeq: 4, simCursor: 0 }
  };
  const state = initStore({ storage: memStorage({ [STORAGE_KEYS.state]: JSON.stringify(v1) }), force: true });
  assert.equal(state.v, 3);
  assert.equal(state.settings.business.name, '180 Electrical', 'the old generic business is replaced wholesale');
  assert.equal(state.settings.business.phone, '07885 496800');
  assert.deepEqual(state.settings.connections, makeDefaultConnections());
  assert.equal(typeof state.quotes, 'object');
  assert.equal(state.bookings.length, 42);
});
