// tests/unit/v3-connections.test.mjs: unit tests for the SIMULATED connections in js/core/store.js (state machines, delays, test events, undo)
// Owner: A3 core
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { WHATSAPP_DEMO_CODE, WHATSAPP_TEMPLATE_KINDS, makeDefaultConnections } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import { occupiedBy } from '../../js/core/availability.js';
import { selectConnectionsSummary, selectMessages, selectNeedsYou, selectPipeline } from '../../js/core/selectors.js';
import { SIM_POOL } from '../../js/core/seed.js';
import * as store from '../../js/core/store.js';

const {
  initStore, getState, subscribe, undo, setConnection, connectWhatsApp, submitWhatsAppTemplates, connectGoogle, disconnect, startDomainSetup, checkDomain,
  rotateWebhookSecret, sendTestEvent, settleConnections, updateSettings
} = store;

const FIXTURE = new Date(2026, 9, 23, 20, 30, 0);

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
afterEach(() => {
  mock.timers.reset();
  initStore({ storage: memStorage(), force: true }); // clears any real timers the store armed
  setClock(null);
});

const conn = (key) => getState().settings.connections[key];
const summary = (key) => selectConnectionsSummary(getState()).find((r) => r.key === key);
const gcalBlocks = () => getState().blocks.filter((b) => b.groupId === 'grp_gcal_sim');
const at = (sec) => setClock(new Date(2026, 9, 23, 20, 30, sec));

// ---------- setConnection ----------

test('setConnection: validated patches on the allowed fields, returned with the connection and an undo token', () => {
  const r = setConnection('whatsapp', { displayName: 'Daniel at 180', ownerAlerts: false, quietHours: { on: false, from: '22:00', to: '07:30' } });
  assert.equal(r.ok, true);
  assert.deepEqual([r.connection.displayName, r.connection.ownerAlerts, r.connection.quietHours], ['Daniel at 180', false, { on: false, from: '22:00', to: '07:30' }]);
  assert.equal(conn('whatsapp').displayName, 'Daniel at 180');
  assert.equal(JSON.parse(storage.getItem('vm_state_v1')).settings.connections.whatsapp.displayName, 'Daniel at 180', 'persisted');
  assert.equal(undo(r.undoToken).ok, true);
  assert.deepEqual(conn('whatsapp'), makeDefaultConnections().whatsapp);
  assert.equal(setConnection('email', { sendFrom: 'hello@180electrical.co.uk', quotes: false }).connection.quotes, false);
  assert.equal(setConnection('webhook', { enabled: false }).connection.enabled, false);
  assert.deepEqual(setConnection('tracking', { metaPixelId: '1234567890', googleTagId: 'g-abcd1234' }).connection, { metaPixelId: '1234567890', googleTagId: 'G-ABCD1234', consentNote: true });
});

test('setConnection: unknown keys and bad values are refused with errors and change nothing; protected fields are ignored; unchanged writes nothing', () => {
  const rev = getState().meta.rev;
  assert.equal(setConnection('fax', { enabled: true }).reason, 'invalid');
  assert.equal(setConnection(undefined, {}).reason, 'invalid');
  const bad = setConnection('whatsapp', { displayName: '', number: 'x' });
  assert.equal(bad.reason, 'invalid');
  assert.ok(bad.errors.displayName && bad.errors.number);
  assert.ok(setConnection('tracking', { googleTagId: 'UA-1' }).errors.googleTagId);
  assert.ok(setConnection('email', { sendFrom: 'nope' }).errors.sendFrom);
  assert.equal(getState().meta.rev, rev);
  // protected fields are dropped silently, and a patch with nothing left changes nothing
  let calls = 0;
  const off = subscribe(() => { calls += 1; });
  assert.equal(setConnection('webhook', { url: 'https://evil.example', secret: 'x', lastEventAt: 'x' }).ok, true);
  assert.equal(setConnection('whatsapp', { displayName: '180 Electrical' }).ok, true, 'the same value');
  assert.equal(setConnection('domain', { status: 'live', domain: 'x.com' }).ok, true);
  off();
  assert.equal(calls, 0);
  assert.equal(conn('webhook').url, makeDefaultConnections().webhook.url);
  assert.equal(conn('domain').status, 'none');
  assert.equal(getState().meta.rev, rev);
});

