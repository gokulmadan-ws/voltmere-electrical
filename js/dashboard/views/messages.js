// js/dashboard/views/messages.js: Messages, the WhatsApp outbox (simulated): banner, compare card, filters, live bubble buttons, wa.me links.
// Owner: WP8
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Button, Chip, EmptyState, Icon, PageHeader, PrototypeNotice, Segmented, Sheet, WhatsAppBubble,
  copyText, showUndoToast, toast, useNow, useStore
} from '../../ui/index.js';
import { acceptEmergency, confirmBooking, markMessagesSeen, sendMessageNow } from '../../core/store.js';
import { selectMessages } from '../../core/selectors.js';
import { bubbleActions, messageIsScheduled, telLink, waLink } from '../../core/messages.js';
import { DEFAULT_TEMPLATES, KIND_LABELS, TEMPLATE_KINDS, WINDOWS } from '../../core/config.js';
import { DAY_SHORT, fmtDayShort, fmtRelativeDay, stampDay, stampTime, weekdayOf } from '../../core/dates.js';
import { nowStamp } from '../../core/clock.js';
import { firstName } from '../../core/format.js';
import { nextFreeSlot } from '../../core/availability.js';
import { SAMPLE_CUSTOMER } from '../../core/seed.js';
import { routeHref } from '../router.js';

export const title = 'Messages';
export const css = ['css/settings.css'];

const BANNER_TEXT = 'SIMULATED. Nothing is sent from this prototype. These are the messages the live system would send through the WhatsApp Business Platform. Tap "Open in WhatsApp" to try one on your own phone.';
const HINT_TEXT = 'Open in WhatsApp goes to the number on the message. These numbers are fictional, so it will not reach a real person. Add your own mobile in Demo tools and every link opens your WhatsApp instead.';
const FAIL_TEXT = 'That did not work: the diary changed. Please check and try again.';

const FILTERS = [
  { value: 'all', label: 'All', testid: 'msg-filter-all' },
  { value: 'owner', label: 'To me', testid: 'msg-filter-owner' },
  { value: 'customer', label: 'To customers', testid: 'msg-filter-customer' },
  { value: 'scheduled', label: 'Scheduled', testid: 'msg-filter-scheduled' }
];

const selectAll = (state) => state;

// ---------- helpers ----------

/** Generic failure rule (8.3) for any mutation result this screen does not handle specially. */
function failToast(res) {
  toast({ message: res && res.reason === 'not_found' ? 'That booking no longer exists.' : FAIL_TEXT, tone: 'danger' });
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
  // The typical ping and the alert come from the SAME booking. With no alert in the store, use the sample customer and the next free repair slot.
  let name; let phone; let at; let body;
  if (alert && booking) {
    name = booking.customer.name; phone = booking.customer.phone; at = alert.at; body = alert.body;
  } else {
    const slot = nextFreeSlot(state, 'fault');
    name = SAMPLE_CUSTOMER.name; phone = SAMPLE_CUSTOMER.phone;
    at = slot ? slot.startsAt : nowS;
    const when = slot ? `${fmtDayShort(slot.date)}, arriving ${WINDOWS[slot.windowId].arrive}` : 'as soon as possible';
    body = ['*New booking*', `${name} · ${phone}`, `Fault finding and repairs`, when, `${SAMPLE_CUSTOMER.line1}, ${SAMPLE_CUSTOMER.postcode}`, 'Confirmed automatically.'].join('\n');
  }
  const [, mm, dd] = stampDay(at).split('-');
  const ping = `New booking received. ${name} ${phone}. ${dd}/${mm} ${stampTime(at)}.`;
  const actions = alert ? actionsFor(alert, booking, nowS) : [];
  return html`<details class="ms-compare" open data-testid="messages-compare">
    <summary class="ms-compare__summary">Is this better than a ping?<${Icon} name="chevron-down" size=${22} class="ms-compare__chev" /></summary>
    <div class="ms-compare__body">
      <div class="ms-compare__col">
        <h3 class="ms-compare__head">A typical ping</h3>
        <p class="ms-compare__cap">illustrative, not your agency's exact message</p>
        <div class="ms-card__chat"><${WhatsAppBubble} direction="in" body=${ping} /></div>
      </div>
      <div class="ms-compare__col">
        <h3 class="ms-compare__head">With this</h3>
        <p class="ms-compare__cap">Buttons that act, not just a notification</p>
        <div class="ms-card__chat">
          <${WhatsAppBubble} direction="in" body=${body} time=${stampTime(at)} stateLabel="Sent (simulated)"
            actions=${actions} onAction=${(id) => runAction(id, booking)} />
        </div>
      </div>
      <p class="ms-compare__foot">One tells you. The other lets you act.</p>
    </div>
  </details>`;
}

// ---------- one message ----------

