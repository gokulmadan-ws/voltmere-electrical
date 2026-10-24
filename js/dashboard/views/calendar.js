// js/dashboard/views/calendar.js: Calendar view (week strip, window rows, block / unblock / day off, add a booking from a free window; week grid from 768px).
// Owner: WP6
import { html, h, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Banner, Button, Chip, ConfirmDialog, Field, Icon, IconButton, Input, PageHeader, Segmented, Sheet, StatusPill, Switch, TextLink,
  cx, pageHref, pageTarget, showUndoToast, toast, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { WINDOWS } from '../../core/config.js';
import { todayKey } from '../../core/clock.js';
import { DAY_SHORT, addDays, fmtDayLong, fmtDayShort, isDayKey, weekDates, weekdayOf } from '../../core/dates.js';
import { firstName, plural } from '../../core/format.js';
import { bookingWindowIds, bookingWindowLabel, getDayLoad, getDaySlots, getDayStatus } from '../../core/availability.js';
import { selectBookingsOn } from '../../core/selectors.js';
import {
  addBlock, addDaysOff, blockRange, getState, removeBlock, removeBlockGroup, removeDayOff, setDayFull
} from '../../core/store.js';
import { navigate, routeHref } from '../router.js';

export const title = 'Calendar';
export const css = ['css/calendar.css'];

// Stable selector for useStore: the calendar depends on bookings, blocks and settings, so it takes the whole state.
const selectAll = (state) => state;

const GENERIC_FAIL = 'That did not work: the diary changed. Please check and try again.';
const LEVEL_TEXT = { good: 'Plenty free', few: '1 left', full: 'Full', closed: 'Closed' };
const STATUS_ICON = { new: 'bell', confirmed: 'calendar-check', on_the_way: 'navigation', done: 'badge-check', cancelled: 'ban' };
const BLOCK_PRESETS = [
  { id: 'dentist', label: 'Dentist' },
  { id: 'mot', label: 'Van MOT' },
  { id: 'supplier', label: 'Supplier run' },
  { id: 'other', label: 'Other' }
];
// Table row index of each window (the lunch gap is row 2) and the window shown on each row.
const ROW_OF = { 0: 0, 1: 1, 2: 3, 3: 4 };
const WINDOW_AT_ROW = [0, 1, null, 2, 3];

// ---------- pure helpers ----------

const dayNumber = (date) => Number(date.slice(8, 10));
const modOf = (status) => String(status).replace(/_/g, '-');

function notify(message, undoToken) {
  if (undoToken) showUndoToast(message, undoToken);
  else toast({ message });
}

function failToast(res) {
  toast({ message: GENERIC_FAIL, tone: 'danger' });
  return res;
}

/** Is this window open for business that day (in the weekday's hours and the day is not a day off)? */
function windowIsOpen(state, date, windowId) {
  if (state.settings.daysOff.some((d) => d.date === date)) return false;
  return (state.settings.hours[weekdayOf(date)] || []).includes(windowId);
}

/** How many windows the owner can see in a block's group (a range over a Sunday also stores hidden blocks on closed windows). */
function groupWindowCount(state, block) {
  if (!block.groupId) return 1;
  return state.blocks.filter((b) => b.groupId === block.groupId && windowIsOpen(state, b.date, b.windowId)).length;
}

/** Left-rail label: one window reads '8–10am'; a half-day job reads '8–12' or '1–5'. */
function railLabel(ids) {
  if (ids.length < 2) return WINDOWS[ids[0]].label;
  const from = WINDOWS[ids[0]].short.split('–')[0];
  const to = WINDOWS[ids[ids.length - 1]].short.split('–')[1];
  return `${from}–${to}`;
}

/** What the strip chip (and the grid column heading) shows for one day, from the CUSTOMER view of availability. */
function dayInfo(state, date, today) {
  const jobs = selectBookingsOn(state, date).length;
  const status = getDayStatus(state, date);
  const load = getDayLoad(state, date);
  let dot = load.level === 'closed' ? 'hatch' : load.level;
  let word = '';
  let spoken = LEVEL_TEXT[load.level] || '';
  if (status.kind === 'past') { dot = 'none'; spoken = 'past'; }
  else if (status.kind === 'dayoff') { dot = 'hatch'; word = 'Off'; spoken = 'day off'; }
  else if (status.kind === 'closed') { dot = 'hatch'; word = 'Closed'; spoken = 'closed'; }
  else if (status.kind === 'beyond') { dot = 'hatch'; word = 'Later'; spoken = 'not open to customers yet'; }
  return {
    date,
    jobs,
    dot,
    isToday: date === today,
    isPast: status.kind === 'past',
    isFull: dot === 'full',
    caption: jobs > 0 ? plural(jobs, 'job') : (word || plural(0, 'job')),
    label: `${fmtDayShort(date)}, ${plural(jobs, 'job')}, ${spoken}`
  };
}

/**
 * The cells of one day in window order (OWNER view: lead time, full days and the horizon are ignored).
 * kind: 'booked' (a half-day job is ONE cell with two ids), 'blocked', 'free', 'past', 'closed'.
 */
function dayCells(state, date) {
  const slots = getDaySlots(state, date, 1, { ownerMode: true });
  const owner = new Map();
  for (const b of selectBookingsOn(state, date)) {
    if (b.urgent) continue;
    for (const id of bookingWindowIds(b)) if (!owner.has(id)) owner.set(id, b);
  }
  const cells = [];
  const covered = new Set();
  for (const w of WINDOWS) {
    if (covered.has(w.id)) continue;
    const booking = owner.get(w.id);
    if (booking) {
      const ids = bookingWindowIds(booking);
      ids.forEach((id) => covered.add(id));
      cells.push({ kind: 'booked', windowId: ids[0], ids, booking });
      continue;
    }
    const slot = slots[w.id];
    if (slot.state === 'blocked') {
      const block = state.blocks.find((b) => b.date === date && b.windowId === w.id);
      cells.push({ kind: 'blocked', windowId: w.id, ids: [w.id], block: block || { id: '', label: slot.blockLabel || 'Blocked', date, windowId: w.id, groupId: null } });
    } else if (slot.state === 'free') {
      cells.push({ kind: 'free', windowId: w.id, ids: [w.id] });
    } else {
      cells.push({ kind: slot.state === 'past' ? 'past' : 'closed', windowId: w.id, ids: [w.id] });
    }
  }
  return cells;
}

/** Windows of a day that a whole-day block should cover: open and not yet past. */
function blockableIds(state, date) {
  return getDaySlots(state, date, 1, { ownerMode: true })
    .filter((s) => s.state === 'free' || s.state === 'booked' || s.state === 'blocked')
    .map((s) => s.windowId);
}

// ---------- day chip (mobile strip) and grid column heading ----------

function DayChip({ info, selected, onSelect }) {
  const { date } = info;
  return html`<button type="button"
    class=${cx('cal-day', selected && 'is-selected', info.isToday && 'is-today', info.isPast && 'is-past')}
    aria-pressed=${selected} aria-label=${info.label} data-testid=${`calendar-day-${date}`}
    onClick=${() => onSelect(date)}>
    <span class="cal-day__dow" aria-hidden="true">${DAY_SHORT[weekdayOf(date)]}</span>
    <span class=${cx('cal-day__num', info.isFull && 'is-full')} aria-hidden="true">${dayNumber(date)}</span>
    <span class="cal-day__sub" aria-hidden="true">${info.caption}</span>
    <span class=${`cal-day__dot cal-day__dot--${info.dot}`} aria-hidden="true"></span>
  </button>`;
}

// ---------- cell bodies (shared by the phone rows and the week grid) ----------

function BookingCard({ booking, ids, compact }) {
  const who = firstName(booking.customer.name);
  const service = booking.variantLabel ? `${booking.serviceName}, ${booking.variantLabel}` : booking.serviceName;
  const mod = modOf(booking.status);
  if (compact) {
    return html`<a class=${cx('cal-booking', 'cal-booking--compact', `cal-booking--${mod}`)}
      href=${routeHref('bookings', { id: booking.id })} data-testid=${`calendar-booking-${booking.id}`}>
      <span class="cal-booking__who"><${Icon} name=${STATUS_ICON[booking.status] || 'bell'} size=${14} /><span class="cal-booking__name">${who}</span></span>
      <span class="cal-booking__svc">${service}</span>
      <span class="u-sr-only">${`${bookingWindowLabel(booking)}, ${booking.paid === false && booking.status === 'done' ? 'To collect' : booking.status.replace(/_/g, ' ')}`}</span>
    </a>`;
  }
  return html`<a class=${cx('cal-booking', ids.length > 1 && 'cal-booking--half', `cal-booking--${mod}`)}
    href=${routeHref('bookings', { id: booking.id })} data-testid=${`calendar-booking-${booking.id}`}>
    <span class="cal-booking__top">
      <span class="cal-booking__service">${service}</span>
      <${StatusPill} status=${booking.status} paid=${booking.paid} compact />
    </span>
    <span class="cal-booking__meta">${`${who} · ${bookingWindowLabel(booking)}`}</span>
  </a>`;
}

function FreeButton({ date, cell, compact, onFree }) {
  const when = `${WINDOWS[cell.windowId].label} on ${fmtDayShort(date)}`;
  return html`<button type="button" class="cal-free" data-testid=${`calendar-window-${date}-${cell.windowId}`} onClick=${() => onFree(date, cell.windowId)}>
    <${Icon} name="plus" size=${20} />
    ${compact
    ? html`<span class="cal-free__text"><strong class="cal-free__word">Free</strong><span class="u-sr-only">${`, ${when}. Tap to add or block`}</span></span>`
    : html`<span class="cal-free__text"><strong class="cal-free__word">Free</strong> · tap to add or block<span class="u-sr-only">${` ${when}`}</span></span>`}
  </button>`;
}

function BlockedButton({ cell, onUnblock }) {
  const { block } = cell;
  return html`<button type="button" class="cal-blocked" data-testid=${`calendar-unblock-${block.id}`} onClick=${() => onUnblock(block)}>
    <${Icon} name="lock" size=${18} />
    <span class="cal-blocked__text">${`Blocked: ${block.label}`}</span>
    <span class="u-sr-only">. Tap to unblock</span>
  </button>`;
}

/** The inside of one cell. Free cells carry their own window test id (it is on the button); the rest get it on the wrapper. */
function CellBody({ date, cell, compact, onFree, onUnblock }) {
  if (cell.kind === 'booked') return html`<${BookingCard} booking=${cell.booking} ids=${cell.ids} compact=${compact} />`;
  if (cell.kind === 'free') return html`<${FreeButton} date=${date} cell=${cell} compact=${compact} onFree=${onFree} />`;
  if (cell.kind === 'blocked') return html`<${BlockedButton} cell=${cell} onUnblock=${onUnblock} />`;
  return html`<div class="cal-muted">${cell.kind === 'past' ? 'Past' : 'Closed'}</div>`;
}

const wrapTestid = (date, cell) => (cell.kind === 'free' ? undefined : `calendar-window-${date}-${cell.windowId}`);

// ---------- phone: the selected day as rows ----------

function DayRows({ date, cells, onFree, onUnblock }) {
  const out = [];
  let lunchDone = false;
  for (const cell of cells) {
    if (!lunchDone && cell.windowId >= 2) {
      lunchDone = true;
      out.push(html`<div class="cal-lunch" role="separator" key="lunch"><span>Lunch</span></div>`);
    }
    out.push(html`<div class=${cx('cal-row', cell.ids.length > 1 && 'cal-row--half')} key=${`w${cell.windowId}`}>
      <div class="cal-row__time">${railLabel(cell.ids)}</div>
      <div class="cal-row__body" data-testid=${wrapTestid(date, cell)}>
        <${CellBody} date=${date} cell=${cell} onFree=${onFree} onUnblock=${onUnblock} />
      </div>
    </div>`);
  }
  return html`<div class="cal-rows">${out}</div>`;
}

// ---------- 768px and up: the week as a grid (rows = windows, columns = days) ----------

function WeekGrid({ state, dates, today, sel, onSelect, onFree, onUnblock }) {
  const days = dates.map((date) => ({ date, info: dayInfo(state, date, today), cells: dayCells(state, date) }));
  // Per column: what goes on each of the five table rows. A half-day job spans two rows ('skip' marks the covered one).
  const columns = days.map(({ cells }) => {
    const rows = [null, null, null, null, null];
    for (const cell of cells) {
      const first = ROW_OF[cell.ids[0]];
      const last = ROW_OF[cell.ids[cell.ids.length - 1]];
      rows[first] = { cell, span: last - first + 1 };
      for (let r = first + 1; r <= last; r += 1) rows[r] = 'skip';
    }
    return rows;
  });
  const bodyRows = [0, 1, 2, 3, 4].map((ri) => {
    if (ri === 2) {
      return html`<tr class="cal-grid__lunchrow" key="lunch">
        <th scope="row" class="cal-grid__rail cal-grid__rail--lunch">Lunch</th>
        ${columns.map((rows, ci) => (rows[ri] === 'skip' ? null : html`<td key=${days[ci].date} class="cal-grid__lunchcell"></td>`))}
      </tr>`;
    }
    const wid = WINDOW_AT_ROW[ri];
    return html`<tr key=${`r${ri}`}>
      <th scope="row" class="cal-grid__rail"><span aria-hidden="true">${WINDOWS[wid].short}</span><span class="u-sr-only">${WINDOWS[wid].label}</span></th>
      ${columns.map((rows, ci) => {
    const slot = rows[ri];
    if (slot === 'skip') return null;
    const { date } = days[ci];
    if (!slot) return html`<td key=${date}></td>`;
    return html`<td key=${date} rowspan=${slot.span > 1 ? slot.span : undefined}
        class=${cx('cal-cell', slot.span > 1 && 'cal-cell--span', date === sel && 'is-col-selected')}
        data-testid=${wrapTestid(date, slot.cell)}>
        <${CellBody} date=${date} cell=${slot.cell} compact onFree=${onFree} onUnblock=${onUnblock} />
      </td>`;
  })}
    </tr>`;
  });
  return html`<table class="cal-grid" data-testid="calendar-grid">
    <caption class="u-sr-only">Week diary: one column per day, one row per arrival window</caption>
    <thead>
      <tr>
        <th scope="col" class="cal-grid__rail"><span class="u-sr-only">Arrival window</span></th>
        ${days.map(({ date, info }) => html`<th scope="col" key=${date} class=${cx('cal-grid__head', date === sel && 'is-col-selected')}>
          <${DayChip} info=${info} selected=${date === sel} onSelect=${onSelect} />
        </th>`)}
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

// ---------- sheets ----------

/** The free-window sheet: add a phone booking, block the time, or take the whole day off. */
function FreeSheet({ slot, onClose, onBlock, onDayOff }) {
  const date = slot ? slot.date : '';
  const windowId = slot ? slot.windowId : 0;
  return html`<${Sheet} open=${!!slot} onClose=${onClose} testid="calendar-free-sheet"
    title=${slot ? `${fmtDayShort(date)}, ${WINDOWS[windowId].label}` : 'Free window'}
    description="This window is free. What would you like to do?">
    <div class="u-stack">
      <${Button} variant="primary" size="lg" block icon="plus" href=${routeHref('new', {}, { date, window: windowId })}
        onClick=${onClose} data-testid="calendar-add-booking">Add booking (phone call)<//>
      <${Button} size="lg" block icon="lock" onClick=${onBlock} data-testid="calendar-block-open">Block this time<//>
      <${Button} size="lg" block icon="calendar-x" onClick=${onDayOff} data-testid="calendar-dayoff-open">Take the whole day off<//>
    </div>
  <//>`;
}

/** The block sheet keeps its own form state; it is mounted only while it is open. */
function BlockSheet({ date, windowId, onClose, onDone }) {
  const [label, setLabel] = useState('Blocked');
  const [otherPicked, setOtherPicked] = useState(false);
  const [scope, setScope] = useState('window');
  const [until, setUntil] = useState(() => addDays(date, 1));
  const presetNow = BLOCK_PRESETS.find((p) => p.id !== 'other' && p.label.toLowerCase() === label.trim().toLowerCase());
  const customText = label.trim() !== '' && label.trim() !== 'Blocked' && !presetNow;
  const isSelected = (p) => (p.id === 'other' ? (otherPicked || customText) : (presetNow && presetNow.id === p.id));

  const pick = (p) => {
    if (p.id === 'other') {
      setOtherPicked(true);
      setLabel('');
      // Input is a function component, so there is no ref to its <input>: find it by id.
      const field = document.getElementById('cal-block-label');
      if (field) field.focus();
    } else {
      setOtherPicked(false);
      setLabel(p.label);
    }
  };

  const submit = () => {
    const text = label.trim() || 'Blocked';
    const state = getState();
    if (scope === 'window') {
      const res = addBlock({ date, windowId, label: text });
      if (res.ok) { notify(`Blocked ${WINDOWS[windowId].label} on ${fmtDayShort(date)}.`, res.undoToken); onDone(); return; }
      if (res.reason === 'booked') { toast({ message: 'That window is already booked, so it cannot be blocked.', tone: 'danger' }); return; }
      failToast(res);
      return;
    }
    const toDate = scope === 'until' && isDayKey(until) && until >= date ? until : date;
    const windowIds = scope === 'day' ? blockableIds(state, date) : [0, 1, 2, 3];
    const res = blockRange({ fromDate: date, toDate, windowIds, label: text });
    if (!res.ok) { failToast(res); return; }
    // Count only windows the owner can see (a range over a Sunday also stores hidden blocks on closed windows).
    const seen = res.added.filter((b) => windowIsOpen(state, b.date, b.windowId)).length;
    const booked = res.skipped.length;
    let message = seen > 0 ? `Blocked ${plural(seen, 'window')}.` : 'Nothing new to block.';
    if (booked > 0) message += ` ${booked} ${booked === 1 ? 'was' : 'were'} already booked.`;
    notify(message, res.added.length > 0 ? res.undoToken : null);
    onDone();
  };

  return html`<${Sheet} open onClose=${onClose} testid="block-sheet" title="Block this time"
    description=${`${fmtDayLong(date)}, ${WINDOWS[windowId].label}. Customers cannot book blocked times. Booked jobs are never touched.`}
    footer=${html`<${Button} variant="primary" size="lg" block onClick=${submit} data-testid="block-confirm">Block<//>`}>
    <div class="u-stack">
      <div class="cal-chips" role="group" aria-label="What is it for?">
        ${BLOCK_PRESETS.map((p) => html`<${Chip} key=${p.id} selected=${!!isSelected(p)} onClick=${() => pick(p)} data-testid=${`block-label-${p.id}`}>${p.label}<//>`)}
      </div>
      <${Field} label="Label" id="cal-block-label">
        <${Input} id="cal-block-label" value=${label} maxlength="40" placeholder="What is it for?" enterkeyhint="done"
          data-testid="block-label" onInput=${(e) => { setOtherPicked(false); setLabel(e.target.value); }} />
      <//>
      <${Segmented} ariaLabel="How much to block" size="sm" value=${scope} onChange=${setScope}
        options=${[
    { value: 'window', label: 'This window', testid: 'block-scope-window' },
    { value: 'day', label: 'Whole day', testid: 'block-scope-day' },
    { value: 'until', label: 'Until a date', testid: 'block-scope-until' }
  ]} />
      ${scope === 'until'
    ? html`<${Field} label="Until and including" id="cal-block-until">
          <${Input} id="cal-block-until" type="date" min=${date} value=${until} data-testid="block-until"
            onInput=${(e) => setUntil(e.target.value)} />
        <//>`
    : null}
    </div>
  <//>`;
}

// ---------- the view ----------

export default function CalendarView({ route }) {
  const state = useStore(selectAll);
  useNow(60000); // windows turn 'past' as the day goes on
  const wide = useMediaQuery('(min-width: 768px)');
  const [freeSlot, setFreeSlot] = useState(null);   // { date, windowId } while the free-window sheet is open
  const [blockSlot, setBlockSlot] = useState(null); // { date, windowId } while the block sheet is open
  const [unblock, setUnblock] = useState(null);     // the Block record awaiting confirmation
  const [unblockAll, setUnblockAll] = useState(true);
  const stripRef = useRef(null);

  const today = todayKey();
  const asked = route && route.params ? route.params.date : '';
  const sel = isDayKey(asked) ? asked : today;
  const dates = weekDates(sel);

  // Picking a day or a week swaps the hash entry, so Back leaves the Calendar instead of replaying every tap.
  const selectDate = (date) => navigate(routeHref('calendar', { date }), { replace: true });
  const goToday = () => navigate(routeHref('calendar'), { replace: true });

  // Below 360px the strip scrolls inside its wrapper: keep the chosen day in view.
  useEffect(() => {
    const wrap = stripRef.current;
    const el = wrap && wrap.querySelector('.cal-day.is-selected');
    if (wrap && el && wrap.scrollWidth > wrap.clientWidth) {
      wrap.scrollLeft = Math.max(0, el.offsetLeft - (wrap.clientWidth - el.offsetWidth) / 2);
    }
  }, [sel, wide]);

  // ---- actions ----
  const openFree = (date, windowId) => setFreeSlot({ date, windowId });
  const askUnblock = (block) => { setUnblockAll(true); setUnblock(block); };

  const dayOffFromSheet = () => {
    const date = freeSlot.date;
    const res = addDaysOff([date], 'Day off');
    if (!res.ok) { failToast(res); return; }
    let message = `${fmtDayShort(date)} marked as a day off. Customers cannot book it.`;
    if (res.bookedCount > 0) message += ` ${plural(res.bookedCount, 'booked job')} ${res.bookedCount === 1 ? 'stays' : 'stay'} in your diary.`;
    notify(message, res.undoToken);
    setFreeSlot(null);
  };

  const confirmUnblock = () => {
    const block = unblock;
    const groupCount = groupWindowCount(state, block);
    const all = unblockAll && groupCount > 1;
    const res = all ? removeBlockGroup(block.groupId) : removeBlock(block.id);
    setUnblock(null);
    if (!res.ok) { failToast(res); return; }
    notify(all ? `Unblocked ${plural(groupCount, 'window')}. Customers can book them again.` : 'Time unblocked. Customers can book it again.', res.undoToken);
  };

  const removeOff = (off) => {
    const res = removeDayOff(off.id);
    if (!res.ok) { failToast(res); return; }
    notify(`Day off removed. Customers can book ${fmtDayShort(off.date)} again.`, res.undoToken);
  };

  const reopen = () => {
    const res = setDayFull(sel, false);
    if (!res.ok) { failToast(res); return; }
    notify('Day reopened. Customers can book it again.', res.undoToken);
  };

  // ---- derived ----
  const off = state.settings.daysOff.find((d) => d.date === sel) || null;
  const marked = state.settings.fullDays.includes(sel);
  const cells = dayCells(state, sel);
  const urgent = selectBookingsOn(state, sel).filter((b) => b.urgent);
  const selInfo = dayInfo(state, sel, today);
  const closedAllDay = cells.every((c) => c.kind === 'closed');
  const weekLabel = `${fmtDayShort(dates[0])} to ${fmtDayShort(dates[6])}`;

  const groupShown = unblock ? groupWindowCount(state, unblock) : 1;

  // The default label is 'Day off': "Day off: Day off." would read badly, so only a custom label (Holiday) is spelled out.
  const customOff = off && off.label.trim() && off.label.trim().toLowerCase() !== 'day off';
  const offText = off
    ? `${customOff ? `Day off: ${off.label}.` : 'Day off.'} Customers cannot book this day.${selInfo.jobs > 0 ? ' Booked jobs stay in your diary.' : ''}`
    : '';
  const offBanner = off
    ? html`<${Banner} tone="warn" icon="calendar-x"
      actions=${html`<${Button} size="sm" onClick=${() => removeOff(off)} data-testid="calendar-remove-dayoff">Remove day off<//>`}>
      ${offText}
    <//>`
    : null;
  const fullBanner = marked
    ? html`<${Banner} tone="warn" icon="triangle-alert"
      actions=${html`<${Button} size="sm" onClick=${reopen} data-testid="calendar-reopen-day">Reopen day<//>`}>
      Marked full. Customers cannot book this day.
    <//>`
    : null;
  const banners = off || marked ? html`<div class="db-stack cal-panel__banners">${offBanner}${fullBanner}</div>` : null;

  const nav = html`<div class="cal-weekbar">
    <${IconButton} icon="chevron-left" label="Previous week" size="lg" class="cal-navbtn" onClick=${() => selectDate(addDays(sel, -7))} data-testid="calendar-prev" />
    <p class="cal-weekbar__label" aria-live="polite" data-testid="calendar-week-label">${weekLabel}</p>
    <${IconButton} icon="chevron-right" label="Next week" size="lg" class="cal-navbtn" onClick=${() => selectDate(addDays(sel, 7))} data-testid="calendar-next" />
  </div>`;

  const panelHead = html`<div class="cal-panel__head">
    <h2 class="cal-panel__title">${fmtDayLong(sel)}</h2>
    <span class="cal-panel__tags">
      ${sel === today ? html`<${Chip} tone="accent">Today<//>` : null}
      <${Chip}>${plural(selInfo.jobs, 'job')}<//>
    </span>
  </div>`;

  return html`<div class="db-page cal-page" data-testid="calendar-view">
    <${PageHeader} title="Calendar"
      actions=${html`<${Button} size="sm" onClick=${goToday} data-testid="calendar-today">Today<//>`} />
    <div class="db-stack">
      ${nav}
      ${wide
    ? html`<div class="cal-panel" data-testid="calendar-day-panel">
            ${panelHead}
            ${banners}
          </div>
          <${WeekGrid} state=${state} dates=${dates} today=${today} sel=${sel} onSelect=${selectDate} onFree=${openFree} onUnblock=${askUnblock} />`
    : html`<div class="cal-strip-wrap" ref=${stripRef}>
            <div class="cal-strip" role="group" aria-label="Choose a day">
              ${dates.map((date) => html`<${DayChip} key=${date} info=${dayInfo(state, date, today)} selected=${date === sel} onSelect=${selectDate} />`)}
            </div>
          </div>
          <section class="cal-panel" data-testid="calendar-day-panel" aria-label=${fmtDayLong(sel)}>
            ${panelHead}
            ${banners}
            ${closedAllDay
    ? (off ? null : html`<p class="cal-closed" data-testid="calendar-closed-day">Closed all day. Opening hours are set in Settings.</p>`)
    : html`<${DayRows} date=${sel} cells=${cells} onFree=${openFree} onUnblock=${askUnblock} />`}
            ${urgent.length > 0 ? html`<div class="cal-urgent">
              <h3 class="cal-urgent__title">Emergency requests</h3>
              <ul class="db-list">
                ${urgent.map((b) => html`<li key=${b.id}><a class="db-list__item" href=${routeHref('bookings', { id: b.id })} data-testid=${`calendar-booking-${b.id}`}>
                  <span class="u-grow u-wrap"><strong>${firstName(b.customer.name)}</strong>${' · '}${b.notes || 'Emergency visit'}</span>
                  <${StatusPill} status=${b.status} urgent compact />
                </a></li>`)}
              </ul>
            </div>` : null}
          </section>`}
      <section class="cal-legend" data-testid="calendar-legend" aria-label="Key">
        <ul class="cal-legend__list">
          <li><span class="cal-day__dot cal-day__dot--good" aria-hidden="true"></span>Plenty free</li>
          <li><span class="cal-day__dot cal-day__dot--few" aria-hidden="true"></span>1 left</li>
          <li><span class="cal-day__dot cal-day__dot--full" aria-hidden="true"></span>Full or closed</li>
          <li><span class="cal-day__dot cal-day__dot--hatch" aria-hidden="true"></span>Blocked</li>
        </ul>
        <p class="cal-legend__note">Customers book from this diary. Free here means bookable on your website.</p>
        <${TextLink} href=${pageHref('index.html', '#book')} target=${pageTarget('index.html')} data-testid="calendar-preview-site">Preview customer view<//>
      </section>
    </div>

    <${FreeSheet} slot=${freeSlot} onClose=${() => setFreeSlot(null)}
      onBlock=${() => setBlockSlot(freeSlot)} onDayOff=${dayOffFromSheet} />
    ${blockSlot
    ? h(BlockSheet, { key: `${blockSlot.date}-${blockSlot.windowId}`, date: blockSlot.date, windowId: blockSlot.windowId, onClose: () => setBlockSlot(null), onDone: () => { setBlockSlot(null); setFreeSlot(null); } })
    : null}
    <${ConfirmDialog} open=${!!unblock} title="Unblock this time?" confirmLabel="Unblock"
      onCancel=${() => setUnblock(null)} onConfirm=${confirmUnblock}
      body=${unblock ? html`<div class="u-stack">
        <p class="cal-confirm__text">${`${unblock.label}, ${fmtDayShort(unblock.date)}, ${WINDOWS[unblock.windowId].label}.`}</p>
        ${groupShown > 1
    ? html`<${Switch} id="cal-unblock-group" checked=${unblockAll} onChange=${setUnblockAll}
            label=${`Unblock all ${groupShown} windows`} data-testid="calendar-unblock-group" />`
    : null}
      </div>` : null} />
  </div>`;
}
