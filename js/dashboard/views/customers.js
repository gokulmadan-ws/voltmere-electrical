// js/dashboard/views/customers.js: Customers list and detail, derived from bookings by phone number (never stored).
// Owner: WP7
import { html, useMemo, useState } from '../../vendor/preact-htm.js';
import {
  Avatar, Button, Card, Chip, EmptyState, Icon, Input, PageHeader, Segmented, Stat, StatusPill,
  cx, useBrand, useStore
} from '../../ui/index.js';
import { selectCustomers, selectCustomerByKey, selectBookingById } from '../../core/selectors.js';
import { fmtDayShort, stampDay } from '../../core/dates.js';
import { firstName, gbp, outwardCode, plural } from '../../core/format.js';
import { bookingWhen } from '../../core/availability.js';
import { mailtoLink, mapsLink, telLink, waLink } from '../../core/messages.js';
import { goBack, navigate, routeHref } from '../router.js';

export const title = 'Customers';
export const css = ['css/insights.css'];

// Whole state: identity is stable between mutations, so useMemo below only recomputes when something changed
// (selectCustomers builds fresh objects on every call, which a shallow-compare selector would treat as "changed").
const selectState = (state) => state;

const VIEW_OPTIONS = [
  { value: 'bookings', label: 'Bookings', testid: 'bookings-view-bookings' },
  { value: 'customers', label: 'Customers', testid: 'bookings-view-customers' }
];

/** Name, address line, postcode (spaces ignored) or phone digits (a leading 0 means +44). */
function matchesSearch(customer, query) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  const hay = [customer.name, ...customer.addresses.map((a) => a.line1)].join(' ').toLowerCase();
  if (hay.includes(text)) return true;
  const compact = text.replace(/\s+/g, '');
  if (compact.length >= 2 && customer.addresses.some((a) => a.postcode.replace(/\s+/g, '').toLowerCase().includes(compact))) return true;
  const digits = text.replace(/[^0-9]/g, '');
  const national = digits.startsWith('0') ? digits.slice(1) : digits;
  return national.length >= 3 && customer.key.includes(national);
}

function lastLabel(c) {
  if (c.lastJobAt) return `Last job ${fmtDayShort(stampDay(c.lastJobAt))}`;
  if (c.nextJobAt) return `Next job ${fmtDayShort(stampDay(c.nextJobAt))}`;
  return 'No jobs yet';
}

const priceOf = (b) => (b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);

function ViewToggle() {
  return html`<${Segmented}
    options=${VIEW_OPTIONS} value="customers" ariaLabel="Show bookings or customers"
    onChange=${(v) => { if (v === 'bookings') navigate(routeHref('bookings')); }}
    data-testid="bookings-view-toggle" />`;
}

function CustomerRow({ customer, selected }) {
  const c = customer;
  const outward = c.addresses[0] ? outwardCode(c.addresses[0].postcode) : '';
  const meta = [outward, plural(c.jobs, 'job')].filter(Boolean).join(' · ');
  return html`<li>
    <a class=${cx('db-list__item', 'cu-row', selected && 'is-selected')} href=${routeHref('customers', { key: c.key })}
       aria-current=${selected ? 'page' : undefined} data-testid=${`customer-row-${c.key}`}>
      <${Avatar} name=${c.name} size=${44} />
      <span class="cu-row__main">
        <span class="cu-row__name">${c.name}</span>
        <span class="cu-row__meta">${meta}</span>
        <span class="cu-row__meta">${lastLabel(c)}</span>
        ${c.tags.length || c.owed > 0 ? html`<span class="cu-row__chips">
          ${c.tags.map((t) => html`<${Chip} key=${t} tone=${t === 'Repeat' ? 'ok' : 'neutral'}>${t}<//>`)}
          ${c.owed > 0 ? html`<${Chip} tone="accent">Owed ${gbp(c.owed)}<//>` : null}
        </span>` : null}
      </span>
      <span class="cu-row__side">
        <span class=${cx('cu-row__value', c.totalValue === 0 && 'is-zero')}>${gbp(c.totalValue)}</span>
        <span class="cu-row__valuelabel">total</span>
      </span>
      <${Icon} name="chevron-right" size=${20} class="cu-row__chevron" />
    </a>
  </li>`;
}

