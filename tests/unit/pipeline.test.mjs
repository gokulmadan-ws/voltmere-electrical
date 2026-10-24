// tests/unit/pipeline.test.mjs: unit tests for js/core/pipeline.js (stages, SLA, lead sources, cost per lead, quote stats and lists)
// Owner: A3 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AD_CHANNELS, LEAD_SOURCES, LEAD_SOURCE_LABELS, PIPELINE_STAGES, SLA_DUE_SOON_MINUTES, makeDefaultSettings } from '../../js/core/config.js';
import { now, setClock } from '../../js/core/clock.js';
import { buildSeed } from '../../js/core/seed.js';
import {
  RANGE_PRESETS, isFreeVisit, leadSourceOf, resolveRange, selectCostPerLead, selectJourney, selectLeadSources, selectPipeline, selectQuote, selectQuoteDetail,
  selectQuoteForBooking, selectQuoteList, selectQuoteStats, selectQuotes, selectQuotesForBooking, selectSla
} from '../../js/core/selectors.js';

const NOW = '2026-10-23T20:30';

beforeEach(() => setClock(new Date(2026, 9, 23, 20, 30)));
afterEach(() => setClock(null));

function seedState() {
  const settings = makeDefaultSettings();
  const seed = buildSeed(now(), settings);
  settings.marketing.adSpend = seed.adSpend;
  return { settings, bookings: seed.bookings, blocks: seed.blocks, messages: seed.messages, quotes: seed.quotes, meta: { messagesSeenSeq: 0 } };
}

let seq = 0;
function enquiry(over = {}) {
  seq += 1;
  return {
    id: `bk_e${seq}`, ref: `EL-${2000 + seq}`, createdAt: '2026-10-20T09:00', serviceId: 'ev_quote', serviceName: 'Home EV charger quote', start: '2026-10-24T08:00', durationMin: 120,
    status: 'new', urgent: false, customer: { name: `Customer ${seq}`, phone: `07700 9007${String(seq).padStart(2, '0')}`, email: '' }, address: { line1: '', postcode: 'BT9 6QP' }, notes: '',
    source: 'website', quotedPrice: 0, finalPrice: null, paid: false, paidMethod: null, paidAt: null, cancelledBy: null, cancelReason: '', seed: false,
    history: [{ at: '2026-10-20T09:00', event: 'created', by: 'customer', note: 'website' }], ...over
  };
}
function install(over = {}) {
  seq += 1;
  return { ...enquiry({ id: `bk_i${seq}`, serviceId: 'ev', serviceName: 'EV charger installation', durationMin: 240, start: '2026-10-30T08:00', status: 'confirmed', quotedPrice: 1500 }), ...over };
}
function quote(bookingId, over = {}) {
  seq += 1;
  return {
    id: `Q-T-${seq}`, bookingId, customerName: 'Customer', createdAt: '2026-10-21T10:00', status: 'draft', brand: 'ZAPPI',
    lines: [{ id: 'l1', label: 'Charger', detail: '', qty: 1, unitPrice: 1500 }], notes: '', validUntil: '2026-11-20', sentAt: null, sentVia: null, viewedAt: null,
    acceptedAt: null, declinedAt: null, declineReason: '', installBookingId: null, seed: false, ...over
  };
}
const stateOf = (bookings, quotes = [], settings = makeDefaultSettings()) => ({ settings, bookings, blocks: [], messages: [], quotes: Object.fromEntries(quotes.map((q) => [q.id, q])), meta: {} });
const stageOf = (state, bookingId) => {
  const p = selectPipeline(state, NOW);
  const hit = p.stages.flatMap((s) => s.items).concat(p.lost).find((i) => i.bookingId === bookingId);
  return hit ? hit.stage : null;
};

// ---------- config ----------

test('PIPELINE_STAGES: the six stages then lost, with labels and hints; lead sources and ad channels', () => {
  assert.deepEqual(PIPELINE_STAGES.map((s) => s.id), ['enquiry', 'survey', 'quote', 'accepted', 'install', 'done', 'lost']);
  assert.deepEqual(PIPELINE_STAGES.map((s) => s.label), ['Enquiry', 'Survey', 'Quote', 'Accepted', 'Install', 'Done', 'Lost']);
  assert.ok(PIPELINE_STAGES.every((s) => s.hint.length > 5));
  assert.deepEqual(LEAD_SOURCES, ['facebook', 'instagram', 'google', 'referral', 'phone', 'other']);
  assert.deepEqual(Object.keys(LEAD_SOURCE_LABELS), LEAD_SOURCES);
  assert.equal(LEAD_SOURCE_LABELS.other, 'Direct or other');
  assert.deepEqual(AD_CHANNELS, ['facebook', 'instagram', 'google', 'other']);
  assert.equal(SLA_DUE_SOON_MINUTES, 240);
});

// ---------- the seed pipeline ----------

test('the v3 seed fills every stage: 2, 3, 5, 2, 3, 6 and 3 lost', () => {
  const p = selectPipeline(seedState(), NOW);
  assert.deepEqual(p.stages.map((s) => [s.id, s.count]), [['enquiry', 2], ['survey', 3], ['quote', 5], ['accepted', 2], ['install', 3], ['done', 6]]);
  assert.equal(p.lostCount, 3);
  assert.equal(p.lost.length, 3);
  assert.equal(p.totalCount, 24 + 0, 'the 24 enquiries; every install belongs to one of them');
  const ids = (id) => p.stages.find((s) => s.id === id).items.map((i) => i.bookingId);
  assert.deepEqual(ids('enquiry'), ['bk_seed_11', 'bk_seed_07'], 'oldest first: the overdue one on top');
  assert.deepEqual(ids('survey'), ['bk_seed_08', 'bk_seed_12', 'bk_seed_14'], 'next survey first');
  assert.deepEqual(ids('quote').sort(), ['bk_seed_16', 'bk_seed_17', 'bk_seed_18', 'bk_seed_19', 'bk_seed_20']);
  assert.deepEqual(ids('accepted').sort(), ['bk_seed_21', 'bk_seed_22']);
  assert.deepEqual(ids('install'), ['bk_seed_25', 'bk_seed_23', 'bk_seed_24'], 'the earliest install day first');
  assert.deepEqual(p.lost.map((i) => i.bookingId).sort(), ['bk_seed_15', 'bk_seed_32', 'bk_seed_33']);
  assert.deepEqual(p.stages.find((s) => s.id === 'done').items.filter((i) => i.paid).length, 4, 'four paid');
  assert.deepEqual(p.stages.find((s) => s.id === 'done').items.filter((i) => !i.paid).length, 2, 'two owed');
});