// ---------- WhatsApp ----------

test('WhatsApp: verifying then the demo code connects; a wrong code is bad_code and changes nothing', () => {
  assert.equal(conn('whatsapp').status, 'disconnected');
  const start = setConnection('whatsapp', { number: '07885 496800', status: 'verifying' });
  assert.equal(start.ok, true);
  assert.equal(start.connection.status, 'verifying');
  assert.equal(summary('whatsapp').label, 'Waiting for code');
  const rev = getState().meta.rev;
  assert.deepEqual(connectWhatsApp({ number: '07885 496800', code: '000000' }), { ok: false, reason: 'bad_code' });
  assert.deepEqual(connectWhatsApp({ number: '07885 496800', code: '' }), { ok: false, reason: 'bad_code' });
  assert.deepEqual(connectWhatsApp({ number: '07885 496800' }), { ok: false, reason: 'bad_code' });
  assert.deepEqual(connectWhatsApp(), { ok: false, reason: 'bad_code' }, 'the number defaults to the one on file');
  assert.equal(getState().meta.rev, rev, 'nothing written');
  assert.equal(conn('whatsapp').status, 'verifying');
  const ok = connectWhatsApp({ number: '+44 7885 496800', code: ` ${WHATSAPP_DEMO_CODE} ` });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.connection.status, ok.connection.number, ok.connection.connectedAt], ['connected', '+447885496800', '2026-10-23T20:30']);
  assert.ok(ok.undoToken);
  assert.equal(WHATSAPP_DEMO_CODE, '482913');
  assert.equal(summary('whatsapp').status, 'pending', 'connected but the templates are not submitted yet');
});

test('WhatsApp: the number is validated and can be connected straight from disconnected', () => {
  const bad = connectWhatsApp({ number: 'banana', code: '482913' });
  assert.equal(bad.reason, 'invalid');
  assert.ok(bad.errors.number);
  assert.equal(connectWhatsApp({ number: '+353 85 123 4567', code: '482913' }).connection.number, '+353851234567');
  assert.equal(setConnection('whatsapp', { status: 'verifying' }).reason, 'invalid', 'cannot start verifying when connected');
  assert.equal(setConnection('whatsapp', { status: 'connected' }).reason, 'invalid', 'cannot be set connected without the code');
  assert.equal(setConnection('whatsapp', { status: 'disconnected' }).reason, 'invalid', 'a connected number is removed with disconnect');
  const cancel = disconnect('whatsapp');
  assert.equal(cancel.connection.status, 'disconnected');
  setConnection('whatsapp', { status: 'verifying' });
  assert.equal(setConnection('whatsapp', { status: 'disconnected' }).connection.status, 'disconnected', 'cancelling a verification is allowed');
});

