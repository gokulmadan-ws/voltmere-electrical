// js/booking/nav.js: booking hash helpers and the tiny route emitter that drives the booking sheet (11.1).
// Owner: WP3
import { useEffect, useState } from '../vendor/preact-htm.js';

// Customer bookable services (the emergency path has its own hash). An unknown id falls back to '#book' (11.1).
const SERVICE_IDS = ['fault', 'eicr', 'consumer', 'sockets', 'ev', 'rewire'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const hasWindow = typeof window !== 'undefined' && typeof history !== 'undefined';

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

function readHash() {
  return hasWindow ? location.hash : '';
}

/** null | { kind:'book', serviceId?, date?, windowId?, emergency? } | { kind:'booked', ref } | { kind:'manage', ref } */
export function parseBookHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  const parts = raw.split('/').map(safeDecode);
  const head = parts[0];
  if (head === 'booked' || head === 'manage') {
    const ref = (parts[1] || '').trim();
    return ref ? { kind: head, ref } : null;
  }
  if (head !== 'book') return null;
  const route = { kind: 'book' };
  if (parts[1] === 'emergency') { route.emergency = true; return route; }
  if (!SERVICE_IDS.includes(parts[1])) return route; // '#book' and unknown ids: Step 0
  route.serviceId = parts[1];
  // A malformed date or window is dropped (the When step opens); a stale but well-formed one is kept and checked by the sheet.
  if (DAY_RE.test(parts[2] || '') && /^[0-3]$/.test(parts[3] || '')) {
    route.date = parts[2];
    route.windowId = Number(parts[3]);
  }
  return route;
}

/** opts: { serviceId, date, windowId } | { emergency: true } | { bookedRef } | { manageRef } | {} -> '#book/fault/2026-10-24/0' */
export function bookHref(opts = {}) {
  if (opts.bookedRef) return `#booked/${encodeURIComponent(opts.bookedRef)}`;
  if (opts.manageRef) return `#manage/${encodeURIComponent(opts.manageRef)}`;
  if (opts.emergency) return '#book/emergency';
  if (!opts.serviceId) return '#book';
  let href = `#book/${opts.serviceId}`;
  if (opts.date && opts.windowId !== undefined && opts.windowId !== null) href += `/${opts.date}/${opts.windowId}`;
  return href;
}

// ---- route emitter ----------------------------------------------------------------------------------------------
// replaceState fires no hashchange, so every navigation goes through here and notifies subscribers itself.

const sameRoute = (a, b) => (a ? bookHref(routeOpts(a)) : '') === (b ? bookHref(routeOpts(b)) : '');

function routeOpts(r) {
  if (r.kind === 'booked') return { bookedRef: r.ref };
  if (r.kind === 'manage') return { manageRef: r.ref };
  return { serviceId: r.serviceId, date: r.date, windowId: r.windowId, emergency: r.emergency };
}

const listeners = new Set();
let lastRoute = parseBookHash(readHash());
let openedByApp = false; // true when the route went from none to a sheet route through a push (or a plain link)
let closing = false;

function sync(source) {
  const next = parseBookHash(readHash());
  if (sameRoute(next, lastRoute)) return;
  if (!lastRoute && next) openedByApp = true;
  if (!next) { openedByApp = false; closing = false; }
  lastRoute = next;
  listeners.forEach((fn) => fn(next, source));
}

if (hasWindow) {
  window.addEventListener('hashchange', () => sync('hashchange'));
  window.addEventListener('popstate', () => sync('popstate'));
}

function currentRoute() {
  const next = parseBookHash(readHash());
  return sameRoute(next, lastRoute) ? lastRoute : next;
}

/** Opens the sheet from outside it: ONE pushState (11.1). Inside an open sheet it just replaces. */
export function openBooking(opts = {}) {
  if (!hasWindow) return;
  if (lastRoute) { goBooking(opts); return; }
  history.pushState(null, '', bookHref(opts));
  sync('push');
}

/** Every in-sheet step: replaceState, never push, so Back and X both close the sheet in one step. */
export function goBooking(opts = {}) {
  if (!hasWindow) return;
  history.replaceState(null, '', bookHref(opts));
  sync('replace');
}

/** history.back() when the app pushed the entry, else strip the hash in place. A second call while closing is ignored. */
export function closeBooking() {
  if (!hasWindow || closing) return;
  if (!currentRoute()) return;
  closing = true;
  if (openedByApp) {
    history.back();
    // Safety net: if Back did not clear the route (no earlier entry), strip the hash ourselves.
    setTimeout(() => {
      if (parseBookHash(readHash())) { history.replaceState(null, '', location.pathname + location.search); sync('replace'); }
      closing = false;
    }, 400);
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    sync('replace');
    closing = false;
  }
}

/** Hook: the parsed booking route, live (emitter, hashchange and popstate). */
export function useBookRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const fn = (next) => setRoute(next);
    listeners.add(fn);
    setRoute(currentRoute()); // a change between render and effect
    return () => { listeners.delete(fn); };
  }, []);
  return route;
}
