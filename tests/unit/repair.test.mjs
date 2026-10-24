// tests/unit/repair.test.mjs: repairState keeps a saved state that is the right outline but wrong deep inside from reaching a screen
// Owner: ROBUST (final gate)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { repairState } from '../../js/core/repair.js';
import * as selectors from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

const FIXTURE = new Date(2026, 9, 23, 20, 30);
beforeEach(() => setClock(FIXTURE));
afterEach(() => setClock(null));

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}
const seeded = () => {
  const storage = memStorage();
  store.initStore({ storage, force: true });
  return JSON.parse(storage.map.get(STORAGE_KEYS.state));
};
const TODAY = '2026-10-23';

test('a clean seeded state is left exactly as it is (nothing changed, nothing counted)', () => {
  const st = seeded();
  const copy = JSON.parse(JSON.stringify(st));
  const { changes } = repairState(copy, { today: TODAY });
  assert.equal(changes, 0);
  assert.deepEqual(copy, st);
});

test('a state after a lot of real use is left exactly as it is', () => {
  const storage = memStorage();
  store.initStore({ storage, force: true });
  const sim = store.simulateIncomingBooking({});
  store.createBooking({ serviceId: 'fault', date: '2026-10-26', windowId: 0, customer: { name: 'Aoife Magee', phone: '07700 900231' }, address: { line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' } });
  const q = store.createQuote({ bookingId: sim.booking.id });
  store.updateQuote(q.quote.id, { notes: 'Terms' });
  store.sendQuote(q.quote.id, { via: 'whatsapp' });
  store.addBlock({ date: '2026-11-02', windowId: 1, label: 'Dentist' });
  store.addDaysOff(['2026-11-10'], 'Holiday');
  store.setConnection('webhook', { enabled: true });
  store.connectGoogle('calendar', { account: 'daniel@gmail.com' });
  store.addBookingPhotos(sim.booking.id, [{ name: 'cu.jpg', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(200) }]);
  store.updateSettings({ business: { name: 'Sparks' }, quoteItems: store.getState().settings.quoteItems.map((i) => ({ ...i, unitPrice: i.unitPrice + 1 })) });
  const st = JSON.parse(storage.map.get(STORAGE_KEYS.state));
  const copy = JSON.parse(JSON.stringify(st));
  const { changes } = repairState(copy, { today: TODAY });
  assert.equal(changes, 0);
  assert.deepEqual(copy, st);
});

const BENDS = [
  ['a null in bookings', (s) => { s.bookings.push(null, 5, 'x', []); }],
  ['a booking with no customer', (s) => { s.bookings[3].customer = null; }],
  ['a number for a name', (s) => { s.bookings[4].customer.name = 42; }],
  ['no history', (s) => { delete s.bookings[5].history; }],
  ['garbage start', (s) => { s.bookings[6].start = 'next tuesday'; }],
  ['no address', (s) => { s.bookings[7].address = null; }],
  ['unknown status', (s) => { s.bookings[8].status = 'maybe'; }],
  ['price strings', (s) => { s.bookings[9].finalPrice = 'lots'; s.bookings[9].quotedPrice = {}; }],
  ['bad photos', (s) => { s.bookings[10].photos = [null, 5, { dataUrl: 'javascript:alert(1)' }]; }],
  ['message with no body or time', (s) => { s.messages[2].body = null; s.messages[2].at = null; }],
  ['null messages', (s) => { s.messages.push(null, 7); }],
  ['block with no date', (s) => { s.blocks.push({ id: 'blk_x' }); }],
  ['null block', (s) => { s.blocks.push(null); }],
  ['quote with no lines', (s) => { Object.values(s.quotes)[2].lines = null; }],
  ['quote of garbage lines', (s) => { Object.values(s.quotes)[3].lines = [null, 'x', { label: 5, qty: 'a', unitPrice: 'b' }, { label: 'ok', qty: 2, unitPrice: 10 }]; }],
  ['quote for a missing booking (an orphan is allowed, nothing to repair)', (s) => { Object.values(s.quotes)[4].bookingId = 'bk_missing'; }, false],
  ['hours that are not a week', (s) => { s.settings.hours = [[], [0]]; }],
  ['day off with no date', (s) => { s.settings.daysOff.push({ id: 'off_x' }); }],
  ['service with no variants', (s) => { delete s.settings.services[0].variants; }],
  ['business fields of the wrong type', (s) => { s.settings.business.name = 5; s.settings.business.phone = null; s.settings.business.brands = 'ZAPPI'; }],
  ['connections of the wrong type', (s) => { s.settings.connections.whatsapp = 'on'; delete s.settings.connections.calendar.twoWay; s.settings.connections.email.status = 7; }],
  ['a quote item with no price', (s) => { s.settings.quoteItems.push({ id: 'x' }, null); }]
];

// every pure selector that takes only the state, plus the ones the screens call with the clock
function allSelectors(state) {
  const failures = [];
  for (const [name, fn] of Object.entries(selectors)) {
    if (typeof fn !== 'function') continue;
    try {
      if (fn.length <= 1) fn(state);
      if (/^selectPipeline$|^selectNeedsYou$|^selectToday/.test(name)) fn(state, '2026-10-23T20:30');
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }
  return failures;
}

test('every deep corruption is repaired: the entries that cannot be shown are dropped, none of the selectors throws, the rest of the state is untouched', () => {
  const baseline = allSelectors(seeded());
  assert.deepEqual(baseline, [], 'baseline: ' + baseline.join('; '));
  for (const [name, bend, expectChange = true] of BENDS) {
    const st = seeded();
    bend(st);
    const { changes } = repairState(st, { today: TODAY });
    if (expectChange) assert.ok(changes > 0, `${name}: should have counted a change`);
    assert.deepEqual(allSelectors(st), [], name);
    // and it loads through the real store without a throw
    const storage = memStorage({ [STORAGE_KEYS.state]: JSON.stringify(st) });
    const loaded = store.initStore({ storage, force: true });
    assert.ok(loaded.bookings.length >= 40, name);
    // a repaired state is stable: repairing it again changes nothing
    assert.equal(repairState(JSON.parse(JSON.stringify(loaded)), { today: TODAY }).changes, 0, name + ' (second pass)');
  }
});

test('the usable part of a half-broken quote survives and the broken part goes', () => {
  const st = seeded();
  const q = Object.values(st.quotes)[3];
  q.lines = [null, 'x', { label: 5, qty: 'a', unitPrice: 'b' }, { label: 'Charger', qty: 2, unitPrice: 10 }];
  repairState(st, { today: TODAY });
  assert.equal(q.lines.length, 1);
  assert.equal(q.lines[0].label, 'Charger');
  assert.equal(q.lines[0].optional, false);
  assert.ok(q.lines[0].id);
});

test('two bookings carrying the same ref (two tabs saved at once) are told apart; the earlier keeps it, the sequence moves on', () => {
  const st = seeded();
  const a = st.bookings[0];
  const b = st.bookings[1];
  b.ref = a.ref;
  const refSeq = st.refSeq;
  repairState(st, { today: TODAY });
  assert.equal(new Set(st.bookings.map((x) => x.ref)).size, st.bookings.length);
  assert.equal(st.bookings[0].ref, a.ref);
  assert.equal(st.bookings[1].ref, `EL-${refSeq}`);
  assert.equal(st.refSeq, refSeq + 1);
});

test('two records with the same id leave one; a ref sequence that fell behind the refs in use is lifted', () => {
  const st = seeded();
  st.bookings.push(JSON.parse(JSON.stringify(st.bookings[2])));
  st.refSeq = 3;
  const n = st.bookings.length;
  repairState(st, { today: TODAY });
  assert.equal(st.bookings.length, n - 1);
  const top = Math.max(...st.bookings.map((x) => Number(x.ref.slice(3))));
  assert.ok(st.refSeq > top);
});

test('initStore keeps a copy of a save it had to repair or replace (small ones), and saves the repaired state', () => {
  const st = seeded();
  st.bookings.push(null);
  const raw = JSON.stringify(st);
  const storage = memStorage({ [STORAGE_KEYS.state]: raw });
  store.initStore({ storage, force: true });
  assert.equal(storage.map.get(STORAGE_KEYS.backup), raw);
  assert.ok(!JSON.parse(storage.map.get(STORAGE_KEYS.state)).bookings.includes(null));
  const bad = memStorage({ [STORAGE_KEYS.state]: '{"v":3,' });
  store.initStore({ storage: bad, force: true });
  assert.equal(bad.map.get(STORAGE_KEYS.backup), '{"v":3,');
  assert.equal(JSON.parse(bad.map.get(STORAGE_KEYS.state)).v, 3);
});

// ---- a seeded fuzz: bend random leaves of the state into hostile values; nothing may throw ----
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const HOSTILE = [null, undefined, 0, -1, 1e308, NaN, '', 'x'.repeat(5000), [], {}, [null], { a: 1 }, true, false, '<img src=x onerror=alert(1)>', '2026-02-31', '9999-99-99T99:99'];
function leaves(node, path, out, depth = 0) {
  if (depth > 6 || !node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    out.push([node, k]);
    leaves(node[k], path + '/' + k, out, depth + 1);
  }
}

test('fuzz: 400 states with 1 to 6 random fields set to hostile values never throw out of initStore and never break a selector', () => {
  const base = seeded();
  const rand = rng(Number(process.env.FUZZ_SEED || 20261023));
  const runs = Number(process.env.FUZZ_N || 400);
  let selectorFailures = [];
  for (let i = 0; i < runs; i += 1) {
    if (process.env.FUZZ_TRACE) process.stderr.write(`iter ${i}\n`);
    const st = JSON.parse(JSON.stringify(base));
    const spots = [];
    leaves(st, '', spots);
    const n = 1 + Math.floor(rand() * 6);
    for (let j = 0; j < n; j += 1) {
      const [node, key] = spots[Math.floor(rand() * spots.length)];
      if (key === 'v') continue; // the schema number is the one field the loader must trust
      const value = HOSTILE[Math.floor(rand() * HOSTILE.length)];
      if (value === undefined) delete node[key]; else node[key] = JSON.parse(JSON.stringify(value === undefined ? null : value, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
    }
    let loaded;
    const storage = memStorage({ [STORAGE_KEYS.state]: JSON.stringify(st) });
    assert.doesNotThrow(() => { loaded = store.initStore({ storage, force: true }); }, `fuzz ${i}`);
    // and the things a person does next work on it (they may refuse, they may not throw)
    assert.doesNotThrow(() => {
      store.simulateIncomingBooking({});
      store.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA' }, customer: { name: 'Fuzz', phone: '07700 900321' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true });
      store.addBlock({ date: '2026-11-03', windowId: 2, label: 'Fuzz' });
      store.updateSettings({ theme: 'light' });
      for (const q of Object.values(store.getState().quotes).slice(0, 3)) store.sendQuote(q.id, { via: 'link' });
      for (const b of store.getState().bookings.slice(0, 4)) { store.confirmBooking(b.id); store.cancelBooking(b.id, 'owner', {}); }
      store.markAllSeen();
    }, `fuzz ${i} (actions)`);
    const failures = allSelectors(store.getState());
    if (failures.length) selectorFailures.push(`#${i}: ${failures.slice(0, 2).join(' / ')}`);
  }
  assert.deepEqual(selectorFailures.slice(0, 5), [], `${selectorFailures.length} of ${runs} broke a selector`);
});
