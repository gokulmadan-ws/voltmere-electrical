// js/landing/ready.js: "the rest of the page is in". The landing page paints the header and the hero first and mounts every section below the fold a moment later (js/landing/below.js),
// so the first screen is not held up by the scripts and the layout work of the rest. Whatever looks for those sections by id (the header's scroll spy and its hidden-link check, the
// scroll reveal) asks this module when they have arrived.
// Owner: PERF (final gate)
import { useEffect, useState } from '../vendor/preact-htm.js';

let ready = false;
const waiting = new Set();

/** Called once the below-the-fold sections are in the page (after they have been committed to the DOM). */
export function markBelowReady() {
  if (ready) return;
  ready = true;
  try { document.documentElement.setAttribute('data-below', 'ready'); } catch (e) { /* no document: nothing to mark */ } // a hook for tests and scripts: the page is complete
  for (const fn of [...waiting]) fn();
  waiting.clear();
}

/** True once the sections below the hero are in the page. */
export function useBelowReady() {
  const [value, setValue] = useState(ready);
  useEffect(() => {
    if (ready) { setValue(true); return undefined; }
    const fn = () => setValue(true);
    waiting.add(fn);
    return () => { waiting.delete(fn); };
  }, []);
  return value;
}
