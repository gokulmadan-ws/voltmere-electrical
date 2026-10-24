// tests/unit/format.test.mjs: unit tests for js/core/format.js (money, phone, postcode, validators, ids)
// Owner: WP1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClock } from '../../js/core/clock.js';
import { makeDefaultSettings } from '../../js/core/config.js';
import {
  gbp, normalisePhone, isUkMobile, toWaDigits, normaliseDemoPhone, normalisePostcode, isValidPostcode, outwardCode,
  postcodeZone, validateName, validatePhone, validatePostcode, validateLine1, initials, firstName, hashHue, makeId, plural,
  isBtPostcode, outsideAreaLabel, addressLine
} from '../../js/core/format.js';

test('gbp', () => {
  assert.equal(gbp(195), '£195');
  assert.equal(gbp(12.5), '£12.50');
  assert.equal(gbp(0), '£0');
  assert.equal(gbp(-5), '-£5');
  assert.equal(gbp(-12.5), '-£12.50');
  assert.equal(gbp(1099.99), '£1099.99');
  assert.equal(gbp(0.1 + 0.2), '£0.30');
});

test('every UK mobile spelling normalises to 07700 900231 and 447700900231', () => {
  const variants = ['07700900231', '07700 900 231', '07700 900231', '+44 7700 900231', '447700900231', '00447700900231', ' 07700-900-231 ', '+44 (0)7700 900231'];
  for (const v of variants) {
    assert.equal(normalisePhone(v), '07700 900231', v);
    assert.equal(isUkMobile(v), true, v);
    assert.equal(toWaDigits(v), '447700900231', v);
  }
});

test('phones that are not UK mobiles are rejected', () => {
  for (const v of ['01234 567890', '0770090023', '077009002311', 'abcdefghijk', '07700 90023x', '', '   ', null, undefined, '020 7946 0958', '+1 202 555 0123', '07000 123456']) {
    assert.equal(normalisePhone(v), null, String(v));
    assert.equal(isUkMobile(v), false, String(v));
  }
});

test('toWaDigits: leading 0 becomes 44, (0) is dropped, any international number is accepted', () => {
  assert.equal(toWaDigits('+44 (0)7700 900231'), '447700900231');
  assert.equal(toWaDigits('01234 567890'), '441234567890');
  assert.equal(toWaDigits('+1 (202) 555-0123'), '12025550123');
  assert.equal(toWaDigits('0033 1 23 45 67 89'), '33123456789');
  assert.equal(toWaDigits('no digits'), '');
  assert.equal(toWaDigits(''), '');
  assert.equal(toWaDigits(null), '');
});

test('normaliseDemoPhone', () => {
  assert.equal(normaliseDemoPhone(''), '');
  assert.equal(normaliseDemoPhone('   '), '');
  assert.equal(normaliseDemoPhone('07700 900555'), '447700900555');
  assert.equal(normaliseDemoPhone('+44 7700 900555'), '447700900555');
  assert.equal(normaliseDemoPhone('+1 202 555 0123'), '12025550123');
  assert.equal(normaliseDemoPhone('0049 30 1234567'), '49301234567');
  assert.equal(normaliseDemoPhone('+44 20 7946 0958'), '442079460958', 'an international landline is fine for a demo');
  assert.equal(normaliseDemoPhone('12345'), null);
  assert.equal(normaliseDemoPhone('+123'), null);
  assert.equal(normaliseDemoPhone('+1234567890123456'), null, 'more than 15 digits');
  assert.equal(normaliseDemoPhone('hello'), null);
  assert.equal(normaliseDemoPhone('01234 567890'), null, 'a UK landline without + is not a mobile');
});

test('postcodes normalise to one space before the last three characters', () => {
  assert.equal(normalisePostcode('bt9 6qp'), 'BT9 6QP');
  assert.equal(normalisePostcode('BT96QP'), 'BT9 6QP');
  assert.equal(normalisePostcode('  bt10   4xj '), 'BT10 4XJ');
  assert.equal(normalisePostcode('bt485hd'), 'BT48 5HD');
  assert.equal(normalisePostcode('xx'), 'XX');
  assert.equal(normalisePostcode(' ab1 '), 'AB1');
  assert.equal(normalisePostcode(''), '');
  assert.equal(normalisePostcode(null), '');
});

