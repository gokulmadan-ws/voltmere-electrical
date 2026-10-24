// js/dashboard/shell.js: the dashboard shell (strip, header, tab bar, sidebar, FAB) and the lazy view loader with page transitions.
// Owner: B3 (was WP2; brand lockup for 180 Electrical by role B2; V3 shell polish by B3)
import { html, h, useEffect, useErrorBoundary, useLayoutEffect, useReducer, useRef, useState } from '../vendor/preact-htm.js';
import {
  BrandMark, Button, Card, Icon, IconButton, PrototypeNotice, Skeleton, ThemeToggle,
  cx, focusTitle, loadCss, pageHref, pageTarget, useStore
} from '../ui/index.js';
import { selectBrand, selectNeedsYou, selectUnseenBookings, selectUnreadMessageCount } from '../core/selectors.js';
import { routeMeta } from './routes.js';
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

// Sidebar (1100px and up): route names and which route names light each item. `id` is the route name used for the link
// and for data-testid="nav-<id>".
const SIDEBAR_MAIN = [
  { id: 'today', label: 'Today', icon: 'zap', names: ['today'] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-days', names: ['calendar'] },
  { id: 'bookings', label: 'Bookings', icon: 'inbox', names: ['bookings'] },
  { id: 'pipeline', label: 'Pipeline', icon: 'list-checks', names: ['pipeline'] },
  { id: 'quotes', label: 'Quotes', icon: 'file-text', names: ['quotes', 'quote-detail'] },
  { id: 'customers', label: 'Customers', icon: 'users', names: ['customers'] },
  { id: 'insights', label: 'Insights', icon: 'pound-sterling', names: ['insights'] },
  { id: 'messages', label: 'Messages', icon: 'message-circle', names: ['messages'] }
];
const SIDEBAR_BUSINESS = [
  { id: 'connections', label: 'Connections', icon: 'plug-zap', names: ['connections', 'connections-domain', 'connections-webhook', 'connections-tracking', 'connections-whatsapp', 'connections-calendar', 'connections-email'] },
  { id: 'share', label: 'Share and promote', icon: 'share-2', names: ['share'] },
  { id: 'more', label: 'More', icon: 'ellipsis', names: ['more', 'settings'] }
];
const SIDEBAR_LOW = [
  { id: 'demo', label: 'Demo tools', icon: 'gauge', names: ['demo'] },
  { id: 'about', label: "What's real", icon: 'shield-check', names: ['about'] }
];

const FAB_ROUTES = ['today', 'calendar', 'bookings'];

const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
};

// ---- Header ----

