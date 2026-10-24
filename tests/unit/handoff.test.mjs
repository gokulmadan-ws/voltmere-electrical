// tests/unit/handoff.test.mjs: js/core/handoff.js (the codec, the builders, the WhatsApp texts, reading a link, hostile input, the budgets)
// Owner: A4 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HANDOFF_BUDGETS, HANDOFF_STORAGE_KEY, INSTALL_DAYS, SITE_BASE_URL } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import {
  buildAcceptancePayload, buildDeclinePayload, buildEnquiryPayload, buildQuotePayload, acceptanceWhatsAppText, clampStamp, dashboardImportLink, decodePayload,
  declineReasonText, declineWhatsAppText, describePreferences, encodePayload, enquiryWhatsAppText, forgetHandoff, importIdOf, parseImport, parseQuoteLink,
  payloadChecksum, quoteLink, quoteLinkInfo, recallHandoff, rememberHandoff, sanitiseText
} from '../../js/core/handoff.js';

const NOW = '2026-10-23T20:30';
beforeEach(() => setClock(new Date(2026, 9, 23, 20, 30)));
afterEach(() => setClock(null));

function memStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

const booking = (over = {}) => ({
  ref: 'EL-1043', createdAt: '2026-10-23T18:42',
  customer: { name: 'Aoife Magee', phone: '07700 900231', email: 'aoife.magee@example.com' },
  address: { line1: '', postcode: 'BT9 6QP' },
  answers: { postcode: 'BT9 6QP', parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: true },
  notes: 'Cable run is about six metres from the fuse box in the garage. Dog is friendly.',
  utm: { source: 'facebook', medium: 'paid_social', campaign: 'ev_charger_leads' },
  ...over
});

const LINES = [
  ['Supply of ZAPPI home charger', 1, 799], ['Standard installation (up to 10 m of cable)', 1, 450], ['Extra cable (per metre)', 6, 12],
  ['Dedicated circuit and protective device', 1, 180], ['Consumer unit upgrade (if required)', 1, 420], ['Surface-mounted enclosure', 1, 95],
  ['Groundwork (per metre)', 4, 65], ['Testing and certification', 1, 85], ['Early booking discount', 1, -50], ['Making good and a tidy finish', 1, 40]
];
const NOTES = 'Sample terms for this prototype, to be replaced with your own. The price covers the work listed above, supplied and fitted. Anything extra is agreed with you before it starts.';
const quote = (over = {}) => ({
  id: 'Q-EL-1043', bookingId: 'bk_x', customerName: 'Aoife Magee', createdAt: '2026-10-23T20:00', status: 'sent', brand: 'ZAPPI',
  lines: LINES.map(([label, qty, unitPrice], i) => ({ id: `l${i}`, label, detail: '', qty, unitPrice })),
  notes: NOTES, validUntil: '2026-11-22', sentAt: '2026-10-23T20:30', ...over
});
const QUOTE_TOTAL = LINES.reduce((t, [, q, p]) => t + q * p, 0);

// A compact enquiry payload as the wire carries it, with any field replaced.
const wireEnq = (over = {}) => ({
  v: 1, t: 'enq', i: 'EL-1043', c: '2026-10-23T18:42', n: 'Aoife Magee', p: '07700 900231', e: 'aoife@example.com', z: 'BT9 6QP',
  a: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, o: 1, m: 'Hello', u: 'facebook', ...over
});
const wireQuo = (over = {}) => ({ v: 1, t: 'quo', i: 'Q-EL-1043', r: 'EL-1043', n: 'Aoife', z: 'BT9 6QP', b: 'ZAPPI', l: [['Charger', 1, 799], ['Install', 1, 450]], m: 'Terms', x: '2026-11-22', s: '2026-10-23T20:30', f: 1, ...over });
const wireAcc = (over = {}) => ({ v: 1, t: 'acc', i: 'Q-EL-1043', n: 'Aoife', d: ['thu', 'fri'], w: 'am', m: 'Gate code 1234', t2: 1249, ...over });
const wireDec = (over = {}) => ({ v: 1, t: 'dec', i: 'Q-EL-1043', n: 'Aoife', y: 'price', m: 'Sorry', ...over });

// ---------- the codec ----------

test('encodePayload / decodePayload round-trip (unicode, emoji, empty strings) as base64url with no padding, `k` last', () => {
  const obj = wireEnq({ n: 'Zoë Ó Briain', m: 'Café ☕ £5 — "quoted" \\ back\nslash \u{1F697}', e: '' });
  const enc = encodePayload(obj);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  const back = decodePayload(enc);
  assert.deepEqual({ ...back, k: undefined }, { ...obj, k: undefined });
  assert.equal(back.k.length, 6);
  assert.equal(Object.keys(back).at(-1), 'k');
  assert.deepEqual(decodePayload(`${enc}==`), back, 'padding on the end is tolerated');
});

test('the checksum does not depend on key order and covers everything except k', () => {
  const a = { v: 1, t: 'dec', i: 'Q-EL-1', n: 'A' };
  const b = { n: 'A', i: 'Q-EL-1', t: 'dec', v: 1 };
  assert.equal(payloadChecksum(a), payloadChecksum(b));
  assert.equal(payloadChecksum({ ...a, k: 'whatever' }), payloadChecksum(a));
  assert.notEqual(payloadChecksum({ ...a, n: 'B' }), payloadChecksum(a));
  assert.match(payloadChecksum(a), /^[A-Za-z0-9_-]{6}$/);
  assert.equal(decodePayload(encodePayload({ ...a, k: 'bogus' })).k, payloadChecksum(a), 'encodePayload replaces a wrong k');
});

test('decodePayload never throws and gives null for anything that is not one of ours', () => {
  const good = encodePayload(wireDec());
  const bad = [
    undefined, null, 0, 42, true, {}, [], () => 1, Symbol('x'), { toString() { throw new Error('boom'); } },
    '', ' ', 'garbage', '%%%', 'e30', 'a'.repeat(15), 'a'.repeat(9000), `${good}!`, `!${good}`, `${good} ${good}`, '<script>alert(1)</script>',
    'e30=', Buffer.from('{"v":1,"t":"enq"}').toString('base64url'), Buffer.from('[1,2,3]').toString('base64url'), Buffer.from('"just a string........"').toString('base64url'),
    Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8, 0xf7, 0xf6, 0xf5, 0xf4, 0xf3, 0xf2, 0xf1, 0xf0]).toString('base64url'),
    '{'.repeat(12000)
  ];
  for (const x of bad) assert.equal(decodePayload(x), null, String(typeof x === 'string' ? x.slice(0, 20) : typeof x));
  assert.ok(decodePayload(good), 'the baseline decodes');
});

