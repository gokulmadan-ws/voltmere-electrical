// js/dashboard/views/today.js: the Today screen (needs you, next up, availability, stats, diary, tomorrow, share).
// Owner: WP4
import { html } from '../../vendor/preact-htm.js';
import {
  Avatar, Banner, Button, Card, Chip, EmptyState, Icon, PageHeader, Stat, StatusPill, Switch,
  copyText, toast, showUndoToast, useNow, useStore
} from '../../ui/index.js';
import {
  selectBrand, selectBookingsOn, selectNeedsYou, selectNextOpenDay, selectNextUp, selectOwed, selectOwedTotal, selectRepeatInfo
} from '../../core/selectors.js';
import {
  bookingEndStamp, bookingWhen, bookingWindowIds, bookingWindowLabel, getDayLoad, getDaySlots, nextFreeSlot
} from '../../core/availability.js';
import {
  addDays, fmtClock, fmtDayShort, fmtRelativeDay, fmtTimeAgo, minutesBetween, stampDay, toStamp, weekDates, weekStart, weekdayOf
} from '../../core/dates.js';
import { EMERGENCY_REASONS, SITE_BASE_URL } from '../../core/config.js';
import { firstName, gbp, outwardCode, plural, postcodeZone } from '../../core/format.js';
import { mapsLink, telLink, waLink, waShareLink } from '../../core/messages.js';
import { addDaysOff, setDayFull } from '../../core/store.js';
import { JobActionBar, NeedsYouActions } from '../shared/job-actions.js';

export const title = 'Today';
export const css = ['css/today.css', 'css/bookings.css'];

// Selector declared outside the component so useStore gets a stable function (8.8). The whole state is cheap to
// derive from and every mutation hands back a new snapshot, so one re-render per change is exactly what we want.
const selectState = (state) => state;

const JOB_STATUSES = ['confirmed', 'on_the_way', 'done'];

/** Generic failure rule (8.3) for any mutation reason this screen does not handle itself. */
function failToast(res) {
  toast({
    message: res && res.reason === 'not_found' ? 'That booking no longer exists.' : 'That did not work: the diary changed. Please check and try again.',
    tone: 'danger'
  });
}

/** Undo toast when the store gave us a token, plain toast when it did not (a no-op mutation has none). */
function doneToast(message, token) {
  if (token) showUndoToast(message, token);
  else toast({ message });
}

const bookedJobsNote = (n) => (n === 1 ? ' 1 booked job stays in your diary.' : ` ${n} booked jobs stay in your diary.`);
const priceOf = (b) => (b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);

/** A weekday with no open windows (Sunday by default) or a day marked off. */
function isClosedDay(settings, day) {
  return (settings.hours[weekdayOf(day)] || []).length === 0 || settings.daysOff.some((d) => d.date === day);
}

function greeting(nowDate) {
  const hour = nowDate.getHours();
  return hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
}

// ---------- 2. Needs you ----------

function NeedCard({ booking: b, brand, autoConfirm, nowStamp }) {
  const first = firstName(b.customer.name);
  const reasons = (b.emergencyReasons || [])
    .map((id) => (EMERGENCY_REASONS.find((r) => r.id === id) || {}).label)
    .filter(Boolean)
    .join(', ');
  const zone = postcodeZone(b.address.postcode, brand);
  let flag = '';
  if (!b.urgent) {
    if (zone === 'edge' || zone === 'outside') flag = 'Outside your usual area: confirm travel.';
    else if (!autoConfirm) flag = 'Auto-confirm is off.';
  }
  const unseen = b.seenByOwner === false;
  return html`<${Card} as="article" class=${`td-need${b.urgent ? ' td-need--urgent' : ''}${unseen ? ' is-unseen' : ''}`}
    data-testid=${`needs-you-card-${b.id}`} aria-label=${`${first}, ${b.urgent ? 'urgent emergency' : 'new request'}`}>
    <div class="td-need__top">
      ${b.urgent
        ? html`<span class="ui-pill ui-pill--urgent"><${Icon} name="siren" size=${16} /><span class="ui-pill__label">URGENT</span></span>`
        : html`<${StatusPill} status="new" />`}
      ${unseen ? html`<span class="u-sr-only">Not opened yet</span>` : null}
    </div>
    <p class="td-need__who"><a class="td-need__link" href=${`#/bookings/${b.id}`} data-testid=${`needs-you-open-${b.id}`}><strong>${first}</strong></a> · ${outwardCode(b.address.postcode)} · ${fmtTimeAgo(b.createdAt, nowStamp)}</p>
    ${b.urgent
      ? html`<div class="td-need__what">
          ${reasons ? html`<p class="td-need__line">${reasons}</p>` : null}
          ${b.notes ? html`<p class="td-need__note">“${b.notes}”</p>` : null}
        </div>`
      : html`<p class="td-need__line">${b.serviceName}, ${bookingWhen(b)}</p>`}
    ${flag ? html`<p class="td-need__flag"><${Icon} name="triangle-alert" size=${16} /><span>${flag}</span></p>` : null}
    <${NeedsYouActions} booking=${b} />
  <//>`;
}

