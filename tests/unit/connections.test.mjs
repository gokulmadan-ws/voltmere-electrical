// tests/unit/connections.test.mjs: unit tests for js/core/connections.js (hostnames, DNS records, patches, settling, hub summary, busy blocks)
// Owner: A3 core
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTION_KEYS, CONNECTION_LABELS, DOMAIN_TARGETS, DOMAIN_VERIFY_SECONDS, TEMPLATE_APPROVAL_SECONDS, WHATSAPP_DEMO_CODE, WHATSAPP_TEMPLATE_KINDS,
  TEMPLATE_KINDS, makeDefaultConnections, makeDefaultSettings
} from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import {
  GCAL_GROUP_ID, GCAL_LABEL, domainRecords, isValidEmail, normaliseWhatsAppNumber, settleConnectionsIn, simulatedBusyBlocks, summariseConnections,
  validateConnectionPatch, validateHostname, webhookSamplePayload
} from '../../js/core/connections.js';
import { buildSeed } from '../../js/core/seed.js';
import { now } from '../../js/core/clock.js';

beforeEach(() => setClock(new Date(2026, 9, 23, 20, 30)));
afterEach(() => setClock(null));

test('defaults: only the webhook is on; the fictional targets use documentation ranges and the .example TLD', () => {
  const c = makeDefaultConnections();
  assert.deepEqual(Object.keys(c), ['domain', 'whatsapp', 'calendar', 'email', 'webhook', 'tracking']);
  assert.deepEqual(c.domain, { status: 'none', domain: '', checks: 0, verifiedAt: null, firstCheckAt: null });
  assert.equal(c.whatsapp.status, 'disconnected');
  assert.equal(c.whatsapp.number, '+447885496800');
  assert.equal(c.whatsapp.displayName, '180 Electrical');
  assert.deepEqual(c.whatsapp.quietHours, { on: true, from: '21:00', to: '08:00' });
  assert.equal(c.whatsapp.ownerAlerts, true);
  assert.equal(c.whatsapp.customerUpdates, true);
  assert.deepEqual(Object.keys(c.whatsapp.templates), WHATSAPP_TEMPLATE_KINDS);
  assert.ok(Object.values(c.whatsapp.templates).every((s) => s === 'none'));
  assert.deepEqual(c.calendar, { status: 'disconnected', account: '', calendarName: '180 Electrical jobs', twoWay: true, addJobs: true, connectedAt: null });
  assert.deepEqual(c.email, { status: 'disconnected', account: '', sendFrom: 'daniel@180electrical.co.uk', confirmations: true, quotes: true, connectedAt: null });
  assert.equal(c.webhook.enabled, true);
  assert.equal(c.webhook.lastEventAt, null);
  assert.match(c.webhook.url, /^https:\/\/hooks\.example\/180\/enq_[0-9a-f]{8}$/);
  assert.match(c.webhook.secret, /^whsec_[0-9a-z]{24}$/);
  assert.deepEqual(c.tracking, { metaPixelId: '', googleTagId: '', consentNote: true });
  assert.deepEqual(DOMAIN_TARGETS, { cname: 'sites.example', a: '192.0.2.10' });
  assert.equal(WHATSAPP_DEMO_CODE, '482913');
  assert.equal(DOMAIN_VERIFY_SECONDS, 20);
  assert.ok(TEMPLATE_APPROVAL_SECONDS > 0 && TEMPLATE_APPROVAL_SECONDS <= 10);
  assert.deepEqual(makeDefaultConnections(), c, 'deterministic');
  assert.notEqual(makeDefaultConnections().whatsapp.templates, c.whatsapp.templates, 'a fresh copy');
  assert.deepEqual(WHATSAPP_TEMPLATE_KINDS, TEMPLATE_KINDS.filter((k) => k !== 'owner_test_event'));
  assert.deepEqual(CONNECTION_KEYS, ['domain', 'webhook', 'tracking', 'whatsapp', 'calendar', 'email']);
  assert.deepEqual(Object.keys(CONNECTION_LABELS), CONNECTION_KEYS);
});

