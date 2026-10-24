// tests/unit/ics.test.mjs: unit tests for js/core/ics.js (RFC 5545 calendar file: CRLF, floating times, UTC DTSTAMP, folding)
// Owner: WP1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDefaultSettings } from '../../js/core/config.js';
import { buildIcs, icsFilename, downloadIcs } from '../../js/core/ics.js';

const LONDON = Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/London';

function sampleBooking(over = {}) {
  return {
    id: 'bk_k3j2h9x1', ref: 'VM-1043', createdAt: '2026-10-23T20:30', serviceId: 'eicr', serviceName: 'EICR safety report',
    variantId: 'house', variantLabel: 'House, 2–3 bed', start: '2026-10-26T08:00', durationMin: 240, status: 'confirmed',
    urgent: false, customer: { name: 'Priya Nair', phone: '07700 900231', email: '' }, address: { line1: '14 Alder Row', postcode: 'MB3 4QP' },
    notes: '', quotedPrice: 195, ...over
  };
}

// Undo the folding: CRLF + one space joins a line back together.
const unfold = (text) => text.replace(/\r\n /g, '');
const lines = (text) => unfold(text).split('\r\n').filter((l) => l !== '');
const settings = makeDefaultSettings();

test('the file matches the 10.7 sample line for line', () => {
  const ics = buildIcs(sampleBooking(), settings);
  const stamp = new Date(2026, 9, 23, 20, 30).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  assert.deepEqual(lines(ics), [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Voltmere Electrical//Prototype//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:bk_k3j2h9x1@voltmere.example',
    `DTSTAMP:${stamp}`,
    'DTSTART:20261026T080000',
    'DTEND:20261026T120000',
    'SUMMARY:Voltmere Electrical: EICR safety report',
    'LOCATION:14 Alder Row\\, MB3 4QP',
    'DESCRIPTION:Arriving between 8 and 10am.\\nRef VM-1043.\\nTo change or cancel call 07700 900412.',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ]);
});

test('every line ends with CRLF and there is no bare LF', () => {
  const ics = buildIcs(sampleBooking(), settings);
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/(^|[^\r])\n/.test(ics), 'a bare LF was found');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
});

test('DTSTART and DTEND are floating local times with no Z and no TZID; DTSTAMP is the ONE UTC value', () => {
  const ics = buildIcs(sampleBooking(), settings);
  assert.match(ics, /\r\nDTSTART:20261026T080000\r\n/);
  assert.match(ics, /\r\nDTEND:20261026T120000\r\n/);
  assert.ok(!/TZID/.test(ics));
  assert.ok(!/DT(START|END)[^\r]*Z/.test(ics));
  assert.match(ics, /\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/);
  assert.equal((ics.match(/\d{8}T\d{6}Z/g) || []).length, 1, 'only DTSTAMP is UTC');
  // createdAt 20:30 local: 20:30 BST is 19:30Z in London
  const stamp = /DTSTAMP:(\S+)/.exec(ics)[1];
  assert.equal(stamp, new Date(2026, 9, 23, 20, 30).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
  if (LONDON) assert.equal(stamp, '20261023T193000Z');
  // a winter createdAt is GMT: the same wall-clock time is the same UTC time
  const winter = buildIcs(sampleBooking({ createdAt: '2026-11-02T20:30' }), settings);
  if (LONDON) assert.match(winter, /DTSTAMP:20261102T203000Z/);
});

test('DTEND is start plus durationMin', () => {
  assert.match(buildIcs(sampleBooking({ start: '2026-10-24T08:00', durationMin: 120 }), settings), /DTSTART:20261024T080000\r\nDTEND:20261024T100000\r\n/);
  assert.match(buildIcs(sampleBooking({ start: '2026-10-26T13:00', durationMin: 240 }), settings), /DTSTART:20261026T130000\r\nDTEND:20261026T170000\r\n/);
  assert.match(buildIcs(sampleBooking({ start: '2026-10-24T10:00', durationMin: 120 }), settings), /DTEND:20261024T120000/);
});

test('STATUS follows the booking status and the description follows the window', () => {
  assert.match(buildIcs(sampleBooking({ status: 'new' }), settings), /STATUS:TENTATIVE/);
  assert.match(buildIcs(sampleBooking({ status: 'confirmed' }), settings), /STATUS:CONFIRMED/);
  assert.match(buildIcs(sampleBooking({ status: 'on_the_way' }), settings), /STATUS:CONFIRMED/);
  assert.match(buildIcs(sampleBooking({ status: 'cancelled' }), settings), /STATUS:CANCELLED/);
  const afternoon = buildIcs(sampleBooking({ start: '2026-10-26T13:00' }), settings);
  assert.ok(afternoon.includes('DESCRIPTION:Arriving between 1 and 3pm.'));
  const second = buildIcs(sampleBooking({ start: '2026-10-24T10:00', durationMin: 120 }), settings);
  assert.ok(second.includes('DESCRIPTION:Arriving between 10am and 12.'));
});

test('text values escape comma, semicolon, backslash and newline', () => {
  const booking = sampleBooking({ serviceName: 'Lights, sockets; and a \\ slash', address: { line1: 'Flat 2, 10 High St; rear', postcode: 'MB3 4QP' } });
  const ics = buildIcs(booking, settings);
  assert.ok(ics.includes('SUMMARY:Voltmere Electrical: Lights\\, sockets\\; and a \\\\ slash'));
  assert.ok(ics.includes('LOCATION:Flat 2\\, 10 High St\\; rear\\, MB3 4QP'));
  const custom = makeDefaultSettings();
  custom.business.name = 'Ashby, Sparks & Sons';
  custom.business.phone = '07700 900555';
  const text = buildIcs(sampleBooking(), custom);
  assert.ok(text.includes('SUMMARY:Ashby\\, Sparks & Sons: EICR safety report'));
  assert.ok(text.includes('call 07700 900555.'));
  // a literal newline in a value becomes the two characters \n
  const withNewline = buildIcs(sampleBooking({ serviceName: 'Line one\nLine two' }), settings);
  assert.ok(withNewline.includes('SUMMARY:Voltmere Electrical: Line one\\nLine two'));
  assert.ok(!withNewline.replace(/\r\n/g, '|').includes('\n'), 'no raw newline inside a value');
});

test('lines longer than 75 octets are folded with CRLF + space, never inside a character', () => {
  const long = `${'A very long street name with “curly” – dashes and £ signs, '.repeat(6)}`;
  const booking = sampleBooking({ address: { line1: long, postcode: 'MB3 4QP' } });
  const ics = buildIcs(booking, settings);
  const physical = ics.split('\r\n');
  assert.ok(physical.some((l) => l.startsWith(' ')), 'something was folded');
  for (const line of physical) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `too long (${Buffer.byteLength(line, 'utf8')} octets): ${line}`);
    assert.ok(!line.includes('�'));
  }
  // unfolding restores the exact original line
  const location = lines(ics).find((l) => l.startsWith('LOCATION:'));
  assert.equal(location, `LOCATION:${`${long}, MB3 4QP`.replace(/,/g, '\\,')}`);
  // multibyte characters survive a round trip through bytes
  const bytes = Buffer.from(ics, 'utf8');
  assert.equal(bytes.toString('utf8'), ics);
  // a line of exactly 75 octets is not folded
  const exact = sampleBooking({ serviceName: 'x'.repeat(75 - 'SUMMARY:Voltmere Electrical: '.length) });
  const exactIcs = buildIcs(exact, settings);
  assert.ok(exactIcs.includes(`SUMMARY:Voltmere Electrical: ${'x'.repeat(75 - 'SUMMARY:Voltmere Electrical: '.length)}\r\n`));
  const over = sampleBooking({ serviceName: 'x'.repeat(76 - 'SUMMARY:Voltmere Electrical: '.length) });
  assert.ok(buildIcs(over, settings).includes('\r\n x\r\n'), 'the 76th octet moves to a continuation line');
});

