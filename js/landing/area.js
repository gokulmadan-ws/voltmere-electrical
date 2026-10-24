// js/landing/area.js: "EV charger installation in Northern Ireland." H2, his statement, then the postcode check: ONE press. The red button ("Get my installation quote", always his words)
// checks the postcode, shows the verdict line, and opens the enquiry funnel with the postcode filled in. An invalid postcode keeps the visitor here: aria-invalid, focus back in the field,
// his funnel's own message in --err. Editing the field clears the error and the verdict. The verdict stays visible behind the sheet and when it closes.
// Owner: B2 (landing V5, docs/LANDING-V5.md 5.9)
import { html, useState } from '../vendor/preact-htm.js';
import { uid } from '../ui/util.js';
import { useBrand, useStore } from '../ui/hooks.js';
import { isValidPostcode, normalisePostcode, postcodeZone } from '../core/format.js';
import { CTA_LABEL, fillOwner, startEnquiry } from './content.js';
import { AREA } from './copy.js';
import { Glyph } from './glyphs.js';
import { LpButton } from './ui.js';

const selectBusiness = (state) => state.settings.business;

export function AreaSection() {
  const business = useStore(selectBusiness);
  const brand = useBrand();
  const [value, setValue] = useState('');
  // result: '' (nothing yet) | 'bad' (not a postcode) | 'covered' | 'edge' | 'outside': the verdict belongs to what was last pressed, and editing clears it
  const [result, setResult] = useState('');
  const [base] = useState(() => uid('lp-pc'));
  const o = brand.ownerFirst;

  const submit = (e) => {
    e.preventDefault();
    const pc = normalisePostcode(value);
    if (!isValidPostcode(pc)) {
      setResult('bad');
      const input = e.currentTarget && e.currentTarget.querySelector ? e.currentTarget.querySelector('input') : null;
      if (input) input.focus();
      return;
    }
    setResult(postcodeZone(pc, business));
    startEnquiry({ postcode: pc });
  };

  const edge = result === 'edge' ? fillOwner(AREA.edge, o).split('{phone}') : null;
  return html`
    <section class="lp-sec lp-sec--l" id="area" aria-labelledby="area-title" data-testid="area" data-sticky-hide>
      <div class="lp-wrap lp-sec__in">
        <h2 class="lp-h2 lp-display" id="area-title">${AREA.title}</h2>
        <div class="lp-area__row">
          <p class="lp-statement">${AREA.body}</p>
          <form class="lp-pc" onSubmit=${submit} novalidate data-testid="area-form">
            <label class="lp-lbl" for=${`${base}-in`}>${AREA.label}</label>
            <div class="lp-pc__row">
              <input id=${`${base}-in`} class="lp-pc__in" type="text" value=${value}
                onInput=${(e) => { setValue(e.target.value); if (result) setResult(''); }}
                placeholder=${AREA.placeholder} autocomplete="postal-code" autocapitalize="characters" spellcheck=${false} enterkeyhint="go" maxlength="8"
                aria-invalid=${result === 'bad' ? 'true' : undefined} aria-describedby=${`${base}-note ${base}-res`} data-testid="coverage-input" />
              <${LpButton} type="submit" size="xl" class="lp-pc__btn" data-testid="coverage-book">${CTA_LABEL}<//>
            </div>
            <p class="lp-pc__note" id=${`${base}-note`}>${AREA.note}</p>
            <p class=${result === 'bad' ? 'lp-pc__result is-bad' : 'lp-pc__result'} id=${`${base}-res`} aria-live="polite" data-testid="coverage-result">
              ${result === 'bad' ? html`<span>${AREA.invalid}</span>` : null}
              ${result === 'covered' ? html`<${Glyph} name="tick" size=${20} /><span>${AREA.covered}</span>` : null}
              ${edge ? html`<span>${edge[0]}<a class="lp-pc__tel" href=${brand.telHref}>${brand.phone}</a>${edge[1]}</span>` : null}
              ${result === 'outside' ? html`<span>${fillOwner(AREA.outside, o)}</span>` : null}
            </p>
          </form>
        </div>
      </div>
    </section>
  `;
}
