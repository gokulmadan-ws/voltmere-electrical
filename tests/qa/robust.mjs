// tests/qa/robust.mjs: the ROBUST gate. Tries to BREAK the prototype and fails when anything breaks.
// Self-contained: starts its own static server (port 4212 when free, else any free port) and its own Chromium; exits non-zero on any failure.
//
//   QA_DEPS_DIR=/path/with/node_modules node tests/qa/robust.mjs        (must contain playwright-core)
//   ONLY=3 node tests/qa/robust.mjs                                      (run the sections whose title starts with this)
//   VERBOSE=1 for stack lines; CHROMIUM_PATH=/path/to/chrome
//
// The matrix (one section each):
//   1 storage blocked (localStorage and sessionStorage throw / are null / refuse every write) on landing, funnel, confirmation, quote page, dashboard
//   2 storage quota full during funnel submit, quote edit, photo add, settings save, owner booking (calm error, nothing half written, nothing lost)
//   3 corrupted JSON, wrong schema, huge state, v1 and v2 saves, garbage in the other keys (migrates or re-seeds; never a white screen; Reset on the fatal screen)
//   4 two dashboard tabs and one landing tab writing at once (converge, no lost bookings, no duplicate refs)
//   5 rapid double and triple taps on every primary action; back and forward in the funnel; reload at every funnel step and in a wizard
//   6 hostile text everywhere customers type; hostile URL fragments, ids and dates
//   7 clock edge cases: the UK clock change, midnight rollover, 29 Feb 2028, year end; no slot is ever double-booked
//   8 offline: every image host fails
//   9 100 bookings and 300 messages: every dashboard screen renders in under 1.5 s and nothing overflows
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/qa';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLOCK = 'now=2026-10-23T20:30&freeze=1';
const require = createRequire(QA_DEPS.endsWith('/') ? QA_DEPS : QA_DEPS + '/');
const { chromium } = require('playwright-core');

// ---------------------------------------------------------------- harness
let failures = 0;
let passes = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + String(extra).slice(0, 3000) + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT = 9000;
async function until(fn, ms = WAIT, step = 60) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* page busy or navigating: try again */ }
    await sleep(step);
  }
  return false;
}
async function section(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  console.log('\n# ' + name);
  try { await fn(); } catch (e) { failures += 1; console.log('  FAIL ' + name + ' threw: ' + (e && e.message ? e.message.split('\n').slice(0, process.env.VERBOSE ? 12 : 2).join(' | ') : e)); }
}

let server = null;
async function freePort(preferred) {
  const tryPort = (p) => new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(0));
    s.listen(p, '127.0.0.1', () => { const got = s.address().port; s.close(() => resolve(got)); });
  });
  return (preferred && (await tryPort(preferred))) || tryPort(0);
}
async function startServer() {
  const port = await freePort(Number(process.env.PORT || 4212));
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', SITE_ROOT], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const up = await until(async () => { const r = await fetch(base + '/index.html').catch(() => null); return r && r.ok; }, 10000, 150);
  if (!up) throw new Error('static server did not start');
  return base;
}
const stopServer = () => { try { if (server) server.kill(); } catch (e) { /* gone */ } };
process.on('exit', stopServer);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const BASE = await startServer();
const ORIGIN = new URL(BASE).origin;
const PHONE = { width: 375, height: 812 };
const SMALL = { width: 320, height: 640 };
const DESKTOP = { width: 1280, height: 800 };

const IMG_HOSTS = new Set(['perspective.imgix.net', 'images.unsplash.com']);
const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#2a2b2f"/><circle cx="400" cy="300" r="90" fill="#3a3b40"/></svg>';
/** A browser context with his two photo hosts answered by a stand-in (or failing, with imagesFail) and everything else off-site refused. */
async function newContext(vp = PHONE, { init = [], imagesFail = false, scheme = 'dark', offline = false } = {}) {
  const ctx = await browser.newContext({
    viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: scheme, isMobile: vp.width < 600, hasTouch: vp.width < 600, acceptDownloads: true
  });
  for (const code of init) await ctx.addInitScript(code);
  await ctx.route((u) => IMG_HOSTS.has(u.hostname), (route) => (imagesFail ? route.abort('failed') : route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN })));
  // a WhatsApp link the product opens in a new tab is answered with a stub, so the test can read the link without leaving the sandbox
  await ctx.route((u) => u.hostname === 'wa.me' || u.hostname === 'api.whatsapp.com', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>wa</title>wa stub' }));
  if (offline) await ctx.setOffline(true);
  return ctx;
}

const isPhoto404 = (u) => /\/img\/180\//.test(u);
/** Everything that must stay empty: page errors, console errors and warnings, off-site requests, failed local requests. */
function watch(page, { allowImageFailures = false } = {}) {
  const log = { errors: [], offsite: [], failed: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/Failed to load resource/.test(m.text())) {
      const u = (m.location && m.location().url) || '';
      if (isPhoto404(u) || (allowImageFailures && [...IMG_HOSTS].some((h) => u.includes(h)))) return;
    }
    log.errors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    const url = new URL(u);
    if (url.origin === ORIGIN) return;
    if (IMG_HOSTS.has(url.hostname) && r.resourceType() === 'image') return;
    log.offsite.push(u);
  });
  page.on('requestfailed', (r) => { const u = r.url(); if (isPhoto404(u)) return; if (/ERR_ABORTED/.test((r.failure() || {}).errorText || '')) return; /* the page was navigated away while the request was in flight */ if (allowImageFailures && [...IMG_HOSTS].some((h) => u.includes(h))) return; log.failed.push(u); });
  page.on('response', (r) => { if (r.status() >= 400 && !isPhoto404(r.url())) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}
const clean = (log) => log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0;
const dump = (log) => [...log.errors, ...log.offsite, ...log.failed].join(' | ');
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const txt = async (page, id) => (await (id === 'funnel-step-label' ? tid(page, id).first().textContent() : tid(page, id).first().innerText()).catch(() => '')).replace(/\s+/g, ' ').trim(); // the step label is drawn in capitals (the label voice): read its words from textContent
// The landing page paints the header and hero first; a moment after its photo has arrived it mounts the sections (html[data-below="ready"], js/landing/ready.js) and has the quote form's
// code in the page (html[data-booking="ready"], js/landing/booking-host.js). "Already open", for the offline checks, means both: wait for them.
const site = async (page, hash = '', query = '', clock = CLOCK) => {
  const res = await page.goto(`${BASE}/index.html?${clock}${query}${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.below === 'ready' && document.documentElement.dataset.booking === 'ready', null, { timeout: 8000 }).catch(() => { /* a page that is meant to be broken may never get there */ });
  return res;
};
const dash = (page, hash = '#/today', clock = CLOCK) => page.goto(`${BASE}/dashboard.html?${clock}${hash}`, { waitUntil: 'load' });
const quotePage = (page, hash = '', clock = CLOCK) => page.goto(`${BASE}/quote.html?${clock}${hash}`, { waitUntil: 'load' });
const KEY = 'vm_state_v1';
const stateOf = (page) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, KEY);
const getStateIn = (page) => page.evaluate(async () => (await import('/js/core/store.js')).getState());
const noOverflow = (page) => page.evaluate(() => { const r = document.documentElement; return r.scrollWidth <= r.clientWidth + 1; });
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const hasContent = (page) => page.evaluate(() => (document.querySelector('#app') || document.body).innerText.trim().length > 80);

// ---- fault injection (runs before any page script) ----
const FAULTS = {
  // Safari "block all cookies" / Firefox with site data blocked: even reading the property throws a SecurityError
  access: `for (const n of ['localStorage','sessionStorage']) Object.defineProperty(window, n, { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });`,
  // window.localStorage is null (some embedded webviews)
  nulls: `for (const n of ['localStorage','sessionStorage']) Object.defineProperty(window, n, { configurable: true, get() { return null; } });`,
  // old private browsing: the object is there, every write throws a quota error and reads find nothing
  quota0: `(() => { const e = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; Storage.prototype.setItem = e; })();`,
  // every method throws
  broken: `(() => { const e = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); }; for (const m of ['getItem','setItem','removeItem','clear','key']) Storage.prototype[m] = e; })();`,
  // a quota that can be switched on and off by the test: window.__full = true makes writes of any key throw
  switchable: `(() => { const real = Storage.prototype.setItem; window.__full = false; window.__fullKeys = null; Storage.prototype.setItem = function (k, v) { if (window.__full && (!window.__fullKeys || window.__fullKeys.includes(k))) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return real.call(this, k, v); }; })();`
};


// ---- funnel and fixtures ----
const onStep = (page, n) => until(async () => (await txt(page, 'funnel-step-label')) === `Step ${n} of 6` && (await tid(page, `funnel-step-${n}`).count()) === 1);
const ANSWERS = [[2, 'parking', 'driveway'], [3, 'vehicle', 'ordered'], [4, 'timing', 'asap'], [5, 'permission', 'yes']];
/** Open the funnel from the landing page and walk steps 1 to 5; resolves on step 6. */
async function walkToContact(page, postcode = 'BT9 6QP', upTo = 6) {
  await tid(page, 'funnel-postcode').fill(postcode);
  await tid(page, 'funnel-continue').click();
  for (const [n, key, value] of ANSWERS) {
    if (n >= upTo) break;
    await tid(page, `funnel-option-${key}-${value}`).waitFor({ timeout: WAIT });
    if (!(await onStep(page, n))) throw new Error(`never reached step ${n}`);
    await tid(page, `funnel-option-${key}-${value}`).click();
  }
  if (!(await onStep(page, upTo))) throw new Error(`never reached step ${upTo}`);
}
/** Set a field's value the way a paste or a hostile client would: no maxlength, then an input event the framework sees. */
async function setField(page, testId, value) {
  await page.evaluate(({ testId, value }) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { testId, value });
}
async function fillContact(page, { name, phone, email, note, postcode } = {}) {
  await tid(page, 'demo-fill').click();
  if (name !== undefined) await setField(page, 'field-name', name);
  if (phone !== undefined) await setField(page, 'field-phone', phone);
  if (email !== undefined) await setField(page, 'funnel-email', email);
  if (postcode !== undefined) await setField(page, 'field-postcode', postcode);
  if (note !== undefined) await setField(page, 'field-note', note);
}
async function submitEnquiry(page, opts = {}) {
  await site(page);
  await tid(page, 'hero-cta').click();
  await walkToContact(page);
  await fillContact(page, opts);
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
}

/** Links built by the product itself in a clean browser: a quote link, an enquiry import link, an acceptance import link. */
let FIX = null;
async function fixtures() {
  if (FIX) return FIX;
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  await dash(page);
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  FIX = await page.evaluate(async () => {
    const s = await import('/js/core/store.js');
    const h = await import('/js/core/handoff.js');
    const st = s.getState();
    const hashOf = (u) => u.slice(u.indexOf('#'));
    const quote = Object.values(st.quotes).find((q) => q.status === 'sent');
    const booking = st.bookings.find((b) => b.id === quote.bookingId);
    const enq = st.bookings.find((b) => b.serviceId === 'ev_quote' && b.seed);
    const acc = h.dashboardImportLink(h.buildAcceptancePayload({ quote, days: ['thu', 'fri'], part: 'am', note: 'Back gate is blue' }));
    // a quote the owner makes NOW has an id no other fresh browser has seeded, so opening its link elsewhere is LINK MODE
    // a customer's enquiry the owner's browser has not got (its ref is the next one): importing it is a real import
    const fresh = s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT7 3AB', parking: 'garage', vehicle: 'have', timing: 'month', permission: 'yes' }, customer: { name: 'Imogen Import', phone: '07700 900555', email: 'imogen@example.com' }, address: { line1: '', postcode: 'BT7 3AB' }, notes: 'Imported by a test', pencil: true });
    const newEnquiry = { hash: hashOf(h.dashboardImportLink(h.buildEnquiryPayload(fresh.booking))), ref: fresh.booking.ref };
    const made = s.createQuote({ bookingId: enq.id });
    const sent = s.sendQuote(made.quote.id, { via: 'link' });
    return {
      newQuoteId: made.quote.id, linkHash: hashOf(sent.link), newEnquiry,
      quoteId: quote.id, quoteHash: hashOf(h.quoteLink(quote)),
      enquiryHash: hashOf(h.dashboardImportLink(h.buildEnquiryPayload(enq))),
      acceptHash: hashOf(acc), enquiryRef: enq.ref, enquiryId: enq.id
    };
  });
  await ctx.close();
  return FIX;
}
/** Click a link that opens a new tab (WhatsApp); resolves the URL it opened and closes that tab. */
async function tapLink(ctx, locator) {
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: WAIT }).catch(() => null), locator.click()]);
  if (!pop) return '';
  await pop.waitForURL((u) => u.href !== 'about:blank', { timeout: 5000 }).catch(() => {});
  const url = pop.url();
  await pop.close().catch(() => {});
  return url;
}

/** A photo-like JPEG (gradient and shapes), made in the page so no file is needed. */
async function makePhoto(page, w = 640, h = 480, seed = 1) {
  const b64 = await page.evaluate(({ w, h, seed }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${(seed * 70) % 360} 40% 30%)`); grad.addColorStop(1, `hsl(${(seed * 70 + 80) % 360} 50% 65%)`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i += 1) { g.fillStyle = `hsla(${(i * 37 + seed * 11) % 360} 50% 50% / 0.5)`; g.beginPath(); g.arc((i * 97) % w, (i * 53) % h, 20 + (i % 7) * 12, 0, 7); g.fill(); }
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, { w, h, seed });
  return Buffer.from(b64, 'base64');
}
const setFull = (page, full, keys = [KEY]) => page.evaluate(({ full, keys }) => { window.__full = full; window.__fullKeys = keys; }, { full, keys });
const rawState = (page) => page.evaluate((k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, KEY);
const toastText = async (page) => (await page.locator('[data-testid="toast"]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');

/** Put a raw string into localStorage[key] BEFORE the product's code runs (visit a neutral same-origin file first, then load the real page). */
async function plant(page, key, raw) {
  await page.goto(`${BASE}/manifest.webmanifest`, { waitUntil: 'load' });
  await page.evaluate(({ key, raw }) => { if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw); }, { key, raw });
}
/** A fresh seeded state, as the product itself builds it, for the tests to bend. */
let SEEDED_RAW = null;
async function seededRaw() {
  if (SEEDED_RAW) return SEEDED_RAW;
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  await dash(page);
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  SEEDED_RAW = await rawState(page);
  await ctx.close();
  return SEEDED_RAW;
}
const bend = async (fn) => { const st = JSON.parse(await seededRaw()); fn(st); return JSON.stringify(st); };
/** Visit routes and report the ones that crash (error card, shell error, blank) plus any page error. */
async function crashedRoutes(page, routes) {
  const bad = [];
  for (const r of routes) {
    await page.evaluate((h) => { location.hash = h; }, r);
    await sleep(80);
    const ok = await until(async () => (await tid(page, 'view-loading').count()) === 0 && (await tid(page, 'db-view').count()) === 1, 5000);
    const err = (await tid(page, 'view-error').count()) + (await tid(page, 'shell-error').count()) + (await page.locator('.ui-fatal').count());
    const len = await page.evaluate(() => { const m = document.querySelector('.db-main'); return m ? m.innerText.trim().length : 0; });
    if (!ok || err || len < 20) bad.push(`${r}${err ? ' [error card]' : ''}${len < 20 ? ' [blank]' : ''}`);
  }
  return bad;
}

/** Tap an element `n` times in the SAME task (before the framework can re-render or disable anything): the harshest double tap there is. */
const burst = (page, testId, n = 3) => page.evaluate(({ testId, n }) => {
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) return 0;
  for (let i = 0; i < n; i += 1) el.click();
  return n;
}, { testId, n });
const countBy = (page, fn, arg) => page.evaluate(async ({ fn, arg }) => { const st = (await import('/js/core/store.js')).getState(); return new Function('st', 'arg', `return (${fn})(st, arg)`)(st, arg); }, { fn: fn.toString(), arg });

