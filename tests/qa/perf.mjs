// tests/qa/perf.mjs: the PERF gate. Loads the landing page, the customer quote page and the owner dashboard (#/today) the way a mid-range phone on 4G would,
// reports what it cost and FAILS when a budget is broken.
//
//   QA_DEPS_DIR=/path/with/node_modules node tests/qa/perf.mjs                  (must contain playwright-core)
//   RUNS=5 node tests/qa/perf.mjs            runs per page (default 3; budgets are checked against the MEDIAN, so one noisy run cannot fail the gate)
//   ONLY=landing,quote,dashboard,activity,idle,warm,fonts   run only these sections (landing also does the whole-page scroll check; the default is all of them)
//   PERF_JSON=/path/out.json                 also write every number to a file (to compare before and after)
//   PERF_VERBOSE=1                           print the request waterfall of the first run of every page
//   PERF_CONNECT_MS=450                      also model DNS + TCP + TLS (3 round trips) before the first answer of every new connection (default 0: the plain CDP profile)
//   PERF_PRIORITY=1                          the server honours Chrome's RFC 9218 priorities (most urgent bytes first) instead of sharing the link fairly (see the note above deliver())
//   CPU=4  DOWN_KBPS=1600  RTT_MS=150  PORT=4214  CHROMIUM_PATH=/path/to/chrome
//
// The profile (Lighthouse's mobile defaults): Chromium CPU throttled 4x, the network held to 1.6 Mbps down / 150 ms by CDP, a 412x915 phone at 2.625 DPR, a cold cache,
// gzip on (the way GitHub Pages serves), HTTP/2. The server is this file's own https server (a self-signed certificate from openssl, accepted by the browser flags):
// his two photo hosts (perspective.imgix.net, images.unsplash.com) are mapped by --host-resolver-rules to it, which answers them with real JPEG stand-ins of REALISTIC byte
// sizes (the sandbox cannot reach the real hosts). The stand-in size is pixels x bytes-per-pixel (BPP below: estimates from his real photos, NOT measurements of the live host:
// treat photo timings as approximate). Every request goes through the real network stack, so the throttle, the image decode and the script work all cost what they would.
// The link is shared fairly between open streams, as Lighthouse models it: the worst case for a page that asks for a lot at once. (PERF_PRIORITY=1 gives the best case, a CDN that
// honours Chrome's priorities; on this site it moves the landing LCP by about 0.2 s.) Run it on a quiet machine: the CPU throttle multiplies whatever the machine is doing.
//
// What it measures, per page (the median of RUNS cold loads): requests, transferred bytes, JS and CSS decoded bytes and a gzip estimate, modules fetched, import depth, first
// contentful paint, largest contentful paint (and what it was), the moment the page's main content is there, a total-blocking-time proxy (long tasks after FCP), the longest task,
// layout shift. Landing only: photos fetched before the load event, when the hero photo arrived, and a scroll through the whole page (layout shift, long tasks, listeners that are
// not passive). Then, apart from the loads: a returning visitor (the warm load: 304s), fonts arriving 2.5 s late (layout shift), one store change on the dashboard (how much
// is redone and how soon it is painted), and the idle checks (re-renders, DOM changes, timers and localStorage writes while a page sits untouched).
import { createRequire } from 'node:module';
import http2 from 'node:http2';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/qa';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLOCK = 'now=2026-10-23T20:30&freeze=1';
const require = createRequire(QA_DEPS.endsWith('/') ? QA_DEPS : QA_DEPS + '/');
const { chromium } = require('playwright-core');

const RUNS = Math.max(1, Number(process.env.RUNS || 3));
const CPU = Number(process.env.CPU || 4);
const DOWN_KBPS = Number(process.env.DOWN_KBPS || 1600);
const RTT_MS = Number(process.env.RTT_MS || 150);
const CONNECT_MS = Number(process.env.PERF_CONNECT_MS || 0);
const VERBOSE = !!process.env.PERF_VERBOSE;
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const wants = (name) => ONLY.length === 0 || ONLY.includes(name);
const PHONE = { width: 412, height: 915 };
const DPR = 2.625;
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// ---------------------------------------------------------------- budgets (chosen from the measurements, with headroom for a busy machine)
// requests / bytes are for the FIRST VIEW: everything asked for up to the moment the landing page's hero photo is in, or up to the load event on the other pages (what the landing page
// fetches after its hero photo, the sections below it, the quote form's code and the lazy photos, is reported on its own). Times in ms. Sizes in KB.
// Measured when these budgets were set (median of 3, a shared 4-core machine, so every time can be 5 per cent worse than on a quiet one):
//   landing    55 requests, 447 KB, JS 181 KB gzip in 44 modules, CSS 34 KB gzip, FCP 2.3-2.5 s, LCP 2.9-3.1 s (the hero photo arriving), longest task 160 ms
//   quote      61 requests, 338 KB, JS 205 KB gzip in 50 modules, CSS 44 KB gzip, FCP and LCP 2.3 s, longest task 182 ms
//   dashboard  59 requests, 307 KB, JS 204 KB gzip in 49 modules, CSS 41 KB gzip, FCP and LCP 2.3 s, Today's content 2.4 s, longest task 160 ms
// Before the PERF round (same harness): landing 87 requests, 1,016 KB, JS 267 KB in 73 modules at import depth 5, FCP 3.1 s, hero photo at 5.2 s; quote 71 requests, JS 223 KB in 60
// modules at depth 6, FCP 2.5 s, LCP 2.6 s; dashboard 68 requests, JS 219 KB in 57 modules at depth 5, FCP 2.3 s but Today's content only at about 3.6 s.
//
// LCP: the target is 2500 ms on every page. quote and dashboard meet it. The LANDING page does not, and the gap is understood, not hidden. Since LANDING-V5 the hero photo is the largest
// thing painted, so the LCP is when that photo has arrived, and what has to arrive before it (scripts 181 KB, styles 34 KB, the Archivo fonts 68 KB, the logo 17 KB, the photo 142 KB for
// a phone that wants 1100 px: 450 KB at an effective 165 KB/s on this profile) takes about 2.9 s. Levers, measured on a copy of the site (landing LCP in ms, base 2860):
//   hero photo at 960 px instead of 1100 (-34 KB, a little softer on a 2.6x phone) 2700 | the same and the fonts not preloaded (they arrive after the photo) 2524 | the hero as WebP (-28 per cent,
//   a modelled figure: the live host cannot be reached from here) 2716 | not preloading the fonts alone: no change (they are asked for at first layout instead).
// And the structural one: js/core/store.js drags the quote, handoff, pipeline, connection and message code into every page (about 38 KB gzipped the landing page never runs); splitting it is
// the only change that would take the landing page under 2.5 s without touching the photo. The landing budget below is the measured value plus headroom, and the run prints a note while
// the target is missed.
const BUDGETS = {
  landing: { requests: 66, transferKB: 520, jsGzKB: 205, cssGzKB: 42, modules: 52, depth: 3, fcp: 2500, viewReady: 2500, lcp: 3300, lcpTarget: 2500, cls: 0.05, tbt: 300, longTask: 200, images: 2, heroDone: 3500 },
  quote: { requests: 66, transferKB: 420, jsGzKB: 220, cssGzKB: 48, modules: 56, depth: 2, fcp: 2500, viewReady: 2500, lcp: 2500, cls: 0.05, tbt: 300, longTask: 200, images: 2 },
  dashboard: { requests: 66, transferKB: 400, jsGzKB: 220, cssGzKB: 46, modules: 56, depth: 2, fcp: 2500, viewReady: 2800, lcp: 2500, cls: 0.05, tbt: 300, longTask: 200, images: 2 }
};
const WARM_BUDGET = { fcp: 1800, transferKB: 120, cls: 0.05 };
const SCROLL_BUDGET = { cls: 0.05, longTask: 200 };
// idle: setState/forceUpdate calls (component re-renders asked for) and DOM mutations in IDLE_SECONDS of nothing happening, and storage writes
const ACTIVITY_BUDGET = { renders: 40, toPaintMs: 250 };
const IDLE_SECONDS = 6;
const IDLE_BUDGET = { renders: 2, mutations: 20, storageWrites: 0, timers: 3 };