function NeedsYou({ items, brand, autoConfirm, nowStamp }) {
  if (items.length === 0) return null;
  return html`<section class="db-section td-section" data-testid="needs-you" aria-labelledby="td-needs-title">
    <h2 class="db-section__title" id="td-needs-title">
      <span>Needs you</span>
      <span class="td-count" aria-label=${`${items.length} waiting`}>${items.length}</span>
    </h2>
    <div class="td-needs">
      ${items.map((b) => html`<${NeedCard} key=${b.id} booking=${b} brand=${brand} autoConfirm=${autoConfirm} nowStamp=${nowStamp} />`)}
    </div>
  </section>`;
}

// ---------- 3. Next up ----------

/** The countdown line of 13.4 item 3. */
function countdownFor(b, nowStamp, today) {
  if (b.status === 'on_the_way') {
    const entry = (b.history || []).filter((e) => e.event === 'on_the_way').pop();
    return entry ? `On the way since ${fmtClock(entry.at)}` : 'On the way';
  }
  if (b.urgent) return b.etaAt ? `Emergency · ETA ${fmtClock(b.etaAt)}` : 'Emergency';
  const day = stampDay(b.start);
  if (day > today) return fmtRelativeDay(day, today);
  if (nowStamp >= b.start && nowStamp < bookingEndStamp(b)) return 'Arriving now';
  if (nowStamp < b.start) {
    const mins = minutesBetween(nowStamp, b.start);
    if (mins < 60) return `In ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `In ${h} h ${m} min` : `In ${h} h`;
  }
  return fmtRelativeDay(day, today);
}

function Tile({ icon, label, href, testid, external }) {
  return html`<a class="td-tile" href=${href} data-testid=${testid}
    target=${external ? '_blank' : undefined} rel=${external ? 'noopener noreferrer' : undefined}>
    <${Icon} name=${icon} size=${22} />
    <span class="td-tile__label">${label}</span>
  </a>`;
}

function NextUp({ booking: b, state, brand, nowStamp, today }) {
  if (!b) {
    return html`<${Card} class="td-next td-next--empty">
      <${EmptyState} icon="calendar-days" title="Nothing booked. Go put the kettle on." data-testid="today-empty" />
    <//>`;
  }
  const first = firstName(b.customer.name);
  const repeat = selectRepeatInfo(state, b).isRepeat;
  const addressText = [b.address.line1, b.address.postcode].filter(Boolean).join(', ');
  const hello = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name} about your booking ${b.ref}.`;
  return html`<${Card} as="section" class="td-next" data-testid="next-up" aria-labelledby="td-next-title">
    <div class="td-next__top">
      <h2 class="td-next__eyebrow" id="td-next-title">Next up</h2>
      <span class="td-next__count">${countdownFor(b, nowStamp, today)}</span>
    </div>
    <p class="td-next__window">${bookingWindowLabel(b)}</p>
    <p class="td-next__service">${b.serviceName}${b.variantLabel ? html`<span class="td-next__variant"> · ${b.variantLabel}</span>` : null}</p>
    <div class="td-next__who">
      <${Avatar} name=${b.customer.name} size=${36} />
      <span class="td-next__name">${b.customer.name}</span>
      ${repeat ? html`<${Chip} tone="accent">Repeat customer<//>` : null}
    </div>
    <a class="td-next__addr" href=${mapsLink(b.address.line1, b.address.postcode)} target="_blank" rel="noopener noreferrer">
      <${Icon} name="map-pin" size=${20} />
      <span>${addressText}</span>
    </a>
    ${b.notes ? html`<p class="td-next__note">“${b.notes}”</p>` : null}
    <p class="td-next__price">${b.finalPrice === null || b.finalPrice === undefined ? gbp(b.quotedPrice) : gbp(b.finalPrice)}</p>
    <div class="td-next__tiles">
      <${Tile} icon="navigation" label="Navigate" href=${mapsLink(b.address.line1, b.address.postcode)} testid="next-up-navigate" external />
      <${Tile} icon="phone" label="Call" href=${telLink(b.customer.phone)} testid="next-up-call" />
      <${Tile} icon="message-circle" label="WhatsApp" href=${waLink(b.customer.phone, hello, brand.demoPhoneDigits)} testid="next-up-whatsapp" external />
      <${Tile} icon="file-text" label="Details" href=${`#/bookings/${b.id}`} testid="next-up-details" />
    </div>
    <div class="td-next__actions"><${JobActionBar} booking=${b} variant="card" /></div>
  <//>`;
}

