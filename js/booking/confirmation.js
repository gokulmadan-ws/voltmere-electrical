// js/booking/confirmation.js: Confirmation screen (#booked/<ref>): enquiry thanks (his copy) + pencilled survey + DEMO panel; classic ticket for other jobs.
// Owner: WP3, rebuilt for the quote enquiry by D2
import { html } from '../vendor/preact-htm.js';
import { Icon, Button, Chip, PhoneMock, WhatsAppBubble, EmptyState, pageHref, pageTarget } from '../ui/index.js';
import { downloadIcs } from '../core/ics.js';
import { bubbleActions, reminderSendAt, waLink } from '../core/messages.js';
import { selectBookingByRef, selectMessages, selectService } from '../core/selectors.js';
import { bookingWindowIds } from '../core/availability.js';
import { PROMISES, WINDOWS, EMERGENCY_REASONS } from '../core/config.js';
import { DAY_LONG, fmtDayShort, stampDay, stampTime, weekdayOf } from '../core/dates.js';
import { nowStamp } from '../core/clock.js';
import { firstName } from '../core/format.js';
import { priceText } from './bk-shared.js';
import { FUNNEL_CONFIRM, FUNNEL_SERVICE_ID } from './funnel.js';

const reasonLabel = (id) => (EMERGENCY_REASONS.find((r) => r.id === id) || { label: id }).label;

/** True for a website quote enquiry (service ev_quote). */
export const isEnquiry = (booking) => !!booking && booking.serviceId === FUNNEL_SERVICE_ID;

/** 'Mon 26 Oct, 8–10am' for the pencilled or confirmed survey window, or '' when the booking has no window. */
export function visitWhen(booking) {
  const ids = bookingWindowIds(booking);
  if (!ids.length || !booking.start) return '';
  return `${fmtDayShort(stampDay(booking.start))}, ${WINDOWS[ids[0]].label}`;
}

/** The light animated tick on the confirmation screen: draws itself in once; drawn in its final state under reduced motion. */
export function Tick({ testid = 'confirmation-tick' }) {
  return html`<svg class="bk-tick" viewBox="0 0 72 72" width="72" height="72" aria-hidden="true" focusable="false" data-testid=${testid}>
    <circle class="bk-tick__disc" cx="36" cy="36" r="32" />
    <circle class="bk-tick__ring" cx="36" cy="36" r="32" />
    <path class="bk-tick__check" d="M22 37.5l9.5 9.5L51 26" />
  </svg>`;
}

/** The survey-visit sentence for an enquiry, by status. '' when there is nothing to say (no window, cancelled). */
function visitSentence(booking, brand) {
  const when = visitWhen(booking);
  if (booking.status === 'cancelled') return '';
  // The diary was full, so the enquiry is kept without a window and the owner places it.
  if (!when) return booking.status === 'new' ? `${brand.ownerFirst} will be in touch within ${PROMISES.contactWithinHours} hours to arrange your free survey visit.` : '';
  if (booking.status === 'new') {
    return booking.tentative !== false
      ? `We've pencilled in a free survey visit for ${when}. It's provisional until ${brand.ownerFirst} confirms.`
      : `Your free survey visit is requested for ${when}. ${brand.ownerFirst} will confirm it.`;
  }
  return `Your free survey visit is confirmed for ${when}.`;
}

