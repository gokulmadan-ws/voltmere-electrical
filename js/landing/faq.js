// js/landing/faq.js: "Frequently asked questions": his six, native <details name="faq"> (exclusive in current browsers, harmless where not), the cost question open on load.
// `open` is passed on that ONE <details> and never changes, so the browser owns the state afterwards. The height animates through ::details-content where supported.
// Owner: B2 (landing V5, docs/LANDING-V5.md 4.5 and 5.10)
import { html } from '../vendor/preact-htm.js';
import { FAQ } from './copy.js';

export function Faq() {
  return html`
    <section class="lp-sec" id="faq" aria-labelledby="faq-title" data-testid="faq">
      <div class="lp-wrap lp-sec__in lp-faq">
        <h2 class="lp-h2 lp-display" id="faq-title">${FAQ.title}</h2>
        <div class="lp-faq__list">
          ${FAQ.items.map((it, i) => html`<details class="lp-faq__item" name="faq" open=${it.q === FAQ.openFirst ? true : undefined} key=${it.q} data-testid=${`faq-item-${i}`}>
            <summary class="lp-faq__q" data-testid=${`faq-q-${i}`}><span>${it.q}</span><i class="lp-pm" aria-hidden="true"></i></summary>
            <div class="lp-faq__a"><p>${it.a}</p></div>
          </details>`)}
        </div>
      </div>
    </section>
  `;
}
