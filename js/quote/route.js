// js/quote/route.js: reads the quote reference from the page hash (quote.html#q=<quoteId>) and follows hash changes.
// Owner: Q2 (customer quote page)
import { useEffect, useState } from '../vendor/preact-htm.js';

/**
 * '#q=Q-EL-1043' -> { id: 'Q-EL-1043', preview: false }. '#q=Q-EL-1043&preview=1' marks an owner preview (the view is not counted).
 * A bare '#Q-EL-1043' is tolerated. Anything else gives an empty id.
 */
export function parseQuoteHash(hash) {
  const raw = String(hash === undefined || hash === null ? '' : hash).replace(/^#\/?/, '').trim();
  if (!raw) return { id: '', preview: false };
  if (!raw.includes('=')) return { id: /^Q-/i.test(raw) ? safeDecode(raw).trim() : '', preview: false };
  let params;
  try { params = new URLSearchParams(raw); } catch (e) { return { id: '', preview: false }; }
  return { id: (params.get('q') || '').trim(), preview: params.get('preview') === '1' };
}

function safeDecode(text) {
  try { return decodeURIComponent(text); } catch (e) { return text; }
}

const read = () => parseQuoteHash(typeof location === 'undefined' ? '' : location.hash);

/** The current route, kept in step with the address bar. */
export function useQuoteRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      const next = read();
      setRoute((prev) => (prev.id === next.id && prev.preview === next.preview ? prev : next));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
