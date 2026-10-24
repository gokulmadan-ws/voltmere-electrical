// js/quote/page.js: the quote page: reads the quote from the store, counts the view once, and shows the right state (open, expired, accepted, declined, not ready, not found).
// Owner: Q2 (customer quote page)
import { html, useEffect } from '../vendor/preact-htm.js';
import { useNow, useStore } from '../ui/index.js';
import { recordQuoteViewed } from '../core/store.js';
import { selectBrand, selectQuoteDetail } from '../core/selectors.js';
import { useQuoteRoute } from './route.js';
import { OpenView } from './open.js';
import { AcceptedView } from './confirmed.js';
import { DeclinedView, DraftView, InvalidView } from './states.js';

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
  const brand = selectBrand(state);
  const detail = route.id ? selectQuoteDetail(state, route.id) : null;
  const view = viewFor(detail);
  const stored = detail ? detail.quote.status : '';

  // Opening the link counts as a view (idempotent: only a quote that is 'sent' becomes 'viewed'). An owner preview is not counted.
  useEffect(() => {
    if (!detail || route.preview) return;
    if (stored !== 'sent' || detail.status !== 'sent') return;
    try { recordQuoteViewed(route.id); } catch (err) { console.error('The view could not be recorded', err); }
  }, [route.id, route.preview, stored, !!detail]);

  // Keep the tab title in step with the quote and the brand.
  useEffect(() => {
    document.title = detail ? `Your quote ${detail.quote.id} · ${brand.name}` : `Your quote · ${brand.name}`;
  }, [brand.name, detail ? detail.quote.id : '']);

  let body;
  if (view === 'invalid') body = html`<${InvalidView} brand=${brand} id=${route.id} />`;
  else if (view === 'draft') body = html`<${DraftView} d=${detail} brand=${brand} />`;
  else if (view === 'accepted') body = html`<${AcceptedView} key=${detail.quote.id} d=${detail} brand=${brand} settings=${state.settings} />`;
  else if (view === 'declined') body = html`<${DeclinedView} d=${detail} brand=${brand} />`;
  else body = html`<${OpenView} key=${detail.quote.id} d=${detail} state=${state} brand=${brand} preview=${route.preview} />`;

  return html`
    <div class="q2-app" data-testid="q2-page" data-state=${view === 'open' && detail.status === 'expired' ? 'expired' : view}>
      <a class="q2-skip" href="#q2-main" data-testid="q2-skip">Skip to your quote</a>
      ${body}
    </div>
  `;
}
