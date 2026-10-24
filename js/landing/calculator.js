// js/landing/calculator.js: "What would home charging cost you?": a prototype IDEA from us, set as ruled rows inside "Your installation, clearly quoted." (the section is js/landing/pricing.js):
// data-proto, a dashed rule and the tag, so "Only my content" removes it and leaves no gap. Intro on the left (sticky from 1024); miles (underline field + hairline slider), the answer, the
// three-way bars, the rates (a closed "Change the rates" disclosure below 1200, always open from 1200) and a footnote row. Plain words, no raw maths, no card, no number tween.
// The arithmetic is js/landing/calc.js, unchanged. Owner: B2 (landing V5, docs/LANDING-V5.md 6.3)
import { html, useEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { uid } from '../ui/util.js';
import { useMediaQuery } from '../ui/hooks.js';
import { CALC_DEFAULTS, estimate, fieldError, parseNumber, resolveInputs, savingWords } from './calc.js';
import { CALC } from './copy.js';
import { ProtoTag, protoProps } from './idea.js';
import { TextLink } from './ui.js';

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

/** One row of the three-way table: the label, a 6px bar that eases to its share of the dearest option (home solid ink, the others 28% ink; never red) and the value. */
function BarRow({ label, cost, max, home, testid }) {
  const share = max > 0 ? Math.max(0.02, Math.min(1, cost / max)) : 0.02;
  return html`<tr>
    <th scope="row">${label}</th>
    <td><span class="lp-bars__t" aria-hidden="true"><span class=${home ? 'lp-bars__f lp-bars__f--home' : 'lp-bars__f'} style=${`--w:${(share * 100).toFixed(1)}%`}></span></span></td>
    <td class="lp-bars__v" data-testid=${testid} data-value=${cost}>${pounds(cost)}</td>
  </tr>`;
}

export function Calculator() {
  const [texts, setTexts] = useState(defaultTexts);
  const [base] = useState(() => uid('lp-calc'));
  const wide = useMediaQuery('(min-width: 1200px)');
  const [more, setMore] = useState(false);
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

  const milesNow = errors.miles ? CALC_DEFAULTS.miles : v.miles;
  const sliderValue = Math.min(SLIDER.max, Math.max(SLIDER.min, Math.round(milesNow / SLIDER.step) * SLIDER.step));
  const maxCost = Math.max(est.home, est.public, est.petrol);
  const petrol = savingWords(est.saveVsPetrol);

  const kwhShown = num(est.kwh);
  const milesShown = num(v.miles);
  // The comparison, in one plain sentence; the difference keeps its own span (l3-calc-saving-big) and its words follow the sign.
  const diff = html`<span data-testid="l3-calc-saving-big" data-value=${est.saveVsPetrol}>${pounds(petrol.amount)}</span>`;
  const compare = petrol.tone === 'save'
    ? html`The same miles in a petrol car would cost about ${pounds(est.petrol)} a year, which is about ${diff} more.`
    : petrol.tone === 'more'
      ? html`The same miles in a petrol car would cost about ${pounds(est.petrol)} a year, which is about ${diff} less.`
      : html`The same miles in a petrol car would cost about ${pounds(est.petrol)} a year, about the same.`;
  // The workings, in plain sentences (no raw maths, no conversion constants).
  const workings = `Your ${milesShown} miles use about ${kwhShown} kWh a year, which is ${pounds(est.home)} at ${num(v.homePence)}p a kWh. A petrol car doing ${num(v.mpg)} mpg would use about ${num(est.litres)} litres, which is ${pounds(est.petrol)} at ${num(v.petrolPence)}p a litre. At a public charger, ${num(v.publicPence)}p a kWh would come to ${pounds(est.public)}.`;

  return html`
    <div class="lp-idea lp-calc" id="savings" role="group" aria-labelledby=${`${base}-t`} ...${protoProps({ 'data-testid': 'l3-calc' })}>
      <${ProtoTag} />
      <div class="lp-idea__grid">
        <div class="lp-idea__intro">
          <h3 id=${`${base}-t`}>${CALC.title}</h3>
          <p>${CALC.lead}</p>
        </div>
        <div class="lp-idea__body">
          <div class="lp-calc__miles">
            <label class="lp-lbl" for=${`${base}-miles`}>${CALC.milesLabel}</label>
            <div class="lp-calc__mrow">
              <input id=${`${base}-miles`} class="lp-calc__in lp-calc__in--big" type="text" inputmode="numeric" autocomplete="off" spellcheck=${false} value=${texts.miles}
                aria-invalid=${errors.miles ? 'true' : undefined} aria-describedby=${errors.miles ? `${base}-miles-u ${base}-miles-err` : `${base}-miles-u`}
                onInput=${(e) => set('miles', e.target.value)}
                onBlur=${() => { if (!errors.miles) set('miles', num(parseNumber(texts.miles))); }}
                data-testid="l3-calc-miles" />
              <span class="lp-calc__unit" id=${`${base}-miles-u`}>${CALC.milesUnit}</span>
            </div>
            ${errors.miles ? html`<p class="lp-calc__err" id=${`${base}-miles-err`} role="alert">${errors.miles} We are using ${num(CALC_DEFAULTS.miles)} meanwhile.</p>` : null}
            <input class="lp-range" type="range" min=${SLIDER.min} max=${SLIDER.max} step=${SLIDER.step} value=${sliderValue}
              aria-label=${CALC.sliderLabel} aria-valuetext=${`${num(sliderValue)} miles a year`}
              onInput=${(e) => set('miles', num(Number(e.target.value)))} data-testid="l3-calc-slider" />
          </div>

          <div class="lp-calc__res" role="group" aria-labelledby=${`${base}-r`} data-testid="l3-calc-result">
            <h4 class="u-sr-only" id=${`${base}-r`}>${CALC.resultTitle}</h4>
            <p class="lp-calc__big" data-testid="l3-calc-headline">
              <span class="lp-calc__lead">${CALC.headLead}</span>${' '}
              <span class="lp-calc__fig"><span class="lp-calc__num" data-testid="l3-calc-home-big" data-value=${est.home}>${pounds(est.home)}</span>${' '}<span class="lp-calc__per">${CALC.headTail}</span></span>
            </p>
            <p class="lp-calc__cmp" data-testid="l3-calc-compare">${compare}</p>
          </div>

          <table class="lp-bars" data-testid="l3-calc-workings">
            <caption class="lp-small">${CALC.compareTitle}</caption>
            <tbody>
              <${BarRow} label=${CALC.bars.home} cost=${est.home} max=${maxCost} home=${true} testid="l3-calc-home" />
              <${BarRow} label=${CALC.bars.petrol} cost=${est.petrol} max=${maxCost} testid="l3-calc-petrol" />
              <${BarRow} label=${CALC.bars.public} cost=${est.public} max=${maxCost} testid="l3-calc-public" />
            </tbody>
          </table>

          <details class="lp-calc__more" open=${wide || more} onToggle=${(e) => { if (!wide) setMore(e.currentTarget.open); }} data-testid="l3-calc-assumptions">
            <summary><span>${CALC.ratesSummary}</span><i class="lp-pm" aria-hidden="true"></i></summary>
            <p class="lp-lbl lp-calc__k">${CALC.assumptionsTitle}</p>
            <div class="lp-rates">
              ${CALC.fields.map((f) => {
                const id = `${base}-${f.key}`;
                return html`<div class="lp-rates__r" key=${f.key}>
                  <label for=${id}>${f.label}</label>
                  <input id=${id} class="lp-calc__in" type="text" inputmode="decimal" autocomplete="off" spellcheck=${false} value=${texts[f.key]}
                    aria-invalid=${errors[f.key] ? 'true' : undefined} aria-describedby=${errors[f.key] ? `${id}-u ${id}-err` : `${id}-u`}
                    onInput=${(e) => set(f.key, e.target.value)} data-testid=${`l3-calc-field-${f.key}`} />
                  <span id=${`${id}-u`}>${f.unit}</span>
                  ${errors[f.key] ? html`<p class="lp-calc__err" id=${`${id}-err`} role="alert">${errors[f.key]} Using ${CALC_DEFAULTS[f.key]} meanwhile.</p>` : null}
                </div>`;
              })}
            </div>
            <p class="lp-small lp-calc__note">${CALC.assumptionsNote}</p>
            <p class="lp-lbl lp-calc__k lp-calc__k--w">${CALC.workingsTitle}</p>
            <p class="lp-workings" data-testid="l3-calc-workings-text">${workings}</p>
            <${TextLink} quiet onClick=${() => setTexts(defaultTexts())} disabled=${!changed} aria-label=${CALC.resetLabel} data-testid="l3-calc-reset">${CALC.reset}<//>
          </details>
        </div>
      </div>
      <div class="lp-calc__foot">
        <span class="lp-calc__badge" data-testid="l3-calc-badge">${CALC.badge}</span>
        <p data-testid="l3-calc-footnote">${CALC.footnote}</p>
      </div>
      <p class="u-sr-only" aria-live="polite" aria-atomic="true">${announce}</p>
    </div>
  `;
}
