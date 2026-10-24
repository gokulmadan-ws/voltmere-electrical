// js/dashboard/shared/photos.js: photo thumbnails and lightbox for a booking, plus canvas helpers (resize a chosen file, make sample photos).
// Owner: E3
import { html, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Button, Sheet, loadCss } from '../../ui/index.js';
import { PHOTO_LIMITS } from '../../core/photos.js';

if (typeof document !== 'undefined') loadCss('css/bookings.css');

/** Thumbnails that open the lightbox. `photos` are { id, name, dataUrl }. */
export function PhotoGrid({ photos, onOpen, class: cls }) {
  return html`<ul class=${`sh-photos ${cls || ''}`} data-testid="detail-photo-grid">
    ${photos.map((p, i) => html`<li key=${p.id}>
      <button type="button" class="sh-photo" onClick=${() => onOpen(i)} data-testid=${`detail-photo-${i}`} aria-label=${`Open photo ${i + 1} of ${photos.length}: ${p.name}`}>
        <img src=${p.dataUrl} alt="" width="160" height="160" decoding="async" />
      </button>
    </li>`)}
  </ul>`;
}

/** Full-screen viewer with previous, next and remove. `index` null = closed. */
export function PhotoLightbox({ photos, index, onIndex, onClose, onRemove }) {
  const open = index !== null && index !== undefined && photos.length > 0;
  const i = open ? Math.min(index, photos.length - 1) : 0;
  const photo = open ? photos[i] : null;
  const closeRef = useRef(null);
  // The photo list shrinks when one is removed: keep the viewer on a photo that still exists, and close it when none are left.
  useEffect(() => {
    if (index !== null && index !== undefined && photos.length === 0) onClose();
    else if (open && index !== i) onIndex(i);
  }, [photos.length, index]);
  const footer = photo
    ? html`<div class="sh-lightbox__bar">
        <${Button} icon="arrow-left" onClick=${() => onIndex((i + photos.length - 1) % photos.length)} disabled=${photos.length < 2} data-testid="photo-prev">Previous<//>
        <${Button} icon="arrow-right" onClick=${() => onIndex((i + 1) % photos.length)} disabled=${photos.length < 2} data-testid="photo-next">Next<//>
        <${Button} variant="danger" icon="trash-2" onClick=${() => onRemove(photo)} data-testid="photo-remove">Remove<//>
      </div>`
    : null;
  return html`<${Sheet} open=${open} onClose=${onClose} title=${photo ? `Photo ${i + 1} of ${photos.length}` : 'Photo'} size="full" testid="photo-lightbox" footer=${footer}>
    ${photo ? html`<figure class="sh-lightbox">
      <img class="sh-lightbox__img" src=${photo.dataUrl} alt=${`Photo ${i + 1} of ${photos.length} from the customer: ${photo.name}`} data-testid="photo-lightbox-img" />
      <figcaption class="sh-lightbox__cap">${photo.name}</figcaption>
    </figure>` : null}
  <//>`;
}

// ---------- canvas helpers ----------

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

/** A chosen image file as a small JPEG data URL that the store accepts (<= PHOTO_LIMITS.maxDataUrlChars). Rejects when it cannot be made small enough. */
export async function fileToJpegDataUrl(file) {
  const bmp = await loadBitmap(file);
  const w0 = bmp.width || bmp.naturalWidth;
  const h0 = bmp.height || bmp.naturalHeight;
  for (const side of [900, 700, 540, 420]) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const q of [0.72, 0.58, 0.45]) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length <= PHOTO_LIMITS.maxDataUrlChars) return url;
    }
  }
  throw new Error('too_big');
}

/**
 * A chosen image file as a downscaled JPEG data URL for his website photos (Settings): about 1200px on the long side, shrunk further until it
 * is under `maxChars` so the store accepts it and localStorage keeps room for all seven. Rejects when it cannot be made small enough.
 */
export async function fileToWebsitePhoto(file, { maxSide = 1200, maxChars = 260000 } = {}) {
  const bmp = await loadBitmap(file);
  const w0 = bmp.width || bmp.naturalWidth;
  const h0 = bmp.height || bmp.naturalHeight;
  for (const side of [maxSide, 1000, 800, 640, 480]) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const q of [0.78, 0.66, 0.54, 0.42]) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length <= maxChars) return url;
    }
  }
  throw new Error('too_big');
}

/** Generated stand-ins for a customer's photos (a consumer unit, a wall and drive). Plain drawings, labelled as samples by their names. */
export function makeSamplePhotos(count = 2) {
  const draw = (kind) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 360;
    const c = canvas.getContext('2d');
    c.fillStyle = 'rgb(58 60 66)'; c.fillRect(0, 0, 480, 360);
    if (kind === 'unit') {
      c.fillStyle = 'rgb(226 224 218)'; c.fillRect(110, 50, 260, 260);
      c.fillStyle = 'rgb(40 42 46)'; c.fillRect(130, 70, 220, 60);
      for (let i = 0; i < 8; i += 1) {
        c.fillStyle = i === 0 ? 'rgb(225 20 20)' : 'rgb(30 30 34)';
        c.fillRect(134 + i * 27, 150, 20, 60);
        c.fillStyle = 'rgb(240 240 240)'; c.fillRect(138 + i * 27, 160, 12, 18);
      }
      c.fillStyle = 'rgb(30 30 34)'; c.fillRect(134, 230, 212, 50);
    } else {
      c.fillStyle = 'rgb(150 82 62)'; c.fillRect(0, 0, 480, 250);
      c.strokeStyle = 'rgb(120 62 46)'; c.lineWidth = 2;
      for (let y = 20; y < 250; y += 28) { c.beginPath(); c.moveTo(0, y); c.lineTo(480, y); c.stroke(); }
      c.fillStyle = 'rgb(120 122 128)'; c.fillRect(0, 250, 480, 110);
      c.setLineDash([10, 8]); c.strokeStyle = 'rgb(255 255 255)'; c.lineWidth = 3; c.strokeRect(250, 70, 90, 120);
    }
    return canvas.toDataURL('image/jpeg', 0.6);
  };
  const kinds = [['unit', 'Consumer unit (sample photo)'], ['wall', 'Charger spot (sample photo)']];
  return Array.from({ length: Math.min(count, kinds.length) }, (_, i) => ({ name: kinds[i][1], dataUrl: draw(kinds[i][0]) }));
}