// stand-in photo bytes per pixel (an estimate, NOT a measurement of the live hosts: imgix ?w=N&q=70 photos about 0.22 (config.js notes 185 KB for a plain w=800), a flat dark logo, unsplash q=80 about 0.18)
const BPP = { imgixPhoto: 0.22, imgixLogo: 0.2, unsplash: 0.18 };
const IMG_HOSTS = new Set(['perspective.imgix.net', 'images.unsplash.com']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let passes = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + String(extra).slice(0, 400) + ']' : '')); }
};
const median = (xs) => { const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const kb = (n) => Math.round(n / 102.4) / 10;

// ---------------------------------------------------------------- the server: static files, gzip, HTTP/2, stand-in photos
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);

function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-cert-'));
  const key = path.join(dir, 'k.pem');
  const cert = path.join(dir, 'c.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:perspective.imgix.net,DNS:images.unsplash.com'], { stdio: 'ignore' });
  } catch (e) {
    throw new Error('perf.mjs needs the openssl command to make a throw-away certificate (the stand-in photo hosts are https): ' + e.message);
  }
  const out = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

const served = new Map(); // url path -> { raw, gz } of what the page asked for (the gzip estimate)
const gzCache = new Map();
const imageMisses = [];
let fontDelayMs = 0; // the fonts scenario holds every font back by this long, to see what the page does while it waits for them
let genImage = null; // async (w, h, bytes) => Buffer, set once the browser is up
const imageCache = new Map();

// What one of his photos is called on the stand-in host -> its real shape (from the app's own config, so nothing here goes stale).
let IMAGE_SHAPES = {};
let HERO_PATH = '';
async function loadImageShapes() {
  const cfg = await import(path.join(SITE_ROOT, 'js/core/config.js'));
  const shapes = {};
  for (const key of cfg.IMAGE_KEYS) {
    const url = new URL(cfg.DEFAULT_IMAGES[key]);
    const meta = cfg.IMAGE_META[key];
    shapes[url.hostname + url.pathname] = { key, w: meta.width, h: meta.height, bpp: url.hostname === 'images.unsplash.com' ? BPP.unsplash : key === 'logo' ? BPP.imgixLogo : BPP.imgixPhoto };
  }
  IMAGE_SHAPES = shapes;
  HERO_PATH = new URL(cfg.DEFAULT_IMAGES.hero).pathname;
}

function pad(buf, bytes) {
  // a JPEG may carry comment segments right after the start marker: pad to the exact size with them
  if (buf.length >= bytes) return buf;
  const parts = [buf.subarray(0, 2)];
  let need = bytes - buf.length;
  while (need > 0) {
    const n = Math.min(need - 4, 65000);
    if (n <= 0) break;
    const seg = Buffer.alloc(n + 4, 0x20);
    seg[0] = 0xff; seg[1] = 0xfe; seg.writeUInt16BE(n + 2, 2);
    parts.push(seg);
    need -= n + 4;
  }
  parts.push(buf.subarray(2));
  return Buffer.concat(parts);
}

async function standIn(host, url) {
  const key = host + url.pathname;
  const shape = IMAGE_SHAPES[key];
  const wParam = Number(url.searchParams.get('w')) || 640;
  const w = Math.max(16, Math.min(4000, wParam));
  const aspect = shape ? shape.h / shape.w : 0.75;
  const h = Math.max(16, Math.round(w * aspect));
  const bytes = Math.round(w * h * (shape ? shape.bpp : BPP.imgixPhoto));
  const ck = `${w}x${h}x${bytes}`;
  let body = imageCache.get(ck);
  if (!body) {
    if (!genImage) return null;
    imageMisses.push(ck);
    body = pad(await genImage(w, h, bytes), bytes);
    imageCache.set(ck, body);
  }
  return body;
}

