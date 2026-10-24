// tests/unit/photos.test.mjs: unit tests for js/core/photos.js (limits and validation of the photos on an enquiry)
// Owner: A3 core
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_LIMITS, normalisePhotos, validatePhoto } from '../../js/core/photos.js';

const jpeg = (chars = 40) => `data:image/jpeg;base64,${'A'.repeat(chars - 'data:image/jpeg;base64,'.length)}`;
const photo = (over = {}) => ({ id: 'ph_1', name: 'consumer-unit.jpg', dataUrl: jpeg(), ...over });

test('the limits are three photos and 70,000 characters each', () => {
  assert.deepEqual(PHOTO_LIMITS, { maxPhotos: 3, maxDataUrlChars: 70000 });
});

test('validatePhoto: a JPEG data URL up to 70,000 characters with a name is fine', () => {
  assert.equal(validatePhoto(photo()), '');
  assert.equal(validatePhoto(photo({ dataUrl: jpeg(70000) })), '', 'exactly at the limit');
  assert.equal(validatePhoto({ name: 'x', dataUrl: 'data:image/jpeg;base64,QUJD' }), '', 'an id is optional');
  assert.equal(validatePhoto(photo({ dataUrl: 'data:image/jpeg;base64,QUJD==' })), '', 'base64 padding');
});

test('validatePhoto: anything else is refused with a plain reason', () => {
  assert.match(validatePhoto(photo({ dataUrl: jpeg(70001) })), /too big/);
  assert.match(validatePhoto(photo({ dataUrl: 'data:image/png;base64,QUJD' })), /JPEG/);
  assert.match(validatePhoto(photo({ dataUrl: 'https://example.com/a.jpg' })), /JPEG/);
  assert.match(validatePhoto(photo({ dataUrl: 'data:image/jpeg;base64,' })), /JPEG/, 'empty payload');
  assert.match(validatePhoto(photo({ dataUrl: 'data:image/jpeg;base64,<script>' })), /JPEG/);
  assert.match(validatePhoto(photo({ dataUrl: 'data:image/jpeg,QUJD' })), /JPEG/, 'not base64');
  assert.match(validatePhoto(photo({ dataUrl: 42 })), /JPEG/);
  assert.match(validatePhoto(photo({ name: '' })), /name/);
  assert.match(validatePhoto(photo({ name: '   ' })), /name/);
  assert.match(validatePhoto(photo({ name: '///' })), /name/, 'a name that is only separators is empty once cleaned');
  for (const v of [null, undefined, 'photo', 3, []]) assert.match(validatePhoto(v), /photo/i, String(v));
});

test('normalisePhotos keeps the valid ones in order, up to the room left, and counts what it dropped', () => {
  const list = [photo({ id: 'a' }), photo({ id: 'b', dataUrl: 'data:image/png;base64,QUJD' }), photo({ id: 'c' }), photo({ id: 'd' }), photo({ id: 'e' })];
  const { photos, dropped } = normalisePhotos(list);
  assert.deepEqual(photos.map((p) => p.id), ['a', 'c', 'd'], 'the invalid one is skipped and the cap is three');
  assert.equal(dropped, 2, 'one invalid, one over the cap');
  const some = normalisePhotos(list, { existing: 2 });
  assert.deepEqual(some.photos.map((p) => p.id), ['a']);
  assert.equal(some.dropped, 4);
  assert.deepEqual(normalisePhotos(list, { existing: 3 }), { photos: [], dropped: 5 });
  assert.deepEqual(normalisePhotos([]), { photos: [], dropped: 0 });
  assert.deepEqual(normalisePhotos(undefined), { photos: [], dropped: 0 });
  assert.deepEqual(normalisePhotos('nope'), { photos: [], dropped: 0 });
});

test('normalisePhotos cleans names, gives missing ids, and does not mutate its input', () => {
  const input = [{ name: '  C:\\temp\\my photo.jpg  ', dataUrl: jpeg() }, { id: 'x'.repeat(100), name: 'n'.repeat(200), dataUrl: jpeg() }];
  const before = JSON.stringify(input);
  const { photos } = normalisePhotos(input);
  assert.match(photos[0].id, /^ph_[0-9a-z]{8}$/);
  assert.equal(photos[0].name, 'C: temp my photo.jpg', 'path separators become spaces');
  assert.equal(photos[1].id.length, 40, 'a long id is cut');
  assert.equal(photos[1].name.length, 60, 'a long name is cut');
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(Object.keys(photos[0]).sort(), ['dataUrl', 'id', 'name'], 'only id, name and dataUrl are kept');
});
