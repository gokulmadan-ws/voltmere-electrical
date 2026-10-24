// tests/unit/v3-misc.test.mjs: unit tests for the other v3 store additions (ad spend, photos, utm, settings, rollover, reset, quota guard)
// Owner: A3 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGES, STORAGE_KEYS, makeDefaultSettings } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { selectBrand, selectBookingById, selectCostPerLead, selectQuote, selectImageUrl } from '../../js/core/selectors.js';
import { PHOTO_LIMITS } from '../../js/core/photos.js';
import { clearUtm } from '../../js/core/utm.js';
import * as store from '../../js/core/store.js';

const {
  initStore, getState, subscribe, undo, createBooking, updateSettings, setAdSpend, removeAdSpend, addBookingPhotos, removeBookingPhoto, resetDemo,
  simulateIncomingBooking, connectGoogle, createQuote, setConnection, sendQuickMessage
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
  clearUtm();
  storage = memStorage();
  initStore({ storage, force: true });
});
afterEach(() => setClock(null));

const spend = () => getState().settings.marketing.adSpend;
const jpeg = (name = 'consumer-unit.jpg', chars = 2000) => ({ name, dataUrl: `data:image/jpeg;base64,${'A'.repeat(chars)}` });
const enquiry = (over = {}) => ({
  serviceId: 'ev_quote', pencil: true, customer: { name: 'Hannah Boyd', phone: '07700 900777', email: 'h@example.com' }, address: { line1: '', postcode: 'BT9 6QP' },
  answers: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, ...over
});

// ---------- ad spend ----------

test('the seed has three months of Facebook and Instagram spend, month to date for this month', () => {
  assert.deepEqual(spend().map((e) => [e.month, e.channel, e.amount]), [
    ['2026-08', 'facebook', 260], ['2026-08', 'instagram', 80], ['2026-09', 'facebook', 300], ['2026-09', 'instagram', 90], ['2026-10', 'facebook', 220], ['2026-10', 'instagram', 70]
  ]);
});

test('setAdSpend: adds, updates in place (the figure becomes the person\'s own), and 0 removes; one entry per month and channel', () => {
  const add = setAdSpend('2026-10', 'google', 120);
  assert.equal(add.ok, true);
  assert.match(add.entry.id, /^ad_[0-9a-z]{8}$/);
  assert.deepEqual([add.entry.month, add.entry.channel, add.entry.amount, 'seed' in add.entry], ['2026-10', 'google', 120, false]);
  assert.equal(spend().length, 7);
  assert.deepEqual(spend().map((e) => `${e.month} ${e.channel}`), ['2026-08 facebook', '2026-08 instagram', '2026-09 facebook', '2026-09 instagram', '2026-10 facebook', '2026-10 instagram', '2026-10 google'], 'sorted by month then channel order');
  const update = setAdSpend('2026-10', 'facebook', 400);
  assert.equal(update.entry.amount, 400);
  assert.equal(update.entry.id, 'ad_seed_2026-10_facebook', 'the same entry');
  assert.equal('seed' in update.entry, false, 'a typed figure is no longer demo data');
  assert.equal(spend().length, 7);
  const gone = setAdSpend('2026-10', 'google', 0);
  assert.deepEqual([gone.ok, gone.entry], [true, null]);
  assert.equal(spend().length, 6);
  assert.deepEqual(setAdSpend('2026-07', 'other', 0), { ok: true, entry: null }, 'removing what is not there is fine');
  assert.ok(add.undoToken && update.undoToken && gone.undoToken);
});