test('any single changed character, any cut-off and any extra character gives null (a damaged link is never read as a different one)', () => {
  const good = encodePayload(wireDec());
  assert.ok(decodePayload(good));
  for (let i = 0; i < good.length; i += 1) {
    for (const ch of ['A', 'B', '-', '_', '0']) {
      if (good[i] === ch) continue;
      assert.equal(decodePayload(good.slice(0, i) + ch + good.slice(i + 1)), null, `position ${i} -> ${ch}`);
    }
  }
  for (let n = 0; n < good.length; n += 1) assert.equal(decodePayload(good.slice(0, n)), null, `cut at ${n}`);
  for (const extra of ['A', 'AA', 'AAAA', '-', 'x'.repeat(40)]) assert.equal(decodePayload(good + extra), null, `extra ${extra}`);
});

test('a wrong version or an unknown kind is null even with a valid checksum; encodePayload refuses non-objects and cycles', () => {
  assert.equal(decodePayload(encodePayload({ ...wireDec(), v: 2 })), null);
  assert.equal(decodePayload(encodePayload({ ...wireDec(), t: 'zzz' })), null);
  assert.equal(decodePayload(encodePayload({ ...wireDec(), v: '1' })), null);
  for (const x of [null, undefined, 'x', 5, [], [1]]) assert.equal(encodePayload(x), '');
  const loop = { v: 1, t: 'dec' };
  loop.self = loop;
  assert.equal(encodePayload(loop), '');
});

// ---------- the budgets ----------

test('size budgets: an enquiry under 900 characters, a 10 line quote under 1,800, acceptance and decline under their budgets', () => {
  const typical = encodePayload(buildEnquiryPayload(booking()));
  assert.ok(typical.length < HANDOFF_BUDGETS.enq, `typical enquiry ${typical.length}`);
  const full = booking({
    customer: { name: 'N'.repeat(60), phone: '07700 900231', email: `${'e'.repeat(48)}@example.com` },
    answers: { postcode: 'BT9 6QP', parking: 'allocated', vehicle: 'ordered', timing: 'one_to_three', permission: 'landlord', marketingOptIn: true },
    notes: 'n'.repeat(300)
  });
  const fullLen = encodePayload(buildEnquiryPayload(full)).length;
  assert.ok(fullLen < HANDOFF_BUDGETS.enq, `a 60 character name, a 60 character email and 300 characters of notes: ${fullLen}`);
  const q = quote();
  const info = quoteLinkInfo(q, { ref: 'EL-1043', postcode: 'BT9 6QP' });
  assert.equal(info.portable, true);
  assert.ok(info.chars < HANDOFF_BUDGETS.quo, `10 line quote ${info.chars}`);
  assert.equal(q.lines.length, 10);
  const acc = encodePayload(buildAcceptancePayload({ quote: q, days: INSTALL_DAYS.map((d) => d.id), part: 'am', note: 'n'.repeat(200) }));
  assert.ok(acc.length < HANDOFF_BUDGETS.acc, `acceptance ${acc.length}`);
  const dec = encodePayload(buildDeclinePayload({ quote: q, reason: 'other_installer', note: 'n'.repeat(140) }));
  assert.ok(dec.length < HANDOFF_BUDGETS.dec, `decline ${dec.length}`);
});

test('the wa.me link for each kind stays a sensible length', () => {
  const urlFor = (text) => `https://wa.me/447885496800?text=${encodeURIComponent(text)}`;
  assert.ok(urlFor(enquiryWhatsAppText(booking())).length < 3000);
  assert.ok(urlFor(acceptanceWhatsAppText({ quote: quote(), days: ['thu'], part: 'am' })).length < 1500);
  assert.ok(urlFor(declineWhatsAppText({ quote: quote(), reason: 'price' })).length < 1500);
});

// ---------- the enquiry payload ----------

test('buildEnquiryPayload: the fields of the brief, short keys, the checksum', () => {
  const p = buildEnquiryPayload(booking());
  assert.deepEqual({ ...p, k: undefined }, {
    v: 1, t: 'enq', i: 'EL-1043', c: '2026-10-23T18:42', n: 'Aoife Magee', p: '07700 900231', e: 'aoife.magee@example.com', z: 'BT9 6QP',
    a: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, o: 1,
    m: 'Cable run is about six metres from the fuse box in the garage. Dog is friendly.', u: 'facebook', k: undefined
  });
  assert.equal(p.k, payloadChecksum(p));
  assert.deepEqual(decodePayload(encodePayload(p)), p);
});

test('buildEnquiryPayload leaves out what is not there and cleans what is', () => {
  const p = buildEnquiryPayload(booking({ customer: { name: '  Aoife   Magee ', phone: '+44 7700 900231' }, notes: '', utm: undefined, answers: { postcode: 'bt96qp', parking: 'nonsense', marketingOptIn: false } }));
  assert.equal(p.n, 'Aoife Magee');
  assert.equal(p.p, '07700 900231');
  assert.equal('e' in p, false);
  assert.equal('m' in p, false);
  assert.equal('u' in p, false);
  assert.deepEqual(p.a, undefined, 'an answer that is not one of his options is dropped');
  assert.equal(p.o, 0);
  assert.equal(p.z, 'BT9 6QP');
  assert.equal(buildEnquiryPayload(booking({ notes: `${'x'.repeat(500)}` })).m.length, 400, 'notes are limited to 400');
  assert.equal(buildEnquiryPayload(booking({ customer: { name: 'Aoife Magee', phone: '07700 900231', email: 'not an email' } })).e, undefined);
});

test('buildEnquiryPayload gives null for anything that cannot be carried (and never throws)', () => {
  for (const x of [null, undefined, 0, 'x', [], {}, booking({ ref: 'X-1' }), booking({ ref: undefined }), booking({ customer: { name: 'A', phone: '07700 900231' } }),
    booking({ customer: { name: 'Aoife', phone: '12345' } }), booking({ address: { postcode: 'nope' }, answers: {} }), booking({ createdAt: 'yesterday' }), booking({ createdAt: undefined })]) {
    assert.equal(buildEnquiryPayload(x), null);
  }
  assert.equal(buildEnquiryPayload({ get ref() { throw new Error('x'); } }), null);
});

// ---------- the quote payload and link ----------

test('buildQuotePayload: [label, qty, unitPrice], detail as an optional 4th element, the flags and the stamps', () => {
  const p = buildQuotePayload(quote({ lines: [{ id: 'a', label: 'Charger', detail: 'Zappi 7kW', qty: 1, unitPrice: 799 }, { id: 'b', label: 'Cable', detail: '', qty: 6, unitPrice: 12 }] }), { ref: 'EL-1043', address: { postcode: 'bt9 6qp' } });
  assert.deepEqual(p.l, [['Charger', 1, 799, 'Zappi 7kW'], ['Cable', 6, 12]]);
  assert.deepEqual([p.t, p.i, p.r, p.n, p.z, p.b, p.x, p.s, p.f], ['quo', 'Q-EL-1043', 'EL-1043', 'Aoife', 'BT9 6QP', 'ZAPPI', '2026-11-22', '2026-10-23T20:30', 1]);
  assert.equal(p.m, NOTES);
  assert.equal(buildQuotePayload(quote(), null, { sample: false }).f, 0);
  assert.equal(p.k, payloadChecksum(p));
});

