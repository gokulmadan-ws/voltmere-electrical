// js/landing/footer.js: the bottom half of the closing composition (docs/LANDING-V5.md 5.12): black like the band above it, HIS logo (the un-striped lockup, because the logo's stripes are drawn
// beside it, bottom-right), three keyed rows (Phone at 48px, Email, Area; a fourth Address row only when the owner has typed one in Settings) and a small copyright line.
// No credentials line (they are in the hero's spec strip), no WhatsApp, no link cloud, no disclosure paragraph (it lives in the Prototype tools popover).
// Owner: L3 (landing page for 180 Electrical; first built by C2), rebuilt by LP1 (polish round 3) and for LANDING-V5 by B1.
import { html } from '../vendor/preact-htm.js';
import { useBrand, useNow, useStore } from '../ui/hooks.js';
import { mailtoLink } from '../core/messages.js';
import { LogoImg } from './media.js';

const selectBusiness = (state) => state.settings.business;

export function Footer() {
  const brand = useBrand();
  const business = useStore(selectBusiness);
  const now = useNow(3600000);
  // His site gives no street address, so the footer shows one only when the owner has typed one in Settings.
  const address = typeof business.address === 'string' ? business.address.trim() : '';
  return html`
    <footer class="lp-footer" data-testid="footer">
      <div class="lp-wrap lp-footer__grid">
        <a class="lp-footer__logo" href="#top" aria-label=${`${brand.name}, back to the top`} data-testid="footer-lockup"><${LogoImg} name=${brand.name} decorative=${true} /></a>
        <dl class="lp-footer__list">
          <div><dt>Phone</dt><dd class="lp-footer__phone"><a href=${brand.telHref} data-testid="footer-phone">${brand.phone}</a></dd></div>
          <div><dt>Email</dt><dd><a href=${mailtoLink(brand.email)} data-testid="footer-email">${brand.email}</a></dd></div>
          <div><dt>Area</dt><dd>${brand.areaText || 'Serving Northern Ireland'}</dd></div>
          ${address ? html`<div data-testid="l3-footer-address"><dt>Address</dt><dd><address>${address}</address></dd></div>` : null}
        </dl>
        <p class="lp-footer__legal" data-testid="footer-copyright">© ${now.getFullYear()} ${brand.name}</p>
      </div>
    </footer>
  `;
}
