// js/dashboard/shared/job-actions.js: state-driven job primary action, Needs-you buttons, Mark paid and the ETA / complete / paid / cancel / reschedule sheets.
// Owner: WP5
import { html, useState, useRef } from '../../vendor/preact-htm.js';
import {
  Button, IconButton, Chip, Icon, Segmented, Stepper, Switch, Sheet, WhatsAppBubble,
  toast, showUndoToast, useBrand, useStore, cx, loadCss
} from '../../ui/index.js';
import {
  getState, confirmBooking, acceptEmergency, declineBooking, markOnTheWay, completeBooking, markPaid, markUnpaid,
  cancelBooking, rescheduleBooking, sendPaymentNudge, sendReviewRequest
} from '../../core/store.js';
import { buildMessage, telLink, waLink } from '../../core/messages.js';
import { getDaySlots, getDayStatus, bookingWhen } from '../../core/availability.js';
import { todayKey } from '../../core/clock.js';
import { addDays, makeStamp, fmtDayLong, weekdayOf, DAY_SHORT, MONTH_SHORT, stampDay, parseDayKey } from '../../core/dates.js';
import { WINDOWS, PROMISES, PAID_METHODS, PAID_METHOD_LABELS, CANCEL_REASONS } from '../../core/config.js';
import { firstName, gbp } from '../../core/format.js';
import { customerKeyOf } from '../../core/selectors.js';
import { routeHref } from '../router.js';

// The sheets render outside #app, so their styles must be on the page whichever view imported this file.
// Idempotent: Today and Insights also list the same sheet in their `css` export.
if (typeof document !== 'undefined') loadCss('css/bookings.css');

const selectAll = (state) => state;
const firstOf = (b) => firstName(b.customer.name);

// ---------- pure helpers ----------

const PRIMARY = {
  confirm: { id: 'confirm', label: 'Confirm', icon: 'check' },
  accept: { id: 'accept', label: 'Accept', icon: 'check' },
  on_my_way: { id: 'on_my_way', label: 'On my way', icon: 'navigation' },
  mark_done: { id: 'mark_done', label: 'Mark done', icon: 'check-check' },
  mark_paid: { id: 'mark_paid', label: 'Mark paid', icon: 'pound-sterling' },
  review: { id: 'review', label: 'Ask for a review', icon: 'star' },
  rebook: { id: 'rebook', label: 'Rebook', icon: 'rotate-ccw' }
};

/** The one big button for a booking's state (13.6.1), or null when nothing is left to do. Pure. */
export function primaryActionFor(booking) {
  if (!booking) return null;
  switch (booking.status) {
    case 'new': return booking.urgent ? PRIMARY.accept : PRIMARY.confirm;
    case 'confirmed': return booking.urgent ? PRIMARY.mark_done : PRIMARY.on_my_way;
    case 'on_the_way': return PRIMARY.mark_done;
    case 'done':
      if (!booking.paid) return PRIMARY.mark_paid;
      return booking.reviewRequested ? null : PRIMARY.review;
    case 'cancelled': return PRIMARY.rebook;
    default: return null;
  }
}

const SECONDARY = {
  decline: { id: 'decline', label: 'Decline', icon: 'circle-x', testid: 'job-secondary-decline', danger: true },
  reschedule: { id: 'reschedule', label: 'Reschedule', icon: 'calendar-days', testid: 'job-secondary-reschedule' },
  cancel: { id: 'cancel', label: 'Cancel booking', icon: 'ban', testid: 'job-secondary-cancel', danger: true },
  nudge: { id: 'nudge', label: 'Payment reminder', icon: 'bell', testid: 'job-secondary-nudge' },
  review: { id: 'review', label: 'Ask for a review', icon: 'star', testid: 'job-secondary-review' },
  unpaid: { id: 'unpaid', label: 'Mark unpaid', icon: 'undo-2', testid: 'job-secondary-unpaid' }
};

/** The secondary buttons for a booking's state (13.6.1 table). Pure. */
function secondaryActionsFor(b) {
  switch (b.status) {
    case 'new': return [SECONDARY.decline];
    case 'confirmed': return b.urgent ? [SECONDARY.cancel] : [SECONDARY.reschedule, SECONDARY.cancel];
    case 'on_the_way': return [SECONDARY.cancel];
    case 'done':
      if (!b.paid) return b.reviewRequested ? [SECONDARY.nudge] : [SECONDARY.nudge, SECONDARY.review];
      return [SECONDARY.unpaid];
    default: return [];
  }
}