// ---- RFC 9218 priorities (PERF_PRIORITY=1) ----
// Chrome tells the server how urgent each request is (`priority: u=0` for styles, `u=1` for scripts, fonts and a fetchpriority=high photo, `u=3` for an ordinary photo; `i` = incremental).
// By default this server ignores that and the link is shared fairly between all open streams, which is the worst case (and what plain hosts do). A CDN that honours the header sends the
// most urgent bytes first; with PERF_PRIORITY=1 the server paces every response at the link rate and does just that, so the two behaviours can be compared.
const PACE = process.env.PERF_PRIORITY === '1';
const paced = new Set();
let paceTimer = null;
function parsePriority(header) {
  const m = /u=(\d)/.exec(String(header || ''));
  return { urgency: m ? Number(m[1]) : 3, incremental: /(^|[,\s])i($|[,\s])/.test(String(header || '')) };
}
function deliver(req, res, body) {
  if (!PACE) { res.end(body); return; }
  paced.add({ res, body, offset: 0, ...parsePriority(req.headers.priority), seq: deliver.seq = (deliver.seq || 0) + 1 });
  if (!paceTimer) paceTimer = setInterval(paceTick, 5);
}
function paceTick() {
  if (!paced.size) { clearInterval(paceTimer); paceTimer = null; return; }
  let budget = ((DOWN_KBPS * 1000) / 8) * 0.005 * 0.97;
  while (budget > 1 && paced.size) {
    const best = Math.min(...[...paced].map((p) => p.urgency));
    const tier = [...paced].filter((p) => p.urgency === best).sort((a, b) => a.seq - b.seq);
    const share = Math.max(200, Math.floor(budget / tier.length));
    for (const p of tier) {
      if (p.res.destroyed || p.res.writableEnded) { paced.delete(p); continue; }
      const n = Math.min(share, p.body.length - p.offset, Math.ceil(budget));
      try {
        if (n > 0) { p.res.write(p.body.subarray(p.offset, p.offset + n)); p.offset += n; budget -= n; }
        if (p.offset >= p.body.length) { p.res.end(); paced.delete(p); }
      } catch (e) { paced.delete(p); }
      if (budget <= 1) break;
    }
  }
}

function startServer(port, tls) {
  const server = http2.createSecureServer({ ...tls, allowHTTP1: true });
  server.on('session', (session) => { session.__readyAt = Date.now() + CONNECT_MS; });
  server.on('request', async (req, res) => {
    try {
      const authority = String(req.headers[':authority'] || req.headers.host || '').replace(/:\d+$/, '');
      const session = req.stream && req.stream.session;
      if (CONNECT_MS && session && session.__readyAt) { const wait = session.__readyAt - Date.now(); if (wait > 0) await sleep(wait); }
      const url = new URL(req.url, 'https://127.0.0.1');
      if (process.env.PERF_DEBUG_HEADERS) console.log('      hdr', req.method, url.pathname.slice(0, 40), JSON.stringify({ dest: req.headers['sec-fetch-dest'], priority: req.headers.priority, accept: String(req.headers.accept || '').slice(0, 20) }));
      if (IMG_HOSTS.has(authority)) {
        const body = await standIn(authority, url);
        if (!body) { res.statusCode = 503; res.end(); return; }
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000', 'access-control-allow-origin': '*', 'content-length': body.length });
        deliver(req, res, body);
        return;
      }
      if (fontDelayMs && url.pathname.startsWith('/fonts/')) await sleep(fontDelayMs);
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(SITE_ROOT, path.normalize(rel));
      if (!file.startsWith(SITE_ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('not found'); return; }
      const ext = path.extname(file).toLowerCase();
      let body = fs.readFileSync(file);
      const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate', 'x-content-type-options': 'nosniff' };
      let gz = body.length;
      if (COMPRESSIBLE.has(ext) && /gzip/.test(String(req.headers['accept-encoding'] || ''))) {
        let c = gzCache.get(file);
        if (!c || c.mtime !== fs.statSync(file).mtimeMs) { c = { mtime: fs.statSync(file).mtimeMs, gz: zlib.gzipSync(body, { level: 9 }) }; gzCache.set(file, c); }
        body = c.gz; gz = c.gz.length; headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding';
      }
      served.set(url.pathname, { raw: fs.statSync(file).size, gz });
      const st = fs.statSync(file);
      headers.etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
      if (req.headers['if-none-match'] === headers.etag) { res.writeHead(304, { etag: headers.etag, 'cache-control': headers['cache-control'] }); res.end(); return; }
      headers['content-length'] = body.length;
      res.writeHead(200, headers);
      deliver(req, res, body);
    } catch (e) {
      try { res.statusCode = 500; res.end(String(e && e.message)); } catch (e2) { /* gone */ }
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function freePort(preferred) {
  const tryPort = (p) => new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(0));
    s.listen(p, '127.0.0.1', () => { const got = s.address().port; s.close(() => resolve(got)); });
  });
  return (preferred && (await tryPort(preferred))) || tryPort(0);
}

// ---------------------------------------------------------------- the instrumentation that runs in the page before any of its scripts
const INSTRUMENT = `(() => {
  const m = window.__perf = { lcp: [], cls: 0, shifts: [], longtasks: [], fcp: null, listeners: [], storageWrites: 0, timers: 0, rafs: 0, scrollPhase: false, gbcr: 0, gcs: 0, firstContent: null };
  const obs = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) { /* not supported */ } };
  const describe = (n) => { try { return n ? (n.tagName ? n.tagName.toLowerCase() : (n.constructor && n.constructor.name) || '#node') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : ''; } catch (e) { return ''; } };
  obs('largest-contentful-paint', (e) => m.lcp.push({ t: Math.round(e.startTime), size: e.size, el: describe(e.element), url: e.url ? e.url.slice(0, 100) : '' }));
  obs('paint', (e) => { if (e.name === 'first-contentful-paint') m.fcp = Math.round(e.startTime); });
  obs('layout-shift', (e) => { if (e.hadRecentInput) return; m.cls += e.value; m.shifts.push({ t: Math.round(e.startTime), v: Math.round(e.value * 10000) / 10000, scroll: m.scrollPhase, nodes: (e.sources || []).slice(0, 3).map((s) => describe(s.node)) }); });
  obs('longtask', (e) => m.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration), scroll: m.scrollPhase }));
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'scroll' || type === 'touchstart' || type === 'touchmove' || type === 'wheel' || type === 'mousewheel' || type === 'resize') {
      const passive = opts && typeof opts === 'object' ? !!opts.passive : false;
      m.listeners.push({ type, passive, target: this === window ? 'window' : this === document ? 'document' : describe(this) });
    }
    return origAdd.call(this, type, fn, opts);
  };
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (m.countWrites) m.storageWrites += 1; return origSet.call(this, k, v); };
  const gb = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { if (m.scrollPhase) m.gbcr += 1; return gb.call(this); };
  const gcs = window.getComputedStyle;
  window.getComputedStyle = function (a, b) { if (m.scrollPhase) m.gcs += 1; return gcs.call(window, a, b); };
  // first time the app has put real content on screen, and the first time the page's own main content (window.__perfReady, a selector) is there
  const watch = () => {
    const app = document.getElementById('app');
    if (m.firstContent === null && app && app.textContent.trim().length > 40) m.firstContent = Math.round(performance.now());
    if (m.readyAt === undefined && window.__perfReady && document.querySelector(window.__perfReady)) m.readyAt = Math.round(performance.now());
    return m.firstContent !== null && (m.readyAt !== undefined || !window.__perfReady);
  };
  const mo = new MutationObserver(() => { if (watch()) mo.disconnect(); });
  const start = () => { if (!watch()) mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
})();`;

// ---------------------------------------------------------------- one cold, throttled load
let browser = null;
let ORIGIN = '';

async function newContext({ ready = '' } = {}) {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, userAgent: UA, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: 'dark', ignoreHTTPSErrors: true });
  if (ready) await ctx.addInitScript(`window.__perfReady = ${JSON.stringify(ready)};`);
  await ctx.addInitScript(INSTRUMENT);
  return ctx;
}