// ---------- 1. Availability ----------

function Availability({ settings, today, jobsToday }) {
  const tomorrow = addDays(today, 1);
  const closedToday = isClosedDay(settings, today);
  const taking = !closedToday && !settings.fullDays.includes(today);
  const tomorrowOff = isClosedDay(settings, tomorrow);
  const nextWeek = weekDates(addDays(weekStart(today), 7));
  const weekOff = nextWeek.every((d) => settings.daysOff.some((o) => o.date === d));

  const onToggle = (checked) => {
    const res = setDayFull(today, !checked);
    if (!res.ok) { failToast(res); return; }
    doneToast(checked ? 'Taking bookings again today.' : 'Marked full for today. Customers cannot book today.', res.undoToken);
  };
  const takeTomorrow = () => {
    const res = addDaysOff([tomorrow], 'Day off');
    if (!res.ok) { failToast(res); return; }
    doneToast(`Tomorrow marked as a day off. Customers cannot book it.${res.bookedCount > 0 ? bookedJobsNote(res.bookedCount) : ''}`, res.undoToken);
  };
  const takeWeek = () => {
    const res = addDaysOff(nextWeek, 'Holiday');
    if (!res.ok) { failToast(res); return; }
    doneToast(`Next week marked as days off.${res.bookedCount > 0 ? bookedJobsNote(res.bookedCount) : ''}`, res.undoToken);
  };

  return html`<${Card} as="section" class="td-avail" data-testid="today-availability" aria-labelledby="td-avail-title">
    <h2 class="td-card-title" id="td-avail-title">Availability</h2>
    <${Switch} id="td-taking-bookings" data-testid="today-taking-bookings" checked=${taking} disabled=${closedToday}
      label="Taking bookings today"
      description=${closedToday ? 'Today is closed.' : taking ? 'Customers can book your free windows today.' : undefined}
      onChange=${onToggle} />
    ${!closedToday && !taking
      ? html`<${Banner} tone="warn">Full today. New customers cannot book today.${jobsToday === 0 ? '' : jobsToday === 1 ? ' Your 1 job stays in your diary.' : ` Your ${jobsToday} jobs stay in your diary.`}<//>`
      : null}
    <div class="td-btnrow">
      <${Button} size="sm" icon="calendar-x" disabled=${tomorrowOff} onClick=${takeTomorrow} data-testid="today-take-tomorrow-off">${tomorrowOff ? 'Tomorrow is off' : 'Take tomorrow off'}<//>
      <${Button} size="sm" icon="calendar-x" disabled=${weekOff} onClick=${takeWeek} data-testid="today-take-week-off">${weekOff ? 'Next week is off' : 'Take next week off'}<//>
    </div>
  <//>`;
}

// ---------- 4. Stats ----------

function Stats({ jobs, done, owedTotal, owedCount, nextFree }) {
  return html`<section class="td-stats" aria-label="Today at a glance">
    <${Stat} label="Jobs today" value=${jobs} hint=${jobs > 0 ? `${done} done` : undefined} data-testid="stat-jobs-today" />
    <${Stat} label="Owed to you" value=${gbp(owedTotal)} hint=${plural(owedCount, 'job')} tone=${owedCount > 0 ? 'accent' : undefined}
      href="#/insights" data-testid="stat-owed" />
    <${Stat} class="td-stats__wide" label="Next free slot" value=${nextFree ? nextFree.human : 'None free'} hint="for repairs" data-testid="stat-next-free" />
  </section>`;
}

