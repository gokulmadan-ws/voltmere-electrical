// tests/unit/messages.test.mjs: unit tests for js/core/messages.js (templates, rendering, scheduling, bubble actions, links)
// Owner: WP1
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultSettings, TEMPLATE_KINDS, SITE_BASE_URL } from '../../js/core/config.js';
import { setClock } from '../../js/core/clock.js';
import {
  DEFAULT_TEMPLATES, PLACEHOLDERS, KIND_LABELS, renderTemplate, buildContext, buildMessage, reminderSendAt, messageIsScheduled,
  bubbleActions, waLink, waShareLink, telLink, smsLink, mailtoLink, mapsLink
} from '../../js/core/messages.js';

beforeEach(() => setClock(new Date(2026, 9, 23, 20, 30)));
afterEach(() => setClock(null));

function sampleBooking(over = {}) {
  return {
    id: 'bk_sample01', ref: 'VM-1043', createdAt: '2026-10-23T20:30', serviceId: 'eicr', serviceName: 'EICR safety report',
    variantId: 'house', variantLabel: 'House, 2–3 bed', start: '2026-10-26T08:00', durationMin: 240, status: 'confirmed',
    urgent: false, emergencyReasons: [], etaMinutes: null, etaAt: null,
    customer: { name: 'Priya Nair', phone: '07700 900231', email: '' }, address: { line1: '14 Alder Row', postcode: 'MB3 4QP' },
    notes: '', internalNotes: '', source: 'website', quotedPrice: 195, finalPrice: null, paid: false, paidMethod: null, paidAt: null,
    seenByOwner: false, reviewRequested: false, cancelledBy: null, cancelReason: '', seed: false, history: [], ...over
  };
}

const stateOf = (over = {}) => ({ settings: makeDefaultSettings(), bookings: [], blocks: [], messages: [], ...over });
const EMOJI = /\p{Extended_Pictographic}/u;

function assertClean(kind, body) {
  assert.ok(body.length > 0, `${kind} is empty`);
  assert.ok(!/[{}]/.test(body), `${kind} has a leftover brace: ${body}`);
  assert.ok(!body.split('\n').some((line) => line.trim() === ''), `${kind} has an empty line`);
  assert.ok(!body.split('\n').some((line) => line !== line.trim()), `${kind} has an untrimmed line`);
  assert.ok(!EMOJI.test(body), `${kind} has an emoji`);
  assert.ok(!body.includes('!'), `${kind} has an exclamation mark`);
  assert.ok(!/undefined|NaN|\bnull\b/.test(body), `${kind} leaks a bad value: ${body}`);
  assert.ok(!/ {2,}/.test(body), `${kind} has a double space`);
}

// Fail the test if any template triggers the "unknown placeholder" warning.
function withWarnSpy(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
}

test('there are 19 kinds and every table has the same keys in the same order', () => {
  assert.equal(TEMPLATE_KINDS.length, 19);
  assert.deepEqual(Object.keys(KIND_LABELS), TEMPLATE_KINDS);
  assert.deepEqual(Object.keys(DEFAULT_TEMPLATES), TEMPLATE_KINDS);
  assert.equal(KIND_LABELS.owner_new_booking, 'New booking alert');
  assert.equal(KIND_LABELS.customer_payment_nudge, 'Payment reminder');
  assert.equal(KIND_LABELS.customer_quote_ready, 'Quote ready');
});

test('buildContext returns exactly the placeholders of 10.2, all strings', () => {
  const ctx = buildContext(sampleBooking(), stateOf());
  assert.deepEqual(Object.keys(ctx).sort(), Object.keys(PLACEHOLDERS).sort());
  for (const [key, value] of Object.entries(ctx)) assert.equal(typeof value, 'string', key);
  // every placeholder used by a default template is documented
  for (const text of Object.values(DEFAULT_TEMPLATES)) {
    for (const [, name] of text.matchAll(/\{(\w+)\}/g)) assert.ok(name in PLACEHOLDERS, `undocumented {${name}}`);
  }
});

