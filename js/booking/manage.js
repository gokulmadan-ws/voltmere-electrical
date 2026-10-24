// js/booking/manage.js: Manage page (#manage/<ref>): live status, customer cancel (free until the cutoff), call and WhatsApp.
// Owner: WP3
import { html, useState } from '../vendor/preact-htm.js';
import { Icon, Button, Select, Sheet, EmptyState, toast } from '../ui/index.js';
import { cancelBooking } from '../core/store.js';
import { isWithinChangeCutoff, selectBookingByRef, selectService } from '../core/selectors.js';
import { nowStamp } from '../core/clock.js';
import { stampTime } from '../core/dates.js';
import { PROMISES } from '../core/config.js';
import { waLink } from '../core/messages.js';
import { StepTitle, ContactButtons } from './bk-shared.js';
import { ConfirmTicket } from './confirmation.js';

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
      <${EmptyState} icon="calendar-x" title="Booking not found" body=${`We couldn't find that booking. Check the reference, or call ${brand.ownerFirst}.`}
        action=${html`<div class="bk-contact"><${Button} variant="primary" onClick=${() => go({})}>Book a visit<//><${Button} icon="phone" href=${brand.telHref}>Call ${brand.ownerFirst}<//></div>`} />
    </div>`;
  }

  const service = selectService(state, booking.serviceId);
  const active = booking.status === 'new' || booking.status === 'confirmed';
  const close = isWithinChangeCutoff(booking, nowStamp());
  const canCancel = active && !close && !booking.urgent;
  const waText = `Hi ${brand.ownerFirst}, it's about booking ${booking.ref}.`;
  const wa = waLink(brand.phone, waText, brand.demoPhoneDigits);

  const doCancel = () => {
    const res = cancelBooking(booking.id, 'customer', { reason });
    setConfirming(false);
    if (res.ok) toast({ message: 'Visit cancelled. That time is free again.' });
    else if (res.reason === 'not_allowed') toast({ message: `This is close, so please call ${brand.ownerFirst}.`, tone: 'danger' });
    else if (res.reason === 'not_found') toast({ message: 'That booking no longer exists.', tone: 'danger' });
    else toast({ message: 'That did not work: the diary changed. Please check and try again.', tone: 'danger' });
  };

  return html`<div class="bk-step" data-testid="manage-page">
    <${StepTitle} sub=${`Reference ${booking.ref}`}>Your booking<//>
    <${ConfirmTicket} booking=${booking} service=${service} brand=${brand} testid="manage-ticket" refTestid="manage-ref" showAlert=${false} />
    ${booking.status === 'cancelled'
    ? html`<div class="bk-block">
        <p class="bk-note bk-note--strong">This booking was cancelled.</p>
        <${Button} variant="primary" size="lg" block onClick=${() => go({})}>Book again<//>
      </div>`
    : html`<${StatusTimeline} booking=${booking} brand=${brand} />`}
    ${canCancel ? html`<div class="bk-block">
      <${Button} variant="secondary" size="lg" block icon="calendar-x" onClick=${() => setConfirming(true)} data-testid="manage-cancel">Cancel visit<//>
      <p class="bk-note">To change the time, call or WhatsApp ${brand.ownerFirst}.</p>
      <${ContactButtons} brand=${brand} text=${waText} />
    </div>` : null}
    ${active && !canCancel ? html`<div class="bk-block">
      <p class="bk-note bk-note--strong" data-testid="manage-close-note">This is close, so please call ${brand.ownerFirst}.</p>
      <${ContactButtons} brand=${brand} text=${waText} />
    </div>` : null}
    <${Sheet} open=${confirming} onClose=${() => setConfirming(false)} title="Cancel this visit?" size="auto" testid="confirm-dialog"
      initialFocus='[data-testid="confirm-cancel"]'
      footer=${html`<div class="ui-confirm__actions ui-confirm__actions--danger">
        <${Button} variant="secondary" onClick=${() => setConfirming(false)} data-testid="confirm-cancel">Keep my visit<//>
        <${Button} variant="danger" onClick=${doCancel} data-testid="manage-cancel-confirm">Cancel visit<//>
      </div>`}>
      <p class="ui-confirm__body">It is free to cancel more than ${PROMISES.freeChangeHours} hours before. The time becomes free for someone else straight away.</p>
      <div class="bk-reason-select">
        <label class="ui-field__label" for="bk-cancel-reason">Reason (optional)</label>
        <${Select} id="bk-cancel-reason" value=${reason} onChange=${(e) => setReason(e.target.value)} options=${REASONS} data-testid="manage-cancel-reason" />
      </div>
    <//>
  </div>`;
}
