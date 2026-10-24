// js/booking/nav.js: booking hash helpers, the route emitter that drives the booking sheet (11.1), and the quote funnel's history steps.
// Owner: WP3, funnel history steps by D3
import { useEffect, useState } from '../vendor/preact-htm.js';
import { prefillFunnelPostcode } from './draft.js';

// Customer bookable services (the emergency path has its own hash). An unknown id falls back to '#book' (11.1).
// 'ev_quote' is the website enquiry: the 6-step quote funnel. The others open the classic When / Details flow.
const SERVICE_IDS = ['ev_quote', 'fault', 'eicr', 'consumer', 'sockets', 'ev', 'rewire'];
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

/** opts: { serviceId, date, windowId } | { emergency: true } | { bookedRef } | { manageRef } | {} -> '#book/fault/2026-10-24/0' (a postcode in opts is ignored here) */
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

// ---- funnel history ---------------------------------------------------------------------------------------------
// Each step of the quote funnel is its own history entry (same URL, history.state = { bkStep: n }), so the phone's Back
// button and swipe-back go to the previous step instead of throwing the customer out of the funnel. The step number lives in
// history.state, which survives a refresh, so the number of entries above the one that opened the sheet is always bkStep - 1.
// Closing or finishing unwinds exactly those entries first, so Back never lands on a half-finished step afterwards.

const isFunnelOpts = (o) => !o.bookedRef && !o.manageRef && !o.emergency;
const here = () => location.pathname + location.search + location.hash;

/** The funnel step stored in the current history entry (1 to 6), or 0 when this entry is not a funnel step. */
export function funnelHistoryStep() {
  if (!hasWindow) return 0;
  const s = history.state;
  return s && Number.isInteger(s.bkStep) && s.bkStep >= 1 ? s.bkStep : 0;
}

let unwinding = false;

/** True while the history is being unwound by closeBooking / finishFunnel: the sheet ignores popstate for that time. */
export function isUnwinding() {
  return unwinding;
}

/** history.go(-n), then `then()` once the browser has landed (popstate), or after a safety timeout (no history to walk). */
function unwind(n, then) {
  let finished = false;
  let timer = null;
  const onPop = () => done();
  function done() {
    if (finished) return;
    finished = true;
    window.removeEventListener('popstate', onPop);
    clearTimeout(timer);
    unwinding = false;
    then();
  }
  unwinding = true;
  window.addEventListener('popstate', onPop);
  timer = setTimeout(done, 700);
  history.go(-n);
}

/** A forward step: a new history entry, same URL. */
export function pushFunnelStep(n) {
  if (!hasWindow) return;
  history.pushState({ bkStep: n }, '', here());
}

/** Keep the current entry but record its step (used when there is no earlier funnel entry to go back to). */
export function replaceFunnelStep(n) {
  if (!hasWindow) return;
  history.replaceState({ bkStep: n }, '', here());
}

/** A step back through the history when this many funnel entries exist below the current one; false when the caller must do it in place. */
export function backFunnelSteps(k = 1) {
  if (!hasWindow || funnelHistoryStep() - 1 < k) return false;
  history.go(-k);
  return true;
}

/** Make the history match the step on screen (a refresh, a deep link with a saved draft, a restart): rebuild entries 1..step. */
export function syncFunnelHistory(step) {
  if (!hasWindow || funnelHistoryStep() === step) return;
  history.replaceState({ bkStep: 1 }, '', here());
  for (let i = 2; i <= step; i += 1) history.pushState({ bkStep: i }, '', here());
}

/** Leave the funnel for the confirmation: collapse the step entries, then show the new route in the same entry. `after` runs once it has. */
export function finishFunnel(opts, after) {
  if (!hasWindow) { if (after) after(); return; }
  const above = Math.max(0, funnelHistoryStep() - 1);
  const land = () => {
    history.replaceState(null, '', bookHref(opts));
    sync('replace');
    if (after) after();
  };
  if (above > 0) unwind(above, land); else land();
}

/** Opens the sheet from outside it: ONE pushState (11.1). Inside an open sheet it just replaces.
 *  opts.postcode (optional) is carried into Step 1 of the quote funnel. */
export function openBooking(opts = {}) {
  if (!hasWindow) return;
  if (opts && opts.postcode) prefillFunnelPostcode(opts.postcode);
  if (lastRoute) { goBooking(opts); return; }
  history.pushState(isFunnelOpts(opts) ? { bkStep: 1 } : null, '', bookHref(opts));
  sync('push');
}

/** Every in-sheet route change outside the funnel steps: replaceState, never push, so Back and X both close the sheet in one step. */
export function goBooking(opts = {}) {
  if (!hasWindow) return;
  history.replaceState(isFunnelOpts(opts) ? { bkStep: 1 } : null, '', bookHref(opts));
  sync('replace');
}

/** Close the sheet. Unwinds the funnel's step entries and the entry that opened the sheet (one history.go), else strips the hash in place.
 *  A second call while closing is ignored. */
export function closeBooking() {
  if (!hasWindow || closing) return;
  if (!currentRoute()) return;
  closing = true;
  const above = Math.max(0, funnelHistoryStep() - 1); // funnel entries stacked on the entry that opened the sheet
  const strip = () => {
    if (parseBookHash(readHash())) { history.replaceState(null, '', location.pathname + location.search); sync('replace'); }
    closing = false;
  };
  if (openedByApp) unwind(above + 1, strip); // strip is the safety net: if Back did not clear the route (no earlier entry), we do
  else if (above > 0) unwind(above, strip);
  else strip();
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