test('every kind renders cleanly for a sample booking (no braces, empty lines, emoji or exclamation marks)', () => {
  withWarnSpy(() => {
    const variants = [
      sampleBooking(),
      sampleBooking({ status: 'done', finalPrice: 195, paid: true, paidMethod: 'card' }),
      sampleBooking({ status: 'new', address: { line1: 'Mill Cottage, Ashgrove Lane', postcode: 'MB12 6AB' }, notes: 'Park by the gate', cancelReason: 'Customer asked' }),
      sampleBooking({ serviceId: 'fault', serviceName: 'Fault finding and repairs', variantId: null, variantLabel: '', quotedPrice: 75, durationMin: 120, etaMinutes: 45, etaAt: '2026-10-23T21:15' }),
      sampleBooking({ serviceId: 'emergency', serviceName: 'Emergency visit', variantId: null, variantLabel: '', urgent: true, status: 'new', durationMin: 0, start: '2026-10-23T20:30', quotedPrice: 95, emergencyReasons: ['no_power', 'burning'], address: { line1: '', postcode: 'MB2 6JN' }, notes: 'No power in kitchen', etaMinutes: 60, etaAt: '2026-10-23T21:30' }),
      sampleBooking({ serviceId: 'rewire', serviceName: 'Rewire survey', variantId: null, variantLabel: '', quotedPrice: 0, durationMin: 120 })
    ];
    for (const booking of variants) {
      for (const kind of TEMPLATE_KINDS) {
        const msg = buildMessage(kind, booking, stateOf(), { oldWhen: 'Sat 24 Oct, 8–10am', newWhen: 'Mon 26 Oct, 8–10am', reason: 'Customer asked', etaMinutes: 45 });
        assertClean(`${kind} (${booking.serviceId}, ${booking.status})`, msg.body);
      }
    }
  });
});

test('customer_confirmed matches the worked example of 10.3 word for word', () => {
  const msg = buildMessage('customer_confirmed', sampleBooking(), stateOf());
  assert.equal(
    msg.body,
    "Hi Priya, it's Dan from Voltmere Electrical. You're booked in: EICR safety report (House, 2–3 bed), Mon 26 Oct, morning, arriving between 8 and 10am, at 14 Alder Row. Fixed price £195, pay after the job. I'll message when I'm 30 minutes away. Need to change it? Reply here or call 07700 900412. Ref VM-1043"
  );
});

test('owner_new_booking: confirmed automatically, and the approval reasons', () => {
  const auto = buildMessage('owner_new_booking', sampleBooking(), stateOf());
  assert.equal(
    auto.body,
    `*New booking VM-1043*\nPriya Nair · 07700 900231\nEICR safety report (House, 2–3 bed) · £195\nMon 26 Oct, morning, arriving between 8 and 10am\n14 Alder Row, MB3 4QP\nConfirmed automatically.\nOpen: ${SITE_BASE_URL}dashboard.html#/bookings/bk_sample01`
  );
  const edge = buildMessage('owner_new_booking', sampleBooking({ status: 'new', address: { line1: 'Mill Cottage', postcode: 'MB12 6AB' }, notes: 'Park by the gate' }), stateOf());
  assert.ok(edge.body.includes('Needs your OK: outside your usual area (MB12).'));
  assert.ok(edge.body.includes('Note: "Park by the gate"'));
  const off = buildMessage('owner_new_booking', sampleBooking({ status: 'new' }), stateOf());
  assert.ok(off.body.includes('Needs your OK: auto-confirm is off.'));
  assert.ok(!off.body.includes('Note:'), 'an empty note line is dropped');
});

test('owner_emergency lists the reasons and the address falls back to the postcode', () => {
  const urgent = sampleBooking({ serviceId: 'emergency', serviceName: 'Emergency visit', variantId: null, variantLabel: '', urgent: true, status: 'new', durationMin: 0, emergencyReasons: ['no_power', 'burning'], address: { line1: '', postcode: 'MB2 6JN' } });
  const msg = buildMessage('owner_emergency', urgent, stateOf());
  assert.equal(msg.to, 'owner');
  assert.ok(msg.body.startsWith('*URGENT: emergency request VM-1043*'));
  assert.ok(msg.body.includes('No power at all, Burning smell or sparks'));
  assert.ok(msg.body.includes('\nMB2 6JN\n'));
  assert.ok(msg.body.includes('Reply within 10 minutes.'));
});

