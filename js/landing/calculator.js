// js/landing/calculator.js: "What would home charging cost you?": a prototype IDEA from us (data-proto + the idea tag; "Only my content" hides it).
// ONE card: miles (a box and a slider), then the answer right under it, then the example rates and the working, ALL IN VIEW (no hidden accordions).
// The answer's first line is the home-charging cost; the petrol and public-charging comparison comes second. Plain words, no raw maths.
// Owner: LP2 (landing page for 180 Electrical)
import { html, useEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { Field, Icon, Input, cx, uid } from '../ui/index.js';
import { CALC_DEFAULTS, estimate, fieldError, parseNumber, resolveInputs, savingWords } from './calc.js';
import { CALC } from './content.js';
import { useTween } from './fx.js';
import { ProtoTag, protoProps } from './idea.js';
import { SectionHead } from './sections.js';

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

/** One cost bar: label, a bar that grows to its share of the dearest option, and the number (which glides). Ink, never red: red is for actions. */
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
  const summary = `Estimate: home charging would cost about ${pounds(est.home)} a year. Petrol ${pounds(est.petrol)}. Public charging ${pounds(est.public)}.`;
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
  const petrol = savingWords(est.saveVsPetrol);
  const petrolShown = useTween(petrol.amount);

  const kwhShown = num(est.kwh);
  const milesShown = num(v.miles);
  // The comparison, in one plain sentence. The difference is a number that glides; its words follow the sign.
  const diff = html`<span class="lp-calc__diff" data-testid="l3-calc-saving-big" data-value=${est.saveVsPetrol}>${pounds(petrolShown)}</span>`;
  const compare = petrol.tone === 'save'
    ? html`The same miles in a petrol car would cost about <strong>${pounds(est.petrol)}</strong> a year, which is about ${diff} more.`
    : petrol.tone === 'more'
      ? html`The same miles in a petrol car would cost about <strong>${pounds(est.petrol)}</strong> a year, which is about ${diff} less.`
      : html`The same miles in a petrol car would cost about <strong>${pounds(est.petrol)}</strong> a year, about the same.`;
  // The workings, in plain sentences (no raw maths, no conversion constants).
  const workings = `Your ${milesShown} miles use about ${kwhShown} kWh a year, which is ${pounds(est.home)} at ${num(v.homePence)}p a kWh. A petrol car doing ${num(v.mpg)} mpg would use about ${num(est.litres)} litres, which is ${pounds(est.petrol)} at ${num(v.petrolPence)}p a litre. At a public charger, ${num(v.publicPence)}p a kWh would come to ${pounds(est.public)}.`;

  return html`
    <section class="lp-section lp-section--band lp-section--calc" id="savings" aria-labelledby="savings-title" ...${protoProps({ 'data-testid': 'l3-calc' })}>
      <div class="lp-container">
        <${SectionHead} eyebrow=${CALC.eyebrow} title=${CALC.title} titleId="savings-title" lead=${CALC.lead}>
          <${ProtoTag} />
        <//>

        <div class="lp-calc" data-reveal="up">
          <div class="lp-calc__miles">
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

          <div class="lp-calc__result" aria-labelledby=${`${base}-result`} data-testid="l3-calc-result">
            <span class="lp-calc__badge" data-testid="l3-calc-badge"><${Icon} name="info" size=${16} />${CALC.badge}</span>
            <h3 class="u-sr-only" id=${`${base}-result`}>Your estimate</h3>
            <p class="lp-calc__big" data-testid="l3-calc-headline">
              <span class="lp-calc__lead">${CALC.headLead}</span>${' '}
              <span class="lp-calc__figure"><span class="lp-calc__num" data-testid="l3-calc-home-big" data-value=${est.home}>${pounds(homeShown)}</span> <span class="lp-calc__per">${CALC.headTail}</span></span>
            </p>
            <p class="lp-calc__compare" data-testid="l3-calc-compare">${compare}</p>
          </div>

          <div class="lp-calc__rates" data-testid="l3-calc-assumptions">
            <div class="lp-calc__ratehead">
              <h3 class="lp-calc__subhead">${CALC.assumptionsTitle}</h3>
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

          <div class="lp-calc__detail" data-testid="l3-calc-workings">
            <h3 class="lp-calc__subhead">${CALC.compareTitle}</h3>
            <ul class="lp-bars" aria-label="Estimated yearly cost">
              <${Bar} label="Home charging" cost=${est.home} max=${maxCost} tone="home" testid="l3-calc-home" />
              <${Bar} label="Petrol" cost=${est.petrol} max=${maxCost} tone="petrol" testid="l3-calc-petrol" />
              <${Bar} label="Public charging" cost=${est.public} max=${maxCost} tone="public" testid="l3-calc-public" />
            </ul>
            <h3 class="lp-calc__subhead lp-calc__subhead--small">${CALC.workingsTitle}</h3>
            <p class="lp-calc__workings" data-testid="l3-calc-workings-text">${workings}</p>
            <p class="lp-calc__note lp-calc__note--foot" data-testid="l3-calc-footnote">${CALC.footnote}</p>
          </div>
          <p class="u-sr-only" aria-live="polite" aria-atomic="true">${announce}</p>
        </div>
      </div>
    </section>
  `;
}
