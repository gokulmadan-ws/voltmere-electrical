// js/booking/manage.js: Manage page (#manage/<ref>): live status, customer cancel (free until the cutoff), call and WhatsApp.
// Owner: WP3, enquiry wording by D2, journey timeline, quote link and cancel rules by D3
import { html, useState } from '../vendor/preact-htm.js';
import { Icon, Button, Chip, Select, Sheet, EmptyState, toast } from '../ui/index.js';
import { cancelBooking } from '../core/store.js';
import { isWithinChangeCutoff, selectBookingByRef, selectService, selectQuoteForBooking } from '../core/selectors.js';
import { waLink } from '../core/messages.js';
import { firstName } from '../core/format.js';
import { nowStamp } from '../core/clock.js';
import { stampTime } from '../core/dates.js';
import { PROMISES } from '../core/config.js';
import { StepTitle } from './bk-shared.js';
import { ConfirmTicket, JourneyTimeline, QuoteNote, VisitCard, enquiryJourney, isEnquiry, statusChipFor, visitWords } from './confirmation.js';
import { replyHours } from './funnel.js';

const REASONS = [
  { value: '', label: 'No reason given' },
  { value: 'Changed my mind', label: 'Changed my mind' },
  { value: 'Found someone else', label: 'Found someone else' },
  { value: 'No longer needed', label: 'No longer needed' },
  { value: 'Other', label: 'Other' }
];

const STEPS = [
  { id: 'new', label: 'Requested' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'on_the_way', label: 'On the way' },
  { id: 'done', label: 'Done' }
];

