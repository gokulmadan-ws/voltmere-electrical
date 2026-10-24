// js/landing/content.js: landing copy (his verbatim words), photo settings (crops, alt text) and the enquiry-start helpers that open the funnel.
// Owner: L3 (landing page for 180 Electrical; first built by C2)
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
      key: 'work1', w: 1170, h: 1532, position: '50% 50%',
      alt: 'A black and grey home EV charger on a red brick wall, with its charging cable tethered neatly beside it'
    },
    {
      // A phone screenshot: black bars top and bottom. A zoom crops them away inside the tile.
      key: 'work2', w: 739, h: 1600, position: '50% 50%', zoom: 1.16,
      alt: 'A home EV charger on a grey pebbledash wall with the cable clipped neatly along the wall'
    },
    {
      key: 'work3', w: 1200, h: 1600, position: '50% 50%',
      alt: 'A black EV charger fitted to a red brick pillar, with the cable resting on a holster beside a wooden fence'
    },
    {
      key: 'work4', w: 3600, h: 2684, position: '50% 39%',
      alt: 'A black EV charger with blue buttons and a cable holster on an orange brick wall beside a black downpipe'
    }
  ]
};

// What the WhatsApp buttons pre-fill. The link itself is built by waLink in js/core/messages.js (the one place wa.me URLs are made).
export const WHATSAPP_TEXT = "Hi, I'd like a quote for a home EV charger.";

export const HERO = {
  eyebrow: 'Local EV charger installation',
  title: 'Your own EV charger. Installed at home in Northern Ireland.',
  // The words inside the title that get the brand-red treatment (the text itself is never changed).
  accent: 'Northern Ireland.',
  sub: 'Make charging fit around your day. 180 Electrical helps homeowners across Northern Ireland choose and install the right charger for their home and vehicle.',
  line1: 'Tell us a little about your home and what you need.',
  line2: 'Free, no-obligation quote.',
  ticks: ['Advice on charger options', 'Installation tailored to your property', 'Speak directly with 180 Electrical']
};

// Used only when the store has no business.credentials / business.brands (they come live from Settings).
export const DEFAULT_CREDENTIALS = ['Level 3 Electrical Installation', '2391 Inspection and Testing'];
export const DEFAULT_BRANDS = ['ZAPPI', 'OHME', 'SYNC'];

export const TRUST_TITLE = 'Accredited and qualified';

export const WHY = {
  title: 'Home charging that works around you.',
  cards: [
    { icon: 'house', title: "Charge while you're at home", body: 'Plug in when you arrive and charge around your routine.' },
    { icon: 'list-checks', title: 'Choose with confidence', body: 'Get help choosing a charger suited to your vehicle, property and preferences.' },
    { icon: 'gauge', title: 'Make the most of smart charging', body: 'Compatible chargers and suitable electricity tariffs can let you schedule charging for off-peak periods.' }
  ]
};

// The savings calculator. Everything it shows is arithmetic on figures the visitor can see and change: no promises, no
// claims about grants or tariffs, no 180 Electrical prices.
export const CALC = {
  eyebrow: 'Running costs',
  title: 'What could you save charging at home?',
  lead: 'Slide to roughly how far you drive in a year. The estimate uses the example figures below, so change any of them to match your own car and electricity rates.',
  milesLabel: 'Miles you drive in a year',
  milesUnit: 'miles a year',
  assumptionsTitle: 'The figures we have used',
  assumptionsNote: 'Examples only. These are not 180 Electrical prices. Change them to match yours.',
  reset: 'Reset',
  resetLabel: 'Reset to the example figures',
  badge: 'Illustrative estimate',
  resultTitle: 'Charging at home could save you about',
  perYear: 'a year',
  workingsTitle: 'How it is worked out',
  footnote: 'An illustration, not a quote or a promise. Your own costs will differ with your car, your driving and the rates you pay.',
  cta: CTA_LABEL,
  ctaNote: 'Free, no-obligation quote.',
  fields: [
    { key: 'homePence', label: 'Charging at home', unit: 'p/kWh' },
    { key: 'publicPence', label: 'Public charging', unit: 'p/kWh' },
    { key: 'petrolPence', label: 'Petrol', unit: 'p/litre' },
    { key: 'mpg', label: 'Petrol car economy', unit: 'mpg' },
    { key: 'milesPerKwh', label: 'Electric car efficiency', unit: 'miles/kWh' }
  ]
};

