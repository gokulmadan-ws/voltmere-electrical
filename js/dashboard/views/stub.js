// js/dashboard/views/stub.js: StubView, the placeholder the shell shows for any screen that is not built or fails to load.
// Owner: WP2
import { html } from '../../vendor/preact-htm.js';
import { PageHeader, EmptyState } from '../../ui/index.js';
import { ROUTES } from '../routes.js';

/** `error` is the import error the shell caught (shown small, so a half-merged repo is easy to debug). */
export default function StubView({ route, error }) {
  const meta = ROUTES.find((r) => r.name === (route && route.name));
  return html`<div class="db-page" data-testid="view-stub">
    <${PageHeader} title=${meta ? meta.title : 'Dashboard'} />
    <${EmptyState}
      icon="plug"
      title="This screen is not built yet."
      body=${error && error.message ? `Details: ${error.message}` : 'It will appear here once it has been added.'}
    />
  </div>`;
}