test('validateHostname: bare hostnames only; protocol, path, port and trailing dot are cleaned or refused', () => {
  const ok = (v) => validateHostname(v);
  assert.deepEqual(ok('www.180electrical.co.uk'), { ok: true, host: 'www.180electrical.co.uk', message: '' });
  assert.equal(ok('  WWW.180Electrical.CO.UK ').host, 'www.180electrical.co.uk');
  assert.equal(ok('https://www.180electrical.co.uk/quote?x=1#top').host, 'www.180electrical.co.uk');
  assert.equal(ok('http://180electrical.co.uk/').host, '180electrical.co.uk');
  assert.equal(ok('180electrical.co.uk.').host, '180electrical.co.uk');
  assert.equal(ok('a-b.example').host, 'a-b.example');
  for (const bad of ['', '   ', 'localhost', 'foo', 'foo.', '.com', 'a..com', '-a.com', 'a-.com', 'a b.com', 'a_b.com', 'foo.c', 'foo.123', 'foo.co.uk:8080', 'me@foo.com', '192.168.0.1', `${'a'.repeat(64)}.com`, `${'a.'.repeat(130)}com`, null, undefined, 42]) {
    const r = ok(bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.host, '');
    assert.equal(r.message, 'Enter a website address like www.180electrical.co.uk');
  }
});

test('domainRecords: a subdomain gets one CNAME, a bare domain an A record and a www CNAME (UK two-level suffixes understood)', () => {
  assert.deepEqual(domainRecords('www.180electrical.co.uk'), [{ type: 'CNAME', host: 'www', value: 'sites.example', ttl: 3600 }]);
  assert.deepEqual(domainRecords('180electrical.co.uk'), [{ type: 'A', host: '@', value: '192.0.2.10', ttl: 3600 }, { type: 'CNAME', host: 'www', value: 'sites.example', ttl: 3600 }]);
  assert.deepEqual(domainRecords('180electrical.com').map((r) => r.type), ['A', 'CNAME']);
  assert.deepEqual(domainRecords('book.180electrical.com'), [{ type: 'CNAME', host: 'book', value: 'sites.example', ttl: 3600 }]);
  assert.equal(domainRecords('quotes.ev.180electrical.com')[0].host, 'quotes.ev');
  assert.deepEqual(domainRecords('https://WWW.example.org/path').map((r) => r.host), ['www']);
  assert.deepEqual(domainRecords('not a domain'), []);
  assert.ok(domainRecords('180electrical.co.uk').every((r) => r.value === '192.0.2.10' || r.value === 'sites.example'), 'only the fictional targets');
});

test('isValidEmail and normaliseWhatsAppNumber', () => {
  for (const v of ['daniel@gmail.com', 'a.b+c@sub.example.co.uk', ' daniel@180electrical.co.uk ']) assert.equal(isValidEmail(v), true, v);
  for (const v of ['', 'daniel', 'daniel@', '@gmail.com', 'dan iel@gmail.com', 'daniel@gmail', 'a@b.c', null, undefined, `${'a'.repeat(120)}@x.com`]) assert.equal(isValidEmail(v), false, String(v));
  assert.equal(normaliseWhatsAppNumber('07885 496800'), '+447885496800');
  assert.equal(normaliseWhatsAppNumber('+44 7885 496800'), '+447885496800');
  assert.equal(normaliseWhatsAppNumber('00447885496800'), '+447885496800');
  assert.equal(normaliseWhatsAppNumber('+353 85 123 4567'), '+353851234567', 'an international number');
  assert.equal(normaliseWhatsAppNumber('+1 (415) 555-2671'), '+14155552671');
  for (const v of ['', '0788', 'abc', '07885 49680x', '12345678', '+123', '+1234567890123456', null]) assert.equal(normaliseWhatsAppNumber(v), '', String(v));
});

