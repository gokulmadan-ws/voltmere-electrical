// js/dashboard/views/stub.js: StubView, the placeholder the shell shows for any screen that is not built or fails to load.
// Owner: WP2
import { html } from '../../vendor/preact-htm.js';
import { Button, PageHeader, EmptyState } from '../../ui/index.js';
import { ROUTES } from '../routes.js';

/**
 * `error` is the import error the shell caught; `onRetry` fetches the screen again (a dropped connection is the usual cause, so it is never
 * remembered as broken). The details stay small, so a half-merged repo is still easy to debug.
 */
export default function StubView({ route, error, onRetry }) {
  const meta = ROUTES.find((r) => r.name === (route && route.name));
  return html`<div class="db-page" data-testid="view-stub">
    <${PageHeader} title=${meta ? meta.title : 'Dashboard'} />
    <${EmptyState}
      icon="plug"
      title=${error ? 'This screen could not load.' : 'This screen is not built yet.'}
      body=${error ? 'Check your connection and try again. Nothing you saved is lost.' : 'It will appear here once it has been added.'}
      action=${error && onRetry ? html`<${Button} variant="primary" icon="rotate-ccw" onClick=${onRetry} data-testid="view-retry">Try again<//>` : undefined}
    />
    ${error && error.message ? html`<p class="db-muted" data-testid="view-stub-details"><small>Details: ${error.message}</small></p>` : null}
  </div>`;
}
