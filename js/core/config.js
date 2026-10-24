// js/core/config.js: constants, promises, defaults, template kinds, enquiry questions, default settings factory
// Owner: WP1

import { isValidPostcode, normalisePostcode } from './format.js';

// v2 = the 180 Electrical model (ev_quote enquiries, booking.answers, booking.tentative, showOnWebsite). The storage key keeps
// its v1 name on purpose (other pages and tests read it); a stored v1 state is migrated in store.js.
export const SCHEMA_VERSION = 2;
export const STORAGE_KEYS = { state: 'vm_state_v1', theme: 'vm_theme', draft: 'vm_draft_v1', bootFail: 'vm_boot_fail' };
// The folder holding index.html, with a trailing slash (works under /<repo>/ and at a domain root).
export const SITE_BASE_URL = new URL('../../', import.meta.url).href;

export const STATUSES = ['new', 'confirmed', 'on_the_way', 'done', 'cancelled'];
export const STATUS_LABELS = { new: 'New request', confirmed: 'Confirmed', on_the_way: 'On the way', done: 'Done', cancelled: 'Cancelled' };
export const TRANSITIONS = { new: ['confirmed', 'cancelled'], confirmed: ['on_the_way', 'done', 'cancelled'], on_the_way: ['done', 'cancelled'], done: [], cancelled: [] };
export const SOURCES = ['website', 'phone', 'whatsapp', 'referral'];
export const SOURCE_LABELS = { website: 'Website', phone: 'Phone', whatsapp: 'WhatsApp', referral: 'Word of mouth' };
export const PAID_METHODS = ['cash', 'card', 'bank'];
export const PAID_METHOD_LABELS = { cash: 'Cash', card: 'Card', bank: 'Bank' };

// Four fixed two-hour arrival windows. Labels use the en dash (U+2013).
export const WINDOWS = [
  { id: 0, start: '08:00', end: '10:00', startMin: 480, endMin: 600, label: '8–10am', arrive: 'between 8 and 10am', short: '8–10' },
  { id: 1, start: '10:00', end: '12:00', startMin: 600, endMin: 720, label: '10am–12', arrive: 'between 10am and 12', short: '10–12' },
  { id: 2, start: '13:00', end: '15:00', startMin: 780, endMin: 900, label: '1–3pm', arrive: 'between 1 and 3pm', short: '1–3' },
  { id: 3, start: '15:00', end: '17:00', startMin: 900, endMin: 1020, label: '3–5pm', arrive: 'between 3 and 5pm', short: '3–5' }
];
export const LUNCH = { start: '12:00', end: '13:00' }; // never bookable
export const HALF_DAY_STARTS = [0, 2]; // morning = windows 0+1, afternoon = windows 2+3

// Every promise the copy makes lives here so the owner can match his real habits in one edit.
export const PROMISES = {
  arrivalWindowHours: 2,
  awayMinutes: 30,
  freeChangeHours: 24,
  reminderHour: 18,
  reviewDelayMinutes: 60,
  emergencyReplyMinutes: 10,
  emergencyCallAfterMinutes: 15,
  emergencyArrivalHours: 2,
  emergencyHoursText: '7am to 10pm, 7 days',
  extraHourRate: 55,
  emergencyFrom: 95,
  powerCutNumber: '105',
  contactWithinHours: 24 // "the team will be in touch within 24 hours" (the enquiry promise on his own site)
};

export const EMERGENCY_REASONS = [
  { id: 'no_power', label: 'No power at all' },
  { id: 'burning', label: 'Burning smell or sparks' },
  { id: 'tripping', label: "Keeps tripping and won't reset" },
  { id: 'water', label: 'Water has got in' },
  { id: 'other', label: 'Something else' }
];

export const CANCEL_REASONS = [
  { id: 'customer', label: 'Customer asked' },
  { id: 'cannot', label: "Can't make it" },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'other', label: 'Other' }
];

