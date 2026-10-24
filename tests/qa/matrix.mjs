// tests/qa/matrix.mjs: the final quality-gate matrix (docs/V3-SPEC.md section 6). Self-contained: starts its own static server, drives Chromium
// through Playwright and exits non-zero when any check fails.
//
//   QA_DEPS_DIR=/dir/with/node_modules  node tests/qa/matrix.mjs            (needs playwright-core and axe-core in that node_modules)
//   ONLY=dashboard | quote | index | landing | funnel | dashboard/pipeline ...   (comma list: page name or a substring of a screen id)
//   FULL=1            every screen at every viewport (default: all screens at 375 and 1440, the core screens at the other four)
//   VIEWPORTS=375x812,1440x900   THEMES=dark,light   FOCUS=0 (skip the Tab walk)   MOTION=0 (skip the reduced-motion pass)
//   REPORT=/path/report.json (machine-readable result)   VERBOSE=1 (print passing screens too)
//   BASE_URL=http://127.0.0.1:4211 (reuse a server)   PORT=4211 (port of the server this file starts; a free one when busy)
//   CHROME_PATH=/path/to/chrome
//
// Every screen is loaded with the clock pinned (?now=2026-10-23T20:30&freeze=1), in dark and light, and each state of it is checked for:
//   overflow       no horizontal scroll on the page (documentElement and body)
//   wide-element   no visible element wider than the viewport or straddling its edge (unless a scroller clips it)
//   tap-target     every interactive element is at least 44 x 44 CSS px (inline links in running text and visually hidden controls with a tappable label excepted)
//   console        zero console errors / warnings / page errors
//   request        zero failed requests, HTTP >= 400 responses and off-site requests (perspective.imgix.net and images.unsplash.com for images only; stand-ins are served)
//   axe            axe-core wcag2a/2aa/21a/21aa: zero serious or critical violations
//   contrast       axe color-contrast: zero violations (text/background AA). Text axe cannot judge (over gradients, photos, pseudo-element backgrounds: roughly a third
//                  of all text in dark mode) is measured from real pixels instead: its own colour over the worst pixel of its line box, 4.5:1 (3:1 for large text)
//                  and the stand-in photo is mid grey (PHOTO_TONE=#eeeeee / #101010 stress the overlays)
//   focus-ring     the landing page and every funnel step: a visible focus indicator on every Tab stop (computed outline, else a before/after pixel difference)
//   text-clipped   no text cut off by overflow:hidden (scrollWidth > clientWidth), and no fixed-height box cutting text vertically
//   image-dims     every img has width+height attributes or an aspect-ratio (itself or a wrapper), loads, and is not distorted
//   cls            layout shift while the page loads (PerformanceObserver; photos answer 250 ms late so a missing reservation shows) is below 0.05
//   reduced-motion with prefers-reduced-motion: reduce no animation longer than 150 ms or infinite is running, and scroll-behavior is auto
//
// Screens: index (landing, funnel steps 1 to 6 with the error state, confirmation and its demo panel), quote (same browser, link, expired, invalid, accepted),
// dashboard (every route; booking and quote ids are read from the seeded store; #import= with an enquiry, an acceptance and garbage; every connection wizard).
// "Extras" (x-* / z-* / landing-open / link-decline) open what is behind a tap: FAQ, lightbox, filter sheet, message rows, every disclosure and <details>,
// pipeline stage tabs, the quote builder and send sheet, wizard step 2. Those that write to the store run last.
// Sampling: all screens at 375 and 1440 in both themes; the core screens (landing, funnel contact + confirmation, quote link, Today, booking detail) at the other four widths.
// SELFTEST=1 builds a page full of defects and checks that every detector fires.
//
// Owner: MATRIX (final gate).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/qa';
const CHROME = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const require = createRequire(QA_DEPS.endsWith('/') ? QA_DEPS : `${QA_DEPS}/`);
const { chromium } = require('playwright-core');
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const NOW = 'now=2026-10-23T20:30&freeze=1';
const CTX = { timezoneId: 'Europe/London', locale: 'en-GB' };
const PHOTO_HOSTS = /^https:\/\/(perspective\.imgix\.net|images\.unsplash\.com)\//;
const PHOTO_DELAY_MS = 250;
const PHOTO_TONE = process.env.PHOTO_TONE || '#777'; // the stand-in photo: text laid over his photos must still pass on a mid-tone picture
const STAND_IN = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${PHOTO_TONE}"/><rect x="40" y="40" width="1120" height="720" fill="${PHOTO_TONE}" opacity="0.85"/></svg>`;
const CLS_LIMIT = 0.05;
const TAP_MIN = 44;

const ALL_VIEWPORTS = ['320x568', '375x812', '390x844', '768x1024', '1024x768', '1440x900'];
const BROAD_VIEWPORTS = ['375x812', '1440x900'];
const THEMES = (process.env.THEMES || 'dark,light').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const FULL = process.env.FULL === '1';
const VERBOSE = process.env.VERBOSE === '1';
const DO_FOCUS = process.env.FOCUS !== '0';
const DO_MOTION = process.env.MOTION !== '0';
const VIEWPORT_LIST = (process.env.VIEWPORTS ? process.env.VIEWPORTS.split(',').map((s) => s.trim()) : ALL_VIEWPORTS).filter((v) => ALL_VIEWPORTS.includes(v) || /^\d+x\d+$/.test(v));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;

// ---------------------------------------------------------------- server
let server = null;
const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});
const anyPort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
async function startServer() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const want = Number(process.env.PORT || 4211);
  const port = (await portFree(want)) ? want : await anyPort();
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', SITE_ROOT], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${base}/dashboard.html`); if (r.ok) return base; } catch (e) { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('static server did not start');
}
let BASE = '';

// ---------------------------------------------------------------- in-page code (serialised by Playwright: no closures)