test('quoteLink / quoteLinkInfo: the self-contained quote.html#d= link, and why a quote cannot be carried', () => {
  const info = quoteLinkInfo(quote(), { ref: 'EL-1043', postcode: 'BT9 6QP' });
  assert.deepEqual([info.portable, info.reason, info.notesTruncated], [true, '', false]);
  assert.ok(info.url.startsWith(`${SITE_BASE_URL}quote.html#d=`));
  assert.equal(info.url, quoteLink(quote(), { ref: 'EL-1043', postcode: 'BT9 6QP' }));
  assert.equal(info.chars, info.url.length - `${SITE_BASE_URL}quote.html#d=`.length);
  assert.equal(info.url, quoteLink(quote(), { ref: 'EL-1043', postcode: 'BT9 6QP' }), 'the same quote always gives the same link');
  assert.equal(quoteLink(quote(), { booking: { ref: 'EL-1043', address: { postcode: 'BT9 6QP' } } }), info.url, 'ref and postcode from the booking');

  const fallback = (q, reason) => {
    const out = quoteLinkInfo(q, {});
    assert.equal(out.portable, false, reason);
    assert.equal(out.reason, reason);
    assert.equal(out.url, `${SITE_BASE_URL}quote.html#q=${q.id}`, 'the id-only link, which works in this browser');
  };
  const line = (i) => ({ id: `l${i}`, label: `Line ${i}`, detail: '', qty: 1, unitPrice: 10 });
  assert.equal(quoteLinkInfo(quote({ lines: Array.from({ length: 14 }, (_, i) => line(i)) })).portable, true, '14 lines is the limit');
  fallback(quote({ lines: Array.from({ length: 15 }, (_, i) => line(i)) }), 'too_many_lines');
  fallback(quote({ lines: Array.from({ length: 14 }, (_, i) => ({ ...line(i), label: 'L'.repeat(100), detail: 'D'.repeat(190) })) }), 'too_long');
  fallback(quote({ lines: [] }), 'no_lines');
  fallback(quote({ lines: [{ id: 'a', label: 'Free', detail: '', qty: 1, unitPrice: 0 }] }), 'no_lines');
  fallback(quote({ lines: [{ id: 'a', label: 'Half', detail: '', qty: 1, unitPrice: 9.5 }] }), 'bad_line');
  fallback(quote({ lines: [{ id: 'a', label: '', detail: '', qty: 1, unitPrice: 9 }] }), 'bad_line');
  assert.equal(quoteLinkInfo(null).portable, false);
  assert.equal(quoteLinkInfo(undefined).url, `${SITE_BASE_URL}quote.html#q=`);
});

test('quote notes over 400 characters are cut at a word with an ellipsis and the owner can be told', () => {
  const long = `${'Terms are plain and short. '.repeat(30)}`;
  const info = quoteLinkInfo(quote({ notes: long }), {});
  assert.equal(info.notesTruncated, true);
  const back = parseQuoteLink(info.url);
  assert.ok(back.ok);
  assert.ok(back.data.notes.length <= 400);
  assert.ok(back.data.notes.endsWith('…'));
  assert.ok(!/\s…$/.test(back.data.notes));
});

test('possible extras (optional lines) travel as a 5th element and are never part of the total the customer sees or accepts', () => {
  const lines = [
    { id: 'a', label: 'Charger', detail: '', qty: 1, unitPrice: 799, optional: false },
    { id: 'b', label: 'Consumer unit upgrade (if required)', detail: '', qty: 1, unitPrice: 420, optional: true },
    { id: 'c', label: 'Extra cable', detail: 'Per metre', qty: 4, unitPrice: 12, optional: true }
  ];
  const p = buildQuotePayload(quote({ lines }), null, {});
  assert.deepEqual(p.l, [['Charger', 1, 799], ['Consumer unit upgrade (if required)', 1, 420, '', 1], ['Extra cable', 4, 12, 'Per metre', 1]]);
  const link = quoteLink(quote({ lines }), {});
  const back = parseQuoteLink(link);
  assert.equal(back.ok, true);
  assert.equal(back.data.total, 799, 'the total adds up the fixed lines only');
  assert.deepEqual(back.data.lines.map((l) => [l.label, l.optional]), [['Charger', false], ['Consumer unit upgrade (if required)', true], ['Extra cable', true]]);
  assert.deepEqual(back.data.lines.map((l) => l.id), ['ln_1', 'ln_2', 'ln_3']);
  // the acceptance carries the fixed total, from either a stored quote or the data of a link
  assert.equal(buildAcceptancePayload({ quote: quote({ lines }), days: [], part: 'any' }).t2, 799);
  assert.equal(buildAcceptancePayload({ quote: back.data, days: [], part: 'any' }).t2, 799);
  assert.ok(acceptanceWhatsAppText({ quote: back.data, days: ['thu'], part: 'am' }, { link: '' }).includes('(£799)'));
  assert.ok(declineWhatsAppText({ quote: quote({ lines }), reason: 'price' }, { link: '' }).includes('(£799)'));
  // a quote that is only extras has nothing to pay, so it is not carried; a wire line with the flag as an object field also works
  assert.equal(quoteLinkInfo(quote({ lines: [lines[1]] }), {}).reason, 'no_lines');
  const wire = parseImport(encodePayload(wireQuo({ l: [['Charger', 1, 799], { label: 'Extra', qty: 1, unitPrice: 50, optional: true }] })), { now: NOW });
  assert.equal(wire.ok, true);
  assert.deepEqual([wire.data.total, wire.data.lines[1].optional], [799, true]);
  const allExtras = parseImport(encodePayload(wireQuo({ l: [['Only extra', 1, 420, '', 1]] })), { now: NOW });
  assert.equal(allExtras.ok, false, 'a link with no fixed price is refused');
  assert.equal(allExtras.reason, 'invalid');
});

// ---------- acceptance and decline ----------