/** The booking summary card of an enquiry: reference, what it is, postcode, the (provisional) survey visit. */
function EnquiryTicket({ booking, service, brand, testid, refTestid, showAlert }) {
  const sentence = visitSentence(booking, brand);
  const provisional = booking.status === 'new';
  return html`<div class="bk-ticket bk-ticket--big" data-testid=${testid}>
    <p class="bk-ticket__ref u-mono" data-testid=${refTestid}>${booking.ref}</p>
    <p class="bk-ticket__service">${booking.serviceName}<span class="bk-ticket__variant">${' · '}${priceText(service, booking.quotedPrice)}</span></p>
    ${booking.address.postcode ? html`<p class="bk-ticket__addr"><${Icon} name="map-pin" size=${16} />${' '}<span>${booking.address.postcode}</span></p>` : null}
    ${sentence ? html`<p class=${'bk-ticket__visit' + (provisional ? ' is-provisional' : '')} data-testid="confirmation-pencilled">
      <${Icon} name=${provisional ? 'clock' : 'calendar-check'} size=${18} />${' '}<span>${sentence}</span></p>` : null}
    ${showAlert ? html`<p class="bk-ticket__alert"><${Icon} name="message-circle" size=${16} />${' '}<span>${brand.ownerFirst} gets a WhatsApp alert (simulated in this prototype).</span></p>` : null}
  </div>`;
}

/** The booking summary card used by Confirmation and Manage. `live` booking from the store. */
export function ConfirmTicket({ booking, service, brand, testid = 'confirmation-ticket', refTestid = 'confirmation-ref', showAlert = true }) {
  if (isEnquiry(booking)) return html`<${EnquiryTicket} booking=${booking} service=${service} brand=${brand} testid=${testid} refTestid=${refTestid} showAlert=${showAlert} />`;
  const ids = bookingWindowIds(booking);
  const win = ids.length ? WINDOWS[ids[0]] : null;
  const half = ids.length === 2;
  let when;
  if (booking.urgent) when = 'As soon as possible';
  else if (half) when = `${fmtDayShort(stampDay(booking.start))} · ${ids[0] === 0 ? 'morning' : 'afternoon'}, arrives ${win.arrive}`;
  else when = `${fmtDayShort(stampDay(booking.start))} · arrives ${win ? win.arrive : stampTime(booking.start)}`;
  const address = [booking.address.line1, booking.address.postcode].filter(Boolean).join(', ');
  const price = booking.urgent
    ? `${priceText(service, booking.quotedPrice)} · pay after the job`
    : `${priceText(service, booking.quotedPrice)}${service && (service.priceType === 'free' || service.priceType === 'quoted') ? '' : ' · pay after the job'}`;
  return html`<div class="bk-ticket bk-ticket--big" data-testid=${testid}>
    <p class="bk-ticket__ref u-mono" data-testid=${refTestid}>${booking.ref}</p>
    <p class="bk-ticket__service">${booking.serviceName}${booking.variantLabel ? html`<span class="bk-ticket__variant">${' · '}${booking.variantLabel}</span>` : null}</p>
    <p class="bk-ticket__when">${when}</p>
    ${booking.urgent && booking.emergencyReasons.length ? html`<p class="bk-ticket__sub">${booking.emergencyReasons.map(reasonLabel).join(', ')}</p>` : null}
    ${address ? html`<p class="bk-ticket__addr"><${Icon} name="map-pin" size=${16} />${' '}<span>${address}</span></p>` : null}
    <p class="bk-ticket__price">${price}</p>
    ${showAlert ? html`<p class="bk-ticket__alert"><${Icon} name="message-circle" size=${16} />${' '}<span>${brand.ownerFirst} gets a WhatsApp alert (simulated in this prototype).</span></p>` : null}
  </div>`;
}

export function statusChipFor(booking, brand) {
  switch (booking.status) {
    case 'new': return { tone: 'accent', icon: 'bell', text: `Waiting for ${brand.ownerFirst} to confirm` };
    case 'confirmed': return { tone: 'ok', icon: 'calendar-check', text: 'Confirmed' };
    case 'on_the_way': return { tone: 'accent', icon: 'navigation', text: `${brand.ownerFirst} is on the way` };
    case 'done': return { tone: 'neutral', icon: 'badge-check', text: 'Done' };
    default: return { tone: 'danger', icon: 'ban', text: 'Cancelled' };
  }
}

function titleFor(booking, first) {
  if (booking.status === 'cancelled') return `Cancelled, ${first}.`;
  if (booking.status === 'done') return `All done, ${first}.`;
  if (booking.urgent || booking.status === 'new') return `Request sent, ${first}.`;
  return `You're booked in, ${first}.`;
}

