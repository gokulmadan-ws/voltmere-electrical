// tests/unit/quote-share.test.mjs: the v3 self-contained customer quote link (legacyQuoteShareUrl / parseQuotePayload) and importLinkedQuote.
// v4: quoteShareUrl now returns the V4 link (quote.html#d=...), so the v3 form is built with legacyQuoteShareUrl; the v4 link has its own tests in handoff.test.mjs.
// Owner: QUOTEPAGE (T03), updated by A4 for v4
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_BASE_URL } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { legacyQuoteShareUrl, parseQuotePayload, quoteLinkPayload, quoteShareUrl, quoteTotal, quoteUrl } from '../../js/core/quotes.js';
import { parseQuoteLink, quoteLink } from '../../js/core/handoff.js';
import { nextFreeSlots } from '../../js/core/availability.js';
import { selectQuote } from '../../js/core/selectors.js';
import * as store from '../../js/core/store.js';

const { initStore, getState, createQuote, sendQuote, acceptQuote, declineQuote, importLinkedQuote } = store;

function memStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}
beforeEach(() => { setClock(new Date(2026, 9, 23, 20, 30)); initStore({ storage: memStorage(), force: true }); });
afterEach(() => setClock(null));

const QUOTE = {
  id: 'Q-EL-1043', bookingId: 'bk_x', customerName: 'Sean Doherty', createdAt: '2026-10-23T09:00', status: 'sent', brand: 'ZAPPI',
  lines: [
    { id: 'a', label: 'Supply of ZAPPI home charger', detail: '', qty: 1, unitPrice: 799 },
    { id: 'b', label: 'Extra cable (per metre)', detail: 'Cable run planned at the survey, café £', qty: 6, unitPrice: 12 },
    { id: 'c', label: 'Early-bird discount', detail: '', qty: 1, unitPrice: -50 }
  ],
  notes: 'The price covers the work listed above.\nAnything extra is agreed first.', validUntil: '2026-11-22', sentAt: '2026-10-23T09:05', sentVia: 'link'
};
const payloadOf = (url) => url.split('&d=')[1];

test('quoteUrl is unchanged and the v3 legacyQuoteShareUrl extends it with &d=', () => {
  assert.equal(quoteUrl('Q-EL-1043'), `${SITE_BASE_URL}quote.html#q=Q-EL-1043`);
  const url = legacyQuoteShareUrl(QUOTE, { ownerFirst: 'Daniel', postcode: 'BT9 6QP' });
  assert.ok(url.startsWith(`${quoteUrl('Q-EL-1043')}&d=`), url);
  assert.match(payloadOf(url), /^[A-Za-z0-9_-]+$/, 'base64url only: nothing a messenger would mangle');
  assert.ok(url.length < 1500, `a link of ${url.length} characters`);
});

test('the payload carries ref, first name, charger, lines, total, valid-until, notes, owner and postcode', () => {
  const p = quoteLinkPayload(QUOTE, { ownerFirst: 'Daniel', postcode: 'BT9 6QP' });
  assert.equal(p.r, 'Q-EL-1043');
  assert.equal(p.n, 'Sean');
  assert.equal(p.c, 'ZAPPI');
  assert.deepEqual(p.l[0], ['Supply of ZAPPI home charger', 799]);
  assert.deepEqual(p.l[1].slice(0, 3), ['Extra cable (per metre)', 12, 6]);
  assert.equal(p.t, 799 + 72 - 50);
  assert.equal(p.u, '2026-11-22');
  assert.equal(p.o, 'Daniel');
  assert.equal(p.p, 'BT9 6QP');
});

