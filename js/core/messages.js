// js/core/messages.js: simulated WhatsApp templates, rendering, scheduled sends, bubble actions and links
// Owner: WP1
import {
  DEFAULT_TEMPLATES, EMERGENCY_REASONS, KIND_LABELS, PLACEHOLDERS, PROMISES, SITE_BASE_URL, WINDOWS, answersLine
} from './config.js';
import { nowStamp } from './clock.js';
import { addDays, addMinutes, fmtClock, fmtDayShort, makeStamp, stampDay } from './dates.js';
import { bookingWindowIds, bookingWhen, isUnscheduled, nextFreeSlot } from './availability.js';
import { addressLine, firstName, gbp, outwardCode, postcodeZone, toWaDigits } from './format.js';

// The defaults live in config.js (one definition); messages.js re-exports them because 8.1 lists them here.
export { DEFAULT_TEMPLATES, KIND_LABELS, PLACEHOLDERS };

// The paperwork sentence per service: a certificate for certificate jobs, a written quote after a quote visit.
const PAPERWORK_LINES = {
  eicr: 'Your certificate follows today.',
  consumer: 'Your certificate follows today.',
  ev: 'Your installation certificate follows today.',
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
  return isUnscheduled(booking) ? TO_BE_ARRANGED : bookingWhen(booking);
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

// The body of customer_received. For the free survey it says: pencilled in, provisional, and the 24 hour promise.
function receivedLineFor(booking, biz, ctx) {
  const hours = ctx.contactHours;
  const travel = ctx.receivedReason ? ` ${ctx.receivedReason}` : '';
  if (booking.serviceId === 'ev_quote') {
    if (booking.tentative && !isUnscheduled(booking)) {
      return `Your free survey visit is pencilled in for ${ctx.when}. This is provisional, so please do not plan around it yet. ${biz.ownerFirstName} will be in touch within ${hours} hours to confirm it.${travel}`;
    }
    return `${biz.ownerFirstName} will be in touch within ${hours} hours to arrange your free survey visit.${travel}`;
  }
  return `We have your request for ${ctx.serviceFull}, ${ctx.when}.${travel} ${biz.ownerFirstName} will confirm shortly.`;
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

  let priceLine = `From ${price}, pay after the job. I'll confirm before any extra work.`;
  if (service && service.priceType === 'free') priceLine = 'No charge for the visit.';
  else if (service && (service.priceType === 'fixed' || service.priceType === 'by_size')) priceLine = `Fixed price ${price}, pay after the job.`;
  else if (quotedType) priceLine = 'The price is as per your agreed quote, payable after the install.';

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
    contactHours: String(PROMISES.contactWithinHours),
    nextFree,
    nextFreeLine,
    finalLine: booking.paid
      ? `Paid with thanks, ${finalPrice}.`
      : isFree && !booking.finalPrice ? 'No charge for the visit.' : `The total is ${finalPrice}, payable by card, bank transfer or cash.`,
    certLine: PAPERWORK_LINES[booking.serviceId] || '',
    jobLink: `${SITE_BASE_URL}dashboard.html#/bookings/${booking.id}`,
    manageLink: `${SITE_BASE_URL}index.html#manage/${booking.ref}`,
    reviewLink: `${emailDomain(biz)}/review (sample link)`,
    awayMinutes: String(PROMISES.awayMinutes),
    emergencyReplyMinutes: String(PROMISES.emergencyReplyMinutes),
    emergencyCallAfterMinutes: String(PROMISES.emergencyCallAfterMinutes),
    powerCutNumber: PROMISES.powerCutNumber
  };
  ctx.receivedLine = receivedLineFor(booking, biz, ctx);
  return ctx;
}

/**
 * PURE: the Message for `kind` WITHOUT id and seq (the store adds those).
 * A template typo must never block a booking, so an unknown placeholder is blanked with a console.warn.
 */
export function buildMessage(kind, booking, state, extra = {}) {
  const biz = state.settings.business;
  const template = (state.settings.templates && state.settings.templates[kind]) || DEFAULT_TEMPLATES[kind];
  const ctx = buildContext(booking, state, extra);
  const body = renderWith(template, ctx, (name) => {
    console.warn(`Unknown message placeholder {${name}} in template ${kind}`);
    return '';
  });
  const toOwner = kind.startsWith('owner_');
  return {
    at: extra.at || nowStamp(),
    sendAt: extra.sendAt === undefined ? null : extra.sendAt,
    bookingId: booking.id,
    to: toOwner ? 'owner' : 'customer',
    toName: toOwner ? biz.ownerFullName : booking.customer.name,
    toPhone: toOwner ? biz.phone : booking.customer.phone,
    channel: 'whatsapp',
    kind,
    body,
    simulated: true,
    seed: false
  };
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
      return booking.status === 'new' ? [{ id: 'confirm', label: 'Confirm' }, call, openJob] : [openJob, call];
    case 'owner_emergency':
      return booking.status === 'new' ? [{ id: 'accept_45', label: 'Accept (45 min)' }, call, openJob] : [openJob, call];
    case 'owner_customer_cancelled':
    case 'owner_customer_rescheduled':
      return [openJob];
    default:
      return [];
  }
}

// ---------- links: the ONLY place wa.me, tel:, sms:, mailto: and maps URLs are built ----------

export function waShareLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function waLink(phone, text, demoPhoneDigits = '') {
  return `https://wa.me/${demoPhoneDigits || toWaDigits(phone)}?text=${encodeURIComponent(text)}`;
}

export function telLink(phone) {
  return `tel:+${toWaDigits(phone)}`;
}

export function smsLink(phone) {
  return `sms:+${toWaDigits(phone)}`;
}

export function mailtoLink(email, subject = '', body = '') {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function mapsLink(line1, postcode) {
  // An urgent request may have no street: search the postcode alone rather than ', BT9 6QP'.
  const query = [line1, postcode].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
