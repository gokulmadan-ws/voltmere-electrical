// js/core/messages.js: simulated WhatsApp and email templates, rendering, scheduled sends, bubble actions and links
// Owner: WP1 (v1), A3 (v3 additions)
import {
  DEFAULT_TEMPLATES, DEFAULT_UNSCHEDULED_TEMPLATES, EMERGENCY_REASONS, KIND_LABELS, PLACEHOLDERS, PROMISES, SITE_BASE_URL, WINDOWS, answersLine, makeDefaultBusiness
} from './config.js';
import { nowStamp } from './clock.js';
import { addDays, addMinutes, fmtClock, fmtDayShort, makeStamp, stampDay } from './dates.js';
import { bookingWindowIds, bookingWhenArrival, isUnscheduled, nextFreeSlot } from './availability.js';
import { addressLine, firstName, gbp, outwardCode, postcodeZone, safeEncode, toWaDigits } from './format.js';
import { latestQuoteFor, quoteShareUrl, quoteTotal, quoteUrl } from './quotes.js';
import {
  buildAcceptancePayload, buildDeclinePayload, buildEnquiryPayload, acceptanceWhatsAppText, dashboardImportLink, declineWhatsAppText, encodePayload,
  enquiryWhatsAppText, quoteLink
} from './handoff.js';

// The defaults live in config.js (one definition); messages.js re-exports them because 8.1 lists them here.
export { DEFAULT_TEMPLATES, KIND_LABELS, PLACEHOLDERS, quoteShareUrl, quoteUrl };

// The paperwork sentence per service: a written quote after a quote visit. His site says nothing about certificates or paperwork, so the default
// messages promise none (the owner can add his own wording in Settings).
const PAPERWORK_LINES = {
  eicr: '',
  consumer: '',
  ev: '',
  ev_quote: 'Your written quote follows shortly.'
};

// ---------- rendering ----------

function renderWith(text, ctx, onUnknown) {
  const filled = String(text).replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(ctx, name)) return String(ctx[name]);
    return onUnknown(name);
  });
  return filled
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** Fill {placeholders}, trim each line, collapse spaces, drop empty lines. An unknown placeholder throws. */
export function renderTemplate(text, ctx) {
  return renderWith(text, ctx, (name) => {
    throw new Error(`Unknown message placeholder {${name}}`);
  });
}

// ---------- context ----------

function etaTextFor(minutes) {
  if (minutes === 60) return '1 hour';
  if (minutes === 120) return '2 hours';
  return `${minutes} minutes`;
}

const TO_BE_ARRANGED = 'a time to be arranged';

function whenFor(booking) {
  if (booking.urgent) return 'as soon as possible';
  return isUnscheduled(booking) ? TO_BE_ARRANGED : bookingWhenArrival(booking);
}

function whenLongFor(booking) {
  if (booking.urgent) return 'as soon as possible';
  if (isUnscheduled(booking)) return TO_BE_ARRANGED;
  const ids = bookingWindowIds(booking);
  const day = fmtDayShort(stampDay(booking.start));
  if (ids.length === 0) return day;
  const arrive = WINDOWS[ids[0]].arrive;
  if (ids.length === 1) return `${day}, arriving ${arrive}`;
  return `${day}, ${ids[0] === 0 ? 'morning' : 'afternoon'}, arriving ${arrive}`;
}

function emailDomain(business) {
  const email = String((business && business.email) || '');
  const at = email.lastIndexOf('@');
  return at >= 0 && at < email.length - 1 ? email.slice(at + 1).trim() : 'prototype.invalid';
}

function nextFreeText(extra, booking, state) {
  if (extra.nextFree) return typeof extra.nextFree === 'string' ? extra.nextFree : extra.nextFree.human || '';
  if (booking.urgent) return '';
  const slot = nextFreeSlot(state, booking.serviceId);
  return slot ? slot.human : '';
}

