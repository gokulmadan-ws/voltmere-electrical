// js/dashboard/views/connections-webhook.js: "Keep your Facebook funnel" (#/connections/webhook): send the instructions to his agency, try a test enquiry,
// and (folded away, for the agency) the address, the secret, the field mapping and an example enquiry.
// Owner: K1 (connections hub, domain, webhook, tracking); round 2 (T13): leads with the one thing he does, plain words, the technical bits collapsed
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Banner, Button, CodeBlock, ConfirmDialog, ConnectionBadge, CopyField, DataTable, Disclosure, Icon, PageHeader, RealBuildNote, Sheet, SimBanner, Switch,
  copyText, failureMessage, pageHref, pageTarget, toast, useBrand, useStore
} from '../../ui/index.js';
import { ENQUIRY_STEPS } from '../../core/config.js';
import { webhookSamplePayload } from '../../core/connections.js';
import { rotateWebhookSecret, sendTestEvent, setConnection } from '../../core/store.js';
import { mailtoLink } from '../../core/messages.js';
import { fmtDayShort, stampDay, stampTime } from '../../core/dates.js';
import { routeHref } from '../router.js';
import { StorageNote, undoToast } from './connections.js';

export const title = 'Keep your Facebook funnel';
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

/** The plain-English message he sends his agency: what to do, where to send it, a sample of what it looks like, and the one tip about the ad link. */
function agencyMessage({ owner, url, secret, payload }) {
  return [
    `Hi, it's ${owner} from 180 Electrical. Could you set up our Facebook funnel so that every new enquiry is ALSO sent to my dashboard? Please keep the funnel exactly as it is. This only adds a copy.`,
    '',
    'Most funnel tools have an Integrations or Webhooks page. Please add a webhook (a POST request with JSON) with these details:',
    '',
    `Webhook URL: ${url}`,
    `Secret key: ${secret}`,
    '',
    'It should send each enquiry like this (the real answers go in place of the sample ones):',
    payload,
    '',
    'One more thing: please add ?utm_source=facebook to the link in the ads (and utm_source=instagram on Instagram ads), so I can see which ad each enquiry came from.',
    '',
    `Thanks, ${owner}`
  ].join('\n');
}

