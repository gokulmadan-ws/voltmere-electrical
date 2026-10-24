// tests/unit/messages-v3.test.mjs: unit tests for the v3 message kinds, placeholders, channels, system messages and bubble actions in messages.js
// Owner: A3 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATES, KIND_LABELS, PLACEHOLDERS, SITE_BASE_URL, TEMPLATE_KINDS, makeDefaultSettings } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { bubbleActions, buildContext, buildMessage, buildSystemMessage } from '../../js/core/messages.js';

beforeEach(() => setClock(new Date(2026, 9, 23, 20, 30)));
afterEach(() => setClock(null));

const NEW_KINDS = ['customer_quote_sent', 'customer_quote_accepted', 'owner_quote_accepted', 'owner_quote_declined', 'customer_photos_request', 'owner_test_event'];

const enquiry = (over = {}) => ({
  id: 'bk_enq', ref: 'EL-1043', createdAt: '2026-10-20T09:00', serviceId: 'ev_quote', serviceName: 'Home EV charger quote', variantId: null, variantLabel: '', start: '2026-10-22T10:00', durationMin: 120,
  status: 'done', urgent: false, emergencyReasons: [], etaMinutes: null, etaAt: null, customer: { name: 'Aoife Magee', phone: '07700 900231', email: 'aoife@example.com' },
  address: { line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' }, notes: '', internalNotes: '', source: 'website', quotedPrice: 0, finalPrice: 0, paid: false, paidMethod: null, paidAt: null,
  seenByOwner: true, reviewRequested: false, cancelledBy: null, cancelReason: '', seed: false, history: [], ...over
});
const install = (over = {}) => enquiry({ id: 'bk_inst', ref: 'EL-1044', serviceId: 'ev', serviceName: 'EV charger installation', start: '2026-10-29T13:00', durationMin: 240, status: 'new', tentative: true, quotedPrice: 1514, finalPrice: null, quoteId: 'Q-EL-1043', ...over });
const quote = (over = {}) => ({
  id: 'Q-EL-1043', bookingId: 'bk_enq', customerName: 'Aoife Magee', createdAt: '2026-10-22T11:00', status: 'sent', brand: 'ZAPPI',
  lines: [{ id: 'a', label: 'Charger', detail: '', qty: 1, unitPrice: 1514 }], notes: '', validUntil: '2026-11-21', sentAt: '2026-10-22T12:00', sentVia: 'whatsapp', viewedAt: null,
  acceptedAt: null, declinedAt: null, declineReason: '', installBookingId: null, seed: false, ...over
});
const stateOf = (extra = {}) => ({ settings: makeDefaultSettings(), bookings: [], blocks: [], messages: [], quotes: {}, ...extra });

test('the six new kinds have a label and a default template, and every placeholder they use is documented', () => {
  for (const kind of NEW_KINDS) {
    assert.ok(TEMPLATE_KINDS.includes(kind), kind);
    assert.ok(KIND_LABELS[kind].length > 3, kind);
    for (const [, name] of DEFAULT_TEMPLATES[kind].matchAll(/\{(\w+)\}/g)) assert.ok(name in PLACEHOLDERS, `${kind} uses undocumented {${name}}`);
    assert.ok(!DEFAULT_TEMPLATES[kind].includes('!'), kind);
    assert.ok(!/\p{Extended_Pictographic}/u.test(DEFAULT_TEMPLATES[kind]), kind);
  }
  assert.equal(KIND_LABELS.customer_quote_sent, 'Quote sent');
  assert.equal(KIND_LABELS.owner_quote_accepted, 'Quote accepted');
  assert.equal(KIND_LABELS.customer_photos_request, 'Photos request');
  assert.equal(KIND_LABELS.owner_test_event, 'Test message');
  assert.equal(KIND_LABELS.customer_quote_ready, 'Quote ready', 'the v2 kind stays');
});

test('buildContext: the five quote placeholders are always present, empty without a quote', () => {
  const ctx = buildContext(enquiry(), stateOf());
  assert.deepEqual(Object.keys(ctx).sort(), Object.keys(PLACEHOLDERS).sort());
  for (const k of ['quoteId', 'quoteLink', 'quoteTotal', 'quoteValidUntil', 'installWhen']) assert.equal(ctx[k], '', k);
  const withQuote = buildContext(enquiry(), stateOf(), { quote: quote() });
  assert.equal(withQuote.quoteId, 'Q-EL-1043');
  assert.equal(withQuote.quoteLink, `${SITE_BASE_URL}quote.html#q=Q-EL-1043`);
  assert.equal(withQuote.quoteTotal, '£1514');
  assert.equal(withQuote.quoteValidUntil, 'Sat 21 Nov');
  assert.equal(withQuote.installWhen, '');
  // found from the state when not passed in: the enquiry's latest quote
  const q2 = quote({ id: 'Q-EL-1043-2', createdAt: '2026-10-23T09:00', lines: [{ id: 'a', label: 'Charger', detail: '', qty: 2, unitPrice: 800 }] });
  const found = buildContext(enquiry(), stateOf({ quotes: { 'Q-EL-1043': quote(), [q2.id]: q2 } }));
  assert.equal(found.quoteId, 'Q-EL-1043-2');
  assert.equal(found.quoteTotal, '£1600');
  // an install booking finds its quote by quoteId and its own day for installWhen
  const inst = install();
  const fromInstall = buildContext(inst, stateOf({ quotes: { 'Q-EL-1043': quote({ installBookingId: 'bk_inst' }) }, bookings: [inst] }));
  assert.equal(fromInstall.quoteId, 'Q-EL-1043');
  assert.equal(fromInstall.installWhen, 'Thu 29 Oct, afternoon, arriving between 1 and 3pm');
  // and the enquiry finds the install through the quote
  const fromEnquiry = buildContext(enquiry(), stateOf({ quotes: { 'Q-EL-1043': quote({ installBookingId: 'bk_inst' }) }, bookings: [inst] }));
  assert.equal(fromEnquiry.installWhen, 'Thu 29 Oct, afternoon, arriving between 1 and 3pm');
});

test('contactHours follows settings.sla.replyHours (the promise in the customer messages is the one the owner set)', () => {
  const state = stateOf();
  assert.equal(buildContext(enquiry({ status: 'new', tentative: true }), state).contactHours, '24');
  state.settings.sla.replyHours = 12;
  assert.equal(buildContext(enquiry(), state).contactHours, '12');
  const received = buildMessage('customer_received', enquiry({ status: 'new', tentative: true }), state);
  assert.ok(received.body.includes('within 12 hours'));
  delete state.settings.sla;
  assert.equal(buildContext(enquiry(), state).contactHours, '24', 'an older state falls back');
});

test('customer_quote_sent: the quote, the total, the valid date and the link; channel email carries the address', () => {
  const state = stateOf();
  const m = buildMessage('customer_quote_sent', enquiry(), state, { quote: quote(), at: '2026-10-23T20:30' });
  assert.equal(m.body, `Hi Aoife, it's Daniel from 180 Electrical. Your written quote for the home charger installation is ready: £1514, valid until Sat 21 Nov. You can read it and choose an install day here: ${SITE_BASE_URL}quote.html#q=Q-EL-1043 Questions? Reply here or call 07885 496800. Ref EL-1043`);
  assert.deepEqual([m.to, m.channel, m.bookingId, m.toName, m.toPhone, m.simulated, m.seed], ['customer', 'whatsapp', 'bk_enq', 'Aoife Magee', '07700 900231', true, false]);
  assert.equal('toEmail' in m, false);
  const em = buildMessage('customer_quote_sent', enquiry(), state, { quote: quote(), channel: 'email' });
  assert.deepEqual([em.channel, em.toEmail, em.toPhone], ['email', 'aoife@example.com', '07700 900231']);
  assert.equal(buildMessage('customer_quote_sent', enquiry({ customer: { name: 'No Mail', phone: '07700 900231' } }), state, { quote: quote(), channel: 'email' }).toEmail, '');
  assert.equal(buildMessage('customer_quote_sent', enquiry(), state, { quote: quote(), channel: 'carrier pigeon' }).channel, 'whatsapp', 'an unknown channel is whatsapp');
  // the owner's own branding and number flow through
  state.settings.business.name = 'Ashby Sparks';
  state.settings.business.ownerFirstName = 'Lee';
  assert.ok(buildMessage('customer_quote_sent', enquiry(), state, { quote: quote() }).body.startsWith("Hi Aoife, it's Lee from Ashby Sparks."));
});

test('customer_quote_accepted and owner_quote_accepted are about the pencilled install', () => {
  const inst = install();
  const state = stateOf({ quotes: { 'Q-EL-1043': quote({ status: 'accepted', installBookingId: 'bk_inst' }) }, bookings: [inst] });
  const toCustomer = buildMessage('customer_quote_accepted', inst, state, { quote: state.quotes['Q-EL-1043'], installBooking: inst });
  assert.equal(toCustomer.body, 'Hi Aoife, thanks for accepting your quote (£1514). I have pencilled in your installation for Thu 29 Oct, afternoon, arriving between 1 and 3pm. I will be in touch to confirm it. Quote Q-EL-1043');
  assert.equal(toCustomer.to, 'customer');
  const toOwner = buildMessage('owner_quote_accepted', inst, state, { quote: state.quotes['Q-EL-1043'], installBooking: inst });
  assert.equal(toOwner.body, `*Quote accepted Q-EL-1043*\nAoife Magee accepted your quote (£1514).\nInstall pencilled in: Thu 29 Oct, afternoon, arriving between 1 and 3pm (provisional)\n14 Larkfield Gardens, BT9 6QP\nOpen: ${SITE_BASE_URL}dashboard.html#/bookings/bk_inst`);
  assert.deepEqual([toOwner.to, toOwner.toName, toOwner.toPhone], ['owner', 'Daniel', '07885 496800']);
});

test('owner_quote_declined: the reason line is dropped when there is none', () => {
  const state = stateOf({ quotes: { 'Q-EL-1043': quote({ status: 'declined' }) } });
  const withReason = buildMessage('owner_quote_declined', enquiry(), state, { quote: state.quotes['Q-EL-1043'], reason: 'Too dear' });
  assert.equal(withReason.body, `*Quote declined Q-EL-1043*\nAoife Magee declined your quote (£1514).\nReason: Too dear.\nOpen: ${SITE_BASE_URL}dashboard.html#/bookings/bk_enq`);
  const without = buildMessage('owner_quote_declined', enquiry(), state, { quote: state.quotes['Q-EL-1043'], reason: '' });
  assert.equal(without.body, `*Quote declined Q-EL-1043*\nAoife Magee declined your quote (£1514).\nOpen: ${SITE_BASE_URL}dashboard.html#/bookings/bk_enq`);
});

test('customer_photos_request asks for the consumer unit and the charger position, in his voice', () => {
  const m = buildMessage('customer_photos_request', enquiry({ status: 'new', tentative: true }), stateOf());
  assert.equal(m.body, "Hi Aoife, it's Daniel from 180 Electrical. To prepare your quote, could you send a photo of your consumer unit and where you'd like the charger? Just reply here with the photos. Ref EL-1043");
  assert.equal(m.to, 'customer');
});

test('every new kind renders for a sample booking: no leftover braces, no exclamation marks, no empty lines, no warnings', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const inst = install();
    const state = stateOf({ quotes: { 'Q-EL-1043': quote({ installBookingId: 'bk_inst' }) }, bookings: [inst] });
    for (const kind of NEW_KINDS) {
      const m = buildMessage(kind, kind.includes('accepted') ? inst : enquiry(), state, { quote: state.quotes['Q-EL-1043'], installBooking: inst, reason: 'why' });
      assert.ok(!/[{}]/.test(m.body), kind);
      assert.ok(!m.body.includes('!'), kind);
      assert.ok(!m.body.split('\n').some((l) => l.trim() === ''), kind);
      assert.ok(m.body.length > 20, kind);
      assert.equal(m.to, kind.startsWith('owner_') ? 'owner' : 'customer', kind);
    }
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
});

