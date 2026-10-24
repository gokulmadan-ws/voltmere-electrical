// js/dashboard/views/demo.js: Demo tools (demo phone override, simulate website bookings, customer-site links, reset, status, script).
// Owner: WP8
import { html, useState } from '../../vendor/preact-htm.js';
import {
  Button, Card, ConfirmDialog, Field, Icon, Input, PageHeader, TextLink,
  pageHref, pageTarget, toast, useStore
} from '../../ui/index.js';
import { getStorageStatus, resetDemo, setDemoPhone, simulateIncomingBooking } from '../../core/store.js';
import { clockOverrideStamp, isClockOverridden } from '../../core/clock.js';
import { firstName } from '../../core/format.js';
import { routeHref } from '../router.js';

export const title = 'Demo tools';
export const css = ['css/settings.css'];

const selectDemoDigits = (state) => state.settings.demoPhoneDigits || '';

// The short script from contract 1.2 (prep, then the three minutes). Plain text, nothing dated.
const PREP_STEPS = [
  'On the phone, in a normal browser tab (not an installed home-screen app), open the customer site and tap Owner login (demo) in the footer. Both pages now share one store.',
  'Here in Demo tools, type your own mobile under Try on your phone and tap Save. Every Open in WhatsApp link then opens your WhatsApp.',
  'Optional: open Settings and change the business name, short name, first name and phone to the friend\'s real details.',
  'Tap Reset diary and messages for a fresh diary, then switch to the customer site tab.'
];
const SCRIPT_STEPS = [
  'Customer site: point at the live next-free chips, the From prices and the sticky Call, WhatsApp and Book bar. Say: this is your website, reading your real diary.',
  'Tap the Landlord safety report tile, Pick this, Continue, Demo: fill sample details, Confirm booking. Four fields, no account, no card.',
  'Tap Open the dashboard in the DEMO panel. The booking lands as a job card with a toast and a Messages badge.',
  'Tap the Messages icon. Show the Compare card, then the new owner alert. Tap Accept (45 min) on the older emergency alert and Open in WhatsApp on the new customer bubble.',
  'Calendar: open the first open day, tap its free 8-10am row, Block this time, Dentist, Block.',
  'View customer site: the first chip has moved on and that window now reads Booked. The diary you edit is the availability customers see.',
  'Flip to dark mode, then open What\'s real in this prototype and read the honest table.'
];