// ---------- 5. Today's diary ----------

function JobRow({ booking: b, brand, nowStamp, compact }) {
  const meta = [firstName(b.customer.name), outwardCode(b.address.postcode), gbp(priceOf(b))];
  if (b.urgent && b.etaAt && b.status !== 'done') meta.push(`ETA ${fmtClock(b.etaAt)}`);
  return html`<a class=${`td-row${compact ? ' td-row--compact' : ''}`} href=${`#/bookings/${b.id}`} data-testid=${compact ? undefined : `today-job-${b.id}`}>
    <span class="td-row__head">
      <span class="td-row__when">${bookingWindowLabel(b)}</span>
      <${StatusPill} status=${b.status} paid=${b.paid} compact />
    </span>
    <span class="td-row__svc">${b.serviceName}</span>
    <span class="td-row__meta">${meta.join(' · ')}</span>
  </a>`;
}

/** The day's rows in window order: accepted emergencies first, then each window as a job, a free row or a block. */
function buildDiary(state, today, nowDate) {
  const todays = selectBookingsOn(state, today).filter((b) => !(b.urgent && b.status === 'new'));
  const entries = todays.filter((b) => b.urgent).map((b) => ({ kind: 'job', windowId: -1, booking: b }));
  const windowed = todays.filter((b) => !b.urgent);
  const placed = new Set();
  // Owner mode: lead time and "Full" do not hide a window from the owner. Past windows come back as 'past'.
  for (const slot of getDaySlots(state, today, 1, { ownerMode: true, now: nowDate })) {
    const b = windowed.find((x) => bookingWindowIds(x).includes(slot.windowId));
    if (b) {
      if (!placed.has(b.id)) { placed.add(b.id); entries.push({ kind: 'job', windowId: slot.windowId, booking: b }); }
    } else if (slot.state === 'free') entries.push({ kind: 'free', windowId: slot.windowId, slot });
    else if (slot.state === 'blocked') entries.push({ kind: 'blocked', windowId: slot.windowId, slot });
  }
  windowed.filter((b) => !placed.has(b.id)).forEach((b) => entries.push({ kind: 'job', windowId: 4, booking: b }));
  return entries;
}

function Diary({ state, brand, nowDate, nowStamp, today, closedToday }) {
  const entries = buildDiary(state, today, nowDate);
  const rows = [];
  let lunchDone = false;
  entries.forEach((e, i) => {
    // Thin Lunch divider between windows 1 and 2, only when there is something on both sides.
    if (!lunchDone && e.windowId >= 2 && i > 0 && entries.slice(0, i).some((p) => p.windowId >= 0 && p.windowId <= 1)) {
      lunchDone = true;
      rows.push(html`<div class="td-lunch" key="lunch"><span>Lunch</span></div>`);
    }
    if (e.kind === 'job') {
      rows.push(html`<${JobRow} key=${e.booking.id} booking=${e.booking} brand=${brand} nowStamp=${nowStamp} />`);
    } else if (e.kind === 'free') {
      rows.push(html`<a class="td-row td-row--free" key=${`free-${e.windowId}`} href=${`#/new?date=${today}&window=${e.windowId}`} data-testid=${`today-free-${e.windowId}`}>
        <${Icon} name="plus" size=${20} />
        <span class="td-row__when">${e.slot.label}</span>
        <span class="td-row__free">Free · add a job</span>
      </a>`);
    } else {
      rows.push(html`<div class="td-row td-row--blocked" key=${`blocked-${e.windowId}`}>
        <${Icon} name="lock" size=${20} />
        <span class="td-row__when">${e.slot.label}</span>
        <span class="td-row__free">Blocked: ${e.slot.blockLabel}</span>
      </div>`);
    }
  });
  return html`<section class="db-section td-section" aria-labelledby="td-diary-title">
    <h2 class="db-section__title" id="td-diary-title">Today's diary</h2>
    <div class="td-diary" data-testid="today-jobs">
      ${rows.length > 0 ? rows : html`<p class="td-quiet">${closedToday ? 'Closed today.' : 'Nothing in the diary today.'}</p>`}
    </div>
  </section>`;
}

// ---------- 6. Tomorrow ----------

function Tomorrow({ state, brand, nowDate, nowStamp, today }) {
  const tomorrow = addDays(today, 1);
  const day = selectNextOpenDay(state, today) || tomorrow;
  const jobs = selectBookingsOn(state, day);
  const free = getDayLoad(state, day, { now: nowDate }).free;
  const shown = jobs.slice(0, 4);
  return html`<section class="db-section td-section" data-testid="tomorrow-list" aria-labelledby="td-tomorrow-title">
    <h2 class="db-section__title" id="td-tomorrow-title">
      <span>${day === tomorrow ? 'Tomorrow' : fmtDayShort(day)}</span>
      <${Chip} tone=${free > 0 ? 'ok' : 'neutral'}>Free windows: ${free}<//>
    </h2>
    <div class="td-diary">
      ${shown.length > 0
        ? shown.map((b) => html`<${JobRow} key=${b.id} booking=${b} brand=${brand} nowStamp=${nowStamp} compact />`)
        : html`<p class="td-quiet">Nothing booked yet.</p>`}
    </div>
    <div class="td-tomorrow__foot">
      ${jobs.length > shown.length ? html`<span class="td-quiet">${`and ${jobs.length - shown.length} more`}</span>` : html`<span></span>`}
      <${Button} variant="ghost" size="sm" iconRight="chevron-right" href=${`#/calendar/${day}`}>Open calendar<//>
    </div>
  </section>`;
}

// ---------- 7. Share ----------

function Share({ brand }) {
  const url = `${SITE_BASE_URL}index.html`;
  const text = `Book ${brand.name} online: ${url}`;
  const onCopy = async () => {
    const ok = await copyText(url);
    toast({ message: ok ? 'Link copied' : 'Could not copy. Select the link and copy it.', tone: ok ? 'default' : 'danger' });
  };
  return html`<${Card} as="section" class="td-share" data-testid="share-card" aria-labelledby="td-share-title">
    <h2 class="td-card-title" id="td-share-title">Your booking page</h2>
    <p class="td-share__text">Send this link to customers. It shows your real diary.</p>
    <p class="td-share__url u-mono">${url}</p>
    <div class="td-btnrow">
      <${Button} size="sm" icon="send" href=${waShareLink(text)} data-testid="share-whatsapp">Send on WhatsApp<//>
      <${Button} size="sm" icon="copy" onClick=${onCopy} data-testid="share-copy">Copy link<//>
    </div>
  <//>`;
}

