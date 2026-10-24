// js/core/seed.js: the relative demo diary (S01 to S15), seeded customers, sample customer and simulator pool
// Owner: WP1
import { WINDOWS, makeDefaultSettings } from './config.js';
import { addDays, addMinutes, makeStamp, stampDay, toStamp, weekdayOf } from './dates.js';
import { bookingWindowIds } from './availability.js';
import { buildMessage, reminderSendAt } from './messages.js';
import { postcodeZone } from './format.js';
import { quotedPriceFor } from './selectors.js';

// ---------- fictional people (3.2: phones are Ofcom drama numbers 07700 900xxx) ----------

export const SEED_CUSTOMERS = {
  priya: { name: 'Priya Nair', phone: '07700 900231', email: '', addresses: [{ line1: '14 Alder Row', postcode: 'MB3 4QP' }] },
  marcus: {
    name: 'Marcus Tate', phone: '07700 900262', email: '',
    addresses: [{ line1: '8 Quarry Lane', postcode: 'MB5 2LN' }, { line1: '31 Hollin Road', postcode: 'MB6 7DZ' }]
  },
  alison: { name: 'Alison Reeve', phone: '07700 900275', email: '', addresses: [{ line1: '22 Fennel Road', postcode: 'MB8 1HT' }] },
  tom: { name: 'Tom Hargreaves', phone: '07700 900288', email: '', addresses: [{ line1: '3 Weavers Yard', postcode: 'MB2 9AQ' }] },
  eileen: { name: 'Eileen Doyle', phone: '07700 900301', email: '', addresses: [{ line1: '17 Kiln Lane', postcode: 'MB4 3RF' }] },
  ngozi: { name: 'Ngozi Okafor', phone: '07700 900344', email: '', addresses: [{ line1: '9 Orchard Close', postcode: 'MB2 6JN' }] },
  hannah: { name: 'Hannah Whitfield', phone: '07700 900356', email: '', addresses: [{ line1: '2 Linnet Close', postcode: 'MB1 8PY' }] },
  kwame: { name: 'Kwame Mensah', phone: '07700 900371', email: '', addresses: [{ line1: '12 Cobb Street', postcode: 'MB9 3UE' }] },
  ruth: { name: 'Ruth Calder', phone: '07700 900388', email: '', addresses: [{ line1: '6 Harrow Mews', postcode: 'MB10 4XJ' }] },
  // Edge zone (MB12): the booking needs Dan's OK.
  sam: { name: 'Sam Wray', phone: '07700 900219', email: '', addresses: [{ line1: 'Mill Cottage, Ashgrove Lane', postcode: 'MB12 6AB' }] },
  lena: { name: 'Lena Kowalski', phone: '07700 900399', email: '', addresses: [{ line1: '27 Alder Row', postcode: 'MB3 5TT' }] }
};

/** What the `Demo: fill sample details` button types in. */
export const SAMPLE_CUSTOMER = { name: 'Priya Nair', phone: '07700 900231', email: '', line1: '14 Alder Row', postcode: 'MB3 4QP' };

/** Eight invented website customers for simulateIncomingBooking (phones 07700 900500 to 900507). */
export const SIM_POOL = [
  { name: 'Gareth Pryce', phone: '07700 900500', line1: '5 Cooper Street', postcode: 'MB4 7LW', notes: 'Fuse box trips when the kettle is on.' },
  { name: 'Fatima Rahman', phone: '07700 900501', line1: '41 Willow Bank', postcode: 'MB7 2HD', notes: '' },
  { name: 'Callum Blair', phone: '07700 900502', line1: '16 Mason Road', postcode: 'MB1 4TT', notes: 'Dog is friendly, side gate is open.' },
  { name: 'Joanna Pike', phone: '07700 900503', line1: '8 Tanners Lane', postcode: 'MB9 6QA', notes: 'Outside light has stopped working.' },
  { name: 'Dev Patel', phone: '07700 900504', line1: '23 Beacon Rise', postcode: 'MB5 8FS', notes: '' },
  { name: 'Maureen Holt', phone: '07700 900505', line1: '2 Chapel Yard', postcode: 'MB2 3ZP', notes: 'Please park on the drive.' },
  { name: 'Owen Lister', phone: '07700 900506', line1: '70 Quarry Hill', postcode: 'MB8 5NG', notes: 'Sockets in the spare room are dead.' },
  { name: 'Chloe Barrett', phone: '07700 900507', line1: '12 Ferry Lane', postcode: 'MB10 1RT', notes: '' }
];

