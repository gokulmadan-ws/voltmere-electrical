// tests/unit/v3-quotes.test.mjs: unit tests for the quote lifecycle in js/core/store.js (create, edit, send, view, accept, decline, undo) and the journey it drives
// Owner: A3 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { nextFreeSlots, isSlotFree } from '../../js/core/availability.js';
import { bubbleActions } from '../../js/core/messages.js';
import {
  quoteTotal, selectBookingById, selectInsights, selectJourney, selectLeadSources, selectMessages, selectPipeline, selectQuote, selectQuoteDetail, selectQuoteStats, selectSla
} from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

const {
  initStore, getState, subscribe, createBooking, confirmBooking, completeBooking, markPaid, updateSettings, undo, createQuote, updateQuote, deleteQuote, sendQuote,
  recordQuoteViewed, acceptQuote, declineQuote, rescheduleBooking, addBlock
} = store;

const FIXTURE = new Date(2026, 9, 23, 20, 30);
const NOW = '2026-10-23T20:30';

function memStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

let storage;
beforeEach(() => {
  setClock(FIXTURE);
  storage = memStorage();
  initStore({ storage, force: true });
});
afterEach(() => setClock(null));

const booking = (id) => selectBookingById(getState(), id);
const kinds = (list) => list.map((m) => m.kind);
const quote = (id) => selectQuote(getState(), id);
const stageOf = (bookingId) => selectJourney(getState(), bookingId, NOW).stage;

// A seeded survey that is done and has no quote (Leona, a phone enquiry with an email address).
const SURVEYED = 'bk_seed_16';

function sendable(over = {}) {
  const made = createQuote({ bookingId: SURVEYED, ...over });
  assert.equal(made.ok, true, JSON.stringify(made));
  return made.quote;
}

// ---------- createQuote ----------

test('createQuote: a draft with the id from the enquiry ref, the first brand, the suggested lines, the default notes and 30 days', () => {
  const ref = booking(SURVEYED).ref;
  const made = createQuote({ bookingId: SURVEYED });
  assert.equal(made.ok, true);
  const q = made.quote;
  assert.equal(q.id, `Q-${ref}`);
  assert.match(q.id, /^Q-EL-\d{4}$/);
  assert.deepEqual(Object.keys(q).sort(), ['acceptedAt', 'bookingId', 'brand', 'createdAt', 'customerName', 'declineReason', 'declinedAt', 'id', 'installBookingId', 'lines', 'notes', 'seed', 'sentAt', 'sentVia', 'status', 'validUntil', 'viewedAt'].sort());
  assert.equal(q.bookingId, SURVEYED);
  assert.equal(q.customerName, 'Leona Fitzsimons');
  assert.equal(q.status, 'draft');
  assert.equal(q.brand, 'ZAPPI');
  assert.equal(q.createdAt, NOW);
  assert.equal(q.validUntil, '2026-11-22');
  assert.equal(q.notes, getState().settings.quoteDefaults.notes);
  assert.deepEqual(q.lines.map((l) => l.label), ['Supply of ZAPPI home charger', 'Standard installation (up to 10 m of cable)', 'Dedicated circuit and protective device', 'Testing and certification']);
  assert.equal(quoteTotal(q), 1514);
  assert.deepEqual([q.sentAt, q.sentVia, q.viewedAt, q.acceptedAt, q.declinedAt, q.declineReason, q.installBookingId, q.seed], [null, null, null, null, null, '', null, false]);
  assert.ok(made.undoToken);
  assert.equal(getState().quotes[q.id], selectQuote(getState(), q.id));
  assert.ok(Object.isFrozen(getState().quotes));
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.state)).quotes[q.id], JSON.parse(JSON.stringify(q)), 'persisted');
  assert.equal(stageOf(SURVEYED), 'quote', 'a draft keeps it in the Quote stage');
});

test('createQuote: brand, lines, notes, validUntil and customerName can be given; a second quote is -2, a third -3', () => {
  const lines = [{ label: 'Supply and fit (sample)', qty: 1, unitPrice: 1200 }, { id: 'mine', label: 'Discount', qty: 1, unitPrice: -100 }];
  const q = sendable({ brand: ' OHME ', lines, notes: '  Thanks  ', validUntil: '2026-12-01', customerName: 'Leona F.' });
  assert.deepEqual([q.brand, q.notes, q.validUntil, q.customerName], ['OHME', 'Thanks', '2026-12-01', 'Leona F.']);
  assert.deepEqual(q.lines.map((l) => [l.label, l.detail, l.qty, l.unitPrice]), [['Supply and fit (sample)', '', 1, 1200], ['Discount', '', 1, -100]]);
  assert.equal(q.lines[1].id, 'mine');
  assert.match(q.lines[0].id, /^ln_[0-9a-z]{8}$/);
  const second = createQuote({ bookingId: SURVEYED });
  assert.equal(second.quote.id, `${q.id}-2`);
  assert.equal(createQuote({ bookingId: SURVEYED }).quote.id, `${q.id}-3`);
  assert.equal(selectJourney(getState(), SURVEYED, NOW).quote.id, `${q.id}-3`, 'the newest quote is the one that counts');
  // an empty draft is allowed; an unknown brand just has no charger line
  assert.deepEqual(createQuote({ bookingId: 'bk_seed_17', lines: [] }).quote.lines, [], 'bk_seed_17 already has a draft: this is its second quote');
  assert.equal(createQuote({ bookingId: 'bk_seed_18', brand: 'NOPE' }).quote.lines.length, 3);
});

