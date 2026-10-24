// js/ui/edge-fade.js: edge fade for sideways-scrolling chip rows (T11). Owner: SHARED (B3).
//
// A row of chips, segments or tabs that is wider than the screen used to end in a hard cut ("To col", "Se", "S"). startEdgeFade() watches the
// page for such rows (.ui-seg, .ui-tabs__list, .st-jump, the pipeline's stage tiles, or anything marked data-edge-fade) and keeps three attributes up to date on each:
//   data-fade-start="1"  there is more to the left   -> css/components.css fades the left edge
//   data-fade-end="1"    there is more to the right  -> css/components.css fades the right edge
//   data-fade-peek="1" + --peek-x   at rest on the left edge, when the chip at the right edge is cut, the fade is moved to the START of that
//                        chip (plus a 10px peek of its outline), so the last chip you can read is whole and the next one is only hinted.
// Nothing here writes markup or styles other than those attributes and one custom property. Safe to call twice (it is idempotent).

const SELECTOR = '.ui-seg, .ui-tabs__list, .st-jump, .pl-strip, [data-edge-fade]';
const PEEK = 10;       // px of the next chip's outline left visible
const MIN_CUT = 14;    // a clipped chip showing less than this has no readable text yet, so it is left alone

const tracked = new Map(); // element -> { stop() }
let rootObserver = null;
let refs = 0;

const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Read the scroll state of one row and write the fade attributes. */
function measure(el) {
  const w = el.clientWidth;
  if (!w) return; // hidden: measure again when it shows (the ResizeObserver fires then)
  const max = el.scrollWidth - w;
  const left = el.scrollLeft;
  const canStart = max > 2 && left > 2;
  const canEnd = max > 2 && left < max - 2;
  setAttr(el, 'data-fade-start', canStart ? '1' : '0');
  setAttr(el, 'data-fade-end', canEnd ? '1' : '0');

  let peekX = null;
  if (canEnd && !canStart) {
    const box = el.getBoundingClientRect();
    const padRight = box.left + el.clientLeft + w;
    for (const c of el.children) {
      if (c.getAttribute('aria-hidden') === 'true') continue; // the sliding indicator of a tab strip
      const r = c.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > padRight + 0.5) {
        const shown = padRight - r.left;
        const offset = r.left - box.left;
        // Not the very first chip (that would hide everything), and only when some of its text would otherwise show.
        if (offset > 40 && shown > MIN_CUT) peekX = Math.round(offset + PEEK);
        break;
      }
    }
  }
  if (peekX === null) {
    if (el.hasAttribute('data-fade-peek')) { el.removeAttribute('data-fade-peek'); el.style.removeProperty('--peek-x'); }
  } else {
    setAttr(el, 'data-fade-peek', '1');
    el.style.setProperty('--peek-x', `${peekX}px`);
  }
}

function attach(el) {
  if (tracked.has(el)) return;
  el.setAttribute('data-edge-fade', '');
  let frame = 0;
  const schedule = () => { if (!frame) frame = raf(() => { frame = 0; if (el.isConnected) measure(el); }); };
  el.addEventListener('scroll', schedule, { passive: true });
  let ro = null;
  const watchChildren = () => {
    if (!ro) return;
    ro.disconnect();
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
  };
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(schedule); watchChildren(); }
  let mo = null;
  if (typeof MutationObserver === 'function') {
    mo = new MutationObserver(() => { watchChildren(); schedule(); });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
  }
  window.addEventListener('resize', schedule);
  measure(el);
  schedule();
  tracked.set(el, {
    stop() {
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
    }
  });
}

function scan(root) {
  if (!root || !root.querySelectorAll) return;
  if (root.matches && root.matches(SELECTOR)) attach(root);
  root.querySelectorAll(SELECTOR).forEach(attach);
}

function prune() {
  for (const [el, entry] of tracked) {
    if (!el.isConnected) { entry.stop(); tracked.delete(el); }
  }
}

/** Start watching the page. Returns a function that stops it (the last stop releases everything). */
export function startEdgeFade(root = document.body) {
  if (typeof document === 'undefined' || !root) return () => {};
  refs += 1;
  if (!rootObserver && typeof MutationObserver === 'function') {
    let pending = false;
    rootObserver = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      raf(() => { pending = false; prune(); scan(document.body); });
    });
    rootObserver.observe(document.body, { childList: true, subtree: true });
  }
  scan(root);
  // Web fonts change chip widths after first paint.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { tracked.forEach((_, el) => { if (el.isConnected) measure(el); }); }).catch(() => {});
  return () => {
    refs -= 1;
    if (refs > 0) return;
    if (rootObserver) { rootObserver.disconnect(); rootObserver = null; }
    tracked.forEach((entry) => entry.stop());
    tracked.clear();
  };
}
