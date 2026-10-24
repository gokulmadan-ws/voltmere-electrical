// js/core/pipeline.js: pure selectors for the sales pipeline, response time, lead sources, cost per lead and the quote list
// Owner: A3 core
import {
  AD_CHANNELS, AD_CHANNEL_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS, PIPELINE_STAGES, SLA_DUE_SOON_MINUTES, ENQUIRY_ANSWER_SHORT
} from './config.js';
import { nowStamp } from './clock.js';
import { addDays, addMinutes, fmtDayShort, isDayKey, minutesBetween, monthKeyOf, stampDay } from './dates.js';
import { bookingEndStamp, bookingWhen, bookingWhenArrival, isUnscheduled } from './availability.js';
import { addressLine, firstName, gbp, own, toWaDigits } from './format.js';
import { latestQuoteFor, quoteExpiresInDays, quoteStatus, quoteTotal, quotesFor, splitLines } from './quotes.js';

const priceOf = (b) => (b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);

/** A free survey visit: an ev_quote that was completed with a final price of 0 (no money to collect, no job value to average). */
export function isFreeVisit(booking) {
  return !!booking && booking.serviceId === 'ev_quote' && booking.status === 'done' && booking.finalPrice === 0;
}

/** The lead source of a booking: its utm source, else by how the owner logged it ('phone' and 'referral'), else 'other'. */
export function leadSourceOf(booking) {
  const utm = booking && booking.utm;
  if (utm && LEAD_SOURCES.includes(utm.source)) return utm.source;
  if (booking && booking.source === 'phone') return 'phone';
  if (booking && booking.source === 'referral') return 'referral';
  return 'other';
}

// ---------- reply (SLA) ----------

const NOT_A_REPLY = ['created', 'note', 'paid', 'unpaid'];

/** The first thing the owner did about a booking (confirm, decline, reschedule, cancel or any message), or null. */
function replyEntry(booking) {
  return (booking.history || []).find((h) => h.by === 'owner' && !NOT_A_REPLY.includes(h.event)) || null;
}

/** True when the booking was made by a customer (website or webhook), not typed in by the owner. */
function customerMade(booking) {
  const created = (booking.history || []).find((h) => h.event === 'created');
  return !created || created.by === 'customer';
}

const isEnquiry = (b) => b.serviceId === 'ev_quote' && !b.urgent;
const waitingForReply = (b) => isEnquiry(b) && b.status === 'new' && !replyEntry(b);
const replyHoursOf = (state) => (state.settings.sla && Number.isInteger(state.settings.sla.replyHours) ? state.settings.sla.replyHours : 24);

function slaFlag(booking, replyHours, nowStampStr) {
  const left = minutesBetween(nowStampStr, addMinutes(booking.createdAt, replyHours * 60));
  if (left < 0) return 'overdue';
  return left <= SLA_DUE_SOON_MINUTES ? 'due_soon' : 'ok';
}

export function selectSla(state, nowStampStr = nowStamp()) {
  const replyHours = replyHoursOf(state);
  const enquiries = state.bookings.filter(isEnquiry);
  const waiting = enquiries.filter(waitingForReply);
  const overdue = [];
  const dueSoon = [];
  for (const b of waiting) {
    const dueAt = addMinutes(b.createdAt, replyHours * 60);
    const left = minutesBetween(nowStampStr, dueAt);
    const row = { bookingId: b.id, ref: b.ref, customerName: b.customer.name, createdAt: b.createdAt, dueAt };
    if (left < 0) overdue.push({ ...row, minutesOverdue: -left });
    else if (left <= SLA_DUE_SOON_MINUTES) dueSoon.push({ ...row, minutesLeft: left });
  }
  overdue.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  dueSoon.sort((a, b) => a.minutesLeft - b.minutesLeft);
  const replied = [];
  for (const b of enquiries) {
    const entry = replyEntry(b);
    if (entry && customerMade(b)) replied.push(Math.max(0, minutesBetween(b.createdAt, entry.at)));
  }
  const within = replied.filter((m) => m <= replyHours * 60).length;
  const counted = replied.length + overdue.length;
  return {
    replyHours,
    overdue,
    dueSoon,
    overdueCount: overdue.length,
    dueSoonCount: dueSoon.length,
    waitingCount: waiting.length,
    avgReplyMinutes: replied.length ? Math.round(replied.reduce((t, m) => t + m, 0) / replied.length) : null,
    withinTargetPct: counted ? Math.round((100 * within) / counted) : null,
    repliedCount: replied.length
  };
}

