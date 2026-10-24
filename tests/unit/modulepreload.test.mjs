// tests/unit/modulepreload.test.mjs: the <link rel="modulepreload"> blocks in the three pages equal each page's static import graph (scripts/modulepreload.mjs),
// and the landing page's early photo preloads name exactly the URLs the page will ask for (js/core/config.js imageUrl).
// If this fails after you added or removed an import: run `node scripts/modulepreload.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, staticGraph, staticImports, stalePages, listedModules, routeAssets } from '../../scripts/modulepreload.mjs';
import { imageUrl } from '../../js/core/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('staticImports finds static imports and re-exports, never dynamic import()', () => {
  const src = [
    "import { a } from './a.js';", "import b, { c } from '../b.js'", "import './side.js';", "export { d } from './d.js';", "export * from './e.js';",
    "const x = await import('./lazy.js');", "import {", "  f,", "  g", "} from './multi.js';", "import { h } from 'node:fs';", "// import { z } from './comment.js'"
  ].join('\n');
  assert.deepEqual(staticImports(src), ['./a.js', '../b.js', './side.js', './d.js', './e.js', './multi.js']);
});

for (const page of PAGES) {
  test(`${page.html}: the modulepreload block lists exactly the static import graph of ${page.entry}`, () => {
    const stale = stalePages().filter((s) => s.page === page.html);
    assert.deepEqual(stale, [], `stale: run node scripts/modulepreload.mjs (${JSON.stringify(stale)})`);
    const listed = listedModules(read(page.html));
    assert.ok(listed.length > 10, 'the block is there');
    assert.equal(new Set(listed).size, listed.length, 'no module listed twice');
    for (const m of listed) assert.ok(fs.existsSync(path.join(ROOT, m)), `${m} exists`);
  });
}

test('the booking sheet and the dashboard views stay out of the first-load graphs (they are dynamic imports)', () => {
  const landing = staticGraph('js/landing/app.js');
  for (const lazy of ['js/booking/booking-sheet.js', 'js/booking/funnel.js', 'js/booking/confirmation.js', 'js/landing/below.js', 'js/landing/why.js', 'js/landing/about.js', 'js/landing/gallery.js', 'js/landing/steps.js', 'js/landing/visit.js', 'js/landing/pricing.js', 'js/landing/calculator.js', 'js/landing/area.js', 'js/landing/faq.js', 'js/landing/copy.js']) {
    assert.ok(!landing.includes(lazy), `${lazy} must not load with the landing page`);
  }
  const dash = staticGraph('js/dashboard/app.js');
  assert.ok(!dash.some((m) => m.startsWith('js/dashboard/views/')), 'no view loads with the shell');
});

test('no first-load graph imports the js/ui/index.js barrel (it pulls in the whole UI kit): import from the module that defines the name', () => {
  for (const page of PAGES) {
    assert.ok(!staticGraph(page.entry).includes('js/ui/index.js'), `${page.entry}: a module in its first-load graph imports js/ui/index.js (the barrel)`);
    if (page.route) assert.ok(!routeAssets(page).modules.includes('js/ui/index.js'), `${page.route.view}: the default view imports the barrel`);
  }
});

test('index.html: the early hero and logo preloads are the URLs the page asks for, in his two photo hosts only', () => {
  const html = read('index.html');
  const links = [...html.matchAll(/<link rel="preload" as="image"[^>]*>/g)].map((m) => m[0]);
  assert.equal(links.length, 2);
  const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1].replace(/&amp;/g, '&') : null; };
  const hero = links.find((l) => /unsplash/.test(l));
  const logo = links.find((l) => /imgix/.test(l));
  assert.ok(hero && logo);
  // what the page asks for: the hero <Photo> in js/landing/hero.js (its sizes string and widths list; the src is widths[1], see js/landing/media.js)
  const photo = /IMAGES\.hero[\s\S]*?sizes="([^"]+)"[\s\S]*?widths=\$\{\[([^\]]+)\]\}/.exec(read('js/landing/hero.js'));
  assert.ok(photo, 'the hero <Photo> in js/landing/hero.js has a sizes string and a widths list');
  const sizes = photo[1];
  const widths = photo[2].split(',').map((n) => Number(n.trim()));
  assert.ok(widths.length >= 3 && widths.every((w) => w > 0));
  assert.equal(attr(hero, 'href'), imageUrl('hero', { width: widths[1] }));
  assert.equal(attr(hero, 'imagesrcset'), widths.map((w) => `${imageUrl('hero', { width: w })} ${w}w`).join(', '));
  assert.equal(attr(hero, 'imagesizes'), sizes);
  // LANDING-V5 3.3: the photo is 8 of 12 columns plus the bleed from 1024, full width below
  assert.equal(sizes, '(min-width: 1024px) 65vw, 100vw');
  assert.equal(attr(hero, 'imagesizes'), '(min-width: 1024px) 65vw, 100vw');
  assert.equal(attr(hero, 'fetchpriority'), 'high');
  // js/landing/media.js LogoImg: photoSrc('logo', 960)
  assert.equal(attr(logo, 'href'), imageUrl('logo', { width: 960 }));
  for (const tag of [...links, ...html.matchAll(/<link rel="preconnect"[^>]*>/g)].map((m) => (typeof m === 'string' ? m : m[0]))) {
    assert.match(tag, /https:\/\/(images\.unsplash\.com|perspective\.imgix\.net)/);
  }
  assert.match(html, /<link rel="preconnect" href="https:\/\/images\.unsplash\.com">/);
  assert.match(html, /<link rel="preconnect" href="https:\/\/perspective\.imgix\.net">/);
});