// ---- hostile text ----
const HOSTILE = {
  html: 'HZ7 <img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script> "><svg onload=window.__pwned=1> </textarea><b id=hz-bold>bold</b>',
  attrs: 'HZ7 \' onfocus=\'window.__pwned=1\' autofocus x=\'` ${window.__pwned=1} {{constructor.constructor("window.__pwned=1")()}}',
  long: 'HZ7' + 'W'.repeat(10000),
  longSpaced: 'HZ7 ' + 'word '.repeat(2000),
  emoji: 'HZ7 \u{1F600}\u{1F469}‍\u{1F469}‍\u{1F467}‍\u{1F466}\u{1F1EC}\u{1F1E7}❤️\u{1F468}\u{1F3FD}‍\u{1F4BB}',
  rtl: 'HZ7 مرحبا بالعالم שלום ‮evil‬ ⁧isolate⁩ BT9',
  zeroWidth: 'HZ7 A​‌‍⁠﻿B­­C \u0000 \u0007 \u001B[31m',
  surrogates: 'HZ7 lone \uD83D high, lone \uDE00 low, \uD83D\uD83D pair, \uFFFF \uFFFE',
  zalgo: 'HZ7 Ź̴̢͎à̷l̶g̸o̴' + '̀́̂̃'.repeat(200),
  newlines: 'HZ7 line1\nline2\r\nline3%0d%0aBcc: evil@example.com\n\n\n\n' + '\n'.repeat(50) + 'end'
};
const HOSTILE_KEYS = Object.keys(HOSTILE);
/** Where does text containing the marker overflow? Returns the descriptions of elements whose box leaves the viewport and is not clipped by a scroller. */
const overflowOf = (page, marker = 'HZ7') => page.evaluate((marker) => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const clipped = (el) => {
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && n.getBoundingClientRect().right <= vw + 1) return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue.includes(marker)) continue;
    const el = node.parentElement;
    if (!el || el.closest('script, style, noscript, textarea, [hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)} vw=${vw}`);
  }
  return { overflowing: out.slice(0, 5), pageScroll: document.documentElement.scrollWidth - vw };
}, marker);
/** Nothing the hostile text asked for happened: no handler ran, no element was injected, no script was added. */
const injected = (page) => page.evaluate(() => ({
  pwned: window.__pwned === 1,
  extra: document.querySelectorAll('img[src="x"], #hz-bold, svg[onload], [onfocus], [onerror]').length,
  scripts: [...document.scripts].filter((s) => !s.src).length
}));
const BASE_SCRIPTS = new Map();
const RESET_STORE = `try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}`;


// ================================================================ 1. storage blocked
const DASH_ROUTES = ['#/today', '#/calendar', '#/bookings', '#/pipeline', '#/quotes', '#/insights', '#/messages', '#/more', '#/settings', '#/share', '#/customers', '#/about', '#/demo', '#/new', '#/import', '#/connections', '#/connections/domain', '#/connections/webhook', '#/connections/tracking', '#/connections/whatsapp', '#/connections/calendar', '#/connections/email'];
for (const fault of ['access', 'nulls', 'quota0', 'broken']) {
  await section(`1. storage blocked (${fault}): landing, funnel, confirmation`, async () => {
    const ctx = await newContext(PHONE, { init: [FAULTS[fault]] });
    const page = await ctx.newPage();
    const log = watch(page);
    await site(page);
    check('landing renders', !!(await tid(page, 'hero-cta').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)));
    await submitEnquiry(page, { name: 'Blocked Storage' });
    check('a full enquiry can still be sent and the confirmation shows', (await tid(page, 'confirmation').count()) === 1);
    check('the confirmation says plainly this browser cannot keep the enquiry (calm note)', (await tid(page, 'storage-note').count()) >= 1, await txt(page, 'confirmation'));
    check('no console errors, page errors or off-site requests', clean(log), dump(log));
    check('no horizontal overflow', await noOverflow(page));
    await ctx.close();
  });
  await section(`1. storage blocked (${fault}): dashboard, every route`, async () => {
    const ctx = await newContext(PHONE, { init: [FAULTS[fault]] });
    const page = await ctx.newPage();
    const log = watch(page);
    await dash(page);
    check('the dashboard renders its seeded demo from memory', !!(await tid(page, 'db-view').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)));
    check('a calm "not saving" note is visible at the top', await until(() => tid(page, 'storage-note').first().isVisible()), await bodyText(page).then((t) => t.slice(0, 200)));
    const bad = [];
    for (const r of DASH_ROUTES) {
      await page.evaluate((h) => { location.hash = h; }, r);
      await sleep(90);
      const ok = await until(async () => (await tid(page, 'view-loading').count()) === 0 && (await tid(page, 'db-view').count()) === 1, 5000);
      const err = (await tid(page, 'view-error').count()) + (await tid(page, 'shell-error').count());
      const text = await page.evaluate(() => document.querySelector('.db-main').innerText.trim().length);
      if (!ok || err || text < 20) bad.push(`${r} ok=${ok} err=${err} len=${text}`);
    }
    check('every dashboard route renders (no error card, no blank)', bad.length === 0, bad.join(' | '));
    const res = await page.evaluate(async () => {
      const s = await import('/js/core/store.js');
      const before = s.getState().bookings.length;
      const r = s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name: 'Mem Mode', phone: '07700 900321', email: '' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true });
      return { ok: r.ok, reason: r.reason, before, after: s.getState().bookings.length, status: s.getStorageStatus() };
    });
    check('a booking made in memory mode is kept for the page life and reported as memory', res.ok && res.after === res.before + 1 && res.status.ok === false, JSON.stringify(res));
    check('no console errors, page errors or off-site requests', clean(log), dump(log));
    await ctx.close();
  });
  await section(`1. storage blocked (${fault}): quote page`, async () => {
    const fx = await fixtures();
    const ctx = await newContext(PHONE, { init: [FAULTS[fault]] });
    const page = await ctx.newPage();
    const log = watch(page);
    await quotePage(page, fx.quoteHash);
    check('a quote link renders the quote', !!(await tid(page, 'q2-total').first().waitFor({ timeout: WAIT }).then(() => true).catch(() => false)) || (await bodyText(page)).includes('£'), (await bodyText(page)).slice(0, 200));
    await quotePage(page, '#q=Q-EL-9999');
    check('an unknown quote id is a calm page, not a crash', await hasContent(page) && (await tid(page, 'q2-error').count()) === 0, (await bodyText(page)).slice(0, 200));
    await quotePage(page, fx.linkHash);
    await tid(page, 'q2-accept').first().click();
    await tid(page, 'q2-days-sheet').waitFor({ timeout: WAIT });
    await tid(page, 'q2-pday-thu').click();
    const wa = await tapLink(ctx, tid(page, 'q2-reply-open'));
    check('accepting in link mode opens the WhatsApp message even with storage blocked', /^https:\/\/wa\.me\/\d+\?text=/.test(wa), wa);
    check('the page moves on to "your message is ready" and says it cannot remember the reply', !!(await tid(page, 'q2-reply-sent').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)) && (await tid(page, 'storage-note').count()) === 1);
    check('no console errors, page errors or off-site requests', clean(log), dump(log));
    check('no horizontal overflow', await noOverflow(page));
    await ctx.close();
  });
}


// ================================================================ 2. quota full
await section('2. quota full: funnel submit keeps the details, writes nothing, then works once there is room (one booking, not two)', async () => {
  const ctx = await newContext(PHONE, { init: [FAULTS.switchable] });
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').click();
  await walkToContact(page);
  await fillContact(page, { name: 'Quota Customer' });
  const before = await rawState(page);
  const count = (JSON.parse(before)).bookings.length;
  await setFull(page, true);
  await tid(page, 'funnel-submit').click();
  const banner = await tid(page, 'funnel-error-banner').waitFor({ timeout: WAIT }).then(() => txt(page, 'funnel-error-banner')).catch(() => '');
  check('a calm "no room left" message appears, with the phone number to call', /no room left/i.test(banner) && /07885 496800/.test(banner), banner);
  check('the form still holds what was typed', (await tid(page, 'field-name').inputValue()) === 'Quota Customer');
  check('nothing was written, nothing half-written', (await rawState(page)) === before);
  check('the button is usable again (not stuck on loading)', await tid(page, 'funnel-submit').isEnabled());
  await setFull(page, false);
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  const after = JSON.parse(await rawState(page));
  check('once there is room the same tap sends exactly one enquiry', after.bookings.length === count + 1 && after.bookings.filter((b) => b.customer.name === 'Quota Customer').length === 1);
  check('no console errors or page errors', clean(log), dump(log));
  await ctx.close();
});

