// js/landing/sections.js: L4 to L11: trust bar, emergency strip, services and prices, how it works, reviews, Dan and coverage, FAQ, final CTA.
// Owner: WP3
import { html, useMemo, useState } from '../vendor/preact-htm.js';
import { Avatar, Button, Chip, Field, Icon, Input, SampleTag, useBrand, useNow, useStore } from '../ui/index.js';
import { nextFreeSlot } from '../core/availability.js';
import { PROMISES } from '../core/config.js';
import { gbp, normalisePostcode, postcodeZone } from '../core/format.js';
import { waLink } from '../core/messages.js';
import { selectService, selectServices, servicePriceLabel } from '../core/selectors.js';
import {
  bookClick, faqItems, howSteps, QUALIFICATIONS, RATING, REVIEWS, SERVICE_ICONS, TRUST_ITEMS, VARIANT_SHORT, waBookText
} from './content.js';

const selectAll = (state) => state;
const selectListed = (state) => selectServices(state).filter((s) => s.id !== 'emergency');
const selectTakingEmergencies = (state) => state.settings.takingEmergencies;
const selectEmergencyService = (state) => selectService(state, 'emergency');

/* ---------------- L4 Trust bar ---------------- */

export function TrustBar() {
  const brand = useBrand();
  return html`
    <section class="lp-trust" aria-labelledby="trust-title" data-testid="trust-bar">
      <div class="lp-container">
        <h2 id="trust-title" class="u-sr-only">Why customers choose us</h2>
        <ul class="lp-trust__list">
          ${TRUST_ITEMS.map((t) => html`<li class="lp-trust__item" key=${t.icon}>
            <span class="lp-trust__icon"><${Icon} name=${t.icon} size=${24} /></span>
            <span class="lp-trust__text">
              <strong class="lp-trust__title">${t.title}</strong>
              <span class="lp-trust__sub">${t.sub}</span>
              ${t.sample ? html`<span><${SampleTag} /></span>` : null}
            </span>
          </li>`)}
        </ul>
        <p class="lp-trust__scheme">${brand.schemeLine}</p>
      </div>
    </section>
  `;
}

/* ---------------- L5 Emergency strip ---------------- */

