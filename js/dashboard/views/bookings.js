// js/dashboard/views/bookings.js: Bookings inbox (List | Pipeline | Customers, search, status, stage and source filters) and the master-detail layout from 1100px.
// Owner: E3 (v1 by WP5, enquiry rows by E2)
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import {
  Button, EmptyState, Field, Icon, IconButton, Input, PageHeader, Segmented, Select, Sheet, TextLink, cx, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { markAllSeen } from '../../core/store.js';
import { selectUpcoming, selectOwed, selectNeedsYou, selectPipeline, customerKeyOf } from '../../core/selectors.js';
import { bookingWhen, bookingWindowLabel } from '../../core/availability.js';
import { fmtRelativeDay, stampDay, toStamp } from '../../core/dates.js';
import { todayKey } from '../../core/clock.js';
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, PIPELINE_STAGES } from '../../core/config.js';
import { gbp, outwardCode } from '../../core/format.js';
import { navigate, routeHref } from '../router.js';
import { BookingDetail } from './booking-detail.js';
import { BookingPill, isEnquiry, isPencilled, isQuotedInstall, priceLabel } from '../shared/enquiry.js';
import { OutsidePill } from '../shared/outside.js';
import { slaFor } from '../shared/sla.js';
import { NeedsYouActions, NeedsYouMenu } from '../shared/job-actions.js';
import { needRows, stripeOf } from '../shared/needs.js';
import { StagePill, stageMapOf } from '../shared/stage.js';
import { useScrollFade } from '../shared/scroll.js';

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
const STAGE_IDS = PIPELINE_STAGES.map((s) => s.id);

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

/**
 * The list in the order Daniel works it: emergencies, then everything that needs him (ranked like Today: overdue and fresh enquiries first,
 * then accepted quotes by value, then the rest by age), then days with plain headings. The days run soonest first for upcoming, newest first
 * for the rest.
 */
function groupBookings(list, soonestFirst, today, ranked) {
  const dir = soonestFirst ? 1 : -1;
  const groups = [];
  const asap = list.filter(isAsap).sort((a, b) => cmp(a.createdAt, b.createdAt));
  if (asap.length) groups.push({ key: 'asap', heading: 'ASAP', items: asap });
  const needIds = new Set();
  if (ranked) {
    const need = ranked.filter((r) => !r.b.urgent && list.some((x) => x.id === r.b.id));
    need.forEach((r) => needIds.add(r.b.id));
    if (need.length) groups.push({ key: 'needs', heading: `Needs you · ${need.length}`, items: need.map((r) => r.b), needs: true });
  }
  const rest = list.filter((b) => !isAsap(b) && !needIds.has(b.id)).sort((a, b) => dir * (cmp(a.start, b.start) || cmp(a.createdAt, b.createdAt)));
  rest.forEach((b) => {
    const day = stampDay(b.start);
    const last = groups[groups.length - 1];
    if (last && last.key === day) last.items.push(b);
    else groups.push({ key: day, heading: fmtRelativeDay(day, today), items: [b] });
  });
  return groups;
}

/** The one booking id a pipeline item shows as a row: the install once there is one (accepted, install, done), else the enquiry. */
const rowIdOf = (item) => (['accepted', 'install', 'done'].includes(item.stage) && item.installBookingId ? item.installBookingId : item.bookingId);

function emptyFor(filter, query, stage, source) {
  if (query) return { title: `No bookings match "${query}".` };
  if (stage || source) {
    const what = [stage ? `in ${PIPELINE_STAGES.find((s) => s.id === stage).label.toLowerCase()}` : '', source ? `from ${LEAD_SOURCE_LABELS[source]}` : ''].filter(Boolean).join(' ');
    return { title: `Nothing ${what} right now.` };
  }
  switch (filter) {
    case 'new': return { title: 'No enquiries waiting. Nice.' };
    case 'upcoming': return { title: 'No upcoming visits or installs.', body: html`<${TextLink} href=${routeHref('share')} inline>Share your enquiry link<//>.` };
    case 'owed': return { title: 'Nothing to collect. Nice.' };
    case 'done': return { title: 'No finished jobs yet.' };
    case 'cancelled': return { title: 'No cancelled bookings. Nice.' };
    default: return { title: 'No enquiries or bookings yet.' };
  }
}

// ---------- rows ----------