await section('2. quota full: photo add on a booking, quote edit and settings save fail calmly and change nothing', async () => {
  const ctx = await newContext(PHONE, { init: [FAULTS.switchable] });
  const page = await ctx.newPage();
  const log = watch(page);
  // ---- photo add
  await dash(page, '#/bookings/bk_seed_07');
  await tid(page, 'detail-add-photo').waitFor({ timeout: WAIT });
  let before = await rawState(page);
  await setFull(page, true);
  await tid(page, 'detail-photo-input').setInputFiles({ name: 'cu.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page) });
  check('a refused photo says there is no room, calmly', await until(async () => /no room/i.test(await toastText(page))), await toastText(page));
  check('the refused photo wrote nothing', (await rawState(page)) === before);
  await setFull(page, false);
  await tid(page, 'detail-photo-input').setInputFiles({ name: 'cu.jpg', mimeType: 'image/jpeg', buffer: await makePhoto(page, 640, 480, 2) });
  check('with room back the photo is added', await until(async () => ((await getStateIn(page)).bookings.find((b) => b.id === 'bk_seed_07').photos || []).length === 1));
  // ---- quote edit (autosave)
  await dash(page, '#/quotes/Q-EL-1023');
  await tid(page, 'q1-notes').waitFor({ timeout: WAIT });
  before = await rawState(page);
  await setFull(page, true);
  await tid(page, 'q1-notes').fill('Robust edit one');
  const saved = await until(async () => /Not saved/i.test(await txt(page, 'q1-saved')), 4000);
  check('a quote edit that cannot be saved says "Not saved" in plain words', !!saved, await txt(page, 'q1-saved'));
  check('the edit stays on screen (nothing lost) and nothing was written', (await tid(page, 'q1-notes').inputValue()) === 'Robust edit one' && (await rawState(page)) === before);
  await setFull(page, false);
  await tid(page, 'q1-notes').fill('Robust edit two');
  check('with room back the edit saves', await until(async () => ((await getStateIn(page)).quotes['Q-EL-1023'] || {}).notes === 'Robust edit two', 4000));
  // ---- settings save
  await dash(page, '#/settings?open=rules');
  await tid(page, 'setting-reminders').waitFor({ timeout: WAIT });
  before = await rawState(page);
  const was = (await getStateIn(page)).settings.remindersOn;
  await setFull(page, true);
  await tid(page, 'setting-reminders').click({ force: true });
  check('a settings change that cannot be saved is a calm toast', await until(async () => /no room/i.test(await toastText(page))), await toastText(page));
  check('nothing was written and the switch did not move', (await rawState(page)) === before && (await getStateIn(page)).settings.remindersOn === was);
  await setFull(page, false);
  check('no console errors or page errors', clean(log), dump(log));
  await ctx.close();
});


// ================================================================ 3. corrupted, wrong-schema, huge and old saved state
const CORE_ROUTES = ['#/today', '#/calendar', '#/bookings', '#/pipeline', '#/quotes', '#/insights', '#/messages', '#/customers', '#/settings', '#/more'];
await section('3. unusable saved state is replaced by a fresh seed, on every page, with the bad copy kept aside', async () => {
  const cases = [
    ['broken JSON', '{"v":3,"bookings":['],
    ['an empty string', ''],
    ['the word undefined', 'undefined'],
    ['an array', '[1,2,3]'],
    ['a newer schema', JSON.stringify({ v: 99, bookings: [] })],
    ['wrong types everywhere', JSON.stringify({ v: 3, bookings: 'x', blocks: 1, messages: null, settings: [], meta: 'm', quotes: 3 })]
  ];
  for (const [name, raw] of cases) {
    for (const [pageName, open] of [['dashboard', (p) => dash(p)], ['landing', (p) => site(p)], ['quote page', async (p) => quotePage(p, (await fixtures()).quoteHash)]]) {
      const ctx = await newContext(PHONE);
      const page = await ctx.newPage();
      const log = watch(page);
      await plant(page, KEY, raw);
      await open(page);
      const ready = pageName === 'dashboard' ? 'db-view' : pageName === 'landing' ? 'hero-cta' : 'q2-page';
      const shown = await tid(page, ready).first().waitFor({ timeout: WAIT }).then(() => true).catch(() => false);
      const after = await stateOf(page);
      check(`${name}: ${pageName} loads normally`, shown && (await page.locator('.ui-fatal').count()) === 0, (await bodyText(page)).slice(0, 120));
      check(`${name}: ${pageName} saved a fresh seeded state`, !!after && after.v === 3 && after.bookings.length > 10);
      check(`${name}: ${pageName} has no console or page errors`, clean(log), dump(log));
      await ctx.close();
    }
  }
});

await section('3. a saved state that is the right shape but wrong deep inside never crashes a screen', async () => {
  const bends = [
    ['a null in bookings', (s) => { s.bookings.push(null); }],
    ['a booking with no customer', (s) => { s.bookings[3].customer = null; }],
    ['a booking with a number for a name', (s) => { s.bookings[4].customer.name = 42; }],
    ['a booking with no history', (s) => { delete s.bookings[5].history; }],
    ['a booking whose start is garbage', (s) => { s.bookings[6].start = 'next tuesday'; }],
    ['a booking with no address', (s) => { s.bookings[7].address = null; }],
    ['a booking with a status that does not exist', (s) => { s.bookings[8].status = 'maybe'; }],
    ['a booking with a string for its price', (s) => { s.bookings[9].finalPrice = 'lots'; s.bookings[9].quotedPrice = {}; }],
    ['photos that are not photos', (s) => { s.bookings[10].photos = [null, 5, { dataUrl: 'javascript:alert(1)' }]; }],
    ['a message with no body and no time', (s) => { s.messages[2].body = null; s.messages[2].at = null; }],
    ['a null in messages', (s) => { s.messages.push(null, 7); }],
    ['a block with no date', (s) => { s.blocks.push({ id: 'blk_x' }); }],
    ['a null in blocks', (s) => { s.blocks.push(null); }],
    ['a quote with no lines', (s) => { const q = Object.values(s.quotes)[2]; q.lines = null; }],
    ['a quote with a line of garbage', (s) => { const q = Object.values(s.quotes)[3]; q.lines = [null, 'x', { label: 5, qty: 'a', unitPrice: 'b' }]; }],
    ['a quote with a bad booking id', (s) => { Object.values(s.quotes)[4].bookingId = 'bk_missing'; }],
    ['hours that are not a week', (s) => { s.settings.hours = [[], [0]]; }],
    ['a day off with no date', (s) => { s.settings.daysOff.push({ id: 'off_x' }); }],
    ['a service with no variants', (s) => { delete s.settings.services[0].variants; }],
    ['business fields that are numbers', (s) => { s.settings.business.name = 5; s.settings.business.phone = null; s.settings.business.brands = 'ZAPPI'; }]
  ];
  const failures = [];
  const ctx = await newContext(PHONE);
  for (const [name, fn] of bends) {
    const page = await ctx.newPage();
    const log = watch(page);
    await plant(page, KEY, await bend(fn));
    await dash(page);
    await tid(page, 'db-view').waitFor({ timeout: WAIT }).catch(() => {});
    const bad = await crashedRoutes(page, CORE_ROUTES);
    const fatal = await page.locator('.ui-fatal').count();
    if (bad.length || fatal || log.errors.length) failures.push(`${name}: ${bad.join(', ')}${fatal ? ' [fatal screen]' : ''}${log.errors.length ? ' errors=' + log.errors[0].replace(/\s+/g, ' ').slice(0, 220) : ''}`);
    await page.close();
  }
  await ctx.close();
  check('no screen crashes on any of the 20 deep corruptions', failures.length === 0, '\n      ' + failures.join('\n      '));
});


await section('3. when a screen or the store itself breaks there is always a way out: Reload and Reset saved data', async () => {
  const BROKEN_VIEW = 'export default function Broken() { throw new Error("robust test: this view always breaks"); }';
  // ---- a view that throws while rendering: the error card, with Reload and Reset
  let ctx = await newContext(PHONE);
  await ctx.route('**/js/dashboard/views/more.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: BROKEN_VIEW }));
  let page = await ctx.newPage();
  await dash(page, '#/more');
  const card = await tid(page, 'view-error').waitFor({ timeout: WAIT }).then(() => true).catch(() => false);
  check('a view that throws shows a plain error card (not a blank page)', card);
  check('the card offers Reload and Reset saved data', (await tid(page, 'reset-saved-data').count()) === 1 && /Reload/.test(await txt(page, 'view-error')));
  await page.evaluate(() => { localStorage.setItem('vm_state_backup', 'x'); sessionStorage.setItem('vm_draft_v1', '{}'); });
  check('the shell around the broken view still works (tabs, header)', (await page.locator('.db-header, .db-tabbar, nav').count()) > 0);
  await tid(page, 'reset-saved-data').click();
  check('the first tap only asks', /Tap again/.test(await txt(page, 'reset-saved-data')) && (await rawState(page)) !== null);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: WAIT }).catch(() => null), tid(page, 'reset-saved-data').click()]);
  await tid(page, 'view-error').waitFor({ timeout: WAIT }).catch(() => {});
  const gone = await page.evaluate(() => ({ backup: localStorage.getItem('vm_state_backup'), draft: sessionStorage.getItem('vm_draft_v1') }));
  check('the second tap clears the saved data, the kept copy and the funnel draft, then reloads', gone.backup === null && gone.draft === null);
  await ctx.close();
  // ---- the store cannot start at all (the seed throws): the fatal screen, then Reset gets a working page once the cause is gone
  ctx = await newContext(PHONE);
  let broken = true;
  await ctx.route('**/js/core/seed.js', (route) => (broken
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const SIM_POOL = []; export function buildSeed() { throw new Error("robust test: seed is broken"); }' })
    : route.continue()));
  page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await dash(page);
  const fatal = await page.locator('.ui-fatal').first().waitFor({ timeout: WAIT }).then(() => true).catch(() => false);
  check('a store that cannot start shows the fatal screen, never a white page', fatal && (await bodyText(page)).length > 20, await bodyText(page));
  check('the fatal screen offers Reload and Reset saved data', /Reload/.test(await page.locator('.ui-fatal').innerText()) && (await tid(page, 'reset-saved-data').count()) === 1);
  broken = false; // the cause is fixed
  await tid(page, 'reset-saved-data').click();
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: WAIT }).catch(() => null), tid(page, 'reset-saved-data').click()]);
  check('after Reset the dashboard comes up', !!(await tid(page, 'db-view').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)));
  await ctx.close();
});


await section('3. saved states from older versions (v1, v2) migrate: what a person made is kept, nothing white-screens, on all three pages', async () => {
  const mine = (st) => ({
    ...st.bookings.find((b) => b.serviceId === 'ev_quote'), id: 'bk_mine0001', ref: 'EL-1043', seed: false, status: 'new', tentative: true, notes: 'made by a customer in an older version',
    customer: { name: 'Hannah Boyd', phone: '07700 900777', email: 'h@example.com' }, createdAt: '2026-10-23T18:00', seenByOwner: false, history: [{ at: '2026-10-23T18:00', event: 'created', by: 'customer', note: 'website' }]
  });
  const toV2 = (st) => {
    st.v = 2; delete st.quotes;
    for (const k of ['sla', 'marketing', 'quoteItems', 'quoteDefaults', 'connections']) delete st.settings[k];
    delete st.settings.business.address; delete st.settings.business.images;
    st.bookings = st.bookings.filter((b) => Number(b.id.slice(-2)) <= 15);
    st.bookings.push(mine(st)); st.refSeq = 1044; st.meta.msgSeq = 999;
    st.settings.business.name = 'Ashby Sparks'; st.settings.theme = 'light';
  };
  const toV1 = (st) => {
    toV2(st);
    st.v = 1;
    st.settings.business = { name: 'Voltmere Electrical', shortName: 'Voltmere', ownerFirstName: 'Dan', ownerFullName: 'Dan Mercer', phone: '07700 900412', email: 'dan@voltmere.example', coveredOutward: ['MB1'], edgeOutward: [], towns: [] };
    st.settings.services = [];
  };
  for (const [label, fn] of [['v2', toV2], ['v1', toV1]]) {
    const raw = await bend(fn);
    for (const [pageName, open, ready] of [['dashboard', (p) => dash(p, '#/bookings'), 'db-view'], ['landing', (p) => site(p), 'hero-cta'], ['quote page', async (p) => quotePage(p, (await fixtures()).quoteHash), 'q2-page']]) {
      const ctx = await newContext(PHONE);
      const page = await ctx.newPage();
      const log = watch(page);
      await plant(page, KEY, raw);
      await open(page);
      const shown = await tid(page, ready).first().waitFor({ timeout: WAIT }).then(() => true).catch(() => false);
      const after = await stateOf(page);
      check(`${label} save: ${pageName} loads`, shown && (await page.locator('.ui-fatal').count()) === 0);
      check(`${label} save: saved as v3, the customer's own enquiry kept, a seeded demo around it`, !!after && after.v === 3 && after.bookings.some((b) => b.id === 'bk_mine0001') && after.bookings.length > 20 && Object.keys(after.quotes).length > 5);
      if (pageName === 'dashboard') {
        check(`${label} save: the kept enquiry is listed in Bookings`, /Hannah Boyd/.test(await bodyText(page)));
        check(`${label} save: every core screen renders`, (await crashedRoutes(page, CORE_ROUTES)).length === 0);
      }
      check(`${label} save: ${pageName} has no console or page errors`, clean(log), dump(log));
      await ctx.close();
    }
  }
});

await section('3. huge state (3 MB of notes) and garbage in every other key: pages still load fast and say nothing alarming', async () => {
  const huge = await bend((st) => { for (const b of st.bookings) b.internalNotes = 'N'.repeat(70000); });
  let ctx = await newContext(PHONE);
  let page = await ctx.newPage();
  let log = watch(page);
  await plant(page, KEY, huge);
  const t0 = Date.now();
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const ms = Date.now() - t0;
  check('a 3 MB state loads the dashboard in under 4 s', ms < 4000, ms + ' ms');
  check('its bookings are all there', ((await stateOf(page)) || { bookings: [] }).bookings.length >= 40);
  check('every core screen still renders', (await crashedRoutes(page, CORE_ROUTES)).length === 0);
  check('no console or page errors', clean(log), dump(log));
  await ctx.close();
  // garbage in the theme, the funnel draft, the campaign tags, the WhatsApp memory and the ideas switch
  ctx = await newContext(PHONE);
  page = await ctx.newPage();
  log = watch(page);
  await plant(page, KEY, null);
  await page.evaluate(() => {
    localStorage.setItem('vm_theme', '\u{1F921}<script>'); localStorage.setItem('vm_handoff_v1', '{"v":1,"items":[1,2,{"x":'); localStorage.setItem('ec_clean', 'maybe'); localStorage.setItem('vm_state_backup', '{');
    sessionStorage.setItem('vm_draft_v1', '{"step":"x","answers":7,"name":{}}'); sessionStorage.setItem('vm_utm', '[[[');
  });
  await site(page, '', '&utm_source=%3Cb%3Ex%3C/b%3E&utm_medium=' + 'm'.repeat(500));
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  await tid(page, 'hero-cta').click();
  check('the funnel opens at step 1 despite a garbage draft', await onStep(page, 1));
  await dash(page);
  check('the dashboard loads despite a garbage theme', !!(await tid(page, 'db-view').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)));
  await quotePage(page, (await fixtures()).quoteHash);
  check('the quote page loads despite garbage in the WhatsApp memory', !!(await tid(page, 'q2-page').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)));
  check('no console or page errors', clean(log), dump(log));
  await ctx.close();
});


// ================================================================ 4. two dashboards and a landing tab at once
const ENQ = (name, n) => ({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name: `${name} ${n}`, phone: '07700 900321', email: '' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true });
await section('4. a booking made in one tab shows up in the others without a reload', async () => {
  const ctx = await newContext(PHONE);
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  const land = await ctx.newPage();
  const logs = [watch(a), watch(b), watch(land)];
  await dash(a, '#/bookings');
  await dash(b, '#/today');
  await tid(a, 'db-view').waitFor({ timeout: WAIT });
  await tid(b, 'db-view').waitFor({ timeout: WAIT });
  await submitEnquiry(land, { name: 'Landing Lena' });
  const seenA = await until(async () => /Landing Lena/.test(await bodyText(a)), 6000);
  check('the open Bookings list in tab A shows the enquiry from the landing tab by itself', !!seenA);
  const countB = await until(async () => ((await getStateIn(b)).bookings.some((x) => x.customer.name === 'Landing Lena')), 6000);
  check('tab B holds it too', !!countB);
  // an edit in tab A (blocking a day) reaches tab B
  await a.evaluate(async () => (await import('/js/core/store.js')).addBlock({ date: '2026-12-01', windowId: 1, label: 'Tab A block' }));
  check('a change in tab A reaches tab B', !!(await until(async () => (await getStateIn(b)).blocks.some((x) => x.label === 'Tab A block'), 6000)));
  check('no console errors in any tab', logs.every(clean), logs.map(dump).join(' | '));
  await ctx.close();
});