test('setAdSpend: validation, no-ops write nothing, undo restores', () => {
  const rev = getState().meta.rev;
  for (const [m, c, a] of [['2026-13', 'facebook', 1], ['26-10', 'facebook', 1], [undefined, 'facebook', 1], ['2026-10', 'tiktok', 1], ['2026-10', 'facebook', -1], ['2026-10', 'facebook', 1.5], ['2026-10', 'facebook', '100'], ['2026-10', 'facebook', 1000000]]) {
    const r = setAdSpend(m, c, a);
    assert.equal(r.reason, 'invalid', `${m} ${c} ${a}`);
    assert.ok(r.errors.month || r.errors.channel || r.errors.amount);
  }
  assert.equal(getState().meta.rev, rev);
  setAdSpend('2026-10', 'facebook', 400);
  let calls = 0;
  const off = subscribe(() => { calls += 1; });
  assert.equal(setAdSpend('2026-10', 'facebook', 400).ok, true, 'the same figure');
  off();
  assert.equal(calls, 0);
  const before = JSON.stringify(spend());
  const change = setAdSpend('2026-09', 'instagram', 500);
  assert.equal(undo(change.undoToken).ok, true);
  assert.equal(JSON.stringify(spend()), before);
  const add = setAdSpend('2026-06', 'google', 75);
  assert.equal(spend().length, 7);
  assert.equal(undo(add.undoToken).ok, true);
  assert.equal(spend().length, 6);
  assert.equal(undo(add.undoToken).reason, 'stale');
});

test('removeAdSpend: removes by id, undoable; unknown id is not_found; cost per lead follows', () => {
  const before = selectCostPerLead(getState(), '3m', NOW);
  assert.equal(before.spend, 1020);
  const gone = removeAdSpend('ad_seed_2026-09_facebook');
  assert.equal(gone.ok, true);
  assert.equal(spend().length, 5);
  assert.equal(selectCostPerLead(getState(), '3m', NOW).spend, 720);
  assert.equal(removeAdSpend('ad_seed_2026-09_facebook').reason, 'not_found');
  assert.equal(removeAdSpend('nope').reason, 'not_found');
  assert.equal(undo(gone.undoToken).ok, true);
  assert.equal(selectCostPerLead(getState(), '3m', NOW).spend, 1020);
  for (const e of [...spend()]) removeAdSpend(e.id);
  const none = selectCostPerLead(getState(), '3m', NOW);
  assert.deepEqual([none.spend, none.hasSpend, none.costPerEnquiry], [0, false, null], 'zero spend: an honest blank');
});

// ---------- photos ----------

test('addBookingPhotos: up to three JPEGs with ids, kept with the booking and in storage', () => {
  const made = createBooking(enquiry());
  const id = made.booking.id;
  const one = addBookingPhotos(id, [jpeg('a.jpg')]);
  assert.deepEqual([one.ok, one.added, one.dropped], [true, 1, 0]);
  assert.equal(one.booking.photos.length, 1);
  assert.match(one.booking.photos[0].id, /^ph_[0-9a-z]{8}$/);
  assert.deepEqual(Object.keys(one.booking.photos[0]).sort(), ['dataUrl', 'id', 'name']);
  assert.ok(one.undoToken);
  const more = addBookingPhotos(id, [jpeg('b.jpg'), jpeg('c.jpg'), jpeg('d.jpg')]);
  assert.deepEqual([more.ok, more.added, more.dropped], [true, 2, 1], 'the cap is three: two fit, one is dropped');
  assert.equal(selectBookingById(getState(), id).photos.length, PHOTO_LIMITS.maxPhotos);
  assert.equal(new Set(selectBookingById(getState(), id).photos.map((p) => p.id)).size, 3);
  assert.deepEqual(addBookingPhotos(id, [jpeg('e.jpg')]), { ok: false, reason: 'too_many', max: 3 });
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.state)).bookings.find((b) => b.id === id).photos.length, 3);
});

