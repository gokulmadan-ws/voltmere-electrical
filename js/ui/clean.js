// js/ui/clean.js: the opt-in "clean preview" (?clean=1). Honest simulated labelling is the default everywhere; this only lets
// someone judge the real feel, or forward a link, without the prototype furniture (strip, disclosure, demo-fill, demo panel).
// Owner: SHARED (round 2, T12). No imports, so it runs in node for the unit tests.
//
//   ?clean=1   on  (also true, on, yes)     ?clean=0   off (also false, off, no)
// Read from location.search, or from the hash query (#/today?clean=1, #q=abc&clean=1). The choice is saved in
// localStorage['vm_clean'] so it survives a reload and carries across the three pages; with storage blocked it still works for
// this page load (kept in memory). When on, <html data-clean="1"> is set: css/base.css hides every [data-proto] element and
// PrototypeNotice's strip and footer render nothing. The dashboard's own "simulated" labels and the Connections wizards are NOT touched.

export const CLEAN_KEY = 'vm_clean';

const ON_WORDS = ['1', 'true', 'on', 'yes'];
const OFF_WORDS = ['0', 'false', 'off', 'no'];

let memory = null; // true | false | null: this page load's explicit choice, used when no storage works (and wins over storage)
let current = null; // true | false | null: what initClean() applied; null until then

/** One param string ('clean=1&x=2') to true, false, or null (absent or not a recognised word). */
function fromParams(text) {
  if (!text) return null;
  let value = null;
  try { value = new URLSearchParams(text).get('clean'); } catch (e) { return null; }
  if (value === null) return null;
  const word = value.trim().toLowerCase();
  if (ON_WORDS.includes(word)) return true;
  if (OFF_WORDS.includes(word)) return false;
  return null;
}

/**
 * The choice carried by a URL: true (?clean=1), false (?clean=0) or null (nothing, or junk). The query string wins over
 * the hash. In the hash the params come after a '?' (#/today?clean=1) or, with no '?', are the whole hash (#q=abc&clean=1).
 */
export function parseCleanParam(search = '', hash = '') {
  const fromSearch = fromParams(String(search || '').replace(/^\?/, ''));
  if (fromSearch !== null) return fromSearch;
  const tail = String(hash || '').replace(/^#/, '');
  const q = tail.indexOf('?');
  return fromParams(q >= 0 ? tail.slice(q + 1) : (tail.includes('=') ? tail : ''));
}

/** The storages to try, best first. An injected `storage` (the tests) is the only one used. Touching a blocked one can throw. */
function backends(storage) {
  if (storage) return [() => storage];
  return [() => localStorage, () => sessionStorage];
}

function readStored(storage) {
  for (const get of backends(storage)) {
    try {
      const value = get().getItem(CLEAN_KEY);
      if (value !== null && value !== undefined) return value;
    } catch (e) { /* blocked: try the next one */ }
  }
  return null;
}

/** Remember the choice: on is saved as '1', off removes the key (the default). Never throws; memory keeps this page right. */
export function setCleanChoice(on, { storage } = {}) {
  memory = !!on;
  let saved = false;
  for (const get of backends(storage)) {
    try {
      const s = get();
      if (on) { if (!saved) { s.setItem(CLEAN_KEY, '1'); saved = true; } } else s.removeItem(CLEAN_KEY);
    } catch (e) { /* blocked or full: memory (above) still holds the choice for this page load */ }
  }
}

/** The saved choice (an explicit choice made on this page load wins; with nothing saved the answer is false). */
export function getCleanChoice({ storage } = {}) {
  if (memory !== null) return memory;
  return readStored(storage) === '1';
}

/** Put the choice on <html data-clean> (off removes the attribute). */
export function applyClean(on, root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || !el.dataset) return;
  if (on) el.dataset.clean = '1'; else delete el.dataset.clean;
}

/**
 * Boot-time (bootApp calls this first): read ?clean from the URL, save it when present, apply the saved choice to <html>.
 * Returns whether clean mode is on. Safe with storage blocked and outside a browser. Options are for the tests.
 */
export function initClean({ search, hash, storage, root } = {}) {
  let s = search;
  let h = hash;
  try {
    if (s === undefined) s = typeof location !== 'undefined' ? location.search : '';
    if (h === undefined) h = typeof location !== 'undefined' ? location.hash : '';
  } catch (e) { s = s || ''; h = h || ''; }
  const fromUrl = parseCleanParam(s, h);
  if (fromUrl !== null) setCleanChoice(fromUrl, { storage });
  current = getCleanChoice({ storage });
  applyClean(current, root);
  return current;
}

/** True while clean preview is on. After initClean it is what was applied to <html>; before it, the saved choice. */
export function isCleanMode() {
  return current !== null ? current : getCleanChoice();
}
