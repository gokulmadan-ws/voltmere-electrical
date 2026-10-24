// js/core/seed.js: the relative EV-led demo diary (S01 to S15), seeded customers, sample enquiry and simulator pool
// Owner: WP1
import { WINDOWS, makeDefaultSettings, normaliseAnswers } from './config.js';
import { addDays, addMinutes, makeStamp, stampDay, toStamp, weekdayOf } from './dates.js';
import { bookingWindowIds } from './availability.js';
import { buildMessage, reminderSendAt } from './messages.js';
import { postcodeZone } from './format.js';
import { quotedPriceFor } from './selectors.js';

// ---------- fictional people (3.2: phones are Ofcom drama numbers 07700 900xxx) ----------

export const SEED_CUSTOMERS = {
  aoife: { name: 'Aoife Magee', phone: '07700 900231', email: '', addresses: [{ line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' }] },
  padraig: {
    name: 'Padraig Quinn', phone: '07700 900262', email: '',
    addresses: [{ line1: '8 Millrace Row', postcode: 'BT28 2LN' }, { line1: '31 Rockmount Road', postcode: 'BT20 4DZ' }]
  },
  niamh: { name: 'Niamh Gallagher', phone: '07700 900275', email: '', addresses: [{ line1: '22 Fernhill Crescent', postcode: 'BT23 5HT' }] },
  declan: { name: 'Declan Rafferty', phone: '07700 900288', email: '', addresses: [{ line1: '3 Linenhall Mews', postcode: 'BT35 9AQ' }] },
  orla: { name: 'Orla Hegarty', phone: '07700 900301', email: '', addresses: [{ line1: '17 Kilmore Drive', postcode: 'BT48 3RF' }] },
  sinead: { name: 'Sinead Doherty', phone: '07700 900344', email: '', addresses: [{ line1: '9 Cloughmore Close', postcode: 'BT42 6JN' }] },
  eoin: { name: 'Eoin McCartney', phone: '07700 900356', email: '', addresses: [{ line1: '2 Bannview Park', postcode: 'BT41 8PY' }] },
  ciaran: { name: 'Ciaran Boyle', phone: '07700 900371', email: '', addresses: [{ line1: '12 Tannery Lane', postcode: 'BT18 9UE' }] },
  roisin: { name: 'Roisin Maguire', phone: '07700 900388', email: '', addresses: [{ line1: '6 Ballydoon Mews', postcode: 'BT14 7XJ' }] },
  // Outside the area (not a BT postcode): the enquiry needs Daniel's OK before he confirms the survey.
  conor: { name: 'Conor Brennan', phone: '07700 900219', email: '', addresses: [{ line1: 'Mill Cottage, Lochan Road', postcode: 'DG9 8AB' }] },
  bronagh: { name: 'Bronagh Hughes', phone: '07700 900399', email: '', addresses: [{ line1: '27 Larkfield Gardens', postcode: 'BT9 6QT' }] }
};

/** What the `Demo: fill sample details` button types in. */
export const SAMPLE_CUSTOMER = { name: 'Aoife Magee', phone: '07700 900231', email: '', line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' };

/** The four funnel answers the demo fill picks (the postcode is SAMPLE_CUSTOMER.postcode). */
export const SAMPLE_ENQUIRY_ANSWERS = { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' };

/**
 * Eight invented website customers for simulateIncomingBooking (phones 07700 900500 to 900507). Each makes a free-survey
 * enquiry with these `answers` (postcode only goes in, like the funnel; `line1` is what they would give on the phone).
 */
export const SIM_POOL = [
  { name: 'Cathal Devlin', phone: '07700 900500', line1: '5 Cooper Street', postcode: 'BT4 3LW', notes: 'Just bought an electric car. Driveway at the side of the house.', answers: { parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' } },
  { name: 'Maeve Corr', phone: '07700 900501', line1: '41 Willow Bank', postcode: 'BT27 5HD', notes: '', answers: { parking: 'garage', vehicle: 'ordered', timing: 'month', permission: 'yes' } },
  { name: 'Callum Blair', phone: '07700 900502', line1: '16 Mason Road', postcode: 'BT19 1TT', notes: 'Dog is friendly, side gate is open.', answers: { parking: 'driveway', vehicle: 'choosing', timing: 'one_to_three', permission: 'yes' } },
  { name: 'Joanne Moore', phone: '07700 900503', line1: '8 Tanners Lane', postcode: 'BT34 6QA', notes: 'Charger would go on the garage wall.', answers: { parking: 'garage', vehicle: 'have', timing: 'asap', permission: 'yes' } },
  { name: 'Shane Kelly', phone: '07700 900504', line1: '23 Beacon Rise', postcode: 'BT47 8FS', notes: '', answers: { parking: 'allocated', vehicle: 'ordered', timing: 'month', permission: 'landlord' } },
  { name: 'Maureen Hanna', phone: '07700 900505', line1: '2 Chapel Yard', postcode: 'BT43 3ZP', notes: 'Please park on the drive.', answers: { parking: 'driveway', vehicle: 'have', timing: 'one_to_three', permission: 'yes' } },
  { name: 'Owen Mulholland', phone: '07700 900506', line1: '70 Quarry Hill', postcode: 'BT38 5NG', notes: 'Fuse box is in the hall cupboard.', answers: { parking: 'street', vehicle: 'choosing', timing: 'researching', permission: 'unsure' } },
  { name: 'Chloe Patterson', phone: '07700 900507', line1: '12 Ferry Lane', postcode: 'BT23 1RT', notes: '', answers: { parking: 'other', vehicle: 'ordered', timing: 'asap', permission: 'yes' } }
];

// ---------- the 15 seeded bookings (3.4) ----------

// ref: 'T' today, 'P<k>' k-th previous open day, 'O<k>' k-th next open day. win = preferred start window.
// status 'today' means: done once its window has ended, else confirmed.
// The diary is EV-led: 8 of the 15 are free EV quote visits (ev_quote) or installs (ev), all with the funnel answers filled; the
// other jobs are phone work for people who already know him. `noLine1`: a website enquiry only gave its postcode.
// The two pending enquiries (S07 and S11) are the ones that "need you"; both have the survey pencilled in (tentative).
const SPECS = [
  { n: 1, day: 'P17', win: 0, blocks: 1, service: 'fault', cust: 'aoife', status: 'done', final: 75, paid: 'card', source: 'website', notes: 'Fuse box keeps tripping in the evening. Checking it before a charger goes in.' },
  { n: 2, day: 'P14', win: 2, blocks: 2, service: 'eicr', variant: 'flat', cust: 'padraig', addr: 0, status: 'done', final: 150, paid: 'bank', source: 'phone', notes: 'Landlord. Flat above the shop, new tenant moving in.' },
  { n: 3, day: 'P11', win: 0, blocks: 2, service: 'ev', cust: 'niamh', status: 'done', final: 899, paid: 'card', source: 'website', notes: 'Charger on the front wall, short cable run from the fuse box.', answers: { parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' } },
  { n: 4, day: 'P6', win: 1, blocks: 1, service: 'sockets', cust: 'roisin', status: 'done', final: 170, paid: null, source: 'whatsapp', notes: 'Two sockets in the kitchen and one outside.' },
  { n: 5, day: 'T', win: 0, blocks: 1, service: 'sockets', cust: 'declan', status: 'today', final: 85, paid: 'cash', source: 'website', notes: 'Extra sockets in the back bedroom.' },
  { n: 6, day: 'T', win: 1, blocks: 1, service: 'fault', cust: 'orla', status: 'today', final: 75, paid: null, source: 'phone', notes: 'Home charger keeps tripping the breaker.' },
  { n: 7, day: 'O5', win: 1, blocks: 1, service: 'ev_quote', cust: 'sinead', status: 'new', source: 'website', noLine1: true, notes: 'Kia EV6 arriving in a couple of weeks. Thinking about a Zappi.', answers: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: false } },
  { n: 8, day: 'O1', win: 1, blocks: 1, service: 'ev_quote', cust: 'eoin', status: 'confirmed', source: 'website', noLine1: true, notes: 'New electric car arrives next month. Driveway at the side of the house.', answers: { parking: 'driveway', vehicle: 'ordered', timing: 'month', permission: 'yes', marketingOptIn: true } },
  { n: 9, day: 'O2', win: 2, blocks: 2, service: 'ev', cust: 'padraig', addr: 1, status: 'confirmed', source: 'phone', notes: 'Landlord. Charger for his own house, after the flat safety report.', answers: { parking: 'garage', vehicle: 'have', timing: 'one_to_three', permission: 'yes' } },
  { n: 10, day: 'O3', win: 0, blocks: 1, service: 'fault', cust: 'niamh', status: 'confirmed', source: 'website', notes: 'Outside light by the charger has stopped working.' },
  { n: 11, day: 'O3', win: 1, blocks: 1, service: 'ev_quote', cust: 'conor', status: 'new', source: 'website', noLine1: true, notes: 'Asked if you travel over for a quote. Check before confirming.', answers: { parking: 'driveway', vehicle: 'choosing', timing: 'one_to_three', permission: 'unsure', marketingOptIn: false } },
  { n: 12, day: 'O3', win: 2, blocks: 1, service: 'ev_quote', cust: 'roisin', status: 'confirmed', source: 'whatsapp', notes: 'Rents her flat. The landlord needs to agree first.', answers: { parking: 'allocated', vehicle: 'have', timing: 'month', permission: 'landlord' } },
  { n: 13, day: 'O3', win: 3, blocks: 1, service: 'sockets', cust: 'declan', status: 'confirmed', source: 'website', notes: 'Two double sockets in the lounge.' },
  { n: 14, day: 'O5', win: 0, blocks: 1, service: 'ev_quote', cust: 'ciaran', status: 'confirmed', source: 'referral', notes: 'Neighbour had a charger fitted. Garage is detached.', answers: { parking: 'garage', vehicle: 'choosing', timing: 'one_to_three', permission: 'yes' } },
  { n: 15, day: 'O6', win: 1, blocks: 1, service: 'ev_quote', cust: 'bronagh', status: 'cancelled', source: 'website', noLine1: true, notes: '', answers: { parking: 'street', vehicle: 'choosing', timing: 'researching', permission: 'unsure', marketingOptIn: false } }
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

    // The free survey is never auto-confirmed: the owner confirms it (and a pencilled-in one stays pending until he does).
    const autoConfirmed = spec.source === 'website' && service.id !== 'ev_quote' && postcodeZone(address.postcode, business) === 'covered';
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

    const answers = spec.answers ? normaliseAnswers(spec.answers, address.postcode) : null;
    const booking = {
      id: `bk_seed_${nn(spec.n)}`,
      ref: `EL-${1027 + spec.n}`,
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
      address: { line1: spec.noLine1 ? '' : address.line1, postcode: address.postcode },
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
    };
    if (answers) booking.answers = answers;
    if (service.id === 'ev_quote' && status === 'new' && durationMin > 0) booking.tentative = true; // pencilled in, awaiting the owner
    bookings.push(booking);
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
