// js/quote/install-ics.js: the calendar file for the install day, built on core's buildIcs and labelled "To be confirmed" until Daniel has confirmed the day.
// Owner: Q2 (customer quote page)
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

const esc = (text) => String(text === null || text === undefined ? '' : text).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** True while the owner has not confirmed the day: its calendar entry must say so. */
export const isProvisionalInstall = (booking) => !!booking && booking.status === 'new';

/**
 * The .ics text for the install day. A confirmed day is core's file with a clearer title; a day still waiting for the owner keeps core's
 * STATUS:TENTATIVE and carries "To be confirmed" in the title and the notes, so nobody plans around a day that has not been agreed.
 */
export function installIcs(booking, settings, quote) {
  const base = buildIcs(booking, settings);
  const biz = settings.business;
  const provisional = isProvisionalInstall(booking);
  const ids = bookingWindowIds(booking);
  const arrive = ids.length ? WINDOWS[ids[0]].arrive : '';
  const notes = [
    provisional ? `TO BE CONFIRMED: ${biz.ownerFirstName} has not confirmed this day yet.` : 'Confirmed.',
    arrive ? `Home EV charger installation, arriving ${arrive}.` : 'Home EV charger installation.',
    quote ? `Quote ${quote.id}.` : '',
    `Ref ${booking.ref}.`,
    `To change or cancel call ${biz.phone}.`
  ].filter(Boolean).join('\n');
  const lines = base.replace(/\r\n[ \t]/g, '').split('\r\n').map((line) => {
    if (line.startsWith('SUMMARY:')) return `SUMMARY:${esc(`${provisional ? 'To be confirmed: ' : ''}EV charger installation, ${biz.name}`)}`;
    if (line.startsWith('DESCRIPTION:')) return `DESCRIPTION:${esc(notes)}`;
    return line;
  });
  return lines.map(fold).join('\r\n');
}

/** Browser only: offers the file to save. Returns true when the download was started. */
export function downloadInstallIcs(booking, settings, quote) {
  return saveFile(icsFilename(booking, settings), installIcs(booking, settings, quote), 'text/calendar;charset=utf-8');
}
