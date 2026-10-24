// js/core/availability.js: the window and slot engine (four fixed two-hour windows, half-day jobs)
// Owner: WP1
import { now as clockNow } from './clock.js';
import { WINDOWS, HALF_DAY_STARTS } from './config.js';
import {
  addDays, addMinutes, fmtDayShort, fmtRelativeDay, isDayKey, makeStamp, stampDay, stampTime, toStamp, weekdayOf, DAY_SHORT
} from './dates.js';

/** @typedef {'free'|'booked'|'blocked'|'closed'|'full'|'too_soon'|'past'} SlotState */

// Precedence of 9.2: the first state that matches wins; for a half-day pair the lower index wins.
const STATE_ORDER = ['past', 'booked', 'closed', 'blocked', 'full', 'too_soon', 'free'];

function ctxFor(state, opts = {}) {
  const settings = state.settings;
  const nowStampStr = toStamp(opts.now || clockNow());
  const today = stampDay(nowStampStr);
  const maxDaysAhead = Number.isInteger(settings.maxDaysAhead) ? settings.maxDaysAhead : 14;
  return {
    settings,
    nowStamp: nowStampStr,
    today,
    lastCustomerDay: addDays(today, maxDaysAhead - 1),
    ownerMode: !!opts.ownerMode,
    ignoreBookingId: opts.ignoreBookingId || null,
    bookings: Array.isArray(state.bookings) ? state.bookings : [],
    blocks: Array.isArray(state.blocks) ? state.blocks : []
  };
}

function blocksOf(settings, serviceOrBlocks) {
  if (serviceOrBlocks === 1 || serviceOrBlocks === 2) return serviceOrBlocks;
  if (typeof serviceOrBlocks === 'string') {
    const svc = (settings.services || []).find((s) => s.id === serviceOrBlocks);
    // CONTRACT-GAP: an unknown service id, or the emergency service (blocks 0), falls back to one window.
    if (svc && (svc.blocks === 1 || svc.blocks === 2)) return svc.blocks;
  }
  return 1;
}

/** Window ids covered by a booking (derived from start + durationMin). Urgent bookings cover none. */
export function bookingWindowIds(booking) {
  if (!booking || booking.urgent || !(booking.durationMin > 0)) return [];
  const startMin = Number(stampTime(booking.start).slice(0, 2)) * 60 + Number(stampTime(booking.start).slice(3, 5));
  const endMin = startMin + booking.durationMin;
  return WINDOWS.filter((w) => w.startMin < endMin && w.endMin > startMin).map((w) => w.id);
}

/** start + durationMin; urgent: start. */
export function bookingEndStamp(booking) {
  if (!booking || booking.urgent || !(booking.durationMin > 0)) return booking ? booking.start : '';
  return addMinutes(booking.start, booking.durationMin);
}

function isLive(b) {
  return b.status !== 'cancelled' && !b.urgent;
}

/** The id of the booking occupying (date, windowId), or null. */
export function occupiedBy(state, date, windowId, { ignoreBookingId } = {}) {
  for (const b of state.bookings || []) {
    if (!isLive(b) || b.id === ignoreBookingId) continue;
    if (stampDay(b.start) !== date) continue;
    if (bookingWindowIds(b).includes(windowId)) return b.id;
  }
  return null;
}

function windowState(c, date, windowId) {
  const w = WINDOWS[windowId];
  const startStamp = makeStamp(date, w.start);
  const endStamp = makeStamp(date, w.end);
  if (endStamp <= c.nowStamp) return { state: 'past', bookingId: null, blockLabel: null };
  const occupant = occupiedBy({ bookings: c.bookings }, date, windowId, { ignoreBookingId: c.ignoreBookingId });
  if (occupant) return { state: 'booked', bookingId: occupant, blockLabel: null };
  const hours = c.settings.hours[weekdayOf(date)] || [];
  const dayOff = (c.settings.daysOff || []).some((d) => d.date === date);
  if ((!c.ownerMode && date > c.lastCustomerDay) || dayOff || !hours.includes(windowId)) {
    return { state: 'closed', bookingId: null, blockLabel: null };
  }
  const block = c.blocks.find((b) => b.date === date && b.windowId === windowId);
  if (block) return { state: 'blocked', bookingId: null, blockLabel: block.label || 'Blocked' };
  if (!c.ownerMode && (c.settings.fullDays || []).includes(date)) return { state: 'full', bookingId: null, blockLabel: null };
  if (!c.ownerMode && startStamp < addMinutes(c.nowStamp, c.settings.leadMinutes)) {
    return { state: 'too_soon', bookingId: null, blockLabel: null };
  }
  return { state: 'free', bookingId: null, blockLabel: null };
}

