// js/landing/header.js: L1 prototype strip and L2 sticky header (brand, call button, phone and Book button from 768).
// Owner: WP3
import { html } from '../vendor/preact-htm.js';
import { BrandMark, Button, Icon, IconButton, PrototypeNotice, useBrand } from '../ui/index.js';
import { bookClick } from './content.js';

const NAV_LINKS = [
  { href: '#services', label: 'Services' },
  { href: '#how', label: 'How it works' },
  { href: '#reviews', label: 'Reviews' },
  { href: '#area', label: 'Area' },
  { href: '#faq', label: 'FAQ' }
];

/**
 * The strip and the header are SIBLINGS (never wrapped in one element: position: sticky needs a parent as tall as the
 * page, 5.2). htm returns an array for two roots.
 */
export function LandingHeader() {
  const brand = useBrand();
  return html`
    <${PrototypeNotice} variant="strip" page="landing" />
    <header class="lp-header" data-testid="lp-header">
      <div class="lp-header__inner lp-container">
        <a class="lp-brand" href="#top" aria-label=${`${brand.name}, back to the top`}>
          <${BrandMark} size=${32} class="lp-brand__mark" />
          <span class="lp-brand__text">
            <span class="lp-brand__name">${brand.shortName}</span>
            <span class="lp-brand__desc">${brand.descriptor}</span>
          </span>
        </a>
        <nav class="lp-nav" aria-label="Page sections">
          ${NAV_LINKS.map((l) => html`<a class="lp-nav__link" key=${l.href} href=${l.href}>${l.label}</a>`)}
        </nav>
        <div class="lp-header__actions">
          <a class="lp-header__phone" href=${brand.telHref} data-testid="lp-header-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a>
          <${IconButton} icon="phone" label=${`Call ${brand.ownerFirst}`} href=${brand.telHref} class="lp-header__call" data-testid="lp-call-button" />
          <${Button} variant="primary" size="sm" class="lp-header__book" data-testid="lp-header-book" onClick=${bookClick({})}>Book a visit<//>
        </div>
      </div>
    </header>
  `;
}
