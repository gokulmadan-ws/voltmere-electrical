// js/dashboard/views/connections-whatsapp.js: WhatsApp Business wizard (6 steps) and its connected dashboard. SIMULATED. Also exports the small helpers the other two K2 wizards share.
// Owner: K2
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Button, Card, ConfirmDialog, ConnectionBadge, Field, Icon, Input, Meter, PageHeader, RealBuildNote, Select, SimBanner,
  Stat, Switch, Textarea, WhatsAppBubble, Wizard, focusTitle, showUndoToast, toast, useBrand, useStore
} from '../../ui/index.js';
import { failureMessage } from '../../ui/util.js';
import {
  connectWhatsApp, disconnect, sendTestEvent, setConnection, settleConnections, submitWhatsAppTemplates
} from '../../core/store.js';
import { selectConnectionsSummary, selectImageUrl } from '../../core/selectors.js';
import { normaliseWhatsAppNumber } from '../../core/connections.js';
import { KIND_LABELS, WHATSAPP_DEMO_CODE, WHATSAPP_TEMPLATE_KINDS, DEFAULT_TEMPLATES } from '../../core/config.js';
import { fmtDayShort, stampDay, stampTime } from '../../core/dates.js';
import { routeHref, navigate } from '../router.js';

export const title = 'WhatsApp';
export const css = ['css/connections-wizards.css'];

// ====================================================================================================================
// Shared helpers (also imported by connections-calendar.js and connections-email.js)
// ====================================================================================================================

const memory = new Map(); // per-page fallback when localStorage / sessionStorage are blocked

/** Read a small JSON record from localStorage (memory fallback), merged over `fallback`. Never throws. */
export function readLocal(key, fallback) {
  let raw = null;
  try { raw = window.localStorage.getItem(key); } catch (e) { raw = null; }
  if (raw === null && memory.has(`l:${key}`)) raw = memory.get(`l:${key}`);
  if (raw === null) return fallback;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...fallback, ...value } : fallback;
  } catch (e) {
    return fallback;
  }
}

/** Save a small JSON record to localStorage (memory fallback). Returns true when it reached storage. */
export function writeLocal(key, value) {
  const raw = JSON.stringify(value);
  memory.set(`l:${key}`, raw);
  try { window.localStorage.setItem(key, raw); return true; } catch (e) { return false; }
}

/**
 * A per-device preference record that is NOT part of the store model (see the CONTRACT-GAP notes in each wizard).
 * Follows other tabs through the `storage` event. `patch(change)` saves and returns the new record.
 */
export function useLocalPref(key, defaults) {
  const [value, setValue] = useState(() => readLocal(key, defaults));
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const onStorage = (e) => { if (e.key === key || e.key === null) { const next = readLocal(key, defaults); latest.current = next; setValue(next); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);
  const patch = (change) => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    writeLocal(key, next);
    setValue(next);
    return next;
  };
  return [value, patch];
}

/** sessionStorage with a memory fallback: where a wizard was when the page reloaded. */
export const stepMemory = {
  get(key) { try { return window.sessionStorage.getItem(key) || ''; } catch (e) { return memory.get(`s:${key}`) || ''; } },
  set(key, value) { memory.set(`s:${key}`, value); try { window.sessionStorage.setItem(key, value); } catch (e) { /* memory only */ } },
  clear(key) { memory.delete(`s:${key}`); try { window.sessionStorage.removeItem(key); } catch (e) { /* nothing to clear */ } }
};

/** '+447885496800' -> '+44 7885 496800'. Anything else is shown as stored. */
export function prettyNumber(value) {
  const text = String(value || '');
  const m = /^\+44(\d{4})(\d{6})$/.exec(text);
  return m ? `+44 ${m[1]} ${m[2]}` : text;
}

/** 'Fri 23 Oct, 20:30' from a Stamp (minute or second precision). */
export function sinceText(stamp) {
  if (!stamp) return '';
  return `${fmtDayShort(stampDay(stamp))}, ${stampTime(stamp.slice(0, 16))}`;
}

/** A store failure as a danger toast. */
export function failToast(res, fallback) {
  toast({ message: failureMessage(res, fallback), tone: 'danger' });
}

/** Back link (to the Connections hub) and the title block every K2 screen starts with. */
export function ConnHeader({ title: heading, subtitle }) {
  return html`<${PageHeader} title=${heading} subtitle=${subtitle} back=${{ href: routeHref('connections'), label: 'Back to Connections' }} />`;
}

/** Icon tile + title + plain-English explanation: "What is this and why connect it". */
export function Explain({ icon, title: heading, children, testid }) {
  return html`<${Card} class="k2-explain" data-testid=${testid}>
    <span class="k2-explain__icon" aria-hidden="true"><${Icon} name=${icon} size=${26} /></span>
    <div class="k2-explain__body">
      <h3 class="k2-explain__title">${heading}</h3>
      ${children}
    </div>
  <//>`;
}

