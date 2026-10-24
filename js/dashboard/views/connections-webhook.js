// js/dashboard/views/connections-webhook.js: Website funnel webhook (#/connections/webhook): endpoint and secret, field mapping, example payload, test enquiry.
// Owner: K1 (connections hub, domain, webhook, tracking)
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Banner, Button, CodeBlock, ConfirmDialog, ConnectionBadge, CopyField, DataTable, Icon, PageHeader, RealBuildNote, SimBanner, Switch,
  failureMessage, pageHref, pageTarget, toast, useStore
} from '../../ui/index.js';
import { ENQUIRY_STEPS } from '../../core/config.js';
import { webhookSamplePayload } from '../../core/connections.js';
import { rotateWebhookSecret, sendTestEvent, setConnection } from '../../core/store.js';
import { fmtDayShort, stampDay, stampTime } from '../../core/dates.js';
import { routeHref } from '../router.js';
import { StorageNote, undoToast } from './connections.js';

export const title = 'Website webhook';
export const css = ['css/connections.css'];

const selectState = (state) => state;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const whenText = (stamp) => (stamp ? `${fmtDayShort(stampDay(stamp))}, ${stampTime(stamp)}` : '');

const optionValues = (key) => ENQUIRY_STEPS.find((s) => s.key === key).options.map((o) => o.value);
const questionOf = (key) => ENQUIRY_STEPS.find((s) => s.key === key).title;

/** His six funnel steps and what each answer is called when it arrives here. `values` is a list of exact words or a sentence. */
const MAPPING = [
  { id: 'postcode', step: 'Step 1', question: "What's your installation postcode?", field: 'answers.postcode', values: 'A UK postcode, like BT9 6QP' },
  { id: 'parking', step: 'Step 2', question: questionOf('parking'), field: 'answers.parking', values: optionValues('parking') },
  { id: 'vehicle', step: 'Step 3', question: questionOf('vehicle'), field: 'answers.vehicle', values: optionValues('vehicle') },
  { id: 'timing', step: 'Step 4', question: questionOf('timing'), field: 'answers.timing', values: optionValues('timing') },
  { id: 'permission', step: 'Step 5', question: questionOf('permission'), field: 'answers.permission', values: optionValues('permission') },
  { id: 'name', step: 'Step 6', question: 'Full name', field: 'customer.name', values: 'Their full name' },
  { id: 'mobile', step: 'Step 6', question: 'Mobile number', field: 'customer.phone', values: 'A mobile number, like 07700 900123' },
  { id: 'email', step: 'Step 6', question: 'Email address', field: 'customer.email', values: 'Their email address' },
  { id: 'notes', step: 'Step 6', question: 'Anything else we should know? (optional)', field: 'notes', values: 'Whatever they typed' },
  { id: 'optin', step: 'Step 6', question: 'Keep me updated with occasional offers (tick box)', field: 'answers.marketingOptIn', values: ['true', 'false'] },
  { id: 'utm', step: 'From the ad link', question: 'Where the visitor came from', field: 'utm.source', values: ['facebook', 'instagram', 'google', 'referral', 'phone'] }
];

const MAPPING_COLUMNS = [
  {
    key: 'question', header: 'Your funnel question', primary: true, width: 'minmax(0, 1.25fr)',
    render: (r) => html`<span class="k1-map__q"><span class="k1-map__text">${r.question}</span><span class="k1-map__step">${r.step}</span></span>`
  },
  { key: 'field', header: 'Send it as', width: 'minmax(186px, 0.95fr)', label: false, render: (r) => html`<span class="k1-inline-code" data-testid=${`k1-map-field-${r.id}`}>${r.field}</span>` },
  {
    key: 'values', header: 'What we expect', width: 'minmax(0, 1fr)', label: false,
    render: (r) => (Array.isArray(r.values)
      ? html`<span class="k1-map__values">${r.values.map((v) => html`<span class="k1-inline-code" key=${v}>${v}</span>`)}</span>`
      : html`<span class="k1-map__plain">${r.values}</span>`)
  }
];

/** The newest enquiry the webhook created (they carry utm.medium 'webhook'), or null. */
function latestWebhookBooking(state) {
  let best = null;
  for (const b of state.bookings || []) {
    if (!b.utm || b.utm.medium !== 'webhook' || b.status === 'cancelled') continue;
    if (!best || b.createdAt > best.createdAt || (b.createdAt === best.createdAt && b.ref > best.ref)) best = b;
  }
  return best;
}

