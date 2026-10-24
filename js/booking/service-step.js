// js/booking/service-step.js: Step 0 "What do you need?" (one tap per service, plus the emergency row).
// Owner: WP3
import { html } from '../vendor/preact-htm.js';
import { Icon } from '../ui/index.js';
import { selectServices, servicePriceLabel } from '../core/selectors.js';
import { StepTitle, ContactButtons } from './bk-shared.js';

export function ServiceStep({ ctx }) {
  const { state, brand, ownerMode, go } = ctx;
  const services = selectServices(state).filter((s) => s.id !== 'emergency');
  const emergencyOn = !ownerMode && state.settings.takingEmergencies;

  if (services.length === 0) {
    return html`<div class="bk-step">
      <${StepTitle}>What do you need?<//>
      <p class="bk-note">No services are on offer right now. Call ${brand.ownerFirst}.</p>
      <${ContactButtons} brand=${brand} />
    </div>`;
  }

  return html`<div class="bk-step">
    ${emergencyOn ? html`<button type="button" class="bk-emergency-row" data-testid="booking-emergency-link" onClick=${() => go({ emergency: true })}>
      <${Icon} name="siren" size=${24} class="bk-emergency-row__icon" />
      <span class="bk-emergency-row__text"><strong>Emergency right now?</strong> Request an urgent visit</span>
      <${Icon} name="chevron-right" size=${20} />
    </button>` : null}
    <${StepTitle}>What do you need?<//>
    <div class="bk-services">
      ${services.map((s) => html`<button type="button" key=${s.id} class="bk-service" data-testid=${'service-option-' + s.id} onClick=${() => go({ serviceId: s.id })}>
        <span class="bk-service__icon"><${Icon} name=${s.icon} size=${24} /></span>
        <span class="bk-service__main">
          <span class="bk-service__name">${s.name}</span>
          <span class="bk-service__meta">${s.durationLabel}</span>
        </span>
        <span class="bk-service__price">${servicePriceLabel(s)}</span>
        <${Icon} name="chevron-right" size=${20} class="bk-service__chev" />
      </button>`)}
    </div>
    <p class="bk-helper">Not sure? Choose Fault finding. ${brand.ownerFirst} will work it out on the day.</p>
  </div>`;
}
