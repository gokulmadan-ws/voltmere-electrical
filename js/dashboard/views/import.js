// js/dashboard/views/import.js: the Import screen (#/import?d=<payload>, also reached from dashboard.html#import=<payload>).
// What the customer sent through WhatsApp (an enquiry, an accepted quote, a declined quote), shown IN FULL and applied only when the owner taps.
// Real: the WhatsApp link, and the data inside it (the web address carries it). What a real build replaces: the webhook and database that do this silently.
// Owner: F4 (V4 cross-device handoff; docs/V4-HANDOFF.md, docs/V4-API.md). The payload is untrusted: parseImport has already cleaned every field,
// and everything here is rendered as plain text (never as markup), with hrefs built only from validated digits and addresses.
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Avatar, Banner, Button, Card, Chip, Field, Icon, KeyValueList, PageHeader, Textarea, TextLink, failureMessage, pageHref, pageTarget, toast, useBrand, useStore
} from '../../ui/index.js';
import { importHandoff, undo } from '../../core/store.js';
import { encodePayload, parseImport } from '../../core/handoff.js';
import { previewImport } from '../../core/selectors.js';
import { bookingWhen, isUnscheduled } from '../../core/availability.js';
import { INSTALL_DAYS, INSTALL_PARTS, LEAD_SOURCE_LABELS, PROMISES } from '../../core/config.js';
import { nowStamp } from '../../core/clock.js';
import { fmtDayShort, stampDay, stampTime } from '../../core/dates.js';
import { gbp } from '../../core/format.js';
import { mailtoLink, telLink, waLink } from '../../core/messages.js';
import { navigate, routeHref } from '../router.js';
import { slaFor } from '../shared/sla.js';

export const title = 'Import';
export const css = ['css/import.css'];

const selectAll = (state) => state;
const stampText = (stamp) => (stamp ? `${fmtDayShort(stampDay(stamp))}, ${stampTime(stamp)}` : '');
const replyHoursOf = (state) => {
  const h = state && state.settings && state.settings.sla ? state.settings.sla.replyHours : 0;
  return Number.isInteger(h) && h > 0 ? h : PROMISES.contactWithinHours;
};
const partLabel = (id) => (INSTALL_PARTS.find((p) => p.id === id) || { label: id }).label;
const bookingById = (state, id) => (state.bookings || []).find((b) => b.id === id) || null;

/** The summary sentence with the quote number kept in one piece (it must never break across two lines at its hyphen). Same text, same words. */
function summaryParts(data) {
  const at = data.summary.indexOf(data.quoteId);
  if (at < 0) return data.summary;
  return html`${data.summary.slice(0, at)}<span class="u-nowrap">${data.quoteId}</span>${data.summary.slice(at + data.quoteId.length)}`;
}

// ---------------------------------------------------------------- small pieces

/** A round badge with an icon: the one visual cue at the top of a state. tone: ok | warn | neutral. */
function Badge({ icon, tone = 'neutral' }) {
  return html`<span class=${`f4-badge f4-badge--${tone}`} aria-hidden="true"><${Icon} name=${icon} size=${26} /></span>`;
}

/** The success tick: the ring and the check draw themselves (static under reduced motion, see import.css). */
function Tick() {
  return html`<svg class="f4-tick" viewBox="0 0 96 96" width="88" height="88" aria-hidden="true" focusable="false" data-testid="f4-tick">
    <circle class="f4-tick__disc" cx="48" cy="48" r="34" />
    <circle class="f4-tick__ring" cx="48" cy="48" r="34" />
    <path class="f4-tick__check" d="M33 49.5l10.5 10.5L64 37" />
  </svg>`;
}

/** The sticky bottom bar (the shell's db-sticky-actions): the one decision, and the way out. */
function Bar({ children, long, inline }) {
  return html`<div class=${`db-sticky-actions f4-bar${long ? ' f4-bar--long' : ''}${inline ? ' f4-bar--inline' : ''}`} data-testid="f4-bar">${children}</div>`;
}

/** "What happens when you tap": a short plain list. */
function Does({ items, testid = 'f4-does', heading = 'What adding it does' }) {
  return html`<section class="f4-does" aria-labelledby=${`${testid}-h`} data-testid=${testid}>
    <h2 class="f4-label" id=${`${testid}-h`}>${heading}</h2>
    <ul class="f4-does__list">
      ${items.map((text, i) => html`<li key=${i}><${Icon} name="check" size=${18} /><span>${text}</span></li>`)}
    </ul>
  </section>`;
}