/** A short list with a tick per line, used in explanations. */
export function TickList({ items, class: cls = '' }) {
  return html`<ul class=${`k2-ticks ${cls}`}>${items.map((text, i) => html`<li key=${i}><${Icon} name="check" size=${16} /><span>${text}</span></li>`)}</ul>`;
}

/** The connected state's top card: what is connected, to what, and its status. `media` replaces the icon tile. */
export function ConnectedHero({ icon, media, title: heading, lines = [], status, label, since, testid, badgeTestid }) {
  return html`<${Card} class="k2-hero" data-testid=${testid}>
    <div class="k2-hero__top">
      <span class="k2-hero__media" aria-hidden="true">${media || html`<${Icon} name=${icon} size=${28} />`}</span>
      <div class="k2-hero__main">
        <h2 class="k2-hero__title">${heading}</h2>
        ${lines.map((line, i) => html`<p class=${`k2-hero__line${line.mono ? ' k2-hero__line--mono' : ''}`} key=${i}>${line.text}</p>`)}
      </div>
    </div>
    <div class="k2-hero__foot">
      <${ConnectionBadge} status=${status} label=${label} data-testid=${badgeTestid} />
      ${since ? html`<span class="k2-hero__since">Connected ${since} (simulated)</span>` : null}
    </div>
  <//>`;
}

/** Titled block on a connected screen. */
export function Section({ title: heading, hint, children, testid, class: cls = '' }) {
  return html`<section class=${`k2-section ${cls}`} data-testid=${testid}>
    <h2 class="k2-section__title">${heading}</h2>
    ${hint ? html`<p class="k2-section__hint">${hint}</p>` : null}
    ${children}
  </section>`;
}

/** "Disconnect" with a confirm sheet and an Undo toast. `connKey` is the store key. */
export function DisconnectPanel({ connKey, name, body, confirmBody, testid }) {
  const [open, setOpen] = useState(false);
  const run = () => {
    const res = disconnect(connKey);
    setOpen(false);
    if (res.ok) showUndoToast(`${name} disconnected (simulated).`, res.undoToken);
    else failToast(res);
  };
  return html`<${Section} title="Disconnect" testid=${`${testid}-section`} class="k2-section--quiet">
    <${Card} class="k2-disconnect">
      <p class="k2-disconnect__text">${body}</p>
      <${Button} variant="secondary" icon="unplug" onClick=${() => setOpen(true)} data-testid=${testid}>Disconnect ${name}<//>
    <//>
    <${ConfirmDialog} open=${open} tone="danger" title=${`Disconnect ${name}?`} body=${confirmBody}
      confirmLabel="Disconnect" cancelLabel="Keep it connected" onConfirm=${run} onCancel=${() => setOpen(false)} />
  <//>`;
}

// ====================================================================================================================
// WhatsApp
// ====================================================================================================================

const STEP_KEY = 'k2_wa_step';
const PROFILE_KEY = 'k2_wa_profile';
// CONTRACT-GAP: the store keeps only displayName for the WhatsApp profile. Category and about text are saved per device (k2_wa_profile).
const PROFILE_DEFAULTS = { category: 'prof', about: 'Home EV charger installation across Northern Ireland. Free survey, clear written quote.' };
const ABOUT_MAX = 139;
const NAME_MAX = 40;
const RESEND_SECONDS = 30;

const CATEGORIES = [
  { value: 'prof', label: 'Professional services' },
  { value: 'other', label: 'Other' },
  { value: 'auto', label: 'Automotive' },
  { value: 'retail', label: 'Shopping and retail' },
  { value: 'edu', label: 'Education' },
  { value: 'event', label: 'Event planning and service' },
  { value: 'finance', label: 'Finance and banking' },
  { value: 'food', label: 'Food and grocery' },
  { value: 'public', label: 'Public service' },
  { value: 'hotel', label: 'Hotel and lodging' },
  { value: 'health', label: 'Medical and health' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'travel', label: 'Travel and transportation' }
];
const categoryLabel = (value) => (CATEGORIES.find((c) => c.value === value) || CATEGORIES[0]).label;