test('createQuote: validation with plain messages, and nothing is written on failure', () => {
  const rev = getState().meta.rev;
  const bad = (input) => createQuote({ bookingId: SURVEYED, ...input });
  assert.deepEqual(createQuote({ bookingId: 'nope' }), { ok: false, reason: 'not_found' });
  assert.equal(createQuote({}).reason, 'not_found');
  assert.equal(createQuote().reason, 'not_found');
  assert.equal(createQuote({ bookingId: 'bk_seed_01' }).reason, 'invalid', 'a fault job is not an enquiry');
  assert.ok(createQuote({ bookingId: 'bk_seed_01' }).errors.bookingId);
  assert.equal(createQuote({ bookingId: 'bk_seed_36' }).reason, 'invalid', 'nor is an install');
  assert.equal(createQuote({ bookingId: 'bk_seed_15' }).reason, 'bad_transition', 'a cancelled enquiry gets no quote');
  assert.match(bad({ lines: 'x' }).errors.lines, /lines of the quote/);
  assert.match(bad({ lines: [{ label: '', qty: 1, unitPrice: 5 }] }).errors.lines, /Line 1 needs a description/);
  assert.match(bad({ lines: [{ label: 'x', qty: 1, unitPrice: -5 }] }).errors.lines, /total cannot be below zero/);
  assert.ok(bad({ validUntil: '2026-02-31' }).errors.validUntil);
  assert.ok(bad({ validUntil: 'soon' }).errors.validUntil);
  assert.ok(bad({ notes: 'n'.repeat(1501) }).errors.notes);
  assert.ok(bad({ customerName: '   ' }).errors.customerName);
  assert.equal(getState().meta.rev, rev, 'nothing was written');
  assert.equal(Object.keys(getState().quotes).length, 17);
});

test('possible extras: a quote keeps an optional line, its total and its message leave it out, and a quote of only extras cannot be sent', () => {
  const lines = [
    { label: 'Supply and fit (sample)', qty: 1, unitPrice: 1200 },
    { label: 'Consumer unit upgrade (if required)', qty: 1, unitPrice: 420, optional: true }
  ];
  const q = sendable({ lines });
  assert.deepEqual(q.lines.map((l) => l.optional), [false, true]);
  assert.equal(quoteTotal(q), 1200, 'the possible extra is not in the fixed total');
  const detail = selectQuoteDetail(getState(), q.id, NOW);
  assert.equal(detail.total, 1200);
  assert.deepEqual(detail.lines.map((l) => l.label), ['Supply and fit (sample)'], 'lines are the ones the total adds up');
  assert.deepEqual(detail.extras.map((l) => [l.label, l.lineTotal, l.optional]), [['Consumer unit upgrade (if required)', 420, true]]);
  assert.deepEqual(detail.allLines.map((l) => l.optional), [false, true]);
  // editing keeps the flag (a line can be turned into an extra and back)
  const edited = updateQuote(q.id, { lines: q.lines.map((l) => ({ ...l, optional: !l.optional })) });
  assert.equal(edited.ok, true);
  assert.deepEqual(edited.quote.lines.map((l) => l.optional), [true, false]);
  assert.equal(quoteTotal(edited.quote), 420);
  assert.equal(updateQuote(q.id, { lines: q.lines }).ok, true);
  const sent = sendQuote(q.id, { via: 'whatsapp' });
  assert.equal(sent.ok, true);
  assert.ok(sent.message.body.includes('£1,200'), sent.message.body);
  assert.ok(!sent.message.body.includes('£1,620'), 'the extra is not added into the figure the customer is told');
  // only extras: nothing to pay, so it is refused like an empty quote
  const only = createQuote({ bookingId: 'bk_seed_17', lines: [{ label: 'Extra only', qty: 1, unitPrice: 50, optional: true }] });
  assert.equal(only.ok, true, 'a draft may hold it while it is being written');
  const refused = sendQuote(only.quote.id, { via: 'whatsapp' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'invalid');
  assert.match(refused.errors.lines, /at least one line with a price/);
});

test('acceptQuote prices the install at the fixed total (a possible extra is not charged until it is agreed)', () => {
  const q = sendable({ lines: [{ label: 'Supply and fit (sample)', qty: 1, unitPrice: 1200 }, { label: 'Consumer unit upgrade (if required)', qty: 1, unitPrice: 420, optional: true }] });
  assert.equal(sendQuote(q.id, { via: 'link' }).ok, true);
  const slot = nextFreeSlots(getState(), 'ev', 1)[0] || nextFreeSlots(getState(), 'ev_quote', 1)[0];
  assert.ok(slot);
  const accepted = acceptQuote(q.id, { date: slot.date, windowId: slot.windowId });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.booking.quotedPrice, 1200);
  assert.ok(accepted.messages[0].body.includes('£1,200') || accepted.messages[1].body.includes('£1,200'));
});

// ---------- updateQuote and deleteQuote ----------

