// js/landing/calculator.js: "What could you save charging at home?": miles slider, five visible editable assumptions, an animated illustrative result with the workings shown.
// Owner: L3 (landing page for 180 Electrical)
import { html, useEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { Button, Field, Icon, Input, cx, uid } from '../ui/index.js';
import { CALC_DEFAULTS, LITRES_PER_GALLON, estimate, fieldError, parseNumber, resolveInputs, savingWords } from './calc.js';
import { CALC, bookClick } from './content.js';
import { useTween } from './fx.js';

const SLIDER = { min: 1000, max: 25000, step: 500 };
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const num = (n) => nf.format(n);
const pounds = (n) => `£${nf.format(Math.round(n))}`;

/** Text for the boxes: the example figures as typed strings (miles with a thousands comma). */
function defaultTexts() {
  const out = {};
  for (const key of Object.keys(CALC_DEFAULTS)) out[key] = key === 'miles' ? num(CALC_DEFAULTS[key]) : String(CALC_DEFAULTS[key]);
  return out;
}

/** The "£1,097 less a year" tile for one comparison. `saving` is the rounded difference; the number glides, the label is exact. */
function Stat({ kicker, saving, testid }) {
  const words = savingWords(saving);
  const shown = useTween(words.amount);
  const tail = words.tone === 'save' ? 'less a year' : words.tone === 'more' ? 'more a year' : 'between the two, about the same a year';
  return html`
    <div class=${cx('lp-stat', `is-${words.tone}`)} data-testid=${testid} data-tone=${words.tone} data-value=${saving}>
      <p class="lp-stat__kicker">${kicker}</p>
      <p class="lp-stat__value">${words.tone === 'same' ? 'No difference' : html`<span class="lp-stat__about">About</span> ${pounds(shown)}`}</p>
      <p class="lp-stat__tail">${tail}</p>
    </div>
  `;
}

/** One cost bar: label, a bar that grows to its share of the dearest option, and the number (which glides). */
function Bar({ label, cost, max, tone, testid }) {
  const shown = useTween(cost);
  const share = max > 0 ? Math.max(0.02, Math.min(1, cost / max)) : 0.02;
  return html`
    <li class=${cx('lp-bar', `lp-bar--${tone}`)}>
      <span class="lp-bar__label">${label}</span>
      <span class="lp-bar__track" aria-hidden="true"><span class="lp-bar__fill" style=${`--w:${share.toFixed(4)}`}></span></span>
      <span class="lp-bar__value" data-testid=${testid} data-value=${cost}>${pounds(shown)}</span>
    </li>
  `;
}

export function Calculator() {
  const [texts, setTexts] = useState(defaultTexts);
  const [base] = useState(() => uid('lp-calc'));
  const errors = useMemo(() => {
    const out = {};
    for (const key of Object.keys(CALC_DEFAULTS)) { const e = fieldError(key, texts[key]); if (e) out[key] = e; }
    return out;
  }, [texts]);
  const v = resolveInputs(texts);
  const est = estimate(v);
  const set = (key, value) => setTexts((t) => ({ ...t, [key]: value }));
  const changed = Object.keys(CALC_DEFAULTS).some((k) => parseNumber(texts[k]) !== CALC_DEFAULTS[k]);

  // The screen-reader summary settles half a second after the last change, so dragging the slider is not read out number by number.
  const summary = `Estimate: charging at home about ${pounds(est.home)} a year. Public charging ${pounds(est.public)}. Petrol ${pounds(est.petrol)}.`;
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(summary), 600);
    return () => clearTimeout(t);
  }, [summary]);

  const milesText = texts.miles;
  const milesNow = errors.miles ? CALC_DEFAULTS.miles : v.miles;
  const sliderValue = Math.min(SLIDER.max, Math.max(SLIDER.min, Math.round(milesNow / SLIDER.step) * SLIDER.step));
  const pct = ((sliderValue - SLIDER.min) / (SLIDER.max - SLIDER.min)) * 100;
  const maxCost = Math.max(est.home, est.public, est.petrol);
  const homeShown = useTween(est.home);

  const kwhShown = num(est.kwh);
  const milesShown = num(v.miles);

  return html`
    <section class="lp-section lp-section--band lp-section--calc" id="savings" aria-labelledby="savings-title" data-testid="l3-calc">
      <div class="lp-container">
        <div class="lp-section__head" data-reveal="up">
          <p class="lp-eyebrow">${CALC.eyebrow}</p>
          <h2 id="savings-title" class="lp-title">${CALC.title}</h2>
          <p class="lp-lead">${CALC.lead}</p>
        </div>

        <div class="lp-calc">
          <div class="lp-calc__inputs" data-reveal="up">
            <div class="lp-calc__card lp-calc__miles">
              <div class="lp-calc__row">
                <label class="lp-calc__label" for=${`${base}-miles`}>${CALC.milesLabel}</label>
                <div class=${cx('lp-num', 'lp-num--miles', errors.miles && 'is-invalid')}>
                  <${Input} id=${`${base}-miles`} value=${milesText} type="text" inputmode="numeric" autocomplete="off" spellcheck=${false}
                    error=${errors.miles ? 'x' : ''} aria-describedby=${errors.miles ? `${base}-miles-err` : undefined}
                    onInput=${(e) => set('miles', e.target.value)}
                    onBlur=${() => { if (!errors.miles) set('miles', num(parseNumber(texts.miles))); }}
                    data-testid="l3-calc-miles" />
                  <span class="lp-num__unit" aria-hidden="true">${CALC.milesUnit}</span>
                </div>
              </div>
              ${errors.miles ? html`<p class="ui-field__error" id=${`${base}-miles-err`} role="alert"><${Icon} name="circle-alert" size=${16} /><span>${errors.miles} We are using ${num(CALC_DEFAULTS.miles)} meanwhile.</span></p>` : null}
              <div class="lp-range" style=${`--pct:${pct.toFixed(2)}%`}>
                <input class="lp-range__input" type="range" min=${SLIDER.min} max=${SLIDER.max} step=${SLIDER.step} value=${sliderValue}
                  aria-label="Miles you drive in a year, slider" aria-valuetext=${`${num(sliderValue)} miles a year`}
                  onInput=${(e) => set('miles', num(Number(e.target.value)))} data-testid="l3-calc-slider" />
                <div class="lp-range__scale" aria-hidden="true"><span>${num(SLIDER.min)}</span><span>${num(SLIDER.max)}</span></div>
              </div>
            </div>

            <div class="lp-calc__card lp-calc__assume">
              <div class="lp-calc__assume-head">
                <h3 class="lp-calc__h">${CALC.assumptionsTitle}</h3>
                <button type="button" class="lp-calc__reset" onClick=${() => setTexts(defaultTexts())} disabled=${!changed} aria-label=${CALC.resetLabel} data-testid="l3-calc-reset">
                  <${Icon} name="rotate-ccw" size=${16} />${CALC.reset}
                </button>
              </div>
              <p class="lp-calc__note">${CALC.assumptionsNote}</p>
              <div class="lp-calc__fields">
                ${CALC.fields.map((f) => {
                  const id = `${base}-${f.key}`;
                  return html`<${Field} key=${f.key} label=${f.label} id=${id} class="lp-calc__field"
                    error=${errors[f.key] ? `${errors[f.key]} Using ${CALC_DEFAULTS[f.key]} meanwhile.` : ''}>
                    <div class=${cx('lp-num', errors[f.key] && 'is-invalid')}>
                      <${Input} id=${id} value=${texts[f.key]} type="text" inputmode="decimal" autocomplete="off" spellcheck=${false}
                        onInput=${(e) => set(f.key, e.target.value)} data-testid=${`l3-calc-field-${f.key}`} />
                      <span class="lp-num__unit" aria-hidden="true">${f.unit}</span>
                    </div>
                  <//>`;
                })}
              </div>
            </div>
          </div>

          <div class="lp-calc__result" aria-labelledby=${`${base}-result`} data-reveal="up" style="--i:1" data-testid="l3-calc-result">
            <div class="lp-calc__result-top">
              <span class="lp-calc__badge" data-testid="l3-calc-badge"><${Icon} name="info" size=${16} />${CALC.badge}</span>
              <span class="lp-calc__miles-now">${milesShown} ${CALC.milesUnit}</span>
            </div>
            <h3 class="lp-calc__result-title" id=${`${base}-result`}>Charging at home could cost about</h3>
            <p class="lp-calc__big"><span data-testid="l3-calc-home-big" data-value=${est.home}>${pounds(homeShown)}</span><span class="lp-calc__per">${CALC.perYear}</span></p>

            <div class="lp-stats">
              <${Stat} kicker="Instead of public chargers" saving=${est.saveVsPublic} testid="l3-calc-save-public" />
              <${Stat} kicker="Instead of petrol" saving=${est.saveVsPetrol} testid="l3-calc-save-petrol" />
            </div>

            <ul class="lp-bars" aria-label="Estimated yearly cost">
              <${Bar} label="Home charging" cost=${est.home} max=${maxCost} tone="home" testid="l3-calc-home" />
              <${Bar} label="Petrol" cost=${est.petrol} max=${maxCost} tone="petrol" testid="l3-calc-petrol" />
              <${Bar} label="Public charging" cost=${est.public} max=${maxCost} tone="public" testid="l3-calc-public" />
            </ul>

            <div class="lp-works" data-testid="l3-calc-workings">
              <h4 class="lp-works__title">${CALC.workingsTitle}</h4>
              <dl class="lp-works__list">
                <div><dt>Electricity used = miles ÷ miles per kWh</dt><dd>${milesShown} ÷ ${num(v.milesPerKwh)} = ${kwhShown} kWh a year</dd></div>
                <div><dt>Home charging = kWh × home pence per kWh</dt><dd>${kwhShown} × ${num(v.homePence)}p = ${pounds(est.home)}</dd></div>
                <div><dt>Public charging = kWh × public pence per kWh</dt><dd>${kwhShown} × ${num(v.publicPence)}p = ${pounds(est.public)}</dd></div>
                <div><dt>Petrol = miles ÷ mpg × ${LITRES_PER_GALLON} litres a gallon × pence per litre</dt><dd>${milesShown} ÷ ${num(v.mpg)} × ${LITRES_PER_GALLON} = ${num(est.litres)} litres, × ${num(v.petrolPence)}p = ${pounds(est.petrol)}</dd></div>
              </dl>
            </div>

            <p class="lp-calc__foot">${CALC.footnote}</p>
            <div class="lp-calc__cta">
              <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta" onClick=${bookClick({})} data-testid="l3-calc-cta">${CALC.cta}<//>
              <p class="lp-calc__ctanote">${CALC.ctaNote}</p>
            </div>
            <p class="u-sr-only" aria-live="polite" aria-atomic="true">${announce}</p>
          </div>
        </div>
      </div>
    </section>
  `;
}