// Plain-English name and "when it goes" line for every message the system can send.
const TPL_INFO = {
  owner_new_booking: ['New enquiry alert', 'Lands on your phone the moment a customer sends an enquiry or books.'],
  owner_emergency: ['Emergency alert', 'When a customer asks for an emergency visit.'],
  owner_customer_cancelled: ['Customer cancelled', 'When a customer cancels a visit.'],
  owner_customer_rescheduled: ['Customer moved their visit', 'When a customer picks a new time.'],
  owner_quote_accepted: ['Quote accepted', 'When a customer accepts your quote and picks an install day.'],
  owner_quote_declined: ['Quote declined', 'When a customer says no to your quote.'],
  customer_received: ['Enquiry received', 'Straight after a customer sends their enquiry.'],
  customer_confirmed: ['Visit confirmed', 'When you confirm a survey or an install.'],
  customer_declined: ['Sorry, cannot do that time', 'When you cannot make the time they asked for.'],
  customer_rescheduled: ['Visit moved', 'When you change the time of a visit.'],
  customer_on_my_way: ['On my way', 'When you set off for a visit.'],
  customer_emergency_received: ['Emergency request received', 'Straight after an emergency request.'],
  customer_emergency_accepted: ['Emergency accepted', 'When you accept an emergency and are on your way.'],
  customer_completed: ['Job done', 'When you finish a job.'],
  customer_review_request: ['Review request', 'After a job, asking for a review.'],
  customer_reminder: ['Visit reminder', 'The evening before a visit.'],
  customer_cancelled: ['Visit cancelled by you', 'When you have to cancel a visit.'],
  customer_payment_nudge: ['Payment reminder', 'A gentle nudge when a job has not been paid.'],
  customer_running_late: ['Running late', 'When you are running behind.'],
  customer_need_access: ['Need access', 'When you arrive and need to be let in.'],
  customer_quote_ready: ['Quote ready', 'A short note that a written quote is on its way.'],
  customer_quote_sent: ['Your quote', 'When you send a quote, with the link to read and accept it.'],
  customer_quote_accepted: ['Quote accepted, thank you', 'After a customer accepts, with the pencilled-in install day.'],
  customer_photos_request: ['Photos request', 'When you ask for a photo of the consumer unit and charger spot.']
};
const OWNER_KINDS = WHATSAPP_TEMPLATE_KINDS.filter((k) => k.startsWith('owner_'));
const CUSTOMER_KINDS = WHATSAPP_TEMPLATE_KINDS.filter((k) => !k.startsWith('owner_'));
const TEMPLATE_BADGE = {
  approved: { status: 'connected', label: 'Approved' },
  pending: { status: 'pending', label: 'Awaiting approval' },
  none: { status: 'off', label: 'Not sent yet' }
};

const selectWa = (state) => state.settings.connections.whatsapp;
const selectTemplateText = (state) => state.settings.templates;
export const selectLogo = (state) => selectImageUrl(state, 'logo', { width: 320 });
const selectWaSummary = (state) => selectConnectionsSummary(state).find((row) => row.key === 'whatsapp');

const countOf = (templates, status) => WHATSAPP_TEMPLATE_KINDS.filter((k) => ((templates || {})[k] || 'none') === status).length;
const allNone = (templates) => countOf(templates, 'none') === WHATSAPP_TEMPLATE_KINDS.length;
const textFor = (texts, kind) => (texts && texts[kind]) || DEFAULT_TEMPLATES[kind] || '';

const STEPS = ['number', 'code', 'profile', 'templates', 'prefs', 'test'];

/** The step a fresh visit starts on, from what the store already knows. */
function startStep(wa) {
  const allowed = wa.status === 'disconnected' ? ['number'] : wa.status === 'verifying' ? ['number', 'code'] : STEPS;
  const saved = stepMemory.get(STEP_KEY);
  if (allowed.includes(saved)) return saved;
  if (wa.status === 'connected') return 'profile';
  return wa.status === 'verifying' ? 'code' : 'number';
}

/** His logo: a round profile picture, or `wide` (3:2) for the email header. Falls back to the local crop when the photo host cannot be reached. */
export function Logo({ src, size = 64, wide, class: cls = '' }) {
  const fallback = (e) => {
    const img = e.currentTarget;
    img.onerror = null;
    img.src = 'img/logo-180.png';
  };
  return html`<img class=${`k2-logo${wide ? ' k2-logo--wide' : ''} ${cls}`} src=${src} width=${wide ? Math.round(size * 1.5) : size} height=${size} alt="180 Electrical logo"
    loading="lazy" decoding="async" referrerpolicy="no-referrer" onError=${fallback} />`;
}

/** One message template: plain name, approval badge, and the exact text with {placeholders} marked. */
function TemplateText({ text }) {
  const parts = String(text).split(/(\*[^*\n]+\*|\{[A-Za-z0-9_]+\})/g);
  return parts.map((part, i) => {
    if (part.startsWith('{') && part.endsWith('}')) return html`<span class="k2-ph" key=${i}>${part}</span>`;
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return html`<strong key=${i}>${part.slice(1, -1)}</strong>`;
    return part;
  });
}