test('updateQuote: draft or sent only, validated, a no-op writes nothing, and it makes a demo quote the person\'s own', () => {
  const q = sendable();
  const edit = updateQuote(q.id, { notes: 'New terms', brand: 'SYNC', lines: [{ label: 'One line', qty: 2, unitPrice: 500 }], validUntil: '2026-12-24', customerName: 'L Fitzsimons' });
  assert.equal(edit.ok, true);
  assert.deepEqual([edit.quote.notes, edit.quote.brand, edit.quote.validUntil, edit.quote.customerName, quoteTotal(edit.quote)], ['New terms', 'SYNC', '2026-12-24', 'L Fitzsimons', 1000]);
  assert.equal(quote(q.id).notes, 'New terms');
  // nothing changes: no notification, no write
  let calls = 0;
  const off = subscribe(() => { calls += 1; });
  const rev = getState().meta.rev;
  assert.equal(updateQuote(q.id, { notes: 'New terms' }).ok, true);
  assert.equal(updateQuote(q.id, {}).ok, true);
  assert.equal(updateQuote(q.id, { lines: edit.quote.lines }).ok, true);
  assert.equal(calls, 0);
  assert.equal(getState().meta.rev, rev);
  off();
  // validation
  assert.equal(updateQuote(q.id, { validUntil: 'x' }).reason, 'invalid');
  assert.ok(updateQuote(q.id, { lines: [{ label: 'x', qty: 0, unitPrice: 1 }] }).errors.lines);
  assert.ok(updateQuote(q.id, { customerName: '' }).errors.customerName);
  assert.ok(updateQuote(q.id, { notes: 'n'.repeat(1501) }).errors.notes);
  assert.ok(updateQuote(q.id, { lines: [{ label: 'x', qty: 1, unitPrice: -1 }] }).errors.lines);
  assert.equal(quote(q.id).notes, 'New terms', 'a failed patch changes nothing');
  assert.equal(updateQuote('nope', { notes: 'x' }).reason, 'not_found');
  // a demo quote becomes the person's own on the first change
  const demo = Object.values(getState().quotes).find((x) => x.seed && x.status === 'draft');
  assert.equal(demo.seed, true);
  assert.equal(updateQuote(demo.id, { notes: 'mine' }).quote.seed, false);
});

test('updateQuote on a sent quote is allowed; a viewed, accepted or declined quote is frozen (write a new one)', () => {
  const q = sendable();
  assert.equal(sendQuote(q.id, { via: 'whatsapp' }).ok, true);
  assert.equal(updateQuote(q.id, { notes: 'Corrected' }).ok, true, 'sent');
  assert.equal(quote(q.id).status, 'sent', 'still sent');
  assert.equal(recordQuoteViewed(q.id).changed, true);
  assert.equal(updateQuote(q.id, { notes: 'Too late' }).reason, 'bad_transition', 'viewed');
  const accepted = Object.values(getState().quotes).find((x) => x.status === 'accepted');
  assert.equal(updateQuote(accepted.id, { notes: 'x' }).reason, 'bad_transition');
  const declined = Object.values(getState().quotes).find((x) => x.status === 'declined');
  assert.equal(updateQuote(declined.id, { notes: 'x' }).reason, 'bad_transition');
  // an expired sent quote can be revived by moving its date
  const expired = Object.values(getState().quotes).find((x) => x.status === 'sent' && x.validUntil < '2026-10-23');
  assert.ok(expired);
  assert.equal(updateQuote(expired.id, { validUntil: '2026-11-30' }).ok, true);
  assert.equal(selectQuoteDetail(getState(), expired.id, NOW).status, 'sent');
});

test('deleteQuote: drafts only, undoable, and the enquiry goes back to needing a quote', () => {
  const q = sendable();
  const gone = deleteQuote(q.id);
  assert.equal(gone.ok, true);
  assert.equal(quote(q.id), null);
  assert.equal(selectJourney(getState(), SURVEYED, NOW).quote, null);
  assert.equal(stageOf(SURVEYED), 'quote', 'survey done, no quote: still the Quote stage');
  assert.equal(undo(gone.undoToken).ok, true);
  assert.deepEqual(quote(q.id), q);
  assert.equal(undo(gone.undoToken).reason, 'stale', 'once');
  assert.equal(deleteQuote('nope').reason, 'not_found');
  assert.equal(sendQuote(q.id, { via: 'link' }).ok, true);
  assert.equal(deleteQuote(q.id).reason, 'bad_transition', 'a sent quote is not deleted');
  const sentSeed = Object.values(getState().quotes).find((x) => x.status === 'accepted');
  assert.equal(deleteQuote(sentSeed.id).reason, 'bad_transition');
});

// ---------- sendQuote ----------

test('sendQuote via WhatsApp: sent with the link, one customer_quote_sent message, history on the enquiry, undoable', () => {
  const q = sendable();
  const base = `${new URL('../../', import.meta.url).href}quote.html#`;
  const sent = sendQuote(q.id, { via: 'whatsapp' });
  assert.equal(sent.ok, true);
  // v4: the link carries the quote itself (quote.html#d=<payload>) so it opens on any phone
  assert.ok(sent.link.startsWith(`${base}d=`), sent.link);
  assert.equal(sent.linkPortable, true);
  const link = sent.link;
  assert.deepEqual([sent.quote.status, sent.quote.sentVia, sent.quote.sentAt], ['sent', 'whatsapp', NOW]);
  const m = sent.message;
  assert.deepEqual([m.kind, m.to, m.channel, m.bookingId, m.simulated, m.seed, m.sendAt, m.at], ['customer_quote_sent', 'customer', 'whatsapp', SURVEYED, true, false, null, NOW]);
  assert.equal(m.toName, 'Leona Fitzsimons');
  assert.equal(m.toPhone, '07700 900425');
  assert.equal('toEmail' in m, false, 'a WhatsApp message keeps the v2 shape');
  assert.ok(m.body.includes(link));
  assert.ok(m.body.includes('£1,514'));
  assert.ok(m.body.includes('valid until Sun 22 Nov'));
  assert.ok(m.body.startsWith("Hi Leona, it's Daniel from 180 Electrical."));
  assert.ok(!/[{}]|!/.test(m.body));
  assert.deepEqual(booking(SURVEYED).history.at(-1), { at: NOW, event: 'message', by: 'owner', note: 'Quote sent' });
  assert.equal(getState().messages.at(-1).id, m.id);
  assert.equal(stageOf(SURVEYED), 'quote');
  assert.equal(selectJourney(getState(), SURVEYED, NOW).quote.status, 'sent');
  // undo puts it all back
  assert.equal(undo(sent.undoToken).ok, true);
  assert.equal(quote(q.id).status, 'draft');
  assert.equal(quote(q.id).sentAt, null);
  assert.ok(!getState().messages.some((x) => x.id === m.id));
  assert.equal(booking(SURVEYED).history.some((h) => h.note === 'Quote sent'), false);
});