async function throttle(cdp) {
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: RTT_MS, downloadThroughput: (DOWN_KBPS * 1000) / 8, uploadThroughput: (750 * 1000) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
}

/** Wait until nothing has been in flight for `quietMs` (capped). */
async function settle(page, state, quietMs = 1500, capMs = 20000) {
  const t0 = Date.now();
  let quietSince = Date.now();
  while (Date.now() - t0 < capMs) {
    await sleep(100);
    if (state.inflight > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) return;
  }
}

function trackNetwork(cdp) {
  const state = { reqs: new Map(), inflight: 0, t0: 0 };
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.startsWith('data:')) return;
    if (!state.t0) state.t0 = e.timestamp;
    state.reqs.set(e.requestId, { id: e.requestId, url: e.request.url, type: e.type, start: e.timestamp, end: 0, enc: 0, dec: 0, status: 0, initiator: e.initiator && (e.initiator.url || (e.initiator.stack && e.initiator.stack.callFrames[0] && e.initiator.stack.callFrames[0].url) || ''), initType: e.initiator && e.initiator.type, prio: e.request.initialPriority });
    state.inflight += 1;
  });
  cdp.on('Network.responseReceived', (e) => { const r = state.reqs.get(e.requestId); if (r) r.status = e.response.status; });
  cdp.on('Network.dataReceived', (e) => { const r = state.reqs.get(e.requestId); if (r) r.dec += e.dataLength; });
  cdp.on('Network.loadingFinished', (e) => { const r = state.reqs.get(e.requestId); if (r && !r.end) { r.end = e.timestamp; r.enc = e.encodedDataLength; state.inflight -= 1; } });
  cdp.on('Network.loadingFailed', (e) => { const r = state.reqs.get(e.requestId); if (r && !r.end) { r.end = e.timestamp; r.failed = e.errorText; state.inflight -= 1; } });
  return state;
}

const isJs = (r) => /\.js(\?|$)/.test(r.url) && r.type !== 'Image';
const isCss = (r) => /\.css(\?|$)/.test(r.url);
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };
const pathOf = (u) => { try { return new URL(u).pathname; } catch (e) { return u; } };

function summarise(state, perf, extra = {}) {
  const all = [...state.reqs.values()];
  // the FIRST VIEW is everything asked for up to the moment the hero photo is in (the landing page: the sections, the booking sheet and the lazy photos are asked for right after it),
  // or up to the load event on a page without a hero photo; what is fetched afterwards is reported on its own
  const heroEntry = (perf.photoTimes || []).find((p) => HERO_PATH && p.name.includes(HERO_PATH));
  const cutoff = heroEntry ? heroEntry.end + 2 : (perf.loadEnd || 1e9);
  const reqs = all.filter((r) => (r.start - state.t0) * 1000 <= cutoff);
  const post = all.filter((r) => (r.start - state.t0) * 1000 > cutoff);
  const local = reqs.filter((r) => hostOf(r.url) === '127.0.0.1');
  const images = reqs.filter((r) => IMG_HOSTS.has(hostOf(r.url)));
  const js = reqs.filter(isJs);
  const css = reqs.filter(isCss);
  const gz = (list) => list.reduce((n, r) => n + ((served.get(pathOf(r.url)) || {}).gz || r.enc), 0);
  // import depth: how many hops from the page to the deepest module (the page itself is 0, the entry script 1)
  const byUrl = new Map(reqs.map((r) => [r.url, r]));
  const depthOf = (r, seen = new Set()) => { if (!r || seen.has(r.url)) return 0; seen.add(r.url); const p = r.initiator && byUrl.get(r.initiator); return p && p !== r ? 1 + depthOf(p, seen) : 1; };
  const depth = js.reduce((d, r) => Math.max(d, depthOf(r)), 0);
  const fcp = perf.fcp;
  const lcps = perf.lcp;
  const lcp = lcps.length ? lcps[lcps.length - 1] : null;
  const tasksAfterFcp = perf.longtasks.filter((t) => !t.scroll && (fcp === null || t.t + t.d >= fcp));
  const tbt = tasksAfterFcp.reduce((n, t) => n + Math.max(0, t.d - 50), 0);
  const loadTasks = perf.longtasks.filter((t) => !t.scroll);
  const loadShift = perf.shifts.filter((s) => !s.scroll).reduce((n, s) => n + s.v, 0);
  return {
    postRequests: post.length,
    postKB: kb(post.reduce((n, r) => n + r.enc, 0)),
    postModules: post.filter(isJs).length,
    requests: reqs.length,
    local: local.length,
    images: images.length,
    imageKB: kb(images.reduce((n, r) => n + r.enc, 0)),
    transferKB: kb(reqs.reduce((n, r) => n + r.enc, 0)),
    jsModules: js.length,
    jsDecodedKB: kb(js.reduce((n, r) => n + r.dec, 0)),
    jsGzKB: kb(gz(js)),
    photosBeforeLoad: images.filter((r) => (perf.photoTimes || []).some((p) => p.name === r.url && p.start < perf.loadEnd)).length,
    photosAfterLoad: post.filter((r) => IMG_HOSTS.has(hostOf(r.url))).length,
    heroDone: (() => { const h = (perf.photoTimes || []).find((p) => HERO_PATH && p.name.includes(HERO_PATH)); return h ? Math.round(h.end) : null; })(),
    cssFiles: css.length,
    cssDecodedKB: kb(css.reduce((n, r) => n + r.dec, 0)),
    cssGzKB: kb(gz(css)),
    fontKB: kb(reqs.filter((r) => r.type === 'Font').reduce((n, r) => n + r.enc, 0)),
    depth,
    fcp,
    lcp: lcp ? lcp.t : null,
    lcpEl: lcp ? `${lcp.el}${lcp.url ? ' ' + pathOf(lcp.url).split('/').pop() : ''}` : '',
    firstContent: perf.firstContent,
    viewReady: perf.readyAt === undefined ? null : perf.readyAt,
    loadMs: Math.round(perf.loadEnd || 0),
    cls: Math.round(loadShift * 10000) / 10000,
    tbt: Math.round(tbt),
    longTasks: loadTasks.length,
    maxLongTask: loadTasks.reduce((n, t) => Math.max(n, t.d), 0),
    failed: all.filter((r) => r.failed || r.status >= 400).map((r) => `${r.status || r.failed} ${r.url}`),
    offsite: all.filter((r) => hostOf(r.url) !== '127.0.0.1' && !(IMG_HOSTS.has(hostOf(r.url)) && r.type === 'Image')).map((r) => r.url),
    ...extra
  };
}

