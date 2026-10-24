// js/ui/theme.js: theme choice (auto / light / dark): getTheme, setThemeChoice, applyTheme, initTheme and ThemeToggle.
// Owner: WP2
import { h, useReducer } from '../vendor/preact-htm.js';
import { setTheme as storeSetTheme, subscribe } from '../core/store.js';
import { IconButton } from './button.js';
import { Segmented } from './form.js';
import { useStore } from './hooks.js';

// localStorage['vm_theme'] is the single source of truth (the inline <head> script reads it before first paint).
// settings.theme in the store is only a mirror that lets the OTHER page notice a change (7.7).
const KEY = 'vm_theme';
const LIGHT_COLOR = '#FBF8F2'; // same as --bg in tokens.css; the theme-color metas need a literal
const DARK_COLOR = '#0B1020';
const CHOICES = ['auto', 'light', 'dark'];
const ICON = { auto: 'sun-moon', light: 'sun', dark: 'moon' };
const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };

let memoryChoice = null; // used only when localStorage is blocked
let started = false;

/** The saved choice: 'auto' | 'light' | 'dark'. Missing means auto. */
export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch (e) {
    return memoryChoice || 'auto';
  }
}

/** Put the choice on <html data-theme> (auto removes it) and keep both theme-color metas in step. */
export function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
  else root.removeAttribute('data-theme');
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    let color;
    if (choice === 'light') color = LIGHT_COLOR;
    else if (choice === 'dark') color = DARK_COLOR;
    else color = /dark/.test(meta.getAttribute('media') || '') ? DARK_COLOR : LIGHT_COLOR;
    meta.setAttribute('content', color);
  });
}

/** Save and apply a choice. Tells the store too, so the other page (a second tab) flips live. */
export function setThemeChoice(choice) {
  if (!CHOICES.includes(choice)) choice = 'auto';
  memoryChoice = choice;
  try { storeSetTheme(choice); } catch (e) { /* store not ready: the localStorage write below still works */ }
  try { localStorage.setItem(KEY, choice); } catch (e) { /* blocked: memoryChoice keeps this tab right */ }
  applyTheme(choice);
}

/** Boot-time: apply the saved choice and follow changes made in the other tab (via the store mirror and the storage event). */
export function initTheme() {
  applyTheme(getTheme());
  if (started) return;
  started = true;
  try { subscribe(() => applyTheme(getTheme())); } catch (e) { /* no store: nothing to follow */ }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) applyTheme(getTheme());
  });
}

const selectThemeMirror = (state) => state.settings.theme;

/** Theme control. `icon`: one button that cycles Auto, Light, Dark. `segmented`: three options (Settings). */
export function ThemeToggle({ variant = 'icon', ...rest }) {
  useStore(selectThemeMirror); // re-render when the theme was changed from the other tab
  const [, bump] = useReducer((n) => n + 1, 0);
  const current = getTheme();
  const choose = (choice) => { setThemeChoice(choice); bump(); };
  if (variant === 'segmented') {
    return h(Segmented, {
      ariaLabel: 'Theme', value: current, onChange: choose,
      options: CHOICES.map((c) => ({ value: c, label: LABEL[c], icon: ICON[c], testid: `theme-${c}` })),
      ...rest
    });
  }
  const next = CHOICES[(CHOICES.indexOf(current) + 1) % CHOICES.length];
  return h(IconButton, {
    icon: ICON[current], label: `Theme: ${LABEL[current]}`, onClick: () => choose(next),
    'data-testid': 'theme-toggle', ...rest
  });
}