// The 19 message kinds (10.1), in contract order.
export const TEMPLATE_KINDS = [
  'owner_new_booking', 'owner_emergency', 'owner_customer_cancelled', 'owner_customer_rescheduled',
  'customer_received', 'customer_confirmed', 'customer_declined', 'customer_rescheduled',
  'customer_on_my_way', 'customer_emergency_received', 'customer_emergency_accepted', 'customer_completed',
  'customer_review_request', 'customer_reminder', 'customer_cancelled', 'customer_payment_nudge',
  'customer_running_late', 'customer_need_access', 'customer_quote_ready'
];

// Labels shown on the Messages screen (same order as TEMPLATE_KINDS).
export const KIND_LABELS = {
  owner_new_booking: 'New enquiry alert',
  owner_emergency: 'Emergency alert',
  owner_customer_cancelled: 'Cancelled by customer',
  owner_customer_rescheduled: 'Moved by customer',
  customer_received: 'Enquiry received',
  customer_confirmed: 'Confirmation',
  customer_declined: 'Declined',
  customer_rescheduled: 'Rescheduled',
  customer_on_my_way: 'On my way',
  customer_emergency_received: 'Emergency received',
  customer_emergency_accepted: 'Emergency accepted',
  customer_completed: 'Job done',
  customer_review_request: 'Review request',
  customer_reminder: 'Reminder',
  customer_cancelled: 'Cancelled',
  customer_payment_nudge: 'Payment reminder',
  customer_running_late: 'Running late',
  customer_need_access: 'Need access',
  customer_quote_ready: 'Quote ready'
};

// ---------- enquiry questions (the 4 choice steps of the quote funnel, verbatim from his site) ----------

// Steps 2 to 5. Step 1 (postcode) and step 6 (contact) have their copy in the funnel module. `label` has no A/B/C letter.
export const ENQUIRY_STEPS = [
  {
    key: 'parking', step: 2, title: 'Where would you normally park to charge?',
    note: 'Whatever you pick, we will check that a safe cable route and parking position can be arranged.',
    options: [
      { value: 'driveway', label: 'Private driveway' },
      { value: 'garage', label: 'Garage' },
      { value: 'allocated', label: 'Allocated parking space' },
      { value: 'street', label: 'On-street parking' },
      { value: 'other', label: 'Other or not sure' }
    ]
  },
  {
    key: 'vehicle', step: 3, title: 'Do you already have your electric or plug-in hybrid car?', note: '',
    options: [
      { value: 'have', label: 'Yes' },
      { value: 'ordered', label: "It's ordered or arriving soon" },
      { value: 'choosing', label: "I'm choosing one" }
    ]
  },
  {
    key: 'timing', step: 4, title: 'When would you like your charger installed?', note: '',
    options: [
      { value: 'asap', label: 'As soon as possible' },
      { value: 'month', label: 'Within the next month' },
      { value: 'one_to_three', label: 'Within 1 to 3 months' },
      { value: 'researching', label: 'Just researching' }
    ]
  },
  {
    key: 'permission', step: 5, title: 'Can you authorise installation work at the property?',
    note: "Not sure yet? That's fine. We will help you work out what is needed.",
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'landlord', label: 'I need landlord or freeholder approval' },
      { value: 'unsure', label: "I'm not sure" }
    ]
  }
];

// The five answers a job card shows, in order (postcode is step 1).
export const ENQUIRY_ANSWER_KEYS = ['postcode', 'parking', 'vehicle', 'timing', 'permission'];

// Short row headings for the owner (job card rows and the compact message line).
export const ENQUIRY_ANSWER_HEADINGS = { postcode: 'Postcode', parking: 'Parking', vehicle: 'Car', timing: 'Timing', permission: 'Permission' };

// Short lower-case phrases for the one-line owner alert ("Parking: private driveway. Car: ordered. ...").
export const ENQUIRY_ANSWER_SHORT = {
  parking: { driveway: 'private driveway', garage: 'garage', allocated: 'allocated space', street: 'on-street', other: 'other or not sure' },
  vehicle: { have: 'has one', ordered: 'ordered', choosing: 'still choosing' },
  timing: { asap: 'as soon as possible', month: 'within a month', one_to_three: '1 to 3 months', researching: 'just researching' },
  permission: { yes: 'yes', landlord: 'needs landlord approval', unsure: 'not sure' }
};

