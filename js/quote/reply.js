// js/quote/reply.js: LINK MODE of the quote page (quote.html#d=<payload> opened on a phone that never held the quote).
// That phone has no copy of the owner's diary and no way to tell the owner anything, so the customer's reply is a real WhatsApp message to
// the owner: "Which days suit you?" chips (accept) or a reason chip (decline), then a wa.me link built by core (acceptanceHandoff /
// declineHandoff) carrying a link the owner taps to add the reply to his dashboard. Nothing is written to this browser's quote store, and
// the page never claims the message was SENT: the customer taps send in WhatsApp, and this page cannot see that. It only remembers that the
// message was OPENED (rememberHandoff), so a reload can say so.
// Owner: Q4
import { html, useLayoutEffect, useRef, useState, useEffect } from '../vendor/preact-htm.js';
import { Banner } from '../ui/display.js';
import { Button } from '../ui/button.js';
import { Disclosure } from '../ui/sim.js';
import { Field, Textarea } from '../ui/form.js';
import { Sheet } from '../ui/sheet.js';
import { StorageNote } from '../ui/storage-note.js';
import { copyText, cx } from '../ui/util.js';
import { nowStamp } from '../core/clock.js';
import { fmtDayShort, stampDay } from '../core/dates.js';
import { INSTALL_DAYS, INSTALL_PARTS } from '../core/config.js';
import { describePreferences, forgetHandoff, recallHandoff, rememberHandoff } from '../core/handoff.js';
import { acceptanceHandoff, declineHandoff } from '../core/messages.js';
import { Footer, Hero, LinesCard, SheetBar, StepFocus, StepsCard } from './parts.js';
import { DECLINE_REASONS } from './decline.js';
import { money, shownTotal } from './format.js';

// ---------------------------------------------------------------- what this browser opened in WhatsApp

/** What this browser last opened in WhatsApp for quote `id`: { kind: 'acc' | 'dec', days, part, reason, note, at } or null. */
export function readReply(id) {
  if (!id) return null;
  const acc = recallHandoff('acc', id);
  const dec = recallHandoff('dec', id);
  const kind = acc && dec ? (String(dec.at) > String(acc.at) ? 'dec' : 'acc') : acc ? 'acc' : dec ? 'dec' : '';
  if (!kind) return null;
  const info = kind === 'acc' ? acc : dec;
  return {
    kind,
    days: Array.isArray(info.days) ? info.days : [],
    part: typeof info.part === 'string' ? info.part : 'any',
    reason: typeof info.reason === 'string' ? info.reason : '',
    note: typeof info.note === 'string' ? info.note : '',
    at: typeof info.at === 'string' ? info.at : '',
    total: typeof info.total === 'number' ? info.total : 0,
    sent: typeof info.sent === 'string' ? info.sent : ''
  };
}

/**
 * Does a remembered reply belong to THIS version of the quote? If the owner changed the price and sent the quote again (same number, new
 * total or a later sent stamp), an old "ready in WhatsApp" view must not hide the updated quote.
 */
export function replyFits(reply, d) {
  if (!reply || !d || !d.fromLink) return false;
  if (reply.total && reply.total !== d.total) return false;
  if (reply.sent && d.fromLink.sentAt && reply.sent !== d.fromLink.sentAt) return false;
  return true;
}

/** Remember that `reply` was opened in WhatsApp. Only one reply is live at a time: the other kind is forgotten. */
export function rememberReply(id, reply) {
  forgetHandoff(reply.kind === 'acc' ? 'dec' : 'acc', id);
  const which = { total: reply.total || 0, sent: reply.sent || '' };
  rememberHandoff(reply.kind, id, reply.kind === 'acc'
    ? { days: reply.days, part: reply.part, note: reply.note, at: reply.at, ...which }
    : { reason: reply.reason, note: reply.note, at: reply.at, ...which });
}

