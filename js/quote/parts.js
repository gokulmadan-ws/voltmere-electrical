// js/quote/parts.js: the building blocks of the customer quote page (prototype strip, top bar with his logo, hero, decision card, itemised lines
// and possible extras, notes, sample terms, trust, steps, contact, the quiet footer, sticky bar).
// Owner: Q2 (customer quote page)
import { createContext, html, useContext, useLayoutEffect, useRef } from '../vendor/preact-htm.js';
import { Button } from '../ui/button.js';
import { Glyph } from '../landing/glyphs.js';
import { PrototypeNotice } from '../ui/notice.js';
import { cx, pageHref } from '../ui/util.js';
import { useNow } from '../ui/hooks.js';
import { mailtoLink, waLink } from '../core/messages.js';
import { DAY_SHORT, MONTH_SHORT, parseDayKey } from '../core/dates.js';
import { ProtoTag, protoProps } from '../landing/idea.js';
import { QuoteLogo } from './media.js';
import { chargerName, chargerSpec, customerNotes, money, questionText, quoteDayLabel, refreshText, shownTotal, splitLines, validity } from './format.js';

/** 'Level 3 Electrical Installation' -> { figure: 'Level 3', rest: 'Electrical Installation' } (the landing's split); a credential without a figure is the descriptor alone. */
function splitCredential(text) {
  const m = /^(Level\s+\d+|\d+[A-Za-z]?)\s+(.*)$/i.exec(String(text || '').trim());
  return m ? { figure: m[1], rest: m[2] } : { figure: '', rest: String(text || '').trim() };
}

/** Which way the page was opened: { link: true } for a quote read from a share link (quote.html#d=...), else this browser's own copy. Only the strip's wording reads it. */
export const QuoteModeContext = createContext({ link: false });

// What the strip's "Prototype tools" popover says about this page. Both start "This is a prototype." The business name, phone and email are his real public details.
const DISCLOSURE_STORE = "This is a prototype. The business name, phone number and email are 180 Electrical's real public details; the quote, its prices and the install days are samples. Nothing is really sent: no WhatsApp, SMS, email or payment. This quote is saved only in this browser.";
const DISCLOSURE_LINK = "This is a prototype. The business name, phone number and email are 180 Electrical's real public details; the quote and its prices are samples. The WhatsApp message you send is real, and the quote and your reply travel inside the links, so nothing is kept on a server.";

/**
 * The bar at the top of every state: HIS logo (the lockup, cropped and blended into the black panel, the same one the landing header wears),
 * who the quote is for (from 480px; for screen readers below) and one tap to call us. The business name is in the link's label, so it
 * reads even when the logo picture is slow or missing. The bolt-in-a-square mark is only for the favicon and the dashboard.
 */