/** The verbatim option label for an answer ('' if unknown). For 'postcode' it returns the value itself. */
export function answerLabel(key, value) {
  if (key === 'postcode') return typeof value === 'string' ? value : '';
  const step = ENQUIRY_STEPS.find((s) => s.key === key);
  const option = step ? step.options.find((o) => o.value === value) : null;
  return option ? option.label : '';
}

/**
 * Clean an answers object: unknown keys ignored, invalid values dropped. Returns null when nothing valid was given.
 * `postcode` is the valid input postcode, else the fallback (normally the address postcode); `marketingOptIn` must be a boolean.
 */
export function normaliseAnswers(input, fallbackPostcode = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const rest = {};
  for (const step of ENQUIRY_STEPS) {
    if (step.options.some((o) => o.value === input[step.key])) rest[step.key] = input[step.key];
  }
  if (typeof input.marketingOptIn === 'boolean') rest.marketingOptIn = input.marketingOptIn;
  const own = typeof input.postcode === 'string' && isValidPostcode(input.postcode) ? normalisePostcode(input.postcode) : '';
  if (!own && Object.keys(rest).length === 0) return null;
  const fallback = typeof fallbackPostcode === 'string' && isValidPostcode(fallbackPostcode) ? normalisePostcode(fallbackPostcode) : '';
  const postcode = own || fallback;
  return { ...(postcode ? { postcode } : {}), ...rest };
}

/** 'Parking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.' ('' without answers). */
export function answersLine(answers) {
  if (!answers || typeof answers !== 'object') return '';
  const parts = [];
  for (const step of ENQUIRY_STEPS) {
    const text = ENQUIRY_ANSWER_SHORT[step.key][answers[step.key]];
    if (text) parts.push(`${ENQUIRY_ANSWER_HEADINGS[step.key]}: ${text}.`);
  }
  return parts.join(' ');
}

// Documents every placeholder in 10.2. buildContext() must return exactly these keys.
export const PLACEHOLDERS = {
  ref: 'Booking reference, e.g. EL-1043',
  customerName: 'Customer full name',
  customerFirst: 'Customer first name',
  customerPhone: 'Customer phone, display form',
  ownerFirst: 'Owner first name',
  business: 'Business name',
  businessShort: 'Short business name',
  ownerPhone: 'Business phone, display form',
  service: 'Service name',
  serviceFull: 'Service name plus the variant, e.g. EICR safety report (House, 2–3 bed)',
  price: 'Quoted price, or Free for a free visit',
  finalPrice: 'Final price (falls back to the quoted price)',
  priceLine: 'Price sentence that depends on the price type',
  when: 'Day and window, e.g. Sat 24 Oct, 8–10am (or "a time to be arranged" for an enquiry with no window yet)',
  whenLong: 'Day and arrival window in words, e.g. Sat 24 Oct, arriving between 8 and 10am',
  whenLine: 'Owner alert time line: "Survey pencilled in: ... (provisional)" for a pencilled enquiry, else the arrival window',
  serviceWhen: 'Service and when, "the free survey visit on ..." for an enquiry, or "your emergency visit"',
  dateShort: 'Short date, e.g. Sat 24 Oct',
  arrive: 'Arrival window in words, e.g. between 8 and 10am',
  line1: 'House number and street (falls back to the postcode)',
  postcode: 'Postcode',
  address: 'Street and postcode (the postcode alone when only the postcode is known)',
  noteLine: 'The customer note as a line, or empty',
  statusLine: 'Owner alert status line',
  alertTitle: 'Owner alert heading: New enquiry, or New booking',
  answersLine: 'The enquiry answers in one line, e.g. Parking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.',
  emergencyList: 'The emergency reasons, comma separated',
  etaMinutes: 'ETA in minutes',
  etaText: 'ETA in words, e.g. 45 minutes',
  etaClock: 'ETA clock time, HH:mm',
  oldWhen: 'The time before a reschedule',
  newWhen: 'The time after a reschedule',
  reasonLine: 'Cancellation reason sentence, or empty',
  receivedReason: 'Travel check sentence for edge and outside postcodes',
  receivedLine: 'The body of the enquiry-received text: pencilled-in survey, provisional, contact within 24 hours',
  contactHours: 'Hours within which the team will be in touch (24)',
  nextFree: 'Next free visit, e.g. Tomorrow, 8–10am',
  nextFreeLine: 'Next free visit sentence',
  finalLine: 'Payment sentence on completion (no charge for a free visit)',
  certLine: 'Paperwork sentence: certificate for EV installs and certificate jobs, written quote for the survey visit',
  jobLink: 'Dashboard link to the booking',
  manageLink: 'Customer link to manage the booking',
  reviewLink: 'Sample review link',
  awayMinutes: 'Minutes-away promise',
  emergencyReplyMinutes: 'Emergency reply promise in minutes',
  emergencyCallAfterMinutes: 'Minutes after which to call',
  powerCutNumber: 'Power cut phone number'
};

