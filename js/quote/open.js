// js/quote/open.js: the quote as the customer first sees it (sent, viewed, or expired): hero, decision card, itemised lines and possible extras, notes, sample terms, trust, steps, contact.
// Owner: Q2 (customer quote page)
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { Banner } from '../ui/display.js';
import {
  ContactCard, DecisionCard, DeclineLink, Footer, Hero, LinesCard, MetaRow, NotesCard, PreviewStrip, StepsCard, StickyBar, TermsCard, TrustCard
} from './parts.js';
import { AcceptFlow } from './accept.js';
import { DeclineFlow } from './decline.js';
import { DaysFlow, LinkDeclineFlow } from './reply.js';
import { installPostcode, questionText } from './format.js';

/** True while `selector` has scrolled out of view (or has not come into view yet): drives the sticky accept bar. Visible by default where observers are missing. */
function useOutOfView(selector, active) {
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!active || typeof IntersectionObserver !== 'function') { setOut(false); return undefined; }
    const el = document.querySelector(selector);
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      setOut(!last.isIntersecting);
    }, { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [selector, active]);
  return out;
}

/** What happens next, for a quote opened from a link: the reply is a WhatsApp message the customer sends (see js/quote/reply.js). */
function linkSteps(brand) {
  return [
    { title: 'Choose the days that suit you', text: 'Tap Choose install day, then pick the days and the time of day that usually work for you.' },
    { title: 'Send your reply on WhatsApp', text: 'WhatsApp opens with your message to us written for you. You tap send.' },
    { title: 'We confirm your day', text: 'We agree the exact day with you by WhatsApp or phone.' }
  ];
}

/**
 * The open quote. `d.fromLink` marks LINK MODE (quote.html#d=<payload> on a phone that never held the quote): the same page, but Accept asks
 * "Which days suit you?" and Accept and Not for me end in a WhatsApp message to the owner (`onReply` tells the page, which then shows the
 * calm "ready in WhatsApp" view). Same-browser mode (the quote is in this browser's store) is unchanged.
 */
export function OpenView({ d, state, brand, preview, onReply }) {
  const linkMode = !!d.fromLink;
  const expired = d.status === 'expired';
  const [sheet, setSheet] = useState(null); // null | 'accept' | 'decline'
  const [notice, setNotice] = useState(null);
  const stuck = useOutOfView('[data-testid="q2-accept"]', !expired);

  // The sheet can only stay open while the quote can still be accepted or declined.
  useEffect(() => { if (expired && sheet) setSheet(null); }, [expired, sheet]);

  const closeSheet = (info) => {
    setSheet(null);
    if (info && info.title) setNotice(info);
  };

  return html`
    <div class="q2-state" data-testid="q2-open">
      ${preview ? html`<${PreviewStrip} />` : null}
      <${Hero} brand=${brand} variant="open" who=${d.customerFirst} eyebrow=${`Hi ${d.customerFirst},`} title="Your EV charger installation quote">
        <${MetaRow} d=${d} postcode=${installPostcode(d, state)} />
      <//>
      <main class="q2-main" id="q2-main" tabindex="-1">
        <div class="q2-wrap q2-grid">
          <aside class="q2-side" aria-label="Your decision">
            ${notice ? html`<${Banner} tone=${notice.tone === 'ok' ? 'ok' : notice.tone} class="q2-notice" data-testid="q2-notice"><strong>${notice.title}.</strong> ${notice.text}<//>` : null}
            <${DecisionCard} d=${d} brand=${brand} expired=${expired} onAccept=${() => { setNotice(null); setSheet('accept'); }} />
            ${expired ? null : html`<${DeclineLink} onDecline=${() => { setNotice(null); setSheet('decline'); }} />`}
          </aside>
          <div class="q2-body">
            <${LinesCard} d=${d} />
            <${NotesCard} d=${d} owner=${brand.ownerFirst} />
            ${expired ? null : html`<${TermsCard} brand=${brand} />`}
            <${TrustCard} brand=${brand} />
            ${expired ? null : html`<${StepsCard} brand=${brand} steps=${linkMode ? linkSteps(brand) : undefined} />`}
            <${ContactCard} brand=${brand} text=${questionText(brand, d)} />
          </div>
        </div>
      </main>
      <${Footer} brand=${brand} />
      ${expired ? null : html`<${StickyBar} show=${stuck && sheet === null} validLabel=${d.validUntilLabel} onAccept=${() => { setNotice(null); setSheet('accept'); }} />`}
      ${expired ? null : linkMode
    ? html`
        <${DaysFlow} open=${sheet === 'accept'} state=${state} d=${d} brand=${brand} onClose=${closeSheet} onReplied=${(id, reply) => { setSheet(null); onReply(id, reply); }} />
        <${LinkDeclineFlow} open=${sheet === 'decline'} state=${state} d=${d} brand=${brand} onClose=${closeSheet} onReplied=${(id, reply) => { setSheet(null); onReply(id, reply); }} />`
    : html`
        <${AcceptFlow} open=${sheet === 'accept'} state=${state} d=${d} brand=${brand} onClose=${closeSheet} onAccepted=${() => setSheet(null)} />
        <${DeclineFlow} open=${sheet === 'decline'} d=${d} brand=${brand} onClose=${() => setSheet(null)} onDeclined=${() => setSheet(null)} />`}
    </div>
  `;
}