function MessageCard({ m, booking, nowS, demoDigits, isNew }) {
  const scheduled = messageIsScheduled(m, nowS);
  const toOwner = m.to === 'owner';
  const time = scheduled ? `Scheduled ${scheduledLabel(m.sendAt)}` : sentLabel(m);
  const copy = async () => {
    const ok = await copyText(m.body);
    toast({ message: ok ? 'Copied' : 'Could not copy. Select the text and copy it by hand.' });
  };
  const sendNow = () => {
    const res = sendMessageNow(m.id);
    if (res.ok) toast({ message: 'Sent now (simulated).' }); else failToast(res);
  };
  return html`<article class=${`ms-card${isNew ? ' is-new' : ''}`} data-testid=${`message-${m.id}`} aria-label=${`${KIND_LABELS[m.kind] || 'Message'} to ${m.toName}`}>
    <div class="ms-card__head">
      <div class="ms-card__to">
        <p class="ms-card__who">${toOwner ? `To: ${m.toName} (you)` : `To: ${m.toName}`}</p>
        <p class="ms-card__sub">${m.toPhone}</p>
      </div>
      <div class="ms-card__meta">
        <${Chip} tone=${toOwner ? 'accent' : 'neutral'}>${KIND_LABELS[m.kind] || m.kind}<//>
        <span class="ms-card__time">${time}</span>
      </div>
    </div>
    <div class="ms-card__chat">
      <${WhatsAppBubble} direction=${toOwner ? 'in' : 'out'} body=${m.body} messageId=${m.id}
        scheduled=${scheduled} time=${scheduled ? undefined : stampTime(m.sendAt || m.at)}
        stateLabel=${scheduled ? `Scheduled for ${scheduledLabel(m.sendAt)} (simulated)` : 'Sent (simulated)'}
        actions=${actionsFor(m, booking, nowS)} onAction=${(id) => runAction(id, booking)} />
    </div>
    <div class="ms-card__foot">
      <${Button} class="is-wide" variant="secondary" icon="send" href=${waLink(m.toPhone, m.body, demoDigits)} data-testid=${`message-open-wa-${m.id}`}>Open in WhatsApp<//>
      <${Button} size="sm" icon="copy" onClick=${copy} data-testid=${`message-copy-${m.id}`}>Copy text<//>
      ${booking
        ? html`<${Button} size="sm" icon="file-text" href=${routeHref('bookings', { id: booking.id })} data-testid=${`message-open-booking-${m.id}`}>Open booking<//>`
        : null}
      ${scheduled ? html`<${Button} class="is-wide" size="sm" variant="ghost" icon="clock" onClick=${sendNow} data-testid=${`message-send-now-${m.id}`}>Send now (simulated)<//>` : null}
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

  // Opening the screen, and any message that lands while it is open, counts as read.
  useEffect(() => { markMessagesSeen(); }, [state.meta.msgSeq]);

  const bookingsById = useMemo(() => new Map(state.bookings.map((b) => [b.id, b])), [state.bookings]);
  const list = selectMessages(state, {
    to: filter === 'owner' || filter === 'customer' ? filter : undefined,
    bookingId: bookingId || undefined,
    scheduledOnly: filter === 'scheduled' ? true : undefined,
    nowStamp: nowS
  });
  const demoDigits = state.settings.demoPhoneDigits || '';

  // The compare card uses the latest owner alert in the whole outbox (not the filtered list).
  const alert = selectMessages(state, { to: 'owner' }).find((m) => m.kind === 'owner_new_booking') || null;
  const alertBooking = alert ? bookingsById.get(alert.bookingId) || null : null;

  // Cards that arrive after the screen opened get the short highlight (the class stays; the animation only plays once per card).
  const known = useRef(null);
  const arrived = useRef(new Set());
  if (known.current === null) known.current = new Set(state.messages.map((m) => m.id));
  state.messages.forEach((m) => { if (!known.current.has(m.id)) arrived.current.add(m.id); });

  const filtered = bookingId ? bookingsById.get(bookingId) : null;
  const groups = [];
  list.forEach((m) => {
    const day = stampDay(m.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m); else groups.push({ day, items: [m] });
  });

  return html`<div class="db-page">
    <${PageHeader} title="Messages" subtitle="WhatsApp outbox (simulated)" />
    <div class="ms-stack">
      <${PrototypeNotice} variant="inline" data-testid="messages-banner">${BANNER_TEXT}<//>

      ${bookingId ? html`<div class="ms-filter-row" data-testid="messages-booking-filter">
        <${Chip} tone="accent" icon="search">${`Showing messages for ${filtered ? filtered.ref : 'one booking'}`}<//>
        <${Button} size="sm" variant="ghost" href=${routeHref('messages')}>Clear<//>
      </div>` : null}

      <${CompareCard} state=${state} alert=${alert} booking=${alertBooking} nowS=${nowS} />

      <${Segmented} options=${FILTERS} value=${filter} onChange=${setFilter} ariaLabel="Filter messages" />

      ${/* CONTRACT-GAP: 13.14 lists the demo hint after the list; it sits above it here so it is seen on a long outbox. */''}
      <div class="ms-hint">
        <p class="ms-hint__text" data-testid="messages-demo-hint">${HINT_TEXT} <a class="ui-link ui-link--inline" href=${routeHref('demo')}>Open Demo tools</a></p>
        <${Button} size="sm" variant="secondary" icon="list-checks" onClick=${() => setTplOpen(true)} data-testid="messages-templates-open">See message templates<//>
      </div>

      ${list.length === 0
        ? html`<${EmptyState} icon="message-circle"
            title=${state.messages.length === 0 ? 'No messages yet.' : 'Nothing here.'}
            body=${state.messages.length === 0 ? 'Make a booking on the website and watch this fill up.' : 'No messages match this filter.'} />`
        : html`<div class="ms-list" data-testid="messages-list">${groups.map((g) => html`<section key=${g.day} aria-label=${fmtRelativeDay(g.day)}>
            <h2 class="ms-day">${fmtRelativeDay(g.day)}</h2>
            ${g.items.map((m) => html`<${MessageCard} key=${m.id} m=${m} booking=${m.bookingId ? bookingsById.get(m.bookingId) || null : null}
              nowS=${nowS} demoDigits=${demoDigits} isNew=${arrived.current.has(m.id)} />`)}
          </section>`)}</div>`}
    </div>
    <${TemplatesSheet} open=${tplOpen} onClose=${() => setTplOpen(false)} overrides=${state.settings.templates} />
  </div>`;
}
