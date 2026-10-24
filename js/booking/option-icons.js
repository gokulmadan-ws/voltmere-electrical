// js/booking/option-icons.js: small line icons for the funnel's answer rows (steps 2 to 5). Drawn here (24px grid, 1.75 stroke, same style as js/ui/icons.js)
// so the shared icon set stays untouched; names the shared set already has fall back to <Icon>.
// Owner: LAND (booking funnel)
import { h } from '../vendor/preact-htm.js';
import { Icon } from '../ui/index.js';

const PATHS = {
  car: [
    ['path', { d: 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2' }],
    ['circle', { cx: '7', cy: '17', r: '2' }], ['path', { d: 'M9 17h6' }], ['circle', { cx: '17', cy: '17', r: '2' }]
  ],
  garage: [
    ['path', { d: 'M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z' }],
    ['path', { d: 'M6 18h12' }], ['path', { d: 'M6 14h12' }], ['rect', { x: '6', y: '10', width: '12', height: '12' }]
  ],
  parking: [['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }], ['path', { d: 'M9 17V7h4a3 3 0 0 1 0 6H9' }]],
  signpost: [['path', { d: 'M12 3v3' }], ['path', { d: 'M18.5 13h-13L2 9.5 5.5 6h13L22 9.5Z' }], ['path', { d: 'M12 13v8' }]],
  help: [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }], ['path', { d: 'M12 17h.01' }]],
  package: [
    ['path', { d: 'm7.5 4.27 9 5.15' }],
    ['path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }],
    ['path', { d: 'm3.3 7 8.7 5 8.7-5' }], ['path', { d: 'M12 22V12' }]
  ],
  book: [['path', { d: 'M12 7v14' }], ['path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' }]]
};

/** One answer's icon, by the funnel's answer key and value. Unknown pairs get a neutral dot. */
const BY_ANSWER = {
  parking: { driveway: 'house', garage: 'garage', allocated: 'parking', street: 'signpost', other: 'help' },
  vehicle: { have: 'car', ordered: 'package', choosing: 'search' },
  timing: { asap: 'zap', month: 'calendar-days', one_to_three: 'calendar-clock', researching: 'book' },
  permission: { yes: 'circle-check', landlord: 'key-round', unsure: 'help' }
};

export function answerIconName(key, value) {
  return (BY_ANSWER[key] && BY_ANSWER[key][value]) || 'circle';
}

/** Decorative line icon (aria-hidden). */
export function OptionIcon({ name, size = 22 }) {
  const nodes = PATHS[name];
  if (!nodes) return h(Icon, { name, size });
  return h('svg', {
    class: 'ui-icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false', 'aria-hidden': 'true'
  }, nodes.map(([tag, attrs], i) => h(tag, { ...attrs, key: i })));
}
