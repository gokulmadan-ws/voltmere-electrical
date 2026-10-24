// js/ui/sheet.js: Sheet (bottom sheet on phones, centred dialog from 768px) and ConfirmDialog.
// Owner: WP2
import { h, render, useLayoutEffect, useRef } from '../vendor/preact-htm.js';
import { IconButton, Button } from './button.js';
import { cx, uid } from './util.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// Open sheets, last = top. Nested sheets stack (z-index + 1) and every sheet below the top is inert.
const stack = [];

const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

/** #overlay-root is the last child of <body>; bootApp creates it, this is only a fallback. */
function overlayRoot() {
  let el = document.getElementById('overlay-root');
  if (!el) { el = document.createElement('div'); el.id = 'overlay-root'; document.body.appendChild(el); }
  return el;
}

/** Make the page behind inert, lock scroll, and stack the layers. Safe to call repeatedly. */
function syncLayers() {
  const app = document.getElementById('app');
  const any = stack.length > 0;
  if (app) {
    if (any) { app.setAttribute('inert', ''); app.setAttribute('aria-hidden', 'true'); }
    else { app.removeAttribute('inert'); app.removeAttribute('aria-hidden'); }
  }
  stack.forEach((rec, i) => {
    if (i === stack.length - 1) rec.container.removeAttribute('inert'); else rec.container.setAttribute('inert', '');
    rec.container.style.zIndex = `calc(var(--z-sheet) + ${i})`;
  });
  document.documentElement.classList.toggle('is-scroll-locked', any);
}

/** The sheet's own Preact tree: scrim + dialog panel. Rendered into the sheet's private container. */
function SheetView({ title, description, size = 'auto', header, footer, dismissible = true, testid, onClose, titleId, descId, children }) {
  const defaultHeader = h('div', { class: 'ui-sheet__header' },
    h('h2', { class: 'ui-sheet__title', id: titleId }, title),
    dismissible
      ? h(IconButton, { icon: 'x', label: 'Close', onClick: onClose, class: 'ui-sheet__close', 'data-testid': 'sheet-close' })
      : null);
  const customHeader = header
    ? h('div', { class: 'ui-sheet__custom-header' }, h('h2', { class: 'u-sr-only', id: titleId }, title), header)
    : null;
  return [
    h('div', { class: 'ui-scrim', key: 'scrim', 'aria-hidden': 'true', onClick: dismissible ? onClose : undefined }),
    h('div', {
      class: cx('ui-sheet', `ui-sheet--${size}`), key: 'panel', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': titleId, 'aria-describedby': description ? descId : undefined,
      tabindex: -1, 'data-testid': testid || 'sheet'
    },
    h('div', { class: 'ui-sheet__handle', 'aria-hidden': 'true' }),
    customHeader || defaultHeader,
    h('div', { class: 'ui-sheet__body' },
      description ? h('p', { class: 'ui-sheet__desc', id: descId }, description) : null,
      children),
    footer ? h('div', { class: 'ui-sheet__footer' }, footer) : null)
  ];
}

function paint(rec) {
  render(h(SheetView, { ...rec.props, titleId: rec.titleId, descId: rec.descId }), rec.container);
}

function focusInitial(rec) {
  const panel = rec.container.querySelector('.ui-sheet');
  if (!panel) return;
  const wanted = rec.props.initialFocus;
  let target = null;
  if (typeof wanted === 'string') target = panel.querySelector(wanted);
  else if (wanted && wanted.current) target = wanted.current;
  if (!target) {
    for (const part of ['.ui-sheet__body', '.ui-sheet__footer']) {
      const area = panel.querySelector(part);
      target = area && [...area.querySelectorAll(FOCUSABLE)].find(isVisible);
      if (target) break;
    }
  }
  if (!target) target = panel.querySelector('[data-testid="sheet-close"]') || panel.querySelector(FOCUSABLE);
  (target || panel).focus({ preventScroll: true });
}

function trapTab(rec, e) {
  const panel = rec.container.querySelector('.ui-sheet');
  if (!panel) return;
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter(isVisible);
  if (!items.length) { e.preventDefault(); panel.focus(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!panel.contains(active)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

function onKeyDown(rec, e) {
  if (stack[stack.length - 1] !== rec) return; // only the top sheet reacts
  if (e.key === 'Escape') {
    if (rec.props.dismissible !== false && rec.props.onClose) { e.preventDefault(); rec.props.onClose(); }
  } else if (e.key === 'Tab') {
    trapTab(rec, e);
  }
}

function openSheet(props) {
  // Each Sheet gets its OWN container: a second render() on a shared container would replace the first tree (6.1.1 trap 2).
  const container = document.createElement('div');
  container.className = 'ui-sheet-root';
  overlayRoot().appendChild(container);
  const rec = { container, props, opener: document.activeElement, titleId: uid('sheet-title'), descId: uid('sheet-desc'), onKey: null };
  rec.onKey = (e) => onKeyDown(rec, e);
  stack.push(rec);
  syncLayers();
  document.addEventListener('keydown', rec.onKey);
  paint(rec);
  focusInitial(rec);
  return rec;
}

function closeSheet(rec) {
  document.removeEventListener('keydown', rec.onKey);
  render(null, rec.container);
  rec.container.remove();
  const i = stack.indexOf(rec);
  if (i >= 0) stack.splice(i, 1);
  syncLayers();
  const opener = rec.opener;
  if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === 'function') {
    try { opener.focus({ preventScroll: true }); } catch (e) { /* element can no longer take focus */ }
  }
}

/**
 * Modal sheet. Renders nothing in place: the panel lives in its own container inside #overlay-root
 * (the vendored Preact has no portals), so the children are a SEPARATE Preact root: do not rely on context
 * from the page, read the store with useStore instead (6.1.1 trap 8).
 */
export function Sheet(props) {
  const recRef = useRef(null);
  // Runs after every render so prop changes (children, title, footer) repaint the sheet.
  useLayoutEffect(() => {
    if (props.open) {
      if (!recRef.current) recRef.current = openSheet(props);
      else { recRef.current.props = props; paint(recRef.current); }
    } else if (recRef.current) {
      closeSheet(recRef.current);
      recRef.current = null;
    }
  });
  useLayoutEffect(() => () => {
    if (recRef.current) { closeSheet(recRef.current); recRef.current = null; }
  }, []);
  return null;
}

/** Small yes/no sheet. `body` may be a string or a node (for example a Select). Danger tone focuses Cancel first. */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default', onConfirm, onCancel }) {
  const danger = tone === 'danger';
  return h(Sheet, {
    open, title, size: 'auto', onClose: onCancel, testid: 'confirm-dialog',
    initialFocus: danger ? '[data-testid="confirm-cancel"]' : '[data-testid="confirm-ok"]',
    footer: h('div', { class: cx('ui-confirm__actions', danger && 'ui-confirm__actions--danger') },
      h(Button, { variant: 'secondary', onClick: onCancel, 'data-testid': 'confirm-cancel' }, cancelLabel),
      h(Button, { variant: danger ? 'danger' : 'primary', onClick: onConfirm, 'data-testid': 'confirm-ok' }, confirmLabel))
  }, typeof body === 'string' ? h('p', { class: 'ui-confirm__body' }, body) : body);
}
