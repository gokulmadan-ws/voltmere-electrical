// js/landing/glyphs.js: the five hand-drawn glyphs of the landing page (docs/LANDING-V5.md 4.14): arrow, tick, phone, chev, x. Inline SVG, drawn through h() (never as an HTML string),
// stroke only (currentColor), square caps. The shared Icon set (js/ui/display.js) is NOT used on the landing page: it draws round lucide icons at a different weight.
// Owner: B1 (LANDING-V5).
import { h } from '../vendor/preact-htm.js';
import { cx } from '../ui/util.js';

// name -> { box (the viewBox edge), d (the path), w (stroke width), size (default drawn size), join (optional stroke-linejoin) }
const GLYPHS = {
  arrow: { box: 20, d: 'M3 10h13M11 4.5 16.5 10 11 15.5', w: 1.75, size: 20 },
  tick: { box: 20, d: 'M3.5 10.5 8 15 16.5 5.5', w: 1.75, size: 20 },
  phone: {
    box: 24, w: 1.6, size: 20, join: 'round',
    d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'
  },
  chev: { box: 12, d: 'M2.5 4.5 6 8l3.5-3.5', w: 1.5, size: 12 },
  x: { box: 20, d: 'M4.5 4.5l11 11M15.5 4.5l-11 11', w: 1.75, size: 20 }
};

export const GLYPH_NAMES = Object.keys(GLYPHS);

/** One glyph as inline SVG. Decorative (aria-hidden) always: the words beside it carry the meaning. `size` is the drawn edge in px. */
export function Glyph({ name, size, class: cls, ...rest }) {
  const g = GLYPHS[name];
  if (!g) return null;
  const px = size || g.size;
  return h('svg', {
    class: cx('lp-glyph', `lp-glyph--${name}`, cls),
    width: px, height: px, viewBox: `0 0 ${g.box} ${g.box}`,
    fill: 'none', stroke: 'currentColor', 'stroke-width': g.w, 'stroke-linecap': 'square', 'stroke-linejoin': g.join || 'miter',
    focusable: 'false', 'aria-hidden': 'true', ...rest
  }, h('path', { d: g.d }));
}