test('pipeline items: the shape, SLA flags only on waiting enquiries, value and summary in plain words', () => {
  const p = selectPipeline(seedState(), NOW);
  const all = p.stages.flatMap((s) => s.items).concat(p.lost);
  for (const item of all) {
    assert.deepEqual(Object.keys(item).sort(), ['ageMinutes', 'bookingId', 'customerKey', 'customerName', 'installBookingId', 'leadSource', 'paid', 'postcode', 'quoteId', 'quoteStatus', 'ref', 'sla', 'stage', 'stageSince', 'standalone', 'summary', 'value'].sort(), item.bookingId);
    assert.ok(Number.isInteger(item.value) && item.value >= 0 && Number.isInteger(item.ageMinutes) && item.ageMinutes >= 0, item.bookingId);
    assert.ok(item.summary.length > 5 && !/[{}]/.test(item.summary) && !item.summary.includes('!'), `${item.bookingId}: ${item.summary}`);
    assert.ok(LEAD_SOURCES.includes(item.leadSource));
    assert.equal(item.standalone, false);
    if (item.stage !== 'enquiry') assert.equal(item.sla, null, `${item.bookingId} only waiting enquiries carry an SLA flag`);
  }
  const conor = all.find((i) => i.bookingId === 'bk_seed_11');
  const sinead = all.find((i) => i.bookingId === 'bk_seed_07');
  assert.equal(conor.sla, 'overdue');
  assert.equal(conor.ageMinutes, 30 * 60);
  assert.equal(sinead.sla, 'ok');
  assert.equal(sinead.ageMinutes, 12);
  assert.equal(conor.customerName, 'Conor Brennan');
  assert.equal(conor.postcode, 'DG9 8AB');
  assert.equal(conor.customerKey, '447700900219');
  assert.equal(conor.leadSource, 'google');
  assert.equal(conor.value, 0, 'no quote yet, no value');
  assert.match(conor.summary, /^Survey pencilled in Tue 27 Oct, 10am–12\./);
  assert.match(sinead.summary, /Wants it as soon as possible$/);
  const quoteOut = all.find((i) => i.bookingId === 'bk_seed_19');
  assert.equal(quoteOut.quoteStatus, 'viewed');
  assert.equal(quoteOut.value, 679 + 450 + 180 + 85 + 95);
  assert.equal(quoteOut.summary, 'Quote £1,489 viewed by the customer');
  assert.equal(quoteOut.ageMinutes, 26 * 60, 'in the quote stage since it was sent');
  assert.equal(all.find((i) => i.bookingId === 'bk_seed_16').summary, 'Survey done, quote to write');
  assert.equal(all.find((i) => i.bookingId === 'bk_seed_17').summary, 'Draft quote £1,394, not sent yet');
  assert.equal(all.find((i) => i.bookingId === 'bk_seed_18').summary, 'Quote £1,586 sent, not opened yet');
  assert.match(all.find((i) => i.bookingId === 'bk_seed_21').summary, /^Accepted £1,364\. Install pencilled in Sat 31 Oct, 8am–12$/);
  assert.match(all.find((i) => i.bookingId === 'bk_seed_23').summary, /^Install Mon 2 Nov, 8am–12$/);
  const done = all.find((i) => i.bookingId === 'bk_seed_27');
  assert.equal(done.stage, 'done');
  assert.equal(done.value, 1490, 'the money earned: the install final price');
  assert.match(done.summary, /^Installed Sat 19 Sep, paid £1,490$/);
  assert.equal(all.find((i) => i.bookingId === 'bk_seed_30').summary.endsWith('to collect £1,550'), true);
  assert.deepEqual(p.lost.map((i) => i.summary).sort(), ['Cancelled by the customer', 'Quote declined: Found a lower price elsewhere', 'Quote £1,394 expired']);
});

test('stage totals: counts and values add up; openValue is everything not yet installed', () => {
  const p = selectPipeline(seedState(), NOW);
  for (const stage of p.stages) {
    assert.equal(stage.count, stage.items.length);
    assert.equal(stage.value, stage.items.reduce((t, i) => t + i.value, 0), stage.id);
  }
  assert.equal(p.openValue, p.stages.filter((s) => s.id !== 'done').reduce((t, s) => t + s.value, 0));
  assert.equal(p.stages.find((s) => s.id === 'enquiry').value, 0);
  assert.equal(p.stages.find((s) => s.id === 'done').value, 8771);
  assert.equal(p.lostValue, p.lost.reduce((t, i) => t + i.value, 0));
  assert.ok(p.lostValue > 0, 'the declined and expired quotes still show what was lost');
  assert.equal(p.totalCount, p.stages.reduce((t, s) => t + s.count, 0) + p.lostCount);
});

// ---------- the stage rules ----------

test('stage rules: the enquiry itself decides until a quote exists (pending, confirmed, on the way, done)', () => {
  const states = {
    new: enquiry({ status: 'new' }),
    confirmed: enquiry({ status: 'confirmed' }),
    on_the_way: enquiry({ status: 'on_the_way' }),
    done: enquiry({ status: 'done', finalPrice: 0 })
  };
  const s = stateOf(Object.values(states));
  assert.equal(stageOf(s, states.new.id), 'enquiry');
  assert.equal(stageOf(s, states.confirmed.id), 'survey');
  assert.equal(stageOf(s, states.on_the_way.id), 'survey');
  assert.equal(stageOf(s, states.done.id), 'quote', 'survey done and no quote: a quote to write');
  const cancelled = enquiry({ status: 'cancelled', cancelledBy: 'owner', cancelReason: 'declined' });
  assert.equal(stageOf(stateOf([cancelled]), cancelled.id), 'lost');
});

