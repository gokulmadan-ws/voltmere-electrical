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
  step1: { eyebrow: "Let's find the right home charging setup for you", title: "What's your installation postcode?", label: 'UK postcode', placeholder: 'e.g. BT7 3AB', error: 'Please enter a valid UK postcode so we can check your location.', help: 'Your postcode helps us confirm we cover your area.' },
  steps: [
    { n: 2, key: 'parking', title: 'Where would you normally park to charge?', why: 'Whatever you pick, we will check that a safe cable route and parking position can be arranged.', options: ['Private driveway', 'Garage', 'Allocated parking space', 'On-street parking', 'Other or not sure'], values: ['driveway', 'garage', 'allocated', 'street', 'other'] },
    { n: 3, key: 'vehicle', title: 'Do you already have your electric or plug-in hybrid car?', why: 'We use this to suggest a suitable charger.', options: ['Yes', "It's ordered or arriving soon", "I'm choosing one"], values: ['have', 'ordered', 'choosing'] },
    { n: 4, key: 'timing', title: 'When would you like your charger installed?', why: 'We use this to plan our diary around you.', options: ['As soon as possible', 'Within the next month', 'Within 1 to 3 months', 'Just researching'], values: ['asap', 'month', 'one_to_three', 'researching'] },
    { n: 5, key: 'permission', title: 'Can you authorise installation work at the property?', why: "Not sure yet? That's fine. We will help you work out what is needed.", options: ['Yes', 'I need landlord or freeholder approval', "I'm not sure"], values: ['yes', 'landlord', 'unsure'] }
  ],
  // T14: his note label "Anything else we should know? (optional)" wrapped over two lines of wide caps; it is now "Anything else?" with "Optional" as the helper line.
  step6: { title: 'Where can 180 Electrical contact you about your quote?', promise: '180 Electrical will contact you within 24 hours. Free, no-obligation quote.', labels: ['Full name', 'Installation postcode', 'Mobile number', 'Email address', 'Anything else?'], submit: 'Request my installation quote', optIn: 'Keep me updated with occasional offers and EV charging tips from 180 Electrical. Optional, and you can opt out at any time.', small: '180 Electrical will use these details to respond to your installation enquiry. By submitting your details you give us permission to contact you.' },
  // his own "Helpful to have ready" words, verbatim (docs/reference/180-site-report.md)
  confirm: { title: 'Thanks, your enquiry has been received.', body: 'The team at 180 Electrical will review your details and contact you to discuss your home charger installation within 24 hours. Please also check your emails.', ready: 'If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation.' }
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
const stepLabel = async (page) => ((await tid(page, 'funnel-step-label').first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim(); // textContent: the label voice is drawn in capitals, the words are "Step 1 of 6"
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
/** Open the "Demo: see what your phone would receive" row (the whole demo lives behind it, inside the dashed PROTOTYPE block). */
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
async function axeSeriousCount(page, context, tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'], levels = ['serious', 'critical']) {
  if (!AXE_SOURCE) return { count: 0, detail: 'axe-core not installed' };
  await page.evaluate(AXE_SOURCE);
  const res = await page.evaluate(async ([ctxSel, tagList, levelList]) => {
    const out = await window.axe.run(ctxSel ? { include: [ctxSel] } : document, { runOnly: { type: 'tag', values: tagList } });
    return out.violations.filter((v) => levelList.includes(v.impact)).map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`);
  }, [context || null, tags, levels]);
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
    const scope = await page.evaluate(() => [document.documentElement.getAttribute('data-scope'), document.documentElement.getAttribute('data-theme')].join('/'));
    check('the public page is LIGHT by default, even for a visitor whose phone prefers dark (paper canvas, data-scope="public", data-theme="light")', lum(bg) > 0.9 && scope === 'public/light', bg + ' ' + scope);
    check('his H1 is on the page', (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ').includes('Your own EV charger. Installed at home in Northern Ireland.'));
    check('the hero CTA reads "Get my installation quote"', (await txt(page, 'hero-cta')) === 'Get my installation quote', await txt(page, 'hero-cta'));
    // ---- the first screen (LANDING-V5 4.10, 5.2, 5.3): the black header, the H1 in solid ink, ONE red button, the 3:2 photo with the cut, the spec strip (his ticks and his credentials in the logo voice)
    const first = await page.evaluate(() => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height }; };
      const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : ''; };
      const inView = (b) => { const x = b.getBoundingClientRect(); const s = getComputedStyle(b); return x.width > 0 && x.height > 0 && x.bottom > 0 && x.top < innerHeight && s.visibility !== 'hidden' && s.display !== 'none'; };
      const h1 = document.querySelector('.lp-hero__title');
      const h1spans = h1 ? [...h1.children].map((c) => ({ text: c.textContent, lines: c.getClientRects().length })) : [];
      const logo = document.querySelector('.lp-header .lp-logo');
      const lb = logo ? logo.getBoundingClientRect() : { height: 0 };
      const fig = document.querySelector('[data-testid="l3-hero-visual"]');
      const proof = document.querySelector('[data-testid="hero-proof"]');
      const ticks = [...document.querySelectorAll('[data-testid="hero-ticks"] li')];
      const credsEl = document.querySelector('[data-testid="hero-creds"]');
      const labelledBy = credsEl ? document.getElementById(credsEl.getAttribute('aria-labelledby') || '_') : null;
      const navLinks = [...document.querySelectorAll('.lp-nav .lp-nav__link')];
      const phone = document.querySelector('[data-testid="lp-header-phone"]');
      return {
        vw: innerWidth, vh: innerHeight, header: box('[data-testid="lp-header"]'), headerBg: css('[data-testid="lp-header"]', 'backgroundColor'), headerPos: css('[data-testid="lp-header"]', 'position'),
        photo: box('[data-testid="hero-photo"]'), fig: box('[data-testid="l3-hero-visual"]'), cta: box('[data-testid="hero-cta"]'), free: box('[data-testid="hero-proof-free"]'), copy: box('.lp-hero__copy'), h1: box('.lp-hero__title'), subBox: box('.lp-hero__sub'),
        ctas: [...document.querySelectorAll('.lp-cta')].filter(inView).length, ctaBg: css('[data-testid="hero-cta"]', 'backgroundColor'), ctaH: css('[data-testid="hero-cta"]', 'height'), ctaRadius: css('[data-testid="hero-cta"]', 'borderTopLeftRadius'),
        h1text: h1 ? h1.textContent : '', h1spans, h1color: css('.lp-hero__title', 'color'), h1weight: css('.lp-hero__title', 'fontWeight'), h1stretch: css('.lp-hero__title', 'fontStretch'), h1size: parseFloat(css('.lp-hero__title', 'fontSize')),
        hl: document.querySelectorAll('.lp-hl, .lp-hero__slashes, .lp-hero__shade, .lp-hero__frame').length, eyebrow: (document.querySelector('.lp-hero__eyebrow') || { textContent: '' }).textContent, eyebrowCase: css('.lp-hero__eyebrow', 'textTransform'),
        sub: (document.querySelector('.lp-hero__sub') || { textContent: '' }).textContent, note: (document.querySelector('.lp-note') || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim(), subColor: css('.lp-hero__sub', 'color'),
        logoH: lb.height, logoImg: !!document.querySelector('.lp-header .lp-logo__img'), logoLabel: (document.querySelector('.lp-brand') || { getAttribute: () => '' }).getAttribute('aria-label'), brandMark: !!document.querySelector('.lp-header .bk-brand__mark'),
        phone: phone ? { href: phone.getAttribute('href'), label: phone.getAttribute('aria-label'), vis: inView(phone), text: phone.textContent.trim() } : null, callBtn: document.querySelectorAll('[data-testid="lp-call-button"]').length, headerBook: inView(document.querySelector('[data-testid="lp-header-book"]')),
        nav: navLinks.map((a) => a.textContent.trim()), navVisible: navLinks.length ? inView(navLinks[0]) : false,
        figClip: fig ? getComputedStyle(fig).clipPath : '', figKids: fig ? [...fig.children].map((c) => c.className) : [], figRadius: css('[data-testid="l3-hero-visual"]', 'borderTopLeftRadius') + css('[data-testid="hero-photo"]', 'borderTopLeftRadius'), figShadow: css('[data-testid="l3-hero-visual"]', 'boxShadow') + css('[data-testid="hero-photo"]', 'boxShadow'),
        photoImg: (() => { const i = document.querySelector('[data-testid="hero-photo"] img'); return i ? { alt: i.alt, w: i.getAttribute('width'), h: i.getAttribute('height'), sizes: i.sizes, fetchpriority: i.getAttribute('fetchpriority'), loading: i.getAttribute('loading') } : null; })(),
        proofRule: proof ? getComputedStyle(proof).borderTopWidth : '', tickText: ticks.map((li) => li.textContent.trim()), tickGlyphs: ticks.filter((li) => li.querySelector('svg.lp-glyph')).length, tickList: document.querySelector('[data-testid="hero-ticks"]') ? document.querySelector('[data-testid="hero-ticks"]').getAttribute('aria-label') : null,
        credLabel: labelledBy ? labelledBy.textContent.trim() : null, credRole: credsEl ? credsEl.getAttribute('role') : null, creds: [...document.querySelectorAll('[data-testid^="hero-cred-"]')].map((c) => c.textContent.trim()),
        figs: [...document.querySelectorAll('.lp-spec__cred .lp-fig')].map((f) => ({ t: f.textContent, style: getComputedStyle(f).fontStyle, weight: getComputedStyle(f).fontWeight, stretch: getComputedStyle(f).fontStretch })),
        visitInHero: !!document.querySelector('.lp-hero [data-testid="hero-visit"], .lp-hero [data-testid="live-availability"]'), pageText: document.body.innerText
      };
    });
    const INK = 'rgb(11, 11, 12)';
    check(vp.width < 1024 ? 'the header is a 64px black bar' : 'the header is a 72px black bar', Math.abs(first.header.h - (vp.width < 1024 ? 64 : 72)) <= 1 && first.headerBg === INK, JSON.stringify([first.header, first.headerBg]));
    check(vp.width < 720 ? 'the header is NOT sticky on a phone (it scrolls away; the bottom bar is the persistent control)' : 'the header is sticky from 720px', (vp.width < 720 ? /^(static|relative)$/.test(first.headerPos) : first.headerPos === 'sticky'), first.headerPos);
    check('the header brand is HIS logo picture (the cropped lockup, 48px tall, 56px from 1024), above the fold, named for screen readers, and NOT the bolt-in-a-square mark', first.logoImg && Math.abs(first.logoH - (vp.width < 1024 ? 48 : 56)) <= 1 && /^180 Electrical, back to the top$/.test(first.logoLabel || '') && !first.brandMark, JSON.stringify([first.logoImg, first.logoH, first.logoLabel, first.brandMark]));
    check('the header phone link is the call control (a tel: link named "Call 07885 496800"), there is no separate header Call button, and the red header button is not shown while the hero button is on screen', first.phone && first.phone.vis && /^tel:\+?\d{11,13}$/.test(first.phone.href) && first.phone.label === 'Call 07885 496800' && first.callBtn === 0 && !first.headerBook, JSON.stringify([first.phone, first.callBtn, first.headerBook]));
    check(vp.width >= 1024 ? 'the nav (from 1024px) is About, Our work, How it works, Pricing, Questions: no "Costs"' : 'the nav is hidden below 1024px', vp.width >= 1024 ? first.navVisible && JSON.stringify(first.nav) === JSON.stringify(['About', 'Our work', 'How it works', 'Pricing', 'Questions']) : !first.navVisible, JSON.stringify([first.nav, first.navVisible]));
    check('his H1 reads "Your own EV charger. Installed at home in Northern Ireland." as two spans, the first sentence on ONE line, solid ink, display voice (650, width 108), and no red span, no .lp-hl, no slashes, no shade, no frame anywhere in the hero', first.h1text === 'Your own EV charger. Installed at home in Northern Ireland.' && first.h1spans.length === 2 && first.h1spans[0].text === 'Your own EV charger.' && first.h1spans[0].lines === 1 && first.h1color === INK && first.h1weight === '650' && /108/.test(first.h1stretch) && first.hl === 0, JSON.stringify([first.h1text, first.h1spans, first.h1color, first.h1weight, first.h1stretch, first.hl]));
    check(vp.width >= 1280 ? 'the H1 is 92px at 1280' : 'the H1 is sized from the container (about (width - 48) / 10.4)', vp.width >= 1280 ? Math.abs(first.h1size - 92) < 0.6 : Math.abs(first.h1size - (vp.width - 48) / 10.4) < 0.6, String(first.h1size));
    check('his eyebrow (label voice: uppercase), his sub and the two lines under the button are word for word; "Free, no-obligation quote." is the ink line', first.eyebrow === 'Local EV charger installation' && first.eyebrowCase === 'uppercase' && first.sub === 'Make charging fit around your day. 180 Electrical helps homeowners across Northern Ireland choose and install the right charger for their home and vehicle.' && first.note === 'Tell us a little about your home and what you need. Free, no-obligation quote.' && (await txt(page, 'hero-proof-free')) === 'Free, no-obligation quote.' && first.subColor === INK, JSON.stringify([first.eyebrow, first.note, first.subColor]));
    check('the hero button is the one red fill on the first screen: #E11414, 56px, square, his exact label, and nothing else red is a button in view', first.ctas === 1 && first.ctaBg === 'rgb(225, 20, 20)' && first.ctaH === '56px' && first.ctaRadius === '0px' && (await txt(page, 'hero-cta')) === 'Get my installation quote', JSON.stringify([first.ctas, first.ctaBg, first.ctaH, first.ctaRadius]));
    check(vp.width >= 1024 ? 'the hero photo is a true 3:2 box, runs to the right edge (bleed) and sits in columns 5 to 12 beside the copy' : 'the hero photo is a true 3:2 box, full width (edge to edge) under the notes', Math.abs(first.photo.w / first.photo.h - 1.5) < 0.02 && (vp.width >= 1024 ? first.fig.right >= first.vw - 1 && first.copy.right <= first.fig.left + 1 && first.copy.top < first.fig.bottom : first.fig.w >= first.vw - 1 && first.fig.top >= first.cta.bottom), JSON.stringify([first.photo, first.fig, first.copy]));
    check('the hero photo carries the 45 degree cut (a clip-path polygon on the figure) and NOTHING else: no radius, no shadow, no overlay, no frame, no chip; it is eager, high priority and sized for 8 of 12 columns', /polygon/.test(first.figClip) && /^0px0px$/.test(first.figRadius) && /^nonenone$/.test(first.figShadow) && first.figKids.length === 1 && /lp-photo/.test(first.figKids[0]) && first.photoImg && first.photoImg.alt.length > 20 && first.photoImg.loading === 'eager' && first.photoImg.fetchpriority === 'high' && first.photoImg.sizes === '(min-width: 1024px) 65vw, 100vw', JSON.stringify([first.figClip, first.figRadius, first.figShadow, first.figKids, first.photoImg]));
    check('the spec strip under the photo carries HIS three ticks (each with an ink tick glyph) under a 1px ink rule, and the earliest visit is NOT in the hero any more', JSON.stringify(first.tickText) === JSON.stringify(['Advice on charger options', 'Installation tailored to your property', 'Speak directly with 180 Electrical']) && first.tickGlyphs === 3 && first.tickList === 'What you get' && first.proofRule === '1px' && !first.visitInHero, JSON.stringify([first.tickText, first.tickGlyphs, first.proofRule, first.visitInHero]));
    check('his two credentials are typography: a group labelled "Accredited and qualified", each a bold italic extended figure ("Level 3", "2391") with its descriptor, reading exactly "Level 3 Electrical Installation" and "2391 Inspection and Testing" in the DOM; no chips, no icons, "2391 tested" is nowhere', first.credRole === 'group' && first.credLabel === 'Accredited and qualified' && JSON.stringify(first.creds) === JSON.stringify(['Level 3 Electrical Installation', '2391 Inspection and Testing']) && first.figs.length === 2 && first.figs.every((f) => f.style === 'italic' && f.weight === '800' && /125/.test(f.stretch)) && first.figs[0].t === 'Level 3' && first.figs[1].t === '2391' && !/2391 tested/i.test(first.pageText), JSON.stringify([first.credRole, first.credLabel, first.creds, first.figs]));
    await tid(page, 'footer').waitFor({ timeout: WAIT });
    // ---- nothing is round or shadowed in the page (LANDING-V5 1.4: no radius, no shadow, no gradient except the closing stripes), and no more than one red button is ever in view
    const curvy = await page.evaluate(() => [...document.querySelectorAll('.lp-main *')].filter((el) => { const s = getComputedStyle(el); return /[1-9]/.test([s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius].join(' ')) || s.boxShadow !== 'none' || /gradient/.test(s.backgroundImage); }).map((el) => el.tagName.toLowerCase() + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ')[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8));
    check('no element in .lp-main has a border radius, a box shadow or a gradient (the closing stripes are drawn on the band itself, its ::before)', curvy.length === 0, curvy.join(', '));
    const redInView = () => page.evaluate(() => [...document.querySelectorAll('.lp-cta')].filter((b) => { const x = b.getBoundingClientRect(); const s = getComputedStyle(b); return x.width > 0 && x.height > 0 && x.bottom > 0 && x.top < innerHeight && s.visibility !== 'hidden' && s.display !== 'none'; }).length);
    const stops = [];
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += Math.round(vp.height * 0.55)) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      const n = await until(async () => (await redInView()) <= 1, 2500, 60);
      if (!n) stops.push(`${y}:${await redInView()}`);
    }
    check('at no scroll stop is more than ONE red "Get my installation quote" button in view (hero, header, in-page and sticky bar take turns)', stops.length === 0, stops.join(' '));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    // ---- the footer: the bottom half of the closing composition (black, the un-striped lockup, three keyed rows), the same at every width
    const foot2 = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="footer"]'); const lock = document.querySelector('[data-testid="footer-lockup"]'); const fin = document.querySelector('[data-testid="final-cta"]');
      const keys = [...f.querySelectorAll('dt')].map((e) => e.textContent.trim());
      const phone = document.querySelector('[data-testid="footer-phone"]');
      return { bg: getComputedStyle(f).backgroundColor, finBg: fin ? getComputedStyle(fin).backgroundColor : '', lockTag: lock.tagName, lockLabel: lock.getAttribute('aria-label'), logoH: lock.querySelector('.lp-logo') ? lock.querySelector('.lp-logo').getBoundingClientRect().height : 0, img: !!lock.querySelector('.lp-logo__img'), mark: !!f.querySelector('.bk-brand__mark'),
        phone: phone ? { text: phone.textContent, href: phone.getAttribute('href'), size: parseFloat(getComputedStyle(phone).fontSize), h: phone.getBoundingClientRect().height } : null, email: (document.querySelector('[data-testid="footer-email"]') || {}).textContent, emailHref: (document.querySelector('[data-testid="footer-email"]') || { getAttribute: () => '' }).getAttribute('href'), keys, area: /Serving Northern Ireland/.test(f.innerText),
        copy: (document.querySelector('[data-testid="footer-copyright"]') || {}).textContent, clutter: f.querySelectorAll('[data-testid="footer-owner-link"], [data-testid="footer-about-link"], [data-testid="footer-disclosure"], .ui-seg, [data-testid="l3-footer-whatsapp"], [data-testid="l3-footer-credentials"], [data-testid="l3-footer-book"], .lp-cta').length, links: f.querySelectorAll('a[href^="#"]:not(.lp-footer__logo)').length,
        finH: fin ? getComputedStyle(fin.querySelector('h2')).textAlign : '', finCta: fin ? { text: fin.querySelector('[data-testid="final-book"]').textContent.trim(), bg: getComputedStyle(fin.querySelector('[data-testid="final-book"]')).backgroundColor, h: fin.querySelector('[data-testid="final-book"]').getBoundingClientRect().height } : null,
        finStripe: fin ? getComputedStyle(fin, '::before').backgroundImage : '', footStripe: getComputedStyle(f, '::after').backgroundImage, finLinks: fin ? fin.querySelectorAll('a').length : -1 };
    });
    check('the closing band and the footer are one black block (#0B0B0C), the band flush left with his H2, one red button (64px) and no phone line, WhatsApp or second button, and the logo\'s red and white stripes drawn once at each end (band top-left, footer bottom-right)', foot2.bg === INK && foot2.finBg === INK && foot2.finH !== 'center' && foot2.finCta && foot2.finCta.text === 'Get my installation quote' && foot2.finCta.bg === 'rgb(225, 20, 20)' && foot2.finCta.h === 64 && foot2.finLinks === 0 && /linear-gradient/.test(foot2.finStripe) && /linear-gradient/.test(foot2.footStripe), JSON.stringify([foot2.bg, foot2.finBg, foot2.finH, foot2.finCta, foot2.finLinks]));
    check(`the footer is HIS logo picture (the un-striped lockup, ${vp.width < 1024 ? 88 : 112}px tall, a link back to the top, not the bolt mark), Phone at ${vp.width < 720 ? 32 : vp.width < 1024 ? 40 : 48}px in the display voice, Email, Area, and a small copyright line; keys Phone, Email, Area; no owner login, theme switch, disclosure, link cloud, WhatsApp, credentials line or quote button`, foot2.img && Math.abs(foot2.logoH - (vp.width < 1024 ? 88 : 112)) <= 1 && foot2.lockTag === 'A' && /back to the top/.test(foot2.lockLabel) && !foot2.mark && foot2.phone && foot2.phone.text === '07885 496800' && /^tel:\+?\d{11,13}$/.test(foot2.phone.href) && Math.abs(foot2.phone.size - (vp.width < 720 ? 32 : vp.width < 1024 ? 40 : 48)) < 0.6 && foot2.phone.h >= 44 && foot2.email === 'daniel@180electrical.co.uk' && /^mailto:/.test(foot2.emailHref) && JSON.stringify(foot2.keys) === JSON.stringify(['Phone', 'Email', 'Area']) && foot2.area && /^© 2026 180 Electrical$/.test(foot2.copy) && foot2.clutter === 0 && foot2.links === 0, JSON.stringify(foot2));
    if (vp.width < 720) {
      check('the H1, the sub, the red button and the two lines under it are all above the fold (the photo starts below them)', first.h1.top > 0 && first.subBox.bottom < first.vh && first.cta.bottom < first.vh - 4 && first.free.bottom < first.vh - 4, JSON.stringify({ cta: first.cta, free: first.free, vh: first.vh }));
      check('the sticky bottom bar is hidden on the first screen', await until(async () => !(await tid(page, 'sticky-bar').isVisible())));
      const aboutTop = () => page.evaluate(() => { const g = document.querySelector('[data-testid="about"]'); window.scrollTo({ top: g.getBoundingClientRect().top + scrollY + 300, behavior: 'instant' }); });
      await aboutTop();
      check('the sticky bottom bar slides in once the hero button has scrolled out of view', await until(() => tid(page, 'sticky-bar').isVisible()));
      const bar = await tid(page, 'sticky-bar').boundingBox();
      check('the sticky bar is 80px tall (plus its 1px rule)', bar && bar.height >= 79 && bar.height <= 82, JSON.stringify(bar));
      const stk = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="sticky-bar"]'); const call = document.querySelector('[data-testid="sticky-call"]'); const book = document.querySelector('[data-testid="sticky-book"]');
        return { bg: getComputedStyle(el).backgroundColor, bt: getComputedStyle(el).borderTopWidth, btc: getComputedStyle(el).borderTopColor, shadow: getComputedStyle(el).boxShadow, label: el.getAttribute('aria-label'),
          call: call ? { tag: call.tagName, href: call.getAttribute('href'), label: call.getAttribute('aria-label'), text: call.textContent.trim(), h: call.getBoundingClientRect().height, bg: getComputedStyle(call).backgroundColor, cta: call.classList.contains('lp-cta') } : null,
          book: book ? { text: book.textContent.trim(), h: book.getBoundingClientRect().height, bg: getComputedStyle(book).backgroundColor, w: book.getBoundingClientRect().width, cta: book.classList.contains('lp-cta') } : null };
      });
      check('the sticky bar is an OPAQUE paper surface with a 1px ink top rule and no shadow, with an outlined Call (a tel: link, 56px, no fill, not a quote button) and the one red button (56px, his exact label)', stk.bg === 'rgb(245, 245, 244)' && stk.bt === '1px' && stk.btc === INK && stk.shadow === 'none' && stk.label === 'Quick actions' && stk.call && stk.call.tag === 'A' && /^tel:\+?\d{11,13}$/.test(stk.call.href) && stk.call.label === 'Call 07885 496800' && stk.call.text === 'Call' && stk.call.h === 56 && /rgba\(0, 0, 0, 0\)|transparent/.test(stk.call.bg) && !stk.call.cta && stk.book && stk.book.text === 'Get my installation quote' && stk.book.h === 56 && stk.book.bg === 'rgb(225, 20, 20)' && stk.book.cta, JSON.stringify(stk));
      check('the header phone link and the sticky Call are the two call controls (no header Call button)', (await tid(page, 'lp-header-phone').count()) === 1 && (await tid(page, 'sticky-call').count()) === 1 && (await tid(page, 'lp-call-button').count()) === 0);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      check('the sticky bar hides again when the hero button is back on screen (visibility hidden: it leaves the tab order)', await until(async () => !(await tid(page, 'sticky-bar').isVisible()) && (await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="sticky-bar"]')).visibility)) === 'hidden'));
      // ---- one red button at a time: the bar steps aside at the postcode section and the closing band
      for (const [label, target] of [['the postcode section', '[data-testid="area-form"]'], ['the closing band', '[data-testid="final-cta"]']]) {
        await page.evaluate((sel) => { const el = document.querySelector(sel); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 140, behavior: 'instant' }); }, target);
        check(`at ${label} the sticky bar steps aside`, await until(async () => !(await tid(page, 'sticky-bar').isVisible())));
        const state = await page.evaluate(() => {
          const reds = [...document.querySelectorAll('.lp-cta')].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && x.bottom > 0 && x.top < innerHeight && getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).display !== 'none'; });
          const cut = reds.filter((b) => { const x = b.getBoundingClientRect(); return x.top < 0 || x.bottom > innerHeight; }).length;
          return { n: reds.length, cut };
        });
        check(`at ${label} exactly one red "Get my installation quote" is in view and none is half hidden`, state.n === 1 && state.cut === 0, JSON.stringify(state));
      }
      // the end of the page: the closing band has gone, the footer has no button of its own, and the sticky bar must not cover the last footer line (it is out of the way or the line is above it)
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await tid(page, 'footer-copyright').waitFor({ timeout: WAIT });
      await page.waitForTimeout(500);
      const foot = await page.evaluate(() => {
        const last = document.querySelector('[data-testid="footer-copyright"]').getBoundingClientRect();
        const barEl = document.querySelector('[data-testid="sticky-bar"]');
        const barOn = barEl && getComputedStyle(barEl).visibility !== 'hidden';
        return { lastBottom: last.bottom, barOn, barTop: barEl ? barEl.getBoundingClientRect().top : 9999, vh: innerHeight };
      });
      check('at the end of the page the last footer line is not under the sticky bar', foot.lastBottom <= (foot.barOn ? foot.barTop : foot.vh) + 1, JSON.stringify(foot));
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      // the gallery film strip, its pager ticks and the photo viewer are checked in section 1c (LANDING-V5 4.8 and 5.6)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    } else {
      check('the sticky bottom bar is never shown from 720px', !(await tid(page, 'sticky-bar').isVisible()));
      // ---- the header's red button: only after the hero button has scrolled out, small (44px, no arrow), and it steps aside while an in-page red button (postcode section, closing band) is on screen
      await page.evaluate(() => window.scrollTo({ top: 1500, behavior: 'instant' }));
      const hb = await until(async () => (await tid(page, 'lp-header-book').isVisible()) && (await page.evaluate(() => { const h = document.querySelector('[data-testid="lp-header"]').getBoundingClientRect(); const b = document.querySelector('[data-testid="lp-header-book"]'); return h.top === 0 && b.getBoundingClientRect().height === 44 && b.querySelector('svg') === null && b.textContent.trim() === 'Get my installation quote'; })));
      check('once the hero button has scrolled out the sticky header shows the one small red button (44px, his label, no arrow) and stays at the top of the screen', !!hb);
      for (const [label, target] of [['the postcode section', '[data-testid="area-form"]'], ['the closing band', '[data-testid="final-cta"]']]) {
        await page.evaluate((sel) => { const el = document.querySelector(sel); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 200, behavior: 'instant' }); }, target);
        check(`at ${label} the header button steps aside (the page's own red button is the only one)`, await until(async () => !(await tid(page, 'lp-header-book').isVisible())));
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      check('back at the top the header button is gone again (the hero button is the one)', await until(async () => !(await tid(page, 'lp-header-book').isVisible())));
      // the section compositions at 1280 (the plate, the three step columns, the sticky headings) are checked in section 1c2
      check('the footer has no quote button', (await tid(page, 'l3-footer-book').count()) === 0);
    }
    await tid(page, 'hero-cta').click();
    await sheetOpen(page);
    check('the CTA opens the quote funnel at #book/ev_quote', (await hashOf(page)) === '#book/ev_quote', await hashOf(page));
    check('funnel starts at "Step 1 of 6"', (await stepLabel(page)) === 'Step 1 of 6', await stepLabel(page));
    if (vp.width < 720) check('sticky bar is hidden while the sheet is open', !(await tid(page, 'sticky-bar').isVisible()));
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
await landingLoad('375 (a phone set to dark mode)', MOBILE, 'dark');
await landingLoad('1280', DESKTOP, 'light');

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

// ================================================================ 1c. the landing's sections (LANDING-V5 5.4 to 5.10 and 6): his words, the compositions, the three tagged ideas
// His verbatim copy for the sections below the hero (docs/reference/180-site-report.md); tests/qa/audit.mjs diffs the rendered page against the report itself.
const HIS = {
  whyTitle: 'Home charging that works around you.',
  why: [["Charge while you're at home", 'Plug in when you arrive and charge around your routine.'], ['Choose with confidence', 'Get help choosing a charger suited to your vehicle, property and preferences.'], ['Make the most of smart charging', 'Compatible chargers and suitable electricity tariffs can let you schedule charging for off-peak periods.']],
  aboutTitle: 'Meet your local EV charger installers.',
  aboutP1: '180 Electrical installs home EV chargers for homeowners across Northern Ireland. We take time to understand your property and how you drive, then fit a charger that suits both.',
  aboutP2: 'Every visit is planned around a safe cable route and a tidy finish, so your charger looks like it belongs on your home.',
  workLabel: 'Our recent work', workTitle: 'Installations across Northern Ireland', walls: ['Red brick wall', 'Pebbledash wall', 'Orange brick wall', 'Brick pillar'],
  stepsTitle: 'From first enquiry to charging at home.',
  steps: [['Tell us about your home', 'Answer a few short questions about your location, parking and plans.'], ['Discuss your installation', 'The team will review your enquiry and explain the next steps. Photos or a survey may be needed to prepare an accurate quote.'], ['Arrange your installation', 'Once you are happy with the agreed quote and scope, arrange a suitable installation date.']],
  pricingTitle: 'Your installation, clearly quoted.',
  pricingP: 'Costs depend on your charger choice, cable route and any electrical work required. Tell us about your home so the team can advise on the next steps towards an accurate quote.',
  areaTitle: 'EV charger installation in Northern Ireland.',
  areaP: 'We install home chargers across Northern Ireland. If you are not sure, enter your postcode and we will check.',
  areaNote: 'Enter your postcode so we can check your location.',
  invalid: 'Please enter a valid UK postcode so we can check your location.',
  faqTitle: 'Frequently asked questions',
  faq: [
    ['Which charger is right for my car?', 'Most home chargers suit most electric and plug-in hybrid cars, but the best choice depends on your vehicle, how you drive and your preferences. We will help you weigh up the options once we know a little about your setup.'],
    ['Do I need a driveway or private parking?', 'A charger needs a suitable parking position and a safe route for the cable that does not create a hazard. We assess this for your property rather than assuming it. Running a cable across a public pavement is not a standard solution, so let us know your setup and we will advise.'],
    ['How much will installation cost?', 'It depends on the charger you choose, the cable route and any electrical work your property needs. We give you a clear quote once we understand your requirements, rather than a headline figure that changes later.'],
    ['How long does installation take?', 'Timing varies with the property and the scope of work involved. Once the team has reviewed your enquiry, they can talk you through what to expect for your specific installation.'],
    ['Can I have a charger installed before my car arrives?', 'Many homeowners plan the installation while waiting for their car. Tell us where you are in the process and we will suggest sensible timing so your charger is ready when you need it.'],
    ['What happens after I enquire?', 'The team reviews your details and contacts you to discuss your installation and the next steps. Submitting the form is an enquiry, not a booking, and it does not produce an instant final price.']
  ]
};
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

await section('1c. landing sections at 375: his words verbatim, no numbers or eyebrows, the earliest visit in step 02, the quote and the calculator as ruled rows, no radius, shadow or card', async () => {
  const ctx = await newContext(MOBILE, 'light');
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  await tid(page, 'final-cta').waitFor({ state: 'attached', timeout: WAIT });
  // ---- order and length
  const order = await page.evaluate(() => ['why', 'about', 'work', 'how', 'pricing', 'savings', 'area', 'faq', 'final'].map((id) => document.getElementById(id).getBoundingClientRect().top + scrollY));
  check('section order: why, about, work, how it works, your quote (with its two ideas), the postcode check, questions, the closing band', order.every((v, i) => i === 0 || v > order[i - 1]), JSON.stringify(order));
  const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
  check('the whole page at 375 stays compact (9,300px or less with the ideas on)', pageH <= 9300, String(pageH));
  // ---- the anti-slop blacklist in the DOM: no old section chrome, labels only where they are his words, the logo voice in three places, no radius, shadow or card
  const look = await page.evaluate(() => {
    const main = document.querySelector('.lp-main');
    const shown = (el) => el.getClientRects().length > 0;
    const old = main.querySelectorAll('.lp-eyebrow, .lp-section, .lp-section__head, .lp-title, .lp-section--band, .lp-qcard, .lp-qidea, .lp-gallery, .lp-tile, .lp-meet, .lp-why__n, .lp-hl, .lp-hero__slashes').length;
    const labels = [...main.querySelectorAll('.lp-lbl')].filter((el) => !el.closest('[data-proto], form, .lp-hero, .lp-calc__more')).map((el) => el.textContent.trim());
    const voice = [...main.querySelectorAll('.lp-logovoice')].filter((el) => !el.closest('.lp-hero')).map((el) => (el.classList.contains('lp-step__n') ? 'step' : el.closest('.lp-brands__list') ? 'brand' : 'OTHER:' + el.className));
    const bad = [];
    for (const el of main.querySelectorAll('*')) {
      if (!shown(el)) continue;
      const c = getComputedStyle(el);
      if (c.borderTopLeftRadius !== '0px' || c.borderTopRightRadius !== '0px' || c.borderBottomLeftRadius !== '0px' || c.borderBottomRightRadius !== '0px') bad.push('radius:' + el.className);
      if (c.boxShadow !== 'none') bad.push('shadow:' + el.className);
      if (/gradient/.test(c.backgroundImage) && !el.closest('.lp-final')) bad.push('gradient:' + el.className);
      if (c.filter !== 'none' || c.backdropFilter !== 'none') bad.push('filter:' + el.className);
      const pb = getComputedStyle(el, '::after').maskImage; if (pb && pb !== 'none') bad.push('mask:' + el.className);
    }
    const cuts = [...document.querySelectorAll('.lp-cut-tl, .lp-cut-br')].map((el) => ({ tl: el.classList.contains('lp-cut-tl'), clip: getComputedStyle(el).clipPath.startsWith('polygon'), photo: !!el.querySelector('[data-testid="hero-photo"], [data-testid="about-photo"]') }));
    const reds = [...main.querySelectorAll('*')].filter((el) => shown(el) && !el.closest('.lp-btn, .lp-final') && /rgb\(225, 20, 20\)/.test(getComputedStyle(el).color + getComputedStyle(el).backgroundColor + getComputedStyle(el).borderTopColor)).map((el) => el.className || el.tagName);
    return { old, labels, voice, bad: [...new Set(bad)], cuts, reds: [...new Set(reds)] };
  });
  check('no old section chrome (eyebrows, section heads, bands, cards, tiles, the portrait band, red words) and no section numbers in front of labels', look.old === 0, JSON.stringify(look.old));
  check('after the hero only two labels remain, both his words: "Charger brands we install" and "Our recent work"', JSON.stringify(look.labels) === JSON.stringify(['Charger brands we install', 'Our recent work']), JSON.stringify(look.labels));
  check('the logo voice (bold italic extended) is used for exactly the three step numerals and the three brand names below the hero', look.voice.join() === 'brand,brand,brand,step,step,step', look.voice.join());
  check('no element in the page body has a border radius, a box shadow, a filter or a gradient (except the closing stripes) or a bolt mask', look.bad.length === 0, look.bad.join(' | '));
  check('exactly two photographs carry the 45 degree cut: the hero (top-left) and the About photo (bottom-right)', look.cuts.length === 2 && look.cuts[0].tl && look.cuts[0].photo && !look.cuts[1].tl && look.cuts[1].photo && look.cuts.every((c) => c.clip), JSON.stringify(look.cuts));
  check('red text, red borders or red fills appear nowhere in the sections except the step 01 rule and the FAQ marker (checked on the open FAQ item and step 01 only)', look.reds.every((r) => /lp-step|lp-pm|lp-faq/.test(r)), look.reds.join(' | '));
  // ---- Why: his three rows, the call to action is a text link
  const why = await page.evaluate(() => ({ h2: document.getElementById('why-title').textContent.trim(), rows: [...document.querySelectorAll('#why .lp-rows li')].map((li) => [li.querySelector('h3').textContent.trim(), li.querySelector('p').textContent.trim()]), cta: (() => { const a = document.querySelector('[data-testid="why-cta"]'); const c = getComputedStyle(a); return { tag: a.tagName, text: a.textContent.trim(), bg: c.backgroundColor, h: a.getBoundingClientRect().height, link: a.classList.contains('lp-link'), cta: a.classList.contains('lp-cta') }; })(), eyebrow: !!document.querySelector('#why .lp-eyebrow, #why .lp-lbl') }));
  check('Why: his H2 and his three rows, word for word, with no eyebrow, no number and no icon', why.h2 === HIS.whyTitle && JSON.stringify(why.rows) === JSON.stringify(HIS.why) && !why.eyebrow && (await page.locator('#why svg:not(.lp-glyph)').count()) === 0, JSON.stringify(why));
  check('Why: the call to action is an underlined text link "Get my installation quote" (not a red button, not an .lp-cta), 44px high', why.cta.text === 'Get my installation quote' && why.cta.link && !why.cta.cta && why.cta.bg === 'rgba(0, 0, 0, 0)' && why.cta.h >= 44, JSON.stringify(why.cta));
  // ---- About: his H2 and BOTH paragraphs, no name, no caption, no ticks, no call or WhatsApp buttons
  const about = await page.evaluate(() => { const ph = document.querySelector('[data-testid="about-photo"]').getBoundingClientRect(); return { h2: document.getElementById('about-title').textContent.trim(), p1: document.querySelector('[data-testid="about-body"] p:first-child').textContent.trim(), pull: document.querySelector('[data-testid="about-pull"]').textContent.trim(), text: document.getElementById('about').innerText, ratio: ph.width / ph.height, w: ph.width, vw: innerWidth, gone: ['about-ticks', 'about-caption', 'about-call', 'about-whatsapp'].filter((id) => document.querySelector(`[data-testid="${id}"]`)), brands: [...document.querySelectorAll('[data-testid="brands"] li')].map((li) => li.textContent.trim()), label: document.querySelector('[data-testid="brands"] .lp-lbl').textContent.trim() }; });
  check('About: "Meet your local EV charger installers." is his verbatim H2 with both of his paragraphs (the second is about-pull), and nothing says Daniel', about.h2 === HIS.aboutTitle && about.p1 === HIS.aboutP1 && about.pull === HIS.aboutP2 && !/Daniel/.test(about.text), JSON.stringify([about.h2, about.p1, about.pull]));
  check('About: no ticks, no caption, no Call or WhatsApp buttons (they are retired); his brand list is plain text under "Charger brands we install"', about.gone.length === 0 && about.brands.join() === 'ZAPPI,OHME,SYNC' && about.label === 'Charger brands we install', JSON.stringify(about));
  check('About: the photo is 4:3 and full-bleed on a phone, with the bottom-right cut', Math.abs(about.ratio - 4 / 3) < 0.02 && Math.abs(about.w - about.vw) < 1, JSON.stringify([about.ratio, about.w, about.vw]));
  // ---- the work: a film strip, numbered captions that name only the wall, pager ticks
  const work = await page.evaluate(() => { const row = document.querySelector('[data-testid="l3-gallery-row"]'); const cards = [...row.children].map((li) => li.getBoundingClientRect()); const photos = [0, 1, 2, 3].map((i) => document.querySelector(`[data-testid="l3-gallery-open-${i}"]`).getBoundingClientRect()); return { snap: getComputedStyle(row).scrollSnapType, role: row.getAttribute('role'), tag: row.tagName, peek: cards[1].left < innerWidth - 8, h: photos.map((p) => Math.round(p.height)), w: photos.map((p) => Math.round(p.width)), caps: [...document.querySelectorAll('[data-testid^="gallery-chip-"]')].map((c) => c.textContent.trim()), over: [...document.querySelectorAll('.lp-gal__b *')].filter((e) => e.matches('figcaption, .lp-lbl, span:not(.lp-photo)')).length, aria: [0, 1, 2, 3].map((i) => document.querySelector(`[data-testid="l3-gallery-open-${i}"]`).getAttribute('aria-label')), zoom: parseFloat(getComputedStyle(document.querySelector('[data-testid="gallery-photo-1"]')).getPropertyValue('--zoom')), dots: [...document.querySelectorAll('[data-testid^="gallery-dot-"]')].map((d) => { const r = d.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }), head: document.getElementById('work-title').textContent.trim(), hint: !!document.querySelector('.lp-gallery__hint') }; });
  check('Work: a film strip (snap-x, the next photo peeks), every photo 344px tall at its own ratio, four pager ticks that are 44px targets, no hint line', /x/.test(work.snap) && work.peek && work.h.every((h) => h === 344) && work.w[2] > work.w[0] && work.dots.length === 4 && work.dots.every(([w, h]) => w >= 44 && h >= 44) && !work.hint, JSON.stringify(work));
  check('Work: his label and heading, numbered captions under the photos that name only the wall, nothing laid over a photograph', work.head === HIS.workTitle && JSON.stringify(work.caps) === JSON.stringify(HIS.walls.map((w, i) => `0${i + 1} ${w}`)) && work.over === 0 && work.aria[0] === 'View photo 1 of 4 larger', JSON.stringify([work.head, work.caps, work.over]));
  check('Work: photo 02 (the phone screenshot) is zoomed 1.4 or more so its black bars fall outside the tile', work.zoom >= 1.4, String(work.zoom));
  // T15: the pager is an indicator on the grid: the first DRAWN tick sits on the 24px margin (its 44px tap area starts 10px left of it), "1 of 4" is flush right, and the next rule is 48px below what is drawn
  const pager = await page.evaluate(() => {
    const dots = document.querySelector('[data-testid="gallery-dots"]');
    const R = (el) => el.getBoundingClientRect();
    const ticks = [...dots.querySelectorAll('button > span')].map((s) => R(s));
    const cnt = dots.querySelector('[data-testid="gallery-count"]');
    const cs = getComputedStyle(cnt);
    const ruleHow = R(document.querySelector('#how .lp-sec__in')).top;
    return { left: ticks.map((t) => Math.round(t.left)), w: ticks.map((t) => Math.round(t.width)), h: ticks.map((t) => Math.round(t.height)), boxL: Math.round(R(dots.querySelector('button')).left), cnt: cnt.textContent, aria: cnt.getAttribute('aria-hidden'), fs: cs.fontSize, color: cs.color, right: Math.round(R(cnt).right), vw: innerWidth, toRuleFromTick: Math.round(ruleHow - ticks[0].bottom), toRuleFromBox: Math.round(ruleHow - R(dots).bottom), inGroup: !!cnt.closest('[role="group"]'), ink2: getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim() };
  });
  check('Work pager: the first drawn tick starts at the 24px margin (x=24), the ticks keep their 24 x 2 mark every 44px, each in a 44px tap area that starts at x=14', pager.left[0] === 24 && pager.left.every((l, i) => l === 24 + 44 * i) && pager.w.every((w) => w === 24) && pager.h.every((h) => h === 2) && pager.boxL === 14, JSON.stringify(pager));
  check('Work pager: a 14px grey "1 of 4" counter (aria-hidden, in the pager group) sits flush with the right margin', pager.cnt === '1 of 4' && pager.aria === 'true' && pager.fs === '14px' && pager.inGroup && pager.right === pager.vw - 24 && /rgb\(85, 85, 90\)/.test(pager.color), JSON.stringify(pager));
  check('Work pager: the next section\'s rule is 48px or less below the pager (counted from the drawn tick and from the tap area): no dead zone under the gallery', pager.toRuleFromTick <= 48 && pager.toRuleFromBox <= 48 && pager.toRuleFromTick > 0, JSON.stringify([pager.toRuleFromTick, pager.toRuleFromBox]));
  check('Work pager: the counter follows the scroll ("4 of 4" at the end of the strip) and the ticks ("2 of 4" after pressing the second)', await (async () => {
    await page.evaluate(() => { const l = document.querySelector('[data-testid="l3-gallery-row"]'); l.scrollTo({ left: l.scrollWidth, behavior: 'instant' }); });
    const atEnd = await until(async () => (await txt(page, 'gallery-count')) === '4 of 4');
    await tid(page, 'gallery-dot-1').click();
    return !!atEnd && !!(await until(async () => (await txt(page, 'gallery-count')) === '2 of 4'));
  })(), await txt(page, 'gallery-count'));
  await page.evaluate(() => { const l = document.querySelector('[data-testid="l3-gallery-row"]'); l.scrollTo({ left: 0, behavior: 'instant' }); });
  await until(async () => (await tid(page, 'gallery-dot-0').getAttribute('aria-current')) === 'true');
  check('Work pager: back at the start the counter says "1 of 4" again', !!(await until(async () => (await txt(page, 'gallery-count')) === '1 of 4')), await txt(page, 'gallery-count'));
  // T15: no blank gap over 72px between the last drawn content and the next section's rule in Why, the gallery or the calculator (phones); the Why link sits 48px above the About rule
  const rhythm = await page.evaluate(() => {
    const R = (el) => el.getBoundingClientRect();
    const rule = (id) => R(document.querySelector(`#${id} .lp-sec__in`)).top;
    const cta = R(document.querySelector('[data-testid="why-cta"]'));
    const calcFoot = R(document.querySelector('.lp-calc__foot'));
    const gaps = { why: rule('about') - (cta.bottom - 9), work: rule('how') - R(document.querySelector('[data-testid="gallery-dots"] button > span')).bottom, calc: rule('area') - calcFoot.bottom };
    return { gaps, about: getComputedStyle(document.getElementById('about')).paddingTop, token: getComputedStyle(document.documentElement).getPropertyValue('--sec-l').trim() };
  });
  check('Rhythm at 375: the Why link\'s underline is 48px above the About rule, the pager 48px above the How rule, the calculator note 64px above the Area rule (none over 72px); the section tokens are untouched', Math.round(rhythm.gaps.why) === 48 && Math.round(rhythm.gaps.work) === 48 && Math.round(rhythm.gaps.calc) <= 72 && rhythm.token === '96px', JSON.stringify(rhythm));
  check('Work: the first pager tick is current, and they follow the scroll and scroll to a photo on press', (await tid(page, 'gallery-dot-0').getAttribute('aria-current')) === 'true' && await (async () => {
    await page.evaluate(() => { const l = document.querySelector('[data-testid="l3-gallery-row"]'); l.scrollTo({ left: l.scrollWidth, behavior: 'instant' }); });
    const followed = await until(async () => (await tid(page, 'gallery-dot-3').getAttribute('aria-current')) === 'true');
    await tid(page, 'gallery-dot-1').click();
    return followed && !!(await until(async () => (await tid(page, 'gallery-dot-1').getAttribute('aria-current')) === 'true'));
  })());
  // ---- the lightbox (same logic, new skin): Close first, the whole photo, the caption is the wall, Previous and Next are outlined 56px squares
  await tid(page, 'l3-gallery-open-1').click();
  await tid(page, 'l3-lightbox').waitFor({ timeout: WAIT });
  check('the viewer takes focus (Close first), says "Photo 2 of 4" and captions the photo with its wall', !!(await until(async () => (await activeId(page)) === 'l3-lightbox-close')) && (await txt(page, 'l3-lightbox-count')) === 'Photo 2 of 4' && (await txt(page, 'l3-lightbox-caption')) === 'Pebbledash wall', await activeId(page));
  const lb = await page.evaluate(() => { const q = (id) => document.querySelector(`[data-testid="${id}"]`); const r = (id) => q(id).getBoundingClientRect(); const bg = getComputedStyle(q('l3-lightbox')); const img = q('l3-lightbox-img'); const cap = r('l3-lightbox-caption'); return { img: r('l3-lightbox-img'), cap, prev: r('l3-lightbox-prev'), next: r('l3-lightbox-next'), close: r('l3-lightbox-close'), vh: innerHeight, bg: bg.backgroundColor, blur: bg.backdropFilter, fit: getComputedStyle(img).objectFit, closeText: q('l3-lightbox-close').textContent.trim(), closeLabel: q('l3-lightbox-close').getAttribute('aria-label'), live: q('l3-lightbox-count').getAttribute('aria-live'), radius: getComputedStyle(q('l3-lightbox-prev')).borderRadius, icons: q('l3-lightbox').querySelectorAll('.ui-icon').length }; });
  check('the viewer is full-screen black with no blur and no shared icons; Close is a text button with its aria-label; the photo is contained (never cropped)', /rgb\(11, 11, 12\)/.test(lb.bg) && (lb.blur === 'none' || !lb.blur) && lb.closeText === 'Close' && lb.closeLabel === 'Close photo viewer' && lb.fit === 'contain' && lb.live === 'polite' && lb.icons === 0, JSON.stringify(lb));
  check('Previous and Next are 56px or larger squares (square corners) and Close is a 44px target; the caption sits under the photo, never over it', lb.prev.width >= 56 && lb.prev.height >= 56 && lb.next.height >= 56 && lb.radius === '0px' && lb.close.height >= 44 && lb.cap.top >= lb.img.bottom - 1, JSON.stringify({ prev: lb.prev, close: lb.close, cap: lb.cap, img: lb.img }));
  await page.keyboard.press('ArrowRight');
  check('arrow keys move through the photos (3 of 4, the orange brick wall)', (await txt(page, 'l3-lightbox-count')) === 'Photo 3 of 4' && (await txt(page, 'l3-lightbox-caption')) === 'Orange brick wall');
  await tid(page, 'l3-lightbox-prev').click();
  check('the Previous button goes back (2 of 4)', (await txt(page, 'l3-lightbox-count')) === 'Photo 2 of 4');
  let stray = 0;
  for (let i = 0; i < 6; i += 1) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('[data-testid="l3-lightbox"]')))) stray += 1; }
  check('focus is trapped in the viewer and the page does not scroll behind it', stray === 0 && (await page.evaluate(() => document.documentElement.classList.contains('is-scroll-locked'))), 'stray=' + stray);
  await shot(page, 'landing-lightbox-375');
  await page.keyboard.press('Escape');
  check('Escape closes the viewer and focus returns to the photo that opened it; the scroll lock is released', !!(await until(async () => (await tid(page, 'l3-lightbox').count()) === 0 && (await activeId(page)) === 'l3-gallery-open-1')) && !(await page.evaluate(() => document.documentElement.classList.contains('is-scroll-locked'))), await activeId(page));
  // ---- How it works: his three steps, the numerals are decorative, step 01 has the red rule, the earliest visit is an annotation on step 02
  await page.evaluate(() => { document.getElementById('how').scrollIntoView(); });
  const how = await page.evaluate(() => {
    const lis = [...document.querySelectorAll('[data-testid="l3-steps"] > li')];
    const visit = document.querySelector('[data-testid="hero-visit"]');
    const vcs = visit ? getComputedStyle(visit) : null;
    return {
      olTag: document.querySelector('[data-testid="l3-steps"]').tagName, h2: document.getElementById('how-title').textContent.trim(),
      steps: lis.map((li) => [li.querySelector('h3').textContent.trim(), li.querySelector('.lp-step__t > p').textContent.trim()]),
      nums: lis.map((li) => { const n = li.querySelector('.lp-step__n'); return [n.textContent.trim(), n.getAttribute('aria-hidden')]; }),
      rule: lis.map((li) => [getComputedStyle(li).borderTopWidth, getComputedStyle(li).borderTopColor, getComputedStyle(li).borderBottomWidth]),
      visitIn: lis.map((li) => !!li.querySelector('[data-testid="hero-visit"]')), proto: visit && visit.hasAttribute('data-proto'), tag: visit && visit.querySelector('[data-testid="idea-tag"]') ? visit.querySelector('[data-testid="idea-tag"]').textContent.trim() : '',
      dashed: vcs && vcs.borderTopStyle, k: visit && visit.querySelector('.lp-visit__k').textContent.trim(), when: visit && visit.querySelector('[data-testid="next-free-slot"]').textContent.trim(), conf: visit && visit.querySelector('.lp-visit__conf').textContent.trim(),
      timeTag: !!(visit && visit.querySelector('[data-testid="next-free-slot"] time[datetime]')), interactive: visit ? visit.querySelectorAll('a, button, input').length : -1, sec: document.getElementById('how').innerText
    };
  });
  check('How it works: his H2 and his three steps word for word in an <ol>, numerals 01 to 03 are decorative (aria-hidden)', how.olTag === 'OL' && how.h2 === HIS.stepsTitle && JSON.stringify(how.steps) === JSON.stringify(HIS.steps) && JSON.stringify(how.nums) === JSON.stringify([['01', 'true'], ['02', 'true'], ['03', 'true']]), JSON.stringify(how));
  check('How it works: step 01 has the 2px red top rule (the one step the visitor does today); the rows are split by hairlines and the others have no red', how.rule[0][0] === '2px' && /rgb\(225, 20, 20\)/.test(how.rule[0][1]) && how.rule.every((r) => r[2] === '1px') && !/225, 20, 20/.test(how.rule[1][1] + how.rule[2][1]), JSON.stringify(how.rule));
  check('The earliest visit is an annotation on step 02 only: data-proto, a dashed rule, the tag, "Earliest visit Daniel could offer", the date in 24px with the day in <time>, "Daniel will confirm.", read-only', JSON.stringify(how.visitIn) === '[false,true,false]' && how.proto && how.tag === 'Idea from us, not on your site today' && how.dashed === 'dashed' && how.k === 'Earliest visit Daniel could offer' && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, \d{1,2}(:\d\d)?(am|pm)? to \d{1,2}(:\d\d)?(am|pm)$/.test(how.when) && how.timeTag && how.conf === 'Daniel will confirm.' && how.interactive === 0, JSON.stringify(how));
  check('the visit idea is not in the hero any more', (await page.locator('.lp-hero [data-testid="hero-visit"], .lp-hero [data-testid="live-availability"]').count()) === 0);
  await shot(page, 'landing-steps-375');
  // ---- Your quote: his H2 and paragraph, no call to action, no promise; then the example quote as ruled rows, then the calculator
  await page.evaluate(() => { document.getElementById('pricing').scrollIntoView(); });
  const q = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="quote-preview"]');
    const link = document.querySelector('[data-testid="pricing-sample-link"]');
    const rows = [...card.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    const tbl = card.querySelector('table');
    return {
      h2: document.getElementById('pricing-title').textContent.trim(), p: document.querySelector('#pricing .lp-statement').textContent.trim(), gone: ['pricing-cta', 'pricing-promise', 'quote-preview-total'].filter((id) => document.querySelector(`[data-testid="${id}"]`)),
      proto: card.hasAttribute('data-proto'), tag: card.querySelector('[data-testid="idea-tag"]') ? card.querySelector('[data-testid="idea-tag"]').textContent.trim() : '', dashed: getComputedStyle(card).borderTopStyle, group: card.getAttribute('role'),
      cap: document.querySelector('[data-testid="quote-preview-tag"]').textContent.trim(), rows, hidden: tbl.getAttribute('aria-hidden'), blanks: [...card.querySelectorAll('.lp-qt__blank')].map((b) => b.textContent.trim()).join(''),
      href: link.getAttribute('href'), target: link.getAttribute('target'), linkText: link.textContent.trim(), text: card.innerText.replace(/\s+/g, ' '), eyebrow: !!document.querySelector('#pricing .lp-eyebrow')
    };
  });
  check('Your quote: his H2 and his paragraph word for word; no call to action and no promise line (both retired); no eyebrow', q.h2 === HIS.pricingTitle && q.p === HIS.pricingP && q.gone.length === 0 && !q.eyebrow, JSON.stringify(q));
  check('the example quote is a tagged idea (data-proto, dashed rule, the tag) with the caption "Example only", four named rows and BLANK amount cells (no price, no total)', q.proto && q.tag === 'Idea from us, not on your site today' && q.dashed === 'dashed' && q.group === 'group' && q.cap === 'Example only' && q.hidden === 'true' && q.rows.length === 4 && q.rows.map((r) => r[1]).join('|') === 'Your chosen home charger|Installation|Dedicated circuit|Testing and certification' && q.blanks === '' && !/£/.test(q.text), JSON.stringify(q));
  check('"See how a quote looks" is a text link to quote.html#q=<sample id>&preview=1 in the quote tab', q.linkText === 'See how a quote looks' && /^quote\.html(\?[^#]*)?#q=Q-EL-\d+&preview=1/.test(q.href) && q.target === 'vm-quote', q.href);
  // ---- the calculator as a ruled module (an idea)
  await page.evaluate(() => { document.getElementById('savings').scrollIntoView(); });
  const calc = await page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height, w: b.width }; };
    const sec = document.getElementById('savings');
    const cs = getComputedStyle(sec);
    const det = document.querySelector('[data-testid="l3-calc-assumptions"]');
    const rows = [...document.querySelectorAll('[data-testid="l3-calc-workings"] tbody tr')].map((tr) => [tr.children[0].textContent.trim(), tr.children[2].textContent.trim()]);
    const fills = [...document.querySelectorAll('.lp-bars__f')].map((f) => ({ w: getComputedStyle(f).width, o: getComputedStyle(f).opacity, bg: getComputedStyle(f).backgroundColor, t: getComputedStyle(f).transitionDuration }));
    const num = getComputedStyle(document.querySelector('[data-testid="l3-calc-home-big"]'));
    const thumbRule = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch (e) { return []; } }).find((r) => r.selectorText && /\.lp-range::-webkit-slider-thumb/.test(r.selectorText));
    const thumb = thumbRule ? thumbRule.style : { width: '', height: '', borderRadius: '', backgroundColor: '' };
    return {
      title: sec.querySelector('h3').textContent.trim(), lead: sec.querySelector('.lp-idea__intro p').textContent.trim(), proto: sec.hasAttribute('data-proto'), tag: sec.querySelector('[data-testid="idea-tag"]') ? sec.querySelector('[data-testid="idea-tag"]').textContent.trim() : '', dashed: cs.borderTopStyle, bgc: cs.backgroundColor, bw: [cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(),
      headline: document.querySelector('[data-testid="l3-calc-headline"]').textContent.replace(/\s+/g, ' ').trim(), compare: document.querySelector('[data-testid="l3-calc-compare"]').textContent.replace(/\s+/g, ' ').trim(), diff: document.querySelector('[data-testid="l3-calc-saving-big"]').textContent.trim(),
      headTop: r('[data-testid="l3-calc-headline"]').top, compareTop: r('[data-testid="l3-calc-compare"]').top, sliderBottom: r('[data-testid="l3-calc-slider"]').bottom, sliderH: r('[data-testid="l3-calc-slider"]').h, vh: innerHeight,
      milesH: r('[data-testid="l3-calc-miles"]').h, milesFs: getComputedStyle(document.querySelector('[data-testid="l3-calc-miles"]')).fontSize, milesBox: getComputedStyle(document.querySelector('[data-testid="l3-calc-miles"]')).borderTopWidth, numFs: num.fontSize, numFamily: num.fontStretch, thumb: [thumb.width, thumb.height, thumb.borderRadius || thumb.getPropertyValue('border-radius'), thumb.getPropertyValue('background')],
      rows, fills, caption: document.querySelector('[data-testid="l3-calc-workings"] caption').textContent.trim(), detOpen: det.open, summaryShown: getComputedStyle(det.querySelector('summary')).display !== 'none', summary: det.querySelector('summary').textContent.trim(),
      fieldsShown: [...document.querySelectorAll('[data-testid^="l3-calc-field-"]')].filter((el) => el.checkVisibility()).length, badge: document.querySelector('[data-testid="l3-calc-badge"]').textContent.trim(), foot: document.querySelector('[data-testid="l3-calc-footnote"]').textContent.trim(),
      live: [...sec.querySelectorAll('[aria-live]')].length, text: sec.innerText
    };
  });
  check('the calculator is a tagged idea (data-proto, dashed top rule, the tag), set as ruled rows: no card (no fill, no side or bottom border)', calc.title === 'What would home charging cost you?' && calc.lead === 'A rough guide, using example rates that you can change.' && calc.proto && calc.tag === 'Idea from us, not on your site today' && calc.dashed === 'dashed' && calc.bgc === 'rgba(0, 0, 0, 0)' && calc.bw === '0px,0px,0px', JSON.stringify([calc.title, calc.proto, calc.tag, calc.dashed, calc.bgc, calc.bw]));
  check('its FIRST line is "Home charging would cost about £617 a year", the petrol comparison second ("...which is about £595 more.", the difference in its own span)', calc.headline === 'Home charging would cost about £617 a year' && calc.compare === 'The same miles in a petrol car would cost about £1,212 a year, which is about £595 more.' && calc.diff === '£595' && calc.compareTop > calc.headTop, JSON.stringify([calc.headline, calc.compare, calc.diff]));
  check('the miles field is an underline (no box) at 28px/56px, the slider thumb is a flat 20px ink square, the result is 56 to 72px in the display voice', calc.milesH >= 56 && calc.milesFs === '28px' && calc.milesBox === '0px' && calc.thumb[0] === '20px' && calc.thumb[1] === '20px' && /^0(px)?$/.test(calc.thumb[2]) && /var\(--ink\)/.test(calc.thumb[3]) && parseFloat(calc.numFs) >= 56 && parseFloat(calc.numFs) <= 72, JSON.stringify([calc.milesH, calc.milesFs, calc.milesBox, calc.thumb, calc.numFs]));
  check('the miles control and the first line are close together in one screen, and the slider is a 44px target', calc.sliderH >= 44 && calc.headTop > calc.sliderBottom && calc.headTop - calc.sliderBottom < 200, JSON.stringify([calc.sliderH, calc.headTop, calc.sliderBottom]));
  check('the three-way table "The same miles, three ways": Home charging £617, Petrol £1,212, Public charging £1,714; home bar solid ink, the others 28% ink (never red), widths ease over 300ms', calc.caption === 'The same miles, three ways' && JSON.stringify(calc.rows) === JSON.stringify([['Home charging', '£617'], ['Petrol', '£1,212'], ['Public charging', '£1,714']]) && calc.fills[0].o === '1' && calc.fills[1].o === '0.28' && calc.fills.every((f) => !/225, 20, 20/.test(f.bg) && f.t === '0.3s'), JSON.stringify(calc.fills));
  check('at 375 the rates are a CLOSED "Change the rates" disclosure (no rate field is visible), with a plus', !calc.detOpen && calc.summaryShown && calc.summary === 'Change the rates' && calc.fieldsShown === 0, JSON.stringify([calc.detOpen, calc.summaryShown, calc.fieldsShown]));
  // T15: a closed "Change the rates" row is not followed by a dead zone: the footnote's rule is 48px or less below the row's words
  const closedGap = await page.evaluate(() => {
    const det = document.querySelector('[data-testid="l3-calc-assumptions"]');
    const range = document.createRange(); range.selectNodeContents(det.querySelector('summary > span'));
    const foot = document.querySelector('.lp-calc__foot').getBoundingClientRect();
    return { open: det.open, textToFoot: Math.round(foot.top - range.getBoundingClientRect().bottom), rowToFoot: Math.round(foot.top - det.getBoundingClientRect().bottom) };
  });
  check('a closed "Change the rates" row has the footnote\'s rule within 48px of its words (32px under the row), not 60px of blank paper', !closedGap.open && closedGap.textToFoot > 0 && closedGap.textToFoot <= 48 && closedGap.rowToFoot === 32, JSON.stringify(closedGap));
  check('"Illustrative estimate" and the footnote are on show; "4.54609" is nowhere; one polite live region carries the debounced summary', calc.badge === 'Illustrative estimate' && /^An illustration, not a quote or a promise\./.test(calc.foot) && !/4\.54609/.test(calc.text) && calc.live === 1, JSON.stringify([calc.badge, calc.foot, calc.live]));
  const before = Number(await tid(page, 'l3-calc-home-big').getAttribute('data-value'));
  await tid(page, 'l3-calc-slider').evaluate((el) => { el.value = '20000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  check('dragging the slider updates the answer (a dearer year at 20,000 miles) and the miles box', await until(async () => Number(await tid(page, 'l3-calc-home-big').getAttribute('data-value')) > before) && (await tid(page, 'l3-calc-miles').inputValue()) === '20,000', `${before}`);
  await tid(page, 'l3-calc-miles').fill('12,000');
  check('typing 12,000 miles gives £926 at home', !!(await until(async () => (await txt(page, 'l3-calc-home-big')) === '£926')), await txt(page, 'l3-calc-home-big'));
  await tid(page, 'l3-calc-miles').fill('8000');
  await tid(page, 'l3-calc-assumptions').locator('summary').click();
  check('opening "Change the rates" shows the five example rates, the note and the working', (await tid(page, 'l3-calc-assumptions').evaluate((el) => el.open)) && (await page.evaluate(() => [...document.querySelectorAll('[data-testid^="l3-calc-field-"]')].filter((el) => el.checkVisibility()).length)) === 5 && /Examples only, not 180 Electrical prices\./.test(await txt(page, 'l3-calc-assumptions')) && /How we worked this out/i.test(await txt(page, 'l3-calc-assumptions')) && /Rates we have assumed/i.test(await txt(page, 'l3-calc-assumptions')));
  await tid(page, 'l3-calc-field-homePence').fill('30');
  check('changing a visible rate (home electricity 30p) updates the first line at once', !!(await until(async () => (await txt(page, 'l3-calc-headline')) === 'Home charging would cost about £686 a year')), await txt(page, 'l3-calc-headline'));
  await tid(page, 'l3-calc-field-homePence').fill('abc');
  check('an invalid rate shows words (not colour alone), marks the field invalid and falls back to the example figure (£617)', !!(await until(async () => (await tid(page, 'l3-calc-home-big').innerText()) === '£617')) && (await tid(page, 'l3-calc-field-homePence').getAttribute('aria-invalid')) === 'true' && /Enter a number\./.test(await txt(page, 'l3-calc-assumptions')));
  await tid(page, 'l3-calc-field-homePence').fill('27');
  const wk = await txt(page, 'l3-calc-workings-text');
  check('the working is ONE plain paragraph ("Your 8,000 miles use about 2,286 kWh ... at 27p"), no raw maths and no gallon constant', /^Your 8,000 miles use about 2,286 kWh a year, which is £617 at 27p a kWh\./.test(wk) && !/4\.54609|÷|×| x |=/.test(wk), wk);
  await tid(page, 'l3-calc-field-mpg').fill('50');
  await tid(page, 'l3-calc-reset').click();
  check('Reset (a quiet text link with its own aria-label) restores every example figure: 8,000 miles, 27p, 42 mpg, £617', !!(await until(async () => (await tid(page, 'l3-calc-miles').inputValue()) === '8,000' && (await tid(page, 'l3-calc-field-mpg').inputValue()) === '42' && (await txt(page, 'l3-calc-home-big')) === '£617')) && (await tid(page, 'l3-calc-reset').getAttribute('aria-label')) === 'Reset to the example figures');
  await shot(page, 'landing-calc-375');
  // ---- Area and Questions: the form is covered by 1d; the questions are native <details>
  await page.evaluate(() => { document.getElementById('faq').scrollIntoView(); });
  const faq = await page.evaluate(() => ({ h2: document.getElementById('faq-title').textContent.trim(), items: [...document.querySelectorAll('[data-testid^="faq-item-"]')].map((d) => ({ tag: d.tagName, name: d.getAttribute('name'), open: d.open, q: d.querySelector('summary').textContent.trim(), a: d.querySelector('summary + div p').textContent.trim(), h: Math.round(d.querySelector('summary').getBoundingClientRect().height), qTag: d.querySelector('[data-testid^="faq-q-"]').tagName })), outside: [...document.querySelectorAll('#why, #about, #work, #how, #pricing, #area, #faq')].map((el) => { const c = el.cloneNode(true); c.querySelectorAll('[data-proto]').forEach((n) => n.remove()); return c.textContent.replace(/\s+/g, ' '); }).join(' ') }));
  check('Questions: his H2 and his six questions and answers word for word, as <details name="faq"> with <summary>', faq.h2 === HIS.faqTitle && faq.items.length === 6 && faq.items.every((it, i) => it.tag === 'DETAILS' && it.name === 'faq' && it.qTag === 'SUMMARY' && it.q === HIS.faq[i][0] && it.a === HIS.faq[i][1]), JSON.stringify(faq.items.map((i) => i.q)));
  check('the cost question is open on load and it is the only one; every summary is at least 48px high', faq.items.map((i) => i.open).join() === 'false,false,true,false,false,false' && faq.items.every((i) => i.h >= 48), JSON.stringify(faq.items.map((i) => [i.open, i.h])));
  await tid(page, 'faq-q-4').click();
  check('opening another question closes the cost one (exclusive) and the open marker is a minus', !!(await until(async () => (await page.evaluate(() => [...document.querySelectorAll('[data-testid^="faq-item-"]')].map((d) => d.open).join())) === 'false,false,false,false,true,false')));
  // ---- D1: outside the tagged ideas the landing's own sections show no price, no spec, no payment term
  check('outside tagged ideas the landing sections state no price, no kW spec, no payment term, no guarantee and no "pencilled" or "provisional"', !/£/.test(faq.outside) && !/\bkW\b/i.test(faq.outside) && !/pay after|deposit|guarantee|warranty|pencilled|provisional|free survey/i.test(faq.outside), faq.outside.match(/£|\bkW\b|pay after|deposit|guarantee|warranty|pencilled|provisional|free survey/i) + '');
  const ctas = await page.evaluate(() => [...document.querySelectorAll('.lp-main .lp-cta')].map((b) => b.getAttribute('data-testid')));
  check('the red buttons in the page body are the hero, the postcode check and the closing band (the Why call to action is a text link; no pricing button)', JSON.stringify(ctas) === JSON.stringify(['hero-cta', 'coverage-book', 'final-book']), JSON.stringify(ctas));
  // ---- "Only my content": every idea vanishes with the one existing rule, no tag survives, and the sections close up with no gap
  const withIdeas = await page.evaluate(() => ({ steps: document.querySelector('[data-testid="l3-steps"]').getBoundingClientRect().height, pricing: document.getElementById('pricing').getBoundingClientRect().height, h: document.documentElement.scrollHeight }));
  await site(page, '', '&clean=1');
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  await tid(page, 'final-cta').waitFor({ state: 'attached', timeout: WAIT });
  const only = await page.evaluate(() => {
    const shown = (sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; };
    const all = [...document.querySelectorAll('.lp-main [data-proto]')];
    const tags = [...document.querySelectorAll('[data-testid="idea-tag"]')].filter((el) => el.getClientRects().length > 0).length;
    const lastLi = [...document.querySelectorAll('[data-testid="l3-steps"] > li')].pop().getBoundingClientRect().bottom;
    const ol = document.querySelector('[data-testid="l3-steps"]').getBoundingClientRect().bottom;
    const head = document.querySelector('#pricing .lp-pricing__head').getBoundingClientRect().bottom;
    const sec = document.getElementById('pricing');
    return {
      calc: shown('#savings'), card: shown('[data-testid="quote-preview"]'), visit: shown('[data-testid="hero-visit"]'), pricing: shown('#pricing'), copy: shown('#pricing .lp-statement'), step2: shown('[data-testid="l3-steps"] > li:nth-child(2) p'), final: shown('[data-testid="final-cta"]'), faq: shown('#faq'), hidden: all.length > 0 && all.every((el) => getComputedStyle(el).display === 'none'), n: all.length, tags,
      stored: (() => { try { return localStorage.getItem('ec_clean'); } catch (e) { return 'x'; } })(), money: /£/.test([...document.querySelectorAll('#why, #about, #work, #how, #pricing, #area, #faq, #final')].map((e) => e.innerText).join(' ')),
      stepsGap: Math.abs(ol - lastLi), pricingGap: Math.abs(sec.getBoundingClientRect().bottom - head), stepsH: document.querySelector('[data-testid="l3-steps"]').getBoundingClientRect().height, pricingH: sec.getBoundingClientRect().height, h: document.documentElement.scrollHeight
    };
  });
  check('"Only my content" hides all three ideas (the visit, the example quote, the calculator: every landing [data-proto]) and every tag, keeps his paragraphs, the step 02 text, the FAQ and the closing band, shows no £, and is remembered in ec_clean', !only.calc && !only.card && !only.visit && only.pricing && only.copy && only.step2 && only.final && only.faq && only.hidden && only.n === 3 && only.tags === 0 && only.stored === '1' && !only.money, JSON.stringify(only));
  check('"Only my content" leaves no gap: step 02 and the quote section end exactly where his content ends (no empty rows, no leftover margin)', only.stepsGap <= 1 && only.pricingGap <= 1 && only.stepsH < withIdeas.steps && only.pricingH < withIdeas.pricing / 3, JSON.stringify([only, withIdeas]));
  check('"Only my content" at 375 is about 7,200px (the ideas add about 1,900px)', only.h >= 6900 && only.h <= 7500, String(only.h));
  await page.evaluate(() => { try { localStorage.removeItem('ec_clean'); } catch (e) { /* ignore */ } });
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 1c2. the same sections at 1280: the compositions are different from each other (grid, sticky headings, the plate, three columns)
await section('1c2. landing sections at 1280: sticky H2s, About on the grid with the cut, the work plate with its heading cell, three step columns, the quote head on one baseline, the calculator with open rates', async () => {
  const ctx = await newContext(DESKTOP, 'light');
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  await tid(page, 'final-cta').waitFor({ state: 'attached', timeout: WAIT });
  const g = await page.evaluate(() => {
    const box = (sel) => { const el = document.querySelector(sel); const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top + scrollY), b: Math.round(b.bottom + scrollY), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      sticky: ['#why-title', '#faq-title'].map((s) => getComputedStyle(document.querySelector(s)).position), whyH2: box('#why-title'), whyRows: box('.lp-why__rows'),
      aboutPhoto: box('.lp-about__photo'), aboutText: box('.lp-about__text'), aboutRule: box('#about .lp-sec__in'), brandsK: box('.lp-brands__k'), brandsList: box('.lp-brands__list'), brandCells: [...document.querySelectorAll('.lp-brands__list li')].map((li) => Math.round(li.getBoundingClientRect().width)),
      head: box('.lp-plate__head'), g: [0, 1, 2, 3].map((i) => box(`.lp-gal__i--${i + 1}`)), dots: getComputedStyle(document.querySelector('[data-testid="gallery-dots"]')).display, hint: !!document.querySelector('.lp-gallery__hint'),
      ph: [0, 1, 2, 3].map((i) => { const b = document.querySelector(`[data-testid="l3-gallery-open-${i}"]`).getBoundingClientRect(); return Math.round((b.width / b.height) * 100) / 100; }),
      steps: [...document.querySelectorAll('[data-testid="l3-steps"] > li')].map((li) => { const b = li.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top + scrollY), w: Math.round(b.width), rule: getComputedStyle(li).borderTopWidth + ' ' + getComputedStyle(li).borderTopColor, n: parseFloat(getComputedStyle(li.querySelector('.lp-step__n')).fontSize) }; }),
      pHead: box('.lp-pricing__head .lp-h2'), pState: box('.lp-pricing__head .lp-statement'), calcIntro: getComputedStyle(document.querySelector('.lp-calc .lp-idea__intro')).position, introL: box('.lp-calc .lp-idea__intro'), bodyL: box('.lp-calc .lp-idea__body'),
      det: (() => { const d = document.querySelector('[data-testid="l3-calc-assumptions"]'); return { open: d.open, sum: getComputedStyle(d.querySelector('summary')).display }; })(), fields: [...document.querySelectorAll('[data-testid^="l3-calc-field-"]')].filter((e) => e.checkVisibility()).length,
      areaStmt: box('#area .lp-statement'), areaForm: box('[data-testid="area-form"]'), areaH2: box('#area-title'), pcIn: box('[data-testid="coverage-input"]'), pcBtn: box('[data-testid="coverage-book"]'),
      faqH2: box('#faq-title'), faqList: box('.lp-faq__list'), faqFs: getComputedStyle(document.querySelector('[data-testid="faq-q-0"]')).fontSize, faqPad: getComputedStyle(document.querySelector('[data-testid="faq-q-0"]')).paddingTop,
      h2s: ['why-title', 'about-title', 'work-title', 'how-title', 'pricing-title', 'area-title', 'faq-title'].map((id) => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)), scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
    };
  });
  check('H2s are 52px (44px for About and the work heading cell); the Why and Questions headings are sticky', JSON.stringify(g.h2s) === JSON.stringify([52, 44, 44, 52, 52, 52, 52]) && g.sticky.join() === 'sticky,sticky', JSON.stringify([g.h2s, g.sticky]));
  check('Why: heading in columns 1 to 5, the rows in columns 6 to 12 (the rows start at x=551)', g.whyH2.l === 48 && g.whyRows.l >= 548 && g.whyRows.l <= 554 && g.whyRows.r === 1232, JSON.stringify([g.whyH2, g.whyRows]));
  check('About: the photo is columns 1 to 7 (681 wide) top-aligned to the rule, the text is columns 9 to 12, the brands row is below with a hanging label and three equal cells split by hairlines', g.aboutPhoto.l === 48 && Math.abs(g.aboutPhoto.w - 681) <= 2 && Math.abs(g.aboutPhoto.t - g.aboutRule.t - 20) <= 2 && g.aboutText.l >= 850 && g.aboutText.r === 1232 && g.brandsK.l === 48 && g.brandsList.l >= 345 && g.brandCells.length === 3 && Math.max(...g.brandCells) - Math.min(...g.brandCells) <= 25 && g.brandsK.t > g.aboutPhoto.b, JSON.stringify([g.aboutPhoto, g.aboutText, g.brandsK, g.brandsList, g.brandCells]));
  check('Work: a 12 x 2 plate: the heading cell (columns 1 to 4) beside photo 01 and 02 in row 1, photo 03 (columns 1 to 8, landscape) and photo 04 in row 2; no pager ticks, no hint, no empty cell', g.head.l === 48 && g.head.w <= 380 && g.g[0].l >= 448 && g.g[0].l <= 454 && g.g[1].r === 1232 && g.g[2].l === 48 && g.g[2].t > g.g[0].t && g.g[3].r === 1232 && g.g[3].t === g.g[2].t && g.dots === 'none' && !g.hint, JSON.stringify([g.head, g.g, g.dots]));
  check('Work: portraits are 3:4 (about 379 x 505), the landscape fills its row (about 1.55:1)', Math.abs(g.ph[0] - 0.75) < 0.02 && Math.abs(g.ph[1] - 0.75) < 0.02 && Math.abs(g.ph[3] - 0.75) < 0.02 && g.ph[2] > 1.4 && g.ph[2] < 1.7, JSON.stringify(g.ph));
  check('How it works: three equal columns under 2px rules (ink, ink, red for 01), numerals 104px, the columns align at the top', g.steps.length === 3 && Math.abs(g.steps[0].w - g.steps[1].w) <= 1 && g.steps[0].t === g.steps[1].t && g.steps[1].t === g.steps[2].t && g.steps.every((s) => /^2px/.test(s.rule)) && /225, 20, 20/.test(g.steps[0].rule) && !/225, 20, 20/.test(g.steps[1].rule) && g.steps.every((s) => s.n === 104), JSON.stringify(g.steps));
  check('Your quote: the H2 (columns 1 to 6) and his paragraph (columns 7 to 12) share one baseline row', g.pHead.l === 48 && g.pState.l >= 645 && g.pState.l <= 655 && Math.abs(g.pHead.b - g.pState.b) <= 40, JSON.stringify([g.pHead, g.pState]));
  check('the calculator: its intro (columns 1 to 5) is sticky beside the body (columns 6 to 12); the rates are open and need no switch from 1200', g.calcIntro === 'sticky' && g.introL.l === 48 && g.bodyL.l >= 548 && g.det.open && g.det.sum === 'none' && g.fields === 5, JSON.stringify([g.calcIntro, g.introL, g.bodyL, g.det, g.fields]));
  check('Area: the H2 across, then the statement (columns 1 to 5) and the form (columns 6 to 12) with the field joined to the 64px button', g.areaStmt.l === 48 && g.areaForm.l >= 548 && g.areaForm.l <= 554 && g.areaForm.r === 1232 && g.pcIn.h === 64 && g.pcBtn.h === 64 && Math.abs(g.pcIn.r - g.pcBtn.l) <= 1 && Math.abs(g.pcIn.t - g.pcBtn.t) <= 1, JSON.stringify([g.areaStmt, g.areaForm, g.pcIn, g.pcBtn]));
  check('Questions: the heading (columns 1 to 4) beside the list (columns 5 to 12), questions at 22px with 28px padding', g.faqH2.l === 48 && g.faqList.l >= 448 && g.faqList.l <= 454 && g.faqList.r === 1232 && g.faqFs === '22px' && g.faqPad === '28px', JSON.stringify([g.faqH2, g.faqList, g.faqFs, g.faqPad]));
  check('no horizontal overflow at 1280', g.scrollW <= g.clientW, JSON.stringify([g.scrollW, g.clientW]));
  // one red button on screen at a time at every scroll stop: the hero's first, then the header's, which steps aside while the postcode section or the closing band is on screen
  const reds = [];
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 420) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(420);
    reds.push(await page.evaluate(() => {
      const hdr = document.querySelector('[data-testid="lp-header"]');
      const under = hdr && getComputedStyle(hdr).position === 'sticky' ? hdr.getBoundingClientRect().bottom : 0;
      return [...document.querySelectorAll('.lp-cta')].filter((b) => { const r = b.getBoundingClientRect(); const c = getComputedStyle(b); if (!(r.width > 0) || c.visibility === 'hidden' || c.display === 'none') return false; return b.closest('[data-testid="lp-header"]') ? true : (r.bottom > under + 1 && r.top < innerHeight - 1); }).length;
    }));
  }
  check('at most one red "Get my installation quote" button is visible at every scroll stop (1280)', Math.max(...reds) <= 1, reds.join(','));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  // the 1200 breakpoint: below it the rates fold into the disclosure, from it they stay open
  await page.setViewportSize({ width: 1199, height: 800 });
  check('at 1199 the rates fold into a closed disclosure again; at 1200 they open', await until(async () => !(await tid(page, 'l3-calc-assumptions').evaluate((el) => el.open))), '');
  await page.setViewportSize({ width: 1200, height: 800 });
  check('at 1200 the rates open again (and the disclosure switch is hidden)', await until(async () => (await tid(page, 'l3-calc-assumptions').evaluate((el) => el.open)) && (await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="l3-calc-assumptions"] summary')).display === 'none'))), '');
  await page.setViewportSize(DESKTOP);
  await shot(page, 'landing-sections-1280');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 1d. the postcode check on the landing page (LANDING-V5 5.9): ONE press
await section('1d. the area section: one press checks the postcode, shows the verdict and opens the funnel with it filled; errors in words', async () => {
  const ctx = await newContext(MOBILE, 'light');
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'final-cta').waitFor({ state: 'attached', timeout: WAIT });
  await tid(page, 'coverage-input').scrollIntoViewIfNeeded();
  const area = await page.evaluate(() => ({ h2: document.getElementById('area-title').textContent.trim(), p: document.querySelector('#area .lp-statement').textContent.trim(), note: document.querySelector('#area .lp-pc__note').textContent.trim(), label: document.querySelector('#area label').textContent.trim(), labelFor: document.querySelector('#area label').getAttribute('for') === document.querySelector('[data-testid="coverage-input"]').id, ph: document.querySelector('[data-testid="coverage-input"]').placeholder, ac: document.querySelector('[data-testid="coverage-input"]').autocomplete, cap: document.querySelector('[data-testid="coverage-input"]').getAttribute('autocapitalize'), eh: document.querySelector('[data-testid="coverage-input"]').getAttribute('enterkeyhint'), live: document.querySelector('[data-testid="coverage-result"]').getAttribute('aria-live'), hide: document.getElementById('area').hasAttribute('data-sticky-hide'), tag: document.querySelector('[data-testid="coverage-book"]').tagName, type: document.querySelector('[data-testid="coverage-book"]').type, field: (() => { const c = getComputedStyle(document.querySelector('[data-testid="coverage-input"]')); const b = document.querySelector('[data-testid="coverage-input"]').getBoundingClientRect(); return { h: b.height, fs: c.fontSize, bg: c.backgroundColor, bw: c.borderTopWidth, r: c.borderTopLeftRadius }; })(), btn: (() => { const b = document.querySelector('[data-testid="coverage-book"]').getBoundingClientRect(); const c = getComputedStyle(document.querySelector('[data-testid="coverage-book"]')); return { h: b.height, w: b.width, bg: c.backgroundColor }; })(), vw: innerWidth }));
  check('Area: his H2, his statement and his note word for word; the label is "Your postcode" with a real for/id; the placeholder is "e.g. BT7 3AB"', area.h2 === HIS.areaTitle && area.p === HIS.areaP && area.note === HIS.areaNote && area.label === 'Your postcode' && area.labelFor && area.ph === 'e.g. BT7 3AB', JSON.stringify(area));
  check('Area: the field is white, 64px, 24px type, 1px ink border, square, with the postcode autofill hints; the button is a 64px red submit stacked full width on a phone; the result line is polite; the section steps the sticky bar aside', area.field.h === 64 && area.field.fs === '24px' && area.field.bw === '1px' && area.field.r === '0px' && /255, 255, 255/.test(area.field.bg) && area.ac === 'postal-code' && area.cap === 'characters' && area.eh === 'go' && area.btn.h === 64 && area.btn.w >= area.vw - 50 && area.type === 'submit' && /225, 20, 20/.test(area.btn.bg) && area.live === 'polite' && area.hide, JSON.stringify(area));
  check('the button always reads "Get my installation quote" (never "Check my postcode" or "Continue with ...")', (await txt(page, 'coverage-book')) === 'Get my installation quote', await txt(page, 'coverage-book'));
  await tid(page, 'coverage-input').fill('bt1');
  await tid(page, 'coverage-book').click();
  const bad = await page.evaluate(() => { const i = document.querySelector('[data-testid="coverage-input"]'); const c = getComputedStyle(i); return { inv: i.getAttribute('aria-invalid'), focus: document.activeElement === i, bc: c.borderTopColor, msg: document.querySelector('[data-testid="coverage-result"]').textContent.trim(), mc: getComputedStyle(document.querySelector('[data-testid="coverage-result"]')).color, desc: i.getAttribute('aria-describedby').split(' ').every((id) => !!document.getElementById(id)) }; });
  check('an invalid postcode: aria-invalid, focus back in the field, the funnel\'s own message in the error colour (words, not colour alone), and the funnel does NOT open', bad.inv === 'true' && bad.focus && bad.msg === HIS.invalid && /176, 14, 18/.test(bad.bc) && /176, 14, 18/.test(bad.mc) && bad.desc && (await tid(page, 'booking-sheet').count()) === 0, JSON.stringify(bad));
  await shot(page, 'landing-area-invalid-375');
  await tid(page, 'coverage-input').fill('BT7 3AB');
  check('editing the field clears the error and the verdict', (await tid(page, 'coverage-input').getAttribute('aria-invalid')) === null && (await txt(page, 'coverage-result')) === '');
  await tid(page, 'coverage-book').click();
  await sheetOpen(page);
  check('ONE press with BT7 3AB opens the funnel with the postcode filled in (a single history entry)', (await tid(page, 'funnel-postcode').inputValue()) === 'BT7 3AB' && /^#book\/ev_quote/.test(await hashOf(page)), (await tid(page, 'funnel-postcode').inputValue()) + ' ' + await hashOf(page));
  await page.goBack();
  check('closing the funnel leaves the verdict "Good news, that\'s in our area." on the page, with a tick glyph in ink', !!(await until(async () => (await tid(page, 'booking-sheet').count()) === 0)) && (await txt(page, 'coverage-result')) === "Good news, that's in our area." && await page.evaluate(() => { const r = document.querySelector('[data-testid="coverage-result"]'); return !!r.querySelector('svg.lp-glyph--tick') && getComputedStyle(r).color === getComputedStyle(document.body).color; }));
  await shot(page, 'landing-area-valid-375');
  await tid(page, 'coverage-input').fill('SW1A 1AA');
  await tid(page, 'coverage-book').click();
  await sheetOpen(page);
  check('an outside-Northern-Ireland postcode shows the outside line and still opens the funnel with it filled', /outside Northern Ireland/.test(await txt(page, 'coverage-result')) && (await tid(page, 'funnel-postcode').inputValue()) === 'SW1A 1AA', await txt(page, 'coverage-result'));
  await page.goBack();
  await until(async () => (await tid(page, 'booking-sheet').count()) === 0);
  // the Why link and the closing band open the funnel too
  await tid(page, 'why-cta').scrollIntoViewIfNeeded();
  await tid(page, 'why-cta').click();
  await sheetOpen(page);
  check('the Why text link opens the funnel (#book/ev_quote)', /^#book\/ev_quote/.test(await hashOf(page)), await hashOf(page));
  await page.goBack();
  await until(async () => (await tid(page, 'booking-sheet').count()) === 0);
  // one red button on screen at a time at every scroll stop (the header's and the sticky bar's step aside)
  const reds = [];
  for (let y = 0; y < 9400; y += 380) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(420);
    reds.push(await page.evaluate(() => [...document.querySelectorAll('.lp-cta')].filter((b) => { const r = b.getBoundingClientRect(); const c = getComputedStyle(b); return r.width > 0 && r.bottom > 1 && r.top < innerHeight - 1 && c.visibility !== 'hidden' && c.display !== 'none'; }).length));
  }
  check('at most one red "Get my installation quote" button is visible at every scroll stop (375)', Math.max(...reds) <= 1, reds.join(','));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 1a. theme scope (LANDING-V5 8.1): the public pages are light, the dashboard stays dark, and neither can flip the other
await section('1a. theme scope: public pages light by default (even on a dark-mode phone), their own storage key, the dashboard still dark, no leaking between them', async () => {
  const themeOf = (page) => page.evaluate(() => ({ scope: document.documentElement.getAttribute('data-scope'), theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name="theme-color"]').getAttribute('content') }));
  const ctx = await newContext(MOBILE, 'dark');
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  let t = await themeOf(page);
  check('landing, empty storage, OS prefers dark: html[data-scope="public"] is data-theme="light" with the paper canvas and a near-black theme-color', t.scope === 'public' && t.theme === 'light' && lum(t.bg) > 0.9 && t.meta === '#0B0B0C', JSON.stringify(t));
  await page.goto(`${BASE}/quote.html?${CLOCK}`, { waitUntil: 'networkidle' });
  t = await themeOf(page);
  check('the quote page is public scope and light by default too', t.scope === 'public' && t.theme === 'light' && lum(t.bg) > 0.9, JSON.stringify(t));
  await page.goto(`${BASE}/dashboard.html?${CLOCK}#/today`, { waitUntil: 'networkidle' });
  t = await page.evaluate(() => ({ scope: document.documentElement.getAttribute('data-scope'), theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
  check('the dashboard is untouched: no public scope, data-theme="dark", dark canvas (with the same browser, same storage)', !t.scope && t.theme === 'dark' && lum(t.bg) < 0.2, JSON.stringify(t));
  // a customer previewing Dark on the landing page does not flip the owner's dashboard, and an owner who chose Light does not flip the landing page
  await page.evaluate(() => { localStorage.setItem('vm_theme_public', 'dark'); });
  await page.reload({ waitUntil: 'networkidle' });
  t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('vm_theme_public=dark does not change the dashboard (still dark by its own key, and a light choice there is its own)', t === 'dark');
  await page.evaluate(() => { localStorage.setItem('vm_theme', 'light'); localStorage.setItem('vm_theme_public', 'light'); });
  await page.reload({ waitUntil: 'networkidle' });
  t = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
  check('vm_theme=light flips the dashboard to light', t.theme === 'light' && lum(t.bg) > 0.8, JSON.stringify(t));
  await page.evaluate(() => { localStorage.setItem('vm_theme', 'dark'); localStorage.removeItem('vm_theme_public'); });
  await site(page);
  await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
  t = await themeOf(page);
  check('an owner who chose dark on the dashboard (vm_theme=dark) still gets the LIGHT landing page', t.theme === 'light' && lum(t.bg) > 0.9, JSON.stringify(t));
  await page.evaluate(() => localStorage.setItem('vm_theme_public', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  t = await themeOf(page);
  check('a saved public choice of dark gives the dark landing page, set before the first paint, with the header still near-black', t.theme === 'dark' && lum(t.bg) < 0.2 && t.meta === '#0B0B0C', JSON.stringify(t));
  await page.evaluate(() => localStorage.setItem('vm_theme_public', 'auto'));
  await page.reload({ waitUntil: 'networkidle' });
  t = await themeOf(page);
  check('"auto" removes data-theme so the OS decides (dark here)', t.theme === null && lum(t.bg) < 0.2, JSON.stringify(t));
  await page.evaluate(() => localStorage.setItem('vm_theme_public', 'nonsense'));
  await page.reload({ waitUntil: 'networkidle' });
  t = await themeOf(page);
  check('junk in the public key means light (never dark, never auto)', t.theme === 'light' && lum(t.bg) > 0.9, JSON.stringify(t));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 1f. motion and photos (LANDING-V5 7 and 4.13): calm by default, nothing under reduced motion, a failed photo is a flat box with its shape and its cut
await section('1f. motion and photos: no reveal, no loop, smooth scroll only when motion is welcome, nothing animates under reduced motion; a photo that cannot load is a flat box that keeps its shape, its cut and its words', async () => {
  const ctx = await newContext(DESKTOP, 'light');
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'footer').waitFor({ timeout: WAIT });
  const calm = await page.evaluate(() => ({
    smooth: getComputedStyle(document.documentElement).scrollBehavior, reveal: document.querySelectorAll('[data-reveal], [data-rv], .lp-rv, .lp-progress, .lp-hero__slashes').length,
    looping: document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity).length,
    btn: [getComputedStyle(document.querySelector('[data-testid="hero-cta"]')).transitionDuration, getComputedStyle(document.querySelector('[data-testid="hero-cta"] svg')).transitionDuration], header: getComputedStyle(document.querySelector('[data-testid="lp-header"]')).transitionDuration
  }));
  check('with motion welcome: smooth scrolling, no scroll-reveal hooks or progress line left in the page, no looping animation, the primary button eases its fill (150ms) and its arrow (200ms), and the header never animates', calm.smooth === 'smooth' && calm.reveal === 0 && calm.looping === 0 && calm.btn[0] === '0.15s' && calm.btn[1] === '0.2s' && calm.header === '0s', JSON.stringify(calm));
  const hdr0 = await tid(page, 'lp-header').boundingBox();
  await page.evaluate(() => window.scrollTo({ top: 2000, behavior: 'instant' }));
  const hdr1 = await tid(page, 'lp-header').boundingBox();
  check('the header never changes size on scroll (no condensing)', Math.abs(hdr0.height - hdr1.height) < 0.5, JSON.stringify([hdr0, hdr1]));
  check('no console errors', clean(log), dump(log));
  await ctx.close();

  const rm = await newContext(MOBILE, 'light', { reducedMotion: 'reduce' });
  const p2 = await rm.newPage();
  await site(p2);
  await tid(p2, 'footer').waitFor({ timeout: WAIT });
  const still = await p2.evaluate(() => {
    const t = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).transitionDuration + '/' + getComputedStyle(e).animationName : 'none'; };
    return { smooth: getComputedStyle(document.documentElement).scrollBehavior, btn: t('[data-testid="hero-cta"]'), glyph: t('[data-testid="hero-cta"] svg'), bar: t('[data-testid="sticky-bar"]'), final: t('[data-testid="final-book"]'), running: document.getAnimations().filter((a) => a.playState === 'running').length };
  });
  check('with reduced motion: scrolling is not smoothed and the buttons, the arrow and the sticky bar do not transition', still.smooth === 'auto' && /^0s\//.test(still.btn) && /^0s\//.test(still.glyph) && /^0s\//.test(still.bar) && /^0s\//.test(still.final) && still.running === 0, JSON.stringify(still));
  await rm.close();

  // every photo blocked: the boxes keep their exact shape, flat, with the alt plus "(photo not available right now)", and the hero keeps its cut
  const ctx3 = await browser.newContext({ viewport: DESKTOP, timezoneId: 'Europe/London', locale: 'en-GB' });
  await ctx3.route((u) => IMG_HOSTS.has(u.hostname), (route) => route.abort());
  const p3 = await ctx3.newPage();
  await site(p3);
  await tid(p3, 'footer').waitFor({ timeout: WAIT });
  const failed = await p3.evaluate(() => {
    const ph = document.querySelector('[data-testid="hero-photo"] .lp-photo__ph'); const box = document.querySelector('[data-testid="hero-photo"]').getBoundingClientRect(); const fig = document.querySelector('[data-testid="l3-hero-visual"]');
    return { ph: !!ph, role: ph && ph.getAttribute('role'), label: ph && ph.getAttribute('aria-label'), bg: ph ? getComputedStyle(ph).backgroundColor : '', ratio: box.width / box.height, clip: getComputedStyle(fig).clipPath, imgs: document.querySelectorAll('[data-testid="hero-photo"] img').length, draw: ph ? ph.children.length + ph.textContent.length : -1,
      logo: (() => { const i = document.querySelector('.lp-header .lp-logo__img'); return i ? i.getAttribute('src') : ''; })() };
  });
  check('a failed hero photo is a flat --paper-3 box (nothing drawn, no picture) with role="img" and its alt plus "(photo not available right now)", the same 3:2 shape and the same cut', failed.ph && failed.role === 'img' && /\(photo not available right now\)$/.test(failed.label) && failed.label.length > 40 && failed.bg === 'rgb(227, 227, 224)' && Math.abs(failed.ratio - 1.5) < 0.02 && /polygon/.test(failed.clip) && failed.imgs === 0 && failed.draw === 0, JSON.stringify(failed));
  check('his logo falls back to the local copy (img/logo-180.png) when the remote one cannot load, in the same window', /img\/logo-180\.png$/.test(failed.logo), failed.logo);
  await ctx3.close();
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
  check('the popover holds the disclosure (starting "This is a prototype."), Owner login (demo), What\'s real, the theme choice and the page links, inside the screen, every control 44px', /^This is a prototype\./.test(pop.disclosure) && /Owner login \(demo\)/.test(pop.owner) && /dashboard\.html(\?[^#]*)?#\/today/.test(pop.ownerHref) && /What's real in this prototype/.test(pop.about) && pop.themes && pop.chips.length >= 5 && pop.chips.includes('About') && pop.l >= 0 && pop.r <= pop.vw && pop.small === 0 && pop.over <= 0, JSON.stringify(pop));
  const ax = await axeSeriousCount(page, '[data-testid="prototype-strip"]');
  check('axe: no serious or critical violation in the open popover (light)', ax.count === 0, ax.detail);
  await shot(page, 'strip-tools-375-light');
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
  check('Appearance is a three-way square segmented control reading Light, Dark, Auto, with Light selected on a fresh visit', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-testid^="theme-"]')].map((b) => [b.textContent.trim(), b.getAttribute('aria-checked')]))) === JSON.stringify([['Light', 'true'], ['Dark', 'false'], ['Auto', 'false']]));
  await tid(page, 'theme-dark').click();
  check('Dark sets data-theme="dark" and saves it under vm_theme_public (the dashboard key vm_theme is untouched)', !!(await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')) && (await page.evaluate(() => [localStorage.getItem('vm_theme_public'), localStorage.getItem('vm_theme')])).join('/') === 'dark/', await page.evaluate(() => [localStorage.getItem('vm_theme_public'), localStorage.getItem('vm_theme')].join('/')));
  await tid(page, 'theme-auto').click();
  check('Auto removes data-theme (the OS decides) and the theme-color stays near-black', !!(await until(async () => (await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))) === false)) && (await page.evaluate(() => document.querySelector('meta[name="theme-color"]').getAttribute('content'))) === '#0B0B0C');
  await tid(page, 'theme-light').click();
  check('and back to light', !!(await until(async () => (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light')));
  await tid(page, 'prototype-tools-close').click();
  // ---- the switch
  await tid(page, 'ideas-only').click();
  const off = await page.evaluate(() => ({ clean: document.documentElement.dataset.clean || '', stored: localStorage.getItem('ec_clean'), shown: [...document.querySelectorAll('[data-proto]')].filter((e) => getComputedStyle(e).display !== 'none').length, tags: [...document.querySelectorAll('[data-testid="idea-tag"]')].filter((e) => e.getClientRects().length > 0).length, protos: document.querySelectorAll('[data-proto]').length, text: document.body.innerText }));
  check('"Only my content" sets html[data-clean], saves ec_clean=1 and hides every idea: no [data-proto] and no tag on screen, the strip stays', off.clean === '1' && off.stored === '1' && off.shown === 0 && off.tags === 0 && off.protos >= 1 && (await tid(page, 'prototype-strip').isVisible()) && !/Earliest visit|Idea from us/.test(off.text.replace(/Prototype tools[\s\S]*/, '')), JSON.stringify(off).slice(0, 300));
  check('what is left is HIS words: the H1, his free-quote line and his two credentials', /Free, no-obligation quote/.test(off.text) && /Level 3 Electrical Installation/.test(off.text.replace(/\s+/g, ' ')) && /2391 Inspection and Testing/.test(off.text.replace(/\s+/g, ' ')));
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
    const s1 = await tid(page, 'booking-sheet').textContent();
    check('step 1 eyebrow, H1, label and help are verbatim', s1.includes(COPY.step1.eyebrow) && (await titleOf(page)) === COPY.step1.title && s1.includes(COPY.step1.label) && s1.includes(COPY.step1.help), await titleOf(page));
    check('step 1 placeholder is verbatim', (await tid(page, 'funnel-postcode').getAttribute('placeholder')) === COPY.step1.placeholder);
    check('no Back link on step 1, progress bar at 1 of 6', (await tid(page, 'booking-back').count()) === 0 && (await tid(page, 'booking-progress').getAttribute('aria-valuenow')) === '1');
    // D3: the header brand is HIS logo picture (LogoImg, the lockup crop), not the bolt-in-a-square mark; the business name stays in the DOM for screen readers.
    const brandInfo = await page.evaluate(() => { const b = document.querySelector('[data-testid="booking-brand"]'); const img = b.querySelector('img.lp-logo__img'); const bar = document.querySelector('.bk-header--dark'); return { text: b.innerText.trim(), svg: b.querySelectorAll('svg').length, img: !!img, src: img ? img.getAttribute('src') : '', logoH: b.querySelector('.lp-logo').getBoundingClientRect().height, dark: !!bar && getComputedStyle(bar).backgroundColor }; });
    check('the sheet header carries HIS logo picture (the lockup crop, no bolt mark) with the name kept for screen readers, beside "Step 1 of 6", and step 1 says "About 1 minute"', brandInfo.text === '180 Electrical' && brandInfo.svg === 0 && brandInfo.img && /^(https:\/\/perspective\.imgix\.net\/|img\/logo-180\.png)/.test(brandInfo.src) && brandInfo.logoH >= 36 && (await txt(page, 'funnel-time')) === 'About 1 minute', JSON.stringify(brandInfo));
    // D4/funnel chrome: the sheet is full screen, so the prototype strip is NOT in the header; a quiet note closes the step instead (and is data-proto).
    check('the funnel header has NO prototype strip (the sheet is full screen); ONE quiet honest note closes the step, marked data-proto', (await page.locator('.bk-header .bk-strip').count()) === 0 && (await page.locator('.bk-header [data-testid="booking-proto-strip"]').count()) === 0 && (await page.locator('.bk-strip').count()) === 1 && (await page.locator('.bk-ribbon__tag').count()) === 0 && /Prototype/i.test(await txt(page, 'booking-proto-strip')) && /nothing is really sent/i.test(await txt(page, 'booking-proto-strip')) && (await tid(page, 'booking-proto-strip').getAttribute('data-proto')) !== null, await txt(page, 'booking-proto-strip'));
    check('step 1 has his reassurance: a tap-to-call line ("Questions? Call us on 07885 496800") and his two credentials as type (the figure in the logo voice, no chip, no badge; no London postcode anywhere), and NO 01 to 03 process list', /Questions\? Call us on 07885 496800/.test(await txt(page, 'funnel-reassure')) && (await tid(page, 'funnel-next-steps').count()) === 0 && (await page.locator('.bk-next').count()) === 0 && (await page.locator('.bk-reassure__chip').count()) === 2 && (await page.locator('.bk-reassure__fig.lp-logovoice').count()) === 2 && (await page.locator('.bk-reassure__chip').first().evaluate((e) => getComputedStyle(e).borderRadius === '0px' && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)')) && /Level 3 Electrical Installation/.test(await txt(page, 'funnel-credentials')) && /2391 Inspection and Testing/.test(await txt(page, 'funnel-credentials')) && (await tid(page, 'booking-call').getAttribute('href')) === 'tel:+447885496800' && !(await tid(page, 'booking-sheet').innerText()).includes('SW1A'));
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
      const sheet = await tid(page, 'booking-sheet').textContent();
      check(`step ${s.n} label and H1 are as designed, with a one-line "why we ask" under the question (and no legalistic note)`, (await stepLabel(page)) === `Step ${s.n} of 6` && (await titleOf(page)) === s.title && (await txt(page, 'funnel-why')) === s.why && (await tid(page, 'funnel-note').count()) === 0, await titleOf(page) + ' | ' + await txt(page, 'funnel-why'));
      const labels = (await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__label`).allInnerTexts()).map((t) => t.trim());
      const badges = (await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__letter`).allTextContents()).join('');
      const ticks = await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__tick`).count();
      const icons = await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__icon svg`).count();
      const hints = (await page.locator(`[data-testid^="funnel-hint-${s.key}-"]`).allInnerTexts()).map((t) => t.trim());
      const hintSize = await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-hint-${key}-"]`)].map((h) => getComputedStyle(h).fontSize + '|' + getComputedStyle(h).lineHeight), s.key);
      check(`step ${s.n} options are as designed: ruled rows, the A to E keys in the DOM (shortcuts) but NOT shown on a phone, a flat arrow (not a checkbox) on the right, a 14px grey descriptor and no icon tile`, JSON.stringify(labels) === JSON.stringify(s.options) && badges === 'ABCDE'.slice(0, s.options.length) && ticks === s.options.length && icons === 0 && hints.length === s.options.length && hints.every((h) => h.length > 3) && hintSize.every((h) => h.startsWith('14px')) && (await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"] .bk-fn-opt__letter`)].every((l) => getComputedStyle(l).display === 'none') && [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"] .bk-fn-opt__tick svg.lp-glyph--arrow`)].length === document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`).length, s.key)), JSON.stringify(labels) + ` keys=${badges} ticks=${ticks} icons=${icons} hints=${JSON.stringify(hints)}`);
      // The answers use the room (cards grow with the screen) and the reassurance row rests at the bottom of the step: no big black void between them.
      const gap = await page.evaluate((key) => {
        const opts = [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`)]; const last = opts[opts.length - 1].getBoundingClientRect();
        const re = document.querySelector('[data-testid="funnel-reassure"]').getBoundingClientRect(); const chips = document.querySelectorAll('.bk-reassure__chip').length;
        const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body').getBoundingClientRect();
        return { gap: re.top - last.bottom, chips, hs: opts.map((o) => Math.round(o.getBoundingClientRect().height)), reBottom: Math.round(re.bottom), bodyBottom: Math.round(body.bottom) };
      }, s.key);
      check(`step ${s.n} no void: the reassurance row (a ruled block) follows the last option within 260px and the credentials live on step 1 only`, gap.gap >= 0 && gap.chips === 0 && gap.gap <= 260, JSON.stringify(gap));
      check(`step ${s.n} the progress bar is the same on every step: ${s.n} of 6 segments fully filled (ink, not red), the current one at full strength`, (await page.locator('.bk-fn-progress__seg.is-done').count()) === s.n && (await page.locator('.bk-fn-progress__seg.is-current').count()) === 1 && (await page.evaluate(() => [...document.querySelectorAll('.bk-fn-progress__seg.is-done')].every((e) => !/225, 20, 20/.test(getComputedStyle(e, '::after').backgroundColor)))));
      check(`step ${s.n} has the logo header (no strip in it), no horizontal scroll, and under the options ONLY the phone link "Questions? Call us on 07885 496800" (no repeated trust line, no prototype strip, no demo link)`, (await txt(page, 'booking-brand')) === '180 Electrical' && (await page.locator('.bk-header .bk-strip').count()) === 0 && (await page.locator('.bk-strip').count()) === 0 && (await tid(page, 'demo-fill').count()) === 0 && (await page.locator('.bk-ribbon').count()) === 0 && (await noOverflow(page)) && (await tid(page, 'funnel-reassure').count()) === 1 && (await txt(page, 'funnel-reassure')) === 'Questions? Call us on 07885 496800', await txt(page, 'funnel-reassure'));
      check(`step ${s.n} has no Continue button (it auto-advances)`, (await tid(page, 'funnel-continue').count()) === 0 && (await tid(page, 'funnel-submit').count()) === 0 && !sheet.includes('Continue'));
      const small = await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`)].filter((b) => b.getBoundingClientRect().height < 44).length, s.key);
      check(`step ${s.n} every option row is at least 64px tall (ruled rows, no box), and no label breaks in an orphan: the last line of a label is never one lone short word`, small === 0 && (await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"]`)].every((b) => { const h = b.getBoundingClientRect().height; return h >= 64; }), s.key)) && (await page.evaluate((key) => [...document.querySelectorAll(`[data-testid^="funnel-option-${key}-"] .bk-fn-opt__label`)].every((l) => { const lh = parseFloat(getComputedStyle(l).lineHeight) || 22; const lines = Math.round(l.getBoundingClientRect().height / lh); if (lines < 2) return true; const r = document.createRange(); r.selectNodeContents(l); const rects = [...r.getClientRects()]; const lastTop = Math.max(...rects.map((x) => x.top)); const lastW = rects.filter((x) => Math.abs(x.top - lastTop) < 3).reduce((a, x) => a + x.width, 0); return lastW > 70; }), s.key)));
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
    const s6 = await tid(page, 'booking-sheet').textContent();
    check('step 6 H1, promise line, field labels, opt-in and small print read as designed', (await titleOf(page)) === COPY.step6.title && (await txt(page, 'funnel-promise')) === COPY.step6.promise && COPY.step6.labels.every((l) => s6.includes(l)) && s6.includes(COPY.step6.optIn) && (await txt(page, 'funnel-small-print')) === COPY.step6.small, await titleOf(page));
    check('step 6 has helper text and placeholders (mobile, email) and no stray London or Derby postcode, and no "Daniel" anywhere', !/Daniel/.test(s6) && s6.includes('We may text or WhatsApp you') && s6.includes('Your written quote comes here') && (await tid(page, 'field-phone').getAttribute('placeholder')) === '07xxx xxx xxx' && (await tid(page, 'funnel-email').getAttribute('placeholder')) === 'name@email.com' && (await tid(page, 'field-postcode').getAttribute('placeholder')) === 'e.g. BT7 3AB' && !s6.includes('DE1') && !s6.includes('SW1A'));
    const foot6 = await tid(page, 'booking-sheet').locator('.ui-sheet__footer').boundingBox();
    check('the step 6 footer is the button and ONE line (about 125px: 16 above the button, 12 under it, 16 or the home-bar inset below), with a Privacy link', foot6.height <= 130 && (await txt(page, 'funnel-foot-line')).startsWith('We only use this to reply to your enquiry.') && (await txt(page, 'funnel-privacy')) === 'Privacy', JSON.stringify(foot6));
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
  check('at 375x667 the empty step 6 footer is the button and ONE line, about 125px', foot.height <= 130, JSON.stringify(foot));
  await shot(p3, 'funnel-step6-empty-375x667');
  await tid(p3, 'field-name').focus();
  const ring = await p3.evaluate(() => { const cs = getComputedStyle(document.getElementById('fn-name')); return { w: cs.outlineWidth, off: cs.outlineOffset, color: cs.outlineColor, style: cs.outlineStyle, border: cs.borderTopColor }; });
  check('the focus ring is the landing field\'s: ONE 2px ink outline flush against a 1px ink border (offset 0): never red', ring.w === '2px' && ring.style === 'solid' && ring.off === '0px' && ring.color === 'rgb(11, 11, 12)' && ring.border === 'rgb(11, 11, 12)', JSON.stringify(ring));
  await tid(p3, 'field-name').blur();
  await tid(p3, 'funnel-submit').click();
  check('submitting the empty form shows a "Please check 3 fields" line (label voice, in the form), not in the sticky footer', !!(await until(async () => ((await tid(p3, 'funnel-check-summary').first().textContent().catch(() => '')) || '').trim() === 'Please check 3 fields')) && (await p3.locator('.ui-sheet__footer [data-testid="funnel-check-summary"]').count()) === 0 && (await p3.locator('.bk-fields [data-testid="funnel-check-summary"]').count()) === 1, await txt(p3, 'funnel-check-summary'));
  await p3.waitForTimeout(400); // the border colour eases in
  // T01: a deterministic scroll. At 375x667 the field does not fit with the heading above it, so the body scrolls until the count line is 16px below the top and the H1 is wholly out of view; never half cut.
  const t01 = await p3.evaluate(() => {
    const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body'); const bt = body.getBoundingClientRect().top;
    const hdr = document.querySelector('[data-testid="booking-sheet"] .bk-header').getBoundingClientRect().bottom;
    const h1 = document.querySelector('[data-testid="funnel-title"]').getBoundingClientRect();
    const chk = document.querySelector('[data-testid="funnel-check-summary"]'); const cr = chk.getBoundingClientRect(); const cs = getComputedStyle(chk);
    const lab = document.querySelector('label[for="fn-name"]').getBoundingClientRect();
    const btn = document.querySelector('[data-testid="funnel-submit"]').getBoundingClientRect();
    const redText = [...document.querySelectorAll('[data-testid="booking-sheet"] .ui-sheet__body *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && getComputedStyle(e).color === 'rgb(176, 14, 18)').map((e) => e.getBoundingClientRect()).filter((r) => r.bottom > bt && r.top < btn.top);
    const nearestRed = redText.length ? Math.min(...redText.map((r) => btn.top - r.bottom)) : 999;
    return { hdr: Math.round(hdr), h1Top: Math.round(h1.top), h1Bottom: Math.round(h1.bottom), bodyTop: Math.round(bt), cut: h1.top < bt && h1.bottom > bt, labelGap: Math.round(lab.top - hdr), focus: document.activeElement && document.activeElement.id, rule: cs.borderTopWidth + ' ' + cs.borderTopColor, color: cs.color, size: cs.fontSize, stretch: cs.fontStretch, caps: cs.textTransform, chkAbove: cr.bottom <= lab.top, nearestRed: Math.round(nearestRed) };
  });
  check('after Submit the H1 is never half cut (fully visible or fully scrolled out), the first invalid field\'s label is 16px or more under the progress bar and focused, and no red text is within 16px of the red button', !t01.cut && t01.labelGap >= 16 && t01.focus === 'fn-name' && t01.nearestRed >= 16, JSON.stringify(t01));
  check('the count line is a 13px extended uppercase label in --err with a 1px --err rule on top, flush left, directly above the first error', t01.rule === '1px rgb(176, 14, 18)' && t01.color === 'rgb(176, 14, 18)' && t01.size === '13px' && t01.stretch === '125%' && t01.caps === 'uppercase' && t01.chkAbove, JSON.stringify(t01));
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
  // Red means the primary action only. An ERROR is --err (the deeper red, 6.6:1 on paper): the field's border and outline and the message in WORDS, never the brand red, no icon.
  const errIcons = await p3.locator('[data-testid="error-name"] svg, [data-testid="error-phone"] svg, [data-testid="error-email"] svg').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
  check('the error look is --err, not the brand red: the field border and outline in rgb(176, 14, 18) and the message in the same colour, in words (no icon)', st.invBorder === 'rgb(176, 14, 18)' && st.invBorder !== 'rgb(225, 20, 20)' && st.errColor === 'rgb(176, 14, 18)' && errIcons === 0, JSON.stringify([st, errIcons]));
  await shot(p3, 'funnel-step6-errors-375x667');
  await tid(p3, 'funnel-email').scrollIntoViewIfNeeded();
  const reach = await p3.evaluate(() => { const e = document.querySelector('[data-testid="error-email"]').getBoundingClientRect(); const f = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__footer').getBoundingClientRect(); return e.bottom <= f.top + 1; });
  check('the last error is reachable by scrolling (clear of the footer)', reach);
  await tid(p3, 'funnel-privacy').click();
  check('"Privacy" takes the visitor to the full wording (the opt-in and the small print are ONE block) and flashes it', !!(await until(async () => (await activeId(p3)) === 'funnel-legal')) && (await p3.evaluate(() => document.getElementById('fn-smallprint').classList.contains('is-flash'))));
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
  check('the eyebrow is the label voice in --ink-2 (the muted grey), not red', st1.eb === 'rgb(85, 85, 90)', st1.eb);
  check('"Demo: fill sample details" sits BELOW the answers as a 14px grey solid-underline link (nothing dashed above the question), is a 44px target, and carries data-proto', st1.demoTop > st1.reassureTop && st1.demoTop > st1.titleBottom && st1.fs === '14px' && st1.deco === 'solid' && st1.proto && st1.h >= 44 && !st1.ribbon, JSON.stringify(st1));
  const field = (id) => page.evaluate((i) => { const c = getComputedStyle(document.getElementById(i)); return { ow: c.outlineWidth, os: c.outlineStyle, oc: c.outlineColor, bc: c.borderTopColor, bw: c.borderTopWidth, bg: c.backgroundColor }; }, id);
  await tid(page, 'funnel-postcode').focus();
  const empty = await field('fn-postcode');
  check('focused and empty: the landing field\'s 2px ink outline flush on a 1px ink border, on a white field (no red anywhere)', empty.ow === '2px' && empty.bc === 'rgb(11, 11, 12)' && empty.bw === '1px' && empty.bg === 'rgb(255, 255, 255)' && !/225, 20, 20/.test(empty.oc + empty.bc), JSON.stringify(empty));
  await tid(page, 'funnel-postcode').fill('BT7 3AB');
  await until(async () => (await txt(page, 'funnel-zone-hint')).includes("that's in our area"));
  const ok = await field('fn-postcode');
  check('a valid postcode: the border stays ink (no green, no tick inside the field); the verdict line "Good news, that\'s in our area." carries the tick glyph in ink; no red', ok.bc === 'rgb(11, 11, 12)' && (await tid(page, 'funnel-postcode-ok').count()) === 0 && (await tid(page, 'funnel-zone-hint').locator('svg.lp-glyph--tick').count()) === 1 && !/225, 20, 20/.test(ok.oc + ok.bc) && (await tid(page, 'funnel-zone-hint').evaluate((e) => getComputedStyle(e).color)) === 'rgb(11, 11, 12)', JSON.stringify(ok));
  await shot(page, 'funnel-step1-valid-375');
  await tid(page, 'funnel-postcode').fill('not a postcode');
  await tid(page, 'funnel-continue').click();
  await until(async () => (await txt(page, 'error-funnel-postcode')) === COPY.step1.error);
  await page.waitForTimeout(350);
  const bad = await field('fn-postcode');
  check('an error is the ONLY state in --err: the 1px border and the flush 2px outline in rgb(176, 14, 18) (not the brand red), on the same white field', bad.bc === 'rgb(176, 14, 18)' && bad.bw === '1px' && bad.ow === '2px' && bad.oc === 'rgb(176, 14, 18)' && bad.bg === 'rgb(255, 255, 255)', JSON.stringify(bad));
  await shot(page, 'funnel-step1-error-375');
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-continue').click();
  await onStep(page, 2);
  // ---- step 2: On-street shows a conditional note and a Continue; it does not move on by itself
  await tid(page, 'funnel-option-parking-street').click();
  await page.waitForTimeout(700);
  const note = await txt(page, 'funnel-street-note');
  check('choosing On-street stays on step 2 and shows "Home chargers usually need off-street parking. We can talk through options, or call 07885 496800."', (await stepLabel(page)) === 'Step 2 of 6' && /^Home chargers usually need off-street parking\. We can talk through options, or call 07885 496800\.\s*Continue$/.test(note) && (await tid(page, 'funnel-street-note').locator('a[href="tel:+447885496800"]').count()) === 1, note);
  // T04: the SELECTED row is a single choice, so no checkbox: it FILLS INK with paper-coloured text and no outline, its left and right edges exactly on the 24px content edge (nothing painted outside), and the arrow stays.
  const selSt = await page.evaluate(() => { const o = document.querySelector('[data-testid="funnel-option-parking-street"]'); const r = o.getBoundingClientRect(); const cs = getComputedStyle(o); const after = getComputedStyle(o, '::after'); const tick = o.querySelector('.bk-fn-opt__tick'); const lbl = getComputedStyle(o.querySelector('.bk-fn-opt__label')); const hint = getComputedStyle(o.querySelector('.bk-fn-opt__hint')); const opts = document.querySelector('.bk-fn-opts').getBoundingClientRect(); const h1 = document.querySelector('[data-testid="funnel-title"]').getBoundingClientRect(); return { bg: cs.backgroundColor, left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, edge: Math.round(h1.left), optsL: Math.round(opts.left), optsR: Math.round(opts.right), outline: cs.outlineStyle + ' ' + cs.outlineWidth, afterContent: after.content, label: lbl.color, hint: hint.color, arrow: tick.querySelectorAll('svg.lp-glyph--arrow').length, arrowColor: getComputedStyle(tick).color, tickBg: getComputedStyle(tick).backgroundColor, tickBorder: getComputedStyle(tick).borderTopWidth, h: Math.round(r.height), shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, icons: o.querySelectorAll('.bk-fn-opt__icon').length, letter: getComputedStyle(o.querySelector('.bk-fn-opt__letter')).display }; });
  check('the selected option FILLS INK (paper text, no frame, no shadow, the arrow stays, no checkbox), its edges exactly on the content edge (24px at 375: nothing painted outside), 64px or taller, and no A to E key on a phone', selSt.bg === 'rgb(11, 11, 12)' && selSt.left === selSt.edge && selSt.right === selSt.vw - selSt.edge && selSt.left === selSt.optsL && selSt.right === selSt.optsR && selSt.label === 'rgb(245, 245, 244)' && selSt.arrow === 1 && selSt.arrowColor === 'rgb(245, 245, 244)' && selSt.tickBg === 'rgba(0, 0, 0, 0)' && selSt.tickBorder === '0px' && (selSt.afterContent === 'none' || selSt.afterContent === 'normal') && selSt.shadow === 'none' && selSt.radius === '0px' && selSt.icons === 0 && selSt.h >= 64 && selSt.letter === 'none' && !/225, 20, 20/.test(JSON.stringify(selSt)), JSON.stringify(selSt));
  await shot(page, 'funnel-step2-street-375');
  check('the note does not block Next: Continue moves on to step 3 with the answer kept', await (async () => { await tid(page, 'funnel-next').click(); return onStep(page, 3); })() && (await page.evaluate(() => JSON.parse(sessionStorage.getItem('vm_draft_v1')).answers.parking)) === 'street');
  await tid(page, 'booking-back').click();
  await onStep(page, 2);
  check('back on step 2 the On-street answer is still selected, with its note and Continue', (await tid(page, 'funnel-option-parking-street').getAttribute('aria-pressed')) === 'true' && (await tid(page, 'funnel-next').count()) === 1);
  await tid(page, 'funnel-option-parking-garage').click();
  check('any other answer still moves on by itself and clears the note', await onStep(page, 3));
  // ---- step 5: tenant-friendly wording, the answer ids are unchanged and the owner's dashboard still shows the answer
  // T04: the tapped row stays filled ink for about 380ms (no transition) before the next question opens
  const hold = await page.evaluate(() => new Promise((res) => {
    const sel = '[data-testid="funnel-option-vehicle-ordered"]'; const t0 = performance.now(); let lastBg = ''; let sawFilled = 0;
    document.querySelector(sel).click();
    const read = () => { const o = document.querySelector(sel); const lbl = document.querySelector('[data-testid="funnel-step-label"]'); if (!o || !/Step 3/.test(lbl.textContent)) return res({ ms: Math.round(performance.now() - t0), lastBg, sawFilled }); lastBg = getComputedStyle(o).backgroundColor; if (lastBg === 'rgb(11, 11, 12)') sawFilled = Math.round(performance.now() - t0); requestAnimationFrame(read); };
    read();
  }));
  check('tapping a row keeps it filled ink for 350ms or more (about 380ms) before the next step opens', hold.ms >= 350 && hold.ms <= 700 && hold.lastBg === 'rgb(11, 11, 12)' && hold.sawFilled >= 330, JSON.stringify(hold));
  await onStep(page, 4);
  await tid(page, 'funnel-option-timing-asap').click();
  await onStep(page, 5);
  check('step 5 asks his own "Can you authorise installation work at the property?" with Yes / I need landlord or freeholder approval / I\'m not sure', (await titleOf(page)) === 'Can you authorise installation work at the property?' && JSON.stringify((await page.locator('[data-testid^="funnel-option-permission-"] .bk-fn-opt__label').allInnerTexts()).map((t) => t.trim())) === JSON.stringify(['Yes', 'I need landlord or freeholder approval', "I'm not sure"]));
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
  check('the dashboard job card shows the permission answer in his wording', /I need landlord or freeholder approval/.test(job), job.slice(0, 300));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 2g. the funnel sheet is one system with the landing page (LANDING-V5 section 10)
await section('2g. the funnel sheet is one system with the landing page: square, flat, one family, red only on the one primary button, the whole viewport from 720 (no floating panel)', async () => {
  const flatScan = (page) => page.evaluate(() => {
    const root = document.querySelector('[data-testid="booking-sheet"]');
    const bad = { radius: [], shadow: [], gradient: [], heavy: [], icons: [], red: [] };
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.closest('[data-proto]') && el.closest('[data-testid="demo-panel"]')) continue;
      const tag = (el.getAttribute('data-testid') || el.className || el.tagName).toString().slice(0, 40);
      if (/[1-9]/.test(cs.borderTopLeftRadius + cs.borderBottomRightRadius)) bad.radius.push(tag + ' ' + cs.borderTopLeftRadius);
      if (cs.boxShadow !== 'none' && !/^rgb[a]?\([^)]*\) (0px 0px 0px (1|2)px( inset)?|0px 1px 0px 0px)$/.test(cs.boxShadow)) bad.shadow.push(tag + ' ' + cs.boxShadow);
      if (/gradient/.test(cs.backgroundImage)) bad.gradient.push(tag);
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (parseInt(cs.fontWeight, 10) >= 800 && hasText && !el.closest('.lp-logovoice') && !el.closest('.u-sr-only')) bad.heavy.push(tag + ' ' + cs.fontWeight);
      if (el.matches('.ui-icon-btn, .bk-fn-opt__icon, .bk-service__icon, .bk-wa__icon, .bk-quote__icon')) bad.icons.push(tag);
      const primary = el.closest('.ui-btn--primary');
      if (!primary && ((hasText && cs.color === 'rgb(225, 20, 20)') || (cs.backgroundColor === 'rgb(225, 20, 20)') || cs.borderTopColor === 'rgb(225, 20, 20)' && cs.borderTopWidth !== '0px')) bad.red.push(tag);
    }
    return bad;
  });
  const redVisible = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="booking-sheet"] a, [data-testid="booking-sheet"] button')].filter((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return cs.backgroundColor === 'rgb(225, 20, 20)' && r.width > 0 && r.bottom > 0 && r.top < innerHeight; }).map((b) => b.getAttribute('data-testid')));
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await onStep(page, 1);
  const frame = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="booking-sheet"]'); const r = sheet.getBoundingClientRect();
    const bar = document.querySelector('.bk-header__bar'); const body = sheet.querySelector('.ui-sheet__body'); const foot = sheet.querySelector('.ui-sheet__footer');
    return { w: Math.round(r.width), vw: innerWidth, left: Math.round(r.left), bar: getComputedStyle(bar).backgroundColor, barH: Math.round(bar.getBoundingClientRect().height), body: getComputedStyle(body).backgroundColor, foot: getComputedStyle(foot).backgroundColor, footRule: getComputedStyle(foot).borderTopWidth + ' ' + getComputedStyle(foot).borderTopColor };
  });
  check('phone: the sheet runs edge to edge; a 64px black bar (the logo\'s own ground) over a paper body; the footer is paper with a 1px ink rule', frame.w === frame.vw && frame.left === 0 && frame.bar === 'rgb(11, 11, 12)' && frame.barH === 64 && frame.body === 'rgb(245, 245, 244)' && frame.foot === 'rgb(245, 245, 244)' && frame.footRule === '1px rgb(11, 11, 12)', JSON.stringify(frame));
  const type1 = await page.evaluate(() => { const t = getComputedStyle(document.querySelector('[data-testid="funnel-title"]')); const l = getComputedStyle(document.querySelector('label[for="fn-postcode"]')); const st = getComputedStyle(document.querySelector('[data-testid="funnel-step-label"]')); return { fam: t.fontFamily.split(',')[0], stretch: t.fontStretch, weight: t.fontWeight, ls: t.letterSpacing, size: t.fontSize, lblStretch: l.fontStretch, lblCase: l.textTransform, lblSize: l.fontSize, stepStretch: st.fontStretch, stepCase: st.textTransform }; });
  check('the headline is the display voice (Archivo, width 108, weight 650, tracked in) and the labels and "Step N of 6" are the label voice (width 125, uppercase, 13px)', /Archivo/.test(type1.fam) && type1.stretch === '108%' && type1.weight === '650' && parseFloat(type1.ls) < 0 && type1.lblStretch === '125%' && type1.lblCase === 'uppercase' && type1.lblSize === '13px' && type1.stepStretch === '125%' && type1.stepCase === 'uppercase', JSON.stringify(type1));
  const field = await page.evaluate(() => { const f = getComputedStyle(document.querySelector('[data-testid="funnel-postcode"]')); const r = document.querySelector('[data-testid="funnel-postcode"]').getBoundingClientRect(); return { h: Math.round(r.height), bg: f.backgroundColor, bw: f.borderTopWidth, bc: f.borderTopColor, rad: f.borderTopLeftRadius, fs: f.fontSize, fw: f.fontWeight, tt: f.textTransform }; });
  check('the postcode field is the landing\'s: 64px, white, 1px ink border, square, 24px / 500, uppercase', field.h === 64 && field.bg === 'rgb(255, 255, 255)' && field.bw === '1px' && field.bc === 'rgb(11, 11, 12)' && field.rad === '0px' && field.fs === '24px' && field.fw === '500' && field.tt === 'uppercase', JSON.stringify(field));
  const prog = await page.evaluate(() => [...document.querySelectorAll('.bk-fn-progress__seg')].map((s) => { const c = getComputedStyle(s); const a = getComputedStyle(s, '::after'); return { h: Math.round(s.getBoundingClientRect().height), rad: c.borderTopLeftRadius, rest: c.backgroundColor, fill: a.backgroundColor }; }));
  check('the progress is six 2px square segments: ink for done and current, --rule for to come', prog.length === 6 && prog.every((p) => p.h === 2 && p.rad === '0px') && prog[0].fill === 'rgb(11, 11, 12)' && prog[1].rest === 'rgba(11, 11, 12, 0.16)', JSON.stringify(prog.slice(0, 2)));
  check('step 1: nothing rounded, no shadow, no gradient, no icon tile, no weight 800 outside the logo voice, no red outside the primary button', JSON.stringify(await flatScan(page)) === JSON.stringify({ radius: [], shadow: [], gradient: [], heavy: [], icons: [], red: [] }), JSON.stringify(await flatScan(page)));
  check('step 1: exactly one red button is on screen (Continue)', JSON.stringify(await redVisible(page)) === '["funnel-continue"]', JSON.stringify(await redVisible(page)));
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-continue').click();
  await onStep(page, 2);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="funnel-option-parking-"]')].map((o) => { const c = getComputedStyle(o); const k = o.querySelector('.bk-fn-opt__letter'); const t = o.querySelector('.bk-fn-opt__tick'); const l = o.querySelector('.bk-fn-opt__label'); return { h: Math.round(o.getBoundingClientRect().height), border: c.borderBottomWidth + ' ' + c.borderBottomStyle, bg: c.backgroundColor, rad: c.borderTopLeftRadius, key: k.textContent, keyStretch: getComputedStyle(k).fontStretch, keyShown: getComputedStyle(k).display, arrow: t.querySelectorAll('svg.lp-glyph--arrow').length, tick: Math.round(t.getBoundingClientRect().width), lblFs: getComputedStyle(l).fontSize, lblW: getComputedStyle(l).fontWeight, tickR: getComputedStyle(t).borderTopLeftRadius }; }));
  check('step 2: five ruled rows (a hairline each, no box, no fill), the A to E keys kept as shortcuts but hidden on a phone, a flat 20px arrow on the right (no checkbox), the label 19px / 600', rows.length === 5 && rows.map((r) => r.key).join('') === 'ABCDE' && rows.every((r) => r.h >= 64 && r.border === '1px solid' && r.bg === 'rgba(0, 0, 0, 0)' && r.rad === '0px' && r.keyShown === 'none' && r.tick === 20 && r.tickR === '0px' && r.arrow === 1 && r.lblFs === '19px' && r.lblW === '600'), JSON.stringify(rows[0]));
  check('step 2: nothing rounded, no shadow, no gradient, no icon tile, no red outside the primary button', JSON.stringify(await flatScan(page)) === JSON.stringify({ radius: [], shadow: [], gradient: [], heavy: [], icons: [], red: [] }), JSON.stringify(await flatScan(page)));
  await tid(page, 'funnel-option-parking-street').click();
  await sleep(300);
  await tid(page, 'funnel-next').scrollIntoViewIfNeeded();
  check('step 2: choosing On-street holds the step with the one red button (Continue) on screen', JSON.stringify(await redVisible(page)) === '["funnel-next"]', JSON.stringify(await redVisible(page)));
  await tid(page, 'funnel-option-parking-driveway').click();
  await onStep(page, 3);
  await tid(page, 'funnel-option-vehicle-have').click();
  await onStep(page, 4);
  await tid(page, 'funnel-option-timing-asap').click();
  await onStep(page, 5);
  await tid(page, 'funnel-option-permission-yes').click();
  await onStep(page, 6);
  check('step 6: nothing rounded, no shadow, no gradient, no red outside the primary button; one red button on screen (the submit)', JSON.stringify(await flatScan(page)) === JSON.stringify({ radius: [], shadow: [], gradient: [], heavy: [], icons: [], red: [] }) && JSON.stringify(await redVisible(page)) === '["funnel-submit"]', JSON.stringify([await flatScan(page), await redVisible(page)]));
  await tid(page, 'demo-fill').click();
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  await sleep(500);
  check('confirmation: nothing rounded, no shadow, no gradient, no icon tile, no red outside the primary button; the WhatsApp send is the one red button on screen', JSON.stringify(await flatScan(page)) === JSON.stringify({ radius: [], shadow: [], gradient: [], heavy: [], icons: [], red: [] }) && JSON.stringify(await redVisible(page)) === '["wa-send"]', JSON.stringify([await flatScan(page), await redVisible(page)]));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();

  // T02: from 720 up the funnel sheet is the WHOLE viewport (not a 560px panel floating over the page: its black bar used to fuse with the dimmed black page header). The black bar runs edge to edge
  // with a 1px --rule-b edge under it, Back / his logo / Close on a 48px margin, and the step label, progress, body and sticky footer share ONE 560px column, centred, text flush left.
  for (const [w, h] of [[768, 1024], [1024, 768], [1280, 900]]) {
    const c2 = await newContext({ width: w, height: h }, 'light');
    const p2 = await c2.newPage();
    const log2 = watch(p2);
    await site(p2, '#book/ev_quote');
    await sheetOpen(p2);
    await onStep(p2, 1);
    const probe = () => p2.evaluate(() => {
      const sheet = document.querySelector('[data-testid="booking-sheet"]'); const c = getComputedStyle(sheet); const r = sheet.getBoundingClientRect();
      const bar = document.querySelector('.bk-header__bar'); const br = bar.getBoundingClientRect(); const bc = getComputedStyle(bar);
      const covered = (sel) => { const e = document.querySelector(sel); if (!e || !e.getClientRects().length) return true; const q = e.getBoundingClientRect(); return [[q.left + q.width / 2, q.top + q.height / 2], [q.left + 2, q.top + q.height / 2]].every(([x, y]) => { const t = document.elementFromPoint(x, y); return !t || sheet.contains(t); }); };
      const logo = document.querySelector('[data-testid="booking-brand"]').getBoundingClientRect(); const back = document.querySelector('[data-testid="booking-back"]'); const close = document.querySelector('[data-testid="booking-close"]').getBoundingClientRect();
      const col = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.width)]; };
      const title = document.querySelector('[data-testid="funnel-title"]') || document.querySelector('[data-testid="confirmation-title"]');
      const foot = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__footer > .bk-footer');
      return { vw: innerWidth, vh: innerHeight, sheet: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], rad: c.borderTopLeftRadius, shadow: c.boxShadow, barL: Math.round(br.left), barW: Math.round(br.width), barBg: bc.backgroundColor, barEdge: bc.borderBottomWidth + ' ' + bc.borderBottomColor,
        pageHeader: covered('[data-testid="lp-header"]'), phone: covered('[data-testid="lp-header-phone"]'), strip: covered('[data-testid="prototype-strip"]'),
        margins: [back ? Math.round(back.getBoundingClientRect().left) : 48, Math.round(innerWidth - close.right)], logoCentred: Math.abs(logo.left + logo.width / 2 - innerWidth / 2) <= 1,
        title: col(title), foot: col(foot), body: col(document.querySelector('.bk--sheet > .bk-step')), step: col(document.querySelector('[data-testid="funnel-step-label"]')) };
    });
    const okFull = (g, stepName) => g.sheet[0] === 0 && g.sheet[1] === 0 && g.sheet[2] === g.vw && g.sheet[3] === g.vh && g.rad === '0px' && g.shadow === 'none' && g.barL === 0 && g.barW === g.vw && g.barBg === 'rgb(11, 11, 12)' && g.barEdge === '1px rgba(245, 245, 244, 0.2)' && g.pageHeader && g.phone && g.strip && g.margins[0] === 48 && g.margins[1] === 48 && g.logoCentred;
    const okCol = (g) => g.body && g.body[1] === 560 && Math.abs(g.body[0] - (g.vw - 560) / 2) <= 1 && g.title && g.title[0] === g.body[0] && (!g.foot || (g.foot[1] === 560 && g.foot[0] === g.body[0])) && (!g.step || g.step[0] === g.body[0]);
    const g1 = await probe();
    check(`${w}x${h} step 1: the sheet covers the whole viewport (no panel, no radius, no shadow); the page header, its phone number and the Prototype strip are covered; the black bar spans x=0 to the right edge with a 1px hairline, Back/logo/Close on a 48px margin`, okFull(g1), JSON.stringify(g1));
    check(`${w}x${h} step 1: ONE 560px column (step label, body and sticky footer), centred, text flush left`, okCol(g1), JSON.stringify(g1));
    await tid(p2, 'funnel-postcode').fill('BT9 6QP');
    await tid(p2, 'funnel-continue').click();
    await onStep(p2, 2);
    const g2 = await probe();
    check(`${w}x${h} step 2: the same full-viewport sheet and one 560px column (the options are keyed A to E for a mouse)`, okFull(g2) && okCol(g2) && (await p2.locator('.bk-fn-opt__letter').first().evaluate((e) => getComputedStyle(e).display)) === 'block', JSON.stringify(g2));
    await shot(p2, `funnel-fullsheet-step2-${w}`);
    for (const [key, value] of [['parking', 'driveway'], ['vehicle', 'ordered'], ['timing', 'asap'], ['permission', 'yes']]) { await tid(p2, `funnel-option-${key}-${value}`).waitFor({ timeout: WAIT }); await tid(p2, `funnel-option-${key}-${value}`).click(); await sleep(520); }
    await onStep(p2, 6);
    const g6 = await probe();
    check(`${w}x${h} step 6: the same full-viewport sheet and one 560px column, the footer button inside it`, okFull(g6) && okCol(g6) && g6.foot, JSON.stringify(g6));
    await shot(p2, `funnel-fullsheet-step6-${w}`);
    await tid(p2, 'demo-fill').click();
    await tid(p2, 'funnel-submit').click();
    await tid(p2, 'confirmation').waitFor({ timeout: WAIT });
    const gc = await probe();
    check(`${w}x${h} confirmation: the same full-viewport sheet and one 560px column`, okFull(gc) && okCol(gc), JSON.stringify(gc));
    await shot(p2, `funnel-fullsheet-confirmation-${w}`);
    check(`${w}x${h}: no console errors, off-site or failed requests`, clean(log2), dump(log2));
    await c2.close();
  }
  // below 720 the phone layout is unchanged: edge to edge, a 24px page margin, no 560 column
  const c3 = await newContext({ width: 719, height: 800 }, 'light');
  const p3 = await c3.newPage();
  await site(p3, '#book/ev_quote');
  await sheetOpen(p3);
  await onStep(p3, 1);
  const phoneCol = await p3.evaluate(() => { const t = document.querySelector('[data-testid="funnel-title"]').getBoundingClientRect(); const b = document.querySelector('.bk-header__bar').getBoundingClientRect(); return { titleLeft: Math.round(t.left), barW: Math.round(b.width), vw: innerWidth }; });
  check('719px: still the phone layout (24px margin, the bar full width)', phoneCol.titleLeft === 24 && phoneCol.barW === phoneCol.vw, JSON.stringify(phoneCol));
  await c3.close();
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
  // ---- T03: a FRESH confirmation says "Nearly done" / "Send your enquiry to 180 Electrical." and shows the one red button: nothing has reached the business yet, so no thank-you and no 24-hour promise.
  const fresh = await page.evaluate(() => {
    const conf = document.querySelector('[data-testid="confirmation"]');
    const clone = conf.cloneNode(true); clone.querySelectorAll('[data-proto]').forEach((n) => n.remove());
    const wa = conf.querySelector('[data-testid="wa-send"]'); const tk = conf.querySelector('[data-testid="confirmation-ticket"]'); const h1 = conf.querySelector('[data-testid="confirmation-title"]');
    const eb = conf.querySelector('[data-testid="wa-send-title"]'); const ebs = getComputedStyle(eb);
    const prim = [...conf.querySelectorAll('.ui-btn--primary')].map((b) => b.getAttribute('data-testid'));
    const dark = [...conf.querySelectorAll('svg')].filter((v) => v.getClientRects().length && (v.getAttribute('class') || '').includes('bk-tick')).length;
    const proto = conf.querySelector('[data-testid="confirmation-proto"]'); const done = conf.querySelector('[data-testid="confirmation-done"]');
    return { eyebrow: eb.textContent.trim(), eyebrowCss: [ebs.fontSize, ebs.fontStretch, ebs.textTransform, ebs.color].join('|'), h1: h1.textContent.trim(), h1Top: Math.round(h1.getBoundingClientRect().top), lead: (conf.querySelector('[data-testid="wa-send-text"]') || {}).textContent, button: wa ? wa.textContent.trim() : '', btnTop: wa ? Math.round(wa.getBoundingClientRect().top) : 0, ticketTop: Math.round(tk.getBoundingClientRect().top), prim, ticks: dark + conf.querySelectorAll('[data-testid="confirmation-tick"]').length, thanks: /Thanks, your enquiry has been received|within 24 hours/.test(clone.textContent), hasLead: !!conf.querySelector('[data-testid="confirmation-lead"]'), webhookOutside: /webhook/i.test(clone.textContent), webhookInside: !!proto && /webhook/i.test(proto.textContent), protoBelowDone: !!proto && !!done && proto.getBoundingClientRect().top >= done.getBoundingClientRect().bottom, protoDashed: !!proto && getComputedStyle(proto).borderTopStyle === 'dashed', dani: /Daniel/.test(clone.textContent) };
  });
  check('a fresh confirmation leads with the label-voice eyebrow "Nearly done" (13px, extended, uppercase, ink) over the H1 "Send your enquiry to 180 Electrical.", with NO black square, no tick, no thank-you and no 24-hour promise yet', fresh.eyebrow === 'Nearly done' && fresh.eyebrowCss === '13px|125%|uppercase|rgb(11, 11, 12)' && fresh.h1 === 'Send your enquiry to 180 Electrical.' && fresh.ticks === 0 && !fresh.thanks && !fresh.hasLead, JSON.stringify(fresh));
  check('one line says one tap opens WhatsApp with the details written, the red "Send my enquiry on WhatsApp" button is directly under it, above the reference block, and it is the only red button; no "Daniel" outside the prototype block', /One tap opens WhatsApp with your details already written/.test(fresh.lead) && fresh.button === 'Send my enquiry on WhatsApp' && fresh.btnTop > fresh.h1Top && fresh.btnTop < fresh.ticketTop && fresh.prim.length === 1 && fresh.prim[0] === 'wa-send' && !fresh.dani, JSON.stringify(fresh));
  check('the word "webhook" appears only inside the dashed PROTOTYPE block, which sits below the Done button and is data-proto', !fresh.webhookOutside && fresh.webhookInside && fresh.protoBelowDone && fresh.protoDashed && (await tid(page, 'confirmation-proto').getAttribute('data-proto')) !== null && (await tid(page, 'wa-send-note').getAttribute('data-proto')) !== null, JSON.stringify(fresh));
  await shot(page, 'funnel-7-confirmation-send');
  // The customer taps the button (WhatsApp opens in its own tab; the test only records that it was opened, never follows wa.me), then the thank-you shows.
  await page.evaluate(async () => { const m = await import('./js/core/handoff.js'); m.rememberHandoff('enq', 'EL-1043', {}); });
  await page.reload({ waitUntil: 'networkidle' });
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  // ---- the customer's view is ONE story, short and plain: his thank-you, the reference, the WhatsApp send (the one filled button), ONE tagged idea card for the visit,
  // two closed rows (photos, what happens next), Call, the demo behind one dashed button, and a real "Done" button with "Change or cancel" as a quiet link under it.
  const view = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body');
    const conf = document.querySelector('[data-testid="confirmation"]');
    const done = document.querySelector('[data-testid="confirmation-done"]');
    const manage = document.querySelector('[data-testid="confirmation-manage"]');
    const text = conf.innerText;
    const clone = conf.cloneNode(true); clone.querySelectorAll('[data-proto]').forEach((n) => n.remove());
    const visible = clone.textContent.replace(/\s+/g, ' ').trim();
    const d = done ? done.getBoundingClientRect() : { width: 0, bottom: 0, height: 0 };
    return { h: conf.getBoundingClientRect().height, doneSecondary: !!done && done.classList.contains('ui-btn--secondary') && !done.classList.contains('ui-btn--ghost'), doneW: d.width, doneH: d.height, cw: conf.getBoundingClientRect().width, manageBelow: !!done && !!manage && manage.getBoundingClientRect().top >= d.bottom - 2 && manage.getBoundingClientRect().height >= 40 && manage.tagName === 'BUTTON' && !manage.classList.contains('ui-btn'), text, visible, sheet: body ? body.innerText : '' };
  });
  check('the confirmation in its default state is no taller than about 2 screens (1,700px)', view.h <= 1700, String(view.h));
  check('it has no "(simulated)" and no "prototype" text outside the dashed PROTOTYPE block, uses his own words ("The team at 180 Electrical will review your details"), never uses the old words "pencilled" or "provisional", and never speaks about Daniel in the third person', !/simulated|prototype/i.test(view.visible) && /The team at 180 Electrical will review your details/.test(view.visible) && !/pencil|provisional/i.test(view.visible) && !/Daniel/.test(view.visible), view.visible.slice(0, 300));
  check('it ends plainly: "Done" is a real secondary button (full width, not bare text) and "Change or cancel" is a quiet link under it', view.doneSecondary && view.doneW >= view.cw * 0.8 && view.doneH >= 52 && view.manageBelow && (await txt(page, 'confirmation-manage')) === 'Change or cancel');
  check('"Add photos" is a CLOSED optional row (not a red button), "What happens next" is closed too, and the demo is one dashed button marked data-proto', (await tid(page, 'funnel-ready-box').evaluate((d) => d.open)) === false && /Add photos/.test(await txt(page, 'funnel-ready-box')) && /Optional/i.test(await txt(page, 'funnel-ready-box')) && (await tid(page, 'journey-box').evaluate((d) => d.open)) === false && (await tid(page, 'demo-panel').count()) === 0 && (await txt(page, 'demo-toggle')) === 'Demo: see what your phone would receive' && (await tid(page, 'demo-toggle').getAttribute('data-proto')) !== null);
  check('once WhatsApp has been opened the H1 is his "Thanks, your enquiry has been received." over the eyebrow "Opened in WhatsApp"', (await txt(page, 'confirmation-title')) === COPY.confirm.title && ((await tid(page, 'wa-send-title').textContent()) || '').trim() === 'Opened in WhatsApp', await txt(page, 'confirmation-title'));
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
  check('the suggested visit is ONE idea card: data-proto, the visible tag "Idea from us, not on your site today", "Earliest visit we could offer", "Mon 26 Oct, 8 to 10am" in words, and the single status "We will confirm."', visit.n === 1 && visit.proto && visit.tagVisible && visit.tag === 'Idea from us, not on your site today' && visit.kicker === 'Earliest visit we could offer' && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, \d{1,2}(am|pm)? to \d{1,2}(am|pm)?$/.test(visit.when) && visit.status === 'We will confirm.' && !/pencil|provisional|survey/i.test(visit.text) && visit.pills === 0, JSON.stringify(visit));
  const dateSt = await page.evaluate(() => { const w = document.querySelector('[data-testid="confirmation-visit-when"]'); const cs = getComputedStyle(w); return { size: cs.fontSize, weight: cs.fontWeight, tab: cs.fontVariantNumeric, time: !!w.querySelector('time[datetime]'), tiles: document.querySelectorAll('.bk-datetile').length }; });
  check('the visit date is type, not a tile: 24px / 600 and tabular in a <time>, no calendar-page tile, and no second status tag', dateSt.size === '24px' && dateSt.weight === '600' && /tabular-nums/.test(dateSt.tab) && dateSt.time && dateSt.tiles === 0 && (await tid(page, 'confirmation-visit-tag').count()) === 0, JSON.stringify(dateSt));
  await openAcc(page, 'funnel-ready-box');
  const ready = await txt(page, 'funnel-ready-box');
  check('opening "Add photos" shows HIS words, verbatim: "If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation."', ready.includes(COPY.confirm.ready) && (await tid(page, 'photos-prompt').isVisible()) && (await txt(page, 'photos-prompt')) === COPY.confirm.ready, ready);
  const prim = await page.evaluate(() => [...document.querySelectorAll('[data-testid="confirmation"] .ui-btn--primary')].map((b) => b.getAttribute('data-testid')));
  check('after WhatsApp has been opened the page has NO filled (primary) button: the send became the text link "Open WhatsApp again"; "Choose photos" and "Take a photo" are secondary', (await tid(page, 'photos-card').count()) === 1 && !(await tid(page, 'photos-choose').getAttribute('class')).includes('ui-btn--primary') && prim.length === 0 && (await tid(page, 'wa-send-again').count()) === 1 && (await tid(page, 'wa-send').count()) === 0, JSON.stringify(prim));
  const callBtn = await page.evaluate(() => { const c = document.querySelector('[data-testid="confirmation-call"]').getBoundingClientRect(); return { h: c.height, w: c.width }; });
  check('"Prefer to speak to us?" with ONE Call button (his site lists no WhatsApp), a tel: link with his number; the WhatsApp transport is the send card', (await txt(page, 'confirmation-call')) === 'Call 07885 496800' && (await tid(page, 'confirmation-call').getAttribute('href')) === 'tel:+447885496800' && /Prefer to speak to us\?/.test(await txt(page, 'confirmation')) && (await tid(page, 'confirmation-whatsapp').count()) === 0 && callBtn.h >= 44, JSON.stringify(callBtn));
  const wa = (await tid(page, 'wa-send-again').getAttribute('href')) || '';
  check('the WhatsApp card uses his real number and carries the reference', /^https:\/\/wa\.me\/447885496800\?text=/.test(wa) && decodeURIComponent(wa).includes('EL-1043'), wa);
  const first1 = await page.evaluate(() => {
    const conf = document.querySelector('[data-testid="confirmation"]');
    const chip = document.querySelector('[data-testid="confirmation-status"]');
    const pills = [...conf.querySelectorAll('.ui-chip, .bk-pill-tag')];
    return { pills: pills.length, chip: chip ? chip.textContent.trim() : '', html: document.body.innerHTML };
  });
  check('a NEW enquiry has no status pill at all (the headline says where it is; the visit card has the one status), and nothing says Provisional or Awaiting confirmation', first1.pills === 0 && first1.chip === '' && !/Provisional|Awaiting confirmation/.test(first1.html.replace(/<script[\s\S]*?<\/script>/g, '')), JSON.stringify([first1.pills, first1.chip]));
  const noTile = await page.evaluate(() => ({ tick: document.querySelectorAll('.bk-tick, [data-testid="confirmation-tick"]').length, art: document.querySelectorAll('.bk-confirm__art').length, breaker: document.querySelectorAll('[data-testid="breaker-art"]').length, squares: [...document.querySelectorAll('[data-testid="confirmation"] svg')].filter((v) => v.getClientRects().length && v.getBoundingClientRect().width >= 48).length }));
  check('there is no black square tile with a tick (no icon tile, no breaker art) anywhere on the confirmation', noTile.tick === 0 && noTile.art === 0 && noTile.breaker === 0 && noTile.squares === 0, JSON.stringify(noTile));
  check('no Add to calendar button while the visit is only a suggestion', (await tid(page, 'add-to-calendar').count()) === 0);
  await openAcc(page, 'journey-box');
  const steps = await tid(page, 'confirmation-timeline').locator('li').count();
  const tl = await txt(page, 'confirmation-timeline');
  check('the timeline reads naturally for the customer: no "(simulated)", no "the team", no "Waiting for", and the business speaks as "we"', !/simulated|the team|Waiting for|Daniel/i.test(tl) && /We have your enquiry/.test(tl) && /We review your details/.test(tl), tl);
  const first = await txt(page, 'journey-received');
  const nodeSt = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('[data-testid="journey-received"] .bk-timeline__mark')); return c.backgroundColor + '|' + c.borderRadius; });
  check('"What happens next" has five steps, the first already ticked, and a completed node is an INK square (no green, no circle)', steps === 5 && (await tid(page, 'journey-received').getAttribute('class')).includes('is-done') && first.includes('Just now') && nodeSt === 'rgb(11, 11, 12)|0px', `${steps} ${first} ${nodeSt}`);
  check('the first step still to come is marked as the current one', (await tid(page, 'journey-contact').getAttribute('class')).includes('is-current') && (await tid(page, 'journey-contact').getAttribute('aria-current')) === 'step');
  await openDemo(page);
  check('DEMO panel (inside the dashed PROTOTYPE block, behind a text-link row) is labelled "Demo, simulated" and shows the two labelled messages, ruled and square: no phone frame, no wallpaper, no radius, no green, no red', (await txt(page, 'demo-panel')).toLowerCase().includes('demo, simulated') && (await tid(page, 'demo-owner-bubble').count()) === 1 && (await tid(page, 'demo-customer-bubble').count()) === 1 && /simulated/i.test(await txt(page, 'demo-panel')) && (await page.locator('[data-testid="demo-panel"] .ui-phone, [data-testid="demo-panel"] .ui-bubble').count()) === 0 && (await page.evaluate(() => { const p = document.querySelector('[data-testid="demo-panel"]'); const bad = []; for (const e of p.querySelectorAll('*')) { const cs = getComputedStyle(e); if (/[1-9]/.test(cs.borderTopLeftRadius + cs.borderBottomRightRadius)) bad.push('radius ' + (e.className.baseVal === undefined ? e.className : 'svg')); if (/rgb\((225, 20, 20|37, 211, 102|18, 140, 126|7, 94, 84)/.test(cs.color + cs.backgroundColor + cs.borderTopColor)) bad.push('colour ' + e.className); if (/gradient|url/.test(cs.backgroundImage)) bad.push('image ' + e.className); } const box = p.querySelector('.bk-msg__box'); const b = getComputedStyle(box); return bad.length === 0 && b.borderTopWidth === '1px' && b.borderTopColor === 'rgb(11, 11, 12)' && b.backgroundColor === 'rgb(255, 255, 255)' && p.querySelectorAll('.ui-btn--primary').length === 0; })));
  const ob = await txt(page, 'demo-owner-bubble');
  check('DEMO: the owner bubble has name, postcode and the one-line answers', ob.includes('EL-1043') && ob.includes('BT9 6QP') && ob.includes(ANSWERS_LINE), ob);
  const cb = await txt(page, 'demo-customer-bubble');
  // (The simulated customer text is core's wording (js/core/messages.js), shown only behind the data-proto demo button: "Earliest visit Daniel could offer: {when}. Daniel will confirm within 24 hours.")
  check('DEMO: the customer text names the suggested time and says Daniel will confirm a time within 24 hours; "You asked for" is nowhere in the DOM', /(Earliest visit Daniel could offer: |We've (pencilled in|suggested) )(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, /.test(cb) && /Daniel will confirm( a time)? within 24 hours\./.test(cb) && !/plan around/.test(cb) && cb.includes('EL-1043') && !/You asked for/.test(await page.evaluate(() => document.body.innerHTML)) && !/Awaiting confirmation/.test(await page.evaluate(() => document.body.innerHTML)), cb);
  check('DEMO: the owner bubble shows "Open: Job link" with the real href, and no origin or raw id', /Open: Job link/.test(ob) && !/localhost|127\.0\.0\.1|http|bk_/.test(ob) && /dashboard\.html#\/bookings\/bk_/.test((await tid(page, 'demo-owner-bubble').locator('a.bk-msg__link').first().getAttribute('href')) || ''), ob);
  check('"Open your dashboard" deep-links to the booking in the dashboard tab', /dashboard\.html(\?[^#]*)?#\/bookings\/bk_/.test(await tid(page, 'demo-open-dashboard').getAttribute('href')) && (await tid(page, 'demo-open-dashboard').getAttribute('target')) === 'vm-dashboard');
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
  check('Manage shows the status (Received, in the label voice), the SAME tagged visit idea with its one status, and the journey timeline, and no Add to calendar yet; no "pencilled" or "provisional" anywhere', /received/i.test(await txt(page, 'manage-status')) && mv.n === 1 && mv.proto && mv.status === 'We will confirm.' && !/pencil|provisional|Daniel/i.test(mv.text) && jt === 5 && (await tid(page, 'add-to-calendar').count()) === 0, JSON.stringify([jt, mv.n, mv.proto, mv.status]));
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
  check('the status (label voice) and the confirmation both say cancelled', /cancelled/i.test(await txt(page, 'manage-status')));
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
  check('with room again the photo is sent and shown as sent', await until(async () => (await tid(page, 'photos-saved-0').count()) === 1) && /added to your enquiry\./.test(await txt(page, 'photos-status')), await txt(page, 'photos-status'));
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
  check('the confirmation in clean mode is his story only: "Send your enquiry to 180 Electrical." with the WhatsApp send, the reference, Call, Done; no visit card, no idea tag, no PROTOTYPE block, no demo, no "webhook", no "Earliest visit", no "pencilled" or "provisional", and no "Daniel"', conf.includes('Send your enquiry to 180 Electrical.') && conf.includes('EL-1043') && (await shown('[data-testid="wa-send"]')) === 1 && (await shown('[data-testid="confirmation-call"]')) === 1 && (await shown('[data-testid="confirmation-done"]')) === 1 && (await shown('[data-testid="confirmation-visit"]')) === 0 && (await shown('[data-testid="idea-tag"]')) === 0 && (await shown('[data-testid="demo-toggle"]')) === 0 && (await shown('[data-testid="confirmation-proto"]')) === 0 && (await shown('[data-testid="wa-send-note"]')) === 0 && !/Earliest visit|Idea from us|pencil|provisional|prototype|webhook|Daniel/i.test(conf), conf.slice(0, 200));
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
    await tid(page, 'coverage-book').click(); // ONE press: the verdict shows and the funnel opens with the postcode (LANDING-V5 5.9)
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
  await ctx.addInitScript(() => { try { localStorage.setItem('vm_theme_public', 'light'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body')).backgroundColor);
  check('the sheet is light (paper body under the black bar) in the light theme', lum(bg) > 0.8, bg);
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
      await ctx.addInitScript((s) => { try { localStorage.setItem('vm_theme_public', s); } catch (e) { /* ignore */ } }, scheme);
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
  await section('5c. axe (wcag2a, wcag2aa, wcag21a, wcag21aa and best-practice): no violation of any impact on the landing page at 375 and 1280, light and dark, with ideas and with only my content (LANDING-V5 9.9)', async () => {
    for (const [vp, label] of [[MOBILE, '375'], [DESKTOP, '1280']]) {
      for (const scheme of ['light', 'dark']) {
        for (const ideas of ['with ideas', 'only my content']) {
          const ctx = await newContext(vp, 'light');
          await ctx.addInitScript(([t, c]) => { try { localStorage.setItem('vm_theme_public', t); localStorage.setItem('ec_clean', c); } catch (e) { /* ignore */ } }, [scheme, ideas === 'with ideas' ? '0' : '1']);
          const page = await ctx.newPage();
          await site(page);
          await tid(page, 'hero-cta').waitFor({ timeout: WAIT });
          await tid(page, 'footer').waitFor({ timeout: WAIT });
          await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } window.scrollTo(0, 0); });
          await page.waitForTimeout(800);
          const r = await axeSeriousCount(page, null, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'], ['minor', 'moderate', 'serious', 'critical']);
          check(`${label} ${scheme}, ${ideas}: the landing page`, r.count === 0, r.detail);
          await ctx.close();
        }
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
  check('B: the enquiry is EL-1043; until Daniel confirms there is no status pill, the visit card says "We will confirm." (no Add to calendar yet)', ref === 'EL-1043' && (await tid(B, 'confirmation-status').count()) === 0 && (await txt(B, 'confirmation-pencilled')) === 'We will confirm.' && (await tid(B, 'add-to-calendar').count()) === 0, ref);
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
  check('B: it is now his real appointment: no idea tag, no data-proto (it stays under "Only my content"), a solid ink rule (not dashed), and it moved ABOVE the reference block; ONE status, so no separate pill; the owner has the enquiry, so the page now says "Thanks, your enquiry has been received."', (await tid(B, 'confirmation-visit').getAttribute('data-proto')) === null && (await tid(B, 'confirmation-visit').locator('[data-testid="idea-tag"]').count()) === 0 && (await tid(B, 'confirmation-status').count()) === 0 && (await txt(B, 'confirmation-title')) === COPY.confirm.title && await B.evaluate(() => { const v = document.querySelector('[data-testid="confirmation-visit"]').getBoundingClientRect(); const w = document.querySelector('[data-testid="confirmation-ticket"]').getBoundingClientRect(); return v.top < w.top; }), await txt(B, 'confirmation-pencilled'));
  check('B: Add to calendar appears only now that Daniel has confirmed, and its note says it is saved as confirmed', !!(await until(async () => (await tid(B, 'add-to-calendar').count()) === 1 && /saved as confirmed/i.test(await txt(B, 'add-to-calendar-note')))), `${await tid(B, 'add-to-calendar').count()} | ${await txt(B, 'add-to-calendar-note')}`);
  check('B: the kicker reads "Your visit" and the one status is ink with the tick glyph', /^Your visit$/i.test(await txt(B, 'confirmation-visit-kicker')) && (await B.evaluate(() => { const e = document.querySelector('.bk-visit__status.is-ok'); return !!e && !!e.querySelector('svg'); })));
  check('B: the timeline ticks off the contact and survey steps', (await tid(B, 'journey-contact').getAttribute('class')).includes('is-done') && (await tid(B, 'journey-survey').getAttribute('class')).includes('is-done') === false);
  check('B: the confirmation text appeared in the DEMO panel', !!(await until(async () => /then, when you confirmed/i.test(await txt(B, 'demo-panel')), 8000)));
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