/** The classic four-step status strip (phone jobs). Enquiries use the journey timeline instead. */
function StatusTimeline({ booking, brand }) {
  const at = STEPS.findIndex((s) => s.id === booking.status);
  return html`<div class="bk-block">
    <ol class="bk-steps" data-testid="manage-status-timeline" aria-label="Booking status">
      ${STEPS.map((s, i) => html`<li key=${s.id} class=${'bk-steps__item' + (i < at ? ' is-past' : '') + (i === at ? ' is-current' : '')} aria-current=${i === at ? 'step' : undefined}>
        <span class="bk-steps__mark" aria-hidden="true">${i < at ? html`<${Icon} name="check" size=${14} />` : null}</span>
        <span class="bk-steps__label">${s.label}</span>
      </li>`)}
    </ol>
    ${booking.status === 'on_the_way' && booking.etaAt ? html`<p class="bk-note">${brand.ownerFirst} is on the way. Expected about ${stampTime(booking.etaAt)} (${brand.ownerFirst}'s own estimate, not live tracking).</p>` : null}
  </div>`;
}

export function Manage({ ctx, refId }) {
  const { state, brand, go } = ctx;
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const booking = selectBookingByRef(state, refId);

  if (!booking) {
    return html`<div class="bk-step" data-testid="manage-not-found">
      <${EmptyState} icon="calendar-x" title="We couldn't find that reference" body=${`Check the reference, or call ${brand.ownerFirst} on ${brand.phone}.`}
        action=${html`<div class="bk-contact"><${Button} variant="primary" class="bk-pill" onClick=${() => go({})}>Get my installation quote<//><${Button} icon="phone" href=${brand.telHref}>Call ${brand.ownerFirst}<//></div>`} />
    </div>`;
  }

  const service = selectService(state, booking.serviceId);
  const enquiry = isEnquiry(booking);
  const pending = enquiry && booking.status === 'new';
  const active = booking.status === 'new' || booking.status === 'confirmed';
  const close = isWithinChangeCutoff(booking, nowStamp());
  // CONTRACT-GAP: core cancelBooking(id, 'customer') refuses inside freeChangeHours even for a pencilled enquiry nobody has confirmed, so the
  // button is offered only when the store would accept it. Ask A3 to let a customer withdraw a 'new' ev_quote at any time, then this can drop `!close`.
  const canCancel = active && !booking.urgent && !close;
  const waText = `Hi ${brand.ownerFirst}, it's ${firstName(booking.customer.name)}, about ${enquiry ? 'my EV charger enquiry' : 'booking'} ${booking.ref}.`;
  const noun = enquiry ? 'enquiry' : 'visit';
  const hours = replyHours(state);
  const chip = statusChipFor(booking, brand);
  // One status: once Daniel has confirmed the visit, the visit card (right under) says so, so the pill stays away.
  const visitSaysIt = enquiry && active && !!visitWords(booking) && booking.status === 'confirmed';
  const quote = enquiry ? selectQuoteForBooking(state, booking.id) : null;

  const doCancel = () => {
    const res = cancelBooking(booking.id, 'customer', { reason });
    setConfirming(false);
    if (res.ok) toast({ message: enquiry ? 'Enquiry cancelled. The suggested visit time is free again.' : 'Visit cancelled. That time is free again.' });
    else if (res.reason === 'not_allowed') toast({ message: `This is close, so please call ${brand.ownerFirst}.`, tone: 'danger' });
    else if (res.reason === 'not_found') toast({ message: 'That booking no longer exists.', tone: 'danger' });
    else if (res.reason === 'storage_full') toast({ message: 'This device has no room left to save that change. Please call instead.', tone: 'danger' });
    else toast({ message: 'That did not work: the diary changed. Please check and try again.', tone: 'danger' });
  };

  const contact = html`<div class="bk-contact">
    <${Button} variant="secondary" size="md" icon="phone" href=${brand.telHref} data-testid="manage-call">Call ${brand.phone}<//>
    <${Button} variant="secondary" size="md" icon="message-circle" href=${waLink(brand.phone, waText, brand.demoPhoneDigits)} data-testid="manage-whatsapp">WhatsApp<//>
  </div>`;
  const cancelled = booking.status === 'cancelled';

  return html`<div class="bk-step bk-manage" data-testid="manage-page">
    <${StepTitle} sub=${enquiry ? undefined : `Reference ${booking.ref}`}>${enquiry ? 'Your enquiry' : 'Your booking'}<//>
    <div class="bk-confirm__status bk-confirm__status--left" role="status" aria-live="polite">
      ${visitSaysIt ? null : html`<${Chip} tone=${chip.tone} icon=${chip.icon} data-testid="manage-status">${chip.text}<//>`}
    </div>
    <${ConfirmTicket} booking=${booking} service=${service} brand=${brand} hours=${hours} settings=${state.settings} calendar=${enquiry && active} testid="manage-ticket" refTestid="manage-ref" />
    ${enquiry && active ? html`<${VisitCard} booking=${booking} brand=${brand} settings=${state.settings} />` : null}
    ${enquiry ? html`<${QuoteNote} state=${state} booking=${booking} brand=${brand} />` : null}
    ${cancelled
    ? html`<div class="bk-block">
        <p class="bk-note bk-note--strong">${enquiry ? 'This enquiry was cancelled.' : 'This booking was cancelled.'}</p>
        <${Button} variant="primary" size="lg" block class=${enquiry ? 'bk-pill' : ''} onClick=${() => go(enquiry ? { serviceId: 'ev_quote' } : {})}>${enquiry ? 'Get my installation quote' : 'Book again'}<//>
      </div>`
    : enquiry
      ? html`<${JourneyTimeline} items=${enquiryJourney(booking, brand, hours, quote)} testid="manage-status-timeline" label="Where things are" />`
      : html`<${StatusTimeline} booking=${booking} brand=${brand} />`}
    ${enquiry && booking.status === 'on_the_way' && booking.etaAt ? html`<p class="bk-note bk-note--strong" data-testid="manage-eta">${brand.ownerFirst} is on the way. Expected about ${stampTime(booking.etaAt)} (${brand.ownerFirst}'s own estimate, not live tracking).</p>` : null}
    ${pending ? html`<p class="bk-note bk-note--strong bk-manage__reply" data-testid="manage-reply-note"><${Icon} name="clock" size=${18} />${' '}<span>We'll be in touch within ${hours} hours.</span></p>` : null}
    ${canCancel ? html`<div class="bk-block bk-manage__actions">
      <${Button} variant="secondary" size="lg" block icon="calendar-x" onClick=${() => setConfirming(true)} data-testid="manage-cancel">${enquiry ? 'Cancel enquiry' : 'Cancel visit'}<//>
      <p class="bk-note">${enquiry ? `To change the visit time, call ${brand.ownerFirst}.` : `To change the time, call or WhatsApp ${brand.ownerFirst}.`}</p>
      ${contact}
    </div>` : null}
    ${active && !canCancel ? html`<div class="bk-block bk-manage__actions">
      <p class="bk-note bk-note--strong" data-testid="manage-close-note">This is close, so please call ${brand.ownerFirst}.</p>
      <p class="bk-note">${enquiry ? 'Your visit is coming up soon, so changes are best made by phone.' : 'The visit is coming up, so changes are best made by phone.'}</p>
      ${contact}
    </div>` : null}
    ${cancelled ? html`<div class="bk-block bk-manage__actions">${contact}</div>` : null}
    <${Sheet} open=${confirming} onClose=${() => setConfirming(false)} title=${`Cancel this ${noun}?`} size="auto" testid="confirm-dialog"
      initialFocus='[data-testid="confirm-cancel"]'
      footer=${html`<div class="ui-confirm__actions ui-confirm__actions--danger">
        <${Button} variant="secondary" onClick=${() => setConfirming(false)} data-testid="confirm-cancel">Keep my ${noun}<//>
        <${Button} variant="danger" onClick=${doCancel} data-testid="manage-cancel-confirm">Cancel ${noun}<//>
      </div>`}>
      <p class="ui-confirm__body">${enquiry
    ? 'Any suggested visit time is released straight away. You can send a new enquiry whenever you like.'
    : `It is free to cancel more than ${PROMISES.freeChangeHours} hours before. The time becomes free for someone else straight away.`}</p>
      <div class="bk-reason-select">
        <label class="ui-field__label" for="bk-cancel-reason">Reason (optional)</label>
        <${Select} id="bk-cancel-reason" value=${reason} onChange=${(e) => setReason(e.target.value)} options=${REASONS} data-testid="manage-cancel-reason" />
      </div>
    <//>
  </div>`;
}