// The owner alert's status line: what he has to do about it.
function statusLineFor(booking, zone, outward) {
  if (booking.status !== 'new') return 'Confirmed automatically.';
  const outside = zone === 'edge' || zone === 'outside';
  if (booking.serviceId === 'ev_quote') {
    if (outside) return `Outside Northern Ireland (${outward}). Check you can travel before you confirm the survey.`;
    if (booking.tentative) return 'Needs you: review the enquiry, then confirm the pencilled-in survey.';
    return 'Needs you: review the enquiry and arrange the survey.';
  }
  const reason = outside ? `outside your usual area (${outward})` : 'auto-confirm is off';
  return `Needs your OK: ${reason}.`;
}

// The body of customer_received. For the enquiry it is his own promise (he will be in touch within 24 hours to discuss the installation) and, when the
// diary has a suggested visit, the earliest one he could offer: ONE status, "he will confirm" (never "pencilled" or "provisional", and never a promise
// of a time from the system).
function receivedLineFor(booking, biz, ctx) {
  const hours = ctx.contactHours;
  const travel = ctx.receivedReason ? ` ${ctx.receivedReason}` : '';
  if (booking.serviceId === 'ev_quote') {
    if (booking.tentative && !isUnscheduled(booking)) {
      return `Earliest visit ${biz.ownerFirstName} could offer: ${ctx.when}. ${biz.ownerFirstName} will confirm within ${hours} hours.${travel}`;
    }
    return `${biz.ownerFirstName} will be in touch within ${hours} hours to discuss your installation.${travel}`;
  }
  return `We have your request for ${ctx.serviceFull}, ${ctx.when}.${travel} ${biz.ownerFirstName} will confirm shortly.`;
}

// The enquiry a quote hangs on (it holds the ref and the installation postcode a quote link carries), else the booking the message is about.
function quoteEnquiry(quote, booking, state) {
  return (state.bookings || []).find((b) => b.id === quote.bookingId) || booking;
}

