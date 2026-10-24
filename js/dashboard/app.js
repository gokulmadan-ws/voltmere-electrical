// js/dashboard/app.js: owner dashboard entry. Names the tab, then boots the shell and the new-booking watcher.
// Owner: B3 (was WP2)
import { html, useErrorBoundary } from '../vendor/preact-htm.js';
import { Button } from '../ui/button.js';
import { ResetDataButton } from '../ui/reset.js';
import { bootApp } from '../ui/boot.js';
import { Shell } from './shell.js';
import { Watcher } from './watcher.js';

// Cross-page links target this name, so tapping "Open dashboard" re-uses this tab (16.1).
window.name = 'vm-dashboard';

/** Last line of defence: if the shell itself fails to render, say so plainly instead of leaving a blank page. */
function Crash({ children }) {
  const [error] = useErrorBoundary((err) => console.error('The dashboard shell crashed:', err));
  if (error) {
    return html`<div class="ui-fatal" role="alert" data-testid="shell-error">
      <p class="ui-fatal__text">Something went wrong. Reload the page.</p>
      <${Button} variant="primary" onClick=${() => location.reload()}>Reload<//>
      <${ResetDataButton} />
    </div>`;
  }
  return children;
}

function App() {
  return html`<${Crash}><${Shell} /><${Watcher} /><//>`;
}

bootApp(html`<${App} />`);