function TemplateRow({ kind, status, text }) {
  const info = TPL_INFO[kind] || [KIND_LABELS[kind] || kind, ''];
  const badge = TEMPLATE_BADGE[status] || TEMPLATE_BADGE.none;
  return html`<details class="k2-tpl" data-testid=${`k2-wa-tpl-${kind}`}>
    <summary class="k2-tpl__sum">
      <span class="k2-tpl__name">${info[0]}</span>
      <${ConnectionBadge} compact status=${badge.status} label=${badge.label} data-testid=${`k2-wa-tpl-badge-${kind}`} />
      <${Icon} name="chevron-down" size=${18} class="k2-tpl__chev" />
    </summary>
    <div class="k2-tpl__body">
      ${info[1] ? html`<p class="k2-tpl__when">${info[1]}</p>` : null}
      <p class="k2-tpl__text" data-testid=${`k2-wa-tpl-text-${kind}`}><${TemplateText} text=${text} /></p>
    </div>
  </details>`;
}

function TemplateGroup({ heading, kinds, templates, texts, testid, open }) {
  return html`<details class="k2-tplgroup" open=${open ? true : undefined} data-testid=${testid}>
    <summary class="k2-tplgroup__sum">
      <span class="k2-tplgroup__title">${heading}</span>
      <span class="k2-tplgroup__count">${kinds.length}</span>
      <${Icon} name="chevron-down" size=${20} class="k2-tplgroup__chev" />
    </summary>
    <div class="k2-tpllist">
      ${kinds.map((kind) => html`<${TemplateRow} key=${kind} kind=${kind} status=${(templates || {})[kind] || 'none'} text=${textFor(texts, kind)} />`)}
    </div>
  </details>`;
}

