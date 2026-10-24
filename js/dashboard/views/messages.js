// js/dashboard/views/messages.js: Messages, the outbox of WhatsApp and email messages (simulated): banner, compare card, filters, live bubble buttons, links.
// Owner: E3 (v1 by WP8, enquiry chips and wording by E2)
import { STORAGE_FULL_TEXT } from '../../ui/util.js';
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Button, Chip, Disclosure, EmptyState, Icon, PageHeader, Segmented, Sheet, WhatsAppBubble,
  copyText, cx, pageHref, pageTarget, showUndoToast, toast, useNow, useStore
} from '../../ui/index.js';
import { acceptEmergency, confirmBooking, getState, markMessagesSeen, sendMessageNow } from '../../core/store.js';
import { latestQuoteFor } from '../../core/quotes.js';
import { selectMessages } from '../../core/selectors.js';
import { bubbleActions, mailtoLink, messageIsScheduled, telLink, waLink } from '../../core/messages.js';
import { DEFAULT_TEMPLATES, KIND_LABELS, TEMPLATE_KINDS, WINDOWS } from '../../core/config.js';
import { DAY_SHORT, fmtDayShort, fmtRelativeDay, stampDay, stampTime, weekdayOf } from '../../core/dates.js';
import { nowStamp } from '../../core/clock.js';
import { firstName } from '../../core/format.js';
import { nextFreeSlot } from '../../core/availability.js';
import { SAMPLE_CUSTOMER } from '../../core/seed.js';
import { routeHref } from '../router.js';
import { AnswerChips, hasAnswers } from '../shared/enquiry.js';
import { useScrollFade } from '../shared/scroll.js';

export const title = 'Messages';
export const css = ['css/settings.css', 'css/bookings.css'];

const BANNER_TEXT = 'SIMULATED. Nothing is sent from this prototype. These are the WhatsApp messages and emails a live system would send for you. Tap "Open in WhatsApp" or "Open in email" to try one from your own phone.';
const HINT_TEXT = 'Open in WhatsApp goes to the number on the message. These numbers are fictional, so it will not reach a real person. Add your own mobile in Demo tools and every link opens your WhatsApp instead.';
const FAIL_TEXT = 'That did not work: the diary changed. Please check and try again.';

const FILTERS = [
  { value: 'all', label: 'All', testid: 'msg-filter-all' },
  { value: 'owner', label: 'To me', testid: 'msg-filter-owner' },
  { value: 'customer', label: 'To customers', testid: 'msg-filter-customer' },
  { value: 'email', label: 'Email', testid: 'msg-filter-email' },
  { value: 'scheduled', label: 'Scheduled', testid: 'msg-filter-scheduled' }
];

const selectAll = (state) => state;

const PAGE_SIZE = 20; // the latest 20 show first; "Show earlier" adds 20 more
const EXPLAINER_KEY = 'vm_messages_explainer_open';

/** Whether the "how this works" disclosure was left open (remembered on this device; storage can be blocked, so every touch is guarded). */
function readExplainerOpen() {
  try { return localStorage.getItem(EXPLAINER_KEY) === '1'; } catch (e) { return false; }
}
function saveExplainerOpen(open) {
  try { localStorage.setItem(EXPLAINER_KEY, open ? '1' : '0'); } catch (e) { /* storage blocked: it just starts closed next time */ }
}

// ---------- helpers ----------

