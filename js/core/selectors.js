// js/core/selectors.js: pure derived data for the UI (needs-you, next-up, customers, insights; re-exports the v3 pipeline and quote selectors)
// Owner: WP1 (v1), A3 (v3 additions)
import { ENQUIRY_ANSWER_HEADINGS, ENQUIRY_ANSWER_KEYS, PROMISES, answerLabel, imageUrl, makeDefaultBusiness } from './config.js';
import { nowStamp, nowStampSec } from './clock.js';
import { summariseConnections } from './connections.js';
import { isFreeVisit } from './pipeline.js';
import {
  addDays, diffDays, fmtDayShort, minutesBetween, monthKeyOf, stampDay, weekStart, weekdayOf
} from './dates.js';
import { bookingEndStamp, describeHours } from './availability.js';
import { gbp, outsideAreaLabel, toWaDigits } from './format.js';
import { messageIsScheduled, telLink } from './messages.js';
import { assessQuoteDecision } from './quotes.js';
import { parseImport, quoteLinkInfo } from './handoff.js';

// Selectors never mutate state (it is frozen); every sort below works on a copy.

function byIndex(list) {
  return list.map((item, index) => ({ item, index }));
}

// ---------- brand and services ----------

const brandCache = new WeakMap();

// v3 re-exports: everything a view needs can be imported from here (docs/V3-API.md section 14).
export {
  isFreeVisit, leadSourceOf, resolveRange, RANGE_PRESETS, selectPipeline, selectJourney, selectSla, selectLeadSources, selectCostPerLead,
  selectQuoteStats, selectQuotes, selectQuote, selectQuotesForBooking, selectQuoteForBooking, selectQuoteList, selectQuoteDetail
} from './pipeline.js';
export { quoteTotal, quoteLineTotal, quoteStatus, quoteExpiresInDays, isOptionalLine, quoteFixedLines, quoteExtraLines, quoteExtrasTotal } from './quotes.js';

export function selectBrand(state) {
  const hit = brandCache.get(state);
  if (hit) return hit;
  const s = state.settings;
  const b = s.business;
  const brand = {
    name: b.name,
    shortName: b.shortName,
    descriptor: b.descriptor,
    ownerFirst: b.ownerFirstName,
    ownerFull: b.ownerFullName,
    tagline: b.tagline,
    phone: b.phone,
    phoneDigits: toWaDigits(b.phone),
    telHref: telLink(b.phone),
    email: b.email,
    areaName: b.areaName,
    areaText: b.areaText,
    towns: b.towns,
    schemeLine: b.schemeLine,
    insuranceLine: b.insuranceLine,
    credentials: Array.isArray(b.credentials) ? b.credentials : [],
    brands: Array.isArray(b.brands) ? b.brands : [],
    hoursText: describeHours(s.hours),
    demoPhoneDigits: s.demoPhoneDigits || '',
    coveredOutward: b.coveredOutward,
    edgeOutward: b.edgeOutward,
    address: typeof b.address === 'string' ? b.address : '',
    images: { ...makeDefaultBusiness().images, ...(b.images && typeof b.images === 'object' ? b.images : {}) }
  };
  brandCache.set(state, brand);
  return brand;
}

/** One of his photos for this state's settings: `selectImageUrl(state, 'hero', { width: 1080 })`. */
export function selectImageUrl(state, key, { width } = {}) {
  return imageUrl(key, { width, images: state.settings.business.images });
}

/** The hub rows for the Connections screen (SIMULATED connections). Reports the settled status of any due simulation. */
export function selectConnectionsSummary(state, nowSecStr = nowStampSec()) {
  return summariseConnections(state.settings.connections, nowSecStr);
}

export function selectServices(state, { activeOnly = true } = {}) {
  return state.settings.services.filter((s) => !activeOnly || s.active);
}

export function selectService(state, id) {
  return state.settings.services.find((s) => s.id === id) || null;
}

/** The services the public website offers: active and showOnWebsite (by default only the free EV charger quote). */
export function selectWebsiteServices(state) {
  return state.settings.services.filter((s) => s.active && s.showOnWebsite === true);
}