export function EmergencyStrip() {
  const brand = useBrand();
  const taking = useStore(selectTakingEmergencies);
  const emergency = useStore(selectEmergencyService);
  const o = brand.ownerFirst;
  const from = gbp(emergency ? emergency.price : PROMISES.emergencyFrom);
  const hours = PROMISES.emergencyArrivalHours;
  return html`
    <section class="lp-emergency-section" aria-label="Emergency advice">
      <div class="lp-container">
        <details class="lp-emergency" data-testid="emergency-strip">
          <summary class="lp-emergency__summary" data-testid="emergency-toggle">
            <span class="lp-emergency__icon"><${Icon} name="siren" size=${24} /></span>
            <span class="lp-emergency__head">
              <strong class="lp-emergency__title">Emergency? Fire or shock: call 999.</strong>
              <span class="lp-emergency__hint">Tap for what to do next</span>
            </span>
            <${Icon} name="chevron-down" size=${22} class="lp-emergency__chev" />
          </summary>
          <div class="lp-emergency__body">
            <ol class="lp-emergency__steps">
              <li>Fire, or someone has had a shock: call 999.</li>
              <li>If it is safe, switch off at the fuse box (consumer unit).</li>
              <li>Do not touch anything wet, scorched or sparking.</li>
            </ol>
            <div class="lp-emergency__actions">
              <${Button} variant="emergency" size="lg" block icon="phone" href=${brand.telHref} data-testid="emergency-call">Call ${o} now · <span class="u-nowrap">${brand.phone}</span><//>
              ${taking
                ? html`<${Button} variant="secondary" size="lg" block onClick=${bookClick({ emergency: true })} data-testid="emergency-request">Request an emergency visit<//>`
                : null}
            </div>
            <p class="lp-emergency__note">${taking
              ? `Emergency visits ${PROMISES.emergencyHoursText}. From ${from} including the first hour. ${o} aims to be with you within ${hours} ${hours === 1 ? 'hour' : 'hours'}.`
              : `Not taking emergency visits right now. Call 999 for fire or shock, or ${PROMISES.powerCutNumber} for a power cut.`}</p>
          </div>
        </details>
      </div>
    </section>
  `;
}

/* ---------------- L6 Services and prices ---------------- */

function ServiceCard({ service }) {
  const mini = service.id === 'eicr' && Array.isArray(service.variants) && service.variants.length
    ? service.variants : [];
  return html`
    <button type="button" class="lp-service" data-testid=${`service-card-${service.id}`} onClick=${bookClick({ serviceId: service.id })}>
      <span class="lp-service__icon"><${Icon} name=${service.icon || SERVICE_ICONS[service.id] || 'zap'} size=${24} /></span>
      <span class="lp-service__body">
        <span class="lp-service__head">
          <span class="lp-service__name">${service.name}</span>
          <span class="lp-service__price">${servicePriceLabel(service)}</span>
        </span>
        <span class="lp-service__desc">${service.description}</span>
        ${service.priceNote ? html`<span class="lp-service__note">${service.priceNote}</span>` : null}
        ${mini.length ? html`<span class="lp-service__mini">${mini.map((v) => html`<${Chip} key=${v.id} class="lp-service__minichip">${VARIANT_SHORT[v.id] || v.label} ${gbp(v.price)}<//>`)}</span>` : null}
        <span class="lp-service__meta">
          ${service.durationLabel ? html`<${Chip} icon="clock">${service.durationLabel}<//>` : null}
          ${service.tag ? html`<${Chip} tone="accent">${service.tag}<//>` : null}
        </span>
      </span>
    </button>
  `;
}

export function Services() {
  const brand = useBrand();
  const services = useStore(selectListed);
  const o = brand.ownerFirst;
  return html`
    <section class="lp-section" id="services" aria-labelledby="services-title">
      <div class="lp-container">
        <div class="lp-section__head">
          <h2 id="services-title">Clear prices, agreed before we start</h2>
          <p class="lp-section__sub">"From" prices are for standard jobs. If something bigger turns up, ${o} quotes in writing before any extra work.</p>
        </div>
        ${services.length
          ? html`<ul class="lp-services" data-testid="services-list">
              ${services.map((s) => html`<li key=${s.id}><${ServiceCard} service=${s} /></li>`)}
            </ul>`
          : html`<div class="lp-services-empty" data-testid="services-list">
              <p>No services are on offer right now. Call ${o}.</p>
              <${Button} variant="primary" icon="phone" href=${brand.telHref}>Call ${o}<//>
            </div>`}
        <p class="lp-foot">Prices include standard materials and certification. No call-out fee on booked visits. Sample prices.</p>
      </div>
    </section>
  `;
}

/* ---------------- L7 How it works ---------------- */

export function HowItWorks() {
  const brand = useBrand();
  const steps = howSteps(brand);
  return html`
    <section class="lp-section lp-section--sand" id="how" aria-labelledby="how-title" data-testid="how-it-works">
      <div class="lp-container">
        <div class="lp-section__head"><h2 id="how-title">Booked in a minute, sorted in a visit</h2></div>
        <ol class="lp-steps">
          ${steps.map((s, i) => html`<li class="lp-step" key=${i}>
            <span class="lp-step__num" aria-hidden="true">${i + 1}</span>
            <div class="lp-step__text">
              <h3 class="lp-step__title">${s.title}</h3>
              <p>${s.body}</p>
            </div>
          </li>`)}
        </ol>
        <p class="lp-steps__close"><${Icon} name="calendar-check" size=${20} /><span>Free to change or cancel up to ${PROMISES.freeChangeHours} hours before.</span></p>
      </div>
    </section>
  `;
}

/* ---------------- L8 Reviews (sample) ---------------- */

function Stars({ size = 18 }) {
  return html`<span class="lp-stars" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => html`<${Icon} key=${i} name="star" size=${size} fill="currentColor" />`)}</span>`;
}

export function Reviews() {
  return html`
    <section class="lp-section" id="reviews" aria-labelledby="reviews-title" data-testid="reviews">
      <div class="lp-container">
        <div class="lp-section__head">
          <h2 id="reviews-title">What customers say</h2>
          <div class="lp-reviews__summary">
            <${Chip} tone="accent" class="lp-reviews__chip" data-testid="reviews-sample-chip">SAMPLE REVIEWS, not real customers<//>
            <p class="lp-reviews__rating"><${Stars} size=${20} /><span>${RATING.score} out of ${RATING.outOf} from ${RATING.count} reviews (sample)</span></p>
          </div>
        </div>
        <ul class="lp-reviews">
          ${REVIEWS.map((r) => html`<li class="lp-review" key=${r.name}>
            <${Stars} />
            <span class="u-sr-only">5 out of 5</span>
            <blockquote class="lp-review__quote">${r.quote}</blockquote>
            <div class="lp-review__by">
              <${Avatar} name=${r.name} size=${40} />
              <div class="lp-review__who"><strong>${r.who}</strong><span>${r.job}</span></div>
            </div>
            <span class="lp-review__tag">Sample review · ${r.town}</span>
          </li>`)}
        </ul>
      </div>
    </section>
  `;
}

/* ---------------- L9 Meet Dan and coverage ---------------- */

function DanCard() {
  const brand = useBrand();
  const o = brand.ownerFirst;
  return html`
    <article class="lp-dan ui-card" data-testid="dan-card">
      <img class="lp-dan__avatar" src="img/dan-avatar.svg" alt="" width="72" height="72" />
      <h3 class="lp-dan__title">Hi, I'm ${o}.</h3>
      <p>Fourteen years an electrician, mostly in and around ${brand.areaName}. It's just me and my apprentice Sam, so when you book, I'm the one who turns up. Part P registered, 18th Edition qualified, fully insured (all sample).</p>
      <p class="lp-dan__qual">Qualifications <${SampleTag} /></p>
      <ul class="lp-dan__chips">${QUALIFICATIONS.map((q) => html`<li key=${q}><${Chip}>${q}<//></li>`)}</ul>
    </article>
  `;
}

function CoverageResult({ zone, brand }) {
  if (!zone) return null;
  const o = brand.ownerFirst;
  const wa = waLink(brand.phone, waBookText(brand), brand.demoPhoneDigits);
  if (zone === 'invalid') {
    return html`<div class="lp-cov__result lp-cov__result--neutral"><${Icon} name="circle-alert" size=${22} /><p>Enter a UK postcode, like MB3 4QP.</p></div>`;
  }
  if (zone === 'covered' || zone === 'edge') {
    const ok = zone === 'covered';
    return html`
      <div class=${'lp-cov__result ' + (ok ? 'lp-cov__result--ok' : 'lp-cov__result--warn')}>
        <${Icon} name=${ok ? 'circle-check' : 'triangle-alert'} size=${22} />
        <p>${ok
          ? "Yes, you're in my patch. Usually about 20 minutes away."
          : `At the edge of my area. You can still book; ${o} will confirm any travel charge by message.`}</p>
      </div>
      <${Button} variant="primary" block icon="calendar" onClick=${bookClick({})} data-testid="coverage-book">Book a visit<//>
    `;
  }
  return html`
    <div class="lp-cov__result lp-cov__result--neutral"><${Icon} name="info" size=${22} /><p>Sorry, that's a bit far for me. Call or message me and I can usually recommend someone.</p></div>
    <div class="lp-cov__buttons">
      <${Button} variant="secondary" icon="phone" href=${brand.telHref}>Call ${o}<//>
      <${Button} variant="secondary" icon="message-circle" href=${wa}>WhatsApp<//>
    </div>
  `;
}

function Coverage() {
  const brand = useBrand();
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(null); // the text that was checked; the zone is derived so a rebrand updates it
  const zone = checked === null ? null : postcodeZone(checked, brand);
  const submit = (e) => {
    e.preventDefault();
    const pc = normalisePostcode(value);
    setValue(pc);
    setChecked(pc);
  };
  return html`
    <div class="lp-cov ui-card">
      <h3 class="lp-cov__title">Do I cover your postcode?</h3>
      <form class="lp-cov__form" onSubmit=${submit} novalidate>
        <${Field} label="Your postcode" id="coverage-input" class="lp-cov__field">
          <${Input} id="coverage-input" value=${value} onInput=${(e) => setValue(e.target.value)} placeholder="e.g. MB3 4QP"
            type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters" spellcheck=${false}
            enterkeyhint="next" maxlength="8" data-testid="coverage-input" />
        <//>
        <${Button} variant="primary" size="lg" type="submit" class="lp-cov__check" data-testid="coverage-check">Check<//>
      </form>
      <div class="lp-cov__out" data-testid="coverage-result" aria-live="polite"><${CoverageResult} zone=${zone} brand=${brand} /></div>
      <ul class="lp-cov__towns" aria-label="Towns covered">
        ${brand.towns.map((t) => html`<li key=${t}><${Chip}>${t}<//></li>`)}
      </ul>
      <p class="lp-cov__caption">(fictional)</p>
      <p class="lp-cov__hours">${brand.hoursText}. Emergencies ${PROMISES.emergencyHoursText}.</p>
    </div>
  `;
}

export function AreaSection() {
  const brand = useBrand();
  return html`
    <section class="lp-section lp-section--sand" id="area" aria-labelledby="area-title">
      <div class="lp-container">
        <div class="lp-section__head"><h2 id="area-title">Meet ${brand.ownerFirst}, then check your postcode</h2></div>
        <div class="lp-area">
          <${DanCard} />
          <${Coverage} />
        </div>
      </div>
    </section>
  `;
}

/* ---------------- L10 FAQ ---------------- */

export function Faq() {
  const brand = useBrand();
  const items = faqItems(brand);
  return html`
    <section class="lp-section" id="faq" aria-labelledby="faq-title" data-testid="faq">
      <div class="lp-container">
        <div class="lp-section__head"><h2 id="faq-title">Quick answers</h2></div>
        <div class="lp-faq">
          ${items.map((it, i) => html`<details class="lp-faq__item" key=${i} data-testid=${`faq-item-${i}`}>
            <summary class="lp-faq__q"><span>${it.q}</span><${Icon} name="chevron-down" size=${22} class="lp-faq__chev" /></summary>
            <p class="lp-faq__a">${it.a}</p>
          </details>`)}
        </div>
      </div>
    </section>
  `;
}

/* ---------------- L11 Final call to action ---------------- */

export function FinalCta() {
  const brand = useBrand();
  const state = useStore(selectAll);
  const nowDate = useNow(60000);
  const minute = Math.floor(nowDate.getTime() / 60000);
  const slot = useMemo(() => nextFreeSlot(state, 'fault', { now: nowDate }), [state, minute]);
  const o = brand.ownerFirst;
  const wa = waLink(brand.phone, waBookText(brand), brand.demoPhoneDigits);
  return html`
    <section class="lp-final-section" aria-labelledby="final-title">
      <div class="lp-container">
        <div class="lp-final" data-testid="final-cta">
          <h2 id="final-title" class="lp-final__line">${slot ? `Your next free repair visit is ${slot.human}.` : `Diary full for now. Call ${o}.`}</h2>
          <div class="lp-final__actions">
            <${Button} variant="primary" size="lg" block onClick=${bookClick({})} data-testid="final-book">Book a visit<//>
            <div class="lp-final__secondary">
              <${Button} variant="secondary" icon="phone" href=${brand.telHref}>Call ${o}<//>
              <${Button} variant="secondary" icon="message-circle" href=${wa}>WhatsApp<//>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