test('buildAcceptancePayload: days in week order, unknown ones dropped, the total from the lines, the note limited', () => {
  const p = buildAcceptancePayload({ quote: quote(), days: ['fri', 'thu', 'thu', 'sun', 'FRI', 'nope', 7, null], part: 'am', note: `  ${'n'.repeat(300)}  ` });
  assert.deepEqual([p.t, p.i, p.n, p.d, p.w, p.t2], ['acc', 'Q-EL-1043', 'Aoife', ['thu', 'fri'], 'am', QUOTE_TOTAL]);
  assert.equal(p.m.length, 200);
  const defaults = buildAcceptancePayload({ quote: quote() });
  assert.deepEqual([defaults.d, defaults.w, 'm' in defaults], [[], 'any', false]);
  assert.equal(buildAcceptancePayload({ quote: quote(), part: 'evening' }).w, 'any');
  // link mode: the data of parseQuoteLink works as the quote
  const data = parseQuoteLink(quoteLink(quote(), { ref: 'EL-1043' })).data;
  assert.equal(buildAcceptancePayload({ quote: data, days: ['mon'], part: 'pm' }).t2, QUOTE_TOTAL);
  for (const bad of [null, {}, { quote: null }, { quote: { id: 'x' } }, { quote: quote({ lines: [] }) }, { quote: quote({ id: 'EL-1' }) }, { quote: quote({ customerName: '' }) }]) assert.equal(buildAcceptancePayload(bad), null);
});

test('buildDeclinePayload: a known reason id and a short note, both optional', () => {
  const p = buildDeclinePayload({ quote: quote(), reason: 'price', note: 'n'.repeat(300) });
  assert.deepEqual([p.t, p.i, p.n, p.y], ['dec', 'Q-EL-1043', 'Aoife', 'price']);
  assert.equal(p.m.length, 140);
  const bare = buildDeclinePayload({ quote: quote(), reason: 'because I said so' });
  assert.deepEqual(['y' in bare, 'm' in bare], [false, false]);
  assert.equal(buildDeclinePayload({ quote: { customerName: 'A' } }), null);
  assert.equal(buildDeclinePayload(null), null);
});

test('describePreferences: words for a message, slashes for a heading', () => {
  const d = describePreferences;
  assert.equal(d(['thu', 'fri'], 'am'), 'Thu or Fri mornings');
  assert.equal(d(['thu', 'fri'], 'am', { style: 'compact' }), 'Thu/Fri mornings');
  assert.equal(d(['mon', 'wed', 'fri'], 'pm'), 'Mon, Wed or Fri afternoons');
  assert.equal(d(['sat'], 'any'), 'Sat');
  assert.equal(d([], 'any'), 'any day');
  assert.equal(d([], 'am'), 'any morning');
  assert.equal(d([], 'pm'), 'any afternoon');
  assert.equal(d(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], 'any'), 'any day');
  assert.equal(d(['mon', 'tue', 'wed', 'thu', 'fri'], 'any'), 'any weekday');
  assert.equal(d(['mon', 'tue', 'wed', 'thu', 'fri'], 'am'), 'weekday mornings');
  assert.equal(d(undefined, undefined), 'any day');
  assert.equal(d('thu', 'am'), 'any morning', 'not an array: no days');
  assert.equal(declineReasonText('price', 'Found cheaper'), 'Too expensive: Found cheaper');
  assert.equal(declineReasonText('price', ''), 'Too expensive');
  assert.equal(declineReasonText('', 'Just my note'), 'Just my note');
  assert.equal(declineReasonText('zzz', ''), '');
});

// ---------- the WhatsApp texts ----------

test('enquiryWhatsAppText: who, how to reach them, where, the answers in his words, notes, and the import link on the last line', () => {
  const text = enquiryWhatsAppText(booking());
  const lines = text.split('\n');
  assert.equal(lines[0], "Hi Daniel, it's Aoife Magee. I've just asked for a home charger quote on your website.");
  for (const want of ['Ref: EL-1043', 'Mobile: 07700 900231', 'Email: aoife.magee@example.com', 'Postcode: BT9 6QP', 'Parking: Private driveway', "Electric car: It's ordered or arriving soon",
    'Timing: As soon as possible', 'Permission to install: Yes', 'Anything else: Cable run is about six metres from the fuse box in the garage. Dog is friendly.']) assert.ok(lines.includes(want), want);
  assert.equal(lines.at(-2), 'Tap to add my enquiry to your dashboard:');
  assert.match(lines.at(-1), new RegExp(`^${SITE_BASE_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}dashboard\\.html#import=[A-Za-z0-9_-]+$`));
  assert.ok(!/[!]|\p{Extended_Pictographic}/u.test(text), 'no exclamation marks or emoji');
  // the link in the text reads back as the same enquiry
  const back = parseImport(text, { now: NOW });
  assert.equal(back.ok, true);
  assert.equal(back.data.name, 'Aoife Magee');
  // a custom link, no link, another owner, and multiline notes flattened
  assert.ok(enquiryWhatsAppText(booking(), { link: 'https://x.example/y' }).endsWith('\nhttps://x.example/y'));
  assert.ok(!enquiryWhatsAppText(booking(), { link: '' }).includes('Tap to add'));
  assert.ok(enquiryWhatsAppText(booking(), { business: { ownerFirstName: 'Lee' } }).startsWith('Hi Lee, '));
  assert.ok(enquiryWhatsAppText(booking({ notes: 'line one\n\nline two' })).includes('Anything else: line one line two'));
  assert.equal(enquiryWhatsAppText(null), '');
  assert.equal(enquiryWhatsAppText({ ref: 'nope' }), '');
});

test('acceptanceWhatsAppText and declineWhatsAppText: the sentence from the brief, then the link', () => {
  const acc = acceptanceWhatsAppText({ quote: quote({ lines: [{ id: 'a', label: 'All in', detail: '', qty: 1, unitPrice: 1394 }] }), days: ['thu', 'fri'], part: 'am', note: 'Gate code 1234' });
  const a = acc.split('\n');
  assert.equal(a[0], "Hi Daniel, it's Aoife. I'd like to go ahead with quote Q-EL-1043 (£1,394).");
  assert.equal(a[1], 'Best: Thu or Fri mornings.');
  assert.equal(a[2], 'Note: Gate code 1234');
  assert.equal(a.at(-2), 'Tap to mark it accepted on your dashboard:');
  const back = parseImport(acc, { now: NOW });
  assert.deepEqual([back.kind, back.data.quoteId, back.data.total, back.data.days, back.data.part], ['acc', 'Q-EL-1043', 1394, ['thu', 'fri'], 'am']);
  assert.ok(acceptanceWhatsAppText({ quote: quote() }).includes('Best: any day.'));

  const dec = declineWhatsAppText({ quote: quote(), reason: 'price', note: 'Found cheaper' });
  const d = dec.split('\n');
  assert.equal(d[0], `Hi Daniel, it's Aoife. Thanks for the quote Q-EL-1043 (£${QUOTE_TOTAL.toLocaleString('en-GB')}), but I won't be going ahead this time.`);
  assert.equal(d[1], 'Reason: Too expensive: Found cheaper');
  assert.equal(d.at(-2), 'Tap to mark it declined on your dashboard:');
  assert.equal(parseImport(dec, { now: NOW }).data.reasonId, 'price');
  assert.ok(!declineWhatsAppText({ quote: quote() }).includes('Reason:'));
  for (const t of [acc, dec]) assert.ok(!/[!]|\p{Extended_Pictographic}/u.test(t));
  assert.equal(acceptanceWhatsAppText({ quote: null }), '');
  assert.equal(declineWhatsAppText(null), '');
});