/** Runs before any page script: layout-shift collection. */
function initScript() {
  window.__cls = 0;
  window.__shifts = [];
  try {
    const name = (n) => {
      if (!n || n.nodeType !== 1) return n && n.nodeName ? String(n.nodeName).toLowerCase() : '?';
      const tid = n.getAttribute('data-testid');
      const cls = typeof n.className === 'string' && n.className ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return n.tagName.toLowerCase() + (tid ? `[${tid}]` : cls);
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        window.__shifts.push({ v: Math.round(e.value * 10000) / 10000, t: Math.round(e.startTime), n: (e.sources || []).slice(0, 3).map((s) => name(s.node)).join(' | ') });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* layout-shift unsupported */ }
}

/** The static audit of the page as it is now. */
function auditPage(opts) {
  const tapMin = opts.tapMin;
  const vw = document.documentElement.clientWidth;
  const out = { vw, overflow: [], wide: [], taps: [], clipped: [], images: [], counts: { elements: 0, interactive: 0, images: 0 } };
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    const tid = el.getAttribute('data-testid');
    if (tid) s += `[${tid}]`;
    else if (el.id) s += `#${el.id}`;
    else if (typeof el.className === 'string' && el.className.trim()) s += `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
    const up = el.parentElement && el.parentElement.closest('[data-testid]');
    const t = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    return `${s}${t ? ` "${t}"` : ''}${up && !tid ? ` in [${up.getAttribute('data-testid')}]` : ''}`;
  };
  const shown = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (n.hasAttribute('inert') || n.hidden || parseFloat(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clippedByAncestor = (el) => {
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) return true;
    }
    return false;
  };

  // 1. overflow
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 0.5) out.overflow.push(`documentElement scrollWidth ${de.scrollWidth} > ${de.clientWidth}`);
  if (document.body.scrollWidth > de.clientWidth + 0.5) out.overflow.push(`body scrollWidth ${document.body.scrollWidth} > ${de.clientWidth}`);

  const all = Array.from(document.body.querySelectorAll('*'));
  out.counts.elements = all.length;
  // 2. wide elements, 3b. clipped text
  for (const el of all) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.width > vw + 1 || (r.right > vw + 1 && r.left < vw - 1) || (r.left < -1 && r.right > 1)) {
      if (shown(el) && !clippedByAncestor(el)) out.wide.push(`${desc(el)} ${Math.round(r.left)}..${Math.round(r.right)} (viewport ${vw})`);
    }
    const cs = getComputedStyle(el);
    const hidden = /(hidden|clip)/;
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0) || (el.children.length === 0 && el.textContent.trim().length > 0);
    if (!hasText) continue;
    if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
    if (hidden.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && shown(el)) {
      const ell = cs.textOverflow === 'ellipsis';
      // A deliberate one-line preview (text-overflow: ellipsis) is allowed when the full text is one tap or hover away: it sits inside a button, link or
      // summary, or carries a title. Anything else cut short is a defect.
      if (ell && (el.closest('button, a[href], summary, [role="button"], [role="link"], [aria-expanded], [title]'))) continue;
      out.clipped.push(`${desc(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}${ell ? ' (ellipsis, full text not reachable)' : ''}`);
    } else if (hidden.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && shown(el) && !/-webkit-box/.test(cs.display) && cs.webkitLineClamp === 'none') {
      out.clipped.push(`${desc(el)} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight} (vertical)`);
    }
  }

  // 3. tap targets
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], [role="slider"], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const seen = new Set();
  for (const el of document.querySelectorAll(sel)) {
    if (!shown(el)) continue;
    out.counts.interactive += 1;
    let target = el;
    let r = el.getBoundingClientRect();
    if (r.bottom + window.scrollY <= 0 || r.right + window.scrollX <= 0) continue; // parked off-screen (skip link)
    const cs = getComputedStyle(el);
    const isCheck = el.tagName === 'INPUT' && /^(checkbox|radio|file)$/.test(el.type);
    const label = isCheck ? (el.closest('label') || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null)) : null;
    if (isCheck && (r.width < 12 || r.height < 12 || parseFloat(cs.opacity) < 0.05)) {
      if (!label) { out.taps.push(`${desc(el)} visually hidden with no label to tap`); continue; }
      target = label; r = label.getBoundingClientRect();
    } else if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type) && label) {
      const lr = label.getBoundingClientRect();
      if (lr.width >= tapMin - 0.5 && lr.height >= tapMin - 0.5) continue; // the whole row is the target
    }
    if (r.width <= 1.5 && r.height <= 1.5) continue; // sr-only
    if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement) {
      const running = Array.from(el.parentElement.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (running) continue; // an inline link inside a sentence
    }
    if (target.hasAttribute && target.hasAttribute('data-tap-exempt')) continue;
    // a positioned ::before / ::after that grows the hit area (the usual "44px target around a small control" technique) counts as part of the control
    let ew = r.width; let eh = r.height;
    for (const ps of ['::before', '::after']) {
      const pcs = getComputedStyle(target, ps);
      if (pcs.content !== 'none' && pcs.position === 'absolute') { ew = Math.max(ew, parseFloat(pcs.width) || 0); eh = Math.max(eh, parseFloat(pcs.height) || 0); }
    }
    r = { width: ew, height: eh };
    if (r.width < tapMin - 0.5 || r.height < tapMin - 0.5) {
      const key = `${desc(target)}|${Math.round(r.width)}x${Math.round(r.height)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.taps.push(`${desc(target)} ${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}`);
    }
  }

  // 4. images
  for (const img of document.querySelectorAll('img')) {
    out.counts.images += 1;
    if (!shown(img) && !img.getBoundingClientRect().width) { if (img.complete && img.naturalWidth === 0 && img.currentSrc) out.images.push(`${desc(img)} did not load`); continue; }
    const cs = getComputedStyle(img);
    const attrs = img.hasAttribute('width') && img.hasAttribute('height') && parseFloat(img.getAttribute('width')) > 0 && parseFloat(img.getAttribute('height')) > 0;
    let ratio = cs.aspectRatio !== 'auto';
    for (let n = img.parentElement, i = 0; n && i < 4 && !ratio; n = n.parentElement, i += 1) if (getComputedStyle(n).aspectRatio !== 'auto') ratio = true;
    const abs = cs.position === 'absolute' || cs.position === 'fixed';
    if (!attrs && !ratio && !abs) out.images.push(`${desc(img)} has no width/height attributes and no aspect-ratio`);
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) out.images.push(`${desc(img)} did not load (${img.currentSrc.slice(0, 60)})`);
    if (img.complete && img.naturalWidth > 0 && cs.objectFit === 'fill') {
      const r = img.getBoundingClientRect();
      const nat = img.naturalWidth / img.naturalHeight;
      const box = r.width / r.height;
      if (r.width > 8 && r.height > 8 && Math.abs(nat - box) / nat > 0.06) out.images.push(`${desc(img)} is stretched (natural ratio ${nat.toFixed(2)}, box ${box.toFixed(2)}) with object-fit: fill`);
    }
  }
  return out;
}

/** Which Tab stop is focused now, and whether the browser's own focus ring is showing on it (or on its wrapper). */
function focusProbe() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { body: true };
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const ring = (n) => { const cs = getComputedStyle(n); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 && alpha(cs.outlineColor) > 0.3; };
  const desc = (n) => {
    let s = n.tagName.toLowerCase();
    const tid = n.getAttribute('data-testid');
    if (tid) s += `[${tid}]`;
    else if (n.id) s += `#${n.id}`;
    else if (typeof n.className === 'string' && n.className.trim()) s += `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
    const t = (n.getAttribute('aria-label') || n.textContent || n.value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return t ? `${s} "${t}"` : s;
  };
  let wrapper = null;
  if (!ring(el)) {
    const cand = [el.closest('label'), el.parentElement, el.parentElement && el.parentElement.parentElement].filter(Boolean);
    wrapper = cand.find(ring) || null;
  }
  const r = el.getBoundingClientRect();
  const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
  const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
  const top = document.elementFromPoint(cx, cy);
  const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  const covered = visible && top && !(el === top || el.contains(top) || top.contains(el) || (el.closest('label') && el.closest('label').contains(top)));
  return { key: `${desc(el)}@${Math.round(r.left)},${Math.round(r.top + window.scrollY)}`, desc: desc(el), ring: ring(el), wrapperRing: !!wrapper, visible, covered: covered ? desc(top) : '', rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
}

/** axe cannot judge text over gradients, images and pseudo-elements ("incomplete"): list those text runs with their colour and boxes so they can be measured from pixels. */
async function contrastTargets() {
  const res = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['incomplete'], elementRef: true });
  const out = [];
  const seen = new Set();
  const nodes = res.incomplete.flatMap((v) => v.nodes);
  for (const e of document.body.querySelectorAll('*')) { const ps = getComputedStyle(e).position; if (ps === 'fixed' || ps === 'sticky') e.setAttribute('data-qa-fixed', '1'); }
  // Computed colours can come back as rgb(), color(srgb ...), oklch(), color-mix results...: let a canvas turn any of them into RGBA.
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const modal = document.querySelector('[role="dialog"][aria-modal="true"]'); // with a sheet or lightbox open, what is behind its scrim is not on show
  for (const n of nodes) {
    const el = n.element;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (modal && !modal.contains(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let opacity = 1;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) opacity *= parseFloat(getComputedStyle(a).opacity);
    if (opacity < 0.05) continue;
    const fg = parse(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color && !/transparent|rgba\(0, 0, 0, 0\)/.test(cs.webkitTextFillColor) ? cs.webkitTextFillColor : cs.color);
    const rects = [];
    let text = '';
    for (const t of el.childNodes) {
      if (t.nodeType !== 3 || !t.textContent.trim()) continue;
      text += `${t.textContent.trim()} `;
      const r = document.createRange(); r.selectNodeContents(t);
      for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) rects.push({ x: q.left + window.scrollX, y: q.top + window.scrollY, w: q.width, h: q.height });
    }
    if (!rects.length) continue;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    let name = el.tagName.toLowerCase();
    const tid = el.getAttribute('data-testid');
    if (tid) name += `[${tid}]`; else if (el.id) name += `#${el.id}`; else if (typeof el.className === 'string' && el.className.trim()) name += `.${el.className.trim().split(/\s+/)[0]}`;
    el.setAttribute('data-qa-cc', String(out.length));
    out.push({ i: out.length, name, text: text.trim().slice(0, 40), fixed: !!el.closest('[data-qa-fixed]'), fg: [fg[0], fg[1], fg[2], fg[3] * opacity], need: large ? 3 : 4.5, rects });
  }
  return out;
}

/**
 * For each text line box: is it where the caller thinks it is NOW (a fixed or sticky element does not follow a window scroll), is it fully inside every scroll
 * container it sits in, and is it really on top (nothing else painted over it)? `doc`: rects are document coordinates (else viewport).
 */
