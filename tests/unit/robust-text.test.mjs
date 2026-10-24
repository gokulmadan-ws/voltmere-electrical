// tests/unit/robust-text.test.mjs: hostile text. Half an emoji, control and bidi characters, 10,000 characters, prototype-looking ids and
// huge notes never crash a screen, never make a WhatsApp link too long to open, and never get past the store's bounds.
// Owner: ROBUST (final gate)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_TEXT_MAX, STORAGE_KEYS } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { own, plainText, safeEncode, wellFormed } from '../../js/core/format.js';
import { WA_URL_BUDGET, acceptanceHandoff, declineHandoff, enquiryHandoff, waLink } from '../../js/core/messages.js';
import { repairState } from '../../js/core/repair.js';
import * as store from '../../js/core/store.js';

const FIXTURE = new Date(2026, 9, 23, 20, 30);
beforeEach(() => setClock(FIXTURE));
afterEach(() => setClock(null));

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}
const fresh = () => store.initStore({ storage: memStorage(), force: true });
const input = (over = {}) => ({
  serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' },
  customer: { name: 'Hostile Tester', phone: '07700 900321', email: 'h@example.com' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true, ...over
});

test('wellFormed replaces a lone surrogate and leaves real pairs and ordinary text alone', () => {
  assert.equal(wellFormed('plain'), 'plain');
  assert.equal(wellFormed('\u{1F600} ok'), '\u{1F600} ok');
  assert.equal(wellFormed('a\uD83Db'), 'a�b');
  assert.equal(wellFormed('a\uDE00b'), 'a�b');
  assert.equal(wellFormed('\uD83D'), '�');
  assert.equal(wellFormed('\uD83D😀'), '�\u{1F600}');
  assert.equal(wellFormed(null), '');
  assert.equal(wellFormed(undefined), '');
  assert.equal(wellFormed(42), '42');
});

test('safeEncode never throws and equals encodeURIComponent for well-formed text', () => {
  assert.throws(() => encodeURIComponent('\uD83D'), URIError);
  assert.equal(safeEncode('\uD83D'), '%EF%BF%BD');
  assert.equal(safeEncode('a b&c=\u{1F600}'), encodeURIComponent('a b&c=\u{1F600}'));
  assert.doesNotThrow(() => waLink('07885 496800', 'lone \uD83D surrogate'));
});

test('plainText: control, zero-width and bidi characters go, emoji stay whole at the cut, one line unless asked', () => {
  assert.equal(plainText('A​‌‍⁠﻿B\u0000C\u0007'), 'ABC');
  assert.equal(plainText('evil ‮evil‬ ⁧x⁩'), 'evil evil x');
  assert.equal(plainText('  many   spaces\nand\r\nlines  '), 'many spaces and lines');
  assert.equal(plainText('one\n\n\n\ntwo   three', 100, { multiline: true }), 'one\n\ntwo three');
  const cut = plainText('a'.repeat(59) + '\u{1F600}', 60);
  assert.equal(cut, 'a'.repeat(59), 'half an emoji is never left at the cut');
  assert.equal(plainText('\u{1F600}'.repeat(40), 60).length % 2, 0);
  assert.equal(plainText('x'.repeat(10000), 60).length, 60);
  assert.equal(plainText(undefined), '');
  assert.equal(plainText({ toString: () => 'obj' }), 'obj');
});

test('own() reads only an object\'s own keys: __proto__, constructor and toString are not records', () => {
  const quotes = { 'Q-1': { id: 'Q-1' } };
  assert.equal(own(quotes, 'Q-1').id, 'Q-1');
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nope', '']) assert.equal(own(quotes, k), null, k);
  assert.equal(own(null, 'x'), null);
  assert.equal(own(quotes, 5), null);
});

test('createBooking keeps customer text plain, well-formed and bounded, whatever is sent', () => {
  fresh();
  const hostile = 'HZ7 <img src=x onerror=1> ‮evil‬ \u0000 \uD83D lone ' + '́'.repeat(500) + 'x'.repeat(10000);
  const res = store.createBooking(input({ customer: { name: hostile, phone: '07700 900321', email: 'e'.repeat(5000) + '@example.com' }, notes: hostile, address: { line1: hostile, postcode: 'BT1 1AA' } }));
  assert.ok(res.ok);
  const b = res.booking;
  assert.ok(b.customer.name.length <= 60 && b.notes.length <= 300 && b.customer.email.length <= 120 && b.address.line1.length <= 120);
  for (const text of [b.customer.name, b.notes, b.address.line1]) {
    assert.equal(wellFormed(text), text, 'well-formed');
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F‪-‮⁦-⁩]/.test(text), 'no control or bidi characters');
  }
  const cutAtEmoji = store.createBooking(input({ customer: { name: 'a'.repeat(59) + '\u{1F600}\u{1F600}', phone: '07700 900322', email: '' } }));
  assert.equal(wellFormed(cutAtEmoji.booking.customer.name), cutAtEmoji.booking.customer.name);
  assert.equal(cutAtEmoji.booking.customer.name, 'a'.repeat(59));
});