export default function DemoView() {
  const demoDigits = useStore(selectDemoDigits);

  // ---- A. Demo phone ----
  const [phone, setPhone] = useState(demoDigits ? `+${demoDigits}` : '');
  const [phoneError, setPhoneError] = useState('');
  const savePhone = () => {
    const res = setDemoPhone(phone);
    if (res.ok) {
      setPhoneError('');
      if (res.digits) setPhone(`+${res.digits}`);
    } else {
      setPhoneError((res.errors && res.errors.demoPhone) || 'Enter a UK mobile or an international number.');
    }
  };
  const clearPhone = () => {
    setDemoPhone('');
    setPhone('');
    setPhoneError('');
  };

  // ---- B. Simulate a website booking ----
  const [result, setResult] = useState(null); // null | { ok, booking } | { ok: false }
  const simulate = (kind) => {
    const res = simulateIncomingBooking({ kind });
    setResult(res.ok ? { ok: true, booking: res.booking } : { ok: false, reason: res.reason });
  };

  // ---- D. Reset ----
  const [confirm, setConfirm] = useState(null); // null | 'diary' | 'all'
  const doReset = () => {
    const keepSettings = confirm === 'diary';
    setConfirm(null);
    const res = resetDemo({ keepSettings });
    if (res.ok) {
      setResult(null);
      toast({ message: keepSettings ? 'Diary and messages reset.' : 'Everything reset to the defaults.' });
    } else {
      toast({ message: 'That did not work: the diary changed. Please check and try again.', tone: 'danger' });
    }
  };

  // ---- E. Status ----
  const storage = getStorageStatus();
  const overridden = isClockOverridden();

  return html`<div class="db-page">
    <${PageHeader} title="Demo tools" subtitle="Helpers for showing this prototype. Not part of the product." />

    <section class="db-section" aria-labelledby="dm-phone-title">
      <h2 class="db-section__title" id="dm-phone-title">Try on your phone</h2>
      <${Card} class="dm-phone">
        <p class="dm-explain">These sample customers use fictional numbers, which WhatsApp cannot open. Enter your own mobile and every Open in WhatsApp link opens a chat with you instead. Stored on this device only.</p>
        <${Field} label="Open WhatsApp links with this mobile number" id="demo-phone-input" error=${phoneError}>
          <${Input} id="demo-phone-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="07700 900555"
            value=${phone} onInput=${(e) => { setPhone(e.target.value); if (phoneError) setPhoneError(''); }}
            data-testid="demo-phone-input" />
        <//>
        <div class="dm-actions">
          <${Button} variant="primary" onClick=${savePhone} data-testid="demo-phone-save">Save<//>
          <${Button} variant="secondary" onClick=${clearPhone} data-testid="demo-phone-clear">Clear<//>
        </div>
        <p class=${`dm-status${demoDigits ? ' is-on' : ''}`} role="status" data-testid="demo-phone-status">
          <${Icon} name=${demoDigits ? 'circle-check' : 'info'} size=${18} />
          <span>${demoDigits ? `Links open WhatsApp for +${demoDigits}` : 'Not set: links go to the fictional numbers and will not open a chat.'}</span>
        </p>
      <//>
    </section>

    <section class="db-section" aria-labelledby="dm-sim-title">
      <h2 class="db-section__title" id="dm-sim-title">Add a sample website booking</h2>
      <${Card}>
        <p class="dm-explain">Runs the same code as the website form, so the toast, badge and outbox update exactly as they would for a real customer.</p>
        <div class="dm-sim">
          <${Button} variant="primary" onClick=${() => simulate('standard')} data-testid="demo-sim-standard">Standard booking<//>
          <${Button} variant="secondary" onClick=${() => simulate('approval')} data-testid="demo-sim-approval">Needs your OK (edge postcode)<//>
          <${Button} variant="emergency" onClick=${() => simulate('emergency')} data-testid="demo-sim-emergency">Emergency request<//>
        </div>
        <p class="dm-result" role="status" aria-live="polite" data-testid="demo-sim-result">${result
          ? (result.ok
            ? html`<span>${`Added ${result.booking.ref} for ${firstName(result.booking.customer.name)}.`}</span><${TextLink} href=${routeHref('bookings', { id: result.booking.id })}>View<//>`
            : 'No free window to book. Free one up in Calendar.')
          : null}</p>
      <//>
    </section>

    <section class="db-section" aria-labelledby="dm-site-title">
      <h2 class="db-section__title" id="dm-site-title">Customer site</h2>
      <div class="db-stack">
        <${Button} variant="secondary" block icon="external-link" href=${pageHref('index.html')} target=${pageTarget('index.html')} data-testid="demo-open-site">Open the customer site<//>
        <${Button} variant="secondary" block icon="calendar-check" href=${pageHref('index.html', '#book')} target=${pageTarget('index.html')} data-testid="demo-open-booking">Open the booking sheet<//>
      </div>
    </section>

    <section class="db-section" aria-labelledby="dm-reset-title">
      <h2 class="db-section__title" id="dm-reset-title">Reset</h2>
      <${Card}>
        <p class="dm-explain">Start again before a demo. Your phone number, theme and anything else on this page are kept.</p>
        <div class="dm-reset">
          <${Button} variant="secondary" icon="rotate-ccw" onClick=${() => setConfirm('diary')} data-testid="demo-reset">Reset diary and messages<//>
          <${Button} variant="danger" icon="refresh-cw" onClick=${() => setConfirm('all')} data-testid="demo-reset-all">Reset everything<//>
        </div>
      <//>
    </section>

    <section class="db-section" aria-labelledby="dm-status-title">
      <h2 class="db-section__title" id="dm-status-title">Status</h2>
      <div class="db-stack">
        <p class=${`dm-status${storage.ok ? ' is-on' : ''}`} data-testid="demo-storage-status">
          <${Icon} name=${storage.ok ? 'circle-check' : 'triangle-alert'} size=${18} />
          <span>${storage.ok ? 'Saving in this browser: working' : 'Saving is blocked in this browser mode, so bookings made on the website will not appear on the dashboard.'}</span>
        </p>
        ${overridden ? html`<p class="dm-status" data-testid="demo-clock-status">
          <${Icon} name="clock" size=${18} />
          <span>${`Clock override active: ${clockOverrideStamp()}`}</span>
        </p>` : null}
      </div>
    </section>

    <section class="db-section">
      <details class="dm-script" data-testid="demo-script">
        <summary class="dm-script__summary">The 3-minute demo script<${Icon} name="chevron-down" size=${22} class="dm-script__chev" /></summary>
        <div class="dm-script__body">
          <h3 class="dm-script__title">Before you start</h3>
          <ol class="dm-script__list">${PREP_STEPS.map((s, i) => html`<li key=${i}>${s}</li>`)}</ol>
          <h3 class="dm-script__title">The script</h3>
          <ol class="dm-script__list">${SCRIPT_STEPS.map((s, i) => html`<li key=${i}>${s}</li>`)}</ol>
        </div>
      </details>
    </section>

    <${ConfirmDialog}
      open=${confirm === 'diary'} title="Reset the diary?"
      body="This reseeds the sample bookings relative to today and clears messages. Your business details stay."
      confirmLabel="Reset diary" onConfirm=${doReset} onCancel=${() => setConfirm(null)} />
    <${ConfirmDialog}
      open=${confirm === 'all'} title="Reset everything?"
      body="This also restores the default business details, prices and hours."
      confirmLabel="Reset all" tone="danger" onConfirm=${doReset} onCancel=${() => setConfirm(null)} />
  </div>`;
}