test('addBookingPhotos: invalid input is refused with a reason; only the valid ones of a mixed batch are kept; ids never collide', () => {
  const id = createBooking(enquiry()).booking.id;
  const rev = getState().meta.rev;
  assert.equal(addBookingPhotos('nope', [jpeg()]).reason, 'not_found');
  for (const bad of [undefined, null, [], 'photo', {}]) assert.equal(addBookingPhotos(id, bad).reason, 'invalid', JSON.stringify(bad));
  const png = addBookingPhotos(id, [{ name: 'x.png', dataUrl: 'data:image/png;base64,QUJD' }]);
  assert.equal(png.reason, 'invalid');
  assert.match(png.errors.photos, /JPEG/);
  const big = addBookingPhotos(id, [jpeg('big.jpg', 70001)]);
  assert.match(big.errors.photos, /too big/);
  assert.equal(getState().meta.rev, rev, 'nothing written');
  const mixed = addBookingPhotos(id, [{ name: 'x.png', dataUrl: 'data:image/png;base64,QUJD' }, jpeg('ok.jpg')]);
  assert.deepEqual([mixed.ok, mixed.added, mixed.dropped], [true, 1, 1]);
  const dup = addBookingPhotos(id, [{ ...jpeg('same-id.jpg'), id: mixed.booking.photos[0].id }]);
  assert.equal(dup.ok, true);
  assert.equal(new Set(dup.booking.photos.map((p) => p.id)).size, 2, 'a repeated id is replaced');
  const atLimit = addBookingPhotos(id, [jpeg('exact.jpg', 70000 - 'data:image/jpeg;base64,'.length)]);
  assert.equal(atLimit.ok, true, 'exactly 70,000 characters is allowed');
});

test('removeBookingPhoto: removes one; the key goes away with the last; undoable', () => {
  const id = createBooking(enquiry()).booking.id;
  const added = addBookingPhotos(id, [jpeg('a.jpg'), jpeg('b.jpg')]);
  const [a, b] = added.booking.photos;
  const first = removeBookingPhoto(id, a.id);
  assert.equal(first.ok, true);
  assert.deepEqual(first.booking.photos.map((p) => p.id), [b.id]);
  const last = removeBookingPhoto(id, b.id);
  assert.equal('photos' in last.booking, false);
  assert.equal(removeBookingPhoto(id, b.id).reason, 'not_found');
  assert.equal(removeBookingPhoto('nope', b.id).reason, 'not_found');
  assert.equal(undo(last.undoToken).ok, true);
  assert.equal(selectBookingById(getState(), id).photos.length, 1);
});

test('createBooking accepts photos like addBookingPhotos but never refuses an enquiry because of them', () => {
  const ok = createBooking(enquiry({ photos: [jpeg('a.jpg'), jpeg('b.jpg')] }));
  assert.equal(ok.ok, true);
  assert.equal(ok.booking.photos.length, 2);
  assert.equal(ok.photosDropped, 0);
  const messy = createBooking(enquiry({ customer: { name: 'Maeve Corr', phone: '07700 900501' }, photos: [jpeg('a.jpg'), { name: 'x', dataUrl: 'data:image/gif;base64,QUJD' }, jpeg('b.jpg'), jpeg('c.jpg'), jpeg('d.jpg')] }));
  assert.equal(messy.ok, true);
  assert.deepEqual(messy.booking.photos.map((p) => p.name), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(messy.photosDropped, 2);
  const none = createBooking(enquiry({ customer: { name: 'Joanne Moore', phone: '07700 900503' } }));
  assert.equal('photosDropped' in none, false, 'no photos in the draft, no photosDropped in the result');
  assert.equal('photos' in none.booking, false);
  const junk = createBooking(enquiry({ customer: { name: 'Owen Mulholland', phone: '07700 900506' }, photos: 'not a list' }));
  assert.equal(junk.ok, true);
  assert.equal(junk.photosDropped, 0);
  assert.equal('photos' in junk.booking, false);
});

// ---------- utm on createBooking ----------

test('createBooking stores utm normalised on the booking and ignores junk without an error', () => {
  const fb = createBooking(enquiry({ utm: { source: 'Facebook', medium: 'paid_social', campaign: 'autumn' } }));
  assert.deepEqual(fb.booking.utm, { source: 'facebook', medium: 'paid_social', campaign: 'autumn' });
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.state)).bookings.find((b) => b.id === fb.booking.id).utm, fb.booking.utm);
  const other = createBooking(enquiry({ customer: { name: 'Maeve Corr', phone: '07700 900501' }, utm: { source: 'tiktok', medium: '<b>x</b>' } }));
  assert.deepEqual(other.booking.utm, { source: 'other', medium: 'bx/b', campaign: '' });
  for (const [i, utm] of [null, undefined, 'facebook', 5, [], {}, { source: '' }].entries()) {
    const r = createBooking(enquiry({ customer: { name: 'Person Number', phone: `07700 90060${i}` }, utm }));
    assert.equal(r.ok, true, JSON.stringify(utm));
    assert.equal('utm' in r.booking, false, JSON.stringify(utm));
  }
});