// Default message text (10.3). Placeholders are filled by renderTemplate(); empty lines are dropped.
export const DEFAULT_TEMPLATES = {
  owner_new_booking: [
    '*{alertTitle} {ref}*',
    '{customerName} · {customerPhone}',
    '{serviceFull} · {price}',
    '{whenLine}',
    '{address}',
    '{answersLine}',
    '{noteLine}',
    '{statusLine}',
    'Open: {jobLink}'
  ].join('\n'),
  owner_emergency: [
    '*URGENT: emergency request {ref}*',
    '{customerName} · {customerPhone}',
    '{emergencyList}',
    '{address}',
    '{noteLine}',
    'Reply within {emergencyReplyMinutes} minutes. Open: {jobLink}'
  ].join('\n'),
  owner_customer_cancelled: [
    '*Cancelled by customer {ref}*',
    '{customerName} cancelled {serviceWhen}.',
    '{reasonLine}',
    'That window is free again.'
  ].join('\n'),
  owner_customer_rescheduled: [
    '*Moved by customer {ref}*',
    '{customerName} moved {service} from {oldWhen} to {newWhen}.',
    'Open: {jobLink}'
  ].join('\n'),
  customer_received: 'Hi {customerFirst}, thanks for getting in touch with {business}. {receivedLine} Ref {ref}. Need us sooner? Call {ownerPhone}.',
  customer_confirmed: "Hi {customerFirst}, it's {ownerFirst} from {business}. You're booked in: {serviceFull}, {whenLong}, at {line1}. {priceLine} I'll message when I'm {awayMinutes} minutes away. Need to change it? Reply here or call {ownerPhone}. Ref {ref}",
  customer_declined: "Hi {customerFirst}, it's {ownerFirst} from {business}. Sorry, I can't do {serviceWhen}. {nextFreeLine} Call {ownerPhone} if you'd like to talk it through. Ref {ref}",
  customer_rescheduled: "Hi {customerFirst}, it's {ownerFirst} from {business}. I've moved your {service} from {oldWhen} to {newWhen} at {line1}. Does that still work? Reply here or call {ownerPhone}. Ref {ref}",
  customer_on_my_way: "Hi {customerFirst}, it's {ownerFirst}. I'm on my way to {line1}, {etaText} away (around {etaClock}). See you shortly. Ref {ref}",
  customer_emergency_received: "Hi {customerFirst}, it's {ownerFirst} from {business}. I've got your emergency request. If anyone is in danger, call 999 first. I aim to reply within {emergencyReplyMinutes} minutes. If you haven't heard in {emergencyCallAfterMinutes} minutes, call me on {ownerPhone}. Ref {ref}",
  customer_emergency_accepted: "Hi {customerFirst}, it's {ownerFirst}. I'm on my way to {address}, about {etaText} away (around {etaClock}). If it's safe, switch off at the fuse box and don't touch anything wet or scorched. Ref {ref}",
  customer_completed: "Hi {customerFirst}, it's {ownerFirst} from {business}. All done at {line1}, thanks. {finalLine} {certLine} Ref {ref}",
  customer_review_request: "Hi {customerFirst}, it's {ownerFirst}. Thanks for choosing {business}. If you were happy with the work, a quick review helps a small firm a lot: {reviewLink}. Ref {ref}",
  customer_reminder: "Hi {customerFirst}, it's {ownerFirst} from {business}. A reminder: I'm booked to arrive {whenLong} at {line1} for {serviceFull}. I'll message when I'm {awayMinutes} minutes away. Need to change it? Call {ownerPhone}. Ref {ref}",
  customer_cancelled: "Hi {customerFirst}, it's {ownerFirst} from {business}. I'm sorry, I have to cancel {serviceWhen}. {reasonLine} {nextFreeLine} Ref {ref}",
  customer_payment_nudge: "Hi {customerFirst}, it's {ownerFirst} from {business}. A quick reminder that {finalPrice} is due for {service} on {dateShort}. You can pay by card, bank transfer or cash. Thank you. Ref {ref}",
  customer_running_late: "Hi {customerFirst}, it's {ownerFirst}. I'm running about 15 minutes late for {line1}. Sorry about that, I'm on my way. Ref {ref}",
  customer_need_access: "Hi {customerFirst}, it's {ownerFirst}. I'm outside {line1}. Could you let me in and show me the fuse box? Ref {ref}",
  customer_quote_ready: "Hi {customerFirst}, it's {ownerFirst} from {business}. Your written quote is ready. Reply here or call {ownerPhone} and I'll talk you through it. Ref {ref}"
};