test('parseQuotePayload round-trips the quote (unicode, quantities, a discount line)', () => {
  const link = parseQuotePayload(payloadOf(legacyQuoteShareUrl(QUOTE, { ownerFirst: 'Daniel', postcode: 'bt9 6qp' })));
  assert.ok(link);
  assert.equal(link.id, 'Q-EL-1043');
  assert.equal(link.customerName, 'Sean');
  assert.equal(link.brand, 'ZAPPI');
  assert.equal(link.total, quoteTotal(QUOTE));
  assert.equal(link.validUntil, '2026-11-22');
  assert.equal(link.ownerFirst, 'Daniel');
  assert.equal(link.postcode, 'BT9 6QP');
  assert.equal(link.sentAt, '2026-10-23T09:05');
  assert.equal(link.notes, QUOTE.notes);
  assert.equal(link.lines.length, 3);
  assert.equal(link.lines[1].detail, 'Cable run planned at the survey, café £');
  assert.equal(link.lines[1].qty, 6);
  assert.equal(link.lines[2].unitPrice, -50);
  assert.deepEqual(link.lines.map((l) => l.id), ['ln_1', 'ln_2', 'ln_3']);
});

test('parseQuotePayload refuses garbage, cut-off, edited and out-of-range payloads (and never throws)', () => {
  const good = payloadOf(legacyQuoteShareUrl(QUOTE, { ownerFirst: 'Daniel' }));
  for (const bad of ['', 'garbage', '%%%', 'e30', good.slice(0, -4), good + '!', 'a'.repeat(9000), undefined, null, 42]) assert.equal(parseQuotePayload(bad), null, String(bad).slice(0, 20));
  const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  const base = quoteLinkPayload(QUOTE, { ownerFirst: 'Daniel' });
  assert.ok(parseQuotePayload(enc(base)), 'the baseline is fine');
  assert.equal(parseQuotePayload(enc({ ...base, t: base.t + 1 })), null, 'total that does not match the lines');
  assert.equal(parseQuotePayload(enc({ ...base, v: 2 })), null, 'unknown version');
  assert.equal(parseQuotePayload(enc({ ...base, r: 'EL-1043' })), null, 'not a quote reference');
  assert.equal(parseQuotePayload(enc({ ...base, u: '2026-13-45' })), null, 'not a day');
  assert.equal(parseQuotePayload(enc({ ...base, l: [] })), null, 'no lines');
  assert.equal(parseQuotePayload(enc({ ...base, l: [['x', 1.5]], t: 1.5 })), null, 'fractional price');
  assert.equal(parseQuotePayload(enc({ ...base, n: '' })), null, 'no customer name');
});

test('v4: the send, copy and message links all carry the V4 payload (quote.html#d=); the stored quote is unchanged', () => {
  const made = createQuote({ bookingId: 'bk_seed_16' });
  assert.equal(made.ok, true);
  const sent = sendQuote(made.quote.id, { via: 'whatsapp' });
  assert.equal(sent.ok, true);
  assert.ok(sent.link.startsWith(`${SITE_BASE_URL}quote.html#d=`), sent.link);
  assert.ok(sent.message.body.includes(sent.link), 'the WhatsApp message carries the same link');
  const stored = selectQuote(getState(), made.quote.id);
  assert.equal(quoteShareUrl(stored, { booking: getState().bookings.find((b) => b.id === stored.bookingId) }), sent.link, 'quoteShareUrl IS quoteLink now');
  assert.equal(quoteLink(stored, { booking: getState().bookings.find((b) => b.id === stored.bookingId) }), sent.link);
  const link = parseQuoteLink(sent.link);
  assert.equal(link.ok, true);
  assert.equal(link.data.id, made.quote.id);
  assert.equal(link.data.total, quoteTotal(stored));
  assert.match(link.data.postcode, /^BT/);
});

