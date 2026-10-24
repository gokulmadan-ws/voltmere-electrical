// tests/unit/quotes.test.mjs: unit tests for js/core/quotes.js (totals, effective status, starting lines, validation) and the quote message kinds
// Owner: A3 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_BASE_URL, makeChargerItem, makeDefaultQuoteItems, makeDefaultSettings, chargerItemId } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import {
  buildQuoteDraft, defaultQuoteLines, latestQuoteFor, normaliseQuoteItems, normaliseQuoteLines, quoteExpiresInDays, quoteLineTotal, quoteStatus,
  quoteTotal, quoteUrl, quotesFor
} from '../../js/core/quotes.js';
import * as selectors from '../../js/core/selectors.js';
import { quoteUrl as quoteUrlFromMessages } from '../../js/core/messages.js';

beforeEach(() => setClock(new Date(2026, 9, 23, 20, 30)));
afterEach(() => setClock(null));

const line = (over = {}) => ({ id: 'ln_1', label: 'Supply of ZAPPI home charger', detail: '', qty: 1, unitPrice: 799, ...over });
const quote = (over = {}) => ({
  id: 'Q-EL-1043', bookingId: 'bk_1', customerName: 'Aoife Magee', createdAt: '2026-10-23T09:00', status: 'sent', brand: 'ZAPPI',
  lines: [line(), line({ id: 'ln_2', label: 'Extra cable (per metre)', qty: 6, unitPrice: 12 })], notes: '', validUntil: '2026-11-22',
  sentAt: '2026-10-23T09:30', sentVia: 'whatsapp', viewedAt: null, acceptedAt: null, declinedAt: null, declineReason: '', installBookingId: null, seed: false, ...over
});

test('quoteLineTotal and quoteTotal: whole pounds, discounts are negative lines, nothing breaks on empty input', () => {
  assert.equal(quoteLineTotal(line()), 799);
  assert.equal(quoteLineTotal(line({ qty: 6, unitPrice: 12 })), 72);
  assert.equal(quoteLineTotal(line({ qty: 1, unitPrice: -50 })), -50);
  assert.equal(quoteTotal(quote()), 799 + 72);
  assert.equal(quoteTotal(quote({ lines: [line(), line({ id: 'd', label: 'Discount', unitPrice: -100 })] })), 699);
  assert.equal(quoteTotal(quote({ lines: [] })), 0);
  assert.equal(quoteTotal(null), 0);
  assert.equal(quoteTotal({}), 0);
  assert.equal(quoteLineTotal(null), 0);
  assert.equal(selectors.quoteTotal, quoteTotal, 'the pinned helper is exported from selectors.js too');
});

test('quoteStatus: sent and viewed expire the day AFTER validUntil; every other status is as stored', () => {
  assert.equal(quoteStatus(quote({ validUntil: '2026-10-23' }), '2026-10-23T23:59'), 'sent', 'the last good day is validUntil itself');
  assert.equal(quoteStatus(quote({ validUntil: '2026-10-22' }), '2026-10-23T00:00'), 'expired');
  assert.equal(quoteStatus(quote({ status: 'viewed', validUntil: '2026-10-22' }), '2026-10-23T09:00'), 'expired');
  for (const status of ['draft', 'accepted', 'declined', 'expired']) {
    assert.equal(quoteStatus(quote({ status, validUntil: '2020-01-01' }), '2026-10-23T09:00'), status, `${status} does not change`);
  }
  assert.equal(quoteStatus(quote({ validUntil: '2026-10-22' })), 'expired', 'defaults to the clock');
  assert.equal(quoteStatus(quote({ validUntil: '2026-10-23' })), 'sent');
  assert.equal(quoteStatus(null), null);
  assert.equal(quoteStatus(quote({ validUntil: undefined }), '2030-01-01T00:00'), 'sent', 'no validUntil never expires');
  assert.equal(selectors.quoteStatus, quoteStatus);
});

