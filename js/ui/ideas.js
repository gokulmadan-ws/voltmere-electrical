// js/ui/ideas.js: the "Show: With ideas | Only my content" switch of the public pages (landing, funnel, quote page).
// Owner: LP1 (polish round 3). Everything the prototype adds that 180 Electrical's own site does not say (a priced example quote, savings figures,
// product specs, payment terms, guarantees, a suggested visit slot) is an IDEA: its block carries data-proto and a visible "Idea from us" tag.
// This switch hides every [data-proto] on the page ("Only my content") and remembers the choice per device in localStorage['ec_clean'].
//
//   '1'  Only my content      anything else (or nothing saved)  With ideas (the default)
//
// It rides on the existing clean-preview plumbing: it sets <html data-clean="1"> (css/base.css and css/landing.css hide [data-proto] under it) and
// keeps js/ui/clean.js's own choice in step, so bootApp's initClean() (which runs right after) applies the same answer instead of undoing it.
// A ?clean=1 / ?clean=0 in the URL still wins for the visit and is remembered like a tap on the switch. Never throws; works with storage blocked.
import { h, useEffect, useState } from '../vendor/preact-htm.js';
import { applyClean, parseCleanParam, setCleanChoice } from './clean.js';
import { cx } from './util.js';

export const IDEAS_KEY = 'ec_clean';

const listeners = new Set();
let current = null; // true = Only my content, false = With ideas, null = not read yet
let watching = false;

function readStored() {
  try { return localStorage.getItem(IDEAS_KEY) === '1'; } catch (e) { return false; }
}
function writeStored(clean) {
  try { localStorage.setItem(IDEAS_KEY, clean ? '1' : '0'); } catch (e) { /* blocked: the choice still holds for this page load */ }
}

/** Put the choice on <html data-clean> and into clean.js (so its boot-time initClean agrees), then tell the switches. */
function apply(clean) {
  current = !!clean;
  try { setCleanChoice(current); } catch (e) { /* clean.js never throws; belt and braces */ }
  try { applyClean(current); } catch (e) { /* no document (unit tests) */ }
  for (const fn of Array.from(listeners)) { try { fn(current); } catch (e) { /* one bad listener must not stop the rest */ } }
}

/** True while "Only my content" is chosen (before init: whatever is saved). */
export function getIdeasMode() {
  return current !== null ? current : readStored();
}

/** Choose "Only my content" (true) or "With ideas" (false): applied at once, remembered on this device. */
export function setIdeasMode(clean) {
  writeStored(!!clean);
  apply(!!clean);
  return current;
}

/**
 * Boot-time: call as early as possible, before bootApp (landing/app.js and quote/app.js). A ?clean= in the URL is an explicit choice and is
 * saved; otherwise the saved choice applies; the default is With ideas. Returns true when "Only my content" is on.
 */
export function initIdeasMode({ search, hash } = {}) {
  let s = search;
  let hh = hash;
  try {
    if (s === undefined) s = typeof location !== 'undefined' ? location.search : '';
    if (hh === undefined) hh = typeof location !== 'undefined' ? location.hash : '';
  } catch (e) { s = s || ''; hh = hh || ''; }
  const fromUrl = parseCleanParam(s, hh);
  if (fromUrl !== null) writeStored(fromUrl);
  apply(fromUrl !== null ? fromUrl : readStored());
  if (!watching && typeof window !== 'undefined' && window.addEventListener) {
    watching = true;
    // The other tab changed it: follow within a moment.
    window.addEventListener('storage', (e) => { if (e.key === IDEAS_KEY || e.key === null) apply(readStored()); });
  }
  return current;
}

/** [clean, setClean]: re-renders when the choice changes (from the switch, or from another tab). */
export function useIdeasMode() {
  const [clean, setClean] = useState(getIdeasMode);
  useEffect(() => {
    const fn = (v) => setClean(v);
    listeners.add(fn);
    setClean(getIdeasMode());
    return () => { listeners.delete(fn); };
  }, []);
  return [clean, setIdeasMode];
}

/**
 * The switch: "Show: [With ideas | Only my content]". Two buttons (aria-pressed), each a full 44px tall tap target around a 28px pill, so
 * it fits the strip without making the strip taller. The words are the lead's: they say what the choice does.
 */
export function IdeasSwitch({ class: cls, ...rest }) {
  const [clean, setClean] = useIdeasMode();
  const opt = (value, label, testid) => h('button', {
    type: 'button', class: cx('ui-ideas__opt', clean === value && 'is-selected'), 'aria-pressed': clean === value ? 'true' : 'false',
    'data-testid': testid, onClick: () => { if (clean !== value) setClean(value); }
  }, h('span', { class: 'ui-ideas__pill' }, label));
  return h('div', { class: cx('ui-ideas', cls), role: 'group', 'aria-label': 'Show', 'data-testid': 'ideas-switch', ...rest },
    h('span', { class: 'ui-ideas__label', 'aria-hidden': 'true' }, 'Show:'),
    h('span', { class: 'ui-ideas__track' },
      opt(false, 'With ideas', 'ideas-with'),
      opt(true, 'Only my content', 'ideas-only')));
}