test('validateConnectionPatch: only the allowed fields, validated, anything else ignored', () => {
  const c = makeDefaultConnections();
  const v = (key, patch, current = c[key]) => validateConnectionPatch(key, patch, current);
  assert.deepEqual(v('whatsapp', { displayName: '  Daniel at 180  ', ownerAlerts: false, customerUpdates: false, quietHours: { on: false, from: '22:00', to: '07:30' }, number: '07885 496800' }), {
    errors: {}, changes: { displayName: 'Daniel at 180', ownerAlerts: false, customerUpdates: false, quietHours: { on: false, from: '22:00', to: '07:30' }, number: '+447885496800' }
  });
  assert.deepEqual(v('whatsapp', { templates: { x: 'approved' }, connectedAt: 'x', status: 'connected', secret: 'x' }).changes, {}, 'protected fields are ignored');
  assert.match(v('whatsapp', { status: 'connected' }).errors.status, /connect steps/);
  assert.deepEqual(v('whatsapp', { displayName: '' }).errors, { displayName: 'Enter a name up to 40 characters.' });
  assert.ok(v('whatsapp', { displayName: 'x'.repeat(41) }).errors.displayName);
  assert.ok(v('whatsapp', { ownerAlerts: 'yes' }).errors.ownerAlerts);
  assert.ok(v('whatsapp', { quietHours: { on: true, from: '25:00', to: '08:00' } }).errors.quietHours);
  assert.ok(v('whatsapp', { quietHours: { on: 'yes', from: '21:00', to: '08:00' } }).errors.quietHours);
  assert.ok(v('whatsapp', { quietHours: null }).errors.quietHours);
  assert.ok(v('whatsapp', { number: 'banana' }).errors.number);
  // the verification states
  assert.deepEqual(v('whatsapp', { status: 'verifying' }).changes, { status: 'verifying' }, 'a number is already there');
  assert.ok(v('whatsapp', { status: 'verifying', number: 'x' }).errors.number);
  assert.ok(v('whatsapp', { status: 'verifying' }, { ...c.whatsapp, status: 'connected' }).errors.status, 'disconnect first');
  assert.deepEqual(v('whatsapp', { status: 'disconnected' }, { ...c.whatsapp, status: 'verifying' }).changes, { status: 'disconnected' });
  assert.ok(v('whatsapp', { status: 'disconnected' }, { ...c.whatsapp, status: 'connected' }).errors.status, 'a connected number is removed with disconnect()');
  // calendar, email, webhook, tracking
  assert.deepEqual(v('calendar', { calendarName: ' Jobs ', twoWay: false, addJobs: false, account: 'x@y.com', status: 'connected' }).changes, { calendarName: 'Jobs', twoWay: false, addJobs: false });
  assert.ok(v('calendar', { calendarName: '' }).errors.calendarName);
  assert.ok(v('calendar', { twoWay: 1 }).errors.twoWay);
  assert.deepEqual(v('email', { sendFrom: 'hello@180electrical.co.uk', confirmations: false, quotes: false }).changes, { sendFrom: 'hello@180electrical.co.uk', confirmations: false, quotes: false });
  assert.ok(v('email', { sendFrom: 'nope' }).errors.sendFrom);
  assert.deepEqual(v('webhook', { enabled: false, url: 'https://evil.example', secret: 'x' }).changes, { enabled: false }, 'the url and secret are not patchable');
  assert.ok(v('webhook', { enabled: 'no' }).errors.enabled);
  assert.deepEqual(v('tracking', { metaPixelId: '1234567890', googleTagId: 'g-abcd1234', consentNote: false }).changes, { metaPixelId: '1234567890', googleTagId: 'G-ABCD1234', consentNote: false });
  assert.deepEqual(v('tracking', { metaPixelId: '', googleTagId: '' }).changes, { metaPixelId: '', googleTagId: '' }, 'clearing is allowed');
  for (const id of ['GTM-ABCD12', 'AW-123456789', 'GT-ABCD1234']) assert.deepEqual(v('tracking', { googleTagId: id }).errors, {}, id);
  for (const id of ['123', 'ABCD1234', 'G-AB', 'UA-12345-1']) assert.ok(v('tracking', { googleTagId: id }).errors.googleTagId, id);
  for (const id of ['1234567', '123456789012345678901', 'abc12345678']) assert.ok(v('tracking', { metaPixelId: id }).errors.metaPixelId, id);
  assert.deepEqual(v('domain', { domain: 'x.com', status: 'live' }).changes, {}, 'the domain is only changed by its own functions');
  assert.deepEqual(v('whatsapp', null), { errors: {}, changes: {} });
});