test('stage rules: a draft, sent or viewed quote keeps a surveyed enquiry in Quote; a sent quote moves an enquiry on before its survey', () => {
  const e = enquiry({ status: 'done', finalPrice: 0 });
  for (const status of ['draft', 'sent', 'viewed']) {
    assert.equal(stageOf(stateOf([e], [quote(e.id, { status, sentAt: status === 'draft' ? null : '2026-10-22T09:00' })]), e.id), 'quote', status);
  }
  const early = enquiry({ status: 'confirmed' });
  assert.equal(stageOf(stateOf([early], [quote(early.id, { status: 'draft' })]), early.id), 'survey', 'a draft changes nothing');
  assert.equal(stageOf(stateOf([early], [quote(early.id, { status: 'sent', sentAt: '2026-10-22T09:00' })]), early.id), 'quote', 'a quote sent before the survey puts it in Quote');
  const pending = enquiry({ status: 'new' });
  assert.equal(stageOf(stateOf([pending], [quote(pending.id, { status: 'viewed', sentAt: '2026-10-22T09:00' })]), pending.id), 'quote');
});

test('stage rules: declined and expired quotes are lost, and expiry is derived from validUntil and the clock', () => {
  const e = enquiry({ status: 'done', finalPrice: 0 });
  assert.equal(stageOf(stateOf([e], [quote(e.id, { status: 'declined', declinedAt: '2026-10-22T09:00', sentAt: '2026-10-21T09:00' })]), e.id), 'lost');
  const lastDay = quote(e.id, { status: 'sent', sentAt: '2026-10-01T09:00', validUntil: '2026-10-23' });
  assert.equal(stageOf(stateOf([e], [lastDay]), e.id), 'quote', 'valid through its last day');
  const pastDay = quote(e.id, { status: 'sent', sentAt: '2026-10-01T09:00', validUntil: '2026-10-22' });
  assert.equal(stageOf(stateOf([e], [pastDay]), e.id), 'lost', 'the day after: expired');
  const viewedPast = quote(e.id, { status: 'viewed', sentAt: '2026-10-01T09:00', validUntil: '2026-10-22' });
  assert.equal(stageOf(stateOf([e], [viewedPast]), e.id), 'lost');
  const item = selectPipeline(stateOf([e], [pastDay]), NOW).lost[0];
  assert.equal(item.quoteStatus, 'expired');
  assert.match(item.summary, /expired$/);
  // the same state a day earlier is still open
  assert.equal(selectPipeline(stateOf([e], [pastDay]), '2026-10-22T10:00').lost.length, 0);
});

test('stage rules: an accepted quote is Accepted until an install is confirmed, Install while booked, Done once installed', () => {
  const e = enquiry({ status: 'done', finalPrice: 0 });
  const q = (installId) => quote(e.id, { status: 'accepted', sentAt: '2026-10-22T09:00', acceptedAt: '2026-10-22T12:00', installBookingId: installId });
  assert.equal(stageOf(stateOf([e], [q(null)]), e.id), 'accepted', 'accepted with no install booking yet');
  const mk = (status, extra = {}) => {
    const qq = q('inst');
    return { qq, inst: install({ id: 'inst', quoteId: qq.id, status, ...extra }) };
  };
  for (const [status, stage] of [['new', 'accepted'], ['confirmed', 'install'], ['on_the_way', 'install'], ['done', 'done'], ['cancelled', 'accepted']]) {
    const { qq, inst } = mk(status, status === 'done' ? { finalPrice: 1600, paid: true } : {});
    assert.equal(stageOf(stateOf([e, inst], [qq]), e.id), stage, `install ${status} -> ${stage}`);
  }
  // an accepted quote wins over a cancelled enquiry (the customer said yes, the owner still has work to do)
  const cancelledEnquiry = enquiry({ status: 'cancelled', cancelledBy: 'owner' });
  const qq = quote(cancelledEnquiry.id, { status: 'accepted', sentAt: '2026-10-22T09:00', acceptedAt: '2026-10-22T12:00' });
  assert.equal(stageOf(stateOf([cancelledEnquiry], [qq]), cancelledEnquiry.id), 'accepted');
});

test('stage rules: the quote that counts is the accepted one, else the newest; an install is found by quoteId or installBookingId', () => {
  const e = enquiry({ status: 'done', finalPrice: 0 });
  const first = quote(e.id, { id: 'Q-A', createdAt: '2026-10-20T09:00', status: 'declined', sentAt: '2026-10-20T10:00', declinedAt: '2026-10-21T10:00' });
  const second = quote(e.id, { id: 'Q-A-2', createdAt: '2026-10-22T09:00', status: 'draft' });
  assert.equal(stageOf(stateOf([e], [first, second]), e.id), 'quote', 'the newer quote replaces the declined one');
  assert.equal(stageOf(stateOf([e], [first]), e.id), 'lost');
  const accepted = { ...first, status: 'accepted', acceptedAt: '2026-10-21T12:00' };
  assert.equal(stageOf(stateOf([e], [accepted, second]), e.id), 'accepted', 'an accepted quote beats a newer draft');
  const byLink = install({ id: 'inst_b', quoteId: undefined, status: 'confirmed' });
  assert.equal(stageOf(stateOf([e, byLink], [{ ...accepted, installBookingId: 'inst_b' }]), e.id), 'install', 'found by installBookingId');
  const byQuoteId = install({ id: 'inst_c', quoteId: 'Q-A', status: 'confirmed' });
  assert.equal(stageOf(stateOf([e, byQuoteId], [accepted]), e.id), 'install', 'found by quoteId');
  const cancelledOld = install({ id: 'inst_old', quoteId: 'Q-A', status: 'cancelled' });
  assert.equal(stageOf(stateOf([e, cancelledOld, byQuoteId], [accepted]), e.id), 'install', 'a live install beats a cancelled one');
});