// ---------- the 15 seeded bookings (3.4) ----------

// ref: 'T' today, 'P<k>' k-th previous open day, 'O<k>' k-th next open day. win = preferred start window.
// status 'today' means: done once its window has ended, else confirmed.
const SPECS = [
  { n: 1, day: 'P17', win: 0, blocks: 1, service: 'fault', cust: 'priya', status: 'done', final: 75, paid: 'card', source: 'website', notes: 'Fuse box keeps tripping in the evening.' },
  { n: 2, day: 'P14', win: 2, blocks: 2, service: 'eicr', variant: 'flat', cust: 'marcus', addr: 0, status: 'done', final: 150, paid: 'bank', source: 'phone', notes: 'Landlord. Flat above the shop, new tenant moving in.' },
  { n: 3, day: 'P11', win: 0, blocks: 2, service: 'consumer', cust: 'alison', status: 'done', final: 540, paid: 'card', source: 'website', notes: 'Old fuse box, no RCD.' },
  { n: 4, day: 'P6', win: 1, blocks: 1, service: 'sockets', cust: 'ruth', status: 'done', final: 170, paid: null, source: 'whatsapp', notes: 'Two sockets in the kitchen and one outside.' },
  { n: 5, day: 'T', win: 0, blocks: 1, service: 'sockets', cust: 'tom', status: 'today', final: 85, paid: 'cash', source: 'website', notes: 'Extra sockets in the back bedroom.' },
  { n: 6, day: 'T', win: 1, blocks: 1, service: 'fault', cust: 'eileen', status: 'today', final: 75, paid: null, source: 'phone', notes: '' },
  { n: 7, day: 'T', win: null, blocks: 0, service: 'emergency', cust: 'ngozi', status: 'new', urgent: true, source: 'website', notes: 'No power in kitchen' },
  { n: 8, day: 'O1', win: 1, blocks: 1, service: 'fault', cust: 'hannah', status: 'confirmed', source: 'website', notes: 'Lights flicker when the oven is on.' },
  { n: 9, day: 'O2', win: 2, blocks: 2, service: 'eicr', variant: 'house', cust: 'marcus', addr: 1, status: 'confirmed', source: 'phone', notes: 'Landlord. Tenant leaves at the end of the month.' },
  { n: 10, day: 'O3', win: 0, blocks: 1, service: 'fault', cust: 'alison', status: 'confirmed', source: 'website', notes: 'Outside light has stopped working.' },
  { n: 11, day: 'O3', win: 1, blocks: 1, service: 'sockets', cust: 'sam', status: 'new', source: 'website', notes: 'Barn conversion. Park by the gate.' },
  { n: 12, day: 'O3', win: 2, blocks: 1, service: 'fault', cust: 'ruth', status: 'confirmed', source: 'whatsapp', notes: '' },
  { n: 13, day: 'O3', win: 3, blocks: 1, service: 'sockets', cust: 'tom', status: 'confirmed', source: 'website', notes: 'Two double sockets in the lounge.' },
  { n: 14, day: 'O5', win: 0, blocks: 1, service: 'sockets', cust: 'kwame', status: 'confirmed', source: 'referral', notes: 'Garage sockets.' },
  { n: 15, day: 'O6', win: 1, blocks: 1, service: 'fault', cust: 'lena', status: 'cancelled', source: 'website', notes: '' }
];

const DEFAULT_HOURS = makeDefaultSettings().hours;
const nn = (n) => String(n).padStart(2, '0');

/** The k-th previous (dir -1) or next (dir 1) day that has at least one window in the DEFAULT hours. */
function nthOpenDay(today, dir, k) {
  let day = today;
  let found = 0;
  while (found < k) {
    day = addDays(day, dir);
    if (DEFAULT_HOURS[weekdayOf(day)].length > 0) found += 1;
  }
  return day;
}

