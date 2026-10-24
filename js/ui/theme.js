// js/ui/theme.js: theme choice (auto / light / dark): getTheme, setThemeChoice, applyTheme, initTheme and ThemeToggle.
// Owner: WP2 (dark is the default look for 180 Electrical, set by role B2: no saved choice means dark; an explicit Auto follows the OS)
// Two scopes (docs/LANDING-V5.md 8.1): the owner dashboard (dark by default, key 'vm_theme') and the PUBLIC pages (index.html, quote.html: <html data-scope="public">, light by default,
// their own key 'vm_theme_public', never mirrored into the store), so a choice made on one can never leak into the other. B1.
import { h, useReducer } from '../vendor/preact-htm.js';
import { setTheme as storeSetTheme, subscribe } from '../core/store.js';
import { IconButton } from './button.js';
import { Segmented } from './form.js';
import { useStore } from './hooks.js';

// localStorage[KEY] is the single source of truth (the inline <head> script reads it before first paint).
// settings.theme in the store is only a mirror that lets the OTHER dashboard tab notice a change (7.7); the public scope does not use it.
// Dashboard: nothing saved means DARK (the brand look). Public pages: nothing saved means LIGHT. 'auto' is only ever an explicit choice, saved by the Auto option.
const PUBLIC = typeof document !== 'undefined' && document.documentElement.getAttribute('data-scope') === 'public';
const KEY = PUBLIC ? 'vm_theme_public' : 'vm_theme';
const DEFAULT_CHOICE = PUBLIC ? 'light' : 'dark';
const LIGHT_COLOR = '#F6F5F3'; // same as --bg in tokens.css; the theme-color metas need a literal
const DARK_COLOR = '#0B0B0C'; // same as --bg in the dark block
const CHOICES = ['auto', 'light', 'dark'];
const SEGMENT_ORDER = PUBLIC ? ['light', 'dark', 'auto'] : CHOICES; // the public popover reads Light, Dark, Auto (LANDING-V5 4.11)
const ICON = { auto: 'sun-moon', light: 'sun', dark: 'moon' };
const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };

let memoryChoice = null; // used only when localStorage is blocked
let started = false;

/** The saved choice: 'auto' | 'light' | 'dark'. Missing (or junk) means the scope's default: dark on the dashboard, light on the public pages. */
export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return CHOICES.includes(v) ? v : (memoryChoice || DEFAULT_CHOICE);
  } catch (e) {
    return memoryChoice || DEFAULT_CHOICE;
  }
}

function osPrefersDark(mediaAttr) {
  if (/prefers-color-scheme:\s*dark/.test(mediaAttr || '')) return true;
  if (/prefers-color-scheme:\s*light/.test(mediaAttr || '')) return false;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return true; }
}

/** Put the choice on <html data-theme> (auto removes it) and keep both theme-color metas in step. */
export function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
  else root.removeAttribute('data-theme');
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    let color;
    if (PUBLIC) color = DARK_COLOR; // the public pages' header is black in every theme, so the browser bar is too
    else if (choice === 'light') color = LIGHT_COLOR;
    else if (choice === 'dark') color = DARK_COLOR;
    else color = osPrefersDark(meta.getAttribute('media')) ? DARK_COLOR : LIGHT_COLOR; // auto: follow the OS
    meta.setAttribute('content', color);
  });
}

/** Save and apply a choice. Tells the store too, so the other page (a second tab) flips live. */
export function setThemeChoice(choice) {
  if (!CHOICES.includes(choice)) choice = DEFAULT_CHOICE;
  memoryChoice = choice;
  if (!PUBLIC) { try { storeSetTheme(choice); } catch (e) { /* store not ready: the localStorage write below still works */ } }
  try { localStorage.setItem(KEY, choice); } catch (e) { /* blocked: memoryChoice keeps this tab right */ }
  applyTheme(choice);
}

/** Boot-time: apply the saved choice and follow changes made in the other tab (via the store mirror and the storage event). */
export function initTheme() {
  applyTheme(getTheme());
  if (started) return;
  started = true;
  if (!PUBLIC) { try { subscribe(() => applyTheme(getTheme())); } catch (e) { /* no store: nothing to follow */ } }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) applyTheme(getTheme());
  });
  try { // Auto follows the OS live, so the browser bar colour stays right when the OS flips
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getTheme() === 'auto') applyTheme('auto'); });
  } catch (e) { /* no matchMedia: the theme-color meta keeps its last value */ }
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
      options: SEGMENT_ORDER.map((c) => ({ value: c, label: LABEL[c], icon: ICON[c], testid: `theme-${c}` })),
      ...rest
    });
  }
  const next = CHOICES[(CHOICES.indexOf(current) + 1) % CHOICES.length];
  return h(IconButton, {
    icon: ICON[current], label: `Theme: ${LABEL[current]}`, onClick: () => choose(next),
    'data-testid': 'theme-toggle', ...rest
  });
}