test('quote.html: preconnects to his two photo hosts', () => {
  const html = read('quote.html');
  assert.match(html, /<link rel="preconnect" href="https:\/\/images\.unsplash\.com">/);
  assert.match(html, /<link rel="preconnect" href="https:\/\/perspective\.imgix\.net">/);
});

test('index.html and quote.html: public scope, light by default, Archivo preloaded (not Inter or Manrope), public-tokens.css after tokens.css and before landing.css (LANDING-V5 3.3, 8.1)', () => {
  for (const page of ['index.html', 'quote.html']) {
    const html = read(page);
    assert.match(html, /<html lang="en-GB" data-scope="public" data-theme="light">/, `${page}: <html> carries data-scope="public" and data-theme="light"`);
    assert.match(html, /<meta name="color-scheme" content="light dark">/, `${page}: color-scheme meta`);
    assert.match(html, /<meta name="theme-color" content="#0B0B0C">/, `${page}: theme-color stays near-black`);
    assert.match(html, /<link rel="preload" href="fonts\/archivo-latin-wdth-normal\.woff2" as="font" type="font\/woff2" crossorigin>/, `${page}: preloads the upright Archivo file`);
    assert.ok(!/preload[^>]*(inter|manrope)-latin/.test(html), `${page}: no Inter or Manrope preload on a public page`);
    assert.ok(!/archivo-latin-wdth-italic[^>]*as="font"|as="font"[^>]*archivo-latin-wdth-italic/.test(html), `${page}: the italic file is not preloaded`);
    const at = (name) => html.indexOf(`href="css/${name}"`);
    assert.ok(at('tokens.css') > 0 && at('public-tokens.css') > at('tokens.css'), `${page}: public-tokens.css comes after tokens.css`);
    assert.ok(at('public-tokens.css') < at('landing.css') || at('landing.css') < 0, `${page}: public-tokens.css comes before landing.css`);
    assert.match(html, /vm_theme_public/, `${page}: the head script reads the public theme key`);
    assert.ok(!/localStorage\.getItem\('vm_theme'\)/.test(html), `${page}: the head script does not read the dashboard's key`);
  }
  assert.ok(!/data-scope/.test(read('dashboard.html')), 'the dashboard is not in the public scope');
});

test('the Archivo files, their licence and the fonts.css faces are in place and the fallbacks are metric-matched', () => {
  const css = read('css/fonts.css');
  for (const f of ['fonts/archivo-latin-wdth-normal.woff2', 'fonts/archivo-latin-wdth-italic.woff2', 'fonts/LICENSE-archivo-OFL.txt']) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  assert.match(css, /font-family: 'Archivo'; font-style: normal; font-weight: 100 900; font-stretch: 62% 125%; font-display: swap;/);
  assert.match(css, /font-family: 'Archivo'; font-style: italic;/);
  assert.match(css, /font-family: 'Archivo Fallback'/);
  assert.match(css, /font-family: 'Archivo Fallback Display'/);
  assert.match(css, /font-family: 'Inter'/, 'Inter stays for the dashboard');
  assert.match(css, /font-family: 'Manrope'/, 'Manrope stays for the dashboard');
  assert.match(read('fonts/LICENSE-OFL.txt'), /Archivo/, 'the licence notice names Archivo');
});