// ---------- shared behaviour ----------

/** The generic failure rule of 8.3. */
function failToast(res) {
  const message = res && res.reason === 'not_found'
    ? 'That booking no longer exists.'
    : 'That did not work: the diary changed. Please check and try again.';
  toast({ message, tone: 'danger' });
}

/** Show the Undo toast (or a plain one when the store gave no token) on success, the failure toast otherwise. */
function finish(res, message) {
  if (res && res.ok) {
    if (message) {
      if (res.undoToken) showUndoToast(message, res.undoToken);
      else toast({ message });
    }
    return true;
  }
  failToast(res);
  return false;
}

/** Ignore a second tap for half a second (the mutations are synchronous, so this stops a double-fire in one tick). */
function useTapGuard() {
  const busy = useRef(false);
  return (fn) => {
    if (busy.current) return undefined;
    busy.current = true;
    setTimeout(() => { busy.current = false; }, 500);
    return fn();
  };
}

const doConfirm = (b) => finish(confirmBooking(b.id), `Confirmed. ${firstOf(b)} has been told (simulated).`);
const doAccept = (b, eta) => finish(acceptEmergency(b.id, eta), `Accepted. ${firstOf(b)} has been told you're on your way (simulated).`);
const doDecline = (b) => finish(declineBooking(b.id), `Declined. ${firstOf(b)} has been told (simulated).`);
const doReview = (b) => finish(sendReviewRequest(b.id), 'Review request logged (simulated).');
const doNudge = (b) => finish(sendPaymentNudge(b.id), 'Payment reminder logged (simulated).');
const doUnpaid = (b) => finish(markUnpaid(b.id), 'Marked unpaid.');

const ETA_URGENT = [
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hr' },
  { value: 120, label: '2 hrs' }
];

/** Speech-bubble preview of a message the action will log, labelled "Message to {first} (simulated)". */
function Preview({ kind, booking, extra, testid }) {
  const msg = buildMessage(kind, booking, getState(), extra);
  return html`<div class="ja-chat"><${WhatsAppBubble} body=${msg.body} direction="out" toLabel=${`Message to ${firstOf(booking)} (simulated)`} data-testid=${testid} /></div>`;
}

// ---------- sheets ----------

function EtaSheet({ booking, onClose }) {
  const [eta, setEta] = useState(30);
  const guard = useTapGuard();
  const first = firstOf(booking);
  const options = [
    { value: 15, label: '15 min', testid: 'eta-option-15' },
    { value: 30, label: '30 min', testid: 'eta-option-30' },
    { value: 45, label: '45 min', testid: 'eta-option-45' },
    { value: 60, label: '1 hr', testid: 'eta-option-60' }
  ];
  const send = () => guard(() => {
    finish(markOnTheWay(booking.id, eta), `On your way. ${first} has been told (simulated).`);
    onClose();
  });
  const footer = html`<${Button} variant="primary" size="lg" block icon="navigation" onClick=${send} data-testid="eta-send">Tell ${first} I'm on my way<//>`;
  return html`<${Sheet} open title="How long will you be?" testid="eta-sheet" onClose=${onClose} footer=${footer}>
    <div class="ja-stack">
      <${Segmented} options=${options} value=${eta} onChange=${setEta} ariaLabel="Minutes until you arrive" />
      <${Preview} kind="customer_on_my_way" booking=${booking} extra=${{ etaMinutes: eta }} testid="eta-preview" />
    </div>
  <//>`;
}