test('quoteExpiresInDays: 0 on the last good day, negative once it has passed', () => {
  assert.equal(quoteExpiresInDays(quote({ validUntil: '2026-10-23' }), '2026-10-23T20:30'), 0);
  assert.equal(quoteExpiresInDays(quote({ validUntil: '2026-11-22' }), '2026-10-23T20:30'), 30);
  assert.equal(quoteExpiresInDays(quote({ validUntil: '2026-10-20' }), '2026-10-23T20:30'), -3);
  assert.equal(quoteExpiresInDays(quote({ validUntil: '2026-10-26' })), 3, 'defaults to the clock');
  assert.equal(quoteExpiresInDays(quote({ validUntil: '' })), null);
  assert.equal(quoteExpiresInDays(null), null);
});

test('quoteUrl is SITE_BASE_URL + quote.html#q=<id> (and messages.js exports the same function)', () => {
  assert.equal(quoteUrl('Q-EL-1043'), `${SITE_BASE_URL}quote.html#q=Q-EL-1043`);
  assert.equal(quoteUrlFromMessages, quoteUrl);
  assert.ok(quoteUrl('Q-EL-1043-2').endsWith('quote.html#q=Q-EL-1043-2'));
  assert.ok(SITE_BASE_URL.endsWith('/'));
});

test('the default catalogue: a sample charger line per brand, then the seven install and extra lines', () => {
  const items = makeDefaultQuoteItems();
  assert.deepEqual(items.map((i) => i.id), ['charger_zappi', 'charger_ohme', 'charger_sync', 'install_standard', 'cable_extra', 'circuit', 'consumer_unit', 'enclosure', 'groundwork', 'testing']);
  assert.deepEqual(items.slice(0, 3).map((i) => i.label), ['Supply of ZAPPI home charger', 'Supply of OHME home charger', 'Supply of SYNC home charger']);
  assert.deepEqual(items.slice(0, 3).map((i) => i.brand), ['ZAPPI', 'OHME', 'SYNC']);
  assert.deepEqual(items.slice(3).map((i) => i.label), [
    'Standard installation (up to 10 m of cable)', 'Extra cable (per metre)', 'Dedicated circuit and protective device', 'Consumer unit upgrade (if required)',
    'Surface-mounted enclosure', 'Groundwork (per metre)', 'Testing and certification'
  ]);
  assert.deepEqual(items.filter((i) => i.unit === 'metre').map((i) => i.id), ['cable_extra', 'groundwork']);
  assert.ok(items.every((i) => Number.isInteger(i.unitPrice) && i.unitPrice > 0 && i.defaultQty === 1), 'whole-pound sample prices');
  assert.deepEqual(items.filter((i) => i.suggested).map((i) => i.id), ['charger_zappi', 'install_standard', 'circuit', 'testing']);
  assert.deepEqual(makeDefaultQuoteItems(['KEBA']).map((i) => i.id).slice(0, 2), ['charger_keba', 'install_standard']);
  assert.deepEqual(makeDefaultQuoteItems([]).map((i) => i.kind), ['install', 'extra', 'install', 'extra', 'extra', 'extra', 'install']);
  assert.equal(makeChargerItem('Fox ESS').unitPrice, 700, 'a brand the owner adds starts at a sample 700');
  assert.equal(chargerItemId('Fox ESS'), 'charger_fox_ess');
  assert.notEqual(makeDefaultQuoteItems()[0], makeDefaultQuoteItems()[0], 'a fresh copy every call');
});

