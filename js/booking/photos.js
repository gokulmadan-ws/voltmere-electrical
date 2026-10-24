// js/booking/photos.js: shrink photos in the browser (canvas, JPEG) and the optional "Add photos now" card on the confirmation screen.
// Owner: D3
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon, Button, cx } from '../ui/index.js';
import * as store from '../core/store.js'; // namespace import: addBookingPhotos / removeBookingPhoto are A3's, resolved at call time
import { PHOTO_LIMITS } from '../core/photos.js';
import { waLink } from '../core/messages.js';
import { firstName } from '../core/format.js';

export const PHOTO_MAX_SIDE = 900; // pixels on the long side: plenty for an electrician to read a consumer unit, small enough to store
const QUALITIES = [0.7, 0.6, 0.5, 0.4, 0.3];

/** Decode a File into something drawImage accepts. createImageBitmap applies the EXIF rotation (phone photos are often "sideways"). */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = null; }
    if (!bmp) { try { bmp = await createImageBitmap(file); } catch (e) { bmp = null; } }
    if (bmp) return { source: bmp, width: bmp.width, height: bmp.height, release: () => { if (bmp.close) bmp.close(); } };
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/** 'IMG_2041.HEIC' -> 'IMG_2041.jpg' (the core wants a short name and a JPEG). */
function jpegName(file, index) {
  const base = String(file && file.name ? file.name : '').replace(/\.[^.]*$/, '').replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
  return `${base || `photo-${index + 1}`}.jpg`;
}

/**
 * Shrink one picture to at most `maxSide` px on the long side and a JPEG data URL of at most `maxChars` characters:
 * quality 0.7 first, lower quality until it fits, then a smaller picture. Throws when the file is not a picture or cannot fit.
 */