test('a WhatsApp handoff stays under the URL budget however long or heavy the notes are, and short notes are left exactly as they were', () => {
  fresh();
  const heavy = ['́'.repeat(300), '\u{1F600}'.repeat(150), 'W'.repeat(300), 'word '.repeat(60)];
  for (const notes of heavy) {
    const made = store.createBooking(input({ notes }));
    const h = enquiryHandoff(made.booking, store.getState());
    assert.ok(h.ok, 'carried');
    assert.ok(h.url.length <= WA_URL_BUDGET, `enquiry url ${h.url.length}`);
    assert.doesNotThrow(() => new URL(h.url));
    assert.ok(h.text.endsWith(h.link), 'the link is still the last thing in the message');
  }
  const short = store.createBooking(input({ notes: 'Gate code 1234', customer: { name: 'Short Notes', phone: '07700 900323', email: '' } }));
  const h = enquiryHandoff(short.booking, store.getState());
  assert.ok(h.text.includes('Anything else: Gate code 1234'));
  const quote = Object.values(store.getState().quotes).find((q) => q.status === 'sent');
  for (const note of heavy.map((n) => n.slice(0, 200))) {
    const a = acceptanceHandoff({ quote, days: ['mon', 'tue'], part: 'am', note }, store.getState());
    const d = declineHandoff({ quote, reason: 'price', note }, store.getState());
    assert.ok(a.ok && a.url.length <= WA_URL_BUDGET, `acceptance url ${a.url.length}`);
    assert.ok(d.ok && d.url.length <= WA_URL_BUDGET, `decline url ${d.url.length}`);
  }
});

test('the store refuses over-long business text with a sentence and keeps what it had; the longest allowed text is kept', () => {
  fresh();
  const bad = store.updateSettings({ business: { name: 'W'.repeat(10000), tagline: 't '.repeat(5000), ownerFirstName: 'O'.repeat(100), address: 'A'.repeat(500) } });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid');
  for (const key of ['name', 'tagline', 'ownerFirstName', 'address']) assert.match(bad.errors[key], /Keep /);
  assert.equal(store.getState().settings.business.name, '180 Electrical');
  const ok = store.updateSettings({ business: { name: 'x'.repeat(BUSINESS_TEXT_MAX.name), tagline: 't'.repeat(BUSINESS_TEXT_MAX.tagline), ownerFirstName: 'O'.repeat(BUSINESS_TEXT_MAX.ownerFirstName) } });
  assert.ok(ok.ok);
  const lists = store.updateSettings({ business: { brands: Array.from({ length: 500 }, (_, i) => `B${i}`) } });
  assert.equal(lists.ok, false);
});

test('repair cuts an old save that already holds a huge business text', () => {
  const st = JSON.parse(JSON.stringify(fresh()));
  st.settings.business.name = 'W'.repeat(10000);
  st.settings.business.tagline = 'T'.repeat(10000);
  const { changes } = repairState(st, { today: '2026-10-23' });
  assert.ok(changes >= 2);
  assert.equal(st.settings.business.name.length, BUSINESS_TEXT_MAX.name);
  assert.equal(st.settings.business.tagline.length, BUSINESS_TEXT_MAX.tagline);
});

test('ids that look like object internals are "not found", never a record', () => {
  fresh();
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(store.updateQuote(id, { notes: 'x' }).reason, 'not_found', id);
    assert.equal(store.sendQuote(id, { via: 'link' }).reason, 'not_found', id);
    assert.equal(store.deleteQuote(id).reason, 'not_found', id);
    assert.equal(store.declineQuote(id, { reason: 'x' }).reason, 'not_found', id);
    assert.equal(store.acceptQuote(id, { date: '2026-10-28', windowId: 0 }).reason, 'not_found', id);
    assert.equal(store.confirmBooking(id).reason, 'not_found', id);
    assert.equal(store.cancelBooking(id, 'owner', {}).reason, 'not_found', id);
  }
  assert.equal(store.getState().quotes.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('a state that holds a lone surrogate in a customer name loads, and every link built from it works', () => {
  const st = JSON.parse(JSON.stringify(fresh()));
  st.bookings[0].customer.name = 'Half \uD83D emoji';
  st.bookings[0].notes = 'note \uDE00';
  const storage = memStorage({ [STORAGE_KEYS.state]: JSON.stringify(st) });
  const loaded = store.initStore({ storage, force: true });
  const b = loaded.bookings[0];
  assert.doesNotThrow(() => enquiryHandoff(b, loaded));
  assert.doesNotThrow(() => waLink('07885 496800', b.customer.name + b.notes));
});
