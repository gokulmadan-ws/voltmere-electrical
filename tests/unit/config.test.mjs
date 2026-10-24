// tests/unit/config.test.mjs: unit tests for js/core/config.js (180 Electrical defaults, services, enquiry questions and answers)
// Owner: WP1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEMPLATES, DEFAULT_UNSCHEDULED_TEMPLATES, ENQUIRY_ANSWER_HEADINGS, ENQUIRY_ANSWER_KEYS, ENQUIRY_STEPS, PROMISES, SCHEMA_VERSION, STORAGE_KEYS, answerLabel, answersLine,
  makeDefaultSettings, makeDefaultQuoteItems, normaliseAnswers
} from '../../js/core/config.js';
import { servicePriceLabel } from '../../js/core/selectors.js';

test('the business defaults are his real, public details (and nothing invented)', () => {
  const biz = makeDefaultSettings().business;
  assert.equal(biz.name, '180 Electrical');
  assert.equal(biz.shortName, '180');
  assert.equal(biz.tagline, 'Home EV charger installation across Northern Ireland.');
  assert.equal(biz.ownerFirstName, 'Daniel');
  assert.equal(biz.phone, '07885 496800');
  assert.equal(biz.email, 'daniel@180electrical.co.uk');
  assert.equal(biz.areaName, 'Northern Ireland');
  assert.equal(biz.areaText, 'Serving Northern Ireland');
  assert.deepEqual(biz.credentials, ['Level 3 Electrical Installation', '2391 Inspection and Testing']);
  assert.deepEqual(biz.brands, ['ZAPPI', 'OHME', 'SYNC']);
  assert.equal(biz.schemeLine, '', 'his site makes no scheme claim');
  assert.equal(biz.insuranceLine, '', 'his site makes no insurance claim');
  assert.equal(biz.coveredOutward.length, 94);
  assert.deepEqual(biz.edgeOutward, []);
});

test('storage keys keep their names; the schema is v3 (quotes, pipeline, connections) and adds the utm session key', () => {
  assert.equal(SCHEMA_VERSION, 3);
  assert.deepEqual(STORAGE_KEYS, { state: 'vm_state_v1', theme: 'vm_theme', draft: 'vm_draft_v1', bootFail: 'vm_boot_fail', utm: 'vm_utm', backup: 'vm_state_backup' });
  assert.equal(PROMISES.contactWithinHours, 24);
});

test('settings defaults: dark theme, emergency path off, a fresh deep copy every call', () => {
  const a = makeDefaultSettings();
  assert.equal(a.theme, 'dark');
  assert.equal(a.takingEmergencies, false);
  assert.equal(a.autoConfirm, true);
  assert.equal(a.remindersOn, true);
  const b = makeDefaultSettings();
  assert.notEqual(a.services, b.services);
  assert.notEqual(a.business.credentials, b.business.credentials);
  a.business.brands.push('X');
  a.services[0].name = 'changed';
  assert.deepEqual(b.business.brands, ['ZAPPI', 'OHME', 'SYNC']);
  assert.equal(b.services[0].name, 'Home EV charger quote');
});

test('services: ev_quote first and the only one on the website; ev is quote-led; the rest are hidden phone jobs', () => {
  const { services } = makeDefaultSettings();
  assert.deepEqual(services.map((s) => s.id), ['ev_quote', 'ev', 'fault', 'eicr', 'consumer', 'sockets', 'rewire', 'emergency']);
  const quote = services[0];
  assert.equal(quote.name, 'Home EV charger quote');
  assert.equal(quote.priceType, 'free');
  assert.equal(quote.price, 0);
  assert.equal(servicePriceLabel(quote), 'Free');
  assert.equal(quote.blocks, 1);
  assert.equal(quote.durationMin, 120, 'one 2-hour window');
  assert.equal(quote.showOnWebsite, true);
  assert.equal(quote.active, true);
  const ev = services[1];
  assert.equal(ev.name, 'EV charger installation');
  assert.equal(ev.priceType, 'quoted');
  assert.equal(servicePriceLabel(ev), 'Quoted for your home');
  assert.equal(ev.blocks, 2, 'half a day');
  assert.equal(ev.durationMin, 240);
  assert.equal(ev.showOnWebsite, false, 'arranged after the quote; the owner books it from the dashboard');
  for (const s of services.slice(1)) assert.equal(s.showOnWebsite, false, `${s.id} is hidden from the website`);
  assert.deepEqual(services.filter((s) => s.showOnWebsite).map((s) => s.id), ['ev_quote']);
  assert.ok(services.every((s) => s.active), 'they all stay in the data for owner-entered phone jobs');
  assert.ok(!/£|\d/.test(servicePriceLabel(ev)), 'no number is shown for the installation');
});

