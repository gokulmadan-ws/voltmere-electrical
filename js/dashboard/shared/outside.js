// js/dashboard/shared/outside.js: the amber "Outside NI" pill for an enquiry from outside Northern Ireland (Today and Bookings share it).
// Owner: DASH
import { html } from '../../vendor/preact-htm.js';
import { Icon } from '../../ui/index.js';

export const OUTSIDE_TEXT = 'Outside NI';

/** The amber pill. Screen readers also hear what to do about it. Styled by .td-pill-amber (css/today.css, loaded with Today and Bookings). */
export function OutsidePill({ testid }) {
  return html`<span class="td-pill-amber" data-testid=${testid}><${Icon} name="map-pin" size=${14} /><span>${OUTSIDE_TEXT}</span><span class="u-sr-only">, check travel first</span></span>`;
}