// ---------- reading a link ----------

test('parseImport reads every form of a link, a hash, a bare payload and a pasted message', () => {
  const p = buildEnquiryPayload(booking());
  const enc = encodePayload(p);
  const forms = [
    enc, ` ${enc} `, `${enc.slice(0, 40)}\n${enc.slice(40)}`, `#import=${enc}`, `import=${enc}`, `#/import?d=${enc}`, `/import?d=${enc}`, `#/import?d=${enc}&utm_source=x`,
    `${SITE_BASE_URL}dashboard.html#import=${enc}`, `https://example.github.io/180/dashboard.html#import=${enc}`, `Hi Daniel, new enquiry.\n${SITE_BASE_URL}dashboard.html#import=${enc}\nthanks`,
    `https://wa.me/447885496800?text=${encodeURIComponent(`hello ${SITE_BASE_URL}dashboard.html#import=${enc}`)}`, dashboardImportLink(p), dashboardImportLink(enc)
  ];
  for (const form of forms) {
    const out = parseImport(form, { now: NOW });
    assert.equal(out.ok, true, form.slice(0, 60));
    assert.equal(out.kind, 'enq');
    assert.equal(out.data.name, 'Aoife Magee');
    assert.deepEqual(out.payload, p);
    assert.equal(out.chars, enc.length);
  }
  assert.equal(dashboardImportLink('not base64!'), '');
  assert.equal(dashboardImportLink(null), '');
  assert.equal(dashboardImportLink({ a: 1 }).startsWith(`${SITE_BASE_URL}dashboard.html#import=`), true);
  // an object it made itself reads again; the compact payload object too (its checksum must be right)
  const first = parseImport(enc, { now: NOW });
  assert.deepEqual(parseImport(first, { now: NOW }).data, first.data);
  assert.deepEqual(parseImport(first.data, { now: NOW }).data, first.data, 'the sanitised data re-cleans to itself');
  assert.equal(parseImport(p, { now: NOW }).ok, true);
  assert.equal(parseImport({ ...p, n: 'Someone Else' }, { now: NOW }).reason, 'damaged');
  assert.equal(parseImport({ ...p, v: 2, k: payloadChecksum({ ...p, v: 2 }) }, { now: NOW }).reason, 'unsupported');
  assert.equal(parseImport({ ok: false, reason: 'damaged' }).ok, false);
});

test('parseImport: quote links (#d=) and the wrong kind for a page', () => {
  const link = quoteLink(quote(), { ref: 'EL-1043', postcode: 'BT9 6QP' });
  for (const form of [link, link.slice(link.indexOf('#')), link.slice(link.indexOf('#d=') + 1), link.slice(link.indexOf('#d=') + 3)]) {
    const out = parseQuoteLink(form, { now: NOW });
    assert.equal(out.ok, true, form.slice(0, 40));
    assert.equal(out.kind, 'quo');
  }
  const enq = dashboardImportLink(buildEnquiryPayload(booking()));
  const wrong = parseQuoteLink(enq);
  assert.deepEqual([wrong.ok, wrong.reason], [false, 'wrong_kind']);
  assert.ok(wrong.message);
  assert.equal(parseImport(enq).ok, true);
});

test('parseImport data: an enquiry (answers in his wording, outside Northern Ireland, the sent time clamped)', () => {
  const out = parseImport(encodePayload(wireEnq({ z: 'DG9 8PQ', a: { parking: 'garage', vehicle: 'have', timing: 'researching', permission: 'landlord' }, o: 0 })), { now: NOW });
  const d = out.data;
  assert.equal(d.kind, 'enq');
  assert.deepEqual([d.ref, d.name, d.firstName, d.phone, d.phoneDigits, d.email, d.postcode], ['EL-1043', 'Aoife Magee', 'Aoife', '07700 900231', '447700900231', 'aoife@example.com', 'DG9 8PQ']);
  assert.deepEqual([d.outside, d.outsideLabel, d.marketingOptIn, d.utmSource, d.notes], [true, 'Outside Northern Ireland', false, 'facebook', 'Hello']);
  assert.deepEqual(d.answerRows.map((r) => [r.key, r.heading, r.label]), [
    ['postcode', 'Postcode', 'DG9 8PQ'], ['parking', 'Parking', 'Garage'], ['vehicle', 'Car', 'Yes'], ['timing', 'Timing', 'Just researching'], ['permission', 'Permission', 'I rent or lease and need permission']
  ]);
  assert.deepEqual([d.createdAt, d.sentAt], ['2026-10-23T18:42', '2026-10-23T18:42']);
  assert.equal(d.importId, 'EL-1043|2026-10-23T18:42|447700900231');
  assert.equal(importIdOf(d), d.importId);
  assert.equal(parseImport(encodePayload(wireEnq()), { now: NOW }).data.outside, false);
  // optional parts really are optional
  const bare = parseImport(encodePayload({ v: 1, t: 'enq', i: 'EL-1050', c: '2026-10-23T18:42', n: 'Bo Li', p: '07700 900232', z: 'BT1 1AA', o: 0 }), { now: NOW }).data;
  assert.deepEqual([bare.email, bare.notes, bare.utmSource, bare.answers, bare.answerRows.length], ['', '', '', {}, 1]);
});

