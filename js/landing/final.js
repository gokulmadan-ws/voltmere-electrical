// js/landing/final.js: the closing call to action, the top half of the closing composition (docs/LANDING-V5.md 5.11). One near-black band (the logo's own ground) with the logo's two-stripe corner
// top-left (css .lp-final::before) and his H2 and paragraph flush left, then the one red button; the footer (js/landing/footer.js) continues the same black with the stripes bottom-right.
// Never centred, no second button, no phone line (the footer carries the phone at 48px directly below), no WhatsApp. Inside <main> so the section stays in the main landmark.
// Owner: B1 (LANDING-V5; it was FinalCta in sections.js).
import { html } from '../vendor/preact-htm.js';
import { CTA_LABEL, bookClick } from './content.js';
import { FINAL } from './copy.js';
import { LpButton } from './ui.js';

export function FinalCta() {
  return html`
    <section class="lp-final" id="final" aria-labelledby="final-title" data-testid="final-cta" data-sticky-hide>
      <div class="lp-wrap lp-final__grid">
        <h2 class="lp-final__h lp-display" id="final-title">${FINAL.title}</h2>
        <div class="lp-final__side">
          <p>${FINAL.body}</p>
          <${LpButton} size="xl" class="lp-final__btn" data-testid="final-book" onClick=${bookClick({})}>${CTA_LABEL}<//>
        </div>
      </div>
    </section>
  `;
}