test('submitWhatsAppTemplates: needs a connected number; templates go pending, then approved by the clock', () => {
  assert.equal(submitWhatsAppTemplates().reason, 'not_connected');
  connectWhatsApp({ number: '07885 496800', code: '482913' });
  const sub = submitWhatsAppTemplates();
  assert.equal(sub.ok, true);
  assert.deepEqual(Object.keys(sub.connection.templates), WHATSAPP_TEMPLATE_KINDS);
  assert.ok(Object.values(sub.connection.templates).every((s) => s === 'pending'));
  assert.equal(sub.connection.templatesSubmittedAt, '2026-10-23T20:30:00');
  assert.equal(summary('whatsapp').label, 'Templates pending');
  at(5);
  assert.deepEqual(settleConnections(), { ok: true, changed: false }, 'one second short of 6');
  assert.ok(Object.values(conn('whatsapp').templates).every((s) => s === 'pending'));
  assert.equal(summary('whatsapp').label, 'Templates pending');
  at(6);
  assert.equal(summary('whatsapp').label, 'Connected', 'the summary already shows it settled');
  assert.ok(Object.values(conn('whatsapp').templates).every((s) => s === 'pending'), 'but nothing was written yet');
  const rev = getState().meta.rev;
  assert.deepEqual(settleConnections(), { ok: true, changed: true });
  assert.ok(Object.values(conn('whatsapp').templates).every((s) => s === 'approved'));
  assert.equal(getState().meta.rev, rev + 1);
  assert.deepEqual(settleConnections(), { ok: true, changed: false }, 'idempotent');
  assert.equal(getState().meta.rev, rev + 1, 'and it writes nothing the second time');
  assert.equal(submitWhatsAppTemplates().ok, true, 'submitting again keeps the approved ones');
  assert.ok(Object.values(conn('whatsapp').templates).every((s) => s === 'approved'));
});

test('submitWhatsAppTemplates arms a short real timer, so a view subscribed to the store updates itself even under a frozen clock', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  connectWhatsApp({ number: '07885 496800', code: '482913' });
  const seen = [];
  const off = subscribe((s) => seen.push(Object.values(s.settings.connections.whatsapp.templates).filter((x) => x === 'approved').length));
  submitWhatsAppTemplates();
  assert.deepEqual(seen, [0]);
  mock.timers.tick(2999);
  assert.deepEqual(seen, [0], 'not yet');
  mock.timers.tick(1);
  assert.deepEqual(seen, [0, WHATSAPP_TEMPLATE_KINDS.length], 'about 3 seconds of real time later every template is approved');
  assert.equal(summary('whatsapp').label, 'Connected');
  off();
});

test('disconnecting WhatsApp clears the templates and the connection time; undo brings the connection back', () => {
  connectWhatsApp({ number: '07885 496800', code: '482913' });
  submitWhatsAppTemplates();
  at(10);
  settleConnections();
  const before = conn('whatsapp');
  const off = disconnect('whatsapp');
  assert.equal(off.ok, true);
  assert.deepEqual([off.connection.status, off.connection.connectedAt, off.connection.templatesSubmittedAt], ['disconnected', null, null]);
  assert.ok(Object.values(off.connection.templates).every((s) => s === 'none'));
  assert.equal(off.connection.displayName, before.displayName, 'the settings the person chose stay');
  assert.equal(undo(off.undoToken).ok, true);
  assert.deepEqual(conn('whatsapp'), before);
});

// ---------- Google Calendar and Gmail ----------

test('connectGoogle(calendar): connects with an account and imports a few simulated busy blocks labelled Google Calendar', () => {
  const before = getState().blocks.length;
  const bad = connectGoogle('calendar', { account: 'not an email' });
  assert.equal(bad.reason, 'invalid');
  assert.ok(bad.errors.account);
  assert.equal(connectGoogle('drive', { account: 'd@gmail.example' }).reason, 'invalid');
  assert.equal(connectGoogle('calendar').reason, 'invalid');
  assert.equal(getState().blocks.length, before);
  const ok = connectGoogle('calendar', { account: ' daniel@gmail.example ' });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.connection.status, ok.connection.account, ok.connection.connectedAt], ['connected', 'daniel@gmail.example', '2026-10-23T20:30']);
  const blocks = gcalBlocks();
  assert.ok(blocks.length >= 3 && blocks.length <= 4);
  assert.ok(blocks.every((b) => b.label === 'Google Calendar' && b.seed === false && b.source === 'google_calendar'));
  assert.equal(getState().blocks.length, before + blocks.length);
  for (const b of blocks) assert.equal(occupiedBy(getState(), b.date, b.windowId), null, 'never on a booking');
  assert.equal(new Set(blocks.map((b) => `${b.date}|${b.windowId}`)).size, blocks.length);
  assert.match(summary('calendar').detail, /daniel@gmail\.example, busy times shown in your diary/);
  // connecting again does not duplicate them
  connectGoogle('calendar', { account: 'daniel@gmail.example' });
  assert.equal(gcalBlocks().length, blocks.length);
});

