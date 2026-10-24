// js/ui/status.js: StatusDot, ConnectionBadge, Timeline, Meter and ProgressRing (state and progress display).
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { h } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx } from './util.js';

// ---- Connection state ----

const STATE_OF = {
  connected: 'connected', live: 'connected', ok: 'connected', approved: 'connected', ready: 'connected',
  pending: 'pending', verifying: 'pending', in_review: 'pending', submitted: 'pending',
  error: 'error', failed: 'error', rejected: 'error', problem: 'error',
  off: 'off', none: 'off', disconnected: 'off', not_set_up: 'off', inactive: 'off'
};
const STATE_LABEL = { connected: 'Connected', pending: 'Pending', error: 'Needs attention', off: 'Not set up' };
const STATE_ICON = { connected: 'check', pending: 'clock', error: 'triangle-alert', off: 'circle-dashed' };

/** Map any store spelling (live, verifying, none, disconnected ...) to connected | pending | error | off. */
export function connectionState(status) {
  return STATE_OF[String(status === undefined || status === null ? 'off' : status).toLowerCase()] || 'off';
}

/**
 * A small status dot. The state is also written for screen readers (`label`, or the default word); `showLabel` prints it.
 * Pending dots pulse; the pulse is static under reduced motion.
 */
export function StatusDot({ status, label, showLabel, class: cls, ...rest }) {
  const state = connectionState(status);
  const text = label || STATE_LABEL[state];
  return h('span', { class: cx('ui-dot-wrap', cls), ...rest },
    h('span', { class: cx('ui-dot', `ui-dot--${state}`), 'aria-hidden': 'true' }),
    h('span', { class: showLabel ? 'ui-dot__label' : 'u-sr-only' }, text));
}

/** Pill with a state glyph and a word: never colour alone. `compact` drops the glyph. */
export function ConnectionBadge({ status, label, compact, class: cls, ...rest }) {
  const state = connectionState(status);
  return h('span', { class: cx('ui-conn', `ui-conn--${state}`, compact && 'ui-conn--compact', cls), ...rest },
    compact ? h('span', { class: cx('ui-dot', `ui-dot--${state}`), 'aria-hidden': 'true' }) : h('span', { class: 'ui-conn__glyph', 'aria-hidden': 'true' }, h(Icon, { name: STATE_ICON[state], size: 14 })),
    h('span', { class: 'ui-conn__label' }, label || STATE_LABEL[state]));
}

// ---- Timeline ----

const TONE_ICON = { done: 'check', current: null, upcoming: null, error: 'triangle-alert', warn: 'triangle-alert', info: 'info' };
const TONE_WORD = { done: 'Done: ', current: 'Now: ', upcoming: 'Next: ', error: 'Problem: ', warn: 'Check: ', info: '' };

/** Vertical list of events. item: { id, title, detail, time, tone = 'done', icon, children, testid }. */
export function Timeline({ items = [], ariaLabel, compact, class: cls, ...rest }) {
  return h('ol', { class: cx('ui-timeline', compact && 'ui-timeline--compact', cls), 'aria-label': ariaLabel, ...rest },
    items.map((it) => {
      const tone = it.tone || 'done';
      const glyph = it.icon || TONE_ICON[tone];
      return h('li', { class: cx('ui-timeline__item', `ui-timeline__item--${tone}`), key: it.id, 'data-testid': it.testid },
        h('span', { class: 'ui-timeline__mark', 'aria-hidden': 'true' }, glyph ? h(Icon, { name: glyph, size: 14 }) : null),
        h('div', { class: 'ui-timeline__body' },
          h('p', { class: 'ui-timeline__title' }, TONE_WORD[tone] ? h('span', { class: 'u-sr-only' }, TONE_WORD[tone]) : null, it.title,
            it.time ? h('span', { class: 'ui-timeline__time' }, it.time) : null),
          it.detail ? h('p', { class: 'ui-timeline__detail' }, it.detail) : null,
          it.children ? h('div', { class: 'ui-timeline__extra' }, it.children) : null));
    }));
}

// ---- Meter and ProgressRing ----

const fraction = (value, min, max) => {
  const span = Number(max) - Number(min);
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (Number(value) - Number(min)) / span));
};
const percentText = (f) => `${Math.round(f * 100)}%`;

/** Horizontal gauge. role="meter" with a required `label`. tone: accent | ok | warn | danger | neutral. */
export function Meter({ value = 0, min = 0, max = 100, label, valueText, tone = 'accent', size = 'md', showValue, class: cls, ...rest }) {
  const f = fraction(value, min, max);
  const text = valueText || percentText(f);
  return h('div', {
    class: cx('ui-meter', `ui-meter--${tone}`, size !== 'md' && `ui-meter--${size}`, cls),
    role: 'meter', 'aria-label': label, 'aria-valuenow': Number(value), 'aria-valuemin': Number(min), 'aria-valuemax': Number(max), 'aria-valuetext': text,
    ...rest
  },
  h('div', { class: 'ui-meter__row', 'aria-hidden': 'true' },
    h('span', { class: 'ui-meter__label' }, label),
    showValue ? h('span', { class: 'ui-meter__value' }, text) : null),
  h('div', { class: 'ui-meter__track', 'aria-hidden': 'true' },
    h('span', { class: 'ui-meter__fill', style: { '--p': f } })));
}

/** Circular gauge with centre content (children). role="meter" with a required `label`. */
export function ProgressRing({ value = 0, min = 0, max = 100, size = 72, stroke = 7, label, valueText, tone = 'accent', class: cls, children, ...rest }) {
  const f = fraction(value, min, max);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const text = valueText || percentText(f);
  return h('div', {
    class: cx('ui-ring', `ui-ring--${tone}`, cls),
    style: { width: size + 'px', height: size + 'px' },
    role: 'meter', 'aria-label': label, 'aria-valuenow': Number(value), 'aria-valuemin': Number(min), 'aria-valuemax': Number(max), 'aria-valuetext': text,
    ...rest
  },
  h('svg', { class: 'ui-ring__svg', width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', focusable: 'false' },
    h('circle', { class: 'ui-ring__track', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, fill: 'none' }),
    h('circle', {
      class: 'ui-ring__fill', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, fill: 'none', 'stroke-linecap': 'round',
      style: { '--c': c.toFixed(2), '--off': (c * (1 - f)).toFixed(2) },
      'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': (c * (1 - f)).toFixed(2)
    })),
  h('span', { class: 'ui-ring__center', 'aria-hidden': 'true' }, children === undefined ? text : children));
}