/** Every placeholder of 10.2 as a string. `extra` = { oldWhen, newWhen, nextFree, reason, etaMinutes, at }. */
export function buildContext(booking, state, extra = {}) {
  const settings = state.settings;
  const biz = settings.business;
  const service = (settings.services || []).find((s) => s.id === booking.serviceId) || null;
  const addr = booking.address || { line1: '', postcode: '' };
  const cust = booking.customer || { name: '', phone: '' };
  const line1 = addr.line1 || addr.postcode || '';
  const when = whenFor(booking);
  const isEnquiry = booking.serviceId === 'ev_quote';
  const isFree = !!service && service.priceType === 'free';
  const quotedType = !!service && service.priceType === 'quoted';
  const price = isFree && !booking.quotedPrice ? 'Free' : quotedType && !booking.quotedPrice ? 'Quoted for your home' : gbp(booking.quotedPrice);
  const finalPrice = gbp(booking.finalPrice === null || booking.finalPrice === undefined ? booking.quotedPrice : booking.finalPrice);
  const serviceFull = booking.variantLabel ? `${booking.serviceName} (${booking.variantLabel})` : booking.serviceName;
  const zone = postcodeZone(addr.postcode, biz);

  // No payment terms here: his site states none, so the default messages add none (the owner can write his own in Settings).
  let priceLine = `From ${price}.`;
  if (service && service.priceType === 'free') priceLine = 'No charge for the visit.';
  else if (service && (service.priceType === 'fixed' || service.priceType === 'by_size')) priceLine = `Fixed price ${price}.`;
  else if (quotedType) priceLine = 'The price is as per your agreed quote.';

  const etaMinutes = extra.etaMinutes !== undefined && extra.etaMinutes !== null ? extra.etaMinutes : booking.etaMinutes;
  let etaAt = booking.etaAt || null;
  if (extra.etaMinutes !== undefined && extra.etaMinutes !== null) etaAt = addMinutes(extra.at || nowStamp(), extra.etaMinutes);

  const reason = extra.reason !== undefined ? extra.reason : booking.cancelReason;
  const reasonLine = reason && reason !== 'declined' ? `Reason: ${String(reason).replace(/\.$/, '')}.` : '';

  const nextFree = nextFreeText(extra, booking, state);
  let nextFreeLine = nextFree ? `My next free visit is ${nextFree}.` : "Please call me and I'll find a time.";
  if (booking.urgent) nextFreeLine = `If anyone is in danger call 999, or ${PROMISES.powerCutNumber} for a power cut.`;

  const reasons = (booking.emergencyReasons || []).map((id) => {
    const r = EMERGENCY_REASONS.find((x) => x.id === id);
    return r ? r.label : id;
  });

  // The quote this message is about: the one passed in, else the quote an install booking came from, else the enquiry's latest.
  const quotes = state.quotes || {};
  const quote = extra.quote || (booking.quoteId && quotes[booking.quoteId]) || latestQuoteFor(quotes, booking.id);
  let installBooking = extra.installBooking || null;
  if (!installBooking && booking.serviceId === 'ev' && booking.quoteId) installBooking = booking;
  if (!installBooking && quote && quote.installBookingId) installBooking = (state.bookings || []).find((b) => b.id === quote.installBookingId) || null;

  const whenLong = whenLongFor(booking);
  let whenLine = whenLong;
  if (isEnquiry && !booking.urgent) {
    if (isUnscheduled(booking)) whenLine = 'Survey: time to be arranged';
    else whenLine = booking.tentative ? `Survey pencilled in: ${whenLong} (provisional)` : `Survey: ${whenLong}`;
  }

  let serviceWhen = `${booking.serviceName} on ${when}`;
  if (booking.urgent) serviceWhen = 'your emergency visit';
  else if (isEnquiry) serviceWhen = isUnscheduled(booking) ? 'the free survey visit' : `the free survey visit on ${when}`;

  const ctx = {
    ref: booking.ref,
    customerName: cust.name,
    customerFirst: firstName(cust.name),
    customerPhone: cust.phone,
    ownerFirst: biz.ownerFirstName,
    business: biz.name,
    businessShort: biz.shortName,
    ownerPhone: biz.phone,
    service: booking.serviceName,
    serviceFull,
    price,
    finalPrice,
    priceLine,
    when,
    whenLong,
    whenLine,
    serviceWhen,
    dateShort: fmtDayShort(stampDay(booking.start)),
    arrive: booking.urgent || bookingWindowIds(booking).length === 0 ? 'as soon as possible' : WINDOWS[bookingWindowIds(booking)[0]].arrive,
    line1,
    postcode: addr.postcode || '',
    address: addressLine(addr),
    noteLine: booking.notes ? `Note: "${booking.notes}"` : '',
    statusLine: statusLineFor(booking, zone, outwardCode(addr.postcode)),
    alertTitle: isEnquiry ? 'New enquiry' : 'New booking',
    answersLine: answersLine(booking.answers),
    emergencyList: reasons.join(', '),
    etaMinutes: etaMinutes === null || etaMinutes === undefined ? '' : String(etaMinutes),
    etaText: etaMinutes === null || etaMinutes === undefined ? '' : etaTextFor(etaMinutes),
    etaClock: etaAt ? fmtClock(etaAt) : '',
    oldWhen: extra.oldWhen || '',
    newWhen: extra.newWhen || when,
    reasonLine,
    receivedReason: zone === 'edge' || zone === 'outside' ? `We just need to check travel to ${addr.postcode}.` : '',
    receivedLine: '',
    contactHours: String(settings.sla && Number.isInteger(settings.sla.replyHours) ? settings.sla.replyHours : PROMISES.contactWithinHours),
    nextFree,
    nextFreeLine,
    finalLine: booking.paid
      ? `Paid with thanks, ${finalPrice}.`
      : isFree && !booking.finalPrice ? 'No charge for the visit.' : `The total is ${finalPrice}.`,
    certLine: PAPERWORK_LINES[booking.serviceId] || '',
    jobLink: `${SITE_BASE_URL}dashboard.html#/bookings/${booking.id}`,
    manageLink: `${SITE_BASE_URL}index.html#manage/${booking.ref}`,
    reviewLink: `${emailDomain(biz)}/review (sample link)`,
    awayMinutes: String(PROMISES.awayMinutes),
    emergencyReplyMinutes: String(PROMISES.emergencyReplyMinutes),
    emergencyCallAfterMinutes: String(PROMISES.emergencyCallAfterMinutes),
    powerCutNumber: PROMISES.powerCutNumber,
    quoteId: quote ? quote.id : '',
    quoteLink: quote ? quoteLink(quote, { booking: quoteEnquiry(quote, booking, state) }) : '',
    quoteTotal: quote ? gbp(quoteTotal(quote)) : '',
    quoteValidUntil: quote && quote.validUntil ? fmtDayShort(quote.validUntil) : '',
    installWhen: installBooking ? (isUnscheduled(installBooking) ? 'a day to be agreed' : whenLongFor(installBooking)) : ''
  };
  ctx.receivedLine = receivedLineFor(booking, biz, ctx);
  return ctx;
}

