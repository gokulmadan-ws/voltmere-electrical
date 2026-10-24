// js/landing/below.js: everything on the landing page below the hero, loaded with a dynamic import() once the first screen has painted (see js/landing/app.js): the sections
// (why, about, work, how it works, your quote with its two ideas, area, questions, the closing band) inside <main>, then the footer and the sticky quote bar after it.
// The sections' stylesheet (css/landing-sections.css) is fetched WITH the section modules and this module only finishes evaluating once both have arrived (top-level await), so the
// sections never mount unstyled and the first screen never waits for them. The footer, the closing band and the sticky bar are styled by landing.css (they are small).
// Owner: B2 (landing V5, docs/LANDING-V5.md 9.7); first built by PERF (final gate)
import { html } from '../vendor/preact-htm.js';
import { loadCss } from '../ui/load-css.js';
import { Footer } from './footer.js';
import { StickyBar } from './sticky-bar.js';

const [{ Why }, { About }, { Gallery }, { HowItWorks }, { Pricing }, { AreaSection }, { Faq }, { FinalCta }] = await Promise.all([
  import('./why.js'), import('./about.js'), import('./gallery.js'), import('./steps.js'), import('./pricing.js'), import('./area.js'), import('./faq.js'), import('./final.js'),
  loadCss('css/landing-sections.css')
]);

/** The sections after the hero, in page order. Rendered inside <main id="main">. */
export function Sections() {
  return html`
    <${Why} />
    <${About} />
    <${Gallery} />
    <${HowItWorks} />
    <${Pricing} />
    <${AreaSection} />
    <${Faq} />
    <${FinalCta} />
  `;
}

/** The footer and the sticky quote bar: siblings of <main>. */
export function Tail() {
  return html`
    <${Footer} />
    <${StickyBar} />
  `;
}
