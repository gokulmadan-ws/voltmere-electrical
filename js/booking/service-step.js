// js/booking/service-step.js: Step 0 "What do you need?" (one tap per service, plus the emergency row).
// Owner: WP3, copy refreshed by D2 (owner phone jobs; the website goes straight to the quote funnel)
import { html } from '../vendor/preact-htm.js';
import { Icon } from '../ui/index.js';
import { selectServices } from '../core/selectors.js';
import { StepTitle, ContactButtons, listPrice } from './bk-shared.js';

// A price label longer than this ('Quoted for your home') would squeeze the title if it sat in the right-hand column, so it becomes a
// muted third line under the duration. Short ones ('Free', 'From £75', 'From £150', '£195') stay right-aligned on one line.
const LONG_PRICE = 12;

/** One service row: icon, title over duration (over a long price note), a short price on the right, a chevron. */
function ServiceRow({ service: s, onPick }) {
  const price = listPrice(s);
  const long = price.length > LONG_PRICE;
  return html`<button type="button" class=${long ? 'bk-service bk-service--note' : 'bk-service'} data-testid=${'service-option-' + s.id} onClick=${onPick}>
    <span class="bk-service__icon"><${Icon} name=${s.icon} size=${24} /></span>
    <span class="bk-service__main">
      <span class="bk-service__name">${s.name}</span>
      <span class="bk-service__meta">${s.durationLabel}</span>
      ${long ? html`<span class="bk-service__note">${price}</span>` : null}
    </span>
    ${long ? null : html`<span class="bk-service__price">${price}</span>`}
    <${Icon} name="chevron-right" size=${20} class="bk-service__chev" />
  </button>`;
}

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
      ${services.map((s) => html`<${ServiceRow} key=${s.id} service=${s} onPick=${() => go({ serviceId: s.id })} />`)}
    </div>
    <p class="bk-helper">A call about a charger? Start with ${(services.find((s) => s.id === 'ev_quote') || { name: 'the quote visit' }).name}: a free survey and written quote. The installation itself is booked once the quote is agreed.</p>
  </div>`;
}
