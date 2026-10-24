// js/landing/sticky-bar.js: L13 fixed Call / WhatsApp / Book a visit bar for phones (hidden from 768 and while a sheet or the keyboard is open).
// Owner: WP3
import { html } from '../vendor/preact-htm.js';
import { Icon, useBrand } from '../ui/index.js';
import { waLink } from '../core/messages.js';
import { bookClick, waBookText } from './content.js';

export function StickyBar() {
  const brand = useBrand();
  const wa = waLink(brand.phone, waBookText(brand), brand.demoPhoneDigits);
  return html`
    <nav class="lp-sticky" aria-label="Quick actions" data-testid="sticky-bar">
      <a class="lp-sticky__btn" href=${brand.telHref} data-testid="sticky-call"><${Icon} name="phone" size=${22} /><span>Call</span></a>
      <a class="lp-sticky__btn" href=${wa} target="_blank" rel="noopener noreferrer" data-testid="sticky-whatsapp"><${Icon} name="message-circle" size=${22} /><span>WhatsApp</span></a>
      <button type="button" class="ui-btn ui-btn--primary ui-btn--lg lp-sticky__book" data-testid="sticky-book" onClick=${bookClick({})}><span class="ui-btn__label">Book a visit</span></button>
    </nav>
  `;
}
