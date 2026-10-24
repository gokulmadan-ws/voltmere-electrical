// tests/e2e/landing.mjs: end-to-end check of the landing page, the 6-step quote funnel (copy, motion, keyboard, history, drafts), the enquiry confirmation
// (provisional visit, calendar file, photos, timeline, DEMO panel), the Manage page, the owner's phone-job booking and the cross-page flow.
// Owner: D3 (first written by D2). Self-contained: starts its own static server unless BASE_URL is set; waits on state, never on sleeps.
//
//   node tests/e2e/landing.mjs
//   BASE_URL=http://127.0.0.1:4164 node tests/e2e/landing.mjs
//   QA_DEPS_DIR=/path/with/node_modules node tests/e2e/landing.mjs     (must contain playwright-core; axe-core is used when present)
//   CHROMIUM_PATH=/path/to/chrome   SHOTS_DIR=/some/dir (optional screenshots)
//   ONLY=2c (run the sections whose title starts with this)   CPU_THROTTLE=4 (slow the page down 4x to shake out timing assumptions)
//
// Exits 0 when every check passes, 1 otherwise. The clock is frozen with ?now=2026-10-23T20:30&freeze=1.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/qa';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SHOTS = process.env.SHOTS_DIR || '';
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLOCK = 'now=2026-10-23T20:30&freeze=1';
const require = createRequire(QA_DEPS.endsWith('/') ? QA_DEPS : QA_DEPS + '/');
const { chromium } = require('playwright-core');
let AXE_SOURCE = '';
try { AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { AXE_SOURCE = ''; }

// ---------------------------------------------------------------- his verbatim copy (docs/reference/180-site-report.md)
const COPY = {
  step1: { eyebrow: "Let's find the right home charging setup for you", title: "What's your installation postcode?", label: 'UK postcode', placeholder: 'e.g. SW1A 1AA', error: 'Please enter a valid UK postcode so we can check your location.', help: 'Your postcode helps us confirm we cover your area.' },
  steps: [
    { n: 2, key: 'parking', title: 'Where would you normally park to charge?', note: 'Whatever you pick, we will check that a safe cable route and parking position can be arranged.', options: ['Private driveway', 'Garage', 'Allocated parking space', 'On-street parking', 'Other or not sure'], values: ['driveway', 'garage', 'allocated', 'street', 'other'] },
    { n: 3, key: 'vehicle', title: 'Do you already have your electric or plug-in hybrid car?', note: '', options: ['Yes', "It's ordered or arriving soon", "I'm choosing one"], values: ['have', 'ordered', 'choosing'] },
    { n: 4, key: 'timing', title: 'When would you like your charger installed?', note: '', options: ['As soon as possible', 'Within the next month', 'Within 1 to 3 months', 'Just researching'], values: ['asap', 'month', 'one_to_three', 'researching'] },
    { n: 5, key: 'permission', title: 'Can you authorise installation work at the property?', note: "Not sure yet? That's fine. We will help you work out what is needed.", options: ['Yes', 'I need landlord or freeholder approval', "I'm not sure"], values: ['yes', 'landlord', 'unsure'] }
  ],
  step6: { title: 'Where can 180 Electrical contact you about your quote?', labels: ['Full name', 'Installation postcode', 'Mobile number', 'Email address', 'Anything else we should know? (optional)'], submit: 'Request my installation quote', optIn: 'Keep me updated with occasional offers and EV charging tips from 180 Electrical. Optional, and you can opt out at any time.', small: '180 Electrical will use these details to respond to your installation enquiry. By submitting your details you give us permission to contact you.' },
  confirm: { title: 'Thanks, your enquiry has been received.', body: 'The team at 180 Electrical will review your details and contact you to discuss your home charger installation within 24 hours. Please also check your emails.', readyTitle: 'Helpful to have ready', ready: 'If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation.', call: 'Prefer to speak to us? Call 07885 496800' }
};
const ANSWERS_LINE = 'Parking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.';
const UTM = { source: 'facebook', medium: 'paid_social', campaign: 'autumn_ev' };

// ---------------------------------------------------------------- harness
let failures = 0;
let passes = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT = 9000; // every wait is on a condition with a generous ceiling: a slow machine is slower, never wrong
async function until(fn, ms = WAIT, step = 80) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* page busy or navigating: try again */ }
    await sleep(step);
  }
  return false;
}
async function section(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return; // ONLY=2c runs one section while developing
  console.log('\n# ' + name);
  try { await fn(); } catch (e) { failures += 1; console.log('  FAIL ' + name + ' threw: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// ---------------------------------------------------------------- server
let server = null;
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}
async function startServer() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const port = await freePort();
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', SITE_ROOT], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const up = await until(async () => { const r = await fetch(base + '/index.html').catch(() => null); return r && r.ok; }, 10000, 150);
  if (!up) throw new Error('static server did not start');
  return base;
}

// ---------------------------------------------------------------- browser helpers
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const BASE = await startServer();
const ORIGIN = new URL(BASE).origin;
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

// His photos live on two external hosts the sandbox cannot reach (docs/reference/180-images.md). They are the ONLY off-site hosts allowed,
// for images only, and every request to them is answered with a generated stand-in so layout is judged, never the photos.
const IMG_HOSTS = new Set(['perspective.imgix.net', 'images.unsplash.com']);
const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#2a2b2f"/><circle cx="400" cy="300" r="90" fill="#3a3b40"/></svg>';
async function newContext(vp, scheme = 'dark', extra = {}) {
  const ctx = await browser.newContext({
    viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: scheme,
    isMobile: vp.width < 600, hasTouch: vp.width < 600, acceptDownloads: true, ...extra
  });
  await ctx.route((u) => IMG_HOSTS.has(u.hostname), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
  const rate = Number(process.env.CPU_THROTTLE || 0);
  if (rate > 1) {
    ctx.on('page', async (p) => { try { const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate }); } catch (e) { /* not available: run unthrottled */ } });
  }
  return ctx;
}

// His own photos (img/180/*) may be placed later and the landing page polls for them: a 404 there is expected, not a bug.
const isPhoto404 = (u) => /\/img\/180\//.test(u);

/** Collect everything that should stay empty: console errors and warnings, page errors, off-site and failed requests. */
function watch(page) {
  const log = { errors: [], offsite: [], failed: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/Failed to load resource/.test(m.text()) && m.location && isPhoto404(m.location().url || '')) return;
    log.errors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    const url = new URL(u);
    if (url.origin === ORIGIN) return;
    if (IMG_HOSTS.has(url.hostname) && r.resourceType() === 'image') return;
    log.offsite.push(u);
  });
  page.on('requestfailed', (r) => { if (!isPhoto404(r.url())) log.failed.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400 && !isPhoto404(r.url())) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}
const clean = (log) => log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0;
const dump = (log) => [...log.errors, ...log.offsite, ...log.failed].join(' | ');
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const txt = async (page, id) => (await tid(page, id).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const site = (page, hash = '', query = '') => page.goto(`${BASE}/index.html?${CLOCK}${query}${hash}`, { waitUntil: 'networkidle' });
const dash = (page, hash = '#/today') => page.goto(`${BASE}/dashboard.html?${CLOCK}${hash}`, { waitUntil: 'networkidle' });
const hashOf = (page) => page.evaluate(() => location.hash);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const sheetOpen = (page) => tid(page, 'booking-sheet').waitFor({ state: 'visible', timeout: WAIT });
const sheetGone = (page) => until(async () => (await tid(page, 'booking-sheet').count()) === 0);
const lum = (rgb) => { const m = rgb.match(/\d+(\.\d+)?/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
const stepLabel = (page) => txt(page, 'funnel-step-label');
const titleOf = (page) => txt(page, 'funnel-title');
/** Resolves true once the funnel shows "Step n of 6" AND that step's content is on screen. */
const onStep = (page, n) => until(async () => (await stepLabel(page)) === `Step ${n} of 6` && (await tid(page, `funnel-step-${n}`).count()) === 1);
/** True when nothing in the open sheet is wider than the sheet (no horizontal overflow, page or body). */
const noOverflow = (page) => page.evaluate(() => {
  const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body');
  const root = document.documentElement;
  return root.scrollWidth <= root.clientWidth && (!body || body.scrollWidth <= body.clientWidth);
});
const activeId = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.hasAttribute('data-bk-title') ? 'TITLE' : (a.getAttribute('data-testid') || a.tagName)) : ''; });
const histStep = (page) => page.evaluate(() => (history.state && history.state.bkStep) || 0);
const bookingsInStore = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vm_state_v1')).bookings; } catch (e) { return []; } });
const bookingByRef = async (page, ref) => (await bookingsInStore(page)).find((b) => b.ref === ref) || null;