test('placeholder values: when, whenLong, serviceWhen, line1, address, receivedReason, priceLine', () => {
  const state = stateOf();
  const single = buildContext(sampleBooking({ start: '2026-10-24T08:00', durationMin: 120, serviceId: 'fault', serviceName: 'Fault finding and repairs', variantId: null, variantLabel: '', quotedPrice: 75 }), state);
  assert.equal(single.when, 'Sat 24 Oct, 8–10am');
  assert.equal(single.whenLong, 'Sat 24 Oct, arriving between 8 and 10am');
  assert.equal(single.serviceWhen, 'Fault finding and repairs on Sat 24 Oct, 8–10am');
  assert.equal(single.dateShort, 'Sat 24 Oct');
  assert.equal(single.arrive, 'between 8 and 10am');
  assert.equal(single.priceLine, "From £75, pay after the job. I'll confirm before any extra work.");
  const half = buildContext(sampleBooking(), state);
  assert.equal(half.when, 'Mon 26 Oct, morning, 8–10am');
  assert.equal(half.whenLong, 'Mon 26 Oct, morning, arriving between 8 and 10am');
  assert.equal(half.serviceFull, 'EICR safety report (House, 2–3 bed)');
  assert.equal(half.priceLine, 'Fixed price £195, pay after the job.');
  assert.equal(half.certLine, 'Your certificate follows today.');
  assert.equal(half.customerFirst, 'Priya');
  assert.equal(half.address, '14 Alder Row, MB3 4QP');
  assert.equal(half.receivedReason, '');
  assert.equal(half.jobLink, `${SITE_BASE_URL}dashboard.html#/bookings/bk_sample01`);
  assert.equal(half.manageLink, `${SITE_BASE_URL}index.html#manage/VM-1043`);
  assert.equal(half.reviewLink, 'voltmere.example/review (sample link)');
  assert.equal(half.awayMinutes, '30');
  assert.equal(half.powerCutNumber, '105');
  const free = buildContext(sampleBooking({ serviceId: 'rewire', serviceName: 'Rewire survey', variantId: null, variantLabel: '', quotedPrice: 0 }), state);
  assert.equal(free.priceLine, 'No charge for the visit.');
  assert.equal(free.certLine, '', 'a survey visit has no certificate');
  const urgent = buildContext(sampleBooking({ serviceId: 'emergency', serviceName: 'Emergency visit', urgent: true, status: 'new', address: { line1: '', postcode: 'MB2 6JN' } }), state);
  assert.equal(urgent.when, 'as soon as possible');
  assert.equal(urgent.whenLong, 'as soon as possible');
  assert.equal(urgent.serviceWhen, 'your emergency visit');
  assert.equal(urgent.line1, 'MB2 6JN');
  assert.equal(urgent.address, 'MB2 6JN');
  assert.equal(urgent.nextFreeLine, 'If anyone is in danger call 999, or 105 for a power cut.');
  const edge = buildContext(sampleBooking({ address: { line1: 'Mill Cottage', postcode: 'MB12 6AB' } }), state);
  assert.equal(edge.receivedReason, 'I just need to check travel to MB12 6AB.');
});

test('reviewLink follows the business email and falls back to prototype.invalid', () => {
  const settings = makeDefaultSettings();
  settings.business.email = 'lee@ashby-sparks.example';
  assert.equal(buildContext(sampleBooking(), stateOf({ settings })).reviewLink, 'ashby-sparks.example/review (sample link)');
  const blank = makeDefaultSettings();
  blank.business.email = '';
  assert.equal(buildContext(sampleBooking(), stateOf({ settings: blank })).reviewLink, 'prototype.invalid/review (sample link)');
});

test('ETA placeholders: etaText wording, etaClock from etaAt or from the preview ETA', () => {
  const state = stateOf();
  const eta = (m) => buildContext(sampleBooking(), state, { etaMinutes: m, at: '2026-10-23T20:30' });
  assert.equal(eta(45).etaText, '45 minutes');
  assert.equal(eta(60).etaText, '1 hour');
  assert.equal(eta(120).etaText, '2 hours');
  assert.equal(eta(15).etaText, '15 minutes');
  assert.equal(eta(45).etaClock, '21:15');
  assert.equal(eta(45).etaMinutes, '45');
  const stored = buildContext(sampleBooking({ etaMinutes: 30, etaAt: '2026-10-23T21:00' }), state);
  assert.equal(stored.etaText, '30 minutes');
  assert.equal(stored.etaClock, '21:00');
  const on = buildMessage('customer_on_my_way', sampleBooking({ serviceId: 'fault', start: '2026-10-23T20:00', durationMin: 120 }), state, { etaMinutes: 30 });
  assert.equal(on.body, "Hi Priya, it's Dan. I'm on my way to 14 Alder Row, 30 minutes away (around 21:00). See you shortly. Ref VM-1043");
});

