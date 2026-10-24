// js/landing/media.js: Photo (fixed-ratio box, lazy, neutral placeholder when a photo is missing) and LogoImg (his logo with a fallback).
// Owner: C2 (landing page for 180 Electrical)
import { html, useState } from '../vendor/preact-htm.js';
import { Icon, cx } from '../ui/index.js';
import { PHOTOS } from './content.js';

/**
 * A photo in a box whose shape is fixed by CSS (aspect-ratio), so nothing jumps while it loads. Lazy by default; pass
 * `eager` for the one photo that is above the fold on a desktop. If the file is missing or broken, the box stays and
 * shows a plain dark placeholder instead of a broken-image icon.
 */
export function Photo({ src, alt, ratio = '4x3', eager = false, class: cls, ...rest }) {
  const [failed, setFailed] = useState(false);
  return html`
    <div class=${cx('lp-photo', `lp-photo--${ratio}`, failed && 'is-missing', cls)} ...${rest}>
      ${failed
        ? html`<span class="lp-photo__ph" role="img" aria-label=${alt}><${Icon} name="plug-zap" size=${32} /></span>`
        : html`<img class="lp-photo__img" src=${src} alt=${alt} loading=${eager ? 'eager' : 'lazy'} decoding="async"
            onError=${() => setFailed(true)} />`}
    </div>
  `;
}

/**
 * His logo. It is a picture on a near-black card, so it always sits in a black chip (.lp-logo, black in both themes)
 * and is blended with `lighten` so the card colour disappears into the chip. Tries img/180/logo.jpg first and falls
 * back to the earlier crop (img/logo-180.png) if that file is not there.
 */
export function LogoImg({ name, class: cls }) {
  const [src, setSrc] = useState(PHOTOS.logo);
  return html`
    <span class=${cx('lp-logo', cls)}>
      <img class="lp-logo__img" src=${src} alt=${name} decoding="async"
        onError=${() => { if (src !== PHOTOS.logoFallback) setSrc(PHOTOS.logoFallback); }} />
    </span>
  `;
}
