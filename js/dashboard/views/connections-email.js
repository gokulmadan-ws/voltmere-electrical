// js/dashboard/views/connections-email.js: Gmail wizard (4 steps) and its connected dashboard, with a styled preview of the email a customer would get. SIMULATED.
// Owner: K2
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Button, Card, Field, Icon, Input, RealBuildNote, Segmented, SimBanner, Stat, Switch, Wizard,
  focusTitle, toast, useBrand, useStore
} from '../../ui/index.js';
import { failureMessage } from '../../ui/util.js';
import { sendTestEvent, setConnection, settleConnections } from '../../core/store.js';
import { selectConnectionsSummary } from '../../core/selectors.js';
import { isValidEmail } from '../../core/connections.js';
import { buildMessage } from '../../core/messages.js';
import { DEFAULT_TEMPLATES } from '../../core/config.js';
import { SAMPLE_CUSTOMER } from '../../core/seed.js';
import { routeHref, navigate } from '../router.js';
import { GoogleConnect } from './connections-calendar.js';
import {
  ConnHeader, ConnectedHero, DisconnectPanel, Explain, Logo, Section, TickList, failToast, selectLogo, sinceText, stepMemory, useLocalPref
} from './connections-whatsapp.js';

export const title = 'Gmail';
export const css = ['css/connections-wizards.css'];

const STEP_KEY = 'k2_email_step';
const PREF_KEY = 'k2_email_prefs';
// CONTRACT-GAP: the store keeps confirmations and quotes but no review-request setting. It is saved per device (k2_email_prefs).
const PREF_DEFAULTS = { reviews: true };
const STEPS = ['connect', 'from', 'what', 'preview'];
const PROVIDER = { name: 'Gmail', service: '', icon: 'mail' };
const SCOPES = [
  { id: 'send', label: 'Send email on your behalf', detail: 'So confirmations and quotes go out from your own address. It cannot read your inbox.' },
  { id: 'address', label: 'See your email address', detail: 'To show which Google account is connected.' }
];

const selectEmail = (state) => state.settings.connections.email;
const selectEmailSummary = (state) => selectConnectionsSummary(state).find((row) => row.key === 'email');

// The three emails shown in the preview: which template, the subject line, and the button an email client would show.
const SAMPLES = {
  confirmation: { kind: 'customer_confirmed', label: 'Confirmation', subject: (biz) => `Your visit with ${biz} is confirmed`, button: '' },
  quote: { kind: 'customer_quote_sent', label: 'Quote', subject: (biz) => `Your quote from ${biz}`, button: 'View your quote' },
  review: { kind: 'customer_review_request', label: 'Review', subject: (biz) => `How did we do? ${biz}`, button: '' }
};
const SAMPLE_OPTIONS = Object.keys(SAMPLES).map((id) => ({ value: id, label: SAMPLES[id].label, testid: `k2-email-sample-${id}` }));

/**
 * The email for one sample, built with the REAL template text and a real record from the store (a sample customer).
 * Returns plain strings so a view can select it cheaply. `real` is false when the store had nothing suitable.
 */
function emailSample(state, id) {
  const sample = SAMPLES[id];
  const biz = state.settings.business.name;
  const base = { subject: sample.subject(biz), button: sample.button, kind: sample.kind };
  let booking = null;
  let quote = null;
  try {
    if (id === 'quote') {
      quote = Object.values(state.quotes || {}).find((q) => q.status === 'sent' || q.status === 'viewed') || null;
      booking = quote ? state.bookings.find((b) => b.id === quote.bookingId) || null : null;
    } else if (id === 'confirmation') {
      booking = state.bookings.find((b) => b.status === 'confirmed' && (b.serviceId === 'ev_quote' || b.serviceId === 'ev')) || state.bookings.find((b) => b.status === 'confirmed') || null;
    } else {
      booking = state.bookings.find((b) => b.status === 'done' && b.customer && b.customer.email) || null;
    }
    if (booking) {
      const msg = buildMessage(sample.kind, booking, state, { channel: 'email', quote: quote || undefined });
      return { ...base, real: true, toName: booking.customer.name, toEmail: booking.customer.email || `${booking.customer.name.split(' ')[0].toLowerCase()}@example.com`, body: msg.body };
    }
  } catch (e) { /* fall through to the raw template */ }
  return { ...base, real: false, toName: SAMPLE_CUSTOMER.name, toEmail: 'customer@example.com', body: DEFAULT_TEMPLATES[sample.kind] };
}

