// js/dashboard/views/connections-tracking.js: Ad tracking (#/connections/tracking): Meta Pixel and Google tag IDs, consent note, lead-source summary.
// Owner: K1 (connections hub, domain, webhook, tracking)
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Button, ConfirmDialog, ConnectionBadge, Disclosure, EmptyState, Field, Icon, Input, Meter, PageHeader, RealBuildNote, SimBanner, Switch,
  failureMessage, toast, useStore
} from '../../ui/index.js';
import { selectLeadSources } from '../../core/selectors.js';
import { disconnect, setConnection } from '../../core/store.js';
import { routeHref } from '../router.js';
import { StorageNote, undoToast } from './connections.js';

export const title = 'Ad tracking';
export const css = ['css/connections.css'];

const selectState = (state) => state;

// The same rules the store applies (core/connections.js), so a mistake is caught while he types and the store still has the last word.
const META_RE = /^\d{8,20}$/;
const GOOGLE_RE = /^(G|GT|AW|GTM)-[A-Z0-9]{4,12}$/;

const cleanMeta = (text) => String(text || '').replace(/\s+/g, '');
const cleanGoogle = (text) => String(text || '').replace(/\s+/g, '').toUpperCase();

function metaProblem(text) {
  const v = cleanMeta(text);
  if (!v) return '';
  if (/[^0-9]/.test(v)) return 'A Meta Pixel ID is just numbers. Check you copied the ID, not the pixel name.';
  if (!META_RE.test(v)) return v.length < 8 ? 'That is too short. A Meta Pixel ID is usually 15 or 16 digits.' : 'That is too long. A Meta Pixel ID is usually 15 or 16 digits.';
  return '';
}

function googleProblem(text) {
  const v = cleanGoogle(text);
  if (!v) return '';
  if (!/^(G|GT|AW|GTM)-/.test(v)) return 'A Google tag ID starts with G-, GT-, AW- or GTM-. For example G-ABCD1234.';
  if (!GOOGLE_RE.test(v)) return 'After the dash there should be 4 to 12 letters or numbers, like G-ABCD1234 or GTM-ABCD12.';
  return '';
}

function SourcesPanel({ state }) {
  const data = useMemo(() => selectLeadSources(state, '90d'), [state]);
  const shown = data.sources.filter((s) => s.enquiries > 0);
  const total = data.total.enquiries;
  const hasSamples = (state.bookings || []).some((b) => b.seed);
  return html`<section class="k1-panel" aria-labelledby="k1-sources-title" data-testid="k1-sources">
    <div class="k1-panel__head">
      <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="trending-up" size=${22} /></span>
      <div>
        <h2 class="k1-panel__title" id="k1-sources-title">Where your enquiries come from</h2>
        <p class="k1-panel__sub" data-testid="k1-sources-total">${total ? `${total} enquir${total === 1 ? 'y' : 'ies'} in the last 90 days` : 'Last 90 days'}</p>
      </div>
      ${hasSamples ? html`<span class="k1-tag k1-tag--sample">Sample data</span>` : null}
    </div>
    ${shown.length
      ? html`<ul class="k1-sources" data-testid="k1-sources-list">
        ${shown.map((s) => html`<li key=${s.id} data-testid=${`k1-source-${s.id}`}>
          <${Meter} label=${s.label} value=${s.enquiries} max=${total} valueText=${`${s.enquiries} · ${s.sharePct}%`} showValue size="md" />
        </li>`)}
      </ul>`
      : html`<${EmptyState} icon="megaphone" title="No enquiries yet" body="Once enquiries come in you will see here whether they came from Facebook, Instagram, Google or word of mouth." data-testid="k1-sources-empty" />`}
    <p class="k1-small">Each enquiry is filed by the tag on the link it came from. The Share and promote screen builds tagged links for your ads.</p>
    <div class="k1-actions">
      <${Button} variant="secondary" size="sm" iconRight="arrow-right" href=${routeHref('insights')} data-testid="k1-sources-insights">See it in Insights<//>
      <${Button} variant="ghost" size="sm" href=${routeHref('share')} data-testid="k1-sources-share">Build a tagged link<//>
    </div>
  </section>`;
}

