// js/landing/sections.js: why list, Meet Daniel (portrait + his words), "how it works" stepper, the quote section (his words, plus a tagged idea), area (postcode check), FAQ accordion, final CTA.
// Owner: LP2 (landing page for 180 Electrical; first built by C2). The public page says only what HIS site says, plus clearly tagged IDEAS: every block we added
// carries data-proto and a ProtoTag ("Idea from us, not on your site today"), and "Only my content" hides it. No price, spec or payment term is ever shown outside one.
// Rhythm: sections alternate between the page, a lighter band (Meet Daniel, how it works, running costs, the FAQ) and one deep-red band for the final call to action;
// layouts vary (list, portrait split, carousel, timeline, copy + idea card, form card, sticky-heading rows); headings balance; one voice, Daniel in the third person.
import { html, useState } from '../vendor/preact-htm.js';
import { Button, Field, Icon, Input, cx, pageHref, pageTarget, uid, useBrand, useStore } from '../ui/index.js';
import { isValidPostcode, normalisePostcode, postcodeZone } from '../core/format.js';
import { waLink } from '../core/messages.js';
import {
  ABOUT, AREA, CTA_LABEL, DEFAULT_BRANDS, FAQ, FINAL, IMAGES, PRICING, STEPS, WHATSAPP_TEXT, WHY,
  bookClick, fillOwner, startEnquiry
} from './content.js';
import { ProtoTag, protoProps } from './idea.js';
import { Photo } from './media.js';

// What Meet Daniel shows while (or if) his own photo cannot load: a quiet head-and-shoulders silhouette, not the charger drawing.
const PORTRAIT_FALLBACK = 'img/landing-portrait.svg';

// Stable selector functions (useStore wants the same function every render).
const selectBusiness = (state) => state.settings.business;
const selectQuotes = (state) => state.quotes;

/** The list from the store when it has one, else his verbatim default. */
const listOr = (value, fallback) => (Array.isArray(value) && value.length ? value : fallback);

/** The staggered-reveal offset of the n-th item in a group (see .lp-rv in landing.css). */
const stagger = (i) => `--i:${i}`;

/** A heading's text with its one accent phrase in the brand red (a span, so the words themselves are untouched). Used by the final call to action only. */
export function AccentText({ text, accent }) {
  const at = accent ? text.lastIndexOf(accent) : -1;
  if (at < 0) return text;
  return html`${text.slice(0, at)}<span class="lp-hl">${accent}</span>${text.slice(at + accent.length)}`;
}

/** Eyebrow + heading + optional lead (+ children, e.g. the idea tag), the one section-head pattern. The heading is plain white. `center` centres it from 768px. */
export function SectionHead({ eyebrow, title, titleId, lead, level = 2, center = false, class: cls, children }) {
  const H = `h${level}`;
  return html`
    <div class=${cx('lp-section__head', center && 'lp-section__head--center', cls)} data-reveal="up">
      ${eyebrow ? html`<p class="lp-eyebrow">${eyebrow}</p>` : null}
      <${H} id=${titleId} class="lp-title">${title}<//>
      ${lead ? html`<p class="lp-lead">${lead}</p>` : null}
      ${children}
    </div>
  `;
}

/* ---------------- Home charging that works around you: a plain numbered list, no cards ---------------- */

export function WhyCards() {
  return html`
    <section class="lp-section lp-section--why" id="why" aria-labelledby="why-title" data-testid="why-cards">
      <div class="lp-container">
        <${SectionHead} eyebrow=${WHY.eyebrow} title=${WHY.title} titleId="why-title" />
        <ol class="lp-why">
          ${WHY.cards.map((c, i) => html`<li class="lp-why__item" key=${c.title} data-reveal="up" style=${stagger(i)}>
            <span class="lp-why__n" aria-hidden="true">0${i + 1}</span>
            <h3 class="lp-why__title">${c.title}</h3>
            <p class="lp-why__body">${c.body}</p>
          </li>`)}
        </ol>
      </div>
    </section>
  `;
}

/* ---------------- Meet Daniel: his portrait (full-bleed on a phone, a card beside his words from 900px) with a line from his own words ---------------- */

