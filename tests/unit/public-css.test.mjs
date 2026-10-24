// tests/unit/public-css.test.mjs: guards for the public pages' foundation CSS (docs/LANDING-V5.md 1.3, 1.4, 2, 9.7): the anti-slop rules as text checks on css/landing.css and the
// token contract of css/public-tokens.css (the dark values appear twice, byte-identical; every brand colour is the logo's own).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const landing = strip(read('css/landing.css'));
const tokens = strip(read('css/public-tokens.css'));

test('css/landing.css stays small: under 8 KB gzipped (first-paint budget, LANDING-V5 9.7)', () => {
  const gz = zlib.gzipSync(Buffer.from(read('css/landing.css')), { level: 9 }).length;
  assert.ok(gz < 8 * 1024, `landing.css is ${gz} bytes gzipped`);
});

test('css/landing.css: square, flat and quiet: no radius, no blur, no filter, no glow, no pulse, no shimmer, no scroll reveal', () => {
  const radii = [...landing.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(radii.every((r) => r === '0'), `only border-radius: 0 is allowed, found ${JSON.stringify([...new Set(radii)])}`);
  assert.ok(!/backdrop-filter|filter:|drop-shadow|blur\(/.test(landing), 'no blur, backdrop-filter, filter or drop-shadow');
  const shadows = [...landing.matchAll(/box-shadow:\s*([^;}]+)/g)].map((m) => m[1].trim());
  for (const sh of shadows) assert.ok(sh === 'none' || sh === 'inset 0 0 0 1px var(--ink)' || sh === '0 1px 0 var(--rule-b)', `box-shadow "${sh}" is not a 1px hairline`);
  const frames = [...landing.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(frames, ['lp-spin'], 'the only keyframes are the booking-wait spinner');
  assert.ok(!/lp-rv|data-rv|data-reveal|lp-shimmer|lp-pulse|lp-rise/.test(landing), 'no reveal, shimmer, pulse or rise');
  assert.ok(!/\bscale\(/.test(landing.replace(/scaleX\(/g, '').replace(/scale\(var\(--zoom, 1\)\)/g, '')), 'no scale on hover or press (only the nav underline scales in on X, and the gallery screenshot is zoomed past its black bars)');
  assert.ok(!/rounded|pill/i.test(landing.replace(/--r-pill/g, '').replace(/\.ui-[a-z]+__pill/g, '')), 'no pill or rounded anything (the shared components keep their old class names, ".ui-tools__pill" and ".ui-ideas__pill", which this file squares off)');
});

test('css/landing.css: the only gradient is the logo stripes in the closing composition, and no hex colour except the white label on red and the spinner', () => {
  const grads = landing.match(/linear-gradient|radial-gradient|conic-gradient/g) || [];
  assert.equal(grads.length, 1, 'one gradient');
  assert.match(landing, /\.lp-final::before, \.lp-footer::after \{[^}]*clip-path: polygon\(0 0, 100% 0, 0 100%\);[^}]*linear-gradient\(135deg, var\(--red\) 0 19%, transparent 19% 25%, var\(--on-black\) 25% 32%, transparent 32% 38%, var\(--red\) 38% 50%\)/);
  const hex = [...new Set((landing.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toUpperCase()))].sort();
  assert.deepEqual(hex, ['#F5F5F4', '#FFFFFF'], 'hex only for the label on red (#FFFFFF) and the spinner (#F5F5F4)');
});

test('css/landing.css: red is only a button fill, the nav underline and the stripes (never text, never a border, never a wash)', () => {
  const uses = [...landing.matchAll(/([^{}]+)\{([^{}]*var\(--red(?:-deep)?\)[^{}]*)\}/g)].map((m) => `${m[1].trim()} => ${m[2].trim()}`);
  for (const u of uses) {
    const [sel, decl] = u.split(' => ');
    const props = [...decl.matchAll(/([\w-]+):\s*[^;]*var\(--red(?:-deep)?\)/g)].map((m) => m[1]);
    assert.ok(props.every((p) => p === 'background' || p === 'background-color'), `red used as ${props.join(', ')} in ${sel}`);
    assert.ok(/\.lp-btn|\.lp-nav__link|\.lp-final::before|\.lp-footer::after/.test(sel), `red on an unexpected selector: ${sel}`);
  }
  assert.ok(uses.length >= 4, 'button, button hover, button press, nav underline and the stripes are found');
});

test('css/public-tokens.css: the dark values are byte-identical in both places (explicit dark and the Auto media block) and the brand colours are the logo\'s own', () => {
  const dark = /:root\[data-scope="public"\]\[data-theme="dark"\] \{([^}]*)\}/.exec(tokens);
  const auto = /@media \(prefers-color-scheme: dark\) \{\s*:root\[data-scope="public"\]:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\) \{([^}]*)\}/.exec(tokens);
  assert.ok(dark && auto, 'both dark blocks exist');
  const norm = (b) => b.split(/\s*;\s*/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(';');
  assert.equal(norm(auto[1]), norm(dark[1]));
  const light = /:root\[data-scope="public"\] \{\s*color-scheme: light;([^}]*)\}/.exec(tokens)[1];
  const val = (name, src = light) => { const m = new RegExp(`${name}:\\s*([^;]+);`).exec(src); return m && m[1].trim(); };
  assert.equal(val('--red'), '#E11414');
  assert.equal(val('--red-deep'), '#B00E12');
  assert.equal(val('--black'), '#0B0B0C');
  assert.equal(val('--ink'), '#0B0B0C');
  assert.equal(val('--paper'), '#F5F5F4');
  assert.equal(val('--err'), '#B00E12');
  assert.equal(val('--err', dark[1]), '#FF8A80');
  assert.equal(val('--paper', dark[1]), '#131315');
  assert.equal(val('--ink', dark[1]), '#F5F5F4');
  assert.match(tokens, /--r-xs: 0; --r-sm: 0; --r-md: 0; --r-lg: 0; --r-xl: 0; --r-2xl: 0; --r-pill: 0;/, 'the legacy radii are all 0 on the public pages');
  assert.match(tokens, /--shadow-1: none;/);
});

test('every selector of the public foundation is scoped or class-based: nothing here can touch the dashboard (landing.css and public-tokens.css are not linked from dashboard.html)', () => {
  assert.ok(!/public-tokens|landing\.css/.test(read('dashboard.html')));
  const bare = [...landing.matchAll(/(?:^|\})\s*([a-z][a-z0-9]*)\s*\{/g)].map((m) => m[1]);
  assert.deepEqual(bare, [], `no bare element selectors in landing.css: ${bare.join(', ')}`);
});