/** One styled email, the way a customer's inbox would show it. Always drawn on "paper" so it reads the same in dark and light. */
function EmailCard({ from, to, subject, body, button, logo, brand, testid }) {
  const paragraphs = String(body || '').split('\n').filter((line) => line.trim() !== '');
  return html`<article class="k2-email" aria-label=${`Preview of the email: ${subject}`} data-testid=${testid}>
    <dl class="k2-email__meta">
      <div class="k2-email__row"><dt>From</dt><dd data-testid=${`${testid}-from`}><span class="k2-email__name">${from.name}</span><span class="k2-email__addr">${from.address}</span></dd></div>
      <div class="k2-email__row"><dt>To</dt><dd data-testid=${`${testid}-to`}><span class="k2-email__name">${to.name}</span><span class="k2-email__addr">${to.address}</span></dd></div>
      <div class="k2-email__row"><dt>Subject</dt><dd class="k2-email__subject" data-testid=${`${testid}-subject`}>${subject}</dd></div>
    </dl>
    <div class="k2-email__paper">
      <div class="k2-email__band"><${Logo} src=${logo} size=${44} wide /><span class="k2-email__slash" aria-hidden="true"></span></div>
      <div class="k2-email__body" data-testid=${`${testid}-body`}>
        ${paragraphs.map((line, i) => html`<p key=${i}>${line.split(/(https?:\/\/\S+)/g).map((part, j) => (/^https?:\/\//.test(part) ? html`<span class="k2-email__link" key=${j}>${part}</span>` : part))}</p>`)}
        ${button ? html`<p class="k2-email__btnrow"><span class="k2-email__btn">${button}</span></p>` : null}
      </div>
      <p class="k2-email__foot">${brand.name} · ${brand.phone} · Serving ${brand.areaName}</p>
    </div>
  </article>`;
}

function EmailPreview({ sendFrom, testid = 'k2-email-preview' }) {
  const brand = useBrand();
  const logo = useStore(selectLogo);
  const [which, setWhich] = useState('quote');
  const sample = useStore((state) => emailSample(state, which));
  return html`<div class="k2-preview" data-testid=${testid}>
    <${Segmented} ariaLabel="Which email to preview" options=${SAMPLE_OPTIONS} value=${which} onChange=${setWhich} />
    <${EmailCard} testid="k2-email-card" from=${{ name: brand.name, address: sendFrom }} to=${{ name: sample.toName, address: sample.toEmail }} subject=${sample.subject}
      body=${sample.body} button=${sample.button} logo=${logo} brand=${brand} />
    <p class="k2-note">${sample.real ? 'The wording is your real message template, filled in for a sample customer.' : 'The wording is your real message template. Placeholders in curly brackets are filled in for each customer.'}</p>
  </div>`;
}

/** Radio cards for the address emails come from. */
function SendFromChoice({ mode, other, businessEmail, account, onMode, onOther, invalid }) {
  const card = (value, titleText, sub, testid) => html`<label class=${`k2-choice${mode === value ? ' is-on' : ''}`}>
    <input class="k2-choice__input" type="radio" name="k2-email-from" value=${value} checked=${mode === value} onChange=${() => onMode(value)} data-testid=${testid} />
    <span class="k2-choice__dot" aria-hidden="true"></span>
    <span class="k2-choice__body"><span class="k2-choice__title k2-choice__title--mono">${titleText}</span><span class="k2-choice__sub">${sub}</span></span>
  </label>`;
  return html`<fieldset class="k2-choices" data-testid="k2-email-choice">
    <legend class="u-sr-only">Which address should emails come from</legend>
    ${card('business', businessEmail, 'Your business address. Recommended, customers see a name they recognise.', 'k2-email-from-business')}
    ${account && account !== businessEmail ? card('account', account, 'The Google account you connected.', 'k2-email-from-account') : null}
    ${card('other', 'A different address', 'It has to be an address your Google account is allowed to send as.', 'k2-email-from-other')}
    ${mode === 'other'
      ? html`<${Field} label="Send from" id="k2-email-other" hint="Gmail can only send as the account you connected, or an address that account is already set up to send as.">
        <${Input} id="k2-email-other" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck=${false} value=${other}
          placeholder="name@example.co.uk" error=${invalid} onInput=${(e) => onOther(e.target.value)} data-testid="k2-email-other" />
      <//>`
      : null}
  </fieldset>`;
}

function WhatPanel({ em, prefs, patchPrefs }) {
  const save = (patch) => {
    const res = setConnection('email', patch);
    if (!res.ok) failToast(res);
  };
  return html`<div class="k2-prefs" data-testid="k2-email-what">
    <${Card} class="k2-switches" padded=${false}>
      <${Switch} checked=${em.confirmations} label="Booking confirmations" description="An email when you confirm a survey visit or an install day."
        onChange=${(v) => save({ confirmations: v })} data-testid="k2-email-confirmations" />
      <${Switch} checked=${em.quotes} label="Quotes" description="Your written quote by email, with the link to read it and pick an install day."
        onChange=${(v) => save({ quotes: v })} data-testid="k2-email-quotes" />
      <${Switch} checked=${prefs.reviews} label="Review requests" description="A thank-you with a review link a day or two after a job."
        onChange=${(v) => patchPrefs({ reviews: v })} data-testid="k2-email-reviews" />
    <//>
    <p class="k2-note">Saved on this device. The prototype does not send email, a real build would follow these.</p>
  </div>`;
}

/** "Send test email": logs a simulated email-channel message in the outbox and links to Messages. */
function TestEmail({ sendFrom }) {
  const brand = useBrand();
  const logo = useStore(selectLogo);
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = () => {
    if (busy) return;
    setBusy(true);
    const res = sendTestEvent('email');
    setBusy(false);
    if (!res.ok) { failToast(res); return; }
    setLast(res.message);
    toast({ message: 'Test email added to your Messages (simulated).', icon: 'mail-check', actionLabel: 'View', onAction: () => navigate(routeHref('messages')) });
  };
  return html`<div class="k2-test" data-testid="k2-email-test">
    <${Card}>
      <p class="k2-test__text">This adds a test email to your Messages outbox, marked as an email. Nothing is sent to a real inbox.</p>
      <div class="k2-test__actions">
        <${Button} variant="primary" icon="mail-check" onClick=${send} loading=${busy} data-testid="k2-email-test-send">Send test email<//>
        ${last ? html`<${Button} href=${routeHref('messages')} icon="message-circle" data-testid="k2-email-test-link">See it in Messages<//>` : null}
      </div>
    <//>
    ${last ? html`<div class="k2-test__result" data-testid="k2-email-test-result" role="status">
      <${EmailCard} testid="k2-email-test-card" from=${{ name: brand.name, address: sendFrom }} to=${{ name: brand.ownerFirst, address: last.toEmail || brand.email }} subject=${`Test email from ${brand.name}`}
        body=${String(last.body).replace(/\*/g, '')} button="" logo=${logo} brand=${brand} />
    </div>` : null}
  </div>`;
}

const REAL_BUILD_EMAIL = [
  'Two ways to send: the Gmail API (mail goes out from your own Gmail or Google Workspace account, simple at low volume) or a transactional email service (built for volume, delivery tracking and bounces).',
  'The Gmail API needs the same Google sign-in set-up and review as Calendar. Gmail also limits how many emails go out each day, so it suits a handful a day, not campaigns.',
  'Sending from your own address needs SPF and DKIM records on 180electrical.co.uk, and ideally DMARC, so messages reach the inbox instead of spam.',
  'A plan for replies, bounces and unsubscribes: where replies land and who deals with an address that bounces.',
  'The email designs tested in Gmail, Outlook and on phones.'
];

function EmailRealBuild() {
  return html`<${RealBuildNote} items=${REAL_BUILD_EMAIL}>
    <p class="k2-realbuild__time" data-testid="k2-email-timescale"><strong>Typical timescale:</strong> about a week once the domain records are in place. Google's review adds time if the Gmail API is used.</p>
  <//>`;
}

const modeOf = (em, businessEmail) => (em.sendFrom === businessEmail ? 'business' : (em.account && em.sendFrom === em.account ? 'account' : 'other'));

function EmailWizard({ em, onDone }) {
  const brand = useBrand();
  const [prefs, patchPrefs] = useLocalPref(PREF_KEY, PREF_DEFAULTS);
  const connected = em.status === 'connected';
  const [step, setStep] = useState(() => {
    const saved = stepMemory.get(STEP_KEY);
    if (em.status !== 'connected') return 'connect';
    return STEPS.includes(saved) ? saved : 'from';
  });
  const [mode, setMode] = useState(() => modeOf(em, brand.email));
  const [other, setOther] = useState(() => (modeOf(em, brand.email) === 'other' ? em.sendFrom : ''));
  const [otherBad, setOtherBad] = useState(false);
  const goStep = (id) => { setStep(id); stepMemory.set(STEP_KEY, id); };
  useEffect(() => { if (!connected && step !== 'connect') goStep('connect'); }, [connected]);

  const steps = [
    {
      id: 'connect', title: 'Connect Gmail', hint: 'Sign in with the Google account you send email from.', canNext: connected, nextLabel: 'Next',
      content: html`<div class="k2-stack">
        <${Explain} icon="mail" title="What does connecting do?" testid="k2-email-explain">
          <p>Customers get confirmations and quotes by email as well as WhatsApp, from an address they recognise.</p>
          <${TickList} items=${[`Emails come from ${brand.email}, not a no-reply address.`, 'Replies come straight to your inbox.', 'A good backup for customers who do not use WhatsApp.']} />
        <//>
        <${GoogleConnect} service="email" provider=${PROVIDER} scopes=${SCOPES} label="Gmail" ctaLabel="Connect with Google" testid="k2-email"
          connected=${connected} account=${em.account} onConnected=${() => goStep('from')} />
      </div>`
    },
    {
      id: 'from', title: 'Send from', hint: 'Which address should customers see on your emails?',
      validate: () => {
        const value = mode === 'business' ? brand.email : mode === 'account' ? em.account : other.trim();
        if (!isValidEmail(value)) { setOtherBad(true); return 'Enter an email address like daniel@180electrical.co.uk.'; }
        setOtherBad(false);
        const res = setConnection('email', { sendFrom: value });
        return res.ok ? true : failureMessage(res);
      },
      content: html`<${SendFromChoice} mode=${mode} other=${other} businessEmail=${brand.email} account=${em.account} invalid=${otherBad}
        onMode=${(m) => { setMode(m); setOtherBad(false); }} onOther=${(v) => { setOther(v); setOtherBad(false); }} />`
    },
    {
      id: 'what', title: 'What to send', hint: 'Switch on the emails you want customers to get. You can change these any time.',
      content: html`<${WhatPanel} em=${em} prefs=${prefs} patchPrefs=${patchPrefs} />`
    },
    {
      id: 'preview', title: 'Preview and test', hint: 'This is the email a customer would get. Send yourself a test to see it in Messages.', nextLabel: 'Finish',
      content: html`<div class="k2-stack">
        <${EmailPreview} sendFrom=${em.sendFrom} />
        <${TestEmail} sendFrom=${em.sendFrom} />
      </div>`
    }
  ];

  const finish = () => {
    stepMemory.clear(STEP_KEY);
    onDone();
    toast({ message: 'Gmail is set up (simulated).', icon: 'circle-check' });
    window.scrollTo(0, 0);
    setTimeout(() => focusTitle(), 60);
    return true;
  };

  return html`<${Wizard} title="Set-up" steps=${steps} step=${step} onStepChange=${goStep} onFinish=${finish} finishLabel="Finish"
    onCancel=${() => navigate(routeHref('connections'))} testid="k2-email-wizard" />`;
}

function EmailDashboard({ em }) {
  const brand = useBrand();
  const summary = useStore(selectEmailSummary);
  const [prefs, patchPrefs] = useLocalPref(PREF_KEY, PREF_DEFAULTS);
  const [mode, setMode] = useState(() => modeOf(em, brand.email));
  const [other, setOther] = useState(() => (modeOf(em, brand.email) === 'other' ? em.sendFrom : ''));
  const [otherBad, setOtherBad] = useState(false);
  const chosen = mode === 'business' ? brand.email : mode === 'account' ? em.account : other.trim();
  const dirty = chosen !== em.sendFrom;

  const saveFrom = () => {
    if (!isValidEmail(chosen)) { setOtherBad(true); toast({ message: 'Enter an email address like daniel@180electrical.co.uk.', tone: 'danger' }); return; }
    setOtherBad(false);
    const res = setConnection('email', { sendFrom: chosen });
    if (res.ok) toast({ message: `Emails will come from ${chosen} (simulated).`, icon: 'circle-check' }); else failToast(res);
  };

  return html`<div class="k2-stack" data-testid="k2-email-connected">
    <${ConnectedHero} testid="k2-email-hero" badgeTestid="k2-email-status" icon="mail" title="Gmail"
      lines=${[{ text: em.account, mono: true }, { text: `Sending from ${em.sendFrom}` }]}
      status=${summary ? summary.status : 'connected'} label=${summary ? summary.label : 'Connected'} since=${sinceText(em.connectedAt)} />
    <div class="k2-stats">
      <${Stat} label="Bookings" value=${em.confirmations ? 'On' : 'Off'} data-testid="k2-email-stat-confirmations" />
      <${Stat} label="Quotes" value=${em.quotes ? 'On' : 'Off'} data-testid="k2-email-stat-quotes" />
      <${Stat} label="Reviews" value=${prefs.reviews ? 'On' : 'Off'} data-testid="k2-email-stat-reviews" />
    </div>
    <div class="k2-cols">
      <div class="k2-col">
        <${Section} title="What the customer gets" hint="Your real message wording, in an email." testid="k2-email-section-preview"><${EmailPreview} sendFrom=${em.sendFrom} /><//>
      </div>
      <div class="k2-col">
        <${Section} title="What to send" testid="k2-email-section-what"><${WhatPanel} em=${em} prefs=${prefs} patchPrefs=${patchPrefs} /><//>
        <${Section} title="Send from" testid="k2-email-section-from">
          <${SendFromChoice} mode=${mode} other=${other} businessEmail=${brand.email} account=${em.account} invalid=${otherBad}
            onMode=${(m) => { setMode(m); setOtherBad(false); }} onOther=${(v) => { setOther(v); setOtherBad(false); }} />
          <${Button} variant="primary" icon="save" onClick=${saveFrom} disabled=${!dirty} data-testid="k2-email-from-save">Use this address<//>
        <//>
        <${Section} title="Send a test email" testid="k2-email-section-test"><${TestEmail} sendFrom=${em.sendFrom} /><//>
      </div>
    </div>
    <${EmailRealBuild} />
    <${DisconnectPanel} connKey="email" name="Gmail" testid="k2-email-disconnect"
      body="Stops 180 sending email from this account. WhatsApp is not affected."
      confirmBody="Confirmations, quotes and review requests would stop going out by email. WhatsApp messages carry on as they are." />
  </div>`;
}

export default function EmailView() {
  const em = useStore(selectEmail);
  const [setup, setSetup] = useState(() => em.status !== 'connected' || !!stepMemory.get(STEP_KEY));
  const last = useRef(em.status);
  useEffect(() => {
    if (last.current === 'connected' && em.status !== 'connected') { setSetup(true); stepMemory.clear(STEP_KEY); }
    // Connected again with no wizard step in progress (an Undo of Disconnect): nothing is left to set up.
    else if (last.current !== 'connected' && em.status === 'connected' && !stepMemory.get(STEP_KEY)) setSetup(false);
    last.current = em.status;
  }, [em.status]);
  useEffect(() => { settleConnections(); }, []);
  const wizard = em.status !== 'connected' || setup;
  return html`<div class="db-page k2-page" data-testid="k2-email-root">
    <${ConnHeader} title=${wizard ? 'Connect Gmail' : 'Gmail'} subtitle="Confirmations and quotes by email, from your own address." />
    <${SimBanner} />
    ${wizard ? html`<${EmailWizard} em=${em} onDone=${() => setSetup(false)} />` : html`<${EmailDashboard} em=${em} />`}
  </div>`;
}