/**
 * The decision fact of a row: the one thing Daniel needs to know to act, in words that wrap onto two lines
 * ("Reply due in 23 h · Survey Thu 29 Oct, 10am–12", "Quote £1,394 not sent", "Install pencilled in, Tue 3 Nov").
 */
function factFor(b, item, sla) {
  if (b.status === 'cancelled') return 'Cancelled';
  if (b.urgent) return b.status === 'done' ? 'Emergency visit done' : 'Emergency · ASAP';
  const money = (n) => gbp(n);
  if (isEnquiry(b)) {
    if (b.status === 'new') return [sla ? sla.label : '', `Survey ${isPencilled(b) ? 'pencilled ' : ''}${bookingWhen(b)}`].filter(Boolean).join(' · ');
    if (b.status === 'confirmed' || b.status === 'on_the_way') return `Survey ${bookingWhen(b)}`;
    return item && item.summary ? item.summary : 'Survey done';
  }
  const service = b.variantLabel ? `${b.serviceName} (${b.variantLabel})` : b.serviceName;
  if (isQuotedInstall(b)) {
    if (b.status === 'new') return `Install pencilled in, ${bookingWhen(b)}`;
    if (b.status === 'confirmed' || b.status === 'on_the_way') return `Install ${bookingWhen(b)}`;
    if (b.status === 'done') return b.paid ? 'Installed and paid' : `Installed, ${money(b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice)} to collect`;
  }
  if (b.status === 'done') return b.paid ? `${service}, paid` : `${service}, ${money(b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice)} to collect`;
  return `${service}, ${bookingWhen(b)}`;
}

/**
 * One booking: name and outward code, the decision fact (two lines, never cut), its ONE status pill and its money (nothing for a free survey).
 * A row that needs Daniel (a new enquiry or an accepted quote) carries the same single verb button as Today. The stripe is urgency only:
 * overdue is --danger, due soon is amber, anything else has none.
 */
function Row({ b, selected, linkQuery, item, sla, need }) {
  const outward = outwardCode(b.address.postcode);
  const unseen = !b.seenByOwner;
  // An enquiry with a quote shows the quote total (the survey itself is free, so it shows no money); everything else keeps its own price.
  const price = isEnquiry(b) ? (item && item.value > 0 ? gbp(item.value) : '') : priceLabel(b);
  const stageChip = !!item && isEnquiry(b) && b.status === 'done' && !['done', 'enquiry', 'survey'].includes(item.stage);
  const stripe = need ? stripeOf(need) : '';
  const outside = !!need && need.outside;
  return html`<li class="bl-list__li" data-stripe=${stripe || undefined}>
    <a class=${cx('bl-row', !price && 'bl-row--nomoney', selected && 'is-selected', b.status === 'cancelled' && 'is-cancelled')}
      href=${routeHref('bookings', { id: b.id }, linkQuery)} aria-current=${selected ? 'page' : undefined} data-testid=${`booking-row-${b.id}`}>
      <span class="bl-row__main">
        <span class="bl-row__name">${b.customer.name}${outward ? html`<span class="bl-row__code">${` · ${outward}`}</span>` : null}${unseen && !need ? html`${' '}<span class="bl-new">New</span>` : null}</span>
        <span class="bl-row__fact" data-testid=${`booking-row-fact-${b.id}`}>${factFor(b, item, sla)}</span>
      </span>
      <span class="bl-row__side">
        ${price ? html`<span class="bl-row__price" data-testid=${`booking-row-price-${b.id}`}>${price}</span>` : null}
        ${outside
          ? html`<${OutsidePill} />`
          : stageChip
            ? html`<${StagePill} stage=${item.stage} compact data-testid=${`booking-row-stage-${b.id}`} />`
            : html`<${BookingPill} booking=${b} compact single />`}
      </span>
    </a>
    ${need ? html`<div class="bl-row__acts">
      <${NeedsYouActions} booking=${b} compact />
      <${NeedsYouMenu} booking=${b} />
    </div>` : null}
  </li>`;
}

// ---------- view ----------

