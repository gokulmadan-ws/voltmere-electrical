// js/dashboard/views/demo.js: Demo tools (demo phone, sample enquiries with photos, customer quote actions, webhook and DNS shortcuts, reset, script).
// Owner: E3 (v1 by WP8, EV enquiry script by E2)
import { STORAGE_FULL_TEXT } from '../../ui/util.js';
import { html, useState } from '../../vendor/preact-htm.js';
import {
  Button, Card, ConfirmDialog, Field, Icon, Input, PageHeader, TextLink,
  pageHref, pageTarget, toast, useStore
} from '../../ui/index.js';
import {
  acceptQuote, addBookingPhotos, checkDomain, declineQuote, getState, getStorageStatus, recordQuoteViewed, resetDemo, sendTestEvent,
  setDemoPhone, simulateIncomingBooking
} from '../../core/store.js';
import { clockOverrideStamp, isClockOverridden } from '../../core/clock.js';
import { nextFreeSlot } from '../../core/availability.js';
import { quoteStatus, quoteTotal, selectQuotes } from '../../core/selectors.js';
import { firstName, gbp } from '../../core/format.js';
import { routeHref } from '../router.js';
import { makeSamplePhotos } from '../shared/photos.js';

export const title = 'Demo tools';
export const css = ['css/settings.css'];

const selectDemoDigits = (state) => state.settings.demoPhoneDigits || '';