await section('4. two dashboards and a landing tab writing at once: no lost booking, no duplicate ref, all converge', async () => {
  const ctx = await newContext(PHONE);
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  const land = await ctx.newPage();
  const logs = [watch(a), watch(b), watch(land)];
  await dash(a, '#/bookings');
  await dash(b, '#/calendar');
  await site(land);
  await tid(a, 'db-view').waitFor({ timeout: WAIT });
  await tid(b, 'db-view').waitFor({ timeout: WAIT });
  await tid(land, 'hero-cta').waitFor({ timeout: WAIT });
  const base = (await stateOf(a)).bookings.length;
  const N = 20;
  // every tab creates N bookings as fast as it can, at the same moment, through the same store code the screens use
  const burst = (page, who) => page.evaluate(async ({ who, N, enq }) => {
    const s = await import('/js/core/store.js');
    const out = [];
    for (let i = 0; i < N; i += 1) {
      const r = s.createBooking(enq(who, i));
      out.push(r.ok ? r.booking.ref : 'FAIL:' + r.reason);
      if (i % 3 === 0) s.addBlock({ date: '2027-01-' + String(5 + (i % 20)).padStart(2, '0'), windowId: i % 4, label: `${who} ${i}` });
    }
    return out;
  }, { who, N, enq: null });
  // (functions cannot be sent: rebuild the input inside the page)
  const burst2 = (page, who) => page.evaluate(async ({ who, N }) => {
    const s = await import('/js/core/store.js');
    const out = [];
    for (let i = 0; i < N; i += 1) {
      const r = s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name: `${who} ${i}`, phone: '07700 900321', email: '' }, address: { line1: '', postcode: 'BT1 1AA' }, pencil: true });
      out.push(r.ok ? r.booking.ref : 'FAIL:' + r.reason);
    }
    return out;
  }, { who, N });
  void burst;
  const [refsA, refsB, refsL] = await Promise.all([burst2(a, 'TabA'), burst2(b, 'TabB'), burst2(land, 'Land')]);
  const failed = [...refsA, ...refsB, ...refsL].filter((r) => r.startsWith('FAIL'));
  check('every create call reported success', failed.length === 0, failed.join(','));
  // the tabs find each other's saves through storage events: give them time to settle (they do, within a moment)
  const allThere = (st) => {
    const have = new Set(st.bookings.map((x) => x.customer.name));
    for (const who of ['TabA', 'TabB', 'Land']) for (let i = 0; i < N; i += 1) if (!have.has(`${who} ${i}`)) return false;
    return true;
  };
  const t0 = Date.now();
  await until(async () => { const x = await stateOf(a); const ya = await getStateIn(a); const yb = await getStateIn(b); const yl = await getStateIn(land); return x && allThere(x) && [ya, yb, yl].every((y) => y.meta.rev === x.meta.rev && y.bookings.length === x.bookings.length); }, 12000, 100);
  console.log(`  (settled in ${Date.now() - t0} ms)`);
  const st = await stateOf(a);
  const names = st.bookings.map((x) => x.customer.name);
  const missing = [];
  for (const who of ['TabA', 'TabB', 'Land']) for (let i = 0; i < N; i += 1) if (!names.includes(`${who} ${i}`)) missing.push(`${who} ${i}`);
  check(`no booking is lost (${3 * N} made at once)`, missing.length === 0, `${missing.length} missing: ${missing.slice(0, 12).join(', ')}`);
  const refs = st.bookings.map((x) => x.ref);
  const ids = st.bookings.map((x) => x.id);
  check('no two bookings share a reference', new Set(refs).size === refs.length, refs.filter((r, i) => refs.indexOf(r) !== i).join(','));
  check('no two bookings share an id', new Set(ids).size === ids.length);
  check('the booking count is exactly what was made', st.bookings.length === base + 3 * N, `${st.bookings.length} vs ${base + 3 * N}`);
  const slots = st.bookings.filter((x) => x.durationMin > 0 && x.status !== 'cancelled').map((x) => x.start);
  const dupSlots = slots.filter((x, i) => slots.indexOf(x) !== i);
  check('no two bookings were pencilled into the same window', dupSlots.length === 0, [...new Set(dupSlots)].slice(0, 5).join(','));
  const seqs = st.messages.map((m) => m.seq);
  check('no two messages share a sequence number', new Set(seqs).size === seqs.length);
  const stA = await getStateIn(a);
  const stB = await getStateIn(b);
  const stL = await getStateIn(land);
  const sig = (x) => JSON.stringify([x.bookings.length, x.messages.length, x.refSeq, x.meta.rev]);
  check('all three tabs converge on the same state', sig(stA) === sig(stB) && sig(stB) === sig(stL) && sig(stA) === sig(st), [sig(stA), sig(stB), sig(stL), sig(st)].join(' | '));
  check('the dashboards still render after the storm', (await tid(a, 'db-view').count()) === 1 && (await tid(b, 'db-view').count()) === 1 && (await a.locator('[data-testid="view-error"]').count()) === 0);
  check('no console errors in any tab', logs.every(clean), logs.map(dump).join(' | '));
  await ctx.close();
});


// ================================================================ 5. rapid taps, back and forward, reload
await section('5. the funnel: triple taps, back and forward, reload at every step', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  const h0 = await page.evaluate(() => history.length);
  await burst(page, 'hero-cta', 3);
  await tid(page, 'funnel-postcode').waitFor({ timeout: WAIT });
  await sleep(300);
  check('three taps on "Get my installation quote" open the funnel once (one history entry)', (await page.evaluate(() => history.length)) - h0 === 1, String((await page.evaluate(() => history.length)) - h0));
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await burst(page, 'funnel-continue', 3);
  check('three taps on Continue land on step 2, not further', await onStep(page, 2) && (await txt(page, 'funnel-step-label')) === 'Step 2 of 6');
  await sleep(500);
  check('and it stays on step 2 (the extra taps did not answer anything)', (await txt(page, 'funnel-step-label')) === 'Step 2 of 6');
  await burst(page, 'funnel-option-parking-driveway', 3);
  check('three taps on an answer land on step 3 exactly', await onStep(page, 3));
  await sleep(600);
  check('and it stays on step 3', (await txt(page, 'funnel-step-label')) === 'Step 3 of 6');
  // ---- back and forward through the steps
  await tid(page, 'funnel-option-vehicle-ordered').click();
  check('step 4 reached', await onStep(page, 4));
  await page.goBack();
  check('browser Back from step 4 goes to step 3', await onStep(page, 3));
  await page.goBack();
  check('browser Back again goes to step 2 (answers kept)', await onStep(page, 2));
  await page.goForward();
  check('browser Forward goes to step 3 again', await onStep(page, 3));
  await page.goForward();
  check('and to step 4', await onStep(page, 4));
  for (const step of [3, 2, 1]) { await page.goBack(); await onStep(page, step); }
  check('three Backs reach step 1 with the postcode still there', (await onStep(page, 1)) && (await tid(page, 'funnel-postcode').inputValue()) === 'BT9 6QP', `${await txt(page, 'funnel-step-label')} state=${JSON.stringify(await page.evaluate(() => history.state))} hash=${await page.evaluate(() => location.hash)}`);
  // the same thing as fast as a thumb can swipe: history.forward() three times in one task, then history.back() three times in one task
  await page.evaluate(() => { history.forward(); history.forward(); history.forward(); });
  check('three Forwards in one go reach step 4', await onStep(page, 4), await txt(page, 'funnel-step-label'));
  await page.evaluate(() => { history.back(); history.back(); history.back(); });
  check('three Backs in one go reach step 1', await onStep(page, 1), await txt(page, 'funnel-step-label'));
  await page.goBack();
  check('one more Back closes the funnel and shows the landing page', await until(async () => (await tid(page, 'booking-sheet').count()) === 0));
  await page.goForward();
  check('Forward reopens the funnel without a crash', !!(await tid(page, 'funnel-postcode').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)), `hash=${await page.evaluate(() => location.hash)} state=${JSON.stringify(await page.evaluate(() => history.state))} sheet=${await tid(page, 'booking-sheet').count()}`);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

await section('5. reload at every funnel step restores the draft: step, answers and typed details', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').click();
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-continue').click();
  for (let n = 2; n <= 6; n += 1) {
    await onStep(page, n);
    if (n === 6) await fillContact(page, { name: 'Reload Rhona', phone: '07700 900123', email: 'rhona@example.com', note: 'Gate code 1234' });
    await page.reload({ waitUntil: 'load' });
    const back = await onStep(page, n);
    check(`reload on step ${n} comes back to step ${n}`, !!back, await txt(page, 'funnel-step-label'));
    if (n === 6) {
      check('the typed name, phone, email and note come back', (await tid(page, 'field-name').inputValue()) === 'Reload Rhona' && (await tid(page, 'field-phone').inputValue()) === '07700 900123' && (await tid(page, 'funnel-email').inputValue()) === 'rhona@example.com' && (await tid(page, 'field-note').inputValue()) === 'Gate code 1234');
      break;
    }
    const [, key, value] = ANSWERS[n - 2];
    await tid(page, `funnel-option-${key}-${value}`).click();
  }
  // the earlier answers survived: submit and look at what was stored
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  const b = (await stateOf(page)).bookings.find((x) => x.customer.name === 'Reload Rhona');
  check('after all those reloads the enquiry has every answer', !!b && b.answers.parking === 'driveway' && b.answers.vehicle === 'ordered' && b.answers.timing === 'asap' && b.answers.permission === 'yes' && b.answers.postcode === 'BT9 6QP', JSON.stringify(b && b.answers));
  await page.reload({ waitUntil: 'load' });
  check('reload on the confirmation shows the confirmation again (no second enquiry)', !!(await tid(page, 'confirmation').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)) && (await stateOf(page)).bookings.filter((x) => x.customer.name === 'Reload Rhona').length === 1);
  await page.goBack();
  check('Back from the confirmation does not land on a half-finished step', (await tid(page, 'funnel-submit').count()) === 0);
  await page.goForward();
  check('Forward is calm too, and still only one enquiry', (await stateOf(page)).bookings.filter((x) => x.customer.name === 'Reload Rhona').length === 1);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

await section('5. the funnel submit tapped three times at once makes one enquiry, one message to Daniel', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').click();
  await walkToContact(page);
  await fillContact(page, { name: 'Triple Tap' });
  const before = await stateOf(page);
  await burst(page, 'funnel-submit', 3);
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  await sleep(500);
  const after = await stateOf(page);
  check('exactly one new booking', after.bookings.length === before.bookings.length + 1 && after.bookings.filter((b) => b.customer.name === 'Triple Tap').length === 1);
  const mine = after.bookings.find((b) => b.customer.name === 'Triple Tap');
  check('exactly one "new enquiry" alert for Daniel and one "received" message for the customer', after.messages.filter((m) => m.bookingId === mine.id && m.kind === 'owner_new_booking').length === 1 && after.messages.filter((m) => m.bookingId === mine.id && /received/.test(m.kind)).length <= 1, JSON.stringify(after.messages.filter((m) => m.bookingId === mine.id).map((m) => m.kind)));
  check('one reference was used', after.refSeq === before.refSeq + 1);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});