test('settleConnectionsIn: templates approve after the delay, a verifying domain goes live after 20 s, nothing else changes', () => {
  const base = makeDefaultConnections();
  assert.equal(settleConnectionsIn(base, '2026-10-23T20:30:00'), base, 'nothing due: the same object back');
  const submitted = { ...base, whatsapp: { ...base.whatsapp, status: 'connected', templatesSubmittedAt: '2026-10-23T20:30:00', templates: { ...base.whatsapp.templates, customer_confirmed: 'pending', customer_reminder: 'pending', owner_new_booking: 'approved' } } };
  assert.equal(settleConnectionsIn(submitted, '2026-10-23T20:30:05'), submitted, 'one second short');
  const settled = settleConnectionsIn(submitted, `2026-10-23T20:30:0${TEMPLATE_APPROVAL_SECONDS}`);
  assert.notEqual(settled, submitted);
  assert.equal(settled.whatsapp.templates.customer_confirmed, 'approved');
  assert.equal(settled.whatsapp.templates.customer_reminder, 'approved');
  assert.equal(settled.whatsapp.templates.owner_new_booking, 'approved');
  assert.equal(settled.whatsapp.templates.customer_received, 'none', 'templates that were never submitted stay none');
  assert.equal(submitted.whatsapp.templates.customer_confirmed, 'pending', 'the input is not mutated');
  assert.equal(settled.domain, submitted.domain);
  // a real-time timer may complete the templates early
  assert.equal(settleConnectionsIn(submitted, '2026-10-23T20:30:01', { force: ['templates'] }).whatsapp.templates.customer_confirmed, 'approved');
  assert.equal(settleConnectionsIn(submitted, '2026-10-23T20:30:01', { force: ['domain'] }), submitted, 'forcing the domain does not touch templates');
  // the domain
  const verifying = { ...base, domain: { status: 'verifying', domain: 'www.180electrical.co.uk', checks: 1, verifiedAt: null, firstCheckAt: '2026-10-23T20:30:00' } };
  assert.equal(settleConnectionsIn(verifying, '2026-10-23T20:30:19'), verifying);
  const live = settleConnectionsIn(verifying, '2026-10-23T20:30:20');
  assert.deepEqual(live.domain, { status: 'live', domain: 'www.180electrical.co.uk', checks: 1, verifiedAt: '2026-10-23T20:30', firstCheckAt: '2026-10-23T20:30:00' });
  assert.equal(settleConnectionsIn(verifying, '2026-10-23T20:30:01', { force: ['domain'] }).domain.status, 'live');
  const pending = { ...base, domain: { ...verifying.domain, status: 'pending', firstCheckAt: null } };
  assert.equal(settleConnectionsIn(pending, '2030-01-01T00:00:00'), pending, 'a domain that was never checked never goes live by itself');
});