// The owner's own template wins. Otherwise the default, except for an accepted install that has no day yet (a WhatsApp acceptance): that
// one has its own wording (DEFAULT_UNSCHEDULED_TEMPLATES).
function templateFor(kind, booking, state, extra) {
  const custom = state.settings.templates && state.settings.templates[kind];
  if (custom) return custom;
  if (DEFAULT_UNSCHEDULED_TEMPLATES[kind] && isUnscheduled(extra.installBooking || booking)) return DEFAULT_UNSCHEDULED_TEMPLATES[kind];
  // A booking that is being given its first day (bookingWhenArrival says 'To be arranged' for it) is not "moved from" anything.
  if (kind === 'customer_rescheduled' && extra && extra.oldWhen === 'To be arranged') return DEFAULT_UNSCHEDULED_TEMPLATES.customer_rescheduled;
  return DEFAULT_TEMPLATES[kind];
}

/**
 * The heading of an owner alert row (the stored message gets it as `title`, see store.addMessage and the seed; buildMessage keeps the v2 shape),
 * so a list of alerts says WHICH enquiry each one is: 'New enquiry: Sinead D, BT42' (a free survey enquiry)
 * or 'New booking: Niamh G, BT23'. First name, the initial of the surname and the outward half of the postcode.
 */
export function alertHeading(booking) {
  const words = String((booking.customer && booking.customer.name) || '').trim().split(/\s+/).filter(Boolean);
  const who = words.length > 1 ? `${words[0]} ${words[words.length - 1][0].toUpperCase()}` : (words[0] || '');
  const outward = outwardCode(booking.address && booking.address.postcode);
  const lead = booking.serviceId === 'ev_quote' && !booking.urgent ? 'New enquiry' : 'New booking';
  const tail = [who, outward].filter(Boolean).join(', ');
  return tail ? `${lead}: ${tail}` : lead;
}

/**
 * PURE: the Message for `kind` WITHOUT id and seq (the store adds those).
 * A template typo must never block a booking, so an unknown placeholder is blanked with a console.warn.
 */
export function buildMessage(kind, booking, state, extra = {}) {
  const biz = state.settings.business;
  const template = templateFor(kind, booking, state, extra);
  const ctx = buildContext(booking, state, extra);
  const body = renderWith(template, ctx, (name) => {
    console.warn(`Unknown message placeholder {${name}} in template ${kind}`);
    return '';
  });
  const toOwner = kind.startsWith('owner_');
  const channel = extra.channel === 'email' ? 'email' : 'whatsapp';
  const message = {
    at: extra.at || nowStamp(),
    sendAt: extra.sendAt === undefined ? null : extra.sendAt,
    bookingId: booking.id,
    to: toOwner ? 'owner' : 'customer',
    toName: toOwner ? biz.ownerFullName : booking.customer.name,
    toPhone: toOwner ? biz.phone : booking.customer.phone,
    channel,
    kind,
    body,
    simulated: true,
    seed: false
  };
  // Only an email message carries an address (a WhatsApp message keeps the v2 shape).
  if (channel === 'email') message.toEmail = toOwner ? biz.email : (booking.customer.email || '');
  return message;
}