function CompleteSheet({ booking, onClose }) {
  const [price, setPrice] = useState(booking.finalPrice === null || booking.finalPrice === undefined ? booking.quotedPrice : booking.finalPrice);
  const [method, setMethod] = useState('none');
  const [review, setReview] = useState(true);
  const guard = useTapGuard();
  const methods = [
    { value: 'none', label: 'Not yet', testid: 'paid-method-none' },
    ...PAID_METHODS.map((id) => ({ value: id, label: PAID_METHOD_LABELS[id], testid: `paid-method-${id}` }))
  ];
  const submit = () => guard(() => {
    const paid = method !== 'none';
    const res = completeBooking(booking.id, { finalPrice: price, paid, paidMethod: paid ? method : null, sendReview: review });
    finish(res, paid ? 'Job done. Marked paid.' : `Job done. ${gbp(price)} to collect.`);
    onClose();
  });
  const footer = html`<${Button} variant="primary" size="lg" block icon="check-check" onClick=${submit} data-testid="complete-submit">Complete job<//>`;
  return html`<${Sheet} open title="Finish the job" testid="complete-sheet" onClose=${onClose} footer=${footer}>
    <div class="ja-stack">
      <div class="ja-block">
        <p class="ja-label">Final price</p>
        <${Stepper} value=${price} onChange=${setPrice} step=${5} label="Final price"
          testids=${{ input: 'complete-price', minus: 'complete-price-minus', plus: 'complete-price-plus' }} />
      </div>
      <div class="ja-block">
        <p class="ja-label">Paid?</p>
        <${Segmented} options=${methods} value=${method} onChange=${setMethod} ariaLabel="Paid?" />
      </div>
      <${Switch} checked=${review} onChange=${setReview} label="Send review request"
        description=${`Goes out ${PROMISES.reviewDelayMinutes} minutes after you finish.`} data-testid="complete-review-toggle" />
    </div>
  <//>`;
}

function PaidSheet({ booking, onClose }) {
  const [method, setMethod] = useState('');
  const guard = useTapGuard();
  const methods = PAID_METHODS.map((id) => ({ value: id, label: PAID_METHOD_LABELS[id], testid: `paid-method-${id}` }));
  const submit = () => guard(() => {
    if (!method) return;
    finish(markPaid(booking.id, method), 'Marked paid.');
    onClose();
  });
  const footer = html`<${Button} variant="primary" size="lg" block icon="pound-sterling" disabled=${!method} onClick=${submit} data-testid="paid-submit">Mark paid<//>`;
  return html`<${Sheet} open title="How did they pay?" testid="paid-sheet" onClose=${onClose} footer=${footer}>
    <div class="ja-stack">
      <p class="ja-lead">${firstOf(booking)} owes ${gbp(booking.finalPrice === null || booking.finalPrice === undefined ? booking.quotedPrice : booking.finalPrice)} for ${booking.serviceName}.</p>
      <${Segmented} options=${methods} value=${method} onChange=${setMethod} ariaLabel="How they paid" />
    </div>
  <//>`;
}

function CancelSheet({ booking, onClose }) {
  const [reasonId, setReasonId] = useState('customer');
  const [notify, setNotify] = useState(true);
  const guard = useTapGuard();
  const reason = (CANCEL_REASONS.find((r) => r.id === reasonId) || CANCEL_REASONS[0]).label;
  const submit = () => guard(() => {
    const res = cancelBooking(booking.id, 'owner', { reason, notify });
    finish(res, booking.urgent ? 'Cancelled.' : 'Cancelled. The window is free again.');
    onClose();
  });
  const footer = html`<div class="ja-actions">
    <${Button} variant="danger" size="lg" block icon="ban" onClick=${submit} data-testid="cancel-submit">Cancel booking<//>
    <${Button} variant="ghost" block onClick=${onClose}>Keep booking<//>
  </div>`;
  return html`<${Sheet} open title="Cancel this booking?" testid="cancel-sheet" onClose=${onClose} footer=${footer}>
    <div class="ja-stack">
      <div class="ja-block">
        <p class="ja-label">Reason</p>
        <div class="ja-chips" role="group" aria-label="Reason">
          ${CANCEL_REASONS.map((r) => html`<${Chip} key=${r.id} selected=${r.id === reasonId} onClick=${() => setReasonId(r.id)} data-testid=${`cancel-reason-${r.id}`}>${r.label}<//>`)}
        </div>
      </div>
      <${Switch} checked=${notify} onChange=${setNotify} label="Tell the customer" data-testid="cancel-notify-toggle" />
      ${notify ? html`<${Preview} kind="customer_cancelled" booking=${booking} extra=${{ reason }} testid="cancel-preview" />` : null}
    </div>
  <//>`;
}