export const ABOUT = {
  title: 'Meet your local EV charger installers.',
  p1: '180 Electrical installs home EV chargers for homeowners across Northern Ireland. We take time to understand your property and how you drive, then fit a charger that suits both.',
  p2: 'Every visit is planned around a safe cable route and a tidy finish, so your charger looks like it belongs on your home.',
  brandsLabel: 'Charger brands we install',
  galleryEyebrow: 'Our recent work',
  galleryTitle: 'Installations across Northern Ireland'
};

export const STEPS = {
  title: 'From first enquiry to charging at home.',
  items: [
    { n: '01', icon: 'house', title: 'Tell us about your home', body: 'Answer a few short questions about your location, parking and plans.' },
    { n: '02', icon: 'message-circle', title: 'Discuss your installation', body: 'The team will review your enquiry and explain the next steps. Photos or a survey may be needed to prepare an accurate quote.' },
    { n: '03', icon: 'calendar-check', title: 'Arrange your installation', body: 'Once you are happy with the agreed quote and scope, arrange a suitable installation date.' }
  ]
};

export const PRICING = {
  title: 'Your installation, clearly quoted.',
  body: 'Costs depend on your charger choice, cable route and any electrical work required. Tell us about your home so the team can advise on the next steps towards an accurate quote.'
};

export const AREA = {
  title: 'EV charger installation in Northern Ireland.',
  body: 'We install home chargers across Northern Ireland. If you are not sure, enter your postcode and we will check.',
  note: 'Enter your postcode so we can check your location.',
  // The funnel's own message for a postcode it cannot read (step 1), reused so the two never disagree.
  invalid: 'Please enter a valid UK postcode so we can check your location.',
  covered: 'Good news, that postcode is in Northern Ireland.',
  outside: 'That postcode looks to be outside Northern Ireland. You can still send an enquiry and the team will check.'
};

export const FAQ = {
  title: 'Frequently asked questions',
  items: [
    {
      q: 'Which charger is right for my car?',
      a: 'Most home chargers suit most electric and plug-in hybrid cars, but the best choice depends on your vehicle, how you drive and your preferences. We will help you weigh up the options once we know a little about your setup.'
    },
    {
      q: 'Do I need a driveway or private parking?',
      a: 'A charger needs a suitable parking position and a safe route for the cable that does not create a hazard. We assess this for your property rather than assuming it. Running a cable across a public pavement is not a standard solution, so let us know your setup and we will advise.'
    },
    {
      q: 'How much will installation cost?',
      a: 'It depends on the charger you choose, the cable route and any electrical work your property needs. We give you a clear quote once we understand your requirements, rather than a headline figure that changes later.'
    },
    {
      q: 'How long does installation take?',
      a: 'Timing varies with the property and the scope of work involved. Once the team has reviewed your enquiry, they can talk you through what to expect for your specific installation.'
    },
    {
      q: 'Can I have a charger installed before my car arrives?',
      a: 'Many homeowners plan the installation while waiting for their car. Tell us where you are in the process and we will suggest sensible timing so your charger is ready when you need it.'
    },
    {
      q: 'What happens after I enquire?',
      a: 'The team reviews your details and contacts you to discuss your installation and the next steps. Submitting the form is an enquiry, not a booking, and it does not produce an instant final price.'
    }
  ]
};

export const FINAL = {
  title: 'Ready to make charging at home simpler?',
  body: 'Tell us about your home and plans. 180 Electrical will review your enquiry and help you understand your installation options.'
};

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