test('isValidPostcode is deliberately lenient', () => {
  assert.equal(isValidPostcode('bt9 6qp'), true);
  assert.equal(isValidPostcode('BT96QP'), true);
  assert.equal(isValidPostcode('AB1 2CD'), true);
  assert.equal(isValidPostcode('M1 1AE'), true);
  assert.equal(isValidPostcode('W1A 0AX'), true);
  assert.equal(isValidPostcode('xx'), false);
  assert.equal(isValidPostcode('12345'), false);
  assert.equal(isValidPostcode('BT9'), false);
  assert.equal(isValidPostcode(''), false);
});

test('outwardCode', () => {
  assert.equal(outwardCode('BT9 6QP'), 'BT9');
  assert.equal(outwardCode('bt104xj'), 'BT10');
  assert.equal(outwardCode('xx'), '');
  assert.equal(outwardCode(''), '');
});

test('postcodeZone', () => {
  const business = makeDefaultSettings().business;
  assert.equal(postcodeZone('BT9 6QP', business), 'covered');
  assert.equal(postcodeZone('BT1 8PY', business), 'covered');
  assert.equal(postcodeZone('BT48 4XJ', business), 'covered', 'Derry/Londonderry');
  assert.equal(postcodeZone('bt94 5hd', business), 'covered', 'every BT district is in the area');
  assert.equal(postcodeZone('BT74 6AB', business), 'covered');
  assert.deepEqual(business.edgeOutward, [], 'there is no edge zone by default');
  assert.equal(postcodeZone('BT9 6QP', { coveredOutward: ['BT1'], edgeOutward: ['BT9'] }), 'edge', 'an owner can still add an edge zone');
  assert.equal(postcodeZone('AB1 2CD', business), 'outside');
  assert.equal(postcodeZone('DG9 8AB', business), 'outside', 'Scotland is outside the area');
  assert.equal(postcodeZone('CH1 1AA', business), 'outside');
  assert.equal(postcodeZone('xx', business), 'invalid');
  assert.equal(postcodeZone('', business), 'invalid');
  assert.equal(postcodeZone('BT9 6QP', { coveredOutward: [], edgeOutward: [] }), 'outside');
  assert.equal(postcodeZone('BT9 6QP', { coveredOutward: ['BT9'], edgeOutward: [] }), 'covered');
});

test('validators return the exact messages of 13.2.3', () => {
  assert.equal(validateName(''), 'Enter your name');
  assert.equal(validateName('A'), 'Enter your name');
  assert.equal(validateName('  '), 'Enter your name');
  assert.equal(validateName('Al'), '');
  assert.equal(validateName('Aoife Magee'), '');

  assert.equal(validatePhone(''), 'Enter your mobile number');
  assert.equal(validatePhone('   '), 'Enter your mobile number');
  assert.equal(validatePhone('01234 567890'), "That doesn't look like a UK mobile. It should start 07 or +44 7");
  assert.equal(validatePhone('abc'), "That doesn't look like a UK mobile. It should start 07 or +44 7");
  assert.equal(validatePhone('07700 900231'), '');
  assert.equal(validatePhone('+447700900231'), '');

  assert.equal(validatePostcode(''), 'Enter your postcode');
  assert.equal(validatePostcode('xx'), 'Enter a UK postcode, like BT9 6QP');
  assert.equal(validatePostcode('BT9 6QP'), '');
  assert.equal(validatePostcode('AB1 2CD'), '');

  assert.equal(validateLine1(''), 'Enter your house number and street');
  assert.equal(validateLine1('   '), 'Enter your house number and street');
  assert.equal(validateLine1('14 Larkfield Gardens'), '');
});