const DAYS_AHEAD = 28;
const SLOT_STATE_TEXT = { booked: 'Booked', closed: 'Closed', past: 'Passed', full: 'Full', too_soon: 'Too soon' };

function RescheduleSheet({ booking, onClose }) {
  const state = useStore(selectAll);
  const blocks = booking.durationMin >= 240 ? 2 : 1;
  const today = todayKey();
  const current = stampDay(booking.start);
  const [date, setDate] = useState(current >= today && current <= addDays(today, DAYS_AHEAD - 1) ? current : '');
  const [windowId, setWindowId] = useState(null);
  const [notify, setNotify] = useState(true);
  const guard = useTapGuard();
  const opts = { ownerMode: true, ignoreBookingId: booking.id };
  const slotsOn = (d) => getDaySlots(state, d, blocks, opts);

  const days = [];
  for (let i = 0; i < DAYS_AHEAD; i += 1) {
    const d = addDays(today, i);
    const free = slotsOn(d).filter((s) => s.state === 'free').length;
    days.push({ date: d, free, status: getDayStatus(state, d, { ownerMode: true }) });
  }

  const daySlots = date ? slotsOn(date).filter((s) => s.state !== 'closed') : [];
  const picked = windowId === null ? null : daySlots.find((s) => s.windowId === windowId) || null;
  const oldWhen = bookingWhen(booking);
  const newWhen = picked ? bookingWhen({ ...booking, start: makeStamp(date, WINDOWS[windowId].start) }) : '';

  const submit = () => guard(() => {
    if (!picked) return;
    const res = rescheduleBooking(booking.id, { date, windowId }, 'owner', { notify });
    if (res && !res.ok && res.reason === 'slot_taken') {
      toast({ message: 'That time was just taken. Please pick another.', tone: 'danger' });
      setWindowId(null);
      return;
    }
    const ok = finish(res, res && res.ok ? `Moved to ${bookingWhen(res.booking)}.` : '');
    if (ok || (res && res.reason !== 'invalid')) onClose();
  });

  const footer = html`<${Button} variant="primary" size="lg" block icon="calendar-check" disabled=${!picked} onClick=${submit} data-testid="reschedule-submit">Move booking<//>`;
  return html`<${Sheet} open title="Move to another time" testid="reschedule-sheet" onClose=${onClose} footer=${footer}
    description=${`Now: ${oldWhen}`}>
    <div class="ja-stack">
      <div class="ja-block">
        <p class="ja-label" id="ja-day-label">Pick a day</p>
        <div class="ja-days" role="group" aria-labelledby="ja-day-label">
          ${days.map((d, i) => {
            const dt = parseDayKey(d.date);
            const dim = d.free === 0;
            const reason = d.status.kind === 'dayoff' ? 'day off' : d.status.kind === 'closed' ? 'closed' : dim ? 'fully booked' : '';
            const monthTag = i === 0 || dt.getDate() === 1 ? MONTH_SHORT[dt.getMonth()] : '';
            return html`<button type="button" key=${d.date} class=${cx('ja-day', d.date === date && 'is-selected', dim && 'is-dim')}
              disabled=${dim} aria-pressed=${d.date === date ? 'true' : 'false'}
              aria-label=${`${fmtDayLong(d.date)}${reason ? `, ${reason}` : ''}`}
              data-testid=${`reschedule-day-${d.date}`}
              onClick=${() => { setDate(d.date); setWindowId(null); }}>
              <span class="ja-day__dow">${DAY_SHORT[weekdayOf(d.date)]}</span>
              <span class="ja-day__num">${dt.getDate()}</span>
              <span class="ja-day__mon">${monthTag}</span>
            </button>`;
          })}
        </div>
      </div>
      ${date ? html`<div class="ja-block">
        <p class="ja-label">${fmtDayLong(date)}</p>
        <div class="ja-windows">
          ${daySlots.map((s) => {
            const isCurrent = s.startsAt === booking.start;
            const free = s.state === 'free' && !isCurrent;
            const text = isCurrent ? 'Current time' : s.state === 'free' ? 'Free' : s.state === 'blocked' ? `Blocked: ${s.blockLabel}` : SLOT_STATE_TEXT[s.state] || s.state;
            return html`<button type="button" key=${s.windowId} class=${cx('ja-window', s.windowId === windowId && 'is-selected')}
              disabled=${!free} aria-pressed=${s.windowId === windowId ? 'true' : 'false'}
              data-testid=${`reschedule-window-${s.windowId}`} onClick=${() => setWindowId(s.windowId)}>
              <span class="ja-window__label">${s.label}</span>
              <span class="ja-window__state">${text}</span>
            </button>`;
          })}
        </div>
      </div>` : null}
      <${Switch} checked=${notify} onChange=${setNotify} label="Tell the customer" data-testid="reschedule-notify-toggle" />
      ${notify && picked ? html`<${Preview} kind="customer_rescheduled" booking=${booking} extra=${{ oldWhen, newWhen }} testid="reschedule-preview" />` : null}
    </div>
  <//>`;
}