// ---------- journeys: enquiry, quote, install ----------

const INSTALL_RANK = { done: 4, on_the_way: 3, confirmed: 2, new: 1, cancelled: 0 };

function pickInstall(bookings, quote) {
  if (!quote) return null;
  const linked = bookings.filter((b) => b.serviceId === 'ev' && (b.quoteId === quote.id || b.id === quote.installBookingId));
  if (!linked.length) return null;
  return linked.sort((a, b) => (INSTALL_RANK[b.status] || 0) - (INSTALL_RANK[a.status] || 0) || (a.createdAt < b.createdAt ? 1 : -1))[0];
}

function chooseQuote(quotes, bookingId) {
  const all = quotesFor(quotes, bookingId);
  return all.find((q) => q.status === 'accepted') || all[0] || null;
}

function historyAt(booking, event) {
  const hit = booking && (booking.history || []).find((h) => h.event === event);
  return hit ? hit.at : null;
}

function stageFor(enquiry, quote, install, nowStampStr) {
  const qs = quote ? quoteStatus(quote, nowStampStr) : null;
  if (quote && quote.status === 'accepted') {
    if (install && install.status === 'done') return 'done';
    if (install && (install.status === 'confirmed' || install.status === 'on_the_way')) return 'install';
    return 'accepted';
  }
  if (enquiry.status === 'cancelled') return 'lost';
  if (qs === 'declined' || qs === 'expired') return 'lost';
  if (enquiry.status === 'done' || qs === 'sent' || qs === 'viewed') return 'quote';
  if (enquiry.status === 'confirmed' || enquiry.status === 'on_the_way') return 'survey';
  return 'enquiry';
}

function buildJourneys(state, nowStampStr) {
  const quotes = state.quotes || {};
  const journeys = [];
  const usedInstalls = new Set();
  for (const enquiry of state.bookings.filter(isEnquiry)) {
    const quote = chooseQuote(quotes, enquiry.id);
    const install = pickInstall(state.bookings, quote);
    if (install) usedInstalls.add(install.id);
    journeys.push({ enquiry, quote, install, standalone: false, stage: stageFor(enquiry, quote, install, nowStampStr) });
  }
  for (const b of state.bookings) {
    if (b.serviceId !== 'ev' || usedInstalls.has(b.id)) continue;
    const quote = b.quoteId ? quotes[b.quoteId] : null;
    if (quote && state.bookings.some((x) => x.id === quote.bookingId && isEnquiry(x))) continue; // belongs to a journey (a duplicate install of one)
    const stage = b.status === 'done' ? 'done' : b.status === 'cancelled' ? 'lost' : 'install';
    journeys.push({ enquiry: null, quote: null, install: b, standalone: true, stage });
  }
  return journeys;
}

function valueFor(j) {
  const quoteValue = j.quote ? quoteTotal(j.quote) : 0;
  if (j.stage === 'done') return j.install ? priceOf(j.install) || quoteValue : quoteValue;
  if (j.standalone) return j.install ? priceOf(j.install) : 0;
  if ((j.stage === 'accepted' || j.stage === 'install') && !quoteValue && j.install) return priceOf(j.install);
  return quoteValue;
}

function stageSinceFor(j, nowStampStr) {
  const e = j.enquiry;
  const q = j.quote;
  const i = j.install;
  switch (j.stage) {
    case 'enquiry': return e.createdAt;
    case 'survey': return historyAt(e, 'confirmed') || e.createdAt;
    case 'quote':
      if (q && (q.status === 'sent' || q.status === 'viewed') && q.sentAt) return q.sentAt;
      return historyAt(e, 'done') || bookingEndStamp(e) || e.createdAt;
    case 'accepted': return (q && q.acceptedAt) || (i && i.createdAt) || e.createdAt;
    case 'install': return j.standalone ? i.createdAt : (i && historyAt(i, 'confirmed')) || (q && q.acceptedAt) || i.createdAt;
    case 'done': return historyAt(i, 'done') || bookingEndStamp(i) || i.createdAt;
    default: {
      if (j.standalone) return historyAt(i, 'cancelled') || i.createdAt;
      if (e.status === 'cancelled') return historyAt(e, 'cancelled') || historyAt(e, 'declined') || e.createdAt;
      if (q && q.declinedAt) return q.declinedAt;
      if (q && q.validUntil) return `${q.validUntil}T23:59`;
      return e.createdAt;
    }
  }
}