function printWaterfall(state) {
  const reqs = [...state.reqs.values()].sort((a, b) => a.start - b.start);
  for (const r of reqs) {
    const s = Math.round((r.start - state.t0) * 1000);
    const e = r.end ? Math.round((r.end - state.t0) * 1000) : -1;
    console.log(`      ${String(s).padStart(5)} -> ${String(e).padStart(5)}  ${String(r.type).padEnd(10)} ${String(Math.round(r.enc / 102.4) / 10).padStart(7)} KB  ${hostOf(r.url) === '127.0.0.1' ? pathOf(r.url) : r.url.slice(0, 90)}`);
  }
}

/** One measured load; a navigation that times out on a busy machine is tried once more (and said so). */
async function loadOnce(url, opts = {}) {
  try {
    return await loadOnceTry(url, opts);
  } catch (e) {
    if (!/Timeout/i.test(String(e && e.message))) throw e;
    console.log(`  note: ${url.replace(ORIGIN, '')} timed out (${String(e.message).split('\n')[0]}); trying once more`);
    return loadOnceTry(url, opts);
  }
}

async function loadOnceTry(url, { scroll = false, label = '', waterfall = false, ready = '', warm = false } = {}) {
  const ctx = await newContext({ ready });
  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const state = trackNetwork(cdp);
    await throttle(cdp);
    await cdp.send('Performance.enable');
    const consoleProblems = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleProblems.push(m.type() + ': ' + m.text().slice(0, 200)); });
    page.on('pageerror', (e) => consoleProblems.push('pageerror: ' + e.message));
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await settle(page, state);
    if (warm) {
      // a returning visitor: the same page again in the same browser, with what the first visit left in the HTTP cache (the server answers 304 to a matching If-None-Match)
      state.reqs.clear(); state.inflight = 0; state.t0 = 0;
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await settle(page, state);
    }
    const perf = await page.evaluate((hosts) => {
      const p = JSON.parse(JSON.stringify(window.__perf));
      const nav = performance.getEntriesByType('navigation')[0];
      p.loadEnd = nav ? nav.loadEventEnd : 0;
      p.photoTimes = performance.getEntriesByType('resource').filter((e) => { try { return hosts.includes(new URL(e.name).hostname); } catch (err) { return false; } }).map((e) => ({ name: e.name, start: e.startTime, end: e.responseEnd }));
      return p;
    }, [...IMG_HOSTS]);
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const out = summarise(state, perf, {
      scriptMs: Math.round((metrics.ScriptDuration || 0) * 1000), layoutMs: Math.round((metrics.LayoutDuration || 0) * 1000), styleMs: Math.round((metrics.RecalcStyleDuration || 0) * 1000), taskMs: Math.round((metrics.TaskDuration || 0) * 1000),
      consoleProblems
    });
    out.listeners = perf.listeners;
    if (waterfall) { console.log(`    waterfall: ${label}`); printWaterfall(state); }
    if (scroll) {
      const before = { reqs: state.reqs.size, enc: [...state.reqs.values()].reduce((n, r) => n + r.enc, 0) };
      await page.evaluate(() => { window.__perf.scrollPhase = true; });
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < total; y += PHONE.height * 0.7) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await sleep(180);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await settle(page, state, 1200, 25000);
      await sleep(500);
      const p2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__perf)));
      const sc = p2.shifts.filter((s) => s.scroll);
      out.scroll = {
        pageHeight: total,
        cls: Math.round(sc.reduce((n, s) => n + s.v, 0) * 10000) / 10000,
        shifts: sc,
        longTasks: p2.longtasks.filter((t) => t.scroll).length,
        maxLongTask: p2.longtasks.filter((t) => t.scroll).reduce((n, t) => Math.max(n, t.d), 0),
        newRequests: state.reqs.size - before.reqs,
        newKB: kb([...state.reqs.values()].reduce((n, r) => n + r.enc, 0) - before.enc),
        gbcr: p2.gbcr, gcs: p2.gcs
      };
    }
    return out;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- idle: nothing happens, how much work does the page still do?