export default function BookingsView({ route }) {
  const state = useStore(selectAll);
  const nowDate = useNow(30000);
  const wide = useMediaQuery('(min-width: 1100px)');
  const controlsRef = useRef(null);
  const filtersRef = useRef(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const id = route.params.id || '';
  useScrollFade(filtersRef, '.bl-filters', [id, wide]);
  const stage = STAGE_IDS.includes(route.query.s) ? route.query.s : '';
  const source = LEAD_SOURCES.includes(route.query.src) ? route.query.src : '';
  // Picking a stage or source looks at everything (a survey that is done is not "upcoming"), so the status filter defaults to All then.
  // With nothing else chosen it opens on "Needs you" while something needs him, else on what is coming up.
  const needsCount = selectNeedsYou(state).length;
  const baseDefault = needsCount > 0 ? 'new' : 'upcoming';
  const defaultF = stage || source ? 'all' : baseDefault;
  const f = FILTER_IDS.includes(route.query.f) ? route.query.f : defaultF;
  const urlQ = route.query.q || '';
  const [q, setQ] = useState(urlQ);
  useEffect(() => { setQ(urlQ); }, [urlQ]); // an outside link (#/bookings?q=...) wins over what was typed
  const query = q.trim();

  const nowStampStr = toStamp(nowDate);
  const today = todayKey();
  const hasUnseen = state.bookings.some((b) => !b.seenByOwner);
  const replyHours = state.settings.sla ? state.settings.sla.replyHours : 24;

  const pipeline = selectPipeline(state, nowStampStr);
  const stageMap = stageMapOf(pipeline);

  const counts = {
    new: needsCount,
    upcoming: selectUpcoming(state, nowStampStr).length,
    owed: selectOwed(state).length,
    done: state.bookings.filter((b) => b.status === 'done').length,
    cancelled: state.bookings.filter((b) => b.status === 'cancelled').length,
    all: state.bookings.length
  };

  // A non-empty search looks at EVERYTHING, whatever filter is selected.
  let base = query ? state.bookings.filter((b) => matches(b, query)) : listFor(state, f, nowStampStr);
  if (stage) {
    const rowIds = new Set(pipeline.stages.concat([{ id: 'lost', items: pipeline.lost }]).find((s) => s.id === stage).items.map(rowIdOf));
    base = base.filter((b) => rowIds.has(b.id));
  }
  if (source) base = base.filter((b) => { const it = stageMap.get(b.id); return it && it.leadSource === source; });
  const ranked = needRows(selectNeedsYou(state), state, replyHours, nowStampStr);
  const rankOf = new Map(ranked.map((r) => [r.b.id, r]));
  const groups = groupBookings(base, !query && (f === 'new' || f === 'upcoming'), today, ranked);
  const activeCount = (query ? 1 : 0) + (stage ? 1 : 0) + (source ? 1 : 0);

  // Filter and search live in the hash (replace, so Back does not step through every keystroke).
  const go = (next) => navigate(routeHref('bookings', id ? { id } : {}, {
    f: next.f === defaultOf(next) ? '' : next.f, s: next.s, src: next.src, q: next.q
  }), { replace: true });
  const defaultOf = (next) => (next.s || next.src ? 'all' : baseDefault);
  const linkQuery = { f: f === defaultF ? '' : f, s: stage, src: source, q: query };
  const onSearch = (e) => { setQ(e.target.value); go({ f, s: stage, src: source, q: e.target.value.trim() }); };
  const onFilter = (value) => go({ f: value, s: stage, src: source, q: query });
  const onStage = (e) => go({ f, s: e.target.value, src: source, q: query });
  const onSource = (e) => go({ f, s: stage, src: e.target.value, q: query });
  const clearAll = () => { setQ(''); go({ f, s: '', src: '', q: '' }); };

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
  const empty = emptyFor(f, query, stage, source);
  const filterOptions = FILTERS.map((o) => ({
    value: o.id,
    testid: `filter-${o.id}`,
    label: html`${o.label} <span class="bl-count">${counts[o.id]}</span>`
  }));
  const stageOptions = [{ value: '', label: 'All stages' }].concat(pipeline.stages.concat([{ id: 'lost', label: 'Lost', count: pipeline.lostCount }])
    .map((s) => ({ value: s.id, label: `${s.label} (${s.count})` })));
  const sourceCounts = {};
  stageMap.forEach((it, key) => { if (key === it.bookingId) sourceCounts[it.leadSource] = (sourceCounts[it.leadSource] || 0) + 1; });
  const sourceOptions = [{ value: '', label: 'All sources' }].concat(LEAD_SOURCES.map((s) => ({ value: s, label: `${LEAD_SOURCE_LABELS[s]} (${sourceCounts[s] || 0})` })));
  const shownCount = groups.reduce((t, g) => t + g.items.length, 0);

  // One filter icon in the header holds search, stage and source; the badge says how many are on.
  const headerActions = html`${hasUnseen ? html`<${Button} variant="ghost" size="sm" onClick=${() => markAllSeen()} data-testid="bookings-mark-all-seen">Mark all seen<//>` : null}
    <span class="bl-filter">
      <${IconButton} icon="filter" label=${activeCount ? `Search and filters, ${activeCount} on` : 'Search and filters'} size="lg" class="bl-filter__btn" onClick=${() => setSheetOpen(true)} data-testid="bookings-filter-open" />
      ${activeCount ? html`<span class="bl-filter__n" aria-hidden="true" data-testid="bookings-filter-count">${activeCount}</span>` : null}
    </span>`;

  return html`<div class=${cx('db-page', 'bl-page', id && 'bl-page--detail')}>
    ${showListHeader ? html`<${PageHeader} title="Bookings" actions=${headerActions} />` : null}
    <div class=${cx('db-master-detail', id && 'db-master-detail--has-detail')}>
      <div class="db-master-detail__list bl-pane">
        <div class="bl-toggle">
          <${Segmented} ariaLabel="Bookings view" value="list" data-testid="bookings-view-toggle"
            options=${[
              { value: 'list', label: 'List', testid: 'bookings-view-bookings' },
              { value: 'pipeline', label: 'Pipeline', testid: 'bookings-view-pipeline' },
              { value: 'customers', label: 'Customers', testid: 'bookings-view-customers' }
            ]}
            onChange=${(v) => { if (v === 'customers') navigate('#/customers'); else if (v === 'pipeline') navigate(routeHref('pipeline')); }} />
        </div>
        <div class="bl-controls" ref=${controlsRef}>
          <div class="sf-wrap" ref=${filtersRef}>
            <${Segmented} class="bl-filters sf-fade" ariaLabel="Filter bookings" options=${filterOptions} value=${f} onChange=${onFilter} />
          </div>
        </div>
        ${activeCount ? html`<div class="bl-active" role="status">
          <span class="bl-searching">${query ? 'Searching all bookings' : [stage ? `Stage: ${(stageOptions.find((o) => o.value === stage) || {}).label || stage}` : '', source ? `From ${LEAD_SOURCE_LABELS[source]}` : ''].filter(Boolean).join(' · ')}</span>
          <${Button} variant="ghost" size="sm" onClick=${clearAll} data-testid="bookings-clear-filters">Clear<//>
        </div>` : html`<p class="bl-searching" role="status"></p>`}

        <div class="bl-listwrap" data-testid="bookings-list">
          ${groups.length === 0
            ? html`<${EmptyState} icon="inbox" title=${empty.title} body=${empty.body} data-testid="bookings-empty" />`
            : groups.map((g) => html`<section class="bl-group" key=${g.key}>
              <h2 class="bl-group__title">${g.heading}</h2>
              <ul class="bl-list">
                ${g.items.map((b) => html`<${Row} key=${b.id} b=${b} selected=${b.id === id} linkQuery=${linkQuery} item=${stageMap.get(b.id) || null}
                  sla=${slaFor(b, replyHours, nowStampStr)} need=${g.needs ? rankOf.get(b.id) : null} />`)}
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
    <${Sheet} open=${sheetOpen} onClose=${() => setSheetOpen(false)} title="Search and filter" testid="bookings-filter-sheet"
      footer=${html`<${Button} variant="primary" size="lg" block onClick=${() => setSheetOpen(false)} data-testid="bookings-filter-done">${`Show ${shownCount} ${shownCount === 1 ? 'booking' : 'bookings'}`}<//>`}>
      <div class="ja-stack">
        <${Field} label="Search" id="bookings-search">
          <${Input} id="bookings-search" type="search" value=${q} onInput=${onSearch} placeholder="Name, phone, postcode or ref"
            inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="none"
            spellcheck=${false} class="bl-search__input" data-testid="bookings-search" />
        <//>
        <${Field} label="Pipeline stage" id="bookings-stage">
          <${Select} id="bookings-stage" value=${stage} options=${stageOptions} onChange=${onStage} data-testid="bookings-stage-filter" />
        <//>
        <${Field} label="Where it came from" id="bookings-source">
          <${Select} id="bookings-source" value=${source} options=${sourceOptions} onChange=${onSource} data-testid="bookings-source-filter" />
        <//>
        ${activeCount ? html`<${Button} variant="ghost" onClick=${clearAll} data-testid="bookings-filter-clear">Clear search and filters<//>` : null}
      </div>
    <//>
  </div>`;
}