/** Summary, the "Submit for approval" button and every message template. Used in the wizard and on the connected screen. */
function TemplatesPanel({ wa, texts, open }) {
  const total = WHATSAPP_TEMPLATE_KINDS.length;
  const approved = countOf(wa.templates, 'approved');
  const pending = countOf(wa.templates, 'pending');
  const none = countOf(wa.templates, 'none');
  const submit = () => {
    const res = submitWhatsAppTemplates();
    if (res.ok) toast({ message: `${none} message templates sent for approval (simulated).`, icon: 'send' });
    else failToast(res);
  };
  let line = `None of the ${total} messages has been sent for approval yet.`;
  if (pending > 0) line = `Waiting for approval: ${pending} of ${total}. This takes a few seconds in the prototype. With Meta it is usually minutes, sometimes up to a day.`;
  else if (approved === total) line = `All ${total} messages approved (simulated).`;
  else if (none > 0 && approved + pending > 0) line = `${approved} approved, ${none} not sent yet.`;
  return html`<div class="k2-tpls" data-testid="k2-wa-templates">
    <${Card} class="k2-tpls__sum">
      <${Meter} label="Messages approved" value=${approved} max=${total} valueText=${`${approved} of ${total} approved`} showValue tone=${approved === total ? 'ok' : 'accent'}
        data-testid="k2-wa-templates-meter" />
      <p class="k2-tpls__line" role="status" aria-live="polite" data-testid="k2-wa-templates-status">${line}</p>
      ${none > 0 ? html`<${Button} variant="primary" icon="send" onClick=${submit} data-testid="k2-wa-templates-submit">Submit for approval<//>` : null}
    <//>
    <${TemplateGroup} heading="Alerts to you" kinds=${OWNER_KINDS} templates=${wa.templates} texts=${texts} open=${open} testid="k2-wa-group-owner" />
    <${TemplateGroup} heading="Messages to your customers" kinds=${CUSTOMER_KINDS} templates=${wa.templates} texts=${texts} open=${open} testid="k2-wa-group-customer" />
  </div>`;
}

/** Display name, category and about text with a live "how customers see you" card. */
function ProfileFields({ name, category, about, onName, onCategory, onAbout, brandName, logo, errorField }) {
  return html`<div class="k2-profile">
    <div class="k2-card-preview" role="group" data-testid="k2-wa-preview" aria-label="Preview of your WhatsApp profile">
      <p class="k2-card-preview__label">How customers see you</p>
      <div class="k2-card-preview__head">
        <${Logo} src=${logo} size=${64} />
        <div class="k2-card-preview__who">
          <p class="k2-card-preview__name" data-testid="k2-wa-preview-name">${name.trim() || brandName}</p>
          <p class="k2-card-preview__cat">Business account, ${categoryLabel(category)}</p>
        </div>
      </div>
      <p class="k2-card-preview__about" data-testid="k2-wa-preview-about">${about.trim() || 'Your short description appears here.'}</p>
      <p class="k2-card-preview__note">WhatsApp shows your logo as a circle.</p>
    </div>
    <div class="k2-profile__fields">
      <${Field} label="Business name" id="k2-wa-name" hint="Use your trading name. Meta checks business names, so a plain one is approved fastest.">
        <${Input} id="k2-wa-name" value=${name} maxlength=${NAME_MAX} autocomplete="organization" error=${errorField === 'name'}
          onInput=${(e) => onName(e.target.value)} data-testid="k2-wa-display-name" />
      <//>
      <${Field} label="Category" id="k2-wa-category">
        <${Select} id="k2-wa-category" value=${category} options=${CATEGORIES} onChange=${(e) => onCategory(e.target.value)} data-testid="k2-wa-category" />
      <//>
      <${Field} label="About" id="k2-wa-about" hint=${`${about.length} of ${ABOUT_MAX} characters`}>
        <${Textarea} id="k2-wa-about" value=${about} rows=${3} maxlength=${ABOUT_MAX} error=${errorField === 'about'}
          onInput=${(e) => onAbout(e.target.value)} data-testid="k2-wa-about" />
      <//>
    </div>
  </div>`;
}

/** Owner alerts, customer updates and quiet hours. Every change is saved straight away. */
function PrefsPanel({ wa }) {
  const q = wa.quietHours || { on: false, from: '21:00', to: '08:00' };
  const save = (patch) => {
    const res = setConnection('whatsapp', patch);
    if (!res.ok) failToast(res);
  };
  const setTime = (field) => (e) => {
    const v = e.target.value;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) save({ quietHours: { ...q, [field]: v } });
  };
  return html`<div class="k2-prefs" data-testid="k2-wa-prefs">
    <${Card} class="k2-switches" padded=${false}>
      <${Switch} checked=${wa.ownerAlerts} label="Alerts to you" description="New enquiries, accepted quotes, cancellations and emergencies, sent to your phone."
        onChange=${(v) => save({ ownerAlerts: v })} data-testid="k2-wa-owner-alerts" />
      <${Switch} checked=${wa.customerUpdates} label="Updates to customers" description="Confirmations, reminders, quotes and on-my-way messages, sent from your business number."
        onChange=${(v) => save({ customerUpdates: v })} data-testid="k2-wa-customer-updates" />
      <${Switch} checked=${q.on} label="Quiet hours" description="Non-urgent messages wait until the morning. Emergencies always come through."
        onChange=${(v) => save({ quietHours: { ...q, on: v } })} data-testid="k2-wa-quiet" />
      ${q.on ? html`<div class="k2-times">
        <${Field} label="Quiet from" id="k2-wa-quiet-from">
          <${Input} id="k2-wa-quiet-from" type="time" value=${q.from} onInput=${setTime('from')} data-testid="k2-wa-quiet-from" />
        <//>
        <${Field} label="Until" id="k2-wa-quiet-to">
          <${Input} id="k2-wa-quiet-to" type="time" value=${q.to} onInput=${setTime('to')} data-testid="k2-wa-quiet-to" />
        <//>
      </div>` : null}
    <//>
    <p class="k2-note" data-testid="k2-wa-prefs-note">Saved on this device. The prototype does not hold messages back, a real build would follow these.</p>
  </div>`;
}

/** "Send test message": logs a simulated owner message in the outbox and links to Messages. */
function TestPanel() {
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = () => {
    if (busy) return;
    setBusy(true);
    const res = sendTestEvent('whatsapp');
    setBusy(false);
    if (!res.ok) { failToast(res); return; }
    setLast(res.message);
    toast({ message: 'Test message added to your Messages (simulated).', icon: 'message-circle', actionLabel: 'View', onAction: () => navigate(routeHref('messages')) });
  };
  return html`<div class="k2-test" data-testid="k2-wa-test">
    <${Card}>
      <p class="k2-test__text">This adds a test message to your Messages outbox, the way a real alert would arrive. Nothing is sent to a real phone.</p>
      <div class="k2-test__actions">
        <${Button} variant="primary" icon="send" onClick=${send} loading=${busy} data-testid="k2-wa-test-send">Send test message<//>
        ${last ? html`<${Button} href=${routeHref('messages')} icon="message-circle" data-testid="k2-wa-test-link">See it in Messages<//>` : null}
      </div>
    <//>
    ${last ? html`<div class="k2-test__result" data-testid="k2-wa-test-result" role="status">
      <${WhatsAppBubble} direction="in" body=${last.body} time=${stampTime(last.at)} stateLabel="Simulated" toLabel="To your WhatsApp" />
    </div>` : null}
  </div>`;
}

function CodeStep({ number, code, invalid, verified, onCode, onResend }) {
  const [left, setLeft] = useState(RESEND_SECONDS);
  useEffect(() => {
    if (left <= 0) return undefined;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  if (verified) {
    return html`<div class="k2-verified" data-testid="k2-wa-verified">
      <span class="k2-verified__tick" aria-hidden="true"><${Icon} name="check" size=${22} /></span>
      <div><p class="k2-verified__title">Number verified</p><p class="k2-verified__sub">${prettyNumber(number)}</p></div>
    </div>`;
  }
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return html`<div class="k2-code-step">
    <p class="k2-lead">We have sent a 6-digit code to <strong class="k2-nowrap">${prettyNumber(number)}</strong> in a WhatsApp message (simulated).</p>
    <${Field} label="6-digit code" id="k2-wa-code" hint="Type the 6 digits from the message.">
      <${Input} id="k2-wa-code" class="k2-code" value=${code} inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" enterkeyhint="done"
        spellcheck=${false} placeholder="000000" error=${invalid}
        onInput=${(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = v; onCode(v); }} data-testid="k2-wa-code" />
    <//>
    <div class="k2-demo-hint" data-testid="k2-wa-code-hint">
      <span class="k2-demo-hint__text">Prototype code: <strong class="k2-demo-hint__code">${WHATSAPP_DEMO_CODE}</strong></span>
      <${Button} size="sm" variant="secondary" onClick=${() => onCode(WHATSAPP_DEMO_CODE)} data-testid="k2-wa-code-fill">Use this code<//>
    </div>
    <div class="k2-resend">
      ${left > 0
        ? html`<p class="k2-resend__text" data-testid="k2-wa-resend-timer">Send a new code in <strong>${clock}</strong></p>`
        : html`<${Button} variant="ghost" icon="refresh-cw" onClick=${() => { setLeft(RESEND_SECONDS); onResend(); }} data-testid="k2-wa-resend">Send a new code<//>`}
    </div>
  </div>`;
}

const REAL_BUILD_WA = [
  'The WhatsApp Business Platform (Cloud API) from Meta, set up on a Meta Business account.',
  'Meta Business verification: company details and a document check, usually a few working days and sometimes longer.',
  'A phone number registered for the API. A number that is already on the ordinary WhatsApp app has to be moved or shared, so a new number is the simplest route.',
  'Every message sent outside a customer\'s 24-hour reply window must use a template that Meta has approved, usually within minutes and sometimes up to a day.',
  'A small server to send messages, receive replies and delivery receipts, and keep the access token safe.',
  'Meta charges per template message, priced by country and type of message. Expect pence per message and check Meta\'s current price list.'
];

function WaRealBuild() {
  return html`<${RealBuildNote} items=${REAL_BUILD_WA}>
    <p class="k2-realbuild__time" data-testid="k2-wa-timescale"><strong>Typical timescale:</strong> about one to two weeks to get a business verified, a number registered and the templates approved, then build and test time on top.</p>
  <//>`;
}

