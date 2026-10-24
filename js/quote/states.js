// js/quote/states.js: the quiet states of the quote page: link not valid on this device, quote not ready yet, quote declined.
// Owner: Q2 (customer quote page)
import { html } from '../vendor/preact-htm.js';
import { Button, Disclosure, Icon, pageHref } from '../ui/index.js';
import { waLink } from '../core/messages.js';
import { ContactCard, Footer, Hero, LinesCard } from './parts.js';
import { money, plainText, reopenText, shownTotal } from './format.js';
import { linkProblemText } from './linked.js';

/**
 * No quote for this link: the address has no reference, or this browser has never seen it and the link did not carry its own copy
 * (a bare link, or one cut short). Said in the customer's words: what happened, and Call (primary) or WhatsApp to get it sent again.
 * The explanation for someone trying the prototype lives in its own card, tagged data-proto.
 */
export function InvalidView({ brand, id, damaged, why }) {
  const missing = !id && !damaged;
  const owner = brand.ownerFirst;
  const wa = waLink(brand.phone, plainText(brand, id), brand.demoPhoneDigits);
  return html`
    <div class="q2-state" data-testid="q2-invalid">
      <${Hero} brand=${brand} variant="quiet"
        title="We could not open this quote"
        lead=${`The link may have been cut short. Call or WhatsApp ${owner} and he will send it again.`} />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        <section class="q2-card q2-help" aria-labelledby="q2-why-h">
          <h2 class="q2-h2" id="q2-why-h">Get your quote sent again</h2>
          <div class="q2-actions">
            <${Button} variant="primary" size="lg" block icon="phone" href=${brand.telHref} data-testid="q2-call">Call ${brand.phone}<//>
            <div class="q2-row q2-row--even">
              <${Button} variant="secondary" icon="message-circle" href=${wa} data-testid="q2-whatsapp">WhatsApp ${owner}<//>
              <${Button} variant="ghost" icon="house" href=${pageHref('index.html')} data-testid="q2-home">Visit ${brand.name}<//>
            </div>
          </div>
          <ul class="q2-list q2-help__list">
            ${damaged ? html`<li><${Icon} name="link" size=${20} /><span data-testid="q2-damaged">${linkProblemText(why, owner)}</span></li>` : null}
            ${missing ? html`<li><${Icon} name="link" size=${20} /><span>The link is missing the quote reference. Check that you copied the whole link from the message.</span></li>` : null}
            <li><${Icon} name="send" size=${20} /><span>${`If it still will not open, ${owner} can send the link again.`}</span></li>
          </ul>
          ${missing ? null : html`<p class="q2-muted q2-ref-line">Reference in the link: <span class="u-mono" data-testid="q2-bad-id">${id}</span></p>`}
        </section>
        <section class="q2-card q2-demo" aria-labelledby="q2-demo-h" data-proto data-testid="q2-demo">
          <h2 class="q2-h2" id="q2-demo-h">Trying the prototype?</h2>
          <p class="q2-muted">A quote link carries the whole quote inside the link, so it opens on any phone with no server. A link that holds only a quote number is kept in the browser that made them, so it opens nowhere else. Open the owner dashboard on this device, write a quote, send it, and open its link. The quote then appears here.</p>
          <div class="q2-actions"><${Button} variant="secondary" icon="file-text" href=${pageHref('dashboard.html', '#/quotes')} data-testid="q2-open-dashboard">Open the dashboard<//></div>
        </section>
      </main>
      <${Footer} brand=${brand} />
    </div>
  `;
}

/** A draft: the owner has not sent it yet, so nothing of it is shown. */
export function DraftView({ d, brand }) {
  return html`
    <div class="q2-state" data-testid="q2-draft">
      <${Hero} brand=${brand} variant="quiet" eyebrow=${`Hi ${d.customerFirst},`} title="Your quote isn't ready yet"
        lead=${`${brand.ownerFirst} is still putting it together and will send you the link when it is ready.`} who=${d.customerFirst} />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        <${ContactCard} brand=${brand} heading="Need it sooner?" intro=${`Call or message ${brand.ownerFirst} to find out when to expect it.`}
          text=${`Hi ${brand.ownerFirst}, it's ${d.quote.customerName}. Could you tell me when my EV charger quote will be ready?`} />
      </main>
      <${Footer} brand=${brand} />
    </div>
  `;
}

/** The customer turned the quote down. Nothing more to do; a way back to the owner if they change their mind. */
export function DeclinedView({ d, brand }) {
  const wa = waLink(brand.phone, reopenText(brand, d), brand.demoPhoneDigits);
  const reason = String(d.quote.declineReason || '').trim();
  return html`
    <div class="q2-state" data-testid="q2-declined">
      <${Hero} brand=${brand} variant="quiet" eyebrow="Quote declined" title=${`Thanks for letting ${brand.ownerFirst} know.`}
        lead="There is nothing more you need to do. This quote is closed." who=${d.customerFirst} />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        ${reason ? html`
          <section class="q2-card" aria-labelledby="q2-reason-h">
            <h2 class="q2-h2" id="q2-reason-h">What you told ${brand.ownerFirst}</h2>
            <p class="q2-reasonline" data-testid="q2-declined-reason">${reason}</p>
          </section>` : null}
        <section class="q2-card q2-contact" aria-labelledby="q2-again-h">
          <h2 class="q2-h2" id="q2-again-h">Changed your mind?</h2>
          <p class="q2-contact__intro">Message ${brand.ownerFirst} to see what can be done. Quote ${d.quote.id}, ${money(shownTotal(d))}.</p>
          <div class="q2-row q2-row--even">
            <${Button} variant="primary" size="lg" icon="message-circle" href=${wa} data-testid="q2-whatsapp">Message ${brand.ownerFirst}<//>
            <${Button} variant="secondary" size="lg" icon="phone" href=${brand.telHref} data-testid="q2-call">Call ${brand.phone}<//>
          </div>
        </section>
        <${Disclosure} title="Read the quote" summary=${money(shownTotal(d))} testid="q2-quote-disclosure" class="q2-disclosure">
          <${LinesCard} d=${d} compact />
        <//>
      </main>
      <${Footer} brand=${brand} />
    </div>
  `;
}