function runProbe(arg) {
  return arg.runs.map((r) => {
    const el = document.querySelector(`[data-qa-cc="${r.i}"]`);
    if (!el) return false;
    const x0 = r.x - (arg.doc ? window.scrollX : 0);
    const y0 = r.y - (arg.doc ? window.scrollY : 0);
    if (x0 < 0 || y0 < 0 || x0 + r.w > window.innerWidth || y0 + r.h > window.innerHeight) return false;
    let there = false; // one of the element's line boxes is exactly this one right now
    for (const t of el.childNodes) {
      if (t.nodeType !== 3 || !t.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const q of rg.getClientRects()) if (Math.abs(q.left - x0) < 1.5 && Math.abs(q.top - y0) < 1.5 && Math.abs(q.width - r.w) < 1.5) there = true;
    }
    if (!there) return false;
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = n.getBoundingClientRect();
      if (x0 < b.left - 1 || x0 + r.w > b.right + 1 || y0 < b.top - 1 || y0 + r.h > b.bottom + 1) return false;
    }
    const y = y0 + r.h / 2;
    return [x0 + 2, x0 + r.w / 2, x0 + r.w - 2].every((x) => {
      const top = document.elementFromPoint(Math.min(Math.max(x, 1), window.innerWidth - 2), Math.min(Math.max(y, 1), window.innerHeight - 2));
      return !!top && (el === top || el.contains(top));
    });
  });
}

/** Scroll one text element to the middle of its scroll containers and report its line boxes (viewport coordinates) and whether they are all visible and on top. */
function scrollRuns(arg) {
  const el = document.querySelector(`[data-qa-cc="${arg.i}"]`);
  if (!el) return { rects: [], ok: [] };
  if (arg.scroll) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const rects = [];
  for (const t of el.childNodes) {
    if (t.nodeType !== 3 || !t.textContent.trim()) continue;
    const r = document.createRange(); r.selectNodeContents(t);
    for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) rects.push({ x: q.left, y: q.top, w: q.width, h: q.height });
  }
  return { rects };
}

/** Worst contrast of `fg` text over the pixels of a screenshot region (PNG data URL), measured per pixel with the text colour blended in. */
async function pixelContrast(arg) {
  const blob = await (await fetch(arg.png)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return arg.items.map((it) => {
    let worst = 99; let worstBg = ''; let worstAt = '';
    for (const q of it.rects) {
      const x0 = Math.max(0, Math.floor(q.x)); const y0 = Math.max(0, Math.floor(q.y));
      const w = Math.min(bmp.width - x0, Math.ceil(q.w)); const h = Math.min(bmp.height - y0, Math.ceil(q.h));
      if (w < 1 || h < 1) continue;
      const d = cx.getImageData(x0, y0, w, h).data;
      for (let k = 0; k < d.length; k += 12) { // every third pixel
        const a = it.fg[3];
        const tr = a * it.fg[0] + (1 - a) * d[k]; const tg = a * it.fg[1] + (1 - a) * d[k + 1]; const tb = a * it.fg[2] + (1 - a) * d[k + 2];
        const l1 = lum(tr, tg, tb); const l2 = lum(d[k], d[k + 1], d[k + 2]);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (ratio < worst) { worst = ratio; worstBg = `${d[k]},${d[k + 1]},${d[k + 2]}`; worstAt = `${x0 + ((k / 4) % w)},${y0 + Math.floor(k / 4 / w)}`; }
      }
    }
    return { i: it.i, worst, worstBg, worstAt, box: it.rects.map((q) => `${Math.round(q.x)},${Math.round(q.y)} ${Math.round(q.w)}x${Math.round(q.h)}`).join(' ') };
  });
}

/** Animations that should not exist under prefers-reduced-motion. */
function motionProbe() {
  const out = [];
  for (const a of document.getAnimations()) {
    if (a.playState !== 'running') continue;
    let t = null;
    try { t = a.effect && a.effect.getComputedTiming(); } catch (e) { t = null; }
    if (!t) continue;
    const total = t.activeDuration; // duration x iterations; a transition's start delay (a visibility flip held back 200 ms) is not motion
    if (total === Infinity || total > 150) {
      const tg = a.effect && a.effect.target;
      const name = a.animationName || a.transitionProperty || a.constructor.name;
      const who = tg && tg.tagName ? tg.tagName.toLowerCase() + (tg.getAttribute('data-testid') ? `[${tg.getAttribute('data-testid')}]` : typeof tg.className === 'string' && tg.className ? `.${tg.className.trim().split(/\s+/)[0]}` : '') : '?';
      out.push(`${who} ${name} ${total === Infinity ? 'infinite' : `${Math.round(total)}ms`}`);
    }
  }
  const sb = getComputedStyle(document.documentElement).scrollBehavior;
  if (sb && sb !== 'auto') out.push(`html scroll-behavior: ${sb}`);
  return out;
}

// ---------------------------------------------------------------- harness
const failures = []; // { key, vp, theme, check, detail }
const stats = { states: 0, screens: 0, runs: 0, ms: 0, perCheck: {} };
const note = (check) => { stats.perCheck[check] = (stats.perCheck[check] || 0) + 1; };
function fail(ctxInfo, check, detail) {
  failures.push({ key: ctxInfo.key, vp: ctxInfo.vp, theme: ctxInfo.theme, check, detail: String(detail).slice(0, 420) });
}

function attachLog(page, log) {
  const origin = new URL(BASE).origin;
  const push = (s) => log.items.push(s);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') push(['console', `${m.type()}: ${m.text()}`.slice(0, 300)]); });
  page.on('pageerror', (e) => push(['console', `pageerror: ${e.message}`.slice(0, 300)]));
  page.on('requestfailed', (r) => push(['request', `failed ${r.url().slice(0, 140)} ${(r.failure() || {}).errorText || ''}`]));
  page.on('response', (r) => {
    if (r.status() >= 400) push(['request', `HTTP ${r.status()} ${r.url().slice(0, 140)}`]);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    if (PHOTO_HOSTS.test(u) && r.resourceType() === 'image') return;
    push(['request', `off-site ${r.resourceType()} ${u.slice(0, 140)}`]);
  });
}

async function newContext(browser, vp, theme, { reduce = false, mobile } = {}) {
  const [w, h] = vp.split('x').map(Number);
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile === undefined ? w < 700 : mobile, hasTouch: mobile === undefined ? w < 700 : mobile, colorScheme: theme, reducedMotion: reduce ? 'reduce' : 'no-preference'
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* storage blocked */ } }, theme);
  await ctx.addInitScript(initScript);
  await ctx.route(PHOTO_HOSTS, async (route) => {
    await sleep(PHOTO_DELAY_MS);
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }).catch(() => {});
  });
  return ctx;
}

/** Everything is settled: network idle, fonts ready, finite animations done. */
async function settle(page) {
  await page.waitForFunction(() => document.readyState === 'complete' && Array.from(document.images).every((i) => i.complete || i.loading === 'lazy'), null, { timeout: 8000 }).catch(() => {});
  // the landing page mounts the sections below the hero, and has the quote form's code in the page, a moment after its photo has arrived (html[data-below] and html[data-booking], js/landing)
  await page.waitForFunction(() => !document.querySelector('[data-testid="hero-cta"]') || (document.documentElement.dataset.below === 'ready' && document.documentElement.dataset.booking === 'ready'), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(async () => {
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
    const t0 = performance.now();
    while (performance.now() - t0 < 2600) {
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        try {
          const tg = a.effect.target; // the toast's 4 s countdown bar is not page loading
          if (tg && tg.closest && tg.closest('.ui-toast')) return false;
          return Number.isFinite(a.effect.getComputedTiming().endTime);
        } catch (e) { return false; }
      });
      if (!running.length) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    await new Promise((r) => setTimeout(r, 150));
  }).catch(() => {});
}

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += Math.max(300, window.innerHeight - 100)) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 120));
  }).catch(() => {});
}

async function runAxe(page) {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return res.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => ({ t: n.target.join(' '), d: (n.any[0] && n.any[0].data && n.any[0].data.contrastRatio) ? `${n.any[0].data.contrastRatio} ${n.any[0].data.fgColor} on ${n.any[0].data.bgColor}` : (n.failureSummary || '').split('\n').slice(1, 2).join(' ').trim().slice(0, 100) })),
      count: v.nodes.length
    }));
  });
}

