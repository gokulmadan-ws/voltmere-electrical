// js/core/seed.js: the relative v3 demo (24 enquiries through the whole pipeline, their quotes and installs, ad spend), customers, simulator pool
// Owner: WP1 (v1), A3 (v3 rewrite)
import { KIND_LABELS, WINDOWS, makeChargerItem, makeDefaultSettings, normaliseAnswers } from './config.js';
import { addDays, addMinutes, makeStamp, stampDay, toStamp, weekdayOf } from './dates.js';
import { bookingWindowIds } from './availability.js';
import { alertHeading, buildMessage, reminderSendAt } from './messages.js';
import { postcodeZone } from './format.js';
import { quotedPriceFor } from './selectors.js';
import { quoteTotal } from './quotes.js';

// ---------- fictional people (phones are Ofcom drama numbers 07700 900xxx; emails are at example.com) ----------

const person = (name, phone, line1, postcode, extra = []) => ({
  name, phone, email: `${name.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, '.')}@example.com`, addresses: [{ line1, postcode }, ...extra]
});

export const SEED_CUSTOMERS = {
  aoife: person('Aoife Magee', '07700 900231', '14 Larkfield Gardens', 'BT9 6QP'),
  padraig: person('Padraig Quinn', '07700 900262', '8 Millrace Row', 'BT28 2LN', [{ line1: '31 Rockmount Road', postcode: 'BT20 4DZ' }]),
  niamh: person('Niamh Gallagher', '07700 900275', '22 Fernhill Crescent', 'BT23 5HT'),
  declan: person('Declan Rafferty', '07700 900288', '3 Linenhall Mews', 'BT35 9AQ'),
  orla: person('Orla Hegarty', '07700 900301', '17 Kilmore Drive', 'BT48 3RF'),
  sinead: person('Sinead Doherty', '07700 900344', '9 Cloughmore Close', 'BT42 6JN'),
  eoin: person('Eoin McCartney', '07700 900356', '2 Bannview Park', 'BT41 8PY'),
  ciaran: person('Ciaran Boyle', '07700 900371', '12 Tannery Lane', 'BT18 9UE'),
  roisin: person('Roisin Maguire', '07700 900388', '6 Ballydoon Mews', 'BT14 7XJ'),
  // Outside the area (not a BT postcode): the enquiry needs Daniel's OK before he confirms the survey.
  conor: person('Conor Brennan', '07700 900219', 'Mill Cottage, Lochan Road', 'DG9 8AB'),
  bronagh: person('Bronagh Hughes', '07700 900399', '27 Larkfield Gardens', 'BT9 6QT'),
  ronan: person('Ronan Kearney', '07700 900412', '5 Drumard Avenue', 'BT36 7XA'),
  grainne: person('Grainne Haughey', '07700 900413', '11 Cornmill Road', 'BT66 8QP'),
  malachy: person('Malachy Dunlop', '07700 900414', '3 Sallow Glen', 'BT32 4HJ'),
  eimear: person('Eimear Toner', '07700 900415', '28 Beechfield Park', 'BT12 6GN'),
  cormac: person('Cormac Loughran', '07700 900416', '14 Lisnasure Road', 'BT62 3LD'),
  ailbhe: person('Ailbhe Crossan', '07700 900417', '9 Whinfield Gardens', 'BT15 4RZ'),
  darragh: person('Darragh Sloan', '07700 900418', '36 Millbrook Close', 'BT43 5EU'),
  sorcha: person('Sorcha Mallon', '07700 900420', '17 Kilnasaggart Park', 'BT60 2DW'),
  fergal: person('Fergal Donnelly', '07700 900421', '6 Orchard Brae', 'BT21 0PY'),
  cathy: person('Cathy Rainey', '07700 900422', '41 Glenview Drive', 'BT45 6NH'),
  tiernan: person('Tiernan Cassidy', '07700 900423', '8 Strand Row', 'BT34 1XK'),
  majella: person('Majella Quigg', '07700 900424', '12 Carrowdore Gardens', 'BT30 7LS'),
  leona: person('Leona Fitzsimons', '07700 900425', '23 Cavehill Terrace', 'BT8 6QT'),
  oisin: person('Oisin Carville', '07700 900426', '4 Ravenhill Mews', 'BT5 4AX'),
  dermot: person('Dermot Fox', '07700 900427', '19 Barnfield Road', 'BT26 6PL'),
  una: person('Una Kerr', '07700 900428', '10 Castlerock Heights', 'BT52 1HS')
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

// ---------- the 15 original bookings (S01 to S15) ----------

// These keep their ids (bk_seed_01 to 15), windows, refs (EL-1028 to EL-1042) and createdAt rules from v2, so everything that was written
// against them still holds. v3 adds where each enquiry came from (`utm`), how fast it was answered (`reply`) and ties two installs to the
// quotes that made them (S03 and S09, see JOURNEYS). ref: 'T' today, 'P<k>' k-th previous open day, 'O<k>' k-th next open day.
// status 'today' means: done once its window has ended, else confirmed. `noLine1`: a website enquiry only gave its postcode.
// `label` (T10): 180 Electrical only sells home EV chargers, so the seven original jobs that were not EV work (fault finding, sockets, an EICR) keep
// their service id, price and place (every selector, the pipeline and the diary maths are unchanged) but read as the EV jobs they are in the diary,
// the calendar, Insights and messages: a survey or an install. `createdDaysAgo`: a future job that was booked on an earlier day, not "5 minutes ago".
const LEGACY = [
  { n: 1, day: 'P17', win: 0, blocks: 1, service: 'fault', label: 'EV charger survey', cust: 'aoife', status: 'done', final: 75, paid: 'card', source: 'website', notes: 'Fuse box keeps tripping in the evening, so the supply gets checked before a charger goes in. Wall by the front door.' },
  { n: 2, day: 'P14', win: 2, blocks: 2, service: 'eicr', variant: 'flat', label: 'EV charger installation (landlord)', cust: 'padraig', addr: 0, status: 'done', final: 150, paid: 'bank', source: 'phone', notes: 'Landlord. Charger bay for the flat above the shop, new tenant moving in.' },
  { n: 3, day: 'P11', win: 0, blocks: 2, service: 'ev', cust: 'niamh', status: 'done', paid: 'card', source: 'website', notes: 'Charger on the front wall, short cable run from the fuse box.', answers: { parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, journey: 'd1' },
  { n: 4, day: 'P6', win: 1, blocks: 1, service: 'sockets', label: 'EV charger install visit', cust: 'roisin', status: 'done', final: 170, paid: null, source: 'whatsapp', notes: 'Isolator by the meter box and a weatherproof outdoor socket for the charger cable.' },
  { n: 5, day: 'T', win: 0, blocks: 1, service: 'sockets', label: 'EV charger install visit', cust: 'declan', status: 'today', final: 85, paid: 'cash', source: 'website', notes: 'Second visit: wall box connected and tested, app set up on his phone.' },
  { n: 6, day: 'T', win: 1, blocks: 1, service: 'fault', label: 'EV charger survey', cust: 'orla', status: 'today', final: 75, paid: null, source: 'phone', notes: 'Second charger for the new car. Her first one keeps tripping the breaker, so the supply gets checked first.' },
  { n: 7, day: 'O5', win: 1, blocks: 1, service: 'ev_quote', cust: 'sinead', status: 'new', source: 'website', noLine1: true, ageMin: 12, notes: 'Kia EV6 arriving in a couple of weeks. Thinking about a Zappi.', answers: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: false }, lead: 'facebook' },
  { n: 8, day: 'O1', win: 1, blocks: 1, service: 'ev_quote', cust: 'eoin', status: 'confirmed', source: 'website', noLine1: true, notes: 'New electric car arrives next month. Driveway at the side of the house.', answers: { parking: 'driveway', vehicle: 'ordered', timing: 'month', permission: 'yes', marketingOptIn: true }, lead: 'facebook', reply: 95, photosRequest: true },
  { n: 9, day: 'O2', win: 2, blocks: 2, service: 'ev', cust: 'padraig', addr: 1, status: 'confirmed', source: 'phone', notes: 'Landlord. Charger for his own house, same set-up as the flat.', answers: { parking: 'garage', vehicle: 'have', timing: 'one_to_three', permission: 'yes' }, journey: 'i3' },
  { n: 10, day: 'O3', win: 0, blocks: 1, service: 'fault', label: 'EV charger survey', cust: 'niamh', status: 'confirmed', source: 'website', createdDaysAgo: 3, notes: 'Survey for a second charger bay. Also asked about the outside light by the first charger.' },
  { n: 11, day: 'O3', win: 1, blocks: 1, service: 'ev_quote', cust: 'conor', status: 'new', source: 'website', noLine1: true, notes: 'Asked if you travel over for a quote. Check before confirming.', answers: { parking: 'driveway', vehicle: 'choosing', timing: 'one_to_three', permission: 'unsure', marketingOptIn: false }, lead: 'google', ageMin: 30 * 60 },
  { n: 12, day: 'O3', win: 2, blocks: 1, service: 'ev_quote', cust: 'roisin', status: 'confirmed', source: 'whatsapp', createdDaysAgo: 2, notes: 'Rents her flat. The landlord needs to agree first.', answers: { parking: 'allocated', vehicle: 'have', timing: 'month', permission: 'landlord' }, lead: 'instagram' },
  { n: 13, day: 'O3', win: 3, blocks: 1, service: 'sockets', label: 'EV charger install visit', cust: 'declan', status: 'confirmed', source: 'website', createdDaysAgo: 1, notes: 'Second visit: socket and isolator for the garage charger.' },
  { n: 14, day: 'O5', win: 0, blocks: 1, service: 'ev_quote', cust: 'ciaran', status: 'confirmed', source: 'referral', notes: 'Neighbour had a charger fitted. Garage is detached.', answers: { parking: 'garage', vehicle: 'choosing', timing: 'one_to_three', permission: 'yes' } },
  { n: 15, day: 'O6', win: 1, blocks: 1, service: 'ev_quote', cust: 'bronagh', status: 'cancelled', source: 'website', createdDaysAgo: 2, noLine1: true, notes: '', answers: { parking: 'street', vehicle: 'choosing', timing: 'researching', permission: 'unsure', marketingOptIn: false }, lead: 'facebook' }
];

// ---------- the 18 further enquiries (one journey each) ----------

// A survey is `sv: [day, window]`, an install is `inst: [day, window]` (window 0 or 2: a half day). Times that must be "recent" are
// minutes before now, so the diary reads the same whatever day it is opened. `reply` = minutes from the enquiry to the owner's reply.
// Enquiry ids are bk_seed_16 to 33 in this order and their installs bk_seed_34 to 42; d1 and i3 reuse the original installs 03 and 09
// (`install: 3` / `install: 9`). With the 6 original enquiries that makes 24: enquiry 2 (07, 11), survey 3 (08, 12, 14), quote 5
// (w1, w2, o1, o2, o3), accepted 2 (a1, a2), install 3 (09, i1, i2), done 6 (03, d2 to d6), lost 3 (15, l2, l3).
// `marketingOptIn` is the funnel's optional checkbox; null leaves it out (the original installs S03 and S09 never had it).
const A = (parking, vehicle, timing, permission, marketingOptIn = false) => ({ parking, vehicle, timing, permission, ...(marketingOptIn === null ? {} : { marketingOptIn }) });

const JOURNEYS = [
  // survey done, quote still to write
  { n: 16, key: 'w1', cust: 'leona', stage: 'noquote', src: 'phone', sv: ['P1', 1], notes: 'Rang about a charger for her new Polestar. Wall by the front door.', answers: A('driveway', 'have', 'asap', 'yes') },
  { n: 17, key: 'w2', cust: 'oisin', stage: 'draft', src: 'referral', reply: 300, sv: ['P3', 0], draftAgoMin: 300, brand: 'OHME', extras: [], noLine1: true, notes: 'Recommended by a neighbour who had an Ohme fitted.', answers: A('garage', 'ordered', 'month', 'yes') },
  // quotes out with the customer
  { n: 18, key: 'o1', cust: 'cathy', stage: 'sent', src: 'facebook', reply: 60, sv: ['P6', 2], sentAgoMin: 3 * 24 * 60, via: 'whatsapp', brand: 'ZAPPI', extras: [['cable_extra', 6]], noLine1: true, notes: 'Car is on order. Driveway is a bit long.', answers: A('driveway', 'ordered', 'month', 'yes') },
  { n: 19, key: 'o2', cust: 'tiernan', stage: 'viewed', src: 'instagram', reply: 180, sv: ['P5', 0], sentAgoMin: 26 * 60, viewedAgoMin: 20 * 60, via: 'email', brand: 'OHME', extras: [['enclosure', 1]], noLine1: true, notes: 'Charger on the side of the garage.', answers: A('garage', 'have', 'asap', 'yes', true) },
  { n: 20, key: 'o3', cust: 'majella', stage: 'sent', src: 'facebook', reply: 35, sv: ['P2', 3], sentAgoMin: 4 * 60, via: 'whatsapp', brand: 'ZAPPI', extras: [['consumer_unit', 1]], noLine1: true, notes: 'Old fuse box in the cupboard under the stairs.', answers: A('driveway', 'have', 'asap', 'yes') },
  // quote accepted, install day still to confirm (pencilled in)
  { n: 21, key: 'a1', cust: 'sorcha', stage: 'accepted', src: 'facebook', reply: 75, sv: ['P9', 1], sentAgoMin: 4 * 24 * 60, acceptedAgoMin: 30 * 60, via: 'whatsapp', brand: 'SYNC', extras: [], inst: ['O7', 0], instN: 34, noLine1: true, notes: 'Wants it done before the school run gets busy.', answers: A('driveway', 'have', 'asap', 'yes', true) },
  { n: 22, key: 'a2', cust: 'fergal', stage: 'accepted', src: 'instagram', reply: 130, sv: ['P7', 3], sentAgoMin: 3 * 24 * 60, acceptedAgoMin: 6 * 60, via: 'email', brand: 'ZAPPI', extras: [['cable_extra', 4]], inst: ['O9', 2], instN: 35, noLine1: true, notes: 'Hybrid arriving soon. Charger on the gable wall.', answers: A('driveway', 'ordered', 'month', 'yes') },
  // install day booked
  { n: 23, key: 'i1', cust: 'ailbhe', stage: 'install', src: 'facebook', reply: 20, sv: ['P12', 0], acc: 3, brand: 'ZAPPI', extras: [['groundwork', 3]], inst: ['O8', 0], instN: 36, noLine1: true, notes: 'Charger by the garage, cable has to cross the grass.', answers: A('driveway', 'have', 'asap', 'yes') },
  { n: 24, key: 'i2', cust: 'darragh', stage: 'install', src: 'facebook', reply: 100, sv: ['P10', 2], acc: 3, brand: 'OHME', extras: [], inst: ['O10', 2], instN: 37, noLine1: true, notes: 'Terraced house, parks right outside.', answers: A('driveway', 'ordered', 'month', 'yes') },
  { n: 25, key: 'i3', cust: 'padraig', addr: 1, stage: 'install', src: 'phone', sv: ['P9', 3], acc: 3, brand: 'ZAPPI', extras: [], install: 9, notes: 'Landlord. Charger for his own house, after the flat safety report.', answers: A('garage', 'have', 'one_to_three', 'yes', null) },
  // installed (four paid, two still owed)
  { n: 26, key: 'd1', cust: 'niamh', stage: 'done', src: 'facebook', reply: 55, sv: ['P18', 1], acc: 2, brand: 'SYNC', extras: [], install: 3, noLine1: true, notes: 'Charger on the front wall, short cable run from the fuse box.', answers: A('driveway', 'have', 'asap', 'yes', null) },
  { n: 27, key: 'd2', cust: 'ronan', stage: 'done', src: 'facebook', reply: 410, sv: ['P38', 1], acc: 3, brand: 'OHME', extras: [['cable_extra', 5]], inst: ['P29', 2], instN: 38, paid: 'bank', paidDays: 2, adj: 36, noLine1: true, notes: 'New EV delivered last week.', answers: A('driveway', 'have', 'asap', 'yes') },
  { n: 28, key: 'd3', cust: 'grainne', stage: 'done', src: 'instagram', reply: 90, sv: ['P24', 2], acc: 3, brand: 'ZAPPI', extras: [['enclosure', 1]], inst: ['P20', 0], instN: 39, paid: 'card', paidDays: 0, adj: 0, noLine1: true, notes: 'Charger by the back door, brick wall.', answers: A('driveway', 'ordered', 'month', 'yes', true) },
  { n: 29, key: 'd4', cust: 'malachy', stage: 'done', src: 'google', reply: 240, sv: ['P22', 0], acc: 3, brand: 'SYNC', extras: [], inst: ['P9', 2], instN: 40, paid: 'card', paidDays: 1, adj: 0, noLine1: true, notes: 'Searched for a local installer.', answers: A('garage', 'have', 'month', 'yes') },
  { n: 30, key: 'd5', cust: 'eimear', stage: 'done', src: 'facebook', reply: 1620, sv: ['P13', 3], acc: 3, brand: 'ZAPPI', extras: [['consumer_unit', 1], ['cable_extra', 3]], inst: ['P5', 0], instN: 41, paid: null, adj: 0, noLine1: true, notes: 'Fuse box is old, asked if it needs replacing.', answers: A('driveway', 'have', 'asap', 'yes') },
  { n: 31, key: 'd6', cust: 'cormac', stage: 'done', src: 'facebook', reply: 65, sv: ['P8', 2], acc: 3, brand: 'OHME', extras: [], inst: ['P2', 0], instN: 42, paid: null, adj: 0, noLine1: true, notes: 'Saw the video and sent a message.', answers: A('driveway', 'have', 'month', 'yes') },
  // lost: a declined quote and an expired one (the cancelled enquiry is bk_seed_15)
  { n: 32, key: 'l2', cust: 'dermot', stage: 'declined', src: 'facebook', reply: 45, sv: ['P16', 1], declineDays: 5, reason: 'Found a lower price elsewhere', brand: 'ZAPPI', extras: [], noLine1: true, notes: 'Comparing a few quotes.', answers: A('driveway', 'choosing', 'one_to_three', 'yes') },
  { n: 33, key: 'l3', cust: 'una', stage: 'expired', src: 'google', reply: 800, sv: ['P34', 2], brand: 'OHME', extras: [], noLine1: true, notes: 'Not sure when the car is arriving.', answers: A('allocated', 'ordered', 'one_to_three', 'landlord') }
];

const UTM = {
  facebook: (n) => ({ source: 'facebook', medium: 'paid_social', campaign: n % 2 ? 'ev_charger_leads' : 'home_charging_video' }),
  instagram: () => ({ source: 'instagram', medium: 'paid_social', campaign: 'charger_reels' }),
  google: () => ({ source: 'google', medium: 'organic', campaign: '' }),
  referral: () => ({ source: 'referral', medium: 'share_link', campaign: 'customer_referral' })
};

// An original booking's createdAt: two days before for past and today jobs, the earlier of now-5min and three days before for future
// ones; the two enquiries that "need you" are made a given number of minutes ago (`ageMin`).
function legacyCreatedAt(spec, startDay, today, nowStampStr) {
  if (spec.ageMin !== undefined) return addMinutes(nowStampStr, -spec.ageMin);
  // Booked on an earlier day, at a varied hour (T10: not every future job was "made 5 minutes ago", so the Messages list has a real history).
  if (spec.createdDaysAgo !== undefined) return makeStamp(addDays(today, -spec.createdDaysAgo), ENQUIRY_TIMES[spec.n % ENQUIRY_TIMES.length]);
  if (startDay <= today) return makeStamp(addDays(startDay, -2), '09:00');
  const early = addMinutes(nowStampStr, -5);
  const threeDays = makeStamp(addDays(startDay, -3), '09:00');
  return early < threeDays ? early : threeDays;
}

// Hours of the day an enquiry came in, cycled for variety.
const ENQUIRY_TIMES = ['10:15', '19:40', '08:55', '21:10', '13:25', '17:50', '11:05', '20:30'];

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

// The quote lines of a seeded quote, from the catalogue in settings (so a renamed or repriced catalogue is honoured). A catalogue item flagged
// `optional` (the consumer unit upgrade) becomes a possible extra: listed on the quote but never inside its fixed total.
function seedLines(settings, brand, extras) {
  const items = settings.quoteItems || [];
  const find = (id) => items.find((i) => i.id === id);
  const line = (item, qty = 1) => ({ id: '', label: item.label, detail: item.detail || '', qty, unitPrice: item.unitPrice, optional: item.optional === true });
  const charger = items.find((i) => i.kind === 'charger' && i.brand === brand) || makeChargerItem(brand);
  const wanted = [[charger, 1], ...['install_standard', 'circuit'].map((id) => [find(id), 1]), ...extras.map(([id, qty]) => [find(id), qty]), [find('testing'), 1]];
  return wanted.filter(([item]) => item).map(([item, qty], i) => ({ ...line(item, qty), id: `ln_${i + 1}` }));
}

// What the legacy bookings need to know about their lead source: a utm for the paid ones, nothing for word of mouth and phone.
const LEGACY_IDS = new Set(LEGACY.map((spec) => `bk_seed_${nn(spec.n)}`));

/**
 * The relative seed: { bookings, blocks, messages, refSeq, quotes, adSpend }.
 * `existing` holds the NON-seed records already stored; their windows count as taken (so a day rollover
 * can never double-book). Message seq numbers start at 1 in ascending `at` order; the store offsets them.
 */
export function buildSeed(now, settings, existing = { bookings: [], blocks: [] }) {
  const nowStampStr = toStamp(now);
  const today = stampDay(nowStampStr);
  const taken = liveWindowKeys(existing);
  const business = settings.business;
  const service = (id) => settings.services.find((s) => s.id === id);
  const validDays = settings.quoteDefaults && Number.isInteger(settings.quoteDefaults.validDays) ? settings.quoteDefaults.validDays : 30;
  const quoteNotes = settings.quoteDefaults ? settings.quoteDefaults.notes : '';

  // Blocks first, so bookings that spill over to the next open day cannot land on Van MOT.
  const mot = resolveDay('O4', today);
  const blocks = [];
  [0, 1, 2, 3].forEach((w) => {
    if (taken.has(`${mot}|${w}`)) return;
    taken.add(`${mot}|${w}`);
    blocks.push({ id: `blk_seed_${nn(blocks.length + 1)}`, date: mot, windowId: w, label: 'Van MOT', groupId: 'grp_seed_01', seed: true });
  });

  // Placement: the 15 original bookings first (so their windows never move), then the half-day installs of the further journeys
  // (they need an aligned pair), then their single-window surveys.
  const spots = {};
  for (const spec of LEGACY) spots[`L${spec.n}`] = place(spec, today, taken);
  for (const j of JOURNEYS) if (j.inst) spots[`${j.key}:i`] = place({ day: j.inst[0], win: j.inst[1], blocks: 2 }, today, taken);
  for (const j of JOURNEYS) spots[`${j.key}:s`] = place({ day: j.sv[0], win: j.sv[1], blocks: 1 }, today, taken);

  const bookings = [];
  const quotes = [];
  const links = []; // { enquiry, quote, install } for every quote
  const legacyById = {};

  // ----- the 15 original bookings -----
  for (const spec of LEGACY) {
    const svc = service(spec.service);
    const spot = spots[`L${spec.n}`];
    if (!svc || !spot) continue; // nothing fits within five days: the diary is simply one job shorter
    const who = SEED_CUSTOMERS[spec.cust];
    const home = who.addresses[spec.addr || 0];
    const startDay = spot.date;
    const start = makeStamp(spot.date, WINDOWS[spot.windowId].start);
    const endStamp = makeStamp(spot.date, WINDOWS[spot.windowId + spec.blocks - 1].end);
    const durationMin = spec.blocks * 120;
    const variant = spec.variant ? svc.variants.find((v) => v.id === spec.variant) : null;
    const quoted = quotedPriceFor(svc, variant ? variant.id : null);
    let status = spec.status;
    if (status === 'today') status = endStamp <= nowStampStr ? 'done' : 'confirmed';
    const createdAt = legacyCreatedAt(spec, startDay, today, nowStampStr);
    const done = status === 'done';
    const paid = done && !!spec.paid;
    const paidAt = paid ? endStamp : null;
    const cancelled = status === 'cancelled';

    // The free survey is never auto-confirmed: the owner confirms it (and a pencilled-in one stays pending until he does).
    const autoConfirmed = spec.source === 'website' && svc.id !== 'ev_quote' && postcodeZone(home.postcode, business) === 'covered';
    const history = [{ at: createdAt, event: 'created', by: spec.source === 'website' ? 'customer' : 'owner', note: spec.source }];
    const confirmedAt = spec.reply !== undefined ? addMinutes(createdAt, spec.reply) : addMinutes(createdAt, 1);
    if (['confirmed', 'on_the_way', 'done'].includes(status)) history.push({ at: confirmedAt, event: 'confirmed', by: autoConfirmed ? 'system' : 'owner' });
    if (spec.photosRequest) history.push({ at: addMinutes(confirmedAt, 6), event: 'message', by: 'owner', note: KIND_LABELS.customer_photos_request });
    if (done) history.push({ at: endStamp, event: 'done', by: 'owner' });
    if (paid) history.push({ at: paidAt, event: 'paid', by: 'owner', note: spec.paid });
    if (cancelled) {
      const cancelledAt = addMinutes(createdAt, 30) < nowStampStr ? addMinutes(createdAt, 30) : nowStampStr;
      history.push({ at: cancelledAt, event: 'cancelled', by: 'customer', note: 'Customer asked' });
    }

    const answers = spec.answers ? normaliseAnswers(spec.answers, home.postcode) : null;
    const booking = {
      id: `bk_seed_${nn(spec.n)}`,
      ref: `EL-${1027 + spec.n}`,
      createdAt,
      serviceId: svc.id,
      serviceName: spec.label || svc.name,
      variantId: variant ? variant.id : null,
      variantLabel: variant && !spec.label ? variant.label : '',
      start,
      durationMin,
      status,
      urgent: false,
      emergencyReasons: [],
      etaMinutes: null,
      etaAt: null,
      customer: { name: who.name, phone: who.phone, email: who.email },
      address: { line1: spec.noLine1 ? '' : home.line1, postcode: home.postcode },
      notes: spec.notes || '',
      internalNotes: '',
      source: spec.source,
      quotedPrice: quoted,
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
    if (spec.lead && UTM[spec.lead]) booking.utm = UTM[spec.lead](spec.n);
    if (svc.id === 'ev_quote' && status === 'new' && durationMin > 0) booking.tentative = true; // pencilled in, awaiting the owner
    bookings.push(booking);
    legacyById[spec.n] = booking;
  }

  // ----- the further enquiries, their quotes and installs -----
  JOURNEYS.forEach((j, index) => {
    const spot = spots[`${j.key}:s`];
    if (!spot) return;
    const who = SEED_CUSTOMERS[j.cust];
    const home = who.addresses[j.addr || 0];
    const phoneMade = j.src === 'phone';
    const surveyStart = makeStamp(spot.date, WINDOWS[spot.windowId].start);
    const surveyEnd = makeStamp(spot.date, WINDOWS[spot.windowId].end);
    const createdAt = makeStamp(addDays(spot.date, -(j.gap || 2)), ENQUIRY_TIMES[index % ENQUIRY_TIMES.length]);
    const status = j.stage === 'cancelled' ? 'cancelled' : 'done';
    const confirmedAt = phoneMade ? addMinutes(createdAt, 1) : addMinutes(createdAt, j.reply);

    const history = [
      { at: createdAt, event: 'created', by: phoneMade ? 'owner' : 'customer', note: phoneMade ? 'phone' : 'website' },
      { at: confirmedAt, event: 'confirmed', by: 'owner' },
      { at: surveyEnd, event: 'done', by: 'owner' }
    ];
    const enquiry = {
      id: `bk_seed_${nn(j.n)}`,
      ref: '',
      createdAt,
      serviceId: 'ev_quote',
      serviceName: service('ev_quote').name,
      variantId: null,
      variantLabel: '',
      start: surveyStart,
      durationMin: 120,
      status,
      urgent: false,
      emergencyReasons: [],
      etaMinutes: null,
      etaAt: null,
      customer: { name: who.name, phone: who.phone, email: who.email },
      address: { line1: phoneMade || !j.noLine1 ? home.line1 : '', postcode: home.postcode },
      notes: j.notes || '',
      internalNotes: '',
      source: phoneMade ? 'phone' : 'website',
      quotedPrice: 0,
      finalPrice: 0,
      paid: false,
      paidMethod: null,
      paidAt: null,
      seenByOwner: true,
      reviewRequested: false,
      cancelledBy: null,
      cancelReason: '',
      seed: true,
      history
    };
    const answers = normaliseAnswers(j.answers, home.postcode);
    if (answers) enquiry.answers = answers;
    if (!phoneMade && UTM[j.src]) enquiry.utm = UTM[j.src](j.n);
    bookings.push(enquiry);

    // ----- the quote -----
    if (j.stage === 'noquote') return;
    const lines = seedLines(settings, j.brand, j.extras || []);
    const reuse = j.install ? legacyById[j.install] : null; // an original install this quote led to
    let sentAt = null;
    if (j.stage !== 'draft') {
      if (j.sentAgoMin !== undefined) sentAt = addMinutes(nowStampStr, -j.sentAgoMin);
      else if (reuse) sentAt = makeStamp(addDays(stampDay(reuse.createdAt), -1), '09:40');
      else sentAt = makeStamp(addDays(spot.date, 1), '09:40');
    }
    const quoteCreatedAt = j.stage === 'draft'
      ? addMinutes(nowStampStr, -j.draftAgoMin)
      : j.sentAgoMin !== undefined ? addMinutes(sentAt, -25) : addMinutes(surveyEnd, 20);
    const quote = {
      id: '',
      bookingId: enquiry.id,
      customerName: who.name,
      createdAt: quoteCreatedAt,
      status: 'draft',
      brand: j.brand,
      lines,
      notes: quoteNotes,
      validUntil: addDays(stampDay(sentAt || quoteCreatedAt), validDays),
      sentAt,
      sentVia: sentAt ? j.via || 'whatsapp' : null,
      viewedAt: null,
      acceptedAt: null,
      declinedAt: null,
      declineReason: '',
      installBookingId: null,
      seed: true
    };
    if (j.stage === 'sent' || j.stage === 'expired') quote.status = 'sent';
    if (j.stage === 'viewed') {
      quote.status = 'viewed';
      quote.viewedAt = addMinutes(nowStampStr, -j.viewedAgoMin);
    }
    if (j.stage === 'declined') {
      quote.status = 'declined';
      quote.declinedAt = makeStamp(addDays(stampDay(sentAt), j.declineDays), '18:15');
      quote.declineReason = j.reason;
    }
    quotes.push(quote);
    const link = { enquiry, quote, install: null };
    links.push(link);

    // ----- accepted quotes: the install booking (a further one, or an original that this quote led to) -----
    if (!j.inst && !reuse) return;
    let install = reuse;
    let instSpot = null;
    if (!reuse) {
      instSpot = spots[`${j.key}:i`];
      if (!instSpot) return;
    }
    const instStartStamp = reuse ? reuse.start : makeStamp(instSpot.date, WINDOWS[instSpot.windowId].start);
    const instDay = stampDay(instStartStamp);
    let acceptedAt;
    if (reuse) {
      acceptedAt = reuse.createdAt;
    } else if (j.acceptedAgoMin !== undefined) {
      acceptedAt = addMinutes(nowStampStr, -j.acceptedAgoMin);
    } else {
      const wanted = makeStamp(addDays(spot.date, 1 + (j.acc || 2)), '16:20');
      const latest = makeStamp(addDays(instDay, -1), '18:00');
      acceptedAt = wanted < latest ? wanted : latest;
      if (acceptedAt < addMinutes(sentAt, 60)) acceptedAt = addMinutes(sentAt, 60);
    }
    quote.status = 'accepted';
    quote.acceptedAt = acceptedAt;
    quote.viewedAt = quote.viewedAt || (addMinutes(sentAt, 180) < addMinutes(acceptedAt, -30) ? addMinutes(sentAt, 180) : addMinutes(acceptedAt, -30));
    const total = quoteTotal(quote);
    if (reuse) {
      // The original install booking now carries the quote's price (an EV install is "quoted for your home").
      reuse.quotedPrice = total;
      if (reuse.status === 'done') reuse.finalPrice = total;
    } else {
      const instEnd = makeStamp(instSpot.date, WINDOWS[instSpot.windowId + 1].end);
      const instStatus = j.stage === 'accepted' ? 'new' : j.stage === 'install' ? 'confirmed' : 'done';
      const instHistory = [{ at: acceptedAt, event: 'created', by: phoneMade ? 'owner' : 'customer', note: phoneMade ? 'phone' : 'website' }];
      if (instStatus !== 'new') {
        const wanted = phoneMade ? addMinutes(acceptedAt, 1) : addMinutes(acceptedAt, 150);
        const latest = addMinutes(instStartStamp, -60);
        instHistory.push({ at: wanted < latest ? wanted : latest, event: 'confirmed', by: 'owner' });
      }
      const paid = instStatus === 'done' && !!j.paid;
      const paidAt = paid ? makeStamp(addDays(instSpot.date, j.paidDays || 0), '18:30') : null;
      if (instStatus === 'done') instHistory.push({ at: instEnd, event: 'done', by: 'owner' });
      if (paid) instHistory.push({ at: paidAt, event: 'paid', by: 'owner', note: j.paid });
      install = {
        id: `bk_seed_${nn(j.instN)}`,
        ref: '',
        createdAt: acceptedAt,
        serviceId: 'ev',
        serviceName: service('ev').name,
        variantId: null,
        variantLabel: '',
        start: instStartStamp,
        durationMin: 240,
        status: instStatus,
        urgent: false,
        emergencyReasons: [],
        etaMinutes: null,
        etaAt: null,
        customer: { name: who.name, phone: who.phone, email: who.email },
        address: { line1: home.line1, postcode: home.postcode },
        notes: '',
        internalNotes: '',
        source: phoneMade ? 'phone' : 'website',
        quotedPrice: total,
        finalPrice: instStatus === 'done' ? total + (j.adj || 0) : null,
        paid,
        paidMethod: paid ? j.paid : null,
        paidAt,
        seenByOwner: j.key !== 'a2',
        reviewRequested: instStatus === 'done' && j.key !== 'd6',
        cancelledBy: null,
        cancelReason: '',
        seed: true,
        history: instHistory
      };
      if (enquiry.answers) install.answers = { ...enquiry.answers }; // the job card keeps what the customer said about their home
      if (instStatus === 'new') install.tentative = true;
      bookings.push(install);
    }
    link.install = install;
    quote.installBookingId = install.id;
  });

  // ----- refs: the original 15 keep EL-1028 to EL-1042; the 27 further bookings take EL-1001 to EL-1027 in the order they were made -----
  const further = bookings.filter((b) => !LEGACY_IDS.has(b.id));
  further
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    .forEach((b, idx) => {
      b.ref = `EL-${1001 + idx}`;
    });
  bookings.sort((a, b) => (a.id < b.id ? -1 : 1)); // bk_seed_01 to 42, as the original diary was ordered
  for (const { enquiry, quote, install } of links) {
    quote.id = `Q-${enquiry.ref}`;
    quote.lines = quote.lines.map((line, i) => ({ ...line, id: `ln_${quote.id}_${i + 1}` }));
    if (install) install.quoteId = quote.id;
  }
  const quoteMap = {};
  for (const q of quotes) quoteMap[q.id] = q;

  // ----- messages: alerts for what is coming up, plus the last 10 days of quote traffic -----
  const partial = { settings, bookings, blocks, quotes: quoteMap };
  const pending = [];
  const add = (booking, role, kind, at, extra = {}) => {
    const m = buildMessage(kind, booking, partial, { at, sendAt: null, ...extra });
    m.seed = true;
    if (kind === 'owner_new_booking') m.title = alertHeading(booking); // 'New enquiry: Sinead D, BT42': which enquiry this alert is for
    pending.push({ role, booking, message: m });
  };
  const tenDaysAgo = addMinutes(nowStampStr, -10 * 24 * 60);
  for (const b of bookings) {
    if (stampDay(b.start) < today || b.status === 'cancelled') continue; // past jobs have no messages
    const isInstall = !!b.quoteId; // an install made by a quote has its own accepted messages
    const confirmedEntry = b.history.find((h) => h.event === 'confirmed');
    if (!isInstall) add(b, 'alert', 'owner_new_booking', b.createdAt);
    const confAt = b.status !== 'new' && confirmedEntry ? confirmedEntry.at : addMinutes(b.createdAt, 1);
    if (b.status === 'confirmed' && settings.remindersOn) {
      const sendAt = reminderSendAt(b, b.createdAt);
      if (sendAt) add(b, 'rem', 'customer_reminder', confAt, { sendAt });
    }
    if (!isInstall || b.status === 'confirmed') add(b, 'conf', b.status === 'new' ? 'customer_received' : 'customer_confirmed', confAt);
    if (b.status === 'done') add(b, 'done', 'customer_completed', addMinutes(b.start, b.durationMin));
  }
  for (const { enquiry, quote, install } of links) {
    if (quote.sentAt && quote.sentAt >= tenDaysAgo) {
      add(enquiry, 'qsent', 'customer_quote_sent', quote.sentAt, { quote, channel: quote.sentVia === 'email' ? 'email' : 'whatsapp' });
    }
    if (install && quote.acceptedAt >= tenDaysAgo && install.status !== 'cancelled') {
      add(install, 'qacc', 'owner_quote_accepted', quote.acceptedAt, { quote, installBooking: install });
      add(install, 'qaccc', 'customer_quote_accepted', addMinutes(quote.acceptedAt, 1), { quote, installBooking: install });
    }
  }
  for (const b of bookings) {
    const asked = b.history.find((h) => h.event === 'message' && h.note === KIND_LABELS.customer_photos_request);
    if (asked && asked.at >= tenDaysAgo && b.status !== 'cancelled') add(b, 'photos', 'customer_photos_request', asked.at);
  }
  for (const { enquiry, quote } of links) {
    // Quote events on the enquiry's own history (what the booking screen shows).
    if (quote.sentAt) enquiry.history.push({ at: quote.sentAt, event: 'message', by: 'owner', note: KIND_LABELS.customer_quote_sent });
    if (quote.status === 'accepted') enquiry.history.push({ at: quote.acceptedAt, event: 'message', by: 'customer', note: 'Quote accepted' });
    if (quote.status === 'declined') enquiry.history.push({ at: quote.declinedAt, event: 'message', by: 'customer', note: 'Quote declined' });
    enquiry.history.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  const ordered = pending
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => (a.message.at < b.message.at ? -1 : a.message.at > b.message.at ? 1 : a.i - b.i));
  const messages = ordered.map((p, idx) => ({
    id: `msg_seed_${nn(Number(p.booking.id.slice(-2)))}_${p.role}`,
    ...p.message,
    seq: idx + 1
  }));

  return { bookings, blocks, messages, refSeq: 1043, quotes: quoteMap, adSpend: buildAdSpend(today) };
}

// ---------- ad spend: Facebook and Instagram for this month and the two before (this month is month-to-date) ----------

const AD_PLAN = [
  { back: 2, facebook: 260, instagram: 80 },
  { back: 1, facebook: 300, instagram: 90 },
  { back: 0, facebook: 300, instagram: 90 }
];

function buildAdSpend(today) {
  const entries = [];
  const dayOfMonth = Number(today.slice(8, 10));
  for (const plan of AD_PLAN) {
    let first = `${today.slice(0, 7)}-01`;
    for (let i = 0; i < plan.back; i += 1) first = `${addDays(first, -1).slice(0, 7)}-01`;
    const month = first.slice(0, 7);
    const lastDay = Number(addDays(`${addDays(first, 31).slice(0, 7)}-01`, -1).slice(8, 10));
    const share = plan.back === 0 ? Math.min(1, dayOfMonth / lastDay) : 1;
    for (const channel of ['facebook', 'instagram']) {
      const amount = plan.back === 0 ? Math.max(40, Math.round((plan[channel] * share) / 10) * 10) : plan[channel];
      entries.push({ id: `ad_seed_${month}_${channel}`, month, channel, amount, seed: true });
    }
  }
  return entries;
}