function pounds(n) {
  return `£${n}`;
}

// ev_quote first (the one thing the website offers), then the installation (arranged after the quote), then the older
// services that stay in the data for owner-entered phone jobs. Only showOnWebsite services appear on the public site.
function makeServices() {
  const emergencyHours = PROMISES.emergencyArrivalHours;
  return [
    {
      id: 'ev_quote', name: 'Home EV charger quote',
      description: 'A free survey visit and a written quote for your home EV charger. No obligation.',
      icon: 'house', priceType: 'free', price: 0, priceNote: 'Free survey and written quote',
      variants: [], defaultVariantId: null, blocks: 1, durationMin: 120, durationLabel: 'One 2-hour window', tag: '', active: true, showOnWebsite: true
    },
    {
      id: 'ev', name: 'EV charger installation',
      // Quote-led: the headline label is 'Quoted for your home'. `price` is only the owner's starting amount for a job he books.
      description: 'Your home EV charger supplied and fitted once the written quote is agreed. Arranged after the free survey.',
      icon: 'plug-zap', priceType: 'quoted', price: 899, priceNote: 'Quoted for your home',
      variants: [], defaultVariantId: null, blocks: 2, durationMin: 240, durationLabel: 'About half a day', tag: '', active: true, showOnWebsite: false
    },
    {
      id: 'fault', name: 'Fault finding and repairs',
      description: 'Fuse box keeps tripping? Dead sockets? Flickering lights? Found and fixed, usually on the first visit.',
      icon: 'wrench', priceType: 'from', price: 75,
      priceNote: `First hour included, then ${pounds(PROMISES.extraHourRate)} an hour`,
      variants: [], defaultVariantId: null, blocks: 1, durationMin: 120, durationLabel: 'About 1–2 hrs', tag: '', active: true, showOnWebsite: false
    },
    {
      id: 'eicr', name: 'EICR safety report',
      description: 'The electrical safety report landlords and buyers often ask for. Digital report the same day.',
      icon: 'clipboard-check', priceType: 'by_size', price: 150, priceNote: 'Fixed price by property size',
      variants: [
        { id: 'flat', label: 'Flat', price: 150 },
        { id: 'house', label: 'House, 2–3 bed', price: 195 },
        { id: 'large', label: 'House, 4+ bed', price: 260 }
      ],
      defaultVariantId: 'house', blocks: 2, durationMin: 240, durationLabel: 'About 3–4 hrs', tag: 'Landlords', active: true, showOnWebsite: false
    },
    {
      id: 'consumer', name: 'New fuse box (consumer unit)',
      description: 'A modern consumer unit fully fitted and tested, certificate included.',
      icon: 'toggle-right', priceType: 'from', price: 540, priceNote: 'Certificate included',
      variants: [], defaultVariantId: null, blocks: 2, durationMin: 240, durationLabel: 'About half a day', tag: 'Certificate included', active: true, showOnWebsite: false
    },
    {
      id: 'sockets', name: 'Sockets, switches and lights',
      description: 'Extra sockets, downlights, outdoor lights, USB points. Neat, with making good.',
      icon: 'lightbulb', priceType: 'from', price: 85,
      priceNote: `First hour included, then ${pounds(PROMISES.extraHourRate)} an hour`,
      variants: [], defaultVariantId: null, blocks: 1, durationMin: 120, durationLabel: 'About 1–2 hrs', tag: '', active: true, showOnWebsite: false
    },
    {
      id: 'rewire', name: 'Rewire survey',
      description: 'Free survey visit and a written quote within 48 hours.',
      icon: 'file-text', priceType: 'free', price: 0, priceNote: 'Free visit, written quote',
      variants: [], defaultVariantId: null, blocks: 1, durationMin: 120, durationLabel: 'About 45 mins', tag: '', active: true, showOnWebsite: false
    },
    {
      // Stored once at creation and never rendered by the UI, so a rebrand cannot leave a stale name on screen.
      id: 'emergency', name: 'Emergency visit',
      description: `Power out or something unsafe? Daniel aims to be with you within ${emergencyHours} ${emergencyHours === 1 ? 'hour' : 'hours'}.`,
      icon: 'siren', priceType: 'from', price: PROMISES.emergencyFrom, priceNote: 'Includes the first hour',
      variants: [], defaultVariantId: null, blocks: 0, durationMin: 0, durationLabel: 'As soon as possible', tag: '', active: true, showOnWebsite: false, urgent: true
    }
  ];
}