/** Forget both (the customer goes back to the quote to choose again). */
export function forgetReply(id) {
  forgetHandoff('acc', id);
  forgetHandoff('dec', id);
}

/** The ready-to-open WhatsApp handoff for a reply: { ok, url, text, ... } (core builds it; nothing here writes wa.me addresses). */
export function handoffFor(d, state, reply) {
  return reply.kind === 'acc'
    ? acceptanceHandoff({ quote: d.fromLink, days: reply.days, part: reply.part, note: reply.note }, state)
    : declineHandoff({ quote: d.fromLink, reason: reply.reason, note: reply.note }, state);
}

/** Stand-alone problem for a quote that cannot be carried in a message (never happens for a link that opened, but the page must not break). */
function CannotSend({ brand }) {
  return html`<${Banner} tone="danger" data-testid="q2-reply-problem"
    actions=${html`<${Button} size="sm" variant="secondary" icon="phone" href=${brand.telHref}>Call ${brand.phone}<//>`}>
    <strong>This reply cannot be made from this link.</strong> Nothing was sent. Please call us.
  <//>`;
}

// ---------------------------------------------------------------- accept: "Which days suit you?"

/** One chip: a real checkbox or radio underneath (keyboard and screen readers get a proper group), a 48px button on top. */
function Pref({ type, name, value, label, long, selected, onPick, testid }) {
  return html`
    <label class=${cx('q2-pref', selected && 'is-selected')} data-testid=${testid}>
      <input class="q2-pref__input" type=${type} name=${name} value=${value} checked=${selected} onChange=${onPick} />
      <span class="q2-pref__label" aria-hidden=${long ? 'true' : undefined}>${label}</span>
      ${long ? html`<span class="u-sr-only">${long}</span>` : null}
    </label>
  `;
}

/**
 * The accept sheet in link mode: the days that suit (Mon to Sat), the time of day, an optional note, then "Open WhatsApp" (a real link, so the
 * browser opens it like any link and no pop-up blocker is involved). `onReplied(id, reply)` runs just after the tap, once the browser has
 * followed the link.
 */
