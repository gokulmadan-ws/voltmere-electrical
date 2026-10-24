// js/quote/page.js: the quote page. Same-browser mode: the quote is in this browser's store (the live copy). Link mode: this browser never saw the
// quote, so it is read from the link itself (quote.html#d=<payload>), and Accept / Not for me become a WhatsApp message to the owner (js/quote/reply.js).
// Counts a stored quote's view once, and shows the right state (open, expired, accepted, declined, message ready, not ready, not found).
// Owner: Q2 (customer quote page), link mode by Q4
import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { useNow, useStore } from '../ui/index.js';
import { recordQuoteViewed } from '../core/store.js';
import { selectBrand, selectQuoteDetail } from '../core/selectors.js';
import { parseQuoteHash, replaceHash, shareHash, useQuoteRoute } from './route.js';
import { detailFromLink, linkWins, readLink } from './linked.js';
import { OpenView } from './open.js';
import { AcceptedView } from './confirmed.js';
import { DeclinedView, DraftView, InvalidView } from './states.js';
import { LinkSentView, forgetReply, readReply, replyFits } from './reply.js';
import { QuoteModeContext } from './parts.js';
import { installPostcode } from './format.js';

const wholeState = (state) => state;

/** Which screen a quote's EFFECTIVE status gets. */
export function viewFor(detail) {
  if (!detail) return 'invalid';
  switch (detail.status) {
    case 'accepted': return 'accepted';
    case 'declined': return 'declined';
    case 'draft': return 'draft';
    default: return 'open'; // sent, viewed, expired
  }
}

export function QuotePage() {
  const route = useQuoteRoute();
  const state = useStore(wholeState);
  useNow(30000); // so a quote that expires while the page is open flips by itself
  const baseBrand = selectBrand(state);
  // A self-contained link (#d=...) carries its own copy of the quote: it is shown when this browser never saw the quote.
  const { link, damaged, reason } = useMemo(() => readLink(route), [route.id, route.data]);
  const id = route.id || (link ? link.quoteId : '');
  const stored = id ? selectQuoteDetail(state, id) : null;
  const fromLink = !!link && linkWins(stored, link);
  const detail = fromLink ? detailFromLink(link) : stored;
  const brand = useMemo(
    () => (fromLink && link.ownerFirst && link.ownerFirst !== baseBrand.ownerFirst ? { ...baseBrand, ownerFirst: link.ownerFirst } : baseBrand),
    [baseBrand, fromLink, link]
  );

  // Link mode: what this browser opened in WhatsApp for this quote (remembered across a reload). `override` is what was just opened (or cleared
  // by "Back to my quote") in this page session; it wins over the stored copy so the screen changes at once even when storage is blocked.
  const [override, setOverride] = useState(null); // { id, reply } | null
  const justOpened = !!override && override.id === id;
  const remembered = fromLink && detail && !justOpened ? readReply(id) : null;
  const reply = fromLink && detail ? (justOpened ? override.reply : (replyFits(remembered, detail) ? remembered : null)) : null;
  const onReply = (quoteId, next) => setOverride({ id: quoteId, reply: next });
  const onChange = () => { forgetReply(id); setOverride({ id, reply: null }); };

  const view = reply ? 'reply' : viewFor(detail);
  const mode = useMemo(() => ({ link: fromLink }), [fromLink]); // the strip's popover words differ for a quote read from a link
  const storedStatus = detail && !fromLink ? detail.quote.status : '';

  // Opening the link counts as a view (idempotent: only a quote that is 'sent' becomes 'viewed'). An owner preview is not counted.
  // Link mode writes nothing here: the quote is not in this browser's store.
  useEffect(() => {
    if (!detail || fromLink || route.preview) return;
    if (storedStatus !== 'sent' || detail.status !== 'sent') return;
    try { recordQuoteViewed(id); } catch (err) { console.error('The view could not be recorded', err); }
  }, [id, route.preview, storedStatus, fromLink, !!detail]);

  // A quote opened from a BARE link (quote.html#q=<id>, as the confirmation, the landing sample and the dashboard's "customer view" give)
  // swaps the address bar for the self-contained link (#d=<payload>), so whatever is copied from the address bar opens on any phone.
  // replaceState raises no hashchange, so the route (and with it the view count and every other effect) is untouched: no loop. A later
  // jump to the same quote's bare address (the owner's preview re-using this tab) is swapped again.
  const carried = !!detail && !fromLink && ['sent', 'viewed', 'accepted', 'expired'].includes(detail.status);
  const latest = useRef(null);
  latest.current = { detail, state };
  useEffect(() => {
    if (!carried || !id) return undefined;
    const swap = () => {
      const now = parseQuoteHash(location.hash);
      if (now.data || now.id !== id) return;
      const { detail: d, state: s } = latest.current;
      const booking = (s.bookings || []).find((b) => b.id === d.quote.bookingId);
      replaceHash(shareHash(d.quote, { booking, postcode: installPostcode(d, s) }, { preview: now.preview }));
    };
    swap();
    window.addEventListener('hashchange', swap);
    return () => window.removeEventListener('hashchange', swap);
  }, [carried, id]);

  // Keep the tab title in step with the quote and the brand.
  useEffect(() => {
    document.title = detail ? `Your quote ${detail.quote.id} · ${brand.name}` : `Your quote · ${brand.name}`;
  }, [brand.name, detail ? detail.quote.id : '']);

  let body;
  if (view === 'reply') body = html`<${LinkSentView} key=${`reply-${detail.quote.id}`} d=${detail} brand=${brand} state=${state} reply=${reply} fresh=${justOpened} onChange=${onChange} />`;
  else if (view === 'invalid') body = html`<${InvalidView} brand=${brand} id=${route.id} damaged=${damaged} why=${reason} />`;
  else if (view === 'draft') body = html`<${DraftView} d=${detail} brand=${brand} />`;
  else if (view === 'accepted') body = html`<${AcceptedView} key=${detail.quote.id} d=${detail} brand=${brand} settings=${state.settings} />`;
  else if (view === 'declined') body = html`<${DeclinedView} d=${detail} brand=${brand} />`;
  else body = html`<${OpenView} key=${detail.quote.id} d=${detail} state=${state} brand=${brand} preview=${route.preview} onReply=${onReply} />`;

  // The skip link must not change the address bar: the address is how this page knows which quote it is showing.
  const skip = (e) => {
    const main = document.getElementById('q2-main');
    if (!main) return;
    e.preventDefault();
    try { main.focus({ preventScroll: true }); main.scrollIntoView(); } catch (err) { /* not focusable right now */ }
  };

  return html`
    <${QuoteModeContext.Provider} value=${mode}>
      <div class="q2-app" data-testid="q2-page" data-state=${view === 'open' && detail.status === 'expired' ? 'expired' : view} data-mode=${fromLink ? 'link' : 'store'}>
        <a class="q2-skip" href="#q2-main" onClick=${skip} data-testid="q2-skip">Skip to your quote</a>
        ${body}
      </div>
    <//>
  `;
}
