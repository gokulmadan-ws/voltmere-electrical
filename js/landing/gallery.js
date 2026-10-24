// js/landing/gallery.js: "Recent work" (a snap carousel on phones with ONE position indicator, the dots; a bento grid on desktop; each photo with a neutral caption chip, "Recent install")
// and its photo viewer (lightbox: an opaque scrim, big previous/next buttons). Owner: LP2 (landing page for 180 Electrical)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon, cx, useStore } from '../ui/index.js';
import { ABOUT, IMAGES } from './content.js';
import { reducedMotion } from './fx.js';
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
        <div class="lp-lb__frame">
          <div class=${cx('lp-lb__stage', status === 'loading' && !failed && 'is-loading')} onPointerDown=${onPointerDown} onPointerUp=${onPointerUp} onPointerCancel=${() => { swipe.current = null; }}>
            <img key=${`${item.key}-${failed}`} class=${cx('lp-lb__img', failed && 'is-ph')}
              src=${failed ? PLACEHOLDER_SRC : src} alt=${failed ? `${item.alt} (photo not available right now)` : item.alt}
              width=${item.w} height=${item.h} decoding="async" referrerpolicy="no-referrer" draggable=${false}
              onLoad=${() => setStatus((s) => (s === 'failed' ? s : 'loaded'))} onError=${() => setStatus('failed')} data-testid="l3-lightbox-img" />
          </div>
          <button type="button" class="lp-lb__btn lp-lb__nav lp-lb__nav--prev" onClick=${() => go(-1)} aria-label="Previous photo" data-testid="l3-lightbox-prev"><${Icon} name="chevron-left" size=${34} /></button>
          <button type="button" class="lp-lb__btn lp-lb__nav lp-lb__nav--next" onClick=${() => go(1)} aria-label="Next photo" data-testid="l3-lightbox-next"><${Icon} name="chevron-right" size=${34} /></button>
        </div>
        <figcaption class="lp-lb__caption" data-testid="l3-lightbox-caption">${item.title || item.alt}</figcaption>
      </figure>
    </div>
  `;
}

/**
 * Which card of the swipe row is "current": the one whose left edge is nearest the row's left padding edge, or the last one
 * once the row is scrolled to its end (the last card can never reach the left edge). 0 when nothing scrolls (the wide grid).
 */
function currentCard(list) {
  const cards = Array.from(list.children);
  if (!cards.length || list.scrollWidth - list.clientWidth <= 1) return 0;
  if (list.scrollLeft >= list.scrollWidth - list.clientWidth - 2) return cards.length - 1;
  const box = list.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
  let best = 0;
  let bestGap = Infinity;
  cards.forEach((card, i) => {
    const gap = Math.abs(card.getBoundingClientRect().left - box.left - pad);
    if (gap < bestGap) { best = i; bestGap = gap; }
  });
  return best;
}

export function Gallery() {
  const items = IMAGES.work;
  const [open, setOpen] = useState(-1);
  const [current, setCurrent] = useState(0);
  const tiles = useRef([]);
  const lastOpen = useRef(0);
  const listRef = useRef(null);

  // The swipe row reports where it is (the dots follow the scroll). One rAF-throttled passive listener.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    let queued = false;
    const read = () => { queued = false; setCurrent(currentCard(list)); };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(read); } };
    list.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    read();
    return () => { list.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  /** Scroll the row so card `i` sits at its left edge (smooth unless the visitor asked for less motion). */
  const goTo = (i) => {
    const list = listRef.current;
    const card = list && list.children[i];
    if (!card) return;
    const box = list.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
    list.scrollTo({ left: list.scrollLeft + card.getBoundingClientRect().left - box.left - pad, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

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
        <${SectionHead} eyebrow=${ABOUT.galleryEyebrow} title=${ABOUT.galleryTitle} titleId="work-title" center=${true} />
      </div>
      <ul class="lp-gallery" ref=${listRef} data-testid="l3-gallery-row">
        ${items.map((img, i) => html`<li class=${cx('lp-gallery__item', `lp-gallery__item--${i + 1}`)} key=${img.key} data-reveal="up" style=${`--i:${i}`}>
          <button type="button" class="lp-tile" ref=${(el) => { tiles.current[i] = el; }} onClick=${() => show(i)}
            aria-haspopup="dialog" aria-label=${`Open photo: ${img.title}`} data-testid=${`l3-gallery-open-${i}`}>
            <${Photo} as="span" img=${img} ratio="4 / 5" widths=${[360, 600, 900]} sizes="(min-width: 768px) 40vw, 80vw"
              class="lp-tile__photo" data-testid=${`gallery-photo-${i}`} />
            <span class="lp-tile__shade" aria-hidden="true"></span>
            <span class="lp-tile__chip" data-testid=${`gallery-chip-${i}`}>${img.chip}</span>
          </button>
        </li>`)}
      </ul>
      <div class="lp-gallery__dots" role="group" aria-label="Choose a photo" data-testid="gallery-dots">
        ${items.map((img, i) => html`<button type="button" class=${cx('lp-gallery__dot', i === current && 'is-current')} key=${img.key}
          aria-label=${`Show photo ${i + 1} of ${items.length}`} aria-current=${i === current ? 'true' : undefined}
          onClick=${() => goTo(i)} data-testid=${`gallery-dot-${i}`}><span aria-hidden="true"></span></button>`)}
      </div>
      ${open >= 0 ? html`<${Lightbox} items=${items} index=${open} onIndex=${show} onClose=${close} />` : null}
    </section>
  `;
}