function resolveDay(ref, today) {
  if (ref === 'T') return today;
  return nthOpenDay(today, ref[0] === 'P' ? -1 : 1, Number(ref.slice(1)));
}

function liveWindowKeys(records) {
  const keys = new Set();
  for (const b of (records && records.bookings) || []) {
    if (b.status === 'cancelled' || b.urgent) continue;
    for (const w of bookingWindowIds(b)) keys.add(`${stampDay(b.start)}|${w}`);
  }
  for (const k of (records && records.blocks) || []) keys.add(`${k.date}|${k.windowId}`);
  return keys;
}

/**
 * Placement of 8.7.2: preferred window first, then the other valid starts in ascending order; if the day
 * cannot take the job move to the next open day in the same direction (at most 5 days). Null when nothing fits.
 */
function place(spec, today, taken) {
  const isToday = spec.day === 'T';
  // CONTRACT-GAP: if today itself is full of non-seed bookings, today's jobs move back to earlier open days.
  const dir = isToday || spec.day[0] === 'P' ? -1 : 1;
  const starts = spec.blocks === 2 ? [0, 2] : [0, 1, 2, 3];
  const candidates = [spec.win, ...starts.filter((s) => s !== spec.win)];
  let date = resolveDay(spec.day, today);
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    const hours = DEFAULT_HOURS[weekdayOf(date)];
    const ignoreHours = isToday && attempt === 0; // a Sunday "today" still shows its jobs
    for (const start of candidates) {
      const covered = Array.from({ length: spec.blocks }, (_, i) => start + i);
      if (covered.every((w) => (ignoreHours || hours.includes(w)) && !taken.has(`${date}|${w}`))) {
        covered.forEach((w) => taken.add(`${date}|${w}`));
        return { date, windowId: start };
      }
    }
    date = nthOpenDay(date, dir, 1);
  }
  return null;
}

function createdAtFor(spec, startDay, today, nowStampStr) {
  if (spec.n === 7) return addMinutes(nowStampStr, -12);
  if (spec.n === 11) return addMinutes(nowStampStr, -40);
  if (startDay <= today) return makeStamp(addDays(startDay, -2), '09:00');
  const early = addMinutes(nowStampStr, -5);
  const threeDays = makeStamp(addDays(startDay, -3), '09:00');
  return early < threeDays ? early : threeDays;
}

/**
 * The relative seed: { bookings, blocks, messages, refSeq }.
 * `existing` holds the NON-seed records already stored; their windows count as taken (so a day rollover
 * can never double-book). Message seq numbers start at 1 in ascending `at` order; the store offsets them.
 */
