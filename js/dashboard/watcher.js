// js/dashboard/watcher.js: new-booking announcements (toasts) and the "(n)" document title prefix.
// Owner: B3 (was WP2; wording for quote-led enquiries by role B2; richer non-blocking toast by B3)
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

// A website enquiry for the free survey and quote (service "ev_quote") is an enquiry, not a booking.
const isEnquiry = (b) => b && b.serviceId === 'ev_quote';

// Where the lead came from (booking.utm, set by the landing page from the ad link; ids and labels as in the core's LEAD_SOURCES).
// Unknown or "other" sources are not guessed at: the toast just leaves the source out.
const SOURCE_LABEL = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', referral: 'Word of mouth', phone: 'Phone' };
const sourceOf = (b) => {
  const utm = b && b.utm;
  if (!utm || typeof utm.source !== 'string') return '';
  if (utm.medium === 'webhook') return 'Website form (test)';
  return SOURCE_LABEL[utm.source.toLowerCase()] || '';
};

/** The reply promise from Settings (24 hours by default), when the core has one. */
function replyPromise() {
  try {
    const sla = getState().settings.sla;
    const hours = sla && Number(sla.replyHours);
    return hours > 0 ? `Reply within ${hours} hours` : '';
  } catch (e) {
    return '';
  }
}

function announceSummary(list) {
  const n = list.length;
  const word = list.every(isEnquiry) ? 'enquir' : 'booking';
  const noun = word === 'booking' ? (n === 1 ? 'booking' : 'bookings') : (n === 1 ? 'enquiry' : 'enquiries');
  toast({
    message: `${n} new ${noun} since you last looked`,
    icon: 'inbox',
    actionLabel: 'View',
    duration: 8000,
    onAction: n === 1 ? viewBooking(list[0].id) : () => navigate(routeHref('bookings', {}, { f: 'new' }))
  });
}

function announceArrival(booking) {
  const name = firstName((booking.customer && booking.customer.name) || '') || 'a customer';
  if (booking.urgent) {
    toast({ message: `URGENT request: ${name}`, icon: 'siren', tone: 'danger', actionLabel: 'View', onAction: viewBooking(booking.id) });
    return;
  }
  if (isEnquiry(booking)) {
    const postcode = (booking.address && booking.address.postcode) || '';
    const detail = [sourceOf(booking), replyPromise()].filter(Boolean).join(' · ');
    toast({
      message: postcode ? `New enquiry: ${name}, ${postcode}` : `New enquiry: ${name}`,
      detail: detail || undefined, icon: 'bell-ring', duration: 9000,
      actionLabel: 'View', onAction: viewBooking(booking.id)
    });
    return;
  }
  let when = '';
  try { when = bookingWhen(booking); } catch (e) { /* keep the toast even if the time cannot be described */ }
  toast({ message: when ? `New booking: ${name}, ${when}` : `New booking: ${name}`, icon: 'calendar-check', actionLabel: 'View', onAction: viewBooking(booking.id) });
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