test('the two-way switch adds and removes the busy blocks while connected, and does nothing while disconnected', () => {
  assert.equal(setConnection('calendar', { twoWay: false }).ok, true);
  connectGoogle('calendar', { account: 'daniel@gmail.example' });
  assert.equal(gcalBlocks().length, 0, 'one-way: no busy blocks come in');
  const on = setConnection('calendar', { twoWay: true });
  assert.equal(on.ok, true);
  assert.ok(gcalBlocks().length >= 3);
  const off = setConnection('calendar', { twoWay: false });
  assert.equal(gcalBlocks().length, 0);
  assert.equal(undo(off.undoToken).ok, true);
  assert.ok(gcalBlocks().length >= 3, 'undo brings them back');
  disconnect('calendar');
  assert.equal(setConnection('calendar', { twoWay: true }).ok, true);
  assert.equal(gcalBlocks().length, 0, 'disconnected: nothing is imported');
});

test('disconnect(calendar) removes the busy blocks; undo restores both the connection and the blocks', () => {
  connectGoogle('calendar', { account: 'daniel@gmail.example' });
  const blocks = gcalBlocks();
  const off = disconnect('calendar');
  assert.equal(off.ok, true);
  assert.deepEqual([off.connection.status, off.connection.account], ['disconnected', '']);
  assert.equal(gcalBlocks().length, 0);
  assert.equal(summary('calendar').status, 'off');
  assert.equal(undo(off.undoToken).ok, true);
  assert.equal(conn('calendar').status, 'connected');
  assert.deepEqual(gcalBlocks().map((b) => b.id).sort(), blocks.map((b) => b.id).sort());
});

test('the busy blocks are the diary\'s own: customers cannot book them, and a booking made later is never put on one', () => {
  connectGoogle('calendar', { account: 'daniel@gmail.example' });
  const [block] = gcalBlocks();
  const made = store.createBooking({ serviceId: 'fault', date: block.date, windowId: block.windowId, customer: { name: 'Zed Ford', phone: '07700 900612' }, address: { line1: '1 Test Road', postcode: 'BT9 6QP' } });
  assert.equal(made.reason, 'slot_taken');
  assert.equal(store.addBlock({ date: block.date, windowId: block.windowId }).ok, false, 'already blocked');
});

test('connectGoogle(email) and disconnect(email)', () => {
  const ok = connectGoogle('email', { account: 'daniel@gmail.example' });
  assert.equal(ok.ok, true);
  assert.equal(conn('email').status, 'connected');
  assert.match(summary('email').detail, /daniel@gmail\.example, sending from daniel@180electrical\.co\.uk/);
  assert.equal(gcalBlocks().length, 0, 'email imports nothing');
  assert.equal(disconnect('email').connection.status, 'disconnected');
  assert.equal(conn('email').sendFrom, 'daniel@180electrical.co.uk', 'the chosen sender stays');
});

// ---------- the domain ----------

test('startDomainSetup: validates the hostname, shows the fictional records, sets pending', () => {
  const bad = startDomainSetup('not a domain');
  assert.equal(bad.reason, 'invalid');
  assert.equal(bad.errors.domain, 'Enter a website address like www.180electrical.co.uk');
  assert.equal(conn('domain').status, 'none');
  const ok = startDomainSetup('HTTPS://WWW.180Electrical.co.uk/');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.connection, { status: 'pending', domain: 'www.180electrical.co.uk', checks: 0, verifiedAt: null, firstCheckAt: null });
  assert.deepEqual(ok.records, [{ type: 'CNAME', host: 'www', value: 'sites.example', ttl: 3600 }]);
  assert.equal(summary('domain').label, 'Waiting for DNS');
  const apex = startDomainSetup('180electrical.co.uk');
  assert.deepEqual(apex.records.map((r) => [r.type, r.value]), [['A', '192.0.2.10'], ['CNAME', 'sites.example']]);
  assert.equal(conn('domain').domain, '180electrical.co.uk', 'starting again replaces the old setup');
  assert.equal(conn('domain').checks, 0);
});