async function idleOnce(url) {
  const ctx = await newContext();
  await ctx.addInitScript('window.__perf.countWrites = false;');
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const state = trackNetwork(cdp);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await settle(page, state, 1200, 15000);
  await sleep(800);
  await page.evaluate(async () => {
    const m = window.__perf;
    const p = await import('/js/vendor/preact-htm.js');
    m.renders = 0; m.mutations = 0; m.timers = 0; m.countWrites = true; m.storageWrites = 0;
    const set = p.Component.prototype.setState; p.Component.prototype.setState = function (a, b) { m.renders += 1; return set.call(this, a, b); };
    const force = p.Component.prototype.forceUpdate; p.Component.prototype.forceUpdate = function (a) { m.renders += 1; return force.call(this, a); };
    new MutationObserver((l) => { m.mutations += l.length; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    const st = window.setTimeout; window.setTimeout = function (fn, ms, ...a) { return st.call(window, function () { m.timers += 1; return typeof fn === 'function' ? fn.apply(this, arguments) : undefined; }, ms, ...a); };
    const si = window.setInterval; window.setInterval = function (fn, ms, ...a) { return si.call(window, function () { m.timers += 1; return typeof fn === 'function' ? fn.apply(this, arguments) : undefined; }, ms, ...a); };
  });
  const lt0 = (await page.evaluate(() => window.__perf.longtasks.length));
  await sleep(IDLE_SECONDS * 1000);
  const r = await page.evaluate(() => ({ renders: window.__perf.renders, mutations: window.__perf.mutations, storageWrites: window.__perf.storageWrites, timers: window.__perf.timers, longTasks: window.__perf.longtasks.length }));
  await ctx.close();
  return { renders: r.renders, mutations: r.mutations, storageWrites: r.storageWrites, timers: r.timers, longTasks: r.longTasks - lt0 };
}

// ---------------------------------------------------------------- activity: ONE store change (a new website enquiry arrives), how much does the screen redo?
async function activityOnce(url) {
  const ctx = await newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const state = trackNetwork(cdp);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await settle(page, state, 1200, 15000);
  await sleep(800);
  const r = await page.evaluate(async () => {
    const m = window.__perf;
    const p = await import('/js/vendor/preact-htm.js');
    const store = await import('/js/core/store.js');
    let renders = 0; let mutations = 0;
    const set = p.Component.prototype.setState; p.Component.prototype.setState = function (a, b) { renders += 1; return set.call(this, a, b); };
    const force = p.Component.prototype.forceUpdate; p.Component.prototype.forceUpdate = function (a) { renders += 1; return force.call(this, a); };
    new MutationObserver((l) => { mutations += l.length; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    const lt0 = m.longtasks.length;
    const t0 = performance.now();
    const res = store.simulateIncomingBooking({ kind: 'standard' });
    const sync = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const toPaint = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: !!(res && res.ok), renders, mutations, syncMs: Math.round(sync), toPaintMs: Math.round(toPaint), longestTask: Math.max(0, ...m.longtasks.slice(lt0).map((t) => t.d)) };
  });
  await ctx.close();
  return r;
}

// ---------------------------------------------------------------- report helpers
function medianOf(list, key) { return median(list.map((r) => r[key])); }
function aggregate(list) {
  const keys = ['postRequests', 'postKB', 'postModules', 'requests', 'local', 'images', 'photosBeforeLoad', 'photosAfterLoad', 'heroDone', 'imageKB', 'transferKB', 'jsModules', 'jsDecodedKB', 'jsGzKB', 'cssFiles', 'cssDecodedKB', 'cssGzKB', 'fontKB', 'depth', 'fcp', 'lcp', 'firstContent', 'viewReady', 'loadMs', 'cls', 'tbt', 'longTasks', 'maxLongTask', 'scriptMs', 'layoutMs', 'styleMs', 'taskMs'];
  const out = {};
  for (const k of keys) out[k] = medianOf(list, k);
  out.max = { lcp: Math.max(...list.map((r) => r.lcp || 0)), cls: Math.max(...list.map((r) => r.cls || 0)), maxLongTask: Math.max(...list.map((r) => r.maxLongTask || 0)) };
  out.lcpEl = list.map((r) => r.lcpEl).join(' | ');
  return out;
}
function printRow(name, a) {
  console.log(`    ${name}`);
  console.log(`      first view = up to ${a.heroDone ? 'the hero photo arriving' : 'the load event'} (${a.heroDone || a.loadMs || '?'} ms); after it: ${a.postRequests} requests, ${a.postKB} KB (${a.postModules} modules); load event at ${a.loadMs} ms`);
  console.log(`      requests ${a.requests} (local ${a.local}, photos ${a.images}: ${a.photosBeforeLoad} before load, ${a.photosAfterLoad} after)   transferred ${a.transferKB} KB (photos ${a.imageKB} KB, fonts ${a.fontKB} KB)${a.heroDone ? `   hero photo in ${a.heroDone} ms` : ''}`);
  console.log(`      JS ${a.jsModules} modules, ${a.jsDecodedKB} KB decoded, ${a.jsGzKB} KB gzip, import depth ${a.depth}   CSS ${a.cssFiles} files, ${a.cssDecodedKB} KB decoded, ${a.cssGzKB} KB gzip`);
  console.log(`      FCP ${a.fcp} ms   LCP ${a.lcp} ms (${a.lcpEl})   app content ${a.firstContent} ms   main content ${a.viewReady} ms   CLS ${a.cls}`);
  console.log(`      TBT proxy ${a.tbt} ms   long tasks ${a.longTasks}, longest ${a.maxLongTask} ms   script ${a.scriptMs} ms, layout ${a.layoutMs} ms, style ${a.styleMs} ms, main thread busy ${a.taskMs} ms`);
}

function enforce(name, a, b, runs) {
  const checks = [
    ['requests', a.requests, b.requests, ''], ['transferred KB', a.transferKB, b.transferKB, ''], ['JS gzip KB', a.jsGzKB, b.jsGzKB, ''], ['CSS gzip KB', a.cssGzKB, b.cssGzKB, ''],
    ['JS modules fetched', a.jsModules, b.modules, ''], ['import depth', a.depth, b.depth, ''], ['photos requested before load', a.photosBeforeLoad, b.images, ''],
    ['FCP ms', a.fcp, b.fcp, ''], ...(b.viewReady ? [['main content shown ms', a.viewReady, b.viewReady, '']] : []), ['LCP ms (median)', a.lcp, b.lcp, ''], ['LCP ms (worst run)', a.max.lcp, b.lcp + 400, 'worst run may exceed the budget by 400 ms: a busy machine'],
    ...(b.heroDone ? [['hero photo arrived ms', a.heroDone, b.heroDone, '']] : []),
    ['CLS', a.cls, b.cls, ''], ['TBT proxy ms', a.tbt, b.tbt, ''], ['longest task ms (median)', a.maxLongTask, b.longTask, ''], ['longest task ms (worst run)', a.max.maxLongTask, b.longTask + 100, 'worst run may exceed by 100 ms: a busy machine']
  ];
  for (const [label, got, limit, note] of checks) check(`${name}: ${label} ${got} <= ${limit}${note ? ' (' + note + ')' : ''}`, got <= limit, `${got} > ${limit}`);
  if (b.lcpTarget && a.lcp > b.lcpTarget) console.log(`  note  ${name}: LCP ${a.lcp} ms is above the ${b.lcpTarget} ms target (budget ${b.lcp} ms): see the note above BUDGETS`);
  const bad = runs.flatMap((r) => [...r.failed, ...r.offsite.map((u) => 'OFFSITE ' + u), ...r.consoleProblems]);
  check(`${name}: no failed requests, no off-site requests, no console errors or warnings`, bad.length === 0, [...new Set(bad)].join(' | '));
}

// ---------------------------------------------------------------- main
const results = {};
async function main() {
  const tls = makeCert();
  const port = await freePort(Number(process.env.PORT || 4214));
  await loadImageShapes();
  const server = await startServer(port, tls);
  ORIGIN = `https://127.0.0.1:${port}`;
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=MAP perspective.imgix.net 127.0.0.1:${port}, MAP images.unsplash.com 127.0.0.1:${port}`]
  });
  try {
    // the stand-in photo generator: a page in its own context draws photo-like noise and encodes it to JPEG at the requested size
    const genCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const genPage = await genCtx.newPage();
    await genPage.goto('about:blank');
    genImage = async (w, h, target) => {
      const b64 = await genPage.evaluate(async ({ w, h, target }) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#3a4a5c'); grad.addColorStop(0.5, '#8a8f98'); grad.addColorStop(1, '#2a2f38');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) { g.fillStyle = `hsla(${(i * 37) % 360},30%,${30 + (i * 7) % 40}%,0.35)`; g.beginPath(); g.arc(((i * 977) % w), ((i * 613) % h), 20 + ((i * 53) % Math.max(30, w / 5)), 0, 6.3); g.fill(); }
        const img = g.getImageData(0, 0, w, h);
        let seed = 12345;
        const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        for (let amp of [34, 20, 10, 5]) {
          for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * amp; img.data[i] = Math.max(0, Math.min(255, img.data[i] + n)); img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n)); img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n)); }
          g.putImageData(img, 0, 0);
          const low = await c.convertToBlob({ type: 'image/jpeg', quality: 0.3 });
          if (low.size <= target) break;
        }
        let lo = 0.05; let hi = 0.97; let best = await c.convertToBlob({ type: 'image/jpeg', quality: lo });
        for (let i = 0; i < 7; i++) { const q = (lo + hi) / 2; const b = await c.convertToBlob({ type: 'image/jpeg', quality: q }); if (b.size > target) hi = q; else { lo = q; best = b; } }
        const buf = new Uint8Array(await best.arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
        return btoa(bin);
      }, { w, h, target });
      return Buffer.from(b64, 'base64');
    };

    console.log(`# perf: ${CPU}x CPU, ${DOWN_KBPS} kbps down, ${RTT_MS} ms RTT${CONNECT_MS ? ', ' + CONNECT_MS + ' ms connection setup' : ''}, ${PHONE.width}x${PHONE.height}@${DPR}, ${RUNS} cold runs per page (median checked)`);
    const load = os.loadavg()[0];
    if (load > os.cpus().length * 0.6) console.log(`  note: the machine is busy (load average ${load.toFixed(1)} on ${os.cpus().length} CPUs). The CPU throttle multiplies whatever else is running, so every time below is inflated: run it again when the machine is quiet before believing a failure.`);

    // a quote id to open (the seeded store has sent quotes; a fresh browser seeds the same ones)
    const probeCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const probe = await probeCtx.newPage();
    await probe.goto(`${ORIGIN}/index.html?${CLOCK}`, { waitUntil: 'load' });
    const quoteHash = await probe.evaluate(async () => {
      const s = await import('/js/core/store.js');
      const q = Object.values(s.getState().quotes).find((x) => x && x.sentAt && !x.acceptedAt && !x.declinedAt) || Object.values(s.getState().quotes)[0];
      return q ? '#q=' + q.id : '';
    });
    await probeCtx.close();

    const PAGES = [
      { name: 'landing', url: `${ORIGIN}/index.html?${CLOCK}`, scroll: true, ready: '[data-testid="hero-cta"]' },
      { name: 'quote', url: `${ORIGIN}/quote.html?${CLOCK}${quoteHash}`, ready: '[data-testid="q2-page"]' },
      { name: 'dashboard', url: `${ORIGIN}/dashboard.html?${CLOCK}#/today`, ready: '[data-testid^="today-"]' }
    ];
    for (const p of PAGES) {
      if (!wants(p.name) && !(p.name === 'landing' && wants('scroll'))) continue;
      console.log(`\n# ${p.name}  ${p.url.replace(ORIGIN, '')}`);
      // prime: the stand-in photos are generated on first request; do that unmeasured (unthrottled), so a measured run never waits for the generator
      { const ctx = await newContext(); const page = await ctx.newPage(); await page.goto(p.url, { waitUntil: 'load' }); await sleep(700); if (p.scroll) { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(1500); } await ctx.close(); }
      imageMisses.length = 0;
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        runs.push(await loadOnce(p.url, { scroll: !!p.scroll && (wants('scroll') || wants(p.name)), label: p.name, waterfall: VERBOSE && i === 0, ready: p.ready }));
      }
      if (imageMisses.length) console.log(`  note: ${imageMisses.length} stand-in photo(s) were generated during a measured run, so that run's timings are unreliable: ${imageMisses.join(', ')}`);
      const agg = aggregate(runs);
      results[p.name] = { median: agg, runs };
      printRow('median of ' + RUNS, agg);
      if (RUNS > 1) console.log(`      per run LCP ${runs.map((r) => r.lcp).join(', ')} ms; CLS ${runs.map((r) => r.cls).join(', ')}; longest task ${runs.map((r) => r.maxLongTask).join(', ')} ms`);
      if (wants(p.name)) enforce(p.name, agg, BUDGETS[p.name], runs);
      if (p.scroll && runs[0].scroll) {
        const sc = runs.map((r) => r.scroll);
        const scCls = Math.max(...sc.map((s) => s.cls));
        const scLong = Math.max(...sc.map((s) => s.maxLongTask));
        console.log(`    scroll through the whole page (${sc[0].pageHeight} px): CLS ${sc.map((s) => s.cls).join(', ')}; long tasks ${sc.map((s) => s.longTasks).join(', ')} (longest ${scLong} ms); lazy requests ${sc[0].newRequests}, ${sc[0].newKB} KB; getBoundingClientRect ${sc[0].gbcr}, getComputedStyle ${sc[0].gcs}`);
        if (sc.some((s) => s.shifts.length)) console.log('      shifts: ' + JSON.stringify(sc.find((s) => s.shifts.length).shifts));
        check(`landing: CLS while scrolling the whole page ${scCls} <= ${SCROLL_BUDGET.cls}`, scCls <= SCROLL_BUDGET.cls);
        check(`landing: longest task while scrolling ${scLong} ms <= ${SCROLL_BUDGET.longTask + 100} ms`, scLong <= SCROLL_BUDGET.longTask + 100);
        const bad = runs[0].listeners.filter((l) => !l.passive && (l.type === 'scroll' || l.type === 'touchstart' || l.type === 'touchmove' || l.type === 'wheel' || l.type === 'mousewheel'));
        check('landing: every scroll, wheel and touch listener is passive', bad.length === 0, JSON.stringify(bad));
        console.log('    listeners: ' + JSON.stringify(runs[0].listeners.filter((l) => l.type !== 'resize')));
      }
    }

    if (wants('warm')) {
      // a returning visitor (the owner opening the dashboard every day): the second load of the same page, with the HTTP cache from the first (vercel.json: HTML, JS and CSS are
      // max-age=0, must-revalidate, so every file is asked about again and answered 304; fonts are immutable)
      for (const p of PAGES) {
        console.log(`\n# warm ${p.name}  ${p.url.replace(ORIGIN, '')}`);
        const runs = [];
        for (let i = 0; i < Math.min(RUNS, 2); i++) runs.push(await loadOnce(p.url, { warm: true, ready: p.ready }));
        const a = aggregate(runs);
        results['warm-' + p.name] = { median: a, runs };
        console.log(`    requests ${a.requests} (${a.local} local)   transferred ${a.transferKB} KB   FCP ${a.fcp} ms   LCP ${a.lcp} ms   main content ${a.viewReady} ms   CLS ${a.cls}   longest task ${a.maxLongTask} ms`);
        check(`warm ${p.name}: FCP ${a.fcp} <= ${WARM_BUDGET.fcp}`, a.fcp <= WARM_BUDGET.fcp);
        check(`warm ${p.name}: transferred ${a.transferKB} KB <= ${WARM_BUDGET.transferKB}`, a.transferKB <= WARM_BUDGET.transferKB);
        check(`warm ${p.name}: CLS ${a.cls} <= ${WARM_BUDGET.cls}`, a.cls <= WARM_BUDGET.cls);
      }
    }

    if (wants('fonts')) {
      // the web fonts arrive late (a slow phone, 2.5 s after everything else): the text is drawn in the fallback first, and swapping to the real font must not move the page
      console.log('\n# fonts held back 2.5 s on the landing page: the swap must not shift the layout');
      fontDelayMs = 2500;
      const url = `${ORIGIN}/index.html?${CLOCK}`;
      const rs = [];
      for (let i = 0; i < Math.min(RUNS, 2); i++) rs.push(await loadOnce(url, { label: 'late fonts' }));
      fontDelayMs = 0;
      const cls = Math.max(...rs.map((r) => r.cls));
      results.lateFonts = { cls, runs: rs.map((r) => ({ cls: r.cls, fcp: r.fcp, lcp: r.lcp })) };
      console.log(`    CLS ${rs.map((r) => r.cls).join(', ')}   FCP ${rs.map((r) => r.fcp).join(', ')} ms`);
      check(`landing with late fonts: CLS ${cls} <= ${BUDGETS.landing.cls}`, cls <= BUDGETS.landing.cls);
    }

    if (wants('activity')) {
      for (const route of ['#/today', '#/bookings']) {
        console.log(`\n# one new enquiry arrives while ${route} is open (a store change)`);
        const url = `${ORIGIN}/dashboard.html?${CLOCK}${route}`;
        const rs = [];
        for (let i = 0; i < Math.min(RUNS, 2); i++) rs.push(await activityOnce(url));
        const worst = { renders: Math.max(...rs.map((x) => x.renders)), mutations: Math.max(...rs.map((x) => x.mutations)), syncMs: Math.max(...rs.map((x) => x.syncMs)), toPaintMs: Math.max(...rs.map((x) => x.toPaintMs)), longestTask: Math.max(...rs.map((x) => x.longestTask)) };
        results['activity' + route] = worst;
        console.log(`    re-renders asked for ${worst.renders}, DOM mutations ${worst.mutations}, store change to painted ${worst.toPaintMs} ms (the change itself ${worst.syncMs} ms), longest task ${worst.longestTask} ms`);
        check(`activity ${route}: the store change worked`, rs.every((x) => x.ok));
        check(`activity ${route}: re-renders ${worst.renders} <= ${ACTIVITY_BUDGET.renders}`, worst.renders <= ACTIVITY_BUDGET.renders);
        check(`activity ${route}: store change to painted ${worst.toPaintMs} ms <= ${ACTIVITY_BUDGET.toPaintMs}`, worst.toPaintMs <= ACTIVITY_BUDGET.toPaintMs);
      }
    }

    if (wants('idle')) {
      for (const route of ['landing', '#/today', '#/bookings']) {
        console.log(`\n# idle ${route}: ${IDLE_SECONDS} s of nothing happening`);
        const url = route === 'landing' ? `${ORIGIN}/index.html?${CLOCK}` : `${ORIGIN}/dashboard.html?${CLOCK}${route}`;
        const rs = [];
        for (let i = 0; i < Math.min(RUNS, 2); i++) rs.push(await idleOnce(url));
        const r = { renders: Math.max(...rs.map((x) => x.renders)), mutations: Math.max(...rs.map((x) => x.mutations)), storageWrites: Math.max(...rs.map((x) => x.storageWrites)), timers: Math.max(...rs.map((x) => x.timers)), longTasks: Math.max(...rs.map((x) => x.longTasks)) };
        results['idle' + route] = r;
        console.log(`    re-renders asked for ${r.renders}, DOM mutations ${r.mutations}, timers fired ${r.timers}, localStorage writes ${r.storageWrites}, long tasks ${r.longTasks}`);
        check(`idle ${route}: re-renders ${r.renders} <= ${IDLE_BUDGET.renders}`, r.renders <= IDLE_BUDGET.renders);
        check(`idle ${route}: DOM mutations ${r.mutations} <= ${IDLE_BUDGET.mutations}`, r.mutations <= IDLE_BUDGET.mutations);
        check(`idle ${route}: localStorage writes ${r.storageWrites} <= ${IDLE_BUDGET.storageWrites}`, r.storageWrites <= IDLE_BUDGET.storageWrites);
        check(`idle ${route}: timers fired ${r.timers} <= ${IDLE_BUDGET.timers}`, r.timers <= IDLE_BUDGET.timers);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  if (process.env.PERF_JSON) fs.writeFileSync(process.env.PERF_JSON, JSON.stringify(results, null, 1));
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
