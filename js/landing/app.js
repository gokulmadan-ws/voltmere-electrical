// js/landing/app.js: customer landing page entry for 180 Electrical: names the tab, composes the sections, opens the enquiry funnel from the hash.
// Owner: C2
import { html, useEffect, useErrorBoundary } from '../vendor/preact-htm.js';
import { bootApp, useBrand } from '../ui/index.js';
import { makeDefaultSettings } from '../core/config.js';
import { getState } from '../core/store.js';
import { closeBooking, useBookRoute } from '../booking/nav.js';
import { BookingSheet } from '../booking/booking-sheet.js';
import { LandingHeader } from './header.js';
import { Hero } from './hero.js';
import { About, AreaSection, Faq, FinalCta, Gallery, HowItWorks, Pricing, TrustBar, WhyCards } from './sections.js';
import { Footer } from './footer.js';
import { StickyBar } from './sticky-bar.js';

// Cross-page links target this name, so "View customer site" in the dashboard re-uses this tab (16.1). Do not rename.
window.name = 'vm-site';

/** What the booking sheet should show, from the parsed hash (11.1). */
function routeToIntent(route) {
  if (!route) return {};
  if (route.kind === 'book') {
    return { serviceId: route.serviceId, date: route.date, windowId: route.windowId, emergency: !!route.emergency };
  }
  return { ref: route.ref };
}

function LandingPage() {
  const brand = useBrand();
  const route = useBookRoute();

  // Keep the tab title and meta description in step with the LIVE brand (13.1), so a rebrand in the other tab shows within 2 seconds.
  useEffect(() => {
    document.title = `${brand.name}: ${brand.tagline}`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'description'); document.head.appendChild(meta); }
    meta.setAttribute('content', `Get a free, no-obligation home EV charger installation quote from ${brand.name}, across Northern Ireland. Prototype with sample data.`);
  }, [brand.name, brand.tagline]);

  return html`
    <a class="lp-skip" href="#main">Skip to main content</a>
    <${LandingHeader} />
    <main id="main" class="lp-main" tabindex="-1">
      <${Hero} />
      <${TrustBar} />
      <${WhyCards} />
      <${About} />
      <${Gallery} />
      <${HowItWorks} />
      <${Pricing} />
      <${AreaSection} />
      <${Faq} />
      <${FinalCta} />
    </main>
    <${Footer} />
    <${StickyBar} />
    ${route ? html`<${BookingSheet} mode="customer" presentation="sheet" intent=${routeToIntent(route)} onClose=${closeBooking} />` : null}
  `;
}

function fallbackPhone() {
  try { return getState().settings.business.phone; } catch (e) { return makeDefaultSettings().business.phone; }
}

/** Error boundary (useErrorBoundary makes THIS component the boundary for LandingPage below it). */
function LandingApp() {
  const [error] = useErrorBoundary((err) => console.error('Landing page failed to render', err));
  if (error) {
    return html`<div class="ui-fatal" role="alert"><p class="ui-fatal__text">Something went wrong on this page. Reload, or call ${fallbackPhone()}.</p></div>`;
  }
  return html`<${LandingPage} />`;
}

bootApp(html`<${LandingApp} />`);
