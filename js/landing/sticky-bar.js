// js/landing/sticky-bar.js: the fixed bar at the bottom of a phone (below 720px; docs/LANDING-V5.md 4.9): an outlined Call and the one red "Get my installation quote" on a paper surface with a 1px ink top
// rule. It slides up once the hero's own button has scrolled out above the viewport, and goes away while any in-page red button (the postcode section, the closing band) is on screen, while a
// sheet is open (html.is-scroll-locked) and while the keyboard is open (html.is-keyboard-open): the last two are css. Hidden means visibility: hidden, so it leaves the tab order.
// The two observers (useHeroCtaGone, useInPageCtaVisible) live in js/landing/fx.js and are shared with the header's button.
// Owner: L3 (landing page for 180 Electrical; first built by C2); rebuilt for LANDING-V5 by B1.
import { html } from '../vendor/preact-htm.js';
import { cx } from '../ui/util.js';
import { useBrand } from '../ui/hooks.js';
import { CTA_LABEL, bookClick } from './content.js';
import { useHeroCtaGone, useInPageCtaVisible } from './fx.js';
import { LpButton } from './ui.js';

export function StickyBar() {
  const brand = useBrand();
  const heroGone = useHeroCtaGone();
  const blocked = useInPageCtaVisible();
  const show = heroGone && !blocked;
  return html`
    <nav class=${cx('lp-sticky', show && 'is-on')} aria-label="Quick actions" data-testid="sticky-bar">
      <${LpButton} variant="outline" href=${brand.telHref} icon="phone" class="lp-sticky__call" aria-label=${`Call ${brand.phone}`} data-testid="sticky-call">Call<//>
      <${LpButton} class="lp-sticky__book" data-testid="sticky-book" onClick=${bookClick({})}>${CTA_LABEL}<//>
    </nav>
  `;
}