/** The variant price when the variant exists, else the headline price. */
export function quotedPriceFor(service, variantId) {
  const v = (service.variants || []).find((x) => x.id === variantId);
  return v ? v.price : service.price;
}

/** 'From £75' | 'From £150' | 'Free' | fixed '£120' | quote-led 'Quoted for your home' (no number) */
export function servicePriceLabel(service) {
  if (service.priceType === 'free') return 'Free';
  if (service.priceType === 'quoted') return 'Quoted for your home';
  if (service.priceType === 'fixed') return gbp(service.price);
  return `From ${gbp(service.price)}`;
}

// ---------- bookings ----------

/**
 * The enquiry answers of a booking as job-card rows, in funnel order: [{ key, heading, value, label }].
 * `label` is his verbatim option text (the postcode itself for 'postcode'). Empty for a booking with no answers.
 */
export function enquiryAnswerRows(booking) {
  const answers = booking && booking.answers;
  if (!answers) return [];
  const rows = [];
  for (const key of ENQUIRY_ANSWER_KEYS) {
    const label = answerLabel(key, answers[key]);
    if (label) rows.push({ key, heading: ENQUIRY_ANSWER_HEADINGS[key], value: answers[key], label });
  }
  return rows;
}

/** 'Outside Northern Ireland' when the booking's postcode is a valid non-BT UK postcode, else ''. */
export function bookingAreaFlag(booking) {
  return booking && booking.address ? outsideAreaLabel(booking.address.postcode) : '';
}

export function selectBookingById(state, id) {
  return state.bookings.find((b) => b.id === id) || null;
}

export function selectBookingByRef(state, ref) {
  const wanted = String(ref || '').trim().toUpperCase();
  return state.bookings.find((b) => b.ref.toUpperCase() === wanted) || null;
}

