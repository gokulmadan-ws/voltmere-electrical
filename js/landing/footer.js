// js/landing/footer.js: the finished footer: logo, contact (phone, email, WhatsApp, serving area), credentials, page links, owner login, theme, prototype disclosure.
// Owner: L3 (landing page for 180 Electrical; first built by C2)
import { html } from '../vendor/preact-htm.js';
import { Button, Icon, PrototypeNotice, ThemeToggle, useBrand, useStore, pageHref, pageTarget } from '../ui/index.js';
import { mailtoLink, waLink } from '../core/messages.js';
import { CTA_LABEL, DEFAULT_CREDENTIALS, WHATSAPP_TEXT, bookClick } from './content.js';
import { LogoImg } from './media.js';

const selectBusiness = (state) => state.settings.business;

const EXPLORE = [
  { href: '#savings', label: 'What could you save?' },
  { href: '#about', label: 'About us' },
  { href: '#work', label: 'Our recent work' },
  { href: '#how', label: 'How it works' },
  { href: '#area', label: 'Check your postcode' },
  { href: '#faq', label: 'Questions' }
];

export function Footer() {
  const brand = useBrand();
  const business = useStore(selectBusiness);
  const credentials = Array.isArray(business.credentials) && business.credentials.length ? business.credentials : DEFAULT_CREDENTIALS;
  // His site gives no street address, so the footer shows one only when the owner has typed one in Settings.
  const address = typeof business.address === 'string' ? business.address.trim() : '';
  const wa = waLink(brand.phone, WHATSAPP_TEXT, brand.demoPhoneDigits);
  return html`
    <footer class="lp-footer" data-testid="footer">
      <div class="lp-container lp-footer__inner">
        <div class="lp-footer__brand">
          <p class="lp-footer__name"><${LogoImg} name=${brand.name} decorative=${true} class="lp-logo--footer" /><span>${brand.name}</span></p>
          <p class="lp-footer__tag">${brand.tagline}</p>
          <${Button} variant="primary" size="md" iconRight="arrow-right" class="lp-cta lp-footer__cta" onClick=${bookClick({})} data-testid="l3-footer-book">${CTA_LABEL}<//>
        </div>

        <div class="lp-footer__col">
          <h2 class="lp-footer__label" id="footer-contact">Get in touch</h2>
          <ul class="lp-footer__list">
            <li><a class="lp-footer__link" href=${brand.telHref} data-testid="footer-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a></li>
            <li><a class="lp-footer__link" href=${mailtoLink(brand.email)} data-testid="footer-email"><${Icon} name="send" size=${20} /><span>${brand.email}</span></a></li>
            <li><a class="lp-footer__link" href=${wa} target="_blank" rel="noopener noreferrer" data-testid="l3-footer-whatsapp"><${Icon} name="message-circle" size=${20} /><span>WhatsApp</span></a></li>
            <li class="lp-footer__line"><${Icon} name="map-pin" size=${20} /><span>${brand.areaText || 'Serving Northern Ireland'}</span></li>
            ${address ? html`<li class="lp-footer__line lp-footer__address" data-testid="l3-footer-address"><${Icon} name="building-2" size=${20} /><address>${address}</address></li>` : null}
          </ul>
        </div>

        <nav class="lp-footer__col" aria-labelledby="footer-explore">
          <h2 class="lp-footer__label" id="footer-explore">On this page</h2>
          <ul class="lp-footer__list lp-footer__list--cols">
            ${EXPLORE.map((l) => html`<li key=${l.href}><a class="lp-footer__link" href=${l.href}><span>${l.label}</span></a></li>`)}
          </ul>
        </nav>

        <div class="lp-footer__col">
          <h2 class="lp-footer__label" id="footer-creds">Accredited and qualified</h2>
          <ul class="lp-footer__creds" aria-labelledby="footer-creds" data-testid="l3-footer-credentials">
            ${credentials.map((c) => html`<li key=${c}><${Icon} name="badge-check" size=${18} /><span>${c}</span></li>`)}
          </ul>
          <h2 class="lp-footer__label lp-footer__label--gap" id="footer-owner">Owner area</h2>
          <ul class="lp-footer__list" aria-labelledby="footer-owner">
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
