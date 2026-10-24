// js/landing/sections.js: trust badges, why cards, about + brands, the "how it works" stepper, pricing, area (postcode), FAQ accordion, final CTA.
// Owner: L3 (landing page for 180 Electrical; first built by C2). No prices and no reviews anywhere on this page: he has neither.
import { html, useState } from '../vendor/preact-htm.js';
import { Button, Field, Icon, Input, cx, uid, useBrand, useStore } from '../ui/index.js';
import { isValidPostcode, normalisePostcode, postcodeZone } from '../core/format.js';
import { waLink } from '../core/messages.js';
import {
  ABOUT, AREA, CTA_LABEL, DEFAULT_BRANDS, DEFAULT_CREDENTIALS, FAQ, FINAL, IMAGES, PRICING, STEPS, TRUST_TITLE, WHATSAPP_TEXT, WHY,
  bookClick, startEnquiry
} from './content.js';
import { Photo } from './media.js';

// Stable selector function (useStore wants the same function every render).
const selectBusiness = (state) => state.settings.business;

/** The list from the store when it has one, else his verbatim default. */
const listOr = (value, fallback) => (Array.isArray(value) && value.length ? value : fallback);

/** The staggered-reveal offset of the n-th item in a group (see .lp-rv in landing.css). */
const stagger = (i) => `--i:${i}`;

/** Eyebrow + heading + optional lead, the one section-head pattern. */
export function SectionHead({ eyebrow, title, titleId, lead, level = 2, class: cls }) {
  const H = `h${level}`;
  return html`
    <div class=${cx('lp-section__head', cls)} data-reveal="up">
      ${eyebrow ? html`<p class="lp-eyebrow">${eyebrow}</p>` : null}
      <${H} id=${titleId} class="lp-title">${title}<//>
      ${lead ? html`<p class="lp-lead">${lead}</p>` : null}
    </div>
  `;
}

/* ---------------- Trust bar: his two credentials as proper badges ---------------- */

const TRUST_ICONS = ['badge-check', 'shield-check'];

export function TrustBar() {
  const business = useStore(selectBusiness);
  const credentials = listOr(business.credentials, DEFAULT_CREDENTIALS);
  return html`
    <section class="lp-trust" aria-labelledby="trust-title" data-testid="trust-bar">
      <div class="lp-container">
        <div class="lp-trust__panel" data-reveal="up">
          <h2 id="trust-title" class="lp-trust__title">${TRUST_TITLE}</h2>
          <ul class="lp-trust__list">
            ${credentials.map((c, i) => html`<li class="lp-trust__item" key=${c} data-testid=${`l3-credential-${i}`}>
              <span class="lp-seal" aria-hidden="true"><${Icon} name=${TRUST_ICONS[i % TRUST_ICONS.length]} size=${24} /></span>
              <span class="lp-trust__text">${c}</span>
            </li>`)}
          </ul>
        </div>
      </div>
    </section>
  `;
}

/* ---------------- Home charging that works around you ---------------- */

export function WhyCards() {
  return html`
    <section class="lp-section lp-section--why" id="why" aria-labelledby="why-title" data-testid="why-cards">
      <div class="lp-container">
        <${SectionHead} title=${WHY.title} titleId="why-title" />
        <ul class="lp-cards">
          ${WHY.cards.map((c, i) => html`<li class="lp-card" key=${c.title} data-reveal="up" style=${stagger(i)}>
            <span class="lp-card__icon"><${Icon} name=${c.icon} size=${26} /></span>
            <h3 class="lp-card__title">${c.title}</h3>
            <p class="lp-card__body">${c.body}</p>
          </li>`)}
        </ul>
        <div class="lp-section__cta" data-reveal="up">
          <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta" onClick=${bookClick({})} data-testid="why-cta">${CTA_LABEL}<//>
        </div>
      </div>
    </section>
  `;
}

/* ---------------- About: his two paragraphs, the brands he fits, a portrait ---------------- */

export function About() {
  const business = useStore(selectBusiness);
  const brands = listOr(business.brands, DEFAULT_BRANDS);
  return html`
    <section class="lp-section lp-section--line" id="about" aria-labelledby="about-title" data-testid="about">
      <div class="lp-container lp-about">
        <div class="lp-about__copy" data-reveal="up">
          <h2 id="about-title" class="lp-title">${ABOUT.title}</h2>
          <p class="lp-about__p">${ABOUT.p1}</p>
          <p class="lp-about__p">${ABOUT.p2}</p>
          <div class="lp-brands" data-testid="brands">
            <p class="lp-brands__label" id="brands-label">${ABOUT.brandsLabel}</p>
            <ul class="lp-brands__list" aria-labelledby="brands-label">
              ${brands.map((b) => html`<li class="lp-brands__item" key=${b}>${b}</li>`)}
            </ul>
          </div>
        </div>
        <div class="lp-about__visual" data-reveal="up" style=${stagger(1)}>
          <${Photo} img=${IMAGES.about} ratio="4 / 3" sizes="(min-width: 900px) 46vw, 100vw" widths=${[480, 800, 1200]}
            class="lp-about__photo" data-testid="about-photo">
            <span class="lp-about__tag"><${Icon} name="map-pin" size=${16} />Northern Ireland</span>
          <//>
        </div>
      </div>
    </section>
  `;
}

/* ---------------- From first enquiry to charging at home: the stepper ---------------- */

