// js/core/config.js: constants, promises, defaults, template kinds, default settings factory
// Owner: WP1

export const SCHEMA_VERSION = 1;
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
  powerCutNumber: '105'
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
  owner_new_booking: 'New booking alert',
  owner_emergency: 'Emergency alert',
  owner_customer_cancelled: 'Cancelled by customer',
  owner_customer_rescheduled: 'Moved by customer',
  customer_received: 'Request received',
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

// Documents every placeholder in 10.2. buildContext() must return exactly these keys.
export const PLACEHOLDERS = {
  ref: 'Booking reference, e.g. VM-1043',
  customerName: 'Customer full name',
  customerFirst: 'Customer first name',
  customerPhone: 'Customer phone, display form',
  ownerFirst: 'Owner first name',
  business: 'Business name',
  businessShort: 'Short business name',
  ownerPhone: 'Business phone, display form',
  service: 'Service name',
  serviceFull: 'Service name plus the variant, e.g. EICR safety report (House, 2–3 bed)',
  price: 'Quoted price',
  finalPrice: 'Final price (falls back to the quoted price)',
  priceLine: 'Price sentence that depends on the price type',
  when: 'Day and window, e.g. Sat 24 Oct, 8–10am',
  whenLong: 'Day and arrival window in words, e.g. Sat 24 Oct, arriving between 8 and 10am',
  serviceWhen: 'Service and when, or "your emergency visit"',
  dateShort: 'Short date, e.g. Sat 24 Oct',
  arrive: 'Arrival window in words, e.g. between 8 and 10am',
  line1: 'House number and street (falls back to the postcode)',
  postcode: 'Postcode',
  address: 'Street and postcode',
  noteLine: 'The customer note as a line, or empty',
  statusLine: 'Owner alert status line',
  emergencyList: 'The emergency reasons, comma separated',
  etaMinutes: 'ETA in minutes',
  etaText: 'ETA in words, e.g. 45 minutes',
  etaClock: 'ETA clock time, HH:mm',
  oldWhen: 'The time before a reschedule',
  newWhen: 'The time after a reschedule',
  reasonLine: 'Cancellation reason sentence, or empty',
  receivedReason: 'Travel check sentence for edge and outside postcodes',
  nextFree: 'Next free visit, e.g. Tomorrow, 8–10am',
  nextFreeLine: 'Next free visit sentence',
  finalLine: 'Payment sentence on completion',
  certLine: 'Certificate sentence for certificate jobs',
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
    '*New booking {ref}*',
    '{customerName} · {customerPhone}',
    '{serviceFull} · {price}',
    '{whenLong}',
    '{address}',
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
  customer_received: "Hi {customerFirst}, it's {ownerFirst} from {business}. I've got your request for {serviceFull}, {when}. {receivedReason} I'll confirm shortly. Ref {ref}. Need me sooner? Call {ownerPhone}.",
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
  customer_quote_ready: "Hi {customerFirst}, it's {ownerFirst} from {business}. Your written quote for {service} is ready. Reply here or call {ownerPhone} and I'll talk you through it. Ref {ref}"
};

function pounds(n) {
  return `£${n}`;
}