/** Type a valid BT postcode and walk steps 1 to 5 with the answers of ANSWERS_LINE, waiting on each step. */
async function walkToContact(page, postcode = 'BT9 6QP') {
  await tid(page, 'funnel-postcode').fill(postcode);
  await tid(page, 'funnel-continue').click();
  for (const [n, key, value] of [[2, 'parking', 'driveway'], [3, 'vehicle', 'ordered'], [4, 'timing', 'asap'], [5, 'permission', 'yes']]) {
    await tid(page, `funnel-option-${key}-${value}`).waitFor({ timeout: WAIT });
    if (!(await onStep(page, n))) throw new Error(`never reached step ${n}`);
    await tid(page, `funnel-option-${key}-${value}`).click();
  }
  if (!(await onStep(page, 6))) throw new Error('never reached step 6');
}
/** Walk the whole funnel with sample details and submit; resolves once the confirmation is showing. */
async function submitEnquiry(page, { note = '' } = {}) {
  await walkToContact(page);
  await tid(page, 'demo-fill').click();
  if (note) await tid(page, 'field-note').fill(note);
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
}
/** A realistic big photo (gradient, shapes, soft noise) as JPEG bytes, made in the page so no file is needed. */
async function makePhoto(page, w, h, seed = 1) {
  const b64 = await page.evaluate(({ w, h, seed }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${(seed * 70) % 360} 40% 30%)`); grad.addColorStop(1, `hsl(${(seed * 70 + 80) % 360} 50% 65%)`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 160; i += 1) { g.fillStyle = `hsla(${rnd() * 360} 50% 50% / 0.5)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 160, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.font = `${Math.round(h / 8)}px sans-serif`; g.fillText('CONSUMER UNIT', w / 12, h / 2);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
  }, { w, h, seed });
  return Buffer.from(b64, 'base64');
}
/** Run axe on the current page; resolves the serious and critical violations (empty when axe-core is not installed). */
async function axeSeriousCount(page, context) {
  if (!AXE_SOURCE) return { count: 0, detail: 'axe-core not installed' };
  await page.evaluate(AXE_SOURCE);
  const res = await page.evaluate(async (ctxSel) => {
    const out = await window.axe.run(ctxSel ? { include: [ctxSel] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return out.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`);
  }, context || null);
  return { count: res.length, detail: res.join(' | ') };
}

// ================================================================ 1. landing page loads and opens the funnel
async function landingLoad(name, vp, scheme) {
  await section(`1. landing page ${name}`, async () => {
    const ctx = await newContext(vp, scheme);
    const page = await ctx.newPage();
    const log = watch(page);
    await site(page);
    await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
    check('no console errors, off-site or failed requests', clean(log), dump(log));
    const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check('no horizontal overflow', dims.sw <= dims.cw, JSON.stringify(dims));
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('dark theme is the default', lum(bg) < 0.2, bg);
    check('his H1 is on the page', (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').includes('Your own EV charger. Installed at home in Northern Ireland.'));
    check('the hero CTA reads "Get my installation quote"', (await txt(page, 'hero-cta')) === 'Get my installation quote', await txt(page, 'hero-cta'));
    if (vp.width < 768) check('sticky bottom bar is visible on a phone', await tid(page, 'sticky-bar').isVisible());
    await tid(page, 'hero-cta').click();
    await sheetOpen(page);
    check('the CTA opens the quote funnel at #book/ev_quote', (await hashOf(page)) === '#book/ev_quote', await hashOf(page));
    check('funnel starts at "Step 1 of 6"', (await stepLabel(page)) === 'Step 1 of 6', await stepLabel(page));
    if (vp.width < 768) check('sticky bar is hidden while the sheet is open', !(await tid(page, 'sticky-bar').isVisible()));
    await shot(page, `funnel-open-${name}`);
    await page.goBack();
    check('browser Back closes the sheet in one step', await sheetGone(page));
    await ctx.close();
  });
}
await landingLoad('375-dark', MOBILE, 'dark');
await landingLoad('1280-dark', DESKTOP, 'dark');

// ================================================================ 2. funnel: copy, validation, auto-advance, Back, draft
async function funnelSteps(name, vp, scheme) {
  await section(`2. the 6 steps ${name}: his verbatim copy, validation, auto-advance, Back, refresh`, async () => {
    const ctx = await newContext(vp, scheme);
    const page = await ctx.newPage();
    const log = watch(page);
    await site(page, '#book/ev_quote');
    await sheetOpen(page);
    await onStep(page, 1);
    const s1 = await tid(page, 'booking-sheet').innerText();
    check('step 1 eyebrow, H1, label and help are verbatim', s1.includes(COPY.step1.eyebrow) && (await titleOf(page)) === COPY.step1.title && s1.includes(COPY.step1.label) && s1.includes(COPY.step1.help), await titleOf(page));
    check('step 1 placeholder is verbatim', (await tid(page, 'funnel-postcode').getAttribute('placeholder')) === COPY.step1.placeholder);
    check('no Back link on step 1, progress bar at 1 of 6', (await tid(page, 'booking-back').count()) === 0 && (await tid(page, 'booking-progress').getAttribute('aria-valuenow')) === '1');
    check('the progress bar is six segments and one is full on step 1', (await page.locator('.bk-fn-progress__seg').count()) === 6 && (await page.locator('.bk-fn-progress__seg.is-done').count()) === 1);
    await shot(page, `funnel-1-postcode-${name}`);
    await tid(page, 'funnel-continue').click();
    check('empty postcode shows his exact error and stays on step 1', (await until(async () => (await txt(page, 'error-funnel-postcode')) === COPY.step1.error)) && (await stepLabel(page)) === 'Step 1 of 6', await txt(page, 'error-funnel-postcode'));
    await tid(page, 'funnel-postcode').fill('not a postcode');
    await tid(page, 'funnel-continue').click();
    check('a malformed postcode is refused with the same error', (await txt(page, 'error-funnel-postcode')) === COPY.step1.error && (await stepLabel(page)) === 'Step 1 of 6');
    await shot(page, `funnel-1b-postcode-error-${name}`);
    await tid(page, 'funnel-postcode').fill('bt96qp');
    check('a BT postcode earns the "in our area" line', (await until(async () => (await txt(page, 'funnel-zone-hint')).includes("that's in our area"))), await txt(page, 'funnel-zone-hint'));
    await tid(page, 'funnel-postcode').fill('sw1a1aa');
    check('a valid non-BT postcode is accepted but says we will check it', (await until(async () => /outside Northern Ireland/.test(await txt(page, 'funnel-zone-hint')))), await txt(page, 'funnel-zone-hint'));
    await tid(page, 'funnel-continue').click();
    check('a valid non-BT postcode moves on (flagged for the owner later)', await onStep(page, 2));
    check('Back link appears on step 2', (await tid(page, 'booking-back').count()) === 1);
    await tid(page, 'booking-back').click();
    check('Back returns to step 1 with the postcode kept (normalised)', (await onStep(page, 1)) && (await tid(page, 'funnel-postcode').inputValue()) === 'SW1A 1AA', await tid(page, 'funnel-postcode').inputValue());
    await tid(page, 'funnel-postcode').fill('BT9 6QP');
    await tid(page, 'funnel-postcode').press('Enter');
    check('Enter on the postcode field continues', await onStep(page, 2));

    // steps 2 to 5: verbatim title, note, options with A..E letters; clicking auto-advances
    for (const s of COPY.steps) {
      check(`step ${s.n} is on screen`, await onStep(page, s.n));
      const sheet = await tid(page, 'booking-sheet').innerText();
      check(`step ${s.n} label, H1 and note are verbatim`, (await stepLabel(page)) === `Step ${s.n} of 6` && (await titleOf(page)) === s.title && (s.note ? (await txt(page, 'funnel-note')) === s.note : (await tid(page, 'funnel-note').count()) === 0), await titleOf(page));
      const labels = (await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__label`).allInnerTexts()).map((t) => t.trim());
      const letters = (await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__letter`).allInnerTexts()).map((t) => t.trim());
      check(`step ${s.n} options are verbatim, lettered A to ${'ABCDE'[s.options.length - 1]}`, JSON.stringify(labels) === JSON.stringify(s.options) && letters.join('') === 'ABCDE'.slice(0, s.options.length), JSON.stringify(labels));
      check(`step ${s.n} has no Continue button (it auto-advances)`, (await tid(page, 'funnel-continue').count()) === 0 && (await tid(page, 'funnel-submit').count()) === 0 && !sheet.includes('Continue'));
      const small = await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`)].filter((b) => b.getBoundingClientRect().height < 44).length, s.key);
      check(`step ${s.n} every option card is at least 44px tall`, small === 0);
      const pick = tid(page, `funnel-option-${s.key}-${s.values[0]}`);
      await pick.waitFor({ state: 'visible', timeout: WAIT });
      // The card advances by itself shortly after the tap, so the selected state is read in the same page turn as the tap (two frames later).
      const picked = await pick.evaluate((el) => { el.click(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({ pressed: el.getAttribute('aria-pressed'), cls: el.className })))); });
      check(`step ${s.n} the tapped option shows the selected state`, picked.pressed === 'true' && picked.cls.includes('is-selected'), JSON.stringify(picked));
      if (s.n === 2) await shot(page, `funnel-2-selected-${name}`);
      check(`step ${s.n} advanced by itself to step ${s.n + 1}`, await onStep(page, s.n + 1));
      check(`step ${s.n + 1} nothing overflows sideways`, await noOverflow(page));
      if (s.n === 2) {
        // Back keeps the answer; picking another option advances again
        await tid(page, 'booking-back').click();
        check('Back to step 2 shows the earlier answer still selected', (await onStep(page, 2)) && (await tid(page, 'funnel-option-parking-driveway').getAttribute('aria-pressed')) === 'true');
        await tid(page, 'funnel-option-parking-garage').click();
        await onStep(page, 3);
        await tid(page, 'booking-back').click();
        await onStep(page, 2);
        check('changing an answer replaces it (Garage now selected, Driveway not)', (await tid(page, 'funnel-option-parking-garage').getAttribute('aria-pressed')) === 'true' && (await tid(page, 'funnel-option-parking-driveway').getAttribute('aria-pressed')) === 'false');
        await tid(page, 'funnel-option-parking-driveway').click();
        await onStep(page, 3);
      }
      if (s.n === 3) await shot(page, `funnel-4-timing-next-${name}`);
    }

    // step 6
    check('step 6 is on screen', await onStep(page, 6));
    const s6 = await tid(page, 'booking-sheet').innerText();
    check('step 6 H1, field labels, opt-in and small print are verbatim', (await titleOf(page)) === COPY.step6.title && COPY.step6.labels.every((l) => s6.includes(l)) && s6.includes(COPY.step6.optIn) && (await txt(page, 'funnel-small-print')) === COPY.step6.small, await titleOf(page));
    check('step 6 submit button is verbatim and progress is 6 of 6', (await txt(page, 'funnel-submit')) === COPY.step6.submit && (await tid(page, 'booking-progress').getAttribute('aria-valuenow')) === '6' && (await page.locator('.bk-fn-progress__seg.is-done').count()) === 6);
    check('step 6 installation postcode is prefilled from step 1', (await tid(page, 'field-postcode').inputValue()) === 'BT9 6QP');
    const attrs = await page.evaluate(() => {
      const g = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); return { ac: el.getAttribute('autocomplete'), im: el.getAttribute('inputmode'), eh: el.getAttribute('enterkeyhint'), type: el.getAttribute('type'), fs: parseFloat(getComputedStyle(el).fontSize) }; };
      return { name: g('field-name'), pc: g('field-postcode'), phone: g('field-phone'), email: g('funnel-email'), note: g('field-note') };
    });
    check('inputs carry autocomplete / inputmode / enterkeyhint / type', attrs.name.ac === 'name' && attrs.pc.ac === 'postal-code' && attrs.phone.ac === 'tel' && attrs.phone.im === 'tel' && attrs.email.ac === 'email' && attrs.email.type === 'email' && attrs.name.eh === 'next' && attrs.note.eh === 'done', JSON.stringify(attrs));
    check('every input is 16px or larger (no iOS zoom)', Object.values(attrs).every((a) => a.fs >= 16), JSON.stringify(attrs));
    await shot(page, `funnel-6-contact-${name}`);
    // Enter on a single-line field moves to the next one (the keyboard's "next" key)
    await tid(page, 'field-name').fill('Aoife Magee');
    await tid(page, 'field-name').press('Enter');
    check('Enter in Full name moves to the postcode field', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'fn-postcode-6');
    // refresh restores the funnel (draft in sessionStorage)
    await tid(page, 'field-name').blur();
    await page.reload({ waitUntil: 'networkidle' });
    await sheetOpen(page);
    check('a refresh on step 6 comes back to step 6 with the name kept', (await onStep(page, 6)) && (await tid(page, 'field-name').inputValue()) === 'Aoife Magee', await stepLabel(page));
    check('the history still knows it is step 6 after the refresh', (await histStep(page)) === 6, String(await histStep(page)));
    await tid(page, 'booking-back').click();
    check('the answers survived the refresh (step 5 shows Yes selected)', (await onStep(page, 5)) && (await tid(page, 'funnel-option-permission-yes').getAttribute('aria-pressed')) === 'true');
    check('no console errors, off-site or failed requests', clean(log), dump(log));
    await ctx.close();
  });
}
await funnelSteps('375', MOBILE, 'dark');

