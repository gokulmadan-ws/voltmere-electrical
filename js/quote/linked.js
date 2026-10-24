// js/quote/linked.js: a quote read from a self-contained share link, for a browser that never saw it. Since v4 that is quote.html#d=<payload>
// (js/core/handoff.js: parseQuoteLink); the v3 form quote.html#q=<id>&d=<payload> still opens too, and is turned into the same data.
// The page builds the same "detail" the store gives for a stored quote (core's quoteDetailFromLink). Link mode NEVER writes to this browser's
// store: the customer's phone has no copy of the owner's diary, so accepting or declining is a WhatsApp message to the owner (js/quote/reply.js).
// Owner: QUOTEPAGE (T03), reworked for v4 by Q4
import { nowStamp } from '../core/clock.js';
import { firstName } from '../core/format.js';
import { parseQuoteLink } from '../core/handoff.js';
import { parseQuotePayload, quoteDetailFromLink, quoteTotal } from '../core/quotes.js';

const sameFirst = (a, b) => firstName(String(a || '').normalize('NFC')).toLowerCase() === firstName(String(b || '').normalize('NFC')).toLowerCase();

/** The v3 payload as the data a v4 link gives (so one code path shows both). `legacy` marks it. */
function fromLegacy(p) {
  const first = firstName(p.customerName);
  return {
    kind: 'quo', id: p.id, quoteId: p.id, ref: '', customerFirst: first, customerName: first, postcode: p.postcode, brand: p.brand, lines: p.lines, total: p.total,
    notes: p.notes, validUntil: p.validUntil, sentAt: p.sentAt, sample: true, legacy: true, ownerFirst: p.ownerFirst
  };
}

/**
 * The parsed link of a route: { link, damaged, reason }. `link` is the data of parseQuoteLink (kind 'quo'), or null.
 * `damaged` is true when the address HAD a d= part that could not be used (cut off, edited, another kind of link, another version);
 * `reason` is why (a parseQuoteLink reason, or 'mismatch' when the address names another quote than the payload carries).
 */
export function readLink(route) {
  const raw = route && route.data ? route.data : '';
  if (!raw) return { link: null, damaged: false, reason: '' };
  const v4 = parseQuoteLink(raw);
  if (v4.ok) {
    // A link whose own reference disagrees with the one in the address is not trusted.
    if (route.id && v4.data.quoteId !== route.id) return { link: null, damaged: true, reason: 'mismatch' };
    return { link: v4.data, damaged: false, reason: '' };
  }
  const old = parseQuotePayload(raw);
  if (old) {
    if (route.id && old.id !== route.id) return { link: null, damaged: true, reason: 'mismatch' };
    return { link: fromLegacy(old), damaged: false, reason: '' };
  }
  return { link: null, damaged: true, reason: v4.reason || 'damaged' };
}

/**
 * What to tell the customer when their link could not be used, in their words (never "checksum" or "payload"), in our voice ("us"). The `owner` parameter stays
 * (the callers pass it) but the page never names him: the landing says "we", and so does this.
 */
export function linkProblemText(reason, owner = 'Daniel') {
  switch (reason) {
    case 'unsupported':
      return 'This link was made by a different version of the site, so it cannot be opened here. Ask us to send it again.';
    case 'invalid':
      return 'The link opened, but something in it cannot be used. Ask us to send it again.';
    case 'wrong_kind':
      return 'This is not a quote link. Open the link we sent for your quote.';
    case 'mismatch':
      return 'The quote number in the address does not match the quote inside the link, so it was not opened. Ask us to send it again.';
    default:
      return 'The link looks cut short or damaged. Copy the whole link from the message and open it again.';
  }
}

/**
 * Should the page show the link's quote instead of what this browser holds under the same reference?
 * Yes when this browser has nothing, when the stored quote is another customer's (two browsers number their quotes alike), when it is
 * a draft (a link only exists for a sent quote), or when it is a demo quote the owner changed and re-sent since.
 * No when it is the same quote: this browser's copy is then the live one (it may already be accepted).
 */
export function linkWins(stored, link) {
  if (!link) return false;
  if (!stored) return true;
  const q = stored.quote;
  if (!sameFirst(q.customerName, link.customerFirst)) return true;
  if (q.status === 'draft') return true;
  return q.seed === true && (q.status === 'sent' || q.status === 'viewed') && !!link.sentAt && link.sentAt > String(q.sentAt || '') && quoteTotal(q) !== link.total;
}

/** The same shape as selectQuoteDetail gives for a stored quote, built from the link (`fromLink` marks it). */
export function detailFromLink(link, nowStampStr = nowStamp()) {
  return quoteDetailFromLink(link, nowStampStr);
}