test('parseImport data: a quote, an acceptance and a decline', () => {
  const q = parseImport(encodePayload(wireQuo({ l: [['Charger', 1, 799, 'Zappi 7kW'], ['Cable', 6, 12], ['Discount', 1, -50]] })), { now: NOW }).data;
  assert.deepEqual([q.kind, q.id, q.quoteId, q.ref, q.customerFirst, q.customerName, q.postcode, q.brand, q.total, q.validUntil, q.sentAt, q.sample, q.notes], ['quo', 'Q-EL-1043', 'Q-EL-1043', 'EL-1043', 'Aoife', 'Aoife', 'BT9 6QP', 'ZAPPI', 821, '2026-11-22', '2026-10-23T20:30', true, 'Terms']);
  assert.deepEqual(q.lines.map((l) => [l.id, l.label, l.detail, l.qty, l.unitPrice]), [['ln_1', 'Charger', 'Zappi 7kW', 1, 799], ['ln_2', 'Cable', '', 6, 12], ['ln_3', 'Discount', '', 1, -50]]);
  assert.equal(parseImport(encodePayload(wireQuo({ f: 0 })), { now: NOW }).data.sample, false);

  const a = parseImport(encodePayload(wireAcc()), { now: NOW }).data;
  assert.deepEqual([a.kind, a.quoteId, a.customerFirst, a.days, a.part, a.note, a.total, a.prefers, a.prefersLong], ['acc', 'Q-EL-1043', 'Aoife', ['thu', 'fri'], 'am', 'Gate code 1234', 1249, 'Thu/Fri mornings', 'Thu or Fri mornings']);
  assert.equal(a.summary, 'Aoife accepted quote Q-EL-1043 (£1,249), prefers Thu/Fri mornings');

  const d = parseImport(encodePayload(wireDec()), { now: NOW }).data;
  assert.deepEqual([d.kind, d.quoteId, d.customerFirst, d.reasonId, d.reasonLabel, d.note, d.reasonText], ['dec', 'Q-EL-1043', 'Aoife', 'price', 'Too expensive', 'Sorry', 'Too expensive: Sorry']);
  assert.equal(d.summary, 'Aoife declined quote Q-EL-1043 (Too expensive)');
  assert.equal(parseImport(encodePayload(wireDec({ y: undefined, m: undefined })), { now: NOW }).data.summary, 'Aoife declined quote Q-EL-1043');
  assert.equal(parseImport(encodePayload(wireDec({ y: 'made up' })), { now: NOW }).data.reasonId, '', 'an unknown reason id is dropped');
});

// ---------- hostile input ----------

test('parseImport never throws and gives a calm reason for anything that is not a link of ours', () => {
  const cases = [
    [undefined, 'empty'], [null, 'empty'], [0, 'empty'], [true, 'empty'], ['', 'empty'], ['   \n ', 'empty'], [[], 'empty'], [() => 1, 'empty'], [Symbol('x'), 'empty'],
    [{}, 'no_payload'], [{ foo: 1 }, 'no_payload'],
    ['hello there', 'no_payload'], ['<script>alert(1)</script>', 'no_payload'], ['javascript:alert(1)', 'no_payload'], ['{"v":1,"t":"enq"}', 'no_payload'],
    [`${SITE_BASE_URL}dashboard.html#/today`, 'no_payload'], ['#import=', 'no_payload'], ['#import=short', 'no_payload'],
    ['#import=' + 'A'.repeat(60), 'damaged'], ['x'.repeat(40), 'damaged'], ['#d=' + 'B'.repeat(200), 'damaged'],
    ['a'.repeat(1_000_000), 'too_long'], [`#import=${'A'.repeat(9000)}`, 'too_long']
  ];
  for (const [input, reason] of cases) {
    const out = parseImport(input);
    assert.equal(out.ok, false, String(typeof input === 'string' ? input.slice(0, 30) : typeof input));
    assert.equal(out.reason, reason, String(typeof input === 'string' ? input.slice(0, 30) : typeof input));
    assert.ok(typeof out.message === 'string' && out.message.length > 10, 'a sentence to show');
  }
  const t0 = Date.now();
  parseImport('=' .repeat(500000) + '#import=' + 'z'.repeat(500000));
  parseImport(' import='.repeat(5000));
  assert.ok(Date.now() - t0 < 2000, 'huge input is refused quickly');
});

test('deeply nested or oversized JSON with a valid checksum is refused or ignored, never thrown on', () => {
  const nest = (depth) => JSON.parse(`${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`);
  for (const depth of [10, 400, 900]) {
    const enc = encodePayload({ ...wireEnq(), x: nest(depth) });
    const out = parseImport(`#import=${enc}`, { now: NOW });
    assert.ok(out.ok === true || typeof out.reason === 'string', `depth ${depth}`);
    if (out.ok) assert.equal(out.data.name, 'Aoife Magee', 'unknown fields are ignored');
  }
  const arrays = Buffer.from(`${'['.repeat(5000)}${']'.repeat(5000)}`).toString('base64url');
  assert.equal(parseImport(`#import=${arrays}`).ok, false);
  assert.equal(decodePayload(arrays), null);
  const huge = encodePayload({ ...wireEnq(), pad: 'p'.repeat(20000) });
  assert.equal(huge.length > 8000, true);
  assert.equal(parseImport(`#import=${huge}`).reason, 'too_long');
  assert.equal(decodePayload(huge), null);
});

test('a cut-off, a changed or a joined link is damaged, a different version is unsupported', () => {
  const enc = encodePayload(wireEnq());
  assert.equal(parseImport(`#import=${enc.slice(0, -3)}`).reason, 'damaged');
  assert.equal(parseImport(`#import=${enc}x`).reason, 'damaged');
  assert.equal(parseImport(`#import=${enc.slice(0, 50)}${enc[50] === 'B' ? 'C' : 'B'}${enc.slice(51)}`).reason, 'damaged');
  assert.equal(parseImport(`#import=${encodePayload(wireEnq({ v: 2 }))}`).reason, 'unsupported');
  assert.equal(parseImport(`#import=${encodePayload(wireEnq({ t: 'zzz' }))}`).reason, 'unsupported');
  // two links in one message: the readable one wins, even when the first is damaged
  const both = `first #import=${enc.slice(0, -5)} then ${SITE_BASE_URL}dashboard.html#import=${enc}`;
  assert.equal(parseImport(both, { now: NOW }).ok, true);
});

