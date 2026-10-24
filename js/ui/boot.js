// js/ui/boot.js: bootApp(vnode), the one place that starts a page (store, theme, viewport, toasts, render).
// Owner: WP2
import { h, render } from '../vendor/preact-htm.js';
import { initStore } from '../core/store.js';
import { initTheme } from './theme.js';
import { ToastHost } from './toast.js';
import { Button } from './button.js';

const FAIL_KEY = 'vm_boot_fail';
const STATE_KEY = 'vm_state_v1';

const session = {
  get(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch (e) { /* blocked */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch (e) { /* blocked */ } }
};

/**
 * Keep --kb-inset (how much of the layout viewport the on-screen keyboard covers) up to date on <html>
 * and toggle is-keyboard-open. iOS and Chrome do not shrink 100dvh for the keyboard (5.1 item 15).
 */
function trackViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const update = () => {
    let inset = 0;
    // While pinch-zoomed the visual viewport shrinks for another reason: do not treat that as a keyboard.
    if (vv && vv.scale === 1) inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb-inset', inset + 'px');
    root.classList.toggle('is-keyboard-open', inset > 120);
  };
  if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update); }
  window.addEventListener('orientationchange', update);
  update();

  // A focused field must not hide behind the keyboard: bring it to the middle once the keyboard is up.
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.matches('input, textarea, select')) return;
    if (!touch && !root.classList.contains('is-keyboard-open')) return;
    setTimeout(() => {
      if (document.activeElement === el) el.scrollIntoView({ block: 'center' });
    }, 250);
  });
}

/** Create #overlay-root (last child of body) with #toast-root first inside it, and mount the ToastHost there. */
function mountToasts() {
  let overlay = document.getElementById('overlay-root');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'overlay-root'; document.body.appendChild(overlay); }
  let toastRoot = document.getElementById('toast-root');
  if (!toastRoot) { toastRoot = document.createElement('div'); toastRoot.id = 'toast-root'; overlay.insertBefore(toastRoot, overlay.firstChild); }
  render(h(ToastHost), toastRoot); // ONE render() per container (6.1.1 trap 2)
}

function fatalScreen(root) {
  root.textContent = '';
  render(h('div', { class: 'ui-fatal', role: 'alert' },
    h('p', { class: 'ui-fatal__text' }, "Couldn't load saved data. Reload to reset."),
    h(Button, { variant: 'primary', onClick: () => location.reload() }, 'Reload')), root);
}

/**
 * Start a page. Order (11.6): store, theme, viewport tracking, toast host, then EMPTY #app and render.
 * A failing store shows a Reload screen once; a second failure in the same tab clears the saved state and reloads.
 */
export function bootApp(vnode, { container = '#app' } = {}) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  if (!root) { console.error('bootApp: container not found', container); return; }

  let storeOk = true;
  try {
    initStore();
    session.remove(FAIL_KEY);
  } catch (err) {
    storeOk = false;
    console.error('Store failed to start', err);
    const seen = session.get(FAIL_KEY);
    if (seen === '1') {
      // Second failure in this tab: the saved state is bad. Drop it and reload once ('2' stops a reload loop).
      try { localStorage.removeItem(STATE_KEY); } catch (e) { /* blocked */ }
      session.set(FAIL_KEY, '2');
      location.reload();
      return;
    }
    if (seen !== '2') session.set(FAIL_KEY, '1');
  }

  try { initTheme(); } catch (err) { console.error('Theme failed to start', err); }
  try { trackViewport(); } catch (err) { console.error('Viewport tracking failed to start', err); }
  try { mountToasts(); } catch (err) { console.error('Toast host failed to start', err); }

  if (!storeOk) { fatalScreen(root); return; }
  root.textContent = ''; // render() into a container with children appends instead of replacing (6.1.1 trap 3)
  render(vnode, root);
}