function slotInfo(c, date, windowId, blocks) {
  const covered = blocks === 2 ? [windowId, windowId + 1] : [windowId];
  const parts = covered.map((id) => windowState(c, date, id));
  let best = parts[0];
  for (const p of parts) if (STATE_ORDER.indexOf(p.state) < STATE_ORDER.indexOf(best.state)) best = p;
  const first = WINDOWS[windowId];
  const last = WINDOWS[covered[covered.length - 1]];
  let label = first.label;
  if (blocks === 2) label = windowId === 0 ? `Morning · arrive ${first.label}` : `Afternoon · arrive ${first.label}`;
  return {
    date,
    windowId,
    blocks,
    startsAt: makeStamp(date, first.start),
    endsAt: makeStamp(date, last.end),
    label,
    arriveLabel: first.label,
    state: best.state,
    bookingId: best.state === 'booked' ? best.bookingId : null,
    blockLabel: best.state === 'blocked' ? best.blockLabel : null
  };
}

function startsFor(blocks) {
  return blocks === 2 ? HALF_DAY_STARTS : WINDOWS.map((w) => w.id);
}

/** All slots of a day for a service: 4 single windows, or the 2 half-day starts. Closed ones included. */
export function getDaySlots(state, date, serviceOrBlocks, opts = {}) {
  const c = ctxFor(state, opts);
  const blocks = blocksOf(state.settings, serviceOrBlocks);
  return startsFor(blocks).map((id) => slotInfo(c, date, id, blocks));
}

function isTodayAllPast(c, date, open) {
  return date === c.today && open.length > 0 && open.every((id) => makeStamp(date, WINDOWS[id].end) <= c.nowStamp);
}

/** { kind: 'past'|'beyond'|'dayoff'|'closed'|'full'|'open', label } */
export function getDayStatus(state, date, opts = {}) {
  const c = ctxFor(state, opts);
  if (date < c.today) return { kind: 'past', label: '' };
  if (!c.ownerMode && date > c.lastCustomerDay) return { kind: 'beyond', label: '' };
  const off = (c.settings.daysOff || []).find((d) => d.date === date);
  if (off) return { kind: 'dayoff', label: off.label || 'Day off' };
  const open = c.settings.hours[weekdayOf(date)] || [];
  if (open.length === 0 || isTodayAllPast(c, date, open)) return { kind: 'closed', label: 'Closed' };
  if (!c.ownerMode && (c.settings.fullDays || []).includes(date)) return { kind: 'full', label: 'Full' };
  return { kind: 'open', label: '' };
}

function loadFor(c, date) {
  const closed = { free: 0, total: 0, level: 'closed' };
  if (date < c.today) return closed;
  if (!c.ownerMode && date > c.lastCustomerDay) return closed;
  if ((c.settings.daysOff || []).some((d) => d.date === date)) return closed;
  const open = c.settings.hours[weekdayOf(date)] || [];
  if (open.length === 0 || isTodayAllPast(c, date, open)) return closed;
  const free = open.filter((id) => windowState(c, date, id).state === 'free').length;
  const level = free === 0 ? 'full' : free === 1 ? 'few' : 'good';
  return { free, total: open.length, level };
}

/** Single-window load for the CUSTOMER view of a day: { free, total, level: 'good'|'few'|'full'|'closed' } */
export function getDayLoad(state, date, opts = {}) {
  return loadFor(ctxFor(state, opts), date);
}

/** [{ date, status, load, freeSlots }] from today. `freeSlots` is per SERVICE (half-day jobs count half-days). */
export function getBookableDays(state, { count, serviceOrBlocks = 1, now, ownerMode } = {}) {
  const opts = { now, ownerMode };
  const c = ctxFor(state, opts);
  const blocks = blocksOf(state.settings, serviceOrBlocks);
  const n = Number.isInteger(count) ? count : c.settings.maxDaysAhead;
  const days = [];
  for (let i = 0; i < n; i += 1) {
    const date = addDays(c.today, i);
    const freeSlots = startsFor(blocks).filter((id) => slotInfo(c, date, id, blocks).state === 'free').length;
    days.push({ date, status: getDayStatus(state, date, opts), load: loadFor(c, date), freeSlots });
  }
  return days;
}

/** 'Today, 3–5pm' | 'Tomorrow, 8–10am' | 'Mon 26 Oct, 8–10am' | half-day: 'Mon 26 Oct, morning, arrive 8–10am' */
export function slotHuman(date, windowId, blocks, todayKeyStr) {
  const day = fmtRelativeDay(date, todayKeyStr);
  const label = WINDOWS[windowId].label;
  if (blocks === 2) return `${day}, ${windowId === 0 ? 'morning' : 'afternoon'}, arrive ${label}`;
  return `${day}, ${label}`;
}

