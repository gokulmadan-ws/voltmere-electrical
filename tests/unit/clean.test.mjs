// tests/unit/clean.test.mjs: the opt-in clean preview (js/ui/clean.js): URL parsing, persistence, the storage-blocked fallback, <html data-clean>.
// Owner: SHARED (T12). The module keeps one in-memory choice, so every test imports a fresh copy (a unique query string).
import { test } from 'node:test';
import assert from 'node:assert/strict';

let n = 0;
const fresh = () => import(`../../js/ui/clean.js?t=${++n}`);

/** A stand-in Storage. */
function memStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data
  };
}
/** A Storage that is blocked: every touch throws, like Safari with all site data blocked. */
const blocked = () => {
  const boom = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
};
/** A stand-in <html>: only `dataset` is used. */
const fakeRoot = () => ({ dataset: {} });

test('parseCleanParam: ?clean=1 is on, ?clean=0 is off, anything else is no choice', async () => {
  const { parseCleanParam } = await fresh();
  assert.equal(parseCleanParam('?clean=1'), true);
  assert.equal(parseCleanParam('?clean=0'), false);
  assert.equal(parseCleanParam('?now=2026-10-23T20:30&freeze=1&clean=1'), true);
  assert.equal(parseCleanParam('clean=1'), true, 'a leading ? is optional');
  for (const word of ['true', 'ON', 'Yes', ' 1 ']) assert.equal(parseCleanParam(`?clean=${encodeURIComponent(word)}`), true, word);
  for (const word of ['false', 'OFF', 'no']) assert.equal(parseCleanParam(`?clean=${word}`), false, word);
  assert.equal(parseCleanParam(''), null);
  assert.equal(parseCleanParam('?now=2026-10-23T20:30&freeze=1'), null);
  assert.equal(parseCleanParam('?clean='), null);
  assert.equal(parseCleanParam('?clean=maybe'), null);
  assert.equal(parseCleanParam(undefined, undefined), null);
  assert.equal(parseCleanParam(null, null), null);
});

test('parseCleanParam: reads the hash query too, and the query string wins', async () => {
  const { parseCleanParam } = await fresh();
  assert.equal(parseCleanParam('', '#/today?clean=1'), true, 'dashboard-style hash query');
  assert.equal(parseCleanParam('', '#/bookings?status=new&clean=0'), false);
  assert.equal(parseCleanParam('', '#q=abc123&clean=1'), true, 'quote-style hash params');
  assert.equal(parseCleanParam('', '#q=abc123'), null);
  assert.equal(parseCleanParam('', '#/today'), null);
  assert.equal(parseCleanParam('?clean=0', '#/today?clean=1'), false, 'the query string wins');
  assert.equal(parseCleanParam('?now=2026-10-23T20:30', '#/today?clean=1'), true, 'no clean in the query: fall through to the hash');
});

test('setCleanChoice / getCleanChoice persist: on is saved as 1, off removes the key', async () => {
  const { setCleanChoice, getCleanChoice, CLEAN_KEY } = await fresh();
  const storage = memStorage();
  assert.equal(CLEAN_KEY, 'vm_clean');
  assert.equal(getCleanChoice({ storage }), false, 'nothing saved means off');
  setCleanChoice(true, { storage });
  assert.equal(storage.getItem('vm_clean'), '1');
  setCleanChoice(false, { storage });
  assert.equal(storage.getItem('vm_clean'), null, 'off restores the default, nothing is stored');
  assert.equal(getCleanChoice({ storage }), false);
});

test('a saved choice is found by a later page load (a fresh module, the same storage)', async () => {
  const storage = memStorage();
  const first = await fresh();
  first.initClean({ search: '?clean=1', hash: '', storage, root: fakeRoot() });
  const root = fakeRoot();
  const second = await fresh(); // a reload: no memory, only storage
  assert.equal(second.initClean({ search: '', hash: '', storage, root }), true, 'no param: the saved choice is used');
  assert.equal(root.dataset.clean, '1');
  assert.equal(second.isCleanMode(), true);
});