test('stage rules: an install with no quote link is a standalone install and still shows in the pipeline', () => {
  const live = install({ status: 'confirmed' });
  const done = install({ status: 'done', finalPrice: 1450, paid: true });
  const pencilled = install({ status: 'new', tentative: true });
  const gone = install({ status: 'cancelled', cancelledBy: 'owner' });
  const s = stateOf([live, done, pencilled, gone]);
  const p = selectPipeline(s, NOW);
  assert.deepEqual([live, done, pencilled, gone].map((b) => stageOf(s, b.id)), ['install', 'done', 'install', 'lost']);
  const item = p.stages.find((x) => x.id === 'done').items[0];
  assert.equal(item.standalone, true);
  assert.equal(item.value, 1450);
  assert.equal(item.paid, true);
  assert.equal(item.installBookingId, done.id);
  assert.equal(item.quoteId, null);
  assert.equal(item.sla, null);
  assert.equal(p.stages.find((x) => x.id === 'enquiry').count, 0, 'standalone installs are never enquiries');
  // an install pointing at a quote that no longer exists is also standalone
  const orphan = install({ quoteId: 'Q-GONE', status: 'confirmed' });
  assert.equal(selectPipeline(stateOf([orphan]), NOW).stages.find((x) => x.id === 'install').items[0].standalone, true);
});

test('an install of a journey is never listed twice, and urgent bookings are never enquiries', () => {
  const e = enquiry({ status: 'done', finalPrice: 0 });
  const qq = quote(e.id, { status: 'accepted', sentAt: '2026-10-22T09:00', acceptedAt: '2026-10-22T12:00', installBookingId: 'i1' });
  const inst = install({ id: 'i1', quoteId: qq.id, status: 'confirmed' });
  const urgent = enquiry({ urgent: true, status: 'new', start: NOW, durationMin: 0 });
  const p = selectPipeline(stateOf([e, inst, urgent], [qq]), NOW);
  assert.equal(p.totalCount, 1);
  assert.equal(p.stages.find((s) => s.id === 'install').items[0].bookingId, e.id, 'the item is the enquiry, with the install attached');
  assert.equal(p.stages.find((s) => s.id === 'install').items[0].installBookingId, 'i1');
});

test('pipeline value: the quote total from the quote stage on, the install price when done, 0 before a quote', () => {
  const e1 = enquiry({ status: 'confirmed' });
  const e2 = enquiry({ status: 'done', finalPrice: 0 });
  const q2 = quote(e2.id, { status: 'sent', sentAt: '2026-10-22T09:00', lines: [{ id: 'a', label: 'a', detail: '', qty: 2, unitPrice: 700 }, { id: 'b', label: 'disc', detail: '', qty: 1, unitPrice: -100 }] });
  const p = selectPipeline(stateOf([e1, e2], [q2]), NOW);
  assert.equal(p.stages.find((s) => s.id === 'survey').items[0].value, 0);
  assert.equal(p.stages.find((s) => s.id === 'quote').items[0].value, 1300);
  const e3 = enquiry({ status: 'done', finalPrice: 0 });
  const q3 = quote(e3.id, { status: 'accepted', sentAt: '2026-10-22T09:00', acceptedAt: '2026-10-22T12:00', installBookingId: 'i3' });
  const i3 = install({ id: 'i3', quoteId: q3.id, status: 'done', quotedPrice: 1500, finalPrice: 1560, paid: false });
  const done = selectPipeline(stateOf([e3, i3], [q3]), NOW).stages.find((s) => s.id === 'done').items[0];
  assert.equal(done.value, 1560);
  assert.equal(done.paid, false);
  assert.match(done.summary, /to collect £1,560$/);
});

test('stageSince and ageMinutes: from the moment each item entered its stage', () => {
  const e = enquiry({ status: 'new', createdAt: '2026-10-23T18:30', history: [{ at: '2026-10-23T18:30', event: 'created', by: 'customer' }] });
  const surveyed = enquiry({ status: 'confirmed', createdAt: '2026-10-20T09:00', history: [{ at: '2026-10-20T09:00', event: 'created', by: 'customer' }, { at: '2026-10-20T10:00', event: 'confirmed', by: 'owner' }] });
  const needsQuote = enquiry({ status: 'done', finalPrice: 0, start: '2026-10-22T08:00', history: [{ at: '2026-10-19T09:00', event: 'created', by: 'customer' }, { at: '2026-10-22T10:00', event: 'done', by: 'owner' }] });
  const sentTo = enquiry({ status: 'done', finalPrice: 0 });
  const sent = quote(sentTo.id, { status: 'sent', sentAt: '2026-10-22T20:30' });
  const p = selectPipeline(stateOf([e, surveyed, needsQuote, sentTo], [sent]), NOW);
  const by = (id) => p.stages.flatMap((s) => s.items).find((i) => i.bookingId === id);
  assert.deepEqual([by(e.id).stageSince, by(e.id).ageMinutes], ['2026-10-23T18:30', 120]);
  assert.deepEqual([by(surveyed.id).stageSince, by(surveyed.id).ageMinutes], ['2026-10-20T10:00', 3 * 24 * 60 + 10 * 60 + 30]);
  assert.equal(by(needsQuote.id).stageSince, '2026-10-22T10:00');
  assert.deepEqual([by(sentTo.id).stageSince, by(sentTo.id).ageMinutes], ['2026-10-22T20:30', 24 * 60]);
});

// ---------- selectJourney ----------

test('selectJourney: the enquiry, quote and install for any booking in the chain; null for none', () => {
  const s = seedState();
  const fromEnquiry = selectJourney(s, 'bk_seed_21', NOW);
  assert.equal(fromEnquiry.stage, 'accepted');
  assert.equal(fromEnquiry.enquiry.id, 'bk_seed_21');
  assert.equal(fromEnquiry.install.id, 'bk_seed_34');
  assert.equal(fromEnquiry.quote.status, 'accepted');
  assert.equal(fromEnquiry.standalone, false);
  const fromInstall = selectJourney(s, 'bk_seed_34', NOW);
  assert.equal(fromInstall.enquiry.id, 'bk_seed_21');
  assert.equal(fromInstall.quote.id, fromEnquiry.quote.id);
  assert.deepEqual(Object.keys(selectJourney(s, 'bk_seed_07', NOW)).sort(), ['enquiry', 'install', 'quote', 'stage', 'standalone']);
  assert.equal(selectJourney(s, 'bk_seed_07', NOW).quote, null);
  assert.equal(selectJourney(s, 'bk_seed_07', NOW).install, null);
  assert.equal(selectJourney(s, 'bk_seed_01', NOW), null, 'a phone job is not in a journey');
  assert.equal(selectJourney(s, 'nope', NOW), null);
  const solo = install();
  assert.equal(selectJourney(stateOf([solo]), solo.id, NOW).standalone, true);
});

