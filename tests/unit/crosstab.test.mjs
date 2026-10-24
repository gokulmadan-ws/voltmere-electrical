// tests/unit/crosstab.test.mjs: two tabs of one browser saving at (nearly) the same moment. Each tab can read a stale copy of the shared storage, so a
// save can overwrite another tab's save; the journal (meta.writes) and the replay of a tab's own overwritten writes (store.js reconcile) make the tabs
// converge with nothing lost, no duplicate ref, no double-booked window.
// Owner: ROBUST (final gate)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { addDays } from '../../js/core/dates.js';
import * as storeA from '../../js/core/store.js';

const KEY = STORAGE_KEYS.state;
const FIXTURE = new Date(2026, 9, 23, 20, 30);
beforeEach(() => setClock(FIXTURE));
afterEach(() => setClock(null));

/** The browser's one storage and a per-tab cache that only learns of other tabs' writes when the test says so (like a storage event arriving late). */
function sharedBrowser() {
  const shared = new Map();
  const tab = () => {
    const cache = new Map();
    const t = {
      cache,
      getItem: (k) => (cache.has(k) ? cache.get(k) : null),
      setItem: (k, v) => { cache.set(k, String(v)); shared.set(k, String(v)); }, // a write is seen at once by its own tab, and is the last word in the browser
      removeItem: (k) => { cache.delete(k); shared.delete(k); },
      deliver: () => { for (const [k, v] of shared) cache.set(k, v); } // the storage event reaches this tab
    };
    return t;
  };
  return { shared, tab };
}
async function secondTab() {
  return import(`../../js/core/store.js?tab=${Math.random().toString(36).slice(2)}`);
}

const enquiry = (name) => ({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name, phone: '07700 900321', email: '' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true });
const names = (st) => st.bookings.map((b) => b.customer.name);

function twoTabs() {
  const browser = sharedBrowser();
  const a = browser.tab();
  const b = browser.tab();
  storeA.initStore({ storage: a, force: true });
  return secondTab().then((storeB) => {
    b.deliver(); // tab B opens after tab A saved the seed
    storeB.initStore({ storage: b, force: true });
    a.deliver();
    return { browser, a, b, A: storeA, B: storeB };
  });
}

test('both tabs save from a stale read: the second save overwrites the first, then both converge with nothing lost', async () => {
  const { a, b, A, B } = await twoTabs();
  const madeA = [];
  const madeB = [];
  for (let i = 0; i < 3; i += 1) madeA.push(A.createBooking(enquiry(`Alpha ${i}`)));
  for (let i = 0; i < 3; i += 1) madeB.push(B.createBooking(enquiry(`Bravo ${i}`)));
  assert.ok([...madeA, ...madeB].every((r) => r.ok));
  // the browser holds B's last save: A's three are gone from storage
  assert.ok(!names(JSON.parse(b.getItem(KEY))).includes('Alpha 0'));
  a.deliver();
  assert.equal(A.syncFromStorage(), true, 'A reads B\'s state and finds its own writes missing');
  b.deliver();
  B.syncFromStorage();
  for (const [label, st] of [['A', A.getState()], ['B', B.getState()]]) {
    for (const n of ['Alpha 0', 'Alpha 1', 'Alpha 2', 'Bravo 0', 'Bravo 1', 'Bravo 2']) assert.ok(names(st).includes(n), `${label} holds ${n}`);
    assert.equal(new Set(st.bookings.map((x) => x.ref)).size, st.bookings.length, `${label}: refs are unique`);
    assert.equal(new Set(st.bookings.map((x) => x.id)).size, st.bookings.length, `${label}: ids are unique`);
    assert.equal(new Set(st.messages.map((x) => x.seq)).size, st.messages.length, `${label}: message numbers are unique`);
    const windows = st.bookings.filter((x) => x.durationMin > 0 && x.status !== 'cancelled').map((x) => x.start);
    assert.equal(new Set(windows).size, windows.length, `${label}: no window holds two bookings`);
  }
  assert.equal(A.getState().meta.rev, B.getState().meta.rev);
  assert.equal(JSON.stringify(A.getState().bookings.map((x) => x.id).sort()), JSON.stringify(B.getState().bookings.map((x) => x.id).sort()));
});

test('a booking keeps its id when it is redone, so a confirmation that already showed it still finds it', async () => {
  const { a, b, A, B } = await twoTabs();
  const mineA = A.createBooking(enquiry('Alpha Keeper'));
  B.createBooking(enquiry('Bravo Racer'));
  a.deliver();
  A.syncFromStorage();
  const redone = A.getState().bookings.find((x) => x.customer.name === 'Alpha Keeper');
  assert.ok(redone);
  assert.equal(redone.id, mineA.booking.id, 'same id as the one returned to the page');
  b.deliver();
  B.syncFromStorage();
  assert.ok(B.getState().bookings.some((x) => x.id === mineA.booking.id));
});