test('simulateIncomingBooking rotates the lead source so a demo run shows up in Lead sources', () => {
  const sources = [];
  for (let i = 0; i < 5; i += 1) sources.push(simulateIncomingBooking().booking.utm.source);
  assert.deepEqual(sources, ['facebook', 'facebook', 'instagram', 'google', 'facebook']);
  assert.equal(simulateIncomingBooking().booking.utm.source, 'facebook', 'and it cycles');
});

// ---------- settings ----------

test('updateSettings: business address, images, reply promise, quote defaults', () => {
  const r = updateSettings({
    business: { address: '  12 Sample Street, Belfast  ', images: { hero: ' img/180/hero.jpg ', work1: 'https://cdn.example.com/w1.jpg' } },
    sla: { replyHours: 12 },
    quoteDefaults: { validDays: 14, notes: '  Our terms.  ' }
  });
  assert.equal(r.ok, true);
  const s = getState().settings;
  assert.equal(s.business.address, '12 Sample Street, Belfast');
  assert.equal(s.business.images.hero, 'img/180/hero.jpg');
  assert.equal(s.business.images.work1, 'https://cdn.example.com/w1.jpg');
  assert.equal(s.business.images.logo, DEFAULT_IMAGES.logo, 'the other keys are untouched');
  assert.deepEqual(s.sla, { replyHours: 12 });
  assert.deepEqual(s.quoteDefaults, { validDays: 14, notes: 'Our terms.' });
  assert.equal(selectBrand(getState()).address, '12 Sample Street, Belfast');
  assert.equal(selectImageUrl(getState(), 'hero', { width: 1080 }), 'img/180/hero.jpg');
  // a new quote picks the new defaults up
  const q = createQuote({ bookingId: 'bk_seed_16' }).quote;
  assert.equal(q.notes, 'Our terms.');
  assert.equal(q.validUntil, '2026-11-06');
  // an empty image resets it to his default
  assert.equal(updateSettings({ business: { images: { hero: '' } } }).ok, true);
  assert.equal(getState().settings.business.images.hero, DEFAULT_IMAGES.hero);
  assert.equal(updateSettings({ business: { address: '' } }).ok, true);
  assert.equal(getState().settings.business.address, '');
});

test('updateSettings: validation of the v3 fields is atomic with plain messages', () => {
  const before = JSON.stringify(getState().settings);
  const bad = (patch) => updateSettings(patch);
  assert.ok(bad({ business: { address: 'x'.repeat(201) } }).errors.address);
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://insecure.example/a.jpg', '//evil.example/a.jpg', 'ftp://x/y.jpg', 'file:///etc/passwd', 'C:\\pics\\a.jpg', 'has space.jpg', `https://x.example/${'a'.repeat(600)}`]) {
    const r = bad({ business: { images: { hero: url } } });
    assert.equal(r.reason, 'invalid', url);
    assert.match(r.errors['images.hero'], /https:\/\/ or a file path/, url);
  }
  assert.equal(bad({ business: { images: { notakey: 'img/a.jpg' } } }).ok, true, 'an unknown image key is ignored');
  assert.equal(getState().settings.business.images.notakey, undefined);
  for (const hours of [0, 169, 1.5, '24', null, -1]) assert.ok(bad({ sla: { replyHours: hours } }).errors.replyHours, String(hours));
  for (const days of [0, 366, 2.5, '30']) assert.ok(bad({ quoteDefaults: { validDays: days } }).errors.validDays, String(days));
  assert.ok(bad({ quoteDefaults: { notes: 'n'.repeat(1501) } }).errors.notes);
  // one bad field stops the whole patch
  const mixed = bad({ business: { tagline: 'Changed' }, sla: { replyHours: 0 } });
  assert.equal(mixed.reason, 'invalid');
  assert.equal(JSON.stringify(getState().settings), before.replace('"images":{"logo"', '"images":{"logo"'), 'nothing changed');
  assert.equal(getState().settings.business.tagline, 'Home EV charger installation across Northern Ireland.');
});

