// js/dashboard/watcher.js: new-booking announcements (toasts) and the "(n)" document title prefix.
// Owner: WP2
import { useEffect, useRef } from '../vendor/preact-htm.js';
import { getState } from '../core/store.js';
import { selectUnseenBookings } from '../core/selectors.js';
import { firstName } from '../core/format.js';
import { bookingWhen } from '../core/availability.js';
import { toast, useStore } from '../ui/index.js';
import { navigate, routeHref } from './router.js';

// The shell owns the page title text and the watcher owns the "(n) " prefix, so both go through here
// and never overwrite each other.
let baseTitle = 'Dashboard';
let unseenCount = 0;

function applyTitle() {
  document.title = (unseenCount > 0 ? `(${unseenCount}) ` : '') + baseTitle;
}

/** Called by the shell whenever the screen or the business name changes. */
export function setBaseTitle(title) {
  baseTitle = title;
  applyTitle();
}

const selectUnseenKey = (state) => selectUnseenBookings(state).map((b) => b.id).join(',');

const viewBooking = (id) => () => navigate(routeHref('bookings', { id }));

function announceSummary(list) {
  const n = list.length;
  toast({
    message: n === 1 ? '1 new booking since you last looked' : `${n} new bookings since you last looked`,
    actionLabel: 'View',
    duration: 8000,
    onAction: n === 1 ? viewBooking(list[0].id) : () => navigate(routeHref('bookings', {}, { f: 'new' }))
  });
}

function announceArrival(booking) {
  const name = firstName((booking.customer && booking.customer.name) || '') || 'a customer';
  if (booking.urgent) {
    toast({ message: `URGENT request: ${name}`, tone: 'danger', actionLabel: 'View', onAction: viewBooking(booking.id) });
    return;
  }
  let when = '';
  try { when = bookingWhen(booking); } catch (e) { /* keep the toast even if the time cannot be described */ }
  toast({ message: when ? `New booking: ${name}, ${when}` : `New booking: ${name}`, actionLabel: 'View', onAction: viewBooking(booking.id) });
}

/**
 * Renders nothing. On mount: one summary toast when unseen bookings exist. Later: one toast per newly
 * arrived unseen booking (a booking is announced once per page session). No sound, no vibration (WON'T).
 */
export function Watcher() {
  const key = useStore(selectUnseenKey);
  const announcedRef = useRef(null);
  if (!announcedRef.current) announcedRef.current = new Set();
  const firstRun = useRef(true);

  useEffect(() => {
    const announced = announcedRef.current;
    const unseen = selectUnseenBookings(getState()); // newest first
    unseenCount = unseen.length;
    applyTitle();
    if (firstRun.current) {
      firstRun.current = false;
      unseen.forEach((b) => announced.add(b.id));
      if (unseen.length >= 1) announceSummary(unseen);
      return;
    }
    const fresh = unseen.filter((b) => !announced.has(b.id)).reverse(); // oldest first
    fresh.forEach((b) => announced.add(b.id));
    // Two toasts fit on screen; a burst (for example after a long background tab) gets one summary instead.
    if (fresh.length > 2) announceSummary(fresh);
    else fresh.forEach(announceArrival);
  }, [key]);

  return null;
}
