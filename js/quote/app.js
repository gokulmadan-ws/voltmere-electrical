// js/quote/app.js: customer quote page entry (quote.html#q=<quoteId>[&d=<payload>]): names the tab, boots the shared store, theme and toasts, shows the quote
// (from this browser's store, or from the share link's own copy when this browser never saw it).
// Owner: Q2 (customer quote page)
import { html, useErrorBoundary } from '../vendor/preact-htm.js';
import { Button } from '../ui/button.js';
import { ResetDataButton } from '../ui/reset.js';
import { bootApp } from '../ui/boot.js';
import { initIdeasMode } from '../ui/ideas.js';
import { makeDefaultSettings } from '../core/config.js';
import { getState } from '../core/store.js';
import { QuotePage } from './page.js';

// "Show: With ideas | Only my content" (localStorage ec_clean): applied to <html data-clean> before the first frame, so an idea block never flashes for
// someone who chose "Only my content". Guarded: a storage problem must never stop the quote from showing.
try { initIdeasMode(); } catch (err) { console.error('The ideas switch could not start', err); }

// Cross-page links target this name, so "Preview as customer" in the dashboard re-uses this tab. Do not rename.
window.name = 'vm-quote';

function fallbackPhone() {
  try { return getState().settings.business.phone; } catch (e) { return makeDefaultSettings().business.phone; }
}

/** Error boundary: whatever goes wrong, the customer still gets a phone number and a way to try again. */
function QuoteApp() {
  const [error] = useErrorBoundary((err) => console.error('Quote page failed to render', err));
  if (error) {
    return html`<div class="ui-fatal" role="alert" data-testid="q2-error">
      <p class="ui-fatal__text">Something went wrong showing your quote. Reload the page, or call ${fallbackPhone()}.</p>
      <${Button} variant="primary" onClick=${() => location.reload()}>Reload<//>
      <${ResetDataButton} />
    </div>`;
  }
  return html`<${QuotePage} />`;
}

bootApp(html`<${QuoteApp} />`);