test('updateSettings: the quote catalogue is replaced as a whole, validated, with generated ids', () => {
  const items = getState().settings.quoteItems.map((i) => (i.id === 'circuit' ? { ...i, unitPrice: 200 } : i));
  items.push({ label: 'Smart meter link', unitPrice: 60 });
  const r = updateSettings({ quoteItems: items });
  assert.equal(r.ok, true);
  const saved = getState().settings.quoteItems;
  assert.equal(saved.length, 11);
  assert.equal(saved.find((i) => i.id === 'circuit').unitPrice, 200);
  assert.match(saved.at(-1).id, /^item_[0-9a-z]{8}$/);
  assert.equal(createQuote({ bookingId: 'bk_seed_16' }).quote.lines.find((l) => l.label.startsWith('Dedicated')).unitPrice, 200);
  const bad = updateSettings({ quoteItems: [{ label: '', unitPrice: 1 }] });
  assert.equal(bad.reason, 'invalid');
  assert.match(bad.errors.quoteItems, /needs a description/);
  assert.equal(getState().settings.quoteItems.length, 11);
  assert.equal(updateSettings({ quoteItems: 'nope' }).reason, 'invalid');
});

test('the charger lines of the catalogue follow business.brands: a new brand is added at a sample price, a removed one goes', () => {
  assert.deepEqual(getState().settings.quoteItems.filter((i) => i.kind === 'charger').map((i) => i.brand), ['ZAPPI', 'OHME', 'SYNC']);
  assert.equal(updateSettings({ business: { brands: ['ZAPPI', 'KEBA'] } }).ok, true);
  const chargers = getState().settings.quoteItems.filter((i) => i.kind === 'charger');
  assert.deepEqual(chargers.map((i) => [i.brand, i.label, i.unitPrice]), [['ZAPPI', 'Supply of ZAPPI home charger', 799], ['KEBA', 'Supply of KEBA home charger', 700]]);
  assert.equal(getState().settings.quoteItems[0].brand, 'ZAPPI', 'chargers stay first, in brand order');
  assert.equal(getState().settings.quoteItems.filter((i) => i.kind !== 'charger').length, 7, 'the other lines are untouched');
  // a price the owner set survives a re-save of the brands
  updateSettings({ quoteItems: getState().settings.quoteItems.map((i) => (i.id === 'charger_keba' ? { ...i, unitPrice: 650 } : i)) });
  updateSettings({ business: { brands: ['KEBA', 'ZAPPI'] } });
  assert.deepEqual(getState().settings.quoteItems.filter((i) => i.kind === 'charger').map((i) => [i.brand, i.unitPrice]), [['KEBA', 650], ['ZAPPI', 799]]);
  assert.equal(updateSettings({ business: { brands: [] } }).ok, true);
  assert.equal(getState().settings.quoteItems.filter((i) => i.kind === 'charger').length, 0);
  assert.equal(createQuote({ bookingId: 'bk_seed_16' }).quote.lines.length, 3, 'a quote with no brands has no charger line');
});

// ---------- the day rollover ----------