test('declined and cancelled messages: serviceWhen, reasonLine and nextFree', () => {
  const booking = sampleBooking({ serviceId: 'fault', serviceName: 'Fault finding and repairs', variantId: null, variantLabel: '', start: '2026-10-24T10:00', durationMin: 120, status: 'cancelled', cancelReason: 'declined' });
  // The store builds these texts against the diary as it was BEFORE the change, so the booking still holds its window.
  const state = stateOf({ bookings: [sampleBooking({ id: 'bk_other', start: '2026-10-24T08:00', durationMin: 120, serviceId: 'fault' }), { ...booking, status: 'new' }] });
  const declined = buildMessage('customer_declined', booking, state);
  assert.equal(declined.body, "Hi Priya, it's Dan from Voltmere Electrical. Sorry, I can't do Fault finding and repairs on Sat 24 Oct, 10am–12. My next free visit is Mon 26 Oct, 8–10am. Call 07700 900412 if you'd like to talk it through. Ref VM-1043");
  const cancelled = buildMessage('customer_cancelled', { ...booking, cancelReason: "Can't make it" }, state, { reason: "Can't make it" });
  assert.ok(cancelled.body.includes("Reason: Can't make it."));
  const none = buildMessage('customer_cancelled', booking, state);
  assert.ok(!none.body.includes('Reason:'), 'declined has no reason line');
  const urgent = buildMessage('customer_declined', sampleBooking({ serviceId: 'emergency', serviceName: 'Emergency visit', urgent: true, durationMin: 0 }), state);
  assert.ok(urgent.body.includes("Sorry, I can't do your emergency visit."));
  assert.ok(!urgent.body.includes('as soon as possible'));
  // no free slot anywhere: ask them to call
  const settings = makeDefaultSettings();
  settings.hours = [[], [], [], [], [], [], []];
  const closed = buildMessage('customer_declined', booking, stateOf({ settings }));
  assert.ok(closed.body.includes("Please call me and I'll find a time."));
  // an explicit nextFree wins (a string or a slot object)
  assert.ok(buildMessage('customer_declined', booking, state, { nextFree: 'Wed 28 Oct, 1–3pm' }).body.includes('My next free visit is Wed 28 Oct, 1–3pm.'));
  assert.ok(buildMessage('customer_declined', booking, state, { nextFree: { human: 'Thu 29 Oct, 8–10am' } }).body.includes('Thu 29 Oct, 8–10am.'));
});

test('completed message: paid and unpaid wording', () => {
  const unpaid = buildMessage('customer_completed', sampleBooking({ status: 'done', finalPrice: 195 }), stateOf());
  assert.equal(unpaid.body, "Hi Priya, it's Dan from Voltmere Electrical. All done at 14 Alder Row, thanks. The total is £195, payable by card, bank transfer or cash. Your certificate follows today. Ref VM-1043");
  const paid = buildMessage('customer_completed', sampleBooking({ status: 'done', finalPrice: 210, paid: true, paidMethod: 'cash' }), stateOf());
  assert.ok(paid.body.includes('Paid with thanks, £210.'));
});

test('buildMessage shape: PURE, no id or seq, owner and customer recipients', () => {
  const state = stateOf();
  const before = JSON.stringify(state);
  const owner = buildMessage('owner_new_booking', sampleBooking(), state);
  assert.deepEqual(Object.keys(owner).sort(), ['at', 'body', 'bookingId', 'channel', 'kind', 'seed', 'sendAt', 'simulated', 'to', 'toName', 'toPhone'].sort());
  assert.equal(owner.to, 'owner');
  assert.equal(owner.toName, 'Dan Mercer');
  assert.equal(owner.toPhone, '07700 900412');
  assert.equal(owner.channel, 'whatsapp');
  assert.equal(owner.simulated, true);
  assert.equal(owner.seed, false);
  assert.equal(owner.sendAt, null);
  assert.equal(owner.at, '2026-10-23T20:30', 'defaults to the clock');
  assert.equal(owner.bookingId, 'bk_sample01');
  const customer = buildMessage('customer_reminder', sampleBooking(), state, { at: '2026-10-23T21:00', sendAt: '2026-10-25T18:00' });
  assert.equal(customer.to, 'customer');
  assert.equal(customer.toName, 'Priya Nair');
  assert.equal(customer.toPhone, '07700 900231');
  assert.equal(customer.at, '2026-10-23T21:00');
  assert.equal(customer.sendAt, '2026-10-25T18:00');
  assert.equal(JSON.stringify(state), before, 'state untouched');
  for (const kind of TEMPLATE_KINDS) {
    assert.equal(buildMessage(kind, sampleBooking(), state).to, kind.startsWith('owner_') ? 'owner' : 'customer', kind);
  }
});

