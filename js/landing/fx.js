// js/landing/fx.js: small behaviour helpers for the landing page: reducedMotion, useMedia, the two "where is the red button" observers (useHeroCtaGone, useInPageCtaVisible) and the scroll spy.
// LANDING-V5 (7): no scroll reveal, no condensing header, no loops. Owner: L3 (landing page for 180 Electrical); trimmed and extended by B1.
import { useEffect, useState } from '../vendor/preact-htm.js';
import { useMediaQuery } from '../ui/hooks.js';

/** True when the visitor asked for less motion. Re-read on every call (cheap) so a change in system settings applies at once. */
export function reducedMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

/** True while the media query matches (ui/hooks.js useMediaQuery; the calculator's rates use useMedia('(min-width: 1200px)')). */
export function useMedia(query) { return useMediaQuery(query); }

/**
 * How much of the top of the viewport the header covers right now: its own height while it is sticky (from 720px), 0 while it scrolls away (phones). Read from the header itself,
 * so a breakpoint change in the css can never leave this stale. A button under a sticky header counts as out of view.
 */
function headerZone() {
  const el = typeof document !== 'undefined' ? document.querySelector('[data-testid="lp-header"]') : null;
  if (!el || getComputedStyle(el).position !== 'sticky') return 0;
  return Math.round(el.getBoundingClientRect().height);
}

/**
 * True once the hero's own quote button has scrolled out of view ABOVE the screen. Until then the hero button is the one red button on screen (the header's and the sticky bar's wait).
 * With no IntersectionObserver, or no hero button to watch, it is always true: the bar and the header button must never be missing. Re-observes when the header becomes (or stops being)
 * sticky at a breakpoint.
 */
export function useHeroCtaGone() {
  const [gone, setGone] = useState(typeof IntersectionObserver !== 'function');
  const sticky = useMedia('(min-width: 720px)');
  const tall = useMedia('(min-width: 1024px)');
  useEffect(() => {
    const target = document.querySelector('[data-testid="hero-cta"]');
    if (typeof IntersectionObserver !== 'function' || !target) { setGone(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      const top = e.rootBounds ? e.rootBounds.top : 0;
      setGone(!e.isIntersecting && e.boundingClientRect.top < top);
    }, { rootMargin: `-${headerZone()}px 0px 0px 0px`, threshold: 0 });
    io.observe(target);
    return () => io.disconnect();
  }, [sticky, tall]);
  return gone;
}

/**
 * True while any block marked data-sticky-hide (the postcode section, the final band) is on screen. Those blocks carry their own red button, so the header's and the sticky bar's
 * step aside: one red "Get my installation quote" at a time. `ready` is true once the sections below the hero are in the page (js/landing/ready.js): the blocks do not exist before,
 * so the observer is set up again then. With no IntersectionObserver the answer is always false.
 */
export function useInPageCtaVisible(ready = true) {
  const [blocked, setBlocked] = useState(false);
  const sticky = useMedia('(min-width: 720px)');
  const tall = useMedia('(min-width: 1024px)');
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll('[data-sticky-hide]'));
    if (typeof IntersectionObserver !== 'function' || !targets.length) { setBlocked(false); return undefined; }
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting);
      setBlocked(Array.from(seen.values()).some(Boolean));
    }, { rootMargin: `-${headerZone()}px 0px 0px 0px`, threshold: 0 }); // a block hidden under the sticky header is not on screen
    for (const t of targets) io.observe(t);
    return () => io.disconnect();
  }, [ready, sticky, tall]);
  return blocked;
}

/** The id of the section nearest the middle of the screen, from a list of element ids ('' while none is). */
export function useScrollSpy(ids, sectionsReady = true) {
  const [active, setActive] = useState('');
  const key = ids.join('|') + (sectionsReady ? '|ready' : '');
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
