// js/landing/media.js: Photo (reserved box, srcset, lazy; flat paper tone while loading and when it fails, nothing drawn) and LogoImg (his logo with a local fallback).
// Owner: L3 (landing page for 180 Electrical; first built by C2); LANDING-V5 changes (4.13) by B1: ratio="fill", no shimmer, no fade, a plain flat box for a failed photo.
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { imageUrl } from '../core/config.js';
import { getState } from '../core/store.js';
import { cx } from '../ui/util.js';
import { useStore } from '../ui/hooks.js';

// The charger line art (img/landing-placeholder.svg) is no longer drawn by Photo: a photo that will not load is a flat box. It stays only for the quote page's charger thumbnail.
export const PLACEHOLDER_SRC = 'img/landing-placeholder.svg';
// The earlier crop of his logo (from a phone screenshot), used when the logo URL cannot be reached.
export const LOGO_FALLBACK = 'img/logo-180.png';

// Components that show a photo subscribe to this, so a URL edited in Settings (in this tab or another) shows within a moment.
export const selectImages = (state) => (state.settings && state.settings.business ? state.settings.business.images : undefined);

/**
 * The URL for one of his images at a width: the one helper in js/core/config.js, fed the live business.images from the
 * store ('' when there is none). Nothing else on the page knows an image address.
 */
export function photoSrc(key, width) {
  try {
    const images = getState().settings.business.images;
    const url = imageUrl(key, { width, images });
    return typeof url === 'string' ? url : '';
  } catch (e) {
    return '';
  }
}

const srcsetFor = (key, widths) => widths.map((w) => `${photoSrc(key, w)} ${w}w`).join(', ');

// Photos below the first screen start their download only once the page has finished loading (its own `load` event: the hero photo, the logo, the scripts and styles are in),
// so on a slow connection they never share the line with what the first screen needs. After that the browser's own lazy loading (loading="lazy") decides by distance, as before.
// A safety timer releases them if `load` is held up (a hung request must not leave pictures blank for ever).
let pageLoaded = typeof document === 'undefined' || document.readyState === 'complete';
const waitingForLoad = new Set();
function releaseLoaded() {
  if (pageLoaded) return;
  pageLoaded = true;
  for (const fn of [...waitingForLoad]) fn();
  waitingForLoad.clear();
}
if (!pageLoaded && typeof window !== 'undefined') {
  window.addEventListener('load', () => setTimeout(releaseLoaded, 0), { once: true });
  setTimeout(releaseLoaded, 8000);
}
/** True when this photo may start downloading: always for the eager (first screen) photo, otherwise once the page has loaded. */
function useAfterLoad(eager) {
  const [ready, setReady] = useState(eager || pageLoaded);
  useEffect(() => {
    if (ready) return undefined;
    const go = () => setReady(true);
    waitingForLoad.add(go);
    return () => { waitingForLoad.delete(go); };
  }, [ready]);
  return ready;
}

/**
 * A photo in a box whose shape is fixed by CSS (aspect-ratio), so nothing jumps while it loads or if it never does.
 * `img` is an entry of IMAGES (key, w, h, alt, position, zoom). `ratio` is the BOX shape ('3 / 2'), which may differ from the file's own (object-fit: cover crops, aimed by
 * `position`; `zoom` crops further); ratio="fill" draws no aspect-ratio at all, so CSS (a grid cell, a fixed height) sizes the box. Lazy by default; `eager` is for the first-screen
 * photo only (and asks for high priority). `as` is the box's tag ('span' inside a button). While it loads the box is the flat --paper-3 tone (nothing drawn, no shimmer, no fade);
 * if the file is missing or blocked the box keeps its exact shape and stays flat, with role="img" and the alt plus "(photo not available right now)".
 */
export function Photo({ img, ratio = '4 / 3', widths = [480, 800, 1200], sizes = '100vw', eager = false, as: Tag = 'div', fallback, class: cls, children, ...rest }) {
  useStore(selectImages);
  const [state, setState] = useState('loading'); // loading | loaded | failed
  const armed = useAfterLoad(eager);
  const src = photoSrc(img.key, widths[1] || widths[0]);
  // A new URL (edited in Settings) deserves a fresh try, even after the old one failed.
  const [seen, setSeen] = useState(src);
  if (seen !== src) { setSeen(src); setState('loading'); }
  const failed = state === 'failed' || !src;
  // A cached image can be complete before Preact's load listener is attached: settle it from the element itself.
  const settle = (el) => {
    if (!el || !armed || !el.complete || state !== 'loading') return;
    setState(el.naturalWidth > 0 ? 'loaded' : 'failed');
  };
  const style = (ratio && ratio !== 'fill' ? `aspect-ratio:${ratio};` : '') + (img.zoom ? `--zoom:${img.zoom};` : '');
  return html`
    <${Tag} class=${cx('lp-photo', failed ? 'is-failed' : state === 'loaded' ? 'is-loaded' : 'is-loading', img.zoom && 'has-zoom', cls)} style=${style || undefined} ...${rest}>
      ${failed
        ? html`<span class="lp-photo__ph" role="img" aria-label=${`${img.alt} (photo not available right now)`}></span>`
        : html`<img class="lp-photo__img" ref=${settle}
            src=${armed ? src : undefined} srcset=${armed ? srcsetFor(img.key, widths) : undefined} sizes=${sizes}
            width=${img.w} height=${img.h} alt=${img.alt}
            style=${img.position ? `object-position:${img.position}` : undefined}
            loading=${eager ? 'eager' : 'lazy'} fetchpriority=${eager ? 'high' : undefined} decoding="async" referrerpolicy="no-referrer"
            onLoad=${() => setState('loaded')} onError=${() => setState('failed')} />`}
      ${children}
    <//>
  `;
}

/**
 * His logo. The picture (1119x743, near-black card, "180 ELECTRICAL" lockup in the middle, corner stripes) is shown through a
 * crop window (.lp-logo in landing.css, --cx .2273 / --cy .3039 / --cw .5368 / --ch .3922: only the lockup is visible, so the red ELECTRICAL wordmark stays readable at header
 * size) and blended with `lighten`, so the card colour disappears into the near-black header or footer: no chip, no box.
 * Falls back to the earlier local crop (img/logo-180.png, same layout, so the same window fits).
 * `decorative` gives it an empty alt (when the business name is printed right beside it).
 */
export function LogoImg({ name, eager = false, decorative = false, class: cls }) {
  useStore(selectImages);
  const remote = photoSrc('logo', 960);
  const [broken, setBroken] = useState(false);
  const [seen, setSeen] = useState(remote);
  if (seen !== remote) { setSeen(remote); setBroken(false); }
  const src = broken || !remote ? LOGO_FALLBACK : remote;
  return html`
    <span class=${cx('lp-logo', cls)}>
      <img class="lp-logo__img" src=${src} alt=${decorative ? '' : name} width="1119" height="743"
        loading=${eager ? 'eager' : 'lazy'} fetchpriority=${eager ? 'high' : undefined} decoding="async" referrerpolicy="no-referrer"
        onError=${() => setBroken(true)} />
    </span>
  `;
}