// ---------- SLA ----------

test('selectSla on the seed: one overdue, nothing due soon, the average and the share within the 24 hour promise', () => {
  const sla = selectSla(seedState(), NOW);
  assert.equal(sla.replyHours, 24);
  assert.equal(sla.overdueCount, 1);
  assert.equal(sla.dueSoonCount, 0);
  assert.equal(sla.waitingCount, 2);
  assert.deepEqual(sla.overdue, [{ bookingId: 'bk_seed_11', ref: 'EL-1038', customerName: 'Conor Brennan', createdAt: '2026-10-22T14:30', dueAt: '2026-10-23T14:30', minutesOverdue: 360 }]);
  assert.deepEqual(sla.dueSoon, []);
  assert.equal(sla.repliedCount, 17, 'only enquiries a customer made themselves, and the owner answered');
  assert.equal(sla.avgReplyMinutes, 254);
  assert.equal(sla.withinTargetPct, 89, '16 of 17 replies inside 24 hours, plus the one overdue one counted as a miss: 16 / 18');
});

test('selectSla: waiting, overdue, due soon (inside 4 hours) and the clock', () => {
  const at = (iso) => ({ createdAt: iso, history: [{ at: iso, event: 'created', by: 'customer' }] });
  const fresh = enquiry(at('2026-10-23T20:00'));
  const soon = enquiry(at('2026-10-22T18:00')); // due 2026-10-23T18:00 -> overdue at 20:30; make one due soon instead
  const dueSoon = enquiry(at('2026-10-22T23:00')); // due 23:00 tonight: 150 min left
  const edge = enquiry(at('2026-10-22T20:30')); // due exactly now: 0 minutes left is due soon, not overdue
  const justOver = enquiry(at('2026-10-22T20:29')); // one minute overdue
  const farOff = enquiry(at('2026-10-23T09:00')); // due tomorrow 09:00: 12.5 h left, ok
  const s = stateOf([fresh, soon, dueSoon, edge, justOver, farOff]);
  const sla = selectSla(s, NOW);
  assert.deepEqual(sla.overdue.map((r) => [r.bookingId, r.minutesOverdue]), [[soon.id, 150], [justOver.id, 1]], 'oldest first');
  assert.deepEqual(sla.dueSoon.map((r) => [r.bookingId, r.minutesLeft]), [[edge.id, 0], [dueSoon.id, 150]], 'soonest first');
  assert.equal(sla.waitingCount, 6);
  assert.equal(sla.avgReplyMinutes, null, 'nothing answered yet');
  assert.equal(sla.withinTargetPct, 0, 'two overdue and nobody answered in time');
  const items = selectPipeline(s, NOW).stages.find((x) => x.id === 'enquiry').items;
  const flag = (b) => items.find((i) => i.bookingId === b.id).sla;
  assert.deepEqual([flag(fresh), flag(soon), flag(dueSoon), flag(edge), flag(justOver), flag(farOff)], ['ok', 'overdue', 'due_soon', 'due_soon', 'overdue', 'ok']);
  // later in the evening the due-soon one is overdue
  assert.equal(selectSla(s, '2026-10-23T23:01').overdueCount, 4);
  assert.equal(selectSla(s).waitingCount, 6, 'defaults to the clock');
});

test('selectSla: a reply is the first owner action; system, customer, note and paid entries never count; owner-made enquiries are left out', () => {
  const customerMade = (replyEvent, by = 'owner', replyAt = '2026-10-20T11:00') => enquiry({
    createdAt: '2026-10-20T09:00', status: 'confirmed',
    history: [{ at: '2026-10-20T09:00', event: 'created', by: 'customer' }, ...(replyEvent ? [{ at: replyAt, event: replyEvent, by }] : [])]
  });
  const confirmed = customerMade('confirmed');
  const declined = customerMade('declined', 'owner', '2026-10-20T09:30');
  const messaged = customerMade('message', 'owner', '2026-10-20T13:00');
  const rescheduled = customerMade('rescheduled', 'owner', '2026-10-21T09:00'); // exactly 24 h: inside the promise
  const slow = customerMade('confirmed', 'owner', '2026-10-21T09:01'); // 24 h 1 min: a miss
  const bySystem = customerMade('confirmed', 'system');
  const byCustomer = customerMade('rescheduled', 'customer');
  const noteOnly = customerMade('note', 'owner');
  const ownerMade = enquiry({ status: 'confirmed', createdAt: '2026-10-20T09:00', history: [{ at: '2026-10-20T09:00', event: 'created', by: 'owner', note: 'phone' }, { at: '2026-10-20T09:01', event: 'confirmed', by: 'owner' }] });
  const sla = selectSla(stateOf([confirmed, declined, messaged, rescheduled, slow, bySystem, byCustomer, noteOnly, ownerMade]), NOW);
  assert.equal(sla.repliedCount, 5, 'confirmed, declined, messaged, rescheduled, slow');
  assert.equal(sla.avgReplyMinutes, Math.round((120 + 30 + 240 + 1440 + 1441) / 5));
  assert.equal(sla.withinTargetPct, 80, '4 of 5 inside 24 hours');
  assert.equal(sla.waitingCount, 0, 'none of them are pending');
  // a pending enquiry the owner has already answered is not waiting
  const answeredButOpen = enquiry({ status: 'new', createdAt: '2026-10-21T09:00', history: [{ at: '2026-10-21T09:00', event: 'created', by: 'customer' }, { at: '2026-10-21T10:00', event: 'rescheduled', by: 'owner' }] });
  assert.equal(selectSla(stateOf([answeredButOpen]), NOW).waitingCount, 0);
  assert.equal(selectPipeline(stateOf([answeredButOpen]), NOW).stages[0].items[0].sla, null, 'no flag once he has replied');
  assert.equal(selectSla(stateOf([]), NOW).withinTargetPct, null);
});