/** Tab through the page: every stop must show a focus indicator. */
async function focusWalk(page, info, label, maxStops = 140) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const a = document.createElement('span'); a.tabIndex = -1; document.body.prepend(a); a.focus(); a.remove();
  }).catch(() => {});
  let first = null;
  let stops = 0;
  const bad = [];
  const vp = page.viewportSize();
  // No computed outline: compare the pixels around the element focused and blurred (then give it focus back, still in keyboard mode).
  const indicatorShows = async (f) => {
    try {
      const pad = 10;
      const x = Math.max(0, Math.floor(f.rect.x - pad)); const y = Math.max(0, Math.floor(f.rect.y - pad));
      const clip = { x, y, width: Math.max(1, Math.min(vp.width - x, Math.ceil(f.rect.w + pad * 2))), height: Math.max(1, Math.min(vp.height - y, Math.ceil(f.rect.h + pad * 2))) };
      const freeze = await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused !important;caret-color:transparent !important}' });
      await sleep(180);
      const focused = await page.screenshot({ clip });
      const handle = await page.evaluateHandle(() => { const el = document.activeElement; el.blur(); return el; });
      await sleep(220);
      const blurred = await page.screenshot({ clip });
      await handle.evaluate((el) => el.focus());
      await handle.dispose();
      await freeze.evaluate((n) => n.remove());
      await sleep(40);
      return !focused.equals(blurred);
    } catch (e) { if (process.env.DEBUG_FOCUS) console.log('  pixel check error', e.message.split('\n')[0]); return true; }
  };
  for (let i = 0; i < maxStops; i += 1) {
    await page.keyboard.press('Tab');
    await page.evaluate(async () => { // smooth scrolling (landing.css) and the carousel's own scroller both need to arrive before the stop is judged
      let last = '';
      for (let k = 0; k < 40; k += 1) {
        const el = document.activeElement;
        const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0 };
        const now = `${Math.round(window.scrollY)}|${Math.round(r.left)}|${Math.round(r.top)}`;
        if (now === last) break;
        last = now;
        await new Promise((res) => setTimeout(res, 40));
      }
    }).catch(() => {});
    let f = await page.evaluate(focusProbe);
    for (let k = 0; k < 15 && !f.body && (!f.visible || f.covered); k += 1) { // a long smooth scroll (landing.css) can still be under way: give it up to 1.5 s
      await sleep(100);
      f = await page.evaluate(focusProbe);
    }
    if (process.env.DEBUG_FOCUS) console.log('  tab', i, JSON.stringify({ d: f.desc, ring: f.ring, w: f.wrapperRing, vis: f.visible, cov: f.covered }));
    if (f.body) break; // focus left the document
    if (first && f.key === first) break; // a full lap (a trapped sheet cycles)
    if (!first) first = f.key;
    stops += 1;
    if (!f.visible) bad.push(`${f.desc}: focused but not visible on screen`);
    else if (f.covered) bad.push(`${f.desc}: focused but covered by ${f.covered}`);
    else if (!f.ring && !f.wrapperRing && !(await indicatorShows(f))) bad.push(`${f.desc}: no visible focus indicator (no outline and the pixels do not change)`);
  }
  note('focus-stops');
  for (const b of bad.slice(0, 12)) fail(info, 'focus-ring', `${label}: ${b}`);
  if (stops === 0) fail(info, 'focus-ring', `${label}: Tab reached no focusable element`);
  return stops;
}

/**
 * Text axe could not judge (gradient cards, text over photos, pseudo-element backgrounds) is measured from real pixels: every text run is hidden,
 * the region around it is screenshotted, and the worst per-pixel contrast of its own colour over that region must still be AA (4.5, or 3 for large text).
 */
async function verifyIncompleteContrast(page, info, label) {
  const targets = await page.evaluate(contrastTargets).catch(() => []);
  if (!targets.length) return 0;
  const vp = page.viewportSize();
  const freeze = await page.addStyleTag({ content: '*,*::before,*::after{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important;text-decoration:none !important;-webkit-text-stroke:0 !important;caret-color:transparent !important;animation-play-state:paused !important;scroll-behavior:auto !important}' });
  const runs = targets.flatMap((t) => t.rects.map((q, k) => ({ i: t.i, k, id: `${t.i}:${k}`, q, fixed: t.fixed })));
  const done = new Map(); // run id -> { worst, worstBg }
  const step = Math.max(200, vp.height - 120);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const offsets = [];
  for (let y = 0; y < docH; y += step) offsets.push(y);
  for (const f of [0.5, 0.25, 0.75]) for (let y = Math.floor(step * f); y < docH; y += step) offsets.push(y); // shifted laps for runs still unmeasured (they only cost a screenshot when something is left)
  // Pass A: ordinary content, with every fixed / sticky element (header, tab bar, toast, sticky action bars) hidden so the pixels are the content's own background.
  // Pass B: the fixed / sticky elements' own text, with everything showing.
  for (const pass of ['content', 'fixed']) {
    const hide = pass === 'content' ? await page.addStyleTag({ content: '[data-qa-fixed]{visibility:hidden !important}' }) : null;
    for (const y0 of offsets) {
      const todo = runs.filter((r) => (pass === 'fixed') === r.fixed && !done.has(r.id) && r.q.y >= y0 && r.q.y + r.q.h <= y0 + vp.height - 4);
      if (!todo.length) continue;
      await page.evaluate((y) => window.scrollTo(0, y), y0);
      await sleep(50);
      const sy = await page.evaluate(() => window.scrollY);
      // only line boxes that are really on top at this scroll position and fully inside every scroll container they sit in
      const ok = await page.evaluate(runProbe, { runs: todo.map((r) => ({ i: r.i, x: r.q.x, y: r.q.y, w: r.q.w, h: r.q.h })), doc: true });
      const sample = todo.filter((r, n) => ok[n]);
      if (!sample.length) continue;
      const shot = await page.screenshot();
      // nothing may have moved while the picture was taken (a smooth scroll, a sheet settling): probe again and keep only the runs still in place
      const still = await page.evaluate(runProbe, { runs: sample.map((r) => ({ i: r.i, x: r.q.x, y: r.q.y, w: r.q.w, h: r.q.h })), doc: true });
      const items = sample.filter((r, n) => still[n]).map((r) => ({ i: r.id, fg: targets[r.i].fg, rects: [{ x: r.q.x, y: r.q.y - sy, w: r.q.w, h: r.q.h }] }));
      if (!items.length) continue;
      const res = await page.evaluate(pixelContrast, { png: `data:image/png;base64,${shot.toString('base64')}`, items });
      for (const r of res) { r.shot = process.env.DEBUG_CONTRAST_DIR ? shot : null; r.via = `${pass}@${y0}/sy${sy}`; done.set(r.i, r); }
    }
    if (hide) await hide.evaluate((n) => n.remove());
  }
  // Pass C: text inside an inner scroller (a dialog body, a list) that the page scroll never brought fully into view: scroll that element itself to the middle.
  const left = targets.filter((t) => t.rects.some((q, k) => !done.has(`${t.i}:${k}`)) && !t.rects.some((q, k) => done.has(`${t.i}:${k}`))).slice(0, 80);
  for (const t of left) {
    const hide = t.fixed ? null : await page.addStyleTag({ content: '[data-qa-fixed]{visibility:hidden !important}' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const got = await page.evaluate(scrollRuns, { i: t.i, scroll: true });
      await sleep(80 + attempt * 150);
      const ok = got.rects.length ? await page.evaluate(runProbe, { runs: got.rects.map((q) => ({ i: t.i, ...q })), doc: false }) : [];
      const shot = await page.screenshot();
      const again = await page.evaluate(scrollRuns, { i: t.i, scroll: false }); // the picture only counts if nothing moved while it was taken
      const keep = got.rects.filter((q, n) => ok[n] && again.rects[n] && Math.abs(again.rects[n].x - q.x) < 1 && Math.abs(again.rects[n].y - q.y) < 1);
      if (!keep.length) continue;
      const res = await page.evaluate(pixelContrast, { png: `data:image/png;base64,${shot.toString('base64')}`, items: keep.map((q, n) => ({ i: `${t.i}:${n}`, fg: t.fg, rects: [q] })) });
      for (const r of res) { r.shot = process.env.DEBUG_CONTRAST_DIR ? shot : null; r.via = `C#${attempt}`; done.set(r.i, r); }
      break;
    }
    if (hide) await hide.evaluate((n) => n.remove());
  }
  await freeze.evaluate((n) => n.remove());
  await page.evaluate(() => window.scrollTo(0, 0));
  let bad = 0;
  for (const t of targets) {
    const mine = t.rects.map((q, k) => done.get(`${t.i}:${k}`)).filter(Boolean);
    if (!mine.length) { note('contrast-unverified'); continue; }
    note('contrast-verified');
    const r = mine.reduce((w, x) => (x.worst < w.worst ? x : w));
    if (r.worst < t.need - 0.01) {
      bad += 1;
      if (r.shot && process.env.DEBUG_CONTRAST_DIR) { fs.mkdirSync(process.env.DEBUG_CONTRAST_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.DEBUG_CONTRAST_DIR, `${label.replace(/\W+/g, '_')}-${info.vp}-${info.theme}-${t.i}.png`), r.shot); }
      if (bad <= 10) fail({ ...info, key: label }, 'contrast', `${t.name} "${t.text}" ${r.worst.toFixed(2)}:1 < ${t.need}:1 over rgb(${r.worstBg}) at ${r.worstAt} in ${r.box} via ${r.via} with text rgba(${t.fg.map((n, k) => (k < 3 ? Math.round(n) : Math.round(n * 100) / 100)).join(',')})`);
    }
  }
  return bad;
}

