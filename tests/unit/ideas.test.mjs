// tests/unit/ideas.test.mjs: the public pages' "Show: With ideas | Only my content" switch (js/ui/ideas.js): default, persistence in ec_clean,
// the ?clean= URL choice, the storage-blocked fallback, and agreement with the older clean-preview module (vm_clean, <html data-clean>).
// Owner: LP1 (polish round 3). Each test imports fresh copies (a unique query string) because both modules keep one in-memory choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let n = 0;
const fresh = async () => {
  n += 1;
  return { ideas: await import(`../../js/ui/ideas.js?t=${n}`), clean: await import(`../../js/ui/clean.js?t=${n}`) };
};
const mem = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); }, _data: data };
};
const blockedStorage = () => { const boom = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); }; return { getItem: boom, setItem: boom, removeItem: boom }; };
/** A stand-in <html> so applyClean has something to set (clean.js uses document.documentElement when none is passed). */
function withDom(fn) {
  const root = { dataset: {} };
  const prev = { document: globalThis.document, localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), location: globalThis.location };
  globalThis.document = { documentElement: root };
  return Promise.resolve(fn(root)).finally(() => {
    if (prev.document === undefined) delete globalThis.document; else globalThis.document = prev.document;
    if (prev.localStorage) Object.defineProperty(globalThis, 'localStorage', prev.localStorage); else delete globalThis.localStorage;
  });
}
const setStorage = (s) => Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });

test('the key is ec_clean and the default is With ideas', async () => {
  await withDom(async (root) => {
    setStorage(mem());
    const { ideas } = await fresh();
    assert.equal(ideas.IDEAS_KEY, 'ec_clean');
    assert.equal(ideas.getIdeasMode(), false);
    assert.equal(ideas.initIdeasMode({ search: '', hash: '' }), false);
    assert.equal(root.dataset.clean, undefined, 'no data-clean by default');
  });
});

test('setIdeasMode saves ec_clean (1 / 0), sets <html data-clean="1">, and keeps clean.js in step so bootApp does not undo it', async () => {
  await withDom(async (root) => {
    const storage = mem();
    setStorage(storage);
    const { ideas, clean } = await fresh();
    ideas.initIdeasMode({ search: '', hash: '' });
    ideas.setIdeasMode(true);
    assert.equal(storage.getItem('ec_clean'), '1');
    assert.equal(root.dataset.clean, '1');
    assert.equal(ideas.getIdeasMode(), true);
    assert.equal(clean.getCleanChoice(), true, 'the older module agrees, so its initClean() applies the same answer');
    assert.equal(clean.initClean({ search: '', hash: '' }), true, 'bootApp runs initClean right after: still on');
    assert.equal(root.dataset.clean, '1');
    ideas.setIdeasMode(false);
    assert.equal(storage.getItem('ec_clean'), '0');
    assert.equal(root.dataset.clean, undefined);
    assert.equal(clean.initClean({ search: '', hash: '' }), false);
  });
});

test('a saved ec_clean=1 applies at boot', async () => {
  await withDom(async (root) => {
    setStorage(mem({ ec_clean: '1' }));
    const { ideas } = await fresh();
    assert.equal(ideas.initIdeasMode({ search: '', hash: '' }), true);
    assert.equal(root.dataset.clean, '1');
  });
});

test('?clean=1 and ?clean=0 are explicit choices: they win and are remembered', async () => {
  await withDom(async (root) => {
    const storage = mem({ ec_clean: '1' });
    setStorage(storage);
    const { ideas } = await fresh();
    assert.equal(ideas.initIdeasMode({ search: '?now=2026-10-23T20:30&clean=0', hash: '' }), false);
    assert.equal(storage.getItem('ec_clean'), '0');
    assert.equal(root.dataset.clean, undefined);
    assert.equal(ideas.initIdeasMode({ search: '', hash: '#q=abc&clean=1' }), true);
    assert.equal(storage.getItem('ec_clean'), '1');
  });
});

test('with storage blocked nothing throws, the default is With ideas, and a tap still works for this page load', async () => {
  await withDom(async (root) => {
    setStorage(blockedStorage());
    const { ideas } = await fresh();
    assert.equal(ideas.getIdeasMode(), false);
    assert.equal(ideas.initIdeasMode({ search: '', hash: '' }), false);
    assert.equal(ideas.setIdeasMode(true), true);
    assert.equal(root.dataset.clean, '1');
    assert.equal(ideas.getIdeasMode(), true);
  });
});

test('junk in storage means With ideas', async () => {
  await withDom(async () => {
    setStorage(mem({ ec_clean: 'maybe' }));
    const { ideas } = await fresh();
    assert.equal(ideas.initIdeasMode({ search: '', hash: '' }), false);
  });
});
