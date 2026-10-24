// js/ui/toast.js: toast(), dismissToast(), showUndoToast() and the ToastHost live region.
// Owner: WP2
import { h, useEffect, useState } from '../vendor/preact-htm.js';
import { undo } from '../core/store.js';
import { cx } from './util.js';

const MAX_VISIBLE = 2;
let nextId = 0;
let items = [];                 // visible toasts, oldest first; replaced (never mutated) on every change
const listeners = new Set();    // ToastHost setState functions
const timers = new Map();       // toast id -> timeout handle

const emit = () => listeners.forEach((fn) => fn(items));

function clearTimer(id) {
  if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
}

function arm(id) {
  clearTimer(id);
  const t = items.find((x) => x.id === id);
  if (!t || !(t.duration > 0)) return;
  timers.set(id, setTimeout(() => dismissToast(id), t.duration));
}

/** Show a toast. Returns its id. `tone: 'danger'` is announced as an alert. At most two are visible. */
export function toast({ message, actionLabel, onAction, duration = 6000, tone = 'default' }) {
  nextId += 1;
  const id = nextId;
  items = [...items, { id, message, actionLabel, onAction, duration, tone }];
  while (items.length > MAX_VISIBLE) dismissToast(items[0].id, false);
  arm(id);
  emit();
  return id;
}

export function dismissToast(id, notify = true) {
  clearTimer(id);
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
  const act = () => {
    dismissToast(t.id);
    if (t.onAction) t.onAction();
  };
  // Auto-dismiss pauses while the action is hovered or focused (the rest of the toast ignores the pointer).
  const pause = () => clearTimer(t.id);
  const resume = () => arm(t.id);
  return h('div', {
    class: cx('ui-toast', t.tone !== 'default' && `ui-toast--${t.tone}`),
    role: t.tone === 'danger' ? 'alert' : undefined,
    'data-testid': 'toast'
  },
  h('span', { class: 'ui-toast__msg' }, t.message),
  t.actionLabel
    ? h('button', {
      type: 'button', class: 'ui-toast__action', 'data-testid': 'toast-action',
      onClick: act, onPointerEnter: pause, onPointerLeave: resume, onFocus: pause, onBlur: resume
    }, t.actionLabel)
    : null);
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