test('sendQuote via email: needs an email address, logs an email message with it; via a link logs a message too', () => {
  const q = sendable();
  const email = sendQuote(q.id, { via: 'email' });
  assert.equal(email.ok, true);
  assert.deepEqual([email.message.channel, email.message.toEmail, email.quote.sentVia], ['email', 'leona.fitzsimons@example.com', 'email']);
  const link = sendQuote(q.id, { via: 'link' });
  assert.equal(link.ok, true);
  assert.deepEqual([link.message.channel, link.quote.sentVia], ['whatsapp', 'link']);
  assert.equal(kinds(selectMessages(getState(), { bookingId: SURVEYED }).filter((m) => !m.seed)).filter((k) => k === 'customer_quote_sent').length, 2);
  // no email on file
  const noEmail = createBooking({ serviceId: 'ev_quote', pencil: true, customer: { name: 'No Email', phone: '07700 900777' }, address: { line1: '', postcode: 'BT9 6QP' } });
  const nq = createQuote({ bookingId: noEmail.booking.id });
  const refused = sendQuote(nq.quote.id, { via: 'email' });
  assert.equal(refused.reason, 'no_email');
  assert.ok(refused.errors.email);
  assert.equal(quote(nq.quote.id).status, 'draft', 'unchanged');
  assert.equal(sendQuote(nq.quote.id, { via: 'whatsapp' }).ok, true, 'WhatsApp does not need an email');
});

test('sendQuote: validation and the status rules', () => {
  const q = sendable({ lines: [] });
  assert.equal(sendQuote(q.id, { via: 'whatsapp' }).reason, 'invalid');
  assert.ok(sendQuote(q.id, { via: 'whatsapp' }).errors.lines, 'at least one line with a price');
  assert.equal(updateQuote(q.id, { lines: [{ label: 'Free thing', qty: 1, unitPrice: 0 }] }).ok, true);
  assert.equal(sendQuote(q.id, { via: 'whatsapp' }).reason, 'invalid', 'a total of 0 is not a quote');
  assert.equal(updateQuote(q.id, { lines: [{ label: 'Thing', qty: 1, unitPrice: 900 }] }).ok, true);
  for (const via of ['sms', '', undefined, null, 'WhatsApp']) assert.equal(sendQuote(q.id, { via }).reason, 'invalid', String(via));
  assert.equal(sendQuote(q.id).reason, 'invalid');
  assert.equal(sendQuote('nope', { via: 'link' }).reason, 'not_found');
  const accepted = Object.values(getState().quotes).find((x) => x.status === 'accepted');
  const declined = Object.values(getState().quotes).find((x) => x.status === 'declined');
  assert.equal(sendQuote(accepted.id, { via: 'link' }).reason, 'bad_transition');
  assert.equal(sendQuote(declined.id, { via: 'link' }).reason, 'bad_transition');
  assert.equal(sendQuote(q.id, { via: 'link' }).ok, true);
  // the enquiry gets cancelled: nothing more is sent about it
  const cancelled = createQuote({ bookingId: 'bk_seed_08', lines: [{ label: 'x', qty: 1, unitPrice: 5 }] });
  assert.equal(store.cancelBooking('bk_seed_08', 'owner').ok, true);
  assert.equal(sendQuote(cancelled.quote.id, { via: 'link' }).reason, 'bad_transition');
});

test('sendQuote: a resend logs another message and keeps a viewed quote viewed; a stale validity is reset to 30 days from today', () => {
  const q = sendable();
  sendQuote(q.id, { via: 'whatsapp' });
  recordQuoteViewed(q.id);
  setClock(new Date(2026, 9, 25, 9, 0));
  const again = sendQuote(q.id, { via: 'email' });
  assert.equal(again.ok, true);
  assert.equal(again.quote.status, 'viewed', 'the customer has already seen it');
  assert.deepEqual([again.quote.sentVia, again.quote.sentAt], ['email', '2026-10-25T09:00']);
  assert.equal(selectMessages(getState(), { bookingId: SURVEYED }).filter((m) => m.kind === 'customer_quote_sent' && !m.seed).length, 2);
  // a draft written long ago, sent after its date has passed
  setClock(FIXTURE);
  const old = createQuote({ bookingId: 'bk_seed_18', validUntil: '2026-10-01', lines: [{ label: 'x', qty: 1, unitPrice: 900 }] });
  const sent = sendQuote(old.quote.id, { via: 'link' });
  assert.equal(sent.quote.validUntil, '2026-11-22', 'a date in the past is replaced');
  const keeps = createQuote({ bookingId: 'bk_seed_19', validUntil: '2026-12-31', lines: [{ label: 'x', qty: 1, unitPrice: 900 }] });
  assert.equal(sendQuote(keeps.quote.id, { via: 'link' }).quote.validUntil, '2026-12-31', 'a good date is kept');
  const today = createQuote({ bookingId: 'bk_seed_20', validUntil: '2026-10-23', lines: [{ label: 'x', qty: 1, unitPrice: 900 }] });
  assert.equal(sendQuote(today.quote.id, { via: 'link' }).quote.validUntil, '2026-10-23', 'today is still valid');
});