test('importLinkedQuote: a browser that never saw the quote can accept it from the link', () => {
  const link = parseQuotePayload(payloadOf(legacyQuoteShareUrl({ ...QUOTE, id: 'Q-EL-9001', validUntil: '2026-11-22' }, { ownerFirst: 'Daniel', postcode: 'BT9 6QP' })));
  assert.equal(selectQuote(getState(), 'Q-EL-9001'), null);
  assert.equal(acceptQuote('Q-EL-9001', { date: '2026-10-27', windowId: 0 }).reason, 'not_found', 'without the import there is nothing to accept');
  const imported = importLinkedQuote(link);
  assert.equal(imported.ok, true);
  const q = selectQuote(getState(), 'Q-EL-9001');
  assert.equal(q.status, 'viewed');
  assert.equal(q.customerName, 'Sean');
  assert.equal(quoteTotal(q), 821);
  assert.equal(q.validUntil, '2026-11-22');
  assert.equal(importLinkedQuote(link).ok, true, 'importing twice is harmless');
  assert.equal(Object.keys(getState().quotes).filter((id) => id === 'Q-EL-9001').length, 1);
  const slot = nextFreeSlots(getState(), 'ev', 1)[0];
  const accepted = acceptQuote('Q-EL-9001', { date: slot.date, windowId: slot.windowId });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(selectQuote(getState(), 'Q-EL-9001').status, 'accepted');
  assert.equal(accepted.booking.quotedPrice, 821);
  assert.equal(accepted.booking.address.postcode, 'BT9 6QP');
});

test('importLinkedQuote: decline works too, a bad payload is refused, an expired link cannot be accepted', () => {
  const link = parseQuotePayload(payloadOf(legacyQuoteShareUrl({ ...QUOTE, id: 'Q-EL-9002' }, { ownerFirst: 'Daniel' })));
  assert.equal(importLinkedQuote({ ...link, lines: [] }).ok, false);
  assert.equal(importLinkedQuote({ ...link, id: 'nope' }).ok, false);
  assert.equal(importLinkedQuote(null).ok, false);
  assert.equal(importLinkedQuote(link).ok, true);
  assert.equal(declineQuote('Q-EL-9002', { reason: 'Too expensive', by: 'customer' }).ok, true);
  assert.equal(selectQuote(getState(), 'Q-EL-9002').status, 'declined');
  const late = parseQuotePayload(payloadOf(legacyQuoteShareUrl({ ...QUOTE, id: 'Q-EL-9003', validUntil: '2026-10-20' }, { ownerFirst: 'Daniel' })));
  assert.equal(importLinkedQuote(late).ok, true);
  const slot = nextFreeSlots(getState(), 'ev', 1)[0];
  assert.equal(acceptQuote('Q-EL-9003', { date: slot.date, windowId: slot.windowId }).reason, 'expired');
});

test('importLinkedQuote: a quote that is already here is left alone; an undecided demo quote that is older than the link is replaced', () => {
  const made = createQuote({ bookingId: 'bk_seed_16' });
  const sent = sendQuote(made.quote.id, { via: 'whatsapp' });
  const own = parseQuotePayload(payloadOf(legacyQuoteShareUrl(selectQuote(getState(), made.quote.id), { ownerFirst: 'Daniel', postcode: 'BT8 6QT' })));
  assert.ok(sent.ok && own, 'the owner\'s own quote, as a v3 link');
  const before = JSON.stringify(selectQuote(getState(), made.quote.id));
  assert.equal(importLinkedQuote(own).existing, true);
  assert.equal(JSON.stringify(selectQuote(getState(), made.quote.id)), before, "the owner's own quote is never overwritten by a link");
  const demo = Object.values(getState().quotes).find((q) => q.seed && (q.status === 'sent' || q.status === 'viewed'));
  assert.ok(demo, 'there is a demo quote waiting for an answer');
  const newer = parseQuotePayload(payloadOf(legacyQuoteShareUrl({ ...QUOTE, id: demo.id, sentAt: '2026-10-23T20:00' }, { ownerFirst: 'Daniel' })));
  assert.equal(importLinkedQuote(newer).ok, true);
  const replaced = selectQuote(getState(), demo.id);
  assert.equal(replaced.customerName, 'Sean');
  assert.equal(quoteTotal(replaced), 821);
  assert.equal(replaced.seed, false);
});
