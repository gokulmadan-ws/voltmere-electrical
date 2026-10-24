// js/landing/hero.js: the hero and its spec strip (docs/LANDING-V5.md 5.2 and 5.3). His eyebrow, H1, sub, button and the two lines under it word for word; a 3:2 photo with the 45 degree
// cut top-left (nothing laid over it); then the spec strip: his three ticks and, in the logo voice, his two credentials ("Level 3", "2391"). The earliest visit idea is not here any
// more: it is a margin annotation in step 02 (js/landing/visit.js).
// Owner: L3 (landing page for 180 Electrical; first built by C2); rebuilt for LANDING-V5 by B1.
import { html } from '../vendor/preact-htm.js';
import { useStore } from '../ui/hooks.js';
import { credentialList } from '../booking/bk-shared.js';
import { CTA_LABEL, HERO, IMAGES, bookClick } from './content.js';
import { Photo } from './media.js';
import { Glyph } from './glyphs.js';
import { LpButton } from './ui.js';

// Stable selector function (useStore wants the same function every render).
const selectBusiness = (state) => state.settings.business;

/**
 * "Level 3 Electrical Installation" -> { fig: 'Level 3', rest: 'Electrical Installation' }; "2391 Inspection and Testing" -> { fig: '2391', rest: 'Inspection and Testing' }.
 * Text that does not start with a figure comes back as { fig: '', rest: text } (it is drawn as the descriptor only). The textContent of a credential never changes.
 */
export function splitCredential(text) {
  const m = /^(Level\s+\d+|\d+[A-Za-z]?)\s+(.*)$/i.exec(String(text).trim());
  return m ? { fig: m[1], rest: m[2] } : { fig: '', rest: String(text) };
}

/** His H1, word for word: the first sentence is its own line; "Northern Ireland." never breaks (css .lp-nowrap, not a non-breaking space: the text stays byte-identical). */
function HeroTitle() {
  const second = HERO.titleSecond;
  const at = HERO.titleNoWrap ? second.lastIndexOf(HERO.titleNoWrap) : -1;
  return html`<span>${HERO.titleFirst}</span>${' '}<span>${at < 0 ? second : html`${second.slice(0, at)}<span class="lp-nowrap">${HERO.titleNoWrap}</span>${second.slice(at + HERO.titleNoWrap.length)}`}</span>`;
}

/** The spec strip under the photo: his three ticks, then "Accredited and qualified" and his two credentials (live from Settings, with his words as the default). */
export function HeroProof() {
  const business = useStore(selectBusiness);
  const list = credentialList({ settings: { business } });
  return html`<div class="lp-spec" data-testid="hero-proof">
    <ul class="lp-spec__ticks" aria-label="What you get" data-testid="hero-ticks">
      ${HERO.ticks.map((t) => html`<li key=${t}><${Glyph} name="tick" /><span>${t}</span></li>`)}
    </ul>
    <div class="lp-spec__trust" role="group" aria-labelledby="hero-trust-k" data-testid="hero-creds">
      <p class="lp-lbl lp-spec__k" id="hero-trust-k">${HERO.credLabel}</p>
      ${list.map((c, i) => {
        const { fig, rest } = splitCredential(c);
        return html`<p class=${fig ? 'lp-spec__cred' : 'lp-spec__cred lp-spec__cred--plain'} key=${c} data-testid=${`hero-cred-${i}`}>${fig ? html`<b class="lp-fig lp-logovoice">${fig}</b>${' '}` : null}<span>${rest}</span></p>`;
      })}
    </div>
  </div>`;
}

export function Hero() {
  return html`
    <section class="lp-hero" id="top" aria-labelledby="hero-title">
      <div class="lp-wrap">
        <p class="lp-lbl lp-hero__eyebrow">${HERO.eyebrow}</p>
        <h1 class="lp-hero__title lp-display" id="hero-title"><${HeroTitle} /></h1>
      </div>
      <div class="lp-wrap lp-hero__body">
        <div class="lp-hero__copy">
          <p class="lp-hero__sub">${HERO.sub}</p>
          <div class="lp-hero__cta">
            <${LpButton} size="lg" class="lp-hero__btn" data-testid="hero-cta" onClick=${bookClick({})}>${CTA_LABEL}<//>
            <p class="lp-note"><span>${HERO.note}</span><strong data-testid="hero-proof-free">${HERO.proofFree}</strong></p>
          </div>
        </div>
        <figure class="lp-hero__photo lp-cut-tl" data-testid="l3-hero-visual">
          <${Photo} img=${IMAGES.hero} ratio="3 / 2" eager=${true} sizes="(min-width: 1024px) 65vw, 100vw" widths=${[640, 960, 1100, 1280]} data-testid="hero-photo" />
        </figure>
      </div>
      <div class="lp-wrap"><${HeroProof} /></div>
    </section>
  `;
}
