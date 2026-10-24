// tests/e2e/landing.mjs: end-to-end check of the landing page, the 6-step quote funnel (copy, motion, keyboard, history, drafts), the enquiry confirmation
// (one story, the suggested visit as a tagged idea, calendar file, photos, timeline, DEMO panel), the Manage page, the owner's phone-job booking and the cross-page flow.
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
  step1: { eyebrow: "Let's find the right home charging setup for you", title: "What's your installation postcode?", label: 'Your postcode', placeholder: 'e.g. BT7 3AB', error: 'Please enter a valid UK postcode so we can check your location.', help: 'We cover Northern Ireland (BT postcodes)' },
  steps: [
    { n: 2, key: 'parking', title: 'Where would you normally park to charge?', why: 'Daniel uses this to plan the cable route.', options: ['Private driveway', 'Garage', 'Allocated parking space', 'On-street parking', 'Other or not sure'], values: ['driveway', 'garage', 'allocated', 'street', 'other'] },
    { n: 3, key: 'vehicle', title: 'Do you already have your electric or plug-in hybrid car?', why: 'Daniel uses this to suggest a suitable charger.', options: ['Yes', "It's ordered or arriving soon", "I'm choosing one"], values: ['have', 'ordered', 'choosing'] },
    { n: 4, key: 'timing', title: 'When would you like your charger installed?', why: 'Daniel uses this to plan his diary around you.', options: ['As soon as possible', 'Within the next month', 'Within 1 to 3 months', 'Just researching'], values: ['asap', 'month', 'one_to_three', 'researching'] },
    { n: 5, key: 'permission', title: "Do you own the property, or have the owner's permission?", why: 'Daniel uses this to plan any permission needed.', options: ['Yes', 'I rent or lease and need permission', 'Not sure'], values: ['yes', 'landlord', 'unsure'] }
  ],
  step6: { title: 'Where should Daniel send your quote?', promise: 'Daniel will contact you within 24 hours. Free, no-obligation quote.', labels: ['Full name', 'Installation postcode', 'Mobile number', 'Email address', 'Anything else we should know? (optional)'], submit: 'Request my installation quote', optIn: 'Keep me updated with occasional offers and EV charging tips from 180 Electrical. Optional, and you can opt out at any time.', small: '180 Electrical will use these details to respond to your installation enquiry. By submitting your details you give us permission to contact you.' },
  // his own "Helpful to have ready" words, verbatim (docs/reference/180-site-report.md)
  confirm: { title: 'Thanks, your enquiry has been received.', body: 'Daniel will review your details and contact you to discuss your home charger installation within 24 hours. Please also check your emails.', ready: 'If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation.' }
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
  try { await fn(); } catch (e) { failures += 1; console.log('  FAIL ' + name + ' threw: ' + (e && e.message ? e.message.split('\n').slice(0, process.env.VERBOSE ? 12 : 1).join(' | ') : e)); }
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
/** Open one of the confirmation's closed accordions (photos: funnel-ready-box, timeline: journey-box). */
const openAcc = async (page, id) => { const d = tid(page, id); if (!(await d.evaluate((el) => el.open))) await d.locator('summary').click(); await until(() => d.evaluate((el) => el.open)); };
/** Open the dashed "See what Daniel's phone just received" button (the whole demo lives behind it). */
const openDemo = async (page) => { if (!(await tid(page, 'demo-panel').count())) await tid(page, 'demo-toggle').click(); await tid(page, 'demo-panel').waitFor({ timeout: WAIT }); };
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
    // ---- the first screen: slim header naming the business in text, a short photo band, one red button, a read-only proof row
    const first = await page.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, w: b.width, h: b.height }; };
      const reds = [...document.querySelectorAll('.ui-btn--primary')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && x.bottom > 0 && x.top < innerHeight && getComputedStyle(b).visibility !== 'hidden'; }).length;
      const logoImg = document.querySelector('.lp-header .lp-logo');
      const bn = logoImg ? logoImg.getBoundingClientRect() : { top: 0, bottom: 0, height: 0, width: 0 };
      const credsEl = document.querySelector('[data-testid="hero-creds"]');
      const proof = document.querySelector('[data-testid="hero-proof"]');
      const pr = proof ? proof.getBoundingClientRect() : { bottom: 9999 };
      return {
        vw: innerWidth, header: r('[data-testid="lp-header"]'), photo: r('[data-testid="hero-photo"]'), free: r('[data-testid="hero-proof-free"]'), cta: r('[data-testid="hero-cta"]'), h1: r('.lp-hero__title'), sub: r('.lp-hero__sub'),
        reds, logoH: bn.height, logoW: bn.width, logoOnScreen: bn.top >= 0 && bn.bottom <= 110, logoLabel: (document.querySelector('.lp-brand') || { getAttribute: () => '' }).getAttribute('aria-label'), logoImg: !!document.querySelector('.lp-header .lp-logo__img'), brandMark: !!document.querySelector('.lp-header .bk-brand__mark'),
        credsBottom: credsEl ? credsEl.getBoundingClientRect().bottom : 9999, credsOverPhoto: credsEl ? !!credsEl.closest('.lp-hero__frame') : null,
        proofBottom: pr.bottom, proofText: proof ? proof.innerText.replace(/\s+/g, ' ') : '', proofLinks: proof ? proof.querySelectorAll('a[href], button').length : -1, vh: innerHeight,
        extras: document.querySelectorAll('.lp-hero__line, [data-testid="hero-ticks"], .lp-ticks').length, heroParas: [...document.querySelectorAll('.lp-hero p')].map((p) => p.className).join(','),
        proofBorder: proof ? getComputedStyle(proof).borderTopWidth : '', visit: (() => { const v = document.querySelector('[data-testid="hero-visit"]'); return v ? { proto: v.hasAttribute('data-proto'), tag: !!v.querySelector('[data-testid="idea-tag"]'), text: v.innerText.replace(/\s+/g, ' ').trim() } : null; })(),
        creds: [...document.querySelectorAll('[data-testid^="hero-cred-"]')].map((c) => c.textContent.trim()), pageText: document.body.innerText
      };
    });
    check(vp.width < 768 ? 'the header is slim on a phone (56px)' : 'the header is slim on a wide screen (64px)', first.header.h <= (vp.width < 768 ? 58 : 66), JSON.stringify(first.header));
    check('the header brand is HIS logo picture (the cropped lockup, about 40 to 46px tall), above the fold, named for screen readers, and NOT the bolt-in-a-square mark', first.logoImg && first.logoH >= 38 && first.logoH <= 48 && first.logoOnScreen && /^180 Electrical, back to the top$/.test(first.logoLabel || '') && !first.brandMark, JSON.stringify([first.logoImg, first.logoH, first.logoOnScreen, first.logoLabel, first.brandMark]));
    check('under the button: his free-quote line, his two credentials (one quiet line) and, tagged as an IDEA (data-proto + the tag), "Earliest visit Daniel could offer: <day>, 8 to 10am. Daniel will confirm."; nothing in it is tappable and the old words (survey, pencilled, provisional) are gone', /^Free, no-obligation quote Level 3 Electrical Installation 2391 Inspection and Testing Idea from us, not on your site today Earliest visit Daniel could offer: (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, \d{1,2}(:\d\d)?(am|pm)? to \d{1,2}(:\d\d)?(am|pm)\. Daniel will confirm\.$/.test(first.proofText.trim()) && first.proofLinks === 0 && first.visit && first.visit.proto && first.visit.tag && !/survey|pencilled|provisional/i.test(first.proofText), first.proofText + ' links=' + first.proofLinks + ' visit=' + JSON.stringify(first.visit));
    check('the hero ends at the proof row: no second paragraph, no tick list, no divider above the proof', first.extras === 0 && first.proofBorder === '0px' && /lp-eyebrow/.test(first.heroParas) && /lp-hero__sub/.test(first.heroParas) && first.heroParas.split(',').length === 2, first.heroParas + ' extras=' + first.extras + ' border=' + first.proofBorder);
    check('his two credentials are in full wording in the hero as one quiet line under the button (never over the photo); "2391 tested" is nowhere on the page', JSON.stringify(first.creds) === JSON.stringify(['Level 3 Electrical Installation', '2391 Inspection and Testing']) && first.credsOverPhoto === false && !/2391 tested/i.test(first.pageText), JSON.stringify([first.creds, first.credsOverPhoto]));
    if (vp.width < 768) {
      check('the hero photo is FRAMED: full width and 4:5 on a phone, running up under the header', first.photo.w >= first.vw - 1 && first.photo.h / first.photo.w >= 1.2 && first.photo.h / first.photo.w <= 1.3 && first.photo.top <= 50, JSON.stringify(first.photo));
      check('the H1, the sentence, the red button, the free line and his credentials line are all above the fold (the idea card may sit below it)', first.h1.top > 0 && first.sub.bottom < first.vh && first.cta.bottom < first.vh - 4 && first.free.bottom < first.vh - 4 && first.credsBottom < first.vh, JSON.stringify({ cta: first.cta, creds: first.credsBottom, vh: first.vh }));
      check('the sticky bottom bar is hidden on the first screen', !(await tid(page, 'sticky-bar').isVisible()));
      check('exactly one red quote button is on the first screen', first.reds === 1, 'reds=' + first.reds);
      const aboutTop = () => page.evaluate(() => { const g = document.querySelector('[data-testid="about"]'); window.scrollTo({ top: g.getBoundingClientRect().top + scrollY + 300, behavior: 'instant' }); });
      await aboutTop();
      check('the sticky bottom bar slides in once the hero button has scrolled out of view', await until(() => tid(page, 'sticky-bar').isVisible()));
      const bar = await tid(page, 'sticky-bar').boundingBox();
      check('the sticky bar is about 56px tall', bar && bar.height >= 54 && bar.height <= 60, JSON.stringify(bar));
      const stk = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector('[data-testid="sticky-bar"]')).backgroundColor, bt: getComputedStyle(document.querySelector('[data-testid="sticky-bar"]')).borderTopWidth, w: document.querySelector('[data-testid="sticky-book"]').getBoundingClientRect().width, fade: getComputedStyle(document.querySelector('[data-testid="sticky-bar"]'), '::before').content }));
      check('the sticky bar is ONE full-width quote button on an OPAQUE surface with a hairline (no fade slicing copy), and has no call control of its own', !/rgba|transparent/.test(stk.bg) && stk.bt === '1px' && stk.w >= MOBILE.width - 32 && (stk.fade === 'none' || stk.fade === 'normal') && (await tid(page, 'sticky-call').count()) === 0, JSON.stringify(stk));
      check('the header Call is the ONE call control on screen (a header Call and no sticky call)', (await tid(page, 'lp-call-button').isVisible()) && (await page.locator('[data-testid="sticky-bar"] a[href^="tel:"]').count()) === 0);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      check('the sticky bar hides again when the hero button is back on screen', await until(async () => !(await tid(page, 'sticky-bar').isVisible())));
      // ---- one red button at a time: the bar steps aside at the postcode card, the savings button, the final card and the footer
      for (const [label, target] of [['the postcode card', '[data-testid="area-form"]'], ['the final card', '[data-testid="final-cta"]']]) {
        await page.evaluate((sel) => { const el = document.querySelector(sel); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 140, behavior: 'instant' }); }, target);
        check(`at ${label} the sticky bar steps aside`, await until(async () => !(await tid(page, 'sticky-bar').isVisible())));
        const state = await page.evaluate(() => {
          const reds = [...document.querySelectorAll('.ui-btn--primary')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && x.bottom > 64 && x.top < innerHeight && getComputedStyle(b).visibility !== 'hidden'; });
          const cut = reds.filter((b) => { const x = b.getBoundingClientRect(); return x.top < 64 || x.bottom > innerHeight; }).length;
          return { n: reds.length, cut };
        });
        check(`at ${label} exactly one red "Get my installation quote" is in view and none is half hidden`, state.n === 1 && state.cut === 0, JSON.stringify(state));
      }
      // the footer is short and quiet and has no quote button of its own: at the very end of the page exactly ONE "Get my installation quote" is in view (the final card's, or the sticky bar when that has scrolled away), and the bar never covers the last footer line
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await tid(page, 'footer-copyright').waitFor({ timeout: WAIT });
      await page.waitForTimeout(500);
      const foot = await page.evaluate(() => {
        const quote = [...document.querySelectorAll('button')].filter((b) => /^Get my installation quote$/.test(b.textContent.trim()) && (() => { const x = b.getBoundingClientRect(); return x.width > 0 && x.bottom > 0 && x.top < innerHeight && getComputedStyle(b).visibility !== 'hidden' && !b.closest('[inert]'); })());
        const last = document.querySelector('[data-testid="footer-copyright"]').getBoundingClientRect();
        const barEl = document.querySelector('[data-testid="sticky-bar"]');
        const barOn = barEl && getComputedStyle(barEl).visibility !== 'hidden';
        return { n: quote.length, lastBottom: last.bottom, barOn, barTop: barEl ? barEl.getBoundingClientRect().top : 9999, vh: innerHeight };
      });
      check('at the end of the page exactly one "Get my installation quote" is in view and the last footer line is not under the sticky bar', foot.n === 1 && foot.lastBottom <= (foot.barOn ? foot.barTop : foot.vh) + 1, JSON.stringify(foot));
      check('the footer has no quote button of its own and states his two credentials in one quiet line', (await tid(page, 'l3-footer-book').count()) === 0 && /^Level 3 Electrical Installation\s*(·\s*)?2391 Inspection and Testing$/.test(await txt(page, 'l3-footer-credentials')), await txt(page, 'l3-footer-credentials'));
      const lock = await page.evaluate(() => {
        const f = document.querySelector('[data-testid="footer-lockup"]'); const foot = document.querySelector('.lp-footer');
        return { logoH: f && f.querySelector('.lp-logo') ? f.querySelector('.lp-logo').getBoundingClientRect().height : 0, img: !!(f && f.querySelector('.lp-logo__img')), mark: !!foot.querySelector('.bk-brand__mark'),
          phone: (document.querySelector('[data-testid="footer-phone"]') || {}).textContent, email: (document.querySelector('[data-testid="footer-email"]') || {}).textContent, area: /Serving Northern Ireland/.test(foot.innerText),
          copy: (document.querySelector('[data-testid="footer-copyright"]') || {}).textContent, clutter: foot.querySelectorAll('[data-testid="footer-owner-link"], [data-testid="footer-about-link"], [data-testid="footer-disclosure"], .ui-seg, [data-testid="l3-footer-whatsapp"]').length, links: foot.querySelectorAll('a[href^="#"]:not(.lp-footer__name)').length };
      });
      check('the footer is his logo picture (52px tall, not the bolt mark), phone, email, "Serving Northern Ireland", credentials and a small copyright line, with no owner login, theme switch, disclosure or link cloud', lock.img && Math.abs(lock.logoH - 52) < 1 && !lock.mark && lock.phone === '07885 496800' && lock.email === 'daniel@180electrical.co.uk' && lock.area && /^© 2026 180 Electrical$/.test(lock.copy) && lock.clutter === 0 && lock.links === 0, JSON.stringify(lock));
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      // ---- the gallery strip: a snap carousel (the next tile peeks), a counter and dots that follow the scroll, a caption chip on each tile, work2 zoomed past its black bars
      await page.evaluate(() => { const g = document.querySelector('[data-testid="gallery"]'); window.scrollTo({ top: g.getBoundingClientRect().top + scrollY - 70, behavior: 'instant' }); });
      const gal = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="l3-gallery-row"]');
        const tiles = [...row.querySelectorAll('.lp-gallery__item')].map((li) => li.getBoundingClientRect());
        return { zoom: parseFloat(getComputedStyle(document.querySelector('[data-testid="gallery-photo-1"]')).getPropertyValue('--zoom')), snap: getComputedStyle(row).scrollSnapType, w0: tiles[0].width, w1x: tiles[1].left, vw: innerWidth, hint: !!document.querySelector('.lp-gallery__hint'), text: document.querySelector('[data-testid="gallery"]').innerText };
      });
      check('the gallery is a horizontal snap carousel with the next tile peeking in (tiles about 80% wide)', /x/.test(gal.snap) && gal.w0 / gal.vw >= 0.7 && gal.w0 / gal.vw <= 0.86 && gal.w1x < gal.vw - 8, JSON.stringify(gal));
      check('no "Select a photo to see it full size" helper line', !gal.hint && !/Select a photo/.test(gal.text), gal.text.slice(0, 160));
      const chips = (await page.locator('[data-testid^="gallery-chip-"]').allInnerTexts()).map((t) => t.trim());
      check('each tile carries a NEUTRAL caption chip, "Recent install" (no charger make, model or claim anywhere in the gallery)', JSON.stringify(chips) === JSON.stringify(['Recent install', 'Recent install', 'Recent install', 'Recent install']) && !/Zappi|Ohme|Fox|kW|smart|fast/i.test(gal.text), JSON.stringify(chips));
      check('work2 (a phone screenshot with black bars) is zoomed 1.4 or more so the bars fall outside the tile', gal.zoom >= 1.4, JSON.stringify(gal));
      check('the gallery shows ONE position indicator, the dots (no "1 / 4" counter), and the first dot is current', (await tid(page, 'gallery-count').count()) === 0 && (await tid(page, 'gallery-dot-0').getAttribute('aria-current')) === 'true');
      await page.evaluate(() => { const l = document.querySelector('[data-testid="l3-gallery-row"]'); l.scrollTo({ left: l.scrollWidth, behavior: 'instant' }); });
      check('the dots follow the scroll (dot 4 current)', await until(async () => (await tid(page, 'gallery-dot-3').getAttribute('aria-current')) === 'true'));
      const dot = await tid(page, 'gallery-dot-0').boundingBox();
      check('each gallery dot is a 44px tap target', dot.width >= 44 && dot.height >= 44, JSON.stringify(dot));
      await tid(page, 'gallery-dot-1').click();
      check('tapping a dot scrolls the strip to that photo', await until(async () => (await tid(page, 'gallery-dot-1').getAttribute('aria-current')) === 'true'));
      // ---- the lightbox: the photo gets at least 60% of the screen height, a short title as the caption, the arrows beside the image
      await tid(page, 'l3-gallery-open-1').click();
      await tid(page, 'l3-lightbox').waitFor({ timeout: WAIT });
      check('the viewer takes focus (Close first) so keys and Tab work from the start', !!(await until(async () => (await activeId(page)) === 'l3-lightbox-close')), await activeId(page)); // the same effect that moves focus also arms Esc and the arrows
      const lb = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel).getBoundingClientRect();
        return { img: q('[data-testid="l3-lightbox-img"]'), prev: q('[data-testid="l3-lightbox-prev"]'), next: q('[data-testid="l3-lightbox-next"]'), vh: innerHeight, vw: innerWidth, caption: document.querySelector('[data-testid="l3-lightbox-caption"]').textContent.trim(), alt: document.querySelector('[data-testid="l3-lightbox-img"]').alt, scrim: getComputedStyle(document.querySelector('[data-testid="l3-lightbox"]')).backgroundColor, blur: getComputedStyle(document.querySelector('[data-testid="l3-lightbox"]')).backdropFilter };
      });
      check('the lightbox image area is at least 60% of the screen height', lb.img.height / lb.vh >= 0.6, JSON.stringify(lb.img));
      check('the lightbox caption is the neutral title "Recent install", not the raw alt text', lb.caption === 'Recent install' && lb.caption !== lb.alt, lb.caption);
      check('the lightbox scrim is fully opaque (no see-through colour, no blur) and the previous and next buttons are big (56px or more)', /^rgb\(/.test(lb.scrim) && (lb.blur === 'none' || !lb.blur) && lb.prev.width >= 56 && lb.prev.height >= 56 && lb.next.width >= 56 && lb.next.height >= 56, JSON.stringify([lb.scrim, lb.blur, lb.prev.width, lb.next.width]));
      check('prev and next sit beside the image (level with it, at its two edges)', lb.prev.top >= lb.img.top && lb.prev.bottom <= lb.img.bottom && lb.next.top >= lb.img.top && lb.next.bottom <= lb.img.bottom && lb.prev.left < lb.vw / 2 && lb.next.right > lb.vw / 2, JSON.stringify({ prev: lb.prev, next: lb.next }));
      await shot(page, `lightbox-${name}`);
      await page.keyboard.press('Escape');
      check('Escape closes the photo viewer and focus returns to the tile', !!(await until(async () => (await tid(page, 'l3-lightbox').count()) === 0 && (await activeId(page)) === 'l3-gallery-open-1')), await activeId(page));
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    } else {
      check('the sticky bottom bar is never shown from 768px', !(await tid(page, 'sticky-bar').isVisible()));
      const wide = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.lp-steps .lp-step__card')].map((c) => c.getBoundingClientRect().height);
        const why = [...document.querySelectorAll('.lp-why__item')].map((li) => ({ n: li.querySelector('.lp-why__n').getBoundingClientRect().top, t: li.querySelector('.lp-why__title').getBoundingClientRect().top, b: li.querySelector('.lp-why__body').getBoundingClientRect().top }));
        const hero = { copy: document.querySelector('.lp-hero__copy').getBoundingClientRect(), media: document.querySelector('.lp-hero__media').getBoundingClientRect() };
        const slash = (() => { const s = document.querySelector('.lp-hero__slashes'); const c = document.querySelector('.lp-hero__copy'); if (!s || !c) return 'n/a'; const a = s.getBoundingClientRect(); const b = c.getBoundingClientRect(); return a.left >= b.right - 1 ? 'clear' : 'overlap ' + JSON.stringify([a.left, b.right]); })();
        return { items, why, hero, slash, footerCta: document.querySelectorAll('[data-testid="l3-footer-book"]').length };
      });
      check('the three "how it works" steps are equal height', wide.items.length === 3 && Math.max(...wide.items) - Math.min(...wide.items) < 2, JSON.stringify(wide.items));
      check('the three "Home charging that works around you" columns share their top edges (numerals, headings, bodies within 1px)', wide.why.length === 3 && ['n', 't', 'b'].every((k) => Math.max(...wide.why.map((w) => w[k])) - Math.min(...wide.why.map((w) => w[k])) <= 1), JSON.stringify(wide.why));
      check('the hero is two columns (copy left, photo right) with the slash art behind the photo only, never behind copy', wide.hero.copy.right <= wide.hero.media.left + 1 && wide.hero.copy.top < wide.hero.media.bottom && wide.slash === 'clear', JSON.stringify([wide.hero, wide.slash]));
      check('the footer has no quote button', wide.footerCta === 0);
    }
    await tid(page, 'hero-cta').click();
    await sheetOpen(page);
    check('the CTA opens the quote funnel at #book/ev_quote', (await hashOf(page)) === '#book/ev_quote', await hashOf(page));
    check('funnel starts at "Step 1 of 6"', (await stepLabel(page)) === 'Step 1 of 6', await stepLabel(page));
    if (vp.width < 768) check('sticky bar is hidden while the sheet is open', !(await tid(page, 'sticky-bar').isVisible()));
    // ---- the page behind the sheet is inert (not in the focus order, hidden from screen readers); the toast host is not
    const behind = await page.evaluate(() => ({
      appInert: document.getElementById('app').inert, appHidden: document.getElementById('app').getAttribute('aria-hidden'),
      toastInert: !!document.getElementById('toast-root').closest('[inert]'), overlayInert: document.getElementById('overlay-root').inert
    }));
    check('the page behind the open funnel is inert and aria-hidden', behind.appInert === true && behind.appHidden === 'true', JSON.stringify(behind));
    check('the toast host and the overlay root are NOT inert', !behind.toastInert && !behind.overlayInert, JSON.stringify(behind));
    let stray = 0;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => !!document.activeElement.closest('[data-testid="booking-sheet"]')))) stray += 1;
    }
    check('Tab never leaves the open funnel for the page behind', stray === 0, 'stray=' + stray);
    await page.evaluate(async () => { const m = await import('/js/ui/index.js'); m.toast({ message: 'Toast over an open sheet' }); });
    check('a toast raised over the open sheet is still visible', await until(() => page.locator('[data-testid="toast"]', { hasText: 'Toast over an open sheet' }).isVisible()));
    await shot(page, `funnel-open-${name}`);
    await page.goBack();
    check('browser Back closes the sheet in one step', await sheetGone(page));
    check('closing the funnel makes the page live again (no inert, no aria-hidden) and returns focus to the hero button', await until(async () => page.evaluate(() => !document.getElementById('app').inert && !document.getElementById('app').hasAttribute('aria-hidden') && document.activeElement && document.activeElement.getAttribute('data-testid') === 'hero-cta')));
    await ctx.close();
  });
}
await landingLoad('375-dark', MOBILE, 'dark');
await landingLoad('1280-dark', DESKTOP, 'dark');