test('selectSla follows settings.sla.replyHours', () => {
  const settings = makeDefaultSettings();
  settings.sla.replyHours = 2;
  const e = enquiry({ createdAt: '2026-10-23T18:00', history: [{ at: '2026-10-23T18:00', event: 'created', by: 'customer' }] });
  const sla = selectSla(stateOf([e], [], settings), NOW);
  assert.equal(sla.replyHours, 2);
  assert.equal(sla.overdueCount, 1);
  assert.equal(sla.overdue[0].dueAt, '2026-10-23T20:00');
  assert.equal(selectPipeline(stateOf([e], [], settings), NOW).stages[0].items[0].sla, 'overdue');
  settings.sla.replyHours = 72;
  assert.equal(selectSla(stateOf([e], [], settings), NOW).overdueCount, 0);
  delete settings.sla;
  assert.equal(selectSla(stateOf([e], [], settings), NOW).replyHours, 24, 'an older state falls back to the 24 hour promise');
});

// ---------- ranges, lead sources, cost per lead ----------

test('resolveRange: presets and explicit ranges as inclusive day keys', () => {
  assert.deepEqual(resolveRange(undefined, NOW), { from: null, to: null, preset: 'all' });
  assert.deepEqual(resolveRange('all', NOW), { from: null, to: null, preset: 'all' });
  assert.deepEqual(resolveRange('nonsense', NOW), { from: null, to: null, preset: 'all' });
  assert.deepEqual(resolveRange('7d', NOW), { from: '2026-10-17', to: '2026-10-23', preset: '7d' });
  assert.deepEqual(resolveRange('30d', NOW), { from: '2026-09-24', to: '2026-10-23', preset: '30d' });
  assert.deepEqual(resolveRange('90d', NOW), { from: '2026-07-26', to: '2026-10-23', preset: '90d' });
  assert.deepEqual(resolveRange('month', NOW), { from: '2026-10-01', to: '2026-10-23', preset: 'month' });
  assert.deepEqual(resolveRange('last_month', NOW), { from: '2026-09-01', to: '2026-09-30', preset: 'last_month' });
  assert.deepEqual(resolveRange('3m', NOW), { from: '2026-08-01', to: '2026-10-23', preset: '3m' });
  assert.deepEqual(resolveRange('3m', '2026-01-15T10:00'), { from: '2025-11-01', to: '2026-01-15', preset: '3m' }, 'across a year end');
  assert.deepEqual(resolveRange('last_month', '2026-01-15T10:00'), { from: '2025-12-01', to: '2025-12-31', preset: 'last_month' });
  assert.deepEqual(resolveRange({ from: '2026-10-01', to: '2026-10-15' }, NOW), { from: '2026-10-01', to: '2026-10-15', preset: null });
  assert.deepEqual(resolveRange({ from: '2026-10-01' }, NOW), { from: '2026-10-01', to: null, preset: null });
  assert.deepEqual(resolveRange({ from: 'x', to: '2026-02-31' }, NOW), { from: null, to: null, preset: null }, 'junk is an open range');
  assert.deepEqual(resolveRange('month'), resolveRange('month', NOW), 'defaults to the clock');
  assert.deepEqual(RANGE_PRESETS.map((p) => p.id), ['all', '7d', '30d', '90d', 'month', 'last_month', '3m']);
  assert.ok(RANGE_PRESETS.every((p) => p.label.length > 3));
});

test('leadSourceOf: the utm source, else how it was logged: phone, word of mouth, anything else is other', () => {
  assert.equal(leadSourceOf({ utm: { source: 'instagram' }, source: 'phone' }), 'instagram', 'a utm wins');
  assert.equal(leadSourceOf({ source: 'phone' }), 'phone');
  assert.equal(leadSourceOf({ source: 'referral' }), 'referral');
  assert.equal(leadSourceOf({ source: 'website' }), 'other');
  assert.equal(leadSourceOf({ source: 'whatsapp' }), 'other');
  assert.equal(leadSourceOf({ utm: { source: 'bogus' }, source: 'referral' }), 'referral', 'an unknown utm source is ignored');
  assert.equal(leadSourceOf({}), 'other');
  assert.equal(leadSourceOf(null), 'other');
});

test('selectLeadSources on the seed: 13 Facebook, 4 Instagram, 3 Google, 2 word of mouth, 2 phone', () => {
  const r = selectLeadSources(seedState(), 'all', NOW);
  assert.deepEqual(r.sources.map((s) => [s.id, s.enquiries]), [['facebook', 13], ['instagram', 4], ['google', 3], ['referral', 2], ['phone', 2], ['other', 0]]);
  assert.deepEqual(r.sources.map((s) => s.sharePct), [54, 17, 13, 8, 8, 0], '13 of 24 is about 55 percent');
  assert.deepEqual(r.range, { from: null, to: null, preset: 'all' });
  assert.deepEqual(r.total, { enquiries: 24, quotes: 16, accepted: 11, installs: 6, revenue: 8771 });
  assert.equal(r.sources.reduce((t, s) => t + s.revenue, 0), r.total.revenue);
  assert.ok(r.sources.every((s) => s.label === LEAD_SOURCE_LABELS[s.id]));
  const fb = r.sources[0];
  assert.deepEqual([fb.quotes, fb.accepted, fb.installs, fb.winPct], [10, 7, 4, 70]);
  assert.equal(r.sources.find((s) => s.id === 'other').winPct, null, 'no quotes, no win rate');
  assert.deepEqual(selectLeadSources(seedState(), undefined, NOW).total, r.total);
});

test('selectLeadSources: counted by the day the enquiry was made, sorted by volume then source order', () => {
  const mk = (day, extra = {}) => enquiry({ createdAt: `${day}T10:00`, history: [{ at: `${day}T10:00`, event: 'created', by: 'customer' }], ...extra });
  const s = stateOf([
    mk('2026-10-22', { utm: { source: 'google', medium: 'cpc', campaign: '' } }), mk('2026-10-22', { utm: { source: 'google', medium: 'cpc', campaign: '' } }),
    mk('2026-10-20', { utm: { source: 'facebook', medium: '', campaign: '' } }), mk('2026-09-01', { utm: { source: 'facebook', medium: '', campaign: '' } }),
    mk('2026-10-21', { source: 'phone' }), mk('2026-10-21')
  ]);
  const all = selectLeadSources(s, 'all', NOW);
  assert.deepEqual(all.sources.map((x) => [x.id, x.enquiries]), [['facebook', 2], ['google', 2], ['phone', 1], ['other', 1], ['instagram', 0], ['referral', 0]], 'ties keep the source order');
  const week = selectLeadSources(s, '7d', NOW);
  assert.equal(week.total.enquiries, 5, 'the September enquiry is out of range');
  assert.equal(week.sources.find((x) => x.id === 'facebook').enquiries, 1);
  const explicit = selectLeadSources(s, { from: '2026-10-21', to: '2026-10-21' }, NOW);
  assert.equal(explicit.total.enquiries, 2);
  assert.equal(selectLeadSources(s, 'last_month', NOW).total.enquiries, 1);
  assert.equal(selectLeadSources(stateOf([]), 'all', NOW).total.enquiries, 0);
  assert.ok(selectLeadSources(stateOf([]), 'all', NOW).sources.every((x) => x.sharePct === 0 && x.winPct === null));
});

