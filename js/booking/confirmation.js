// js/booking/confirmation.js: Confirmation screen (#booked/<ref>): breaker art, live status, ticket, timeline, buttons, DEMO panel.
// Owner: WP3
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
import { BreakerArt } from '../landing/art.js';

const reasonLabel = (id) => (EMERGENCY_REASONS.find((r) => r.id === id) || { label: id }).label;

/** The booking summary card used by Confirmation and Manage. `live` booking from the store. */
export function ConfirmTicket({ booking, service, brand, testid = 'confirmation-ticket', refTestid = 'confirmation-ref', showAlert = true }) {
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
    : `${priceText(service, booking.quotedPrice)}${service && service.priceType === 'free' ? '' : ' · pay after the job'}`;
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

function Timeline({ booking, brand, remindersOn }) {
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
  return html`<section class="bk-demo" data-testid="demo-panel" aria-labelledby="bk-demo-title">
    <p class="bk-demo__tag">DEMO · SIMULATED</p>
    <h3 class="bk-demo__title" id="bk-demo-title">This is the message ${brand.ownerFirst}'s phone just received</h3>
    <${PhoneMock} title=${brand.shortName + ' bookings'} subtitle=${brand.ownerFirst + "'s phone (simulated)"}>
      <${WhatsAppBubble} direction="in" body=${ownerMsg.body} time=${stampTime(ownerMsg.at)} stateLabel="Sent (simulated)" actions=${actions} onAction=${() => {}} data-testid="demo-owner-bubble" />
    <//>
    ${custMsgs.map((m, i) => html`<div key=${m.id}><p class="bk-eyebrow bk-demo__label">${i === 0 ? 'What you received' : `Then, when ${brand.ownerFirst} confirmed`}</p>
    <${PhoneMock} title=${brand.name} subtitle=${firstName(booking.customer.name) + "'s phone (simulated)"}>
      <${WhatsAppBubble} direction="out" body=${m.body} time=${stampTime(m.at)} stateLabel="Sent (simulated)" data-testid=${i === 0 ? 'demo-customer-bubble' : `demo-customer-bubble-${i}`} />
    <//></div>`)}
    <${Button} variant="secondary" size="lg" block iconRight="arrow-right" href=${pageHref('dashboard.html', '#/bookings/' + booking.id)} target=${pageTarget('dashboard.html')} data-testid="demo-open-dashboard">Open ${brand.ownerFirst}'s dashboard<//>
  </section>`;
}

export function Confirmation({ ctx, refId }) {
  const { state, brand, go, close } = ctx;
  const booking = selectBookingByRef(state, refId);
  if (!booking) {
    return html`<div class="bk-step" data-testid="confirmation">
      <${EmptyState} icon="calendar-x" title="Booking not found" body=${`We couldn't find that booking. Check the reference, or call ${brand.ownerFirst}.`}
        action=${html`<div class="bk-contact"><${Button} variant="primary" onClick=${() => go({})}>Book a visit<//><${Button} icon="phone" href=${brand.telHref}>Call ${brand.ownerFirst}<//></div>`} />
    </div>`;
  }
  const service = selectService(state, booking.serviceId);
  const first = firstName(booking.customer.name);
  const chip = statusChipFor(booking, brand);
  const ids = bookingWindowIds(booking);
  const arriveLabel = ids.length ? WINDOWS[ids[0]].label : '';
  const waText = booking.urgent
    ? `Hi ${brand.ownerFirst}, it's ${first}, emergency request ${booking.ref}.`
    : `Hi ${brand.ownerFirst}, it's ${first}, booking ${booking.ref} for ${fmtDayShort(stampDay(booking.start))} ${arriveLabel}.`;
  return html`<div class="bk-step bk-confirm" data-testid="confirmation">
    <div class="bk-confirm__art"><${BreakerArt} /></div>
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