function WaWizard({ wa, onDone }) {
  const brand = useBrand();
  const logo = useStore(selectLogo);
  const texts = useStore(selectTemplateText);
  const [saved, patchSaved] = useLocalPref(PROFILE_KEY, PROFILE_DEFAULTS);
  const [step, setStep] = useState(() => startStep(wa));
  const [numberText, setNumberText] = useState(() => prettyNumber(wa.number));
  const [numberBad, setNumberBad] = useState(false);
  const [code, setCode] = useState('');
  const [codeBad, setCodeBad] = useState(false);
  const [name, setName] = useState(wa.displayName);
  const [category, setCategory] = useState(saved.category);
  const [about, setAbout] = useState(saved.about);
  const [badField, setBadField] = useState('');

  const connected = wa.status === 'connected';
  const submitted = countOf(wa.templates, 'none') === 0;

  const goStep = (id) => { setStep(id); stepMemory.set(STEP_KEY, id); };

  // Disconnected or part-verified in another tab: never sit on a step that needs a verified number.
  useEffect(() => {
    const at = STEPS.indexOf(step);
    if (wa.status === 'disconnected' && at > 0) goStep('number');
    else if (wa.status === 'verifying' && at > 1) goStep('code');
  }, [wa.status]);

  const steps = [
    {
      id: 'number', title: 'Your number', hint: 'The WhatsApp number customers will see messages from.', nextLabel: 'Send code',
      validate: () => {
        if (connected) return true;
        const n = normaliseWhatsAppNumber(numberText);
        if (!n) { setNumberBad(true); return 'Enter your WhatsApp number, like 07885 496800.'; }
        setNumberBad(false);
        const res = setConnection('whatsapp', wa.status === 'verifying' ? { number: n } : { number: n, status: 'verifying' });
        if (!res.ok) { setNumberBad(true); return failureMessage(res); }
        setCode('');
        setCodeBad(false);
        return true;
      },
      content: html`<div class="k2-stack">
        <${Explain} icon="message-circle" title="What is WhatsApp Business?" testid="k2-wa-explain">
          <p>It is WhatsApp set up for a business. Customers see your business name and logo instead of a random number, and you can send confirmations, quotes and reminders from one number.</p>
          <${TickList} items=${['Your own business profile: name, logo and a short description.', 'An alert on your phone the moment an enquiry comes in.', 'Quotes and updates sent in the chat your customers already use.']} />
        <//>
        <${Field} label="WhatsApp number" id="k2-wa-number" hint=${connected ? 'To use a different number, disconnect first.' : 'A UK mobile such as 07885 496800 works. The next step pretends to send it a code.'}>
          <${Input} id="k2-wa-number" type="tel" inputmode="tel" autocomplete="tel" value=${numberText} disabled=${connected} error=${numberBad}
            onInput=${(e) => { setNumberText(e.target.value); setNumberBad(false); }} data-testid="k2-wa-number" />
        <//>
      </div>`
    },
    {
      id: 'code', title: 'Verify your number', hint: 'WhatsApp checks the number is yours before it goes any further.', nextLabel: 'Verify',
      validate: () => {
        if (connected) return true;
        const c = code.trim();
        if (!/^\d{6}$/.test(c)) { setCodeBad(true); return 'Enter the 6 digits from the WhatsApp message.'; }
        const res = connectWhatsApp({ number: wa.number, code: c });
        if (res.ok) { setCodeBad(false); toast({ message: 'Number verified (simulated).', icon: 'circle-check' }); return true; }
        setCodeBad(true);
        return res.reason === 'bad_code' ? 'That code does not match. Check the 6 digits and try again.' : failureMessage(res);
      },
      content: html`<${CodeStep} number=${wa.number} code=${code} invalid=${codeBad} verified=${connected} onCode=${(v) => { setCode(v); setCodeBad(false); }}
        onResend=${() => toast({ message: `New code sent (simulated). Prototype code: ${WHATSAPP_DEMO_CODE}`, icon: 'refresh-cw' })} />`
    },
    {
      id: 'profile', title: 'Your business profile', hint: 'This is what customers see at the top of your chat.',
      validate: () => {
        const nm = name.trim();
        if (!nm || nm.length > NAME_MAX) { setBadField('name'); return `Enter your business name, up to ${NAME_MAX} characters.`; }
        if (about.trim().length > ABOUT_MAX) { setBadField('about'); return `Keep the description to ${ABOUT_MAX} characters.`; }
        setBadField('');
        const res = setConnection('whatsapp', { displayName: nm });
        if (!res.ok) return failureMessage(res);
        patchSaved({ category, about: about.trim() });
        return true;
      },
      content: html`<${ProfileFields} name=${name} category=${category} about=${about} brandName=${brand.name} logo=${logo} errorField=${badField}
        onName=${(v) => { setName(v); setBadField(''); }} onCategory=${setCategory} onAbout=${(v) => { setAbout(v); setBadField(''); }} />`
    },
    {
      id: 'templates', title: 'Message templates', canNext: submitted,
      hint: 'These are the messages 180 sends for you. WhatsApp checks every one before it can be used, so they all go in for approval.',
      content: html`<${TemplatesPanel} wa=${wa} texts=${texts} open />`
    },
    {
      id: 'prefs', title: 'Preferences', hint: 'Choose what you want to receive, and when to keep quiet.',
      content: html`<${PrefsPanel} wa=${wa} />`
    },
    {
      id: 'test', title: 'Send a test message', hint: 'See what an alert looks like before a real customer sends an enquiry.', nextLabel: 'Finish',
      content: html`<${TestPanel} />`
    }
  ];

  const finish = () => {
    stepMemory.clear(STEP_KEY);
    onDone();
    toast({ message: 'WhatsApp is set up (simulated).', icon: 'circle-check' });
    window.scrollTo(0, 0);
    setTimeout(() => focusTitle(), 60);
    return true;
  };

  return html`<${Wizard} title="Set-up" steps=${steps} step=${step} onStepChange=${goStep} onFinish=${finish} finishLabel="Finish"
    onCancel=${() => navigate(routeHref('connections'))} testid="k2-wa-wizard" />`;
}