test('UID is the booking id at the business email domain, else prototype.invalid', () => {
  assert.match(buildIcs(sampleBooking(), settings), /\r\nUID:bk_k3j2h9x1@voltmere\.example\r\n/);
  const noEmail = makeDefaultSettings();
  noEmail.business.email = '';
  assert.match(buildIcs(sampleBooking(), noEmail), /\r\nUID:bk_k3j2h9x1@prototype\.invalid\r\n/);
  const other = makeDefaultSettings();
  other.business.email = 'lee@ashby.example';
  assert.match(buildIcs(sampleBooking(), other), /UID:bk_k3j2h9x1@ashby\.example/);
});

test('icsFilename is the short name, lower-cased, then the ref', () => {
  assert.equal(icsFilename(sampleBooking(), settings), 'voltmere-VM-1043.ics');
  const custom = makeDefaultSettings();
  custom.business.shortName = 'Ashby Sparks!';
  assert.equal(icsFilename(sampleBooking(), custom), 'ashby-sparks-VM-1043.ics');
  custom.business.shortName = '!!!';
  assert.equal(icsFilename(sampleBooking(), custom), 'booking-VM-1043.ics');
});

test('an urgent request with no duration still produces a valid one-hour event', () => {
  const urgent = sampleBooking({ urgent: true, durationMin: 0, start: '2026-10-23T20:30', address: { line1: '', postcode: 'MB2 6JN' } });
  const ics = buildIcs(urgent, settings);
  assert.match(ics, /DTSTART:20261023T203000\r\nDTEND:20261023T213000\r\n/);
  assert.ok(ics.includes('LOCATION:MB2 6JN\r\n'));
  assert.ok(ics.includes('DESCRIPTION:Arriving as soon as possible.'));
});

test('downloadIcs is safe in Node (no document) and clicks a temporary link in a browser', () => {
  assert.equal(downloadIcs(sampleBooking(), settings), false);

  const clicks = [];
  const anchor = { style: {}, click() { clicks.push({ href: this.href, download: this.download }); } };
  const appended = [];
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const revoked = [];
  const originalRevoke = URL.revokeObjectURL;
  globalThis.document = {
    createElement: (tag) => { assert.equal(tag, 'a'); return anchor; },
    body: { appendChild: (el) => appended.push(el), removeChild: (el) => appended.splice(appended.indexOf(el), 1) }
  };
  globalThis.setTimeout = (fn) => { fn(); return 0; };
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    assert.equal(downloadIcs(sampleBooking(), settings), true);
  } finally {
    globalThis.document = originalDocument;
    if (originalDocument === undefined) delete globalThis.document;
    globalThis.setTimeout = originalSetTimeout;
    URL.revokeObjectURL = originalRevoke;
  }
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].download, 'voltmere-VM-1043.ics');
  assert.match(clicks[0].href, /^blob:/);
  assert.equal(appended.length, 0, 'the temporary link is removed again');
  assert.deepEqual(revoked, [clicks[0].href]);
});
