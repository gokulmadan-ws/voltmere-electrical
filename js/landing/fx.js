// js/landing/fx.js: small motion helpers: scroll reveal (starts visible), condensing header flag, scroll spy, number tween.
// Owner: L3 (landing page for 180 Electrical)
import { useEffect, useRef, useState } from '../vendor/preact-htm.js';

/** True when the visitor asked for less motion. Re-read on every call (cheap) so a change in system settings applies at once. */
export function reducedMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

/**
 * Scroll reveal. Everything is fully visible by default: only elements that are BELOW the fold at this moment get
 * data-rv="pending" (a small downward offset, never opacity 0, so a full-page screenshot, a thumbnail, a print or a
 * failed script still shows every word at full contrast), and data-rv="in" when they scroll into view. Elements that are
 * already on screen are left alone, so nothing flickers on load. Targets are [data-reveal]; the offset delay per item
 * comes from the inline --i variable (see .lp-rv in landing.css). Returns a cleanup function.
 */
export function initReveal(root = document) {
  if (reducedMotion() || typeof IntersectionObserver !== 'function') return () => {};
  const targets = Array.from(root.querySelectorAll('[data-reveal]:not([data-rv])'));
  if (!targets.length) return () => {};
  const fold = window.innerHeight || 800;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.setAttribute('data-rv', 'in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
  for (const el of targets) {
    if (el.getBoundingClientRect().top > fold * 0.96) {
      el.setAttribute('data-rv', 'pending');
      io.observe(el);
    }
  }
  // Safety net: anything still pending after a long wait that is on screen is released (an observer that never fires must not strand content).
  const timer = setInterval(() => {
    for (const el of root.querySelectorAll('[data-rv="pending"]')) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) { el.setAttribute('data-rv', 'in'); io.unobserve(el); }
    }
  }, 2500);
  return () => { io.disconnect(); clearInterval(timer); };
}

/** True once the page has scrolled past `after` pixels (the header condenses). One rAF-throttled passive listener. */
export function useCondensed(after = 36) {
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    let queued = false;
    const read = () => { queued = false; setCondensed((window.scrollY || document.documentElement.scrollTop || 0) > after); };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(read); } };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [after]);
  return condensed;
}

/** The id of the section nearest the middle of the screen, from a list of element ids ('' while none is). */
export function useScrollSpy(ids) {
  const [active, setActive] = useState('');
  const key = ids.join('|');
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return undefined;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = ids.find((id) => seen.get(id));
      setActive(first || '');
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    for (const id of ids) { const el = document.getElementById(id); if (el) io.observe(el); }
    return () => io.disconnect();
  }, [key]);
  return active;
}

/**
 * A number that glides to `target` (ease-out cubic over `ms`). With reduced motion, or on the first render, it is the
 * target at once. Uses the animation frame timestamp, never the wall clock.
 */
export function useTween(target, ms = 650) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const shown = useRef(target);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; from.current = target; shown.current = target; setValue(target); return undefined; }
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') { from.current = target; shown.current = target; setValue(target); return undefined; }
    const start = shown.current;
    let t0 = null;
    let raf = 0;
    const step = (ts) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (target - start) * eased;
      shown.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step); else { shown.current = target; setValue(target); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}
