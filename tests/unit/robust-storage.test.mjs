// tests/unit/robust-storage.test.mjs: the store never half-writes. With the browser's quota full, every mutation either fails with 'storage_full'
// and changes NOTHING (the state object, the saved JSON, the undo list), or is a harmless no-op; blocked storage drops to memory mode and keeps working;
// corrupted, newer, wrong-shaped and huge saves never throw out of initStore.
// Owner: ROBUST (final gate)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, STORAGE_KEYS } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import * as store from '../../js/core/store.js';

const KEY = STORAGE_KEYS.state;
const FIXTURE = new Date(2026, 9, 23, 20, 30);
beforeEach(() => setClock(FIXTURE));
afterEach(() => setClock(null));

const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError', code: 22 });

/** A StorageLike whose big writes (the state key) can be refused, the way a full browser quota refuses them; small ones keep working. */
function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const s = {
    map, full: false, writes: 0,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (s.full && k === KEY) throw quotaError(); s.writes += 1; map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); }
  };
  return s;
}

const seededRaw = (() => {
  const storage = memStorage();
  store.initStore({ storage, force: true });
  return storage.map.get(KEY);
})();

const day = (offset) => {
  const d = new Date(2026, 9, 23 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(300);

/** What each operation needs from the seeded state; `null` from pick means "nothing suitable in this seed", which the test reports as skipped. */
const first = (list, fn) => list.find(fn) || null;
const OPS = [
  ['createBooking (a website enquiry)', (s, st) => s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name: 'Quota Test', phone: '07700 900321', email: 'q@example.com' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true })],
  ['createBooking (an enquiry with photos keeps nothing when the quota is full)', (s) => s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA' }, customer: { name: 'Quota Photos', phone: '07700 900322', email: '' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true, photos: [{ name: 'a.jpg', dataUrl: JPEG }] })],
  ['simulateIncomingBooking', (s) => s.simulateIncomingBooking({ kind: 'standard' })],
  ['confirmBooking', (s, st) => { const b = first(st.bookings, (x) => x.status === 'new' && !x.urgent && x.serviceId !== 'ev_quote' && x.durationMin > 0); return b && s.confirmBooking(b.id); }],
  ['declineBooking', (s, st) => { const b = first(st.bookings, (x) => x.status === 'new'); return b && s.declineBooking(b.id); }],
  ['markOnTheWay', (s, st) => { const b = first(st.bookings, (x) => x.status === 'confirmed' && !x.urgent); return b && s.markOnTheWay(b.id, 20); }],
  ['completeBooking', (s, st) => { const b = first(st.bookings, (x) => x.status === 'confirmed'); return b && s.completeBooking(b.id, { finalPrice: 100, paid: true, paidMethod: 'cash' }); }],
  ['markPaid', (s, st) => { const b = first(st.bookings, (x) => x.status === 'done' && !x.paid); return b && s.markPaid(b.id, 'cash'); }],
  ['markUnpaid', (s, st) => { const b = first(st.bookings, (x) => x.status === 'done' && x.paid); return b && s.markUnpaid(b.id); }],
  ['cancelBooking', (s, st) => { const b = first(st.bookings, (x) => x.status === 'confirmed' && x.durationMin > 0); return b && s.cancelBooking(b.id, 'owner', { reason: 'test' }); }],
  ['rescheduleBooking', (s, st) => { const b = first(st.bookings, (x) => x.status === 'confirmed' && !x.urgent && x.durationMin === 120); return b && s.rescheduleBooking(b.id, { date: day(40), windowId: 1 }); }],
  ['updateBooking', (s, st) => s.updateBooking(st.bookings[0].id, { internalNotes: 'quota note' })],
  ['markSeen', (s, st) => { const b = first(st.bookings, (x) => !x.seenByOwner); return b && s.markSeen(b.id); }],
  ['markAllSeen', (s) => s.markAllSeen()],
  ['sendQuickMessage', (s, st) => { const b = first(st.bookings, (x) => x.status === 'confirmed' && !x.urgent); return b && s.sendQuickMessage(b.id, 'customer_running_late'); }],
  ['sendPaymentNudge', (s, st) => { const b = first(st.bookings, (x) => x.status === 'done' && !x.paid); return b && s.sendPaymentNudge(b.id); }],
  ['sendReviewRequest', (s, st) => { const b = first(st.bookings, (x) => x.status === 'done' && !x.reviewRequested); return b && s.sendReviewRequest(b.id); }],
  ['sendMessageNow', (s, st) => { const m = first(st.messages, (x) => x.sendAt && x.sendAt > '2026-10-23T20:30'); return m && s.sendMessageNow(m.id); }],
  ['markMessagesSeen', (s) => s.markMessagesSeen()],
  ['addBlock', (s) => s.addBlock({ date: day(30), windowId: 1, label: 'Quota block' })],
  ['blockRange', (s) => s.blockRange({ fromDate: day(31), toDate: day(32), label: 'Quota range' })],
  ['removeBlock', (s, st) => { const b = first(st.blocks, (x) => !x.groupId); return b && s.removeBlock(b.id); }],
  ['addDaysOff', (s) => s.addDaysOff([day(35)], 'Quota holiday')],
  ['setDayFull', (s) => s.setDayFull(day(36), true)],
  ['updateSettings (business name)', (s) => s.updateSettings({ business: { name: 'Quota Sparks' } })],
  ['updateSettings (theme)', (s) => s.updateSettings({ theme: 'light' })],
  ['updateService', (s, st) => s.updateService(st.settings.services[0].id, { active: false })],
  ['setTheme', (s) => s.setTheme('light')],
  ['setDemoPhone', (s) => s.setDemoPhone('07700 900555')],
  ['resetDemo', (s) => s.resetDemo({ keepSettings: true })],
  ['createQuote', (s, st) => { const b = first(st.bookings, (x) => x.serviceId === 'ev_quote' && x.status !== 'cancelled' && !Object.values(st.quotes).some((q) => q.bookingId === x.id)); return b && s.createQuote({ bookingId: b.id }); }],
  ['updateQuote', (s, st) => { const q = first(Object.values(st.quotes), (x) => x.status === 'draft'); return q && s.updateQuote(q.id, { notes: 'Quota notes' }); }],
  ['deleteQuote', (s, st) => { const q = first(Object.values(st.quotes), (x) => x.status === 'draft'); return q && s.deleteQuote(q.id); }],
  ['sendQuote', (s, st) => { const q = first(Object.values(st.quotes), (x) => x.status === 'draft'); return q && s.sendQuote(q.id, { via: 'whatsapp' }); }],
  ['recordQuoteViewed', (s, st) => { const q = first(Object.values(st.quotes), (x) => x.status === 'sent'); return q && s.recordQuoteViewed(q.id); }],
  ['acceptQuote', (s, st) => { const q = first(Object.values(st.quotes), (x) => x.status === 'sent' || x.status === 'viewed'); return q && s.acceptQuote(q.id, { date: day(20), windowId: 0 }); }],
  ['declineQuote', (s, st) => { const q = first(Object.values(st.quotes), (x) => x.status === 'sent' || x.status === 'viewed'); return q && s.declineQuote(q.id, { reason: 'too dear' }); }],
  ['addBookingPhotos', (s, st) => { const b = first(st.bookings, (x) => !x.photos); return b && s.addBookingPhotos(b.id, [{ name: 'a.jpg', dataUrl: JPEG }]); }],
  ['setAdSpend', (s) => s.setAdSpend('2026-10', 'facebook', 123)],
  ['setConnection (webhook)', (s) => s.setConnection('webhook', { enabled: true })],
  ['connectWhatsApp', (s) => s.connectWhatsApp({ number: '07885 496800', code: '123456' })],
  ['connectGoogle (calendar)', (s) => s.connectGoogle('calendar', { account: 'daniel@gmail.com' })],
  ['disconnect (tracking)', (s) => s.disconnect('tracking')],
  ['startDomainSetup', (s) => s.startDomainSetup('www.example-sparks.co.uk')],
  ['rotateWebhookSecret', (s) => s.rotateWebhookSecret()],
  ['sendTestEvent', (s) => s.sendTestEvent('webhook')]
];

function trial(op, full) {
  const storage = memStorage({ [KEY]: seededRaw });
  store.initStore({ storage, force: true });
  const before = store.getState();
  const rawBefore = storage.map.get(KEY);
  storage.full = full;
  const res = op(store, before);
  return { res, before, after: store.getState(), rawBefore, rawAfter: storage.map.get(KEY), storage };
}

test('with the quota full no mutation changes anything: same state object, same saved JSON, reason storage_full', () => {
  let exercised = 0;
  const skipped = [];
  for (const [name, op] of OPS) {
    const normal = trial(op, false);
    if (normal.res === null || normal.res === undefined || !normal.res.ok) { skipped.push(`${name} (${normal.res ? normal.res.reason : 'no suitable record in the seed'})`); continue; }
    const wrote = normal.rawAfter !== normal.rawBefore;
    const t = trial(op, true);
    if (!wrote) { assert.ok(t.res && t.res.ok, `${name}: a no-op stays a no-op when full`); continue; }
    exercised += 1;
    assert.ok(t.res && t.res.ok === false && t.res.reason === 'storage_full', `${name}: should fail with storage_full, got ${JSON.stringify(t.res && { ok: t.res.ok, reason: t.res.reason })}`);
    assert.equal(t.after, t.before, `${name}: the state object must be untouched`);
    assert.equal(t.rawAfter, t.rawBefore, `${name}: the saved JSON must be untouched`);
    assert.equal(t.res.undoToken, undefined, `${name}: no undo token for a change that did not happen`);
  }
  assert.ok(exercised >= 35, `exercised ${exercised} mutations; skipped: ${skipped.join('; ')}`);
});

test('a refused write leaves the undo list alone: an earlier change can still be undone, and resetDemo does not forget it', () => {
  const storage = memStorage({ [KEY]: seededRaw });
  store.initStore({ storage, force: true });
  const made = store.addBlock({ date: day(30), windowId: 2, label: 'Undo me' });
  assert.ok(made.ok && made.undoToken);
  storage.full = true;
  const reset = store.resetDemo({ keepSettings: true });
  assert.equal(reset.reason, 'storage_full');
  storage.full = false;
  const undone = store.undo(made.undoToken);
  assert.ok(undone.ok, 'the undo token survived the refused reset');
  assert.ok(!store.getState().blocks.some((b) => b.label === 'Undo me'));
});

test('once room is back the same action works, exactly once (no duplicate ref, no duplicate message)', () => {
  const storage = memStorage({ [KEY]: seededRaw });
  store.initStore({ storage, force: true });
  const input = { serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name: 'Again', phone: '07700 900321', email: '' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true };
  const bookings = store.getState().bookings.length;
  const messages = store.getState().messages.length;
  const refSeq = store.getState().refSeq;
  storage.full = true;
  for (let i = 0; i < 3; i += 1) assert.equal(store.createBooking(input).reason, 'storage_full');
  assert.equal(store.getState().refSeq, refSeq, 'a refused write does not burn a reference number');
  storage.full = false;
  const ok = store.createBooking(input);
  assert.ok(ok.ok);
  const st = store.getState();
  assert.equal(st.bookings.length, bookings + 1);
  assert.equal(st.refSeq, refSeq + 1);
  assert.ok(st.messages.length > messages);
  assert.equal(new Set(st.bookings.map((b) => b.ref)).size, st.bookings.length, 'refs stay unique');
});

test('storage that refuses every write drops to memory mode: nothing throws and the changes live for the page', () => {
  const dead = { getItem: () => null, setItem: () => { throw quotaError(); }, removeItem: () => { throw quotaError(); } };
  const st = store.initStore({ storage: dead, force: true });
  assert.equal(store.getStorageStatus().mode, 'memory');
  assert.ok(st.bookings.length > 0);
  const res = store.addBlock({ date: day(30), windowId: 1, label: 'Memory block' });
  assert.ok(res.ok);
  assert.ok(store.getState().blocks.some((b) => b.label === 'Memory block'));
});

test('storage that fails after it was working (a write is refused outright mid-session) switches to memory mode and keeps going', () => {
  const storage = memStorage({ [KEY]: seededRaw });
  store.initStore({ storage, force: true });
  assert.equal(store.getStorageStatus().mode, 'local');
  storage.setItem = () => { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); };
  const res = store.addBlock({ date: day(30), windowId: 1, label: 'Blocked mid-session' });
  assert.ok(res.ok, 'the change is kept in memory');
  assert.equal(store.getStorageStatus().mode, 'memory');
  let told = 0;
  const off = store.subscribe(() => { told += 1; });
  store.addBlock({ date: day(30), windowId: 2, label: 'And another' });
  off();
  assert.equal(told, 1);
});