/** True once the page has scrolled a little: the header then gets its hairline and shadow. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => { frame = 0; setScrolled(window.scrollY > 4); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    window.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => { window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return scrolled;
}

function Header() {
  const shortName = useStore(selectShortName);
  const unread = useStore(selectUnread);
  const scrolled = useScrolled();
  return html`<header class=${cx('db-header', scrolled && 'is-scrolled')} data-testid="db-header">
    <div class="db-header__inner">
      <a class="db-header__brand" href=${routeHref('today')} aria-label=${`${shortName} dashboard, go to Today`}>
        <${BrandMark} size=${36} />
        <span class="db-brand__text">
          <span class="db-header__name">${shortName}</span>
          <span class="db-brand__sub">Owner dashboard</span>
        </span>
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
  const active = TABS.findIndex((t) => t.id === activeTab);
  // Tapping the tab you are already on scrolls to the top (and does not add a history entry).
  const onTab = (href, isActive) => (e) => {
    if (isActive && location.hash === href) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  };
  return html`<nav class="db-tabbar" aria-label="Main" data-testid="tabbar">
    <div class="db-tabbar__track" style=${{ '--tab-i': Math.max(active, 0) }}>
      <span class=${cx('db-tabbar__indicator', active < 0 && 'is-hidden')} aria-hidden="true" data-testid="tabbar-indicator"></span>
      <ul class="db-tabbar__list">
        ${TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const href = routeHref(tab.id);
          return html`<li class="db-tabbar__item" key=${tab.id}>
            <a class=${cx('db-tab', isActive && 'is-active')} href=${href} onClick=${onTab(href, isActive)} aria-current=${isActive ? 'page' : undefined} data-testid=${`tab-${tab.id}`}>
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
    </div>
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
        <${BrandMark} size=${38} />
        <span class="db-brand__text">
          <span class="db-sidebar__name">${shortName}</span>
          <span class="db-brand__sub">Owner dashboard</span>
        </span>
      </a>
      <${Button} variant="primary" block icon="plus" href=${routeHref('new')} class="db-sidebar__new" data-testid="nav-new-booking">New booking<//>
      <ul class="db-nav">
        ${SIDEBAR_MAIN.map((item) => html`<${SidebarItem} key=${item.id} item=${item} route=${route} badge=${item.id === 'messages' ? unread : 0} />`)}
      </ul>
      <p class="db-nav__heading" id="db-nav-business">Business</p>
      <ul class="db-nav" aria-labelledby="db-nav-business">
        ${SIDEBAR_BUSINESS.map((item) => html`<${SidebarItem} key=${item.id} item=${item} route=${route} badge=${0} />`)}
      </ul>
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

/** Import a view module (and its CSS). A missing or broken view falls back to StubView, so every route always opens. */
function loadView(name) {
  if (loading.has(name)) return loading.get(name);
  const meta = routeMeta(name);
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

/** What shows while a view's module and stylesheet load: a title, a subtitle and three card placeholders. */
function ViewSkeleton() {
  return html`<div class="db-page db-skel" data-testid="view-loading" aria-busy="true">
    <${Skeleton} lines=${1} height=${30} class="db-skel__title" />
    <${Skeleton} lines=${1} height=${14} class="db-skel__sub" />
    <div class="db-stack db-skel__cards">
      <${Skeleton} variant="card" />
      <${Skeleton} variant="card" />
      <${Skeleton} variant="card" />
    </div>
  </div>`;
}

const isNarrow = () => {
  try { return window.matchMedia('(max-width: 1099px)').matches; } catch (e) { return true; }
};

/**
 * Wrapper that plays the page transition. It is keyed by route name, so it re-mounts (and rises in) when the SCREEN changes.
 * Inside one screen, list <-> detail on a phone lifts in or settles back; from 1100px (master-detail) nothing replays.
 * Reduced motion is handled by the global rule in base.css.
 */
function ViewFrame({ immersive, children }) {
  const ref = useRef(null);
  if (ref.current === null) ref.current = { immersive, variant: immersive ? 'push' : 'rise' };
  const st = ref.current;
  if (st.immersive !== immersive) {
    st.immersive = immersive;
    if (isNarrow()) st.variant = immersive ? 'push' : 'back';
  }
  return html`<div class=${cx('db-view', `db-view--${st.variant}`)} data-testid="db-view">${children}</div>`;
}

function ViewHost({ route }) {
  const [, rerender] = useReducer((n) => n + 1, 0);
  const shortName = useStore(selectShortName);
  const entry = loaded.get(route.name);
  const meta = routeMeta(route.name);
  const immersive = isImmersive(route);

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
  const screenKey = `${route.name}|${immersive ? 'detail' : 'list'}`;
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

  if (!entry) return html`<${ViewSkeleton} />`;
  const View = entry.mod.default;
  return html`<${ViewFrame} key=${route.name} immersive=${immersive}>
    <${Boundary}>${h(View, { route, error: entry.error })}<//>
  <//>`;
}

// ---- Shell ----

/** The page: strip, sticky header, sidebar (1100+), content, tab bar (below 1100) and FAB. */
export function Shell() {
  const route = useRoute();
  const meta = routeMeta(route.name);
  const immersive = isImmersive(route);
  const showFab = !immersive && FAB_ROUTES.includes(route.name);
  const nav = immersive ? 'immersive' : (showFab ? 'fab' : 'tabs');
  // CSS hook: where toasts and sticky bars sit depends on what is at the bottom of the screen (dashboard.css).
  useLayoutEffect(() => { document.documentElement.dataset.dbNav = nav; }, [nav]);
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