/** Overflow sheet on booking detail: the SECONDARY actions as 56px rows. */
function OverflowSheet({ actions, onPick, onClose }) {
  return html`<${Sheet} open title="More actions" testid="detail-overflow-sheet" onClose=${onClose}>
    <ul class="db-list ja-more">
      ${actions.map((a) => html`<li key=${a.id}>
        <button type="button" class=${cx('db-list__item', 'ja-more__item', a.danger && 'is-danger')} data-testid=${a.testid} onClick=${() => onPick(a.id)}>
          <${Icon} name=${a.icon} size=${22} />
          <span class="ja-more__label">${a.label}</span>
        </button>
      </li>`)}
    </ul>
  <//>`;
}

// ---------- JobActionBar ----------

/**
 * The state-driven action area for one booking (13.6.1). `card`: ETA picker (urgent new), the 56px primary,
 * then a row of 44px secondary text buttons. `bar`: the primary plus an overflow button that lists the secondaries.
 * Owns its sheets and Undo toasts; a sheet only shows for the booking it was opened on.
 */
export function JobActionBar({ booking, variant = 'card' }) {
  const [sheet, setSheet] = useState(null); // { kind, id }
  const [eta, setEta] = useState(45);
  const guard = useTapGuard();
  if (!booking) return null;

  const kind = sheet && sheet.id === booking.id ? sheet.kind : null;
  const open = (k) => setSheet({ kind: k, id: booking.id });
  const close = () => setSheet(null);
  const primary = primaryActionFor(booking);
  const secondary = secondaryActionsFor(booking);
  const urgentNew = booking.status === 'new' && booking.urgent;

  const runPrimary = () => guard(() => {
    if (!primary) return;
    switch (primary.id) {
      case 'confirm': doConfirm(booking); break;
      case 'accept': doAccept(booking, eta); break;
      case 'on_my_way': open('eta'); break;
      case 'mark_done': open('complete'); break;
      case 'mark_paid': open('paid'); break;
      case 'review': doReview(booking); break;
      default: break;
    }
  });

  const runSecondary = (id) => {
    close();
    switch (id) {
      case 'decline': guard(() => doDecline(booking)); break;
      case 'reschedule': open('reschedule'); break;
      case 'cancel': open('cancel'); break;
      case 'nudge': guard(() => doNudge(booking)); break;
      case 'review': guard(() => doReview(booking)); break;
      case 'unpaid': guard(() => doUnpaid(booking)); break;
      default: break;
    }
  };

  const etaPicker = urgentNew
    ? html`<${Segmented} class="ja-eta" size="sm" ariaLabel="How long until you arrive" options=${ETA_URGENT.map((o) => ({ ...o, testid: `job-eta-${o.value}` }))} value=${eta} onChange=${setEta} />`
    : null;

  let primaryNode;
  if (primary && primary.id === 'rebook') {
    const href = routeHref('new', {}, { customer: customerKeyOf(booking.customer.phone), service: booking.serviceId });
    primaryNode = html`<${Button} variant="primary" size="lg" block icon=${primary.icon} href=${href} data-testid="job-primary">${primary.label}<//>`;
  } else if (primary) {
    primaryNode = html`<${Button} variant="primary" size="lg" block icon=${primary.icon} onClick=${runPrimary} data-testid="job-primary">${primary.label}<//>`;
  } else {
    primaryNode = html`<${Button} variant="secondary" size="lg" block icon="circle-check" disabled data-testid="job-primary">All done<//>`;
  }

  const sheets = html`
    ${kind === 'eta' ? html`<${EtaSheet} booking=${booking} onClose=${close} />` : null}
    ${kind === 'complete' ? html`<${CompleteSheet} booking=${booking} onClose=${close} />` : null}
    ${kind === 'paid' ? html`<${PaidSheet} booking=${booking} onClose=${close} />` : null}
    ${kind === 'cancel' ? html`<${CancelSheet} booking=${booking} onClose=${close} />` : null}
    ${kind === 'reschedule' ? html`<${RescheduleSheet} booking=${booking} onClose=${close} />` : null}
    ${kind === 'overflow' ? html`<${OverflowSheet} actions=${secondary} onPick=${runSecondary} onClose=${close} />` : null}`;

  if (variant === 'bar') {
    return html`<div class="ja-bar ja-bar--bar" data-testid="job-action-bar">
      ${etaPicker}
      <div class="ja-bar__row">
        <div class="ja-bar__primary">${primaryNode}</div>
        ${secondary.length ? html`<${IconButton} icon="ellipsis" label="More actions" size="lg" class="ja-bar__more" onClick=${() => open('overflow')} data-testid="detail-overflow" />` : null}
      </div>
      ${sheets}
    </div>`;
  }

  return html`<div class="ja-bar ja-bar--card" data-testid="job-action-bar">
    ${etaPicker}
    ${primaryNode}
    ${secondary.length ? html`<div class="ja-secondary">
      ${secondary.map((a) => html`<${Button} key=${a.id} variant="ghost" size="sm" icon=${a.icon} class=${cx('ja-secondary__btn', a.danger && 'is-danger')}
        onClick=${() => runSecondary(a.id)} data-testid=${a.testid}>${a.label}<//>`)}
    </div>` : null}
    ${sheets}
  </div>`;
}