test('checkDomain: the first check cannot see the records yet, the second finds them and the certificate is issued', () => {
  assert.deepEqual(checkDomain(), { ok: false, reason: 'bad_transition' }, 'nothing set up');
  startDomainSetup('www.180electrical.co.uk');
  const first = checkDomain();
  assert.equal(first.ok, true);
  assert.deepEqual([first.found, first.status, first.sslIssued], [false, 'verifying', false]);
  assert.equal(first.message, 'We cannot see your records yet. DNS changes can take a while, so try again in a minute.');
  assert.deepEqual([first.connection.checks, first.connection.firstCheckAt, first.connection.verifiedAt], [1, '2026-10-23T20:30:00', null]);
  assert.equal(summary('domain').label, 'Checking');
  const second = checkDomain();
  assert.equal(second.ok, true);
  assert.deepEqual([second.found, second.status, second.sslIssued], [true, 'live', true]);
  assert.equal(second.message, 'Your website address is connected and the security certificate is ready (simulated).');
  assert.deepEqual([second.connection.checks, second.connection.verifiedAt], [2, '2026-10-23T20:30']);
  assert.equal(summary('domain').status, 'connected');
  const rev = getState().meta.rev;
  const third = checkDomain();
  assert.deepEqual([third.ok, third.found, third.status, third.unchanged], [true, true, 'live', true]);
  assert.equal(getState().meta.rev, rev, 'a live domain is not written again');
});

test('checkDomain: left alone, a verifying domain goes live after 20 seconds of clock time (settleConnections or the summary)', () => {
  startDomainSetup('www.180electrical.co.uk');
  checkDomain();
  at(19);
  assert.equal(summary('domain').label, 'Checking');
  assert.deepEqual(settleConnections(), { ok: true, changed: false });
  at(20);
  assert.equal(summary('domain').label, 'Connected', 'the summary shows it settled');
  assert.equal(conn('domain').status, 'verifying');
  assert.deepEqual(settleConnections(), { ok: true, changed: true });
  assert.deepEqual([conn('domain').status, conn('domain').verifiedAt], ['live', '2026-10-23T20:30']);
  // or a later check after the 20 seconds finds it live straight away
  startDomainSetup('www.example.org');
  setClock(FIXTURE);
  checkDomain();
  at(40);
  const late = checkDomain();
  assert.deepEqual([late.found, late.status], [true, 'live']);
});

test('checkDomain arms a real timer too: 20 seconds later a subscribed view sees it go live even under a frozen clock', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  startDomainSetup('www.180electrical.co.uk');
  const seen = [];
  const off = subscribe((s) => seen.push(s.settings.connections.domain.status));
  checkDomain();
  mock.timers.tick(19999);
  assert.deepEqual(seen, ['verifying']);
  mock.timers.tick(1);
  assert.deepEqual(seen, ['verifying', 'live']);
  off();
});

test('disconnect(domain) resets it; undo brings it back; a domain that was never set up can be disconnected harmlessly', () => {
  startDomainSetup('www.180electrical.co.uk');
  checkDomain();
  checkDomain();
  const live = conn('domain');
  const off = disconnect('domain');
  assert.deepEqual(off.connection, { status: 'none', domain: '', checks: 0, verifiedAt: null, firstCheckAt: null });
  assert.equal(undo(off.undoToken).ok, true);
  assert.deepEqual(conn('domain'), live);
  disconnect('domain');
  assert.equal(disconnect('domain').ok, true);
  assert.equal(disconnect('fax').reason, 'invalid');
});