test('ENQUIRY_STEPS: the four choice questions (his funnel, step 5 reworded for tenants), steps 2 to 5 in order', () => {
  assert.deepEqual(ENQUIRY_STEPS.map((s) => [s.key, s.step]), [['parking', 2], ['vehicle', 3], ['timing', 4], ['permission', 5]]);
  assert.deepEqual(ENQUIRY_STEPS.map((s) => s.title), [
    'Where would you normally park to charge?',
    'Do you already have your electric or plug-in hybrid car?',
    'When would you like your charger installed?',
    'Can you authorise installation work at the property?'
  ]);
  assert.equal(ENQUIRY_STEPS[0].note, 'Whatever you pick, we will check that a safe cable route and parking position can be arranged.');
  assert.equal(ENQUIRY_STEPS[1].note, '');
  assert.equal(ENQUIRY_STEPS[2].note, '');
  assert.equal(ENQUIRY_STEPS[3].note, "Not sure yet? That's fine. We will help you work out what is needed.");
  assert.deepEqual(ENQUIRY_STEPS[0].options, [
    { value: 'driveway', label: 'Private driveway' },
    { value: 'garage', label: 'Garage' },
    { value: 'allocated', label: 'Allocated parking space' },
    { value: 'street', label: 'On-street parking' },
    { value: 'other', label: 'Other or not sure' }
  ]);
  assert.deepEqual(ENQUIRY_STEPS[1].options.map((o) => [o.value, o.label]), [['have', 'Yes'], ['ordered', "It's ordered or arriving soon"], ['choosing', "I'm choosing one"]]);
  assert.deepEqual(ENQUIRY_STEPS[2].options.map((o) => [o.value, o.label]), [
    ['asap', 'As soon as possible'], ['month', 'Within the next month'], ['one_to_three', 'Within 1 to 3 months'], ['researching', 'Just researching']
  ]);
  assert.deepEqual(ENQUIRY_STEPS[3].options.map((o) => [o.value, o.label]), [['yes', 'Yes'], ['landlord', 'I need landlord or freeholder approval'], ['unsure', "I'm not sure"]]);
  for (const step of ENQUIRY_STEPS) for (const o of step.options) assert.ok(!/^[A-E][.)]?\s/.test(o.label), 'no A/B/C letter in a label');
  assert.deepEqual(ENQUIRY_ANSWER_KEYS, ['postcode', 'parking', 'vehicle', 'timing', 'permission']);
  assert.deepEqual(Object.keys(ENQUIRY_ANSWER_HEADINGS), ENQUIRY_ANSWER_KEYS);
});

test('answerLabel: the verbatim label, the postcode itself, and an empty string for anything unknown', () => {
  assert.equal(answerLabel('parking', 'driveway'), 'Private driveway');
  assert.equal(answerLabel('parking', 'other'), 'Other or not sure');
  assert.equal(answerLabel('vehicle', 'ordered'), "It's ordered or arriving soon");
  assert.equal(answerLabel('timing', 'one_to_three'), 'Within 1 to 3 months');
  assert.equal(answerLabel('permission', 'landlord'), 'I need landlord or freeholder approval');
  assert.equal(answerLabel('postcode', 'BT9 6QP'), 'BT9 6QP');
  assert.equal(answerLabel('postcode', undefined), '');
  assert.equal(answerLabel('parking', 'moon'), '');
  assert.equal(answerLabel('parking', undefined), '');
  assert.equal(answerLabel('nope', 'driveway'), '');
  // every option of every step round-trips
  for (const step of ENQUIRY_STEPS) for (const o of step.options) assert.equal(answerLabel(step.key, o.value), o.label);
  // a value from another question is not valid here
  assert.equal(answerLabel('vehicle', 'driveway'), '');
});