test('defaultQuoteLines: the charger line of the brand, then every suggested item, with fresh line ids', () => {
  const settings = makeDefaultSettings();
  const lines = defaultQuoteLines(settings, { brand: 'OHME' });
  assert.deepEqual(lines.map((l) => l.label), ['Supply of OHME home charger', 'Standard installation (up to 10 m of cable)', 'Dedicated circuit and protective device', 'Testing and certification']);
  assert.deepEqual(lines.map((l) => [l.qty, l.unitPrice]), [[1, 679], [1, 450], [1, 180], [1, 85]]);
  assert.equal(quoteTotal({ lines }), 679 + 450 + 180 + 85);
  assert.ok(lines.every((l) => /^ln_[0-9a-z]{8}$/.test(l.id) && l.detail === ''));
  assert.equal(new Set(lines.map((l) => l.id)).size, lines.length);
  assert.equal(defaultQuoteLines(settings)[0].label, 'Supply of ZAPPI home charger', 'the first brand by default');
  assert.equal(defaultQuoteLines(settings, { brand: 'NOPE' }).length, 3, 'an unknown brand gets no charger line');
  assert.equal(defaultQuoteLines(settings, { brand: '' }).length, 3);
  settings.quoteItems.find((i) => i.id === 'circuit').unitPrice = 200;
  assert.equal(quoteTotal({ lines: defaultQuoteLines(settings, { brand: 'ZAPPI' }) }), 799 + 450 + 200 + 85, 'the catalogue prices flow in');
  assert.deepEqual(defaultQuoteLines({}), [], 'tolerates a settings object with no catalogue');
});

test('buildQuoteDraft: the ready-to-edit input for a booking, nothing saved, null for an unknown booking', () => {
  const settings = makeDefaultSettings();
  const state = { settings, bookings: [{ id: 'bk_1', customer: { name: 'Aoife Magee' } }], quotes: {} };
  const draft = buildQuoteDraft(state, 'bk_1');
  assert.equal(draft.bookingId, 'bk_1');
  assert.equal(draft.customerName, 'Aoife Magee');
  assert.equal(draft.brand, 'ZAPPI');
  assert.equal(draft.lines.length, 4);
  assert.equal(draft.notes, settings.quoteDefaults.notes);
  assert.equal(draft.validUntil, '2026-11-22', 'today + 30 days');
  assert.equal(buildQuoteDraft(state, 'bk_1', { brand: 'SYNC' }).lines[0].label, 'Supply of SYNC home charger');
  assert.equal(buildQuoteDraft(state, 'nope'), null);
  assert.deepEqual(state.quotes, {}, 'nothing was saved');
  settings.quoteDefaults.validDays = 14;
  assert.equal(buildQuoteDraft(state, 'bk_1').validUntil, '2026-11-06');
});

test('normaliseQuoteLines: clean lines or one plain sentence about the first problem', () => {
  const ok = normaliseQuoteLines([{ label: '  Charger  ', qty: 2, unitPrice: 100 }, { id: 'keep', label: 'Discount', detail: ' loyal ', qty: 1, unitPrice: -20 }]);
  assert.equal(ok.error, '');
  assert.deepEqual(ok.lines.map((l) => [l.label, l.detail, l.qty, l.unitPrice]), [['Charger', '', 2, 100], ['Discount', 'loyal', 1, -20]]);
  assert.match(ok.lines[0].id, /^ln_[0-9a-z]{8}$/, 'a missing id is generated');
  assert.equal(ok.lines[1].id, 'keep');
  assert.equal(normaliseQuoteLines([]).error, '', 'an empty draft is allowed');
  const dup = normaliseQuoteLines([{ id: 'a', label: 'x', qty: 1, unitPrice: 1 }, { id: 'a', label: 'y', qty: 1, unitPrice: 1 }]);
  assert.notEqual(dup.lines[0].id, dup.lines[1].id, 'duplicate ids are replaced');
  const bad = (lines) => normaliseQuoteLines(lines).error;
  assert.match(bad('x'), /lines of the quote/);
  assert.match(bad([null]), /Line 1 is not valid/);
  assert.match(bad([{ label: '', qty: 1, unitPrice: 1 }]), /Line 1 needs a description/);
  assert.match(bad([{ label: 'x'.repeat(121), qty: 1, unitPrice: 1 }]), /under 120/);
  assert.match(bad([{ label: 'x', detail: 'd'.repeat(201), qty: 1, unitPrice: 1 }]), /under 200/);
  for (const qty of [0, -1, 1.5, '2', 1000, null, undefined]) assert.match(bad([{ label: 'x', qty, unitPrice: 1 }]), /quantity from 1 to 999/, String(qty));
  for (const unitPrice of [1.5, '10', 100000, -100000, null, undefined]) assert.match(bad([{ label: 'x', qty: 1, unitPrice }]), /whole number of pounds/, String(unitPrice));
  assert.match(bad([{ label: 'ok', qty: 1, unitPrice: 1 }, { label: '', qty: 1, unitPrice: 1 }]), /Line 2/, 'the line number is the position');
  assert.match(bad(Array.from({ length: 41 }, () => ({ label: 'x', qty: 1, unitPrice: 1 }))), /up to 40 lines/);
});