function WaDashboard({ wa }) {
  const brand = useBrand();
  const logo = useStore(selectLogo);
  const texts = useStore(selectTemplateText);
  const summary = useStore(selectWaSummary);
  const [saved, patchSaved] = useLocalPref(PROFILE_KEY, PROFILE_DEFAULTS);
  const [name, setName] = useState(wa.displayName);
  const [category, setCategory] = useState(saved.category);
  const [about, setAbout] = useState(saved.about);
  const [badField, setBadField] = useState('');
  const total = WHATSAPP_TEMPLATE_KINDS.length;
  const approved = countOf(wa.templates, 'approved');
  const dirty = name.trim() !== wa.displayName || category !== saved.category || about.trim() !== saved.about;

  // Follow the store and other tabs unless there are unsaved edits here.
  useEffect(() => { if (!dirty) { setName(wa.displayName); setCategory(saved.category); setAbout(saved.about); } }, [wa.displayName, saved.category, saved.about]);

  const saveProfile = () => {
    const nm = name.trim();
    if (!nm || nm.length > NAME_MAX) { setBadField('name'); toast({ message: `Enter your business name, up to ${NAME_MAX} characters.`, tone: 'danger' }); return; }
    if (about.trim().length > ABOUT_MAX) { setBadField('about'); toast({ message: `Keep the description to ${ABOUT_MAX} characters.`, tone: 'danger' }); return; }
    setBadField('');
    const res = setConnection('whatsapp', { displayName: nm });
    if (!res.ok) { failToast(res); return; }
    patchSaved({ category, about: about.trim() });
    toast({ message: 'Profile saved on this device (simulated).', icon: 'circle-check' });
  };

  return html`<div class="k2-stack" data-testid="k2-wa-connected">
    <${ConnectedHero} testid="k2-wa-hero" badgeTestid="k2-wa-status" media=${html`<${Logo} src=${logo} size=${56} />`}
      title=${wa.displayName} lines=${[{ text: prettyNumber(wa.number), mono: true }, { text: 'WhatsApp Business number' }]}
      status=${summary ? summary.status : 'connected'} label=${summary ? summary.label : 'Connected'} since=${sinceText(wa.connectedAt)} />
    <div class="k2-stats">
      <${Stat} label="Messages approved" value=${`${approved} of ${total}`} tone=${approved === total ? 'ok' : undefined} data-testid="k2-wa-stat-templates" />
      <${Stat} label="Alerts to you" value=${wa.ownerAlerts ? 'On' : 'Off'} data-testid="k2-wa-stat-alerts" />
      <${Stat} label="Customer updates" value=${wa.customerUpdates ? 'On' : 'Off'} data-testid="k2-wa-stat-updates" />
    </div>
    <div class="k2-cols">
      <div class="k2-col">
        <${Section} title="Message templates" hint="Every message 180 can send, and where it is with WhatsApp." testid="k2-wa-section-templates">
          <${TemplatesPanel} wa=${wa} texts=${texts} />
        <//>
        <${Section} title="Business profile" testid="k2-wa-section-profile">
          <${ProfileFields} name=${name} category=${category} about=${about} brandName=${brand.name} logo=${logo} errorField=${badField}
            onName=${(v) => { setName(v); setBadField(''); }} onCategory=${setCategory} onAbout=${(v) => { setAbout(v); setBadField(''); }} />
          <${Button} variant="primary" icon="save" onClick=${saveProfile} disabled=${!dirty} data-testid="k2-wa-profile-save">Save profile<//>
        <//>
      </div>
      <div class="k2-col">
        <${Section} title="Preferences" testid="k2-wa-section-prefs"><${PrefsPanel} wa=${wa} /><//>
        <${Section} title="Send a test message" testid="k2-wa-section-test"><${TestPanel} /><//>
      </div>
    </div>
    <${WaRealBuild} />
    <${DisconnectPanel} connKey="whatsapp" name="WhatsApp" testid="k2-wa-disconnect"
      body="Stops 180 sending from this number. Your message templates would need approving again if you connect later."
      confirmBody="Alerts and customer messages would stop going out from your business number. Your message approvals are cleared, so you would send them in again if you reconnect." />
  </div>`;
}