/** Honest provenance: what is real here and what a live build replaces. Tagged data-proto so a clean preview can hide it. */
function How({ brand }) {
  return html`<p class="f4-how" data-proto="true" data-testid="f4-how">
    <${Icon} name="info" size=${18} />
    <span>This reached you inside the WhatsApp link itself: the web address carries the details, and nothing goes through a server. In a live build ${brand.ownerFirst} gets it through the website webhook and a database, with nothing to tap.</span>
  </p>`;
}

// ---------------------------------------------------------------- the paste fallback

function PastePanel({ heading, lead }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const read = () => {
    const out = parseImport(text);
    if (!out.ok || !out.payload) { setError(out.ok ? 'We could not find a link in that.' : out.message); return; }
    setError('');
    navigate(routeHref('import', {}, { d: encodePayload(out.payload) }));
  };
  return html`<${Card} class="f4-card f4-paste" data-testid="f4-paste">
    <h2 class="f4-h">${heading}</h2>
    <p class="f4-muted">${lead}</p>
    <${Field} label="WhatsApp message" id="f4-paste-input" error=${error} errorTestid="f4-paste-error">
      <${Textarea} id="f4-paste-input" rows=${4} value=${text} placeholder="Paste the whole message here" autocomplete="off" spellcheck="false"
        onInput=${(e) => { setText(e.target.value); if (error) setError(''); }} data-testid="f4-paste-input" />
    <//>
    <div><${Button} variant="primary" icon="clipboard-check" onClick=${read} data-testid="f4-paste-read">Read the message<//></div>
  <//>`;
}

// ---------------------------------------------------------------- an enquiry

function EnquiryCard({ data, brand }) {
  const greeting = `Hi ${data.firstName}, it's ${brand.ownerFirst} from ${brand.shortName}. Thanks for your home charger enquiry ${data.ref}.`;
  const sentText = stampText(data.sentAt);
  const rows = data.answerRows.map((r) => ({
    key: r.key,
    label: r.heading,
    value: r.key === 'postcode' && data.outside
      ? html`<span class="f4-pc"><span data-testid="f4-postcode">${r.label}</span><${Chip} tone="danger" icon="triangle-alert" data-testid="f4-outside">${data.outsideLabel}<//></span>`
      : (r.key === 'postcode' ? html`<span data-testid="f4-postcode">${r.label}</span>` : r.label)
  }));
  const source = data.utmSource ? LEAD_SOURCE_LABELS[data.utmSource] || '' : '';
  return html`<${Card} class="f4-card" role="group" data-testid="f4-enquiry-card" aria-label="The enquiry">
    <div class="f4-who">
      <${Avatar} name=${data.name} size=${52} />
      <div class="f4-who__main">
        <h2 class="f4-who__name" data-testid="f4-name">${data.name}</h2>
        <p class="f4-meta"><span class="u-mono" data-testid="f4-ref">${data.ref}</span>${' · '}<span data-testid="f4-sent">${`Sent ${sentText}`}</span></p>
      </div>
    </div>
    <ul class="f4-tags" aria-label="Where it came from">
      <li><${Chip} icon="message-circle" data-testid="f4-received-tag">Received via WhatsApp link<//></li>
      ${source ? html`<li><${Chip} data-testid="f4-source">${`Came from ${source}`}<//></li>` : null}
    </ul>
    ${data.createdAt !== data.sentAt ? html`<p class="f4-meta" data-testid="f4-clamped">${`The sent time looked wrong, so the reply clock counts from ${stampText(data.createdAt)}.`}</p>` : null}
    <div class="f4-contact">
      <p class="f4-phone u-tabular" data-testid="f4-phone">${data.phone}</p>
      <div class="f4-contact__btns">
        <${Button} variant="secondary" icon="phone" href=${telLink(data.phone)} data-testid="f4-call">Call<//>
        <${Button} variant="secondary" icon="message-circle" href=${waLink(data.phone, greeting)} data-testid="f4-whatsapp">WhatsApp<//>
      </div>
      ${data.email ? html`<p class="f4-email"><${Icon} name="mail" size=${18} /><a href=${mailtoLink(data.email, `Your home charger enquiry ${data.ref}`)} data-testid="f4-email">${data.email}</a></p>` : null}
    </div>
    <div data-testid="f4-answers"><${KeyValueList} items=${rows} /></div>
    ${data.notes
      ? html`<div class="f4-note" data-testid="f4-notes"><p class="f4-label">Note from the customer</p><p class="f4-note__text">${data.notes}</p></div>`
      : html`<p class="f4-meta" data-testid="f4-notes-none">No note from the customer.</p>`}
    <p class="f4-meta" data-testid="f4-optin">${data.marketingOptIn ? 'Happy to receive occasional offers and tips.' : 'Did not opt in to marketing messages.'}</p>
  <//>`;
}

