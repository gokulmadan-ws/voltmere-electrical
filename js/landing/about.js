// js/landing/about.js: "Meet your local EV charger installers." Photo first (4:3, the bottom-right 45 degree cut), his H2 and two paragraphs beside it from 1024, then his brand list in the logo voice.
// His words only: no name, no caption, no ticks (they are in the hero), no call or WhatsApp buttons. The brands come live from Settings (business.brands).
// Owner: B2 (landing V5, docs/LANDING-V5.md 5.5)
import { html } from '../vendor/preact-htm.js';
import { useStore } from '../ui/hooks.js';
import { DEFAULT_BRANDS, IMAGES } from './content.js';
import { ABOUT } from './copy.js';
import { Photo } from './media.js';

const selectBusiness = (state) => state.settings.business;

export function About() {
  const business = useStore(selectBusiness);
  const brands = Array.isArray(business.brands) && business.brands.length ? business.brands : DEFAULT_BRANDS;
  return html`
    <section class="lp-sec lp-sec--l" id="about" aria-labelledby="about-title" data-testid="about">
      <div class="lp-wrap lp-sec__in lp-about">
        <figure class="lp-about__photo lp-cut-br">
          <${Photo} img=${IMAGES.about} ratio="4 / 3" sizes="(min-width: 1024px) 58vw, 100vw" widths=${[640, 1000, 1200, 1600]} data-testid="about-photo" />
        </figure>
        <div class="lp-about__text">
          <h2 class="lp-h2 lp-h2--s lp-display" id="about-title">${ABOUT.title}</h2>
          <div data-testid="about-body">
            <p class="lp-about__p1">${ABOUT.p1}</p>
            <p class="lp-about__p2" data-testid="about-pull">${ABOUT.p2}</p>
          </div>
        </div>
        <div class="lp-brands" role="group" aria-labelledby="brands-k" data-testid="brands">
          <p class="lp-lbl lp-brands__k" id="brands-k">${ABOUT.brandsLabel}</p>
          <ul class="lp-brands__list">
            ${brands.map((b) => html`<li class="lp-logovoice" key=${b}>${b}</li>`)}
          </ul>
        </div>
      </div>
    </section>
  `;
}