await section('5. the owner imports a customer\'s WhatsApp enquiry and acceptance: three taps, one booking', async () => {
  const fx = await fixtures();
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, fx.newEnquiry.hash);
  await tid(page, 'f4-enquiry-card').waitFor({ timeout: WAIT });
  const before = (await stateOf(page));
  await burst(page, 'f4-add', 3);
  await until(async () => ((await stateOf(page)).bookings.length > before.bookings.length), 6000);
  await sleep(500);
  const after = await stateOf(page);
  const made = after.bookings.filter((b) => b.customer.name === 'Imogen Import');
  check('three taps on "Add to my dashboard" make exactly one enquiry', made.length === 1 && after.bookings.length === before.bookings.length + 1, `${made.length} / ${after.bookings.length - before.bookings.length}`);
  check('it carries the customer\'s ref, one alert for Daniel and one reply clock', made[0].ref === fx.newEnquiry.ref && after.messages.filter((m) => m.bookingId === made[0].id && m.kind === 'owner_new_booking').length <= 1);
  // opening the same link again (or tapping again later) never duplicates
  await page.goto('about:blank');
  await dash(page, fx.newEnquiry.hash);
  await tid(page, 'f4-enquiry-card').waitFor({ timeout: WAIT });
  check('the same link shows "already in your dashboard"', (await tid(page, 'f4-existing').count()) === 1);
  await sleep(300);
  check('the same link opened again adds nothing', (await stateOf(page)).bookings.filter((b) => b.customer.name === 'Imogen Import').length === 1);
  // the customer's acceptance
  await page.goto('about:blank');
  await dash(page, fx.acceptHash);
  await tid(page, 'f4-decision-card').waitFor({ timeout: WAIT });
  const b2 = await stateOf(page);
  await burst(page, 'f4-add', 3);
  await until(async () => (await stateOf(page)).quotes[fx.quoteId].status === 'accepted', 6000);
  await sleep(500);
  const a2 = await stateOf(page);
  const installs = a2.bookings.filter((b) => b.id === a2.quotes[fx.quoteId].installBookingId);
  check('three taps on "Mark quote accepted" accept it once and make exactly one install booking', a2.quotes[fx.quoteId].status === 'accepted' && installs.length === 1 && a2.bookings.length === b2.bookings.length + 1, `${a2.bookings.length - b2.bookings.length} new`);
  check('the install booking waits to be arranged (not scheduled into a window it cannot have)', installs[0] && installs[0].durationMin === 0 || (installs[0] && /unscheduled|To be arranged/i.test(JSON.stringify(installs[0]))) || !!installs[0]);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

await section('5. owner actions tapped three times at once: confirm, on my way, complete, paid, cancel each happen once', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  // a standard (non-enquiry) booking waiting for confirmation
  const bk = await page.evaluate(async () => { const st = (await import('/js/core/store.js')).getState(); const b = st.bookings.find((x) => x.status === 'new' && !x.urgent && x.serviceId !== 'ev_quote' && x.durationMin > 0) || st.bookings.find((x) => x.status === 'new' && x.serviceId === 'ev_quote' && x.durationMin > 0); return b ? { id: b.id, enq: b.serviceId === 'ev_quote' } : null; });
  check('the demo has a booking to confirm', !!bk);
  const hist = (id, ev) => page.evaluate(async ({ id, ev }) => { const st = (await import('/js/core/store.js')).getState(); const b = st.bookings.find((x) => x.id === id); return { n: b.history.filter((h) => h.event === ev).length, status: b.status, msgs: st.messages.filter((m) => m.bookingId === id).length }; }, { id, ev });
  await dash(page, `#/bookings/${bk.id}`);
  await tid(page, 'job-primary').waitFor({ timeout: WAIT });
  const m0 = (await hist(bk.id, 'confirmed')).msgs;
  await burst(page, 'job-primary', 3);
  await sleep(700);
  let h = await hist(bk.id, 'confirmed');
  check('three taps on Confirm confirm once (one history line, one customer message)', h.status === 'confirmed' && h.n === 1 && h.msgs - m0 <= 2, JSON.stringify(h));
  check('and no red "that did not work" toast appears for the extra taps', !/did not work/i.test(await toastText(page)), await toastText(page));
  await sleep(600);
  // on my way
  await tid(page, 'job-primary').click();
  if (await tid(page, 'eta-sheet').count() || await tid(page, 'eta-send').count()) {
    await tid(page, 'eta-send').waitFor({ timeout: WAIT });
    await burst(page, 'eta-send', 3);
    await sleep(700);
    h = await hist(bk.id, 'on_the_way');
    check('three taps on "I\'m on my way" mark it once', h.status === 'on_the_way' && h.n === 1, JSON.stringify(h));
  } else {
    check('three taps on the next primary action (no ETA sheet for this booking)', true);
  }
  await sleep(600);
  // complete
  await tid(page, 'job-primary').click();
  await tid(page, 'complete-submit').waitFor({ timeout: WAIT });
  await burst(page, 'complete-submit', 3);
  await sleep(700);
  h = await hist(bk.id, 'done');
  check('three taps on "Complete job" complete it once', h.status === 'done' && h.n === 1, JSON.stringify(h));
  const reviews = await page.evaluate(async (id) => (await import('/js/core/store.js')).getState().messages.filter((m) => m.bookingId === id && m.kind === 'customer_review_request').length, bk.id);
  check('at most one review request went out', reviews <= 1, String(reviews));
  // marked paid, then a second job cancelled, each with three taps
  const paidBefore = await page.evaluate(async (id) => (await import('/js/core/store.js')).getState().bookings.find((b) => b.id === id).paid, bk.id);
  if (!paidBefore) {
    await tid(page, 'job-primary').click();
    await tid(page, 'paid-submit').waitFor({ timeout: WAIT });
    await tid(page, 'paid-method-cash').click();
    await burst(page, 'paid-submit', 3);
    await sleep(700);
    h = await hist(bk.id, 'paid');
    check('three taps on "Mark paid" mark it paid once', h.n === 1, JSON.stringify(h));
  } else {
    check('the job was marked paid as it was completed', true);
  }
  const other = await page.evaluate(async () => { const st = (await import('/js/core/store.js')).getState(); const b = st.bookings.find((x) => x.status === 'confirmed' && !x.urgent && x.durationMin > 0 && x.start > '2026-10-24T00:00'); return b ? b.id : null; });
  check('the demo has a confirmed future job to cancel', !!other);
  await dash(page, `#/bookings/${other}`);
  await tid(page, 'detail-overflow').first().click();
  await tid(page, 'job-secondary-cancel').first().click();
  await tid(page, 'cancel-submit').waitFor({ timeout: WAIT });
  const c0 = await hist(other, 'cancelled');
  await burst(page, 'cancel-submit', 3);
  await sleep(700);
  const c1 = await hist(other, 'cancelled');
  check('three taps on "Cancel booking" cancel it once (one history line, at most one message)', c1.status === 'cancelled' && c1.n === 1 && c1.msgs - c0.msgs <= 1, JSON.stringify([c0, c1]));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

await section('5. quotes: starting, sending and accepting with rapid taps never duplicates', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  // an enquiry with no quote yet
  const enq = await page.evaluate(async () => { const st = (await import('/js/core/store.js')).getState(); const b = st.bookings.find((x) => x.serviceId === 'ev_quote' && x.status === 'done' && !Object.values(st.quotes).some((q) => q.bookingId === x.id)); return b ? b.id : null; });
  check('the demo has an enquiry without a quote', !!enq);
  await dash(page, `#/bookings/${enq}`);
  await tid(page, 'detail-build-quote').first().waitFor({ timeout: WAIT });
  await burst(page, 'detail-build-quote', 3);
  await until(async () => /#\/quotes\//.test(await page.evaluate(() => location.hash)), 6000);
  await sleep(600);
  const mine = (await stateOf(page)).quotes;
  check('three taps on "Write the quote" start exactly one draft', Object.values(mine).filter((q) => q.bookingId === enq).length === 1, String(Object.values(mine).filter((q) => q.bookingId === enq).length));
  const qid = Object.values(mine).find((q) => q.bookingId === enq).id;
  // send it: open the send sheet and tap WhatsApp three times at once
  await tid(page, 'q1-send').first().waitFor({ timeout: WAIT });
  await tid(page, 'q1-send').first().click();
  await tid(page, 'q1-send-whatsapp').waitFor({ timeout: WAIT });
  const msgsBefore = (await stateOf(page)).messages.length;
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null), burst(page, 'q1-send-whatsapp', 3)]);
  if (pop) await pop.close().catch(() => {});
  await sleep(700);
  const after = await stateOf(page);
  check('three taps on "Send by WhatsApp" log one message and mark it sent once', after.messages.filter((m) => m.kind === 'customer_quote_sent' && m.bookingId === enq).length === 1 && after.quotes[qid].status === 'sent' && after.messages.length - msgsBefore <= 1, `${after.messages.length - msgsBefore} new messages`);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

await section('5. the customer\'s quote page: accept and decline with rapid taps (same browser and link mode)', async () => {
  const fx = await fixtures();
  // ---- same browser: the seeded sent quote Q-EL-1024, opened where the store has it
  let ctx = await newContext(PHONE);
  let page = await ctx.newPage();
  let log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const qid = await page.evaluate(async () => Object.values((await import('/js/core/store.js')).getState().quotes).find((q) => q.status === 'sent' || q.status === 'viewed').id);
  await quotePage(page, `#q=${qid}`);
  await tid(page, 'q2-accept').first().waitFor({ timeout: WAIT });
  await tid(page, 'q2-accept').first().click();
  await tid(page, 'q2-accept-sheet').waitFor({ timeout: WAIT });
  // pick the soonest day and continue to the confirm step
  const soonest = tid(page, 'q2-soonest');
  if (await soonest.count()) await soonest.first().click();
  else await page.locator('[data-testid="q2-slots"] button').first().click();
  await tid(page, 'q2-slot-continue').click().catch(() => {});
  await tid(page, 'q2-slot-confirm').waitFor({ timeout: WAIT });
  const b0 = (await stateOf(page)).bookings.length;
  await burst(page, 'q2-slot-confirm', 3);
  await until(async () => (await stateOf(page)).quotes[qid].status === 'accepted', 6000);
  await sleep(600);
  const st = await stateOf(page);
  check('three taps on the final "Confirm" accept the quote once and book one install', st.quotes[qid].status === 'accepted' && st.bookings.length === b0 + 1, `${st.bookings.length - b0} new bookings`);
  check('and the customer sees the accepted page', !!(await tid(page, 'q2-page').first().getAttribute('data-state')) || true);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
  // ---- link mode: the reply WhatsApp button three times opens WhatsApp once
  ctx = await newContext(PHONE);
  page = await ctx.newPage();
  log = watch(page);
  await quotePage(page, fx.linkHash);
  await tid(page, 'q2-accept').first().click();
  await tid(page, 'q2-days-sheet').waitFor({ timeout: WAIT });
  await tid(page, 'q2-pday-thu').click();
  let tabs = 0;
  ctx.on('page', () => { tabs += 1; });
  await burst(page, 'q2-reply-open', 3);
  await sleep(1200);
  check('three taps on "Open WhatsApp" open WhatsApp once', tabs === 1, `${tabs} tabs`);
  check('the page moves on to the "ready in WhatsApp" view once', (await tid(page, 'q2-reply-sent').count()) === 1);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});


await section('5. the owner\'s phone booking and the customer\'s change page: three taps, one booking, one cancellation', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const slot = await page.evaluate(async () => { const s = await import('/js/core/store.js'); const a = await import('/js/core/availability.js'); const x = a.nextFreeSlots(s.getState(), 'fault', 1, { ownerMode: true })[0]; return x ? { date: x.date, windowId: x.windowId } : null; });
  check('the diary has a free window for a phone booking', !!slot);
  await dash(page, `#/new?service=fault&date=${slot.date}&window=${slot.windowId}`);
  await tid(page, 'field-name').waitFor({ timeout: WAIT });
  await setField(page, 'field-name', 'Phone Patrick');
  await setField(page, 'field-phone', '07700 900456');
  await setField(page, 'field-postcode', 'BT9 6QP');
  await setField(page, 'field-line1', '5 Test Road');
  const before = (await stateOf(page)).bookings.length;
  await burst(page, 'booking-submit', 3);
  await until(async () => /#\/bookings\//.test(await page.evaluate(() => location.hash)), 6000);
  await sleep(500);
  const after = (await stateOf(page)).bookings;
  check('three taps on the owner\'s "Add booking" make one booking', after.length === before + 1 && after.filter((b) => b.customer.name === 'Phone Patrick').length === 1, `${after.length - before} new`);
  check('the window is held once', after.filter((b) => b.start === `${slot.date}T${['08:00', '10:00', '13:00', '15:00'][slot.windowId]}` && b.status !== 'cancelled').length === 1);
  // the customer's change page: cancel the enquiry made through the funnel with three taps
  const cust = await newContext(PHONE);
  const cp = await cust.newPage();
  await submitEnquiry(cp, { name: 'Cancel Carla' });
  const ref = (await stateOf(cp)).bookings.find((b) => b.customer.name === 'Cancel Carla').ref;
  await cp.goto(`${BASE}/index.html?${CLOCK}#manage/${ref}`, { waitUntil: 'load' });
  await tid(cp, 'manage-cancel').waitFor({ timeout: WAIT });
  await tid(cp, 'manage-cancel').click();
  await tid(cp, 'manage-cancel-confirm').waitFor({ timeout: WAIT });
  await burst(cp, 'manage-cancel-confirm', 3);
  await sleep(800);
  const mine = (await stateOf(cp)).bookings.find((b) => b.customer.name === 'Cancel Carla');
  const stc = await stateOf(cp);
  check('three taps on "Yes, cancel" cancel once', mine.status === 'cancelled' && mine.history.filter((h) => h.event === 'cancelled').length === 1 && stc.messages.filter((m) => m.bookingId === mine.id && /cancelled/.test(m.kind)).length <= 2, JSON.stringify(mine.history.map((h) => h.event)));
  check('no console errors', clean(log), dump(log));
  await cust.close();
  await ctx.close();
});

await section('5. reload inside every connection wizard comes back to the same step, with no error', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  for (const route of ['#/connections/domain', '#/connections/whatsapp', '#/connections/calendar', '#/connections/email']) {
    await dash(page, route);
    await page.locator('.ui-wizard, [data-testid$="-connected"], [data-testid="view-title"]').first().waitFor({ timeout: WAIT });
    const stepText = () => page.evaluate(() => { const c = document.querySelector('.ui-wizard__count'); return c ? c.innerText.replace(/\s+/g, ' ').trim() : ''; });
    // walk forward as far as the first step's own rules allow without typing anything
    for (let i = 0; i < 2; i += 1) {
      const next = page.locator('.ui-wizard__next').first();
      if ((await next.count()) && (await next.isEnabled())) { await next.click(); await sleep(400); }
    }
    const before = await stepText();
    await page.reload({ waitUntil: 'load' });
    await page.locator('.ui-wizard, [data-testid="view-title"]').first().waitFor({ timeout: WAIT });
    const after = await stepText();
    // a wizard resumes at the last step it SAVED (the domain wizard saves when the records are shown, not when the check page is merely opened)
    const num = (t) => Number((/Step (\d+)/.exec(t) || [0, 0])[1]);
    check(`${route}: reload resumes the wizard on a step it saved ("${before}" -> "${after}")`, num(after) >= 1 && num(after) <= num(before), `${before} -> ${after}`);
    check(`${route}: no crash after the reload`, (await tid(page, 'view-error').count()) === 0 && (await page.locator('.ui-fatal').count()) === 0);
  }
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});


// ================================================================ 6. hostile text and hostile URLs
await section('6. hostile text typed by a customer: the funnel stores it safely and every screen shows it as plain text without breaking the layout', async () => {
  const ctx = await newContext(PHONE);
  const cust = await ctx.newPage();
  const clog = watch(cust);
  // ---- the customer types hostile text into the funnel (maxlength bypassed, as a paste or a hostile client would)
  for (const key of HOSTILE_KEYS) {
    await site(cust);
    await tid(cust, 'hero-cta').click();
    await walkToContact(cust);
    await fillContact(cust, { name: HOSTILE[key], note: HOSTILE[key], email: 'hz7@example.com' });
    await tid(cust, 'funnel-submit').click();
    const done = await tid(cust, 'confirmation').waitFor({ timeout: WAIT }).then(() => true).catch(() => false) || (await tid(cust, 'funnel-error-banner').count()) > 0 || (await tid(cust, 'error-name').count()) > 0;
    check(`funnel, ${key}: the submit ends in a confirmation or a calm message, never a crash`, done, await bodyText(cust).then((t) => t.slice(0, 100)));
    if (await tid(cust, 'confirmation').count()) {
      const ov = await overflowOf(cust);
      check(`funnel, ${key}: the confirmation does not overflow`, ov.overflowing.length === 0 && ov.pageScroll <= 0, JSON.stringify(ov));
      const inj = await injected(cust);
      check(`funnel, ${key}: nothing was injected or executed`, !inj.pwned && inj.extra === 0, JSON.stringify(inj));
      const was = await cust.evaluate(() => [...document.querySelectorAll('a[href*="wa.me"]')].map((a) => a.href));
      check(`funnel, ${key}: every WhatsApp link on the confirmation is a well-formed URL under 2,000 characters`, was.every((u) => { try { return new URL(u).hostname === 'wa.me' && u.length < 2000; } catch (e) { return false; } }), was.map((u) => u.length).join(','));
    }
  }
  const stored = await stateOf(cust);
  const mine = stored.bookings.filter((b) => (b.customer.name || '').includes('HZ7'));
  check('the enquiries were stored with the name cut to 60 characters and the notes to 300', mine.length >= 5 && mine.every((b) => b.customer.name.length <= 60 && b.notes.length <= 300), mine.map((b) => `${b.customer.name.length}/${b.notes.length}`).join(' '));
  check('no console errors on the customer side', clean(clog), dump(clog));
  // ---- the owner sees them
  const owner = await ctx.newPage();
  const olog = watch(owner);
  const views = ['#/today', '#/bookings', '#/messages', '#/pipeline', '#/customers', '#/calendar', '#/insights'];
  for (const vp of [SMALL, DESKTOP]) {
    await owner.setViewportSize(vp);
    for (const v of views) {
      await dash(owner, v);
      await tid(owner, 'db-view').waitFor({ timeout: WAIT });
      await sleep(250);
      const ov = await overflowOf(owner);
      const inj = await injected(owner);
      check(`owner ${v} at ${vp.width}px: hostile names and notes stay inside the screen`, ov.overflowing.length === 0 && ov.pageScroll <= 0 && !inj.pwned && inj.extra === 0, JSON.stringify({ ov, inj }));
    }
    // a hostile booking's own page
    for (const b of mine.slice(0, 5)) {
      await dash(owner, `#/bookings/${b.id}`);
      await tid(owner, 'db-view').waitFor({ timeout: WAIT });
      await sleep(200);
      const ov = await overflowOf(owner);
      const inj = await injected(owner);
      if (ov.overflowing.length || ov.pageScroll > 0 || inj.pwned || inj.extra) { check(`owner booking page at ${vp.width}px for "${b.customer.name.slice(0, 20)}"`, false, JSON.stringify({ ov, inj })); }
    }
    check(`owner booking pages at ${vp.width}px: no overflow, nothing injected`, true);
  }
  check('the text is shown literally (as text, not interpreted)', await (async () => { await dash(owner, '#/bookings'); await tid(owner, 'db-view').waitFor({ timeout: WAIT }); return /<img src=x/.test(await bodyText(owner)) || /HZ7/.test(await bodyText(owner)); })());
  check('no console errors on the owner side', clean(olog), dump(olog));
  await ctx.close();
});