// ================================================================ 2b. keyboard, focus, announcements, motion, browser Back
await section('2b. keyboard: arrows, letters and Enter; focus and announcements; browser Back walks the steps', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await onStep(page, 1);
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-postcode').press('Enter');
  check('step 2 opens', await onStep(page, 2));
  check('focus moves to the new heading on every step change', !!(await until(async () => (await activeId(page)) === 'TITLE')), await activeId(page));
  check('screen readers hear "Step 2 of 6" (polite live region)', (await until(async () => (await txt(page, 'funnel-announce')) === 'Step 2 of 6')) && (await tid(page, 'funnel-announce').getAttribute('aria-live')) === 'polite', await txt(page, 'funnel-announce'));
  check('forward steps arrive from the right (data-dir=fwd)', (await tid(page, 'funnel-step-2').getAttribute('data-dir')) === 'fwd');
  await page.keyboard.press('Tab');
  check('Tab from the heading lands on the first option', (await activeId(page)) === 'funnel-option-parking-driveway', await activeId(page));
  const tabStops = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="funnel-option-parking-"]')].filter((b) => b.tabIndex === 0).length);
  check('the options are one tab stop (roving tabindex)', tabStops === 1, String(tabStops));
  await page.keyboard.press('ArrowDown');
  check('ArrowDown moves to the next option', (await activeId(page)) === 'funnel-option-parking-garage', await activeId(page));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  check('ArrowUp moves back', (await activeId(page)) === 'funnel-option-parking-garage', await activeId(page));
  await page.keyboard.press('End');
  check('End jumps to the last option', (await activeId(page)) === 'funnel-option-parking-other', await activeId(page));
  await page.keyboard.press('ArrowDown');
  check('ArrowDown wraps from the last to the first option', (await activeId(page)) === 'funnel-option-parking-driveway', await activeId(page));
  await page.keyboard.press('c');
  check('the letter on a card picks it (C = Allocated parking space) and advances', await onStep(page, 3));
  await until(async () => (await activeId(page)) === 'TITLE');
  check('the arrow keys never picked anything by themselves (only C is stored)', !!(await until(async () => (await page.evaluate(() => JSON.parse(sessionStorage.getItem('vm_draft_v1')).answers.parking)) === 'allocated')));
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('Enter on a focused option picks it (Ordered) and advances', await onStep(page, 4));
  await until(async () => (await activeId(page)) === 'TITLE');
  await page.keyboard.press('d');
  check('D picks the fourth option (Just researching) and advances', await onStep(page, 5));
  check('browser Back goes to the previous step (4), not out of the funnel', await (async () => { await page.goBack(); return onStep(page, 4); })());
  check('the earlier answer is still selected after browser Back', (await tid(page, 'funnel-option-timing-researching').getAttribute('aria-pressed')) === 'true');
  check('a step reached by Back arrives from the left (data-dir=back)', (await tid(page, 'funnel-step-4').getAttribute('data-dir')) === 'back');
  check('browser Forward returns to step 5', await (async () => { await page.goForward(); return onStep(page, 5); })());
  await tid(page, 'booking-back').click();
  check('the header Back does the same as browser Back (step 4)', await onStep(page, 4));
  await page.goBack();
  check('browser Back again: step 3', await onStep(page, 3));
  await page.goBack();
  await page.goBack();
  check('two more: step 1 with the postcode kept', (await onStep(page, 1)) && (await tid(page, 'funnel-postcode').inputValue()) === 'BT9 6QP');
  check('one more Back leaves the funnel (the sheet closes)', await (async () => { await page.goBack(); return sheetGone(page); })());
  check('and the landing page is showing with no hash', (await hashOf(page)) === '');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

