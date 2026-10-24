// js/ui/consent.js: ConsentSheet, a fake OAuth consent screen (always labelled Simulated, no real provider artwork).
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { html } from '../vendor/preact-htm.js';
import { Icon, BrandMark, Avatar } from './display.js';
import { Button } from './button.js';
import { Sheet } from './sheet.js';

/**
 * Simulated sign-in and permission screen. provider: { name, service, icon }, account (email text), scopes: [{ id, label, detail }].
 * onAllow() / onCancel(); `busy` shows a spinner on Allow. Nothing is shared with anyone: the sheet says so.
 * Sheet content is a separate Preact root, so this component reads no context.
 */
export function ConsentSheet({
  open, provider = {}, account, appName = '180 Electrical', scopes = [], onAllow, onCancel, busy, allowLabel = 'Allow', testid = 'consent-sheet'
}) {
  const pname = provider.name || 'Provider';
  const service = provider.service ? ` ${provider.service}` : '';
  const footer = html`<div class="ui-consent__actions">
    <${Button} variant="secondary" size="lg" onClick=${onCancel} disabled=${busy} data-testid="consent-cancel">Cancel<//>
    <${Button} variant="primary" size="lg" onClick=${onAllow} loading=${busy} data-testid="consent-allow">${allowLabel}<//>
  </div>`;
  return html`<${Sheet} open=${open} onClose=${onCancel} title=${`Simulated ${pname} sign-in`} size="auto" testid=${testid}
    initialFocus='[data-testid="consent-allow"]' footer=${footer}>
    <div class="ui-consent">
      <p class="ui-consent__sim" data-testid="consent-simulated"><${Icon} name="unplug" size=${16} /><span><strong>Simulated.</strong> This screen only imitates the real one. Nothing is shared with ${pname}.</span></p>
      <div class="ui-consent__marks" aria-hidden="true">
        <${BrandMark} size=${52} />
        <span class="ui-consent__link"></span>
        <span class="ui-consent__provider"><${Icon} name=${provider.icon || 'plug'} size=${26} /></span>
      </div>
      <h3 class="ui-consent__title">${`${appName} wants to use your ${pname}${service}`}</h3>
      ${account ? html`<p class="ui-consent__account"><${Avatar} name=${account} size=${28} /><span class="ui-consent__email">${account}</span></p>` : null}
      <p class="ui-consent__lead">This will let ${appName}:</p>
      <ul class="ui-consent__scopes" data-testid="consent-scopes">
        ${scopes.map((s) => html`<li key=${s.id || s.label} class="ui-consent__scope">
          <span class="ui-consent__tick" aria-hidden="true"><${Icon} name="check" size=${14} /></span>
          <span class="ui-consent__scope-text"><span class="ui-consent__scope-label">${s.label}</span>${s.detail ? html`<span class="ui-consent__scope-detail">${s.detail}</span>` : null}</span>
        </li>`)}
      </ul>
      <p class="ui-consent__fine">You can turn this off at any time. In a real build this is where ${pname} would ask you to sign in.</p>
    </div>
  <//>`;
}