test('summariseConnections: one row per connection in hub order with connected, pending or off', () => {
  const c = makeDefaultConnections();
  const rows = summariseConnections(c, '2026-10-23T20:30:00');
  assert.deepEqual(rows.map((r) => r.key), CONNECTION_KEYS);
  assert.deepEqual(rows.map((r) => r.status), ['off', 'connected', 'off', 'off', 'off', 'off'], 'the demo default: only the webhook is on');
  assert.deepEqual(rows.map((r) => r.title), CONNECTION_KEYS.map((k) => CONNECTION_LABELS[k]));
  assert.deepEqual(rows.map((r) => r.href), CONNECTION_KEYS.map((k) => `#/connections/${k}`));
  assert.ok(rows.every((r) => r.label && r.detail && r.raw), 'every row has a label, a detail and the raw status');
  assert.equal(rows[1].label, 'On');
  assert.match(rows[1].detail, /No events yet/);
  assert.equal(rows[0].label, 'Not set up');
  // each state
  const row = (patch, key) => summariseConnections({ ...c, ...patch }, '2026-10-23T20:30:00').find((r) => r.key === key);
  assert.deepEqual([row({ domain: { ...c.domain, status: 'pending', domain: 'www.x.co.uk' } }, 'domain').status, row({ domain: { ...c.domain, status: 'pending', domain: 'www.x.co.uk' } }, 'domain').label], ['pending', 'Waiting for DNS']);
  assert.equal(row({ domain: { ...c.domain, status: 'verifying', domain: 'www.x.co.uk', firstCheckAt: '2026-10-23T20:30:00' } }, 'domain').label, 'Checking');
  assert.equal(row({ domain: { ...c.domain, status: 'verifying', domain: 'www.x.co.uk', firstCheckAt: '2026-10-23T20:29:00' } }, 'domain').label, 'Connected', 'a due simulation is shown as settled');
  assert.match(row({ domain: { ...c.domain, status: 'live', domain: 'www.x.co.uk' } }, 'domain').detail, /www\.x\.co\.uk, security certificate ready/);
  assert.deepEqual([row({ webhook: { ...c.webhook, enabled: false } }, 'webhook').status, row({ webhook: { ...c.webhook, enabled: false } }, 'webhook').label], ['off', 'Paused']);
  assert.match(row({ webhook: { ...c.webhook, lastEventAt: '2026-10-23T20:00' } }, 'webhook').detail, /Last test event 2026-10-23 20:00/);
  assert.equal(row({ tracking: { ...c.tracking, metaPixelId: '1234567890' } }, 'tracking').detail, 'Meta Pixel 1234567890, Google tag not set');
  assert.equal(row({ tracking: { ...c.tracking, googleTagId: 'G-ABCD1234' } }, 'tracking').status, 'connected');
  const wa = (patch) => row({ whatsapp: { ...c.whatsapp, ...patch } }, 'whatsapp');
  assert.equal(wa({ status: 'verifying' }).label, 'Waiting for code');
  assert.deepEqual([wa({ status: 'connected' }).status, wa({ status: 'connected' }).label], ['pending', 'Finish setup'], 'connected but no templates yet is not finished');
  const pendingTemplates = { ...c.whatsapp.templates, customer_confirmed: 'pending' };
  assert.equal(wa({ status: 'connected', templates: pendingTemplates, templatesSubmittedAt: '2026-10-23T20:30:00' }).label, 'Templates pending');
  const approved = Object.fromEntries(WHATSAPP_TEMPLATE_KINDS.map((k) => [k, 'approved']));
  assert.deepEqual([wa({ status: 'connected', templates: approved }).status, wa({ status: 'connected', templates: approved }).label], ['connected', 'Connected']);
  assert.match(wa({ status: 'connected', templates: approved }).detail, /180 Electrical, \+447885496800, templates approved/);
  assert.match(row({ calendar: { ...c.calendar, status: 'connected', account: 'd@gmail.example' } }, 'calendar').detail, /d@gmail\.example, busy times shown in your diary/);
  assert.match(row({ calendar: { ...c.calendar, status: 'connected', account: 'd@gmail.example', twoWay: false } }, 'calendar').detail, /jobs added only/);
  assert.match(row({ email: { ...c.email, status: 'connected', account: 'd@gmail.example' } }, 'email').detail, /sending from daniel@180electrical\.co\.uk/);
  // nothing claims a real connection
  for (const r of summariseConnections({ ...c, calendar: { ...c.calendar, status: 'connected', account: 'd@gmail.example' } }, '2026-10-23T20:30:00')) assert.ok(!/\bsent for real\b|\blive on whatsapp\b/i.test(r.detail), r.key);
});

