// tests/unit/images.test.mjs: unit tests for his photos in config.js (business.images defaults, imageUrl) and selectImageUrl
// Owner: A3 core
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_IMAGES, IMAGE_KEYS, IMAGE_META, imageUrl, makeDefaultBusiness, makeDefaultSettings } from '../../js/core/config.js';
import { selectBrand, selectImageUrl } from '../../js/core/selectors.js';

test('the seven keys and their URLs are exactly the ones in docs/reference/180-images.md', () => {
  assert.deepEqual(IMAGE_KEYS, ['logo', 'hero', 'about', 'work1', 'work2', 'work3', 'work4']);
  assert.deepEqual(Object.keys(DEFAULT_IMAGES), IMAGE_KEYS);
  assert.equal(DEFAULT_IMAGES.logo, 'https://perspective.imgix.net/6ac64662b8d25e3fced4de9e.jpeg?w=2000&h=2000&fit=max&fm=jpg');
  assert.equal(DEFAULT_IMAGES.hero, 'https://images.unsplash.com/photo-1704475386627-dcfcd97ed51a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wyMjcwN3wwfDF8YWxsfHx8fHx8fHx8MTc4OTI5NjM4Nnw&ixlib=rb-4.1.0&q=80&w=1080');
  assert.equal(DEFAULT_IMAGES.work1, 'https://perspective.imgix.net/6ac64c7dfd2652fd454c9753.jpeg');
  assert.equal(DEFAULT_IMAGES.work2, 'https://perspective.imgix.net/6ac64c898c0de982eaa037ce.jpeg');
  assert.equal(DEFAULT_IMAGES.work3, 'https://perspective.imgix.net/6abce0349736daf21b921061.jpeg');
  assert.ok(DEFAULT_IMAGES.about.startsWith('https://perspective.imgix.net/6ac64bf1b8d25e3fced53c3e.jpeg?'));
  assert.ok(DEFAULT_IMAGES.work4.startsWith('https://perspective.imgix.net/6abb7d69173b2b4f1bfd30e9.jpeg?'));
  for (const url of Object.values(DEFAULT_IMAGES)) {
    const host = new URL(url).hostname;
    assert.ok(host === 'perspective.imgix.net' || host === 'images.unsplash.com', `only the two allowed image hosts: ${host}`);
  }
});

test('business.images defaults come from the factory (a fresh copy each call) and business.address is empty', () => {
  const a = makeDefaultBusiness();
  assert.deepEqual(a.images, DEFAULT_IMAGES);
  assert.notEqual(a.images, DEFAULT_IMAGES);
  assert.equal(a.address, '', 'his site gives no street address');
  a.images.hero = 'changed';
  assert.equal(makeDefaultBusiness().images.hero, DEFAULT_IMAGES.hero);
  assert.deepEqual(makeDefaultSettings().business.images, DEFAULT_IMAGES);
});

test('IMAGE_META has an alt text and the intrinsic size for every key', () => {
  assert.deepEqual(Object.keys(IMAGE_META), IMAGE_KEYS);
  for (const [key, meta] of Object.entries(IMAGE_META)) {
    assert.ok(meta.label && meta.alt.length > 10, key);
    assert.ok(Number.isInteger(meta.width) && Number.isInteger(meta.height) && meta.width > 0 && meta.height > 0, key);
    assert.ok(!/zappi|ohme|fox/i.test(meta.alt), `${key}: no product claim in the alt text`);
  }
  assert.deepEqual([IMAGE_META.logo.width, IMAGE_META.logo.height], [1119, 743]);
  assert.deepEqual([IMAGE_META.work2.width, IMAGE_META.work2.height], [739, 1600]);
});

test('perspective.imgix.net: the query is replaced by ?w=<width>&auto=compress,format&q=70', () => {
  assert.equal(imageUrl('work1', { width: 640 }), 'https://perspective.imgix.net/6ac64c7dfd2652fd454c9753.jpeg?w=640&auto=compress,format&q=70');
  assert.equal(imageUrl('about', { width: 800 }), 'https://perspective.imgix.net/6ac64bf1b8d25e3fced53c3e.jpeg?w=800&auto=compress,format&q=70', 'the old crop and dpr are gone');
  assert.equal(imageUrl('work4', { width: 480 }), 'https://perspective.imgix.net/6abb7d69173b2b4f1bfd30e9.jpeg?w=480&auto=compress,format&q=70');
  assert.equal(imageUrl('logo', { width: 300 }), 'https://perspective.imgix.net/6ac64662b8d25e3fced4de9e.jpeg?w=300&auto=compress,format&q=70');
});

