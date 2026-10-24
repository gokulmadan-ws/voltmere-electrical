// js/dashboard/router.js: hash router (parseHash, routeHref, navigate, useRoute, goBack, isImmersive).
// Owner: WP2
import { useEffect, useState } from '../vendor/preact-htm.js';
import { ROUTES, DEFAULT_ROUTE } from './routes.js';

const TODAY = ROUTES.find((r) => r.name === 'today');

/** Split a pattern such as '/bookings/:id?' into segments: { name, param, optional }. */
function segmentsOf(pattern) {
  return pattern.split('/').filter(Boolean).map((s) => {
    const m = /^:(\w+)(\?)?$/.exec(s);
    return m ? { param: m[1], optional: !!m[2] } : { literal: s };
  });
}
const COMPILED = ROUTES.map((route) => ({ route, segments: segmentsOf(route.pattern) }));

const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

/** Match a path (no query) against the route table. Returns { route, params } or null. */
function match(path) {
  const parts = path.split('/').filter(Boolean).map(decode);
  for (const { route, segments } of COMPILED) {
    if (parts.length > segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segments.length && ok; i++) {
      const seg = segments[i];
      const part = parts[i];
      if (seg.literal !== undefined) { if (part !== seg.literal) ok = false; }
      else if (part === undefined) { if (!seg.optional) ok = false; }
      else params[seg.param] = part;
    }
    if (ok) return { route, params };
  }
  return null;
}

function parts(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const q = raw.indexOf('?');
  return { path: q === -1 ? raw : raw.slice(0, q), search: q === -1 ? '' : raw.slice(q + 1) };
}

/**
 * '#/bookings/bk_1?f=owed' -> { name: 'bookings', params: { id: 'bk_1' }, query: { f: 'owed' }, path: '/bookings/bk_1' }.
 * An unknown or empty hash gives the 'today' route.
 */
export function parseHash(hash) {
  const { path, search } = parts(hash);
  const hit = match(path);
  if (!hit) return { name: TODAY.name, params: {}, query: {}, path: TODAY.pattern };
  const query = {};
  new URLSearchParams(search).forEach((value, key) => { query[key] = value; });
  const cleanPath = '/' + path.split('/').filter(Boolean).join('/');
  return { name: hit.route.name, params: hit.params, query, path: cleanPath };
}

/** True when the hash names a real route (used to redirect everything else to the default). */
function isKnownHash(hash) {
  return !!match(parts(hash).path);
}

/** routeHref('bookings', { id }, { f: 'owed' }) -> '#/bookings/bk_1?f=owed'. Empty params and query are omitted. */
export function routeHref(name, params = {}, query = {}) {
  const route = ROUTES.find((r) => r.name === name) || TODAY;
  const path = segmentsOf(route.pattern)
    .map((s) => (s.literal !== undefined ? s.literal : (params[s.param] === undefined || params[s.param] === null || params[s.param] === '' ? null : encodeURIComponent(params[s.param]))))
    .filter((s) => s !== null)
    .join('/');
  const qs = new URLSearchParams();
  Object.keys(query || {}).forEach((k) => {
    const v = query[k];
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const tail = qs.toString();
  return '#/' + path + (tail ? '?' + tail : '');
}

// Router events: a replace does not fire hashchange, so components listen to this as well.
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
let sawInAppChange = false;
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => { sawInAppChange = true; notify(); });
  window.addEventListener('popstate', notify);
}

/** Go to a hash such as '#/today' without reloading. `replace` swaps the history entry instead of adding one. */
export function navigate(hash, { replace = false } = {}) {
  const target = String(hash).startsWith('#') ? String(hash) : '#' + hash;
  if (replace) {
    history.replaceState(null, '', location.pathname + location.search + target);
    notify();
  } else if (location.hash !== target) {
    location.hash = target; // fires hashchange
  } else {
    notify();
  }
}

/** Back one step when this page load has seen an in-app navigation; a deep link has nothing to go back to. */
export function goBack(fallbackHash = '#/today') {
  if (sawInAppChange) history.back();
  else navigate(fallbackHash, { replace: true });
}

/** Booking detail, customer detail and New booking hide the tab bar and show a back arrow. */
export function isImmersive(route) {
  if (!route) return false;
  return (route.name === 'bookings' && !!route.params.id)
    || (route.name === 'customers' && !!route.params.key)
    || route.name === 'new';
}

/** The current route. Re-renders on hashchange, popstate and in-app replaces. Unknown hashes are replaced with #/today. */
export function useRoute() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const sync = () => {
      if (!isKnownHash(location.hash) && location.hash !== '') {
        history.replaceState(null, '', location.pathname + location.search + DEFAULT_ROUTE);
      } else if (location.hash === '') {
        history.replaceState(null, '', location.pathname + location.search + DEFAULT_ROUTE);
      }
      setHash(location.hash);
    };
    listeners.add(sync);
    sync();
    return () => { listeners.delete(sync); };
  }, []);
  // Parsed per hash string; the object only changes when the hash does.
  return parseHashCached(hash);
}

let cacheKey = null;
let cacheValue = null;
function parseHashCached(hash) {
  if (hash !== cacheKey) { cacheKey = hash; cacheValue = parseHash(hash); }
  return cacheValue;
}
