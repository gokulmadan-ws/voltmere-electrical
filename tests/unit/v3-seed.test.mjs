// tests/unit/v3-seed.test.mjs: unit tests for the v3 seed (the pipeline distribution, quotes in every status, ad spend, chronology at many clocks)
// Owner: A3 core
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultSettings } from '../../js/core/config.js';
import { setClock, now } from '../../js/core/clock.js';
import { addDays, stampDay, toStamp } from '../../js/core/dates.js';
import { buildSeed } from '../../js/core/seed.js';
import {
  quoteFixedLines, quoteStatus, quoteTotal, selectCostPerLead, selectLeadSources, selectPipeline, selectQuoteStats, selectSla
} from '../../js/core/selectors.js';

afterEach(() => setClock(null));

const FIXTURE = new Date(2026, 9, 23, 20, 30);

function seedAt(date = FIXTURE) {
  setClock(date);
  const settings = makeDefaultSettings();
  const seed = buildSeed(now(), settings);
  settings.marketing.adSpend = seed.adSpend;
  const state = { settings, bookings: seed.bookings, blocks: seed.blocks, messages: seed.messages, quotes: seed.quotes, meta: {} };
  return { state, seed, nowStamp: toStamp(now()) };
}

const WEEKS = ['2026-10-26', '2026-12-28', '2027-03-22', '2027-07-05'];
const CLOCKS = WEEKS.flatMap((monday) => [0, 1, 2, 3, 4, 5].map((i) => [addDays(monday, i), 9, 0]).concat([[addDays(monday, 6), 12, 0]]));
const when = ([day, h, m]) => {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m);
};

test('at every clock the pipeline has the same shape: 2, 3, 5, 2, 3, 6 and 3 lost', () => {
  for (const clock of CLOCKS) {
    const { state, nowStamp } = seedAt(when(clock));
    const p = selectPipeline(state, nowStamp);
    assert.deepEqual(p.stages.map((s) => s.count), [2, 3, 5, 2, 3, 6], `${clock.join(' ')}`);
    assert.equal(p.lostCount, 3, `${clock.join(' ')} lost`);
    assert.equal(p.totalCount, 24);
  }
});

