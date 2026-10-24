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
 * and what it shows. Alt text says what is in the picture and nothing more: no addresses, no product claims. Gallery captions (chip, title) are
 * neutral on purpose: "Recent install", never a make, a model or a claim about a charger.
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
      key: 'work1', w: 1170, h: 1532, position: '50% 50%', chip: 'Recent install', title: 'Recent install',
      alt: 'A black and grey home EV charger on a red brick wall, with its charging cable tethered neatly beside it'
    },
    {
      // A phone screenshot: black bars top and bottom. A strong, centred zoom (1.4 or more) puts the bars outside the visible tile.
      key: 'work2', w: 739, h: 1600, position: '50% 50%', zoom: 1.45, chip: 'Recent install', title: 'Recent install',
      alt: 'A home EV charger on a grey pebbledash wall with the cable clipped neatly along the wall'
    },
    {
      key: 'work3', w: 1200, h: 1600, position: '50% 50%', chip: 'Recent install', title: 'Recent install',
      alt: 'A black EV charger fitted to a red brick pillar, with the cable resting on a holster beside a wooden fence'
    },
    {
      key: 'work4', w: 3600, h: 2684, position: '50% 39%', chip: 'Recent install', title: 'Recent install',
      alt: 'A black EV charger with blue buttons and a cable holster on an orange brick wall beside a black downpipe'
    }
  ]
};

// What the WhatsApp buttons pre-fill. The link itself is built by waLink in js/core/messages.js (the one place wa.me URLs are made).
export const WHATSAPP_TEXT = "Hi, I'd like a quote for a home EV charger.";

// The hero: his eyebrow, H1 and sub word for word, the quote button, and ONE proof row (free quote, the earliest free survey from his diary).
// His two credentials appear once, in full wording, as chips on the hero photo (they come live from Settings; DEFAULT_CREDENTIALS is the fallback).
export const HERO = {
  eyebrow: 'Local EV charger installation',
  title: 'Your own EV charger. Installed at home in Northern Ireland.',
  // The words inside the title that get the brand-red treatment (the text itself is never changed).
  accent: 'Northern Ireland.',
  sub: 'Make charging fit around your day. 180 Electrical helps homeowners across Northern Ireland choose and install the right charger for their home and vehicle.',
  proofFree: 'Free, no-obligation quote',
  // The survey slot is an OFFER from his diary, never a booking.
  proofSlot: 'Earliest free survey'
};

// Used only when the store has no business.credentials / business.brands (they come live from Settings).
export const DEFAULT_CREDENTIALS = ['Level 3 Electrical Installation', '2391 Inspection and Testing'];
export const DEFAULT_BRANDS = ['ZAPPI', 'OHME', 'SYNC'];

// One voice below the hero: Daniel in the third person (or the business name). No invented first-person quotes, no "the team".
// Red accent words appear only in the H1 and the final call to action; every other heading is plain white.
export const WHY = {
  eyebrow: 'Why home charging',
  title: 'Home charging that works around you.',
  cards: [
    { icon: 'house', title: "Charge while you're at home", body: 'Plug in when you arrive and charge around your routine.' },
    { icon: 'list-checks', title: 'Choose with confidence', body: 'Get help choosing a charger suited to your vehicle, property and preferences.' },
    { icon: 'gauge', title: 'Make the most of smart charging', body: 'Compatible chargers and suitable electricity tariffs can let you schedule charging for off-peak periods.' }
  ]
};

// The running-costs calculator: a prototype IDEA (data-proto, tagged "Idea from us, not on your site today"; hidden by "Only my content"). Everything it
// shows is arithmetic on figures the visitor can see and change, all in view (no hidden accordions): no promises, no claims about grants or tariffs,
// no 180 Electrical prices. Its first line is the home-charging cost; the petrol and public-charging comparison comes second.
export const CALC = {
  eyebrow: 'Running costs',
  title: 'What would home charging cost you?',
  lead: 'A rough guide, using example rates that you can change.',
  milesLabel: 'Miles you drive in a year',
  milesUnit: 'miles a year',
  assumptionsTitle: 'Rates we have assumed',
  assumptionsNote: 'Examples only, not 180 Electrical prices. A kWh is the unit of electricity on your bill. Change any figure to match yours.',
  reset: 'Reset',
  resetLabel: 'Reset to the example figures',
  badge: 'Illustrative estimate',
  headLead: 'Home charging would cost about',
  headTail: 'a year',
  compareTitle: 'The same miles, three ways',
  workingsTitle: 'How we worked this out',
  footnote: 'An illustration, not a quote or a promise. Your own costs will differ with your car, your driving and the rates you pay.',
  fields: [
    { key: 'homePence', label: 'Electricity at home', unit: 'p per kWh' },
    { key: 'petrolPence', label: 'Petrol', unit: 'p per litre' },
    { key: 'mpg', label: 'Petrol car economy', unit: 'miles per gallon' },
    { key: 'milesPerKwh', label: 'Electric car efficiency', unit: 'miles per kWh' },
    { key: 'publicPence', label: 'Public charger', unit: 'p per kWh' }
  ]
};