export default function TrackingView() {
  const state = useStore(selectState);
  const saved = state.settings.connections.tracking;
  const [meta, setMeta] = useState(saved.metaPixelId);
  const [google, setGoogle] = useState(saved.googleTagId);
  const [consent, setConsent] = useState(!!saved.consentNote);
  const [touched, setTouched] = useState({ meta: false, google: false });
  const [storeErrors, setStoreErrors] = useState({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedKey = `${saved.metaPixelId}|${saved.googleTagId}|${saved.consentNote}`;
  const lastKey = useRef(savedKey);

  const dirty = cleanMeta(meta) !== saved.metaPixelId || cleanGoogle(google) !== saved.googleTagId || consent !== !!saved.consentNote;

  // Another tab, an Undo or Remove changed the saved values: show them, unless he is part-way through typing.
  useEffect(() => {
    if (lastKey.current === savedKey) return;
    lastKey.current = savedKey;
    setMeta(saved.metaPixelId);
    setGoogle(saved.googleTagId);
    setConsent(!!saved.consentNote);
    setStoreErrors({});
  }, [savedKey]);

  const metaError = (touched.meta ? metaProblem(meta) : '') || storeErrors.metaPixelId || '';
  const googleError = (touched.google ? googleProblem(google) : '') || storeErrors.googleTagId || '';
  const hasAny = !!(saved.metaPixelId || saved.googleTagId);

  const save = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setTouched({ meta: true, google: true });
    const mp = metaProblem(meta);
    const gp = googleProblem(google);
    if (mp || gp) {
      setStoreErrors({});
      const first = mp ? 'k1-track-meta' : 'k1-track-google';
      setTimeout(() => { const el = document.getElementById(first); if (el) el.focus(); }, 0);
      return;
    }
    const res = setConnection('tracking', { metaPixelId: cleanMeta(meta), googleTagId: cleanGoogle(google), consentNote: consent });
    if (!res || !res.ok) {
      if (res && res.errors) setStoreErrors(res.errors);
      toast({ message: failureMessage(res, 'We could not save that. Please try again.'), tone: 'danger' });
      return;
    }
    setStoreErrors({});
    setJustSaved(true);
    const nothing = !cleanMeta(meta) && !cleanGoogle(google);
    undoToast({
      message: nothing ? 'Tracking IDs cleared' : 'Tracking saved',
      detail: 'Saved on this device only. Nothing is sent to Meta or Google.', icon: 'megaphone', token: res.undoToken
    });
  };

  // Typing again clears the "Saved" tick.
  useEffect(() => { if (dirty) setJustSaved(false); }, [dirty]);

  const clearAll = () => {
    setConfirmClear(false);
    const res = disconnect('tracking');
    if (!res || !res.ok) { toast({ message: failureMessage(res), tone: 'danger' }); return; }
    setTouched({ meta: false, google: false });
    setStoreErrors({});
    undoToast({ message: 'Tracking IDs removed', detail: 'Your consent note setting is unchanged.', icon: 'trash-2', token: res.undoToken });
  };

  return html`<div class="db-page k1-page" data-testid="k1-tracking">
    <${PageHeader}
      back=${{ href: routeHref('connections'), label: 'Back to Connections' }}
      eyebrow="Connections" title="Ad tracking"
      subtitle="Tell Facebook and Google which ads brought you an enquiry, so you can see what is worth paying for."
    />
    <${SimBanner}>Your IDs are only saved here. Nothing is sent to Meta or Google.<//>
    <${StorageNote} />

    <div class="k1-split k1-split--even">
      <div class="k1-split__a">
        <form class="k1-panel k1-form" onSubmit=${save} noValidate data-testid="k1-track-form" aria-labelledby="k1-ids-title">
          <div class="k1-panel__head">
            <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="megaphone" size=${22} /></span>
            <div>
              <h2 class="k1-panel__title" id="k1-ids-title">Your tracking IDs</h2>
              <p class="k1-panel__sub">Add one or both. Leave a box empty if you do not use it.</p>
            </div>
            <${ConnectionBadge} status=${hasAny ? 'connected' : 'off'} label=${hasAny ? 'Saved' : 'Not set up'} data-testid="k1-track-badge" />
          </div>

          <${Field} label="Meta Pixel ID (Facebook and Instagram)" id="k1-track-meta" error=${metaError} errorTestid="k1-track-meta-error"
            hint="Numbers only, usually 15 or 16 of them. In Meta Events Manager it is shown under the name of your pixel.">
            <${Input} id="k1-track-meta" value=${meta} placeholder="e.g. 123456789012345" inputmode="numeric" autocomplete="off" spellcheck=${false}
              data-testid="k1-track-meta" onInput=${(e) => setMeta(e.target.value)} onBlur=${() => setTouched((t) => ({ ...t, meta: true }))} />
          <//>

          <${Field} label="Google tag ID (Google Ads, Analytics or Tag Manager)" id="k1-track-google" error=${googleError} errorTestid="k1-track-google-error"
            hint="Starts with G-, GT-, AW- or GTM-, like G-ABCD1234.">
            <${Input} id="k1-track-google" value=${google} placeholder="e.g. G-ABCD1234" autocapitalize="characters" autocomplete="off" spellcheck=${false}
              data-testid="k1-track-google" onInput=${(e) => setGoogle(e.target.value)} onBlur=${() => setTouched((t) => ({ ...t, google: true }))} />
          <//>

          <${Switch} checked=${consent} onChange=${setConsent} label="Show a consent note on my website"
            description="Tells visitors you use ad tracking and asks first. In the UK that is expected before tracking cookies are used. This is general guidance, not legal advice."
            data-testid="k1-track-consent" />

          <div class="k1-form__actions">
            <${Button} type="submit" variant="primary" icon=${justSaved && !dirty ? 'check' : 'save'} data-testid="k1-track-save">${justSaved && !dirty ? 'Saved' : 'Save tracking IDs'}<//>
            ${hasAny ? html`<${Button} variant="ghost" icon="trash-2" onClick=${() => setConfirmClear(true)} data-testid="k1-track-clear">Remove IDs<//>` : null}
          </div>
          <p class="k1-small k1-form__state" role="status" data-testid="k1-track-state">${dirty ? 'You have changes that are not saved yet.' : (hasAny ? 'All changes saved on this device.' : '')}</p>
        </form>

        <${Disclosure} title="Where do I find these IDs?" summary="Short guide" testid="k1-track-help">
          <ul class="k1-help">
            <li><strong>Meta Pixel.</strong> In Meta Events Manager, choose your pixel. The ID is the number shown under its name.</li>
            <li><strong>Google Analytics.</strong> In Admin, open Data streams and choose your site. The Measurement ID starts with G-.</li>
            <li><strong>Google Tag Manager.</strong> The container ID at the top of the workspace starts with GTM-.</li>
            <li><strong>Google Ads.</strong> Conversion tags start with AW-.</li>
          </ul>
        <//>
      </div>

      <div class="k1-split__b">
        <${SourcesPanel} state=${state} />
      </div>
    </div>

    <${RealBuildNote} items=${[
      'Your pixel and tag added to the funnel pages, so they load for real visitors',
      'A consent notice that holds tracking back until the visitor says yes',
      'A "lead" event fired when someone sends an enquiry, so Facebook and Google can learn from it',
      'Optionally, events sent from a server as well, for more accurate numbers'
    ]} />

    <${ConfirmDialog} open=${confirmClear} tone="danger" title="Remove your tracking IDs?"
      body="Both IDs are cleared from this prototype. You can undo this straight afterwards."
      confirmLabel="Remove IDs" cancelLabel="Keep them" onConfirm=${clearAll} onCancel=${() => setConfirmClear(false)} />
  </div>`;
}
