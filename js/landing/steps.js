// js/landing/steps.js: "From first enquiry to charging at home." H2, then his three steps. The logo's bold italic is the numeral (decorative: the <ol> already numbers the steps);
// step 01 is the one the visitor does today and carries the only red rule on the page's content. Step 02 also holds the earliest-visit idea as a margin annotation (js/landing/visit.js).
// Phones: rows (numeral column, title, text). 1024 and up: three columns under 2px rules. Owner: B2 (landing V5, docs/LANDING-V5.md 5.7)
import { html } from '../vendor/preact-htm.js';
import { STEPS } from './copy.js';
import { Visit } from './visit.js';

export function HowItWorks() {
  return html`
    <section class="lp-sec lp-sec--l" id="how" aria-labelledby="how-title" data-testid="how-it-works">
      <div class="lp-wrap lp-sec__in">
        <h2 class="lp-h2 lp-display" id="how-title">${STEPS.title}</h2>
        <ol class="lp-steps" role="list" data-testid="l3-steps">
          ${STEPS.items.map((s) => html`<li class="lp-step" key=${s.n}>
            <span class="lp-step__n lp-logovoice" aria-hidden="true">${s.n}</span>
            <div class="lp-step__t">
              <h3>${s.title}</h3>
              <p>${s.body}</p>
              ${s.n === '02' ? html`<${Visit} />` : null}
            </div>
          </li>`)}
        </ol>
      </div>
    </section>
  `;
}
