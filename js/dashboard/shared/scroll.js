// js/dashboard/shared/scroll.js: small scrolling helpers for the owner views (jump to a section on another screen, edge fade on a sideways scroller).
// Owner: DASH
import { useEffect } from '../../vendor/preact-htm.js';
import { navigate } from '../router.js';

const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
};

/**
 * Go to `hash`, then scroll the element with `id` into view once its screen has drawn (the shell scrolls a new screen to the top
 * first, so this waits for it). Gives up quietly after about three seconds.
 */
export function jumpTo(hash, id) {
  navigate(hash);
  let frames = 0; // counted in frames, not wall-clock time (the prototype clock can be frozen)
  const look = () => {
    const el = document.getElementById(id);
    if (el) {
      // The shell's own scroll-to-top runs in the frame the screen mounts; scroll one frame after the element exists.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + window.scrollY - 110;
        window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
      }));
      return;
    }
    frames += 1;
    if (frames < 180) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/**
 * Edge fade for a sideways scroller. Keeps `data-fade-start` and `data-fade-end` ("1" or "0") up to date on the scroller found by
 * `selector` inside the ref'd wrapper (the wrapper itself when no selector); css/bookings.css turns them into a mask-image fade, so a
 * clipped last pill reads as "more this way" instead of a mistake.
 */
export function useScrollFade(ref, selector, deps = []) {
  useEffect(() => {
    const wrap = ref.current;
    const el = wrap && (selector ? wrap.querySelector(selector) : wrap);
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.dataset.fadeStart = max > 2 && el.scrollLeft > 2 ? '1' : '0';
      el.dataset.fadeEnd = max > 2 && el.scrollLeft < max - 2 ? '1' : '0';
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(update); ro.observe(el); }
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); if (ro) ro.disconnect(); };
  }, deps);
}