test('initials, firstName, hashHue', () => {
  assert.equal(initials('Aoife Magee'), 'AM');
  assert.equal(initials('priya nair'), 'PN');
  assert.equal(initials('Cher'), 'CH');
  assert.equal(initials('A'), 'A');
  assert.equal(initials('Mary Ann Smith'), 'MS');
  assert.equal(initials(''), '?');
  assert.equal(initials('   '), '?');
  assert.equal(initials(undefined), '?');
  assert.equal(firstName('Aoife Magee'), 'Aoife');
  assert.equal(firstName('  Tom   Hargreaves '), 'Tom');
  assert.equal(firstName('Cher'), 'Cher');
  assert.equal(firstName(''), '');
  for (const name of ['Aoife Magee', 'Padraig Quinn', 'Conor Brennan', '', 'Zoë']) {
    const h = hashHue(name);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 5, name);
    assert.equal(hashHue(name), h, 'stable');
  }
  assert.equal(hashHue('A'), 65 % 6);
});

test('makeId gives 1000 distinct ids under a FROZEN clock', () => {
  setClock(new Date(2026, 9, 23, 20, 30), { frozen: true });
  const ids = new Set();
  for (let i = 0; i < 1000; i += 1) ids.add(makeId('bk'));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^bk_[0-9a-z]{8}$/);
  assert.match(makeId('msg'), /^msg_[0-9a-z]{8}$/);
  setClock(null);
});

test('plural', () => {
  assert.equal(plural(1, 'job'), '1 job');
  assert.equal(plural(2, 'job'), '2 jobs');
  assert.equal(plural(0, 'job'), '0 jobs');
  assert.equal(plural(1, 'person', 'people'), '1 person');
  assert.equal(plural(3, 'person', 'people'), '3 people');
});

test('isBtPostcode: every valid BT postcode is Northern Ireland, nothing else is', () => {
  for (const pc of ['BT1 1AA', 'BT9 6QP', 'bt96qp', 'BT48 4XJ', 'BT82 0AB', 'BT94 5HD', ' bt7 2xx ']) assert.equal(isBtPostcode(pc), true, pc);
  for (const pc of ['DG9 8AB', 'AB1 2CD', 'CH1 1AA', 'BT95 1AA', 'BT0 1AA', 'BTX 1AA', 'B9 6QP', 'xx', '', undefined, null]) assert.equal(isBtPostcode(pc), false, String(pc));
});

test('BT zone logic: the default area covers all of BT1 to BT94, and outsideAreaLabel flags every valid non-BT postcode', () => {
  const business = makeDefaultSettings().business;
  for (let n = 1; n <= 94; n += 1) assert.equal(postcodeZone(`BT${n} 1AA`, business), 'covered', `BT${n}`);
  assert.equal(postcodeZone('BT95 1AA', business), 'outside', 'there is no BT95');
  assert.equal(outsideAreaLabel('DG9 8AB'), 'Outside Northern Ireland');
  assert.equal(outsideAreaLabel('sw1a 1aa'), 'Outside Northern Ireland');
  assert.equal(outsideAreaLabel('BT9 6QP'), '');
  assert.equal(outsideAreaLabel('xx'), '', 'an invalid postcode is a validation problem, not an area one');
  assert.equal(outsideAreaLabel(''), '');
  // the funnel accepts a valid non-BT postcode (it is only flagged), and still rejects junk
  assert.equal(validatePostcode('DG9 8AB'), '');
  assert.equal(validatePostcode('SW1A 1AA'), '');
  assert.equal(validatePostcode('banana'), 'Enter a UK postcode, like BT9 6QP');
});

test('addressLine: street and postcode, or just the postcode when only that was collected', () => {
  assert.equal(addressLine({ line1: '14 Larkfield Gardens', postcode: 'BT9 6QP' }), '14 Larkfield Gardens, BT9 6QP');
  assert.equal(addressLine({ line1: '', postcode: 'BT9 6QP' }), 'BT9 6QP');
  assert.equal(addressLine({ line1: '  ', postcode: 'BT9 6QP' }), 'BT9 6QP');
  assert.equal(addressLine({ postcode: 'BT9 6QP' }), 'BT9 6QP');
  assert.equal(addressLine({ line1: '1 High St' }), '1 High St');
  assert.equal(addressLine(null), '');
  assert.equal(addressLine(undefined), '');
});