// ---------- NeedsYouActions ----------

/**
 * Buttons for a card in Today's "Needs you": Accept (with an ETA picker) or Confirm, Call, WhatsApp, then Decline
 * (one tap, with Undo, set apart from the primary).
 */
export function NeedsYouActions({ booking }) {
  const brand = useBrand();
  const [eta, setEta] = useState(45);
  const guard = useTapGuard();
  if (!booking) return null;
  const id = booking.id;
  const first = firstOf(booking);
  const text = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name} about booking ${booking.ref}.`;
  const accept = booking.urgent;
  return html`<div class="ja-needs">
    ${accept ? html`<${Segmented} class="ja-eta" size="sm" ariaLabel="How long until you arrive" value=${eta} onChange=${setEta}
      options=${ETA_URGENT.map((o) => ({ ...o, testid: `needs-you-eta-${o.value}` }))} />` : null}
    ${accept
      ? html`<${Button} variant="primary" size="lg" block icon="check" onClick=${() => guard(() => doAccept(booking, eta))} data-testid=${`needs-you-accept-${id}`}>Accept<//>`
      : html`<${Button} variant="primary" size="lg" block icon="check" onClick=${() => guard(() => doConfirm(booking))} data-testid=${`needs-you-confirm-${id}`}>Confirm<//>`}
    <div class="ja-needs__contact">
      <${Button} variant="secondary" icon="phone" href=${telLink(booking.customer.phone)} data-testid=${`needs-you-call-${id}`}>Call<//>
      <${Button} variant="secondary" icon="message-circle" href=${waLink(booking.customer.phone, text, brand.demoPhoneDigits)} data-testid=${`needs-you-whatsapp-${id}`}>WhatsApp<//>
    </div>
    <${Button} variant="ghost" block class="ja-needs__decline" onClick=${() => guard(() => doDecline(booking))} data-testid=${`needs-you-decline-${id}`}>Decline<//>
  </div>`;
}

// ---------- PaidButton ----------

/** "Mark paid" button that opens the payment-method sheet (used by Insights owed rows). */
export function PaidButton({ booking, size = 'md' }) {
  const [open, setOpen] = useState(false);
  if (!booking) return null;
  return html`<${Button} variant="primary" size=${size} icon="pound-sterling" onClick=${() => setOpen(true)} data-testid=${`owed-mark-paid-${booking.id}`}>Mark paid<//>
    ${open ? html`<${PaidSheet} booking=${booking} onClose=${() => setOpen(false)} />` : null}`;
}
