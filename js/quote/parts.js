// js/quote/parts.js: the building blocks of the customer quote page (prototype strip, top bar with his logo, hero, decision card, itemised lines
// and possible extras, notes, sample terms, trust, steps, contact, the quiet footer, sticky bar).
// Owner: Q2 (customer quote page)
import { createContext, html, useContext, useLayoutEffect, useRef } from '../vendor/preact-htm.js';
import { Button, Icon, PrototypeNotice, cx, pageHref, useNow } from '../ui/index.js';
import { mailtoLink, waLink } from '../core/messages.js';
import { DAY_SHORT, MONTH_SHORT, parseDayKey } from '../core/dates.js';
import { ProtoTag, protoProps } from '../landing/idea.js';
import { QuoteLogo } from './media.js';
import { chargerName, chargerSpec, customerNotes, money, questionText, quoteDayLabel, refreshText, shownTotal, splitLines, validity } from './format.js';

/** Which way the page was opened: { link: true } for a quote read from a share link (quote.html#d=...), else this browser's own copy. Only the strip's wording reads it. */
export const QuoteModeContext = createContext({ link: false });

// What the strip's "Prototype tools" popover says about this page. Both start "This is a prototype." The business name, phone and email are his real public details.
const DISCLOSURE_STORE = "This is a prototype. The business name, phone number and email are 180 Electrical's real public details; the quote, its prices and the install days are samples. Nothing is really sent: no WhatsApp, SMS, email or payment. This quote is saved only in this browser.";
const DISCLOSURE_LINK = "This is a prototype. The business name, phone number and email are 180 Electrical's real public details; the quote and its prices are samples. The WhatsApp message you send is real, and the quote and your reply travel inside the links, so nothing is kept on a server.";

/**
 * The bar at the top of every state: HIS logo (the lockup, cropped and blended into the black panel, the same one the landing header wears),
 * who the quote is for (from 480px; for screen readers below) and one tap to call Daniel. The business name is in the link's label, so it
 * reads even when the logo picture is slow or missing. The bolt-in-a-square mark is only for the favicon and the dashboard.
 */
export function TopBar({ brand, who }) {
  return html`
    <div class="q2-top q2-wrap" data-testid="q2-header">
      <div class="q2-top__row">
        <a class="q2-brand" href=${pageHref('index.html')} aria-label=${`${brand.name} home page`} data-testid="q2-logo">
          <${QuoteLogo} name=${brand.name} images=${brand.images} decorative=${true} testid="q2-header-logo-img" class="q2-logo--header" />
          <span class="u-sr-only" data-testid="q2-brand-name">${brand.name}</span>
        </a>
        ${who ? html`<span class="q2-for" data-testid="q2-for">Quote for ${who}</span>` : null}
        <div class="q2-owner" data-testid="q2-owner">
          <a class="q2-owner__call" href=${brand.telHref} aria-label=${`Call ${brand.ownerFirst} on ${brand.phone}`} data-testid="q2-top-call"><${Icon} name="phone" size=${18} /><span>Call<span class="q2-owner__name"> <span data-testid="q2-owner-name">${brand.ownerFirst}</span></span></span></a>
        </div>
      </div>
    </div>
  `;
}

/**
 * The prototype strip above the header: the shared public strip ("Prototype tools" popover on the left, "Show: With ideas | Only my content" on
 * the right, js/ui/notice.js). Everything that is not his own content lives behind it: the disclosure, the owner login, what is real, the theme.
 */
export function ProtoStrip({ link }) {
  return html`<${PrototypeNotice} variant="strip" page="quote" disclosure=${link ? DISCLOSURE_LINK : DISCLOSURE_STORE} />`;
}

/**
 * The top of every state: the strip (a sibling of the black panel, so its popover is never clipped by it), an optional banner (the expired
 * notice), then the black panel with the top bar, greeting, the one h1 (focus target), a lead line and anything else (children).
 * `who` is the customer's first name for the "Quote for ..." line in the bar.
 */