export default function WhatsAppView() {
  const wa = useStore(selectWa);
  // In setup until the last step is finished. Starts true when nothing is connected, when a number is verified but no template has gone in yet,
  // or when this tab left the wizard part-way (so a reload carries on where it stopped).
  const [setup, setSetup] = useState(() => wa.status !== 'connected' || allNone(wa.templates) || !!stepMemory.get(STEP_KEY));
  const last = useRef(wa.status);
  useEffect(() => {
    if (last.current === 'connected' && wa.status !== 'connected') { setSetup(true); stepMemory.clear(STEP_KEY); }
    // Connected again with every approval back (an Undo of Disconnect): nothing is left to set up.
    else if (last.current !== 'connected' && wa.status === 'connected' && !allNone(wa.templates)) setSetup(false);
    last.current = wa.status;
  }, [wa.status]);
  // Template approvals and the like settle on the clock; ask the store to apply any that are due.
  useEffect(() => {
    settleConnections();
    const id = setInterval(settleConnections, 5000);
    return () => clearInterval(id);
  }, []);
  const wizard = wa.status !== 'connected' || setup;
  return html`<div class="db-page k2-page" data-testid="k2-wa-root">
    <${ConnHeader} title=${wizard ? 'Connect WhatsApp' : 'WhatsApp Business'} subtitle="Alerts to you, quotes and updates to your customers." />
    <${SimBanner} />
    ${wizard ? html`<${WaWizard} wa=${wa} onDone=${() => setSetup(false)} />` : html`<${WaDashboard} wa=${wa} />`}
  </div>`;
}