export function DaysFlow({ open, state, d, brand, onClose, onReplied }) {
  const [days, setDays] = useState([]);
  const [part, setPart] = useState('any');
  const [note, setNote] = useState('');
  const tapped = useRef(false); // WhatsApp is opened by the link itself: a second tap before the page moves on must not open a second tab

  // A layout effect, so the reset lands before the first tap.
  useLayoutEffect(() => { if (open) { setDays([]); setPart('any'); setNote(''); tapped.current = false; } }, [open]);

  if (!open) return html`<${Sheet} open=${false} title="Which days suit you?" />`;

  const h = acceptanceHandoff({ quote: d.fromLink, days, part, note }, state);
  const toggle = (id) => setDays((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const shown = h.ok ? describePreferences(h.payload.d, h.payload.w) : '';

  const go = (e) => {
    if (!h.ok) return;
    if (tapped.current) { if (e && e.preventDefault) e.preventDefault(); return; }
    tapped.current = true;
    // The tap is an ordinary link: remember it at once (a browser that opens WhatsApp in this very tab would unload the page), then let the
    // browser follow the link (WhatsApp opens in a new tab) BEFORE this sheet closes and the page changes.
    const reply = { kind: 'acc', days: h.payload.d, part: h.payload.w, reason: '', note: h.payload.m || '', at: nowStamp(), total: d.total, sent: d.fromLink.sentAt || '' };
    rememberReply(d.quote.id, reply);
    setTimeout(() => onReplied(d.quote.id, reply), 0);
  };

  const body = html`
    <${StepFocus} class="q2-sheet__lead" testid="q2-days-lead">Tap the days that usually suit you. We will agree the exact day with you on WhatsApp or by phone.<//>
    <fieldset class="q2-prefgroup" data-testid="q2-days">
      <legend class="q2-prefgroup__legend">Days <span class="q2-muted">(choose any, or none if any day suits)</span></legend>
      <div class="q2-prefs q2-prefs--days">
        ${INSTALL_DAYS.map((x) => html`<${Pref} key=${x.id} type="checkbox" name="q2-pday" value=${x.id} label=${x.label} long=${x.long}
          selected=${days.includes(x.id)} onPick=${() => toggle(x.id)} testid=${`q2-pday-${x.id}`} />`)}
      </div>
    </fieldset>
    <fieldset class="q2-prefgroup" data-testid="q2-parts">
      <legend class="q2-prefgroup__legend">Time of day</legend>
      <div class="q2-prefs q2-prefs--parts">
        ${INSTALL_PARTS.map((x) => html`<${Pref} key=${x.id} type="radio" name="q2-ppart" value=${x.id} label=${x.label}
          selected=${part === x.id} onPick=${() => setPart(x.id)} testid=${`q2-ppart-${x.id}`} />`)}
      </div>
    </fieldset>
    <div class="q2-sheet__field">
      <${Field} label="Anything else we should know? (optional)" id="q2-days-note">
        <${Textarea} id="q2-days-note" rows=${2} value=${note} maxlength="200" onInput=${(e) => setNote(e.target.value)} data-testid="q2-days-note" />
      <//>
    </div>
    ${h.ok
    ? html`<p class="q2-prefsum" aria-live="polite" data-testid="q2-reply-summary"><span>Your message says: <strong>Best: ${shown}.</strong></span></p>`
    : html`<${CannotSend} brand=${brand} />`}
  `;

  const footer = html`
    <div class="q2-sheet__foot">
      ${h.ok
    ? html`<${Button} variant="primary" size="lg" block icon="message-circle" href=${h.url} onClick=${go} data-testid="q2-reply-open">Open WhatsApp<//>
        <p class="q2-sheet__sum">This opens WhatsApp with your message written for you. You tap send.</p>`
    : html`<${Button} variant="secondary" size="lg" block onClick=${() => onClose(null)} data-testid="q2-reply-close">Close<//>`}
    </div>`;

  const header = html`<${SheetBar} brand=${brand} title="Which days suit you?" onClose=${() => onClose(null)} />`;
  return html`<${Sheet} open=${true} size="auto" title="Which days suit you?" header=${header} onClose=${() => onClose(null)} footer=${footer}
    initialFocus="[data-q2-focus]" testid="q2-days-sheet">${body}<//>`;
}

// ---------------------------------------------------------------- decline: the reason, then WhatsApp

/** "Not for me" in link mode: the same reason chips, then "Decline in WhatsApp" (a real link). */
export function LinkDeclineFlow({ open, state, d, brand, onClose, onReplied }) {
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const tapped = useRef(false); // see DaysFlow: one tap opens WhatsApp once

  useLayoutEffect(() => { if (open) { setReasonId(''); setNote(''); tapped.current = false; } }, [open]);

  if (!open) return html`<${Sheet} open=${false} title="Not for you?" />`;

  const h = declineHandoff({ quote: d.fromLink, reason: reasonId, note }, state);

  const go = (e) => {
    if (!h.ok) return;
    if (tapped.current) { if (e && e.preventDefault) e.preventDefault(); return; }
    tapped.current = true;
    const reply = { kind: 'dec', days: [], part: 'any', reason: h.payload.y || '', note: h.payload.m || '', at: nowStamp(), total: d.total, sent: d.fromLink.sentAt || '' };
    rememberReply(d.quote.id, reply);
    setTimeout(() => onReplied(d.quote.id, reply), 0);
  };

  const footer = html`
    <div class="q2-sheet__foot">
      <div class="q2-sheet__actions q2-sheet__actions--stack">
        <${Button} variant="primary" size="lg" block onClick=${() => onClose(null)} data-testid="q2-decline-cancel">Keep my quote<//>
        ${h.ok
    ? html`<${Button} variant="secondary" size="lg" block icon="message-circle" href=${h.url} onClick=${go} data-testid="q2-decline-whatsapp">Decline in WhatsApp<//>`
    : null}
      </div>
      <p class="q2-sheet__sum">${h.ok ? 'This opens WhatsApp with your message written for you. You tap send.' : ''}</p>
    </div>`;

  const header = html`<${SheetBar} brand=${brand} title="Not for you?" onClose=${() => onClose(null)} />`;
  return html`<${Sheet} open=${true} size="auto" title="Not for you?" header=${header} onClose=${() => onClose(null)} footer=${footer}
    initialFocus="[data-q2-focus]" testid="q2-decline-sheet">
    <${StepFocus} class="q2-sheet__lead">No problem. If you tell us why, it helps. You can also skip this.<//>
    <fieldset class="q2-reasons" data-testid="q2-reasons">
      <legend class="q2-reasons__legend">Why? <span class="q2-muted">(optional)</span></legend>
      <div class="q2-reasons__list">
        ${DECLINE_REASONS.map((r) => html`
          <label class=${cx('q2-reason', reasonId === r.id && 'is-selected')} key=${r.id} data-testid=${`q2-reason-${r.id}`}>
            <input class="q2-reason__input" type="radio" name="q2-reason" value=${r.id} checked=${reasonId === r.id} onChange=${() => setReasonId(r.id)} />
            <span>${r.label}</span>
            <span class="q2-reason__tick" aria-hidden="true"></span>
          </label>`)}
      </div>
    </fieldset>
    <div class="q2-sheet__field">
      <${Field} label="Anything else you'd like us to know? (optional)" id="q2-decline-note">
        <${Textarea} id="q2-decline-note" rows=${3} value=${note} maxlength="140" onInput=${(e) => setNote(e.target.value)} data-testid="q2-reason-note" />
      <//>
    </div>
    ${h.ok ? null : html`<${CannotSend} brand=${brand} />`}
  <//>`;
}

// ---------------------------------------------------------------- after the tap: "Your message is ready in WhatsApp"

/** A chat-bubble look for the message, with the long link shown as a short chip (the whole text is one tap away under "See everything"). */
function MessagePreview({ text, link }) {
  const human = link ? text.split(link).join('').replace(/\n+$/, '') : text;
  return html`
    <div class="q2-bubble" data-testid="q2-reply-message">
      <p class="q2-bubble__text">${human}</p>
      ${link ? html`<p class="q2-bubble__link"><span>Link to your reply</span></p>` : null}
    </div>
  `;
}

/**
 * The calm confirmation once WhatsApp has been opened (and again on every reload, from what the browser remembered): the message that is ready,
 * "Open WhatsApp" again, "Copy message" for a pop-up blocker or a phone that did not open the app, the whole text for copying by hand, and a way
 * back to the quote. It never says "sent": the customer taps send in WhatsApp and this page cannot see it.
 */
export function LinkSentView({ d, brand, state, reply, fresh, onChange }) {
  const [copied, setCopied] = useState('');
  const accepted = reply.kind === 'acc';
  const h = handoffFor(d, state, reply);
  const when = reply.at ? fmtDayShort(stampDay(reply.at)) : '';

  useEffect(() => {
    const el = document.getElementById('q2-title');
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
    window.scrollTo(0, 0);
  }, []);

  const copy = async () => {
    const ok = h.ok ? await copyText(h.text) : false;
    setCopied(ok ? 'ok' : 'fail');
  };

  const title = 'Your message is ready in WhatsApp';
  const lead = accepted
    ? 'Tap send and we will confirm your install day.'
    : 'Tap send so we know. There is nothing else you need to do.';
  const eyebrow = fresh ? 'Almost done' : (when ? `Opened in WhatsApp on ${when}` : 'Opened in WhatsApp');

  const steps = [
    { title: 'Your message is written', text: accepted ? 'It has your quote number, the days you chose and a link for your reply.' : 'It has your quote number and a link for your reply.' },
    { title: 'You tap send in WhatsApp', text: 'Nothing reaches us until you do.' },
    { title: 'We confirm your day', text: 'We agree the exact day with you by WhatsApp or phone.' }
  ];

  return html`
    <div class="q2-state" data-testid="q2-reply-sent" data-kind=${reply.kind}>
      <${Hero} brand=${brand} variant="ready" who=${d.customerFirst} eyebrow=${eyebrow} title=${title} lead=${lead} titleTestid="q2-sent-title" />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        <section class="q2-card q2-ready" aria-labelledby="q2-ready-h" data-testid="q2-ready">
          <div class="q2-ready__head">
            <h2 class="q2-label" id="q2-ready-h">Your message to us</h2>
            <p class="q2-ready__quote u-mono">${d.quote.id} · ${money(shownTotal(d))}</p>
          </div>
          ${h.ok ? html`<${MessagePreview} text=${h.text} link=${h.link} />` : null}
          ${h.ok ? null : html`<${CannotSend} brand=${brand} />`}
          <div class="q2-actions">
            ${h.ok ? html`<${Button} variant="primary" size="lg" block icon="message-circle" href=${h.url} data-testid="q2-reopen">Open WhatsApp again<//>` : null}
            <div class="q2-row q2-row--even">
              <${Button} variant="secondary" onClick=${copy} disabled=${!h.ok} data-testid="q2-copy">${copied === 'ok' ? 'Copied' : 'Copy message'}<//>
              <${Button} variant="secondary" icon="phone" href=${brand.telHref} aria-label=${`Call us on ${brand.phone}`} data-testid="q2-call">Call us<//>
            </div>
            <p class=${cx('q2-copynote', copied === 'fail' && 'is-fail')} role="status" data-testid="q2-copy-status">${
  copied === 'ok' ? `Copied. In WhatsApp, open your chat with ${brand.name} and paste it.`
    : copied === 'fail' ? 'Your phone would not copy it. Open "See everything in the message" below and select the text by hand.' : ''}</p>
          </div>
          ${h.ok ? html`
            <${Disclosure} title="See everything in the message" testid="q2-fulltext-disclosure" class="q2-disclosure q2-fulltextbox">
              <p class="q2-fine">The link at the end lets us add your reply to our dashboard with one tap.</p>
              <textarea class="q2-fulltext" readonly rows="7" value=${h.text} aria-label="The whole message" data-testid="q2-reply-fulltext"
                onFocus=${(e) => { try { e.target.select(); } catch (err) { /* nothing to select */ } }} />
            <//>` : null}
        </section>
        <${StorageNote} where="quote" />
        ${accepted ? html`<${StepsCard} brand=${brand} heading="What happens next" steps=${steps} done=${1} />` : null}
        <section class="q2-card q2-change" aria-labelledby="q2-change-h" data-testid="q2-change">
          <h2 class="q2-h2" id="q2-change-h">${accepted ? 'Picked the wrong days?' : 'Changed your mind?'}</h2>
          <p class="q2-contact__intro">${accepted ? 'Go back to the quote and make your reply again.' : 'Go back to the quote to accept it, or message us to talk it over.'}</p>
          <${Button} variant="secondary" size="lg" block icon="arrow-left" onClick=${onChange} data-testid="q2-reply-change">Back to my quote<//>
        </section>
        <${Disclosure} title="Read your quote again" summary=${money(shownTotal(d))} testid="q2-quote-disclosure" class="q2-disclosure">
          <${LinesCard} d=${d} compact />
        <//>
        <p class="q2-simnote" data-proto data-testid="q2-simnote"><span><strong>Prototype.</strong> Your reply travels as a WhatsApp message that you send, with a link we tap. This page cannot see inside WhatsApp, so it cannot tell whether you sent it. A live version would reach us automatically.</span></p>
      </main>
      <${Footer} brand=${brand} />
    </div>
  `;
}
