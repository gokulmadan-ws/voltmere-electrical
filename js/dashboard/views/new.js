// js/dashboard/views/new.js: New booking route, wraps BookingSheet in owner mode as an inline page.
// Owner: WP6
import { html, useMemo } from '../../vendor/preact-htm.js';
import { PageHeader } from '../../ui/index.js';
import { BookingSheet } from '../../booking/booking-sheet.js';
import { isDayKey } from '../../core/dates.js';
import { goBack, navigate, routeHref } from '../router.js';

export const title = 'New booking';
// CONTRACT-GAP: 13.8 lists only css/booking.css; css/calendar.css is added for the small page wrapper (cal-newpage).
export const css = ['css/booking.css', 'css/calendar.css'];

// The owner can only enter bookings that came in some other way than the website form.
const OWNER_SOURCES = ['phone', 'whatsapp', 'referral'];

/** Query -> BookingSheet intent (11.5). Anything missing or malformed is simply left out. */
function intentFrom(query) {
  const intent = {};
  if (query.service) intent.serviceId = query.service;
  if (isDayKey(query.date)) intent.date = query.date;
  if (/^[0-3]$/.test(String(query.window))) intent.windowId = Number(query.window);
  if (query.customer) intent.customerKey = query.customer;
  if (OWNER_SOURCES.includes(query.source)) intent.source = query.source;
  return intent;
}

export default function NewBookingView({ route }) {
  const q = (route && route.query) || {};
  // One stable object per distinct query, so BookingSheet does not see a "new" intent on every render.
  const intent = useMemo(() => intentFrom(q), [q.service, q.date, q.window, q.customer, q.source]);
  const back = () => goBack('#/today');
  const onBooked = (booking) => navigate(routeHref('bookings', { id: booking.id }), { replace: true });
  return html`<div class="db-page cal-newpage">
    <${PageHeader} title="New booking"
      back=${{ href: '#/today', label: 'Back', onClick: (e) => { if (e && e.preventDefault) e.preventDefault(); back(); } }} />
    <${BookingSheet} mode="owner" presentation="page" intent=${intent} onClose=${back} onBooked=${onBooked} />
  </div>`;
}