// ---------------------------------------------------------------- an accepted or declined quote

function DecisionCard({ data, preview, state, blocked }) {
  const accepted = data.kind === 'acc';
  const quote = preview.quote;
  const enquiry = quote ? bookingById(state, quote.bookingId) : null;
  const changed = accepted && preview.localTotal !== null && preview.localTotal !== data.total;
  const rows = [
    { key: 'quote', label: 'Quote', value: quote ? html`<${TextLink} href=${routeHref('quote-detail', { id: quote.id })} data-testid="f4-quote-link"><span class="u-mono">${data.quoteId}</span><//>` : html`<span class="u-mono">${data.quoteId}</span>` },
    { key: 'customer', label: 'Customer', value: quote ? quote.customerName : data.customerFirst },
    accepted ? { key: 'total', label: 'Total they accepted', value: html`<span data-testid="f4-accepted-total">${gbp(data.total)}</span>${changed ? html`<span class="f4-changed">${` (the quote now says ${gbp(preview.localTotal)})`}</span>` : null}` } : null,
    accepted ? { key: 'days', label: 'Install days that suit', value: html`<span data-testid="f4-prefers">${data.prefersLong}</span>` } : null,
    accepted && data.note ? { key: 'note', label: 'Their note', value: html`<span data-testid="f4-decision-note">${data.note}</span>` } : null,
    !accepted && preview.localTotal !== null ? { key: 'total', label: 'Quote total', value: gbp(preview.localTotal) } : null,
    !accepted ? { key: 'reason', label: 'Reason', value: html`<span data-testid="f4-reason">${data.reasonLabel || 'No reason given'}</span>` } : null,
    !accepted && data.note ? { key: 'note', label: 'Their words', value: html`<span data-testid="f4-decision-note">${data.note}</span>` } : null,
    enquiry && enquiry.address && enquiry.address.postcode ? { key: 'postcode', label: 'Postcode', value: enquiry.address.postcode } : null
  ].filter(Boolean);
  const chosen = accepted ? INSTALL_DAYS.filter((d) => data.days.includes(d.id)) : [];
  return html`<${Card} class="f4-card" role="group" data-testid="f4-decision-card" aria-label=${accepted ? 'The acceptance' : 'The decline'}>
    <div class="f4-who">
      <${Badge} icon=${accepted ? 'badge-check' : 'circle-x'} tone=${accepted && !blocked ? 'ok' : 'neutral'} />
      <div class="f4-who__main">
        <h2 class="f4-who__name" data-testid="f4-summary">${summaryParts(data)}</h2>
      </div>
    </div>
    ${accepted ? html`<ul class="f4-tags" aria-label="Days that suit" data-testid="f4-days">
      ${chosen.length ? chosen.map((d) => html`<li key=${d.id}><${Chip} tone="accent">${d.label}<//></li>`) : html`<li><${Chip}>Any weekday<//></li>`}
      <li><${Chip} icon="clock">${data.part === 'any' ? 'Any time' : partLabel(data.part)}<//></li>
    </ul>` : null}
    <${KeyValueList} items=${rows} />
  <//>`;
}

// ---------------------------------------------------------------- the screens

/** Why this cannot be applied here, in the owner's words, with the way forward. */
function BlockedNote({ preview, data }) {
  const missing = preview.reason === 'quote_not_found';
  if (missing) {
    return html`<${Banner} tone="warn" icon="smartphone" data-testid="f4-blocked" data-reason=${preview.reason}>
      <strong class="f4-banner__title">This quote isn't on this phone</strong>
      <span class="f4-banner__text" data-testid="f4-blocked-text">Open the link on the phone where you made the quote. A quote only exists on the phone that made it, because this prototype has no shared database.</span>
    <//>`;
  }
  return html`<${Banner} tone="warn" data-testid="f4-blocked" data-reason=${preview.reason}>
    <span class="f4-banner__text" data-testid="f4-blocked-text">${preview.message || `This ${data.kind === 'enq' ? 'enquiry' : 'reply'} cannot be added here.`}</span>
  <//>`;
}

