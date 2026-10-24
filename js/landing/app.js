// js/landing/app.js: customer landing page entry: names the tab, composes L1 to L13, opens the booking sheet from the hash.
// Owner: WP3
import { html, useEffect, useErrorBoundary } from '../vendor/preact-htm.js';
import { bootApp, useBrand } from '../ui/index.js';
import { makeDefaultSettings } from '../core/config.js';
import { getState } from '../core/store.js';
import { closeBooking, useBookRoute } from '../booking/nav.js';
import { BookingSheet } from '../booking/booking-sheet.js';
import { LandingHeader } from './header.js';
import { Hero } from './hero.js';
import { AreaSection, EmergencyStrip, Faq, FinalCta, HowItWorks, Reviews, Services, TrustBar } from './sections.js';
import { Footer } from './footer.js';
import { StickyBar } from './sticky-bar.js';

// Cross-page links target this name, so "View customer site" in the dashboard re-uses this tab (16.1).
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
    meta.setAttribute('content', `Book ${brand.name} online in 60 seconds. Real availability, clear prices, a certificate with every job. Prototype with sample data.`);
  }, [brand.name, brand.tagline]);

  return html`
    <a class="lp-skip" href="#main">Skip to main content</a>
    <${LandingHeader} />
    <main id="main" class="lp-main" tabindex="-1">
      <${Hero} />
      <${TrustBar} />
      <${EmergencyStrip} />
      <${Services} />
      <${HowItWorks} />
      <${Reviews} />
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