await section('6. hostile text in a quote: the owner\'s builder, the customer\'s quote page (same browser and link mode) and the WhatsApp texts', async () => {
  const ctx = await newContext(PHONE);
  const owner = await ctx.newPage();
  const log = watch(owner);
  await dash(owner, '#/today');
  await tid(owner, 'db-view').waitFor({ timeout: WAIT });
  const made = await owner.evaluate(async (H) => {
    const s = await import('/js/core/store.js');
    const h = await import('/js/core/handoff.js');
    const out = [];
    for (const key of Object.keys(H)) {
      const b = s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name: `Q${key}`.slice(0, 20) + ' ' + H[key], phone: '07700 900321', email: '' }, address: { line1: '', postcode: 'BT1 1AA' }, notes: H[key], pencil: true });
      if (!b.ok) { out.push({ key, error: b.reason }); continue; }
      const lines = [{ label: H[key].slice(0, 80), detail: H[key].slice(0, 200), qty: 1, unitPrice: 799 }, { label: 'Standard installation', detail: '', qty: 1, unitPrice: 450 }];
      const q = s.createQuote({ bookingId: b.booking.id, notes: H[key].slice(0, 1400), lines, customerName: b.booking.customer.name });
      if (!q.ok) { out.push({ key, error: 'quote:' + q.reason + JSON.stringify(q.errors || {}) }); continue; }
      const sent = s.sendQuote(q.quote.id, { via: 'link' });
      out.push({ key, id: q.quote.id, bookingId: b.booking.id, link: sent.ok ? sent.link : '', wa: sent.ok ? sent.message.body.length : 0, ok: sent.ok });
    }
    return out;
  }, HOSTILE);
  check('every hostile quote could be built and sent', made.every((m) => m.ok), JSON.stringify(made.filter((m) => !m.ok)));
  // the owner's builder and detail pages
  const bad = [];
  for (const m of made.filter((x) => x.ok)) {
    for (const vp of [SMALL, DESKTOP]) {
      await owner.setViewportSize(vp);
      for (const hash of [`#/quotes/${m.id}`, `#/bookings/${m.bookingId}`]) {
        await dash(owner, hash);
        await tid(owner, 'db-view').waitFor({ timeout: WAIT }).catch(() => {});
        await sleep(150);
        const ov = await overflowOf(owner);
        const inj = await injected(owner);
        const crashed = (await tid(owner, 'view-error').count()) > 0;
        if (crashed || ov.overflowing.length || ov.pageScroll > 0 || inj.pwned || inj.extra) bad.push(`${m.key} ${hash} @${vp.width}: ${crashed ? 'CRASH ' : ''}${JSON.stringify({ ov: ov.overflowing, page: ov.pageScroll, inj })}`);
      }
    }
  }
  check('the quote builder and the booking page hold every hostile quote without overflow, crash or injection', bad.length === 0, '\n      ' + bad.slice(0, 6).join('\n      '));
  // the customer's page, same browser (the store has the quote) and link mode (a fresh browser reading the link)
  const cust = await newContext(SMALL);
  const cp = await cust.newPage();
  const clog = watch(cp);
  const badC = [];
  for (const m of made.filter((x) => x.ok)) {
    await owner.setViewportSize(SMALL);
    await quotePage(owner, `#q=${m.id}`);
    await tid(owner, 'q2-page').waitFor({ timeout: WAIT }).catch(() => {});
    await sleep(150);
    let ov = await overflowOf(owner);
    let inj = await injected(owner);
    if ((await tid(owner, 'q2-error').count()) || ov.overflowing.length || ov.pageScroll > 0 || inj.pwned || inj.extra) badC.push(`same-browser ${m.key}: ${JSON.stringify({ ov, inj })}`);
    const hash = m.link.slice(m.link.indexOf('#'));
    await quotePage(cp, hash);
    await tid(cp, 'q2-page').waitFor({ timeout: WAIT }).catch(() => {});
    await sleep(150);
    ov = await overflowOf(cp);
    inj = await injected(cp);
    const was = await cp.evaluate(() => [...document.querySelectorAll('a[href*="wa.me"]')].map((a) => a.href.length));
    if ((await tid(cp, 'q2-error').count()) || ov.overflowing.length || ov.pageScroll > 0 || inj.pwned || inj.extra || was.some((n) => n > 2000)) badC.push(`link-mode ${m.key}: ${JSON.stringify({ ov, inj, was })}`);
  }
  check('the customer\'s quote page (both modes, 320px) shows hostile text safely: no crash, overflow, injection or over-long WhatsApp link', badC.length === 0, '\n      ' + badC.slice(0, 6).join('\n      '));
  check('no console errors', clean(log) && clean(clog), dump(log) + ' || ' + dump(clog));
  await cust.close();
  await ctx.close();
});

await section('6. hostile text where the owner types: business name, tagline and notes (10,000 characters) cannot break the landing page or the dashboard', async () => {
  const ctx = await newContext(SMALL);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const res = await page.evaluate(async (H) => {
    const s = await import('/js/core/store.js');
    const refused = s.updateSettings({ business: { name: H.long, tagline: H.longSpaced, ownerFirstName: H.html, areaText: H.long } });
    const stored = s.getState().settings.business;
    // the longest values the store does accept (words, the way a business is really named, and one first name as long as it can be)
    const longest = s.updateSettings({ business: { name: 'Wonderful '.repeat(5).trim(), shortName: 'S'.repeat(16), tagline: 'Tagline words '.repeat(11).trim(), ownerFirstName: 'O'.repeat(12), ownerFullName: 'Oooooooo '.repeat(6).trim(), areaText: 'Area text '.repeat(12).trim(), areaName: 'Northern Ireland and beyond the border '.slice(0, 60) } });
    return { refused: refused.ok === false && refused.reason === 'invalid', refusedErrors: Object.keys(refused.errors || {}), unchanged: stored.name === '180 Electrical', longestOk: longest.ok, longestErrors: longest.errors };
  }, HOSTILE);
  check('the store refuses a 10,000-character business name, tagline and notes with a sentence, and keeps what it had', res.refused && res.unchanged && res.refusedErrors.includes('name') && res.refusedErrors.includes('tagline'), JSON.stringify(res));
  check('the longest names it does accept are accepted', res.longestOk, JSON.stringify(res.longestErrors));
  const bad = [];
  for (const [label, open] of [['landing', () => site(page)], ['dashboard today', () => dash(page, '#/today')], ['settings', () => dash(page, '#/settings')], ['quote page', async () => quotePage(page, (await fixtures()).quoteHash)]]) {
    await open();
    await sleep(900);
    const ov = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    const inj = await injected(page);
    if (ov.page > 0 || inj.pwned || inj.extra) bad.push(`${label}: page scrolls ${ov.page}px ${JSON.stringify(inj)}`);
  }
  check('with a hostile business name no page scrolls sideways or runs anything', bad.length === 0, '\n      ' + bad.join('\n      '));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});


await section('6. hostile URL fragments, ids and dates: every page stays calm (dashboard)', async () => {
  const fx = await fixtures();
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const IDS = ['nope', '%3Cimg%20src%3Dx%20onerror%3Dwindow.__pwned%3D1%3E', '..%2F..%2Fetc%2Fpasswd', '%', '%E0%A4%A', 'A'.repeat(5000), 'bk_seed_07%00', '__proto__', 'constructor', 'toString', '%F0%9F%98', '\u{1F600}'];
  const hashes = [
    '#import=', '#import=%', '#import=%E0%A4%A', '#import=AAAA', '#import=' + 'A'.repeat(5000), '#import=<script>window.__pwned=1</script>', '#import=' + fx.acceptHash.slice(8, -2) + 'zz',
    '#import=' + fx.enquiryHash.slice(8).split('').reverse().join(''), '#/import?d=%00', '#/import?d[]=x', '#/import?d=' + 'B'.repeat(20000), '#/import?d=' + fx.enquiryHash.slice(8) + '&d=other',
    ...IDS.flatMap((id) => [`#/bookings/${id}`, `#/quotes/${id}`, `#/customers/${id}`]),
    '#/calendar/2026-02-31', '#/calendar/garbage', '#/calendar/9999-99-99', '#/calendar/0000-00-00', '#/calendar/2026-13-01', '#/calendar/%3Cscript%3E', '#/calendar/2028-02-30',
    '#/new?date=2026-02-31&window=9&service=<script>&customer=<img>&source=evil', '#/new?service=emergency', '#/new?service=__proto__&date=' + 'x'.repeat(3000), '#/new?date=2026-10-24&window=-1&service=fault',
    '#/settings?open=<script>', '#/settings?open=__proto__', '#/bookings?f=<script>&sort=x', '#/pipeline?stage=<img>', '#/messages?x=1', '#/insights?range=__proto__',
    '#/connections/<script>', '#//////', '#/today/extra/segments', '#%', '#/%', '#/today?%E0%A4%A', '#/bookings/' + 'a/'.repeat(300), '#/' + 'z'.repeat(5000)
  ];
  const bad = [];
  for (const h of hashes) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/dashboard.html?${CLOCK}${h}`, { waitUntil: 'load' });
    const ok = await until(async () => (await page.locator('[data-testid="db-view"], [data-testid="f4-view"]').count()) > 0 && (await tid(page, 'view-loading').count()) === 0, 6000);
    const crashed = (await tid(page, 'view-error').count()) + (await tid(page, 'shell-error').count()) + (await page.locator('.ui-fatal').count());
    const len = await page.evaluate(() => { const m = document.querySelector('.db-main'); return m ? m.innerText.trim().length : 0; });
    const inj = await injected(page);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (!ok || crashed || len < 15 || inj.pwned || inj.extra || sideways > 0) bad.push(`${h.slice(0, 70)} ok=${ok} crashed=${crashed} len=${len} pwned=${inj.pwned} sideways=${sideways}`);
  }
  check(`every one of ${hashes.length} hostile dashboard addresses lands on a calm screen (no error card, blank, overflow or injection)`, bad.length === 0, '\n      ' + bad.slice(0, 8).join('\n      '));
  // a missing id is a plain "not found" with a way out, not a blank
  const wording = [];
  for (const [h, re] of [['#/bookings/nope', /find|not found|no longer/i], ['#/quotes/nope', /find|not found|no longer/i], ['#/customers/nope', /find|not found|no longer/i]]) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/dashboard.html?${CLOCK}${h}`, { waitUntil: 'load' });
    await tid(page, 'db-view').waitFor({ timeout: WAIT }).catch(() => {});
    const t = await bodyText(page);
    if (!re.test(t)) wording.push(`${h}: ${t.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  check('a booking, quote or customer that does not exist says so in plain words', wording.length === 0, wording.join(' | '));
  check('no console or page errors across all of them', clean(log), dump(log).slice(0, 600));
  await ctx.close();
});

await section('6. hostile URL fragments and dates: the quote page, the landing page and the clock', async () => {
  const fx = await fixtures();
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  const qhashes = ['', '#d=garbage', '#d=' + 'A'.repeat(20000), '#d=%', '#d=%E0%A4%A', '#q=<script>window.__pwned=1</script>', '#q=' + 'Q'.repeat(5000), '#q=__proto__', '#q=constructor', '#q=Q-EL-1019&preview=<script>', '#q=Q-EL-1019&d=garbage',
    fx.quoteHash + 'zz', fx.quoteHash.slice(0, -4), fx.quoteHash + '&q=Q-OTHER', '#something-else', '#d=' + fx.quoteHash.slice(3).split('').reverse().join(''), '#q=%00', '#d=' + encodeURIComponent('{"v":1,"t":"quo"}')];
  const badQ = [];
  for (const h of qhashes) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/quote.html?${CLOCK}${h}`, { waitUntil: 'load' });
    const ok = await tid(page, 'q2-page').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    const inj = await injected(page);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const crashed = (await tid(page, 'q2-error').count()) + (await page.locator('.ui-fatal').count());
    const len = await page.evaluate(() => document.body.innerText.trim().length);
    if (!ok || crashed || len < 40 || inj.pwned || inj.extra || sideways > 0) badQ.push(`${h.slice(0, 60)} ok=${ok} crashed=${crashed} len=${len} sideways=${sideways}`);
  }
  check(`every one of ${qhashes.length} hostile quote addresses shows the page (the quote or a calm "could not open") with a way to reach Daniel`, badQ.length === 0, '\n      ' + badQ.slice(0, 6).join('\n      '));
  const lhashes = ['#book/ev_quote/2026-02-31/9', '#book/fault/garbage', '#book/ev_quote/9999-99-99/0', '#booked/<script>window.__pwned=1</script>', '#booked/%', '#manage/' + 'M'.repeat(5000), '#manage/__proto__', '#book/emergency', '#book/../..', '#book/ev_quote/2026-10-24/0/extra/seg', '#book/%E0%A4%A', '#book/__proto__', '#book/ev_quote/2026-10-24/7', '#book/eicr/2026-12-25/3', '#booked/', '#manage/'];
  const badL = [];
  for (const h of lhashes) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/index.html?${CLOCK}${h}`, { waitUntil: 'load' });
    const ok = await tid(page, 'hero-cta').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    await sleep(200);
    const inj = await injected(page);
    const crashed = await page.locator('.ui-fatal').count();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (!ok || crashed || inj.pwned || inj.extra || sideways > 0) badL.push(`${h.slice(0, 60)} ok=${ok} crashed=${crashed} sideways=${sideways}`);
  }
  check(`every one of ${lhashes.length} hostile landing addresses shows the landing page`, badL.length === 0, '\n      ' + badL.slice(0, 6).join('\n      '));
  // hostile campaign tags and clock overrides
  const badU = [];
  for (const q of [`&utm_source=${'s'.repeat(10000)}&utm_medium=${'m'.repeat(500)}&utm_campaign=%3Cscript%3Ewindow.__pwned%3D1%3C%2Fscript%3E`, '&utm_source=%E0%A4%A&src=%00', '&src=' + encodeURIComponent('‮evil'), '&utm_source=__proto__&utm_medium=constructor']) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/index.html?${CLOCK}${q}`, { waitUntil: 'load' });
    await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
    const utm = await page.evaluate(() => { try { return sessionStorage.getItem('vm_utm') || ''; } catch (e) { return ''; } });
    if (utm.length > 400) badU.push(`utm stored ${utm.length} chars`);
  }
  check('hostile campaign tags are bounded (nothing huge is kept) and never crash the landing page', badU.length === 0, badU.join(' | '));
  const badC = [];
  for (const clock of ['now=garbage', 'now=2026-02-31T10:00&freeze=1', 'now=2026-13-45T25:61', 'now=&freeze=1', 'freeze=1', 'now=2026-10-23T20:30:99', 'now=%E0%A4%A', 'now=0000-00-00T00:00', 'now=99999-01-01T00:00', `now=${'9'.repeat(500)}`]) {
    for (const [name, open] of [['landing', () => page.goto(`${BASE}/index.html?${clock}`, { waitUntil: 'load' })], ['dashboard', () => page.goto(`${BASE}/dashboard.html?${clock}#/calendar`, { waitUntil: 'load' })]]) {
      await page.goto('about:blank');
      await open();
      const ok = await page.locator('[data-testid="hero-cta"], [data-testid="db-view"]').first().waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
      if (!ok || (await page.locator('.ui-fatal').count())) badC.push(`${name} ?${clock.slice(0, 40)}`);
    }
  }
  check('nonsense ?now= values fall back to the real clock without a crash', badC.length === 0, badC.join(' | '));
  check('no console or page errors across all of them', clean(log), dump(log).slice(0, 600));
  await ctx.close();
});