test('normaliseQuoteItems: the catalogue editor input, validated', () => {
  const ok = normaliseQuoteItems([{ label: 'Smart meter link', unitPrice: 60 }, { id: 'charger_zappi', kind: 'charger', brand: ' ZAPPI ', label: 'Supply of ZAPPI home charger', unit: 'each', unitPrice: 810, defaultQty: 1, suggested: true }]);
  assert.equal(ok.error, '');
  assert.deepEqual(ok.items[0], { id: ok.items[0].id, kind: 'extra', brand: '', label: 'Smart meter link', detail: '', unit: 'each', unitPrice: 60, defaultQty: 1, suggested: false });
  assert.match(ok.items[0].id, /^item_[0-9a-z]{8}$/);
  assert.deepEqual([ok.items[1].brand, ok.items[1].suggested, ok.items[1].unitPrice], ['ZAPPI', true, 810]);
  assert.equal(normaliseQuoteItems([{ kind: 'extra', brand: 'ignored', label: 'x', unitPrice: 1 }]).items[0].brand, '', 'only chargers carry a brand');
  const bad = (items) => normaliseQuoteItems(items).error;
  assert.match(bad('x'), /items for the quote builder/);
  assert.match(bad([{ label: '', unitPrice: 1 }]), /needs a description/);
  assert.match(bad([{ label: 'x'.repeat(81), unitPrice: 1 }]), /under 80/);
  assert.match(bad([{ label: 'x', unitPrice: -1 }]), /whole number of pounds/);
  assert.match(bad([{ label: 'x', unitPrice: 1.5 }]), /whole number of pounds/);
  assert.match(bad([{ label: 'x', unitPrice: 1, unit: 'mile' }]), /each or per metre/);
  assert.match(bad([{ label: 'x', unitPrice: 1, kind: 'gift' }]), /type/);
  assert.match(bad([{ label: 'x', unitPrice: 1, defaultQty: 0 }]), /quantity/);
  assert.match(bad(Array.from({ length: 61 }, () => ({ label: 'x', unitPrice: 1 }))), /up to 60/);
});

test('latestQuoteFor and quotesFor: newest first, version 2 beats version 1 in the same minute, other bookings ignored', () => {
  const quotes = {
    'Q-EL-1043': quote({ id: 'Q-EL-1043', createdAt: '2026-10-20T09:00' }),
    'Q-EL-1043-2': quote({ id: 'Q-EL-1043-2', createdAt: '2026-10-22T09:00' }),
    'Q-EL-1043-10': quote({ id: 'Q-EL-1043-10', createdAt: '2026-10-22T09:00' }),
    'Q-EL-1044': quote({ id: 'Q-EL-1044', bookingId: 'bk_2', createdAt: '2026-10-23T09:00' })
  };
  assert.deepEqual(quotesFor(quotes, 'bk_1').map((q) => q.id), ['Q-EL-1043-10', 'Q-EL-1043-2', 'Q-EL-1043'], 'ties by version number, not by text order');
  assert.equal(latestQuoteFor(quotes, 'bk_1').id, 'Q-EL-1043-10');
  assert.equal(latestQuoteFor(quotes, 'bk_2').id, 'Q-EL-1044');
  assert.equal(latestQuoteFor(quotes, 'nope'), null);
  assert.equal(latestQuoteFor(undefined, 'bk_1'), null);
  assert.deepEqual(quotesFor({}, 'bk_1'), []);
});