function CustomerList({ customers, total, query, onQuery, selectedKey }) {
  const shown = customers.filter((c) => matchesSearch(c, query));
  return html`<div class="cu-list-pane">
    ${selectedKey
      ? html`<h2 class="cu-listhead">Customers</h2>`
      : html`<${PageHeader} title="Customers" subtitle=${total ? plural(total, 'customer') : undefined} />`}
    <div class="cu-controls">
      <${ViewToggle} />
      <${Input}
        id="customers-search-input" type="search" value=${query} onInput=${onQuery}
        placeholder="Name, phone or postcode" aria-label="Search customers"
        autocomplete="off" autocapitalize="off" enterkeyhint="search" spellcheck=${false}
        data-testid="customers-search" />
    </div>
    ${total === 0
      ? html`<${EmptyState} icon="users" title="No customers yet. They appear when someone books." data-testid="customers-empty" />`
      : shown.length === 0
        ? html`<${EmptyState} icon="search" title=${`No customers match "${query.trim()}".`} data-testid="customers-empty" />`
        : html`<ul class="db-list cu-list" data-testid="customers-list">
          ${shown.map((c) => html`<${CustomerRow} key=${c.key} customer=${c} selected=${c.key === selectedKey} />`)}
        </ul>`}
  </div>`;
}

function BookingRow({ booking }) {
  const b = booking;
  return html`<li>
    <a class="db-list__item cu-bk" href=${routeHref('bookings', { id: b.id })} data-testid=${`customer-booking-${b.id}`}>
      <span class="cu-bk__main">
        <span class="cu-bk__when">${bookingWhen(b)}</span>
        <span class="cu-bk__svc">${b.serviceName}${b.variantLabel ? `, ${b.variantLabel}` : ''} · ${b.ref}</span>
        <span class="cu-bk__status"><${StatusPill} status=${b.status} paid=${b.paid} urgent=${b.urgent} compact /></span>
      </span>
      <span class=${cx('cu-bk__price', b.status === 'cancelled' && 'is-struck')}>${gbp(priceOf(b))}</span>
      <${Icon} name="chevron-right" size=${20} class="cu-row__chevron" />
    </a>
  </li>`;
}