function summaryFor(j, nowStampStr) {
  const e = j.enquiry;
  const q = j.quote;
  const i = j.install;
  const total = q ? gbp(quoteTotal(q)) : '';
  switch (j.stage) {
    case 'enquiry': {
      if (isUnscheduled(e)) return 'No survey time yet';
      const answers = e.answers || {};
      const timing = answers.timing && ENQUIRY_ANSWER_SHORT.timing[answers.timing];
      const base = e.tentative ? `Survey pencilled in ${bookingWhen(e)}` : `Survey ${bookingWhen(e)}`;
      return timing ? `${base}. Wants it ${timing}` : base;
    }
    case 'survey': return `Survey ${bookingWhen(e)}`;
    case 'quote': {
      const qs = q ? quoteStatus(q, nowStampStr) : null;
      if (!q) return 'Survey done, quote to write';
      if (qs === 'draft') return `Draft quote ${total}, not sent yet`;
      if (qs === 'viewed') return `Quote ${total} viewed by the customer`;
      return `Quote ${total} sent, not opened yet`;
    }
    case 'accepted':
      return i && i.status === 'new' && !isUnscheduled(i) ? `Accepted ${total}. Install pencilled in ${bookingWhen(i)}` : `Accepted ${total}. Install day to arrange`;
    case 'install': return `Install ${bookingWhen(i)}`;
    case 'done': {
      const day = fmtDayShort(stampDay(i.start));
      return `Installed ${day}, ${i.paid ? 'paid' : 'to collect'} ${gbp(priceOf(i))}`;
    }
    default: {
      if (j.standalone) return 'Install cancelled';
      if (e.status === 'cancelled') return e.cancelledBy === 'customer' ? 'Cancelled by the customer' : 'Declined';
      if (q && quoteStatus(q, nowStampStr) === 'declined') return q.declineReason ? `Quote declined: ${q.declineReason}` : 'Quote declined';
      if (q && quoteStatus(q, nowStampStr) === 'expired') return `Quote ${total} expired`;
      return 'Lost';
    }
  }
}

function itemFor(j, replyHours, nowStampStr) {
  const base = j.enquiry || j.install;
  const stageSince = stageSinceFor(j, nowStampStr);
  const refBooking = j.enquiry || j.install;
  return {
    bookingId: base.id,
    installBookingId: j.install ? j.install.id : null,
    quoteId: j.quote ? j.quote.id : null,
    ref: refBooking.ref,
    stage: j.stage,
    customerName: base.customer.name,
    postcode: base.address.postcode,
    customerKey: toWaDigits(base.customer.phone),
    value: valueFor(j),
    ageMinutes: Math.max(0, minutesBetween(stageSince, nowStampStr)),
    stageSince,
    sla: j.stage === 'enquiry' && waitingForReply(j.enquiry) ? slaFlag(j.enquiry, replyHours, nowStampStr) : null,
    summary: summaryFor(j, nowStampStr),
    leadSource: leadSourceOf(base),
    quoteStatus: j.quote ? quoteStatus(j.quote, nowStampStr) : null,
    standalone: j.standalone,
    paid: j.stage === 'done' && j.install ? !!j.install.paid : null
  };
}

// What needs attention first in each stage: the oldest enquiry, the next survey, the longest-waiting quote; the newest finished job.
const STAGE_ORDER = {
  enquiry: (a, b) => cmpStr(a.stageSince, b.stageSince),
  survey: (a, b) => cmpStr(a.when, b.when),
  quote: (a, b) => cmpStr(a.stageSince, b.stageSince),
  accepted: (a, b) => cmpStr(a.stageSince, b.stageSince),
  install: (a, b) => cmpStr(a.when, b.when),
  done: (a, b) => cmpStr(b.stageSince, a.stageSince),
  lost: (a, b) => cmpStr(b.stageSince, a.stageSince)
};

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function startOf(j) {
  if (j.stage === 'survey') return j.enquiry.start;
  if (j.stage === 'install') return j.install.start;
  return '';
}