// The short script (prep, then the five minutes). Plain text, nothing dated. The full version, with every tap and what to say, is docs/DEMO-SCRIPT.md.
const PREP_STEPS = [
  'Two phones, each in a normal browser tab (not an installed home-screen app): phone A is the customer, phone B is the owner. Both open this site.',
  'Care: the customer\'s Send my enquiry to Daniel on WhatsApp button opens a chat to the real number, 07885 496800. On each phone, here in Demo tools, type the OTHER phone\'s mobile under Try on your phone and tap Save, so nothing goes to the real owner. (If phone B is the owner\'s own phone, leave phone B pointing at phone A and phone A at the default.)',
  'On phone B tap Reset diary and messages for a fresh diary, then put phone A on the customer site.',
  'One phone only? Use Add a sample website enquiry and the A customer... buttons below instead of the second phone.'
];
const SCRIPT_STEPS = [
  'Phone A, customer site: show the hero, his credentials and the "Get my installation quote" button. In the strip at the top, tap Only my content, then With ideas: anything we added is tagged "Idea from us". Say: this is your site, word for word.',
  'Phone A: tap the button and answer the six steps: a BT postcode such as BT9 6QP, Private driveway, "It\'s ordered or arriving soon", As soon as possible, Yes, then a name, the phone\'s real mobile and an email. No price is shown and nothing is charged.',
  'Phone A: the confirmation says "Thanks, your enquiry has been received." Tap Send my enquiry to Daniel on WhatsApp and press send. Say: in a live build his funnel webhook does this with no tapping.',
  'Phone B: in WhatsApp tap the link in the customer\'s message. The Import screen shows exactly what they typed. Tap Add to my dashboard, then Open the enquiry and Confirm survey visit.',
  'Phone B: More, Quotes, New quote, pick the enquiry, tap Send, then WhatsApp, and press send. Every price is a labelled sample.',
  'Phone A: tap the link in the quote message. The quote opens on a phone that never saw it. Tap Accept quote, choose the days that suit (for example Thu, Fri, Morning), tap Open WhatsApp and press send.',
  'Phone B: tap the link in the reply. Tap Mark quote accepted and plan the install, then Plan the install day, choose a day and Set this day, then Confirm install day. Open More, Pipeline to show the whole process.',
  'Finish on More, What\'s real: the honest list of what is simulated, and what a live build replaces (his funnel webhook, a database, a login and automatic delivery).'
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

  // ---- B. Simulate a website enquiry (the same code as the funnel) ----
  const [result, setResult] = useState(null); // null | { ok, booking, note } | { ok: false }
  const simulate = (kind, withPhotos) => {
    const res = simulateIncomingBooking({ kind });
    if (!res.ok) { setResult({ ok: false, reason: res.reason }); return; }
    let note = '';
    if (withPhotos) {
      try {
        const photos = addBookingPhotos(res.booking.id, makeSamplePhotos(2));
        note = photos.ok ? ` with ${photos.added} sample photos` : ' (the photos could not be added)';
      } catch (err) {
        note = ' (the photos could not be added)';
      }
    }
    setResult({ ok: true, booking: res.booking, note });
  };

  // ---- C. A customer acts on a quote ----
  const [quoteResult, setQuoteResult] = useState(null); // null | { text, href? }
  const quotesNow = () => selectQuotes(getState());
  const waitingQuote = (statuses) => quotesNow().find((q) => statuses.includes(quoteStatus(q)));
  const viewQuote = () => {
    const q = waitingQuote(['sent']);
    if (!q) { setQuoteResult({ text: 'No unopened quote to open. Send a quote from a booking first.' }); return; }
    const res = recordQuoteViewed(q.id);
    setQuoteResult(res.ok ? { text: `${q.customerName} opened quote ${q.id}.`, href: routeHref('quote-detail', { id: q.id }) } : { text: 'That did not work. Please try again.' });
  };
  const acceptOne = () => {
    const q = waitingQuote(['sent', 'viewed']);
    if (!q) { setQuoteResult({ text: 'No quote is waiting on a customer. Send a quote from a booking first.' }); return; }
    const slot = nextFreeSlot(getState(), 'ev');
    if (!slot) { setQuoteResult({ text: 'No free install day to offer. Free one up in Calendar.' }); return; }
    let res = acceptQuote(q.id, { date: slot.date, windowId: slot.windowId });
    if (!res.ok && res.reason === 'slot_taken' && res.alternatives && res.alternatives[0]) res = acceptQuote(q.id, { date: res.alternatives[0].date, windowId: res.alternatives[0].windowId });
    if (res.ok) setQuoteResult({ text: `${q.customerName} accepted ${q.id} (${gbp(quoteTotal(q))}). An install is pencilled in.`, href: routeHref('bookings', { id: res.booking.id }) });
    else setQuoteResult({ text: res.reason === 'expired' ? 'That quote has expired.' : 'That did not work. Please try again.' });
  };
  const declineOne = () => {
    const q = waitingQuote(['sent', 'viewed']);
    if (!q) { setQuoteResult({ text: 'No quote is waiting on a customer.' }); return; }
    const res = declineQuote(q.id, { reason: 'Found a lower price elsewhere', by: 'customer' });
    setQuoteResult(res.ok ? { text: `${q.customerName} declined ${q.id}.`, href: routeHref('quote-detail', { id: q.id }) } : { text: 'That did not work. Please try again.' });
  };
  const openQuote = waitingQuote(['sent', 'viewed', 'accepted']);

  // ---- C2. Connections shortcuts ----
  const [connResult, setConnResult] = useState(null);
  const webhookTest = () => {
    const res = sendTestEvent('webhook');
    if (res.ok) setConnResult({ text: `Added ${res.booking.ref} for ${firstName(res.booking.customer.name)} from the webhook test (simulated).`, href: routeHref('bookings', { id: res.booking.id }) });
    else setConnResult({ text: res.reason === 'disabled' ? 'The webhook is paused. Turn it on in Connections first.' : 'That did not work. Please try again.' });
  };
  const skipDns = () => {
    const before = getState().settings.connections.domain;
    if (before.status === 'none') { setConnResult({ text: 'No domain is being set up yet.', href: routeHref('connections-domain') }); return; }
    let res = checkDomain();
    if (res.ok && res.status !== 'live') res = checkDomain();
    setConnResult(res.ok && res.status === 'live'
      ? { text: `${before.domain} is live, with its security certificate (simulated).`, href: routeHref('connections-domain') }
      : { text: 'That did not work. Please try again.' });
  };

  // ---- D. Reset ----
  const [confirm, setConfirm] = useState(null); // null | 'diary' | 'all'
  const doReset = () => {
    const keepSettings = confirm === 'diary';
    setConfirm(null);
    const res = resetDemo({ keepSettings });
    if (res.ok) {
      setResult(null);
      setQuoteResult(null);
      setConnResult(null);
      toast({ message: keepSettings ? 'Diary, quotes and messages reset.' : 'Everything reset to the defaults.' });
    } else {
      toast({ message: res.reason === 'storage_full' ? STORAGE_FULL_TEXT : 'That did not work: the diary changed. Please check and try again.', tone: 'danger' });
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
        <p class="dm-explain">These sample customers use fictional numbers, which WhatsApp cannot open. Enter your own mobile and every Open in WhatsApp link opens a chat with you instead, including the customer's Send my enquiry to Daniel on WhatsApp message. Stored on this device only.</p>
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

    <section class="db-section" aria-labelledby="dm-loop-title">
      <h2 class="db-section__title" id="dm-loop-title">Two phones, one loop</h2>
      <${Card}>
        <p class="dm-explain">This part is real. The customer's confirmation has a button that opens WhatsApp with their enquiry written out and a link at the end. Opening that link on your phone shows the enquiry in full, and one tap adds it here. A quote you send, and the customer's accept or decline, come back the same way. There is no server: the details travel inside the link. A live build does it by itself through your website webhook.</p>
        <p class="dm-explain">To try it on your own, use two browsers (or a private window): one as the customer, one as the owner. If a link will not open, paste the whole WhatsApp message into the Import screen.</p>
        <${Button} variant="secondary" icon="clipboard-check" href=${routeHref('import')} data-testid="demo-open-import">Paste a customer's WhatsApp message<//>
      <//>
    </section>

    <section class="db-section" aria-labelledby="dm-sim-title">
      <h2 class="db-section__title" id="dm-sim-title">Add a sample website enquiry</h2>
      <${Card}>
        <p class="dm-explain">Runs the same code as the website funnel, so the toast, badge, pencilled-in survey visit, lead source and outbox update exactly as they would for a real enquiry.</p>
        <div class="dm-sim">
          <${Button} variant="primary" onClick=${() => simulate('standard', false)} data-testid="demo-sim-standard">New enquiry<//>
          <${Button} variant="primary" icon="camera" onClick=${() => simulate('standard', true)} data-testid="demo-sim-photos">New enquiry with photos<//>
          <${Button} variant="secondary" onClick=${() => simulate('approval', false)} data-testid="demo-sim-approval">Enquiry outside Northern Ireland<//>
        </div>
        <p class="dm-result" role="status" aria-live="polite" data-testid="demo-sim-result">${result
          ? (result.ok
            ? html`<span>${`Added ${result.booking.ref} for ${firstName(result.booking.customer.name)}${result.note}.`}</span><${TextLink} href=${routeHref('bookings', { id: result.booking.id })}>View<//>`
            : 'No free survey window to pencil in. Free one up in Calendar.')
          : null}</p>
      <//>
    </section>

    <section class="db-section" aria-labelledby="dm-quote-title">
      <h2 class="db-section__title" id="dm-quote-title">A customer acts on a quote</h2>
      <${Card}>
        <p class="dm-explain">Stands in for the customer's phone. These use the real quote code: an accepted quote books the next free install day, pencilled in until you confirm it.</p>
        <div class="dm-sim">
          <${Button} variant="secondary" icon="eye" onClick=${viewQuote} data-testid="demo-quote-view">A customer opens a quote<//>
          <${Button} variant="primary" icon="badge-check" onClick=${acceptOne} data-testid="demo-quote-accept">A customer accepts a quote<//>
          <${Button} variant="secondary" icon="circle-x" onClick=${declineOne} data-testid="demo-quote-decline">A customer declines a quote<//>
        </div>
        <p class="dm-result" role="status" aria-live="polite" data-testid="demo-quote-result">${quoteResult
          ? html`<span>${quoteResult.text}</span>${quoteResult.href ? html`<${TextLink} href=${quoteResult.href}>View<//>` : null}`
          : null}</p>
        ${openQuote
          ? html`<${Button} variant="ghost" icon="external-link" href=${pageHref('quote.html', `#q=${openQuote.id}`)} target=${pageTarget('quote.html')} data-testid="demo-open-quote">${`Open ${openQuote.id} as the customer sees it`}<//>`
          : html`<p class="dm-explain" data-testid="demo-open-quote-none">Send a quote from a booking and its customer page opens from here.</p>`}
      <//>
    </section>

    <section class="db-section" aria-labelledby="dm-conn-title">
      <h2 class="db-section__title" id="dm-conn-title">Connections shortcuts</h2>
      <${Card}>
        <p class="dm-explain">Everything under Connections is simulated. These skip the waiting.</p>
        <div class="dm-sim">
          <${Button} variant="secondary" icon="webhook" onClick=${webhookTest} data-testid="demo-webhook-test">Send a webhook test enquiry<//>
          <${Button} variant="secondary" icon="globe" onClick=${skipDns} data-testid="demo-dns-skip">Skip the DNS wait<//>
          <${Button} variant="ghost" icon="plug-zap" href=${routeHref('connections')} data-testid="demo-open-connections">Open Connections<//>
        </div>
        <p class="dm-result" role="status" aria-live="polite" data-testid="demo-conn-result">${connResult
          ? html`<span>${connResult.text}</span>${connResult.href ? html`<${TextLink} href=${connResult.href}>View<//>` : null}`
          : null}</p>
      <//>
    </section>

    <section class="db-section" aria-labelledby="dm-site-title">
      <h2 class="db-section__title" id="dm-site-title">Customer site</h2>
      <div class="db-stack">
        <${Button} variant="secondary" block icon="external-link" href=${pageHref('index.html')} target=${pageTarget('index.html')} data-testid="demo-open-site">Open the customer site<//>
        <${Button} variant="secondary" block icon="calendar-check" href=${pageHref('index.html', '#book')} target=${pageTarget('index.html')} data-testid="demo-open-booking">Open the quote funnel<//>
      </div>
    </section>

    <section class="db-section" aria-labelledby="dm-reset-title">
      <h2 class="db-section__title" id="dm-reset-title">Reset</h2>
      <${Card}>
        <p class="dm-explain">Start again before a demo. Resetting the diary and messages brings back the sample enquiries, quotes and ad spend; your settings, connections and demo phone number are kept.</p>
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
        <summary class="dm-script__summary">The 5-minute demo script<${Icon} name="chevron-down" size=${22} class="dm-script__chev" /></summary>
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
      body="This reseeds the sample bookings, quotes and messages relative to today. Your business details, photos, price list and connections stay."
      confirmLabel="Reset diary" onConfirm=${doReset} onCancel=${() => setConfirm(null)} />
    <${ConfirmDialog}
      open=${confirm === 'all'} title="Reset everything?"
      body="This also restores the default business details, photos, prices, quote price list, hours and every connection (back to Not set up)."
      confirmLabel="Reset all" tone="danger" onConfirm=${doReset} onCancel=${() => setConfirm(null)} />
  </div>`;
}
