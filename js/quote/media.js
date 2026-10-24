// js/quote/media.js: his logo for the quote page (a black chip, blended, with a local fallback if the picture cannot load).
// Owner: Q2 (customer quote page)
import { html, useState } from '../vendor/preact-htm.js';
import { imageUrl } from '../core/config.js';
import { cx } from '../ui/index.js';

// The earlier crop of his logo, used when the logo address cannot be reached.
export const LOGO_FALLBACK = 'img/logo-180.png';

/**
 * His logo. It is a picture on a near-black card, so it always sits in a black chip (black in both themes) and is blended with
 * `lighten` so the card colour disappears into the chip. `images` is the live business.images map.
 */
export function QuoteLogo({ name, images, eager = true, class: cls }) {
  const remote = imageUrl('logo', { width: 360, images });
  const [failedUrl, setFailedUrl] = useState('');
  const src = !remote || failedUrl === remote ? LOGO_FALLBACK : remote;
  return html`
    <span class=${cx('q2-logo', cls)}>
      <img class="q2-logo__img" src=${src} alt=${name} width="1119" height="743"
        loading=${eager ? 'eager' : 'lazy'} fetchpriority=${eager ? 'high' : undefined} decoding="async" referrerpolicy="no-referrer"
        onError=${() => setFailedUrl(remote)} data-testid="q2-logo-img" />
    </span>
  `;
}
