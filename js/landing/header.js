// js/landing/header.js: prototype strip and the sticky dark header (his logo, Call on phones, from 768 the number and the quote CTA; condenses on scroll).
// Owner: L3 (landing page for 180 Electrical; first built by C2)
import { html } from '../vendor/preact-htm.js';
import { Button, Icon, PrototypeNotice, cx, useBrand } from '../ui/index.js';
import { CTA_LABEL, bookClick } from './content.js';
import { useCondensed, useScrollSpy } from './fx.js';
import { LogoImg } from './media.js';

// In page order. `id` is the section id the link jumps to (and the scroll spy watches).
const NAV_LINKS = [
  { id: 'savings', label: 'Savings' },
  { id: 'about', label: 'About' },
  { id: 'work', label: 'Our work' },
  { id: 'how', label: 'How it works' },
  { id: 'area', label: 'Area' },
  { id: 'faq', label: 'FAQ' }
];
const NAV_IDS = NAV_LINKS.map((l) => l.id);

/**
 * The strip and the header are SIBLINGS (never wrapped in one element: position: sticky needs a parent as tall as the
 * page). htm returns an array for two roots. The header keeps ONE height for ever: "condensed" only changes how the bar
 * inside it looks (glass, hairline, a smaller logo), so scrolling never moves the page under the reader.
 */
export function LandingHeader() {
  const brand = useBrand();
  const condensed = useCondensed(36);
  const active = useScrollSpy(NAV_IDS);
  return html`
    <aside class="lp-protostrip" aria-label="Prototype notice"><${PrototypeNotice} variant="strip" page="landing" /></aside>
    <header class=${cx('lp-header', condensed && 'is-condensed')} data-testid="lp-header">
      <div class="lp-header__bar">
        <div class="lp-header__inner lp-container">
          <a class="lp-brand" href="#top" aria-label=${`${brand.name}, back to the top`}>
            <${LogoImg} name=${brand.name} eager=${true} />
          </a>
          <nav class="lp-nav" aria-label="Page sections">
            ${NAV_LINKS.map((l) => html`<a class=${cx('lp-nav__link', active === l.id && 'is-active')} key=${l.id} href=${`#${l.id}`}
              aria-current=${active === l.id ? 'true' : undefined}>${l.label}</a>`)}
          </nav>
          <div class="lp-header__actions">
            <a class="lp-header__phone" href=${brand.telHref} data-testid="lp-header-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a>
            <${Button} variant="secondary" size="sm" icon="phone" href=${brand.telHref} class="lp-header__call" data-testid="lp-call-button">Call <span class="u-nowrap">${brand.phone}</span><//>
            <${Button} variant="primary" size="sm" class="lp-header__book lp-cta" data-testid="lp-header-book" onClick=${bookClick({})}>${CTA_LABEL}<//>
          </div>
        </div>
        <span class="lp-progress" aria-hidden="true"></span>
      </div>
    </header>
  `;
}
