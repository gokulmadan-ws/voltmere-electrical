// js/landing/booking-host.js: the customer's booking sheet (the 6-step quote funnel, its confirmation and the Manage page), fetched the first time it is needed instead of with the
// landing page: it is about 50 KB of gzipped script and 12 KB of stylesheet that nobody needs to see the first screen. loadBookingSheet() starts the fetch (one shared promise),
// prefetchBookingSheet() starts it when the visitor first touches the page or reaches a quote button, BookingHost renders the sheet once it has arrived.
// Owner: PERF (final gate)
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { loadCss } from '../ui/load-css.js';
import { toast } from '../ui/toast.js';

let loading = null;

/** Start (once) fetching the booking sheet's code and stylesheet. Resolves with the BookingSheet component; a failure is forgotten, so the next ask tries again. */
export function loadBookingSheet() {
  if (!loading) {
    loading = Promise.all([import('../booking/booking-sheet.js'), loadCss('css/booking.css')])
      .then(([mod]) => {
        try { document.documentElement.setAttribute('data-booking', 'ready'); } catch (e) { /* no document */ } // a hook for tests and scripts: the quote form's code is in the page
        return mod.BookingSheet;
      })
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

let armed = false;

/**
 * Have the booking sheet on its way before the visitor asks for it, without costing the first screen anything. It starts on the visitor's first touch, click or key press
 * anywhere on the page (somebody who scrolls or reads is likely to ask for a quote next) and as soon as a pointer or the keyboard reaches a quote button (a hover or a focus
 * comes some time before the tap). The landing page also starts it by itself the moment the hero photo is in (js/landing/app.js), so the form's code is in the page a moment
 * after the first screen, and a phone that loses its signal then can still open the quote form and finish the enquiry (the booking sheet keeps its draft and the enquiry in the
 * browser). Safe to call more than once.
 */
export function prefetchBookingSheet() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const listeners = [];
  const start = () => {
    for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
    loadBookingSheet().catch(() => { /* the sheet asks again when it is needed */ });
  };
  const on = (type, fn) => { listeners.push([type, fn]); window.addEventListener(type, fn, { capture: true, passive: true }); };
  for (const type of ['pointerdown', 'touchstart', 'keydown']) on(type, start);
  // pointerover and focusin fire for everything: only a quote button (or a link to #book) counts
  for (const type of ['pointerover', 'focusin']) on(type, (e) => { if (e.target && e.target.closest && e.target.closest('.lp-cta, a[href^="#book"]')) start(); });
}

/**
 * The booking sheet for the landing page. Until its code has arrived (a tap on a slow connection before the prefetch finished) the page shows the dimmed backdrop a sheet
 * would, so the tap is visibly acknowledged; then the sheet takes over.
 */
export function BookingHost({ intent, onClose }) {
  const [Sheet, setSheet] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadBookingSheet().then((C) => { if (live) setSheet(() => C); }).catch((err) => {
      console.error('The booking form could not be loaded', err);
      if (!live) return;
      setFailed(true);
      toast({ message: 'The quote form could not load. Check your connection and try again.', tone: 'danger' });
      onClose();
    });
    return () => { live = false; };
  }, []);
  if (Sheet) return html`<${Sheet} mode="customer" presentation="sheet" intent=${intent} onClose=${onClose} />`;
  if (failed) return null;
  return html`<div class="ui-scrim lp-booking-wait" aria-hidden="true" data-testid="booking-loading" onClick=${onClose}></div>`;
}
