// js/dashboard/views/bookings.js: Bookings inbox (search, filters, grouped list) and the master-detail layout from 1100px.
// Owner: WP5
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import {
  Button, EmptyState, Icon, Input, PageHeader, Segmented, StatusPill, TextLink, cx, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { markAllSeen } from '../../core/store.js';
import { selectUpcoming, selectOwed, selectNeedsYou, customerKeyOf } from '../../core/selectors.js';
import { bookingWindowIds, bookingWindowLabel } from '../../core/availability.js';
import { fmtRelativeDay, stampDay, toStamp } from '../../core/dates.js';
import { todayKey } from '../../core/clock.js';
import { gbp, outwardCode } from '../../core/format.js';
import { navigate, routeHref } from '../router.js';
import { BookingDetail } from './booking-detail.js';

export const title = 'Bookings';
export const css = ['css/bookings.css'];

// CROSS-PKG: the shell scrolls to the top when a list route becomes a detail route (isImmersive flips), so the very
// first row tapped at 1100px+ resets the list scroll once; moving between details afterwards keeps it (13.5).

const selectAll = (state) => state;

const FILTERS = [
  { id: 'new', label: 'Needs you' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'owed', label: 'To collect' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' }
];
const FILTER_IDS = FILTERS.map((f) => f.id);

// ---------- pure helpers ----------

/** Case-insensitive match over name, phone digits, postcode, ref, service and address line (13.5). Spaces are ignored in phone and postcode. */
function matches(b, rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const compact = q.replace(/[\s-]+/g, '');
  const digits = q.replace(/\D/g, '');
  const looksNumeric = /^[\d\s+()-]+$/.test(q);
  const hay = (s) => String(s || '').toLowerCase();
  if (hay(b.customer.name).includes(q)) return true;
  if (looksNumeric && digits.length >= 2) {
    const own = b.customer.phone.replace(/\D/g, '');
    if (own.includes(digits) || customerKeyOf(b.customer.phone).includes(digits)) return true;
  }
  if (compact.length >= 2 && hay(b.address.postcode).replace(/\s+/g, '').includes(compact)) return true;
  if (hay(b.ref).includes(q) || hay(b.ref).replace('-', '').includes(compact)) return true;
  if (hay(b.serviceName).includes(q) || hay(b.variantLabel).includes(q)) return true;
  return hay(b.address.line1).includes(q);
}

function listFor(state, filter, nowStampStr) {
  const all = state.bookings;
  switch (filter) {
    case 'new': return selectNeedsYou(state);
    case 'upcoming': return selectUpcoming(state, nowStampStr);
    case 'owed': return selectOwed(state);
    case 'done': return all.filter((b) => b.status === 'done');
    case 'cancelled': return all.filter((b) => b.status === 'cancelled');
    default: return all.slice();
  }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isAsap = (b) => b.urgent && b.status !== 'done' && b.status !== 'cancelled';

/** Urgent live requests first under "ASAP", then days with plain headings. new / upcoming run soonest first, the rest newest first. */
function groupBookings(list, soonestFirst, today) {
  const dir = soonestFirst ? 1 : -1;
  const sorted = list.slice().sort((a, b) => dir * (cmp(a.start, b.start) || cmp(a.createdAt, b.createdAt)));
  const groups = [];
  const asap = sorted.filter(isAsap);
  if (asap.length) groups.push({ key: 'asap', heading: 'ASAP', items: asap });
  sorted.filter((b) => !isAsap(b)).forEach((b) => {
    const day = stampDay(b.start);
    const last = groups[groups.length - 1];
    if (last && last.key === day) last.items.push(b);
    else groups.push({ key: day, heading: fmtRelativeDay(day, today), items: [b] });
  });
  return groups;
}

function emptyFor(filter, query) {
  if (query) return { title: `No bookings match "${query}".` };
  switch (filter) {
    case 'new': return { title: 'Nothing needs you. Nice.' };
    case 'upcoming': return { title: 'No upcoming bookings.', body: html`<${TextLink} href=${routeHref('today')} inline>Share your booking link<//>.` };
    case 'owed': return { title: 'Nothing to collect. Nice.' };
    case 'done': return { title: 'No finished jobs yet.' };
    case 'cancelled': return { title: 'No cancelled bookings. Nice.' };
    default: return { title: 'No bookings yet.' };
  }
}

// ---------- rows ----------

function Row({ b, selected, linkQuery }) {
  const ids = bookingWindowIds(b);
  const urgent = b.urgent;
  const half = ids.length === 2;
  const timeMain = urgent ? 'ASAP' : half ? bookingWindowLabel(b).replace(/^(Morning|Afternoon) · arrive /, '') : bookingWindowLabel(b);
  const timeSub = urgent ? '' : half ? (ids[0] === 0 ? 'Morning' : 'Afternoon') : '';
  const price = b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice;
  const outward = outwardCode(b.address.postcode);
  const unseen = !b.seenByOwner;
  const service = b.variantLabel ? `${b.serviceName} (${b.variantLabel})` : b.serviceName;
  return html`<li class="bl-list__li">
    <a class=${cx('bl-row', unseen && 'is-unseen', selected && 'is-selected', b.status === 'cancelled' && 'is-cancelled')}
      href=${routeHref('bookings', { id: b.id }, linkQuery)} aria-current=${selected ? 'page' : undefined} data-testid=${`booking-row-${b.id}`}>
      <span class="bl-row__time">
        <span class="bl-row__time-main">${timeMain}</span>
        ${timeSub ? html`<span class="bl-row__time-sub">${timeSub}</span>` : null}
      </span>
      <span class="bl-row__main">
        <span class="bl-row__name">${unseen ? html`<span class="bl-dot" aria-hidden="true"></span><span class="u-sr-only">New, unseen. </span>` : null}${b.customer.name}</span>
        <span class="bl-row__svc">${service}${outward ? ` · ${outward}` : ''}</span>
      </span>
      <span class="bl-row__side">
        <span class="bl-row__price">${gbp(price)}</span>
        <${StatusPill} status=${b.status} paid=${b.paid} urgent=${urgent} compact />
      </span>
    </a>
  </li>`;
}

// ---------- view ----------

export default function BookingsView({ route }) {
  const state = useStore(selectAll);
  const nowDate = useNow(30000);
  const wide = useMediaQuery('(min-width: 1100px)');
  const controlsRef = useRef(null);

  const id = route.params.id || '';
  const f = FILTER_IDS.includes(route.query.f) ? route.query.f : 'upcoming';
  const urlQ = route.query.q || '';
  const [q, setQ] = useState(urlQ);
  useEffect(() => { setQ(urlQ); }, [urlQ]); // an outside link (#/bookings?q=...) wins over what was typed
  const query = q.trim();

  const nowStampStr = toStamp(nowDate);
  const today = todayKey();
  const hasUnseen = state.bookings.some((b) => !b.seenByOwner);

  const counts = {
    new: selectNeedsYou(state).length,
    upcoming: selectUpcoming(state, nowStampStr).length,
    owed: selectOwed(state).length,
    done: state.bookings.filter((b) => b.status === 'done').length,
    cancelled: state.bookings.filter((b) => b.status === 'cancelled').length,
    all: state.bookings.length
  };

  // A non-empty search looks at EVERYTHING, whatever filter is selected.
  const base = query ? state.bookings.filter((b) => matches(b, query)) : listFor(state, f, nowStampStr);
  const groups = groupBookings(base, !query && (f === 'new' || f === 'upcoming'), today);

  // Filter and search live in the hash (replace, so Back does not step through every keystroke).
  const go = (next) => navigate(routeHref('bookings', id ? { id } : {}, { f: next.f === 'upcoming' ? '' : next.f, q: next.q }), { replace: true });
  const linkQuery = { f: f === 'upcoming' ? '' : f, q: query };
  const onSearch = (e) => { setQ(e.target.value); go({ f, q: e.target.value.trim() }); };
  const onFilter = (value) => go({ f: value, q: query });

  // Bring the selected filter into view on mount and whenever the list pane comes back on screen.
  useEffect(() => {
    if (id && !wide) return;
    const wrap = controlsRef.current && controlsRef.current.querySelector('.bl-filters');
    const el = wrap && wrap.querySelector('[aria-checked="true"]');
    if (!wrap || !el) return;
    // Least movement that shows the selected option in full (the kit's own mount code centres it, which clips its neighbours).
    wrap.scrollLeft = 0;
    const right = el.offsetLeft + el.offsetWidth;
    if (right > wrap.clientWidth) wrap.scrollLeft = right - wrap.clientWidth + 12;
  }, [id, wide]);

  const showListHeader = !id || wide;
  const empty = emptyFor(f, query);
  const filterOptions = FILTERS.map((o) => ({
    value: o.id,
    testid: `filter-${o.id}`,
    label: html`${o.label} <span class="bl-count">${counts[o.id]}</span>`
  }));

  return html`<div class=${cx('db-page', 'bl-page', id && 'bl-page--detail')}>
    ${showListHeader ? html`<${PageHeader} title="Bookings"
      actions=${hasUnseen ? html`<${Button} variant="ghost" size="sm" onClick=${() => markAllSeen()} data-testid="bookings-mark-all-seen">Mark all seen<//>` : null} />` : null}
    <div class=${cx('db-master-detail', id && 'db-master-detail--has-detail')}>
      <div class="db-master-detail__list bl-pane">
        <div class="bl-toggle">
          <${Segmented} ariaLabel="Bookings or customers" value="bookings" data-testid="bookings-view-toggle"
            options=${[
              { value: 'bookings', label: 'Bookings', testid: 'bookings-view-bookings' },
              { value: 'customers', label: 'Customers', testid: 'bookings-view-customers' }
            ]}
            onChange=${(v) => { if (v === 'customers') navigate('#/customers'); }} />
        </div>
        <div class="bl-controls" ref=${controlsRef}>
          <div class="bl-search">
            <${Icon} name="search" size=${20} class="bl-search__icon" />
            <${Input} id="bookings-search" type="search" value=${q} onInput=${onSearch} placeholder="Name, phone, postcode or ref"
              aria-label="Search bookings" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="none"
              spellcheck=${false} class="bl-search__input" data-testid="bookings-search" />
          </div>
          <${Segmented} class="bl-filters" ariaLabel="Filter bookings" options=${filterOptions} value=${f} onChange=${onFilter} />
          <p class="bl-searching" role="status">${query ? 'Searching all bookings' : ''}</p>
        </div>

        <div class="bl-listwrap" data-testid="bookings-list">
          ${groups.length === 0
            ? html`<${EmptyState} icon="inbox" title=${empty.title} body=${empty.body} data-testid="bookings-empty" />`
            : groups.map((g) => html`<section class="bl-group" key=${g.key}>
              <h2 class="bl-group__title">${g.heading}</h2>
              <ul class="bl-list">
                ${g.items.map((b) => html`<${Row} key=${b.id} b=${b} selected=${b.id === id} linkQuery=${linkQuery} />`)}
              </ul>
            </section>`)}
        </div>
      </div>
      <div class="db-master-detail__detail bl-pane">
        ${id
          ? html`<${BookingDetail} id=${id} embedded=${wide} backHref=${routeHref('bookings', {}, linkQuery)} />`
          : html`<${EmptyState} icon="inbox" title="Select a booking" body="Its details and actions show here." class="bl-detail-empty" />`}
      </div>
    </div>
  </div>`;
}
