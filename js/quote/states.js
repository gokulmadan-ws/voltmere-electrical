// js/quote/states.js: the quiet states of the quote page: link not valid on this device, quote not ready yet, quote declined.
// Owner: Q2 (customer quote page)
import { html } from '../vendor/preact-htm.js';
import { Button, Disclosure, Icon, pageHref } from '../ui/index.js';
import { waLink } from '../core/messages.js';
import { ContactCard, Footer, Hero, LinesCard } from './parts.js';
import { money, plainText, reopenText } from './format.js';

/** No quote for this link: the address has no reference, or this browser has never seen it (a prototype limit, explained plainly). */
export function InvalidView({ brand, id }) {
  const missing = !id;
  const wa = waLink(brand.phone, plainText(brand), brand.demoPhoneDigits);
  return html`
    <div class="q2-state" data-testid="q2-invalid">
      <${Hero} brand=${brand} variant="quiet"
        eyebrow=${missing ? 'Quote link incomplete' : 'Quote not found here'}
        title=${missing ? "This quote link isn't complete" : "This quote link isn't valid on this device"}
        lead=${missing ? 'It is missing the quote reference. Check that you copied the whole link from the message.' : 'This is a prototype, so quotes are kept in the browser that made them, not on a server.'} />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        <section class="q2-card" aria-labelledby="q2-why-h">
          <h2 class="q2-h2" id="q2-why-h">What to do</h2>
          <ul class="q2-list">
            ${missing ? null : html`<li><${Icon} name="smartphone" size=${20} /><span>Open the link on the same phone or computer where the quote was written.</span></li>`}
            <li><${Icon} name="send" size=${20} /><span>${`Ask ${brand.ownerFirst} to send the link again.`}</span></li>
            <li><${Icon} name="globe" size=${20} /><span>In a live version, your quote link would open on any phone, anywhere.</span></li>
          </ul>
          ${missing ? null : html`<p class="q2-muted q2-ref-line">Reference in the link: <span class="u-mono" data-testid="q2-bad-id">${id}</span></p>`}
          <div class="q2-actions">
            <${Button} variant="primary" size="lg" block icon="phone" href=${brand.telHref} data-testid="q2-call">Call ${brand.phone}<//>
            <div class="q2-row q2-row--even">
              <${Button} variant="secondary" icon="message-circle" href=${wa} data-testid="q2-whatsapp">WhatsApp ${brand.ownerFirst}<//>
              <${Button} variant="ghost" icon="house" href=${pageHref('index.html')} data-testid="q2-home">Visit ${brand.name}<//>
            </div>
          </div>
        </section>
        <section class="q2-card q2-demo" aria-labelledby="q2-demo-h">
          <h2 class="q2-h2" id="q2-demo-h">Trying the prototype?</h2>
          <p class="q2-muted">Open the owner dashboard on this device, write a quote, send it, and open its link. The quote then appears here.</p>
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
        lead=${`${brand.ownerFirst} is still putting it together. He will send you the link when it is ready.`} />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        <${ContactCard} brand=${brand} heading="Need it sooner?" intro=${`Call or message ${brand.ownerFirst} and he can tell you when to expect it.`}
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
        lead="There is nothing more you need to do. This quote is closed." />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        ${reason ? html`
          <section class="q2-card" aria-labelledby="q2-reason-h">
            <h2 class="q2-h2" id="q2-reason-h">What you told ${brand.ownerFirst}</h2>
            <p class="q2-reasonline" data-testid="q2-declined-reason">${reason}</p>
          </section>` : null}
        <section class="q2-card q2-contact" aria-labelledby="q2-again-h">
          <h2 class="q2-h2" id="q2-again-h">Changed your mind?</h2>
          <p class="q2-contact__intro">Message ${brand.ownerFirst} and he will see what he can do. Quote ${d.quote.id}, ${money(d.total)}.</p>
          <div class="q2-row q2-row--even">
            <${Button} variant="primary" size="lg" icon="message-circle" href=${wa} data-testid="q2-whatsapp">Message ${brand.ownerFirst}<//>
            <${Button} variant="secondary" size="lg" icon="phone" href=${brand.telHref} data-testid="q2-call">Call ${brand.phone}<//>
          </div>
        </section>
        <${Disclosure} title="Read the quote" summary=${money(d.total)} testid="q2-quote-disclosure" class="q2-disclosure">
          <${LinesCard} d=${d} compact />
        <//>
      </main>
      <${Footer} brand=${brand} />
    </div>
  `;
}