/**
 * Audit the current state of `page`. `opt`: { core, focus, scroll }. Returns after recording failures.
 */
async function auditState(page, log, info, name, opt = {}) {
  const label = `${info.screen}/${name}`;
  const sinfo = { ...info, key: label };
  if (info.coreOnly && !opt.core) return;
  if (opt.thin && !info.thick) return; // a repeat of a layout already audited: only on the sampled (viewport, theme) pairs unless FULL=1
  stats.states += 1;
  const tp = Date.now();
  await settle(page);
  const tSettle = Date.now() - tp;
  if (opt.scroll) await scrollThrough(page);
  // the route did not fall over
  const broken = await page.evaluate(() => ({
    err: !!document.querySelector('[data-testid="view-error"]'),
    empty: !document.querySelector('#app') || document.querySelector('#app').children.length === 0
  })).catch(() => ({ err: false, empty: true }));
  if (broken.err) fail(sinfo, 'load', 'the dashboard shows its "view-error" screen');
  if (broken.empty) fail(sinfo, 'load', '#app is empty');
  // static audit
  const t1 = Date.now();
  const a = await page.evaluate(auditPage, { tapMin: TAP_MIN });
  const tAudit = Date.now() - t1;
  stats.elements = (stats.elements || 0) + a.counts.elements; stats.interactive = (stats.interactive || 0) + a.counts.interactive; stats.images = (stats.images || 0) + a.counts.images;
  for (const s of a.overflow) fail(sinfo, 'overflow', s);
  for (const s of a.wide.slice(0, 8)) fail(sinfo, 'wide-element', s);
  for (const s of a.taps.slice(0, 20)) fail(sinfo, 'tap-target', s);
  for (const s of a.clipped.slice(0, 10)) fail(sinfo, 'text-clipped', s);
  for (const s of a.images.slice(0, 8)) fail(sinfo, 'image-dims', s);
  if (a.taps.length > 20) fail(sinfo, 'tap-target', `... and ${a.taps.length - 20} more`);
  // layout shift
  const cls = await page.evaluate(() => ({ v: window.__cls || 0, s: window.__shifts || [] })).catch(() => ({ v: 0, s: [] }));
  if (cls.v >= CLS_LIMIT) fail(sinfo, 'cls', `${cls.v.toFixed(4)} >= ${CLS_LIMIT}: ${cls.s.slice(0, 4).map((x) => `${x.v}@${x.t}ms ${x.n}`).join('; ')}`);
  // axe
  const t2 = Date.now();
  try {
    const v = await runAxe(page);
    for (const x of v) {
      const contrast = x.id === 'color-contrast';
      if (!contrast && x.impact !== 'serious' && x.impact !== 'critical') { note('axe-minor'); continue; }
      fail(sinfo, contrast ? 'contrast' : 'axe', `${x.id} (${x.impact}) x${x.count}: ${x.help}. ${x.nodes.map((n) => `${n.t}${n.d ? ` [${n.d}]` : ''}`).join(' ; ')}`);
    }
  } catch (e) { fail(sinfo, 'axe', `axe did not run: ${e.message.split('\n')[0]}`); }
  if (info.contrastOk) {
    try { await verifyIncompleteContrast(page, info, label); } catch (e) { fail(sinfo, 'contrast', `pixel contrast check did not run: ${e.message.split('\n')[0]}`); }
  }
  if (process.env.PROFILE) console.log(`   [profile] ${label}: settle ${tSettle}ms audit ${tAudit}ms axe ${Date.now() - t2}ms`);
  // console / requests collected so far
  for (const [check, text] of log.items.splice(0)) fail(sinfo, check, text);
  // focus ring
  if (opt.focus && info.focusOk && DO_FOCUS) {
    const stops = await focusWalk(page, sinfo, name);
    for (const [check, text] of log.items.splice(0)) fail(sinfo, check, text);
    sinfo.stops = stops;
  }
}

