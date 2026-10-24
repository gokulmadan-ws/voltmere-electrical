// js/landing/footer.js: the finished, quiet footer: HIS logo, phone, email, "Serving Northern Ireland", his two credentials and a small copyright line.
// Everything that was prototype furniture (owner login, what's real, the theme, the disclosure, the link cloud) now lives in the strip's "Prototype tools" popover (js/ui/notice.js).
// Owner: L3 (landing page for 180 Electrical; first built by C2), rebuilt by LP1 (polish round 3)
import { html } from '../vendor/preact-htm.js';
import { Icon, useBrand, useNow, useStore } from '../ui/index.js';
import { mailtoLink } from '../core/messages.js';
import { credentialList } from '../booking/bk-shared.js';
import { LogoImg } from './media.js';

const selectBusiness = (state) => state.settings.business;

export function Footer() {
  const brand = useBrand();
  const business = useStore(selectBusiness);
  const now = useNow(3600000);
  // His site gives no street address, so the footer shows one only when the owner has typed one in Settings.
  const address = typeof business.address === 'string' ? business.address.trim() : '';
  const credentials = credentialList({ settings: { business } });
  return html`
    <footer class="lp-footer" data-testid="footer">
      <div class="lp-container lp-footer__inner">
        <a class="lp-footer__name" href="#top" aria-label=${`${brand.name}, back to the top`}>
          <span class="lp-footer__logo" data-testid="footer-lockup"><${LogoImg} name=${brand.name} decorative=${true} /></span>
        </a>

        <ul class="lp-footer__list" aria-label="Contact">
          <li><a class="lp-footer__link" href=${brand.telHref} data-testid="footer-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a></li>
          <li><a class="lp-footer__link" href=${mailtoLink(brand.email)} data-testid="footer-email"><${Icon} name="mail" size=${20} /><span>${brand.email}</span></a></li>
          <li class="lp-footer__line"><${Icon} name="map-pin" size=${20} /><span>${brand.areaText || 'Serving Northern Ireland'}</span></li>
          ${address ? html`<li class="lp-footer__line lp-footer__address" data-testid="l3-footer-address"><${Icon} name="building-2" size=${20} /><address>${address}</address></li>` : null}
        </ul>

        <div class="lp-footer__base">
          <p class="lp-footer__creds" data-testid="l3-footer-credentials">${credentials.map((c, i) => html`${i ? html`<span class="lp-footer__sep" aria-hidden="true"> · </span>` : null}<span class="lp-footer__cred" key=${c}>${c}</span>`)}</p>
          <p class="lp-footer__copy" data-testid="footer-copyright">© ${now.getFullYear()} ${brand.name}</p>
        </div>
      </div>
    </footer>
  `;
}
