// js/landing/footer.js: footer: 180 Electrical, phone, email, "Serving Northern Ireland", owner login, About link, theme choice, disclosure.
// Owner: C2 (landing page for 180 Electrical)
import { html } from '../vendor/preact-htm.js';
import { Icon, PrototypeNotice, ThemeToggle, useBrand, pageHref, pageTarget } from '../ui/index.js';
import { mailtoLink } from '../core/messages.js';
import { LogoImg } from './media.js';

export function Footer() {
  const brand = useBrand();
  return html`
    <footer class="lp-footer" data-testid="footer">
      <div class="lp-container lp-footer__inner">
        <div class="lp-footer__brand">
          <p class="lp-footer__name"><${LogoImg} name=${brand.name} class="lp-logo--footer" /><span>${brand.name}</span></p>
          <ul class="lp-footer__contact">
            <li><a class="lp-footer__link" href=${brand.telHref} data-testid="footer-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a></li>
            <li><a class="lp-footer__link" href=${mailtoLink(brand.email)} data-testid="footer-email"><${Icon} name="send" size=${20} /><span>${brand.email}</span></a></li>
            <li class="lp-footer__line"><${Icon} name="map-pin" size=${20} /><span>Serving Northern Ireland</span></li>
          </ul>
        </div>
        <div class="lp-footer__side">
          <ul class="lp-footer__links">
            <li><a class="lp-footer__link lp-footer__link--strong" href=${pageHref('dashboard.html', '#/today')} target=${pageTarget('dashboard.html')} data-testid="footer-owner-link"><span>Owner login (demo) →</span></a></li>
            <li><a class="lp-footer__link" href=${pageHref('dashboard.html', '#/about')} target=${pageTarget('dashboard.html')} data-testid="footer-about-link"><span>What's real in this prototype</span></a></li>
          </ul>
          <div class="lp-footer__theme">
            <p class="lp-footer__label" id="footer-appearance">Appearance</p>
            <${ThemeToggle} variant="segmented" />
          </div>
        </div>
        <div class="lp-footer__legal">
          <${PrototypeNotice} variant="footer" page="landing" />
        </div>
      </div>
    </footer>
  `;
}
