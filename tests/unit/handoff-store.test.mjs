// tests/unit/handoff-store.test.mjs: the WhatsApp link handoff end to end in the store (importEnquiry, importQuoteDecision, importHandoff), the
// handoff links in messages.js, previewImport and the other v4 selectors. Two browsers are two memory storages the store is switched between.
// Owner: A4 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS, SITE_BASE_URL } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { addDays } from '../../js/core/dates.js';
import { isUnscheduled, nextFreeSlot } from '../../js/core/availability.js';
import {
  decodePayload, encodePayload, dashboardImportLink, enquiryWhatsAppText, parseImport, parseQuoteLink, payloadChecksum, quoteLink
} from '../../js/core/handoff.js';
import {
  acceptanceHandoff, bubbleActions, buildContext, buildMessage, declineHandoff, enquiryHandoff, ownerWhatsAppUrl
} from '../../js/core/messages.js';
import { quoteDetailFromLink, quoteTotal, assessQuoteDecision } from '../../js/core/quotes.js';
import {
  previewImport, selectBookingById, selectCustomers, selectInsights, selectJourney, selectLeadSources, selectMessages, selectNeedsYou, selectPipeline,
  selectQuoteDetail, selectQuoteLinkInfo, selectQuoteList, selectQuoteStats, selectSla, selectUnreadMessageCount, leadSourceOf
} from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

const {
  initStore, getState, createBooking, createQuote, updateQuote, sendQuote, recordQuoteViewed, importEnquiry, importQuoteDecision, importHandoff, undo,
  rescheduleBooking, confirmBooking, addDaysOff, updateService, setDemoPhone, updateSettings
} = store;

const NOW = '2026-10-23T20:30';
const T0 = new Date(2026, 9, 23, 20, 30);

function memStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

let customerStore;
let ownerStore;
beforeEach(() => {
  setClock(T0);
  customerStore = memStorage();
  ownerStore = memStorage();
  initStore({ storage: ownerStore, force: true });
});
afterEach(() => setClock(null));

const asOwner = () => initStore({ storage: ownerStore, force: true });
const asCustomer = () => initStore({ storage: customerStore, force: true });

const FUNNEL = {
  customer: { name: 'Aoife Magee', phone: '07700 900231', email: 'aoife.magee@example.com' }, address: { line1: '', postcode: 'BT9 6QP' },
  notes: 'Cable run is about six metres from the fuse box in the garage.', source: 'website', serviceId: 'ev_quote', pencil: true,
  answers: { postcode: 'BT9 6QP', parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: true },
  utm: { source: 'facebook', medium: 'paid_social', campaign: 'ev_charger_leads' }
};

// The customer finishes the funnel in THEIR browser and taps "send my enquiry to Daniel on WhatsApp".
function customerSends(over = {}) {
  asCustomer();
  const made = createBooking({ ...FUNNEL, ...over });
  assert.equal(made.ok, true, JSON.stringify(made));
  const hand = enquiryHandoff(made.booking, getState());
  assert.equal(hand.ok, true);
  return { booking: made.booking, hand };
}

const wireEnq = (over = {}) => ({
  v: 1, t: 'enq', i: 'EL-1043', c: '2026-10-23T18:42', n: 'Aoife Magee', p: '07700 900231', e: 'aoife@example.com', z: 'BT9 6QP',
  a: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, o: 1, m: 'Hello', u: 'facebook', ...over
});

// Owner: import the enquiry, write a quote and send it. Returns what the customer receives.
function ownerImportsAndQuotes() {
  const { hand } = customerSends();
  asOwner();
  const imported = importHandoff(hand.link);
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const made = createQuote({ bookingId: imported.bookingId });
  assert.equal(made.ok, true);
  const sent = sendQuote(made.quote.id, { via: 'whatsapp' });
  assert.equal(sent.ok, true);
  return { enquiry: imported.booking, quoteId: made.quote.id, link: sent.link, message: sent.message };
}

// ---------- importEnquiry ----------

test('importEnquiry: the same path as a website enquiry, with the customer\'s own details, time and source', () => {
  const { booking: theirs, hand } = customerSends();
  asOwner();
  const before = getState();
  const slot = nextFreeSlot(before, 'ev_quote', { ownerMode: false });
  const out = importEnquiry(hand.link);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.existed, false);
  const b = selectBookingById(getState(), out.bookingId);
  assert.equal(b.id, out.bookingId);
  assert.deepEqual([b.serviceId, b.source, b.status, b.urgent, b.seenByOwner, b.seed], ['ev_quote', 'website', 'new', false, false, false]);
  assert.deepEqual([b.customer.name, b.customer.phone, b.customer.email, b.address.postcode, b.address.line1], ['Aoife Magee', '07700 900231', 'aoife.magee@example.com', 'BT9 6QP', '']);
  assert.equal(b.notes, FUNNEL.notes);
  assert.deepEqual(b.answers, FUNNEL.answers);
  assert.deepEqual(b.utm, { source: 'facebook', medium: '', campaign: '' });
  assert.equal(leadSourceOf(b), 'facebook');
  assert.equal(b.importId, `${theirs.ref}|${theirs.createdAt}|447700900231`);
  assert.equal(b.ref, theirs.ref, 'the customer\'s own ref is kept when it is free here');
  // the survey is pencilled in from HIS diary, not the customer's
  assert.equal(b.tentative, true);
  assert.equal(isUnscheduled(b), false);
  assert.equal(b.start.slice(0, 10), slot.date);
  assert.equal(b.start.slice(11, 16), slot.windowId === 0 ? '08:00' : b.start.slice(11, 16));
  // the same two simulated messages a website enquiry makes, the owner alert on top
  assert.deepEqual(out.messages.map((m) => m.kind), ['customer_received', 'owner_new_booking']);
  const alert = out.messages.at(-1);
  assert.equal(alert.to, 'owner');
  assert.ok(alert.body.includes('Aoife Magee') && alert.body.includes('BT9 6QP') && alert.body.includes('Survey pencilled in:') && alert.body.includes('Parking: private driveway.'));
  assert.equal(alert.simulated, true);
  assert.equal(selectMessages(getState(), { to: 'owner' })[0].id, alert.id, 'the alert sorts first');
  assert.equal(selectUnreadMessageCount(getState()) > 0, true);
  // history: created by the customer at the time they SENT it, then the note
  assert.deepEqual(b.history.map((e) => [e.event, e.by, e.at, e.note]), [
    ['created', 'customer', b.createdAt, 'website'], ['note', 'system', NOW, 'Added from a WhatsApp link']
  ]);
  assert.equal(getState().bookings.length, before.bookings.length + 1);
  assert.ok(getState().refSeq > Number(b.ref.slice(3)));
});