function reminderLabel(booking, remindersOn) {
  if (booking.urgent || !remindersOn) return '';
  const at = reminderSendAt(booking, booking.createdAt);
  if (!at) return '';
  return stampTime(at) === '07:00' ? 'Morning of the visit' : `${DAY_LONG[weekdayOf(stampDay(at))]} evening`;
}

/** What happens next, in his three steps: talk, free survey and written quote, then the install date. */
function EnquiryTimeline({ booking, brand }) {
  const when = visitWhen(booking);
  const confirmed = booking.status !== 'new' && booking.status !== 'cancelled';
  const items = [
    { when: 'Just now', text: `${brand.ownerFirst} has your enquiry on WhatsApp (simulated)`, done: true },
    confirmed
      ? { when: 'Survey visit confirmed', text: when ? `${when}, free and no obligation` : 'Free and no obligation', done: true }
      : { when: `Within ${PROMISES.contactWithinHours} hours`, text: `${brand.ownerFirst} calls to talk through your installation and confirm the survey visit` },
    { when: 'After the survey', text: 'Your written quote. Photos of your consumer unit and charger location can help it be accurate.' },
    { when: 'When you are happy', text: 'Agree the quote, then arrange your installation date' }
  ];
  return html`<div class="bk-block">
    <p class="bk-eyebrow">What happens next</p>
    <ol class="bk-timeline" data-testid="confirmation-timeline">
      ${items.map((it, i) => html`<li key=${i} class=${'bk-timeline__item' + (it.done ? ' is-done' : '')}>
        <span class="bk-timeline__mark" aria-hidden="true">${it.done ? html`<${Icon} name="check" size=${14} />` : null}</span>
        <span class="bk-timeline__body"><span class="bk-timeline__when">${it.when}</span><span class="bk-timeline__text">${it.text}</span></span>
      </li>`)}
    </ol>
  </div>`;
}

function Timeline({ booking, brand, remindersOn }) {
  if (isEnquiry(booking)) return html`<${EnquiryTimeline} booking=${booking} brand=${brand} />`;
  let items;
  if (booking.urgent) {
    items = [
      { when: 'Now', text: `${brand.ownerFirst} has been alerted (simulated)`, done: true },
      { when: `Within ${PROMISES.emergencyReplyMinutes} minutes`, text: 'A reply with an arrival time' },
      { when: `If you haven't heard in ${PROMISES.emergencyCallAfterMinutes} minutes`, text: `Call ${brand.phone}` }
    ];
  } else {
    const rem = reminderLabel(booking, remindersOn);
    items = [
      { when: 'Just now', text: `${brand.ownerFirst} has your booking on WhatsApp (simulated)`, done: true },
      rem ? { when: rem, text: 'Reminder text with your arrival window' } : null,
      { when: 'On the day', text: `A message when ${brand.ownerFirst} is ${PROMISES.awayMinutes} minutes away` },
      { when: 'After the job', text: 'Certificate and receipt, then a quick review request' }
    ].filter(Boolean);
  }
  return html`<div class="bk-block">
    <p class="bk-eyebrow">What happens next</p>
    <ol class="bk-timeline" data-testid="confirmation-timeline">
      ${items.map((it, i) => html`<li key=${i} class=${'bk-timeline__item' + (it.done ? ' is-done' : '')}>
        <span class="bk-timeline__mark" aria-hidden="true">${it.done ? html`<${Icon} name="check" size=${14} />` : null}</span>
        <span class="bk-timeline__body"><span class="bk-timeline__when">${it.when}</span><span class="bk-timeline__text">${it.text}</span></span>
      </li>`)}
    </ol>
  </div>`;
}

function SafetyLines() {
  return html`<ol class="bk-safety">
    <li>Fire, or someone has had a shock: call 999.</li>
    <li>If it is safe, switch off at the fuse box (consumer unit).</li>
    <li>Do not touch anything wet, scorched or sparking.</li>
  </ol>`;
}

