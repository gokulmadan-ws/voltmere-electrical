// js/landing/ui.js: the two interactive primitives of the landing page (docs/LANDING-V5.md 4.1 and 4.2): LpButton (the red primary, its small and extra-large sizes and the outline
// secondary) and TextLink (ink, underlined, with an optional arrow). NOT the shared js/ui/button.js (its sizing, radius and press behaviour are the old look).
// Both render an <a> when `href` is given and a <button type="button"> otherwise, and pass every other prop (data-testid, onClick, aria-label, target, rel...) through.
//
//   <${LpButton} onClick=${bookClick({})} data-testid="hero-cta">${CTA_LABEL}<//>              primary, 56px, label left, arrow right; class "lp-btn lp-cta"
//   <${LpButton} size="sm" ...>                                                               44px header button, no arrow
//   <${LpButton} size="xl" ...>                                                               64px (postcode check, closing band)
//   <${LpButton} variant="outline" href=${brand.telHref} icon="phone">Call<//>                 outlined ink; no lp-cta class (it is not a quote button)
//   <${TextLink} href=${...}>See how a quote looks<//>   <${TextLink} quiet onClick=${reset}>Reset<//>
// `lp-cta` marks a button that opens the funnel: the booking prefetch (js/landing/booking-host.js) and the tests select on it. Pass cta={false} for a primary that does not.
// Owner: B1 (LANDING-V5).
import { h } from '../vendor/preact-htm.js';
import { cx } from '../ui/util.js';
import { Glyph } from './glyphs.js';

/**
 * props: variant 'primary' (default) | 'outline'; size 'sm' | 'lg' | 'xl' | undefined (the 56px default; 'lg' is the same height, it only exists for the narrow-phone padding rule);
 * arrow (default: true for primary at 56px and above, false for 'sm' and for outline); icon (a glyph name drawn BEFORE the label, e.g. 'phone'); block (full width);
 * cta (default true for a primary).
 */
export function LpButton({ variant = 'primary', size, arrow, icon, block, cta, href, type, class: cls, children, ...rest }) {
  const outline = variant === 'outline';
  const showArrow = arrow === undefined ? (!outline && size !== 'sm') : arrow;
  const isCta = cta === undefined ? !outline : cta;
  const classes = cx('lp-btn', size && `lp-btn--${size}`, outline && 'lp-btn--outline', block && 'lp-btn--block', isCta && 'lp-cta', cls);
  const kids = [
    icon ? h(Glyph, { name: icon, key: 'i' }) : null,
    h('span', { key: 'l' }, children),
    showArrow ? h(Glyph, { name: 'arrow', key: 'a' }) : null
  ];
  if (href !== undefined && href !== null) return h('a', { class: classes, href, ...rest }, kids);
  return h('button', { type: type || 'button', class: classes, ...rest }, kids);
}

/** A text link: ink 16px/600 with a 1px underline (also under the arrow), a 44px hit area. `quiet`: 14px/500 grey, no arrow (Reset). */
export function TextLink({ quiet, arrow, href, type, class: cls, children, ...rest }) {
  const showArrow = arrow === undefined ? !quiet : arrow;
  const classes = cx('lp-link', quiet && 'lp-link--quiet', cls);
  const kids = [h('span', { key: 'l' }, children), showArrow ? h(Glyph, { name: 'arrow', key: 'a' }) : null];
  if (href !== undefined && href !== null) return h('a', { class: classes, href, ...rest }, kids);
  return h('button', { type: type || 'button', class: classes, ...rest }, kids);
}