export function selectPipeline(state, nowStampStr = nowStamp()) {
  const replyHours = replyHoursOf(state);
  const journeys = buildJourneys(state, nowStampStr);
  const decorated = journeys.map((j) => ({ ...itemFor(j, replyHours, nowStampStr), when: startOf(j) }));
  const stages = PIPELINE_STAGES.filter((s) => s.id !== 'lost').map((def) => {
    const items = decorated.filter((it) => it.stage === def.id).sort(STAGE_ORDER[def.id]).map(({ when, ...item }) => item);
    return { id: def.id, label: def.label, hint: def.hint, items, count: items.length, value: items.reduce((t, it) => t + it.value, 0) };
  });
  const lost = decorated.filter((it) => it.stage === 'lost').sort(STAGE_ORDER.lost).map(({ when, ...item }) => item);
  const open = stages.filter((s) => s.id !== 'done').reduce((t, s) => t + s.value, 0);
  return {
    stages,
    lost,
    lostCount: lost.length,
    lostValue: lost.reduce((t, it) => t + it.value, 0),
    totalCount: stages.reduce((t, s) => t + s.count, 0) + lost.length,
    openValue: open
  };
}

/** The enquiry, its quote and its install for any booking in the chain (the enquiry, the install, or a standalone install). */
export function selectJourney(state, bookingId, nowStampStr = nowStamp()) {
  const hit = buildJourneys(state, nowStampStr).find((j) => (j.enquiry && j.enquiry.id === bookingId) || (j.install && j.install.id === bookingId));
  return hit ? { stage: hit.stage, enquiry: hit.enquiry, quote: hit.quote, install: hit.install, standalone: hit.standalone } : null;
}

// ---------- ranges ----------

export const RANGE_PRESETS = [
  { id: 'all', label: 'All time' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: '3m', label: 'Last 3 months' }
];

const firstOfMonth = (day) => `${day.slice(0, 7)}-01`;

/** A range spec -> { from, to, preset } (day keys, inclusive; null = open). */
export function resolveRange(range, nowStampStr = nowStamp()) {
  const today = stampDay(nowStampStr);
  if (range && typeof range === 'object') {
    return { from: isDayKey(range.from) ? range.from : null, to: isDayKey(range.to) ? range.to : null, preset: null };
  }
  switch (range) {
    case '7d': return { from: addDays(today, -6), to: today, preset: '7d' };
    case '30d': return { from: addDays(today, -29), to: today, preset: '30d' };
    case '90d': return { from: addDays(today, -89), to: today, preset: '90d' };
    case 'month': return { from: firstOfMonth(today), to: today, preset: 'month' };
    case 'last_month': {
      const lastDay = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(lastDay), to: lastDay, preset: 'last_month' };
    }
    case '3m': {
      const prev = addDays(firstOfMonth(today), -1);
      return { from: firstOfMonth(addDays(firstOfMonth(prev), -1)), to: today, preset: '3m' };
    }
    default: return { from: null, to: null, preset: 'all' };
  }
}

const inRange = (day, r) => (!r.from || day >= r.from) && (!r.to || day <= r.to);

// ---------- lead sources and cost per lead ----------

function emptyRow(id) {
  return { id, label: LEAD_SOURCE_LABELS[id], enquiries: 0, quotes: 0, accepted: 0, installs: 0, revenue: 0, sharePct: 0, winPct: null };
}

function tally(journeys) {
  const rows = new Map(LEAD_SOURCES.map((id) => [id, emptyRow(id)]));
  for (const j of journeys) {
    const row = rows.get(leadSourceOf(j.enquiry));
    row.enquiries += 1;
    if (j.quote && j.quote.sentAt) row.quotes += 1;
    if (j.quote && j.quote.status === 'accepted') row.accepted += 1;
    if (j.install && j.install.status === 'done') {
      row.installs += 1;
      row.revenue += priceOf(j.install);
    }
  }
  return rows;
}

function enquiryJourneys(state, r, nowStampStr) {
  return buildJourneys(state, nowStampStr).filter((j) => j.enquiry && inRange(stampDay(j.enquiry.createdAt), r));
}

