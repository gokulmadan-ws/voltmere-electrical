// js/landing/gallery.js: "Our recent work" as a printed plate. From 1024 a 12 x 2 grid: row 1 = the heading cell | photo 01 | photo 02, row 2 = photo 03 (landscape, fills its row) | photo 04.
// Below that a film strip (the next photo always peeks, snap-x, no scrollbar) with four pager ticks that follow the scroll (the first drawn tick sits on the page margin, each is a 44px tap area)
// and a "1 of 4" counter at the right margin. Every photo has a numbered caption UNDER it that names only the wall
// ("01 Red brick wall"); nothing is ever laid over a photograph. Press or Enter opens the viewer: full-screen black, the whole photo (contain), "Photo N of 4", a text Close button and
// outlined Previous and Next squares. The viewer keeps its logic (focus trap, Esc, arrows, swipe, neighbour prefetch, scroll lock, focus back to the tile).
// Owner: B2 (landing V5, docs/LANDING-V5.md 4.8 and 5.6)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { cx } from '../ui/util.js';
import { useStore } from '../ui/hooks.js';
import { IMAGES } from './content.js';
import { WORK } from './copy.js';
import { reducedMotion } from './fx.js';
import { Glyph } from './glyphs.js';
import { Photo, photoSrc, selectImages } from './media.js';

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** The wall type of one photo ("Red brick wall"): the caption field, without any leading number. */
const wallOf = (img) => String(img.caption || img.title || '').replace(/^\d+\s*/, '');
const two = (n) => String(n).padStart(2, '0');