// ---------- The view ----------

export default function TodayView() {
  const state = useStore(selectState);
  const nowDate = useNow(30000);
  const brand = selectBrand(state);
  const nowStamp = toStamp(nowDate);
  const today = stampDay(nowStamp);

  const needs = selectNeedsYou(state);
  const nextUp = selectNextUp(state, nowStamp);
  const todays = selectBookingsOn(state, today);
  const jobsToday = todays.filter((b) => JOB_STATUSES.includes(b.status));
  const doneToday = jobsToday.filter((b) => b.status === 'done').length;
  const owed = selectOwed(state);
  const nextFree = nextFreeSlot(state, 'fault', { now: nowDate });
  const closedToday = isClosedDay(state.settings, today);

  const needText = needs.length === 1 ? '1 needs you' : `${needs.length} need you`;
  const subtitle = `${fmtDayShort(today)} · ${plural(jobsToday.length, 'job')} today · ${needText}`;

  return html`<div class="db-page td-page" data-testid="today-view">
    <${PageHeader} title=${`${greeting(nowDate)}, ${brand.ownerFirst}`} subtitle=${subtitle} />
    <div class="db-two-col">
      <div class="td-col">
        <${NeedsYou} items=${needs} brand=${brand} autoConfirm=${state.settings.autoConfirm} nowStamp=${nowStamp} />
        <${NextUp} booking=${nextUp} state=${state} brand=${brand} nowStamp=${nowStamp} today=${today} />
        <${Availability} settings=${state.settings} today=${today} jobsToday=${jobsToday.length} />
      </div>
      <div class="td-col">
        <${Stats} jobs=${jobsToday.length} done=${doneToday} owedTotal=${selectOwedTotal(state)} owedCount=${owed.length} nextFree=${nextFree} />
        <${Diary} state=${state} brand=${brand} nowDate=${nowDate} nowStamp=${nowStamp} today=${today} closedToday=${closedToday} />
        <${Tomorrow} state=${state} brand=${brand} nowDate=${nowDate} nowStamp=${nowStamp} today=${today} />
        <${Share} brand=${brand} />
      </div>
    </div>
  </div>`;
}