function makeServices() {
  const emergencyHours = PROMISES.emergencyArrivalHours;
  return [
    {
      id: 'fault', name: 'Fault finding and repairs',
      description: 'Fuse box keeps tripping? Dead sockets? Flickering lights? Found and fixed, usually on the first visit.',
      icon: 'wrench', priceType: 'from', price: 75,
      priceNote: `First hour included, then ${pounds(PROMISES.extraHourRate)} an hour`,
      variants: [], defaultVariantId: null, blocks: 1, durationMin: 120, durationLabel: 'About 1–2 hrs', tag: 'Most booked', active: true
    },
    {
      id: 'eicr', name: 'EICR safety report',
      description: 'The certificate landlords need every 5 years and buyers ask for. Digital report the same day.',
      icon: 'clipboard-check', priceType: 'by_size', price: 150, priceNote: 'Fixed price by property size',
      variants: [
        { id: 'flat', label: 'Flat', price: 150 },
        { id: 'house', label: 'House, 2–3 bed', price: 195 },
        { id: 'large', label: 'House, 4+ bed', price: 260 }
      ],
      defaultVariantId: 'house', blocks: 2, durationMin: 240, durationLabel: 'About 3–4 hrs', tag: 'Landlords', active: true
    },
    {
      id: 'consumer', name: 'New fuse box (consumer unit)',
      description: '18th Edition unit fully fitted and tested, certificate included.',
      icon: 'toggle-right', priceType: 'from', price: 540, priceNote: 'Certificate included',
      variants: [], defaultVariantId: null, blocks: 2, durationMin: 240, durationLabel: 'About half a day', tag: 'Certificate included', active: true
    },
    {
      id: 'sockets', name: 'Sockets, switches and lights',
      description: 'Extra sockets, downlights, outdoor lights, USB points. Neat, with making good.',
      icon: 'lightbulb', priceType: 'from', price: 85,
      priceNote: `First hour included, then ${pounds(PROMISES.extraHourRate)} an hour`,
      variants: [], defaultVariantId: null, blocks: 1, durationMin: 120, durationLabel: 'About 1–2 hrs', tag: '', active: true
    },
    {
      id: 'ev', name: 'EV charger fitting',
      description: '7kW home charger supplied and fitted with commissioning certificate.',
      icon: 'plug-zap', priceType: 'from', price: 895, priceNote: 'Charger supplied and fitted',
      variants: [], defaultVariantId: null, blocks: 2, durationMin: 240, durationLabel: 'About half a day', tag: '', active: true
    },
    {
      id: 'rewire', name: 'Rewire survey',
      description: 'Free survey visit and a written quote within 48 hours.',
      icon: 'file-text', priceType: 'free', price: 0, priceNote: 'Free visit, written quote',
      variants: [], defaultVariantId: null, blocks: 1, durationMin: 120, durationLabel: 'About 45 mins', tag: '', active: true
    },
    {
      // Stored once at creation and never rendered by the UI, so a rebrand cannot leave a stale name on screen.
      id: 'emergency', name: 'Emergency visit',
      description: `Power out or something unsafe? Dan aims to be with you within ${emergencyHours} ${emergencyHours === 1 ? 'hour' : 'hours'}.`,
      icon: 'siren', priceType: 'from', price: PROMISES.emergencyFrom, priceNote: 'Includes the first hour',
      variants: [], defaultVariantId: null, blocks: 0, durationMin: 0, durationLabel: 'As soon as possible', tag: '', active: true, urgent: true
    }
  ];
}

/** A fresh, deep Settings object (7.3 and 3.1) on every call. Nothing is shared between calls. */
export function makeDefaultSettings() {
  return {
    business: {
      name: 'Voltmere Electrical',
      shortName: 'Voltmere',
      descriptor: 'Electrical',
      ownerFirstName: 'Dan',
      ownerFullName: 'Dan Mercer',
      tagline: 'Local electrician. Booked in 60 seconds.',
      phone: '07700 900412',
      email: 'dan@voltmere.example',
      areaName: 'Marlbury',
      areaText: 'Marlbury and 15 miles around',
      towns: ['Marlbury', 'Thornley Green', 'Hollin Cross', 'Wexby', 'Ashgrove'],
      coveredOutward: ['MB1', 'MB2', 'MB3', 'MB4', 'MB5', 'MB6', 'MB7', 'MB8', 'MB9', 'MB10'],
      edgeOutward: ['MB11', 'MB12', 'MB13'],
      schemeLine: 'Competent person scheme, reg. no. 000000 (sample)',
      insuranceLine: '£2m public liability cover (sample)'
    },
    // Index = JS weekday (0 Sunday). Value = open WindowIds.
    hours: [[], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1]],
    leadMinutes: 90,
    maxDaysAhead: 14,
    daysOff: [],
    fullDays: [],
    autoConfirm: true,
    takingEmergencies: true,
    remindersOn: true,
    services: makeServices(),
    templates: {},
    theme: 'auto',
    demoPhoneDigits: ''
  };
}