/** What a link is called in a message people read: the label of where it goes, never the address. */
function labelForUrl(url) {
  if (/quote\.html/i.test(url)) return 'Open quote';
  if (/dashboard\.html#\/bookings/i.test(url)) return 'Open job';
  if (/dashboard\.html/i.test(url)) return 'Open dashboard';
  if (/index\.html#manage/i.test(url)) return 'Manage booking';
  if (/index\.html/i.test(url)) return 'Booking page';
  return 'Open link';
}

/**
 * The text of a message as it is SHOWN: every web address becomes a short "Open job" or "Open quote" label and an internal id
 * (bk_seed_14) never prints. Display only: the stored body, Copy text and the WhatsApp link all keep the real links, and the buttons under
 * the message carry the real hrefs.
 */
export function friendlyBody(body) {
  return String(body === undefined || body === null ? '' : body)
    .replace(/(Open:\s*)?((?:https?|file):\/\/[^\s<>"]+?)([.,;:!?)\]]*)(?=\s|$)/g, (all, lead, url, punct) => labelForUrl(url) + punct)
    .replace(/\bbk_[A-Za-z0-9_]+\b/g, 'Open job');
}

/** One line for the collapsed row: bold marks and the greeting dropped, lines joined, so what is left says what the message is about. */
function previewOf(body) {
  return friendlyBody(body).replace(/\*/g, '').replace(/^Hi [^,\n]+, it's [^.\n]+ from [^.\n]+\.\s*/, '')
    .split('\n').map((l) => l.trim()).filter(Boolean).join(' · ');
}

/** Generic failure rule (8.3) for any mutation result this screen does not handle specially. */
function failToast(res) {
  toast({ message: res && res.reason === 'not_found' ? 'That booking no longer exists.' : res && res.reason === 'storage_full' ? STORAGE_FULL_TEXT : FAIL_TEXT, tone: 'danger' });
}

/** 'Fri 18:00' for a scheduled send. */
const scheduledLabel = (stamp) => `${DAY_SHORT[weekdayOf(stampDay(stamp))]} ${stampTime(stamp)}`;

/** The time shown on a card: HH:mm, or day + time when a delayed send landed on another day than it was logged. */
function sentLabel(m) {
  const at = m.sendAt || m.at;
  const day = stampDay(at);
  return day === stampDay(m.at) ? stampTime(at) : `${fmtDayShort(day)} ${stampTime(at)}`;
}

/** Quick-reply buttons for a bubble, with hrefs for the two that are links (10.6). */
function actionsFor(m, booking, nowS) {
  if (!booking) return [];
  return bubbleActions(m, booking, nowS).map((a) => {
    if (a.id === 'call') return { ...a, href: telLink(booking.customer.phone) };
    if (a.id === 'open_job') return { ...a, href: routeHref('bookings', { id: booking.id }) };
    return a;
  });
}

/** Run the two live bubble buttons through the real store actions, with the same Undo toast as the job buttons (13.6.1). */
function runAction(id, booking) {
  if (!booking) return;
  const first = firstName(booking.customer.name);
  if (id === 'confirm') {
    const res = confirmBooking(booking.id);
    if (res.ok) showUndoToast(`Confirmed. ${first} has been told (simulated).`, res.undoToken); else failToast(res);
  } else if (id === 'accept_45') {
    const res = acceptEmergency(booking.id, 45);
    if (res.ok) showUndoToast(`Accepted. ${first} has been told you're on your way (simulated).`, res.undoToken); else failToast(res);
  }
}

// ---------- compare card ----------

function CompareCard({ state, alert, booking, nowS }) {
  // The typical ping and the alert come from the SAME booking. With no alert in the store, use the sample customer and the next free quote visit slot.
  let name; let phone; let at; let body;
  if (alert && booking) {
    name = booking.customer.name; phone = booking.customer.phone; at = alert.at; body = alert.body;
  } else {
    const slot = nextFreeSlot(state, 'ev_quote');
    name = SAMPLE_CUSTOMER.name; phone = SAMPLE_CUSTOMER.phone;
    at = slot ? slot.startsAt : nowS;
    const when = slot ? `${fmtDayShort(slot.date)}, ${WINDOWS[slot.windowId].label}` : 'the next free window';
    body = ['*New enquiry*', `${name} · ${phone}`, SAMPLE_CUSTOMER.postcode, 'Parking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.',
      `Free survey visit pencilled in: ${when}`].join('\n');
  }
  const [, mm, dd] = stampDay(at).split('-');
  const ping = `New enquiry received. ${name} ${phone}. ${dd}/${mm} ${stampTime(at)}.`;
  const actions = alert ? actionsFor(alert, booking, nowS) : [];
  return html`<div class="ms-compare" data-testid="messages-compare">
    <h2 class="ms-compare__title">Is this better than a ping?</h2>
    <div class="ms-compare__body">
      <div class="ms-compare__col">
        <h2 class="ms-compare__head">A typical ping</h2>
        <p class="ms-compare__cap">illustrative: a plain notification</p>
        <div class="ms-card__chat"><${WhatsAppBubble} direction="in" body=${ping} /></div>
      </div>
      <div class="ms-compare__col">
        <h2 class="ms-compare__head">With this</h2>
        <p class="ms-compare__cap">Buttons that act, not just a notification</p>
        <div class="ms-card__chat">
          <${WhatsAppBubble} direction="in" body=${body} time=${stampTime(at)} stateLabel="Sent (simulated)"
            actions=${actions} onAction=${(id) => runAction(id, booking)} />
        </div>
      </div>
      <p class="ms-compare__foot">One tells you. The other lets you act.</p>
    </div>
  </div>`;
}

// ---------- one message ----------

const QUOTE_ID_IN_BODY = /quote\.html(?:\?[^#\s]*)?#q=([A-Za-z0-9-]+)/;
// A quote link can now carry the whole quote (quote.html#d=...), so the id is not always in the text: a message about a quote finds it through its booking.
const QUOTE_KINDS = ['customer_quote_ready', 'customer_quote_sent', 'customer_quote_accepted', 'owner_quote_accepted', 'owner_quote_declined'];
function quoteIdOf(m, booking) {
  const inBody = (QUOTE_ID_IN_BODY.exec(m.body) || [])[1];
  if (inBody) return inBody;
  if (!booking || !QUOTE_KINDS.includes(m.kind)) return '';
  if (booking.quoteId) return booking.quoteId;
  const quote = latestQuoteFor(getState().quotes, booking.id);
  return quote ? quote.id : '';
}

/**
 * One message as a collapsed row (who, channel, kind, a one-line preview, the time, its status) that opens into the bubble and its buttons
 * when tapped. The panel stays in the page while closed (hidden), so nothing is rebuilt on each tap.
 */
function MessageCard({ m, booking, nowS, demoDigits, isNew, sendFrom }) {
  const [open, setOpen] = useState(!!isNew);
  const scheduled = messageIsScheduled(m, nowS);
  const toOwner = m.to === 'owner';
  const email = m.channel === 'email';
  const time = scheduled ? scheduledLabel(m.sendAt) : sentLabel(m);
  const quoteId = quoteIdOf(m, booking);
  const kind = m.title || KIND_LABELS[m.kind] || m.kind; // an owner alert carries its own heading ('New enquiry: Sinead D, BT42'), so alerts are told apart
  const who = toOwner ? 'You' : m.toName;
  const shown = friendlyBody(m.body);
  const panelId = `msg-panel-${m.id}`;
  const copy = async () => {
    const ok = await copyText(m.body);
    toast({ message: ok ? 'Copied' : 'Could not copy. Select the text and copy it by hand.' });
  };
  const sendNow = () => {
    const res = sendMessageNow(m.id);
    if (res.ok) toast({ message: 'Sent now (simulated).' }); else failToast(res);
  };
  const channelLabel = email ? 'Email' : 'WhatsApp';
  return html`<article class=${cx('ms-card', isNew && 'is-new', email && 'ms-card--email', open && 'is-open')} data-testid=${`message-${m.id}`} data-channel=${m.channel || 'whatsapp'}
    aria-label=${`${kind} to ${m.toName}`}>
    <button type="button" class="ms-row" aria-expanded=${open ? 'true' : 'false'} aria-controls=${panelId} onClick=${() => setOpen(!open)} data-testid=${`message-toggle-${m.id}`}>
      <span class=${`ms-row__ch ms-row__ch--${email ? 'email' : 'whatsapp'}`} data-testid=${`message-channel-${m.id}`}>
        <${Icon} name=${email ? 'mail' : 'message-circle'} size=${18} /><span class="u-sr-only">${channelLabel}</span>
      </span>
      <span class="ms-row__main">
        <span class="ms-row__who">${who}</span>
        <span class="ms-row__line"><strong>${kind}</strong>${shown ? html` · ${previewOf(m.body)}` : null}</span>
      </span>
      <span class="ms-row__side">
        <span class="ms-row__time">${time}</span>
        <span class=${cx('ms-row__status', scheduled && 'is-scheduled')}><${Icon} name=${scheduled ? 'clock' : 'check-check'} size=${14} />${scheduled ? 'Scheduled' : 'Sent'}</span>
      </span>
      <${Icon} name="chevron-down" size=${20} class="ms-row__chev" />
    </button>
    <div class="ms-card__panel" id=${panelId} hidden=${!open}>
      <p class="ms-card__sub">${toOwner ? `To: ${m.toName} (you)` : 'To:'} ${email ? (m.toEmail || 'No email address') : m.toPhone}</p>
      ${toOwner && booking && hasAnswers(booking) ? html`<${AnswerChips} booking=${booking} class="ms-card__chips" />` : null}
      <div class="ms-card__chat">
        ${email
          ? html`<div class="ms-mail" data-testid=${`message-mail-${m.id}`}>
              <p class="ms-mail__subject">${kind}</p>
              <p class="ms-mail__from">${`From ${toOwner ? 'your dashboard' : sendFrom} (simulated)`}</p>
              <p class="ms-mail__body">${shown}</p>
              <p class="ms-mail__state"><${Icon} name=${scheduled ? 'clock' : 'check-check'} size=${16} /> ${scheduled ? `Scheduled for ${scheduledLabel(m.sendAt)} (simulated)` : 'Sent (simulated)'}</p>
            </div>`
          : html`<${WhatsAppBubble} direction=${toOwner ? 'in' : 'out'} body=${shown} messageId=${m.id}
              scheduled=${scheduled} time=${scheduled ? undefined : stampTime(m.sendAt || m.at)}
              stateLabel=${scheduled ? `Scheduled for ${scheduledLabel(m.sendAt)} (simulated)` : 'Sent (simulated)'}
              actions=${actionsFor(m, booking, nowS)} onAction=${(id) => runAction(id, booking)} />`}
      </div>
      <div class="ms-card__foot">
        ${email
          ? html`<${Button} class="is-wide" variant="secondary" icon="mail" href=${mailtoLink(m.toEmail || '', kind, m.body)} data-testid=${`message-open-mail-${m.id}`}>Open in email<//>`
          : html`<${Button} class="is-wide" variant="secondary" icon="send" href=${waLink(m.toPhone, m.body, demoDigits)} data-testid=${`message-open-wa-${m.id}`}>Open in WhatsApp<//>`}
        <${Button} size="sm" icon="copy" onClick=${copy} data-testid=${`message-copy-${m.id}`}>Copy text<//>
        ${quoteId ? html`<${Button} size="sm" icon="file-text" href=${routeHref('quote-detail', { id: quoteId })} data-testid=${`message-open-quote-${m.id}`}>Open quote<//>` : null}
        ${quoteId ? html`<${Button} size="sm" icon="external-link" href=${pageHref('quote.html', `#q=${quoteId}`)} target=${pageTarget('quote.html')} data-testid=${`message-view-quote-${m.id}`}>Customer view<//>` : null}
        ${booking
          ? html`<${Button} size="sm" icon="file-text" href=${routeHref('bookings', { id: booking.id })} data-testid=${`message-open-booking-${m.id}`}>Open job<//>`
          : null}
        ${scheduled ? html`<${Button} class="is-wide" size="sm" variant="ghost" icon="clock" onClick=${sendNow} data-testid=${`message-send-now-${m.id}`}>Send now (simulated)<//>` : null}
      </div>
    </div>
  </article>`;
}

// ---------- templates sheet (read only) ----------

/** Split a template so each {placeholder} can be drawn in a <mark>. */
function Highlighted({ text }) {
  const parts = String(text).split(/(\{[A-Za-z]+\})/);
  return parts.map((p, i) => (/^\{[A-Za-z]+\}$/.test(p) ? html`<mark key=${i}>${p}</mark>` : p));
}

function TemplatesSheet({ open, onClose, overrides }) {
  return html`<${Sheet} open=${open} onClose=${onClose} title="Message templates" size="full" testid="templates-sheet"
    description="Read only. The live system fills each {placeholder} from the booking.">
    <div class="ms-tpl">${TEMPLATE_KINDS.map((kind) => html`<div class="ms-tpl__item" key=${kind}>
      <h3 class="ms-tpl__kind">${KIND_LABELS[kind]}</h3>
      <p class="ms-tpl__text"><${Highlighted} text=${(overrides && overrides[kind]) || DEFAULT_TEMPLATES[kind]} /></p>
    </div>`)}</div>
  <//>`;
}

// ---------- the screen ----------

export default function MessagesView({ route }) {
  const state = useStore(selectAll);
  useNow(30000); // Sent versus Scheduled is derived at render time, so tick the screen
  const nowS = nowStamp();
  const bookingId = (route && route.query && route.query.b) || '';
  const [filter, setFilter] = useState('all');
  const [tplOpen, setTplOpen] = useState(false);
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const filtersRef = useRef(null);
  useScrollFade(filtersRef, '.ms-filters', []);

  // Opening the screen, and any message that lands while it is open, counts as read.
  useEffect(() => { markMessagesSeen(); }, [state.meta.msgSeq]);

  const bookingsById = useMemo(() => new Map(state.bookings.map((b) => [b.id, b])), [state.bookings]);
  const list = selectMessages(state, {
    to: filter === 'owner' || filter === 'customer' ? filter : undefined,
    bookingId: bookingId || undefined,
    scheduledOnly: filter === 'scheduled' ? true : undefined,
    nowStamp: nowS
  }).filter((m) => filter !== 'email' || m.channel === 'email');
  const demoDigits = state.settings.demoPhoneDigits || '';
  const sendFrom = (state.settings.connections && state.settings.connections.email && state.settings.connections.email.sendFrom) || state.settings.business.email;

  // The compare card uses the latest owner alert in the whole outbox (not the filtered list).
  const alert = selectMessages(state, { to: 'owner' }).find((m) => m.kind === 'owner_new_booking') || null;
  const alertBooking = alert ? bookingsById.get(alert.bookingId) || null : null;

  // Cards that arrive after the screen opened get the short highlight (the class stays; the animation only plays once per card).
  const known = useRef(null);
  const arrived = useRef(new Set());
  if (known.current === null) known.current = new Set(state.messages.map((m) => m.id));
  state.messages.forEach((m) => { if (!known.current.has(m.id)) arrived.current.add(m.id); });

  const filtered = bookingId ? bookingsById.get(bookingId) : null;
  // Newest first, the latest PAGE_SIZE only, grouped under a heading per day.
  const visible = list.slice(0, shownCount);
  const groups = [];
  visible.forEach((m) => {
    const day = stampDay(m.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m); else groups.push({ day, items: [m] });
  });
  const more = list.length - visible.length;
  const onFilter = (value) => { setFilter(value); setShownCount(PAGE_SIZE); };

  return html`<div class="db-page">
    <${PageHeader} title="Messages" subtitle="WhatsApp and email outbox (simulated)" />
    <div class="ms-stack">
      <${Disclosure} title="Simulated: how this works" summary="Read me" class="ms-explainer" testid="messages-banner" defaultOpen=${readExplainerOpen()}
        onToggle=${(e) => saveExplainerOpen(!!(e.target && e.target.open))}>
        <p class="ms-explainer__text">${BANNER_TEXT}</p>
        <${CompareCard} state=${state} alert=${alert} booking=${alertBooking} nowS=${nowS} />
        <div class="ms-hint">
          <p class="ms-hint__text" data-testid="messages-demo-hint">${HINT_TEXT} <a class="ui-link ui-link--inline" href=${routeHref('demo')}>Open Demo tools</a></p>
          <${Button} size="sm" variant="secondary" icon="list-checks" onClick=${() => setTplOpen(true)} data-testid="messages-templates-open">See message templates<//>
        </div>
      <//>

      ${bookingId ? html`<div class="ms-filter-row" data-testid="messages-booking-filter">
        <${Chip} tone="accent" icon="search">${`Showing messages for ${filtered ? filtered.ref : 'one booking'}`}<//>
        <${Button} size="sm" variant="ghost" href=${routeHref('messages')}>Clear<//>
      </div>` : null}

      <div class="sf-wrap" ref=${filtersRef}>
        <${Segmented} class="ms-filters sf-fade" options=${FILTERS} value=${filter} onChange=${onFilter} ariaLabel="Filter messages" />
      </div>

      ${list.length === 0
        ? html`<${EmptyState} icon="message-circle"
            title=${state.messages.length === 0 ? 'No messages yet.' : 'Nothing here.'}
            body=${state.messages.length === 0 ? 'Send an enquiry from the website and watch this fill up.' : filter === 'email' ? 'No emails yet. Connect Gmail and send a quote by email to see one here.' : 'No messages match this filter.'} />`
        : html`<div class="ms-list" data-testid="messages-list">${groups.map((g) => html`<section key=${g.day} aria-label=${fmtRelativeDay(g.day)}>
            <h2 class="ms-day">${fmtRelativeDay(g.day)}</h2>
            ${g.items.map((m) => html`<${MessageCard} key=${m.id} m=${m} booking=${m.bookingId ? bookingsById.get(m.bookingId) || null : null}
              nowS=${nowS} demoDigits=${demoDigits} isNew=${arrived.current.has(m.id)} sendFrom=${sendFrom} />`)}
          </section>`)}
          ${more > 0 ? html`<${Button} variant="secondary" block icon="chevron-down" class="ms-earlier" onClick=${() => setShownCount(shownCount + PAGE_SIZE)} data-testid="messages-show-earlier">${`Show earlier (${more} more)`}<//>` : null}
        </div>`}
    </div>
    <${TemplatesSheet} open=${tplOpen} onClose=${() => setTplOpen(false)} overrides=${state.settings.templates} />
  </div>`;
}
