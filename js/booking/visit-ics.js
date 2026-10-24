// js/booking/visit-ics.js: the calendar file for a pencilled-in survey visit, labelled provisional (built on core's buildIcs).
// Owner: D3
import { buildIcs, icsFilename } from '../core/ics.js';
import { WINDOWS } from '../core/config.js';
import { bookingWindowIds } from '../core/availability.js';
import { saveFile } from '../ui/util.js';

// Same folding and escaping rules as core/ics.js (RFC 5545): 75 octets a line, CRLF plus a space continues it, escape \ ; , and newlines.
function octets(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

function fold(line) {
  const parts = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = octets(ch);
    if (bytes + n > 75) { parts.push(cur); cur = ' '; bytes = 1; }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n');
}

const esc = (text) => String(text === null || text === undefined ? '' : text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** True while the visit is only pencilled in (the owner has not confirmed it): its calendar entry must say so. */
export const isProvisionalVisit = (booking) => !!booking && booking.status === 'new';

/**
 * The .ics text for the survey visit. A confirmed visit is core's file as it is (STATUS:CONFIRMED). A pencilled-in one keeps core's
 * STATUS:TENTATIVE and gets "PROVISIONAL" in the title and the notes, so nobody plans around a time that has not been agreed.
 */
export function visitIcs(booking, settings) {
  const base = buildIcs(booking, settings);
  if (!isProvisionalVisit(booking)) return base;
  const biz = settings.business;
  const ids = bookingWindowIds(booking);
  const arrive = ids.length ? WINDOWS[ids[0]].arrive : '';
  const notes = [
    `PROVISIONAL: pencilled in, not confirmed until ${biz.ownerFirstName} confirms it.`,
    arrive ? `Free survey visit, arriving ${arrive}.` : 'Free survey visit.',
    `Ref ${booking.ref}.`,
    `To change or cancel call ${biz.phone}.`
  ].join('\n');
  const lines = base.replace(/\r\n[ \t]/g, '').split('\r\n').map((line) => {
    if (line.startsWith('SUMMARY:')) return `SUMMARY:${esc(`PROVISIONAL: free survey visit, ${biz.name}`)}`;
    if (line.startsWith('DESCRIPTION:')) return `DESCRIPTION:${esc(notes)}`;
    return line;
  });
  return lines.map(fold).join('\r\n');
}

/** Browser only: offers the file to save. Returns true when the download was started. */
export function downloadVisitIcs(booking, settings) {
  return saveFile(icsFilename(booking, settings), visitIcs(booking, settings), 'text/calendar;charset=utf-8');
}
