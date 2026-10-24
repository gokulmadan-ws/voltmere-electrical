// js/landing/art.js: inline SVG art: BreakerArt (the six-breaker confirmation graphic). The hero underline is a CSS mask.
// Owner: WP3
import { h } from '../vendor/preact-htm.js';
import { cx } from '../ui/util.js';

// One breaker module is 38 wide with an 8 gap, six of them fit a 300 wide case (see viewBox below).
const BREAKER_X = [16, 62, 108, 154, 200, 246];
const BOOKED = 2; // the third breaker (index 2) is "yours": it starts OFF and flips ON

/**
 * Six circuit breakers in a consumer unit. The third one flips ON over --dur-flip with --ease-spring and a small
 * scale pulse (css/landing.css, .lp-breaker*). Under reduced motion, or with `animate={false}`, it is drawn in its
 * final state (all six ON). Decorative (aria-hidden); `data-testid="breaker-art"` by default, override via props.
 */
export function BreakerArt({ animate = true, class: cls, ...rest }) {
  const modules = BREAKER_X.map((x, i) => {
    const yours = i === BOOKED;
    return h('g', { key: i, class: cx('lp-breaker__unit', yours && 'lp-breaker__unit--yours') },
      h('rect', { class: 'lp-breaker__body', x, y: 26, width: 38, height: 92, rx: 5 }),
      h('rect', { class: 'lp-breaker__slot', x: x + 9, y: 38, width: 20, height: 56, rx: 3 }),
      // The lever sits in the top half when ON. The flip animation starts it 40 units lower (OFF).
      h('rect', { class: 'lp-breaker__lever', x: x + 11, y: 40, width: 16, height: 24, rx: 2.5 }),
      h('circle', { class: 'lp-breaker__led', cx: x + 19, cy: 106, r: 3.2 }),
      h('text', { class: 'lp-breaker__num', x: x + 19, y: 140, 'text-anchor': 'middle' }, String(i + 1)));
  });
  return h('svg', {
    class: cx('lp-breaker', !animate && 'is-static', cls),
    viewBox: '0 0 300 150', width: 300, height: 150,
    'aria-hidden': 'true', focusable: 'false',
    'data-testid': 'breaker-art',
    ...rest
  },
  h('rect', { class: 'lp-breaker__case', x: 0, y: 0, width: 300, height: 150, rx: 14 }),
  h('rect', { class: 'lp-breaker__rail', x: 8, y: 20, width: 284, height: 104, rx: 8 }),
  modules);
}