export default function WebhookView() {
  const state = useStore(selectState);
  const brand = useBrand();
  const hook = state.settings.connections.webhook;
  const payload = useMemo(() => JSON.stringify(webhookSamplePayload(state), null, 2), [state]);
  const latest = useMemo(() => latestWebhookBooking(state), [state]);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // { id, ref, name, postcode } for the success banner, or { error }
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const message = useMemo(() => agencyMessage({ owner: brand.ownerFirst, url: hook.url, secret: hook.secret, payload }), [brand.ownerFirst, hook.url, hook.secret, payload]);
  const waHref = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const mailHref = mailtoLink('', 'Please add a webhook to our Facebook funnel', message);
  const copyMessage = async () => {
    const ok = await copyText(message);
    toast({ message: ok ? 'Message copied' : 'Could not copy. Use WhatsApp or email instead.', detail: ok ? 'Paste it into any chat or email to your agency.' : undefined, icon: ok ? 'copy' : undefined, tone: ok ? 'default' : 'danger' });
  };

  const toggle = (next) => {
    const res = setConnection('webhook', { enabled: next });
    if (!res || !res.ok) { toast({ message: failureMessage(res), tone: 'danger' }); return; }
    setSent(null);
    undoToast({
      message: next ? 'Funnel enquiries are on' : 'Funnel enquiries are paused',
      detail: next ? 'Enquiries from your funnel will be accepted.' : 'Enquiries your funnel sends will be ignored (practice mode).',
      icon: 'webhook', token: res.undoToken
    });
  };

  const rotate = () => {
    setConfirmRotate(false);
    const res = rotateWebhookSecret();
    if (!res || !res.ok) { toast({ message: failureMessage(res), tone: 'danger' }); return; }
    undoToast({ message: 'New secret key created', detail: 'Send your agency the new one. The old one no longer works.', icon: 'key-round', token: res.undoToken });
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
      const text = res && res.reason === 'disabled' ? 'Funnel enquiries are paused. Switch them on above, then send the test again.' : failureMessage(res, 'The test enquiry did not go through. Please try again.');
      setSent({ error: text });
      toast({ message: text, tone: 'danger' });
      return;
    }
    const b = res.booking;
    // The shell already announces the new enquiry with its own toast, so the confirmation lives here, in the page.
    setSent({ id: b.id, ref: b.ref, name: b.customer.name, postcode: b.address.postcode });
  };

  const on = !!hook.enabled;
  const waiting = on && !hook.lastEventAt;
  return html`<div class="db-page k1-page" data-testid="k1-webhook">
    <${PageHeader}
      back=${{ href: routeHref('connections'), label: 'Back to Connections' }}
      eyebrow="Connections" title="Keep your Facebook funnel"
      subtitle="Your agency keeps running the funnel. Every enquiry it collects lands here too."
    />
    <${SimBanner} compact />
    <${StorageNote} />

    <section class="k1-panel k1-agency-card" aria-labelledby="k1-agency-title" data-testid="k1-agency">
      <div class="k1-panel__head">
        <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="send" size=${22} /></span>
        <div>
          <h2 class="k1-panel__title" id="k1-agency-title">One message to your agency</h2>
          <p class="k1-panel__sub">They add one line to your funnel. We write the message for you, with everything they need.</p>
        </div>
      </div>
      <${Button} variant="primary" size="lg" block icon="send" onClick=${() => setAgencyOpen(true)} data-testid="k1-agency-send">Send these instructions to my agency<//>
      <p class="k1-tip" data-testid="k1-utm-tip"><${Icon} name="lightbulb" size=${18} /><span><strong>Tip:</strong> ask them to put <span class="k1-inline-code">utm_source=facebook</span> in the ad link. Each enquiry then says which ad it came from.</span></p>
    </section>

    <section class="k1-panel" aria-label="Funnel enquiries" data-testid="k1-hook-status">
      <div class="k1-panel__head">
        <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="webhook" size=${22} /></span>
        <div>
          <h2 class="k1-panel__title">Enquiries from your funnel</h2>
          <p class="k1-panel__sub" data-testid="k1-last-event">${hook.lastEventAt ? `Last enquiry ${whenText(hook.lastEventAt)}` : 'None yet'}</p>
        </div>
        <${ConnectionBadge} status=${waiting ? 'pending' : on ? 'connected' : 'off'} label=${waiting ? 'Waiting for your first enquiry' : on ? 'On' : 'Paused'} data-testid="k1-hook-badge" />
      </div>
      <${Switch} checked=${on} onChange=${toggle} label="Accept enquiries from my funnel"
        description=${on ? 'Switch off to pause. Anything your funnel sends is then ignored.' : 'Paused. Switch on to accept enquiries again.'} data-testid="k1-hook-switch" />
    </section>

    <section class="k1-panel" aria-labelledby="k1-test-title" data-testid="k1-test">
      <div class="k1-panel__head">
        <span class="k1-panel__icon" aria-hidden="true"><${Icon} name="circle-check" size=${22} /></span>
        <div>
          <h2 class="k1-panel__title" id="k1-test-title">Try it</h2>
          <p class="k1-panel__sub">Sends a pretend enquiry the way a real one would arrive. It also marks this as tried out.</p>
        </div>
      </div>
      <${Button} variant="secondary" icon="send" loading=${sending} onClick=${send} data-testid="k1-test-send">Send test enquiry<//>
      <div aria-live="polite" class="k1-live-region">
        ${sent && sent.error ? html`<${Banner} tone="warn" data-testid="k1-test-error">${sent.error}<//>` : null}
        ${sent && sent.ok !== false && sent.id ? html`<${Banner} tone="ok" data-testid="k1-test-result"
          actions=${html`<${Button} size="sm" variant="secondary" iconRight="arrow-right" href=${routeHref('bookings', { id: sent.id })} data-testid="k1-test-open">Open the enquiry<//>`}>
          <strong>Test enquiry received.</strong> ${sent.name}, ${sent.postcode} (${sent.ref}) is in your Bookings. Practice mode.
        <//>` : null}
        ${!sent && latest ? html`<p class="k1-small" data-testid="k1-test-latest">Latest from the funnel: <strong>${latest.customer.name}</strong> (${latest.ref}).
          <a class="k1-link" href=${routeHref('bookings', { id: latest.id })} data-testid="k1-test-latest-open">Open it</a></p>` : null}
      </div>
    </section>

    <${Disclosure} title="Technical details" summary="For your agency" class="k1-tech" testid="k1-tech">
      <div class="k1-tech__body">
        <section class="k1-section" aria-labelledby="k1-endpoint-title" data-testid="k1-endpoint">
          <h2 class="k1-section__title" id="k1-endpoint-title">Where to send enquiries</h2>
          <p class="k1-section__intro">The message above already has these. Both are examples: nothing arrives from a real funnel.</p>
          <${CopyField} label="Webhook address" value=${hook.url} testid="k1-webhook-url" hint="Where the funnel sends each enquiry. This is a placeholder address." />
          <${CopyField} label="Secret key" value=${hook.secret} secret testid="k1-webhook-secret" hint="Like a password for that address. Keep it private." />
          <div class="k1-actions">
            <${Button} variant="secondary" size="sm" icon="refresh-cw" onClick=${() => setConfirmRotate(true)} data-testid="k1-secret-rotate">Make a new secret<//>
          </div>
        </section>

        <section class="k1-section" aria-labelledby="k1-map-title" data-testid="k1-mapping">
          <h2 class="k1-section__title" id="k1-map-title">Which answer goes where</h2>
          <p class="k1-section__intro">Each answer is sent under the name shown. These names and words are exact: they are the ones we recognise.</p>
          <${DataTable} caption="Funnel questions and the field each one is sent as" testid="k1-map-table" rows=${MAPPING} rowKey=${(r) => r.id}
            rowTestid=${(r) => `k1-map-row-${r.id}`} columns=${MAPPING_COLUMNS} />
        </section>

        <section class="k1-section" aria-labelledby="k1-payload-title">
          <h2 class="k1-section__title" id="k1-payload-title">What arrives</h2>
          <p class="k1-section__intro">One enquiry, as your funnel would send it. All the values are samples.</p>
          <${CodeBlock} label="Example enquiry" language="json" code=${payload} testid="k1-payload" />
        </section>
      </div>
    <//>

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
      'Checking the secret key on every post, so nobody can send fake enquiries',
      'Handling repeats and retries without creating the same enquiry twice',
      'Saving each enquiry in a database and sending the WhatsApp alert for real'
    ]} />

    <${Sheet} open=${agencyOpen} title="Send these instructions" testid="k1-agency-sheet" onClose=${() => setAgencyOpen(false)}
      description="Pick how to send them. The message is written for you: your agency reads it and adds the webhook to your funnel.">
      <div class="k1-agency">
        <pre class="k1-agency__preview" tabindex="0" aria-label="The message your agency will get" data-testid="k1-agency-preview">${message}</pre>
        <div class="k1-agency__actions">
          <${Button} variant="primary" size="lg" block icon="message-circle" href=${waHref} onClick=${() => setAgencyOpen(false)} data-testid="k1-agency-whatsapp">Send by WhatsApp<//>
          <${Button} variant="secondary" size="lg" block icon="mail" href=${mailHref} onClick=${() => setAgencyOpen(false)} data-testid="k1-agency-email">Send by email<//>
          <${Button} variant="ghost" icon="copy" onClick=${copyMessage} data-testid="k1-agency-copy">Copy the message<//>
        </div>
        <p class="k1-small">WhatsApp and your email app open with the message ready. You choose who it goes to. Nothing is sent from this prototype.</p>
      </div>
    <//>

    <${ConfirmDialog} open=${confirmRotate} tone="danger" title="Make a new secret?"
      body="Your funnel will stop being accepted until your agency has the new secret. You can undo this straight afterwards."
      confirmLabel="Make a new secret" cancelLabel="Keep the old one" onConfirm=${rotate} onCancel=${() => setConfirmRotate(false)} />
  </div>`;
}
