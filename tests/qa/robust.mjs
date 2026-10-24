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
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + String(extra).slice(0, 600) + ']' : '')); }
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
  page.on('requestfailed', (r) => { const u = r.url(); if (isPhoto404(u)) return; if (allowImageFailures && [...IMG_HOSTS].some((h) => u.includes(h))) return; log.failed.push(u); });
  page.on('response', (r) => { if (r.status() >= 400 && !isPhoto404(r.url())) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}
const clean = (log) => log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0;
const dump = (log) => [...log.errors, ...log.offsite, ...log.failed].join(' | ');
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const txt = async (page, id) => (await tid(page, id).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const site = (page, hash = '', query = '', clock = CLOCK) => page.goto(`${BASE}/index.html?${clock}${query}${hash}`, { waitUntil: 'load' });
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
    return {
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
  const url = pop.url();
  await pop.close().catch(() => {});
  return url;
}
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
    await quotePage(page, fx.quoteHash);
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

// @@SECTIONS@@

console.log(`\n${passes} checks passed, ${failures} failed`);
await browser.close();
stopServer();
process.exit(failures ? 1 : 0);