test('images.unsplash.com: w is set to the width and every other parameter is kept', () => {
  const url = imageUrl('hero', { width: 720 });
  const u = new URL(url);
  assert.equal(u.hostname, 'images.unsplash.com');
  assert.equal(u.searchParams.get('w'), '720');
  const original = new URL(DEFAULT_IMAGES.hero);
  for (const [k, v] of original.searchParams) if (k !== 'w') assert.equal(u.searchParams.get(k), v, k);
  assert.equal([...u.searchParams.keys()].length, [...original.searchParams.keys()].length);
});

test('the logo with no width returns the original URL; other keys use a sensible default width', () => {
  assert.equal(imageUrl('logo'), DEFAULT_IMAGES.logo);
  assert.equal(imageUrl('logo', {}), DEFAULT_IMAGES.logo);
  assert.equal(new URL(imageUrl('hero')).searchParams.get('w'), '1080');
  assert.ok(imageUrl('about').includes('?w=900&'));
  assert.ok(imageUrl('work3').includes('?w=640&'));
});

test('width is rounded and clamped to 16 to 4000; a bad width falls back to the defaults', () => {
  assert.ok(imageUrl('work1', { width: 640.6 }).includes('?w=641&'));
  assert.ok(imageUrl('work1', { width: 3 }).includes('?w=16&'));
  assert.ok(imageUrl('work1', { width: 99999 }).includes('?w=4000&'));
  assert.ok(imageUrl('work1', { width: -5 }).includes('?w=640&'), 'negative: the default');
  assert.ok(imageUrl('work1', { width: 'wide' }).includes('?w=640&'));
  assert.equal(imageUrl('logo', { width: 0 }), DEFAULT_IMAGES.logo);
});

test('settings can override a URL: other hosts and relative paths come back unchanged', () => {
  const images = { hero: 'img/180/hero.jpg', work1: 'https://cdn.example.com/a.jpg?x=1', about: 'https://images.unsplash.com/photo-1?w=100&q=80' };
  assert.equal(imageUrl('hero', { width: 1080, images }), 'img/180/hero.jpg');
  assert.equal(imageUrl('work1', { width: 640, images }), 'https://cdn.example.com/a.jpg?x=1');
  assert.equal(imageUrl('about', { width: 500, images }), 'https://images.unsplash.com/photo-1?w=500&q=80');
  assert.equal(imageUrl('work2', { width: 640, images }), imageUrl('work2', { width: 640 }), 'an unset key falls back to the default');
  assert.equal(imageUrl('hero', { width: 640, images: { hero: '' } }), imageUrl('hero', { width: 640 }), 'an empty override is the default');
  assert.equal(imageUrl('nope', { width: 640 }), '');
  assert.equal(imageUrl('hero', { width: 640, images: { hero: 'http://insecure.example/a.jpg' } }), 'http://insecure.example/a.jpg', 'http is returned unchanged (the settings screen refuses it)');
});

test('selectBrand carries address and merged images; selectImageUrl follows the settings', () => {
  const settings = makeDefaultSettings();
  settings.business.images = { ...settings.business.images, hero: 'img/hero-local.jpg' };
  settings.business.address = '12 Sample Street, Belfast';
  const state = { settings };
  const brand = selectBrand(state);
  assert.equal(brand.address, '12 Sample Street, Belfast');
  assert.equal(brand.images.hero, 'img/hero-local.jpg');
  assert.equal(brand.images.logo, DEFAULT_IMAGES.logo);
  assert.equal(selectImageUrl(state, 'hero', { width: 900 }), 'img/hero-local.jpg');
  assert.ok(selectImageUrl(state, 'work1', { width: 320 }).includes('?w=320&auto=compress,format&q=70'));
  // an older saved business with no images still gets the defaults
  const legacy = { settings: { ...settings, business: { ...settings.business } } };
  delete legacy.settings.business.images;
  delete legacy.settings.business.address;
  assert.equal(selectBrand(legacy).address, '');
  assert.deepEqual(selectBrand(legacy).images, DEFAULT_IMAGES);
  assert.equal(selectImageUrl(legacy, 'logo'), DEFAULT_IMAGES.logo);
});