function SuccessView({ finished, preview, state, brand, onUndo }) {
  const { res } = finished;
  const kind = finished.kind;
  const headingRef = useRef(null);
  useEffect(() => { if (headingRef.current) headingRef.current.focus(); }, []);
  const hours = replyHoursOf(state);
  if (kind === 'enq') {
    const b = bookingById(state, res.bookingId);
    const sla = b ? slaFor(b, hours, nowStamp()) : null;
    const when = b ? bookingWhen(b) : '';
    const slot = !b ? '' : isUnscheduled(b) ? 'No free slot in your diary: place the survey from the enquiry' : `${when}${b.tentative === true ? ', pencilled in' : ''}`;
    const first = b ? (b.customer.name || '').split(' ')[0] : '';
    const greeting = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.shortName}. Thanks for your home charger enquiry ${b ? b.ref : ''}.`;
    return html`<div class="f4-success" data-testid="f4-success" data-kind="enq">
      <${Tick} />
      <h2 class="f4-success__title" tabindex="-1" ref=${headingRef} data-testid="f4-success-title">Added to your dashboard</h2>
      <p class="f4-success__lead">${b ? `${b.customer.name}'s enquiry ${b.ref} is in your Bookings, marked new.` : 'The enquiry is in your Bookings, marked new.'}</p>
      <${KeyValueList} class="f4-success__rows" items=${[
        slot ? { key: 'slot', label: 'Survey visit', value: html`<span data-testid="f4-success-slot">${slot}</span>` } : null,
        sla ? { key: 'sla', label: 'Reply clock', value: html`<span data-testid="f4-success-sla">${sla.label}</span>` } : null
      ].filter(Boolean)} />
      ${b && b.customer.phone ? html`<div class="f4-contact__btns">
        <${Button} variant="secondary" icon="phone" href=${telLink(b.customer.phone)} data-testid="f4-call">${first ? `Call ${first}` : 'Call'}<//>
        <${Button} variant="secondary" icon="message-circle" href=${waLink(b.customer.phone, greeting)} data-testid="f4-whatsapp">WhatsApp<//>
      </div>` : null}
    </div>
    <${Bar} inline=${true}>
      <${Button} variant="secondary" size="lg" class="f4-bar__second" href=${routeHref('today')} data-testid="f4-today">Back to Today<//>
      <${Button} variant="primary" size="lg" class="f4-bar__primary" href=${routeHref('bookings', { id: res.bookingId })} data-testid="f4-open">Open the enquiry<//>
    <//>`;
  }
  const accepted = kind === 'acc';
  const quote = res.quote || preview.quote;
  const enquiry = quote ? bookingById(state, quote.bookingId) : null;
  const phone = enquiry && enquiry.customer ? enquiry.customer.phone : '';
  const first = quote ? (quote.customerName || '').split(' ')[0] : '';
  const text = accepted
    ? `Hi ${first}, it's ${brand.ownerFirst}. Thanks for accepting quote ${quote ? quote.id : ''}. I'll be in touch shortly to agree your install day.`
    : `Hi ${first}, it's ${brand.ownerFirst}. Thanks for letting me know about quote ${quote ? quote.id : ''}. If I can change anything to help, just reply here.`;
  const planHref = accepted && res.bookingId ? routeHref('bookings', { id: res.bookingId }) : '';
  return html`<div class="f4-success" data-testid="f4-success" data-kind=${kind}>
    <${Tick} />
    <h2 class="f4-success__title" tabindex="-1" ref=${headingRef} data-testid="f4-success-title">${accepted ? 'Quote accepted' : 'Quote marked declined'}</h2>
    <p class="f4-success__lead">${accepted
      ? (res.bookingId ? 'The install is in your Pipeline under Accepted, waiting for you to agree a day.' : 'The quote is marked accepted.')
      : 'The quote is marked declined. You can still message them and send a new one.'}</p>
    ${phone ? html`<div><${Button} variant="secondary" block icon="message-circle" href=${waLink(phone, text, brand.demoPhoneDigits)} data-testid="f4-reply">${first ? `Message ${first} on WhatsApp` : 'Message them on WhatsApp'}<//></div>` : null}
    ${res.undoToken ? html`<button type="button" class="f4-undo" onClick=${onUndo} data-testid="f4-undo"><${Icon} name="undo-2" size=${18} />Undo</button>` : null}
  </div>
  <${Bar} inline=${true}>
    ${planHref
      ? html`<${Button} variant="secondary" size="lg" class="f4-bar__second" href=${routeHref('pipeline')} data-testid="f4-pipeline">Pipeline<//>
        <${Button} variant="primary" size="lg" class="f4-bar__primary" href=${planHref} data-testid="f4-open">Plan the install day<//>`
      : html`<${Button} variant="secondary" size="lg" class="f4-bar__second" href=${routeHref('today')} data-testid="f4-today">Back to Today<//>
        <${Button} variant="primary" size="lg" class="f4-bar__primary" href=${quote ? routeHref('quote-detail', { id: quote.id }) : routeHref('quotes')} data-testid="f4-open">Open the quote<//>`}
  <//>`;
}

