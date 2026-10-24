// js/core/ics.js: builds the downloadable calendar file (RFC 5545) for a booking
// Owner: WP1
import { WINDOWS } from './config.js';
import { addMinutes, parseStamp, stampDay, stampTime } from './dates.js';
import { bookingWindowIds } from './availability.js';

// UTF-8 length of one code point, so folding never splits a character and never exceeds 75 octets.
function octets(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/** Fold a content line at 75 octets: CRLF plus one space continues it. */
function fold(line) {
  const parts = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = octets(ch);
    if (bytes + n > 75) {
      parts.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n');
}

/** Escape a TEXT value: backslash first, then ; , and newlines. */
function esc(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// '2026-10-26T08:00' -> '20261026T080000' (floating local time: no Z, no TZID)
function floating(stamp) {
  return `${stampDay(stamp).replace(/-/g, '')}T${stampTime(stamp).replace(':', '')}00`;
}

// DTSTAMP is the ONE UTC value (RFC 5545 requires it): '2026-10-23T19:30:00.000Z' -> '20261023T193000Z'
function utcStamp(stamp) {
  return `${parseStamp(stamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

function domainOf(settings) {
  const email = String((settings.business && settings.business.email) || '');
  const at = email.lastIndexOf('@');
  return at >= 0 && at < email.length - 1 ? email.slice(at + 1).trim() : 'prototype.invalid';
}

/** The .ics text (CRLF line endings, folded at 75 octets). */
export function buildIcs(booking, settings) {
  const biz = settings.business;
  const ids = bookingWindowIds(booking);
  const arrive = ids.length ? WINDOWS[ids[0]].arrive : null;
  // CONTRACT-GAP: a job with no duration (an urgent request) gets a one-hour calendar block.
  const minutes = booking.durationMin > 0 ? booking.durationMin : 60;
  const description = [
    arrive ? `Arriving ${arrive}.` : 'Arriving as soon as possible.',
    `Ref ${booking.ref}.`,
    `To change or cancel call ${biz.phone}.`
  ].join('\n');
  const status = booking.status === 'new' ? 'TENTATIVE' : booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
  const location = booking.address.line1 ? `${booking.address.line1}, ${booking.address.postcode}` : booking.address.postcode;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${esc(biz.name)}//Prototype//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@${domainOf(settings)}`,
    `DTSTAMP:${utcStamp(booking.createdAt)}`,
    `DTSTART:${floating(booking.start)}`,
    `DTEND:${floating(addMinutes(booking.start, minutes))}`,
    `SUMMARY:${esc(`${biz.name}: ${booking.serviceName}`)}`,
    `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(description)}`,
    `STATUS:${status}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** 'voltmere-VM-1043.ics' */
export function icsFilename(booking, settings) {
  const short = String(settings.business.shortName || 'booking').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${short || 'booking'}-${booking.ref}.ics`;
}

/** Browser only: saves the file through a temporary link. Safe to import (and to call) in Node, where it does nothing. */
export function downloadIcs(booking, settings) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
  const blob = new Blob([buildIcs(booking, settings)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFilename(booking, settings);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click has been handled; revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