test('renderTemplate: substitutes, trims lines, collapses spaces, drops empty lines', () => {
  assert.equal(renderTemplate('Hi {a}, it is {b}.', { a: 'Priya', b: 'Dan' }), 'Hi Priya, it is Dan.');
  assert.equal(renderTemplate('one\n{empty}\n  two  \n\n{empty}\nthree', { empty: '' }), 'one\ntwo\nthree');
  assert.equal(renderTemplate('a {x}  b', { x: '' }), 'a b');
  assert.equal(renderTemplate('{x} {x}', { x: '*bold*' }), '*bold* *bold*');
  assert.equal(renderTemplate('no placeholders', {}), 'no placeholders');
  assert.equal(renderTemplate('{n}', { n: 0 }), '0');
  assert.throws(() => renderTemplate('Hello {nobody}', { a: 1 }), /nobody/);
  // a value that itself looks like a placeholder is not substituted again
  assert.equal(renderTemplate('{a}', { a: '{b}', b: 'no' }), '{b}');
});

test('a template typo never blocks a message: buildMessage blanks it and warns', () => {
  const settings = makeDefaultSettings();
  settings.templates = { customer_quote_ready: 'Hi {customerFirst}, quote {oops} ready. Ref {ref}' };
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let msg;
  try {
    msg = buildMessage('customer_quote_ready', sampleBooking(), stateOf({ settings }));
  } finally {
    console.warn = original;
  }
  assert.equal(msg.body, 'Hi Priya, quote ready. Ref VM-1043');
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('oops'));
});

test('settings.templates overrides the default text', () => {
  const settings = makeDefaultSettings();
  settings.templates = { customer_need_access: 'Outside {line1}. Ref {ref}' };
  assert.equal(buildMessage('customer_need_access', sampleBooking(), stateOf({ settings })).body, 'Outside 14 Alder Row. Ref VM-1043');
});

test('waLink digit rules and the demo phone override', () => {
  const text = "Hi Priya, it's Dan & co. 100%?";
  const enc = encodeURIComponent(text);
  assert.equal(waLink('07700 900231', text), `https://wa.me/447700900231?text=${enc}`);
  assert.equal(waLink('+44 7700 900231', text), `https://wa.me/447700900231?text=${enc}`);
  assert.equal(waLink('447700900231', text), `https://wa.me/447700900231?text=${enc}`);
  assert.equal(waLink('00447700900231', text), `https://wa.me/447700900231?text=${enc}`);
  assert.equal(waLink('+44 (0)7700 900231', text), `https://wa.me/447700900231?text=${enc}`);
  assert.equal(waLink('07700 900231', text, '447700900555'), `https://wa.me/447700900555?text=${enc}`);
  assert.equal(waLink('07700 900231', text, ''), `https://wa.me/447700900231?text=${enc}`);
  assert.ok(!waLink('07700 900231', 'a b\nc').includes(' '));
  assert.ok(waLink('07700 900231', 'a b\nc').endsWith('a%20b%0Ac'));
});

test('waShareLink never has a recipient and is never rerouted', () => {
  assert.equal(waShareLink('Book Voltmere online: https://x.example/index.html'), 'https://wa.me/?text=Book%20Voltmere%20online%3A%20https%3A%2F%2Fx.example%2Findex.html');
});

test('telLink, smsLink, mailtoLink, mapsLink', () => {
  assert.equal(telLink('07700 900412'), 'tel:+447700900412');
  assert.equal(smsLink('07700 900412'), 'sms:+447700900412');
  assert.equal(mailtoLink('dan@voltmere.example', 'Hello there', 'Line 1\nLine 2 & more'), 'mailto:dan@voltmere.example?subject=Hello%20there&body=Line%201%0ALine%202%20%26%20more');
  assert.equal(mailtoLink('dan@voltmere.example'), 'mailto:dan@voltmere.example?subject=&body=');
  assert.equal(mapsLink('14 Alder Row', 'MB3 4QP'), 'https://www.google.com/maps/search/?api=1&query=14%20Alder%20Row%2C%20MB3%204QP');
  assert.equal(mapsLink('', 'MB2 6JN'), 'https://www.google.com/maps/search/?api=1&query=MB2%206JN');
});