// Every BT postcode district is in the area (BT1 to BT94 covers all of Northern Ireland); nothing is an edge zone.
const NI_OUTWARD = Array.from({ length: 94 }, (_, i) => `BT${i + 1}`);

/** The business block of a fresh Settings (also what the v1 migration falls back to). */
export function makeDefaultBusiness() {
  return {
    name: '180 Electrical',
    shortName: '180',
    descriptor: 'Electrical',
    ownerFirstName: 'Daniel', // taken from his email address; editable in Settings
    ownerFullName: 'Daniel', // the surname is unknown, so the prototype does not invent one
    tagline: 'Home EV charger installation across Northern Ireland.',
    phone: '07885 496800',
    email: 'daniel@180electrical.co.uk',
    areaName: 'Northern Ireland',
    areaText: 'Serving Northern Ireland',
    towns: ['Belfast', 'Lisburn', 'Bangor', 'Newry', 'Derry/Londonderry', 'Newtownards', 'Ballymena', 'Antrim'],
    coveredOutward: [...NI_OUTWARD],
    edgeOutward: [],
    // His site makes no scheme, insurance or guarantee claims, so the prototype adds none (render these only when non-empty).
    schemeLine: '',
    insuranceLine: '',
    credentials: ['Level 3 Electrical Installation', '2391 Inspection and Testing'],
    brands: ['ZAPPI', 'OHME', 'SYNC']
  };
}

/** A fresh, deep Settings object (7.3 and 3.1) on every call. Nothing is shared between calls. */
export function makeDefaultSettings() {
  return {
    business: makeDefaultBusiness(),
    // Index = JS weekday (0 Sunday). Value = open WindowIds.
    hours: [[], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1]],
    leadMinutes: 90,
    maxDaysAhead: 14,
    daysOff: [],
    fullDays: [],
    autoConfirm: true,
    takingEmergencies: false, // his business is home EV chargers: the emergency path exists but is off until he turns it on
    remindersOn: true,
    services: makeServices(),
    templates: {},
    theme: 'dark',
    demoPhoneDigits: ''
  };
}