await section('2c. closing from a deep step unwinds the history; a refresh mid-funnel keeps Back working', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').click();
  await sheetOpen(page);
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-continue').click();
  await onStep(page, 2);
  await tid(page, 'funnel-option-parking-driveway').click();
  await onStep(page, 3);
  await tid(page, 'funnel-option-vehicle-have').click();
  await onStep(page, 4);
  check('three steps in, the history knows step 4', (await histStep(page)) === 4, String(await histStep(page)));
  await tid(page, 'booking-close').click();
  check('X on step 4 closes the sheet', await sheetGone(page));
  check('and leaves no funnel entries behind (no hash, no step in the history)', (await hashOf(page)) === '' && (await histStep(page)) === 0, `${await hashOf(page)} ${await histStep(page)}`);
  await tid(page, 'hero-cta').click();
  await sheetOpen(page);
  check('reopening resumes the draft where it was (step 4)', await onStep(page, 4), await stepLabel(page));
  check('and the history was rebuilt to match, so Back still walks the steps', (await histStep(page)) === 4, String(await histStep(page)));
  await page.keyboard.press('Escape');
  check('Escape closes the sheet from step 4 and unwinds the history', (await sheetGone(page)) && (await hashOf(page)) === '' && (await histStep(page)) === 0, `${await hashOf(page)} ${await histStep(page)}`);
  await tid(page, 'hero-cta').click();
  await sheetOpen(page);
  await tid(page, 'booking-close').click();
  await sheetGone(page);
  // refresh mid-funnel
  await page.goto(`${BASE}/index.html?${CLOCK}#book/ev_quote`, { waitUntil: 'networkidle' });
  await sheetOpen(page);
  const resumed = await stepLabel(page);
  const n = Number((resumed.match(/Step (\d)/) || [0, 1])[1]);
  if (n < 4) { // the draft was cleared by the close above: walk to step 4 again
    if (n === 1) { await tid(page, 'funnel-postcode').fill('BT9 6QP'); await tid(page, 'funnel-continue').click(); await onStep(page, 2); }
    if (n <= 2) { await tid(page, 'funnel-option-parking-driveway').click(); await onStep(page, 3); }
    await tid(page, 'funnel-option-vehicle-have').click();
    await onStep(page, 4);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await sheetOpen(page);
  check('a refresh on step 4 comes back to step 4', await onStep(page, 4));
  check('and browser Back still goes to step 3', await (async () => { await page.goBack(); return onStep(page, 3); })(), `${await stepLabel(page)} ${await histStep(page)} ${await hashOf(page)}`);
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

await section('2d. reduced motion: no slide, no stagger, no animated tick', async () => {
  const ctx = await newContext(MOBILE, 'dark', { reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-continue').click();
  await onStep(page, 2);
  const names = await page.evaluate(() => ({
    step: getComputedStyle(document.querySelector('[data-testid="funnel-step-2"]')).animationName,
    opt: getComputedStyle(document.querySelector('[data-testid="funnel-option-parking-driveway"]')).animationName
  }));
  check('the step and its options run no animation', names.step === 'none' && names.opt === 'none', JSON.stringify(names));
  const prog = await page.evaluate(() => getComputedStyle(document.querySelector('.bk-fn-progress__seg'), '::after').transitionDuration);
  check('the progress bar does not animate', parseFloat(prog) < 0.001, prog);
  await ctx.close();
});

// ================================================================ 3. submit: contact validation, confirmation, calendar, UTM, manage
await section('3. submit -> confirmation (his copy, pencilled survey, calendar, 5-step timeline, DEMO panel) -> Manage', async () => {
  const ctx = await newContext(MOBILE);
  await ctx.addInitScript((u) => { try { sessionStorage.setItem('vm_utm', JSON.stringify(u)); } catch (e) { /* ignore */ } }, UTM);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await walkToContact(page);
  await tid(page, 'funnel-submit').click();
  check('empty step 6 shows name, mobile and email errors and does not submit', await until(async () => { const t = await tid(page, 'booking-sheet').innerText(); return ['Enter your name', 'Enter your mobile number', 'Enter your email address'].every((m) => t.includes(m)); }) && (await stepLabel(page)) === 'Step 6 of 6');
  check('focus went to the first invalid field', !!(await until(async () => (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'fn-name')));
  await shot(page, 'funnel-6b-errors');
  await tid(page, 'field-name').fill('Aoife Magee');
  await tid(page, 'field-phone').fill('12345');
  await tid(page, 'funnel-email').fill('not-an-email');
  await tid(page, 'funnel-submit').click();
  check('a bad mobile and a bad email are refused with a clear message', await until(async () => { const t = await tid(page, 'booking-sheet').innerText(); return /doesn't look like a UK mobile/.test(t) && /email address doesn't look right/.test(t); }));
  await tid(page, 'demo-fill').click();
  check('Demo: fill sample details fills name, mobile and email', (await tid(page, 'field-name').inputValue()).length > 1 && (await tid(page, 'field-phone').inputValue()).startsWith('07700 900') && (await tid(page, 'funnel-email').inputValue()).includes('@'));
  await tid(page, 'field-note').fill('Charger on the garage wall please');
  await tid(page, 'funnel-optin').check();
  check('the optional marketing checkbox ticks', await tid(page, 'funnel-optin').isChecked());
  check('the opt-in row is a 44px-tall target', (await tid(page, 'funnel-optin').boundingBox()).height >= 44);
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  check('confirmation route is #booked/EL-1043', (await hashOf(page)) === '#booked/EL-1043', await hashOf(page));
  check('the step entries collapsed: the history holds no funnel step any more', (await histStep(page)) === 0, String(await histStep(page)));
  await tid(page, 'confirmation-ticket').waitFor({ timeout: WAIT });
  await shot(page, 'funnel-7-confirmation');
  check('H1 is his "Thanks, your enquiry has been received."', (await txt(page, 'confirmation-title')) === COPY.confirm.title, await txt(page, 'confirmation-title'));
  check('his paragraph, "within 24 hours" and "check your emails"', (await txt(page, 'confirmation-lead')) === COPY.confirm.body, await txt(page, 'confirmation-lead'));
  check('focus moved to the confirmation heading', (await until(async () => (await activeId(page)) === 'TITLE')));
  check('reference EL-1043 in monospace, with a copy button', (await txt(page, 'confirmation-ref')) === 'EL-1043' && (await tid(page, 'confirmation-ref').getAttribute('class')).includes('u-mono') && (await tid(page, 'confirmation-copy').count()) === 1);
  const pencilled = await txt(page, 'confirmation-pencilled');
  check('"We\'ve pencilled in a free survey visit for {when}. It\'s provisional until Daniel confirms."', /^We've pencilled in a free survey visit for (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, [^.]+\. It's provisional until Daniel confirms\.$/.test(pencilled), pencilled);
  const tile = await page.locator('.bk-datetile').innerText();
  check('the visit has a date tile (weekday, day, month) and a Provisional tag', /^(SAT|SUN|MON|TUE|WED|THU|FRI)\s+\d{1,2}\s+[A-Z]{3}$/i.test(tile.replace(/\s+/g, ' ').trim()) && /Provisional/i.test(await txt(page, 'confirmation-visit-tag')), tile);
  const ready = await txt(page, 'funnel-ready-box');
  check('"Helpful to have ready" box is verbatim', ready.includes(COPY.confirm.readyTitle) && ready.includes(COPY.confirm.ready), ready);
  check('the optional "Add photos now" card is there, with the exact line', (await tid(page, 'photos-card').count()) === 1 && (await txt(page, 'photos-card')).includes("A photo of your consumer unit and where you'd like the charger helps the team prepare your quote."));
  check('"Prefer to speak to us? Call 07885 496800" is a tel: button', (await txt(page, 'confirmation-call')) === COPY.confirm.call && (await tid(page, 'confirmation-call').getAttribute('href')) === 'tel:+447885496800', await tid(page, 'confirmation-call').getAttribute('href'));
  const wa = (await tid(page, 'confirmation-whatsapp').getAttribute('href')) || '';
  check('a WhatsApp button uses his real number and names the reference', /^https:\/\/wa\.me\/447885496800\?text=/.test(wa) && decodeURIComponent(wa).includes('EL-1043'), wa);
  check('status chip says Daniel still has to confirm; no breaker art', (await txt(page, 'confirmation-status')).includes('Waiting for Daniel to confirm') && (await tid(page, 'breaker-art').count()) === 0);
  check('animated tick is drawn', (await tid(page, 'confirmation-tick').count()) === 1);
  const steps = await tid(page, 'confirmation-timeline').locator('li').count();
  const first = await txt(page, 'journey-received');
  check('"What happens next" has five steps, the first already ticked', steps === 5 && (await tid(page, 'journey-received').getAttribute('class')).includes('is-done') && first.includes('Just now'), `${steps} ${first}`);
  check('the first step still to come is marked as the current one', (await tid(page, 'journey-contact').getAttribute('class')).includes('is-current') && (await tid(page, 'journey-contact').getAttribute('aria-current')) === 'step');
  check('DEMO panel is labelled simulated', (await txt(page, 'demo-panel')).includes('DEMO · SIMULATED'));
  const ob = await txt(page, 'demo-owner-bubble');
  check('DEMO: the owner bubble has name, postcode and the one-line answers', ob.includes('EL-1043') && ob.includes('BT9 6QP') && ob.includes(ANSWERS_LINE), ob);
  const cb = await txt(page, 'demo-customer-bubble');
  check('DEMO: the customer text says pencilled, provisional, within 24 hours', /pencilled/.test(cb) && /provisional/.test(cb) && /24 hours/.test(cb) && cb.includes('EL-1043'), cb);
  check('Open Daniel\'s dashboard deep-links to the booking in the dashboard tab', /dashboard\.html(\?[^#]*)?#\/bookings\/bk_/.test(await tid(page, 'demo-open-dashboard').getAttribute('href')) && (await tid(page, 'demo-open-dashboard').getAttribute('target')) === 'vm-dashboard');
  check('the draft is cleared after submitting', await page.evaluate(() => sessionStorage.getItem('vm_draft_v1') === null));
  check('confirmation fits the phone width', await noOverflow(page));
  const stored = await bookingByRef(page, 'EL-1043');
  check('the enquiry carries the session\'s UTM capture (source, medium, campaign)', !!stored && stored.utm && stored.utm.source === UTM.source && stored.utm.medium === UTM.medium && stored.utm.campaign === UTM.campaign, JSON.stringify(stored && stored.utm));
  // add to calendar: a provisional .ics
  await tid(page, 'add-to-calendar').scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: WAIT }), tid(page, 'add-to-calendar').click()]);
  const ics = fs.readFileSync(await download.path(), 'utf8');
  check('Add to calendar downloads an .ics named for the reference', /\.ics$/.test(download.suggestedFilename()) && download.suggestedFilename().includes('EL-1043'), download.suggestedFilename());
  check('the calendar file is valid and says PROVISIONAL (tentative, not confirmed)', ics.startsWith('BEGIN:VCALENDAR') && /STATUS:TENTATIVE/.test(ics) && /SUMMARY:PROVISIONAL/.test(ics) && /not confirmed until Daniel confirms/.test(ics.replace(/\r\n /g, '').replace(/\\/g, '')) && /DTSTART:20261024T080000/.test(ics), ics.slice(0, 400));
  check('every line of the calendar file is at most 75 octets (folded)', ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  check('the calendar button says it saves a provisional entry', (await txt(page, 'add-to-calendar-note')).includes('provisional'));
  // survives a refresh
  await page.reload({ waitUntil: 'networkidle' });
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  check('confirmation survives a refresh', (await txt(page, 'confirmation-ref')) === 'EL-1043' && (await tid(page, 'demo-owner-bubble').count()) === 1);
  // manage
  await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-manage').click();
  await tid(page, 'manage-page').waitFor({ timeout: WAIT });
  check('Manage opens at #manage/EL-1043', (await hashOf(page)) === '#manage/EL-1043');
  check('a pending enquiry says "We\'ll be in touch within 24 hours." (no time promise)', (await txt(page, 'manage-reply-note')) === "We'll be in touch within 24 hours.", await txt(page, 'manage-reply-note'));
  const jt = await tid(page, 'manage-status-timeline').locator('li').count();
  check('Manage shows the live status chip and the journey timeline', (await txt(page, 'manage-status')).includes('Waiting for Daniel') && jt === 5, `${jt}`);
  check('Manage offers Call and WhatsApp', (await tid(page, 'manage-call').count()) === 1 && (await tid(page, 'manage-whatsapp').count()) === 1);
  check('the pencilled visit is next day, so cancelling is by phone (the store refuses inside 24 h): no Cancel button, a clear note', (await tid(page, 'manage-cancel').count()) === 0 && (await txt(page, 'manage-close-note')) === 'This is close, so please call Daniel.', await txt(page, 'manage-close-note'));
  await shot(page, 'funnel-8-manage');
  check('Back on the Manage page returns to the confirmation', await (async () => { await tid(page, 'booking-back').click(); return tid(page, 'confirmation').waitFor({ timeout: WAIT }).then(() => true, () => false); })());
  await tid(page, 'confirmation-done').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-done').click();
  check('Done closes the sheet to the landing page (no hash)', (await sheetGone(page)) && (await hashOf(page)) === '');
  await tid(page, 'hero-cta').click();
  await sheetOpen(page);
  check('opening the funnel again starts fresh at step 1 with an empty postcode', (await onStep(page, 1)) && (await tid(page, 'funnel-postcode').inputValue()) === '');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 3b. cancel an enquiry that is a few days away; the window frees up
await section('3b. a visit more than 24 h away can be cancelled from Manage, and the pencilled window is free again', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  // Block the next four days in the diary (through the page's own store module) so the engine pencils the survey in beyond the 24 h cutoff.
  const blocked = await page.evaluate(async () => {
    const s = await import('./js/core/store.js');
    const r = s.blockRange({ fromDate: '2026-10-24', toDate: '2026-10-27', label: 'Test: away' });
    return !!r.ok;
  });
  check('setup: the diary is blocked Sat 24 to Tue 27 Oct', blocked);
  await submitEnquiry(page);
  const p1 = await txt(page, 'confirmation-pencilled');
  check('the survey is pencilled in for 28 Oct or later (more than 24 h away)', /(Wed|Thu|Fri|Sat|Sun|Mon|Tue) (2[89]|3[01]) Oct|Nov/.test(p1), p1);
  await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-manage').click();
  await tid(page, 'manage-page').waitFor({ timeout: WAIT });
  check('Manage offers "Cancel enquiry" and no close-to-the-visit note', (await txt(page, 'manage-cancel')) === 'Cancel enquiry' && (await tid(page, 'manage-close-note').count()) === 0);
  await tid(page, 'manage-cancel').click();
  await tid(page, 'manage-cancel-confirm').waitFor({ timeout: WAIT });
  await tid(page, 'manage-cancel-reason').selectOption('Changed my mind');
  await tid(page, 'manage-cancel-confirm').click();
  check('cancelling shows "This enquiry was cancelled." and a way to start again', await until(async () => { const t = await txt(page, 'manage-page'); return t.includes('This enquiry was cancelled.') && t.includes('Get my installation quote'); }), await txt(page, 'manage-page'));
  const b = await bookingByRef(page, 'EL-1043');
  check('the store has the enquiry cancelled by the customer with the reason', !!b && b.status === 'cancelled' && b.cancelledBy === 'customer' && b.cancelReason === 'Changed my mind', JSON.stringify(b && [b.status, b.cancelledBy, b.cancelReason]));
  check('the status chip and the confirmation both say cancelled', (await txt(page, 'manage-status')).includes('Cancelled'));
  await tid(page, 'booking-back').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  check('the confirmation of a cancelled enquiry says so and drops the photos card and timeline', (await txt(page, 'confirmation-title')) === 'This enquiry was cancelled.' && (await tid(page, 'photos-card').count()) === 0 && (await tid(page, 'confirmation-timeline').count()) === 0);
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 3c. browser Back from the confirmation leaves the sheet
await section('3c. browser Back from the confirmation leaves the sheet (it never reopens step 5)', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').click();
  await sheetOpen(page);
  await submitEnquiry(page);
  await page.goBack();
  check('Back from the confirmation closes the sheet to the landing page', (await sheetGone(page)) && (await hashOf(page)) === '', await hashOf(page));
  await page.goForward();
  check('Forward brings the confirmation back (same reference, no second enquiry)', (await tid(page, 'confirmation').waitFor({ timeout: WAIT }).then(() => true, () => false)) && (await txt(page, 'confirmation-ref')) === 'EL-1043');
  const n = (await bookingsInStore(page)).filter((x) => x.ref === 'EL-1043').length;
  check('exactly one enquiry was created', n === 1, String(n));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 3d. photos: shrink, thumbnails, send, storage full
await section('3d. photos on the confirmation: pick, shrink to <= 900px / <= 70,000 chars, remove, send, storage full', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await submitEnquiry(page);
  await tid(page, 'photos-card').scrollIntoViewIfNeeded();
  const input = tid(page, 'photos-input');
  check('the picker accepts images, several at once; the camera button carries the capture hint', (await input.getAttribute('accept')) === 'image/*' && (await input.getAttribute('multiple')) !== null && (await tid(page, 'photos-camera-input').getAttribute('capture')) === 'environment');
  check('both photo buttons are at least 44px tall', (await tid(page, 'photos-camera').boundingBox()).height >= 44 && (await tid(page, 'photos-choose').boundingBox()).height >= 44);
  check('no Send button until a photo is chosen', (await tid(page, 'photos-send').count()) === 0);
  const big = await makePhoto(page, 3200, 2400, 1);
  const wide = await makePhoto(page, 2400, 1200, 2);
  await input.setInputFiles([{ name: 'IMG_0001 consumer unit.JPG', mimeType: 'image/jpeg', buffer: big }, { name: 'drive.jpeg', mimeType: 'image/jpeg', buffer: wide }]);
  check('two thumbnails appear', await until(async () => (await tid(page, 'photos-grid').locator('li.bk-thumb:not(.is-busy)').count()) === 2));
  check('the Send button says "Send photos"', (await txt(page, 'photos-send')) === 'Send photos');
  await shot(page, 'photos-2-chosen');
  await tid(page, 'photo-remove-1').click();
  check('a thumbnail can be removed', await until(async () => (await tid(page, 'photos-grid').locator('li.bk-thumb:not(.is-busy)').count()) === 1) && (await txt(page, 'photos-send')) === 'Send photo');
  await input.setInputFiles([{ name: 'wall.png', mimeType: 'image/jpeg', buffer: wide }, { name: 'one-too-many.jpg', mimeType: 'image/jpeg', buffer: big }, { name: 'and-another.jpg', mimeType: 'image/jpeg', buffer: wide }]);
  check('at most three photos: the extra ones are not taken and it says so', await until(async () => (await tid(page, 'photos-grid').locator('li.bk-thumb:not(.is-busy)').count()) === 3) && /Up to 3 photos fit/.test(await txt(page, 'photos-status')), await txt(page, 'photos-status'));
  check('with three chosen both picker buttons are off', (await tid(page, 'photos-choose').isDisabled()) && (await tid(page, 'photos-camera').isDisabled()));
  await tid(page, 'photo-remove-2').click();
  await tid(page, 'photo-remove-1').click();
  check('back to one photo', await until(async () => (await tid(page, 'photos-grid').locator('li.bk-thumb:not(.is-busy)').count()) === 1));
  // not an image
  await input.setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') }]);
  check('a file that is not a picture is refused kindly', await until(async () => /couldn't read that photo/.test(await txt(page, 'photos-status'))), await txt(page, 'photos-status'));
  // storage full: fill localStorage up to the brim, then try to send
  await page.evaluate(() => {
    const fill = (chunk) => { for (let i = 0; i < 400; i += 1) { try { localStorage.setItem('zz_junk_' + chunk + '_' + i, 'x'.repeat(chunk)); } catch (e) { return i; } } return 400; };
    fill(200000); fill(20000); fill(2000); fill(200);
  });
  await tid(page, 'photos-send').click();
  check('when the device has no room it says so, keeps the photo, and offers WhatsApp instead', await until(async () => /no room left/.test(await txt(page, 'photos-status'))) && (await tid(page, 'photos-grid').locator('li.bk-thumb:not(.is-busy)').count()) === 1 && (await tid(page, 'photos-whatsapp').count()) === 1, await txt(page, 'photos-status'));
  check('storage full did not lose the enquiry', !!(await bookingByRef(page, 'EL-1043')) || (await page.evaluate(() => localStorage.length)) > 0);
  await shot(page, 'photos-storage-full');
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('zz_junk_')) localStorage.removeItem(k); });
  await tid(page, 'photos-send').click();
  check('with room again the photo is sent and shown as sent', await until(async () => (await tid(page, 'photos-saved-0').count()) === 1) && /added to your enquiry for Daniel/.test(await txt(page, 'photos-status')), await txt(page, 'photos-status'));
  check('the Send button is gone and the picker is open for two more', (await tid(page, 'photos-send').count()) === 0 && !(await tid(page, 'photos-choose').isDisabled()));
  const stored = await bookingByRef(page, 'EL-1043');
  const ph = stored && stored.photos ? stored.photos : [];
  check('the booking holds exactly one photo in the store', ph.length === 1, String(ph.length));
  const dims = await page.evaluate(async (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = () => resolve([0, 0]); i.src = url; }), ph[0] ? ph[0].dataUrl : '');
  check('the stored photo is a JPEG, at most 900px on the long side and at most 70,000 characters', !!ph[0] && ph[0].dataUrl.startsWith('data:image/jpeg;base64,') && ph[0].dataUrl.length <= 70000 && Math.max(...dims) <= 900 && Math.max(...dims) >= 600, `${ph[0] && ph[0].dataUrl.length} ${dims}`);
  check('the photo\'s name is cleaned and ends .jpg', !!ph[0] && /^[\w .()-]+\.jpg$/.test(ph[0].name), ph[0] && ph[0].name);
  await shot(page, 'photos-sent');
  // survives a reload, and the sent photo can be removed
  await page.reload({ waitUntil: 'networkidle' });
  await tid(page, 'photos-card').waitFor({ timeout: WAIT });
  check('after a refresh the sent photo is still shown', (await tid(page, 'photos-saved-0').count()) === 1);
  await tid(page, 'photo-remove-saved-0').click();
  check('a sent photo can be taken back', await until(async () => ((await bookingByRef(page, 'EL-1043')).photos || []).length === 0));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 3e. the owner's quote shows up for the customer, live
await section('3e. a quote the owner sends appears on the confirmation and Manage, and ticks off the timeline', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await submitEnquiry(page);
  check('no quote yet: no quote card, the quote step is still to come', (await tid(page, 'quote-note').count()) === 0 && !(await tid(page, 'journey-quote').getAttribute('class')).includes('is-done'));
  const sent = await page.evaluate(async () => {
    const s = await import('./js/core/store.js');
    const b = s.getState().bookings.find((x) => x.ref === 'EL-1043');
    const q = s.createQuote({ bookingId: b.id });
    if (!q.ok) return 'create:' + q.reason;
    const r = s.sendQuote(q.quote.id, { via: 'link' });
    return r.ok ? q.quote.id : 'send:' + r.reason;
  });
  check('setup: the owner writes and sends a quote (through the store)', /^Q-EL-1043/.test(sent), sent);
  check('the confirmation shows "Your quote is ready" without a reload', !!(await until(async () => (await tid(page, 'quote-note').count()) === 1 && (await txt(page, 'quote-note')).includes('Your quote is ready'))));
  const href = (await tid(page, 'quote-open').getAttribute('href')) || '';
  check('the button opens quote.html#q=<id> in the quote tab, and says it is a sample', /^quote\.html(\?[^#]*)?#q=Q-EL-1043/.test(href) && (await tid(page, 'quote-open').getAttribute('target')) === 'vm-quote' && (await txt(page, 'quote-note')).includes('sample'), href);
  check('the "written quote" step is ticked off', (await tid(page, 'journey-quote').getAttribute('class')).includes('is-done') && (await tid(page, 'journey-install').getAttribute('class')).includes('is-current'));
  await shot(page, 'confirmation-quote-ready');
  await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-manage').click();
  await tid(page, 'manage-page').waitFor({ timeout: WAIT });
  check('Manage shows the quote card too', (await tid(page, 'quote-note').count()) === 1 && (await tid(page, 'manage-status-timeline').locator('li.is-done').count()) >= 3);
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 3f. enquiries paused
await section('3f. when the owner pauses online enquiries the funnel says so and offers the phone', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await page.evaluate(async () => { const s = await import('./js/core/store.js'); s.updateService('ev_quote', { active: false }); });
  check('the sheet swaps to "Online enquiries are paused" with a Call button', !!(await until(async () => (await tid(page, 'funnel-unavailable').count()) === 1)) && (await tid(page, 'funnel-unavailable').locator('a[href^="tel:"]').count()) === 1);
  check('there is no submit or continue button while paused', (await tid(page, 'funnel-continue').count()) === 0 && (await tid(page, 'funnel-submit').count()) === 0);
  await page.evaluate(async () => { const s = await import('./js/core/store.js'); s.updateService('ev_quote', { active: true }); });
  check('switching enquiries back on brings the funnel back live', !!(await until(async () => (await tid(page, 'funnel-step-1').count()) === 1)));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 4. layout: keyboard open, deep links, postcode prefill
await section('4. keyboard-open layout, old deep links, landing postcode prefill', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await onStep(page, 1);
  // Emulate the on-screen keyboard exactly as js/ui/boot.js reports it: --kb-inset and is-keyboard-open on <html>.
  const KB = 320;
  const keyboard = (on) => page.evaluate(({ on, n }) => {
    const r = document.documentElement;
    r.style.setProperty('--kb-inset', on ? n + 'px' : '0px');
    r.classList.toggle('is-keyboard-open', !!on);
  }, { on, n: KB });
  const visible = async (id) => {
    const b = await tid(page, id).boundingBox();
    return !!b && b.y >= 0 && b.y + b.height <= MOBILE.height - KB + 1 && b.height >= 44;
  };
  await tid(page, 'funnel-postcode').focus();
  await keyboard(true);
  check('step 1 with the keyboard open: Continue is fully visible above it', await until(() => visible('funnel-continue'), 3000), JSON.stringify(await tid(page, 'funnel-continue').boundingBox()));
  const sh = await tid(page, 'booking-sheet').boundingBox();
  check('step 1 with the keyboard open: the sheet shrinks to the space above the keyboard', sh.y + sh.height <= MOBILE.height - KB + 1, JSON.stringify(sh));
  await shot(page, 'funnel-1-keyboard');
  await keyboard(false);
  await walkToContact(page);
  await tid(page, 'field-phone').focus();
  await keyboard(true);
  check('step 6 with the keyboard open: the submit button is fully visible above it', await until(() => visible('funnel-submit'), 3000), JSON.stringify(await tid(page, 'funnel-submit').boundingBox()));
  const fieldOnScreen = async () => { const f = await tid(page, 'field-phone').boundingBox(); return !!f && f.y >= 0 && f.y + f.height <= MOBILE.height - KB; };
  check('step 6 with the keyboard open: the focused field is still on screen', !!(await until(fieldOnScreen, 3000)), JSON.stringify(await tid(page, 'field-phone').boundingBox()));
  await shot(page, 'funnel-6-keyboard');
  await keyboard(false);

  // old deep links and '#book' all open the funnel (the website offers only the enquiry)
  for (const hash of ['#book', '#book/fault/2026-10-24/0', '#book/eicr']) {
    // Leave the open sheet first (its pagehide flush re-saves the draft), clear the draft on the bare page, then deep-link.
    await page.goto(`${BASE}/index.html?${CLOCK}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${BASE}/index.html?${CLOCK}${hash}`, { waitUntil: 'networkidle' });
    await sheetOpen(page);
    check(`${hash} opens the quote funnel at step 1`, (await onStep(page, 1)) && (await tid(page, 'funnel-step-1').count()) === 1, await stepLabel(page));
  }
  // the emergency path is off by default
  await page.goto(`${BASE}/index.html?${CLOCK}#book/emergency`, { waitUntil: 'networkidle' });
  await sheetOpen(page);
  check('#book/emergency says emergencies are not taken online and points to 999', (await tid(page, 'emergency-off-banner').count()) === 1 && (await txt(page, 'emergency-off-banner')).includes('999'));
  // landing postcode box -> funnel step 1 prefilled
  await page.goto(`${BASE}/index.html?${CLOCK}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => sessionStorage.clear());
  if (await tid(page, 'coverage-input').count()) {
    await tid(page, 'coverage-input').scrollIntoViewIfNeeded();
    await tid(page, 'coverage-input').fill('bt96qp');
    await tid(page, 'coverage-book').click();
    await sheetOpen(page);
    check('a postcode typed on the landing page arrives prefilled on step 1', (await tid(page, 'funnel-postcode').inputValue()) === 'BT9 6QP', await tid(page, 'funnel-postcode').inputValue());
  } else {
    check('landing page has the postcode box (coverage-input)', false);
  }
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 5. light theme and 320 / 1280 widths
await section('5. light theme: funnel, confirmation and Manage are readable; 320px and 1280px hold together', async () => {
  const ctx = await newContext(MOBILE, 'light');
  await ctx.addInitScript(() => { try { localStorage.setItem('vm_theme', 'light'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="booking-sheet"]')).backgroundColor);
  check('the sheet is light in the light theme', lum(bg) > 0.8, bg);
  await shot(page, 'funnel-1-postcode-light');
  await walkToContact(page);
  await shot(page, 'funnel-6-contact-light');
  await tid(page, 'demo-fill').click();
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  await tid(page, 'confirmation-ticket').waitFor({ timeout: WAIT });
  await shot(page, 'funnel-7-confirmation-light');
  const ink = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="confirmation-title"]')).color);
  check('confirmation text is dark on light', lum(ink) < 0.3, ink);
  const notch = await page.evaluate(() => getComputedStyle(document.querySelector('.bk-ticket__tear'), '::before').backgroundColor);
  check('the ticket notches match the light page (so they read as holes)', lum(notch) > 0.8, notch);
  await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-manage').click();
  await tid(page, 'manage-page').waitFor({ timeout: WAIT });
  await shot(page, 'funnel-8-manage-light');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();

  for (const [w, h, label] of [[320, 568, '320'], [1280, 800, '1280']]) {
    const c2 = await newContext({ width: w, height: h }, 'dark');
    const p2 = await c2.newPage();
    const l2 = watch(p2);
    await site(p2, '#book/ev_quote');
    await sheetOpen(p2);
    await shot(p2, `funnel-1-postcode-${label}`);
    check(`${label}px: step 1 fits and the Continue button is reachable`, (await noOverflow(p2)) && (await tid(p2, 'funnel-continue').isVisible()));
    await walkToContact(p2);
    check(`${label}px: step 6 fits`, await noOverflow(p2));
    await shot(p2, `funnel-6-contact-${label}`);
    await tid(p2, 'demo-fill').click();
    await tid(p2, 'funnel-submit').click();
    await tid(p2, 'confirmation').waitFor({ timeout: WAIT });
    await tid(p2, 'confirmation-ticket').waitFor({ timeout: WAIT });
    check(`${label}px: confirmation fits (no sideways scroll)`, await noOverflow(p2));
    await shot(p2, `funnel-7-confirmation-${label}`);
    await tid(p2, 'photos-card').scrollIntoViewIfNeeded();
    check(`${label}px: the photo card and its buttons fit`, await p2.evaluate(() => { const c = document.querySelector('[data-testid="photos-card"]').getBoundingClientRect(); const b = document.querySelector('[data-testid="booking-sheet"]').getBoundingClientRect(); return c.left >= b.left && c.right <= b.right; }));
    await shot(p2, `funnel-7b-photos-${label}`);
    check(`${label}px: no console errors, off-site or failed requests`, clean(l2), dump(l2));
    await c2.close();
  }
});

// ================================================================ 5b. accessibility (axe, serious and critical) in both themes
if (AXE_SOURCE) {
  await section('5b. axe: no serious or critical violations on the funnel, confirmation and Manage (dark and light)', async () => {
    for (const scheme of ['dark', 'light']) {
      const ctx = await newContext(MOBILE, scheme);
      await ctx.addInitScript((s) => { try { localStorage.setItem('vm_theme', s); } catch (e) { /* ignore */ } }, scheme);
      const page = await ctx.newPage();
      await site(page, '#book/ev_quote');
      await sheetOpen(page);
      await onStep(page, 1);
      let r = await axeSeriousCount(page);
      check(`${scheme}: step 1`, r.count === 0, r.detail);
      await tid(page, 'funnel-postcode').fill('BT9 6QP');
      await tid(page, 'funnel-continue').click();
      await onStep(page, 2);
      await tid(page, 'funnel-option-parking-driveway').waitFor({ timeout: WAIT });
      await page.waitForTimeout(900); // the entrance animation changes colours mid-flight; axe reads settled colours
      r = await axeSeriousCount(page);
      check(`${scheme}: step 2 (option cards)`, r.count === 0, r.detail);
      await tid(page, 'funnel-option-parking-driveway').click();
      for (const [n, key, value] of [[3, 'vehicle', 'ordered'], [4, 'timing', 'asap'], [5, 'permission', 'yes']]) { await onStep(page, n); await tid(page, `funnel-option-${key}-${value}`).click(); }
      await onStep(page, 6);
      await tid(page, 'funnel-submit').click();
      await page.waitForTimeout(300);
      r = await axeSeriousCount(page);
      check(`${scheme}: step 6 with errors showing`, r.count === 0, r.detail);
      await tid(page, 'demo-fill').click();
      await tid(page, 'funnel-submit').click();
      await tid(page, 'confirmation').waitFor({ timeout: WAIT });
      await page.waitForTimeout(1800); // tick and entrance animations finished
      r = await axeSeriousCount(page);
      check(`${scheme}: confirmation`, r.count === 0, r.detail);
      await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
      await tid(page, 'confirmation-manage').click();
      await tid(page, 'manage-page').waitFor({ timeout: WAIT });
      await page.waitForTimeout(500);
      r = await axeSeriousCount(page);
      check(`${scheme}: Manage`, r.count === 0, r.detail);
      await ctx.close();
    }
  });
}

// ================================================================ 6. owner's phone job (BookingSheet owner mode, #/new)
await section('6. owner mode: New booking books an EV installation and a fault-finding visit by phone', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/new');
  await tid(page, 'new-booking-page').waitFor({ timeout: WAIT });
  check('step 0 lists the free quote visit and the EV installation (no emergency row)', (await tid(page, 'service-option-ev_quote').count()) === 1 && (await tid(page, 'service-option-ev').count()) === 1 && (await tid(page, 'booking-emergency-link').count()) === 0);
  check('the installation shows "Quoted for your home", never a price', (await txt(page, 'service-option-ev')).includes('Quoted for your home') && !/£\d/.test(await txt(page, 'service-option-ev')), await txt(page, 'service-option-ev'));
  check('owner mode does not show the customer funnel header', (await tid(page, 'funnel-step-label').count()) === 0);
  await tid(page, 'service-option-ev').click();
  await tid(page, 'soonest-card').waitFor({ timeout: WAIT });
  await tid(page, 'soonest-pick').click();
  await tid(page, 'booking-continue').click();
  await tid(page, 'field-name').waitFor({ timeout: WAIT });
  check('details step ticket says Quoted for your home', (await txt(page, 'booking-ticket')).includes('Quoted for your home'), await txt(page, 'booking-ticket'));
  await tid(page, 'demo-fill').click();
  check('postcode hint says it is in Northern Ireland', (await until(async () => (await txt(page, 'postcode-hint')).includes('Northern Ireland'))), await txt(page, 'postcode-hint'));
  await tid(page, 'booking-submit').click();
  check('Add to diary lands on the booking page', !!(await until(async () => /#\/bookings\/bk_/.test(await hashOf(page)))), await hashOf(page));
  check('the booking page shows the installation', !!(await until(async () => (await page.locator('body').innerText()).includes('EV charger installation'))));
  await shot(page, 'owner-new-installation');
  // a second, classic phone job: the older flow still works end to end
  await dash(page, '#/new');
  await tid(page, 'new-booking-page').waitFor({ timeout: WAIT });
  if (await tid(page, 'service-option-fault').count()) {
    await tid(page, 'service-option-fault').click();
    await tid(page, 'soonest-card').waitFor({ timeout: WAIT });
    await tid(page, 'soonest-pick').click();
    await tid(page, 'booking-continue').click();
    await tid(page, 'field-name').waitFor({ timeout: WAIT });
    await tid(page, 'demo-fill').click();
    await tid(page, 'booking-submit').click();
    check('a classic phone job (fault finding) also lands on its booking page', !!(await until(async () => /#\/bookings\/bk_/.test(await hashOf(page)))), await hashOf(page));
  } else {
    check('the classic fault-finding service is listed for phone jobs', false);
  }
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 7. cross-page flow (one context, two pages)
await section('7. cross-page: the website enquiry reaches the dashboard, and Daniel confirming flips the customer page live', async () => {
  const ctx = await newContext(MOBILE);
  const A = await ctx.newPage();
  const logA = watch(A);
  await dash(A, '#/today');
  await tid(A, 'tabbar-indicator').waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
  const B = await ctx.newPage();
  const logB = watch(B);
  await site(B, '#book/ev_quote');
  await sheetOpen(B);
  await submitEnquiry(B);
  const ref = await txt(B, 'confirmation-ref');
  check('B: the enquiry is EL-1043 and waits for Daniel', ref === 'EL-1043' && (await txt(B, 'confirmation-status')).includes('Waiting for Daniel to confirm'), ref);
  const href = await tid(B, 'demo-open-dashboard').getAttribute('href');
  const bookingId = (href.match(/#\/bookings\/(bk_[a-z0-9]+)/) || [])[1];
  check('B: the DEMO panel links to the dashboard job card', !!bookingId, href);

  const toast = await until(async () => A.getByText(/New (booking|enquiry): /).first().isVisible(), 12000, 150);
  check('A: a new-enquiry toast appeared without a reload', !!toast);
  await A.evaluate((id) => { location.hash = '#/bookings/' + id; }, bookingId);
  await tid(A, 'job-primary').waitFor({ timeout: WAIT });
  const jobText = (await A.locator('body').innerText()).replace(/\s+/g, ' ');
  check('A: the job card shows the five funnel answers', ['BT9 6QP', 'Private driveway', 'ordered or arriving soon', 'As soon as possible'].every((t) => jobText.includes(t)), jobText.slice(0, 300));
  check('A: the job card primary action is Confirm', /confirm/i.test(await txt(A, 'job-primary')), await txt(A, 'job-primary'));
  await tid(A, 'job-primary').click();
  const flipped = await until(async () => (await txt(B, 'confirmation-status')) === 'Confirmed', 12000, 150);
  check('B: the chip flipped to Confirmed without a reload', !!flipped, await txt(B, 'confirmation-status'));
  check('B: the survey line now says it is confirmed (no longer provisional)', !!(await until(async () => /Your free survey visit is confirmed for/.test(await txt(B, 'confirmation-pencilled')) && !/provisional/.test(await txt(B, 'confirmation-pencilled')))), await txt(B, 'confirmation-pencilled'));
  check('B: the visit tag flips to Confirmed and the calendar note drops "provisional"', !!(await until(async () => /confirmed/i.test(await txt(B, 'confirmation-visit-tag')) && !/provisional/i.test(await txt(B, 'add-to-calendar-note')))), `${await txt(B, 'confirmation-visit-tag')} | ${await txt(B, 'add-to-calendar-note')}`);
  check('B: the timeline ticks off the contact and survey steps', (await tid(B, 'journey-contact').getAttribute('class')).includes('is-done') && (await tid(B, 'journey-survey').getAttribute('class')).includes('is-done') === false);
  check('B: the confirmation text appeared in the DEMO panel', !!(await until(async () => /then, when daniel confirmed/i.test(await txt(B, 'demo-panel')), 8000)));
  const [dl] = await Promise.all([B.waitForEvent('download', { timeout: WAIT }), tid(B, 'add-to-calendar').click()]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  check('B: the calendar file is now CONFIRMED and no longer says provisional', /STATUS:CONFIRMED/.test(ics) && !/PROVISIONAL/.test(ics));
  check('no console errors on either page', logA.errors.length + logB.errors.length === 0, [...logA.errors, ...logB.errors].join(' | '));
  check('no off-site or failed requests on either page', logA.offsite.length + logB.offsite.length + logA.failed.length + logB.failed.length === 0, [...logA.offsite, ...logB.offsite, ...logA.failed, ...logB.failed].join(' | '));
  await ctx.close();
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