test('selectCostPerLead on the seed: spend, ad leads only, whole-pound costs per enquiry, accepted quote and install', () => {
  const r = selectCostPerLead(seedState(), '3m', NOW);
  assert.deepEqual(r.range, { from: '2026-08-01', to: '2026-10-23', preset: '3m' });
  assert.deepEqual(r.months, ['2026-08', '2026-09', '2026-10']);
  assert.equal(r.spend, 1020);
  assert.equal(r.hasSpend, true);
  assert.deepEqual([r.adEnquiries, r.adAccepted, r.adInstalls], [17, 9, 5], 'Facebook and Instagram leads only: organic Google and word of mouth are left out');
  assert.deepEqual([r.costPerEnquiry, r.costPerAccepted, r.costPerInstall], [60, 113, 204]);
  assert.deepEqual(r.byChannel.map((c) => [c.channel, c.spend, c.enquiries]), [['facebook', 780, 13], ['instagram', 240, 4], ['google', 0, 3], ['other', 0, 0]]);
  assert.deepEqual(r.byChannel.map((c) => c.costPerEnquiry), [60, 60, null, null], 'no spend: an honest blank, never zero');
  assert.deepEqual(r.byChannel.map((c) => c.label), ['Facebook', 'Instagram', 'Google', 'Other']);
});

test('selectCostPerLead: an honest blank when spend is zero or there is nothing to divide by; ranges widen to whole months', () => {
  const s = seedState();
  s.settings.marketing.adSpend = [];
  const none = selectCostPerLead(s, '3m', NOW);
  assert.equal(none.spend, 0);
  assert.equal(none.hasSpend, false);
  assert.deepEqual([none.costPerEnquiry, none.costPerAccepted, none.costPerInstall], [null, null, null]);
  assert.equal(none.adEnquiries, 0, 'with no ads running, nothing is an ad lead');
  // spend but no leads in the range
  const empty = stateOf([], []);
  empty.settings.marketing.adSpend = [{ id: 'a', month: '2026-10', channel: 'facebook', amount: 200 }];
  const noLeads = selectCostPerLead(empty, 'month', NOW);
  assert.equal(noLeads.spend, 200);
  assert.deepEqual([noLeads.costPerEnquiry, noLeads.costPerInstall], [null, null], 'a cost of 200 over zero leads is blank, not infinite');
  // a 30 day window is widened to the whole months it touches (ad spend is monthly)
  const wide = selectCostPerLead(seedState(), '30d', NOW);
  assert.deepEqual(wide.range, { from: '2026-09-01', to: '2026-10-23', preset: '30d' });
  assert.deepEqual(wide.months, ['2026-09', '2026-10']);
  assert.equal(wide.spend, 680, 'September (390) plus October to date (290)');
  assert.equal(wide.spend, wide.byChannel.reduce((t, c) => t + c.spend, 0));
  const last = selectCostPerLead(seedState(), 'last_month', NOW);
  assert.deepEqual(last.range, { from: '2026-09-01', to: '2026-09-30', preset: 'last_month' }, 'a past month ends on its own last day');
  assert.equal(last.spend, 390);
  const everything = selectCostPerLead(seedState(), 'all', NOW);
  assert.deepEqual(everything.range, { from: null, to: null, preset: 'all' });
  assert.equal(everything.spend, 1020);
  assert.deepEqual(everything.months, ['2026-08', '2026-09', '2026-10']);
  // 'other' spend turns 'other' leads into ad leads
  const other = stateOf([enquiry({ createdAt: '2026-10-10T10:00' })]);
  other.settings.marketing.adSpend = [{ id: 'o', month: '2026-10', channel: 'other', amount: 100 }];
  assert.equal(selectCostPerLead(other, 'month', NOW).adEnquiries, 1);
  assert.equal(selectCostPerLead(other, 'month', NOW).costPerEnquiry, 100);
});

// ---------- quotes: stats, list, detail ----------

test('selectQuoteStats on the seed: sent, accepted, declined, expired, win rate, average value and what is waiting', () => {
  const r = selectQuoteStats(seedState(), 'all', NOW);
  assert.deepEqual([r.sent, r.accepted, r.declined, r.expired, r.decided], [16, 11, 1, 1, 13]);
  assert.equal(r.winRatePct, 85, 'accepted of those that were decided (11 of 13), not of the ones still open');
  assert.equal(r.avgAcceptedValue, 1480);
  assert.equal(r.waitingCount, 3);
  assert.equal(r.waitingValue, 4589, 'two sent and one viewed; the one with a possible extra (a consumer unit upgrade) counts its fixed lines only');
  assert.deepEqual([r.draftCount, r.draftValue], [1, 1394]);
  assert.deepEqual(r.range, { from: null, to: null, preset: 'all' });
});

test('selectQuoteStats: counted by the day a quote was sent; waiting and drafts are not range-limited; blanks are honest', () => {
  const s = seedState();
  const lastWeek = selectQuoteStats(s, '7d', NOW);
  assert.ok(lastWeek.sent < 16 && lastWeek.sent > 0);
  assert.equal(lastWeek.waitingCount, 3, 'what is waiting now does not depend on the range');
  const none = selectQuoteStats(stateOf([]), 'all', NOW);
  assert.deepEqual([none.sent, none.accepted, none.decided, none.winRatePct, none.avgAcceptedValue, none.waitingCount, none.waitingValue, none.draftCount], [0, 0, 0, null, 0, 0, 0, 0]);
  const e = enquiry({ status: 'done', finalPrice: 0 });
  const expiredButStoredSent = quote(e.id, { status: 'sent', sentAt: '2026-10-01T09:00', validUntil: '2026-10-10' });
  const r = selectQuoteStats(stateOf([e], [expiredButStoredSent]), 'all', NOW);
  assert.deepEqual([r.sent, r.expired, r.waitingCount], [1, 1, 0], 'an expired quote is not waiting');
});