export function HowItWorks() {
  return html`
    <section class="lp-section lp-section--band" id="how" aria-labelledby="how-title" data-testid="how-it-works">
      <div class="lp-container">
        <${SectionHead} title=${STEPS.title} titleId="how-title" />
        <ol class="lp-steps" data-reveal="steps" data-testid="l3-steps">
          ${STEPS.items.map((s, i) => html`<li class="lp-step" key=${s.n} style=${stagger(i)}>
            <span class="lp-step__node" aria-hidden="true"><${Icon} name=${s.icon} size=${22} /></span>
            <div class="lp-step__card">
              <span class="lp-step__num" aria-hidden="true">${s.n}</span>
              <h3 class="lp-step__title">${s.title}</h3>
              <p class="lp-step__body">${s.body}</p>
            </div>
          </li>`)}
        </ol>
      </div>
    </section>
  `;
}

/* ---------------- Your installation, clearly quoted (no prices, on purpose) ---------------- */

const FACTORS = [
  { icon: 'plug-zap', label: 'Your charger choice' },
  { icon: 'navigation', label: 'The cable route' },
  { icon: 'wrench', label: 'Any electrical work required' }
];

export function Pricing() {
  return html`
    <section class="lp-section" id="pricing" aria-labelledby="pricing-title" data-testid="pricing">
      <div class="lp-container">
        <div class="lp-pricing" data-reveal="up">
          <div class="lp-pricing__copy">
            <h2 id="pricing-title" class="lp-title">${PRICING.title}</h2>
            <p class="lp-pricing__body">${PRICING.body}</p>
          </div>
          <ul class="lp-factors" aria-label="What a quote depends on">
            ${FACTORS.map((f, i) => html`<li class="lp-factors__item" key=${f.label} style=${stagger(i)}>
              <span class="lp-factors__icon"><${Icon} name=${f.icon} size=${22} /></span>
              <span>${f.label}</span>
            </li>`)}
          </ul>
          <div class="lp-pricing__cta">
            <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta" onClick=${bookClick({})} data-testid="pricing-cta">${CTA_LABEL}<//>
          </div>
        </div>
      </div>
    </section>
  `;
}

/* ---------------- EV charger installation in Northern Ireland: postcode check opens the funnel ---------------- */

export function AreaSection() {
  const business = useStore(selectBusiness);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [inputId] = useState(() => uid('lp-pc'));
  const pc = normalisePostcode(value);
  const valid = isValidPostcode(pc);
  const zone = valid ? postcodeZone(pc, business) : null;

  const submit = (e) => {
    e.preventDefault();
    if (!pc) { startEnquiry({}); return; }
    if (!valid) {
      setError(AREA.invalid);
      const input = e.currentTarget && e.currentTarget.querySelector ? e.currentTarget.querySelector('input') : null;
      if (input) input.focus();
      return;
    }
    setError('');
    startEnquiry({ postcode: pc });
  };

  return html`
    <section class="lp-section lp-section--line lp-section--area" id="area" aria-labelledby="area-title" data-testid="area">
      <div class="lp-container lp-area">
        <div class="lp-area__copy" data-reveal="up">
          <span class="lp-area__pin" aria-hidden="true"><span class="lp-area__ring"></span><span class="lp-area__ring"></span><${Icon} name="map-pin" size=${28} /></span>
          <h2 id="area-title" class="lp-title">${AREA.title}</h2>
          <p class="lp-area__body">${AREA.body}</p>
        </div>
        <form class="lp-area__form" onSubmit=${submit} novalidate data-testid="area-form" data-reveal="up" style=${stagger(1)}>
          <${Field} label="Your postcode" id=${inputId} hint=${AREA.note} error=${error}>
            <${Input} id=${inputId} value=${value}
              onInput=${(e) => { setValue(e.target.value); if (error) setError(''); }}
              placeholder="e.g. BT1 1AA" type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters"
              spellcheck=${false} enterkeyhint="go" maxlength="8" data-testid="coverage-input" />
          <//>
          <div class="lp-area__result" data-testid="coverage-result" aria-live="polite">
            ${zone === 'covered' ? html`<p class="lp-area__ok"><${Icon} name="circle-check" size=${20} /><span>${AREA.covered}</span></p>` : null}
            ${zone === 'outside' ? html`<p class="lp-area__warn"><${Icon} name="info" size=${20} /><span>${AREA.outside}</span></p>` : null}
          </div>
          <${Button} variant="primary" size="lg" iconRight="arrow-right" type="submit" class="lp-cta" data-testid="coverage-book">${CTA_LABEL}<//>
        </form>
      </div>
    </section>
  `;
}

/* ---------------- FAQ accordion (real buttons, aria-expanded, arrow keys) ---------------- */

export function Faq() {
  const [open, setOpen] = useState(-1);
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
    <section class="lp-section lp-section--line" id="faq" aria-labelledby="faq-title" data-testid="faq">
      <div class="lp-container lp-faqwrap">
        <${SectionHead} title=${FAQ.title} titleId="faq-title" />
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
                <div class="lp-faq__clip"><p class="lp-faq__a">${it.a}</p></div>
              </div>
            </div>`;
          })}
        </div>
      </div>
    </section>
  `;
}

/* ---------------- Final call to action ---------------- */

export function FinalCta() {
  const brand = useBrand();
  const wa = waLink(brand.phone, WHATSAPP_TEXT, brand.demoPhoneDigits);
  return html`
    <section class="lp-final-section" aria-labelledby="final-title">
      <div class="lp-container">
        <div class="lp-final" data-testid="final-cta" data-reveal="up">
          <div class="lp-final__copy">
            <h2 id="final-title" class="lp-final__line">${FINAL.title}</h2>
            <p class="lp-final__body">${FINAL.body}</p>
          </div>
          <div class="lp-final__actions">
            <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta" onClick=${bookClick({})} data-testid="final-book">${CTA_LABEL}<//>
            <p class="lp-final__call"><span>Prefer to speak to us?</span></p>
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