export default function WebhookView() {
  const state = useStore(selectState);
  const hook = state.settings.connections.webhook;
  const payload = useMemo(() => JSON.stringify(webhookSamplePayload(state), null, 2), [state]);
  const latest = useMemo(() => latestWebhookBooking(state), [state]);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // { id, ref, name, postcode } for the success banner, or { error }
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const toggle = (next) => {
    const res = setConnection('webhook', { enabled: next });
    if (!res || !res.ok) { toast({ message: failureMessage(res), tone: 'danger' }); return; }
    setSent(null);
    undoToast({
      message: next ? 'Webhook is on' : 'Webhook is paused',
      detail: next ? 'Enquiries from your funnel will be accepted.' : 'Enquiries your funnel sends will be ignored (simulated).',
      icon: 'webhook', token: res.undoToken
    });
  };

  const rotate = () => {
    setConfirmRotate(false);
    const res = rotateWebhookSecret();
    if (!res || !res.ok) { toast({ message: failureMessage(res), tone: 'danger' }); return; }
    undoToast({ message: 'New secret created', detail: 'Copy it into your funnel tool. The old one no longer works.', icon: 'key-round', token: res.undoToken });
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    setSent(null);
    await sleep(600); // a short pause so it feels like something travelled
    const res = sendTestEvent('webhook');
    if (!alive.current) return;
    setSending(false);
    if (!res || !res.ok) {
      const message = res && res.reason === 'disabled' ? 'The webhook is paused. Switch it on above, then send the test again.' : failureMessage(res, 'The test enquiry did not go through. Please try again.');
      setSent({ error: message });
      toast({ message, tone: 'danger' });
      return;
    }
    const b = res.booking;
    // The shell already announces the new enquiry with its own toast, so the confirmation lives here, in the page.
    setSent({ id: b.id, ref: b.ref, name: b.customer.name, postcode: b.address.postcode });
  };

  const on = !!hook.enabled;
  return html`<div class="db-page k1-page" data-testid="k1-webhook">
    <${PageHeader}
      back=${{ href: routeHref('connections'), label: 'Back to Connections' }}
      eyebrow="Connections" title="Website funnel webhook"
      subtitle="Keep your funnel exactly as it is. Every enquiry it collects can land here too."
    />
    <${SimBanner}>The address and the secret below are examples. Nothing arrives from a real funnel.<//>
    <${StorageNote} />

    <section class="k1-section" aria-labelledby="k1-how-title" data-testid="k1-how">
      <h2 class="k1-section__title" id="k1-how-title">How it works</h2>
      <ol class="k1-steps k1-steps--cards">
        <li><span class="k1-steps__n" aria-hidden="true">1</span><span><strong>Your funnel keeps running.</strong> Customers see the same page and the same six questions as now.</span></li>
        <li><span class="k1-steps__n" aria-hidden="true">2</span><span><strong>It passes each enquiry on.</strong> Most funnel tools can send the answers to a web address (a webhook). Look for Integrations or Webhooks, and check your plan includes it.</span></li>
        <li><span class="k1-steps__n" aria-hidden="true">3</span><span><strong>We turn it into an enquiry.</strong> It lands in Bookings with a free survey pencilled in and an alert in Messages, like one from our own funnel.</span></li>
      </ol>
    </section>

    <div class="k1-split">
      <div class="k1-split__a">
        <section class="k1-panel" aria-label="Webhook status" data-testid="k1-hook-status">
          <div class="k1-panel__head">
            <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="webhook" size=${22} /></span>
            <div>
              <h2 class="k1-panel__title">Receiving enquiries</h2>
              <p class="k1-panel__sub" data-testid="k1-last-event">${hook.lastEventAt ? `Last event ${whenText(hook.lastEventAt)}` : 'No events yet'}</p>
            </div>
            <${ConnectionBadge} status=${on ? 'connected' : 'off'} label=${on ? 'On' : 'Paused'} data-testid="k1-hook-badge" />
          </div>
          <${Switch} checked=${on} onChange=${toggle} label="Accept enquiries from my funnel"
            description=${on ? 'Switch off to pause. Anything your funnel sends is then ignored.' : 'Paused. Switch on to accept enquiries again.'} data-testid="k1-hook-switch" />
        </section>

        <section class="k1-panel" aria-labelledby="k1-endpoint-title" data-testid="k1-endpoint">
          <div class="k1-panel__head">
            <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="link" size=${22} /></span>
            <div>
              <h2 class="k1-panel__title" id="k1-endpoint-title">Your webhook address</h2>
              <p class="k1-panel__sub">Paste these into your funnel tool.</p>
            </div>
          </div>
          <${CopyField} label="Webhook URL" value=${hook.url} testid="k1-webhook-url" hint="Where your funnel sends each enquiry. This is a placeholder address." />
          <${CopyField} label="Signing secret" value=${hook.secret} secret testid="k1-webhook-secret" hint="Like a password for the address. Keep it private." />
          <div class="k1-actions">
            <${Button} variant="secondary" size="sm" icon="refresh-cw" onClick=${() => setConfirmRotate(true)} data-testid="k1-secret-rotate">Rotate secret<//>
          </div>
        </section>

        <section class="k1-panel" aria-labelledby="k1-test-title" data-testid="k1-test">
          <div class="k1-panel__head">
            <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="send" size=${22} /></span>
            <div>
              <h2 class="k1-panel__title" id="k1-test-title">Try it</h2>
              <p class="k1-panel__sub">Sends a pretend enquiry the same way a real one would arrive.</p>
            </div>
          </div>
          <${Button} variant="primary" icon="send" loading=${sending} onClick=${send} data-testid="k1-test-send">Send test enquiry<//>
          <div aria-live="polite" class="k1-live-region">
            ${sent && sent.error ? html`<${Banner} tone="warn" data-testid="k1-test-error">${sent.error}<//>` : null}
            ${sent && sent.ok !== false && sent.id ? html`<${Banner} tone="ok" data-testid="k1-test-result"
              actions=${html`<${Button} size="sm" variant="secondary" iconRight="arrow-right" href=${routeHref('bookings', { id: sent.id })} data-testid="k1-test-open">Open the enquiry<//>`}>
              <strong>Test enquiry received.</strong> ${sent.name}, ${sent.postcode} (${sent.ref}) is in your Bookings. Simulated.
            <//>` : null}
            ${!sent && latest ? html`<p class="k1-small" data-testid="k1-test-latest">Latest from the webhook: <strong>${latest.customer.name}</strong> (${latest.ref}).
              <a class="k1-link" href=${routeHref('bookings', { id: latest.id })} data-testid="k1-test-latest-open">Open it</a></p>` : null}
          </div>
        </section>
      </div>

      <div class="k1-split__b">
        <section class="k1-section" aria-labelledby="k1-map-title" data-testid="k1-mapping">
          <h2 class="k1-section__title" id="k1-map-title">Which answer goes where</h2>
          <p class="k1-section__intro">Send each answer under the name shown. These words are exact: they are the ones we recognise.</p>
          <${DataTable} caption="Funnel questions and the field each one is sent as" testid="k1-map-table" rows=${MAPPING} rowKey=${(r) => r.id}
            rowTestid=${(r) => `k1-map-row-${r.id}`} columns=${MAPPING_COLUMNS} />
        </section>

        <section class="k1-section" aria-labelledby="k1-payload-title">
          <h2 class="k1-section__title" id="k1-payload-title">What arrives</h2>
          <p class="k1-section__intro">One enquiry, as your funnel would send it. All the values are samples.</p>
          <${CodeBlock} label="Example enquiry" language="json" code=${payload} testid="k1-payload" />
        </section>
      </div>
    </div>

    <section class="k1-panel k1-panel--quiet" aria-labelledby="k1-alt-title">
      <div class="k1-panel__head">
        <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="zap" size=${22} /></span>
        <div>
          <h2 class="k1-panel__title" id="k1-alt-title">Or switch the funnel itself</h2>
          <p class="k1-panel__sub">This prototype has its own 180 Electrical funnel with the same six questions, so nothing needs forwarding.</p>
        </div>
      </div>
      <div class="k1-actions">
        <${Button} variant="secondary" size="sm" iconRight="external-link" href=${pageHref('index.html')} target=${pageTarget('index.html')} data-testid="k1-open-funnel">See our funnel<//>
      </div>
    </section>

    <${RealBuildNote} items=${[
      'A public web address that accepts your funnel\'s posts over HTTPS',
      'Checking the signing secret on every post, so nobody can send fake enquiries',
      'Handling repeats and retries without creating the same enquiry twice',
      'Saving each enquiry in a database and sending the WhatsApp alert for real'
    ]} />

    <${ConfirmDialog} open=${confirmRotate} tone="danger" title="Create a new secret?"
      body="Your funnel tool will stop being accepted until you paste the new secret into it. You can undo this straight afterwards."
      confirmLabel="Rotate secret" cancelLabel="Keep the old one" onConfirm=${rotate} onCancel=${() => setConfirmRotate(false)} />
  </div>`;
}
