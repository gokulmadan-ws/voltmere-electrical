// js/core/photos.js: limits and validation for the photos a customer (or the owner) attaches to an enquiry
// Owner: A3 core
import { makeId } from './format.js';

export const PHOTO_LIMITS = { maxPhotos: 3, maxDataUrlChars: 70000 };

const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

function cleanName(name) {
  const text = String(name === null || name === undefined ? '' : name)
    .replace(/[\\/]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 60);
}

/** '' when `photo` is acceptable, otherwise the reason in plain words. */
export function validatePhoto(photo) {
  if (!photo || typeof photo !== 'object') return 'Choose a photo.';
  if (typeof photo.dataUrl !== 'string' || !JPEG_DATA_URL.test(photo.dataUrl)) return 'Photos must be JPEG pictures.';
  if (photo.dataUrl.length > PHOTO_LIMITS.maxDataUrlChars) return 'That photo is too big. Try a smaller one.';
  if (!cleanName(photo.name)) return 'The photo needs a name.';
  return '';
}

/**
 * Keep the valid photos in order, up to the room left (`existing` photos already held), with clean names and ids.
 * `dropped` counts every photo that was refused (invalid or no room).
 */
export function normalisePhotos(list, { existing = 0 } = {}) {
  const input = Array.isArray(list) ? list : [];
  const room = Math.max(0, PHOTO_LIMITS.maxPhotos - existing);
  const photos = [];
  for (const photo of input) {
    if (photos.length >= room) break;
    if (validatePhoto(photo)) continue;
    photos.push({ id: typeof photo.id === 'string' && photo.id ? photo.id.slice(0, 40) : makeId('ph'), name: cleanName(photo.name), dataUrl: photo.dataUrl });
  }
  return { photos, dropped: input.length - photos.length };
}