// "{owner}" is replaced with the owner's first name from Settings (brand.ownerFirst) wherever the copy is drawn.
// Every word below is his own: the eyebrow is his "Meet your local EV charger installers" (singular), the pull line his P2 ("...a tidy finish, so your
// charger looks like it belongs on your home"), the paragraph his P1 and the rest of P2 in the third person, the three ticks the ones under his hero button.
// No invented biography: no years, no numbers, no stories.
export const ABOUT = {
  eyebrow: 'Your local EV charger installer',
  title: 'Meet {owner}.',
  pull: 'A tidy finish, so your charger looks like it belongs on your home.',
  body: '180 Electrical installs home EV chargers for homeowners across Northern Ireland. {owner} takes time to understand your property and how you drive, then fits a charger that suits both. Every visit is planned around a safe cable route.',
  ticks: ['Advice on charger options', 'Installation tailored to your property', 'Speak directly with 180 Electrical'],
  caption: '{owner}, 180 Electrical',
  brandsLabel: 'Charger brands {owner} installs',
  galleryEyebrow: 'Recent work',
  galleryTitle: 'Installations across Northern Ireland'
};

export const STEPS = {
  eyebrow: 'How it works',
  title: 'From first enquiry to charging at home.',
  items: [
    { n: '01', icon: 'house', title: 'Tell {owner} about your home', body: 'Answer a few short questions about your location, parking and plans.' },
    { n: '02', icon: 'message-circle', title: 'Discuss your installation', body: '{owner} will review your enquiry and explain the next steps. Photos or a survey may be needed to prepare an accurate quote.' },
    { n: '03', icon: 'calendar-check', title: 'Arrange your installation', body: 'Once you are happy with the agreed quote and scope, arrange a suitable installation date.' }
  ]
};

// His own pricing words (the paragraph is his, in the third person; the promise is the second sentence of his cost answer). The page shows NO figure of
// any kind outside the tagged idea below it: the teaser card ("See how a quote looks") is an IDEA from us, so it carries data-proto and is hidden by
// "Only my content". It shows no prices either: it only opens the example quote page.
export const PRICING = {
  eyebrow: 'Your quote',
  title: 'Your installation, clearly quoted.',
  body: 'Costs depend on your charger choice, cable route and any electrical work required. Tell {owner} about your home so he can advise on the next steps towards an accurate quote.',
  promise: 'A clear quote, not a headline figure that changes later.',
  teaser: {
    title: 'See how a quote looks',
    body: 'Curious what you would receive? Open an example quote and read it line by line.',
    note: 'Example only',
    link: 'See how a quote looks',
    // Line names for the little picture of a quote (names only, no figures). They only appear inside the tagged idea.
    lines: ['Your chosen home charger', 'Installation', 'Dedicated circuit', 'Testing and certification']
  }
};

export const AREA = {
  eyebrow: 'Where {owner} works',
  title: 'EV charger installation in Northern Ireland.',
  body: '{owner} installs home chargers across Northern Ireland. If you are not sure, enter your postcode and he will check.',
  note: 'We cover Northern Ireland (BT postcodes)',
  // The funnel's own message for a postcode it cannot read (step 1), reused so the two never disagree.
  invalid: 'Please enter a valid UK postcode so we can check your location.',
  covered: "Good news, that's in our area.",
  edge: "That's on the edge of {owner}'s area. Call {owner} on {phone} and he will check.",
  outside: 'That postcode looks to be outside Northern Ireland. You can still send an enquiry and {owner} will check.',
  check: 'Check my postcode',
  continue: (pc) => `Continue with ${pc}`
};

export const FAQ = {
  eyebrow: 'Questions',
  title: 'Frequently asked questions',
  // The question that opens first: the one every buyer is asking.
  openFirst: 'How much will installation cost?',
  items: [
    {
      q: 'Which charger is right for my car?',
      a: 'Most home chargers suit most electric and plug-in hybrid cars, but the best choice depends on your vehicle, how you drive and your preferences. {owner} will help you weigh up the options once he knows a little about your setup.'
    },
    {
      q: 'Do I need a driveway or private parking?',
      a: 'A charger needs a suitable parking position and a safe route for the cable that does not create a hazard. {owner} assesses this for your property rather than assuming it. Running a cable across a public pavement is not a standard solution, so tell him your setup and he will advise.'
    },
    {
      q: 'How much will installation cost?',
      a: 'It depends on the charger you choose, the cable route and any electrical work your property needs. {owner} gives you a clear quote once he understands your requirements, rather than a headline figure that changes later.'
    },
    {
      q: 'How long does installation take?',
      a: 'Timing varies with the property and the scope of work involved. Once {owner} has reviewed your enquiry, he can talk you through what to expect for your specific installation.'
    },
    {
      q: 'Can I have a charger installed before my car arrives?',
      a: 'Many homeowners plan the installation while waiting for their car. Tell {owner} where you are in the process and he will suggest sensible timing so your charger is ready when you need it.'
    },
    {
      q: 'What happens after I enquire?',
      a: '{owner} reviews your details and contacts you to discuss your installation and the next steps. Submitting the form is an enquiry, not a booking, and it does not produce an instant final price.'
    }
  ]
};

export const FINAL = {
  title: 'Ready to make charging at home simpler?',
  accent: 'simpler?',
  body: 'Tell {owner} about your home and plans. He will review your enquiry and help you understand your installation options.'
};

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
