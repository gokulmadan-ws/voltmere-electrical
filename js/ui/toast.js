// js/ui/toast.js: toast(), dismissToast(), showUndoToast() and the ToastHost live region.
// Owner: B3 (was WP2; detail line, icon and a pause-safe timer bar added by B3)
import { h, useEffect, useState } from '../vendor/preact-htm.js';
import { undo } from '../core/store.js';
import { Icon } from './display.js';
import { cx } from './util.js';

const MAX_VISIBLE = 2;
let nextId = 0;
let items = [];                 // visible toasts, oldest first; replaced (never mutated) on every change
const listeners = new Set();    // ToastHost setState functions
const timers = new Map();       // toast id -> timeout handle
const clocks = new Map();       // toast id -> { remaining, startedAt } so a pause keeps the time that is left

const emit = () => listeners.forEach((fn) => fn(items));
const tick = () => (typeof performance !== 'undefined' ? performance.now() : 0);

function clearTimer(id) {
  if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
}

/** (Re)start the countdown with whatever time is left. */
function arm(id) {
  clearTimer(id);
  const clock = clocks.get(id);
  if (!clock || !(clock.remaining > 0)) return;
  clock.startedAt = tick();
  timers.set(id, setTimeout(() => dismissToast(id), clock.remaining));
}

/** Stop the countdown but remember how long was left (hover or focus on the action). */
function pause(id) {
  const clock = clocks.get(id);
  if (!clock || !timers.has(id)) return;
  clock.remaining = Math.max(1500, clock.remaining - (tick() - clock.startedAt));
  clearTimer(id);
}

/**
 * Show a toast. Returns its id. `tone: 'danger'` is announced as an alert. At most two are visible.
 * `detail` is an optional second, muted line; `icon` an optional Lucide name drawn in a round badge.
 */
export function toast({ message, detail, icon, actionLabel, onAction, duration = 6000, tone = 'default', testid }) {
  nextId += 1;
  const id = nextId;
  items = [...items, { id, message, detail, icon, actionLabel, onAction, duration, tone, testid }];
  while (items.length > MAX_VISIBLE) dismissToast(items[0].id, false);
  clocks.set(id, { remaining: duration, startedAt: 0 });
  arm(id);
  emit();
  return id;
}

export function dismissToast(id, notify = true) {
  clearTimer(id);
  clocks.delete(id);
  const before = items.length;
  items = items.filter((t) => t.id !== id);
  if (notify && items.length !== before) emit();
}

/**
 * Toast with an Undo button that calls store.undo(token). If the diary has moved on since, say so.
 * (Lives here, not in job-actions, so every screen can use it without a cross-package import.)
 */
export function showUndoToast(message, undoToken, { duration = 6000 } = {}) {
  return toast({
    message, actionLabel: 'Undo', duration,
    onAction: () => {
      const res = undo(undoToken);
      if (!res || !res.ok) toast({ message: 'Too late to undo.' });
    }
  });
}

function ToastItem({ t }) {
  const [paused, setPaused] = useState(false);
  const act = () => {
    dismissToast(t.id);
    if (t.onAction) t.onAction();
  };
  // Auto-dismiss pauses while the action is hovered or focused (the rest of the toast ignores the pointer).
  // The time that was left is kept, and the timer bar pauses with it.
  const hold = () => { pause(t.id); setPaused(true); };
  const release = () => { arm(t.id); setPaused(false); };
  return h('div', {
    class: cx('ui-toast', t.tone !== 'default' && `ui-toast--${t.tone}`, t.icon && 'ui-toast--icon', paused && 'is-paused'),
    role: t.tone === 'danger' ? 'alert' : undefined,
    'data-testid': 'toast'
  },
  t.icon ? h('span', { class: 'ui-toast__badge', 'aria-hidden': 'true' }, h(Icon, { name: t.icon, size: 18 })) : null,
  h('span', { class: 'ui-toast__text' },
    h('span', { class: 'ui-toast__msg' }, t.message),
    t.detail ? h('span', { class: 'ui-toast__detail' }, t.detail) : null),
  t.actionLabel
    ? h('button', {
      type: 'button', class: 'ui-toast__action', 'data-testid': 'toast-action',
      onClick: act, onPointerEnter: hold, onPointerLeave: release, onFocus: hold, onBlur: release
    }, t.actionLabel)
    : null,
  t.duration > 0 ? h('span', { class: 'ui-toast__timer', 'aria-hidden': 'true', style: { '--toast-dur': t.duration + 'ms' } }) : null);
}

/** Mounted once per page by bootApp into #toast-root. The region exists from first paint; only its content changes. */
export function ToastHost() {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    setList(items);
    return () => { listeners.delete(setList); };
  }, []);
  return h('div', { class: 'ui-toast-host', role: 'status', 'aria-live': 'polite' },
    list.map((t) => h(ToastItem, { t, key: t.id })));
}