test('initClean: ?clean=1 sets <html data-clean="1">, ?clean=0 removes it and the saved choice', async () => {
  const { initClean, isCleanMode } = await fresh();
  const storage = memStorage();
  const root = fakeRoot();
  assert.equal(initClean({ search: '', hash: '', storage, root }), false, 'default: off');
  assert.equal(root.dataset.clean, undefined);
  assert.equal(isCleanMode(), false);

  assert.equal(initClean({ search: '?clean=1', hash: '', storage, root }), true);
  assert.equal(root.dataset.clean, '1');
  assert.equal(storage.getItem('vm_clean'), '1');
  assert.equal(isCleanMode(), true);

  assert.equal(initClean({ search: '?junk=1', hash: '', storage, root }), true, 'an unrelated query leaves the saved choice alone');
  assert.equal(root.dataset.clean, '1');

  assert.equal(initClean({ search: '?clean=0', hash: '', storage, root }), false);
  assert.equal(root.dataset.clean, undefined, '?clean=0 restores everything');
  assert.equal(storage.getItem('vm_clean'), null);
  assert.equal(isCleanMode(), false);
});

test('initClean: the hash query turns it on as well', async () => {
  const { initClean } = await fresh();
  const root = fakeRoot();
  assert.equal(initClean({ search: '', hash: '#/today?clean=1', storage: memStorage(), root }), true);
  assert.equal(root.dataset.clean, '1');
});

test('persistence fallback: with storage blocked the choice still holds for the page and nothing throws', async () => {
  const { initClean, isCleanMode, getCleanChoice, setCleanChoice } = await fresh();
  const storage = blocked();
  const root = fakeRoot();
  assert.equal(initClean({ search: '', hash: '', storage, root }), false, 'blocked and no param: off, no throw');
  assert.doesNotThrow(() => setCleanChoice(true, { storage }));
  assert.equal(getCleanChoice({ storage }), true, 'kept in memory');
  assert.equal(initClean({ search: '?clean=1', hash: '', storage, root }), true);
  assert.equal(root.dataset.clean, '1');
  assert.equal(isCleanMode(), true);
  assert.equal(initClean({ search: '?clean=0', hash: '', storage, root }), false);
  assert.equal(root.dataset.clean, undefined);
});

test('persistence fallback: a storage that reads but cannot write still honours this page load\'s choice', async () => {
  const { initClean } = await fresh();
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const root = fakeRoot();
  assert.equal(initClean({ search: '?clean=1', hash: '', storage, root }), true);
  assert.equal(root.dataset.clean, '1');
});

test('the default storages: a blocked localStorage falls back to sessionStorage, then to memory', async () => {
  const had = { local: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), session: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage') };
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  try {
    const session = memStorage();
    define('localStorage', blocked());
    define('sessionStorage', session);
    const a = await fresh();
    assert.equal(a.initClean({ search: '?clean=1', hash: '', root: fakeRoot() }), true);
    assert.equal(session.getItem('vm_clean'), '1', 'the tab keeps the choice for its other pages');
    const b = await fresh(); // another page in the same tab
    assert.equal(b.initClean({ search: '', hash: '', root: fakeRoot() }), true);

    define('sessionStorage', blocked()); // both blocked: memory only, still no throw
    const c = await fresh();
    assert.equal(c.initClean({ search: '?clean=1', hash: '', root: fakeRoot() }), true);
    assert.equal(c.isCleanMode(), true);
    const d = await fresh();
    assert.equal(d.initClean({ search: '', hash: '', root: fakeRoot() }), false, 'a new page load with nothing saved is off');
  } finally {
    for (const [name, key] of [['localStorage', 'local'], ['sessionStorage', 'session']]) {
      if (had[key]) Object.defineProperty(globalThis, name, had[key]); else delete globalThis[name];
    }
  }
});

test('outside a browser (no location, no document, no storage) nothing throws and clean is off', async () => {
  const { initClean, isCleanMode, applyClean } = await fresh();
  assert.equal(isCleanMode(), false);
  assert.doesNotThrow(() => applyClean(true));
  assert.equal(initClean(), false);
  assert.equal(isCleanMode(), false);
});

test('applyClean sets and removes the attribute on the given root only', async () => {
  const { applyClean } = await fresh();
  const root = fakeRoot();
  applyClean(true, root);
  assert.equal(root.dataset.clean, '1');
  applyClean(false, root);
  assert.equal('clean' in root.dataset, false);
});