test('reminderSendAt: 18:00 the evening before, else 07:00 on the day, else null', () => {
  const b = (start) => sampleBooking({ start });
  // plenty of notice: the evening before
  assert.equal(reminderSendAt(b('2026-10-26T08:00'), '2026-10-23T20:30'), '2026-10-25T18:00');
  assert.equal(reminderSendAt(b('2026-10-24T10:00'), '2026-10-23T09:00'), '2026-10-23T18:00');
  // created after 18:00 the evening before: the morning of the visit
  assert.equal(reminderSendAt(b('2026-10-24T10:00'), '2026-10-23T20:30'), '2026-10-24T07:00');
  assert.equal(reminderSendAt(b('2026-10-24T10:00'), '2026-10-23T18:00'), '2026-10-24T07:00', 'exactly 18:00 is not after');
  assert.equal(reminderSendAt(b('2026-10-24T10:00'), '2026-10-23T17:59'), '2026-10-23T18:00');
  // booked on the day itself after 07:00: no reminder
  assert.equal(reminderSendAt(b('2026-10-23T15:00'), '2026-10-23T09:30'), null);
  assert.equal(reminderSendAt(b('2026-10-23T15:00'), '2026-10-23T06:30'), '2026-10-23T07:00');
  assert.equal(reminderSendAt(b('2026-10-23T15:00'), '2026-10-23T07:00'), null, 'exactly 07:00 is not after');
  // month boundary
  assert.equal(reminderSendAt(b('2026-11-01T08:00'), '2026-10-20T09:00'), '2026-10-31T18:00');
});

test('messageIsScheduled: sendAt in the future, derived at render time', () => {
  const now = '2026-10-23T20:30';
  assert.equal(messageIsScheduled({ sendAt: null }, now), false);
  assert.equal(messageIsScheduled({ sendAt: undefined }, now), false);
  assert.equal(messageIsScheduled({ sendAt: '2026-10-25T18:00' }, now), true);
  assert.equal(messageIsScheduled({ sendAt: '2026-10-23T20:31' }, now), true);
  assert.equal(messageIsScheduled({ sendAt: '2026-10-23T20:30' }, now), false, 'due now means sent');
  assert.equal(messageIsScheduled({ sendAt: '2026-10-23T18:00' }, now), false);
});

test('bubbleActions per kind and live booking status (10.6)', () => {
  const now = '2026-10-23T20:30';
  const ids = (m, status, over = {}) => bubbleActions({ kind: m }, sampleBooking({ status, ...over }), now).map((a) => a.id);
  assert.deepEqual(ids('owner_new_booking', 'new'), ['confirm', 'call', 'open_job']);
  assert.deepEqual(ids('owner_new_booking', 'confirmed'), ['open_job', 'call']);
  assert.deepEqual(ids('owner_new_booking', 'on_the_way'), ['open_job', 'call']);
  assert.deepEqual(ids('owner_emergency', 'new'), ['accept_45', 'call', 'open_job']);
  assert.deepEqual(ids('owner_emergency', 'confirmed'), ['open_job', 'call']);
  assert.deepEqual(ids('owner_emergency', 'cancelled'), ['open_job', 'call']);
  for (const status of ['new', 'confirmed', 'done', 'cancelled']) {
    assert.deepEqual(ids('owner_customer_cancelled', status), ['open_job']);
    assert.deepEqual(ids('owner_customer_rescheduled', status), ['open_job']);
  }
  for (const kind of TEMPLATE_KINDS.filter((k) => k.startsWith('customer_'))) assert.deepEqual(ids(kind, 'confirmed'), [], kind);
  // labels
  const actions = bubbleActions({ kind: 'owner_new_booking' }, sampleBooking({ status: 'new' }), now);
  assert.deepEqual(actions, [{ id: 'confirm', label: 'Confirm' }, { id: 'call', label: 'Call Priya' }, { id: 'open_job', label: 'Open job' }]);
  assert.deepEqual(bubbleActions({ kind: 'owner_emergency' }, sampleBooking({ status: 'new' }), now)[0], { id: 'accept_45', label: 'Accept (45 min)' });
  // a booking deleted by a reset
  assert.deepEqual(bubbleActions({ kind: 'owner_new_booking' }, null, now), []);
  assert.deepEqual(bubbleActions({ kind: 'owner_new_booking' }, undefined, now), []);
});