export async function downscalePhoto(file, { maxSide = PHOTO_MAX_SIDE, maxChars = PHOTO_LIMITS.maxDataUrlChars, index = 0 } = {}) {
  const src = await decode(file);
  try {
    if (!src.width || !src.height) throw new Error('decode');
    let scale = Math.min(1, maxSide / Math.max(src.width, src.height));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const w = Math.max(1, Math.round(src.width * scale));
      const h = Math.max(1, Math.round(src.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      g.fillStyle = '#ffffff'; // a PNG with transparency would turn black in a JPEG
      g.fillRect(0, 0, w, h);
      g.drawImage(src.source, 0, 0, w, h);
      for (const q of QUALITIES) {
        const dataUrl = canvas.toDataURL('image/jpeg', q);
        if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('encode');
        if (dataUrl.length <= maxChars) return { name: jpegName(file, index), dataUrl, width: w, height: h };
      }
      scale *= 0.8; // lowest quality is still too big: shrink the picture itself and go round again
    }
    throw new Error('too_big');
  } finally {
    src.release();
  }
}

let keySeq = 0;

/**
 * "Add photos now": up to three photos for the enquiry. Pick or take them, see thumbnails (each can be removed), send.
 * Sent photos are saved on the booking in this browser (a real build would upload them): the card says so.
 */
export function PhotoCard({ booking, brand }) {
  const [pending, setPending] = useState([]); // chosen but not sent: { key, name, dataUrl }
  const [busy, setBusy] = useState(false); // shrinking pictures
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState(null); // { tone: 'ok' | 'error', text, whatsapp? }
  const choose = useRef(null);
  const camera = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const saved = Array.isArray(booking.photos) ? booking.photos : [];
  const room = Math.max(0, PHOTO_LIMITS.maxPhotos - saved.length - pending.length);
  const full = room === 0;
  const first = firstName(booking.customer.name);
  const waHref = waLink(brand.phone, `Hi ${brand.ownerFirst}, it's ${first}, enquiry ${booking.ref}. Here are photos of my consumer unit and where I'd like the charger.`, brand.demoPhoneDigits);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // so the same photo can be picked again after removing it
    if (!files.length) return;
    setNote(null);
    setBusy(true);
    const take = files.slice(0, room);
    const added = [];
    let unreadable = 0;
    for (let i = 0; i < take.length; i += 1) {
      try {
        const p = await downscalePhoto(take[i], { index: saved.length + pending.length + added.length });
        keySeq += 1;
        added.push({ key: `p${keySeq}`, name: p.name, dataUrl: p.dataUrl });
      } catch (err) {
        unreadable += 1;
      }
    }
    if (!alive.current) return;
    setBusy(false);
    if (added.length) setPending((prev) => [...prev, ...added].slice(0, Math.max(0, PHOTO_LIMITS.maxPhotos - saved.length)));
    if (unreadable) setNote({ tone: 'error', text: unreadable === 1 ? "We couldn't read that photo. Please try a different one." : `We couldn't read ${unreadable} of those photos. Please try different ones.` });
    else if (files.length > take.length) setNote({ tone: 'neutral', text: `Up to ${PHOTO_LIMITS.maxPhotos} photos fit, so we kept the first ${take.length}.` });
  };

  const remove = (key) => { setPending((prev) => prev.filter((p) => p.key !== key)); setNote(null); };

  const removeSaved = (id) => {
    if (typeof store.removeBookingPhoto !== 'function') return;
    const res = store.removeBookingPhoto(booking.id, id);
    if (!res.ok) setNote({ tone: 'error', text: "That photo couldn't be removed. Please try again." });
    else setNote(null);
  };

  const send = () => {
    if (!pending.length || sending) return;
    if (typeof store.addBookingPhotos !== 'function') { setNote({ tone: 'error', text: "Photos can't be sent from this build yet.", whatsapp: true }); return; }
    setSending(true);
    const res = store.addBookingPhotos(booking.id, pending.map((p) => ({ name: p.name, dataUrl: p.dataUrl })));
    setSending(false);
    if (res.ok) {
      setPending([]);
      const n = res.added;
      const dropped = res.dropped ? ` ${res.dropped} could not be added.` : '';
      setNote({ tone: 'ok', text: `${n === 1 ? 'Your photo is' : `Your ${n} photos are`} added to your enquiry for ${brand.ownerFirst}.${dropped}` });
      return;
    }
    if (res.reason === 'storage_full') {
      setNote({ tone: 'error', text: `There is no room left on this device to save those photos. Your photos are still here: try one or two, or send them to ${brand.ownerFirst} on WhatsApp.`, whatsapp: true });
    } else if (res.reason === 'too_many') {
      setNote({ tone: 'error', text: `You have already sent ${PHOTO_LIMITS.maxPhotos} photos, which is the most we can take here. Anything else, send to ${brand.ownerFirst} on WhatsApp.`, whatsapp: true });
      setPending([]);
    } else if (res.reason === 'not_found') {
      setNote({ tone: 'error', text: `We couldn't find your enquiry any more. Please call ${brand.ownerFirst} on ${brand.phone}.` });
    } else {
      setNote({ tone: 'error', text: `Those photos weren't accepted. Try different ones, or send them to ${brand.ownerFirst} on WhatsApp.`, whatsapp: true });
    }
  };

  const slots = saved.length + pending.length;
  return html`<section class="bk-photos" data-testid="photos-card" aria-labelledby="bk-photos-title">
    <div class="bk-photos__head">
      <span class="bk-photos__icon" aria-hidden="true"><${Icon} name="camera" size=${22} /></span>
      <div class="bk-photos__titles">
        <h3 class="bk-photos__title" id="bk-photos-title">Add photos now</h3>
        <p class="bk-photos__opt">Optional</p>
      </div>
    </div>
    <p class="bk-photos__text">A photo of your consumer unit and where you'd like the charger helps the team prepare your quote.</p>
    ${slots > 0 ? html`<ul class="bk-photos__grid" data-testid="photos-grid">
      ${saved.map((p, i) => html`<li key=${p.id} class="bk-thumb is-saved" data-testid=${`photos-saved-${i}`}>
        <img src=${p.dataUrl} alt=${`Photo ${i + 1}, sent`} width="120" height="120" decoding="async" />
        <span class="bk-thumb__badge" aria-hidden="true"><${Icon} name="check" size=${14} /></span>
        <button type="button" class="bk-thumb__x" onClick=${() => removeSaved(p.id)} aria-label=${`Remove photo ${i + 1}`} data-testid=${`photo-remove-saved-${i}`}><${Icon} name="x" size=${16} /></button>
      </li>`)}
      ${pending.map((p, i) => html`<li key=${p.key} class="bk-thumb" data-testid=${`photo-thumb-${i}`}>
        <img src=${p.dataUrl} alt=${`Photo ${saved.length + i + 1}, ready to send`} width="120" height="120" decoding="async" />
        <button type="button" class="bk-thumb__x" onClick=${() => remove(p.key)} aria-label=${`Remove photo ${saved.length + i + 1}`} data-testid=${`photo-remove-${i}`}><${Icon} name="x" size=${16} /></button>
      </li>`)}
      ${busy ? html`<li class="bk-thumb is-busy" aria-hidden="true"><span class="bk-thumb__spin"></span></li>` : null}
    </ul>` : null}
    <div class="bk-photos__pick">
      <${Button} variant="secondary" size="md" icon="camera" disabled=${full || busy} onClick=${() => camera.current && camera.current.click()} data-testid="photos-camera">Take a photo<//>
      <${Button} variant="secondary" size="md" icon="image" disabled=${full || busy} onClick=${() => choose.current && choose.current.click()} data-testid="photos-choose">Choose photos<//>
    </div>
    <input ref=${choose} type="file" accept="image/*" multiple hidden tabindex="-1" onChange=${onFiles} data-testid="photos-input" />
    <input ref=${camera} type="file" accept="image/*" capture="environment" hidden tabindex="-1" onChange=${onFiles} data-testid="photos-camera-input" />
    ${pending.length > 0 ? html`<${Button} variant="primary" size="lg" block class="bk-pill" loading=${sending} onClick=${send} data-testid="photos-send">${pending.length === 1 ? 'Send photo' : 'Send photos'}<//>` : null}
    <p class=${cx('bk-photos__hint', note && `bk-photos__hint--${note.tone}`)} role=${note && note.tone === 'error' ? 'alert' : 'status'} data-testid="photos-status">${note
    ? html`<${Icon} name=${note.tone === 'ok' ? 'circle-check' : note.tone === 'error' ? 'circle-alert' : 'info'} size=${18} />${' '}<span>${note.text}</span>`
    : (saved.length ? `${saved.length} of ${PHOTO_LIMITS.maxPhotos} photos sent.` : `Up to ${PHOTO_LIMITS.maxPhotos} photos. They are made smaller on your phone first.`)}</p>
    ${note && note.whatsapp ? html`<${Button} variant="secondary" icon="message-circle" href=${waHref} data-testid="photos-whatsapp">Send them on WhatsApp instead<//>` : null}
    <p class="bk-photos__sim" data-testid="photos-sim">Prototype: photos stay on this device. A live build would upload them securely.</p>
  </section>`;
}