export function TopBar({ brand, who }) {
  return html`
    <div class="q2-bar">
      <div class="q2-top q2-wrap" data-testid="q2-header">
        <div class="q2-top__row">
          <a class="q2-brand" href=${pageHref('index.html')} aria-label=${`${brand.name} home page`} data-testid="q2-logo">
            <${QuoteLogo} name=${brand.name} images=${brand.images} decorative=${true} testid="q2-header-logo-img" class="q2-logo--header" />
            <span class="u-sr-only" data-testid="q2-brand-name">${brand.name}</span>
          </a>
          ${who ? html`<span class="q2-for" data-testid="q2-for">Quote for ${who}</span>` : null}
          <div class="q2-owner" data-testid="q2-owner">
            <a class="q2-owner__call" href=${brand.telHref} aria-label=${`Call us on ${brand.phone}`} data-testid="q2-top-call"><${Glyph} name="phone" size=${20} /><span>Call <span data-testid="q2-owner-name">us</span></span></a>
          </div>
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

/**
 * The expired notice: a ruled row in ink (a 2px ink rule on its left, the key phrase in weight 600), set directly above the total inside the decision card,
 * so the black header stays the first thing on the page. Never red: the words carry it. (The day it ran out is the "Valid until" fact in the row above.)
 */
export function ExpiredBanner() {
  return html`
    <div class="q2-expiredbar" role="alert" data-testid="q2-expired">
      <p><strong>This quote has expired.</strong> It can't be accepted now, but we can send you an updated one.</p>
    </div>
  `;
}

/**
 * The four facts a customer checks first, on one ruled strip under the title: the quote reference, the day it was written, where the charger goes in
 * and how long the quote stays good. (The customer's name is in the top bar: "Quote for Sean".) "Valid until" lives here once, and in the sticky bar.
 */
export function MetaRow({ d, postcode }) {
  const day = quoteDayLabel(d);
  const v = validity(d);
  const urgent = v.tone === 'soon' || v.tone === 'last' || v.tone === 'expired';
  return html`
    <ul class="q2-meta" aria-label="Quote details">
      <li class="q2-meta__ref"><span class="q2-meta__k">Quote</span><span class="u-mono q2-meta__v" data-testid="q2-ref">${d.quote.id}</span></li>
      ${day ? html`<li data-testid="q2-quote-date"><span class="q2-meta__k">Quoted</span><strong class="q2-meta__v">${day}</strong></li>` : null}
      ${postcode ? html`<li data-testid="q2-postcode"><span class="u-sr-only">Installation </span><span class="q2-meta__k">Postcode</span><strong class="q2-meta__v">${postcode}</strong></li>` : null}
      <li class=${cx('q2-meta__valid', urgent && 'is-urgent')} data-testid="q2-fixed">
        <span class="q2-meta__k">Valid until</span>
        <span class="q2-meta__vwrap" data-testid="q2-valid">
          <strong class="q2-meta__v" data-testid="q2-valid-until">${d.validUntilLabel}</strong>
          ${v.short ? html`<span class="q2-meta__note" data-testid="q2-days-left">${v.short}</span>` : null}
        </span>
      </li>
    </ul>
  `;
}

/** 'Valid until Thu 19 Nov' plus how long is left, as one line (never colour alone). A comfortable quote gets the quiet version. */
export function ValidChip({ d, quiet }) {
  const v = validity(d);
  return html`
    <p class=${cx('q2-valid', `q2-valid--${v.tone}`, quiet && 'q2-valid--quiet')} data-testid="q2-valid">
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
 * Simple by design: the total, the charger's name, a jump to the itemised table, then the red button. The button says "Choose install day" because that
 * is all it does (it opens the day picker; nothing is accepted until the last step of the sheet). An expired quote shows no such button: the expired
 * row above a muted total, and "Ask us for an updated quote" as the one primary action. "Valid until" is a fact in the row under the title, not repeated here.
 */
export function DecisionCard({ d, brand, expired, onAccept }) {
  const ask = waLink(brand.phone, questionText(brand, d), brand.demoPhoneDigits);
  const refresh = waLink(brand.phone, refreshText(brand, d), brand.demoPhoneDigits);
  const name = chargerName(d);
  const spec = chargerSpec(d);
  return html`
    <section class=${cx('q2-card', 'q2-decide', expired && 'is-expired')} aria-labelledby="q2-total-label" data-testid="q2-decision">
      ${expired ? html`<${ExpiredBanner} d=${d} brand=${brand} />` : null}
      <div class="q2-decide__figure">
        <p class="q2-label" id="q2-total-label">${expired ? 'Total when quoted' : 'Total'}</p>
        <p class="q2-total" data-testid="q2-total">${money(shownTotal(d))}</p>
        ${name ? html`
          <div class="q2-product" data-testid="q2-product">
            <p class="q2-product__name" data-testid="q2-brand">${name}</p>
            ${spec ? html`<p class="q2-product__spec" data-testid="q2-spec">${spec}</p>` : null}
          </div>` : null}
      </div>
      ${d.fromLink && !d.fromLink.sample ? null : html`<p class="q2-sample" title="All prices in this prototype are samples" data-proto data-testid="q2-sample"><i class="ui-idea-tag__d" aria-hidden="true"></i><span>Sample price</span></p>`}
      <a class="lp-link q2-seeall" href="#q2-lines-card" onClick=${seeBreakdown} data-testid="q2-see-breakdown"><span>${expired ? 'See what was quoted' : 'See full breakdown'}</span><${Glyph} name="arrow" size=${16} /></a>
      ${expired
    ? html`
        <div class="q2-actions">
          <${Button} variant="primary" size="lg" block icon="message-circle" href=${refresh} data-testid="q2-ask">Ask us for an updated quote<//>
        </div>`
    : html`
        <div class="q2-actions">
          <div class="q2-accept">
            <${Button} variant="primary" size="lg" block icon="check" onClick=${onAccept} data-testid="q2-accept">Choose install day<//>
            <p class="q2-nopay" data-testid="q2-nopay"><span>Accepting takes no payment. We confirm your install day with you.</span></p>
          </div>
          <${Button} variant="secondary" block icon="message-circle" href=${ask} data-testid="q2-ask">Ask a question<//>
        </div>`}
      ${d.fromLink && d.fromLink.sample
    ? html`<p class="q2-protonote" data-proto data-testid="q2-sample-note"><span><strong>Prototype: sample prices.</strong> Nothing here is a real offer.</span></p>` : null}
    </section>
  `;
}

/** "Not for me": a small, grey, underlined link under the decision card, so it never competes with Accept. */
export function DeclineLink({ onDecline }) {
  return html`<p class="q2-notforme"><button type="button" class="lp-link lp-link--quiet q2-notforme__btn" onClick=${onDecline} data-testid="q2-decline">Not for me</button></p>`;
}

/** One itemised row of the ruled table: its number, the description and detail, the line total (and quantity times price) right-aligned in tabular figures. */
function LineRow({ line, extra, n }) {
  return html`
    <li class=${cx('q2-line', extra && 'q2-line--extra')} data-testid=${extra ? 'q2-extra' : 'q2-line'}>
      <span class="q2-line__n" aria-hidden="true">${String(n).padStart(2, '0')}</span>
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

/** The table's header row (label voice, decorative: the list below is the content). */
function LinesHead() {
  return html`<div class="q2-lines__head" aria-hidden="true"><span>No.</span><span>Line</span><span>Amount</span></div>`;
}

/**
 * Itemised lines as a ruled table: number, description, detail, quantity times price, line total, then the total. A line that only applies "if required" / "if needed"
 * (or is flagged optional) is NOT in the total, whatever the data says: it sits apart under "Possible extras, quoted separately".
 */
export function LinesCard({ d, heading = "What's included", compact }) {
  const { fixed, extras } = splitLines(d);
  return html`
    <section class=${cx('q2-card', 'q2-lines', compact && 'q2-lines--compact')} id=${compact ? undefined : 'q2-lines-card'} aria-labelledby="q2-lines-h" data-testid="q2-lines-card">
      <h2 class="q2-h2 q2-h2--display" id="q2-lines-h" tabindex="-1">${heading}</h2>
      <${LinesHead} />
      <ul class="q2-lines__list" data-testid="q2-lines">
        ${fixed.map((line, i) => html`<${LineRow} key=${line.id} line=${line} n=${i + 1} />`)}
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
            ${extras.map((line, i) => html`<${LineRow} key=${line.id} line=${line} extra=${true} n=${fixed.length + i + 1} />`)}
          </ul>
        </div>` : null}
    </section>
  `;
}

/** The owner's own notes (never the old placeholder wording), in our voice ("Notes from us"). Nothing at all when he wrote none: the page adds no wording of its own here. */
export function NotesCard({ d, owner = 'the installer' }) {
  const notes = customerNotes(d.quote.notes);
  if (!notes) return null;
  return html`
    <section class="q2-card q2-notes" aria-labelledby="q2-notes-h" data-testid="q2-notes-card">
      <h2 class="q2-h2" id="q2-notes-h">Notes from us</h2>
      <p class="q2-notes__text" data-testid="q2-notes">${notes}</p>
    </section>
  `;
}

/**
 * Payment and certificate wording, as an IDEA: his site states no payment terms and no guarantee, so this block is tagged (the dashed rule, data-proto and the
 * visible "Idea from us" tag, which are what say "sample") and vanishes under "Only my content". Minimal on purpose: the owner sets the real terms.
 */
export function TermsCard({ brand }) {
  const rows = [
    { title: 'Payment', text: 'Due when the installation is finished and tested.' },
    { title: 'Certificate', text: 'Issued once the installation has been tested.' }
  ];
  return html`
    <section class="q2-card q2-terms" aria-labelledby="q2-terms-h" data-testid="q2-terms" ...${protoProps()}>
      <div class="q2-terms__head">
        <span class="q2-terms__tag" data-testid="q2-terms-tag"><${ProtoTag} /></span>
        <h2 class="q2-h2" id="q2-terms-h">Terms</h2>
      </div>
      <ul class="q2-facts q2-terms__list">
        ${rows.map((r) => html`<li key=${r.title}><span><strong>${r.title}.</strong> ${r.text}</span></li>`)}
      </ul>
    </section>
  `;
}

/** The two credentials from his site, as typography (the landing's spec strip): the figure in the logo voice, the descriptor beside it. No badge, no icon. */
export function TrustCard({ brand }) {
  const list = Array.isArray(brand.credentials) ? brand.credentials : [];
  if (!list.length) return null;
  return html`
    <section class="q2-card q2-trust" aria-labelledby="q2-trust-h" data-testid="q2-trust">
      <h2 class="q2-label q2-trust__k" id="q2-trust-h">Accredited and qualified</h2>
      <ul class="q2-badges" data-testid="q2-credentials">
        ${list.map((c) => {
    const parts = splitCredential(c);
    return html`<li class="q2-badge" key=${c}>${parts.figure ? html`<span class="q2-badge__fig lp-logovoice">${parts.figure}</span>${' '}` : null}<span class="q2-badge__text">${parts.rest}</span></li>`;
  })}
      </ul>
    </section>
  `;
}

/** Three plain steps. `done` marks the first one(s) as already happened. */
export function StepsCard({ brand, heading = 'What happens next', steps, done = 0 }) {
  const list = steps || [
    { title: 'Choose your install day', text: 'Pick a morning or afternoon that suits you.' },
    { title: 'We confirm the day', text: 'We check it with you by WhatsApp or phone.' },
    { title: 'Your charger is installed', text: 'On the day you agree.' }
  ];
  return html`
    <section class="q2-card q2-steps" aria-labelledby="q2-steps-h" data-testid="q2-steps">
      <h2 class="q2-h2" id="q2-steps-h">${heading}</h2>
      <ol class="q2-steps__list">
        ${list.map((s, i) => html`
          <li class=${cx('q2-step', i < done && 'is-done', done > 0 && i === done && 'is-current')} key=${i}>
            <span class="q2-step__num lp-logovoice" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
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
      <p class="q2-contact__intro">${intro || 'We are happy to go through the quote with you, by phone or on WhatsApp.'}</p>
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
  return html`
    <footer class="q2-footer" data-testid="q2-footer">
      <div class="q2-wrap q2-footer__inner">
        <a class="q2-footer__logo" href=${pageHref('index.html')} aria-label=${`${brand.name} home page`} data-testid="q2-footer-logo">
          <${QuoteLogo} name=${brand.name} images=${brand.images} eager=${false} decorative=${true} />
        </a>
        <dl class="q2-footer__list" aria-label="Contact">
          <div><dt>Phone</dt><dd class="q2-footer__phone"><a href=${brand.telHref} data-testid="q2-footer-phone">${brand.phone}</a></dd></div>
          <div><dt>Email</dt><dd><a href=${mailtoLink(brand.email)} data-testid="q2-footer-email">${brand.email}</a></dd></div>
          <div><dt>Area</dt><dd class="q2-footer__area">${brand.areaText || 'Serving Northern Ireland'}</dd></div>
        </dl>
        <p class="q2-footer__legal q2-footer__copy" data-testid="q2-footer-copyright">© ${now.getFullYear()} ${brand.name}</p>
      </div>
    </footer>
  `;
}

/**
 * The red button that follows the customer down the page on phones, once the one in the card has scrolled away ("Choose install day": it opens the picker).
 * It carries how long the quote is valid, not the price again: the total is already shown in the card and in the lines.
 */
export function StickyBar({ show, validLabel, onAccept }) {
  return html`
    <aside class=${cx('q2-sticky', show && 'is-on')} aria-label="Choose your install day" aria-hidden=${show ? undefined : 'true'} inert=${show ? undefined : true} data-testid="q2-sticky">
      <div class="q2-sticky__inner">
        <p class="q2-sticky__total"><span>Valid until</span><strong data-testid="q2-sticky-valid">${validLabel}</strong></p>
        <${Button} variant="primary" icon="check" onClick=${onAccept} tabindex=${show ? undefined : -1} data-testid="q2-accept-sticky">Choose install day<//>
      </div>
    </aside>
  `;
}

/** A slim bar for the owner who opened the link from the dashboard. */
export function PreviewStrip() {
  return html`
    <div class="q2-preview" role="note" data-testid="q2-preview">
      <div class="q2-wrap q2-preview__inner"><p><strong>Preview.</strong> This is what your customer sees. This visit is not counted as a view, but accepting or declining here really changes the quote.</p></div>
    </div>
  `;
}

/** A little calendar leaf: month, day number, weekday. Decorative (the date is always written out beside it). */
export function DateBox({ dayKey }) {
  const date = parseDayKey(dayKey);
  return html`
    <span class="q2-datebox" aria-hidden="true">
      <span class="q2-datebox__mon">${MONTH_SHORT[date.getMonth()]}</span>
      <span class="q2-datebox__day lp-logovoice">${date.getDate()}</span>
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

/**
 * The head of every quote sheet, in the funnel's chrome: a black bar with his logo and "Close" as an underlined word (never an X), then on the paper an optional
 * "Step N of 2" in the label voice and the sheet's title in the display voice. It is the Sheet's `header`, which replaces the default title row; the sheet's own
 * visually hidden h2 stays the dialog's name, so the title shown here is for the eye only. Two sheets in a row (day, then check and accept) wear exactly this.
 */
export function SheetBar({ brand, title, step, onClose }) {
  return html`
    <div class="q2-sheetbar">
      <div class="q2-sheetbar__bar">
        <span class="q2-sheetbar__logo" aria-hidden="true"><${QuoteLogo} name=${brand.name} images=${brand.images} decorative=${true} testid="q2-sheet-logo-img" class="q2-logo--header" /></span>
        <button type="button" class="q2-sheetbar__close" onClick=${onClose} data-testid="sheet-close"><span>Close</span></button>
      </div>
      <div class="q2-sheetbar__head">
        ${step ? html`<p class="q2-label q2-sheetbar__step" data-testid="q2-sheet-step">${step}</p>` : null}
        <p class="q2-sheetbar__title" aria-hidden="true" data-testid="q2-sheet-title">${title}</p>
      </div>
    </div>
  `;
}
