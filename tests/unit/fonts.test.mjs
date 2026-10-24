// tests/unit/fonts.test.mjs: the web fonts stay light (they were the heaviest part of the first screen) and the one trimmed font that could silently go wrong is checked.
// scripts/subset-fonts.py says how the files in fonts/ are made and why each axis range is what it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const size = (f) => fs.statSync(path.join(ROOT, 'fonts', f)).size;

// bytes: what each file weighs after trimming, with room for a re-run of the script (the compressor is not byte-for-byte repeatable)
const BUDGET = {
  'inter-latin-wght-normal.woff2': 38000,
  'manrope-latin-wght-normal.woff2': 25000,
  'archivo-latin-wdth-normal.woff2': 60000,
  'archivo-latin-wdth-italic.woff2': 20000
};

test('every font file is a woff2 within its size budget', () => {
  for (const [file, max] of Object.entries(BUDGET)) {
    const full = path.join(ROOT, 'fonts', file);
    assert.ok(fs.existsSync(full), `${file} exists`);
    assert.equal(fs.readFileSync(full).subarray(0, 4).toString('latin1'), 'wOF2', `${file} is a woff2`);
    assert.ok(size(file) <= max, `${file} is ${size(file)} bytes, budget ${max}: run scripts/subset-fonts.py (or trim it) before adding weight to the first screen`);
  }
});

test('every font the stylesheet names exists, and every font file is named by the stylesheet', () => {
  const css = read('css/fonts.css');
  const named = [...css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
  for (const f of named) assert.ok(fs.existsSync(path.join(ROOT, 'fonts', f)), `${f} is named in css/fonts.css but missing`);
  const files = fs.readdirSync(path.join(ROOT, 'fonts')).filter((f) => f.endsWith('.woff2'));
  for (const f of files) assert.ok(named.includes(f), `${f} is in fonts/ but no @font-face uses it (dead weight)`);
});

test('the Archivo italic is a static font pinned at weight 800 and width 125: .lp-logovoice, its only user, still asks for exactly that', () => {
  const landing = read('css/landing.css');
  const rule = /\.lp-logovoice\s*\{([^}]*)\}/.exec(landing);
  assert.ok(rule, '.lp-logovoice is in css/landing.css');
  assert.match(rule[1], /font-style:\s*italic/);
  assert.match(rule[1], /font-weight:\s*800/, 'the italic file is pinned at weight 800: change JOBS in scripts/subset-fonts.py and run it again');
  assert.match(rule[1], /font-stretch:\s*125%/, 'the italic file is pinned at width 125: change JOBS in scripts/subset-fonts.py and run it again');
  // nothing else asks for italic text (a second italic use would be drawn at weight 800 and width 125 too)
  for (const f of fs.readdirSync(path.join(ROOT, 'css')).filter((n) => n.endsWith('.css') && n !== 'fonts.css')) {
    const text = read(path.join('css', f));
    const uses = [...text.matchAll(/font-style:\s*italic/g)].length;
    if (f === 'landing.css') assert.equal(uses, 1, 'css/landing.css has one italic use (.lp-logovoice)');
    else assert.equal(uses, 0, `css/${f} asks for italic text: the Archivo italic is pinned at weight 800, width 125 (scripts/subset-fonts.py)`);
  }
});

test('the Archivo normal file covers the weights and widths the public CSS asks for (weight 400 to 800, width 100 to 125)', () => {
  const css = ['css/landing.css', 'css/public-tokens.css', 'css/booking.css', 'css/quote.css', 'css/components.css', 'css/base.css'].map(read).join('\n');
  for (const m of css.matchAll(/font-stretch:\s*(\d+)%/g)) {
    const w = Number(m[1]);
    assert.ok(w >= 100 && w <= 125, `font-stretch ${w}% is outside the trimmed width range 100-125 (scripts/subset-fonts.py)`);
  }
  for (const m of css.matchAll(/font-weight:\s*(\d{3})\b|\bfont:\s*(?:italic\s+)?(\d{3})\s/g)) {
    const w = Number(m[1] || m[2]);
    assert.ok(w >= 400 && w <= 800, `font-weight ${w} is outside the trimmed weight range 400-800 (scripts/subset-fonts.py)`);
  }
});