/**
 * The photo viewer. A modal dialog: focus moves to Close and is trapped inside, Esc closes, Left/Right (and a swipe, and the two outlined buttons) move between the photos, the page behind
 * does not scroll, and focus goes back to the photo that opened it. It shows the whole photo (contain), never the tile's crop.
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
  // Load state belongs to ONE photo: moving to another photo starts from "loading" in the same render (no stale frame).
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

  // The neighbours are fetched ahead so a swipe feels instant (and only the two neighbours).
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
    <div class="lp-lb" role="dialog" aria-modal="true" aria-label=${WORK.viewer} ref=${dialogRef} data-testid="l3-lightbox"
      onClick=${(e) => { if (!(e.target.closest && e.target.closest('.lp-lb__img, .lp-lb__ph, .lp-lb__nav, .lp-lb__close, .lp-lb__caption, .lp-lb__count'))) onClose(); }}>
      <div class="lp-lb__top">
        <p class="lp-lb__count" aria-live="polite" data-testid="l3-lightbox-count">Photo ${index + 1} of ${count}</p>
        <button type="button" class="lp-lb__close" ref=${closeRef} onClick=${onClose} aria-label="Close photo viewer" data-testid="l3-lightbox-close">Close</button>
      </div>
      <figure class="lp-lb__figure">
        <div class="lp-lb__frame">
          <div class=${cx('lp-lb__stage', status === 'loading' && !failed && 'is-loading')} onPointerDown=${onPointerDown} onPointerUp=${onPointerUp} onPointerCancel=${() => { swipe.current = null; }}>
            ${failed
              ? html`<span key=${`${item.key}-ph`} class="lp-lb__ph" role="img" aria-label=${`${item.alt} (photo not available right now)`} style=${`aspect-ratio:${item.w} / ${item.h}`} data-testid="l3-lightbox-img"></span>`
              : html`<img key=${item.key} class="lp-lb__img" src=${src} alt=${item.alt} width=${item.w} height=${item.h} decoding="async" referrerpolicy="no-referrer" draggable=${false}
                  onLoad=${() => setStatus((s) => (s === 'failed' ? s : 'loaded'))} onError=${() => setStatus('failed')} data-testid="l3-lightbox-img" />`}
          </div>
          <button type="button" class="lp-lb__nav lp-lb__nav--prev" onClick=${() => go(-1)} aria-label="Previous photo" data-testid="l3-lightbox-prev"><${Glyph} name="arrow" size=${24} /></button>
          <button type="button" class="lp-lb__nav lp-lb__nav--next" onClick=${() => go(1)} aria-label="Next photo" data-testid="l3-lightbox-next"><${Glyph} name="arrow" size=${24} /></button>
        </div>
        <figcaption class="lp-lb__caption" data-testid="l3-lightbox-caption">${wallOf(item) || item.alt}</figcaption>
      </figure>
    </div>
  `;
}

/**
 * Which photo of the film strip is "current": the one whose left edge is nearest the strip's left padding edge, or the last one once the strip is scrolled to its end (the last
 * photo can never reach the left edge). 0 when nothing scrolls (the plate from 1024).
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

  // The film strip reports where it is (the ticks follow the scroll). One rAF-throttled passive listener.
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

  /** Scroll the strip so photo `i` sits at its left edge (smooth unless the visitor asked for less motion). */
  const goTo = (i) => {
    const list = listRef.current;
    const card = list && list.children[i];
    if (!card) return;
    const box = list.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
    list.scrollTo({ left: list.scrollLeft + card.getBoundingClientRect().left - box.left - pad, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  // "1 of 4": the pager's counter (read by nobody: the ticks already say which photo is current), so the unlabelled ticks read as an indicator.
  const counter = `${current + 1} of ${items.length}`;

  const show = (i) => { lastOpen.current = i; setOpen(i); };
  const close = () => {
    const back = open >= 0 ? open : lastOpen.current;
    setOpen(-1);
    // Focus returns to the tile of the photo that was on screen (after the dialog has gone).
    setTimeout(() => { const t = tiles.current[back]; if (t && t.focus) t.focus(); }, 0);
  };

  return html`
    <section class="lp-sec" id="work" aria-labelledby="work-title" data-testid="gallery">
      <div class="lp-wrap lp-sec__in">
        <div class="lp-plate">
          <div class="lp-plate__head">
            <p class="lp-lbl">${WORK.label}</p>
            <h2 class="lp-h2 lp-h2--s lp-display" id="work-title">${WORK.title}</h2>
          </div>
          <ul class="lp-gal" role="list" aria-label=${WORK.listLabel} ref=${listRef} data-testid="l3-gallery-row">
            ${items.map((img, i) => html`<li class=${cx('lp-gal__i', `lp-gal__i--${i + 1}`)} key=${img.key}>
              <figure>
                <button type="button" class="lp-gal__b" ref=${(el) => { tiles.current[i] = el; }} onClick=${() => show(i)}
                  aria-haspopup="dialog" aria-label=${`View photo ${i + 1} of ${items.length} larger`} data-testid=${`l3-gallery-open-${i}`}>
                  <${Photo} as="span" img=${img} ratio="fill" widths=${[360, 600, 900]}
                    sizes=${img.w >= img.h ? '(min-width: 1024px) 62vw, 460px' : '(min-width: 1024px) 31vw, 258px'}
                    class="lp-gal__photo" data-testid=${`gallery-photo-${i}`} />
                </button>
                <figcaption class="lp-gal__cap" data-testid=${`gallery-chip-${i}`}><span class="lp-gal__n">${two(i + 1)}</span>${' '}${wallOf(img)}</figcaption>
              </figure>
            </li>`)}
          </ul>
          <div class="lp-gal__dots" role="group" aria-label=${WORK.dotsLabel} data-testid="gallery-dots">
            ${items.map((img, i) => html`<button type="button" class=${cx('lp-gal__dot', i === current && 'is-current')} key=${img.key}
              aria-label=${`Show photo ${i + 1} of ${items.length}`} aria-current=${i === current ? 'true' : undefined}
              onClick=${() => goTo(i)} data-testid=${`gallery-dot-${i}`}><span aria-hidden="true"></span></button>`)}
            <span class="lp-gal__count" aria-hidden="true" data-testid="gallery-count">${counter}</span>
          </div>
        </div>
      </div>
      ${open >= 0 ? html`<${Lightbox} items=${items} index=${open} onIndex=${show} onClose=${close} />` : null}
    </section>
  `;
}
