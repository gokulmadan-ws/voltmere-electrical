// js/landing/app.js: customer landing page entry for 180 Electrical: names the tab, captures campaign tags, composes the page (header, hero, then the sections, the closing band and the footer from
// js/landing/below.js), opens the enquiry funnel from the hash. LANDING-V5: no scroll reveal (7).
// Owner: L3 (landing page for 180 Electrical; first built by C2); boot updated for LANDING-V5 by B1.
import { html, useEffect, useErrorBoundary, useState } from '../vendor/preact-htm.js';
import { ResetDataButton } from '../ui/reset.js';
import { bootApp } from '../ui/boot.js';
import { useBrand } from '../ui/hooks.js';
import { initIdeasMode } from '../ui/ideas.js';
import { makeDefaultSettings } from '../core/config.js';
import { getState } from '../core/store.js';
import { captureUtm } from '../core/utm.js';
import { closeBooking, useBookRoute } from '../booking/nav.js';
import { BookingHost, loadBookingSheet, prefetchBookingSheet } from './booking-host.js';
import { LandingHeader } from './header.js';
import { Hero } from './hero.js';
import { markBelowReady } from './ready.js';

// Cross-page links target this name, so "View customer site" in the dashboard re-uses this tab (16.1). Do not rename.
window.name = 'vm-site';

// "Show: With ideas | Only my content" (localStorage ec_clean): applied to <html data-clean> as early as this module can, BEFORE bootApp renders the first
// frame, so an idea block never flashes for someone who chose "Only my content". Guarded: a storage problem must never stop the page.
try { initIdeasMode(); } catch (err) { console.error('The ideas switch could not start', err); }

// Campaign tags (?utm_source=, ?utm_medium=, ?utm_campaign=, or ?src=) are kept for the funnel's submit (js/core/utm.js).
// A problem there must never stop the page from showing, so it is guarded.
try { captureUtm(location.search); } catch (err) { console.error('Campaign tags were not captured', err); }

/** What the booking sheet should show, from the parsed hash (11.1). */
function routeToIntent(route) {
  if (!route) return {};
  if (route.kind === 'book') {
    return { serviceId: route.serviceId, date: route.date, windowId: route.windowId, emergency: !!route.emergency };
  }
  return { ref: route.ref };
}

/**
 * Resolves when the first screen's photo has arrived (or failed), or after `cap` ms, whichever comes first. On a fast connection (and in a cached or local run) the picture is
 * in before anything asks, so this is immediate; on a slow one it keeps the sections' scripts and styles from sharing the line with the hero photo, which is what the visitor
 * is waiting to see (and the largest thing painted: the LCP).
 */
function heroPhotoSettled(cap = 4000) {
  return new Promise((resolve) => {
    const img = document.querySelector('[data-testid="hero-photo"] img');
    if (!img || img.complete) { resolve(); return; }
    let timer = 0;
    const done = () => { clearTimeout(timer); img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
    timer = setTimeout(done, cap);
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  });
}

/**
 * The sections below the hero (js/landing/below.js): null until the first screen has painted and its photo is in, then the module's { Sections, Tail }. An effect already runs
 * after the first paint (Preact schedules it behind the next animation frame, with a 100 ms fallback for a hidden tab), so the wait starts there.
 * The header and the hero are all the first paint needs, and the rest is most of the page's markup, styling and script. If the module cannot be fetched the page stays
 * a hero with its header (the error is logged), as it would on a failed script.
 */
function useBelowTheFold() {
  const [below, setBelow] = useState(null);
  useEffect(() => {
    let live = true;
    heroPhotoSettled().then(() => {
      // the first screen is in: now the quote form's code (so a phone that loses its signal can still make an enquiry) and the sections, side by side
      loadBookingSheet().catch(() => { /* asked for again when the visitor taps */ });
      return import('./below.js');
    }).then((m) => { if (live) setBelow(m); }).catch((err) => console.error('The rest of the page could not load', err));
    return () => { live = false; };
  }, []);
  return below;
}

function LandingPage() {
  const brand = useBrand();
  const route = useBookRoute();
  const below = useBelowTheFold();

  // Keep the tab title and meta description in step with the LIVE brand (13.1), so a rebrand in the other tab shows within 2 seconds.
  useEffect(() => {
    document.title = `${brand.name}: ${String(brand.tagline).replace(/[.\s]+$/, '')}`; // no full stop in a tab title
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'description'); document.head.appendChild(meta); }
    meta.setAttribute('content', `Get a free, no-obligation home EV charger installation quote from ${brand.name}, across Northern Ireland. Prototype with sample data.`);
  }, [brand.name, brand.tagline]);

  useEffect(() => {
    if (!below) return;
    markBelowReady();
    // a link such as index.html#faq could not scroll anywhere while the section was not yet in the page: do it now, unless the visitor has already moved
    // a hostile fragment such as #book/%E0%A4%A must never break the page: keep the raw text when it will not decode
    let id = (location.hash || '').slice(1);
    try { id = decodeURIComponent(id); } catch (e) { /* keep the raw fragment */ }
    const target = id && !window.scrollY ? document.getElementById(id) : null;
    if (target) target.scrollIntoView();
  }, [below]);

  // The booking sheet is a separate chunk (js/landing/booking-host.js): start fetching it once the visitor touches the page or the page has settled.
  useEffect(() => { prefetchBookingSheet(); }, []);

  return html`
    <a class="lp-skip" href="#main">Skip to main content</a>
    <${LandingHeader} />
    <main id="main" class="lp-main" tabindex="-1">
      <${Hero} />
      ${below ? html`<${below.Sections} />` : null}
    </main>
    ${below ? html`<${below.Tail} />` : null}
    ${route ? html`<${BookingHost} intent=${routeToIntent(route)} onClose=${closeBooking} />` : null}
  `;
}

function fallbackPhone() {
  try { return getState().settings.business.phone; } catch (e) { return makeDefaultSettings().business.phone; }
}

/** Error boundary (useErrorBoundary makes THIS component the boundary for LandingPage below it). */
function LandingApp() {
  const [error] = useErrorBoundary((err) => console.error('Landing page failed to render', err));
  if (error) {
    return html`<div class="ui-fatal" role="alert"><p class="ui-fatal__text">Something went wrong on this page. Reload, or call ${fallbackPhone()}.</p><${ResetDataButton} /></div>`;
  }
  return html`<${LandingPage} />`;
}

bootApp(html`<${LandingApp} />`);
