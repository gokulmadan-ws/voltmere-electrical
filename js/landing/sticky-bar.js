// js/landing/sticky-bar.js: fixed bottom bar for phones: one pill "Get my installation quote" and a round Call button (hidden from 768 and while the funnel or keyboard is open).
// Owner: L3 (landing page for 180 Electrical; first built by C2)
import { html } from '../vendor/preact-htm.js';
import { Icon, useBrand } from '../ui/index.js';
import { CTA_LABEL, bookClick } from './content.js';

export function StickyBar() {
  const brand = useBrand();
  return html`
    <nav class="lp-sticky" aria-label="Quick actions" data-testid="sticky-bar">
      <button type="button" class="ui-btn ui-btn--primary ui-btn--lg lp-cta lp-sticky__book" data-testid="sticky-book" onClick=${bookClick({})}><span class="ui-btn__label">${CTA_LABEL}</span><${Icon} name="arrow-right" size=${20} class="ui-btn__icon" /></button>
      <a class="lp-sticky__call" href=${brand.telHref} aria-label=${`Call ${brand.phone}`} data-testid="sticky-call"><${Icon} name="phone" size=${24} /></a>
    </nav>
  `;
}