test('sendQuote counts as the reply: the enquiry stops being overdue', () => {
  const before = selectSla(getState(), NOW);
  assert.equal(before.overdueCount, 1);
  const q = createQuote({ bookingId: 'bk_seed_11', lines: [{ label: 'Survey first', qty: 1, unitPrice: 100 }] });
  assert.equal(q.ok, true);
  assert.equal(sendQuote(q.quote.id, { via: 'whatsapp' }).ok, true);
  const after = selectSla(getState(), NOW);
  assert.equal(after.overdueCount, 0, 'he has answered');
  assert.equal(stageOf('bk_seed_11'), 'quote', 'a quote sent before the survey moves it on');
});

// ---------- recordQuoteViewed ----------

test('recordQuoteViewed: sent becomes viewed once; every other status is left alone; nothing is logged; no write when nothing changes', () => {
  const q = sendable();
  assert.deepEqual(recordQuoteViewed(q.id), { ok: true, quote: quote(q.id), changed: false }, 'a draft is not viewed');
  sendQuote(q.id, { via: 'whatsapp' });
  const messagesBefore = getState().messages.length;
  const first = recordQuoteViewed(q.id);
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.deepEqual([first.quote.status, first.quote.viewedAt], ['viewed', NOW]);
  assert.equal(getState().messages.length, messagesBefore, 'logs nothing');
  let calls = 0;
  const off = subscribe(() => { calls += 1; });
  const rev = getState().meta.rev;
  assert.equal(recordQuoteViewed(q.id).changed, false);
  assert.equal(recordQuoteViewed(q.id).changed, false);
  assert.equal(calls, 0);
  assert.equal(getState().meta.rev, rev);
  off();
  assert.equal(quote(q.id).viewedAt, NOW, 'the first view time is kept');
  assert.equal(recordQuoteViewed('nope').reason, 'not_found');
  const accepted = Object.values(getState().quotes).find((x) => x.status === 'accepted');
  assert.equal(recordQuoteViewed(accepted.id).changed, false);
  const expired = Object.values(getState().quotes).find((x) => x.status === 'sent' && x.validUntil < '2026-10-23');
  assert.equal(recordQuoteViewed(expired.id).changed, false, 'an expired quote is not marked viewed');
  assert.equal(quote(expired.id).status, 'sent');
});

// ---------- acceptQuote ----------

function sentQuote(bookingId = SURVEYED, over = {}) {
  const made = createQuote({ bookingId, ...over });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(sendQuote(made.quote.id, { via: 'whatsapp' }).ok, true);
  return made.quote.id;
}

test('acceptQuote: a pencilled half-day install, the quote accepted, two messages, history, and the pipeline moves to Accepted', () => {
  const id = sentQuote();
  const slot = nextFreeSlots(getState(), 'ev', 1)[0];
  assert.equal(slot.blocks, 2);
  const accepted = acceptQuote(id, { date: slot.date, windowId: slot.windowId });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const b = accepted.booking;
  assert.match(b.id, /^bk_[0-9a-z]{8}$/);
  assert.match(b.ref, /^EL-\d{4}$/);
  assert.deepEqual([b.serviceId, b.serviceName, b.status, b.tentative, b.urgent, b.durationMin, b.quotedPrice, b.finalPrice, b.quoteId, b.seed], ['ev', 'EV charger installation', 'new', true, false, 240, 1514, null, id, false]);
  assert.equal(b.start, `${slot.date}T${slot.windowId === 0 ? '08:00' : '13:00'}`);
  assert.deepEqual(b.customer, { name: 'Leona Fitzsimons', phone: '07700 900425', email: 'leona.fitzsimons@example.com' });
  assert.deepEqual(b.address, booking(SURVEYED).address);
  assert.deepEqual(b.answers, booking(SURVEYED).answers, 'the job card keeps what the customer said about their home');
  assert.deepEqual([b.paid, b.paidMethod, b.paidAt, b.seenByOwner, b.reviewRequested, b.cancelledBy], [false, null, null, false, false, null]);
  assert.deepEqual(b.history.map((h) => [h.event, h.by]), [['created', 'customer']]);
  assert.equal(b.source, booking(SURVEYED).source);
  const q = accepted.quote;
  assert.deepEqual([q.status, q.acceptedAt, q.installBookingId, q.seed], ['accepted', NOW, b.id, false]);
  assert.deepEqual(kinds(accepted.messages), ['customer_quote_accepted', 'owner_quote_accepted'], 'the owner alert last, so it sorts first');
  const [toCustomer, toOwner] = accepted.messages;
  assert.ok(toOwner.seq > toCustomer.seq);
  assert.deepEqual([toOwner.to, toOwner.bookingId, toCustomer.to, toCustomer.bookingId], ['owner', b.id, 'customer', b.id]);
  assert.ok(toOwner.body.startsWith(`*Quote accepted ${id}*\nLeona Fitzsimons accepted your quote (£1,514).\nInstall pencilled in: `));
  assert.ok(toOwner.body.includes('(provisional)'));
  assert.ok(toOwner.body.includes(`dashboard.html#/bookings/${b.id}`));
  assert.ok(toCustomer.body.startsWith('Hi Leona, thanks for accepting your quote (£1,514). The install day you chose is ') && !/pencilled|provisional/.test(toCustomer.body));
  assert.ok(toCustomer.body.endsWith(`Quote ${id}`));
  assert.deepEqual(booking(SURVEYED).history.at(-1), { at: NOW, event: 'message', by: 'customer', note: 'Quote accepted' });
  assert.equal(stageOf(SURVEYED), 'accepted');
  assert.equal(selectJourney(getState(), b.id, NOW).enquiry.id, SURVEYED);
  // the install holds its two windows for everybody else
  assert.equal(isSlotFree(getState(), { date: slot.date, windowId: slot.windowId, blocks: 2 }), false);
  assert.equal(isSlotFree(getState(), { date: slot.date, windowId: slot.windowId, blocks: 1 }), false);
  // the owner's bubble offers Confirm on the pencilled install
  assert.deepEqual(bubbleActions(toOwner, b, NOW).map((a) => a.id), ['confirm', 'call', 'open_job']);
  // and Needs you lists it
  assert.ok(store.getState().bookings.filter((x) => x.status === 'new').some((x) => x.id === b.id));
  assert.ok(accepted.undoToken);
});

