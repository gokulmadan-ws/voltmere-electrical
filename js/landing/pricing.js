// js/landing/pricing.js: "Your installation, clearly quoted." His H2 and his paragraph on one baseline, then the two tagged ideas on the same ruled rows: an example quote you can open
// (names only, blank amounts, "Example only"), and the running-costs calculator (js/landing/calculator.js). No call to action here (his site has none; the red button is in the postcode
// section and the closing band) and no promise line. Under "Only my content" the section is just the head row.
// Owner: B2 (landing V5, docs/LANDING-V5.md 5.8 and 6.2)
import { html } from '../vendor/preact-htm.js';
import { pageHref, pageTarget } from '../ui/util.js';
import { useStore } from '../ui/hooks.js';
import { PRICING } from './copy.js';
import { ProtoTag, protoProps } from './idea.js';
import { TextLink } from './ui.js';
import { Calculator } from './calculator.js';

const selectQuotes = (state) => state.quotes;

/**
 * A sample quote to open: one the owner has sent (so it is complete), with the fewest lines (the plainest one).
 * null when the store holds none; the idea is then left out altogether (there is nothing to open).
 */
export function pickSampleQuote(quotes) {
  const list = Object.values(quotes || {}).filter((q) => q && ['sent', 'viewed', 'accepted'].includes(q.status) && Array.isArray(q.lines) && q.lines.length >= 3);
  list.sort((a, b) => a.lines.length - b.lines.length || (a.id < b.id ? -1 : 1));
  return list[0] || null;
}

/** "See how a quote looks": a link to the example quote, beside a blank four-row quote form. The table is a picture (aria-hidden): names only, no figure. */
function QuotePeek({ quote }) {
  const t = PRICING.teaser;
  return html`<div class="lp-idea lp-qpeek" role="group" aria-label=${t.title} ...${protoProps({ 'data-testid': 'quote-preview' })}>
    <${ProtoTag} />
    <div class="lp-idea__grid">
      <div class="lp-idea__intro">
        <h3>${t.title}</h3>
        <p>${t.body}</p>
        <${TextLink} href=${pageHref('quote.html', '#q=' + quote.id + '&preview=1')} target=${pageTarget('quote.html')} data-testid="pricing-sample-link">${t.link}<//>
      </div>
      <div class="lp-idea__body">
        <table class="lp-qt" aria-hidden="true">
          <caption class="lp-small" data-testid="quote-preview-tag">${t.note}</caption>
          <thead><tr><th scope="col">${t.head[0]}</th><th scope="col">${t.head[1]}</th><th scope="col" class="lp-qt__r">${t.head[2]}</th></tr></thead>
          <tbody>
            ${t.lines.map((name, i) => html`<tr key=${name}><td>${String(i + 1).padStart(2, '0')}</td><td>${name}</td><td class="lp-qt__r"><span class="lp-qt__blank"></span></td></tr>`)}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

export function Pricing() {
  const quotes = useStore(selectQuotes);
  const quote = pickSampleQuote(quotes);
  return html`
    <section class="lp-sec" id="pricing" aria-labelledby="pricing-title" data-testid="pricing">
      <div class="lp-wrap lp-sec__in">
        <div class="lp-pricing__head">
          <h2 class="lp-h2 lp-display" id="pricing-title">${PRICING.title}</h2>
          <p class="lp-statement">${PRICING.body}</p>
        </div>
        ${quote ? html`<${QuotePeek} quote=${quote} />` : null}
        <${Calculator} />
      </div>
    </section>
  `;
}