// ---------- the webhook ----------

test('rotateWebhookSecret: a new whsec_ secret every time, the URL stays, undoable', () => {
  const before = conn('webhook');
  const one = rotateWebhookSecret();
  assert.equal(one.ok, true);
  assert.match(one.secret, /^whsec_[0-9a-z]{24}$/);
  assert.equal(one.connection.secret, one.secret);
  assert.notEqual(one.secret, before.secret);
  assert.equal(conn('webhook').url, before.url);
  const two = rotateWebhookSecret();
  assert.notEqual(two.secret, one.secret);
  assert.equal(undo(two.undoToken).ok, true);
  assert.equal(conn('webhook').secret, one.secret);
});

test('disconnect(webhook) pauses it (the URL stays); disconnect(tracking) clears the ids', () => {
  assert.equal(disconnect('webhook').connection.enabled, false);
  assert.equal(conn('webhook').url, makeDefaultConnections().webhook.url);
  assert.equal(summary('webhook').label, 'Paused');
  setConnection('tracking', { metaPixelId: '1234567890', googleTagId: 'G-ABCD1234' });
  const off = disconnect('tracking');
  assert.deepEqual(off.connection, { metaPixelId: '', googleTagId: '', consentNote: true });
  assert.equal(summary('tracking').status, 'off');
  assert.equal(undo(off.undoToken).ok, true);
  assert.equal(conn('tracking').metaPixelId, '1234567890');
});

test('sendTestEvent(webhook): a sample enquiry through the funnel path, with a webhook utm, lastEventAt set, the next person from the pool', () => {
  const bookings = getState().bookings.length;
  const messages = getState().messages.length;
  const sent = sendTestEvent('webhook');
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const b = sent.booking;
  assert.equal(getState().bookings.length, bookings + 1);
  assert.deepEqual([b.serviceId, b.status, b.tentative, b.source, b.seed, b.seenByOwner], ['ev_quote', 'new', true, 'website', false, false]);
  assert.deepEqual(b.utm, { source: 'other', medium: 'webhook', campaign: 'test_event' });
  assert.equal(b.notes, 'Sample enquiry from the webhook test (simulated).');
  assert.equal(b.customer.name, SIM_POOL[0].name);
  assert.deepEqual(b.answers, { postcode: 'BT4 3LW', ...SIM_POOL[0].answers });
  assert.equal(b.address.line1, '', 'the funnel only collects the postcode');
  assert.deepEqual(sent.messages.map((m) => m.kind), ['customer_received', 'owner_new_booking'], 'the same messages as a funnel enquiry');
  assert.equal(getState().messages.length, messages + 2);
  assert.equal(sent.connection.lastEventAt, '2026-10-23T20:30');
  assert.equal(conn('webhook').lastEventAt, '2026-10-23T20:30');
  assert.match(summary('webhook').detail, /Last test event 2026-10-23 20:30/);
  assert.ok(selectNeedsYou(getState()).some((x) => x.id === b.id), 'it needs a reply like any enquiry');
  const p = selectPipeline(getState(), '2026-10-23T20:30');
  assert.equal(p.stages.find((s) => s.id === 'enquiry').count, 3);
  // the next one is the next person
  assert.equal(sendTestEvent('webhook').booking.customer.name, SIM_POOL[1].name);
  assert.equal(getState().meta.simCursor, 2);
});

test('sendTestEvent(webhook) is refused while the webhook is off, and nothing is created', () => {
  disconnect('webhook');
  const rev = getState().meta.rev;
  assert.deepEqual(sendTestEvent('webhook'), { ok: false, reason: 'disabled' });
  assert.equal(getState().meta.rev, rev);
  setConnection('webhook', { enabled: true });
  assert.equal(sendTestEvent('webhook').ok, true);
});