test('buildSystemMessage: a test message that belongs to no booking, simulated, to the owner, in the chosen channel', () => {
  const state = stateOf();
  const wa = buildSystemMessage('owner_test_event', state);
  assert.deepEqual(wa, {
    at: '2026-10-23T20:30', sendAt: null, bookingId: null, to: 'owner', toName: 'Daniel', toPhone: '07885 496800', channel: 'whatsapp', kind: 'owner_test_event',
    body: '*Test message from 180 Electrical*\nThis is a test from your dashboard. A live build would send it to 07885 496800. Simulated: nothing was really sent.', simulated: true, seed: false
  });
  const em = buildSystemMessage('owner_test_event', state, { channel: 'email', toEmail: 'd@gmail.example', at: '2026-10-23T21:00' });
  assert.deepEqual([em.channel, em.toEmail, em.at], ['email', 'd@gmail.example', '2026-10-23T21:00']);
  assert.equal(buildSystemMessage('owner_test_event', state, { channel: 'email' }).toEmail, 'daniel@180electrical.co.uk', 'defaults to the business email');
  state.settings.business.name = 'Ashby Sparks';
  assert.ok(buildSystemMessage('owner_test_event', state).body.startsWith('*Test message from Ashby Sparks*'));
  // a custom template is honoured, and a typo never throws
  state.settings.templates = { owner_test_event: 'Hello {business} {nonsense}' };
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.equal(buildSystemMessage('owner_test_event', state).body, 'Hello Ashby Sparks');
  } finally {
    console.warn = original;
  }
  // the same kind through buildMessage (it has no placeholders that need a booking)
  assert.ok(buildMessage('owner_test_event', enquiry(), stateOf()).body.includes('Simulated: nothing was really sent.'));
});

test('bubbleActions: Confirm on a pencilled install from an accepted quote, Open job on a declined one', () => {
  const pending = install();
  const accepted = { kind: 'owner_quote_accepted' };
  assert.deepEqual(bubbleActions(accepted, pending, '2026-10-23T20:30').map((a) => [a.id, a.label]), [['confirm', 'Confirm'], ['call', 'Call Aoife'], ['open_job', 'Open job']]);
  assert.deepEqual(bubbleActions(accepted, install({ status: 'confirmed' }), '2026-10-23T20:30').map((a) => a.id), ['open_job', 'call'], 'once confirmed there is nothing to confirm');
  assert.deepEqual(bubbleActions({ kind: 'owner_quote_declined' }, enquiry(), '2026-10-23T20:30').map((a) => a.id), ['open_job']);
  for (const kind of ['customer_quote_sent', 'customer_quote_accepted', 'customer_photos_request', 'owner_test_event']) assert.deepEqual(bubbleActions({ kind }, enquiry(), '2026-10-23T20:30'), [], kind);
  assert.deepEqual(bubbleActions(accepted, null, '2026-10-23T20:30'), []);
});
