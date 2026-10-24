// js/landing/sticky-bar.js: fixed bottom bar for phones: ONE full-width "Get my installation quote" button on an opaque surface (the header's Call is the only call control; hidden from 768, while the funnel or keyboard is open, until the hero's own button has scrolled out of view, and while any in-page quote button is on screen; it is the one quote button over the footer).
// Owner: L3 (landing page for 180 Electrical; first built by C2)
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { Icon, cx } from '../ui/index.js';
import { CTA_LABEL, bookClick } from './content.js';

// The sticky header covers the top of the screen, so a button under it counts as out of view.
const HEADER_ZONE = 64;

/**
 * True once the hero's own quote button has scrolled out of view ABOVE the screen. Until then the hero button is the one red
 * button on screen (two identical ones stacked on the first screen looked like a mistake, and the bar hid the line under the
 * hero button). With no IntersectionObserver, or no hero button to watch, it is always true: the bar must never be missing.
 */
export function useHeroCtaGone() {
  const [gone, setGone] = useState(typeof IntersectionObserver !== 'function');
  useEffect(() => {
    const target = document.querySelector('[data-testid="hero-cta"]');
    if (typeof IntersectionObserver !== 'function' || !target) { setGone(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      const top = e.rootBounds ? e.rootBounds.top : 0;
      setGone(!e.isIntersecting && e.boundingClientRect.top < top);
    }, { rootMargin: `-${HEADER_ZONE}px 0px 0px 0px`, threshold: 0 });
    io.observe(target);
    return () => io.disconnect();
  }, []);
  return gone;
}

/**
 * True while any block marked data-sticky-hide (the postcode card, the quote preview button, the final card) is on screen.
 * Those blocks carry their own red button, so the bar steps aside: one red "Get my installation quote" at a time, never a button
 * half-hidden behind the bar. With no IntersectionObserver the bar simply stays as the hero rule says.
 */
export function useInPageCtaVisible() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll('[data-sticky-hide]'));
    if (typeof IntersectionObserver !== 'function' || !targets.length) return undefined;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting);
      setBlocked(Array.from(seen.values()).some(Boolean));
    }, { rootMargin: `-${HEADER_ZONE}px 0px 0px 0px`, threshold: 0 }); // a block hidden under the sticky header is not on screen
    for (const t of targets) io.observe(t);
    return () => io.disconnect();
  }, []);
  return blocked;
}

export function StickyBar() {
  const heroGone = useHeroCtaGone();
  const blocked = useInPageCtaVisible();
  const show = heroGone && !blocked;
  return html`
    <nav class=${cx('lp-sticky', show && 'is-on')} aria-label="Quick actions" data-testid="sticky-bar">
      <button type="button" class="ui-btn ui-btn--primary lp-cta lp-sticky__book" data-testid="sticky-book" onClick=${bookClick({})}><span class="ui-btn__label">${CTA_LABEL}</span><${Icon} name="arrow-right" size=${20} class="ui-btn__icon" /></button>
    </nav>
  `;
}