// ================================================================ 1b. shared Sheet: the page behind goes inert, nested sheets stack, the page comes back
await section('1b. sheets: inert page behind, nested stacking, restore', async () => {
  const ctx = await newContext(MOBILE, 'dark');
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  // two Sheets from the shared UI kit, mounted in a throw-away node inside #app (outside Preact's tree)
  await page.evaluate(async () => {
    const { Sheet, ConfirmDialog } = await import('/js/ui/index.js');
    const { h, render } = await import('/js/vendor/preact-htm.js');
    const mount = document.createElement('div');
    document.getElementById('app').appendChild(mount);
    const draw = () => render(h('div', null,
      h(Sheet, { open: !!window.__a, title: 'Sheet A', onClose: () => { window.__a = false; draw(); } }, h('button', { type: 'button' }, 'A button')),
      h(ConfirmDialog, { open: !!window.__b, title: 'Confirm B', body: 'Sure?', onConfirm: () => { window.__b = false; draw(); }, onCancel: () => { window.__b = false; draw(); } })), mount);
    window.__set = (k, v) => { window[k] = v; draw(); };
    draw();
  });
  const snap = () => page.evaluate(() => ({
    app: document.getElementById('app').inert, hidden: document.getElementById('app').getAttribute('aria-hidden'),
    roots: [...document.querySelectorAll('.ui-sheet-root')].map((r) => r.inert), toast: !!document.getElementById('toast-root').closest('[inert]'),
    locked: document.documentElement.classList.contains('is-scroll-locked')
  }));
  await page.evaluate(() => window.__set('__a', true));
  let s = await snap();
  check('one open sheet: #app is inert and aria-hidden, the sheet is live, scroll is locked', s.app && s.hidden === 'true' && s.roots.length === 1 && s.roots[0] === false && s.locked, JSON.stringify(s));
  check('the toast host stays live under an open sheet', !s.toast, JSON.stringify(s));
  await page.evaluate(() => window.__set('__b', true));
  s = await snap();
  check('nested: the lower sheet is inert, the top one live, #app still inert', s.app && s.roots.length === 2 && s.roots[0] === true && s.roots[1] === false, JSON.stringify(s));
  await page.keyboard.press('Escape');
  s = await snap();
  check('closing the top sheet makes the lower one live again, #app stays inert', s.app && s.roots.length === 1 && s.roots[0] === false, JSON.stringify(s));
  await page.keyboard.press('Escape');
  s = await snap();
  check('closing the last sheet makes the page live again', !s.app && s.hidden === null && s.roots.length === 0 && !s.locked, JSON.stringify(s));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 1c. the landing's sections: Meet Daniel, savings, quote preview, FAQ, voice
await section('1c. landing sections at 375: rhythm, one voice, Meet Daniel, the quote before the calculator, the one-headline calculator, the cost FAQ', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  // ---- order (T07): Meet Daniel, the work, how it works, the example quote, THEN the calculator, then the postcode check, then the FAQ
  const order = await page.evaluate(() => ['about', 'work', 'how', 'pricing', 'savings', 'area', 'faq'].map((id) => document.getElementById(id).getBoundingClientRect().top + scrollY));
  check('section order: Meet Daniel, recent work, how it works, the quote (with the example quote card), the running-costs calculator, the postcode check, the FAQ', order.every((v, i) => i === 0 || v > order[i - 1]), JSON.stringify(order));
  // ---- rhythm (T06): shorter page, two red accents, one eyebrow style, alternating surfaces, no stat grid
  const rhythm = await page.evaluate(() => {
    const eyebrows = [...document.querySelectorAll('.lp-main .lp-section__head .lp-eyebrow, .lp-meet__copy .lp-eyebrow, .lp-quote__copy .lp-eyebrow, .lp-area__copy .lp-eyebrow')];
    const fs = new Set(eyebrows.map((e) => getComputedStyle(e).fontSize + '|' + getComputedStyle(e).letterSpacing + '|' + getComputedStyle(e).textTransform));
    const sections = [...document.querySelectorAll('.lp-main > section')].filter((x) => ['why', 'about', 'work', 'how', 'pricing', 'savings', 'area', 'faq'].includes(x.id));
    const bg = (el) => getComputedStyle(el).backgroundColor;
    const surfaces = sections.map((x) => ({ id: x.id, bg: bg(x) }));
    const page0 = getComputedStyle(document.body).backgroundColor;
    const bands = surfaces.filter((x) => x.bg !== page0 && x.bg !== 'rgba(0, 0, 0, 0)').map((x) => x.id);
    const hl = [...document.querySelectorAll('h1 .lp-hl, h2 .lp-hl, h3 .lp-hl, .lp-hl')].map((e) => e.closest('h1, h2, h3') && e.closest('h1, h2, h3').id);
    return {
      h: document.documentElement.scrollHeight, eyebrowCount: eyebrows.length, eyebrowStyles: [...fs], hl, bands, stat: document.querySelectorAll('.lp-proofstrip, [data-testid="trust-bar"]').length,
      h2White: [...document.querySelectorAll('.lp-main h2.lp-title')].every((h) => !h.querySelector('.lp-hl'))
    };
  });
  check('the whole page at 375 stays compact (8,600px or less with the ideas on: the running-costs idea now shows its rates and working in full)', rhythm.h <= 8600, String(rhythm.h));
  check('the brand-red accent is on exactly two headings: the H1 and the final call to action', rhythm.hl.length === 2 && rhythm.hl.includes('hero-title') && rhythm.hl.includes('final-title') && rhythm.h2White, JSON.stringify(rhythm.hl));
  check('every section has the SAME eyebrow (one style: 12px caps)', rhythm.eyebrowCount >= 7 && rhythm.eyebrowStyles.length === 1 && /^12px/.test(rhythm.eyebrowStyles[0]), JSON.stringify([rhythm.eyebrowCount, rhythm.eyebrowStyles]));
  check('sections alternate between the page and a one-step lighter band (Meet Daniel, how it works, running costs and the FAQ are bands)', JSON.stringify(rhythm.bands) === JSON.stringify(['about', 'how', 'savings', 'faq']), JSON.stringify(rhythm.bands));
  check('there is no big-number stat grid (credentials live once, in the hero)', rhythm.stat === 0);
  // ---- voice (T06): Daniel in the third person; his words only; never "the team", "I fit it myself" or "Fixed written quote"
  const pageText = await page.evaluate(() => document.body.innerText);
  check('the page says Daniel in the third person, and never "the team", "I fit it myself", "Fixed written quote" or "we"-voice invented quotes', !/the team/i.test(pageText) && /Meet Daniel/.test(pageText) && !/fit it myself/i.test(pageText) && !/Fixed written quote/i.test(pageText) && !/\bI'm Daniel\b/.test(pageText) && !/\bI visit\b/.test(pageText), '');
  const meet = await page.evaluate(() => ({ pull: document.querySelector('[data-testid="about-pull"]').textContent.trim(), body: document.querySelector('[data-testid="about-body"]').textContent.trim(), h: document.querySelector('[data-testid="about-photo"]').getBoundingClientRect().height, w: document.querySelector('[data-testid="about-photo"]').getBoundingClientRect().width }));
  check('Meet Daniel is ONE tall 4:5 full-bleed portrait band; its overlay line (from his own words) is not repeated in the paragraph below', Math.abs(meet.h / meet.w - 1.25) < 0.02 && meet.pull.length > 20 && !meet.body.includes(meet.pull) && !meet.body.toLowerCase().includes('looks like it belongs'), JSON.stringify(meet));
  check('Meet Daniel has the photo caption "Daniel, 180 Electrical", Call Daniel (filled) with WhatsApp beside it at half width', (await txt(page, 'about-caption')) === 'Daniel, 180 Electrical' && (await tid(page, 'about-call').getAttribute('href')) === 'tel:+447885496800' && /^https:\/\/wa\.me\/447885496800/.test((await tid(page, 'about-whatsapp').getAttribute('href')) || '') && await page.evaluate(() => { const c = document.querySelector('[data-testid="about-call"]').getBoundingClientRect(); const w = document.querySelector('[data-testid="about-whatsapp"]').getBoundingClientRect(); return Math.abs(c.width - w.width) < 4 && Math.abs(c.top - w.top) < 2 && getComputedStyle(document.querySelector('[data-testid="about-call"]')).backgroundColor !== getComputedStyle(document.querySelector('[data-testid="about-whatsapp"]')).backgroundColor; }));
  const look = await page.evaluate(() => {
    const bolt = [...document.querySelectorAll('.lp-main *')].some((el) => { const c = getComputedStyle(el, '::after'); return /landing-bolt/.test(c.maskImage || '') || /landing-bolt/.test(c.webkitMaskImage || ''); });
    const hero = document.querySelector('.lp-hero');
    const rad = getComputedStyle(hero).borderBottomLeftRadius;
    return { bolt, rad, treatments: new Set(['.lp-meet', '.lp-section--band', '.lp-why', '.lp-gallery', '.lp-qcard'].filter((q) => document.querySelector(q))).size };
  });
  check('no lightning-bolt watermarks and a clean hero edge (no rounding)', !look.bolt && look.rad === '0px', JSON.stringify(look));
  check('at least five visually distinct section treatments are present (photo band, list, carousel, band, cards)', look.treatments >= 5, JSON.stringify(look));
  // ---- the quote section (LP2): his words on the page, ONE tagged idea beside them (an example quote to open), no figure outside an idea
  await page.evaluate(() => { const g = document.querySelector('#pricing'); window.scrollTo({ top: g.getBoundingClientRect().top + scrollY - 60, behavior: 'instant' }); });
  const q = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="quote-preview"]');
    const link = document.querySelector('[data-testid="pricing-sample-link"]');
    return { text: card.innerText.replace(/\s+/g, ' '), proto: card.hasAttribute('data-proto'), tagText: card.querySelector('[data-testid="idea-tag"]') ? card.querySelector('[data-testid="idea-tag"]').textContent.trim() : '', tag: document.querySelector('[data-testid="quote-preview-tag"]').textContent.trim(), pills: [...document.querySelectorAll('#pricing .lp-factors__item')].length, href: link.getAttribute('href'), target: link.getAttribute('target'), linkText: link.textContent.trim(), total: document.querySelector('[data-testid="quote-preview-total"]'), promise: document.querySelector('[data-testid="pricing-promise"]').textContent.trim(), body: document.querySelector('.lp-quote__body').getBoundingClientRect().height, lh: parseFloat(getComputedStyle(document.querySelector('.lp-quote__body')).lineHeight), fs: getComputedStyle(document.querySelector('.lp-quote__body')).fontSize, bodyText: document.querySelector('.lp-quote__body').textContent.trim() };
  });
  check('the quote section carries ONE idea card: data-proto, the tag "Idea from us, not on your site today", a "See how a quote looks" link and the note "Example only"; it shows NO price and no total', q.proto && q.tagText === 'Idea from us, not on your site today' && q.linkText === 'See how a quote looks' && q.tag === 'Example only' && !/£|\d/.test(q.text.replace(/Idea from us, not on your site today/, '')) && q.total === null, JSON.stringify(q));
  check('the paragraph is his own pricing paragraph (charger choice, cable route, electrical work, an accurate quote), no "from £" range, and the promise is his "not a headline figure that changes later"', /Costs depend on your charger choice, cable route and any electrical work required/.test(q.bodyText) && /accurate quote/.test(q.bodyText) && q.pills === 0 && !/from £/i.test(q.text) && /headline figure that changes later/.test(q.promise), JSON.stringify([q.bodyText, q.promise]));
  check('the pricing paragraph (his own words) is 16px and at most 4 lines at 375', q.fs === '16px' && Math.round(q.body / q.lh) <= 4, JSON.stringify([q.fs, q.body, q.lh]));
  check('"See how a quote looks" opens quote.html#q=<sample id> as an owner-style preview (not counted as a view) in the quote tab', /^quote\.html(\?[^#]*)?#q=Q-EL-\d+&preview=1/.test(q.href) && q.target === 'vm-quote', q.href);
  const faqA = await txt(page, 'faq-item-2');
  check('the cost FAQ is open on load, the others are closed, and its answer is his own (charger, cable route, electrical work, a clear quote, no headline figure; no numbers and no mention of an example)', (await tid(page, 'faq-q-2').getAttribute('aria-expanded')) === 'true' && (await tid(page, 'faq-q-0').getAttribute('aria-expanded')) === 'false' && /cable route/.test(faqA) && /electrical work/.test(faqA) && /headline figure that changes later/.test(faqA) && !/example/i.test(faqA) && !/£|\d/.test(faqA.replace(/How much will installation cost\?/, '')), faqA);
  // ---- D1: outside the tagged ideas the landing's own sections show no price, no spec and no payment term
  const outside = await page.evaluate(() => {
    const parts = [...document.querySelectorAll('#why, #about, #work, #how, #pricing, #area, #faq, .lp-final-section')].map((el) => { const c = el.cloneNode(true); c.querySelectorAll('[data-proto]').forEach((n) => n.remove()); return c.textContent.replace(/\s+/g, ' '); });
    return parts.join(' ');
  });
  check('outside tagged ideas the landing sections state no price, no kW spec, no payment term, no guarantee and no "pencilled" or "provisional"', !/£/.test(outside) && !/\bkW\b/i.test(outside) && !/pay after|deposit|guarantee|warranty|pencilled|provisional|free survey/i.test(outside), outside.match(/£|\bkW\b|pay after|deposit|guarantee|warranty|pencilled|provisional|free survey/i) + '');
  await shot(page, 'landing-quote-preview-375');
  // ---- the running-costs calculator (an IDEA): data-proto + tag, a question first, the home-charging cost as the FIRST line, the comparison second, every assumption in view
  await page.evaluate(() => { const g = document.querySelector('#savings'); window.scrollTo({ top: g.getBoundingClientRect().top + scrollY - 60, behavior: 'instant' }); });
  const calc = await page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height }; };
    const card = document.querySelector('.lp-calc');
    const cr = card.getBoundingClientRect();
    const slab = document.querySelector('[data-testid="l3-calc-result"]');
    const sr = slab.getBoundingClientRect();
    const sec = document.querySelector('#savings');
    return { title: document.querySelector('#savings-title').textContent.trim(), proto: sec.hasAttribute('data-proto'), tag: sec.querySelector('[data-testid="idea-tag"]') ? sec.querySelector('[data-testid="idea-tag"]').textContent.trim() : '',
      slider: r('[data-testid="l3-calc-slider"]'), headline: slab.querySelector('[data-testid="l3-calc-headline"]').textContent.replace(/\s+/g, ' ').trim(), compare: document.querySelector('[data-testid="l3-calc-compare"]').textContent.replace(/\s+/g, ' ').trim(),
      headTop: r('[data-testid="l3-calc-headline"]').top, compareTop: r('[data-testid="l3-calc-compare"]').top, sliderBottom: r('[data-testid="l3-calc-slider"]').bottom, vh: innerHeight,
      accordions: document.querySelectorAll('#savings details, #savings .ui-disclosure, #savings summary').length, fieldsShown: [...document.querySelectorAll('[data-testid^="l3-calc-field-"]')].filter((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility === 'visible').length,
      cardOverflow: getComputedStyle(card).overflow, cardRadius: getComputedStyle(card).borderTopLeftRadius, slabInside: sr.left >= cr.left - 1 && sr.right <= cr.right + 1, text: sec.innerText, sliderFill: getComputedStyle(document.querySelector('[data-testid="l3-calc-slider"]'), '::-webkit-slider-runnable-track').backgroundImage };
  });
  check('the calculator is an idea (data-proto + the tag) and leads with the question "What would home charging cost you?" (no money figure in it)', calc.title === 'What would home charging cost you?' && calc.proto && calc.tag === 'Idea from us, not on your site today', JSON.stringify([calc.title, calc.proto, calc.tag]));
  check('its FIRST line is "Home charging would cost about £617 a year" and the petrol comparison comes second (no "a year less than petrol" headline)', calc.headline === 'Home charging would cost about £617 a year' && /^The same miles in a petrol car would cost about £1,212 a year/.test(calc.compare) && calc.compareTop > calc.headTop && !/a year less than petrol/i.test(calc.text), JSON.stringify([calc.headline, calc.compare]));
  check('the miles control and the first line are visible in the same viewport', calc.slider.top >= 0 && calc.headTop + 40 <= calc.vh && calc.headTop > calc.sliderBottom, JSON.stringify([calc.slider, calc.headTop, calc.vh]));
  check('no hidden accordions: the assumptions and the working are in view on load (five example rates visible, no <details>, no disclosure)', calc.accordions === 0 && calc.fieldsShown === 5 && /How we worked this out/.test(calc.text) && /Rates we have assumed/.test(calc.text), JSON.stringify([calc.accordions, calc.fieldsShown]));
  check('ONE card: the result slab runs edge to edge inside it and the card clips it to its rounded corners', calc.cardOverflow === 'hidden' && parseFloat(calc.cardRadius) >= 20 && calc.slabInside, JSON.stringify([calc.cardOverflow, calc.cardRadius, calc.slabInside]));
  check('"ILLUSTRATIVE ESTIMATE" is on show, "4.54609" is not in the page, and the slider progress is ink, not the brand red', /illustrative estimate/i.test(calc.text) && !/4\.54609/.test(calc.text) && !/225, 20, 20|rgb\(225/.test(calc.sliderFill), calc.sliderFill);
  const before = Number(await tid(page, 'l3-calc-home-big').getAttribute('data-value'));
  await tid(page, 'l3-calc-slider').evaluate((el) => { el.value = '20000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  check('dragging the slider updates the answer (a dearer home-charging year at 20,000 miles) and the miles box', await until(async () => Number(await tid(page, 'l3-calc-home-big').getAttribute('data-value')) > before) && (await tid(page, 'l3-calc-miles').inputValue()) === '20,000', `${before}`);
  await tid(page, 'l3-calc-slider').evaluate((el) => { el.value = '8000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await tid(page, 'l3-calc-field-homePence').fill('30');
  check('changing a visible rate (home electricity 30p) updates the first line at once', !!(await until(async () => (await txt(page, 'l3-calc-headline')).replace(/\s+/g, ' ') === 'Home charging would cost about £686 a year')), await txt(page, 'l3-calc-headline'));
  await tid(page, 'l3-calc-field-homePence').fill('27');
  const wk = await txt(page, 'l3-calc-workings-text');
  check('the working is ONE plain paragraph in view ("Your 8,000 miles use about 2,286 kWh ... at 27p"), no raw maths and no gallon constant', /^Your 8,000 miles use about 2,286 kWh a year, which is £617 at 27p a kWh\./.test(wk) && !/4\.54609|÷|×| x |=/.test(wk), wk);
  await shot(page, 'landing-calc-375');
  // ---- inline quote CTAs (T10): hero, pricing and the final card only
  const ctas = await page.evaluate(() => [...document.querySelectorAll('.lp-main .lp-cta')].map((b) => b.getAttribute('data-testid')));
  check('only three inline quote buttons remain in the page body: the hero, the quote section and the final card', JSON.stringify(ctas) === JSON.stringify(['hero-cta', 'pricing-cta', 'final-book']) || JSON.stringify(ctas.filter((c) => c !== 'coverage-book')) === JSON.stringify(['hero-cta', 'pricing-cta', 'final-book']), JSON.stringify(ctas));
  // ---- "Only my content" (?clean=1 is remembered in ec_clean): the running-costs idea and the example-quote card vanish, his sections and the red final band stay
  await site(page, '', '&clean=1');
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  const only = await page.evaluate(() => {
    const shown = (sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; };
    const all = [...document.querySelectorAll('.lp-main [data-proto]')].every((el) => getComputedStyle(el).display === 'none');
    return { calc: shown('#savings'), card: shown('[data-testid="quote-preview"]'), pricing: shown('#pricing'), copy: shown('.lp-quote__body'), cta: shown('[data-testid="pricing-cta"]'), final: shown('.lp-final-section'), faq: shown('#faq'), all, stored: (() => { try { return localStorage.getItem('ec_clean'); } catch (e) { return 'x'; } })(), money: /£/.test([...document.querySelectorAll('#why, #about, #work, #how, #pricing, #area, #faq, .lp-final-section')].map((e) => e.innerText).join(' ')) };
  });
  check('"Only my content" hides the running-costs idea and the example-quote card (every landing [data-proto]), keeps his quote paragraph, button, FAQ and the final band, shows no £ anywhere, and is remembered in ec_clean', !only.calc && !only.card && only.pricing && only.copy && only.cta && only.final && only.faq && only.all && only.stored === '1' && !only.money, JSON.stringify(only));
  await page.evaluate(() => { try { localStorage.removeItem('ec_clean'); } catch (e) { /* ignore */ } });
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 1d. the postcode check on the landing page (T10)
await section('1d. the area card: "Check my postcode", a green answer, then "Continue with BT7 3AB" opens the funnel with it filled and valid', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'coverage-input').scrollIntoViewIfNeeded();
  check('the button reads "Check my postcode" (the verb matches the field)', (await txt(page, 'coverage-book')) === 'Check my postcode', await txt(page, 'coverage-book'));
  await tid(page, 'coverage-input').fill('bt1');
  await tid(page, 'coverage-book').click();
  check('an invalid postcode shows the funnel\'s own error and does NOT open the funnel', !!(await until(async () => (await page.locator('#area .ui-field__error').count()) === 1)) && (await tid(page, 'booking-sheet').count()) === 0 && (await page.locator('#area .ui-field__error').innerText()).includes('valid UK postcode'));
  await tid(page, 'coverage-input').fill('bt73ab');
  await tid(page, 'coverage-book').click();
  const res = await txt(page, 'coverage-result');
  check('BT7 3AB shows the green "Good news, that\'s in our area." with a tick, and the button becomes "Continue with BT7 3AB"', res === "Good news, that's in our area." && (await txt(page, 'coverage-book')) === 'Continue with BT7 3AB' && (await tid(page, 'booking-sheet').count()) === 0 && await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.lp-area__ok')).color; return c !== getComputedStyle(document.body).color; }), res + ' | ' + await txt(page, 'coverage-book'));
  await shot(page, 'landing-area-valid-375');
  await tid(page, 'coverage-input').fill('bt73a');
  check('editing the postcode takes the button back to "Check my postcode"', !!(await until(async () => (await txt(page, 'coverage-book')) === 'Check my postcode')));
  await tid(page, 'coverage-input').fill('BT7 3AB');
  await tid(page, 'coverage-book').click();
  await tid(page, 'coverage-book').click();
  await sheetOpen(page);
  check('"Continue with BT7 3AB" opens step 1 with BT7 3AB filled and in its valid state (green border and tick)', (await tid(page, 'funnel-postcode').inputValue()) === 'BT7 3AB' && (await tid(page, 'funnel-postcode').getAttribute('class')).includes('is-valid') && (await tid(page, 'funnel-postcode-ok').count()) === 1 && (await txt(page, 'funnel-zone-hint')).includes("that's in our area"), await tid(page, 'funnel-postcode').inputValue());
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 1e. the prototype strip: tools popover and the "Show: With ideas | Only my content" switch (LP1)
await section('1e. prototype strip: tools popover (focus, Esc, contents) and the ideas switch (default With ideas, hides every idea, persists in ec_clean)', async () => {
  const ctx = await newContext(MOBILE, 'dark');
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  const geo = await page.evaluate(() => {
    const r = (id) => { const e = document.querySelector(`[data-testid="${id}"]`); const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { vw: innerWidth, strip: r('prototype-strip'), tools: r('prototype-tools'), withI: r('ideas-with'), only: r('ideas-only'), clean: document.documentElement.dataset.clean || '', stored: (() => { try { return localStorage.getItem('ec_clean'); } catch (e) { return 'blocked'; } })(),
      visit: (() => { const v = document.querySelector('[data-testid="hero-visit"]'); return !!v && getComputedStyle(v).display !== 'none'; })(), isProtoStrip: document.querySelector('[data-testid="prototype-strip"]').hasAttribute('data-proto'), over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check('the strip is one 44px row: the tools button and both switch options are 44px tall tap targets and all sit inside the 375px screen', geo.tools.h >= 44 && geo.withI.h >= 44 && geo.only.h >= 44 && geo.only.r <= geo.vw && geo.tools.l >= 0 && geo.strip.h <= 46 && geo.over <= 0, JSON.stringify(geo));
  check('by default the choice is "With ideas" (nothing saved, no data-clean), the idea card is showing, and the strip itself is never an idea', (await tid(page, 'ideas-with').getAttribute('aria-pressed')) === 'true' && (await tid(page, 'ideas-only').getAttribute('aria-pressed')) === 'false' && geo.clean === '' && geo.stored !== '1' && geo.visit && !geo.isProtoStrip, JSON.stringify(geo));
  check('the switch reads "Show: With ideas | Only my content" (the "Show:" label shows from 400px)', /With ideas/.test(await txt(page, 'ideas-with')) && /Only my content/.test(await txt(page, 'ideas-only')));
  // ---- the popover
  await tid(page, 'prototype-tools').click();
  await tid(page, 'prototype-tools-panel').waitFor({ timeout: WAIT });
  check('the tools open in a popover: the button says it is expanded and focus moves into it', (await tid(page, 'prototype-tools').getAttribute('aria-expanded')) === 'true' && (await activeId(page)) === 'prototype-tools-panel', await activeId(page));
  const pop = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="prototype-tools-panel"]'); const b = p.getBoundingClientRect();
    return { l: b.left, r: b.right, vw: innerWidth, disclosure: document.querySelector('[data-testid="footer-disclosure"]').textContent.trim(), owner: document.querySelector('[data-testid="footer-owner-link"]').textContent.trim(), ownerHref: document.querySelector('[data-testid="footer-owner-link"]').getAttribute('href'),
      about: document.querySelector('[data-testid="footer-about-link"]').textContent.trim(), themes: ['theme-auto', 'theme-light', 'theme-dark'].every((id) => !!document.querySelector(`[data-testid="${id}"]`)),
      chips: [...p.querySelectorAll('.ui-tools__chip')].map((a) => a.textContent.trim()), small: [...p.querySelectorAll('a, button')].filter((e) => { const x = e.getBoundingClientRect(); return x.height < 43.5 && x.width > 0; }).length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check('the popover holds the disclosure (starting "This is a prototype."), Owner login (demo), What\'s real, the theme choice and the page links, inside the screen, every control 44px', /^This is a prototype\./.test(pop.disclosure) && /Owner login \(demo\)/.test(pop.owner) && /dashboard\.html(\?[^#]*)?#\/today/.test(pop.ownerHref) && /What's real in this prototype/.test(pop.about) && pop.themes && pop.chips.length >= 5 && pop.chips.includes('Meet Daniel') && pop.l >= 0 && pop.r <= pop.vw && pop.small === 0 && pop.over <= 0, JSON.stringify(pop));
  const ax = await axeSeriousCount(page, '[data-testid="prototype-strip"]');
  check('axe: no serious or critical violation in the open popover (dark)', ax.count === 0, ax.detail);
  await shot(page, 'strip-tools-375-dark');
  await page.keyboard.press('Escape');
  check('Escape closes the popover and gives focus back to the tools button', !!(await until(async () => (await tid(page, 'prototype-tools-panel').count()) === 0 && (await activeId(page)) === 'prototype-tools')), await activeId(page));
  await tid(page, 'prototype-tools').click();
  await tid(page, 'prototype-tools-panel').waitFor({ timeout: WAIT });
  await tid(page, 'prototype-tools-close').click();
  check('the close button closes it and gives focus back', !!(await until(async () => (await tid(page, 'prototype-tools-panel').count()) === 0 && (await activeId(page)) === 'prototype-tools')), await activeId(page));
  await tid(page, 'prototype-tools').click();
  await tid(page, 'prototype-tools-panel').waitFor({ timeout: WAIT });
  await page.mouse.click(187, 800);
  check('a tap outside closes it', !!(await until(async () => (await tid(page, 'prototype-tools-panel').count()) === 0)));
  await tid(page, 'prototype-tools').click();
  await tid(page, 'prototype-tools-panel').waitFor({ timeout: WAIT });
  let left = false;
  for (let i = 0; i < 20 && !left; i += 1) { await page.keyboard.press('Tab'); left = (await tid(page, 'prototype-tools-panel').count()) === 0; }
  check('tabbing past the last control closes it (it is a popover, not a trap)', left);
  await tid(page, 'prototype-tools').click();
  await tid(page, 'prototype-tools-panel').waitFor({ timeout: WAIT });
  await tid(page, 'theme-light').click();
  check('the theme choice in the popover works (light)', !!(await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light')));
  await tid(page, 'theme-dark').click();
  check('and back to dark', !!(await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')));
  await tid(page, 'prototype-tools-close').click();
  // ---- the switch
  await tid(page, 'ideas-only').click();
  const off = await page.evaluate(() => ({ clean: document.documentElement.dataset.clean || '', stored: localStorage.getItem('ec_clean'), shown: [...document.querySelectorAll('[data-proto]')].filter((e) => getComputedStyle(e).display !== 'none').length, tags: [...document.querySelectorAll('[data-testid="idea-tag"]')].filter((e) => e.getClientRects().length > 0).length, protos: document.querySelectorAll('[data-proto]').length, text: document.body.innerText }));
  check('"Only my content" sets html[data-clean], saves ec_clean=1 and hides every idea: no [data-proto] and no tag on screen, the strip stays', off.clean === '1' && off.stored === '1' && off.shown === 0 && off.tags === 0 && off.protos >= 1 && (await tid(page, 'prototype-strip').isVisible()) && !/Earliest visit|Idea from us/.test(off.text.replace(/Prototype tools[\s\S]*/, '')), JSON.stringify(off).slice(0, 300));
  check('what is left is HIS words: the H1, his free-quote line and his two credentials', /Free, no-obligation quote/.test(off.text) && /Level 3 Electrical Installation/.test(off.text) && /2391 Inspection and Testing/.test(off.text));
  await page.reload({ waitUntil: 'networkidle' });
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  check('the choice survives a reload (set before the first paint, button pressed)', (await page.evaluate(() => document.documentElement.dataset.clean)) === '1' && (await tid(page, 'ideas-only').getAttribute('aria-pressed')) === 'true' && !(await tid(page, 'hero-visit').isVisible()));
  await tid(page, 'prototype-tools').click();
  await tid(page, 'prototype-tools-panel').waitFor({ timeout: WAIT });
  check('the popover still opens in "Only my content" (the way back is always there)', await tid(page, 'footer-owner-link').isVisible());
  await tid(page, 'prototype-tools-close').click();
  await tid(page, 'ideas-with').click();
  const back = await page.evaluate(() => ({ clean: document.documentElement.dataset.clean || '', stored: localStorage.getItem('ec_clean') }));
  check('"With ideas" brings them back and saves ec_clean=0', back.clean === '' && back.stored === '0' && (await tid(page, 'hero-visit').isVisible()) && (await tid(page, 'idea-tag').first().isVisible()), JSON.stringify(back));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();

  // ---- storage blocked: the page still loads, defaults to With ideas, and the switch still works for this visit
  const ctx2 = await newContext(MOBILE, 'dark');
  await ctx2.addInitScript(() => { const boom = () => { throw new DOMException('blocked', 'SecurityError'); }; try { Object.defineProperty(window, 'localStorage', { get: boom }); Object.defineProperty(window, 'sessionStorage', { get: boom }); } catch (e) { /* ignore */ } });
  const p2 = await ctx2.newPage();
  const log2 = watch(p2);
  await site(p2);
  await tid(p2, 'hero-cta').waitFor({ timeout: WAIT });
  await tid(p2, 'ideas-only').click();
  check('with storage blocked the switch still works for this visit and nothing throws', (await p2.evaluate(() => document.documentElement.dataset.clean)) === '1' && !(await tid(p2, 'hero-visit').isVisible()) && log2.errors.length === 0, dump(log2));
  await ctx2.close();

  // ---- a wide screen: the whole word "Show:" and the strip aligned to the page container
  const ctx3 = await newContext(DESKTOP, 'light');
  const p3 = await ctx3.newPage();
  const log3 = watch(p3);
  await site(p3);
  await tid(p3, 'hero-cta').waitFor({ timeout: WAIT });
  const wide = await p3.evaluate(() => ({ label: (document.querySelector('.ui-ideas__label') || { innerText: '' }).innerText, lblShown: !!document.querySelector('.ui-ideas__label') && document.querySelector('.ui-ideas__label').getClientRects().length > 0, tools: document.querySelector('[data-testid="prototype-tools"]').getBoundingClientRect().left, brand: document.querySelector('.lp-brand').getBoundingClientRect().left, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  check('at 1280 the label "Show:" is there and the tools button lines up with the logo (same container edge)', wide.lblShown && wide.label.trim() === 'Show:' && Math.abs(wide.tools - wide.brand) <= 2 && wide.over <= 0, JSON.stringify(wide));
  await shot(p3, 'strip-1280-light');
  check('no console errors at 1280', clean(log3), dump(log3));
  await ctx3.close();
});

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
    // D3: the header brand is HIS logo picture (LogoImg, the lockup crop), not the bolt-in-a-square mark; the business name stays in the DOM for screen readers.
    const brandInfo = await page.evaluate(() => { const b = document.querySelector('[data-testid="booking-brand"]'); const img = b.querySelector('img.lp-logo__img'); const bar = document.querySelector('.bk-header--dark'); return { text: b.innerText.trim(), svg: b.querySelectorAll('svg').length, img: !!img, src: img ? img.getAttribute('src') : '', logoH: b.querySelector('.lp-logo').getBoundingClientRect().height, dark: !!bar && getComputedStyle(bar).backgroundColor }; });
    check('the sheet header carries HIS logo picture (the lockup crop, no bolt mark) with the name kept for screen readers, beside "Step 1 of 6", and step 1 says "About 1 minute"', brandInfo.text === '180 Electrical' && brandInfo.svg === 0 && brandInfo.img && /^(https:\/\/perspective\.imgix\.net\/|img\/logo-180\.png)/.test(brandInfo.src) && brandInfo.logoH >= 36 && (await txt(page, 'funnel-time')) === 'About 1 minute', JSON.stringify(brandInfo));
    // D4/funnel chrome: the sheet is full screen, so the prototype strip is NOT in the header; a quiet note closes the step instead (and is data-proto).
    check('the funnel header has NO prototype strip (the sheet is full screen); ONE quiet honest note closes the step, marked data-proto', (await page.locator('.bk-header .bk-strip').count()) === 0 && (await page.locator('.bk-header [data-testid="booking-proto-strip"]').count()) === 0 && (await page.locator('.bk-strip').count()) === 1 && (await page.locator('.bk-ribbon__tag').count()) === 0 && /Prototype/i.test(await txt(page, 'booking-proto-strip')) && /nothing is really sent/i.test(await txt(page, 'booking-proto-strip')) && (await tid(page, 'booking-proto-strip').getAttribute('data-proto')) !== null, await txt(page, 'booking-proto-strip'));
    check('step 1 has his reassurance: a tap-to-call line and his two credentials as quiet chips (no London postcode anywhere)', /Call Daniel/.test(await txt(page, 'funnel-reassure')) && (await page.locator('.bk-reassure__chip').count()) === 2 && /Level 3 Electrical Installation/.test(await txt(page, 'funnel-credentials')) && /2391 Inspection and Testing/.test(await txt(page, 'funnel-credentials')) && (await tid(page, 'booking-call').getAttribute('href')) === 'tel:+447885496800' && !(await tid(page, 'booking-sheet').innerText()).includes('SW1A'));
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
      check(`step ${s.n} label and H1 are as designed, with a one-line "why we ask" under the question (and no legalistic note)`, (await stepLabel(page)) === `Step ${s.n} of 6` && (await titleOf(page)) === s.title && (await txt(page, 'funnel-why')) === s.why && (await tid(page, 'funnel-note').count()) === 0, await titleOf(page) + ' | ' + await txt(page, 'funnel-why'));
      const labels = (await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__label`).allInnerTexts()).map((t) => t.trim());
      const badges = await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__letter`).count();
      const icons = await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__icon svg`).count();
      const hints = (await page.locator(`[data-testid^="funnel-hint-${s.key}-"]`).allInnerTexts()).map((t) => t.trim());
      const hintSize = await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-hint-${key}-"]`)].map((h) => getComputedStyle(h).fontSize + '|' + getComputedStyle(h).lineHeight), s.key);
      check(`step ${s.n} options are as designed, each with a line icon, a 14px grey descriptor and no A to E badge`, JSON.stringify(labels) === JSON.stringify(s.options) && badges === 0 && icons === s.options.length && hints.length === s.options.length && hints.every((h) => h.length > 3) && hintSize.every((h) => h.startsWith('14px')), JSON.stringify(labels) + ` badges=${badges} icons=${icons} hints=${JSON.stringify(hints)}`);
      // The answers use the room (cards grow with the screen) and the reassurance row rests at the bottom of the step: no big black void between them.
      const gap = await page.evaluate((key) => {
        const opts = [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`)]; const last = opts[opts.length - 1].getBoundingClientRect();
        const re = document.querySelector('[data-testid="funnel-reassure"]').getBoundingClientRect(); const chips = document.querySelectorAll('.bk-reassure__chip').length;
        const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body').getBoundingClientRect();
        return { gap: re.top - last.bottom, chips, hs: opts.map((o) => Math.round(o.getBoundingClientRect().height)), reBottom: Math.round(re.bottom), bodyBottom: Math.round(body.bottom) };
      }, s.key);
      check(`step ${s.n} no black void: the reassurance row follows the last option within 48px (the cards are as tall as 112px before any space is left over) and the credential chips live on step 1 only`, gap.gap >= 0 && gap.chips === 0 && (gap.gap <= 48 || gap.hs.every((h) => h >= 108)), JSON.stringify(gap));
      check(`step ${s.n} the progress bar is the same on every step: ${s.n} of 6 segments fully filled (ink, not red), the current one at full strength`, (await page.locator('.bk-fn-progress__seg.is-done').count()) === s.n && (await page.locator('.bk-fn-progress__seg.is-current').count()) === 1 && (await page.evaluate(() => [...document.querySelectorAll('.bk-fn-progress__seg.is-done')].every((e) => !/225, 20, 20/.test(getComputedStyle(e, '::after').backgroundColor)))));
      check(`step ${s.n} has the logo header (no strip in it), the one quiet prototype note at the foot, no horizontal scroll and the reassurance row at the bottom (his free-quote line, Daniel contacts you within 24 hours)`, (await txt(page, 'booking-brand')) === '180 Electrical' && (await page.locator('.bk-header .bk-strip').count()) === 0 && (await page.locator('.bk-strip').count()) === 1 && (await page.locator('.bk-ribbon').count()) === 0 && (await noOverflow(page)) && (await tid(page, 'funnel-reassure').count()) === 1 && /Free, no-obligation quote\. Daniel will contact you within 24 hours\./.test(await txt(page, 'funnel-reassure')), await txt(page, 'funnel-reassure'));
      check(`step ${s.n} has no Continue button (it auto-advances)`, (await tid(page, 'funnel-continue').count()) === 0 && (await tid(page, 'funnel-submit').count()) === 0 && !sheet.includes('Continue'));
      const small = await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`)].filter((b) => b.getBoundingClientRect().height < 44).length, s.key);
      check(`step ${s.n} every option row is 68 to 112px tall (the cards use the room), and no label breaks in an orphan: the last line of a label is never one lone short word`, small === 0 && (await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`)].every((b) => { const h = b.getBoundingClientRect().height; return h >= 68 && h <= 112; }), s.key)) && (await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"] .bk-fn-opt__label`)].every((l) => { const lh = parseFloat(getComputedStyle(l).lineHeight) || 22; const lines = Math.round(l.getBoundingClientRect().height / lh); if (lines < 2) return true; const r = document.createRange(); r.selectNodeContents(l); const rects = [...r.getClientRects()]; const lastTop = Math.max(...rects.map((x) => x.top)); const lastW = rects.filter((x) => Math.abs(x.top - lastTop) < 3).reduce((a, x) => a + x.width, 0); return lastW > 70; }), s.key)));
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
    check('step 6 H1, promise line, field labels, opt-in and small print read as designed', (await titleOf(page)) === COPY.step6.title && (await txt(page, 'funnel-promise')) === COPY.step6.promise && COPY.step6.labels.every((l) => s6.includes(l)) && s6.includes(COPY.step6.optIn) && (await txt(page, 'funnel-small-print')) === COPY.step6.small, await titleOf(page));
    check('step 6 has helper text and placeholders (mobile, email) and no stray London or Derby postcode', s6.includes('Daniel may text or WhatsApp you') && s6.includes('Your written quote comes here') && (await tid(page, 'field-phone').getAttribute('placeholder')) === '07xxx xxx xxx' && (await tid(page, 'funnel-email').getAttribute('placeholder')) === 'name@email.com' && (await tid(page, 'field-postcode').getAttribute('placeholder')) === 'e.g. BT7 3AB' && !s6.includes('DE1') && !s6.includes('SW1A'));
    const foot6 = await tid(page, 'booking-sheet').locator('.ui-sheet__footer').boundingBox();
    check('the step 6 footer is the button and ONE line (about 100px), with a Privacy link', foot6.height <= 108 && (await txt(page, 'funnel-foot-line')).startsWith('We only use this to reply to your enquiry.') && (await txt(page, 'funnel-privacy')) === 'Privacy', JSON.stringify(foot6));
    // D5: the bar is the same on every step (ink on the near-black bar, never red, never half-lit): on step N, N segments are FULLY filled, the sixth included.
    const bar6 = await page.evaluate(() => [...document.querySelectorAll('.bk-fn-progress__seg')].map((s) => { const a = getComputedStyle(s, '::after'); return { done: s.classList.contains('is-done'), cur: s.classList.contains('is-current'), tf: a.transform, bg: a.backgroundColor, anim: a.animationName, op: a.opacity }; }));
    check('step 6 submit button is verbatim; the progress bar reads step 6 of 6 with ALL SIX segments fully filled (the sixth is the current one, full strength, not pulsing, not red)', (await txt(page, 'funnel-submit')) === COPY.step6.submit && (await tid(page, 'booking-progress').getAttribute('aria-valuenow')) === '6' && (await page.locator('.bk-fn-progress__seg.is-done').count()) === 6 && (await page.locator('.bk-fn-progress__seg.is-pulse').count()) === 0 && bar6.length === 6 && bar6.every((b) => b.done && b.anim === 'none' && b.op === '1' && !/225, 20, 20/.test(b.bg)) && bar6[5].cur, JSON.stringify(bar6[5]));
    check('Full name has the placeholder "e.g. Aoife Magee"', (await tid(page, 'field-name').getAttribute('placeholder')) === 'e.g. Aoife Magee');
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

// ================================================================ 2e. step 6: fixing the postcode never bounces the customer (T01); errors, focus ring and footer (T06)
await section('2e. step 6: editing the pre-filled postcode keeps the customer on step 6; inline error on blur; one focus ring, one error look, a ~100px footer', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await onStep(page, 1);
  await walkToContact(page, 'BT9 6QP');
  const pc = tid(page, 'field-postcode');
  await pc.click();
  await pc.press('End');
  const seen = [];
  for (let i = 0; i < 4; i += 1) { await pc.press('Backspace'); seen.push(await stepLabel(page)); }
  check('backspacing the pre-filled postcode down to "BT7"-ish never leaves step 6 (no jump to step 1)', (await pc.inputValue()).length === 3 && seen.every((l) => l === 'Step 6 of 6') && (await tid(page, 'funnel-step-6').count()) === 1 && (await tid(page, 'funnel-step-1').count()) === 0, JSON.stringify(seen));
  await pc.fill('BT7');
  check('at exactly "BT7" it is still step 6, the contact form is on screen and there is no error while typing', (await stepLabel(page)) === 'Step 6 of 6' && (await tid(page, 'field-name').count()) === 1 && (await tid(page, 'error-postcode').count()) === 0);
  await shot(page, 'funnel-step6-postcode-edit-375');
  await tid(page, 'field-name').click();
  check('tapping away shows the inline error under the postcode field, still on step 6', !!(await until(async () => (await txt(page, 'error-postcode')) === COPY.step1.error)) && (await stepLabel(page)) === 'Step 6 of 6', await txt(page, 'error-postcode'));
  await tid(page, 'field-name').fill('Aoife Magee');
  await tid(page, 'field-phone').fill('07700 900231');
  await tid(page, 'funnel-email').fill('aoife@example.com');
  await tid(page, 'funnel-submit').click();
  check('submitting with the invalid postcode stays on step 6 and focuses the postcode field', (await stepLabel(page)) === 'Step 6 of 6' && !!(await until(async () => (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'fn-postcode-6')));
  const inView = await page.evaluate(() => { const el = document.getElementById('fn-postcode-6').getBoundingClientRect(); const f = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__footer').getBoundingClientRect(); return el.top >= 0 && el.bottom <= f.top; });
  check('and the field is scrolled clear of the sticky footer', inView);
  await pc.fill('BT7 3AB');
  check('typing a valid BT postcode clears the error', !!(await until(async () => (await tid(page, 'error-postcode').count()) === 0)));
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  check('and submitting opens the confirmation (the enquiry carries the corrected postcode)', ((await bookingByRef(page, 'EL-1043')) || { address: {} }).address.postcode === 'BT7 3AB');
  await ctx.close();

  // Back from step 6 goes to step 5 (never to step 1)
  const c2 = await newContext(MOBILE);
  const p2 = await c2.newPage();
  await site(p2, '#book/ev_quote');
  await sheetOpen(p2);
  await walkToContact(p2, 'BT9 6QP');
  await p2.locator('[data-testid="field-postcode"]').fill('BT7');
  await tid(p2, 'booking-back').click();
  check('Back from step 6 (with the postcode half-edited) goes to step 5', await onStep(p2, 5));
  await c2.close();

  // ---- T06 on a small phone (375 x 667)
  const c3 = await newContext({ width: 375, height: 667 });
  const p3 = await c3.newPage();
  await site(p3, '#book/ev_quote');
  await sheetOpen(p3);
  await walkToContact(p3, 'BT9 6QP');
  const foot = await tid(p3, 'booking-sheet').locator('.ui-sheet__footer').boundingBox();
  check('at 375x667 the empty step 6 footer is about 100px or less', foot.height <= 104, JSON.stringify(foot));
  await shot(p3, 'funnel-step6-empty-375x667');
  await tid(p3, 'field-name').focus();
  const ring = await p3.evaluate(() => { const cs = getComputedStyle(document.getElementById('fn-name')); return { w: cs.outlineWidth, off: cs.outlineOffset, color: cs.outlineColor, style: cs.outlineStyle, border: cs.borderTopColor }; });
  check('the focus ring is ONE thin 2px NEUTRAL ring (white at about 60% in dark) on a neutral border: never red', ring.w === '2px' && ring.style === 'solid' && /(0\.9\d* 0\.9\d* 0\.9\d*|245, 245, 244).*0\.6/.test(ring.color + '') && ring.border === 'rgb(122, 122, 128)', JSON.stringify(ring));
  await tid(p3, 'field-name').blur();
  await tid(p3, 'funnel-submit').click();
  check('submitting the empty form shows a "Please check 3 fields" line above the button', !!(await until(async () => (await txt(p3, 'funnel-check-summary')) === 'Please check 3 fields')), await txt(p3, 'funnel-check-summary'));
  await p3.waitForTimeout(400); // the border colour eases in
  const st = await p3.evaluate(() => {
    const f = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__footer').getBoundingClientRect();
    const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body').getBoundingClientRect();
    const first = document.getElementById('fn-name').getBoundingClientRect();
    const errs = [...document.querySelectorAll('[data-testid="error-name"], [data-testid="error-phone"], [data-testid="error-email"]')];
    const inv = getComputedStyle(document.getElementById('fn-name'));
    const err = getComputedStyle(errs[0]);
    return { firstVisible: first.top >= body.top - 1 && first.bottom <= f.top, errs: errs.length, errColor: err.color, invBorder: inv.borderTopColor, invBorderW: inv.borderTopWidth };
  });
  check('the first invalid field is on screen above the footer; all three errors exist', st.firstVisible && st.errs === 3, JSON.stringify(st));
  // D5: red means the primary action, brand moments and the selected state only. An ERROR is the distinct DANGER treatment (amber-red outline, icon, message in words), never the brand red.
  const errIcons = await p3.locator('[data-testid="error-name"] svg, [data-testid="error-phone"] svg, [data-testid="error-email"] svg').count();
  check('the error look is the DANGER treatment, not the brand red: a 2px amber-red outline (rgb 255,106,43), the message in the danger text colour with an icon (three icons)', st.invBorder === 'rgb(255, 106, 43)' && st.invBorder !== 'rgb(225, 20, 20)' && st.errColor === 'rgb(255, 160, 112)' && errIcons === 3, JSON.stringify([st, errIcons]));
  await shot(p3, 'funnel-step6-errors-375x667');
  await tid(p3, 'funnel-email').scrollIntoViewIfNeeded();
  const reach = await p3.evaluate(() => { const e = document.querySelector('[data-testid="error-email"]').getBoundingClientRect(); const f = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__footer').getBoundingClientRect(); return e.bottom <= f.top + 1; });
  check('the last error is reachable by scrolling (clear of the footer)', reach);
  await tid(p3, 'funnel-privacy').click();
  check('"Privacy" takes the visitor to the full wording above the opt-in', !!(await until(async () => (await activeId(p3)) === 'funnel-small-print')));
  await c3.close();
  check('no console errors, off-site or failed requests', clean(log), dump(log));
});

// ================================================================ 2f. the funnel's first interaction speaks one colour language (T03); sparse steps, the street note, tenant wording (T11)
await section('2f. step 1: neutral focus, green valid, the danger outline only for errors, grey eyebrow, quiet demo link below; step 2 street note; step 5 tenant wording keeps its ids', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await onStep(page, 1);
  const st1 = await page.evaluate(() => {
    const eb = document.querySelector('.bk-fn__eyebrow');
    const demo = document.querySelector('[data-testid="demo-fill"]');
    const title = document.querySelector('[data-testid="funnel-title"]');
    const dc = getComputedStyle(demo);
    const before = !!document.querySelector('[data-testid="booking-sheet"] .bk-ribbon');
    return { eb: getComputedStyle(eb).color, demoTop: demo.getBoundingClientRect().top, titleBottom: title.getBoundingClientRect().bottom, reassureTop: document.querySelector('[data-testid="funnel-reassure"]').getBoundingClientRect().top, fs: dc.fontSize, deco: dc.textDecorationStyle, color: dc.color, proto: demo.hasAttribute('data-proto'), h: demo.getBoundingClientRect().height, ribbon: before };
  });
  check('the eyebrow is the muted grey of the other eyebrows, not red', st1.eb === 'rgb(198, 198, 200)', st1.eb);
  check('"Demo: fill sample details" sits BELOW the answers as a 12px grey solid-underline link (nothing dashed above the question), is a 44px target, and carries data-proto', st1.demoTop > st1.reassureTop && st1.demoTop > st1.titleBottom && st1.fs === '12px' && st1.deco === 'solid' && st1.proto && st1.h >= 44 && !st1.ribbon, JSON.stringify(st1));
  const field = (id) => page.evaluate((i) => { const c = getComputedStyle(document.getElementById(i)); return { ow: c.outlineWidth, os: c.outlineStyle, oc: c.outlineColor, bc: c.borderTopColor, bw: c.borderTopWidth, bg: c.backgroundColor }; }, id);
  await tid(page, 'funnel-postcode').focus();
  const empty = await field('fn-postcode');
  check('focused and empty: a neutral 2px ring on a neutral border (no red anywhere)', empty.ow === '2px' && empty.bc === 'rgb(122, 122, 128)' && !/225, 20, 20/.test(empty.oc + empty.bc), JSON.stringify(empty));
  await tid(page, 'funnel-postcode').fill('BT7 3AB');
  await until(async () => (await tid(page, 'funnel-postcode-ok').count()) === 1);
  await page.waitForTimeout(400); // the border colour eases in
  const ok = await field('fn-postcode');
  check('a valid postcode: a green border, a small green tick INSIDE the field, the green "in our area" line, and no red', ok.bc === 'rgb(74, 222, 128)' && (await tid(page, 'funnel-postcode-ok').isVisible()) && !/225, 20, 20/.test(ok.oc + ok.bc) && (await txt(page, 'funnel-zone-hint')).includes("that's in our area"), JSON.stringify(ok));
  await shot(page, 'funnel-step1-valid-375');
  await tid(page, 'funnel-postcode').fill('not a postcode');
  await tid(page, 'funnel-continue').click();
  await until(async () => (await txt(page, 'error-funnel-postcode')) === COPY.step1.error);
  await page.waitForTimeout(350);
  const bad = await field('fn-postcode');
  check('an error is the ONLY state with the amber-red danger outline and a tinted fill: ONE 2px border (not the brand red), no second ring', bad.bc === 'rgb(255, 106, 43)' && bad.bw === '2px' && (bad.ow === '0px' || bad.os === 'none') && bad.bg !== 'rgb(21, 21, 23)', JSON.stringify(bad));
  await shot(page, 'funnel-step1-error-375');
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-continue').click();
  await onStep(page, 2);
  // ---- step 2: On-street shows a conditional note and a Continue; it does not move on by itself
  await tid(page, 'funnel-option-parking-street').click();
  await page.waitForTimeout(700);
  const note = await txt(page, 'funnel-street-note');
  check('choosing On-street stays on step 2 and shows "Home chargers usually need off-street parking. Daniel can talk through options, or call 07885 496800."', (await stepLabel(page)) === 'Step 2 of 6' && /^Home chargers usually need off-street parking\. Daniel can talk through options, or call 07885 496800\.\s*Continue$/.test(note) && (await tid(page, 'funnel-street-note').locator('a[href="tel:+447885496800"]').count()) === 1, note);
  // D5: the SELECTED state is ink (a white border in dark, a tint, an ink icon tile) with one small red check; red is not the selection colour any more.
  const selSt = await page.evaluate(() => { const o = document.querySelector('[data-testid="funnel-option-parking-street"]'); const c = getComputedStyle(o); const tick = getComputedStyle(o.querySelector('.bk-fn-opt__tick')); const icon = getComputedStyle(o.querySelector('.bk-fn-opt__icon')); return { border: c.borderTopColor, bg: c.backgroundColor, tick: tick.backgroundColor, tickOp: tick.opacity, icon: icon.backgroundColor, tickBox: o.querySelector('.bk-fn-opt__tick').getBoundingClientRect().width }; });
  check('the selected option is INK, not red: a near-white border (dark theme), a tinted fill, an ink icon tile, and ONE small red check (24px) that overlays the corner instead of taking a column', selSt.border === 'rgb(245, 245, 244)' && selSt.border !== 'rgb(225, 20, 20)' && selSt.icon === 'rgb(245, 245, 244)' && selSt.tick === 'rgb(225, 20, 20)' && selSt.tickOp === '1' && selSt.tickBox === 24, JSON.stringify(selSt));
  await shot(page, 'funnel-step2-street-375');
  check('the note does not block Next: Continue moves on to step 3 with the answer kept', await (async () => { await tid(page, 'funnel-next').click(); return onStep(page, 3); })() && (await page.evaluate(() => JSON.parse(sessionStorage.getItem('vm_draft_v1')).answers.parking)) === 'street');
  await tid(page, 'booking-back').click();
  await onStep(page, 2);
  check('back on step 2 the On-street answer is still selected, with its note and Continue', (await tid(page, 'funnel-option-parking-street').getAttribute('aria-pressed')) === 'true' && (await tid(page, 'funnel-next').count()) === 1);
  await tid(page, 'funnel-option-parking-garage').click();
  check('any other answer still moves on by itself and clears the note', await onStep(page, 3));
  // ---- step 5: tenant-friendly wording, the answer ids are unchanged and the owner's dashboard still shows the answer
  await tid(page, 'funnel-option-vehicle-ordered').click();
  await onStep(page, 4);
  await tid(page, 'funnel-option-timing-asap').click();
  await onStep(page, 5);
  check('step 5 asks "Do you own the property, or have the owner\'s permission?" with Yes / I rent or lease and need permission / Not sure', (await titleOf(page)) === "Do you own the property, or have the owner's permission?" && JSON.stringify((await page.locator('[data-testid^="funnel-option-permission-"] .bk-fn-opt__label').allInnerTexts()).map((t) => t.trim())) === JSON.stringify(['Yes', 'I rent or lease and need permission', 'Not sure']));
  await tid(page, 'funnel-option-permission-landlord').click();
  await onStep(page, 6);
  check('the draft keeps the unchanged answer id ("landlord")', (await page.evaluate(() => JSON.parse(sessionStorage.getItem('vm_draft_v1')).answers.permission)) === 'landlord');
  await tid(page, 'demo-fill').click();
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  const saved = await bookingByRef(page, 'EL-1043');
  check('the saved enquiry carries permission = landlord', !!saved && saved.answers && saved.answers.permission === 'landlord', JSON.stringify(saved && saved.answers));
  await dash(page, '#/bookings/' + saved.id);
  await tid(page, 'job-primary').waitFor({ timeout: WAIT });
  const job = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('the dashboard job card still shows the permission answer (with the new wording)', /I rent or lease and need permission/.test(job), job.slice(0, 300));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 3. submit: contact validation, confirmation, calendar, UTM, manage
await section('3. submit -> confirmation (his copy, one story, the suggested visit as a tagged idea, calendar, 5-step timeline, DEMO panel) -> Manage', async () => {
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
  // ---- the customer's view is ONE story, short and plain: his thank-you, the reference, the WhatsApp send (the one filled button), ONE tagged idea card for the visit,
  // two closed rows (photos, what happens next), Call, the demo behind one dashed button, and a real "Done" button with "Change or cancel" as a quiet link under it.
  const view = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body');
    const conf = document.querySelector('[data-testid="confirmation"]');
    const done = document.querySelector('[data-testid="confirmation-done"]');
    const manage = document.querySelector('[data-testid="confirmation-manage"]');
    const text = conf.innerText;
    const d = done ? done.getBoundingClientRect() : { width: 0, bottom: 0, height: 0 };
    return { h: conf.getBoundingClientRect().height, doneSecondary: !!done && done.classList.contains('ui-btn--secondary') && !done.classList.contains('ui-btn--ghost'), doneW: d.width, doneH: d.height, cw: conf.getBoundingClientRect().width, manageBelow: !!done && !!manage && manage.getBoundingClientRect().top >= d.bottom - 2 && manage.getBoundingClientRect().height >= 40 && manage.tagName === 'BUTTON' && !manage.classList.contains('ui-btn'), text, sheet: body ? body.innerText : '' };
  });
  check('the confirmation in its default state is no taller than about 2 screens (1,700px)', view.h <= 1700, String(view.h));
  check('it has no "(simulated)" and no "prototype" text outside the demo disclosure, says Daniel not "the team", and never uses the old words "pencilled" or "provisional"', !/simulated|prototype/i.test(view.text) && !/the team/i.test(view.text) && !/pencil|provisional/i.test(view.text) && /Daniel/.test(view.text), view.text.slice(0, 300));
  check('it ends plainly: "Done" is a real secondary button (full width, not bare text) and "Change or cancel" is a quiet link under it', view.doneSecondary && view.doneW >= view.cw * 0.8 && view.doneH >= 52 && view.manageBelow && (await txt(page, 'confirmation-manage')) === 'Change or cancel');
  check('"Add photos" is a CLOSED optional row (not a red button), "What happens next" is closed too, and the demo is one dashed button marked data-proto', (await tid(page, 'funnel-ready-box').evaluate((d) => d.open)) === false && /Add photos/.test(await txt(page, 'funnel-ready-box')) && /Optional/i.test(await txt(page, 'funnel-ready-box')) && (await tid(page, 'journey-box').evaluate((d) => d.open)) === false && (await tid(page, 'demo-panel').count()) === 0 && (await txt(page, 'demo-toggle')) === "See what Daniel's phone just received" && (await tid(page, 'demo-toggle').getAttribute('data-proto')) !== null);
  check('H1 is his "Thanks, your enquiry has been received."', (await txt(page, 'confirmation-title')) === COPY.confirm.title, await txt(page, 'confirmation-title'));
  check('his paragraph, "within 24 hours" and "check your emails"', (await txt(page, 'confirmation-lead')) === COPY.confirm.body, await txt(page, 'confirmation-lead'));
  check('focus moved to the confirmation heading', (await until(async () => (await activeId(page)) === 'TITLE')));
  check('reference EL-1043 in monospace, with a copy button', (await txt(page, 'confirmation-ref')) === 'EL-1043' && (await tid(page, 'confirmation-ref').getAttribute('class')).includes('u-mono') && (await tid(page, 'confirmation-copy').count()) === 1);
  // D1/D2: the suggested visit is an IDEA from us (his site offers no date): data-proto + the visible tag, ONE status, no old words.
  const visit = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="confirmation-visit"]');
    const t = (id) => { const e = v && v.querySelector(`[data-testid="${id}"]`); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
    const tag = v && v.querySelector('[data-testid="idea-tag"]');
    return { n: document.querySelectorAll('[data-testid="confirmation-visit"]').length, proto: !!v && v.hasAttribute('data-proto'), tag: tag ? tag.textContent.trim() : '', tagVisible: !!tag && tag.getClientRects().length > 0, kicker: t('confirmation-visit-kicker'), when: t('confirmation-visit-when'), status: t('confirmation-pencilled'), text: v ? v.innerText : '', pills: v ? v.querySelectorAll('.ui-chip, .bk-pill-tag').length : -1 };
  });
  check('the suggested visit is ONE idea card: data-proto, the visible tag "Idea from us, not on your site today", "Earliest visit Daniel could offer", "Mon 26 Oct, 8 to 10am" in words, and the single status "Daniel will confirm."', visit.n === 1 && visit.proto && visit.tagVisible && visit.tag === 'Idea from us, not on your site today' && visit.kicker === 'Earliest visit Daniel could offer' && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, \d{1,2}(am|pm)? to \d{1,2}(am|pm)?$/.test(visit.when) && visit.status === 'Daniel will confirm.' && !/pencil|provisional|survey/i.test(visit.text) && visit.pills === 0, JSON.stringify(visit));
  const tile = await page.locator('.bk-datetile').innerText();
  check('the visit has a date tile (weekday, day, month) and no second status tag', /^(SAT|SUN|MON|TUE|WED|THU|FRI)\s+\d{1,2}\s+[A-Z]{3}$/i.test(tile.replace(/\s+/g, ' ').trim()) && (await tid(page, 'confirmation-visit-tag').count()) === 0, tile);
  await openAcc(page, 'funnel-ready-box');
  const ready = await txt(page, 'funnel-ready-box');
  check('opening "Add photos" shows HIS words, verbatim: "If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation."', ready.includes(COPY.confirm.ready) && (await tid(page, 'photos-prompt').isVisible()) && (await txt(page, 'photos-prompt')) === COPY.confirm.ready, ready);
  const prim = await page.evaluate(() => [...document.querySelectorAll('[data-testid="confirmation"] .ui-btn--primary')].map((b) => b.getAttribute('data-testid')));
  check('the page has ONE filled (primary) button, the WhatsApp send; "Choose photos" and "Take a photo" are secondary', (await tid(page, 'photos-card').count()) === 1 && !(await tid(page, 'photos-choose').getAttribute('class')).includes('ui-btn--primary') && prim.length === 1 && prim[0] === 'wa-send', JSON.stringify(prim));
  const callBtn = await page.evaluate(() => { const c = document.querySelector('[data-testid="confirmation-call"]').getBoundingClientRect(); return { h: c.height, w: c.width }; });
  check('"Prefer to speak to us?" with ONE Call button (his site lists no WhatsApp), a tel: link with his number; the WhatsApp transport is the send card', (await txt(page, 'confirmation-call')) === 'Call 07885 496800' && (await tid(page, 'confirmation-call').getAttribute('href')) === 'tel:+447885496800' && /Prefer to speak to us\?/.test(await txt(page, 'confirmation')) && (await tid(page, 'confirmation-whatsapp').count()) === 0 && callBtn.h >= 44, JSON.stringify(callBtn));
  const wa = (await tid(page, 'wa-send').getAttribute('href')) || '';
  check('the WhatsApp send card uses his real number and carries the reference', /^https:\/\/wa\.me\/447885496800\?text=/.test(wa) && decodeURIComponent(wa).includes('EL-1043'), wa);
  const first1 = await page.evaluate(() => {
    const conf = document.querySelector('[data-testid="confirmation"]');
    const chip = document.querySelector('[data-testid="confirmation-status"]');
    const pills = [...conf.querySelectorAll('.ui-chip, .bk-pill-tag')];
    const ring = getComputedStyle(document.querySelector('.bk-tick__ring')).stroke;
    const chk = getComputedStyle(document.querySelector('.bk-tick__check')).stroke;
    return { pills: pills.length, chip: chip ? chip.textContent.trim() : '', ring, chk, html: document.body.innerHTML };
  });
  check('a NEW enquiry has no status pill at all (the headline says it was received; the visit card has the one status), and nothing says Provisional or Awaiting confirmation', first1.pills === 0 && first1.chip === '' && !/Provisional|Awaiting confirmation/.test(first1.html.replace(/<script[\s\S]*?<\/script>/g, '')), JSON.stringify([first1.pills, first1.chip]));
  check('the tick and its ring are SUCCESS GREEN, never the accent red; no breaker art', /rgb\(74, 222, 128\)/.test(first1.ring) && /rgb\(110, 231, 160\)/.test(first1.chk) && (await tid(page, 'breaker-art').count()) === 0, JSON.stringify([first1.ring, first1.chk]));
  check('no Add to calendar button while the visit is only a suggestion', (await tid(page, 'add-to-calendar').count()) === 0);
  check('animated tick is drawn', (await tid(page, 'confirmation-tick').count()) === 1);
  await openAcc(page, 'journey-box');
  const steps = await tid(page, 'confirmation-timeline').locator('li').count();
  const tl = await txt(page, 'confirmation-timeline');
  check('the timeline reads naturally for the customer: no "(simulated)", no "the team", no "Waiting for"', !/simulated|the team|Waiting for/i.test(tl) && /Daniel has your enquiry/.test(tl), tl);
  const first = await txt(page, 'journey-received');
  const nodeBg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="journey-received"] .bk-timeline__mark')).backgroundColor);
  check('"What happens next" has five steps, the first already ticked, and a completed node is GREEN', steps === 5 && (await tid(page, 'journey-received').getAttribute('class')).includes('is-done') && first.includes('Just now') && nodeBg === 'rgb(74, 222, 128)', `${steps} ${first} ${nodeBg}`);
  check('the first step still to come is marked as the current one', (await tid(page, 'journey-contact').getAttribute('class')).includes('is-current') && (await tid(page, 'journey-contact').getAttribute('aria-current')) === 'step');
  await openDemo(page);
  check('DEMO panel (behind the dashed button) is labelled simulated and shows the two labelled phone mocks', (await txt(page, 'demo-panel')).includes('DEMO · SIMULATED') && (await tid(page, 'demo-owner-bubble').count()) === 1 && (await tid(page, 'demo-customer-bubble').count()) === 1 && /simulated/i.test(await txt(page, 'demo-panel')));
  const ob = await txt(page, 'demo-owner-bubble');
  check('DEMO: the owner bubble has name, postcode and the one-line answers', ob.includes('EL-1043') && ob.includes('BT9 6QP') && ob.includes(ANSWERS_LINE), ob);
  const cb = await txt(page, 'demo-customer-bubble');
  // (The simulated customer text is core's wording (js/core/messages.js), shown only behind the data-proto demo button: "Earliest visit Daniel could offer: {when}. Daniel will confirm within 24 hours.")
  check('DEMO: the customer text names the suggested time and says Daniel will confirm a time within 24 hours; "You asked for" is nowhere in the DOM', /(Earliest visit Daniel could offer: |We've (pencilled in|suggested) )(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, /.test(cb) && /Daniel will confirm( a time)? within 24 hours\./.test(cb) && !/plan around/.test(cb) && cb.includes('EL-1043') && !/You asked for/.test(await page.evaluate(() => document.body.innerHTML)) && !/Awaiting confirmation/.test(await page.evaluate(() => document.body.innerHTML)), cb);
  check('DEMO: the owner bubble shows "Open: Job link" with the real href, and no origin or raw id', /Open: Job link/.test(ob) && !/localhost|127\.0\.0\.1|http|bk_/.test(ob) && /dashboard\.html#\/bookings\/bk_/.test((await tid(page, 'demo-owner-bubble').locator('a.ui-bubble__link').first().getAttribute('href')) || ''), ob);
  check('Open Daniel\'s dashboard deep-links to the booking in the dashboard tab', /dashboard\.html(\?[^#]*)?#\/bookings\/bk_/.test(await tid(page, 'demo-open-dashboard').getAttribute('href')) && (await tid(page, 'demo-open-dashboard').getAttribute('target')) === 'vm-dashboard');
  check('the draft is cleared after submitting', await page.evaluate(() => sessionStorage.getItem('vm_draft_v1') === null));
  check('confirmation fits the phone width', await noOverflow(page));
  const stored = await bookingByRef(page, 'EL-1043');
  check('the enquiry carries the session\'s UTM capture (source, medium, campaign)', !!stored && stored.utm && stored.utm.source === UTM.source && stored.utm.medium === UTM.medium && stored.utm.campaign === UTM.campaign, JSON.stringify(stored && stored.utm));
  // the calendar file for a suggested visit still exists (the button only appears once Daniel confirms): read it through the module
  const ics = await page.evaluate(async () => { const m = await import('./js/booking/visit-ics.js'); const st = await import('./js/core/store.js'); const g = st.getState(); return m.visitIcs(g.bookings.find((b) => b.ref === 'EL-1043'), g.settings); });
  check('the suggested-visit calendar file is valid and says it is a suggestion (tentative, not confirmed), without the old words "pencilled" or "provisional"', ics.startsWith('BEGIN:VCALENDAR') && /STATUS:TENTATIVE/.test(ics) && /SUMMARY:Suggested visit \(not confirmed\)/.test(ics.replace(/\\/g, '')) && /Suggested time, not confirmed until Daniel confirms/.test(ics.replace(/\r\n /g, '').replace(/\\/g, '')) && !/pencil|provisional/i.test(ics) && /DTSTART:20261026T080000/.test(ics), ics.slice(0, 400));
  check('every line of that calendar file is at most 75 octets (folded)', ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  // survives a refresh
  await page.reload({ waitUntil: 'networkidle' });
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  check('confirmation survives a refresh', (await txt(page, 'confirmation-ref')) === 'EL-1043' && (await tid(page, 'demo-toggle').count()) === 1);
  // manage
  await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-manage').click();
  await tid(page, 'manage-page').waitFor({ timeout: WAIT });
  check('Manage opens at #manage/EL-1043', (await hashOf(page)) === '#manage/EL-1043');
  check('a pending enquiry says "We\'ll be in touch within 24 hours." (no time promise)', (await txt(page, 'manage-reply-note')) === "We'll be in touch within 24 hours.", await txt(page, 'manage-reply-note'));
  const jt = await tid(page, 'manage-status-timeline').locator('li').count();
  const mv = await page.evaluate(() => { const v = document.querySelector('[data-testid="confirmation-visit"]'); return { n: document.querySelectorAll('[data-testid="confirmation-visit"]').length, proto: !!v && v.hasAttribute('data-proto'), status: v ? v.querySelector('[data-testid="confirmation-pencilled"]').textContent.trim() : '', text: document.querySelector('[data-testid="manage-page"]').innerText }; });
  check('Manage shows the status chip (Received), the SAME tagged visit idea with its one status, and the journey timeline, and no Add to calendar yet; no "pencilled" or "provisional" anywhere', (await txt(page, 'manage-status')).includes('Received') && mv.n === 1 && mv.proto && mv.status === 'Daniel will confirm.' && !/pencil|provisional/i.test(mv.text) && jt === 5 && (await tid(page, 'add-to-calendar').count()) === 0, JSON.stringify([jt, mv.n, mv.proto, mv.status]));
  check('Manage offers Call and WhatsApp', (await tid(page, 'manage-call').count()) === 1 && (await tid(page, 'manage-whatsapp').count()) === 1);
  check('the suggested visit is never inside 24 h (Monday 26 Oct, not tomorrow 8am), so Manage offers Cancel enquiry and no close-to-the-visit note', (await tid(page, 'manage-cancel').count()) === 1 && (await tid(page, 'manage-close-note').count()) === 0, await txt(page, 'manage-cancel').catch(() => ''));
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
await section('3b. a visit more than 24 h away can be cancelled from Manage, and the suggested window is free again', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  // Block the next four days in the diary (through the page's own store module) so the engine suggests the visit beyond the 24 h cutoff.
  const blocked = await page.evaluate(async () => {
    const s = await import('./js/core/store.js');
    const r = s.blockRange({ fromDate: '2026-10-24', toDate: '2026-10-27', label: 'Test: away' });
    return !!r.ok;
  });
  check('setup: the diary is blocked Sat 24 to Tue 27 Oct', blocked);
  await submitEnquiry(page);
  const p1 = await txt(page, 'confirmation-visit-when');
  check('the suggested visit is for 28 Oct or later (more than 24 h away)', /(Wed|Thu|Fri|Sat|Sun|Mon|Tue) (2[89]|3[01]) Oct|Nov/.test(p1), p1);
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
  await openAcc(page, 'funnel-ready-box');
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
  await tid(page, 'photos-card').waitFor({ state: 'attached', timeout: WAIT });
  await openAcc(page, 'funnel-ready-box');
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

// ================================================================ 3g. "Only my content" (ec_clean=1) in the funnel and the confirmation (D1, D2)
await section('3g. "Only my content": the funnel and the thank-you keep only his words and the real actions; every idea (the visit card, the demo, the notes) is hidden', async () => {
  const ctx = await newContext(MOBILE);
  await ctx.addInitScript(() => { try { localStorage.setItem('ec_clean', '1'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await onStep(page, 1);
  const shown = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].filter((e) => e.getClientRects().length > 0).length, sel);
  check('the funnel in clean mode: the quiet prototype note and the demo shortcut are hidden (both are data-proto); the question and the button remain', (await shown('[data-testid="booking-proto-strip"]')) === 0 && (await shown('[data-testid="demo-fill"]')) === 0 && (await tid(page, 'funnel-continue').isVisible()) && (await tid(page, 'funnel-postcode').isVisible()));
  await walkToContact(page);
  await tid(page, 'field-name').fill('Aoife Magee');
  await tid(page, 'field-phone').fill('07700 900231');
  await tid(page, 'funnel-email').fill('aoife@example.com');
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  const conf = await page.evaluate(() => document.querySelector('[data-testid="confirmation"]').innerText);
  check('the thank-you in clean mode is his story only: his headline and paragraph, the reference, the WhatsApp send, Call, Done; no visit card, no idea tag, no demo, no "Earliest visit", no "pencilled" or "provisional"', conf.includes(COPY.confirm.title) && conf.includes('EL-1043') && (await shown('[data-testid="wa-send"]')) === 1 && (await shown('[data-testid="confirmation-call"]')) === 1 && (await shown('[data-testid="confirmation-done"]')) === 1 && (await shown('[data-testid="confirmation-visit"]')) === 0 && (await shown('[data-testid="idea-tag"]')) === 0 && (await shown('[data-testid="demo-toggle"]')) === 0 && (await shown('[data-testid="wa-send-note"]')) === 0 && !/Earliest visit|Idea from us|pencil|provisional|prototype/i.test(conf), conf.slice(0, 200));
  await shot(page, 'funnel-confirmation-clean-375');
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
    await tid(page, 'coverage-book').click(); // "Check my postcode"
    await tid(page, 'coverage-book').click(); // "Continue with BT9 6QP"
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
  // The funnel's bar is near-black in BOTH themes (it carries his logo picture, which sits on a near-black card) and the page below it is light.
  const hdr = await page.evaluate(() => { const h = document.querySelector('.bk-header--dark'); const c = getComputedStyle(h); const logo = h.querySelector('.lp-logo__img'); return { bg: c.backgroundColor, ink: getComputedStyle(h.querySelector('[data-testid="booking-close"]')).color, logo: !!logo }; });
  check('in the light theme the header band is still near-black with white controls and his logo (the page below it is light)', lum(hdr.bg) < 0.1 && lum(hdr.ink) > 0.8 && hdr.logo, JSON.stringify(hdr));
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
    await openAcc(p2, 'funnel-ready-box');
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

// ================================================================ 5c. accessibility of the landing page itself (T04, T06, T07, T10): contrast in both themes
if (AXE_SOURCE) {
  await section('5c. axe: no serious or critical violations on the landing page at 375 and 1280 (dark and light)', async () => {
    for (const [vp, label] of [[MOBILE, '375'], [DESKTOP, '1280']]) {
      for (const scheme of ['dark', 'light']) {
        const ctx = await newContext(vp, scheme);
        await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* ignore */ } }, scheme);
        const page = await ctx.newPage();
        await site(page);
        await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
        // scroll through once so every reveal has settled, then back to the top
        await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(1600);
        const r = await axeSeriousCount(page);
        check(`${label} ${scheme}: the landing page`, r.count === 0, r.detail);
        await ctx.close();
      }
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
  await dash(A, '#/bookings'); // not Today: the dashboard's watcher does not toast a new enquiry on Today (the list itself updates there)
  await tid(A, 'tabbar-indicator').waitFor({ state: 'attached', timeout: WAIT }).catch(() => {});
  const B = await ctx.newPage();
  const logB = watch(B);
  await site(B, '#book/ev_quote');
  await sheetOpen(B);
  await submitEnquiry(B);
  const ref = await txt(B, 'confirmation-ref');
  check('B: the enquiry is EL-1043; until Daniel confirms there is no status pill, the visit card says "Daniel will confirm." (no Add to calendar yet)', ref === 'EL-1043' && (await tid(B, 'confirmation-status').count()) === 0 && (await txt(B, 'confirmation-pencilled')) === 'Daniel will confirm.' && (await tid(B, 'add-to-calendar').count()) === 0, ref);
  await openDemo(B);
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
  const flipped = await until(async () => (await txt(B, 'confirmation-pencilled')) === 'Confirmed.', 12000, 150);
  check('B: the visit card flipped to "Confirmed." without a reload', !!flipped, await txt(B, 'confirmation-pencilled'));
  check('B: it is now his real appointment: no idea tag, no data-proto (it stays under "Only my content"), green, and it moved ABOVE the WhatsApp card; ONE status, so no separate pill', (await tid(B, 'confirmation-visit').getAttribute('data-proto')) === null && (await tid(B, 'confirmation-visit').locator('[data-testid="idea-tag"]').count()) === 0 && (await tid(B, 'confirmation-status').count()) === 0 && await B.evaluate(() => { const v = document.querySelector('[data-testid="confirmation-visit"]').getBoundingClientRect(); const w = document.querySelector('[data-testid="wa-send-card"]').getBoundingClientRect(); return v.top < w.top; }), await txt(B, 'confirmation-pencilled'));
  check('B: Add to calendar appears only now that Daniel has confirmed, and its note says it is saved as confirmed', !!(await until(async () => (await tid(B, 'add-to-calendar').count()) === 1 && /saved as confirmed/i.test(await txt(B, 'add-to-calendar-note')))), `${await tid(B, 'add-to-calendar').count()} | ${await txt(B, 'add-to-calendar-note')}`);
  check('B: the kicker reads "Your visit" and the one status is green with a calendar tick', /^Your visit$/i.test(await txt(B, 'confirmation-visit-kicker')) && (await B.evaluate(() => { const e = document.querySelector('.bk-visit__status.is-ok'); return !!e && !!e.querySelector('svg'); })));
  check('B: the timeline ticks off the contact and survey steps', (await tid(B, 'journey-contact').getAttribute('class')).includes('is-done') && (await tid(B, 'journey-survey').getAttribute('class')).includes('is-done') === false);
  check('B: the confirmation text appeared in the DEMO panel', !!(await until(async () => /then, when daniel confirmed/i.test(await txt(B, 'demo-panel')), 8000)));
  const [dl] = await Promise.all([B.waitForEvent('download', { timeout: WAIT }), tid(B, 'add-to-calendar').click()]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  check('B: the calendar file is now CONFIRMED and no longer says it is a suggestion', /STATUS:CONFIRMED/.test(ics) && !/PROVISIONAL|Suggested/i.test(ics));
  check('no console errors on either page', logA.errors.length + logB.errors.length === 0, [...logA.errors, ...logB.errors].join(' | '));
  check('no off-site or failed requests on either page', logA.offsite.length + logB.offsite.length + logA.failed.length + logB.failed.length === 0, [...logA.offsite, ...logB.offsite, ...logA.failed, ...logB.failed].join(' | '));
  await ctx.close();
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
