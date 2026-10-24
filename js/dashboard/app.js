// js/dashboard/app.js: owner dashboard entry. Names the tab, then boots the shell and the new-booking watcher.
// Owner: WP2
import { html } from '../vendor/preact-htm.js';
import { bootApp } from '../ui/index.js';
import { Shell } from './shell.js';
import { Watcher } from './watcher.js';

// Cross-page links target this name, so tapping "Open dashboard" re-uses this tab (16.1).
window.name = 'vm-dashboard';

function App() {
  return html`<${Shell} /><${Watcher} />`;
}

bootApp(html`<${App} />`);