/**
 * PURE: a message that belongs to no booking (a connection test). Same shape as buildMessage with `bookingId: null`.
 * `extra` = { at, channel: 'whatsapp'|'email', toEmail }.
 */
export function buildSystemMessage(kind, state, extra = {}) {
  const biz = state.settings.business;
  const template = (state.settings.templates && state.settings.templates[kind]) || DEFAULT_TEMPLATES[kind];
  const ctx = { business: biz.name, businessShort: biz.shortName, ownerFirst: biz.ownerFirstName, ownerPhone: biz.phone };
  const body = renderWith(template, ctx, (name) => {
    console.warn(`Unknown message placeholder {${name}} in template ${kind}`);
    return '';
  });
  const channel = extra.channel === 'email' ? 'email' : 'whatsapp';
  const message = {
    at: extra.at || nowStamp(),
    sendAt: null,
    bookingId: null,
    to: 'owner',
    toName: biz.ownerFullName,
    toPhone: biz.phone,
    channel,
    kind,
    body,
    simulated: true,
    seed: false
  };
  if (channel === 'email') message.toEmail = extra.toEmail || biz.email;
  return message;
}

// ---------- scheduling ----------

/**
 * When the day-before reminder goes: 18:00 the evening before, else 07:00 on the day, else null.
 * Pure: it does not look at settings.remindersOn (the store checks that).
 */
export function reminderSendAt(booking, createdStamp) {
  const day = stampDay(booking.start);
  const hour = String(PROMISES.reminderHour).padStart(2, '0');
  const evening = makeStamp(addDays(day, -1), `${hour}:00`);
  if (evening > createdStamp) return evening;
  const morning = makeStamp(day, '07:00');
  return morning > createdStamp ? morning : null;
}

/** Sent versus Scheduled is derived at render time; there are no timers. */
export function messageIsScheduled(msg, nowStampStr) {
  return msg.sendAt !== null && msg.sendAt !== undefined && msg.sendAt > nowStampStr;
}

// ---------- bubble actions (10.6) ----------

/** Quick-reply buttons for a simulated bubble, from the message kind and the LIVE booking status. */
// `nowStampStr` is part of the contract signature; the buttons depend only on the live status.
export function bubbleActions(message, booking, nowStampStr) {
  if (!booking) return [];
  const callLabel = `Call ${firstName(booking.customer.name)}`;
  const call = { id: 'call', label: callLabel };
  const openJob = { id: 'open_job', label: 'Open job' };
  switch (message.kind) {
    case 'owner_new_booking':
    case 'owner_quote_accepted':
      // A booking with no day yet (the diary was full, or a WhatsApp acceptance that only said which days suit) cannot be confirmed from here:
      // confirmBooking refuses it, so the button is Open job (place it in the diary there).
      return booking.status === 'new' && !isUnscheduled(booking) ? [{ id: 'confirm', label: 'Confirm' }, call, openJob] : [openJob, call];
    case 'owner_emergency':
      return booking.status === 'new' ? [{ id: 'accept_45', label: 'Accept (45 min)' }, call, openJob] : [openJob, call];
    case 'owner_customer_cancelled':
    case 'owner_customer_rescheduled':
    case 'owner_quote_declined':
      return [openJob];
    default:
      return [];
  }
}

// ---------- links: the ONLY place wa.me, tel:, sms:, mailto: and maps URLs are built ----------

export function waShareLink(text) {
  return `https://wa.me/?text=${safeEncode(text)}`;
}