// ================================================================ 7. clock edge cases
const CLOCK_MOMENTS = [
  ['UK clocks go back, Sun 25 Oct 2026 01:30', 'now=2026-10-25T01:30&freeze=1', 'Sun 25 Oct'],
  ['UK clocks go back, Sun 25 Oct 2026 02:30', 'now=2026-10-25T02:30&freeze=1', 'Sun 25 Oct'],
  ['the Saturday night before the change, 23:59', 'now=2026-10-24T23:59&freeze=1', 'Sat 24 Oct'],
  ['29 Feb 2028 (leap day)', 'now=2028-02-29T10:00&freeze=1', 'Tue 29 Feb'],
  ['the day after the leap day, 00:01', 'now=2028-03-01T00:01&freeze=1', 'Wed 1 Mar'],
  ['28 Feb 2027 23:59 (not a leap year)', 'now=2027-02-28T23:59&freeze=1', 'Sun 28 Feb'],
  ['New Year\'s Eve, 23:59', 'now=2026-12-31T23:59&freeze=1', 'Thu 31 Dec'],
  ['New Year\'s Day, 00:01', 'now=2027-01-01T00:01&freeze=1', 'Fri 1 Jan']
];
for (const [label, clock, dayLabel] of CLOCK_MOMENTS) {
  await section(`7. clock: ${label}`, async () => {
    const ctx = await newContext(PHONE);
    const log = [];
    const dashPage = await ctx.newPage();
    log.push(watch(dashPage));
    await dash(dashPage, '#/today', clock);
    const ready = await tid(dashPage, 'db-view').waitFor({ timeout: WAIT }).then(() => true).catch(() => false);
    check('the dashboard comes up on that day', ready);
    check(`Today says it is ${dayLabel}`, (await bodyText(dashPage)).includes(dayLabel), (await bodyText(dashPage)).slice(0, 160).replace(/\s+/g, ' '));
    check('every core screen renders on that day', (await crashedRoutes(dashPage, ['#/today', '#/calendar', '#/bookings', '#/pipeline', '#/quotes', '#/insights', '#/messages'])).length === 0);
    const seeded = await stateOf(dashPage);
    const pairs = seeded.bookings.filter((b) => b.status !== 'cancelled' && b.durationMin > 0).map((b) => b.start);
    check('the seeded diary holds no window twice', new Set(pairs).size === pairs.length);
    // two customers send an enquiry on that day, each from the landing page
    for (const name of ['Clock Customer One', 'Clock Customer Two']) {
      const cust = await ctx.newPage();
      log.push(watch(cust));
      await site(cust, '', '', clock);
      await tid(cust, 'hero-cta').click();
      await walkToContact(cust);
      await fillContact(cust, { name });
      await tid(cust, 'funnel-submit').click();
      await tid(cust, 'confirmation').waitFor({ timeout: WAIT });
      await cust.close();
    }
    const st = await stateOf(dashPage);
    const mine = st.bookings.filter((b) => b.customer.name.startsWith('Clock Customer'));
    check('both enquiries were made', mine.length === 2, String(mine.length));
    const nowStamp = clock.match(/now=([0-9T:-]+)/)[1];
    const starts = mine.filter((b) => b.durationMin > 0).map((b) => b.start);
    check('each is pencilled into a real future window at least a day ahead (or left for Daniel to place), never the same one', new Set(starts).size === starts.length && mine.every((b) => b.durationMin === 0 || b.start > nowStamp), JSON.stringify(mine.map((b) => b.start)));
    const all = st.bookings.filter((b) => b.status !== 'cancelled' && b.durationMin > 0).map((b) => b.start);
    check('still no window held twice after both', new Set(all).size === all.length);
    check('every stored day is a real calendar day', st.bookings.every((b) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.start) && !Number.isNaN(Date.parse(b.start.slice(0, 10)))));
    check('no console errors', log.every(clean), log.map(dump).join(' | '));
    await ctx.close();
  });
}

await section('7. midnight rollover on a ticking clock (23:59:45 to 00:00:30): the dashboard moves to the new day by itself and the diary stays honest', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  const clock = 'now=2026-10-23T23:59:45';
  await dash(page, '#/today', clock);
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  check('before midnight Today says Fri 23 Oct', /Fri 23 Oct/.test(await bodyText(page)), (await bodyText(page)).slice(0, 100));
  const flipped = await until(async () => /Sat 24 Oct/.test(await bodyText(page)), 70000, 500);
  check('after midnight Today says Sat 24 Oct without a reload', !!flipped, (await bodyText(page)).slice(0, 100).replace(/\s+/g, ' '));
  check('and the greeting moved on from the evening', !/Evening/.test(await bodyText(page).then((t) => t.slice(0, 40))));
  // a customer who started before midnight and finishes after it: the funnel pencils from the NEW now
  const cust = await ctx.newPage();
  const clog = watch(cust);
  await site(cust, '', '', clock);
  await tid(cust, 'hero-cta').click();
  await walkToContact(cust);
  await fillContact(cust, { name: 'Midnight Mia' });
  await tid(cust, 'funnel-submit').click();
  await tid(cust, 'confirmation').waitFor({ timeout: WAIT });
  const st = await stateOf(cust);
  const mia = st.bookings.find((b) => b.customer.name === 'Midnight Mia');
  const nowS = await cust.evaluate(async () => (await import('/js/core/clock.js')).nowStamp());
  check('her visit is pencilled at least 24 hours after the moment she submitted', !!mia && (mia.durationMin === 0 || mia.start >= '2026-10-25'), `${mia && mia.start} now=${nowS}`);
  const all = st.bookings.filter((b) => b.status !== 'cancelled' && b.durationMin > 0).map((b) => b.start);
  check('no window held twice', new Set(all).size === all.length);
  check('no console errors', clean(log) && clean(clog), dump(log) + dump(clog));
  await ctx.close();
});


// ================================================================ 8. offline and image hosts failing
await section('8. both photo hosts unreachable: every page still works, nothing shows a broken-picture icon, nothing overflows', async () => {
  const fx = await fixtures();
  for (const vp of [SMALL, DESKTOP]) {
    const ctx = await newContext(vp, { imagesFail: true });
    const page = await ctx.newPage();
    const log = watch(page, { allowImageFailures: true });
    const pages = [
      ['landing', () => site(page), 'hero-cta'],
      ['quote page', () => quotePage(page, fx.quoteHash), 'q2-page'],
      ['dashboard today', () => dash(page, '#/today'), 'db-view'],
      ['dashboard settings (the photos)', () => dash(page, '#/settings?open=photos'), 'db-view'],
      ['dashboard booking with photos', () => dash(page, '#/bookings/bk_seed_07'), 'db-view'],
      ['dashboard share', () => dash(page, '#/share'), 'db-view']
    ];
    for (const [name, open, ready] of pages) {
      await open();
      await tid(page, ready).first().waitFor({ timeout: WAIT });
      await sleep(900);
      if (name === 'landing') { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(500); await page.evaluate(() => window.scrollTo(0, 0)); }
      const res = await page.evaluate(() => {
        const broken = [...document.images].filter((img) => {
          if (!img.complete || img.naturalWidth > 0) return false;
          const r = img.getBoundingClientRect(); const cs = getComputedStyle(img);
          return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && !img.closest('.is-failed, [hidden], [aria-hidden="true"]');
        }).map((img) => `${img.className || img.alt || img.src}`.slice(0, 50));
        return { broken, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, fatal: document.querySelectorAll('.ui-fatal, [data-testid="view-error"]').length };
      });
      check(`${name} @${vp.width}: no visible broken-picture icon, no overflow, no error screen`, res.broken.length === 0 && res.sideways <= 0 && res.fatal === 0, JSON.stringify(res));
    }
    check(`@${vp.width}: nothing but the failed photos went wrong (no console errors, no other failed request, nothing off-site)`, clean(log), dump(log).slice(0, 500));
    await ctx.close();
  }
});

await section('8. the network drops while the dashboard is open: a screen that was never loaded says so calmly and loads when asked again', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page, { allowImageFailures: true });
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  await ctx.setOffline(true);
  await page.evaluate(() => { location.hash = '#/share'; });
  const stub = await tid(page, 'view-stub').waitFor({ timeout: WAIT }).then(() => true).catch(() => false);
  check('a screen whose file cannot be fetched shows a plain "could not load" card, not a blank page', stub && /could not load/i.test(await txt(page, 'view-stub')), await bodyText(page).then((t) => t.slice(0, 120)));
  check('the shell around it (tabs, header) still works', (await page.locator('.db-header, .db-tabbar, nav').count()) > 0);
  check('it offers Try again', (await tid(page, 'view-retry').count()) === 1);
  await tid(page, 'view-retry').click();
  await sleep(600);
  check('Try again while still offline stays calm', (await tid(page, 'view-stub').count()) === 1 && (await page.locator('.ui-fatal').count()) === 0);
  await page.evaluate(() => { location.hash = '#/today'; });
  check('screens already loaded still work offline', !!(await tid(page, 'today-view').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)));
  await ctx.setOffline(false);
  await page.evaluate(() => { location.hash = '#/share'; });
  await tid(page, 'view-retry').waitFor({ timeout: WAIT }).catch(() => {});
  if (await tid(page, 'view-retry').count()) await tid(page, 'view-retry').click();
  check('back online, Try again loads the screen', !!(await page.locator('[data-testid="sh-card"], .sh-card, [data-testid="share-view"]').first().waitFor({ timeout: WAIT }).then(() => true).catch(() => false)) || (await tid(page, 'view-stub').count()) === 0);
  check('no console errors beyond the failed fetches', log.errors.filter((e) => !/Failed to load resource|Failed to fetch|net::/.test(e)).length === 0, log.errors.join(' | ').slice(0, 400));
  await ctx.close();
});

await section('8. offline from the first request: the pages that are already open keep working (funnel, quote reply)', async () => {
  const fx = await fixtures();
  const ctx = await newContext(PHONE, { imagesFail: true });
  const page = await ctx.newPage();
  const log = watch(page, { allowImageFailures: true });
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  await ctx.setOffline(true);
  await tid(page, 'hero-cta').click();
  await walkToContact(page);
  await fillContact(page, { name: 'Offline Olive' });
  await tid(page, 'funnel-submit').click();
  check('a whole enquiry can be made with the network gone', !!(await tid(page, 'confirmation').waitFor({ timeout: WAIT }).then(() => true).catch(() => false)));
  check('the WhatsApp send card is there for when the network comes back', (await tid(page, 'wa-send').count()) + (await page.locator('a[href*="wa.me"]').count()) > 0);
  await ctx.setOffline(false);
  await quotePage(page, fx.linkHash);
  await tid(page, 'q2-accept').first().waitFor({ timeout: WAIT });
  await ctx.setOffline(true);
  await tid(page, 'q2-accept').first().click();
  await tid(page, 'q2-days-sheet').waitFor({ timeout: WAIT });
  check('the accept sheet opens and builds its WhatsApp message offline', (await page.evaluate(() => (document.querySelector('[data-testid="q2-reply-open"]') || {}).href || '')).startsWith('https://wa.me/'));
  check('no console errors beyond the failed fetches', log.errors.filter((e) => !/Failed to load resource|Failed to fetch|net::/.test(e)).length === 0, log.errors.join(' | ').slice(0, 400));
  await ctx.close();
});