test('normaliseAnswers: unknown keys ignored, invalid values dropped, null when nothing valid', () => {
  assert.equal(normaliseAnswers(undefined), null);
  assert.equal(normaliseAnswers(null), null);
  assert.equal(normaliseAnswers('driveway'), null);
  assert.equal(normaliseAnswers([]), null);
  assert.equal(normaliseAnswers({}), null);
  assert.equal(normaliseAnswers({ parking: 'moon', whatever: 1 }), null);
  assert.equal(normaliseAnswers({}, 'BT9 6QP'), null, 'a fallback postcode alone does not make an answers object');
  assert.deepEqual(
    normaliseAnswers({ postcode: 'bt96qp', parking: 'garage', vehicle: 'have', timing: 'month', permission: 'unsure', marketingOptIn: true, extra: 'x' }),
    { postcode: 'BT9 6QP', parking: 'garage', vehicle: 'have', timing: 'month', permission: 'unsure', marketingOptIn: true }
  );
  assert.deepEqual(normaliseAnswers({ parking: 'moon', vehicle: 'ordered', timing: 3, permission: null, marketingOptIn: 'yes' }), { vehicle: 'ordered' }, 'invalid values are dropped one by one');
  assert.deepEqual(normaliseAnswers({ parking: 'street' }, 'bt1 1aa'), { postcode: 'BT1 1AA', parking: 'street' }, 'the postcode falls back to the address postcode');
  assert.deepEqual(normaliseAnswers({ postcode: 'nonsense', parking: 'street' }, 'BT2 2BB'), { postcode: 'BT2 2BB', parking: 'street' });
  assert.deepEqual(normaliseAnswers({ postcode: 'nonsense', parking: 'street' }), { parking: 'street' });
  assert.deepEqual(normaliseAnswers({ marketingOptIn: false }), { marketingOptIn: false });
});

test('answersLine: one compact line for the owner alert', () => {
  assert.equal(
    answersLine({ postcode: 'BT42 6JN', parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }),
    'Parking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.'
  );
  assert.equal(answersLine({ parking: 'allocated', vehicle: 'have', timing: 'month', permission: 'landlord' }), 'Parking: allocated space. Car: has one. Timing: within a month. Permission: needs landlord approval.');
  assert.equal(answersLine({ parking: 'street', vehicle: 'choosing', timing: 'one_to_three', permission: 'unsure' }), 'Parking: on-street. Car: still choosing. Timing: 1 to 3 months. Permission: not sure.');
  assert.equal(answersLine({ parking: 'other', timing: 'researching' }), 'Parking: other or not sure. Timing: just researching.');
  assert.equal(answersLine({ parking: 'moon' }), '');
  assert.equal(answersLine(undefined), '');
  assert.equal(answersLine(null), '');
  assert.ok(!answersLine({ parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }).includes('!'));
});

test('the default content says only what he has said: the sample quote catalogue and terms carry no product, guarantee or payment wording', () => {
  const settings = makeDefaultSettings();
  assert.equal(settings.quoteDefaults.notes, 'Sample terms: Daniel sets his own.');
  const claim = /guarantee|warranty|year|kw\b|smart|app\b|pay\b|payment|deposit|card|cash|transfer|invoice|interest|insured|certified|\bgrant\b|\bfree\b/i;
  for (const item of makeDefaultQuoteItems()) {
    assert.ok(!item.detail, `${item.id} has no detail text`);
    assert.ok(!claim.test(item.label.replace(/Testing and certification/, '')), `${item.id}: "${item.label}" reads as a plain line item`);
  }
  assert.ok(!claim.test(settings.quoteDefaults.notes));
  assert.deepEqual(makeDefaultQuoteItems().filter((i) => i.optional).map((i) => i.label), ['Consumer unit upgrade (if required)']);
});

test('the default messages a customer receives use his words: no pencilled or provisional status, no payment terms or methods he never wrote', () => {
  const vocabulary = /pencil|provisional|pay after|payable|bank transfer|by card|cash\b|guarantee|free survey/i;
  const customerKinds = Object.keys(DEFAULT_TEMPLATES).filter((k) => k.startsWith('customer_'));
  assert.ok(customerKinds.length >= 15);
  for (const kind of customerKinds) assert.ok(!vocabulary.test(DEFAULT_TEMPLATES[kind]), `${kind}: ${DEFAULT_TEMPLATES[kind]}`);
  for (const kind of Object.keys(DEFAULT_UNSCHEDULED_TEMPLATES).filter((k) => k.startsWith('customer_'))) assert.ok(!vocabulary.test(DEFAULT_UNSCHEDULED_TEMPLATES[kind]), kind);
});