test('acceptQuote is race-safe: a second accept of the same quote is already_accepted, never a second install', () => {
  const id = sentQuote();
  const [one, two] = nextFreeSlots(getState(), 'ev', 2);
  const first = acceptQuote(id, { date: one.date, windowId: one.windowId });
  assert.equal(first.ok, true);
  const bookings = getState().bookings.length;
  const second = acceptQuote(id, { date: two.date, windowId: two.windowId });
  assert.deepEqual(second, { ok: false, reason: 'already_accepted', installBookingId: first.booking.id });
  assert.equal(getState().bookings.length, bookings);
  assert.equal(quote(id).installBookingId, first.booking.id);
});

test('acceptQuote is race-safe across two tabs: the stale tab gets already_accepted or slot_taken, and the diary never double-books', async () => {
  const tabB = await import(`../../js/core/store.js?tab=${Math.random().toString(36).slice(2)}`);
  tabB.initStore({ storage, force: true });
  const a = sentQuote(SURVEYED);
  const b = sentQuote('bk_seed_18');
  const [slot, other] = nextFreeSlots(getState(), 'ev', 2);
  // both tabs hold both quotes in memory; tab B has not looked at what tab A does next
  tabB.syncFromStorage();
  const fromA = acceptQuote(a, { date: slot.date, windowId: slot.windowId });
  assert.equal(fromA.ok, true);
  const sameQuote = tabB.acceptQuote(a, { date: other.date, windowId: other.windowId });
  assert.equal(sameQuote.reason, 'already_accepted', 'the same quote accepted from the stale tab');
  assert.equal(sameQuote.installBookingId, fromA.booking.id);
  const sameDay = tabB.acceptQuote(b, { date: slot.date, windowId: slot.windowId });
  assert.equal(sameDay.reason, 'slot_taken', 'a different customer picking the day that was just taken');
  assert.equal(sameDay.alternatives.length, 3);
  assert.ok(sameDay.alternatives.every((s) => s.blocks === 2 && !(s.date === slot.date && s.windowId === slot.windowId)));
  const fine = tabB.acceptQuote(b, { date: other.date, windowId: other.windowId });
  assert.equal(fine.ok, true, 'and then a free day works');
  assert.equal(getState().bookings.length, tabB.getState().bookings.length - 1, 'tab A has not synced yet');
  assert.equal(store.syncFromStorage(), true);
  const taken = getState().bookings.filter((x) => x.status !== 'cancelled' && x.start === `${slot.date}T${slot.windowId === 0 ? '08:00' : '13:00'}`);
  assert.equal(taken.length, 1, 'exactly one booking holds the contested slot');
});

test('acceptQuote: the day is checked in customer mode (lead time, closed days, the horizon, blocks), with three alternatives', () => {
  const id = sentQuote();
  const [first] = nextFreeSlots(getState(), 'ev', 1);
  // today is 20:30, so any window today is gone (too soon / past)
  assert.equal(acceptQuote(id, { date: '2026-10-23', windowId: 2 }).reason, 'slot_taken');
  assert.equal(acceptQuote(id, { date: '2026-10-25', windowId: 0 }).reason, 'slot_taken', 'a Sunday: closed');
  assert.equal(acceptQuote(id, { date: '2026-12-01', windowId: 0 }).reason, 'slot_taken', 'beyond the 14 day horizon');
  assert.equal(acceptQuote(id, { date: '2026-10-22', windowId: 0 }).reason, 'slot_taken', 'in the past');
  assert.equal(acceptQuote(id, { date: '2026-10-24', windowId: 2 }).reason, 'slot_taken', 'Saturday afternoon is closed');
  addBlock({ date: first.date, windowId: first.windowId === 0 ? 1 : 3, label: 'Dentist' });
  const blocked = acceptQuote(id, { date: first.date, windowId: first.windowId });
  assert.equal(blocked.reason, 'slot_taken', 'half of the half day is blocked');
  assert.equal(blocked.alternatives.length, 3);
  assert.equal(quote(id).status, 'sent', 'a refused accept changes nothing');
  assert.equal(getState().bookings.filter((b) => b.quoteId === id).length, 0);
});

