// js/quote/route.js: reads the quote from the page hash and follows hash changes. The hash is quote.html#q=<quoteId> (this browser's own copy),
// quote.html#d=<payload> (v4: the quote travels inside the link) or the v3 quote.html#q=<quoteId>&d=<payload>.
// Owner: Q2 (customer quote page), v4 by Q4
import { useEffect, useState } from '../vendor/preact-htm.js';
import { quoteShareUrl } from '../core/quotes.js';
import { parseQuoteLink } from '../core/handoff.js';

/**
 * '#q=Q-EL-1043' -> { id: 'Q-EL-1043', preview: false, data: '' }. '#q=Q-EL-1043&preview=1' marks an owner preview (the view is not counted).
 * '#d=<base64url>' is the v4 self-contained share link (no id: the payload names the quote) and '#q=Q-EL-1043&d=<base64url>' the v3 one:
 * `data` is the raw payload either way (js/quote/linked.js reads it).
 * A bare '#Q-EL-1043' is tolerated. Anything else gives an empty id.
 */
export function parseQuoteHash(hash) {
  const raw = String(hash === undefined || hash === null ? '' : hash).replace(/^#\/?/, '').trim();
  if (!raw) return { id: '', preview: false, data: '' };
  if (!raw.includes('=')) return { id: /^Q-/i.test(raw) ? safeDecode(raw).trim() : '', preview: false, data: '' };
  let params;
  try { params = new URLSearchParams(raw); } catch (e) { return { id: '', preview: false, data: '' }; }
  return { id: (params.get('q') || '').trim(), preview: params.get('preview') === '1', data: (params.get('d') || '').trim() };
}

function safeDecode(text) {
  try { return decodeURIComponent(text); } catch (e) { return text; }
}

/**
 * The address-bar hash that makes a stored quote's link work on ANY phone: '#d=<payload>' (plus '&preview=1' for an owner preview).
 * `extra` = { booking?, postcode?, ref? } as core's quoteLink takes it. '' when the quote cannot be carried (nothing to carry, or the
 * payload would be too long for the page to read back).
 */
export function shareHash(quote, extra = {}, { preview = false } = {}) {
  let url = '';
  try { url = quoteShareUrl(quote, extra); } catch (e) { return ''; }
  const at = url.indexOf('#');
  if (at < 0) return '';
  const hash = url.slice(at);
  const { data } = parseQuoteHash(hash);
  if (!data || !parseQuoteLink(data).ok) return '';
  return preview ? `${hash}&preview=1` : hash;
}

/**
 * Put `hash` in the address bar without adding a history entry. replaceState raises no hashchange, so the route state is not touched:
 * nothing re-renders and the view is not counted again. Returns whether the address changed.
 */
export function replaceHash(hash) {
  if (!hash || typeof history === 'undefined' || typeof history.replaceState !== 'function' || typeof location === 'undefined') return false;
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
    return true;
  } catch (e) {
    return false;
  }
}

const read = () => parseQuoteHash(typeof location === 'undefined' ? '' : location.hash);

/** The current route, kept in step with the address bar. */
export function useQuoteRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      // An in-page jump such as '#q2-main' (the skip link) is not a different quote.
      if (/^#q2-/.test(location.hash)) return;
      const next = read();
      setRoute((prev) => (prev.id === next.id && prev.preview === next.preview && prev.data === next.data ? prev : next));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