export function waLink(phone, text, demoPhoneDigits = '') {
  return `https://wa.me/${demoPhoneDigits || toWaDigits(phone)}?text=${safeEncode(text)}`;
}

export function telLink(phone) {
  return `tel:+${toWaDigits(phone)}`;
}

export function smsLink(phone) {
  return `sms:+${toWaDigits(phone)}`;
}

export function mailtoLink(email, subject = '', body = '') {
  return `mailto:${email}?subject=${safeEncode(subject)}&body=${safeEncode(body)}`;
}

export function mapsLink(line1, postcode) {
  // An urgent request may have no street: search the postcode alone rather than ', BT9 6QP'.
  const query = [line1, postcode].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${safeEncode(query)}`;
}

// ---------- v4: the handoff links (the customer or the owner taps send in their own WhatsApp; docs/V4-API.md) ----------

/** https://wa.me/<digits>?text=<text> to the business number of `state` (settings.business.phone, or the demo phone when one is set). */
export function ownerWhatsAppUrl(state, text) {
  const settings = state && state.settings ? state.settings : {};
  const biz = settings.business || {};
  return waLink(biz.phone || makeDefaultBusiness().phone, String(text === undefined || text === null ? '' : text), settings.demoPhoneDigits || '');
}

function handoffFor(kind, payload, textFor, state) {
  if (!payload) return { ok: false, reason: 'cannot_carry' };
  const encoded = encodePayload(payload);
  const link = dashboardImportLink(encoded);
  const biz = state && state.settings ? state.settings.business : undefined;
  const text = textFor(link, biz);
  if (!encoded || !link || !text) return { ok: false, reason: 'cannot_carry' };
  return { ok: true, kind, payload, encoded, link, text, url: ownerWhatsAppUrl(state, text), chars: encoded.length };
}

// A wa.me link carries the whole message in its address, and an address over about 2,000 characters is cut or refused by some phones, browsers and
// messengers. A customer's own words are the only part of a handoff that can be long (and each accented, emoji or combining character costs up to nine
// characters once encoded), so when the link would be too long the notes are cut back (never the link at the end of the message).
export const WA_URL_BUDGET = 1950;
const cutText = (text, keep) => Array.from(String(text || '')).slice(0, Math.max(0, keep)).join('').trim();

/** Build with the notes at full length, then at a half, a quarter... until the wa.me URL fits (or the notes are gone). */
function fitHandoff(build, notes) {
  const full = String(notes === undefined || notes === null ? '' : notes);
  let out = build(full);
  let keep = Array.from(full).length;
  while (out.ok && out.url.length > WA_URL_BUDGET && keep > 0) {
    keep = Math.floor(keep / 2);
    out = build(cutText(full, keep));
  }
  return out;
}

/** The customer's "Send my enquiry to Daniel on WhatsApp": { ok, kind: 'enq', payload, encoded, link, text, url, chars } for a stored enquiry booking. */
export function enquiryHandoff(booking, state) {
  return fitHandoff((notes) => {
    const b = notes === (booking && booking.notes) ? booking : { ...booking, notes };
    return handoffFor('enq', buildEnquiryPayload(b), (link, business) => enquiryWhatsAppText(b, { link, business }), state);
  }, booking && booking.notes);
}

/** The customer's "Accept quote" message to Daniel. `quote` is a stored Quote or the data of parseQuoteLink. */
export function acceptanceHandoff(input, state) {
  return fitHandoff((note) => {
    const i = note === (input && input.note) ? input : { ...input, note };
    return handoffFor('acc', buildAcceptancePayload(i), (link, business) => acceptanceWhatsAppText(i, { link, business }), state);
  }, input && input.note);
}

/** The customer's "Not for me" message to Daniel. */
export function declineHandoff(input, state) {
  return fitHandoff((note) => {
    const i = note === (input && input.note) ? input : { ...input, note };
    return handoffFor('dec', buildDeclinePayload(i), (link, business) => declineWhatsAppText(i, { link, business }), state);
  }, input && input.note);
}
