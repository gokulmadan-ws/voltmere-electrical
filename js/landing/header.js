// js/landing/header.js: prototype strip and sticky header (his logo, a Call button, and from 768 the phone number and the quote CTA).
// Owner: C2 (landing page for 180 Electrical)
import { html } from '../vendor/preact-htm.js';
import { Button, Icon, PrototypeNotice, useBrand } from '../ui/index.js';
import { CTA_LABEL, bookClick } from './content.js';
import { LogoImg } from './media.js';

const NAV_LINKS = [
  { href: '#about', label: 'About' },
  { href: '#work', label: 'Our work' },
  { href: '#how', label: 'How it works' },
  { href: '#area', label: 'Area' },
  { href: '#faq', label: 'FAQ' }
];

/**
 * The strip and the header are SIBLINGS (never wrapped in one element: position: sticky needs a parent as tall as the
 * page). htm returns an array for two roots.
 */
export function LandingHeader() {
  const brand = useBrand();
  return html`
    <${PrototypeNotice} variant="strip" page="landing" />
    <header class="lp-header" data-testid="lp-header">
      <div class="lp-header__inner lp-container">
        <a class="lp-brand" href="#top" aria-label=${`${brand.name}, back to the top`}>
          <${LogoImg} name=${brand.name} />
        </a>
        <nav class="lp-nav" aria-label="Page sections">
          ${NAV_LINKS.map((l) => html`<a class="lp-nav__link" key=${l.href} href=${l.href}>${l.label}</a>`)}
        </nav>
        <div class="lp-header__actions">
          <a class="lp-header__phone" href=${brand.telHref} data-testid="lp-header-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a>
          <${Button} variant="secondary" size="sm" icon="phone" href=${brand.telHref} class="lp-header__call" data-testid="lp-call-button">Call <span class="u-nowrap">${brand.phone}</span><//>
          <${Button} variant="primary" size="sm" class="lp-header__book lp-cta" data-testid="lp-header-book" onClick=${bookClick({})}>${CTA_LABEL}<//>
        </div>
      </div>
    </header>
  `;
}
