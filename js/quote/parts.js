// js/quote/parts.js: the building blocks of the customer quote page (top bar, hero, decision card, itemised lines, notes, trust, steps, contact, footer, sticky bar).
// Owner: Q2 (customer quote page)
import { html, useLayoutEffect, useRef } from '../vendor/preact-htm.js';
import { Button, Icon, PrototypeNotice, ThemeToggle, cx, pageHref } from '../ui/index.js';
import { mailtoLink, waLink } from '../core/messages.js';
import { DAY_SHORT, MONTH_SHORT, parseDayKey } from '../core/dates.js';
import { QuoteLogo } from './media.js';
import { money, questionText, refreshText, validity } from './format.js';

/** His logo and the "Prototype: sample quote" notice. Sits on the black hero panel. */
export function TopBar({ brand }) {
  return html`
    <div class="q2-top q2-wrap" data-testid="q2-header">
      <a class="q2-brand" href=${pageHref('index.html')} aria-label=${`${brand.name} home page`} data-testid="q2-logo">
        <${QuoteLogo} name=${brand.name} images=${brand.images} />
      </a>
      <p class="q2-proto" role="note" data-testid="q2-proto"><${Icon} name="info" size=${16} /><span>Prototype: sample quote</span></p>
    </div>
  `;
}

/** The black panel at the top of every state: top bar, greeting, the one h1 (focus target), a lead line and anything else (children). */
export function Hero({ brand, eyebrow, title, lead, variant, titleTestid = 'q2-title', children, mark }) {
  return html`
    <header class=${cx('q2-hero', variant && `q2-hero--${variant}`)}>
      <${TopBar} brand=${brand} />
      <div class="q2-wrap q2-hero__body">
        ${mark || null}
        ${eyebrow ? html`<p class="q2-eyebrow" data-testid="q2-greeting">${eyebrow}</p>` : null}
        <h1 class="q2-title" id="q2-title" tabindex="-1" data-testid=${titleTestid}>${title}</h1>
        ${lead ? html`<p class="q2-lead">${lead}</p>` : null}
        ${children || null}
      </div>
    </header>
  `;
}

/** Quote reference and who it is for, as two small pills under the title. */
export function MetaPills({ d }) {
  return html`
    <ul class="q2-meta" aria-label="Quote details">
      <li class="q2-pill"><span class="q2-pill__k">Quote</span><span class="q2-pill__v u-mono" data-testid="q2-ref">${d.quote.id}</span></li>
      <li class="q2-pill"><span class="q2-pill__k">For</span><span class="q2-pill__v" data-testid="q2-for">${d.quote.customerName}</span></li>
    </ul>
  `;
}

/** 'Valid until Thu 19 Nov' plus how long is left, as one chip with an icon (never colour alone). */
export function ValidChip({ d }) {
  const v = validity(d);
  const icon = v.tone === 'expired' ? 'calendar-x' : v.tone === 'ok' ? 'calendar-clock' : 'hourglass';
  return html`
    <p class=${cx('q2-valid', `q2-valid--${v.tone}`)} data-testid="q2-valid">
      <${Icon} name=${icon} size=${18} />
      <span><span data-testid="q2-valid-until">${v.label}</span>${v.short ? html` <span class="q2-valid__left" data-testid="q2-days-left">· ${v.short}</span>` : null}</span>
    </p>
  `;
}

/** Total, charger, validity and the decisions. On wide screens this card stays in view beside the quote. */
export function DecisionCard({ d, brand, expired, onAccept, onDecline }) {
  const ask = waLink(brand.phone, questionText(brand, d), brand.demoPhoneDigits);
  const refresh = waLink(brand.phone, refreshText(brand, d), brand.demoPhoneDigits);
  return html`
    <section class=${cx('q2-card', 'q2-decide', expired && 'is-expired')} aria-labelledby="q2-total-label" data-testid="q2-decision">
      <div class="q2-decide__top">
        <div>
          <p class="q2-label" id="q2-total-label">Total</p>
          <p class="q2-total" data-testid="q2-total">${money(d.total)}</p>
        </div>
        <span class="q2-sample" title="All prices in this prototype are samples">Sample price</span>
      </div>
      ${d.quote.brand ? html`<p class="q2-decide__what" data-testid="q2-brand"><${Icon} name="plug-zap" size=${18} /><span>${d.quote.brand} home charger</span></p>` : null}
      ${expired ? null : html`<${ValidChip} d=${d} />`}

      ${expired
    ? html`
          <div class="q2-expired" id="q2-expired-note" role="note" data-testid="q2-expired">
            <${Icon} name="calendar-x" size=${22} />
            <p><strong>This quote has expired.</strong> It was valid until ${d.validUntilLabel}, so it can't be accepted now. ${brand.ownerFirst} can send you an updated one.</p>
          </div>
          <div class="q2-actions">
            <${Button} variant="primary" size="lg" block icon="message-circle" href=${refresh} data-testid="q2-ask">Ask for an updated quote<//>
            <${Button} variant="secondary" block icon="check" disabled aria-describedby="q2-expired-note" data-testid="q2-accept">Accept quote<//>
          </div>`
    : html`
          <div class="q2-actions">
            <${Button} variant="primary" size="lg" block icon="check" onClick=${onAccept} data-testid="q2-accept">Accept quote<//>
            <div class="q2-row">
              <${Button} variant="secondary" icon="message-circle" href=${ask} data-testid="q2-ask">Ask a question<//>
              <${Button} variant="ghost" onClick=${onDecline} data-testid="q2-decline">Not for me<//>
            </div>
          </div>
          <p class="q2-fine">You choose your install day next. It is pencilled in until ${brand.ownerFirst} confirms it. No payment is taken on this page.</p>`}
    </section>
  `;
}