test('importEnquiry is idempotent: the same link again changes nothing, whatever form it arrives in', () => {
  const { hand } = customerSends();
  asOwner();
  const first = importEnquiry(hand.link);
  const after = getState();
  const forms = [hand.link, hand.encoded, `#import=${hand.encoded}`, hand.text, parseImport(hand.link), parseImport(hand.link).data, parseImport(hand.link).payload, `#/import?d=${hand.encoded}`];
  for (const form of forms) {
    const again = importEnquiry(form);
    assert.deepEqual([again.ok, again.existed, again.bookingId], [true, true, first.bookingId]);
    assert.equal(again.booking.id, first.bookingId);
    assert.equal(getState(), after, 'the state object itself is untouched (nothing written)');
  }
  assert.equal(getState().bookings.filter((b) => b.importId).length, 1);
  assert.equal(importHandoff(hand.link).existed, true);
});

test('two different customers who both sent EL-1043 are both imported; the second takes the next ref', () => {
  const a = encodePayload(wireEnq());
  const b = encodePayload(wireEnq({ n: 'Sean Doherty', p: '07700 900344', e: undefined }));
  const first = importEnquiry(a);
  const second = importEnquiry(b);
  assert.equal(first.ok && second.ok, true);
  assert.equal(second.existed, false);
  assert.notEqual(first.bookingId, second.bookingId);
  assert.equal(first.booking.ref, 'EL-1043');
  assert.equal(second.booking.ref, 'EL-1044', 'the ref was taken, so the next one in this store');
  assert.notEqual(first.booking.importId, second.booking.importId);
  assert.equal(importEnquiry(a).existed, true);
  assert.equal(importEnquiry(b).existed, true);
  assert.equal(getState().refSeq, 1045);
});

test('refs: a free plausible ref is kept (and never lowers the sequence), an implausible one takes the next', () => {
  const s0 = getState().refSeq;
  assert.equal(importEnquiry(encodePayload(wireEnq({ i: 'EL-1043' }))).booking.ref, `EL-${s0}`);
  assert.equal(importEnquiry(encodePayload(wireEnq({ i: 'EL-1075', p: '07700 900301' }))).booking.ref, 'EL-1075');
  assert.equal(getState().refSeq, 1076);
  assert.equal(importEnquiry(encodePayload(wireEnq({ i: 'EL-1080', p: '07700 900302' }))).booking.ref, 'EL-1080');
  assert.equal(importEnquiry(encodePayload(wireEnq({ i: 'EL-999999', p: '07700 900303' }))).booking.ref, 'EL-1081', 'nowhere near the sequence: ignored');
  assert.equal(importEnquiry(encodePayload(wireEnq({ i: 'EL-0500', p: '07700 900304' }))).booking.ref, 'EL-1082', 'below the range this store uses: ignored');
  assert.equal(importEnquiry(encodePayload(wireEnq({ i: 'EL-1010', p: '07700 900305' }))).booking.ref, 'EL-1083', 'a ref the demo already used is not reused');
  const refs = getState().bookings.map((b) => b.ref);
  assert.equal(new Set(refs).size, refs.length, 'no two bookings share a ref');
  assert.equal(getState().refSeq, 1084);
});

