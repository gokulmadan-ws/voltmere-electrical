// js/landing/content.js: landing copy (reviews, FAQ, steps, trust items), the hero tile map and the booking link helpers.
// Owner: WP3
import { PROMISES } from '../core/config.js';
import { bookHref, openBooking } from '../booking/nav.js';

// Sample rating shown on the page. Always followed by a SampleTag or "(sample)" (3.6).
export const RATING = { score: '4.9', outOf: 5, count: 212 };

// Hero tiles (13.1 L3): the copy is fixed, the price and the icon come live from the service in the store.
export const HERO_TILES = [
  { id: 'fault', title: "Something's gone wrong", sub: 'Tripping, dead sockets, burning smell' },
  { id: 'eicr', title: 'Landlord safety report', sub: 'EICR certificate' },
  { id: 'sockets', title: 'Sockets, lights and small jobs', sub: '' },
  { id: 'consumer', title: 'New fuse box', sub: 'Consumer unit upgrade' }
];

// Icon use map of 4.9, used when a service in the store has no icon of its own.
export const SERVICE_ICONS = {
  fault: 'wrench', eicr: 'clipboard-check', consumer: 'toggle-right', sockets: 'lightbulb',
  ev: 'plug-zap', rewire: 'file-text', emergency: 'siren'
};

// Short labels for the EICR price chips (13.1 L6): Flat, 2–3 bed house, 4+ bed.
export const VARIANT_SHORT = { flat: 'Flat', house: '2–3 bed house', large: '4+ bed' };

export const TRUST_ITEMS = [
  { icon: 'star', title: `Rated ${RATING.score} out of ${RATING.outOf}`, sub: `${RATING.count} reviews`, sample: true },
  { icon: 'shield-check', title: 'Part P registered', sub: 'Certificate with every job', sample: true },
  { icon: 'badge-check', title: '£2m insured', sub: 'Public liability cover', sample: true },
  { icon: 'receipt', title: 'Prices agreed first', sub: 'Fixed for standard jobs, written quote for bigger ones', sample: false }
];

export const QUALIFICATIONS = ['City & Guilds 2365', '18th Edition', 'Inspection and Testing 2391', 'Part P registered'];

// The three sample reviews of 3.5 (copy exact). `who` is the byline, `job` the job type, `town` the tag.
export const REVIEWS = [
  {
    quote: 'Fuse box kept tripping every evening. Dan found a faulty immersion heater in 40 minutes and quoted before he touched anything.',
    name: 'Priya N.', who: 'Priya N.', job: 'Fault finding', town: 'Thornley Green'
  },
  {
    quote: 'Needed an EICR for two flats with a tenant moving in Friday. Booked at 9pm, done Wednesday, certificate in my inbox that afternoon.',
    name: 'Marcus T.', who: 'Marcus T., landlord', job: 'EICR safety report', town: 'Hollin Cross'
  },
  {
    quote: 'Rang three firms and only Dan gave me a price and a time. Shoe covers on, hoovered up after. New consumer unit in one morning.',
    name: 'Alison R.', who: 'Alison R.', job: 'New fuse box', town: 'Wexby'
  }
];

export function howSteps(b) {
  const o = b.ownerFirst;
  return [
    { title: 'Pick a time', body: `You see ${o}'s real diary, not a we'll-call-you-back form.` },
    { title: 'Get it in writing', body: 'Instant confirmation by WhatsApp or text, plus a reminder the evening before.' },
    {
      title: `${o} turns up, tidy and on time`,
      body: `A message when ${o} is ${PROMISES.awayMinutes} minutes away. Certificate and receipt when the job is done. You pay after.`
    }
  ];
}

export function faqItems(b) {
  const o = b.ownerFirst;
  return [
    {
      q: 'How much will it cost?',
      a: `The price on each service is what you pay for standard jobs. If ${o} finds something bigger, you get the price in writing before any extra work. You pay after the job by card, bank transfer or cash.`
    },
    {
      q: 'Do I need to be home?',
      a: `Someone over 18 needs to let ${o} in and show where the fuse box is. Landlords can book with a tenant's number and arrange access by message.`
    },
    {
      q: 'Will I get a certificate?',
      a: `Yes. Notifiable work is registered through ${o}'s competent person scheme and you get the certificate by email or WhatsApp.`
    },
    {
      q: 'What is an EICR and do I need one?',
      a: `An Electrical Installation Condition Report is a safety inspection. Landlords in England must have rented homes inspected at least every 5 years, and buyers and lenders often ask for one. Findings are coded C1, C2, C3 or FI and ${o} explains each in plain English.`
    },
    {
      q: 'What does arrival window mean?',
      a: `${o} arrives at some point in a ${PROMISES.arrivalWindowHours}-hour window, for example 10am to 12, and messages you when ${o} is ${PROMISES.awayMinutes} minutes away.`
    },
    {
      q: 'How do I change or cancel?',
      a: `Use the Manage booking link on your confirmation, reply to your confirmation message, or call ${o}. It's free up to ${PROMISES.freeChangeHours} hours before.`
    }
  ];
}

// Pre-filled WhatsApp texts (13.1 L3 and L13).
export const waBookText = (b) => `Hi ${b.ownerFirst}, I'd like to book an electrician.`;
export const waUnsureText = (b) => `Hi ${b.ownerFirst}, I'd like to book an electrician. Not sure what I need yet.`;

/**
 * Click handler that opens the booking sheet through the route emitter (11.1) instead of letting a plain
 * hash link push a second history entry. Modified clicks (new tab) keep their default behaviour.
 */
export function bookClick(opts = {}) {
  return (e) => {
    if (e) {
      if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.preventDefault) e.preventDefault();
    }
    openBooking(opts);
  };
}

/** Props for an <a> that opens the sheet: a real href (so "open in new tab" works) plus the click handler. */
export function bookLinkProps(opts = {}) {
  return { href: bookHref(opts), onClick: bookClick(opts) };
}
