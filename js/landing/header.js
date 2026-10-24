// js/landing/header.js: the prototype strip and the black header (HIS logo picture cropped to the lockup, the five section links from 1024px, the phone number, and a small red button that
// appears only after the hero's own button has scrolled out and steps aside while an in-page red button is on screen). Static on phones (the sticky bar is the persistent control),
// sticky from 720px, and it never changes size or look on scroll (LANDING-V5 4.10).
// Owner: L3 (landing page for 180 Electrical; first built by C2); rebuilt for LANDING-V5 by B1.
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { PrototypeNotice } from '../ui/notice.js';
import { cx } from '../ui/util.js';
import { useBrand } from '../ui/hooks.js';
import { useIdeasMode } from '../ui/ideas.js';
import { CTA_LABEL, bookClick } from './content.js';
import { useHeroCtaGone, useInPageCtaVisible, useScrollSpy } from './fx.js';
import { useBelowReady } from './ready.js';
import { LogoImg } from './media.js';
import { Glyph } from './glyphs.js';
import { LpButton } from './ui.js';

// In page order. `id` is the section id the link jumps to (and the scroll spy watches). The labels are ours (Appendix C of the spec); "Costs" (an idea) is not in the main nav.
const NAV_LINKS = [
  { id: 'about', label: 'About' },
  { id: 'work', label: 'Our work' },
  { id: 'how', label: 'How it works' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'Questions' }
];
const NAV_IDS = NAV_LINKS.map((l) => l.id);

// The page links in the strip's "Prototype tools" popover. Links to a section that is hidden (an idea, under "Only my content") are left out by the popover itself.
const PAGE_LINKS = [
  { href: '#about', label: 'About' },
  { href: '#work', label: 'Recent work' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Your quote' },
  { href: '#savings', label: 'Running costs' },
  { href: '#area', label: 'Your postcode' },
  { href: '#faq', label: 'Questions' }
];

/**
 * The ids whose section is currently hidden (a section hidden under "Only my content"): their links leave the nav, so no link points at nothing.
 * Re-checked when the switch changes, after the page has re-rendered. A section that is not in the page at all is left alone.
 */
function useHiddenSections(ids, belowReady) {
  const [clean] = useIdeasMode();
  const [hidden, setHidden] = useState('');
  useEffect(() => {
    const off = ids.filter((id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length === 0; });
    setHidden(off.join(','));
  }, [clean, belowReady]);
  return hidden;
}

/**
 * The strip and the header are SIBLINGS (never wrapped in one element: position: sticky needs a parent as tall as the page). htm returns an array for two roots. The brand is HIS logo
 * picture (LogoImg: cropped to the "180 ELECTRICAL" lockup, with the local copy as the fallback). The red button is in the DOM from the start but only shown (css, from 720px) while
 * `.is-cta-on`: the hero button has gone and no in-page red button (the postcode section, the closing band) is on screen, so there is never more than one red button on screen.
 */
export function LandingHeader() {
  const brand = useBrand();
  const belowReady = useBelowReady(); // the sections arrive a moment after the first paint: look for them again then
  const active = useScrollSpy(NAV_IDS, belowReady);
  const hidden = useHiddenSections(NAV_IDS, belowReady);
  const heroGone = useHeroCtaGone();
  const inPage = useInPageCtaVisible(belowReady);
  const pageLinks = PAGE_LINKS;
  return html`
    <${PrototypeNotice} variant="strip" page="landing" links=${pageLinks} />
    <header class=${cx('lp-header', heroGone && !inPage && 'is-cta-on')} data-testid="lp-header">
      <div class="lp-wrap lp-header__bar">
        <a class="lp-brand" href="#top" aria-label=${`${brand.name}, back to the top`}>
          <span data-testid="lp-lockup"><${LogoImg} name=${brand.name} decorative=${true} eager=${true} /></span>
        </a>
        <nav class="lp-nav" aria-label="Page sections">
          ${NAV_LINKS.filter((l) => !hidden.split(',').includes(l.id)).map((l) => html`<a class=${cx('lp-nav__link', active === l.id && 'is-active')} key=${l.id} href=${`#${l.id}`}
            aria-current=${active === l.id ? 'true' : undefined}>${l.label}</a>`)}
        </nav>
        <div class="lp-header__actions">
          <a class="lp-header__phone" href=${brand.telHref} aria-label=${`Call ${brand.phone}`} data-testid="lp-header-phone"><${Glyph} name="phone" size=${18} /><span>${brand.phone}</span></a>
          <${LpButton} size="sm" class="lp-header__book" data-testid="lp-header-book" onClick=${bookClick({})}>${CTA_LABEL}<//>
        </div>
      </div>
    </header>
  `;
}