export function selectLeadSources(state, range, nowStampStr = nowStamp()) {
  const r = resolveRange(range, nowStampStr);
  const journeys = enquiryJourneys(state, r, nowStampStr);
  const rows = tally(journeys);
  const total = { enquiries: journeys.length, quotes: 0, accepted: 0, installs: 0, revenue: 0 };
  for (const row of rows.values()) {
    total.quotes += row.quotes;
    total.accepted += row.accepted;
    total.installs += row.installs;
    total.revenue += row.revenue;
  }
  const sources = LEAD_SOURCES.map((id, index) => ({ row: rows.get(id), index })).map(({ row, index }) => {
    row.sharePct = total.enquiries ? Math.round((100 * row.enquiries) / total.enquiries) : 0;
    row.winPct = row.quotes ? Math.round((100 * row.accepted) / row.quotes) : null;
    return { row, index };
  });
  sources.sort((a, b) => b.row.enquiries - a.row.enquiries || a.index - b.index);
  return { range: r, total, sources: sources.map((s) => s.row) };
}

function monthsBetween(fromMonth, toMonth) {
  const months = [];
  let day = `${fromMonth}-01`;
  for (let guard = 0; guard < 240 && monthKeyOf(day) <= toMonth; guard += 1) {
    months.push(monthKeyOf(day));
    day = addDays(firstOfMonth(addDays(day, 31)), 0);
  }
  return months;
}

const lastDayOfMonth = (monthKey) => addDays(firstOfMonth(addDays(`${monthKey}-01`, 31)), -1);
const perLead = (spend, count) => (spend > 0 && count > 0 ? Math.round(spend / count) : null);

export function selectCostPerLead(state, range, nowStampStr = nowStamp()) {
  const today = stampDay(nowStampStr);
  const base = resolveRange(range, nowStampStr);
  const entries = (state.settings.marketing && state.settings.marketing.adSpend) || [];
  const fromMonth = base.from ? monthKeyOf(base.from) : null;
  const toMonth = base.to ? monthKeyOf(base.to) : null;
  const inMonths = entries.filter((e) => (!fromMonth || e.month >= fromMonth) && (!toMonth || e.month <= toMonth));
  const r = {
    from: fromMonth ? `${fromMonth}-01` : null,
    to: toMonth ? (lastDayOfMonth(toMonth) < today ? lastDayOfMonth(toMonth) : today) : null,
    preset: base.preset
  };
  let months;
  if (fromMonth && toMonth) months = monthsBetween(fromMonth, toMonth);
  else months = [...new Set(inMonths.map((e) => e.month))].sort();
  const spend = inMonths.reduce((t, e) => t + e.amount, 0);
  const byChannelSpend = Object.fromEntries(AD_CHANNELS.map((c) => [c, inMonths.filter((e) => e.channel === c).reduce((t, e) => t + e.amount, 0)]));
  const rows = tally(enquiryJourneys(state, r, nowStampStr));
  // Ad spend only buys leads from the channels it was spent on: a channel with no spend (organic Google, say) is left out.
  const adSources = AD_CHANNELS.filter((c) => byChannelSpend[c] > 0);
  const sum = (key) => adSources.reduce((t, id) => t + rows.get(id)[key], 0);
  const adEnquiries = sum('enquiries');
  const adAccepted = sum('accepted');
  const adInstalls = sum('installs');
  return {
    range: r,
    months,
    spend,
    hasSpend: spend > 0,
    adEnquiries,
    adAccepted,
    adInstalls,
    costPerEnquiry: perLead(spend, adEnquiries),
    costPerAccepted: perLead(spend, adAccepted),
    costPerInstall: perLead(spend, adInstalls),
    byChannel: AD_CHANNELS.map((channel) => {
      const row = rows.get(channel);
      return {
        channel,
        label: AD_CHANNEL_LABELS[channel],
        spend: byChannelSpend[channel],
        enquiries: row.enquiries,
        accepted: row.accepted,
        installs: row.installs,
        costPerEnquiry: perLead(byChannelSpend[channel], row.enquiries),
        costPerInstall: perLead(byChannelSpend[channel], row.installs)
      };
    })
  };
}

// ---------- quotes ----------

