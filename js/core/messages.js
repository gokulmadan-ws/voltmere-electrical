// js/core/messages.js: simulated WhatsApp templates, rendering, scheduled sends, bubble actions and links
// Owner: WP1
import {
  DEFAULT_TEMPLATES, EMERGENCY_REASONS, KIND_LABELS, PLACEHOLDERS, PROMISES, SITE_BASE_URL, WINDOWS
} from './config.js';
import { nowStamp } from './clock.js';
import { addDays, addMinutes, fmtClock, fmtDayShort, makeStamp, stampDay } from './dates.js';
import { bookingWindowIds, bookingWhen, nextFreeSlot } from './availability.js';
import { firstName, gbp, outwardCode, postcodeZone, toWaDigits } from './format.js';

// The defaults live in config.js (one definition); messages.js re-exports them because 8.1 lists them here.
export { DEFAULT_TEMPLATES, KIND_LABELS, PLACEHOLDERS };

const CERT_SERVICES = ['eicr', 'consumer', 'ev'];

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

function whenFor(booking) {
  return booking.urgent ? 'as soon as possible' : bookingWhen(booking);
}

function whenLongFor(booking) {
  if (booking.urgent) return 'as soon as possible';
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

/** Every placeholder of 10.2 as a string. `extra` = { oldWhen, newWhen, nextFree, reason, etaMinutes, at }. */
export function buildContext(booking, state, extra = {}) {
  const settings = state.settings;
  const biz = settings.business;
  const service = (settings.services || []).find((s) => s.id === booking.serviceId) || null;
  const addr = booking.address || { line1: '', postcode: '' };
  const cust = booking.customer || { name: '', phone: '' };
  const line1 = addr.line1 || addr.postcode || '';
  const when = whenFor(booking);
  const price = gbp(booking.quotedPrice);
  const finalPrice = gbp(booking.finalPrice === null || booking.finalPrice === undefined ? booking.quotedPrice : booking.finalPrice);
  const serviceFull = booking.variantLabel ? `${booking.serviceName} (${booking.variantLabel})` : booking.serviceName;
  const zone = postcodeZone(addr.postcode, biz);

  let priceLine = `From ${price}, pay after the job. I'll confirm before any extra work.`;
  if (service && service.priceType === 'free') priceLine = 'No charge for the visit.';
  else if (service && (service.priceType === 'fixed' || service.priceType === 'by_size')) priceLine = `Fixed price ${price}, pay after the job.`;

  const etaMinutes = extra.etaMinutes !== undefined && extra.etaMinutes !== null ? extra.etaMinutes : booking.etaMinutes;
  let etaAt = booking.etaAt || null;
  if (extra.etaMinutes !== undefined && extra.etaMinutes !== null) etaAt = addMinutes(extra.at || nowStamp(), extra.etaMinutes);

  let statusLine = 'Confirmed automatically.';
  if (booking.status === 'new') {
    const reason = zone === 'edge' || zone === 'outside' ? `outside your usual area (${outwardCode(addr.postcode)})` : 'auto-confirm is off';
    statusLine = `Needs your OK: ${reason}.`;
  }

  const reason = extra.reason !== undefined ? extra.reason : booking.cancelReason;
  const reasonLine = reason && reason !== 'declined' ? `Reason: ${String(reason).replace(/\.$/, '')}.` : '';

  const nextFree = nextFreeText(extra, booking, state);
  let nextFreeLine = nextFree ? `My next free visit is ${nextFree}.` : "Please call me and I'll find a time.";
  if (booking.urgent) nextFreeLine = `If anyone is in danger call 999, or ${PROMISES.powerCutNumber} for a power cut.`;

  const reasons = (booking.emergencyReasons || []).map((id) => {
    const r = EMERGENCY_REASONS.find((x) => x.id === id);
    return r ? r.label : id;
  });

  return {
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
    whenLong: whenLongFor(booking),
    serviceWhen: booking.urgent ? 'your emergency visit' : `${booking.serviceName} on ${when}`,
    dateShort: fmtDayShort(stampDay(booking.start)),
    arrive: booking.urgent || bookingWindowIds(booking).length === 0 ? 'as soon as possible' : WINDOWS[bookingWindowIds(booking)[0]].arrive,
    line1,
    postcode: addr.postcode || '',
    address: addr.line1 ? `${addr.line1}, ${addr.postcode}` : addr.postcode || '',
    noteLine: booking.notes ? `Note: "${booking.notes}"` : '',
    statusLine,
    emergencyList: reasons.join(', '),
    etaMinutes: etaMinutes === null || etaMinutes === undefined ? '' : String(etaMinutes),
    etaText: etaMinutes === null || etaMinutes === undefined ? '' : etaTextFor(etaMinutes),
    etaClock: etaAt ? fmtClock(etaAt) : '',
    oldWhen: extra.oldWhen || '',
    newWhen: extra.newWhen || when,
    reasonLine,
    receivedReason: zone === 'edge' || zone === 'outside' ? `I just need to check travel to ${addr.postcode}.` : '',
    nextFree,
    nextFreeLine,
    finalLine: booking.paid ? `Paid with thanks, ${finalPrice}.` : `The total is ${finalPrice}, payable by card, bank transfer or cash.`,
    certLine: CERT_SERVICES.includes(booking.serviceId) ? 'Your certificate follows today.' : '',
    jobLink: `${SITE_BASE_URL}dashboard.html#/bookings/${booking.id}`,
    manageLink: `${SITE_BASE_URL}index.html#manage/${booking.ref}`,
    reviewLink: `${emailDomain(biz)}/review (sample link)`,
    awayMinutes: String(PROMISES.awayMinutes),
    emergencyReplyMinutes: String(PROMISES.emergencyReplyMinutes),
    emergencyCallAfterMinutes: String(PROMISES.emergencyCallAfterMinutes),
    powerCutNumber: PROMISES.powerCutNumber
  };
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
  // An urgent request may have no street: search the postcode alone rather than ', MB2 6JN'.
  const query = [line1, postcode].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