/** Bookings starting on dayKey, by start then createdAt. Urgent requests count on the day they were made. */
export function selectBookingsOn(state, dayKey, { includeCancelled = false } = {}) {
  return byIndex(state.bookings)
    .filter(({ item }) => stampDay(item.start) === dayKey && (includeCancelled || item.status !== 'cancelled'))
    .sort((a, b) => cmp(a.item.start, b.item.start) || cmp(a.item.createdAt, b.item.createdAt) || a.index - b.index)
    .map(({ item }) => item);
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** status 'new': urgent first, then oldest first. */
export function selectNeedsYou(state) {
  return byIndex(state.bookings)
    .filter(({ item }) => item.status === 'new')
    .sort((a, b) => (b.item.urgent ? 1 : 0) - (a.item.urgent ? 1 : 0) || cmp(a.item.createdAt, b.item.createdAt) || a.index - b.index)
    .map(({ item }) => item);
}

/** 1) on_the_way, earliest start; 2) accepted emergency, oldest; 3) confirmed job not yet over, earliest start. */
export function selectNextUp(state, nowStampStr) {
  const live = byIndex(state.bookings);
  const sortStart = (a, b) => cmp(a.item.start, b.item.start) || a.index - b.index;
  const onTheWay = live.filter(({ item }) => item.status === 'on_the_way').sort(sortStart);
  if (onTheWay.length) return onTheWay[0].item;
  const urgent = live
    .filter(({ item }) => item.status === 'confirmed' && item.urgent)
    .sort((a, b) => cmp(a.item.createdAt, b.item.createdAt) || a.index - b.index);
  if (urgent.length) return urgent[0].item;
  const next = live
    .filter(({ item }) => item.status === 'confirmed' && !item.urgent && bookingEndStamp(item) > nowStampStr)
    .sort(sortStart);
  return next.length ? next[0].item : null;
}

/** new | confirmed | on_the_way that are urgent or not over yet, by start. */
export function selectUpcoming(state, nowStampStr) {
  return byIndex(state.bookings)
    .filter(({ item }) => ['new', 'confirmed', 'on_the_way'].includes(item.status) && (item.urgent || bookingEndStamp(item) >= nowStampStr))
    .sort((a, b) => cmp(a.item.start, b.item.start) || a.index - b.index)
    .map(({ item }) => item);
}

const priceOf = (b) => (b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);

/** done and not paid, oldest start first. A free survey visit is never owed. */
export function selectOwed(state) {
  return byIndex(state.bookings)
    .filter(({ item }) => item.status === 'done' && !item.paid && !isFreeVisit(item))
    .sort((a, b) => cmp(a.item.start, b.item.start) || a.index - b.index)
    .map(({ item }) => item);
}

export function selectOwedTotal(state) {
  return selectOwed(state).reduce((sum, b) => sum + priceOf(b), 0);
}

/** seenByOwner === false, newest first. */
export function selectUnseenBookings(state) {
  return byIndex(state.bookings)
    .filter(({ item }) => item.seenByOwner === false)
    .sort((a, b) => cmp(b.item.createdAt, a.item.createdAt) || b.index - a.index)
    .map(({ item }) => item);
}

/** The first day after fromDayKey with an open window and not a day off (looks 60 days ahead), else null. */
export function selectNextOpenDay(state, fromDayKey) {
  for (let i = 1; i <= 60; i += 1) {
    const day = addDays(fromDayKey, i);
    const open = state.settings.hours[weekdayOf(day)] || [];
    if (open.length > 0 && !state.settings.daysOff.some((d) => d.date === day)) return day;
  }
  return null;
}

// ---------- customers (derived, never stored) ----------

export function customerKeyOf(phone) {
  return toWaDigits(phone);
}

// CONTRACT-GAP: "newest first" for a customer's bookings means by createdAt, then start, then list position.
function recentFirst(a, b) {
  return cmp(b.item.createdAt, a.item.createdAt) || cmp(b.item.start, a.item.start) || b.index - a.index;
}

function buildCustomer(key, entries) {
  const sorted = [...entries].sort(recentFirst);
  const latest = sorted[0].item;
  const live = sorted.filter(({ item }) => item.status !== 'cancelled');
  const done = sorted.filter(({ item }) => item.status === 'done');
  const upcoming = sorted.filter(({ item }) => item.status === 'new' || item.status === 'confirmed' || item.status === 'on_the_way');
  const seenAddress = new Set();
  const addresses = [];
  for (const { item } of sorted) {
    const k = `${item.address.line1}|${item.address.postcode}`;
    if (seenAddress.has(k)) continue;
    seenAddress.add(k);
    addresses.push({ line1: item.address.line1, postcode: item.address.postcode });
  }
  const eicrAddresses = new Set(live.filter(({ item }) => item.serviceId === 'eicr').map(({ item }) => `${item.address.line1}|${item.address.postcode}`));
  const phoneLandlord = sorted.some(({ item }) => item.source === 'phone' && /landlord/i.test(`${item.notes || ''} ${item.internalNotes || ''}`));
  const tags = [];
  if (eicrAddresses.size >= 2 || phoneLandlord) tags.push('Landlord');
  if (live.length >= 2) tags.push('Repeat');
  const email = (sorted.find(({ item }) => item.customer.email) || { item: { customer: { email: '' } } }).item.customer.email;
  return {
    key,
    name: latest.customer.name,
    phone: latest.customer.phone,
    email,
    bookingIds: sorted.map(({ item }) => item.id),
    jobs: live.length,
    cancelled: sorted.length - live.length,
    totalValue: done.reduce((sum, { item }) => sum + priceOf(item), 0),
    owed: done.filter(({ item }) => !item.paid).reduce((sum, { item }) => sum + priceOf(item), 0),
    lastJobAt: done.length ? done.map(({ item }) => item.start).sort().pop() : null,
    nextJobAt: upcoming.length ? upcoming.map(({ item }) => item.start).sort()[0] : null,
    addresses,
    tags
  };
}

function groupByCustomer(state) {
  const groups = new Map();
  byIndex(state.bookings).forEach((entry) => {
    const key = customerKeyOf(entry.item.customer.phone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  return groups;
}

/** Customers sorted by the later of nextJobAt and lastJobAt (newest first), then name. */
export function selectCustomers(state) {
  const customers = [];
  for (const [key, entries] of groupByCustomer(state)) customers.push(buildCustomer(key, entries));
  const recency = (c) => ((c.nextJobAt || '') > (c.lastJobAt || '') ? c.nextJobAt || '' : c.lastJobAt || '');
  return customers.sort((a, b) => cmp(recency(b), recency(a)) || cmp(a.name, b.name));
}

export function selectCustomerByKey(state, key) {
  const entries = groupByCustomer(state).get(String(key));
  return entries ? buildCustomer(String(key), entries) : null;
}

/** nth = 1-based position among this customer's non-cancelled bookings by createdAt; isRepeat = nth >= 2. */
export function selectRepeatInfo(state, booking) {
  const key = customerKeyOf(booking.customer.phone);
  const others = byIndex(state.bookings).filter(({ item }) => item.id !== booking.id && item.status !== 'cancelled' && customerKeyOf(item.customer.phone) === key);
  const earlier = others.filter(({ item, index }) => {
    if (item.createdAt !== booking.createdAt) return item.createdAt < booking.createdAt;
    const own = state.bookings.findIndex((b) => b.id === booking.id);
    return own < 0 ? true : index < own;
  });
  const nth = earlier.length + 1;
  return { isRepeat: nth >= 2, nth };
}

// ---------- messages ----------

/** Newest first: `at` descending, then `seq` descending. */
export function selectMessages(state, { to, bookingId, scheduledOnly, nowStamp } = {}) {
  return state.messages
    .filter((m) => (!to || m.to === to) && (!bookingId || m.bookingId === bookingId) && (!scheduledOnly || messageIsScheduled(m, nowStamp)))
    .slice()
    .sort((a, b) => cmp(b.at, a.at) || b.seq - a.seq);
}

/** Owner messages the owner has not opened yet (seed alerts count as already seen). */
export function selectUnreadMessageCount(state) {
  return state.messages.filter((m) => m.to === 'owner' && !m.seed && m.seq > state.meta.messagesSeenSeq).length;
}

// ---------- insights ----------

/** Collected, owed, booked-ahead, average job, six weekly totals and per-service totals. */
export function selectInsights(state, nowStampStr) {
  const today = stampDay(nowStampStr);
  const month = monthKeyOf(nowStampStr);
  const bookings = state.bookings;
  // A free survey visit (ev_quote done at £0) carries no money: it is neither collected nor part of the average job.
  const collected = bookings.filter((b) => b.status === 'done' && b.paid && b.paidAt && monthKeyOf(b.paidAt) === month && !isFreeVisit(b));
  const owed = selectOwed(state);
  const horizon = addDays(today, 13);
  const ahead = bookings.filter((b) => !b.urgent && ['new', 'confirmed', 'on_the_way'].includes(b.status) && stampDay(b.start) >= today && stampDay(b.start) <= horizon);
  const recentDone = bookings.filter((b) => b.status === 'done' && !isFreeVisit(b) && diffDays(stampDay(b.start), today) >= 0 && diffDays(stampDay(b.start), today) <= 30);
  const sum = (list, f) => list.reduce((t, b) => t + f(b), 0);

  const thisWeek = weekStart(today);
  const weeks = [];
  for (let i = 5; i >= 0; i -= 1) {
    const ws = addDays(thisWeek, -7 * i);
    const total = sum(bookings.filter((b) => b.status === 'done' && b.paid && b.paidAt && weekStart(stampDay(b.paidAt)) === ws), priceOf);
    weeks.push({ weekStart: ws, label: fmtDayShort(ws), total });
  }

  const services = new Map();
  for (const b of bookings.filter((x) => x.status === 'done')) {
    const entry = services.get(b.serviceId) || { serviceId: b.serviceId, name: b.serviceName, jobs: 0, total: 0 };
    entry.jobs += 1;
    entry.total += priceOf(b);
    services.set(b.serviceId, entry);
  }
  const byService = [...services.values()].sort((a, b) => b.total - a.total || cmp(a.name, b.name));

  return {
    collectedMonth: sum(collected, priceOf),
    collectedMonthCount: collected.length,
    owedTotal: sum(owed, priceOf),
    owedCount: owed.length,
    bookedNext14: sum(ahead, (b) => b.quotedPrice),
    bookedNext14Count: ahead.length,
    avgJob: recentDone.length ? Math.round(sum(recentDone, priceOf) / recentDone.length) : 0,
    weeks,
    byService
  };
}

/** True when the start is less than PROMISES.freeChangeHours away, INCLUDING a start already in the past. */
export function isWithinChangeCutoff(booking, nowStampStr) {
  return minutesBetween(nowStampStr, booking.start) < PROMISES.freeChangeHours * 60;
}

// ---------- v4: the WhatsApp link handoff (docs/V4-API.md) ----------

/**
 * What the owner's import screen shows and does with a link, WITHOUT changing anything. `parsed` is parseImport's result (or anything it accepts).
 * { ok: true, kind, state: 'ready' | 'done' | 'blocked', reason, message, title, summary, actionLabel, bookingId, quote, localTotal, href }, or
 * { ok: false, reason, message } when the link cannot be read. 'done' = already added or decided (the action would do nothing); 'blocked' = cannot be
 * applied on this device (the message says why in plain words). Uses the same rules the store applies (quotes.js assessQuoteDecision).
 */
export function previewImport(state, parsed, nowStampStr = nowStamp()) {
  const read = parsed && parsed.ok === true && parsed.data ? parsed : parseImport(parsed, { now: nowStampStr });
  if (!read.ok) return { ok: false, reason: read.reason, message: read.message };
  const d = read.data;
  const base = { ok: true, kind: read.kind, state: 'ready', reason: '', message: '', title: '', summary: '', actionLabel: '', bookingId: null, quote: null, localTotal: null, href: '#/pipeline' };
  if (read.kind === 'enq') {
    const existing = (state.bookings || []).find((b) => b.importId === d.importId);
    const service = (state.settings.services || []).find((x) => x.id === 'ev_quote');
    const blocked = !existing && (!service || !service.active);
    return {
      ...base,
      state: existing ? 'done' : blocked ? 'blocked' : 'ready',
      reason: blocked ? 'service_unavailable' : '',
      message: blocked ? 'Home charger enquiries are switched off on this device, so this one cannot be added.' : '',
      title: `${d.name} sent an enquiry`,
      summary: `${d.name}, ${d.postcode}`,
      actionLabel: 'Add to my dashboard',
      bookingId: existing ? existing.id : null,
      href: existing ? `#/bookings/${existing.id}` : '#/bookings'
    };
  }
  if (read.kind === 'acc' || read.kind === 'dec') {
    const verdict = assessQuoteDecision(state.quotes, d, nowStampStr);
    const accepted = read.kind === 'acc';
    const local = verdict.localTotal;
    const summary = accepted ? d.summary : `${d.customerFirst} declined quote ${d.quoteId}${local === null ? '' : ` (${gbp(local)})`}${d.reasonLabel ? `. Reason: ${d.reasonLabel}` : ''}`;
    return {
      ...base,
      state: verdict.state,
      reason: verdict.reason,
      message: verdict.message,
      title: `${d.customerFirst} ${accepted ? 'accepted' : 'declined'} a quote`,
      summary,
      actionLabel: accepted ? 'Mark quote accepted and plan the install' : 'Mark quote declined',
      bookingId: verdict.bookingId,
      quote: verdict.quote,
      localTotal: local,
      href: verdict.bookingId ? `#/bookings/${verdict.bookingId}` : verdict.quote ? `#/quotes/${verdict.quote.id}` : '#/pipeline'
    };
  }
  return {
    ...base, state: 'blocked', reason: 'wrong_kind', message: 'This is a quote link for a customer. It opens on the customer\'s quote page, not here.', title: 'A quote link', summary: `${d.customerFirst}, quote ${d.id}`
  };
}

/** The link to copy or send for a stored quote: { url, portable, chars, reason, notesTruncated } (portable false = it opens only in this browser), or null for an unknown quote. */
export function selectQuoteLinkInfo(state, quoteId) {
  const quote = state.quotes && Object.prototype.hasOwnProperty.call(state.quotes, quoteId) ? state.quotes[quoteId] : null;
  if (!quote) return null;
  const booking = (state.bookings || []).find((b) => b.id === quote.bookingId) || null;
  return quoteLinkInfo(quote, { booking });
}