/** Itemised lines: description, detail, quantity times price, line total, then the total. */
export function LinesCard({ d, heading = "What's included", compact }) {
  return html`
    <section class=${cx('q2-card', 'q2-lines', compact && 'q2-lines--compact')} aria-labelledby="q2-lines-h" data-testid="q2-lines-card">
      <h2 class="q2-h2" id="q2-lines-h">${heading}</h2>
      <ul class="q2-lines__list" data-testid="q2-lines">
        ${d.lines.map((line) => html`
          <li class="q2-line" key=${line.id} data-testid="q2-line">
            <div class="q2-line__main">
              <p class="q2-line__label">${line.label}</p>
              ${line.detail ? html`<p class="q2-line__detail">${line.detail}</p>` : null}
            </div>
            <div class="q2-line__amt">
              <span class="q2-line__total">${money(line.lineTotal)}</span>
              ${line.qty > 1
    ? html`<span class="q2-line__qty"><span aria-hidden="true">${line.qty} × ${money(line.unitPrice)}</span><span class="u-sr-only">${line.qty} at ${money(line.unitPrice)} each</span></span>`
    : null}
            </div>
          </li>`)}
      </ul>
      <div class="q2-lines__sum">
        <span class="q2-lines__sumlabel">Total</span>
        <strong class="q2-lines__sumvalue" data-testid="q2-lines-total">${money(d.total)}</strong>
      </div>
    </section>
  `;
}

/** The owner's notes, plus the two facts a customer wants: how long it is valid and how long the install takes. */
export function NotesCard({ d, installLabel }) {
  const notes = String(d.quote.notes || '').trim();
  return html`
    <section class="q2-card q2-notes" aria-labelledby="q2-notes-h" data-testid="q2-notes-card">
      <h2 class="q2-h2" id="q2-notes-h">Good to know</h2>
      ${notes ? html`<p class="q2-notes__text" data-testid="q2-notes">${notes}</p>` : html`<p class="q2-notes__text q2-muted">No extra notes on this quote.</p>`}
      <ul class="q2-facts">
        <li><${Icon} name="calendar-clock" size=${20} /><span><strong>Valid until ${d.validUntilLabel}.</strong> After that, ask for an updated quote.</span></li>
        ${installLabel ? html`<li><${Icon} name="clock" size=${20} /><span><strong>Installation takes ${installLabel}.</strong> You pick a morning or afternoon.</span></li>` : null}
      </ul>
    </section>
  `;
}

/** The two credentials from his site, as badges. */
export function TrustCard({ brand }) {
  const list = Array.isArray(brand.credentials) ? brand.credentials : [];
  if (!list.length) return null;
  return html`
    <section class="q2-card q2-trust" aria-labelledby="q2-trust-h" data-testid="q2-trust">
      <h2 class="q2-h2" id="q2-trust-h">Accredited and qualified</h2>
      <ul class="q2-badges" data-testid="q2-credentials">
        ${list.map((c) => html`<li class="q2-badge" key=${c}><span class="q2-badge__mark"><${Icon} name="badge-check" size=${22} /></span><span class="q2-badge__text">${c}</span></li>`)}
      </ul>
    </section>
  `;
}

/** Three plain steps. `done` marks the first one(s) as already happened. */
export function StepsCard({ brand, heading = 'What happens next', steps, done = 0 }) {
  const list = steps || [
    { title: 'Choose your install day', text: 'Pick a morning or afternoon in the next two weeks. It is pencilled in straight away.' },
    { title: `${brand.ownerFirst} confirms it`, text: `${brand.ownerFirst} checks the day with you by WhatsApp or phone.` },
    { title: 'Your charger is fitted', text: 'Installed and tested on your day, ready to plug in.' }
  ];
  return html`
    <section class="q2-card q2-steps" aria-labelledby="q2-steps-h" data-testid="q2-steps">
      <h2 class="q2-h2" id="q2-steps-h">${heading}</h2>
      <ol class="q2-steps__list">
        ${list.map((s, i) => html`
          <li class=${cx('q2-step', i < done && 'is-done')} key=${i}>
            <span class="q2-step__num" aria-hidden="true">${i < done ? html`<${Icon} name="check" size=${16} />` : i + 1}</span>
            <div><p class="q2-step__title">${s.title}${i < done ? html`<span class="u-sr-only"> (done)</span>` : null}</p><p class="q2-step__text">${s.text}</p></div>
          </li>`)}
      </ol>
    </section>
  `;
}

