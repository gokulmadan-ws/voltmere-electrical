// js/landing/gallery.js: "Our recent work" (swipe row on phones, four-up grid on desktop) and its photo viewer (lightbox).
// Owner: L3 (landing page for 180 Electrical)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon, cx, useStore } from '../ui/index.js';
import { ABOUT, IMAGES } from './content.js';
import { PLACEHOLDER_SRC, Photo, photoSrc, selectImages } from './media.js';
import { SectionHead } from './sections.js';

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The photo viewer. A modal dialog: focus moves to Close and is trapped inside, Esc closes, Left/Right (and a swipe, and
 * the two round buttons) move between the photos, the page behind does not scroll, and focus goes back to the photo that
 * opened it. It shows the whole photo (contain), not the tile's crop.
 */
function Lightbox({ items, index, onIndex, onClose }) {
  useStore(selectImages);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const live = useRef({ index, onIndex, onClose });
  live.current = { index, onIndex, onClose };
  const swipe = useRef(null);
  const item = items[index];
  const count = items.length;
  // Load state belongs to ONE photo: moving to another photo starts from "loading" in the same render (no stale placeholder frame).
  const [load, setLoad] = useState({ key: item.key, status: 'loading' }); // status: loading | loaded | failed
  const status = load.key === item.key ? load.status : 'loading';
  const setStatus = (next) => setLoad((cur) => ({ key: item.key, status: typeof next === 'function' ? next(cur.key === item.key ? cur.status : 'loading') : next }));

  const go = (step) => live.current.onIndex((live.current.index + step + count) % count);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('is-scroll-locked');
    if (closeRef.current) closeRef.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); live.current.onClose(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); root.classList.remove('is-scroll-locked'); };
  }, []);

  // A new photo starts as "loading"; the neighbours are fetched ahead so a swipe feels instant.
  useEffect(() => {
    for (const step of [1, -1]) {
      const near = items[(index + step + count) % count];
      const url = near && photoSrc(near.key, 1400);
      if (url) { const pre = new Image(); pre.referrerPolicy = 'no-referrer'; pre.src = url; }
    }
  }, [index]);

  const src = photoSrc(item.key, 1400);
  const failed = status === 'failed' || !src;
  const onPointerDown = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  };

  return html`
    <div class="lp-lb" role="dialog" aria-modal="true" aria-label="Photo viewer" ref=${dialogRef} data-testid="l3-lightbox"
      onClick=${(e) => { if (!(e.target.closest && e.target.closest('.lp-lb__img, .lp-lb__btn, .lp-lb__caption, .lp-lb__count'))) onClose(); }}>
      <div class="lp-lb__top">
        <p class="lp-lb__count" aria-live="polite" data-testid="l3-lightbox-count">Photo ${index + 1} of ${count}</p>
        <button type="button" class="lp-lb__btn lp-lb__close" ref=${closeRef} onClick=${onClose} aria-label="Close photo viewer" data-testid="l3-lightbox-close">
          <${Icon} name="x" size=${24} />
        </button>
      </div>
      <figure class="lp-lb__figure">
        <div class=${cx('lp-lb__stage', status === 'loading' && !failed && 'is-loading')} onPointerDown=${onPointerDown} onPointerUp=${onPointerUp} onPointerCancel=${() => { swipe.current = null; }}>
          <img key=${`${item.key}-${failed}`} class=${cx('lp-lb__img', failed && 'is-ph')}
            src=${failed ? PLACEHOLDER_SRC : src} alt=${failed ? `${item.alt} (photo not available right now)` : item.alt}
            width=${item.w} height=${item.h} decoding="async" referrerpolicy="no-referrer" draggable=${false}
            onLoad=${() => setStatus((s) => (s === 'failed' ? s : 'loaded'))} onError=${() => setStatus('failed')} data-testid="l3-lightbox-img" />
        </div>
        <figcaption class="lp-lb__caption">${item.alt}</figcaption>
      </figure>
      <button type="button" class="lp-lb__btn lp-lb__nav lp-lb__nav--prev" onClick=${() => go(-1)} aria-label="Previous photo" data-testid="l3-lightbox-prev"><${Icon} name="chevron-left" size=${26} /></button>
      <button type="button" class="lp-lb__btn lp-lb__nav lp-lb__nav--next" onClick=${() => go(1)} aria-label="Next photo" data-testid="l3-lightbox-next"><${Icon} name="chevron-right" size=${26} /></button>
    </div>
  `;
}

export function Gallery() {
  const items = IMAGES.work;
  const [open, setOpen] = useState(-1);
  const tiles = useRef([]);
  const lastOpen = useRef(0);

  const show = (i) => { lastOpen.current = i; setOpen(i); };
  const close = () => {
    const back = open >= 0 ? open : lastOpen.current;
    setOpen(-1);
    // Focus returns to the tile of the photo that was on screen (after the dialog has gone).
    setTimeout(() => { const t = tiles.current[back]; if (t && t.focus) t.focus(); }, 0);
  };

  return html`
    <section class="lp-section lp-section--gallery" id="work" aria-labelledby="work-title" data-testid="gallery">
      <div class="lp-container">
        <${SectionHead} eyebrow=${ABOUT.galleryEyebrow} title=${ABOUT.galleryTitle} titleId="work-title" level=${3} />
      </div>
      <ul class="lp-gallery" data-testid="l3-gallery-row">
        ${items.map((img, i) => html`<li class="lp-gallery__item" key=${img.key} data-reveal="up" style=${`--i:${i}`}>
          <button type="button" class="lp-tile" ref=${(el) => { tiles.current[i] = el; }} onClick=${() => show(i)}
            aria-haspopup="dialog" data-testid=${`l3-gallery-open-${i}`}>
            <${Photo} as="span" img=${img} ratio="4 / 5" widths=${[360, 600, 900]} sizes="(min-width: 768px) 25vw, 70vw"
              class="lp-tile__photo" data-testid=${`gallery-photo-${i}`} />
            <span class="lp-tile__zoom" aria-hidden="true"><${Icon} name="search" size=${18} /></span>
          </button>
        </li>`)}
      </ul>
      <div class="lp-container"><p class="lp-gallery__hint">Select a photo to see it full size.</p></div>
      ${open >= 0 ? html`<${Lightbox} items=${items} index=${open} onIndex=${show} onClose=${close} />` : null}
    </section>
  `;
}