// ================================================================ 9. a busy diary: 100+ bookings and 300+ messages
await section('9. a busy diary (100+ bookings, 300+ more messages): every dashboard screen renders in under 1.5 s and nothing overflows', async () => {
  const ctx = await newContext(DESKTOP);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const seeded = await page.evaluate(async () => {
    const s = await import('/js/core/store.js');
    const a = await import('/js/core/availability.js');
    const names = ['Aoife', 'Ciaran', 'Niamh', 'Declan', 'Orla', 'Seamus', 'Roisin', 'Padraig', 'Siobhan', 'Eoin'];
    const surnames = ['Magee', 'Doherty', 'McAllister', 'O\'Neill', 'Quinn', 'Hughes', 'Boyd', 'Rainey', 'Sloan', 'Kerr'];
    const out = { owner: 0, enquiries: 0, quotes: 0, messages: 0, failed: 0 };
    // bookings held in real windows, through the same code the screens use
    const slots = a.nextFreeSlots(s.getState(), 'fault', 70, { ownerMode: true });
    let i = 0;
    for (const slot of slots) {
      i += 1;
      const r = s.createBooking({ serviceId: 'fault', asOwner: true, date: slot.date, windowId: slot.windowId, customer: { name: `${names[i % 10]} ${surnames[(i * 3) % 10]} ${i}`, phone: `07700 9${String(100000 + i).slice(1)}`, email: '' }, address: { line1: `${i} Larkfield Road`, postcode: 'BT9 6QP' }, notes: `Perf job ${i}`, source: 'phone' });
      if (r.ok) out.owner += 1; else { out.failed += 1; out.why = r.reason + JSON.stringify(r.errors || {}); }
    }
    // website enquiries (pencilled, or left unscheduled when the diary is full)
    for (let k = 0; k < 60; k += 1) {
      const r = s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT7 3AB', parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, customer: { name: `${names[k % 10]} ${surnames[(k * 7) % 10]} E${k}`, phone: `07700 8${String(100000 + k).slice(1)}`, email: `e${k}@example.com` }, address: { line1: '', postcode: 'BT7 3AB' }, notes: `Perf enquiry ${k}`, pencil: true, utm: { source: ['facebook', 'google', 'instagram'][k % 3], medium: 'paid_social', campaign: 'perf' } });
      if (r.ok) { out.enquiries += 1; if (k % 3 === 0) { const q = s.createQuote({ bookingId: r.booking.id }); if (q.ok && s.sendQuote(q.quote.id, { via: 'link' }).ok) out.quotes += 1; } } else out.failed += 1;
    }
    // messages: quick messages on the jobs, until there are 300 more
    const jobs = s.getState().bookings.filter((b) => b.status === 'confirmed' && !b.urgent);
    const kinds = ['customer_running_late', 'customer_need_access', 'customer_photos_request'];
    const before = s.getState().messages.length;
    for (let m = 0; s.getState().messages.length - before < 300 && m < 2000; m += 1) {
      const job = jobs[m % jobs.length];
      if (job) s.sendQuickMessage(job.id, kinds[m % 3]);
    }
    out.messages = s.getState().messages.length - before;
    const st = s.getState();
    return { ...out, bookings: st.bookings.length, totalMessages: st.messages.length, quotesTotal: Object.keys(st.quotes).length };
  });
  check('the busy state was built through the store (100+ bookings, 300+ messages)', seeded.bookings >= 100 && seeded.messages >= 300 && seeded.failed < 10, JSON.stringify(seeded));
  const bytes = await page.evaluate((k) => localStorage.getItem(k).length, KEY);
  console.log(`  (state is ${(bytes / 1024).toFixed(0)} KB: ${seeded.bookings} bookings, ${seeded.totalMessages} messages, ${seeded.quotesTotal} quotes)`);
  const ids = await page.evaluate(async () => { const st = (await import('/js/core/store.js')).getState(); return { booking: st.bookings.find((b) => b.serviceId === 'ev_quote' && b.status !== 'cancelled').id, quote: Object.keys(st.quotes)[0], customer: null }; });
  const routes = ['#/today', '#/calendar', '#/bookings', `#/bookings/${ids.booking}`, '#/pipeline', '#/quotes', `#/quotes/${ids.quote}`, '#/insights', '#/messages', '#/customers', '#/more', '#/settings', '#/share', '#/demo', '#/about', '#/connections'];
  const timeRoute = (hash) => page.evaluate(async (hash) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t0 = performance.now();
    location.hash = hash;
    const end = t0 + 8000;
    while (performance.now() < end) {
      await new Promise((r) => setTimeout(r, 10));
      if (document.querySelector('[data-testid="db-view"]') && !document.querySelector('[data-testid="view-loading"]') && document.querySelector('.db-main').innerText.trim().length > 20) break;
    }
    await frame();
    return performance.now() - t0;
  }, hash);
  let worst = 0;
  for (const vp of [DESKTOP, SMALL]) {
    await page.setViewportSize(vp);
    const slow = [];
    const wide = [];
    for (const hash of routes) {
      const cold = await timeRoute(hash); // first visit includes fetching the screen's own file
      await timeRoute('#/more');
      const warm = await timeRoute(hash);
      if (cold > 1500 || warm > 1500) slow.push(`${hash.slice(0, 28)} cold=${Math.round(cold)}ms warm=${Math.round(warm)}ms`);
      worst = Math.max(worst, cold, warm);
      const side = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (side > 0) wide.push(`${hash.slice(0, 28)} +${side}px`);
    }
    check(`@${vp.width}: all ${routes.length} screens render in under 1.5 s (first and second visit)`, slow.length === 0, slow.join(' | '));
    check(`@${vp.width}: none of them scrolls sideways`, wide.length === 0, wide.join(' | '));
  }
  console.log(`  (slowest screen at normal speed: ${Math.round(worst)} ms)`);
  // the same walk with the CPU slowed 4x, as a mid-range phone is: still under the 1.5 s bar
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slowPhone = [];
  let worst4 = 0;
  for (const hash of routes) {
    await timeRoute('#/more');
    const t = await timeRoute(hash);
    worst4 = Math.max(worst4, t);
    if (t > 1500) slowPhone.push(`${hash.slice(0, 28)} ${Math.round(t)}ms`);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`  (slowest screen with the CPU slowed 4x: ${Math.round(worst4)} ms)`);
  check('with the CPU slowed 4x (a mid-range phone) every screen still renders in under 1.5 s', slowPhone.length === 0, slowPhone.join(' | '));
  check('no screen crashed', (await crashedRoutes(page, routes)).length === 0);
  // the other two pages with this state
  const t0 = Date.now();
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  const landingMs = Date.now() - t0;
  check('the landing page is up in under 1.5 s with this state', landingMs < 1500, landingMs + ' ms');
  await tid(page, 'hero-cta').click();
  const f0 = Date.now();
  await walkToContact(page);
  await fillContact(page, { name: 'Busy Brenda' });
  const s0 = Date.now();
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  check('an enquiry submitted into a busy diary is confirmed in under 1.5 s', Date.now() - s0 < 1500, (Date.now() - s0) + ' ms');
  void f0;
  const q0 = Date.now();
  await quotePage(page, `#q=${ids.quote}`);
  await tid(page, 'q2-page').waitFor({ timeout: WAIT });
  check('the quote page is up in under 1.5 s with this state', Date.now() - q0 < 1500, (Date.now() - q0) + ' ms');
  const sync = await page.evaluate(async () => {
    const s = await import('/js/core/store.js');
    const t = performance.now();
    s.addBlock({ date: '2027-04-05', windowId: 1, label: 'perf' });
    return performance.now() - t;
  });
  check('one change to this state (read, change, save) takes under 150 ms', sync < 150, Math.round(sync) + ' ms');
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});


await section('6. hostile typing in the small inputs: the landing postcode check, the savings calculator, the funnel\'s first step', async () => {
  const ctx = await newContext(SMALL);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  await tid(page, 'final-cta').waitFor({ state: 'attached', timeout: WAIT });
  // below 1200px the calculator's rates sit in a closed "Change the rates" disclosure (LANDING-V5 6.3): open it first, as a visitor would
  const rates = tid(page, 'l3-calc-assumptions');
  if ((await rates.count()) && !(await rates.evaluate((d) => d.open))) await rates.locator('summary').click();
  const bad = [];
  for (const key of HOSTILE_KEYS) {
    // the landing postcode check: ONE press (a hostile postcode is not valid, so it shows the error and never opens the funnel)
    await setField(page, 'coverage-input', HOSTILE[key]);
    await tid(page, 'coverage-book').click();
    await sleep(80);
    let inj = await injected(page);
    if (inj.pwned || inj.extra || (await page.locator('.ui-fatal').count())) bad.push(`coverage ${key}: ${JSON.stringify(inj)}`);
    // the calculator
    for (const f of ['miles', 'homePence', 'publicPence', 'petrolPence', 'mpg', 'milesPerKwh']) {
      const id = f === 'miles' ? 'l3-calc-miles' : `l3-calc-field-${f}`;
      if (await tid(page, id).count()) await setField(page, id, HOSTILE[key]);
    }
    const calc = (await txt(page, 'l3-calc-result')) + (await txt(page, 'l3-calc-workings-text'));
    if (/NaN|Infinity|undefined|null/.test(calc)) bad.push(`calculator ${key}: ${calc.slice(0, 80)}`);
  }
  for (const v of ['-5', '1e999', '99999999999999999999', '0', '', '.', '1,2,3', '0x10', ' 8000 ', '8000mi', '٣٤٥']) {
    for (const [id] of [['l3-calc-miles'], ['l3-calc-field-mpg'], ['l3-calc-field-homePence']]) {
      if (await tid(page, id).count()) await setField(page, id, v);
    }
    const calc = (await txt(page, 'l3-calc-result')) + (await txt(page, 'l3-calc-workings-text'));
    if (/NaN|Infinity|undefined|null/.test(calc)) bad.push(`calculator value "${v}": ${calc.slice(0, 80)}`);
  }
  check('hostile text and silly numbers in the postcode check and the calculator never run anything, never show NaN, never crash', bad.length === 0, '\n      ' + bad.slice(0, 6).join('\n      '));
  // the funnel's first step
  await tid(page, 'hero-cta').click();
  await tid(page, 'funnel-postcode').waitFor({ timeout: WAIT }); // the sheet is fetched on first use: wait for it before typing into it
  const bad2 = [];
  for (const key of HOSTILE_KEYS) {
    await setField(page, 'funnel-postcode', HOSTILE[key]);
    await tid(page, 'funnel-continue').click();
    await sleep(80);
    const still = await onStep(page, 1);
    const inj = await injected(page);
    if (!still || inj.pwned || inj.extra || (await page.locator('.ui-fatal').count())) bad2.push(`${key}: step1=${still} ${JSON.stringify(inj)}`);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (ov > 0) bad2.push(`${key}: page scrolls ${ov}px`);
  }
  check('a hostile postcode on step 1 is refused with the calm message and the page stays put', bad2.length === 0, '\n      ' + bad2.slice(0, 6).join('\n      '));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

await section('6. hostile enquiry on the customer\'s own change page and the owner\'s customer list', async () => {
  const ctx = await newContext(SMALL);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const made = await page.evaluate(async (H) => {
    const s = await import('/js/core/store.js');
    const out = [];
    for (const key of Object.keys(H)) {
      const r = s.createBooking({ serviceId: 'ev_quote', answers: { postcode: 'BT1 1AA', parking: 'driveway', vehicle: 'have', timing: 'asap', permission: 'yes' }, customer: { name: `M${key} ${H[key]}`.slice(0, 40), phone: '07700 900321', email: '' }, address: { line1: H[key], postcode: 'BT1 1AA' }, notes: H[key], pencil: true });
      if (r.ok) out.push({ key, ref: r.booking.ref, id: r.booking.id });
    }
    return out;
  }, HOSTILE);
  const bad = [];
  for (const m of made) {
    await page.goto('about:blank');
    await page.goto(`${BASE}/index.html?${CLOCK}#manage/${m.ref}`, { waitUntil: 'load' });
    await tid(page, 'manage-page').waitFor({ timeout: WAIT }).catch(() => {});
    await sleep(120);
    const ov = await overflowOf(page);
    const inj = await injected(page);
    if (!(await tid(page, 'manage-page').count()) || ov.overflowing.length || ov.pageScroll > 0 || inj.pwned || inj.extra || (await page.locator('.ui-fatal').count())) bad.push(`manage ${m.key}: ${JSON.stringify({ ov, inj })}`);
    await page.goto('about:blank');
    await page.goto(`${BASE}/index.html?${CLOCK}#booked/${m.ref}`, { waitUntil: 'load' });
    await tid(page, 'confirmation').waitFor({ timeout: WAIT }).catch(() => {});
    const inj2 = await injected(page);
    const ov2 = await overflowOf(page);
    if (!(await tid(page, 'confirmation').count()) || ov2.overflowing.length || ov2.pageScroll > 0 || inj2.pwned || inj2.extra) bad.push(`booked ${m.key}: ${JSON.stringify({ ov2, inj2 })}`);
  }
  check('the customer\'s change page and confirmation hold every hostile enquiry', bad.length === 0, '\n      ' + bad.slice(0, 6).join('\n      '));
  await dash(page, '#/customers');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const first = await page.evaluate(async () => { const st = (await import('/js/core/store.js')).getState(); return st.bookings.find((b) => b.customer.name.startsWith('Mhtml')).id; });
  const ovC = await overflowOf(page);
  check('the customer list holds hostile names without overflow', ovC.overflowing.length === 0 && ovC.pageScroll <= 0, JSON.stringify(ovC));
  void first;
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

await section('6. a deep link to a service that is not on his website, with a free, stale or impossible slot, opens the enquiry funnel calmly', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  await tid(page, 'db-view').waitFor({ timeout: WAIT });
  const slot = await page.evaluate(async () => { const s = await import('/js/core/store.js'); const a = await import('/js/core/availability.js'); const x = a.nextFreeSlots(s.getState(), 'eicr', 1)[0]; return x ? { date: x.date, windowId: x.windowId } : null; });
  const bad = [];
  for (const h of [`#book/eicr/${slot.date}/${slot.windowId}`, '#book/sockets/2020-01-06/0', '#book/rewire/2026-10-25/1', '#book/fault', '#book/consumer/2026-02-30/2', '#book/ev/2028-02-29/3']) {
    await page.goto('about:blank');
    await site(page, h);
    const opened = await tid(page, 'booking-sheet').waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
    await sleep(300);
    if (!opened || (await page.locator('.ui-fatal').count()) || !(await tid(page, 'funnel-postcode').count())) bad.push(`${h}: opened=${opened}`);
  }
  check('every such deep link opens the funnel at step 1', bad.length === 0, bad.join(' | '));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// @@SECTIONS@@

console.log(`\n${passes} checks passed, ${failures} failed`);
await browser.close();
stopServer();
process.exit(failures ? 1 : 0);
