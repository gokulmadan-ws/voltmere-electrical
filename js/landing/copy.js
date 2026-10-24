// js/landing/copy.js: the words of every section between the hero and the footer. His own copy, word for word from docs/reference/180-site-report.md ("we", "the team",
// "180 Electrical"; tests/qa/audit.mjs diffs it against that file), plus our own wording only where docs/LANDING-V5.md Appendix C lists it: the gallery captions, the postcode
// field label, the verdict lines, and the three tagged ideas (earliest visit, example quote, running costs). Nothing here is rendered by the hero, the header or the footer,
// so this module loads with the sections (js/landing/below.js), never with the first screen.
// Owner: B2 (landing V5). Moved out of content.js so the two builders never edit one file.

/** Home charging that works around you: his three reasons. No icons, no numbers. */
export const WHY = {
  title: 'Home charging that works around you.',
  rows: [
    { title: "Charge while you're at home", body: 'Plug in when you arrive and charge around your routine.' },
    { title: 'Choose with confidence', body: 'Get help choosing a charger suited to your vehicle, property and preferences.' },
    { title: 'Make the most of smart charging', body: 'Compatible chargers and suitable electricity tariffs can let you schedule charging for off-peak periods.' }
  ]
};

/** Meet your local EV charger installers: his H2 and both paragraphs, then his brand list (the brand names themselves come live from Settings). */
export const ABOUT = {
  title: 'Meet your local EV charger installers.',
  p1: '180 Electrical installs home EV chargers for homeowners across Northern Ireland. We take time to understand your property and how you drive, then fit a charger that suits both.',
  p2: 'Every visit is planned around a safe cable route and a tidy finish, so your charger looks like it belongs on your home.',
  brandsLabel: 'Charger brands we install'
};

/** Our recent work. His label and heading; the captions name only the wall (they are ours: never a make, a model or a claim). */
export const WORK = {
  label: 'Our recent work',
  title: 'Installations across Northern Ireland',
  listLabel: 'Recent installations',
  dotsLabel: 'Choose a photo',
  viewer: 'Photo viewer'
};

/** From first enquiry to charging at home: his three steps. The numerals are drawn by the page (the logo voice), so they are not in the text. */
export const STEPS = {
  title: 'From first enquiry to charging at home.',
  items: [
    { n: '01', title: 'Tell us about your home', body: 'Answer a few short questions about your location, parking and plans.' },
    { n: '02', title: 'Discuss your installation', body: 'The team will review your enquiry and explain the next steps. Photos or a survey may be needed to prepare an accurate quote.' },
    { n: '03', title: 'Arrange your installation', body: 'Once you are happy with the agreed quote and scope, arrange a suitable installation date.' }
  ]
};

/** The earliest-visit idea (a margin annotation under step 02). Ours, tagged "Idea from us, not on your site today". */
export const VISIT = {
  lead: 'Earliest visit {owner} could offer',
  confirm: '{owner} will confirm.',
  full: 'Diary full for the next {n} days.',
  call: 'Call {owner}',
  today: '{owner} is fully booked today.'
};

/** Your installation, clearly quoted: his H2 and his paragraph, then two tagged ideas on the same ruled rows. */
export const PRICING = {
  title: 'Your installation, clearly quoted.',
  body: 'Costs depend on your charger choice, cable route and any electrical work required. Tell us about your home so the team can advise on the next steps towards an accurate quote.',
  teaser: {
    title: 'See how a quote looks',
    body: 'Curious what you would receive? Open an example quote and read it line by line.',
    link: 'See how a quote looks',
    note: 'Example only',
    head: ['No.', 'Line', 'Amount'],
    // Line names for the blank quote form (names only, never a figure). They only appear inside the tagged idea.
    lines: ['Your chosen home charger', 'Installation', 'Dedicated circuit', 'Testing and certification']
  }
};

/** The running-costs idea: arithmetic on figures the visitor can see and change (js/landing/calc.js, unchanged). No 180 Electrical prices, no promises. */
export const CALC = {
  title: 'What would home charging cost you?',
  lead: 'A rough guide, using example rates that you can change.',
  milesLabel: 'Miles you drive in a year',
  milesUnit: 'miles a year',
  sliderLabel: 'Miles you drive in a year, slider',
  resultTitle: 'Your estimate',
  headLead: 'Home charging would cost about',
  headTail: 'a year',
  compareTitle: 'The same miles, three ways',
  bars: { home: 'Home charging', petrol: 'Petrol', public: 'Public charging' },
  ratesSummary: 'Change the rates',
  assumptionsTitle: 'Rates we have assumed',
  assumptionsNote: 'Examples only, not 180 Electrical prices. A kWh is the unit of electricity on your bill. Change any figure to match yours.',
  workingsTitle: 'How we worked this out',
  reset: 'Reset',
  resetLabel: 'Reset to the example figures',
  badge: 'Illustrative estimate',
  footnote: 'An illustration, not a quote or a promise. Your own costs will differ with your car, your driving and the rates you pay.',
  fields: [
    { key: 'homePence', label: 'Electricity at home', unit: 'p per kWh' },
    { key: 'petrolPence', label: 'Petrol', unit: 'p per litre' },
    { key: 'mpg', label: 'Petrol car economy', unit: 'miles per gallon' },
    { key: 'milesPerKwh', label: 'Electric car efficiency', unit: 'miles per kWh' },
    { key: 'publicPence', label: 'Public charger', unit: 'p per kWh' }
  ]
};

/** EV charger installation in Northern Ireland: his H2, his paragraph and his note. The label, placeholder and verdict lines are ours (Appendix C). */
export const AREA = {
  title: 'EV charger installation in Northern Ireland.',
  body: 'We install home chargers across Northern Ireland. If you are not sure, enter your postcode and we will check.',
  note: 'Enter your postcode so we can check your location.',
  label: 'Your postcode',
  placeholder: 'e.g. BT7 3AB',
  // The funnel's own message for a postcode it cannot read (step 1), reused so the two never disagree.
  invalid: 'Please enter a valid UK postcode so we can check your location.',
  covered: "Good news, that's in our area.",
  edge: "That's on the edge of our area. Call {owner} on {phone} and we will check.",
  outside: 'That postcode looks to be outside Northern Ireland. You can still send an enquiry and we will check.'
};

/** Frequently asked questions: his six, in his order. `openFirst` is the one that opens on load. */
export const FAQ = {
  title: 'Frequently asked questions',
  openFirst: 'How much will installation cost?',
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

/** The closing band (js/landing/final.js draws it). His H2 and his paragraph, solid, no accent word. */
export const FINAL = {
  title: 'Ready to make charging at home simpler?',
  body: 'Tell us about your home and plans. 180 Electrical will review your enquiry and help you understand your installation options.'
};