test('a new day swaps the seed quotes and ad spend for fresh ones and keeps what a person made', () => {
  const mine = createQuote({ bookingId: 'bk_seed_16', lines: [{ label: 'My own line', qty: 1, unitPrice: 900 }] }).quote;
  const edited = store.updateQuote(Object.values(getState().quotes).find((q) => q.seed && q.status === 'draft').id, { notes: 'edited by me' }).quote;
  setAdSpend('2026-10', 'google', 150);
  setAdSpend('2026-09', 'facebook', 555);
  const seedQuoteIds = Object.values(getState().quotes).filter((q) => q.seed).map((q) => q.id);
  assert.equal(seedQuoteIds.length, 16, 'one demo quote is the person\'s own now (edited), and one more is new');
  setClock(new Date(2026, 9, 24, 7, 30));
  const state = initStore({ storage, force: true });
  assert.equal(state.seededFor, '2026-10-24');
  assert.equal(Object.keys(state.quotes).length, 17 + 1, 'the 17 seed quotes (one of them the person\'s edited version) and the person\'s own');
  assert.deepEqual(state.quotes[mine.id], mine, 'a quote the person made is kept exactly');
  assert.equal(state.quotes[edited.id].notes, 'edited by me', 'an edited demo quote keeps the edit and is not duplicated');
  assert.equal(state.quotes[edited.id].seed, false);
  assert.equal(Object.values(state.quotes).filter((q) => q.seed).length, 16, 'every other demo quote is fresh');
  const ad = state.settings.marketing.adSpend;
  assert.equal(ad.find((e) => e.month === '2026-09' && e.channel === 'facebook').amount, 555, 'his own figure wins over the demo one');
  assert.ok(ad.some((e) => e.month === '2026-10' && e.channel === 'google' && e.amount === 150));
  assert.equal(ad.filter((e) => e.month === '2026-09' && e.channel === 'facebook').length, 1, 'no duplicate for the same month and channel');
  assert.equal(new Set(ad.map((e) => `${e.month}|${e.channel}`)).size, ad.length);
  assert.equal(ad.filter((e) => e.seed).length, 5, 'the other five demo figures are re-seeded');
});

test('the rollover re-imports the Google Calendar busy blocks for the new day', () => {
  connectGoogle('calendar', { account: 'daniel@gmail.example' });
  const before = getState().blocks.filter((b) => b.groupId === 'grp_gcal_sim').map((b) => b.date);
  setClock(new Date(2026, 10, 2, 7, 30));
  const state = initStore({ storage, force: true });
  const after = state.blocks.filter((b) => b.groupId === 'grp_gcal_sim');
  assert.ok(after.length >= 3);
  assert.ok(after.every((b) => b.date > '2026-11-02'), 'relative to the new today');
  assert.notDeepEqual(after.map((b) => b.date), before);
  assert.equal(new Set(after.map((b) => `${b.date}|${b.windowId}`)).size, after.length);
  // disconnected: none come back
  store.disconnect('calendar');
  setClock(new Date(2026, 10, 3, 7, 30));
  assert.equal(initStore({ storage, force: true }).blocks.filter((b) => b.groupId === 'grp_gcal_sim').length, 0);
});

// ---------- reset ----------