test('quote lists: all, newest first; by effective status; "waiting" is sent or viewed and not expired', () => {
  const s = seedState();
  const all = selectQuotes(s);
  assert.equal(all.length, 17);
  for (let i = 1; i < all.length; i += 1) assert.ok(all[i - 1].createdAt >= all[i].createdAt, `newest first at ${i}`);
  assert.equal(selectQuote(s, all[0].id), all[0]);
  assert.equal(selectQuote(s, 'nope'), null);
  const rows = selectQuoteList(s, { nowStamp: NOW });
  assert.equal(rows.length, 17);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['ageMinutes', 'bookingId', 'customerName', 'expiresInDays', 'installBookingId', 'quote', 'ref', 'status', 'total']);
  const count = (status) => selectQuoteList(s, { status, nowStamp: NOW }).length;
  assert.deepEqual(['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'].map(count), [1, 2, 1, 11, 1, 1], 'the expired quote is counted by its effective status');
  assert.equal(count('waiting'), 3);
  assert.equal(count('all'), 17);
  assert.equal(selectQuoteList(s, { status: 'expired', nowStamp: NOW })[0].customerName, 'Una Kerr');
  const waiting = selectQuoteList(s, { status: 'waiting', nowStamp: NOW });
  assert.ok(waiting.every((r) => r.status === 'sent' || r.status === 'viewed'));
  const viewed = rows.find((r) => r.status === 'viewed');
  assert.equal(viewed.total, 1489);
  assert.equal(viewed.ageMinutes, 26 * 60);
  assert.equal(viewed.expiresInDays, 30 - 1);
  assert.equal(rows.find((r) => r.status === 'expired').expiresInDays < 0, true);
  const withInstall = rows.find((r) => r.installBookingId);
  assert.ok(withInstall.status === 'accepted');
  assert.equal(selectQuoteList(s).length, 17, 'defaults to the clock');
  assert.deepEqual(selectQuoteList({ settings: s.settings, bookings: [], quotes: undefined }), []);
});

test('quotes of a booking: all newest first, and the latest one', () => {
  const e = enquiry({ status: 'done', finalPrice: 0 });
  const a = quote(e.id, { id: 'Q-X', createdAt: '2026-10-20T09:00' });
  const b = quote(e.id, { id: 'Q-X-2', createdAt: '2026-10-22T09:00' });
  const s = stateOf([e], [a, b]);
  assert.deepEqual(selectQuotesForBooking(s, e.id).map((q) => q.id), ['Q-X-2', 'Q-X']);
  assert.equal(selectQuoteForBooking(s, e.id).id, 'Q-X-2');
  assert.equal(selectQuoteForBooking(s, 'nope'), null);
});

test('selectQuoteDetail: everything the customer page needs', () => {
  const s = seedState();
  const viewed = selectQuotes(s).find((q) => q.status === 'viewed');
  const d = selectQuoteDetail(s, viewed.id, NOW);
  assert.equal(d.quote, viewed);
  assert.equal(d.status, 'viewed');
  assert.equal(d.total, 1489);
  assert.equal(d.lines.length, viewed.lines.length);
  assert.deepEqual(d.lines.map((l) => l.lineTotal), viewed.lines.map((l) => l.qty * l.unitPrice));
  assert.equal(d.customerFirst, 'Tiernan');
  assert.match(d.ref, /^EL-10\d\d$/);
  assert.equal(d.address, 'BT34 1XK', 'the funnel only gave a postcode');
  assert.equal(d.validUntilLabel, 'Sat 21 Nov');
  assert.equal(d.expiresInDays, 30 - 1);
  assert.deepEqual([d.canAccept, d.canDecline, d.isExpired], [true, true, false]);
  assert.equal(d.installBooking, null);
  assert.equal(d.installWhen, '');
  // accepted: no more buttons, and the pencilled install is attached
  const accepted = selectQuotes(s).find((q) => q.id === selectJourney(s, 'bk_seed_21', NOW).quote.id);
  const da = selectQuoteDetail(s, accepted.id, NOW);
  assert.deepEqual([da.status, da.canAccept, da.canDecline], ['accepted', false, false]);
  assert.equal(da.installBooking.id, 'bk_seed_34');
  assert.equal(da.installWhen, 'Sat 31 Oct, morning, 8–10am');
  // expired and draft
  const expired = selectQuotes(s).find((q) => selectQuoteDetail(s, q.id, NOW).status === 'expired');
  assert.deepEqual([selectQuoteDetail(s, expired.id, NOW).isExpired, selectQuoteDetail(s, expired.id, NOW).canAccept], [true, false]);
  const draft = selectQuotes(s).find((q) => q.status === 'draft');
  assert.deepEqual([selectQuoteDetail(s, draft.id, NOW).canAccept, selectQuoteDetail(s, draft.id, NOW).canDecline], [false, false], 'a draft cannot be accepted');
  assert.equal(selectQuoteDetail(s, 'nope', NOW), null);
  // the same quote a month on is expired
  assert.equal(selectQuoteDetail(s, viewed.id, '2026-12-01T09:00').isExpired, true);
});

test('isFreeVisit: an ev_quote completed at 0 pounds, nothing else', () => {
  assert.equal(isFreeVisit(enquiry({ status: 'done', finalPrice: 0 })), true);
  assert.equal(isFreeVisit(enquiry({ status: 'done', finalPrice: 75 })), false, 'a charged survey is a normal job');
  assert.equal(isFreeVisit(enquiry({ status: 'confirmed', finalPrice: null })), false);
  assert.equal(isFreeVisit(install({ status: 'done', finalPrice: 0 })), false, 'only the survey is free');
  assert.equal(isFreeVisit(null), false);
});