function ImportScreen({ encoded }) {
  const state = useStore(selectAll);
  const brand = useBrand();
  const parsed = useMemo(() => parseImport(encoded), [encoded]);
  const [finished, setFinished] = useState(null); // { kind, res } after a successful tap
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const back = { href: routeHref('today'), label: 'Back to Today' };

  // ---- nothing readable: the calm error (or an empty screen) and the paste fallback ----
  if (!parsed.ok) {
    const empty = parsed.reason === 'empty';
    return html`<div class="db-page f4-page" data-testid="f4-view" data-state=${empty ? 'empty' : 'error'}>
      <${PageHeader} eyebrow="Import" title="Import from WhatsApp" back=${back} />
      <div class="f4-stack">
        <${Card} class="f4-card f4-problem" data-testid="f4-error" data-reason=${parsed.reason}>
          <${Badge} icon=${empty ? 'link' : 'link-2'} tone="warn" />
          <h2 class="f4-h">${empty ? 'Nothing to import yet' : "We couldn't read that link"}</h2>
          <p class="f4-lead" data-testid="f4-error-message">${parsed.message}</p>
          ${empty ? null : html`<ul class="f4-does__list f4-tips">
            <li><${Icon} name="chevron-right" size=${18} /><span>Open the link again from the WhatsApp message.</span></li>
            <li><${Icon} name="chevron-right" size=${18} /><span>Or paste the whole message below.</span></li>
          </ul>
          <p class="f4-meta" data-testid="f4-error-nothing">Nothing has been added.</p>`}
        <//>
        <${PastePanel} heading="Paste the message instead" lead="Copy the whole WhatsApp message, link and all, and paste it here. We will find the link inside it." />
        <${How} brand=${brand} />
      </div>
    </div>`;
  }

  const preview = previewImport(state, parsed);
  const data = parsed.data;

  // ---- a customer's quote link opened on the owner's dashboard by mistake ----
  if (parsed.kind === 'quo') {
    return html`<div class="db-page f4-page" data-testid="f4-view" data-state="quote-link">
      <${PageHeader} eyebrow="Import" title="This is a quote link" back=${back} />
      <div class="f4-stack">
        <${Card} class="f4-card f4-problem" data-testid="f4-wrong-kind">
          <${Badge} icon="file-text" tone="neutral" />
          <h2 class="f4-h">${`Quote ${data.quoteId} for ${data.customerFirst}`}</h2>
          <p class="f4-lead">That link is the quote a customer opens, not something to add to your dashboard.</p>
          <div><${Button} variant="primary" icon="external-link" href=${pageHref('quote.html', `#d=${encodePayload(parsed.payload)}`)} target=${pageTarget('quote.html')} data-testid="f4-open-quote-page">Open it as the customer sees it<//></div>
        <//>
      </div>
    </div>`;
  }

  const kind = parsed.kind;
  const done = preview.state === 'done';
  const blocked = preview.state === 'blocked';
  const forceable = blocked && preview.reason === 'total_changed';
  const eyebrow = kind === 'enq' ? 'Enquiry from a WhatsApp link' : 'Quote reply from a WhatsApp link';
  const hours = replyHoursOf(state);
  const first = data.firstName || data.customerFirst;

  const apply = (force) => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    let res;
    try { res = importHandoff(parsed, force ? { force: true } : {}); } catch (err) { res = { ok: false, reason: 'failed' }; }
    setBusy(false);
    if (res && res.ok) setFinished({ kind, res });
    else setProblem((res && res.message) || failureMessage(res, 'That did not work. Nothing was changed. Please try again.'));
  };
  const takeBack = () => {
    const token = finished && finished.res && finished.res.undoToken;
    const out = token ? undo(token) : { ok: false };
    if (out.ok) { setFinished(null); toast({ message: 'Taken back.' }); } else toast({ message: 'Too late to undo.' });
  };

  if (finished) {
    return html`<div class="db-page f4-page f4-page--bar" data-testid="f4-view" data-state="success">
      <${PageHeader} eyebrow=${eyebrow} title=${kind === 'enq' ? 'Enquiry added' : (kind === 'acc' ? 'Quote accepted' : 'Quote declined')} back=${back} />
      <${SuccessView} finished=${finished} preview=${preview} state=${state} brand=${brand} onUndo=${takeBack} />
    </div>`;
  }

  const does = kind === 'enq'
    ? [
      'It appears in your Bookings as a new enquiry.',
      'The free survey visit is pencilled into the next free slot in your diary, provisional until you confirm it.',
      `The ${hours} hour reply clock starts from when ${first} sent it.`
    ]
    : kind === 'acc'
      ? [
        'The quote is marked accepted, through WhatsApp.',
        `An install job is made with no day yet, with ${first}'s preferred days in its notes.`,
        'It shows in your Pipeline under Accepted, ready for you to confirm a day.'
      ]
      : [
        'The quote is marked declined, with the reason they gave.',
        `You can still message ${first} and send a new quote.`
      ];

  return html`<div class="db-page f4-page f4-page--bar" data-testid="f4-view" data-state=${done ? 'done' : (blocked ? 'blocked' : 'ready')} data-kind=${kind}>
    <${PageHeader} eyebrow=${eyebrow} title=${preview.title} back=${back} />
    <div class="f4-stack">
      ${done ? html`<${Banner} tone="ok" icon="circle-check" data-testid="f4-existing">
        <strong class="f4-banner__title">Already in your dashboard</strong>
        <span class="f4-banner__text">${kind === 'enq' ? 'This enquiry was added before, so nothing is added twice.' : (kind === 'acc' ? 'This quote is already marked accepted.' : 'This quote is already marked declined.')}</span>
      <//>` : null}
      ${blocked ? html`<${BlockedNote} preview=${preview} data=${data} />` : null}
      ${problem ? html`<${Banner} tone="danger" data-testid="f4-problem"><span class="f4-banner__text">${problem}</span><//>` : null}
      ${kind === 'enq' ? html`<${EnquiryCard} data=${data} brand=${brand} />` : html`<${DecisionCard} data=${data} preview=${preview} state=${state} blocked=${blocked} />`}
      ${!done && !blocked ? html`<${Does} items=${does} heading=${kind === 'enq' ? 'What adding it does' : 'What marking it does'} />` : null}
      ${!done && !blocked ? html`<p class="f4-reassure" data-testid="f4-reassure">Nothing is added until you tap. Not now leaves everything as it is, and the link in WhatsApp still works.</p>` : null}
      <${How} brand=${brand} />
    </div>
    <${Bar} long=${!done && !blocked && String(preview.actionLabel).length > 24}>
      ${done
        ? html`<${Button} variant="secondary" size="lg" class="f4-bar__second" href=${routeHref('today')} data-testid="f4-today">Back to Today<//>
          <${Button} variant="primary" size="lg" class="f4-bar__primary" href=${preview.href} data-testid="f4-existing-open">${kind === 'enq' ? 'Open the enquiry' : (preview.bookingId ? 'Open the install' : 'Open the quote')}<//>`
        : blocked
          ? html`<${Button} variant=${forceable ? 'secondary' : 'primary'} size="lg" class="f4-bar__second" href=${routeHref('today')} data-testid="f4-today">Back to Today<//>
            ${forceable ? html`<${Button} variant="primary" size="lg" class="f4-bar__primary" loading=${busy} onClick=${() => apply(true)} data-testid="f4-force">Accept anyway<//>`
              : (preview.quote ? html`<${Button} variant="secondary" size="lg" class="f4-bar__second" href=${routeHref('quote-detail', { id: preview.quote.id })} data-testid="f4-open-quote">Open the quote<//>` : null)}`
          : html`<${Button} variant="secondary" size="lg" class="f4-bar__second" onClick=${() => navigate(routeHref('today'))} data-testid="f4-not-now">Not now<//>
            <${Button} variant="primary" size="lg" class="f4-bar__primary" loading=${busy} onClick=${() => apply(false)} data-testid="f4-add">${preview.actionLabel}<//>`}
    <//>
  </div>`;
}

export default function ImportView({ route }) {
  const encoded = route && route.query && typeof route.query.d === 'string' ? route.query.d : '';
  // Keyed by the payload: opening a second link while this screen is up starts it afresh (no old success state carried over).
  return html`<${ImportScreen} key=${encoded} encoded=${encoded} />`;
}
