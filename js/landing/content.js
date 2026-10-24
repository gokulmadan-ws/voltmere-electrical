// js/landing/content.js: the hero copy (his verbatim words), photo settings (crops, alt text, gallery captions) and the enquiry-start helpers that open the funnel.
// Owner: L3 (landing page for 180 Electrical; first built by C2). LANDING-V5: the section copy (WHY, ABOUT, STEPS, PRICING, AREA, FAQ, FINAL, CALC) moved to js/landing/copy.js (B2); this file is B1's.
import { bookHref, openBooking } from '../booking/nav.js';

// The only service the website offers: the free survey and written quote (an enquiry, never a booking, never a price).
export const ENQUIRY_SERVICE_ID = 'ev_quote';

// Every CTA on his site has exactly this text.
export const CTA_LABEL = 'Get my installation quote';

/**
 * His photos. The URLs live in ONE place (business.images in js/core/config.js, edited in dashboard Settings); here is only
 * how each is shown: its shape (w and h are the original's, so the box is reserved before the file arrives), where to aim
 * the crop (object-position, from the photo's own focal point), an optional zoom (to crop away phone-screenshot bars)
 * and what it shows. Alt text says what is in the picture and nothing more: no addresses, no product claims.
 * IMAGES.work is in DISPLAY ORDER (the data-testid indices of the gallery equal it): 01 portrait red brick, 02 the phone screenshot (zoomed), 03 landscape orange brick, 04 portrait
 * brick pillar. `caption` is the wall type only, never a charger make or a claim (the photos show Zappi, Ohme and Fox ESS; his brand list says ZAPPI, OHME, SYNC).
 */
export const IMAGES = {
  logo: { key: 'logo', w: 1119, h: 743, alt: '180 Electrical' },
  hero: {
    key: 'hero', w: 1080, h: 720, position: '50% 42%',
    alt: 'A man plugging a charging cable into a wall-mounted home EV charger, with a white electric car parked on the driveway behind him'
  },
  about: {
    key: 'about', w: 3600, h: 2697, position: '50% 59%',
    alt: 'A smiling 180 Electrical installer in a black 180 hoodie, arms crossed, beside a white van on a residential street'
  },
  work: [
    {
      key: 'work1', w: 1170, h: 1532, position: '50% 50%', caption: 'Red brick wall',
      alt: 'A black and grey home EV charger on a red brick wall, with its charging cable tethered neatly beside it'
    },
    {
      // A phone screenshot: black bars top and bottom. A strong, centred zoom (1.4 or more) puts the bars outside the visible tile.
      key: 'work2', w: 739, h: 1600, position: '50% 50%', zoom: 1.45, caption: 'Pebbledash wall',
      alt: 'A home EV charger on a grey pebbledash wall with the cable clipped neatly along the wall'
    },
    {
      key: 'work4', w: 3600, h: 2684, position: '50% 39%', caption: 'Orange brick wall',
      alt: 'A black EV charger with blue buttons and a cable holster on an orange brick wall beside a black downpipe'
    },
    {
      key: 'work3', w: 1200, h: 1600, position: '50% 50%', caption: 'Brick pillar',
      alt: 'A black EV charger fitted to a red brick pillar, with the cable resting on a holster beside a wooden fence'
    }
  ]
};

// The hero (docs/LANDING-V5.md 5.2 and 5.3), his words verbatim: the eyebrow, H1 and sub, the quote button, the two lines under it, and the three ticks of the spec strip.
// His two credentials appear once, in full wording, in the spec strip (they come live from Settings; DEFAULT_CREDENTIALS is the fallback). The earliest visit is no longer here:
// it is a margin annotation in step 02 (js/landing/visit.js).
export const HERO = {
  eyebrow: 'Local EV charger installation',
  // The H1 is two spans: the first sentence on its own line, the second balanced (Northern Ireland. never breaks: .lp-nowrap in css, so the text stays byte-identical).
  title: 'Your own EV charger. Installed at home in Northern Ireland.',
  titleFirst: 'Your own EV charger.',
  titleSecond: 'Installed at home in Northern Ireland.',
  titleNoWrap: 'Northern Ireland.',
  sub: 'Make charging fit around your day. 180 Electrical helps homeowners across Northern Ireland choose and install the right charger for their home and vehicle.',
  // the two lines under the button
  note: 'Tell us a little about your home and what you need.',
  proofFree: 'Free, no-obligation quote.',
  // his three ticks (they used to be in the About band: his site has them under the hero button)
  ticks: ['Advice on charger options', 'Installation tailored to your property', 'Speak directly with 180 Electrical'],
  credLabel: 'Accredited and qualified'
};

// Used only when the store has no business.credentials / business.brands (they come live from Settings).
export const DEFAULT_CREDENTIALS = ['Level 3 Electrical Installation', '2391 Inspection and Testing'];
export const DEFAULT_BRANDS = ['ZAPPI', 'OHME', 'SYNC'];

// The section copy (WHY, ABOUT, STEPS, PRICING, AREA, FAQ, FINAL, CALC) lives in js/landing/copy.js (B2): one voice, HIS own words, word for word from docs/reference/180-site-report.md.

/** Fill the "{owner}" token in a piece of copy. */
export const fillOwner = (text, owner) => String(text).split('{owner}').join(owner || 'Daniel');

// ---- funnel helpers ---------------------------------------------------------------------------------------------

/**
 * Open the 6-step enquiry funnel (one history push). With a postcode, openBooking (js/booking/nav.js) leaves it in the
 * funnel's draft so Step 1 opens with it filled in. The funnel never takes a window from the hash: the engine pencils one in.
 */
export function startEnquiry({ postcode } = {}) {
  const opts = { serviceId: ENQUIRY_SERVICE_ID };
  if (postcode) opts.postcode = postcode;
  openBooking(opts);
}

/**
 * Click handler that opens the funnel through the route emitter (11.1) instead of letting a plain hash link push a
 * second history entry. Modified clicks (new tab) keep their default behaviour.
 */
export function bookClick(opts = {}) {
  return (e) => {
    if (e) {
      if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.preventDefault) e.preventDefault();
    }
    startEnquiry(opts);
  };
}

/** Props for an <a> that opens the funnel: a real href (so "open in new tab" works) plus the click handler. */
export function bookLinkProps(opts = {}) {
  return { href: bookHref({ serviceId: ENQUIRY_SERVICE_ID }), onClick: bookClick(opts) };
}