test('sendTestEvent(whatsapp or email): needs the connection; logs a clearly simulated owner test message that belongs to no booking', () => {
  assert.equal(sendTestEvent('whatsapp').reason, 'not_connected');
  assert.equal(sendTestEvent('email').reason, 'not_connected');
  connectWhatsApp({ number: '07885 496800', code: '482913' });
  const wa = sendTestEvent('whatsapp');
  assert.equal(wa.ok, true);
  const m = wa.message;
  assert.deepEqual([m.kind, m.to, m.channel, m.bookingId, m.simulated, m.seed, m.sendAt], ['owner_test_event', 'owner', 'whatsapp', null, true, false, null]);
  assert.equal(m.body, '*Test message from 180 Electrical*\nThis is a test from your dashboard. A live build would send it to 07885 496800. Simulated: nothing was really sent.');
  assert.equal(getState().messages.at(-1).id, m.id);
  assert.ok(selectMessages(getState(), { to: 'owner' }).some((x) => x.id === m.id));
  assert.ok(wa.undoToken);
  connectGoogle('email', { account: 'daniel@gmail.example' });
  const em = sendTestEvent('email').message;
  assert.deepEqual([em.channel, em.toEmail, em.bookingId], ['email', 'daniel@gmail.example', null]);
  assert.equal(sendTestEvent('calendar').reason, 'invalid');
  assert.equal(sendTestEvent('nope').reason, 'invalid');
  assert.equal(undo(wa.undoToken).ok, true);
  assert.ok(!getState().messages.some((x) => x.id === m.id));
});

test('the hub summary follows every step of the demo: off, pending, connected', () => {
  const states = () => selectConnectionsSummary(getState()).map((r) => r.status).join(',');
  assert.equal(states(), 'off,connected,off,off,off,off');
  startDomainSetup('www.180electrical.co.uk');
  connectWhatsApp({ number: '07885 496800', code: '482913' });
  connectGoogle('calendar', { account: 'daniel@gmail.example' });
  connectGoogle('email', { account: 'daniel@gmail.example' });
  setConnection('tracking', { metaPixelId: '1234567890' });
  assert.equal(states(), 'pending,connected,connected,pending,connected,connected');
  checkDomain();
  checkDomain();
  submitWhatsAppTemplates();
  at(7);
  assert.equal(states(), 'connected,connected,connected,connected,connected,connected');
  for (const key of ['domain', 'webhook', 'tracking', 'whatsapp', 'calendar', 'email']) disconnect(key);
  assert.equal(states(), 'off,off,off,off,off,off');
});

test('connections survive a reload and show in a second tab', async () => {
  connectGoogle('email', { account: 'daniel@gmail.example' });
  startDomainSetup('www.180electrical.co.uk');
  const reloaded = initStore({ storage, force: true });
  assert.equal(reloaded.settings.connections.email.account, 'daniel@gmail.example');
  assert.equal(reloaded.settings.connections.domain.domain, 'www.180electrical.co.uk');
  const tabB = await import(`../../js/core/store.js?tab=${Math.random().toString(36).slice(2)}`);
  tabB.initStore({ storage, force: true });
  setConnection('tracking', { metaPixelId: '1234567890' });
  assert.equal(tabB.syncFromStorage(), true);
  assert.equal(tabB.getState().settings.connections.tracking.metaPixelId, '1234567890');
});

test('updateSettings cannot change connections (they have their own functions)', () => {
  const r = updateSettings({ connections: { webhook: { enabled: false, secret: 'x' } }, marketing: { adSpend: [] } });
  assert.equal(r.ok, true);
  assert.equal(conn('webhook').enabled, true);
  assert.equal(conn('webhook').secret, makeDefaultConnections().webhook.secret);
  assert.equal(getState().settings.marketing.adSpend.length, 6, 'nor the ad spend');
});
