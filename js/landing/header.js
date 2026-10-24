// js/landing/header.js: prototype strip and the slim sticky dark header (HIS logo picture, cropped to the lockup; Call on phones, from 768 the number and the quote CTA; transparent over the hero photo, solid once scrolled).
// Owner: L3 (landing page for 180 Electrical; first built by C2)
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { Button, Icon, PrototypeNotice, cx, useBrand } from '../ui/index.js';
import { useIdeasMode } from '../ui/ideas.js';
import { CTA_LABEL, bookClick, fillOwner } from './content.js';
import { useCondensed, useScrollSpy } from './fx.js';
import { LogoImg } from './media.js';

// In page order. `id` is the section id the link jumps to (and the scroll spy watches).
const NAV_LINKS = [
  { id: 'about', label: 'Meet {owner}' },
  { id: 'work', label: 'Our work' },
  { id: 'how', label: 'How it works' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'savings', label: 'Costs' },
  { id: 'faq', label: 'FAQ' }
];
const NAV_IDS = NAV_LINKS.map((l) => l.id);

// The page links in the strip's "Prototype tools" popover (they used to be a link cloud in the footer). Links to a section that is hidden
// (an idea, under "Only my content") are left out by the popover itself.
const PAGE_LINKS = [
  { href: '#about', label: 'Meet {owner}' },
  { href: '#work', label: 'Recent work' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Your quote' },
  { href: '#savings', label: 'Running costs' },
  { href: '#area', label: 'Your postcode' },
  { href: '#faq', label: 'Questions' }
];

/**
 * The ids whose section is currently hidden (an idea section under "Only my content"): their links leave the nav, so no link points at nothing.
 * Re-checked when the switch changes, after the page has re-rendered. A section that is not in the page at all is left alone.
 */
function useHiddenSections(ids) {
  const [clean] = useIdeasMode();
  const [hidden, setHidden] = useState('');
  useEffect(() => {
    const off = ids.filter((id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length === 0; });
    setHidden(off.join(','));
  }, [clean]);
  return hidden;
}

/**
 * The strip and the header are SIBLINGS (never wrapped in one element: position: sticky needs a parent as tall as the
 * page). htm returns an array for two roots. The header keeps ONE height for ever: "condensed" only changes how the bar
 * inside it looks (solid black with a hairline once scrolled), so scrolling never moves the page under the reader. The brand is HIS
 * logo picture (LogoImg: cropped to the "180 ELECTRICAL" lockup, with the local copy as the fallback), the same one the footer shows; the
 * business bolt-in-a-square mark is only for the favicon and the dashboard.
 */
export function LandingHeader() {
  const brand = useBrand();
  const condensed = useCondensed(36);
  const active = useScrollSpy(NAV_IDS);
  const hidden = useHiddenSections(NAV_IDS);
  const pageLinks = PAGE_LINKS.map((l) => ({ href: l.href, label: fillOwner(l.label, brand.ownerFirst) }));
  return html`
    <${PrototypeNotice} variant="strip" page="landing" links=${pageLinks} />
    <header class=${cx('lp-header', condensed && 'is-condensed')} data-testid="lp-header">
      <div class="lp-header__bar">
        <div class="lp-header__inner lp-container">
          <a class="lp-brand" href="#top" aria-label=${`${brand.name}, back to the top`}>
            <span class="lp-brand__logo" data-testid="lp-lockup"><${LogoImg} name=${brand.name} decorative=${true} eager=${true} /></span>
          </a>
          <nav class="lp-nav" aria-label="Page sections">
            ${NAV_LINKS.filter((l) => !hidden.split(',').includes(l.id)).map((l) => html`<a class=${cx('lp-nav__link', active === l.id && 'is-active')} key=${l.id} href=${`#${l.id}`}
              aria-current=${active === l.id ? 'true' : undefined}>${fillOwner(l.label, brand.ownerFirst)}</a>`)}
          </nav>
          <div class="lp-header__actions">
            <a class="lp-header__phone" href=${brand.telHref} data-testid="lp-header-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a>
            <${Button} variant="secondary" size="sm" icon="phone" href=${brand.telHref} class="lp-header__call" data-testid="lp-call-button" aria-label=${`Call ${brand.phone}`}>Call<span class="lp-header__callnum">${' '}<span class="u-nowrap">${brand.phone}</span></span><//>
            <${Button} variant="primary" size="sm" class="lp-header__book lp-cta" data-testid="lp-header-book" onClick=${bookClick({})}>${CTA_LABEL}<//>
          </div>
        </div>
        <span class="lp-progress" aria-hidden="true"></span>
      </div>
    </header>
  `;
}