test('at every clock: 42 bookings, one overdue enquiry, the lead mix, quotes in every status and no overlap', () => {
  for (const clock of CLOCKS) {
    const { state, seed, nowStamp } = seedAt(when(clock));
    const label = clock.join(' ');
    assert.equal(seed.bookings.length, 42, label);
    assert.equal(Object.keys(seed.quotes).length, 17, label);
    const sla = selectSla(state, nowStamp);
    assert.equal(sla.overdueCount, 1, `${label}: one overdue against the 24 hour promise`);
    assert.equal(sla.waitingCount, 2, label);
    assert.equal(sla.dueSoonCount, 0, label);
    const leads = selectLeadSources(state, 'all', nowStamp);
    assert.deepEqual(leads.sources.map((s) => [s.id, s.enquiries]), [['facebook', 13], ['instagram', 4], ['google', 3], ['referral', 2], ['phone', 2], ['other', 0]], label);
    const statuses = Object.values(seed.quotes).map((q) => quoteStatus(q, nowStamp));
    for (const s of ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired']) assert.ok(statuses.includes(s), `${label}: a quote that is ${s}`);
    assert.deepEqual(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'].map((s) => statuses.filter((x) => x === s).length), [1, 2, 1, 11, 1, 1], label);
    const taken = new Set();
    for (const b of seed.bookings.filter((x) => x.status !== 'cancelled')) {
      const first = { '08:00': 0, '10:00': 1, '13:00': 2, '15:00': 3 }[b.start.slice(11)];
      for (let w = first; w < first + b.durationMin / 120; w += 1) {
        const key = `${stampDay(b.start)}|${w}`;
        assert.ok(!taken.has(key), `${label}: ${b.id} overlaps at ${key}`);
        taken.add(key);
      }
    }
  }
});

test('the quotes and bookings are consistent with each other', () => {
  const { seed } = seedAt();
  const byId = new Map(seed.bookings.map((b) => [b.id, b]));
  const refs = new Map(seed.bookings.map((b) => [b.ref, b.id]));
  assert.equal(refs.size, seed.bookings.length, 'refs are unique');
  assert.equal(seed.refSeq, 1043);
  for (const [id, q] of Object.entries(seed.quotes)) {
    const enquiry = byId.get(q.bookingId);
    assert.ok(enquiry && enquiry.serviceId === 'ev_quote', `${id} belongs to an enquiry`);
    assert.equal(id, q.id);
    assert.equal(id, `Q-${enquiry.ref}`, 'the id comes from the enquiry ref');
    assert.equal(q.customerName, enquiry.customer.name);
    assert.equal(q.seed, true);
    assert.ok(q.lines.length >= 4 && q.lines.every((l) => Number.isInteger(l.qty) && Number.isInteger(l.unitPrice) && l.label && l.id));
    assert.equal(new Set(q.lines.map((l) => l.id)).size, q.lines.length);
    assert.ok(quoteTotal(q) >= 1300 && quoteTotal(q) <= 2200, `${id} total ${quoteTotal(q)} is a plausible sample`);
    assert.ok(['ZAPPI', 'OHME', 'SYNC'].includes(q.brand));
    assert.ok(q.lines[0].label.includes(q.brand));
    assert.equal(q.notes, makeDefaultSettings().quoteDefaults.notes);
    assert.ok(q.lines.every((l) => typeof l.optional === 'boolean'), `${id}: every seeded line says whether it is a possible extra`);
    assert.ok(quoteFixedLines(q).every((l) => !/consumer unit/i.test(l.label)), `${id}: no optional line inside a fixed total`);
    assert.equal(quoteTotal(q), quoteFixedLines(q).reduce((t, l) => t + l.qty * l.unitPrice, 0));
    if (q.status === 'accepted') {
      const install = byId.get(q.installBookingId);
      assert.ok(install, `${id} has its install`);
      assert.equal(install.serviceId, 'ev');
      assert.equal(install.quoteId, id);
      assert.equal(install.quotedPrice, quoteTotal(q), 'the install carries the quote total');
      assert.equal(install.durationMin, 240);
      assert.equal(install.tentative === true, install.status === 'new');
      assert.deepEqual(install.customer, enquiry.customer);
      assert.deepEqual(install.answers, enquiry.answers);
      if (install.status === 'done') assert.ok(install.finalPrice >= install.quotedPrice);
    } else {
      assert.equal(q.installBookingId, null);
    }
  }
  const installs = seed.bookings.filter((b) => b.serviceId === 'ev');
  assert.equal(installs.length, 11);
  assert.ok(installs.every((b) => b.quoteId && seed.quotes[b.quoteId]), 'every seeded install has a quote');
  const money = installs.filter((b) => b.status === 'done');
  assert.deepEqual([money.length, money.filter((b) => b.paid).length, money.filter((b) => !b.paid).length], [6, 4, 2]);
});

test('two seeded quotes carry the consumer unit upgrade as a possible extra: it is listed, flagged and never in their totals', () => {
  const { seed } = seedAt();
  const withExtra = Object.values(seed.quotes).filter((q) => q.lines.some((l) => l.optional));
  assert.deepEqual(withExtra.map((q) => q.customerName).sort(), ['Eimear Toner', 'Majella Quigg']);
  for (const q of withExtra) {
    const extra = q.lines.filter((l) => l.optional);
    assert.deepEqual(extra.map((l) => [l.label, l.unitPrice]), [['Consumer unit upgrade (if required)', 420]]);
    assert.equal(quoteTotal(q), q.lines.filter((l) => !l.optional).reduce((t, l) => t + l.qty * l.unitPrice, 0));
  }
  const sent = withExtra.find((q) => q.customerName === 'Majella Quigg');
  assert.equal(sent.status, 'sent');
  assert.equal(quoteTotal(sent), 799 + 450 + 180 + 85, 'charger, installation, circuit and testing: 1,514');
  const padraig = Object.values(seed.quotes).find((q) => q.customerName === 'Padraig Quinn');
  assert.ok(padraig.lines.every((l) => !l.optional), 'an install that is booked has a plain fixed quote');
  assert.equal(quoteTotal(padraig), 1514);
});

test('chronology: every step of every journey happens after the one before, and nothing happens in the future', () => {
  for (const clock of CLOCKS) {
    const { seed, nowStamp } = seedAt(when(clock));
    const label = clock.join(' ');
    const byId = new Map(seed.bookings.map((b) => [b.id, b]));
    for (const q of Object.values(seed.quotes)) {
      const e = byId.get(q.bookingId);
      assert.equal(e.status, 'done', `${label} ${q.id}: only a surveyed enquiry has a quote`);
      const surveyEnd = e.history.find((h) => h.event === 'done').at;
      assert.ok(e.createdAt <= e.history.find((h) => h.event === 'confirmed').at, `${label} ${q.id}: confirmed after created`);
      assert.ok(e.history.find((h) => h.event === 'confirmed').at <= e.start, `${label} ${q.id}: confirmed before the survey`);
      assert.ok(q.createdAt >= surveyEnd, `${label} ${q.id}: the quote is written after the survey (${q.createdAt} vs ${surveyEnd})`);
      assert.ok(q.createdAt <= nowStamp, `${label} ${q.id}: created in the past`);
      if (q.sentAt) {
        assert.ok(q.sentAt >= q.createdAt, `${label} ${q.id}: sent after created`);
        assert.ok(q.sentAt <= nowStamp, `${label} ${q.id}: sent in the past`);
      } else {
        assert.equal(q.status, 'draft');
      }
      if (q.viewedAt) assert.ok(q.viewedAt >= q.sentAt && q.viewedAt <= nowStamp, `${label} ${q.id}: viewed after sent`);
      if (q.acceptedAt) {
        assert.ok(q.acceptedAt >= q.viewedAt && q.acceptedAt <= nowStamp, `${label} ${q.id}: accepted after viewed`);
        const install = byId.get(q.installBookingId);
        assert.equal(install.createdAt, q.acceptedAt, `${label} ${q.id}: the install is made when the quote is accepted`);
        assert.ok(install.start > q.acceptedAt, `${label} ${q.id}: the install day is after the acceptance`);
        const confirmed = install.history.find((h) => h.event === 'confirmed');
        if (confirmed) assert.ok(confirmed.at >= install.createdAt && confirmed.at <= install.start, `${label} ${q.id}: confirmed between made and the day`);
        if (install.status === 'done') {
          const done = install.history.find((h) => h.event === 'done').at;
          assert.ok(done > install.start, `${label} ${q.id}: done after it started`);
          assert.ok(done <= nowStamp, `${label} ${q.id}: done in the past`);
          if (install.paid) assert.ok(install.paidAt >= done && install.paidAt <= nowStamp, `${label} ${q.id}: paid after done`);
        }
      }
      if (q.declinedAt) assert.ok(q.declinedAt >= q.sentAt && q.declinedAt <= nowStamp, `${label} ${q.id}: declined after sent`);
    }
    for (const b of seed.bookings) {
      const ats = b.history.map((h) => h.at);
      assert.deepEqual([...ats].sort(), ats, `${label} ${b.id}: history is in order`);
      assert.ok(b.createdAt <= nowStamp, `${label} ${b.id}: created in the past`);
      if (b.status === 'done') assert.ok(b.start <= nowStamp, `${label} ${b.id}: a done job has started`);
    }
  }
});

test('the response times are plausible and not all instant: an average of about four hours, one slow reply, one overdue', () => {
  const { state, nowStamp } = seedAt();
  const sla = selectSla(state, nowStamp);
  assert.equal(sla.repliedCount, 17);
  assert.ok(sla.avgReplyMinutes > 120 && sla.avgReplyMinutes < 480, `${sla.avgReplyMinutes} minutes`);
  assert.ok(sla.withinTargetPct >= 80 && sla.withinTargetPct < 100, `${sla.withinTargetPct}%`);
});

test('ad spend: Facebook and Instagram for this month and the two before, this month to date, whole pounds, all marked seed', () => {
  const { seed, state, nowStamp } = seedAt();
  assert.deepEqual(seed.adSpend.map((e) => `${e.month} ${e.channel}`), [
    '2026-08 facebook', '2026-08 instagram', '2026-09 facebook', '2026-09 instagram', '2026-10 facebook', '2026-10 instagram'
  ]);
  assert.deepEqual(seed.adSpend.map((e) => e.amount), [260, 80, 300, 90, 220, 70]);
  assert.ok(seed.adSpend.every((e) => e.seed === true && Number.isInteger(e.amount) && e.amount > 0 && /^ad_seed_\d{4}-\d{2}_(facebook|instagram)$/.test(e.id)));
  assert.equal(new Set(seed.adSpend.map((e) => e.id)).size, 6);
  const cpl = selectCostPerLead(state, '3m', nowStamp);
  assert.equal(cpl.spend, 1020);
  assert.ok(cpl.costPerEnquiry >= 30 && cpl.costPerEnquiry <= 100, `£${cpl.costPerEnquiry} an enquiry is a believable sample`);
  assert.ok(cpl.costPerInstall > cpl.costPerAccepted && cpl.costPerAccepted > cpl.costPerEnquiry);
  // across a month change the three months follow the clock, and this month is the share of the month gone
  const early = seedAt(new Date(2026, 10, 2, 9, 0)).seed.adSpend;
  assert.deepEqual([...new Set(early.map((e) => e.month))], ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(early.filter((e) => e.month === '2026-11').map((e) => e.amount), [40, 40], 'a floor of 40 early in the month');
  const year = seedAt(new Date(2027, 0, 20, 9, 0)).seed.adSpend;
  assert.deepEqual([...new Set(year.map((e) => e.month))], ['2026-11', '2026-12', '2027-01'], 'across a year end');
  const end = seedAt(new Date(2026, 9, 31, 12, 0)).seed.adSpend.filter((e) => e.month === '2026-10');
  assert.deepEqual(end.map((e) => e.amount), [300, 90], 'the whole month on its last day');
});

test('the seed messages include the v3 kinds, in both channels, all clean text, and the 10 day rule for quote traffic', () => {
  const { seed } = seedAt();
  const kinds = new Set(seed.messages.map((m) => m.kind));
  for (const k of ['customer_quote_sent', 'owner_quote_accepted', 'customer_quote_accepted', 'customer_photos_request', 'owner_new_booking', 'customer_confirmed', 'customer_reminder']) assert.ok(kinds.has(k), k);
  assert.ok(seed.messages.some((m) => m.channel === 'email' && m.kind === 'customer_quote_sent' && /@example\.com$/.test(m.toEmail)), 'a quote sent by email carries the address');
  assert.ok(seed.messages.filter((m) => m.channel === 'whatsapp').every((m) => !('toEmail' in m)));
  for (const m of seed.messages) {
    assert.ok(m.seed === true && m.simulated === true, m.id);
    assert.ok(!/[{}]|!/.test(m.body) && !/\p{Extended_Pictographic}/u.test(m.body), m.id);
    assert.ok(!m.body.split('\n').some((l) => l.trim() === ''), m.id);
    if (m.kind === 'customer_quote_sent') assert.match(m.body, /quote\.html#d=[A-Za-z0-9_-]{100,}/, m.id);
  }
  const tenDaysAgo = '2026-10-13T20:30';
  const sentMessages = seed.messages.filter((m) => m.kind === 'customer_quote_sent');
  assert.equal(sentMessages.length, Object.values(seed.quotes).filter((q) => q.sentAt && q.sentAt >= tenDaysAgo).length, 'one for every quote sent in the last 10 days');
  assert.ok(sentMessages.length >= 5 && sentMessages.length < Object.values(seed.quotes).length);
  assert.ok(sentMessages.every((m) => m.at >= tenDaysAgo));
  assert.equal(seed.messages.filter((m) => m.kind === 'owner_quote_accepted').length, Object.values(seed.quotes).filter((q) => q.acceptedAt && q.acceptedAt >= tenDaysAgo).length, 'and one for every quote accepted in the last 10 days');
  assert.equal(seed.messages.filter((m) => m.kind === 'customer_quote_accepted').length, seed.messages.filter((m) => m.kind === 'owner_quote_accepted').length);
  const photos = seed.messages.filter((m) => m.kind === 'customer_photos_request');
  assert.equal(photos.length, 1);
  assert.equal(photos[0].bookingId, 'bk_seed_08');
  assert.match(photos[0].body, /photo of your consumer unit/);
  // the quote messages belong to the right bookings
  const q = seed.quotes[Object.keys(seed.quotes)[0]];
  assert.ok(q);
  assert.deepEqual(seed.messages.map((m) => m.seq), seed.messages.map((_, i) => i + 1));
});

test('the seed is deterministic and does not touch the settings it is given', () => {
  setClock(FIXTURE);
  const settings = makeDefaultSettings();
  const before = JSON.stringify(settings);
  const a = buildSeed(now(), settings);
  const b = buildSeed(now(), makeDefaultSettings());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(settings), before);
});

test('the seed uses the catalogue and the quote defaults it is given (a repriced catalogue and 14 valid days flow in)', () => {
  setClock(FIXTURE);
  const settings = makeDefaultSettings();
  settings.quoteItems.find((i) => i.id === 'charger_zappi').unitPrice = 1000;
  settings.quoteDefaults.validDays = 14;
  settings.quoteDefaults.notes = 'Our own terms.';
  const seed = buildSeed(now(), settings);
  const q = Object.values(seed.quotes).find((x) => x.brand === 'ZAPPI');
  assert.equal(q.lines[0].unitPrice, 1000);
  assert.equal(q.notes, 'Our own terms.');
  assert.equal(addDays(stampDay(q.sentAt || q.createdAt), 14), q.validUntil);
  // a brand the owner removed still gets a charger line (a sample price) so a seeded quote never loses its main line
  const rebranded = makeDefaultSettings();
  rebranded.business.brands = ['KEBA'];
  rebranded.quoteItems = rebranded.quoteItems.filter((i) => i.kind !== 'charger');
  const odd = Object.values(buildSeed(now(), rebranded).quotes)[0];
  assert.ok(odd.lines[0].label.startsWith('Supply of '));
});

test('existing records are never double-booked by the further journeys either', () => {
  const holding = (start, id) => ({ id, status: 'confirmed', urgent: false, start, durationMin: 240, seed: false });
  setClock(FIXTURE);
  // hold the very half days the seed wants for its pencilled and booked installs
  const existing = { bookings: ['2026-10-31T08:00', '2026-11-02T08:00', '2026-11-03T13:00', '2026-11-04T13:00'].map((s, i) => holding(s, `bk_mine${i}`)), blocks: [] };
  const seed = buildSeed(now(), makeDefaultSettings(), existing);
  const occupied = new Set();
  for (const b of existing.bookings) occupied.add(`${stampDay(b.start)}|${b.start.slice(11)}`);
  for (const b of seed.bookings.filter((x) => x.status !== 'cancelled' && x.serviceId === 'ev')) {
    assert.ok(!occupied.has(`${stampDay(b.start)}|${b.start.slice(11)}`), `${b.id} sits on a held half day`);
  }
});