export function selectQuoteStats(state, range, nowStampStr = nowStamp()) {
  const r = resolveRange(range, nowStampStr);
  const all = Object.values(state.quotes || {});
  const sentInRange = all.filter((q) => q.sentAt && inRange(stampDay(q.sentAt), r));
  const count = (status) => sentInRange.filter((q) => quoteStatus(q, nowStampStr) === status).length;
  const accepted = sentInRange.filter((q) => q.status === 'accepted');
  const accepted_n = accepted.length;
  const declined = count('declined');
  const expired = count('expired');
  const decided = accepted_n + declined + expired;
  const waiting = all.filter((q) => ['sent', 'viewed'].includes(quoteStatus(q, nowStampStr)));
  const drafts = all.filter((q) => q.status === 'draft');
  return {
    range: r,
    sent: sentInRange.length,
    accepted: accepted_n,
    declined,
    expired,
    decided,
    winRatePct: decided ? Math.round((100 * accepted_n) / decided) : null,
    avgAcceptedValue: accepted_n ? Math.round(accepted.reduce((t, q) => t + quoteTotal(q), 0) / accepted_n) : 0,
    waitingCount: waiting.length,
    waitingValue: waiting.reduce((t, q) => t + quoteTotal(q), 0),
    draftCount: drafts.length,
    draftValue: drafts.reduce((t, q) => t + quoteTotal(q), 0)
  };
}

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);

export function selectQuotes(state) {
  return Object.values(state.quotes || {}).sort(newestFirst);
}

export function selectQuote(state, id) {
  return own(state.quotes, id);
}

export function selectQuotesForBooking(state, bookingId) {
  return quotesFor(state.quotes, bookingId);
}

export function selectQuoteForBooking(state, bookingId) {
  return latestQuoteFor(state.quotes, bookingId);
}

/** Rows for the Quotes list. `status`: an effective status, 'waiting' (sent or viewed, not expired), or 'all' / undefined. */
export function selectQuoteList(state, { status, nowStamp: now } = {}) {
  const nowStampStr = now || nowStamp();
  const rows = [];
  for (const quote of selectQuotes(state)) {
    const effective = quoteStatus(quote, nowStampStr);
    if (status && status !== 'all') {
      if (status === 'waiting' ? effective !== 'sent' && effective !== 'viewed' : effective !== status) continue;
    }
    const booking = state.bookings.find((b) => b.id === quote.bookingId) || null;
    rows.push({
      quote,
      status: effective,
      total: quoteTotal(quote),
      bookingId: quote.bookingId,
      ref: booking ? booking.ref : '',
      customerName: quote.customerName,
      ageMinutes: Math.max(0, minutesBetween(quote.sentAt || quote.createdAt, nowStampStr)),
      expiresInDays: quoteExpiresInDays(quote, nowStampStr),
      installBookingId: quote.installBookingId || null
    });
  }
  return rows;
}

/** Everything the customer quote page (and the owner's quote detail) needs about one quote. Null for an unknown id. */
export function selectQuoteDetail(state, id, nowStampStr = nowStamp()) {
  const quote = selectQuote(state, id);
  if (!quote) return null;
  const booking = state.bookings.find((b) => b.id === quote.bookingId) || null;
  const install = quote.installBookingId ? state.bookings.find((b) => b.id === quote.installBookingId) || null : null;
  const status = quoteStatus(quote, nowStampStr);
  const open = status === 'sent' || status === 'viewed';
  return {
    quote,
    status,
    total: quoteTotal(quote),
    // `lines` = the FIXED lines (what `total` adds up), `extras` = the possible extras (optional lines, never counted), `allLines` = every line in order.
    ...splitLines(quote),
    customerFirst: firstName(quote.customerName),
    ref: booking ? booking.ref : '',
    address: booking ? addressLine(booking.address) : '',
    validUntil: quote.validUntil,
    validUntilLabel: quote.validUntil ? fmtDayShort(quote.validUntil) : '',
    expiresInDays: quoteExpiresInDays(quote, nowStampStr),
    canAccept: open,
    canDecline: open,
    isExpired: status === 'expired',
    installBooking: install,
    installWhen: install ? bookingWhenArrival(install) : '' // the customer's quote page: the arrival window, as in their messages
  };
}