// ---------------------------------------------------------------- bad saved data

function initWith(raw) {
  const storage = memStorage(raw === undefined ? {} : { [KEY]: raw });
  const state = store.initStore({ storage, force: true });
  return { state, storage };
}
const isSeeded = (st) => st && st.v === SCHEMA_VERSION && st.bookings.length > 0 && st.seededFor === '2026-10-23';

test('saved data that is not usable never throws out of initStore: it is replaced by a fresh seeded state', () => {
  const bad = [
    '', '{', 'null', '[]', '0', '"text"', 'true', '{}', '{"v":"3"}', '{"v":3}', '{"v":3,"bookings":{}}', '{"v":99,"bookings":[]}', '{"v":-1}', '{"v":3.5}', '{"v":0}',
    '{"v":3,"bookings":[],"blocks":[],"messages":[],"settings":null,"meta":{},"quotes":{}}',
    '\u0000\u0000\u0000', 'undefined', 'NaN', '{"__proto__":{"v":3}}', '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[['
  ];
  for (const raw of bad) {
    const { state } = initWith(raw);
    assert.ok(isSeeded(state), `raw ${JSON.stringify(raw).slice(0, 60)} should fall back to a fresh seeded state`);
  }
});

test('a state that parses but is the wrong shape in one deep place is rejected, not half-used', () => {
  const good = JSON.parse(seededRaw);
  const broken = [
    (s) => { s.bookings = 'x'; }, (s) => { s.messages = null; }, (s) => { s.settings.services = {}; }, (s) => { s.settings.hours = 7; },
    (s) => { s.meta = null; }, (s) => { s.meta.rev = 'a'; }, (s) => { s.refSeq = 'EL-1'; }, (s) => { s.quotes = []; },
    (s) => { s.settings.connections = null; }, (s) => { s.settings.business = null; }, (s) => { delete s.settings.quoteDefaults; }
  ];
  for (const mutate of broken) {
    const copy = JSON.parse(JSON.stringify(good));
    mutate(copy);
    const { state } = initWith(JSON.stringify(copy));
    assert.ok(isSeeded(state));
  }
});

test('a huge saved state (3 MB of customer notes) loads and works', () => {
  const big = JSON.parse(seededRaw);
  const text = 'N'.repeat(70000);
  for (const b of big.bookings) b.internalNotes = text;
  const raw = JSON.stringify(big);
  assert.ok(raw.length > 2.5e6);
  const { state } = initWith(raw);
  assert.ok(isSeeded(state));
  assert.equal(state.bookings.length, big.bookings.length);
  assert.ok(store.addBlock({ date: day(30), windowId: 1, label: 'After huge' }).ok);
});

test('another tab writing garbage never replaces what this tab has', () => {
  const storage = memStorage({ [KEY]: seededRaw });
  const before = store.initStore({ storage, force: true });
  storage.map.set(KEY, '{"v":3,"oops":');
  assert.equal(store.syncFromStorage(), false);
  assert.equal(store.getState(), before);
  storage.map.set(KEY, '{"v":99}');
  assert.equal(store.syncFromStorage(), false);
  assert.equal(store.getState(), before);
});