export function Hero({ brand, eyebrow, title, lead, variant, titleTestid = 'q2-title', children, mark, who, banner }) {
  const mode = useContext(QuoteModeContext);
  return html`
    <${ProtoStrip} link=${mode.link} />
    ${banner || null}
    <header class=${cx('q2-hero', variant && `q2-hero--${variant}`)}>
      <${TopBar} brand=${brand} who=${who} />
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

/** The expired notice, full width at the very top of the page (danger treatment: orange-red outline, icon and words; never the brand red). */
export function ExpiredBanner({ d, brand }) {
  return html`
    <div class="q2-expiredbar" role="alert" data-testid="q2-expired">
      <div class="q2-wrap q2-expiredbar__inner">
        <${Icon} name="calendar-x" size=${24} />
        <p><strong>This quote has expired.</strong> It was valid until ${d.validUntilLabel}, so it can't be accepted now. ${brand.ownerFirst} can send you an updated one.</p>
      </div>
    </div>
  `;
}

/**
 * The three facts a customer checks first, on one line under the title: the quote reference, the day it was written and where the
 * charger goes in. (The customer's name is in the top bar: "Quote for Sean".)
 */
export function MetaRow({ d, postcode }) {
  const day = quoteDayLabel(d);
  return html`
    <ul class="q2-meta" aria-label="Quote details">
      <li class="q2-meta__ref"><span class="q2-meta__k">Quote</span><span class="u-mono q2-meta__v" data-testid="q2-ref">${d.quote.id}</span></li>
      ${day ? html`<li data-testid="q2-quote-date"><${Icon} name="calendar-days" size=${16} /><span class="u-sr-only">Quoted </span><strong>${day}</strong></li>` : null}
      ${postcode ? html`<li data-testid="q2-postcode"><${Icon} name="map-pin" size=${16} /><span class="u-sr-only">Installation at </span><strong>${postcode}</strong></li>` : null}
    </ul>
  `;
}

/** 'Valid until Thu 19 Nov' plus how long is left, as one chip with an icon (never colour alone). A comfortable quote gets the quiet version. */
export function ValidChip({ d, quiet }) {
  const v = validity(d);
  const icon = v.tone === 'expired' ? 'calendar-x' : v.tone === 'ok' ? 'calendar-clock' : 'hourglass';
  return html`
    <p class=${cx('q2-valid', `q2-valid--${v.tone}`, quiet && 'q2-valid--quiet')} data-testid="q2-valid">
      <${Icon} name=${icon} size=${18} />
      <span><span data-testid="q2-valid-until">${v.label}</span>${v.short ? html` <span class="q2-valid__left" data-testid="q2-days-left">· ${v.short}</span>` : null}</span>
    </p>
  `;
}

/** Scrolls to the itemised lines without touching the address bar (the address is how this page knows which quote it shows). */
function seeBreakdown(e) {
  const card = document.getElementById('q2-lines-card');
  if (!card) return;
  e.preventDefault();
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  const heading = document.getElementById('q2-lines-h');
  if (heading) { try { heading.focus({ preventScroll: true }); } catch (err) { /* not focusable right now */ } }
}

/**
 * The total and the way to say yes. On wide screens this card stays in view beside the quote. "Not for me" lives below it.
 * Simple by design: the total, the charger's name, three facts that are true of the document itself (a written quote, itemised, valid until a day),
 * then Accept. An expired quote shows no Accept: a muted total, the day it ran out, and "Ask Daniel for an updated quote" as the one primary action.
 */
export function DecisionCard({ d, brand, expired, onAccept }) {
  const ask = waLink(brand.phone, questionText(brand, d), brand.demoPhoneDigits);
  const refresh = waLink(brand.phone, refreshText(brand, d), brand.demoPhoneDigits);
  const name = chargerName(d);
  const spec = chargerSpec(d);
  const v = validity(d);
  const urgent = v.tone === 'soon' || v.tone === 'last';
  return html`
    <section class=${cx('q2-card', 'q2-decide', expired && 'is-expired')} aria-labelledby="q2-total-label" data-testid="q2-decision">
      <div class="q2-decide__top">
        <div class="q2-decide__figure">
          <p class="q2-label" id="q2-total-label">${expired ? 'Total when quoted' : 'Total'}</p>
          <p class="q2-total" data-testid="q2-total">${money(shownTotal(d))}</p>
          ${name ? html`
            <div class="q2-product" data-testid="q2-product">
              <p class="q2-product__name" data-testid="q2-brand">${name}</p>
              ${spec ? html`<p class="q2-product__spec" data-testid="q2-spec">${spec}</p>` : null}
            </div>` : null}
        </div>
        ${d.fromLink && !d.fromLink.sample ? null : html`<span class="q2-sample" title="All prices in this prototype are samples" data-proto>Sample price</span>`}
      </div>
      ${expired
    ? html`
        <p class=${cx('q2-valid', 'q2-valid--expired')} data-testid="q2-valid">
          <${Icon} name="calendar-x" size=${18} />
          <span><span data-testid="q2-valid-until">${v.label}</span> <span class="q2-valid__left" data-testid="q2-days-left">· Expired</span></span>
        </p>
        <a class="ui-link--quiet q2-seeall" href="#q2-lines-card" onClick=${seeBreakdown} data-testid="q2-see-breakdown"><span>See what was quoted</span><${Icon} name="chevron-down" size=${16} /></a>
        <div class="q2-actions">
          <${Button} variant="primary" size="lg" block icon="message-circle" href=${refresh} data-testid="q2-ask">Ask ${brand.ownerFirst} for an updated quote<//>
        </div>`
    : html`
        <ul class="q2-sum" data-testid="q2-summary" aria-label="About this quote">
          <li data-testid="q2-fixed"><${Icon} name="check" size=${16} /><span>A written quote</span></li>
          <li><${Icon} name="check" size=${16} /><span>Itemised, line by line</span></li>
          <li class=${cx('q2-sum__valid', urgent && 'is-urgent')} data-testid="q2-valid">
            <${Icon} name=${urgent ? 'hourglass' : 'check'} size=${16} />
            <span><span data-testid="q2-valid-until">${v.label}</span>${v.short ? html` <span class="q2-valid__left" data-testid="q2-days-left">· ${v.short}</span>` : null}</span>
          </li>
        </ul>
        <a class="ui-link--quiet q2-seeall" href="#q2-lines-card" onClick=${seeBreakdown} data-testid="q2-see-breakdown"><span>See full breakdown</span><${Icon} name="chevron-down" size=${16} /></a>
        <div class="q2-actions">
          <div class="q2-accept">
            <${Button} variant="primary" size="lg" block icon="check" onClick=${onAccept} data-testid="q2-accept">Accept quote<//>
            <p class="q2-nopay" data-testid="q2-nopay"><${Icon} name="info" size=${18} /><span>Accepting takes no payment. ${brand.ownerFirst} confirms your install day with you.</span></p>
          </div>
          <${Button} variant="secondary" block icon="message-circle" href=${ask} data-testid="q2-ask">Ask a question<//>
        </div>`}
      ${d.fromLink && d.fromLink.sample
    ? html`<p class="q2-protonote" data-proto data-testid="q2-sample-note"><${Icon} name="info" size=${16} /><span><strong>Prototype: sample prices.</strong> Nothing here is a real offer.</span></p>` : null}
    </section>
  `;
}

/** "Not for me": a small, grey, underlined link under the decision card, so it never competes with Accept. */
export function DeclineLink({ onDecline }) {
  return html`<p class="q2-notforme"><button type="button" class="ui-link--quiet q2-notforme__btn" onClick=${onDecline} data-testid="q2-decline">Not for me</button></p>`;
}

/** One itemised row: description, detail, quantity times price, line total. */
function LineRow({ line, extra }) {
  return html`
    <li class=${cx('q2-line', extra && 'q2-line--extra')} data-testid=${extra ? 'q2-extra' : 'q2-line'}>
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
    </li>
  `;
}

/**
 * Itemised lines: description, detail, quantity times price, line total, then the total. A line that only applies "if required" / "if needed"
 * (or is flagged optional) is NOT in the total, whatever the data says: it sits apart under "Possible extras, quoted separately".
 */
export function LinesCard({ d, heading = "What's included", compact }) {
  const { fixed, extras } = splitLines(d);
  return html`
    <section class=${cx('q2-card', 'q2-lines', compact && 'q2-lines--compact')} id=${compact ? undefined : 'q2-lines-card'} aria-labelledby="q2-lines-h" data-testid="q2-lines-card">
      <h2 class="q2-h2" id="q2-lines-h" tabindex="-1">${heading}</h2>
      <ul class="q2-lines__list" data-testid="q2-lines">
        ${fixed.map((line) => html`<${LineRow} key=${line.id} line=${line} />`)}
      </ul>
      <div class="q2-lines__sum">
        <span class="q2-lines__sumlabel">Total</span>
        <strong class="q2-lines__sumvalue" data-testid="q2-lines-total">${money(shownTotal(d))}</strong>
      </div>
      ${extras.length ? html`
        <div class="q2-extras" data-testid="q2-extras">
          <h3 class="q2-extras__h">Possible extras, quoted separately</h3>
          <p class="q2-extras__note">Not included in the total above.</p>
          <ul class="q2-lines__list" data-testid="q2-extras-list">
            ${extras.map((line) => html`<${LineRow} key=${line.id} line=${line} extra=${true} />`)}
          </ul>
        </div>` : null}
    </section>
  `;
}

/** The owner's own notes (never the old placeholder wording). Nothing at all when he wrote none: the page adds no wording of its own here. */
export function NotesCard({ d, owner = 'the installer' }) {
  const notes = customerNotes(d.quote.notes);
  if (!notes) return null;
  return html`
    <section class="q2-card q2-notes" aria-labelledby="q2-notes-h" data-testid="q2-notes-card">
      <h2 class="q2-h2" id="q2-notes-h">Notes from ${owner}</h2>
      <p class="q2-notes__text" data-testid="q2-notes">${notes}</p>
    </section>
  `;
}

/**
 * Payment and certificate wording, as an IDEA: his site states no payment terms and no guarantee, so this block is tagged (data-proto, and the
 * visible "Idea from us" tag) and vanishes under "Only my content". Minimal on purpose: Daniel sets the real terms.
 */
export function TermsCard({ brand }) {
  const rows = [
    { icon: 'wallet', title: 'Payment', text: 'Example: due when the installation is finished and tested.' },
    { icon: 'file-check', title: 'Certificate', text: 'Example: issued once the installation has been tested.' }
  ];
  return html`
    <section class="q2-card q2-terms" aria-labelledby="q2-terms-h" data-testid="q2-terms" ...${protoProps()}>
      <div class="q2-terms__head">
        <h2 class="q2-h2" id="q2-terms-h">Sample terms (${brand.ownerFirst} sets these)</h2>
        <span class="q2-terms__tag" data-testid="q2-terms-tag"><${ProtoTag} /></span>
      </div>
      <ul class="q2-facts q2-terms__list">
        ${rows.map((r) => html`<li key=${r.title}><${Icon} name=${r.icon} size=${20} /><span><strong>${r.title}.</strong> ${r.text}</span></li>`)}
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
    { title: 'Choose your install day', text: 'Pick a morning or afternoon that suits you.' },
    { title: `${brand.ownerFirst} confirms the day`, text: `${brand.ownerFirst} checks it with you by WhatsApp or phone.` },
    { title: 'Your charger is installed', text: 'On the day you agree.' }
  ];
  return html`
    <section class="q2-card q2-steps" aria-labelledby="q2-steps-h" data-testid="q2-steps">
      <h2 class="q2-h2" id="q2-steps-h">${heading}</h2>
      <ol class="q2-steps__list">
        ${list.map((s, i) => html`
          <li class=${cx('q2-step', i < done && 'is-done', done > 0 && i === done && 'is-current')} key=${i}>
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
      <p class="q2-contact__intro">${intro || `${brand.ownerFirst} is happy to go through the quote with you, by phone or on WhatsApp.`}</p>
      <div class="q2-row q2-row--even">
        <${Button} variant="secondary" size="lg" icon="phone" href=${brand.telHref} data-testid="q2-call">Call ${brand.phone}<//>
        <${Button} variant="secondary" size="lg" icon="message-circle" href=${wa} data-testid="q2-whatsapp">WhatsApp<//>
      </div>
    </section>
  `;
}

/**
 * The finished, quiet footer, like the landing's: his logo, phone, email, "Serving Northern Ireland", his credentials and a small copyright line.
 * Everything that is prototype furniture (the disclosure, the owner login, what is real, the theme) is in the strip's "Prototype tools" popover.
 */
export function Footer({ brand }) {
  const now = useNow(3600000);
  const creds = Array.isArray(brand.credentials) ? brand.credentials : [];
  return html`
    <footer class="q2-footer" data-testid="q2-footer">
      <div class="q2-wrap q2-footer__inner">
        <a class="q2-footer__logo" href=${pageHref('index.html')} aria-label=${`${brand.name} home page`} data-testid="q2-footer-logo">
          <${QuoteLogo} name=${brand.name} images=${brand.images} eager=${false} decorative=${true} />
        </a>
        <ul class="q2-footer__links" aria-label="Contact">
          <li><a href=${brand.telHref} data-testid="q2-footer-phone"><${Icon} name="phone" size=${20} /><span>${brand.phone}</span></a></li>
          <li><a href=${mailtoLink(brand.email)} data-testid="q2-footer-email"><${Icon} name="mail" size=${20} /><span>${brand.email}</span></a></li>
          <li class="q2-footer__line"><${Icon} name="map-pin" size=${20} /><span class="q2-footer__area">${brand.areaText || 'Serving Northern Ireland'}</span></li>
        </ul>
        <div class="q2-footer__base">
          ${creds.length ? html`<p class="q2-footer__creds" data-testid="q2-footer-credentials">${creds.map((c, i) => html`${i ? html`<span class="q2-footer__sep" aria-hidden="true"> · </span>` : null}<span class="q2-footer__cred" key=${c}>${c}</span>`)}</p>` : null}
          <p class="q2-footer__copy" data-testid="q2-footer-copyright">© ${now.getFullYear()} ${brand.name}</p>
        </div>
      </div>
    </footer>
  `;
}

/**
 * The accept button that follows the customer down the page on phones, once the one in the card has scrolled away.
 * It carries how long the quote is valid, not the price again: the total is already shown in the card and in the lines.
 */
export function StickyBar({ show, validLabel, onAccept }) {
  return html`
    <div class=${cx('q2-sticky', show && 'is-on')} aria-hidden=${show ? undefined : 'true'} inert=${show ? undefined : true} data-testid="q2-sticky">
      <div class="q2-sticky__inner">
        <p class="q2-sticky__total"><span>Valid until</span><strong data-testid="q2-sticky-valid">${validLabel}</strong></p>
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