export function About() {
  const business = useStore(selectBusiness);
  const brand = useBrand();
  const brands = listOr(business.brands, DEFAULT_BRANDS);
  const o = brand.ownerFirst;
  const wa = waLink(brand.phone, WHATSAPP_TEXT, brand.demoPhoneDigits);
  return html`
    <section class="lp-meet lp-section--band" id="about" aria-labelledby="about-title" data-testid="about">
      <div class="lp-meet__inner">
        <div class="lp-meet__media">
          <${Photo} img=${IMAGES.about} ratio="4 / 5" sizes="(min-width: 900px) 46vw, 100vw" widths=${[640, 1000, 1600]} fallback=${PORTRAIT_FALLBACK} class="lp-meet__photo" data-testid="about-photo">
            <span class="lp-meet__shade" aria-hidden="true"></span>
            <div class="lp-container lp-meet__over">
              <p class="lp-meet__caption" data-testid="about-caption"><${Icon} name="user" size=${16} /><span>${fillOwner(ABOUT.caption, o)}</span></p>
              <p class="lp-meet__pull" data-testid="about-pull">${ABOUT.pull}</p>
            </div>
          <//>
        </div>
        <div class="lp-container lp-meet__body">
          <div class="lp-meet__copy" data-reveal="up">
            <p class="lp-eyebrow">${ABOUT.eyebrow}</p>
            <h2 id="about-title" class="lp-title">${fillOwner(ABOUT.title, o)}</h2>
            <p class="lp-about__p" data-testid="about-body">${fillOwner(ABOUT.body, o)}</p>
            <ul class="lp-meet__ticks" data-testid="about-ticks">
              ${ABOUT.ticks.map((t) => html`<li class="lp-meet__tick" key=${t}><${Icon} name="circle-check" size=${20} /><span>${t}</span></li>`)}
            </ul>
          </div>
          <div class="lp-meet__aside" data-reveal="up" style=${stagger(1)}>
            <div class="lp-meet__actions">
              <${Button} variant="secondary" size="lg" icon="phone" href=${brand.telHref} class="lp-pill lp-solid" data-testid="about-call">Call ${o}<//>
              <${Button} variant="secondary" size="lg" icon="message-circle" href=${wa} target="_blank" rel="noopener noreferrer" class="lp-pill" data-testid="about-whatsapp">WhatsApp<//>
            </div>
            <div class="lp-brands" data-testid="brands">
              <p class="lp-brands__label" id="brands-label">${fillOwner(ABOUT.brandsLabel, o)}</p>
              <ul class="lp-brands__list" aria-labelledby="brands-label">
                ${brands.map((b) => html`<li class="lp-brands__item" key=${b}>${b}</li>`)}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

/* ---------------- From first enquiry to charging at home: the stepper ---------------- */

export function HowItWorks() {
  const brand = useBrand();
  return html`
    <section class="lp-section lp-section--band lp-section--how" id="how" aria-labelledby="how-title" data-testid="how-it-works">
      <div class="lp-container">
        <${SectionHead} eyebrow=${STEPS.eyebrow} title=${STEPS.title} titleId="how-title" center=${true} />
        <ol class="lp-steps" data-reveal="steps" data-testid="l3-steps">
          ${STEPS.items.map((s, i) => html`<li class="lp-step" key=${s.n} style=${stagger(i)}>
            <span class="lp-step__node" aria-hidden="true">${s.n}</span>
            <div class="lp-step__card">
              <h3 class="lp-step__title">${fillOwner(s.title, brand.ownerFirst)}</h3>
              <p class="lp-step__body">${fillOwner(s.body, brand.ownerFirst)}</p>
            </div>
          </li>`)}
        </ol>
      </div>
    </section>
  `;
}

/* ---------------- Your installation, clearly quoted: his words, then ONE tagged idea (an example quote to open; no figure on this page) ---------------- */

/**
 * A sample quote to open: one the owner has sent (so it is complete), with the fewest lines (the plainest one).
 * null when the store holds none; the idea card is then left out altogether (there is nothing to open).
 */
function pickSampleQuote(quotes) {
  const list = Object.values(quotes || {}).filter((q) => q && ['sent', 'viewed', 'accepted'].includes(q.status) && Array.isArray(q.lines) && q.lines.length >= 3);
  list.sort((a, b) => a.lines.length - b.lines.length || (a.id < b.id ? -1 : 1));
  return list[0] || null;
}

export function Pricing() {
  const quotes = useStore(selectQuotes);
  const brand = useBrand();
  const quote = pickSampleQuote(quotes);
  const t = PRICING.teaser;
  return html`
    <section class="lp-section lp-section--quote" id="pricing" aria-labelledby="pricing-title" data-testid="pricing">
      <div class="lp-container lp-quote">
        <div class="lp-quote__copy" data-reveal="up">
          <p class="lp-eyebrow">${PRICING.eyebrow}</p>
          <h2 id="pricing-title" class="lp-title">${PRICING.title}</h2>
          <p class="lp-quote__body">${fillOwner(PRICING.body, brand.ownerFirst)}</p>
          <p class="lp-quote__promise" data-testid="pricing-promise"><${Icon} name="file-check" size=${22} /><span>${PRICING.promise}</span></p>
        </div>
        <div class="lp-quote__cta" data-sticky-hide>
          <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta" onClick=${bookClick({})} data-testid="pricing-cta">${CTA_LABEL}<//>
        </div>
        ${quote ? html`<div class="lp-qidea lp-qcard" role="group" ...${protoProps({ 'data-testid': 'quote-preview' })} data-reveal="up" style=${stagger(1)} aria-label=${t.title}>
          <${ProtoTag} />
          <div class="lp-qidea__sheet" aria-hidden="true">
            <ul class="lp-qidea__lines">
              ${t.lines.map((name) => html`<li class="lp-qidea__line" key=${name}><span class="lp-qidea__name">${name}</span><span class="lp-qidea__bar"></span></li>`)}
            </ul>
          </div>
          <p class="lp-qidea__text">${t.body}</p>
          <div class="lp-qidea__foot">
            <${Button} variant="secondary" size="lg" iconRight="arrow-right" class="lp-pill lp-qidea__link" href=${pageHref('quote.html', '#q=' + quote.id + '&preview=1')} target=${pageTarget('quote.html')} data-testid="pricing-sample-link">${t.link}<//>
            <span class="lp-qidea__note" data-testid="quote-preview-tag">${t.note}</span>
          </div>
        </div>` : null}
      </div>
    </section>
  `;
}

/* ---------------- EV charger installation in Northern Ireland: a postcode check first, then on to the funnel ---------------- */

export function AreaSection() {
  const business = useStore(selectBusiness);
  const brand = useBrand();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(''); // the normalised postcode the visitor has just checked ('' until then)
  const [inputId] = useState(() => uid('lp-pc'));
  const pc = normalisePostcode(value);
  const valid = isValidPostcode(pc);
  // The verdict belongs to the postcode that was checked: edit the box and the button goes back to "Check my postcode".
  const done = valid && checked === pc;
  const zone = done ? postcodeZone(pc, business) : null;
  const o = brand.ownerFirst;

  const submit = (e) => {
    e.preventDefault();
    if (done) { startEnquiry({ postcode: pc }); return; }
    if (!valid) {
      setChecked('');
      setError(AREA.invalid);
      const input = e.currentTarget && e.currentTarget.querySelector ? e.currentTarget.querySelector('input') : null;
      if (input) input.focus();
      return;
    }
    setError('');
    setChecked(pc);
  };

  return html`
    <section class="lp-section lp-section--area" id="area" aria-labelledby="area-title" data-testid="area">
      <div class="lp-container lp-area">
        <div class="lp-area__copy" data-reveal="up">
          <p class="lp-eyebrow">${fillOwner(AREA.eyebrow, o)}</p>
          <h2 id="area-title" class="lp-title">${AREA.title}</h2>
          <p class="lp-area__body">${fillOwner(AREA.body, o)}</p>
        </div>
        <form class="lp-area__form" onSubmit=${submit} novalidate data-testid="area-form" data-reveal="up" style=${stagger(1)} data-sticky-hide>
          <${Field} label="Your postcode" id=${inputId} hint=${AREA.note} error=${error}>
            <${Input} id=${inputId} value=${value}
              onInput=${(e) => { setValue(e.target.value); if (error) setError(''); if (checked) setChecked(''); }}
              placeholder="e.g. BT7 3AB" type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters"
              spellcheck=${false} enterkeyhint="go" maxlength="8" data-testid="coverage-input" />
          <//>
          <div class="lp-area__result" data-testid="coverage-result" aria-live="polite">
            ${zone === 'covered' ? html`<p class="lp-area__ok"><${Icon} name="circle-check" size=${20} /><span>${AREA.covered}</span></p>` : null}
            ${zone === 'edge' ? html`<p class="lp-area__warn"><${Icon} name="info" size=${20} /><span>${fillOwner(AREA.edge, o).split('{phone}')[0]}<a class="lp-area__tel" href=${brand.telHref}>${brand.phone}</a>${fillOwner(AREA.edge, o).split('{phone}')[1]}</span></p>` : null}
            ${zone === 'outside' ? html`<p class="lp-area__warn"><${Icon} name="info" size=${20} /><span>${fillOwner(AREA.outside, o)}</span></p>` : null}
          </div>
          <${Button} variant="primary" size="lg" iconRight="arrow-right" type="submit" class="lp-cta" data-testid="coverage-book">${done ? AREA.continue(pc) : AREA.check}<//>
        </form>
      </div>
    </section>
  `;
}

/* ---------------- FAQ accordion (real buttons, aria-expanded, arrow keys); the cost question opens first ---------------- */

export function Faq() {
  const brand = useBrand();
  const [open, setOpen] = useState(() => FAQ.items.findIndex((it) => it.q === FAQ.openFirst));
  const [base] = useState(() => uid('lp-faq'));

  // Up/Down/Home/End move between the questions (the buttons stay in the normal Tab order too).
  const onKeyDown = (e) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll('.lp-faq__q'));
    const at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    let next = at;
    if (e.key === 'ArrowDown') next = (at + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else next = buttons.length - 1;
    buttons[next].focus();
  };

  return html`
    <section class="lp-section lp-section--band lp-section--faq" id="faq" aria-labelledby="faq-title" data-testid="faq">
      <div class="lp-container lp-faqwrap">
        <${SectionHead} eyebrow=${FAQ.eyebrow} title=${FAQ.title} titleId="faq-title" />
        <div class="lp-faq" onKeyDown=${onKeyDown}>
          ${FAQ.items.map((it, i) => {
            const isOpen = open === i;
            return html`<div class=${cx('lp-faq__item', isOpen && 'is-open')} key=${i} data-testid=${`faq-item-${i}`}>
              <h3 class="lp-faq__h">
                <button type="button" class="lp-faq__q" id=${`${base}-q-${i}`} aria-expanded=${isOpen ? 'true' : 'false'} aria-controls=${`${base}-a-${i}`}
                  onClick=${() => setOpen(isOpen ? -1 : i)} data-testid=${`faq-q-${i}`}>
                  <span class="lp-faq__text">${it.q}</span>
                  <span class="lp-faq__chev" aria-hidden="true"><${Icon} name="plus" size=${20} /></span>
                </button>
              </h3>
              <div class="lp-faq__panel" id=${`${base}-a-${i}`} role="region" aria-labelledby=${`${base}-q-${i}`}>
                <div class="lp-faq__clip"><p class="lp-faq__a">${fillOwner(it.a, brand.ownerFirst)}</p></div>
              </div>
            </div>`;
          })}
        </div>
      </div>
    </section>
  `;
}

/* ---------------- Final call to action: the one deep-red band (a brand moment); its button turns white so the primary action still stands out ---------------- */

export function FinalCta() {
  const brand = useBrand();
  const wa = waLink(brand.phone, WHATSAPP_TEXT, brand.demoPhoneDigits);
  return html`
    <section class="lp-final-section" aria-labelledby="final-title">
      <div class="lp-container">
        <div class="lp-final" data-testid="final-cta" data-reveal="up" data-sticky-hide>
          <div class="lp-final__copy">
            <h2 id="final-title" class="lp-final__line"><${AccentText} text=${FINAL.title} accent=${FINAL.accent} /></h2>
            <p class="lp-final__body">${fillOwner(FINAL.body, brand.ownerFirst)}</p>
          </div>
          <div class="lp-final__actions">
            <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta" onClick=${bookClick({})} data-testid="final-book">${CTA_LABEL}<//>
            <p class="lp-final__call"><span>Prefer to speak to ${brand.ownerFirst}?</span></p>
            <div class="lp-final__alt">
              <a class="lp-final__link" href=${brand.telHref} data-testid="final-call"><${Icon} name="phone" size=${20} /><span>Call <span class="u-nowrap">${brand.phone}</span></span></a>
              <a class="lp-final__link" href=${wa} target="_blank" rel="noopener noreferrer" data-testid="l3-final-whatsapp"><${Icon} name="message-circle" size=${20} /><span>WhatsApp</span></a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
