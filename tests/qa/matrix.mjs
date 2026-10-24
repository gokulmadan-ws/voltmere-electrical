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
//   contrast       axe color-contrast: zero violations (text/background AA)
//   focus-ring     the landing page and every funnel step: a visible focus indicator on every Tab stop (computed outline, else a before/after pixel difference)
//   text-clipped   no text cut off by overflow:hidden (scrollWidth > clientWidth), and no fixed-height box cutting text vertically
//   image-dims     every img has width+height attributes or an aspect-ratio (itself or a wrapper), loads, and is not distorted
//   cls            layout shift while the page loads (PerformanceObserver; photos answer 250 ms late so a missing reservation shows) is below 0.05
//   reduced-motion with prefers-reduced-motion: reduce no animation longer than 150 ms or infinite is running, and scroll-behavior is auto
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
const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#444"/><rect x="40" y="40" width="1120" height="720" fill="#555"/></svg>';
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
  const out = { vw, overflow: [], wide: [], taps: [], clipped: [], images: [] };
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
      out.clipped.push(`${desc(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}${ell ? ' (ellipsis)' : ''}`);
    } else if (hidden.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && shown(el) && !/-webkit-box/.test(cs.display) && cs.webkitLineClamp === 'none') {
      out.clipped.push(`${desc(el)} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight} (vertical)`);
    }
  }

  // 3. tap targets
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], [role="slider"], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const seen = new Set();
  for (const el of document.querySelectorAll(sel)) {
    if (!shown(el)) continue;
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

/** Animations that should not exist under prefers-reduced-motion. */
function motionProbe() {
  const out = [];
  for (const a of document.getAnimations()) {
    if (a.playState !== 'running') continue;
    let t = null;
    try { t = a.effect && a.effect.getComputedTiming(); } catch (e) { t = null; }
    if (!t) continue;
    const total = t.endTime;
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

async function newContext(browser, vp, theme, { reduce = false } = {}) {
  const [w, h] = vp.split('x').map(Number);
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: theme, reducedMotion: reduce ? 'reduce' : 'no-preference'
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
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.evaluate(async () => {
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
    const t0 = performance.now();
    while (performance.now() - t0 < 2600) {
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        try { return Number.isFinite(a.effect.getComputedTiming().endTime); } catch (e) { return false; }
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
  let pending = null; // an element with no outline: compared by pixels once focus has moved on
  let stops = 0;
  const bad = [];
  const pixelCheck = async (p, before) => {
    try {
      const box = await p.handle.boundingBox();
      if (!box) return true; // gone from the page: cannot judge
      const pad = 10;
      const vp = page.viewportSize();
      const clip = (b) => {
        const x = Math.max(0, Math.floor(b.x - pad)); const y = Math.max(0, Math.floor(b.y - pad));
        return { x, y, width: Math.max(1, Math.min(vp.width - x, Math.ceil(b.width + pad * 2))), height: Math.max(1, Math.min(vp.height - y, Math.ceil(b.height + pad * 2))) };
      };
      if (box.y + box.height < 0 || box.y > vp.height || box.x + box.width < 0 || box.x > vp.width) return true;
      const after = await page.screenshot({ clip: clip(box) });
      return !before.equals(after);
    } catch (e) { return true; }
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
    if (pending) {
      const changed = await pixelCheck(pending, pending.shot);
      if (!changed) bad.push(`${pending.desc}: no visible focus indicator (no outline and the pixels do not change)`);
      await pending.handle.dispose().catch(() => {});
      pending = null;
    }
    const f = await page.evaluate(focusProbe);
    if (f.body) break; // focus left the document
    if (first && f.key === first) break; // a full lap (a trapped sheet cycles)
    if (!first) first = f.key;
    stops += 1;
    if (!f.visible) bad.push(`${f.desc}: focused but not visible on screen`);
    else if (f.covered) bad.push(`${f.desc}: focused but covered by ${f.covered}`);
    else if (!f.ring && !f.wrapperRing) {
      const handle = await page.evaluateHandle(() => document.activeElement);
      const vp = page.viewportSize();
      const pad = 10;
      const x = Math.max(0, Math.floor(f.rect.x - pad)); const y = Math.max(0, Math.floor(f.rect.y - pad));
      const shot = await page.screenshot({ clip: { x, y, width: Math.max(1, Math.min(vp.width - x, Math.ceil(f.rect.w + pad * 2))), height: Math.max(1, Math.min(vp.height - y, Math.ceil(f.rect.h + pad * 2))) } }).catch(() => null);
      if (shot) pending = { handle, shot, desc: f.desc };
      else await handle.dispose().catch(() => {});
    }
  }
  if (pending) {
    // the last stop: move focus away with one more Tab
    await page.keyboard.press('Tab'); await sleep(60);
    const changed = await pixelCheck(pending, pending.shot);
    if (!changed) bad.push(`${pending.desc}: no visible focus indicator (no outline and the pixels do not change)`);
    await pending.handle.dispose().catch(() => {});
  }
  note('focus-stops');
  for (const b of bad.slice(0, 12)) fail(info, 'focus-ring', `${label}: ${b}`);
  if (stops === 0) fail(info, 'focus-ring', `${label}: Tab reached no focusable element`);
  return stops;
}

/**
 * Audit the current state of `page`. `opt`: { core, focus, scroll }. Returns after recording failures.
 */
async function auditState(page, log, info, name, opt = {}) {
  const label = `${info.screen}/${name}`;
  const sinfo = { ...info, key: label };
  if (info.coreOnly && !opt.core) return;
  stats.states += 1;
  await settle(page);
  if (opt.scroll) await scrollThrough(page);
  // the route did not fall over
  const broken = await page.evaluate(() => ({
    err: !!document.querySelector('[data-testid="view-error"]'),
    empty: !document.querySelector('#app') || document.querySelector('#app').children.length === 0
  })).catch(() => ({ err: false, empty: true }));
  if (broken.err) fail(sinfo, 'load', 'the dashboard shows its "view-error" screen');
  if (broken.empty) fail(sinfo, 'load', '#app is empty');
  // static audit
  const a = await page.evaluate(auditPage, { tapMin: TAP_MIN });
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
  try {
    const v = await runAxe(page);
    for (const x of v) {
      const contrast = x.id === 'color-contrast';
      if (!contrast && x.impact !== 'serious' && x.impact !== 'critical') { note('axe-minor'); continue; }
      fail(sinfo, contrast ? 'contrast' : 'axe', `${x.id} (${x.impact}) x${x.count}: ${x.help}. ${x.nodes.map((n) => `${n.t}${n.d ? ` [${n.d}]` : ''}`).join(' ; ')}`);
    }
  } catch (e) { fail(sinfo, 'axe', `axe did not run: ${e.message.split('\n')[0]}`); }
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
  await page.waitForSelector(T('q2-page'), { timeout: 15000 });
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
        await A(`funnel-${n}-${key}`, { focus: true });
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

const wanted = (s) => !ONLY.length || ONLY.some((o) => s.page === o || s.id.toLowerCase() === o || (o.includes('/') && s.id.toLowerCase().startsWith(o)) || (o === 'landing' && s.id === 'index/landing') || (o === 'funnel' && s.id === 'index/funnel'));

// ---------------------------------------------------------------- self test: the detectors must fire on a page built to fail (SELFTEST=1)
async function selfTest(browser) {
  const ctx = await newContext(browser, '375x812', 'dark', { reduce: true });
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
  const mo = await page.evaluate(motionProbe);
  expect('long animation detected', mo.some((m) => /infinite/.test(m)));
  const cls = await page.evaluate(() => window.__cls || 0);
  expect('layout shift measured', cls > 0.0001);
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
    const screens = SCREENS.filter(wanted);
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
          const page = await ctx.newPage();
          const log = { items: [] };
          attachLog(page, log);
          const info = { screen: screen.id, vp, theme, key: screen.id, coreOnly: !broad, focusOk: BROAD_VIEWPORTS.includes(vp) };
          const A = (name, opt) => auditState(page, log, info, name, opt);
          try {
            await screen.run(page, env, A);
            for (const [check, text] of log.items.splice(0)) fail({ ...info, key: `${screen.id}/end` }, check, text);
          } catch (e) {
            fail({ ...info, key: screen.id }, 'load', `${e.message.split('\n')[0]}`);
          }
          await page.close().catch(() => {});
          stats.runs += 1;
          const mine = failures.length - before;
          const secs = ((Date.now() - started) / 1000).toFixed(1);
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
  console.log(`page runs: ${stats.runs}; states audited: ${stats.states}; minor axe notes (not failures): ${stats.perCheck['axe-minor'] || 0}; focus walks: ${stats.perCheck['focus-stops'] || 0}; motion probes: ${stats.perCheck['motion-probes'] || 0}`);
  console.log(`time: ${(stats.ms / 1000).toFixed(0)}s`);
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
