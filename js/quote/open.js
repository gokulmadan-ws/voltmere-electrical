// js/quote/open.js: the quote as the customer first sees it (sent, viewed, or expired): hero, decision card, itemised lines, notes, trust, steps, contact.
// Owner: Q2 (customer quote page)
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { Banner } from '../ui/index.js';
import {
  ContactCard, DecisionCard, Footer, Hero, LinesCard, MetaPills, NotesCard, PreviewStrip, StepsCard, StickyBar, TrustCard
} from './parts.js';
import { AcceptFlow } from './accept.js';
import { DeclineFlow } from './decline.js';
import { questionText } from './format.js';

/** True while `selector` has scrolled out of view (or has not come into view yet): drives the sticky accept bar. Visible by default where observers are missing. */
function useOutOfView(selector, active) {
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (!active || typeof IntersectionObserver !== 'function') { setOut(false); return undefined; }
    const el = document.querySelector(selector);
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      setOut(!last.isIntersecting);
    }, { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [selector, active]);
  return out;
}

export function OpenView({ d, state, brand, preview }) {
  const expired = d.status === 'expired';
  const [sheet, setSheet] = useState(null); // null | 'accept' | 'decline'
  const [notice, setNotice] = useState(null);
  const stuck = useOutOfView('[data-testid="q2-accept"]', !expired);
  const installLabel = (state.settings.services.find((s) => s.id === 'ev') || {}).durationLabel || '';

  // The sheet can only stay open while the quote can still be accepted or declined.
  useEffect(() => { if (expired && sheet) setSheet(null); }, [expired, sheet]);

  const closeSheet = (info) => {
    setSheet(null);
    if (info && info.title) setNotice(info);
  };

  return html`
    <div class="q2-state" data-testid="q2-open">
      ${preview ? html`<${PreviewStrip} />` : null}
      <${Hero} brand=${brand} eyebrow=${`Hi ${d.customerFirst},`} title="Your EV charger installation quote">
        <${MetaPills} d=${d} />
      <//>
      <main class="q2-main" id="q2-main" tabindex="-1">
        <div class="q2-wrap q2-grid">
          <aside class="q2-side" aria-label="Your decision">
            ${notice ? html`<${Banner} tone=${notice.tone === 'ok' ? 'ok' : notice.tone} class="q2-notice" data-testid="q2-notice"><strong>${notice.title}.</strong> ${notice.text}<//>` : null}
            <${DecisionCard} d=${d} brand=${brand} expired=${expired} onAccept=${() => { setNotice(null); setSheet('accept'); }} onDecline=${() => { setNotice(null); setSheet('decline'); }} />
          </aside>
          <div class="q2-body">
            <${LinesCard} d=${d} />
            <${NotesCard} d=${d} installLabel=${installLabel && installLabel.toLowerCase()} />
            <${TrustCard} brand=${brand} />
            ${expired ? null : html`<${StepsCard} brand=${brand} />`}
            <${ContactCard} brand=${brand} text=${questionText(brand, d)} />
          </div>
        </div>
      </main>
      <${Footer} brand=${brand} />
      ${expired ? null : html`<${StickyBar} show=${stuck && sheet === null} total=${d.total} onAccept=${() => { setNotice(null); setSheet('accept'); }} />`}
      ${expired ? null : html`
        <${AcceptFlow} open=${sheet === 'accept'} state=${state} d=${d} brand=${brand} onClose=${closeSheet} onAccepted=${() => setSheet(null)} />
        <${DeclineFlow} open=${sheet === 'decline'} d=${d} brand=${brand} onClose=${() => setSheet(null)} onDeclined=${() => setSheet(null)} />`}
    </div>
  `;
}