test('acceptQuote: invalid day or window, half-day windows only, and the statuses that cannot be accepted', () => {
  const id = sentQuote();
  const [slot] = nextFreeSlots(getState(), 'ev', 1);
  const bad = acceptQuote(id, { date: 'monday', windowId: 7 });
  assert.equal(bad.reason, 'invalid');
  assert.ok(bad.errors.date && bad.errors.windowId);
  assert.ok(acceptQuote(id, { date: slot.date, windowId: 1 }).errors.windowId, 'a half-day install starts at window 0 or 2');
  assert.ok(acceptQuote(id, { date: slot.date, windowId: 3 }).errors.windowId);
  assert.equal(acceptQuote(id, {}).reason, 'invalid');
  assert.equal(acceptQuote(id).reason, 'invalid');
  assert.equal(acceptQuote('nope', { date: slot.date, windowId: slot.windowId }).reason, 'not_found');
  const draft = Object.values(getState().quotes).find((q) => q.status === 'draft');
  assert.equal(acceptQuote(draft.id, { date: slot.date, windowId: slot.windowId }).reason, 'bad_transition', 'a draft was never sent');
  const declined = Object.values(getState().quotes).find((q) => q.status === 'declined');
  assert.equal(acceptQuote(declined.id, { date: slot.date, windowId: slot.windowId }).reason, 'bad_transition');
  const expired = Object.values(getState().quotes).find((q) => q.status === 'sent' && q.validUntil < '2026-10-23');
  assert.equal(acceptQuote(expired.id, { date: slot.date, windowId: slot.windowId }).reason, 'expired');
  assert.equal(quote(expired.id).status, 'sent');
  // the last good day is validUntil itself
  const edge = createQuote({ bookingId: 'bk_seed_19', validUntil: '2026-10-23', lines: [{ label: 'x', qty: 1, unitPrice: 900 }] });
  sendQuote(edge.quote.id, { via: 'link' });
  assert.equal(acceptQuote(edge.quote.id, { date: slot.date, windowId: slot.windowId }).ok, true, 'valid through its last day');
  const late = sentQuote('bk_seed_20', { validUntil: '2026-10-23' });
  setClock(new Date(2026, 9, 24, 8, 0));
  const [slotNext] = nextFreeSlots(getState(), 'ev', 1);
  assert.equal(acceptQuote(late, { date: slotNext.date, windowId: slotNext.windowId }).reason, 'expired', 'the day after');
});

test('acceptQuote: refused when the install service is off', () => {
  const id = sentQuote();
  const [slot] = nextFreeSlots(getState(), 'ev', 1);
  assert.equal(store.updateService('ev', { active: false }).ok, true);
  assert.equal(acceptQuote(id, { date: slot.date, windowId: slot.windowId }).reason, 'service_unavailable');
  assert.equal(quote(id).status, 'sent');
});

test('acceptQuote can be undone: the install, the messages and the history go, the quote is sent again', () => {
  const id = sentQuote();
  const [slot] = nextFreeSlots(getState(), 'ev', 1);
  const accepted = acceptQuote(id, { date: slot.date, windowId: slot.windowId });
  const bookings = getState().bookings.length;
  assert.equal(undo(accepted.undoToken).ok, true);
  assert.equal(getState().bookings.length, bookings - 1);
  assert.equal(quote(id).status, 'sent');
  assert.equal(quote(id).installBookingId, null);
  assert.ok(!getState().messages.some((m) => m.kind === 'owner_quote_accepted' && m.bookingId === accepted.booking.id));
  assert.equal(booking(SURVEYED).history.some((h) => h.note === 'Quote accepted'), false);
  assert.equal(isSlotFree(getState(), { date: slot.date, windowId: slot.windowId, blocks: 2 }), true, 'the day is free again');
  assert.equal(undo(accepted.undoToken).reason, 'stale');
});

test('a quote accepted by a person stays theirs: seed quotes become the person\'s own once touched', () => {
  const seedSent = Object.values(getState().quotes).find((q) => q.seed && q.status === 'sent' && q.validUntil >= '2026-10-23');
  assert.ok(seedSent);
  const [slot] = nextFreeSlots(getState(), 'ev', 1);
  assert.equal(acceptQuote(seedSent.id, { date: slot.date, windowId: slot.windowId }).ok, true);
  assert.equal(quote(seedSent.id).seed, false);
  assert.equal(getState().bookings.find((b) => b.quoteId === seedSent.id && !b.seed).seed, false);
});

// ---------- declineQuote ----------

test('declineQuote: the customer or the owner says no; a reason, an owner message, history on the enquiry; the pipeline moves to Lost', () => {
  const id = sentQuote();
  const declined = declineQuote(id, { reason: '  Found a cheaper price  ' });
  assert.equal(declined.ok, true);
  assert.deepEqual([declined.quote.status, declined.quote.declinedAt, declined.quote.declineReason], ['declined', NOW, 'Found a cheaper price']);
  assert.deepEqual([declined.message.kind, declined.message.to, declined.message.bookingId], ['owner_quote_declined', 'owner', SURVEYED]);
  assert.equal(declined.message.body, `*Quote declined ${id}*\nLeona Fitzsimons declined your quote (£1,514).\nReason: Found a cheaper price.\nOpen: ${new URL('../../', import.meta.url).href}dashboard.html#/bookings/${SURVEYED}`);
  assert.deepEqual(booking(SURVEYED).history.at(-1), { at: NOW, event: 'message', by: 'customer', note: 'Quote declined' });
  assert.equal(stageOf(SURVEYED), 'lost');
  assert.deepEqual(bubbleActions(declined.message, booking(SURVEYED), NOW).map((a) => a.id), ['open_job']);
  // the owner records a phone refusal; no reason is fine and the line is dropped
  const id2 = sentQuote('bk_seed_18');
  const byOwner = declineQuote(id2, { by: 'owner' });
  assert.equal(byOwner.ok, true);
  assert.equal(byOwner.quote.declineReason, '');
  assert.ok(!byOwner.message.body.includes('Reason'));
  assert.equal(booking('bk_seed_18').history.at(-1).by, 'owner');
  assert.equal(declineQuote(id2).reason, 'bad_transition', 'once');
  assert.equal(declineQuote(id, { by: 'nobody' }).reason, 'invalid');
  assert.equal(declineQuote('nope').reason, 'not_found');
  const draft = Object.values(getState().quotes).find((q) => q.status === 'draft');
  assert.equal(declineQuote(draft.id).reason, 'bad_transition');
  const accepted = Object.values(getState().quotes).find((q) => q.status === 'accepted');
  assert.equal(declineQuote(accepted.id).reason, 'bad_transition');
  const long = sentQuote('bk_seed_19');
  assert.equal(declineQuote(long, { reason: 'x'.repeat(500) }).quote.declineReason.length, 200);
});