test('two tabs that took the same reference: after they converge the refs differ (the redone one moves on)', async () => {
  const { a, b, A, B } = await twoTabs();
  const x = A.createBooking(enquiry('Same Ref A'));
  const y = B.createBooking(enquiry('Same Ref B'));
  assert.equal(x.booking.ref, y.booking.ref, 'both tabs allocated the same number from the same stale base');
  a.deliver();
  A.syncFromStorage();
  b.deliver();
  B.syncFromStorage();
  const refs = A.getState().bookings.map((r) => r.ref);
  assert.equal(new Set(refs).size, refs.length);
  assert.equal(A.getState().bookings.length, B.getState().bookings.length);
  assert.ok(names(A.getState()).includes('Same Ref A') && names(A.getState()).includes('Same Ref B'));
});

test('a state that held our write can itself be overwritten by a third save made from a stale read: the write is redone again', async () => {
  const { browser, a, b, A, B } = await twoTabs();
  void browser;
  A.createBooking(enquiry('Alpha Survivor'));
  b.deliver();
  B.syncFromStorage(); // B has seen A's write (it holds it)
  assert.ok(names(B.getState()).includes('Alpha Survivor'));
  // tab B (which has NOT seen what happens next in A) ... simulate a stale-based save landing last: rewrite storage from the old seed plus a B write
  const stale = JSON.parse(JSON.stringify(B.getState()));
  stale.bookings = stale.bookings.filter((x) => x.customer.name !== 'Alpha Survivor');
  stale.meta.writes = (stale.meta.writes || []).slice(0, -1); // its journal does not know A's write either
  stale.meta.rev += 1;
  b.setItem(KEY, JSON.stringify(stale));
  a.deliver();
  assert.equal(A.syncFromStorage(), true);
  assert.ok(names(A.getState()).includes('Alpha Survivor'), 'A redid its write on top of the state that lost it');
  assert.ok(JSON.parse(a.getItem(KEY)).bookings.some((x) => x.customer.name === 'Alpha Survivor'), 'and saved it');
});

test('a write that no longer makes sense on the latest state (the window went to the other tab) is dropped, not forced in', async () => {
  const { a, b, A, B } = await twoTabs();
  const slot = A.getState().bookings.find((x) => x.status === 'confirmed' && x.durationMin === 120);
  assert.ok(slot);
  // both tabs ask for the same free window in the same moment
  const free = (await import('../../js/core/availability.js')).nextFreeSlots(A.getState(), 'sockets', 1)[0];
  const input = (name) => ({ serviceId: 'sockets', date: free.date, windowId: free.windowId, customer: { name, phone: '07700 900288' }, address: { line1: '1 Road', postcode: 'BT9 6QP' } });
  const first = A.createBooking(input('Window One'));
  const second = B.createBooking(input('Window Two'));
  assert.ok(first.ok && second.ok, 'neither tab could know');
  a.deliver();
  A.syncFromStorage();
  b.deliver();
  B.syncFromStorage();
  for (const st of [A.getState(), B.getState()]) {
    const holders = st.bookings.filter((x) => x.start === `${free.date}T${free.windowId === 0 ? '08:00' : free.windowId === 1 ? '10:00' : free.windowId === 2 ? '13:00' : '15:00'}` && x.status !== 'cancelled');
    assert.equal(holders.length, 1, 'exactly one booking holds the contested window');
  }
});

test('a tab alone never redoes anything and never forgets: a long single-tab session keeps a bounded memory of its writes', async () => {
  const browser = sharedBrowser();
  const a = browser.tab();
  storeA.initStore({ storage: a, force: true });
  for (let i = 0; i < 150; i += 1) storeA.addBlock({ date: addDays('2027-02-01', Math.floor(i / 4)), windowId: i % 4, label: `b${i}` });
  const st = storeA.getState();
  assert.equal(st.blocks.filter((x) => /^b\d+$/.test(x.label)).length, 150);
  assert.ok(st.meta.writes.length <= 200 && st.meta.writes.length >= 150);
  assert.equal(new Set(st.meta.writes).size, st.meta.writes.length);
});

test('the undo of a write still works after it was redone on another state', async () => {
  const { a, b, A, B } = await twoTabs();
  const made = A.addBlock({ date: '2027-03-01', windowId: 1, label: 'Undo after redo' });
  B.addBlock({ date: '2027-03-02', windowId: 1, label: 'Other tab' });
  a.deliver();
  A.syncFromStorage();
  assert.ok(A.getState().blocks.some((x) => x.label === 'Undo after redo'));
  const undone = A.undo(made.undoToken);
  assert.ok(undone.ok);
  assert.ok(!A.getState().blocks.some((x) => x.label === 'Undo after redo'));
  assert.ok(A.getState().blocks.some((x) => x.label === 'Other tab'));
  void b; void B;
});