test('hostile enquiry fields: strings are cleaned and limited, wrong types and bad values are refused with a reason per field', () => {
  const parse = (over, now = NOW) => parseImport(encodePayload(wireEnq(over)), { now });
  const ok = (over) => {
    const out = parse(over);
    assert.equal(out.ok, true, JSON.stringify(over).slice(0, 80));
    return out.data;
  };
  const refused = (over, field) => {
    const out = parse(over);
    assert.equal(out.ok, false, JSON.stringify(over).slice(0, 80));
    assert.equal(out.reason, 'invalid');
    assert.ok(field in out.errors, `${field} in ${JSON.stringify(out.errors)}`);
    assert.ok(out.message.length > 10);
  };
  // HTML and invisible characters
  assert.equal(ok({ n: '<img src=x onerror=alert(1)>Aoife <b>Magee</b>' }).name, 'Aoife Magee');
  assert.equal(ok({ n: '<<b>script>Aoife Magee' }).name.includes('<script'), false);
  assert.equal(ok({ n: `Aoife${String.fromCharCode(0x202e)} Magee${String.fromCharCode(0x200b)}${String.fromCharCode(0)}${String.fromCharCode(0x2028)}` }).name, 'Aoife Magee'); // bidi override, zero width, NUL, line separator
  assert.equal(ok({ n: 'Aoife\n\tMagee' }).name, 'Aoife Magee');
  assert.equal(ok({ m: 'a<script>alert(1)</script>b' }).notes, 'aalert(1)b');
  assert.equal(ok({ m: 'less than <2 metres and 3 > 2' }).notes, 'less than <2 metres and 3 > 2', 'a plain < is not a tag');
  assert.equal(ok({ m: 'line one\r\n\r\n\r\n\r\nline two' }).notes, 'line one\n\nline two');
  // lengths
  assert.equal(ok({ n: `Aoife ${'x'.repeat(5000)}` }).name.length <= 60, true);
  assert.equal(ok({ m: 'y'.repeat(2500) }).notes.length, 400);
  assert.equal(parse({ m: 'y'.repeat(6000) }).reason, 'too_long', 'past the hard ceiling the whole link is refused');
  assert.equal(ok({ e: `${'e'.repeat(300)}@example.com` }).email, '', 'an over-long email is dropped, not cut into another address');
  assert.equal(ok({ e: 'not an email' }).email, '');
  assert.equal(ok({ e: 42 }).email, '');
  // wrong types
  refused({ n: 123 }, 'name');
  refused({ n: ['Aoife'] }, 'name');
  refused({ n: { a: 1 } }, 'name');
  refused({ n: 'A' }, 'name');
  refused({ p: 7700900231 }, 'phone');
  refused({ p: '12345' }, 'phone');
  refused({ p: '07700 900231; DROP TABLE' }, 'phone');
  refused({ z: ['BT9 6QP'] }, 'postcode');
  refused({ z: 'not a postcode' }, 'postcode');
  refused({ z: '' }, 'postcode');
  refused({ i: 'EL-1043; x' }, 'ref');
  refused({ i: 'EL-' }, 'ref');
  refused({ i: 42 }, 'ref');
  refused({ i: 'EL-12345678' }, 'ref');
  refused({ c: 'yesterday' }, 'createdAt');
  refused({ c: '2026-13-45T25:61' }, 'createdAt');
  refused({ c: 20261023 }, 'createdAt');
  refused({ c: undefined }, 'createdAt');
  assert.deepEqual(ok({ a: 'driveway' }).answers, {}, 'answers that are not an object are ignored');
  assert.deepEqual(ok({ a: ['driveway'] }).answers, {});
  assert.deepEqual(ok({ a: { parking: 'a spaceship', vehicle: 'have', timing: 5, permission: { x: 1 }, bogus: 'x' } }).answers, { vehicle: 'have' }, 'only his options survive');
  assert.equal(ok({ o: 'yes' }).marketingOptIn, false);
  assert.equal(ok({ u: 'definitely-not-a-source' }).utmSource, 'other');
  assert.equal(ok({ u: { x: 1 } }).utmSource, '');
  assert.equal(ok({ u: undefined }).utmSource, '');
  assert.equal(ok({ extra: 'ignored', __proto__: { admin: true }, constructor: 'x' }).name, 'Aoife Magee');
  assert.equal(({}).admin, undefined, 'nothing leaked onto Object.prototype');
  const proto = parseImport(encodePayload(JSON.parse('{"v":1,"t":"enq","i":"EL-1043","c":"2026-10-23T18:42","n":"Aoife Magee","p":"07700 900231","z":"BT9 6QP","__proto__":{"polluted":1},"a":{"__proto__":{"polluted":2}}}')), { now: NOW });
  assert.equal(proto.ok, true);
  assert.equal(({}).polluted, undefined);
});

test('dates: a future sent time is now, an old one is no older than 30 days, nonsense is refused', () => {
  const at = (c) => parseImport(encodePayload(wireEnq({ c })), { now: NOW }).data;
  assert.equal(at('2026-10-23T20:30').createdAt, '2026-10-23T20:30');
  assert.equal(at('2026-10-23T20:31').createdAt, NOW, 'one minute in the future');
  assert.equal(at('2099-01-01T00:00').createdAt, NOW);
  assert.equal(at('2026-10-23T20:31').sentAt, '2026-10-23T20:31', 'what was sent is kept for the idempotency key');
  assert.equal(at('2026-10-22T20:30').createdAt, '2026-10-22T20:30');
  assert.equal(at('2000-01-01T00:00').createdAt, '2026-09-23T20:30', '30 days before now');
  assert.equal(at('2026-09-23T20:30').createdAt, '2026-09-23T20:30');
  assert.equal(at('2026-09-23T20:29').createdAt, '2026-09-23T20:30');
  assert.equal(clampStamp('2026-10-24T01:00', NOW), NOW);
  assert.equal(clampStamp('nonsense', NOW), NOW);
  assert.equal(clampStamp(undefined, NOW), NOW);
  assert.equal(clampStamp('2026-10-20T10:00', NOW), '2026-10-20T10:00');
  assert.equal(clampStamp('2026-10-01T10:00', NOW, { maxAgeDays: 7 }), '2026-10-16T20:30');
  assert.equal(clampStamp('2026-10-20T10:00', 'bad clock'), '2026-10-20T10:00', 'a bad clock falls back to the app clock');
});