// ---------------------------------------------------------------- environment (ids and links taken from the seeded store)
async function bootstrapEnv(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard.html?${NOW}#/today`, { waitUntil: 'networkidle' });
  await page.waitForSelector(T('db-view'), { timeout: 15000 });
  const env = await page.evaluate(async () => {
    const store = await import('/js/core/store.js');
    const handoff = await import('/js/core/handoff.js');
    const st = store.getState();
    const bookings = st.bookings || [];
    const quotes = Object.values(st.quotes || {});
    const by = (s) => quotes.find((q) => q.status === s);
    const sent = quotes.find((q) => q.status === 'sent' && q.validUntil >= '2026-10-24') || by('sent');
    const synth = (id, validUntil, notes) => ({
      id, customerFirst: 'Aoife', customerName: 'Aoife Magee', brand: 'Zappi', status: 'sent', validUntil, sentAt: '2026-10-22T09:15', createdAt: '2026-10-22T09:15', notes,
      lines: [
        { label: 'Smart home charger, supply and fit', detail: 'Tethered 7 kW unit on the front wall', qty: 1, unitPrice: 1050 },
        { label: 'Extra cable run beyond 10 m', detail: '', qty: 6, unitPrice: 12 },
        { label: 'Surge protection', detail: 'Type 2 device at the consumer unit', qty: 1, unitPrice: 160, optional: true },
        { label: 'Making good and testing', detail: 'Certificate included', qty: 1, unitPrice: 85 }
      ]
    });
    const extra = { ref: 'EL-9001', postcode: 'BT9 6QP' };
    const hash = (q, ex) => { const u = handoff.quoteLink(q, ex); const i = u.indexOf('#'); return i < 0 ? '' : u.slice(i); };
    const linkQuote = synth('Q-EL-9001', '2026-11-20', 'Cable route agreed on the survey, café side wall. Thanks for your time on Tuesday.');
    const expiredQuote = synth('Q-EL-9002', '2026-10-20', '');
    const enq = handoff.buildEnquiryPayload({
      ref: 'EL-9003', createdAt: '2026-10-23T20:30', customer: { name: 'Aoife Ní Mhaoláin', phone: '07700 900231', email: 'aoife@example.com' }, address: { postcode: 'BT9 6QP' },
      answers: { parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, notes: 'Café side wall, about 8 m of cable run. Budget around £1.5k.'
    });
    let accHash = '';
    if (sent) {
      const acc = handoff.buildAcceptancePayload({ quote: sent, days: ['thu', 'fri'], part: 'am', note: 'Please ring first.' });
      if (acc) accHash = `#import=${handoff.encodePayload(acc)}`;
    }
    const enquiry = bookings.find((b) => b.serviceId === 'ev_quote' && b.status === 'new');
    const withQuote = sent ? bookings.find((b) => b.id === sent.bookingId) : null;
    const job = bookings.find((b) => b.serviceId === 'ev' && b.status === 'confirmed') || bookings.find((b) => b.status === 'confirmed');
    const expiredSeed = quotes.find((q) => ['sent', 'viewed'].includes(q.status) && q.validUntil < '2026-10-23');
    return {
      enquiryId: enquiry && enquiry.id, quoteBookingId: withQuote && withQuote.id, jobId: job && job.id,
      quoteSent: sent && sent.id, quoteAccepted: by('accepted') && by('accepted').id, quoteDraft: by('draft') && by('draft').id,
      quoteDeclined: by('declined') && by('declined').id, quoteExpired: expiredSeed && expiredSeed.id,
      linkOpen: hash(linkQuote, extra), linkExpired: hash(expiredQuote, extra),
      importEnquiry: enq ? `#import=${handoff.encodePayload(enq)}` : '', importAcceptance: accHash
    };
  });
  await page.close();
  return env;
}

// ---------------------------------------------------------------- screens
const dashUrl = (hash) => `${BASE}/dashboard.html?${NOW}${hash}`;
async function gotoDash(page, hash) {
  await page.goto(dashUrl(hash), { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-testid="db-view"],[data-testid="view-error"]') && !document.querySelector('[data-testid="view-loading"]'), null, { timeout: 15000 });
}
async function gotoQuote(page, hash) {
  await page.goto(`${BASE}/quote.html?${NOW}${hash}`, { waitUntil: 'load' });
  await page.waitForSelector(T('q2-page'), { timeout: 20000 });
}

const dashScreen = (id, hash, { core = false, need, ready } = {}) => ({
  id: `dashboard/${id}`, page: 'dashboard', core, need,
  run: async (page, env, A) => {
    const h = typeof hash === 'function' ? hash(env) : hash;
    await gotoDash(page, h);
    if (ready) await page.waitForSelector(ready, { timeout: 8000 }).catch(() => {});
    await A(id, { core });
  }
});

const ANSWERS = [['parking', 'driveway'], ['vehicle', 'ordered'], ['timing', 'asap'], ['permission', 'yes']];

const SCREENS = [
  // ---- index.html
  {
    id: 'index/landing', page: 'index', core: true, motion: true,
    run: async (page, env, A) => {
      await page.goto(`${BASE}/index.html?${NOW}`, { waitUntil: 'load' });
      await page.waitForSelector('main, [role="main"], h1', { timeout: 15000 });
      await A('landing', { core: true, focus: true, scroll: true });
    }
  },
  {
    id: 'index/funnel', page: 'index', core: true, motion: true,
    run: async (page, env, A) => {
      await page.goto(`${BASE}/index.html?${NOW}#book/ev_quote`, { waitUntil: 'load' });
      await page.waitForSelector(T('funnel-postcode'), { timeout: 15000 });
      await A('funnel-1-postcode', { focus: true });
      await page.fill(T('funnel-postcode'), 'BT9 6QP');
      await page.click(T('funnel-continue'));
      let n = 2;
      for (const [key, value] of ANSWERS) {
        await page.waitForSelector(T(`funnel-option-${key}-${value}`), { timeout: 8000 });
        await A(`funnel-${n}-${key}`, { focus: n === 2, thin: n > 2 }); // steps 3 to 5 repeat step 2's layout
        await page.click(T(`funnel-option-${key}-${value}`));
        n += 1;
      }
      await page.waitForSelector(T('funnel-step-6'), { timeout: 8000 });
      await page.click(T('funnel-submit')); // empty: the error treatment
      await page.waitForSelector(T('funnel-check-summary'), { timeout: 4000 }).catch(() => {});
      await A('funnel-6-errors', {});
      await page.fill(T('field-name'), 'Aoife Ní Mhaoláin');
      await page.fill(T('field-phone'), '07700 900231');
      await page.fill(T('funnel-email'), 'aoife@example.com');
      await A('funnel-6-contact', { core: true, focus: true });
      await page.click(T('funnel-submit'));
      await page.waitForSelector(T('confirmation'), { timeout: 10000 });
      await A('confirmation', { core: true, focus: true });
      if (await page.locator(T('demo-toggle')).count()) {
        await page.click(T('demo-toggle'));
        await sleep(300);
        await A('confirmation-demo-panel', {});
      }
    }
  },
  // ---- quote.html
  {
    id: 'quote/same-browser', page: 'quote', motion: false,
    run: async (page, env, A) => {
      await gotoDash(page, '#/today'); // seeds this browser's store, so the quote is "mine"
      await gotoQuote(page, `#q=${env.quoteSent}`);
      await A('quote-same-browser', {});
    }
  },
  {
    id: 'quote/link', page: 'quote', core: true, motion: true,
    run: async (page, env, A) => {
      await gotoQuote(page, env.linkOpen);
      await A('quote-link', { core: true });
      if (await page.locator(T('q2-accept')).count()) {
        await page.click(T('q2-accept'));
        await page.waitForSelector(T('q2-days-sheet'), { timeout: 6000 }).catch(() => {});
        await A('quote-link-accept-sheet', {});
      }
    }
  },
  {
    id: 'quote/expired', page: 'quote',
    run: async (page, env, A) => { await gotoQuote(page, env.linkExpired); await A('quote-expired', {}); }
  },
  {
    id: 'quote/invalid', page: 'quote',
    run: async (page, env, A) => {
      await gotoQuote(page, '#d=garbage');
      await A('quote-invalid-link', {});
      await gotoQuote(page, '#q=Q-NOPE-9');
      await A('quote-invalid-id', {});
    }
  },
  {
    id: 'quote/accepted', page: 'quote',
    run: async (page, env, A) => {
      await gotoDash(page, '#/today');
      await gotoQuote(page, `#q=${env.quoteAccepted}`);
      await A('quote-accepted', {});
    }
  },
  // ---- dashboard.html (every route)
  dashScreen('today', '#/today', { core: true }),
  dashScreen('calendar', '#/calendar'),
  dashScreen('bookings', '#/bookings'),
  dashScreen('bookings-detail-enquiry', (e) => `#/bookings/${e.enquiryId}`, { core: true }),
  dashScreen('bookings-detail-job', (e) => `#/bookings/${e.jobId}`),
  dashScreen('bookings-detail-quote', (e) => `#/bookings/${e.quoteBookingId}`),
  dashScreen('pipeline', '#/pipeline'),
  dashScreen('quotes', '#/quotes'),
  dashScreen('quotes-detail-sent', (e) => `#/quotes/${e.quoteSent}`),
  dashScreen('quotes-detail-accepted', (e) => `#/quotes/${e.quoteAccepted}`),
  dashScreen('quotes-detail-draft', (e) => `#/quotes/${e.quoteDraft}`),
  dashScreen('insights', '#/insights'),
  dashScreen('messages', '#/messages'),
  dashScreen('more', '#/more'),
  dashScreen('settings', '#/settings'),
  dashScreen('share', '#/share'),
  dashScreen('customers', '#/customers'),
  dashScreen('about', '#/about'),
  dashScreen('demo', '#/demo'),
  dashScreen('new', '#/new'),
  dashScreen('import-enquiry', (e) => e.importEnquiry, { ready: T('f4-view') }),
  dashScreen('import-acceptance', (e) => e.importAcceptance, { ready: T('f4-view') }),
  dashScreen('connections', '#/connections'),
  dashScreen('connections-domain', '#/connections/domain'),
  dashScreen('connections-webhook', '#/connections/webhook'),
  dashScreen('connections-tracking', '#/connections/tracking'),
  dashScreen('connections-whatsapp', '#/connections/whatsapp'),
  dashScreen('connections-calendar', '#/connections/calendar'),
  dashScreen('connections-email', '#/connections/email')
];

// ---- extra states: the things behind a tap (sheets, lightbox, accordions, builder, wizard steps). They run at 375 and 1440 only; the ones that write to the store run last.
const must = async (page, sel, ms = 6000) => { await page.waitForSelector(sel, { timeout: ms, state: 'visible' }).catch(() => { throw new Error(`expected control not found: ${sel}`); }); };
const tap = async (page, sel) => { await must(page, sel); await page.click(sel); };
async function expandAll(page, max = 40) {
  // Both kinds of disclosure: aria-expanded buttons and native <details>. A real mouse click (not el.click()): layout moves within half a second of a tap are
  // expected and are not counted by the layout-shift metric.
  const closed = '#app [aria-expanded="false"]:not([data-qa-done]), #app details:not([open]) > summary:not([data-qa-done])';
  for (let i = 0; i < max; i += 1) {
    const btn = page.locator(closed).first();
    if (!(await btn.count())) break;
    await btn.evaluate((b) => b.setAttribute('data-qa-done', '1'));
    await btn.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await btn.click({ timeout: 2000 }).catch(() => {});
    await sleep(60);
  }
  await sleep(250);
}
const EXTRAS = [
  {
    id: 'index/landing-open', page: 'index', extra: true,
    run: async (page, env, A) => {
      await page.goto(`${BASE}/index.html?${NOW}`, { waitUntil: 'load' });
      await tap(page, T('faq-q-0'));
      await A('landing-faq-open', { thin: true });
      await tap(page, T('l3-gallery-open-0'));
      await must(page, T('l3-lightbox'));
      await A('landing-lightbox', { thin: true });
    }
  },
  {
    id: 'quote/link-decline', page: 'quote', extra: true,
    run: async (page, env, A) => {
      await gotoQuote(page, env.linkOpen);
      await tap(page, T('q2-decline'));
      await must(page, '[role="dialog"]');
      await A('quote-link-decline-sheet', {});
    }
  },
  {
    id: 'dashboard/x-bookings-filter', page: 'dashboard', extra: true,
    run: async (page, env, A) => { await gotoDash(page, '#/bookings'); await tap(page, T('bookings-filter-open')); await must(page, '[role="dialog"]'); await A('bookings-filter-sheet', {}); }
  },
  {
    id: 'dashboard/x-messages-open', page: 'dashboard', extra: true,
    run: async (page, env, A) => { await gotoDash(page, '#/messages'); await tap(page, '[data-testid^="message-toggle-"]'); await A('messages-row-open', {}); }
  },
  {
    id: 'dashboard/x-import-garbage', page: 'dashboard', extra: true,
    run: async (page, env, A) => { await gotoDash(page, '#import=garbage'); await must(page, T('f4-view')); await A('import-garbage', {}); }
  },
  {
    id: 'dashboard/x-expanded', page: 'dashboard', extra: true,
    run: async (page, env, A) => {
      if (A.info.vp === '1440x900' && A.info.theme === 'light' && !FULL) return; // sampled: 375 dark and light, 1440 dark
      for (const [name, hash] of [['settings', '#/settings'], ['about', '#/about'], ['insights', '#/insights'], ['messages', '#/messages'], ['booking-detail', `#/bookings/${env.quoteBookingId}`], ['quote-detail', `#/quotes/${env.quoteSent}`], ['connections-webhook', '#/connections/webhook'], ['connections-tracking', '#/connections/tracking']]) {
        await page.goto('about:blank'); // a fresh document per screen: the layout-shift count must start at zero
        await gotoDash(page, hash);
        await expandAll(page, name === 'messages' ? 6 : 40);
        await A(`${name}-expanded`, {});
      }
    }
  },
  {
    id: 'dashboard/x-pipeline-stages', page: 'dashboard', extra: true,
    run: async (page, env, A) => {
      await gotoDash(page, '#/pipeline');
      const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="p1-stage-"]')).map((e) => e.getAttribute('data-testid')).filter((t) => !/^p1-stage-(count|value)-/.test(t) && !/^p1-stage-n/.test(t)));
      for (const id of ids.slice(0, 6)) {
        if (!(await page.locator(T(id)).first().isVisible().catch(() => false))) continue; // wide screens show every stage as a column instead of tabs
        await page.click(T(id));
        await sleep(300);
        await A(`pipeline-${id.replace('p1-stage-', '')}`, {});
      }
    }
  },
  {
    id: 'dashboard/z-quote-builder', page: 'dashboard', extra: true, late: true,
    run: async (page, env, A) => {
      await gotoDash(page, '#/quotes');
      await tap(page, T('q1-new'));
      await tap(page, T(`q1-pick-${env.enquiryId}`));
      await must(page, T('q1-builder'));
      await A('quote-builder', {});
      await tap(page, T('q1-send'));
      await must(page, T('q1-send-sheet'));
      await A('quote-send-sheet', {});
    }
  },
  {
    id: 'dashboard/z-wizard-steps', page: 'dashboard', extra: true, late: true,
    run: async (page, env, A) => {
      for (const w of ['domain', 'whatsapp', 'calendar', 'email']) {
        await page.goto('about:blank');
        await gotoDash(page, `#/connections/${w}`);
        const next = '[data-testid$="-wizard-next"]';
        if (!(await page.locator(next).first().isEnabled().catch(() => false))) continue;
        await page.click(next);
        await sleep(450);
        await A(`wizard-${w}-step-2`, {});
      }
    }
  }
];
SCREENS.push(...EXTRAS);

const wanted = (s) => !ONLY.length || ONLY.some((o) => s.page === o || s.id.toLowerCase() === o || (o.includes('/') && s.id.toLowerCase().startsWith(o)) || (o === 'landing' && s.id === 'index/landing') || (o === 'funnel' && s.id === 'index/funnel'));

// ---------------------------------------------------------------- self test: the detectors must fire on a page built to fail (SELFTEST=1)
async function selfTest(browser) {
  const ctx = await newContext(browser, '375x812', 'dark', { reduce: true, mobile: false });
  const page = await ctx.newPage();
  const log = { items: [] };
  attachLog(page, log);
  const dot = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22100%22%3E%3Crect width=%22200%22 height=%22100%22 fill=%22%23888%22/%3E%3C/svg%3E';
  await ctx.route(`${BASE}/__selftest.html`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>t</title>
    <style>body{margin:0;background:#fff;color:#000;font:16px sans-serif}@keyframes spin{to{transform:rotate(1turn)}}.spin{animation:spin 5s linear infinite;width:20px;height:20px;background:red}</style></head>
    <body><main><h1>Self test</h1>
    <div id="wide" style="width:900px;height:10px;background:red"></div>
    <button id="small" style="width:30px;height:30px">x</button>
    <a id="smalllink" href="#a" style="display:block;width:20px;height:20px">a</a>
    <p>A sentence with <a id="inline" href="#b">an inline link</a> in it.</p>
    <div id="clip" style="width:60px;overflow:hidden;white-space:nowrap">Some long clipped text here</div>
    <img id="noimg" src="${dot}" style="width:100px" alt="x">
    <img id="okimg" src="${dot}" width="200" height="100" alt="y">
    <p id="lowc" style="color:#bbb;background:#fff">low contrast words</p>
    <p id="lowg" style="color:#ccc;background:linear-gradient(#999,#aaa);padding:8px">low contrast on a gradient (axe cannot judge it)</p>
    <p id="okg" style="color:#fff;background:linear-gradient(#111,#222);padding:8px">fine contrast on a gradient</p>
    <button id="noring" style="outline:none;border:0;background:#fff;min-height:44px;min-width:44px">noring</button>
    <button id="ring" style="min-height:44px;min-width:44px">ring</button>
    <div class="spin"></div>
    <div id="late"></div><p id="below">below</p>
    <script>console.error('boom'); setTimeout(function(){document.getElementById('late').style.height='300px'},400)</script>
    </main></body></html>` }));
  await page.goto(`${BASE}/__selftest.html`, { waitUntil: 'load' });
  await sleep(900);
  const a = await page.evaluate(auditPage, { tapMin: TAP_MIN });
  const has = (arr, re) => arr.some((x) => re.test(x));
  const checks = [];
  const expect = (name, ok) => { checks.push([name, ok]); };
  expect('overflow detected', a.overflow.length > 0);
  expect('wide element detected', has(a.wide, /div#wide/));
  expect('small button detected', has(a.taps, /button#small/));
  expect('small link detected', has(a.taps, /a#smalllink/));
  expect('inline link in a sentence not flagged', !has(a.taps, /a#inline/));
  expect('44px buttons not flagged', !has(a.taps, /noring|button#ring/));
  expect('clipped text detected', has(a.clipped, /div#clip/));
  expect('image without dimensions detected', has(a.images, /img#noimg/) && !has(a.images, /img#okimg/));
  const ax = await (async () => { await page.evaluate(AXE_SOURCE); return runAxe(page); })();
  expect('axe color-contrast detected', ax.some((v) => v.id === 'color-contrast'));
  const cbefore = failures.length;
  await verifyIncompleteContrast(page, { screen: 'selftest', vp: '375x812', theme: 'dark', key: 'selftest' }, 'selftest');
  const cfails = failures.slice(cbefore).filter((f) => f.check === 'contrast');
  failures.length = cbefore;
  expect(`pixel contrast catches low contrast on a gradient and passes the good one (${cfails.map((f) => f.detail.slice(0, 50)).join(' / ')})`, cfails.some((f) => /low contrast on a gradient/.test(f.detail)) && !cfails.some((f) => /fine contrast/.test(f.detail)));
  const mo = await page.evaluate(motionProbe);
  expect('long animation detected', mo.some((m) => /infinite/.test(m)));
  const cls = await page.evaluate(() => window.__cls || 0);
  expect(`layout shift measured (${cls})`, cls > 0.0001);
  expect('console error captured', log.items.some(([c]) => c === 'console'));
  const info = { screen: 'selftest', vp: '375x812', theme: 'dark', key: 'selftest' };
  const before = failures.length;
  await focusWalk(page, info, 'selftest', 20);
  const ringFails = failures.slice(before).filter((f) => f.check === 'focus-ring');
  failures.length = before;
  expect(`missing focus ring detected, real one passes (${ringFails.map((f) => f.detail).join(' / ')})`, ringFails.some((f) => /noring/.test(f.detail)) && !ringFails.some((f) => /"ring"/.test(f.detail)));
  await ctx.close();
  let bad = 0;
  for (const [name, ok] of checks) { if (!ok) bad += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} selftest: ${name}`); }
  console.log(bad ? `SELFTEST FAIL (${bad})` : 'SELFTEST PASS: every detector fires on a page built to fail');
  return bad === 0;
}

// ---------------------------------------------------------------- main
function printFailureGroups(list, limit = 400) {
  // group identical (check, detail) across viewports / themes
  const groups = new Map();
  for (const f of list) {
    const k = `${f.check}|${f.key}|${f.detail}`;
    if (!groups.has(k)) groups.set(k, { ...f, where: new Set() });
    groups.get(k).where.add(`${f.vp}/${f.theme}`);
  }
  let i = 0;
  for (const g of groups.values()) {
    if (i >= limit) { console.log(`  ... ${groups.size - limit} more groups (see REPORT)`); break; }
    console.log(`  FAIL [${g.check}] ${g.key} @ ${Array.from(g.where).join(', ')}: ${g.detail}`);
    i += 1;
  }
  return groups.size;
}

async function main() {
  const t0 = Date.now();
  BASE = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  let exitCode = 0;
  try {
    if (process.env.SELFTEST === '1') { process.exitCode = (await selfTest(browser)) ? 0 : 1; return; }
    const screens = SCREENS.filter(wanted).sort((a, b) => (a.late ? 1 : 0) - (b.late ? 1 : 0));
    if (!screens.length) { console.log(`ONLY=${process.env.ONLY} matches no screen`); process.exitCode = 2; return; }
    for (const vp of VIEWPORT_LIST) {
      const broad = FULL || BROAD_VIEWPORTS.includes(vp);
      for (const theme of THEMES) {
        const ctx = await newContext(browser, vp, theme);
        const env = await bootstrapEnv(ctx);
        const missing = ['enquiryId', 'jobId', 'quoteBookingId', 'quoteSent', 'quoteAccepted', 'quoteDraft', 'linkOpen', 'linkExpired', 'importEnquiry'].filter((k) => !env[k]);
        if (missing.length) { console.log(`FAIL setup: the seeded store has no ${missing.join(', ')}`); failures.push({ key: 'setup', vp, theme, check: 'load', detail: `no ${missing.join(', ')}` }); }
        for (const screen of screens) {
          if (!broad && !screen.core) continue;
          const before = failures.length;
          const started = Date.now();
          const info = { screen: screen.id, vp, theme, key: screen.id, coreOnly: !broad, thick: FULL || (vp === '375x812' && theme === 'dark') || (vp === '1440x900' && theme === 'light'), focusOk: BROAD_VIEWPORTS.includes(vp), contrastOk: BROAD_VIEWPORTS.includes(vp) || FULL };
          // A screen that cannot be driven (a timeout on a busy machine) is tried once more on a fresh page before it counts as broken.
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            const page = await ctx.newPage();
            const log = { items: [] };
            attachLog(page, log);
            const A = (name, opt) => auditState(page, log, info, name, opt);
            A.info = info;
            const keep = failures.length;
            try {
              await screen.run(page, env, A);
              for (const [check, text] of log.items.splice(0)) fail({ ...info, key: `${screen.id}/end` }, check, text);
              await page.close().catch(() => {});
              break;
            } catch (e) {
              await page.close().catch(() => {});
              if (attempt === 1) { failures.length = keep; stats.retries = (stats.retries || 0) + 1; continue; }
              fail({ ...info, key: screen.id }, 'load', `${e.message.split('\n')[0]}`);
            }
          }
          stats.runs += 1;
          const mine = failures.length - before;
          const secs = ((Date.now() - started) / 1000).toFixed(1);
          (stats.times = stats.times || {})[screen.id] = ((stats.times || {})[screen.id] || 0) + (Date.now() - started) / 1000;
          if (mine || VERBOSE) console.log(`${mine ? 'FAIL' : 'ok  '} ${screen.id} @ ${vp} ${theme} (${secs}s${mine ? `, ${mine} problem${mine === 1 ? '' : 's'}` : ''})`);
        }
        await ctx.close();
      }
    }

    // ---- reduced motion pass (its own contexts)
    if (DO_MOTION) {
      for (const vp of ['375x812', '1440x900'].filter((v) => VIEWPORT_LIST.includes(v))) {
        const theme = vp === '375x812' ? 'dark' : 'light';
        if (!THEMES.includes(theme)) continue;
        const ctx = await newContext(browser, vp, theme, { reduce: true });
        const env = await bootstrapEnv(ctx);
        const rm = async (page, info, label) => {
          await sleep(120);
          const found = await page.evaluate(motionProbe).catch(() => []);
          note('motion-probes');
          for (const f of found.slice(0, 6)) fail({ ...info, key: label }, 'reduced-motion', f);
        };
        const steps = [
          ['index/landing', async (page, info) => {
            await page.goto(`${BASE}/index.html?${NOW}`, { waitUntil: 'load' });
            await rm(page, info, 'landing (load)');
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
            await rm(page, info, 'landing (scrolled)');
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await rm(page, info, 'landing (bottom)');
          }],
          ['index/funnel', async (page, info) => {
            await page.goto(`${BASE}/index.html?${NOW}#book/ev_quote`, { waitUntil: 'load' });
            await page.waitForSelector(T('funnel-postcode'), { timeout: 15000 });
            await rm(page, info, 'funnel step 1');
            await page.fill(T('funnel-postcode'), 'BT9 6QP');
            await page.click(T('funnel-continue'));
            let n = 2;
            for (const [key, value] of ANSWERS) {
              await page.waitForSelector(T(`funnel-option-${key}-${value}`), { timeout: 8000 });
              await rm(page, info, `funnel step ${n}`);
              await page.click(T(`funnel-option-${key}-${value}`));
              n += 1;
            }
            await page.waitForSelector(T('funnel-step-6'), { timeout: 8000 });
            await rm(page, info, 'funnel step 6');
            await page.fill(T('field-name'), 'Aoife Ní Mhaoláin');
            await page.fill(T('field-phone'), '07700 900231');
            await page.fill(T('funnel-email'), 'aoife@example.com');
            await page.click(T('funnel-submit'));
            await page.waitForSelector(T('confirmation'), { timeout: 10000 });
            await rm(page, info, 'confirmation');
          }],
          ['quote/link', async (page, info) => {
            await gotoQuote(page, env.linkOpen);
            await rm(page, info, 'quote link');
            if (await page.locator(T('q2-accept')).count()) { await page.click(T('q2-accept')); await rm(page, info, 'quote accept sheet'); }
          }],
          ['dashboard/today', async (page, info) => { await gotoDash(page, '#/today'); await rm(page, info, 'today'); }],
          ['dashboard/bookings', async (page, info) => { await gotoDash(page, '#/bookings'); await rm(page, info, 'bookings'); await page.goto(dashUrl(`#/bookings/${env.enquiryId}`), { waitUntil: 'load' }); await rm(page, info, 'booking detail'); }],
          ['dashboard/settings', async (page, info) => { await gotoDash(page, '#/settings'); await rm(page, info, 'settings'); }],
          ['dashboard/connections-domain', async (page, info) => { await gotoDash(page, '#/connections/domain'); await rm(page, info, 'domain wizard'); }]
        ];
        for (const [id, fn] of steps) {
          if (ONLY.length && !ONLY.some((o) => id.startsWith(`${o}/`) || id.toLowerCase().includes(o))) continue;
          const page = await ctx.newPage();
          const log = { items: [] };
          attachLog(page, log);
          const info = { screen: `${id} (reduced motion)`, vp, theme };
          const before = failures.length;
          try { await fn(page, info); } catch (e) { fail({ ...info, key: id }, 'load', e.message.split('\n')[0]); }
          for (const [check, text] of log.items.splice(0)) fail({ ...info, key: `${id}/end` }, check, text);
          await page.close().catch(() => {});
          stats.runs += 1;
          const mine = failures.length - before;
          if (mine || VERBOSE) console.log(`${mine ? 'FAIL' : 'ok  '} ${id} @ ${vp} ${theme} reduced motion${mine ? ` (${mine} problems)` : ''}`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
  }

  // ---- summary
  stats.ms = Date.now() - t0;
  console.log('\n==== MATRIX SUMMARY ====');
  const groups = failures.length ? printFailureGroups(failures) : 0;
  const byCheck = {};
  for (const f of failures) byCheck[f.check] = (byCheck[f.check] || 0) + 1;
  console.log(`viewports: ${VIEWPORT_LIST.join(', ')}; themes: ${THEMES.join(', ')}; screens: ${SCREENS.filter(wanted).length}${FULL ? ' (FULL)' : ''}`);
  console.log(`page runs: ${stats.runs}; states audited: ${stats.states} (${stats.elements || 0} elements, ${stats.interactive || 0} interactive controls, ${stats.images || 0} images measured); minor axe notes (not failures): ${stats.perCheck['axe-minor'] || 0}; focus walks: ${stats.perCheck['focus-stops'] || 0}; text runs axe could not judge, measured from pixels: ${stats.perCheck['contrast-verified'] || 0} (${stats.perCheck['contrast-unverified'] || 0} hidden behind sticky bars, unmeasured); motion probes: ${stats.perCheck['motion-probes'] || 0}`);
  if (stats.times) console.log(`slowest screens (s, all runs): ${Object.entries(stats.times).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}`);
  console.log(`time: ${(stats.ms / 1000).toFixed(0)}s${stats.retries ? `; screens retried once after a driving timeout: ${stats.retries}` : ''}`);
  if (failures.length) {
    console.log(`RESULT: FAIL, ${failures.length} problems in ${groups} groups: ${Object.entries(byCheck).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    exitCode = 1;
  } else {
    console.log('RESULT: PASS (zero problems)');
  }
  if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ stats, failures }, null, 1));
  process.exitCode = exitCode;
}

main().catch((e) => { console.error(e); if (server) server.kill(); process.exit(2); });
