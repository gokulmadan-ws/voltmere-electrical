// js/landing/why.js: "Home charging that works around you." H2 on the left (sticky from 1024), his three reasons as ruled rows on the right, then ONE text link (never a second red button).
// No eyebrow, no numbers, no icons, no cards. Owner: B2 (landing V5, docs/LANDING-V5.md 5.4)
import { html } from '../vendor/preact-htm.js';
import { CTA_LABEL, bookLinkProps } from './content.js';
import { WHY } from './copy.js';
import { TextLink } from './ui.js';

export function Why() {
  return html`
    <section class="lp-sec lp-sec--l" id="why" aria-labelledby="why-title" data-testid="why-cards">
      <div class="lp-wrap lp-sec__in lp-why">
        <h2 class="lp-h2 lp-display" id="why-title">${WHY.title}</h2>
        <div class="lp-why__rows">
          <ul class="lp-rows">
            ${WHY.rows.map((row) => html`<li key=${row.title}><h3>${row.title}</h3><p>${row.body}</p></li>`)}
          </ul>
          <p class="lp-why__cta"><${TextLink} ...${bookLinkProps()} data-testid="why-cta">${CTA_LABEL}<//></p>
        </div>
      </div>
    </section>
  `;
}
