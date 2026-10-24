// js/dashboard/shell.js: the dashboard shell (strip, header, tab bar, sidebar, FAB) and the lazy view loader.
// Owner: WP2
import { html, h, useErrorBoundary, useEffect, useLayoutEffect, useReducer, useRef } from '../vendor/preact-htm.js';
import {
  BrandMark, Button, Card, Icon, IconButton, PrototypeNotice, Skeleton, ThemeToggle,
  cx, focusTitle, loadCss, pageHref, pageTarget, useStore
} from '../ui/index.js';
import { selectBrand, selectNeedsYou, selectUnseenBookings, selectUnreadMessageCount } from '../core/selectors.js';
import { ROUTES } from './routes.js';
import { useRoute, isImmersive, routeHref } from './router.js';
import { setBaseTitle } from './watcher.js';

// Selectors live outside the components so useStore gets stable functions (8.8).
const selectShortName = (state) => selectBrand(state).shortName;
const selectNeedsCount = (state) => selectNeedsYou(state).length;
const selectHasUnseen = (state) => selectUnseenBookings(state).length > 0;
const selectUnread = (state) => selectUnreadMessageCount(state);

const TABS = [
  { id: 'today', label: 'Today', icon: 'zap' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-days' },
  { id: 'bookings', label: 'Bookings', icon: 'inbox' },
  { id: 'insights', label: 'Insights', icon: 'pound-sterling' },
  { id: 'more', label: 'More', icon: 'ellipsis' }
];

// Sidebar (1100px and up): route names and which route names light each item.
const SIDEBAR_MAIN = [
  { id: 'today', label: 'Today', icon: 'zap', names: ['today'] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-days', names: ['calendar'] },
  { id: 'bookings', label: 'Bookings', icon: 'inbox', names: ['bookings'] },
  { id: 'customers', label: 'Customers', icon: 'users', names: ['customers'] },
  { id: 'insights', label: 'Insights', icon: 'pound-sterling', names: ['insights'] },
  { id: 'messages', label: 'Messages', icon: 'message-circle', names: ['messages'] },
  { id: 'more', label: 'More', icon: 'ellipsis', names: ['more', 'settings'] }
];
const SIDEBAR_LOW = [
  { id: 'demo', label: 'Demo tools', icon: 'gauge', names: ['demo'] },
  { id: 'about', label: "What's real", icon: 'shield-check', names: ['about'] }
];

const FAB_ROUTES = ['today', 'calendar', 'bookings'];

// ---- Header ----

function Header() {
  const shortName = useStore(selectShortName);
  const unread = useStore(selectUnread);
  return html`<header class="db-header" data-testid="db-header">
    <div class="db-header__inner">
      <a class="db-header__brand" href=${routeHref('today')}>
        <${BrandMark} size=${32} />
        <span class="db-header__name">${shortName}</span>
      </a>
      <div class="db-header__actions">
        <${IconButton} icon="message-circle" label=${unread > 0 ? `Messages, ${unread} new` : 'Messages'} href=${routeHref('messages')}
          badge=${unread} badgeTestid="db-messages-badge" data-testid="db-messages-button" />
        <${ThemeToggle} />
        <${IconButton} icon="external-link" label="View customer site" href=${pageHref('index.html')}
          target=${pageTarget('index.html')} data-testid="db-site-link" />
      </div>
    </div>
  </header>`;
}

// ---- Navigation ----

function TabBar({ activeTab }) {
  const needs = useStore(selectNeedsCount);
  const hasUnseen = useStore(selectHasUnseen);
  return html`<nav class="db-tabbar" aria-label="Main" data-testid="tabbar">
    <ul class="db-tabbar__list">
      ${TABS.map((tab) => {
        const active = activeTab === tab.id;
        return html`<li class="db-tabbar__item" key=${tab.id}>
          <a class=${cx('db-tab', active && 'is-active')} href=${routeHref(tab.id)} aria-current=${active ? 'page' : undefined} data-testid=${`tab-${tab.id}`}>
            <span class="db-tab__pill">
              <${Icon} name=${tab.icon} size=${24} />
              ${tab.id === 'today' && needs > 0 ? html`<span class="db-tab__badge" data-testid="tab-badge-today" aria-hidden="true">${needs}</span><span class="u-sr-only">${`${needs} need you`}</span>` : null}
              ${tab.id === 'bookings' && hasUnseen ? html`<span class="db-tab__badge db-tab__badge--dot" data-testid="tab-badge-bookings" aria-hidden="true"></span><span class="u-sr-only">New bookings</span>` : null}
            </span>
            <span class="db-tab__label">${tab.label}</span>
          </a>
        </li>`;
      })}
    </ul>
  </nav>`;
}

function SidebarItem({ item, route, badge }) {
  const active = item.names.includes(route.name);
  return html`<li>
    <a class=${cx('db-nav__item', active && 'is-active')} href=${routeHref(item.id)} aria-current=${active ? 'page' : undefined} data-testid=${`nav-${item.id}`}>
      <${Icon} name=${item.icon} size=${22} />
      <span class="db-nav__label">${item.label}</span>
      ${badge > 0 ? html`<span class="db-nav__badge" aria-hidden="true">${badge}</span><span class="u-sr-only">${`${badge} new`}</span>` : null}
    </a>
  </li>`;
}

function Sidebar({ route }) {
  const shortName = useStore(selectShortName);
  const unread = useStore(selectUnread);
  return html`<aside class="db-sidebar" data-testid="sidebar">
    <nav class="db-sidebar__nav" aria-label="Main">
      <a class="db-sidebar__brand" href=${routeHref('today')}>
        <${BrandMark} size=${36} />
        <span class="db-sidebar__name">${shortName}</span>
      </a>
      <ul class="db-nav">
        ${SIDEBAR_MAIN.map((item) => html`<${SidebarItem} key=${item.id} item=${item} route=${route} badge=${item.id === 'messages' ? unread : 0} />`)}
      </ul>
      <${Button} variant="primary" block icon="plus" href=${routeHref('new')} class="db-sidebar__new" data-testid="nav-new-booking">New booking<//>
      <ul class="db-nav db-nav--low">
        ${SIDEBAR_LOW.map((item) => html`<${SidebarItem} key=${item.id} item=${item} route=${route} badge=${0} />`)}
      </ul>
    </nav>
  </aside>`;
}

function Fab() {
  return html`<a class="db-fab" href=${routeHref('new')} aria-label="New booking" data-testid="fab-new-booking">
    <${Icon} name="plus" size=${28} />
  </a>`;
}

// ---- View loader ----

const loaded = new Map();   // route name -> { mod, error? }
const loading = new Map();  // route name -> Promise

/** Import a view module (and its CSS). A failed import falls back to StubView so the shell always loads. */
function loadView(name) {
  if (loading.has(name)) return loading.get(name);
  const meta = ROUTES.find((r) => r.name === name);
  const task = (async () => {
    try {
      const mod = await import(meta.module);
      if (typeof mod.default !== 'function') throw new Error(`${meta.module} has no default export`);
      if (Array.isArray(mod.css)) await Promise.all(mod.css.map((href) => loadCss(href)));
      loaded.set(name, { mod });
    } catch (error) {
      console.warn(`View "${name}" did not load, showing the stub:`, error);
      const stub = await import('./views/stub.js');
      loaded.set(name, { mod: stub, error });
    } finally {
      loading.delete(name);
    }
  })();
  loading.set(name, task);
  return task;
}

/** Friendly card if a view throws while rendering. Keyed by route name so it resets on navigation. */
function Boundary({ children }) {
  const [error] = useErrorBoundary((err) => console.error('A dashboard view crashed:', err));
  if (error) {
    return html`<div class="db-page" data-testid="view-error">
      <${Card} tone="danger" class="db-stack">
        <p class="db-error__text">Something went wrong on this screen. Reload.</p>
        <div><${Button} variant="primary" onClick=${() => location.reload()}>Reload<//></div>
      <//>
    </div>`;
  }
  return children;
}

function ViewHost({ route }) {
  const [, rerender] = useReducer((n) => n + 1, 0);
  const shortName = useStore(selectShortName);
  const entry = loaded.get(route.name);
  const meta = ROUTES.find((r) => r.name === route.name) || ROUTES[0];

  useEffect(() => {
    if (loaded.has(route.name)) return undefined;
    let live = true;
    loadView(route.name).then(() => { if (live) rerender(); });
    return () => { live = false; };
  }, [route.name]);

  // Document title: "<screen> · <short name> dashboard" (the watcher adds the "(n) " prefix).
  const screenTitle = (entry && entry.mod && entry.mod.title) || meta.title;
  useEffect(() => { setBaseTitle(`${screenTitle} · ${shortName} dashboard`); }, [screenTitle, shortName]);

  // A new screen (or list <-> detail) starts at the top with focus on its title. Not done on first load,
  // and not when only a param changes inside the same screen (picking a day in Calendar must keep focus).
  const screenKey = `${route.name}|${isImmersive(route) ? 'detail' : 'list'}`;
  const lastKey = useRef(screenKey);
  const pending = useRef(false);
  if (lastKey.current !== screenKey) { lastKey.current = screenKey; pending.current = true; }
  useLayoutEffect(() => {
    if (entry && pending.current) {
      pending.current = false;
      window.scrollTo(0, 0);
      focusTitle();
    }
  });

  if (!entry) {
    return html`<div class="db-page" data-testid="view-loading"><${Skeleton} lines=${4} height=${20} /></div>`;
  }
  const View = entry.mod.default;
  return html`<${Boundary} key=${route.name}>${h(View, { route, error: entry.error })}<//>`;
}

// ---- Shell ----

/** The page: strip, sticky header, sidebar (1100+), content, tab bar (below 1100) and FAB. */
export function Shell() {
  const route = useRoute();
  const meta = ROUTES.find((r) => r.name === route.name) || ROUTES[0];
  const immersive = isImmersive(route);
  const showFab = !immersive && FAB_ROUTES.includes(route.name);
  // Strip, header and content are SIBLINGS under one page-tall container: a wrapper around strip + header would unstick the header.
  return html`<div class=${cx('db-shell', immersive && 'db-shell--immersive', showFab && 'db-shell--fab')}>
    <${PrototypeNotice} variant="strip" page="dashboard" />
    <${Header} />
    <${Sidebar} route=${route} />
    <main class="db-main" id="main">
      <${ViewHost} route=${route} />
      ${showFab ? html`<${Fab} />` : null}
    </main>
    ${immersive ? null : html`<${TabBar} activeTab=${meta.tab} />`}
  </div>`;
}
