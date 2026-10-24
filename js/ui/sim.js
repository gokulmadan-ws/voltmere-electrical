// js/ui/sim.js: SimBanner (the "simulated" label), RealBuildNote and Disclosure.
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { h } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx } from './util.js';

/**
 * The honesty label every simulated connection screen shows: ONE "Practice mode" style (a neutral dashed outline, no hazard stripes) on the hub,
 * the wizards' end states and the More row. The full version adds one plain sentence; `compact` is the one-line pill for headers and cards;
 * children add a further sentence to the full version.
 */
export function SimBanner({ compact, class: cls, children, ...rest }) {
  if (compact) {
    return h('p', { class: cx('ui-sim ui-sim--compact', cls), 'data-testid': 'sim-banner', ...rest },
      // The tail is its own span so a tight row (the wizard's step row, T11) can show just "Practice mode"; every word is still in the DOM.
      h(Icon, { name: 'circle-dashed', size: 16 }), h('span', null, 'Practice mode', h('span', { class: 'ui-sim__more' }, ' · simulated in this prototype')));
  }
  return h('div', { class: cx('ui-sim', cls), role: 'note', 'data-testid': 'sim-banner', ...rest },
    h('span', { class: 'ui-sim__icon', 'aria-hidden': 'true' }, h(Icon, { name: 'circle-dashed', size: 22 })),
    h('p', { class: 'ui-sim__text' },
      h('strong', null, 'Practice mode.'), ' Simulated in this prototype: nothing is really connected, and what you set up is saved on this device only.',
      children ? h('span', { class: 'ui-sim__extra' }, ' ', children) : null));
}

/** Native <details> with a 56px summary and an animated chevron. */
export function Disclosure({ title, summary, defaultOpen, onToggle, testid, class: cls, children, ...rest }) {
  return h('details', { class: cx('ui-disclosure', cls), open: defaultOpen ? true : undefined, onToggle, 'data-testid': testid, ...rest },
    h('summary', { class: 'ui-disclosure__summary' },
      h('span', { class: 'ui-disclosure__title' }, title),
      summary ? h('span', { class: 'ui-disclosure__meta' }, summary) : null,
      h(Icon, { name: 'chevron-down', size: 20, class: 'ui-disclosure__chev' })),
    h('div', { class: 'ui-disclosure__body' }, children));
}

/** "What a real build needs": a closed disclosure listing what the real version would take. `items` is an array of strings. */
export function RealBuildNote({ title = 'What a real build needs', items, class: cls, children, ...rest }) {
  return h(Disclosure, { title, class: cx('ui-realbuild', cls), testid: 'real-build-note', ...rest },
    Array.isArray(items) && items.length
      ? h('ul', { class: 'ui-realbuild__list' }, items.map((t, i) => h('li', { key: i }, h(Icon, { name: 'check', size: 16 }), h('span', null, t))))
      : null,
    children);
}