function CustomerDetail({ state, customerKey, brand }) {
  const customer = useMemo(() => selectCustomerByKey(state, customerKey), [state, customerKey]);
  const back = {
    href: routeHref('customers'),
    label: 'Back to customers',
    onClick: (e) => { e.preventDefault(); goBack(routeHref('customers')); }
  };

  if (!customer) {
    return html`<div class="cu-detail" data-testid="customer-not-found">
      <${PageHeader} title="Customer" back=${back} />
      <${EmptyState} icon="users" title="We couldn't find that customer."
        body="They may have been removed when the demo was reset."
        action=${html`<${Button} variant="primary" href=${routeHref('customers')}>Back to customers<//>`} />
    </div>`;
  }

  const bookings = customer.bookingIds.map((id) => selectBookingById(state, id)).filter(Boolean);
  const latest = bookings[0];
  const doneCount = bookings.filter((b) => b.status === 'done').length;
  const first = firstName(customer.name);
  const waHref = waLink(customer.phone, `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name}.`, brand.demoPhoneDigits);
  const rebookHref = routeHref('new', {}, { customer: customer.key, service: latest ? latest.serviceId : '' });

  return html`<div class="cu-detail" data-testid="customer-detail">
    <${PageHeader} eyebrow="Customer" title=${customer.name} back=${back} />
    <div class="db-stack">
      <${Card} class="cu-contact">
        ${customer.tags.length ? html`<div class="cu-contact__tags">
          ${customer.tags.map((t) => html`<${Chip} key=${t} tone=${t === 'Repeat' ? 'ok' : 'neutral'}>${t}<//>`)}
        </div>` : null}
        <p class="cu-contact__line"><${Icon} name="phone" size=${18} /><span>${customer.phone}</span></p>
        ${customer.email
          ? html`<p class="cu-contact__line"><${Icon} name="send" size=${18} /><a class="ui-link ui-link--inline" href=${mailtoLink(customer.email)}>${customer.email}</a></p>`
          : null}
        <div class="cu-contact__actions">
          <${Button} icon="phone" href=${telLink(customer.phone)} data-testid="customer-call">Call<//>
          <${Button} icon="message-circle" href=${waHref} data-testid="customer-whatsapp">WhatsApp<//>
        </div>
      <//>

      <div class="cu-tiles">
        <${Stat} label="Total value" value=${gbp(customer.totalValue)} hint=${plural(doneCount, 'finished job')} tone="ok" data-testid="customer-total" />
        <${Stat} label="Owed" value=${gbp(customer.owed)} hint=${customer.owed > 0 ? 'still to collect' : 'nothing due'} tone=${customer.owed > 0 ? 'accent' : undefined} data-testid="customer-owed" />
      </div>

      <section class="db-section">
        <h2 class="db-section__title">${customer.addresses.length > 1 ? 'Addresses' : 'Address'}</h2>
        <ul class="db-list" data-testid="customer-addresses">
          ${customer.addresses.map((a, i) => html`<li class="db-list__item cu-addr" key=${`${a.line1}|${a.postcode}`}>
            <${Icon} name="map-pin" size=${22} class="cu-addr__icon" />
            <span class="cu-addr__text">
              <span class="cu-addr__line">${a.line1 || a.postcode}</span>
              ${a.line1 ? html`<span class="cu-addr__pc">${a.postcode}</span>` : null}
            </span>
            <${Button} variant="ghost" size="sm" icon="navigation" href=${mapsLink(a.line1, a.postcode)} data-testid=${`customer-maps-${i}`}>Open in Maps<//>
          </li>`)}
        </ul>
      </section>

      <section class="db-section">
        <h2 class="db-section__title"><span>Bookings <span class="cu-count">${bookings.length}</span></span></h2>
        <ul class="db-list" data-testid="customer-bookings">
          ${bookings.map((b) => html`<${BookingRow} key=${b.id} booking=${b} />`)}
        </ul>
      </section>
    </div>

    <div class="db-sticky-actions cu-sticky">
      <${Button} variant="primary" size="lg" block icon="plus" href=${rebookHref} data-testid="customer-rebook">Rebook<//>
    </div>
  </div>`;
}

export default function CustomersView({ route }) {
  const state = useStore(selectState);
  const brand = useBrand();
  const key = route.params.key || '';
  const [query, setQuery] = useState(route.query.q || '');
  const customers = useMemo(() => selectCustomers(state), [state]);

  // Typing is mirrored into ?q= with a replace (no history spam), so Back from a detail returns to the same search.
  const onQuery = (e) => {
    const value = e.target.value;
    setQuery(value);
    navigate(routeHref('customers', key ? { key } : {}, value.trim() ? { q: value } : {}), { replace: true });
  };

  return html`<div class="db-page cu-page">
    <div class=${cx('db-master-detail', key && 'db-master-detail--has-detail')}>
      <div class="db-master-detail__list">
        <${CustomerList} customers=${customers} total=${customers.length} query=${query} onQuery=${onQuery} selectedKey=${key} />
      </div>
      <div class="db-master-detail__detail">
        ${key
          ? html`<${CustomerDetail} state=${state} customerKey=${key} brand=${brand} />`
          : html`<${EmptyState} icon="users" title="Pick a customer" body="Their jobs, what they owe and a Rebook shortcut show here." class="cu-pick" />`}
      </div>
    </div>
  </div>`;
}