/** Call and WhatsApp with his real number. */
export function ContactCard({ brand, text, heading, intro }) {
  const wa = waLink(brand.phone, text, brand.demoPhoneDigits);
  return html`
    <section class="q2-card q2-contact" aria-labelledby="q2-contact-h" data-testid="q2-contact">
      <h2 class="q2-h2" id="q2-contact-h">${heading || `Rather talk it through?`}</h2>
      <p class="q2-contact__intro">${intro || `Call or message ${brand.ownerFirst}. He is happy to go through the quote with you.`}</p>
      <div class="q2-row q2-row--even">
        <${Button} variant="secondary" size="lg" icon="phone" href=${brand.telHref} data-testid="q2-call">Call ${brand.phone}<//>
        <${Button} variant="secondary" size="lg" icon="message-circle" href=${wa} data-testid="q2-whatsapp">WhatsApp<//>
      </div>
    </section>
  `;
}

/** Name, area, real phone and email, appearance, and the prototype disclosure. */
export function Footer({ brand }) {
  return html`
    <footer class="q2-footer" data-testid="q2-footer">
      <div class="q2-wrap q2-footer__inner">
        <div class="q2-footer__who">
          <p class="q2-footer__name">${brand.name}</p>
          <p class="q2-footer__area">${brand.areaText || 'Serving Northern Ireland'}</p>
          <ul class="q2-footer__links">
            <li><a href=${brand.telHref} data-testid="q2-footer-phone"><${Icon} name="phone" size=${18} /><span>${brand.phone}</span></a></li>
            <li><a href=${mailtoLink(brand.email)} data-testid="q2-footer-email"><${Icon} name="send" size=${18} /><span>${brand.email}</span></a></li>
          </ul>
        </div>
        <div class="q2-footer__theme">
          <p class="q2-label" id="q2-appearance">Appearance</p>
          <${ThemeToggle} variant="segmented" />
        </div>
        <div class="q2-footer__legal">
          <${PrototypeNotice} variant="footer" page="dashboard" data-testid="q2-footer-disclosure" />
        </div>
      </div>
    </footer>
  `;
}

/** The accept button that follows the customer down the page on phones, once the one in the card has scrolled away. */
export function StickyBar({ show, total, onAccept }) {
  return html`
    <div class=${cx('q2-sticky', show && 'is-on')} aria-hidden=${show ? undefined : 'true'} inert=${show ? undefined : true} data-testid="q2-sticky">
      <div class="q2-sticky__inner">
        <p class="q2-sticky__total"><span>Total</span><strong>${money(total)}</strong></p>
        <${Button} variant="primary" icon="check" onClick=${onAccept} tabindex=${show ? undefined : -1} data-testid="q2-accept-sticky">Accept quote<//>
      </div>
    </div>
  `;
}

/** A slim bar for the owner who opened the link from the dashboard. */
export function PreviewStrip() {
  return html`
    <div class="q2-preview" role="note" data-testid="q2-preview">
      <div class="q2-wrap q2-preview__inner"><${Icon} name="eye" size=${18} /><p><strong>Preview.</strong> This is what your customer sees. This visit is not counted as a view, but accepting or declining here really changes the quote.</p></div>
    </div>
  `;
}

/** A little calendar leaf: month, day number, weekday. Decorative (the date is always written out beside it). */
export function DateBox({ dayKey }) {
  const date = parseDayKey(dayKey);
  return html`
    <span class="q2-datebox" aria-hidden="true">
      <span class="q2-datebox__mon">${MONTH_SHORT[date.getMonth()]}</span>
      <span class="q2-datebox__day">${date.getDate()}</span>
      <span class="q2-datebox__dow">${DAY_SHORT[date.getDay()]}</span>
    </span>
  `;
}

/** A line of text (or a heading, with `as`) that takes focus when it appears, so a screen reader starts reading at the new step. */
export function StepFocus({ as: Tag = 'p', class: cls, testid, children }) {
  const ref = useRef(null);
  // A layout effect, so focus moves before the next key press can land somewhere else.
  useLayoutEffect(() => {
    if (ref.current) { try { ref.current.focus({ preventScroll: true }); } catch (e) { /* not focusable right now */ } }
  }, []);
  return html`<${Tag} class=${cls} tabindex="-1" data-q2-focus="true" ref=${ref} data-testid=${testid}>${children}<//>`;
}