test('declineQuote can be undone, and a viewed quote can be declined too', () => {
  const id = sentQuote();
  recordQuoteViewed(id);
  const declined = declineQuote(id, { reason: 'Too dear' });
  assert.equal(declined.ok, true);
  assert.equal(undo(declined.undoToken).ok, true);
  assert.equal(quote(id).status, 'viewed');
  assert.ok(!getState().messages.some((m) => m.id === declined.message.id));
  assert.equal(stageOf(SURVEYED), 'quote');
});

// ---------- the whole journey through the store ----------

test('the whole journey: funnel enquiry, confirm, survey done, quote, send, view, accept, confirm, install, paid. The numbers move at every step', () => {
  const count = (stageId) => selectPipeline(getState(), NOW).stages.find((s) => s.id === stageId).count;
  const baseline = ['enquiry', 'survey', 'quote', 'accepted', 'install', 'done'].map(count);
  assert.deepEqual(baseline, [2, 3, 5, 2, 3, 6]);
  const leadsBefore = selectLeadSources(getState(), 'all', NOW);
  const made = createBooking({
    serviceId: 'ev_quote', pencil: true, customer: { name: 'Hannah Boyd', phone: '07700 900777', email: 'hannah@example.com' }, address: { line1: '', postcode: 'BT9 6QP' },
    answers: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, utm: { source: 'ig', medium: 'paid_social', campaign: 'reels' }
  });
  const e = made.booking;
  assert.deepEqual([e.utm.source, e.tentative, e.status], ['instagram', true, 'new']);
  assert.equal(count('enquiry'), 3);
  assert.equal(selectLeadSources(getState(), 'all', NOW).sources.find((s) => s.id === 'instagram').enquiries, leadsBefore.sources.find((s) => s.id === 'instagram').enquiries + 1);
  assert.equal(selectSla(getState(), NOW).waitingCount, 3);
  assert.equal(confirmBooking(e.id).ok, true);
  assert.deepEqual([count('enquiry'), count('survey')], [2, 4]);
  assert.equal(selectSla(getState(), NOW).waitingCount, 2, 'confirming is the reply');
  setClock(new Date(2026, 9, 24, 12, 30));
  assert.equal(completeBooking(e.id, { finalPrice: 0, sendReview: false }).ok, true);
  assert.deepEqual([count('survey'), count('quote')], [3, 6]);
  assert.equal(selectInsights(getState(), '2026-10-24T12:30').owedCount, 4, 'a free survey is not owed');
  const q = createQuote({ bookingId: e.id });
  const sent = sendQuote(q.quote.id, { via: 'whatsapp' });
  assert.equal(count('quote'), 6);
  const stats = selectQuoteStats(getState(), 'all', '2026-10-24T12:30');
  assert.equal(stats.sent, 17);
  assert.equal(stats.waitingCount, 4);
  assert.equal(recordQuoteViewed(q.quote.id).changed, true);
  const [slot] = nextFreeSlots(getState(), 'ev', 1);
  const accepted = acceptQuote(q.quote.id, { date: slot.date, windowId: slot.windowId });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.deepEqual([count('quote'), count('accepted')], [5, 3]);
  assert.equal(confirmBooking(accepted.booking.id).ok, true);
  assert.deepEqual([count('accepted'), count('install')], [2, 4]);
  const [sy, sm, sd] = slot.date.split('-').map(Number);
  setClock(new Date(sy, sm - 1, sd, 17, 30));
  assert.equal(completeBooking(accepted.booking.id, { finalPrice: 1514, paid: false, sendReview: false }).ok, true);
  assert.deepEqual([count('install'), count('done')], [3, 7]);
  assert.equal(selectInsights(getState(), `${slot.date}T17:30`).owedCount, 5, 'the install is now owed');
  assert.equal(markPaid(accepted.booking.id, 'bank').ok, true);
  const ig = selectLeadSources(getState(), 'all', `${slot.date}T17:30`).sources.find((s) => s.id === 'instagram');
  assert.equal(ig.installs, leadsBefore.sources.find((s) => s.id === 'instagram').installs + 1);
  assert.equal(ig.revenue, leadsBefore.sources.find((s) => s.id === 'instagram').revenue + 1514);
  assert.ok(sent.ok);
  assert.equal(selectJourney(getState(), e.id, `${slot.date}T17:30`).stage, 'done');
});

test('rescheduling the pencilled install is the owner\'s tool: the quote stays accepted and the install stays pending', () => {
  const id = sentQuote();
  const [one, two] = nextFreeSlots(getState(), 'ev', 2);
  const accepted = acceptQuote(id, { date: one.date, windowId: one.windowId });
  const moved = rescheduleBooking(accepted.booking.id, { date: two.date, windowId: two.windowId }, 'owner');
  assert.equal(moved.ok, true);
  assert.equal(moved.booking.tentative, false, 'the owner chose the time');
  assert.equal(moved.booking.status, 'new');
  assert.equal(quote(id).status, 'accepted');
  assert.equal(stageOf(SURVEYED), 'accepted', 'still waiting for his confirmation');
  assert.equal(confirmBooking(accepted.booking.id).ok, true);
  assert.equal(stageOf(SURVEYED), 'install');
  assert.equal(store.cancelBooking(accepted.booking.id, 'owner').ok, true);
  assert.equal(stageOf(SURVEYED), 'accepted', 'a cancelled install puts the job back to waiting for a day');
});