export function buildSeed(now, settings, existing = { bookings: [], blocks: [] }) {
  const nowStampStr = toStamp(now);
  const today = stampDay(nowStampStr);
  const taken = liveWindowKeys(existing);
  const business = settings.business;

  // Blocks first, so bookings that spill over to the next open day cannot land on Van MOT.
  const mot = resolveDay('O4', today);
  const blocks = [];
  [0, 1, 2, 3].forEach((w) => {
    if (taken.has(`${mot}|${w}`)) return;
    taken.add(`${mot}|${w}`);
    blocks.push({ id: `blk_seed_${nn(blocks.length + 1)}`, date: mot, windowId: w, label: 'Van MOT', groupId: 'grp_seed_01', seed: true });
  });

  const bookings = [];
  for (const spec of SPECS) {
    const service = settings.services.find((s) => s.id === spec.service);
    if (!service) continue;
    const person = SEED_CUSTOMERS[spec.cust];
    const address = person.addresses[spec.addr || 0];
    let start;
    let startDay = today;
    let endStamp = null;
    let durationMin = spec.blocks * 120;
    if (spec.urgent) {
      start = nowStampStr;
      durationMin = 0;
    } else {
      const spot = place(spec, today, taken);
      if (!spot) continue; // nothing fits within five days: the diary is simply one job shorter
      startDay = spot.date;
      start = makeStamp(spot.date, WINDOWS[spot.windowId].start);
      endStamp = makeStamp(spot.date, WINDOWS[spot.windowId + spec.blocks - 1].end);
    }

    const variant = spec.variant ? service.variants.find((v) => v.id === spec.variant) : null;
    const quoted = quotedPriceFor(service, variant ? variant.id : null);
    let status = spec.status;
    if (status === 'today') status = endStamp <= nowStampStr ? 'done' : 'confirmed';
    const createdAt = createdAtFor(spec, startDay, today, nowStampStr);
    const done = status === 'done';
    const paid = done && !!spec.paid;
    const paidAt = paid ? endStamp : null;
    const cancelled = status === 'cancelled';

    const autoConfirmed = spec.source === 'website' && postcodeZone(address.postcode, business) === 'covered';
    const history = [{ at: createdAt, event: 'created', by: spec.source === 'website' ? 'customer' : 'owner', note: spec.source }];
    if (['confirmed', 'on_the_way', 'done'].includes(status)) {
      history.push({ at: addMinutes(createdAt, 1), event: 'confirmed', by: autoConfirmed ? 'system' : 'owner' });
    }
    if (done) history.push({ at: endStamp, event: 'done', by: 'owner' });
    if (paid) history.push({ at: paidAt, event: 'paid', by: 'owner', note: spec.paid });
    if (cancelled) {
      const cancelledAt = addMinutes(createdAt, 30) < nowStampStr ? addMinutes(createdAt, 30) : nowStampStr;
      history.push({ at: cancelledAt, event: 'cancelled', by: 'customer', note: 'Customer asked' });
    }

    bookings.push({
      id: `bk_seed_${nn(spec.n)}`,
      ref: `VM-${1027 + spec.n}`,
      createdAt,
      serviceId: service.id,
      serviceName: service.name,
      variantId: variant ? variant.id : null,
      variantLabel: variant ? variant.label : '',
      start,
      durationMin,
      status,
      urgent: !!spec.urgent,
      emergencyReasons: spec.urgent ? ['no_power'] : [],
      etaMinutes: null,
      etaAt: null,
      customer: { name: person.name, phone: person.phone, email: person.email },
      address: { line1: address.line1, postcode: address.postcode },
      notes: spec.notes || '',
      internalNotes: '',
      source: spec.source,
      quotedPrice: spec.urgent ? service.price : quoted,
      finalPrice: done ? (spec.final !== undefined ? spec.final : quoted) : null,
      paid,
      paidMethod: paid ? spec.paid : null,
      paidAt,
      seenByOwner: spec.n !== 7 && spec.n !== 11,
      reviewRequested: spec.n <= 4,
      cancelledBy: cancelled ? 'customer' : null,
      cancelReason: cancelled ? 'Customer asked' : '',
      seed: true,
      history
    });
  }

  const partial = { settings, bookings, blocks };
  const pending = [];
  const add = (booking, role, kind, at, sendAt = null) => {
    const m = buildMessage(kind, booking, partial, { at, sendAt });
    m.seed = true;
    pending.push({ role, booking, message: m });
  };
  for (const b of bookings) {
    if (stampDay(b.start) < today || b.status === 'cancelled') continue; // past jobs have no messages
    add(b, 'alert', b.urgent ? 'owner_emergency' : 'owner_new_booking', b.createdAt);
    const confAt = addMinutes(b.createdAt, 1);
    if (b.status === 'confirmed' && settings.remindersOn) {
      const sendAt = reminderSendAt(b, b.createdAt);
      if (sendAt) add(b, 'rem', 'customer_reminder', confAt, sendAt);
    }
    if (b.urgent) add(b, 'conf', 'customer_emergency_received', confAt);
    else add(b, 'conf', b.status === 'new' ? 'customer_received' : 'customer_confirmed', confAt);
    if (b.status === 'done') add(b, 'done', 'customer_completed', addMinutes(b.start, b.durationMin));
  }

  const ordered = pending
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => (a.message.at < b.message.at ? -1 : a.message.at > b.message.at ? 1 : a.i - b.i));
  const messages = ordered.map((p, idx) => ({
    id: `msg_seed_${nn(Number(p.booking.id.slice(-2)))}_${p.role}`,
    ...p.message,
    seq: idx + 1
  }));

  return { bookings, blocks, messages, refSeq: 1043 };
}