test('simulatedBusyBlocks: a few free windows labelled Google Calendar, never on bookings, blocks, days off or closed hours', () => {
  const settings = makeDefaultSettings();
  const seed = buildSeed(now(), settings);
  const state = { settings, bookings: seed.bookings, blocks: seed.blocks };
  const blocks = simulatedBusyBlocks(state, '2026-10-23');
  assert.ok(blocks.length >= 3 && blocks.length <= 4, `${blocks.length} blocks`);
  for (const b of blocks) {
    assert.equal(b.label, GCAL_LABEL);
    assert.equal(b.label, 'Google Calendar');
    assert.equal(b.groupId, GCAL_GROUP_ID);
    assert.equal(b.seed, false);
    assert.equal(b.source, 'google_calendar');
    assert.match(b.id, /^blk_gcal_\d{4}-\d{2}-\d{2}_[0-3]$/);
    assert.ok(b.date > '2026-10-23' && b.date <= '2026-11-20', 'in the next few weeks');
    assert.ok(settings.hours[new Date(`${b.date}T12:00`).getDay()].includes(b.windowId), 'an open window');
    assert.ok(!seed.bookings.some((x) => x.status !== 'cancelled' && x.start.slice(0, 10) === b.date && x.durationMin > 0 && x.start.slice(11, 13) >= '08' && windowsOf(x).includes(b.windowId)), `${b.id} is free`);
    assert.ok(!seed.blocks.some((x) => x.date === b.date && x.windowId === b.windowId), `${b.id} is not already blocked`);
  }
  assert.equal(new Set(blocks.map((b) => b.id)).size, blocks.length);
  assert.deepEqual(simulatedBusyBlocks(state, '2026-10-23'), blocks, 'deterministic');
  // a day off is skipped
  const off = { ...state, settings: { ...settings, daysOff: blocks.map((b) => ({ id: `off_${b.date}`, date: b.date, label: 'Off' })) } };
  const moved = simulatedBusyBlocks(off, '2026-10-23');
  assert.ok(moved.every((b) => !blocks.some((x) => x.date === b.date)), 'moved to other days');
});

function windowsOf(b) {
  const startHour = Number(b.start.slice(11, 13));
  const first = startHour === 8 ? 0 : startHour === 10 ? 1 : startHour === 13 ? 2 : 3;
  return b.durationMin >= 240 ? [first, first + 1] : [first];
}

test('webhookSamplePayload: the JSON a real funnel would send, with sample values and the clock', () => {
  const state = { settings: makeDefaultSettings() };
  const p = webhookSamplePayload(state);
  assert.equal(p.event, 'enquiry.created');
  assert.equal(p.createdAt, '2026-10-23T20:30');
  assert.equal(p.webhook, state.settings.connections.webhook.url);
  assert.deepEqual(Object.keys(p.answers), ['postcode', 'parking', 'vehicle', 'timing', 'permission', 'marketingOptIn']);
  assert.deepEqual(Object.keys(p.utm), ['source', 'medium', 'campaign']);
  assert.match(p.customer.phone, /^07700 900\d{3}$/, 'an Ofcom drama number');
  assert.ok(p.customer.email.endsWith('@example.com'));
  assert.deepEqual(webhookSamplePayload({}).webhook, '', 'tolerates a state with no connections');
});