function describeSlot(c, info) {
  return {
    date: info.date,
    windowId: info.windowId,
    blocks: info.blocks,
    startsAt: info.startsAt,
    endsAt: info.endsAt,
    label: info.label,
    arriveLabel: info.arriveLabel,
    human: slotHuman(info.date, info.windowId, info.blocks, c.today)
  };
}

// CONTRACT-GAP: owner mode searches the same maxDaysAhead days as customer mode (it only relaxes the per-window rules).
/** Up to `count` free slots in time order, searching today .. today + maxDaysAhead - 1. */
export function nextFreeSlots(state, serviceOrBlocks, count = 3, opts = {}) {
  const c = ctxFor(state, opts);
  const blocks = blocksOf(state.settings, serviceOrBlocks);
  const out = [];
  for (let i = 0; i < c.settings.maxDaysAhead && out.length < count; i += 1) {
    const date = addDays(c.today, i);
    for (const id of startsFor(blocks)) {
      if (out.length >= count) break;
      const info = slotInfo(c, date, id, blocks);
      if (info.state === 'free') out.push(describeSlot(c, info));
    }
  }
  return out;
}

export function nextFreeSlot(state, serviceOrBlocks, opts = {}) {
  return nextFreeSlots(state, serviceOrBlocks, 1, opts)[0] || null;
}

/** True when the slot's combined state is 'free'. Bad dates and window ids are simply not free. */
export function isSlotFree(state, { date, windowId, blocks = 1, ignoreBookingId, ownerMode, now } = {}) {
  if (!isDayKey(date) || !Number.isInteger(windowId) || windowId < 0 || windowId > 3) return false;
  if (blocks === 2 && !HALF_DAY_STARTS.includes(windowId)) return false;
  const c = ctxFor(state, { now, ownerMode, ignoreBookingId });
  return slotInfo(c, date, windowId, blocks === 2 ? 2 : 1).state === 'free';
}

/** 0..3 when the time of the stamp is exactly a window start, else null. */
export function windowIdFromStart(stamp) {
  const t = stampTime(stamp);
  const w = WINDOWS.find((x) => x.start === t);
  return w ? w.id : null;
}

/** '8–10am' | 'Morning · arrive 8–10am' | 'Afternoon · arrive 1–3pm' | 'ASAP' (urgent) */
export function bookingWindowLabel(booking) {
  if (booking.urgent) return 'ASAP';
  const ids = bookingWindowIds(booking);
  if (ids.length === 0) return stampTime(booking.start);
  const first = WINDOWS[ids[0]];
  if (ids.length === 1) return first.label;
  return ids[0] === 0 ? `Morning · arrive ${first.label}` : `Afternoon · arrive ${first.label}`;
}

/** 'Sat 24 Oct, 8–10am' | 'Mon 26 Oct, morning, 8–10am' | 'ASAP' */
export function bookingWhen(booking) {
  if (booking.urgent) return 'ASAP';
  const ids = bookingWindowIds(booking);
  const day = fmtDayShort(stampDay(booking.start));
  if (ids.length === 0) return `${day}, ${stampTime(booking.start)}`;
  const first = WINDOWS[ids[0]];
  if (ids.length === 1) return `${day}, ${first.label}`;
  return `${day}, ${ids[0] === 0 ? 'morning' : 'afternoon'}, ${first.label}`;
}

function hourText(hhmm) {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === '00' ? `${h12}${suffix}` : `${h12}:${m}${suffix}`;
}

/** 'Mon to Fri 8am to 5pm, Sat 8am to 12pm'. Consecutive weekdays with the same open windows are grouped. */
export function describeHours(hours) {
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  const groups = [];
  for (const wd of order) {
    const open = (hours && hours[wd]) || [];
    if (open.length === 0) continue;
    const key = [...open].sort((a, b) => a - b).join(',');
    const last = groups[groups.length - 1];
    const lastIdx = last ? order.indexOf(last.days[last.days.length - 1]) : -2;
    if (last && last.key === key && lastIdx === order.indexOf(wd) - 1) last.days.push(wd);
    else groups.push({ key, days: [wd], open: [...open].sort((a, b) => a - b) });
  }
  if (groups.length === 0) return 'Closed';
  return groups.map((g) => {
    const from = DAY_SHORT[g.days[0]];
    const to = DAY_SHORT[g.days[g.days.length - 1]];
    const days = g.days.length === 1 ? from : `${from} to ${to}`;
    const start = WINDOWS[g.open[0]].start;
    const end = WINDOWS[g.open[g.open.length - 1]].end;
    return `${days} ${hourText(start)} to ${hourText(end)}`;
  }).join(', ');
}