test('resetDemo restores the seed quotes and ad spend; keepSettings keeps connections, branding and the figures a person typed', () => {
  const q = createQuote({ bookingId: 'bk_seed_16' }).quote;
  store.sendQuote(q.id, { via: 'link' });
  store.updateQuote(Object.values(getState().quotes).find((x) => x.seed && x.status === 'draft').id, { notes: 'changed' });
  setAdSpend('2026-10', 'google', 150);
  setAdSpend('2026-09', 'facebook', 555);
  setConnection('tracking', { metaPixelId: '1234567890' });
  connectGoogle('calendar', { account: 'daniel@gmail.example' });
  updateSettings({ business: { name: 'Ashby Sparks' }, sla: { replyHours: 12 } });
  assert.equal(resetDemo().ok, true);
  const s = getState();
  assert.equal(Object.keys(s.quotes).length, 17, 'back to the seed quotes: the quote he wrote is gone');
  assert.ok(Object.values(s.quotes).every((x) => x.seed));
  assert.equal(selectQuote(s, q.id), selectQuote(s, q.id), 'no throw');
  assert.equal(s.settings.business.name, 'Ashby Sparks');
  assert.equal(s.settings.sla.replyHours, 12);
  assert.equal(s.settings.connections.tracking.metaPixelId, '1234567890', 'connections are settings');
  assert.equal(s.settings.connections.calendar.status, 'connected');
  assert.ok(s.blocks.filter((b) => b.groupId === 'grp_gcal_sim').length >= 3, 'the busy blocks are imported again');
  assert.equal(s.settings.marketing.adSpend.find((e) => e.month === '2026-09' && e.channel === 'facebook').amount, 555);
  assert.ok(s.settings.marketing.adSpend.some((e) => e.channel === 'google' && e.amount === 150));
  assert.equal(s.settings.marketing.adSpend.filter((e) => e.seed).length, 5);
  // the hard reset goes back to every default
  assert.equal(resetDemo({ keepSettings: false }).ok, true);
  const hard = getState();
  assert.equal(hard.settings.business.name, '180 Electrical');
  assert.equal(hard.settings.connections.tracking.metaPixelId, '');
  assert.equal(hard.settings.connections.calendar.status, 'disconnected');
  assert.equal(hard.blocks.filter((b) => b.groupId === 'grp_gcal_sim').length, 0);
  assert.deepEqual(hard.settings.marketing.adSpend.map((e) => e.seed), [true, true, true, true, true, true]);
  assert.equal(hard.settings.sla.replyHours, 24);
});

// ---------- the new quick message ----------

test('the photos request is a quick message to the customer and counts as the reply', () => {
  const sent = sendQuickMessage('bk_seed_11', 'customer_photos_request');
  assert.equal(sent.ok, true);
  assert.deepEqual([sent.message.kind, sent.message.to, sent.message.bookingId, sent.message.channel], ['customer_photos_request', 'customer', 'bk_seed_11', 'whatsapp']);
  assert.ok(sent.message.body.includes("could you send a photo of your consumer unit and where you'd like the charger?"));
  assert.equal(selectBookingById(getState(), 'bk_seed_11').history.at(-1).note, 'Photos request');
  assert.equal(store.sendQuickMessage('bk_seed_11', 'customer_quote_sent').reason, 'invalid', 'only the quick kinds');
  assert.equal(store.sendQuickMessage('bk_seed_11', 'owner_test_event').reason, 'invalid');
});

// ---------- the quota guard ----------

test('a quota error on any v3 write is storage_full and changes nothing', () => {
  const flaky = memStorage();
  const original = flaky.setItem;
  let full = false;
  flaky.setItem = (k, v) => {
    if (full && k === STORAGE_KEYS.state) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    original(k, v);
  };
  initStore({ storage: flaky, force: true });
  const before = getState();
  full = true;
  const attempts = [
    () => createQuote({ bookingId: 'bk_seed_16' }), () => setAdSpend('2026-10', 'google', 1), () => setConnection('tracking', { metaPixelId: '1234567890' }),
    () => store.connectWhatsApp({ number: '07885 496800', code: '482913' }), () => store.startDomainSetup('www.example.org'), () => addBookingPhotos('bk_seed_16', [jpeg()]),
    () => store.sendTestEvent('webhook'), () => store.rotateWebhookSecret()
  ];
  for (const attempt of attempts) assert.deepEqual(attempt(), { ok: false, reason: 'storage_full' });
  assert.equal(getState(), before);
  assert.equal(getState().meta.rev, before.meta.rev);
  full = false;
  assert.equal(createQuote({ bookingId: 'bk_seed_16' }).ok, true);
  assert.equal(NOW, '2026-10-23T20:30');
});