test('hostile quote, acceptance and decline fields', () => {
  const bad = (payload, field) => {
    const out = parseImport(encodePayload(payload), { now: NOW });
    assert.equal(out.ok, false, JSON.stringify(payload).slice(0, 80));
    assert.equal(out.reason, 'invalid');
    assert.ok(field in out.errors, `${field} in ${JSON.stringify(out.errors)}`);
  };
  bad(wireQuo({ i: 'EL-1043' }), 'id');
  bad(wireQuo({ i: 'Q-' }), 'id');
  bad(wireQuo({ i: 'Q-<b>' }), 'id');
  bad(wireQuo({ n: '' }), 'name');
  bad(wireQuo({ n: null }), 'name');
  bad(wireQuo({ x: '2026-13-45' }), 'validUntil');
  bad(wireQuo({ x: undefined }), 'validUntil');
  bad(wireQuo({ l: [] }), 'lines');
  bad(wireQuo({ l: 'lines' }), 'lines');
  bad(wireQuo({ l: { 0: ['x', 1, 1] } }), 'lines');
  bad(wireQuo({ l: Array.from({ length: 15 }, (_, i) => [`L${i}`, 1, 10]) }), 'lines');
  bad(wireQuo({ l: [['x', 1.5, 10]] }), 'lines');
  bad(wireQuo({ l: [['x', 1, 9.5]] }), 'lines');
  bad(wireQuo({ l: [['x', 0, 10]] }), 'lines');
  bad(wireQuo({ l: [['x', 1000, 10]] }), 'lines');
  bad(wireQuo({ l: [['x', -1, 10]] }), 'lines');
  bad(wireQuo({ l: [['x', 1, 100000]] }), 'lines');
  bad(wireQuo({ l: [['', 1, 10]] }), 'lines');
  bad(wireQuo({ l: [[5, 1, 10]] }), 'lines');
  bad(wireQuo({ l: [['x', '1', '10']] }), 'lines');
  bad(wireQuo({ l: ['x'] }), 'lines');
  bad(wireQuo({ l: [null] }), 'lines');
  bad(wireQuo({ l: [['Free', 1, 0]] }), 'lines');
  bad(wireQuo({ l: [['Credit', 1, -10]] }), 'lines');
  const q = parseImport(encodePayload(wireQuo({ n: 'Aoife Magee the Third', z: 'junk', r: 'EL-x', b: 'B'.repeat(200), m: '<b>Terms</b>', s: 'soon', l: [['<i>Charger</i>', 1, 799, 'D'.repeat(500)]] })), { now: NOW }).data;
  assert.deepEqual([q.customerFirst, q.postcode, q.ref, q.brand.length, q.notes, q.sentAt, q.lines[0].label, q.lines[0].detail.length], ['Aoife', '', '', 40, 'Terms', '', 'Charger', 200]);

  bad(wireAcc({ i: 'x' }), 'id');
  bad(wireAcc({ n: '' }), 'name');
  bad(wireAcc({ t2: 0 }), 'total');
  bad(wireAcc({ t2: -5 }), 'total');
  bad(wireAcc({ t2: 12.5 }), 'total');
  bad(wireAcc({ t2: '1249' }), 'total');
  bad(wireAcc({ t2: 10_000_000 }), 'total');
  bad(wireAcc({ t2: undefined }), 'total');
  const a = parseImport(encodePayload(wireAcc({ d: ['sun', 'fri', 'FRI', 5, null, 'mon', 'mon'], w: 'night', m: 'N'.repeat(900) })), { now: NOW }).data;
  assert.deepEqual([a.days, a.part, a.note.length], [['mon', 'fri'], 'any', 200]);
  assert.deepEqual(parseImport(encodePayload(wireAcc({ d: 'thu' })), { now: NOW }).data.days, []);
  assert.deepEqual(parseImport(encodePayload(wireAcc({ d: { 0: 'thu' } })), { now: NOW }).data.days, []);

  bad(wireDec({ i: 'x' }), 'id');
  bad(wireDec({ n: '   ' }), 'name');
  const d = parseImport(encodePayload(wireDec({ m: 'M'.repeat(900) })), { now: NOW }).data;
  assert.equal(d.note.length, 140);
});

// ---------- cleaning ----------

test('sanitiseText: invisible and bidi characters, tags, whitespace, limits, surrogate pairs', () => {
  assert.equal(sanitiseText('  a   b\t c \n d ', 50), 'a b c d');
  assert.equal(sanitiseText('a\n\n\n\nb', 50, { multiline: true }), 'a\n\nb');
  assert.equal(sanitiseText('a \n b', 50, { multiline: true }), 'a\nb');
  assert.equal(sanitiseText('abcdef', 3), 'abc');
  assert.equal(sanitiseText('ab\u{1F697}', 3), 'ab', 'never half an emoji');
  assert.equal(sanitiseText('<p onclick="x">hi</p>', 50), 'hi');
  assert.equal(sanitiseText('x'.repeat(1_000_000), 20).length, 20);
  for (const v of [undefined, null, 5, {}, [], true]) assert.equal(sanitiseText(v, 10), '');
  assert.equal(sanitiseText('Zoë Ó Briain £5 — ☕', 50), 'Zoë Ó Briain £5 — ☕');
});

// ---------- remembering what this browser opened ----------

test('rememberHandoff / recallHandoff / forgetHandoff: best effort, small, never throws', () => {
  const storage = memStorage();
  assert.equal(rememberHandoff('acc', 'Q-EL-1043', { days: ['thu', 'fri'], part: 'am', note: 'Gate' }, { storage }), true);
  const got = recallHandoff('acc', 'Q-EL-1043', { storage });
  assert.deepEqual([got.days, got.part, got.note, got.at], [['thu', 'fri'], 'am', 'Gate', NOW]);
  assert.equal(recallHandoff('dec', 'Q-EL-1043', { storage }), null);
  assert.ok(storage.getItem(HANDOFF_STORAGE_KEY));
  assert.equal(rememberHandoff('enq', 'EL-1043', { at: '2026-10-22T09:00' }, { storage }), true);
  assert.equal(recallHandoff('enq', 'EL-1043', { storage }).at, '2026-10-22T09:00');
  forgetHandoff('acc', 'Q-EL-1043', { storage });
  assert.equal(recallHandoff('acc', 'Q-EL-1043', { storage }), null);
  forgetHandoff('acc', 'never-there', { storage });
  // bad kinds and ids, junk info
  for (const [k, i] of [['quo', 'x'], ['', 'x'], ['acc', ''], ['acc', 5], ['acc', 'x'.repeat(100)], [undefined, undefined]]) {
    assert.equal(rememberHandoff(k, i, {}, { storage }), false);
    assert.equal(recallHandoff(k, i, { storage }), null);
  }
  rememberHandoff('dec', 'Q-J', { a: () => 1, b: { x: 1 }, c: 'c'.repeat(900), d: ['a', 5, 'b'], e: Number.NaN, f: true }, { storage });
  assert.deepEqual(recallHandoff('dec', 'Q-J', { storage }), { c: 'c'.repeat(200), d: ['a', 'b'], f: true, at: NOW });
  // the oldest of more than 30 go
  for (let i = 0; i < 40; i += 1) rememberHandoff('enq', `EL-${2000 + i}`, {}, { storage });
  assert.equal(recallHandoff('enq', 'EL-2000', { storage }), null);
  assert.ok(recallHandoff('enq', 'EL-2039', { storage }));
  assert.ok(Object.keys(JSON.parse(storage.getItem(HANDOFF_STORAGE_KEY)).items).length <= 30);
  // damaged saved data, a storage that throws, no storage at all
  storage.map.set(HANDOFF_STORAGE_KEY, '{not json');
  assert.doesNotThrow(() => recallHandoff('enq', 'EL-2039', { storage }));
  assert.equal(rememberHandoff('enq', 'EL-3000', {}, { storage }), true, 'writes over damaged data');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(rememberHandoff('enq', 'EL-3001', {}, { storage: throwing }), false);
  assert.doesNotThrow(() => recallHandoff('enq', 'EL-3001', { storage: throwing }));
  assert.doesNotThrow(() => forgetHandoff('enq', 'EL-3001', { storage: throwing }));
  assert.doesNotThrow(() => rememberHandoff('enq', 'EL-3002', {}));
});