function DemoPanel({ booking, state, brand }) {
  const msgs = selectMessages(state, { bookingId: booking.id });
  const ownerMsg = msgs.find((m) => m.kind === 'owner_new_booking' || m.kind === 'owner_emergency');
  if (!ownerMsg) return null;
  // Oldest first: what the customer got when they booked, then (live) what they got when the owner confirmed.
  const custMsgs = [...msgs].reverse().filter((m) => ['customer_confirmed', 'customer_received', 'customer_emergency_received'].includes(m.kind));
  const stamp = nowStamp();
  const actions = bubbleActions(ownerMsg, booking, stamp).map((a) => ({ id: a.id, label: a.label }));
  const enquiry = isEnquiry(booking);
  return html`<section class="bk-demo" data-testid="demo-panel" aria-labelledby="bk-demo-title">
    <p class="bk-demo__tag">DEMO · SIMULATED</p>
    <h3 class="bk-demo__title" id="bk-demo-title">This is the message ${brand.ownerFirst}'s phone just received</h3>
    <${PhoneMock} title=${enquiry ? 'New enquiries' : brand.shortName + ' bookings'} subtitle=${brand.ownerFirst + "'s phone (simulated)"}>
      <${WhatsAppBubble} direction="in" body=${ownerMsg.body} time=${stampTime(ownerMsg.at)} stateLabel="Sent (simulated)" actions=${actions} onAction=${() => {}} data-testid="demo-owner-bubble" />
    <//>
    ${custMsgs.map((m, i) => html`<div key=${m.id}><p class="bk-eyebrow bk-demo__label">${i === 0 ? 'What you received' : `Then, when ${brand.ownerFirst} confirmed`}</p>
    <${PhoneMock} title=${brand.name} subtitle=${firstName(booking.customer.name) + "'s phone (simulated)"}>
      <${WhatsAppBubble} direction="out" body=${m.body} time=${stampTime(m.at)} stateLabel="Sent (simulated)" data-testid=${i === 0 ? 'demo-customer-bubble' : `demo-customer-bubble-${i}`} />
    <//></div>`)}
    <${Button} variant="secondary" size="lg" block iconRight="arrow-right" href=${pageHref('dashboard.html', '#/bookings/' + booking.id)} target=${pageTarget('dashboard.html')} data-testid="demo-open-dashboard">Open ${brand.ownerFirst}'s dashboard<//>
  </section>`;
}

/** His thank-you page, plus the reference, the pencilled-in survey and the simulated alerts (our value add). */
function EnquiryConfirmation({ ctx, booking }) {
  const { state, brand, go, close } = ctx;
  const service = selectService(state, booking.serviceId);
  const chip = statusChipFor(booking, brand);
  const cancelled = booking.status === 'cancelled';
  return html`<div class="bk-step bk-confirm bk-confirm--enquiry" data-testid="confirmation">
    <div class="bk-confirm__art"><${Tick} /></div>
    <div class="bk-titleblock bk-titleblock--center">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="confirmation-title">${cancelled ? 'This enquiry was cancelled.' : FUNNEL_CONFIRM.title}</h2>
      ${cancelled ? null : html`<p class="bk-sub bk-confirm__lead" data-testid="confirmation-lead">${FUNNEL_CONFIRM.body(brand.name)}</p>`}
    </div>
    <div class="bk-confirm__status" role="status" aria-live="polite">
      <${Chip} tone=${chip.tone} icon=${chip.icon} data-testid="confirmation-status">${chip.text}<//>
    </div>
    <${ConfirmTicket} booking=${booking} service=${service} brand=${brand} />
    <div class="bk-ready" data-testid="funnel-ready-box">
      <p class="bk-ready__title"><${Icon} name="info" size=${18} />${' '}<span>${FUNNEL_CONFIRM.readyTitle}</span></p>
      <p class="bk-ready__text">${FUNNEL_CONFIRM.ready}</p>
    </div>
    <${Timeline} booking=${booking} brand=${brand} remindersOn=${state.settings.remindersOn} />
    <div class="bk-actions">
      <${Button} variant="secondary" size="lg" block class="bk-pill bk-callbtn" icon="phone" href=${brand.telHref} data-testid="confirmation-call">Prefer to speak to us?${' '}<span class="bk-nowrap">Call ${brand.phone}</span><//>
      <div class="bk-actions__links">
        <button type="button" class="bk-linkbtn" onClick=${() => go({ manageRef: booking.ref })} data-testid="confirmation-manage">Change or cancel</button>
        <button type="button" class="bk-linkbtn" onClick=${() => close()} data-testid="confirmation-done">Done</button>
      </div>
    </div>
    <${DemoPanel} booking=${booking} state=${state} brand=${brand} />
  </div>`;
}

export function Confirmation({ ctx, refId }) {
  const { state, brand, go, close } = ctx;
  const booking = selectBookingByRef(state, refId);
  if (!booking) {
    return html`<div class="bk-step" data-testid="confirmation">
      <${EmptyState} icon="calendar-x" title="We couldn't find that reference" body=${`Check the reference, or call ${brand.ownerFirst} on ${brand.phone}.`}
        action=${html`<div class="bk-contact"><${Button} variant="primary" class="bk-pill" onClick=${() => go({})}>Get my installation quote<//><${Button} icon="phone" href=${brand.telHref}>Call ${brand.ownerFirst}<//></div>`} />
    </div>`;
  }
  if (isEnquiry(booking)) return html`<${EnquiryConfirmation} ctx=${ctx} booking=${booking} />`;
  const service = selectService(state, booking.serviceId);
  const first = firstName(booking.customer.name);
  const chip = statusChipFor(booking, brand);
  const ids = bookingWindowIds(booking);
  const arriveLabel = ids.length ? WINDOWS[ids[0]].label : '';
  const waText = booking.urgent
    ? `Hi ${brand.ownerFirst}, it's ${first}, emergency request ${booking.ref}.`
    : `Hi ${brand.ownerFirst}, it's ${first}, booking ${booking.ref} for ${fmtDayShort(stampDay(booking.start))} ${arriveLabel}.`;
  return html`<div class="bk-step bk-confirm" data-testid="confirmation">
    <div class="bk-confirm__art"><${Tick} /></div>
    <div class="bk-titleblock bk-titleblock--center">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="confirmation-title">${titleFor(booking, first)}</h2>
    </div>
    <div class="bk-confirm__status" role="status" aria-live="polite">
      <${Chip} tone=${chip.tone} icon=${chip.icon} data-testid="confirmation-status">${chip.text}<//>
    </div>
    <${ConfirmTicket} booking=${booking} service=${service} brand=${brand} />
    ${booking.urgent ? html`<${SafetyLines} />` : null}
    <${Timeline} booking=${booking} brand=${brand} remindersOn=${state.settings.remindersOn} />
    <div class="bk-actions">
      ${booking.urgent ? null : html`<${Button} variant="secondary" size="lg" block icon="download" onClick=${() => downloadIcs(booking, state.settings)} data-testid="add-to-calendar">Add to calendar<//>`}
      <${Button} variant="secondary" size="lg" block icon="message-circle" href=${waLink(brand.phone, waText, brand.demoPhoneDigits)} data-testid="confirmation-whatsapp">Message ${brand.ownerFirst} on WhatsApp<//>
      <${Button} variant="secondary" size="lg" block icon="phone" href=${brand.telHref} data-testid="confirmation-call">Call ${brand.ownerFirst}<//>
      <div class="bk-actions__links">
        <button type="button" class="bk-linkbtn" onClick=${() => go({ manageRef: booking.ref })} data-testid="confirmation-manage">Change or cancel</button>
        <button type="button" class="bk-linkbtn" onClick=${() => close()} data-testid="confirmation-done">Done</button>
      </div>
    </div>
    <${DemoPanel} booking=${booking} state=${state} brand=${brand} />
  </div>`;
}
