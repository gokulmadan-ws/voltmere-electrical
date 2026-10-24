// tests/unit/utm.test.mjs: unit tests for js/core/utm.js (lead source capture for the session)
// Owner: A3 core
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_SOURCES, STORAGE_KEYS } from '../../js/core/config.js';
import { captureUtm, clearUtm, getUtm, normaliseLeadSource, normaliseUtm } from '../../js/core/utm.js';

function memStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

beforeEach(() => clearUtm());

test('normaliseLeadSource: facebook/fb, instagram/ig, google, referral, phone, else other', () => {
  for (const v of ['facebook', 'FB', ' Fb ', 'meta', 'facebook.com', 'm.facebook.com', 'l.facebook.com']) assert.equal(normaliseLeadSource(v), 'facebook', v);
  for (const v of ['instagram', 'IG', 'instagram.com']) assert.equal(normaliseLeadSource(v), 'instagram', v);
  for (const v of ['google', 'googleads', 'google-ads', 'AdWords']) assert.equal(normaliseLeadSource(v), 'google', v);
  for (const v of ['referral', 'ref', 'friend']) assert.equal(normaliseLeadSource(v), 'referral', v);
  assert.equal(normaliseLeadSource('phone'), 'phone');
  for (const v of ['tiktok', '', '   ', null, undefined, 42, 'facebook ads']) assert.equal(normaliseLeadSource(v), 'other', String(v));
  for (const v of ['fb', 'ig', 'google', 'ref', 'phone', 'x']) assert.ok(LEAD_SOURCES.includes(normaliseLeadSource(v)));
});

test('normaliseUtm: a clean { source, medium, campaign } or null, with junk dropped and never an error', () => {
  assert.deepEqual(normaliseUtm({ source: 'fb', medium: 'paid_social', campaign: 'ev_leads' }), { source: 'facebook', medium: 'paid_social', campaign: 'ev_leads' });
  assert.deepEqual(normaliseUtm({ source: 'tiktok' }), { source: 'other', medium: '', campaign: '' });
  assert.deepEqual(normaliseUtm({ medium: 'email' }), { source: 'other', medium: 'email', campaign: '' }, 'a medium alone is still something');
  assert.deepEqual(normaliseUtm({ source: 'ig', campaign: '<script>alert(1)</script>  spring  sale' }), { source: 'instagram', medium: '', campaign: 'scriptalert1/script spring sale' });
  assert.equal(normaliseUtm({ campaign: 'x'.repeat(200) }).campaign.length, 60);
  for (const v of [null, undefined, 'facebook', 5, [], {}, { source: '', medium: '', campaign: '' }, { other: 1 }]) assert.equal(normaliseUtm(v), null, JSON.stringify(v));
});

test('captureUtm reads utm_source, utm_medium and utm_campaign, normalises the source and keeps them for the session', () => {
  const storage = memStorage();
  const got = captureUtm('?utm_source=Facebook&utm_medium=paid_social&utm_campaign=autumn_ev', { storage });
  assert.deepEqual(got, { source: 'facebook', medium: 'paid_social', campaign: 'autumn_ev' });
  assert.deepEqual(JSON.parse(storage.map.get(STORAGE_KEYS.utm)), got, 'stored in the session storage under vm_utm');
  assert.deepEqual(getUtm({ storage }), got);
  assert.equal(STORAGE_KEYS.utm, 'vm_utm');
});

test('?src= is an alias for utm_source, and utm_source wins when both are given', () => {
  assert.deepEqual(captureUtm('?src=ig', { storage: memStorage() }), { source: 'instagram', medium: '', campaign: '' });
  clearUtm();
  assert.deepEqual(captureUtm('?src=ig&utm_source=google', { storage: memStorage() }).source, 'google');
});

test('an existing capture is never overwritten in the same session (the first touch wins)', () => {
  const storage = memStorage();
  captureUtm('?utm_source=facebook&utm_campaign=first', { storage });
  const again = captureUtm('?utm_source=google&utm_campaign=second', { storage });
  assert.deepEqual(again, { source: 'facebook', medium: '', campaign: 'first' });
  assert.deepEqual(getUtm({ storage }), again);
});

test('no utm parameters: nothing is stored and getUtm is null; unrelated parameters are ignored', () => {
  const storage = memStorage();
  assert.equal(captureUtm('', { storage }), null);
  assert.equal(captureUtm('?now=2026-10-23T20:30&freeze=1', { storage }), null);
  assert.equal(getUtm({ storage }), null);
  assert.equal(storage.map.size, 0);
  assert.equal(captureUtm('?utm_source=', { storage }), null, 'an empty source is nothing');
});

test('works with sessionStorage missing or throwing: a memory fallback keeps the capture for the page', () => {
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('x'); } };
  assert.deepEqual(captureUtm('?utm_source=fb', { storage: broken }), { source: 'facebook', medium: '', campaign: '' });
  assert.deepEqual(getUtm({ storage: broken }), { source: 'facebook', medium: '', campaign: '' }, 'from memory');
  clearUtm({ storage: broken });
  assert.equal(getUtm({ storage: broken }), null);
  // no storage object at all (Node): the default path is the memory fallback
  assert.equal(typeof sessionStorage, 'undefined');
  assert.deepEqual(captureUtm('?utm_source=google&utm_medium=cpc'), { source: 'google', medium: 'cpc', campaign: '' });
  assert.deepEqual(getUtm(), { source: 'google', medium: 'cpc', campaign: '' });
});

test('a garbage value in sessionStorage is ignored rather than trusted', () => {
  const storage = memStorage();
  storage.map.set(STORAGE_KEYS.utm, '{not json');
  assert.equal(getUtm({ storage }), null);
  storage.map.set(STORAGE_KEYS.utm, JSON.stringify({ source: 'facebook', medium: 'x'.repeat(500) }));
  assert.equal(getUtm({ storage }).medium.length, 60, 'read back through the same cleaning');
});