test('the 24 hour reply clock starts when the customer sent it: never in the future, never older than 30 days', () => {
  const at = (c, p) => importEnquiry(encodePayload(wireEnq({ c, p, i: 'EL-1050' }))).booking;
  const hours = (n) => { const d = new Date(T0.getTime() - n * 3600000); const pad = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fresh = at(hours(21), '07700 900401');
  assert.equal(fresh.createdAt, hours(21));
  assert.equal(fresh.history[0].at, hours(21));
  const sla = selectSla(getState());
  const soon = sla.dueSoon.find((x) => x.bookingId === fresh.id);
  assert.ok(soon && soon.minutesLeft === 180, 'sent 21 hours ago: the 24 hour promise has 3 hours left');
  const late = at(hours(25), '07700 900402');
  assert.equal(late.createdAt, hours(25));
  const overdue = selectSla(getState()).overdue.find((x) => x.bookingId === late.id);
  assert.ok(overdue && overdue.minutesOverdue === 60, `overdue by ${overdue && overdue.minutesOverdue}`);
  assert.equal(at('2099-01-01T00:00', '07700 900403').createdAt, NOW, 'a time in the future is now');
  assert.equal(at('2026-10-23T20:31', '07700 900404').createdAt, NOW);
  assert.equal(at('2001-02-03T04:05', '07700 900405').createdAt, '2026-09-23T20:30', 'a stamp older than 30 days is exactly 30 days old');
});

test('an enquiry from outside Northern Ireland is imported and flagged for the owner; notes up to 400 characters are kept; no utm means no utm', () => {
  const out = importEnquiry(encodePayload(wireEnq({ z: 'DG9 8PQ', u: undefined, m: 'n'.repeat(400) })));
  assert.equal(out.ok, true);
  assert.equal(out.booking.address.postcode, 'DG9 8PQ');
  assert.equal(out.booking.notes.length, 400);
  assert.equal('utm' in out.booking, false);
  assert.equal(leadSourceOf(out.booking), 'other');
  assert.ok(out.messages.at(-1).body.includes('Outside Northern Ireland (DG9)'));
});

test('when the diary is full the imported enquiry is kept unscheduled, like a website one', () => {
  const days = Array.from({ length: 60 }, (_, i) => addDays('2026-10-23', i));
  assert.equal(addDaysOff(days).ok, true);
  const out = importEnquiry(encodePayload(wireEnq()));
  assert.equal(out.ok, true);
  assert.equal(isUnscheduled(out.booking), true);
  assert.ok(!out.booking.tentative);
  assert.ok(out.messages[0].body.includes('will be in touch within 24 hours to discuss your installation'));
  assert.deepEqual(bubbleActions(out.messages.at(-1), out.booking, NOW).map((a) => a.id), ['open_job', 'call'], 'no Confirm: it has no day to confirm');
});

test('importEnquiry refuses everything that is not a clean enquiry and never changes anything', () => {
  const state = getState();
  const enc = encodePayload(wireEnq());
  const bad = [
    [undefined, 'empty'], [null, 'empty'], ['', 'empty'], [42, 'empty'], [{}, 'no_payload'], ['hello', 'no_payload'], ['x'.repeat(2_000_000), 'too_long'],
    [`#import=${enc.slice(0, -4)}`, 'damaged'], [`#import=${enc.slice(0, 40)}B${enc.slice(41)}`.replace(/B(?=B)/, 'C'), 'damaged'],
    [encodePayload(wireEnq({ v: 9 })), 'unsupported'],
    [encodePayload(wireEnq({ n: 5 })), 'invalid'], [encodePayload(wireEnq({ p: 'x' })), 'invalid'], [encodePayload(wireEnq({ z: 'x' })), 'invalid'], [encodePayload(wireEnq({ c: 'x' })), 'invalid'],
    [encodePayload(wireEnq({ i: 'x' })), 'invalid'],
    [encodePayload({ v: 1, t: 'acc', i: 'Q-EL-1043', n: 'Aoife', d: [], w: 'any', t2: 100 }), 'wrong_kind'],
    [encodePayload({ v: 1, t: 'quo', i: 'Q-EL-1043', n: 'Aoife', l: [['x', 1, 5]], x: '2026-11-22' }), 'wrong_kind']
  ];
  for (const [input, reason] of bad) {
    const out = importEnquiry(input);
    assert.equal(out.ok, false, String(reason));
    assert.equal(out.reason, reason, JSON.stringify(out).slice(0, 120));
    assert.ok(typeof out.message === 'string' && out.message.length > 10);
  }
  assert.equal(importEnquiry(encodePayload(wireEnq({ n: 5 }))).errors.name.length > 3, true);
  assert.equal(getState(), state, 'nothing was written by any of them');
});

test('a service that is switched off, and a browser whose storage is full, fail calmly', () => {
  const enc = encodePayload(wireEnq());
  assert.equal(updateService('ev_quote', { active: false }).ok, true);
  const off = importEnquiry(enc);
  assert.deepEqual([off.ok, off.reason], [false, 'service_unavailable']);
  assert.ok(off.message.length > 10);
  assert.equal(previewImport(getState(), enc).state, 'blocked');
  assert.equal(updateService('ev_quote', { active: true }).ok, true);

  const full = memStorage();
  initStore({ storage: full, force: true });
  const before = getState();
  const realSet = full.setItem;
  full.setItem = (k, v) => {
    if (k === STORAGE_KEYS.state) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    realSet(k, v);
  };
  const out = importEnquiry(enc);
  assert.deepEqual([out.ok, out.reason], [false, 'storage_full']);
  assert.equal(getState(), before);
});

// ---------- the quote link ----------

test('sendQuote carries the self-contained link, the message holds the same one, and it reads back on another phone', () => {
  const { quoteId, link, message, enquiry } = ownerImportsAndQuotes();
  assert.ok(link.startsWith(`${SITE_BASE_URL}quote.html#d=`));
  assert.ok(message.body.includes(link));
  assert.ok(link.length < 1800 + 60, `link ${link.length}`);
  const sent = getState().quotes[quoteId];
  assert.equal(selectQuoteLinkInfo(getState(), quoteId).url, link);
  assert.equal(selectQuoteLinkInfo(getState(), 'Q-NOPE'), null);
  assert.equal(selectQuoteLinkInfo(getState(), '__proto__'), null);
  // the customer's phone has no copy of anything: the link alone builds the quote page
  asCustomer();
  assert.equal(getState().quotes[quoteId], undefined);
  const parsed = parseQuoteLink(link);
  assert.equal(parsed.ok, true);
  assert.deepEqual([parsed.data.id, parsed.data.ref, parsed.data.customerFirst, parsed.data.postcode, parsed.data.validUntil, parsed.data.total, parsed.data.sample], [quoteId, enquiry.ref, 'Aoife', 'BT9 6QP', sent.validUntil, quoteTotal(sent), true]);
  assert.deepEqual(parsed.data.lines.map((l) => [l.label, l.qty, l.unitPrice]), sent.lines.map((l) => [l.label, l.qty, l.unitPrice]));
  assert.equal(parsed.data.notes, sent.notes);
  assert.equal(parsed.data.brand, 'ZAPPI');
});

test('sendQuote with a quote too big for a link still sends; linkPortable says it will only open here', () => {
  const { enquiry } = ownerImportsAndQuotes();
  const lines = Array.from({ length: 15 }, (_, i) => ({ label: `Item number ${i + 1}`, detail: '', qty: 1, unitPrice: 10 + i }));
  const made = createQuote({ bookingId: enquiry.id, lines });
  assert.equal(made.ok, true);
  const sent = sendQuote(made.quote.id, { via: 'whatsapp' });
  assert.equal(sent.ok, true);
  assert.equal(sent.linkPortable, false);
  assert.equal(sent.link, `${SITE_BASE_URL}quote.html#q=${made.quote.id}`);
  assert.ok(sent.message.body.includes(sent.link));
  const info = selectQuoteLinkInfo(getState(), made.quote.id);
  assert.deepEqual([info.portable, info.reason], [false, 'too_many_lines']);
  // 14 lines is fine
  const fourteen = createQuote({ bookingId: enquiry.id, lines: lines.slice(0, 14) });
  assert.equal(sendQuote(fourteen.quote.id, { via: 'whatsapp' }).linkPortable, true);
});

test('quoteDetailFromLink has the same shape and values selectQuoteDetail gives for the stored quote', () => {
  const { quoteId, link } = ownerImportsAndQuotes();
  const stored = selectQuoteDetail(getState(), quoteId);
  const fromLink = quoteDetailFromLink(parseQuoteLink(link).data, NOW);
  assert.deepEqual(Object.keys(fromLink).sort(), [...Object.keys(stored), 'fromLink'].sort());
  for (const key of ['status', 'total', 'customerFirst', 'validUntil', 'validUntilLabel', 'expiresInDays', 'canAccept', 'canDecline', 'isExpired', 'ref']) {
    assert.deepEqual(fromLink[key], stored[key], key);
  }
  assert.deepEqual(fromLink.lines.map((l) => [l.label, l.qty, l.unitPrice, l.lineTotal]), stored.lines.map((l) => [l.label, l.qty, l.unitPrice, l.lineTotal]));
  assert.equal(fromLink.address, 'BT9 6QP');
  // an expired link says so
  setClock(new Date(2027, 0, 5, 9, 0));
  const late = quoteDetailFromLink(parseQuoteLink(link, { now: '2027-01-05T09:00' }).data, '2027-01-05T09:00');
  assert.deepEqual([late.status, late.canAccept, late.isExpired], ['expired', false, true]);
  assert.equal(quoteDetailFromLink(null), null);
  assert.equal(quoteDetailFromLink({}), null);
});

// ---------- the whole loop ----------

test('the whole loop across two browsers: enquiry, import, quote, link, accept by WhatsApp, import, install to arrange, then place and confirm it', () => {
  const { enquiry, quoteId, link } = ownerImportsAndQuotes();
  // the customer reads the quote on their phone and accepts: Thu or Fri mornings
  asCustomer();
  const parsedQuote = parseQuoteLink(link);
  const acc = acceptanceHandoff({ quote: parsedQuote.data, days: ['thu', 'fri'], part: 'am', note: 'Gate code is 1234' }, getState());
  assert.equal(acc.ok, true);
  assert.ok(acc.url.startsWith('https://wa.me/447885496800?text='));
  assert.ok(decodeURIComponent(acc.url).includes(`I'd like to go ahead with quote ${quoteId} (`));
  assert.ok(decodeURIComponent(acc.url).includes('Best: Thu or Fri mornings.'));
  // the owner taps the link in WhatsApp
  asOwner();
  const preview = previewImport(getState(), acc.link);
  assert.deepEqual([preview.ok, preview.kind, preview.state, preview.reason], [true, 'acc', 'ready', '']);
  assert.equal(preview.actionLabel, 'Mark quote accepted and plan the install');
  assert.equal(preview.title, 'Aoife accepted a quote');
  assert.equal(preview.summary, `Aoife accepted quote ${quoteId} (£${quoteTotal(getState().quotes[quoteId]).toLocaleString('en-GB')}), prefers Thu/Fri mornings`);
  const before = getState();
  const out = importHandoff(acc.link);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual([out.kind, out.existed], ['acc', false]);
  // the quote
  const q = getState().quotes[quoteId];
  assert.deepEqual([q.status, q.acceptedVia, q.installBookingId, q.acceptedAt, q.seed], ['accepted', 'whatsapp', out.bookingId, NOW, false]);
  // the install booking: unscheduled, new, the preferences in its notes, everything else as an accepted quote makes it
  const install = selectBookingById(getState(), out.bookingId);
  assert.deepEqual([install.serviceId, install.status, install.durationMin, install.start, install.urgent, install.seenByOwner, install.quoteId], ['ev', 'new', 0, NOW, false, false, quoteId]);
  assert.equal(isUnscheduled(install), true);
  assert.ok(!install.tentative);
  assert.equal(install.quotedPrice, quoteTotal(q));
  assert.equal(install.notes, 'Install preferences: Thu or Fri mornings. Customer note: Gate code is 1234');
  assert.deepEqual([install.customer.name, install.customer.phone, install.address.postcode], ['Aoife Magee', '07700 900231', 'BT9 6QP']);
  assert.deepEqual(install.answers, enquiry.answers);
  assert.equal(install.ref !== enquiry.ref, true);
  assert.deepEqual(install.history.map((e) => [e.event, e.by]), [['created', 'customer']]);
  const enquiryNow = selectBookingById(getState(), enquiry.id);
  assert.deepEqual(enquiryNow.history.at(-1), { at: NOW, event: 'message', by: 'customer', note: 'Quote accepted' });
  // the two simulated messages: the install is not "pencilled in"
  assert.deepEqual(out.messages.map((m) => [m.kind, m.to, m.bookingId]), [['customer_quote_accepted', 'customer', install.id], ['owner_quote_accepted', 'owner', install.id]]);
  assert.match(out.messages[0].body, /^Hi Aoife, thanks for accepting your quote \(£[\d,]+\)\. I will be in touch shortly to agree your installation day\. Quote Q-EL-\d+$/);
  const ownerBody = out.messages[1].body;
  assert.ok(ownerBody.startsWith(`*Quote accepted ${quoteId}*\nAoife Magee accepted your quote (`));
  assert.ok(ownerBody.includes('Install day: still to be agreed.') && ownerBody.includes('Note: "Install preferences: Thu or Fri mornings.') && !ownerBody.includes('pencilled'));
  assert.deepEqual(bubbleActions(out.messages[1], install, NOW).map((a) => a.id), ['open_job', 'call']);
  assert.equal(getState().meta.msgSeq, before.meta.msgSeq + 2);
  // it shows in the pipeline under Accepted and in Needs you, and the journey knows it
  const pipeline = selectPipeline(getState());
  const item = pipeline.stages.find((s) => s.id === 'accepted').items.find((i) => i.quoteId === quoteId);
  assert.ok(item);
  assert.deepEqual([item.installBookingId, item.stage, item.bookingId], [install.id, 'accepted', enquiry.id]);
  assert.equal(selectJourney(getState(), install.id).stage, 'accepted');
  assert.ok(selectNeedsYou(getState()).some((b) => b.id === install.id));
  // every selector copes with an install that has no day yet
  for (const fn of [selectInsights, selectCustomers, selectMessages, selectUnreadMessageCount, selectSla, selectLeadSources, selectQuoteStats, selectQuoteList, selectNeedsYou]) {
    assert.doesNotThrow(() => fn(getState()), fn.name);
  }
  assert.doesNotThrow(() => selectQuoteDetail(getState(), quoteId));
  assert.equal(selectQuoteDetail(getState(), quoteId).installWhen, 'To be arranged');
  // "Confirm the install day": confirm refuses with no day, placing it in the diary and then confirming works
  assert.equal(confirmBooking(install.id).reason, 'unscheduled');
  const slot = nextFreeSlot(getState(), 'ev', { ownerMode: true });
  const placed = rescheduleBooking(install.id, { date: slot.date, windowId: slot.windowId }, 'owner');
  assert.equal(placed.ok, true, JSON.stringify(placed));
  assert.equal(confirmBooking(install.id).ok, true);
  assert.equal(selectJourney(getState(), install.id).stage, 'install');
  // the same acceptance again: nothing happens
  const settled = getState();
  const again = importHandoff(acc.link);
  assert.deepEqual([again.ok, again.existed, again.bookingId, again.quote.status], [true, true, install.id, 'accepted']);
  assert.equal(getState(), settled);
  assert.equal(previewImport(getState(), acc.link).state, 'done');
  assert.equal(previewImport(getState(), acc.link).bookingId, install.id);
});

test('an acceptance of a quote that was only opened (viewed) works, and the import can be undone', () => {
  const { quoteId, link } = ownerImportsAndQuotes();
  assert.equal(recordQuoteViewed(quoteId).changed, true);
  asCustomer();
  const acc = acceptanceHandoff({ quote: parseQuoteLink(link).data, days: [], part: 'any' }, getState());
  asOwner();
  const before = getState();
  const out = importQuoteDecision(acc.encoded);
  assert.equal(out.ok, true);
  assert.equal(getState().quotes[quoteId].status, 'accepted');
  assert.equal(selectBookingById(getState(), out.bookingId).notes, 'Install preferences: any day.');
  assert.ok(out.undoToken);
  assert.equal(undo(out.undoToken).ok, true);
  assert.equal(getState().quotes[quoteId].status, 'viewed');
  assert.equal(getState().quotes[quoteId].installBookingId, null);
  assert.equal('acceptedVia' in getState().quotes[quoteId], false);
  assert.equal(selectBookingById(getState(), out.bookingId), null);
  assert.equal(getState().bookings.length, before.bookings.length);
});

test('a decline comes back with its reason: the quote is declined, the owner alert is logged, again does nothing', () => {
  const { quoteId, enquiry, link } = ownerImportsAndQuotes();
  asCustomer();
  const dec = declineHandoff({ quote: parseQuoteLink(link).data, reason: 'price', note: 'Found a cheaper quote' }, getState());
  assert.equal(dec.ok, true);
  assert.ok(decodeURIComponent(dec.url).includes(`Thanks for the quote ${quoteId} (`));
  asOwner();
  const preview = previewImport(getState(), dec.link);
  assert.deepEqual([preview.kind, preview.state, preview.actionLabel, preview.title], ['dec', 'ready', 'Mark quote declined', 'Aoife declined a quote']);
  assert.match(preview.summary, new RegExp(`^Aoife declined quote ${quoteId} \\(£[\\d,]+\\)\\. Reason: Too expensive$`));
  const out = importHandoff(dec.link);
  assert.deepEqual([out.ok, out.kind, out.existed], [true, 'dec', false]);
  const q = getState().quotes[quoteId];
  assert.deepEqual([q.status, q.declineReason, q.declinedVia], ['declined', 'Too expensive: Found a cheaper quote', 'whatsapp']);
  assert.ok(q.declinedAt);
  assert.equal(out.message.kind, 'owner_quote_declined');
  assert.ok(out.message.body.includes('Reason: Too expensive: Found a cheaper quote.'));
  assert.deepEqual(selectBookingById(getState(), enquiry.id).history.at(-1), { at: NOW, event: 'message', by: 'customer', note: 'Quote declined' });
  assert.equal(selectPipeline(getState()).lost.some((i) => i.quoteId === quoteId), true);
  const settled = getState();
  const again = importQuoteDecision(dec.link);
  assert.deepEqual([again.ok, again.existed, again.kind], [true, true, 'dec']);
  assert.equal(getState(), settled);
  assert.equal(previewImport(getState(), dec.link).state, 'done');
  // and then accepting the declined quote is refused, with the reason in plain words
  asCustomer();
  const acc = acceptanceHandoff({ quote: parseQuoteLink(link).data, days: ['mon'], part: 'am' }, getState());
  asOwner();
  const late = importHandoff(acc.link);
  assert.deepEqual([late.ok, late.reason], [false, 'quote_declined']);
  assert.ok(late.message.includes('declined'));
});

test('an acceptance that cannot be applied here says why and changes nothing', () => {
  const { quoteId, enquiry, link } = ownerImportsAndQuotes();
  asCustomer();
  const data = parseQuoteLink(link).data;
  const acc = acceptanceHandoff({ quote: data, days: ['thu'], part: 'am' }, getState());
  const dec = declineHandoff({ quote: data, reason: 'time' }, getState());

  // a browser that has never seen this quote (a fresh demo store): quote_not_found
  initStore({ storage: memStorage(), force: true });
  const fresh = getState();
  const none = importHandoff(acc.link);
  assert.deepEqual([none.ok, none.reason], [false, 'quote_not_found']);
  assert.ok(none.message.includes(quoteId) && none.message.includes('Open this link on the phone you sent the quote from'));
  assert.equal(importHandoff(dec.link).reason, 'quote_not_found');
  assert.equal(previewImport(fresh, acc.link).state, 'blocked');
  assert.equal(previewImport(fresh, acc.link).reason, 'quote_not_found');
  assert.equal(getState(), fresh);

  asOwner();
  // the id exists here but for somebody else
  assert.equal(updateQuote(quoteId, { customerName: 'Sean Doherty' }).ok, true);
  const mismatch = importHandoff(acc.link);
  assert.deepEqual([mismatch.ok, mismatch.reason], [false, 'quote_mismatch']);
  assert.equal(updateQuote(quoteId, { customerName: 'Aoife Magee' }).ok, true);

  // the owner changed the price after sending it: the customer accepted the old total
  const lines = getState().quotes[quoteId].lines.map((l, i) => (i === 0 ? { ...l, unitPrice: l.unitPrice + 100 } : l));
  assert.equal(updateQuote(quoteId, { lines }).ok, true);
  const changed = importHandoff(acc.link);
  const oldTotal = parseImport(acc.link).data.total;
  assert.deepEqual([changed.ok, changed.reason, changed.accepted, changed.expected], [false, 'total_changed', oldTotal, oldTotal + 100]);
  assert.ok(changed.message.includes('Check with Aoife'));
  const stillOpen = getState();
  assert.equal(getState().quotes[quoteId].status, 'sent');
  assert.equal(previewImport(getState(), acc.link).reason, 'total_changed');
  assert.equal(previewImport(getState(), acc.link).state, 'blocked');
  // a decline does not depend on the total
  assert.equal(previewImport(getState(), dec.link).state, 'ready');
  assert.equal(getState(), stillOpen);
  // ... unless the owner has checked with the customer and forces it
  const forced = importQuoteDecision(acc.link, { force: true });
  assert.equal(forced.ok, true, JSON.stringify(forced));
  assert.equal(forced.booking.quotedPrice, oldTotal + 100, 'the install is worth what the quote on this device now says');
  // force does not override anything else
  assert.deepEqual([importQuoteDecision(dec.link, { force: true }).ok, importQuoteDecision(dec.link, { force: true }).reason], [false, 'already_accepted']);
  assert.equal(importQuoteDecision(dec.link).bookingId, forced.bookingId);
  assert.ok(selectBookingById(getState(), enquiry.id));
});

test('draft, expired and decline-after-accept are refused or allowed as the rules say', () => {
  const { quoteId, enquiry, link } = ownerImportsAndQuotes();
  asCustomer();
  const data = parseQuoteLink(link).data;
  const acc = acceptanceHandoff({ quote: data, days: ['sat'], part: 'any' }, getState());
  const dec = declineHandoff({ quote: data, reason: 'plans' }, getState());
  asOwner();
  // a draft (a second version the owner has not sent)
  const draft = createQuote({ bookingId: enquiry.id });
  const draftAcc = acceptanceHandoff({ quote: { ...data, id: draft.quote.id }, days: [], part: 'any' }, getState());
  assert.deepEqual([importHandoff(draftAcc.link).ok, importHandoff(draftAcc.link).reason], [false, 'quote_not_open']);
  assert.equal(importHandoff(declineHandoff({ quote: { ...data, id: draft.quote.id } }, getState()).link).reason, 'quote_not_open');
  // expired: the last good day is validUntil itself
  const until = getState().quotes[quoteId].validUntil;
  const [y, m, d] = until.split('-').map(Number);
  setClock(new Date(y, m - 1, d, 23, 0));
  assert.equal(assessQuoteDecision(getState().quotes, parseImport(acc.link).data, `${until}T23:00`).state, 'ready', 'still good on the last day');
  setClock(new Date(y, m - 1, d + 1, 8, 0));
  const expired = importHandoff(acc.link);
  assert.deepEqual([expired.ok, expired.reason], [false, 'expired']);
  assert.ok(expired.message.includes('ran out on'));
  assert.equal(previewImport(getState(), acc.link).state, 'blocked');
  // declining an expired quote is fine
  const declined = importHandoff(dec.link);
  assert.deepEqual([declined.ok, declined.existed], [true, false]);
  assert.equal(getState().quotes[quoteId].status, 'declined');
  assert.equal(getState().quotes[quoteId].declineReason, 'My plans have changed');

  // decline after accept: refused with the install it made
  setClock(T0);
  const second = createQuote({ bookingId: enquiry.id });
  const sent = sendQuote(second.quote.id, { via: 'link' });
  const secondData = parseQuoteLink(sent.link).data;
  const a2 = acceptanceHandoff({ quote: secondData, days: [], part: 'any' }, getState());
  const d2 = declineHandoff({ quote: secondData }, getState());
  const accepted = importHandoff(a2.link);
  assert.equal(accepted.ok, true);
  const late = importHandoff(d2.link);
  assert.deepEqual([late.ok, late.reason, late.bookingId], [false, 'already_accepted', accepted.bookingId]);
  assert.equal(previewImport(getState(), d2.link).reason, 'already_accepted');
});

test('importHandoff dispatches on the kind and refuses a quote link and garbage', () => {
  const { link } = ownerImportsAndQuotes();
  const wrong = importHandoff(link);
  assert.deepEqual([wrong.ok, wrong.reason], [false, 'wrong_kind']);
  assert.ok(wrong.message.includes('quote'));
  assert.equal(importQuoteDecision(link).reason, 'wrong_kind');
  assert.equal(importEnquiry(link).reason, 'wrong_kind');
  const enqLink = dashboardImportLink(wireEnq({ p: '07700 900777' }));
  assert.equal(importQuoteDecision(enqLink).reason, 'wrong_kind');
  assert.equal(importHandoff('garbage').reason, 'no_payload');
  assert.equal(importHandoff(undefined).reason, 'empty');
  assert.equal(importHandoff(enqLink).ok, true);
});

// ---------- previewImport ----------

test('previewImport for an enquiry: ready, then done with the booking to open; garbage gives a calm failure', () => {
  const enc = encodePayload(wireEnq());
  const ready = previewImport(getState(), enc);
  assert.deepEqual([ready.ok, ready.kind, ready.state, ready.reason, ready.title, ready.summary, ready.actionLabel, ready.bookingId, ready.href], [true, 'enq', 'ready', '', 'Aoife Magee sent an enquiry', 'Aoife Magee, BT9 6QP', 'Add to my dashboard', null, '#/bookings']);
  const out = importEnquiry(enc);
  const done = previewImport(getState(), parseImport(enc));
  assert.deepEqual([done.state, done.bookingId, done.href], ['done', out.bookingId, `#/bookings/${out.bookingId}`]);
  for (const junk of [undefined, '', 'nope', {}, [], 5]) {
    const p = previewImport(getState(), junk);
    assert.equal(p.ok, false);
    assert.ok(p.reason && p.message.length > 10);
  }
  const q = previewImport(getState(), quoteLink({ id: 'Q-EL-9', customerName: 'Aoife Magee', lines: [{ label: 'x', qty: 1, unitPrice: 5 }], validUntil: '2026-11-22' }, {}));
  assert.deepEqual([q.ok, q.kind, q.state, q.reason], [true, 'quo', 'blocked', 'wrong_kind']);
});

// ---------- messages.js ----------

test('enquiryHandoff, acceptanceHandoff and declineHandoff give the ready wa.me address, the link, the text and the sizes', () => {
  const { booking, hand } = customerSends();
  assert.deepEqual(Object.keys(hand).sort(), ['chars', 'encoded', 'kind', 'link', 'ok', 'payload', 'text', 'url']);
  assert.equal(hand.kind, 'enq');
  assert.ok(hand.url.startsWith('https://wa.me/447885496800?text='));
  assert.equal(decodeURIComponent(hand.url.slice('https://wa.me/447885496800?text='.length)), hand.text);
  assert.equal(hand.text, enquiryWhatsAppText(booking, { link: hand.link }));
  assert.equal(hand.link, dashboardImportLink(hand.encoded));
  assert.equal(hand.chars, hand.encoded.length);
  assert.ok(hand.chars < 900 && hand.url.length < 2400, `${hand.chars} / ${hand.url.length}`);
  assert.deepEqual(decodePayload(hand.encoded), hand.payload);
  assert.equal(hand.payload.k, payloadChecksum(hand.payload));
  assert.deepEqual(enquiryHandoff({ ref: 'x' }, getState()), { ok: false, reason: 'cannot_carry' });
  assert.deepEqual(enquiryHandoff(null, getState()), { ok: false, reason: 'cannot_carry' });
  assert.deepEqual(acceptanceHandoff({ quote: null }, getState()), { ok: false, reason: 'cannot_carry' });
  assert.deepEqual(declineHandoff(undefined, getState()), { ok: false, reason: 'cannot_carry' });
  // the demo phone redirects every wa.me address, like every other link
  assert.equal(setDemoPhone('07700 900123').ok, true);
  assert.ok(enquiryHandoff(booking, getState()).url.startsWith('https://wa.me/447700900123?text='));
  assert.ok(ownerWhatsAppUrl(getState(), 'hi there').endsWith('?text=hi%20there'));
  assert.equal(ownerWhatsAppUrl(null, 'x'), 'https://wa.me/447885496800?text=x');
  // the owner's own first name and number flow through
  updateSettings({ business: { ownerFirstName: 'Lee' } });
  assert.ok(enquiryHandoff(booking, getState()).text.startsWith('Hi Lee, '));
});

test('the unscheduled install wording can be overridden by the owner\'s own template, which sees installWhen as "a day to be agreed"', () => {
  const { quoteId } = ownerImportsAndQuotes();
  updateSettings({ templates: { customer_quote_accepted: 'Thanks {customerFirst}, install: {installWhen}.' } });
  asCustomer();
  asOwner();
  const link = quoteLink(getState().quotes[quoteId], { booking: getState().bookings.find((b) => b.id === getState().quotes[quoteId].bookingId) });
  asCustomer();
  const acc = acceptanceHandoff({ quote: parseQuoteLink(link).data, days: ['mon'], part: 'am' }, getState());
  asOwner();
  const out = importHandoff(acc.link);
  assert.equal(out.messages[0].body, 'Thanks Aoife, install: a day to be agreed.');
  assert.ok(out.messages[1].body.includes('Install day: still to be agreed.'), 'the other kind keeps the unscheduled default');
  // a scheduled install keeps the v3 wording
  const st = getState();
  const scheduled = { ...selectBookingById(st, out.bookingId), start: '2026-10-27T08:00', durationMin: 240, tentative: true };
  assert.match(buildMessage('owner_quote_accepted', scheduled, st, { quote: st.quotes[quoteId], installBooking: scheduled }).body, /Install pencilled in: Tue 27 Oct, morning, arriving between 8 and 10am \(provisional\)/);
  assert.equal(buildContext(selectBookingById(st, out.bookingId), st).installWhen, 'a day to be agreed');
});

// ---------- persistence ----------

test('an imported enquiry, an accepted quote and what they made survive a reload and the next day\'s demo rollover', () => {
  const { quoteId, link, enquiry } = ownerImportsAndQuotes();
  asCustomer();
  const acc = acceptanceHandoff({ quote: parseQuoteLink(link).data, days: ['fri'], part: 'pm' }, getState());
  asOwner();
  const out = importHandoff(acc.link);
  const importId = selectBookingById(getState(), enquiry.id).importId;
  assert.ok(importId);
  const raw = ownerStore.getItem(STORAGE_KEYS.state);
  assert.ok(raw.includes('"acceptedVia":"whatsapp"'));
  // a reload
  initStore({ storage: ownerStore, force: true });
  assert.equal(getState().quotes[quoteId].acceptedVia, 'whatsapp');
  assert.equal(selectBookingById(getState(), out.bookingId).notes, 'Install preferences: Fri afternoons.');
  // tomorrow: the demo is re-seeded around what a person made
  setClock(new Date(2026, 9, 24, 8, 0));
  initStore({ storage: ownerStore, force: true });
  const kept = selectBookingById(getState(), enquiry.id);
  assert.equal(kept.importId, importId);
  assert.equal(getState().quotes[quoteId].status, 'accepted');
  assert.equal(selectBookingById(getState(), out.bookingId).quoteId, quoteId);
  // importing the same enquiry link tomorrow is still a no-op
  const hand = enquiryWhatsAppText({ ...enquiry }, {});
  assert.ok(hand.length > 0);
  const again = importEnquiry(dashboardImportLink({ v: 1, t: 'enq', i: enquiry.ref, c: enquiry.createdAt, n: enquiry.customer.name, p: enquiry.customer.phone, z: enquiry.address.postcode, o: 1 }));
  assert.equal(again.ok, true);
});
