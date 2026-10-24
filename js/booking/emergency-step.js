// js/booking/emergency-step.js: the emergency request path (#book/emergency): safety first, reasons, four fields, one tap.
// Owner: WP3
import { html } from '../vendor/preact-htm.js';
import { Banner, Button, Chip } from '../ui/index.js';
import { createBooking } from '../core/store.js';
import { EMERGENCY_REASONS, PROMISES } from '../core/config.js';
import { todayKey } from '../core/clock.js';
import { validateName, validatePhone, validatePostcode } from '../core/format.js';
import { telLink } from '../core/messages.js';
import { toast } from '../ui/index.js';
import { StepTitle } from './bk-shared.js';
import { CustomerFields, focusField } from './details-step.js';
import { clearDraft } from './draft.js';

export function EmergencyStep({ ctx }) {
  const { state, brand, form, setForm, shown } = ctx;
  if (!state.settings.takingEmergencies) {
    return html`<div class="bk-step">
      <${StepTitle}>Emergency visit<//>
      <${Banner} tone="warn" icon="siren" data-testid="emergency-off-banner">Not taking emergency visits right now. Call 999 for fire or shock, or ${PROMISES.powerCutNumber} for a power cut.<//>
      <${Button} variant="primary" size="lg" block icon="phone" href=${brand.telHref}>Call ${brand.ownerFirst}<//>
    </div>`;
  }
  const reasons = form.reasons || [];
  const toggle = (id) => setForm({ reasons: reasons.includes(id) ? reasons.filter((r) => r !== id) : [...reasons, id] });
  const reasonError = shown.has('reasons') && reasons.length === 0 ? 'Choose what is happening' : '';
  return html`<div class="bk-step">
    <${Banner} tone="danger" class="bk-banner">If there is a fire, or someone has had a shock, call 999.<//>
    <${StepTitle}>What is happening?<//>
    <div class="bk-reasons" role="group" aria-label="What is happening?">
      ${EMERGENCY_REASONS.map((r) => html`<${Chip} key=${r.id} class="bk-reason" selected=${reasons.includes(r.id)} onClick=${() => toggle(r.id)} data-testid=${'emergency-reason-' + r.id}>${r.label}<//>`)}
    </div>
    ${reasonError ? html`<p class="ui-field__error bk-reasons__error" role="alert" data-testid="error-reasons">${reasonError}</p>` : null}
    <${CustomerFields} ctx=${ctx} urgent=${true} />
  </div>`;
}

export function EmergencyFooter({ ctx }) {
  const { brand, submitting, state } = ctx;
  if (!state.settings.takingEmergencies) return null;
  return html`<div class="bk-footer">
    <${Button} variant="emergency" size="lg" block loading=${submitting} onClick=${() => submitEmergency(ctx)} data-testid="emergency-submit">Send emergency request<//>
    <p class="bk-footer__note"><a class="ui-link bk-footer__call" href=${telLink(brand.phone)} data-testid="emergency-phone-link">Rather call? ${brand.phone}</a></p>
  </div>`;
}

export function submitEmergency(ctx) {
  const { form, lock } = ctx;
  if (lock.current) return;
  const errors = { name: validateName(form.name), phone: validatePhone(form.phone), postcode: validatePostcode(form.postcode) };
  const reasons = form.reasons || [];
  ctx.setShown(new Set(['name', 'phone', 'postcode', 'line1', 'reasons']));
  const firstBad = ['name', 'phone', 'postcode'].find((k) => errors[k]);
  if (reasons.length === 0) {
    const el = document.querySelector('[data-testid="emergency-reason-no_power"]');
    if (el && !firstBad) el.focus();
  }
  if (firstBad) { focusField(firstBad); return; }
  if (reasons.length === 0) return;

  lock.current = true;
  ctx.setSubmitting(true);
  const res = createBooking({
    urgent: true, serviceId: 'emergency', date: todayKey(), windowId: null, emergencyReasons: reasons,
    customer: { name: form.name, phone: form.phone }, address: { line1: form.line1, postcode: form.postcode },
    notes: form.note, source: 'website'
  });
  if (res.ok) { clearDraft(); ctx.onSuccess(res.booking); return; }
  lock.current = false;
  ctx.setSubmitting(false);
  if (res.reason === 'invalid') {
    const bad = ['name', 'phone', 'postcode'].find((k) => (res.errors || {})[k]);
    if (bad) focusField(bad);
  } else if (res.reason === 'emergencies_off') {
    toast({ message: `${ctx.brand.ownerFirst} is not taking emergency visits right now. Please call.`, tone: 'danger' });
  } else {
    toast({ message: 'That did not work: the diary changed. Please check and try again.', tone: 'danger' });
  }
}
