// js/quote/media.js: his logo for the quote page (his lockup through a crop window, blended into the black panel, with a local fallback if the picture cannot load).
// Owner: Q2 (customer quote page)
import { html, useState } from '../vendor/preact-htm.js';
import { imageUrl } from '../core/config.js';
import { cx } from '../ui/index.js';

// The earlier crop of his logo, used when the logo address cannot be reached.
export const LOGO_FALLBACK = 'img/logo-180.png';

/**
 * His logo, as the landing page shows it: the picture (1119x743, a near-black card with the "180 ELECTRICAL" lockup in the middle and
 * corner stripes) seen through a crop window (.q2-logo in css/quote.css: only the lockup shows, so the red wordmark stays readable at
 * header size) and blended with `lighten`, so the card colour disappears into the near-black header or footer. `images` is the live
 * business.images map; the earlier local crop (img/logo-180.png, same layout, so the same window fits) is the fallback.
 * `decorative` gives it an empty alt (the link around it already carries the name).
 */
export function QuoteLogo({ name, images, eager = true, decorative = false, testid = 'q2-logo-img', class: cls }) {
  const remote = imageUrl('logo', { width: 360, images });
  const [failedUrl, setFailedUrl] = useState('');
  const src = !remote || failedUrl === remote ? LOGO_FALLBACK : remote;
  return html`
    <span class=${cx('q2-logo', cls)}>
      <img class="q2-logo__img" src=${src} alt=${decorative ? '' : name} width="1119" height="743"
        loading=${eager ? 'eager' : 'lazy'} fetchpriority=${eager ? 'high' : undefined} decoding="async" referrerpolicy="no-referrer"
        onError=${() => setFailedUrl(remote)} data-testid=${testid} />
    </span>
  `;
}

// Charger line art on the brand's near-black: shown for a brand with no photo of his, and when a photo cannot load.
export const CHARGER_PLACEHOLDER = 'img/landing-placeholder.svg';

/**
 * A small square picture of the charger in the decision card. `photoKey` is a business.images key (one of his own photos of a fitted
 * charger) or '' for the line art. The picture is decorative (the charger is named in words beside it), has a fixed box so nothing
 * shifts, and falls back to the line art when it cannot load.
 */
export function ChargerThumb({ photoKey, images, class: cls }) {
  const remote = photoKey ? imageUrl(photoKey, { width: 240, images }) : '';
  const [failedUrl, setFailedUrl] = useState('');
  const src = !remote || failedUrl === remote ? CHARGER_PLACEHOLDER : remote;
  return html`
    <span class=${cx('q2-thumb', cls)} aria-hidden="true">
      <img class="q2-thumb__img" src=${src} alt="" width="120" height="120" loading="eager" decoding="async" referrerpolicy="no-referrer"
        onError=${() => setFailedUrl(remote)} data-testid="q2-thumb-img" />
    </span>
  `;
}
