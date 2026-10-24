// tests/e2e/handoff-f4.mjs: the cross-device loop from both ends, in REAL headless Chromium with two (or more) SEPARATE browser contexts that share no storage:
// the customer's phone (the funnel confirmation and its "Send my enquiry on WhatsApp" button) and Daniel's phone (the dashboard Import screen).
// The wa.me link is READ from the page and never followed (requests to wa.me are aborted); the dashboard link inside it is then opened in Daniel's context.
// Covers: the card, the link, the import screen for enquiries / accepted / declined quotes, idempotency, two customers with the same ref, the quote not on this
// phone, a changed total, undo, hostile and damaged payloads, the paste fallback, #import= while the app is open, layout at 320/375/1280 in both themes, axe,
// reduced motion, and the source rules (no Date.now, new Date, innerHTML, eval, hex colours in the new CSS).
// Owner: F4. Self-contained: starts its own static server unless BASE_URL is set.
//
//   node tests/e2e/handoff-f4.mjs
//   BASE_URL=http://127.0.0.1:4178 node tests/e2e/handoff-f4.mjs
//   QA_DEPS_DIR=/path/with/node_modules node tests/e2e/handoff-f4.mjs   (must contain playwright-core; axe-core is used when present)
//   CHROMIUM_PATH=/path/to/chrome   SHOTS_DIR=/some/dir (optional screenshots)   ONLY=3 (runs the sections whose name starts with 3)
//
// Exits 0 when every check passes, 1 otherwise. The clock is frozen with ?now=2026-10-23T20:30&freeze=1 (a Friday evening).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/claude-0/-home-user-LG-Proto1/9b0bf8bc-80f0-53ab-a3b8-7d955fff3e2a/scratchpad/qa-deps';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SHOTS = process.env.SHOTS_DIR || '';
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLOCK = 'now=2026-10-23T20:30&freeze=1';
const NOW = '2026-10-23T20:30';
const require = createRequire(QA_DEPS.endsWith('/') ? QA_DEPS : QA_DEPS + '/');
const { chromium } = require('playwright-core');
let AXE_SOURCE = '';
try { AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { AXE_SOURCE = ''; }

// ---------------------------------------------------------------- harness
let failures = 0;
let passes = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT = 9000;
async function until(fn, ms = WAIT, step = 80) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* page busy or navigating: try again */ }
    await sleep(step);
  }
  return false;
}
async function section(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  console.log('\n# ' + name);
  try { await fn(); } catch (e) { failures += 1; console.log('  FAIL ' + name + ' threw: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// ---------------------------------------------------------------- server and browser
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
  const up = await until(async () => { const r = await fetch(base + '/dashboard.html').catch(() => null); return r && r.ok; }, 10000, 150);
  if (!up) throw new Error('static server did not start');
  return base;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const BASE = await startServer();
const ORIGIN = new URL(BASE).origin;
const PHONE = { width: 375, height: 812 };
const SMALL = { width: 320, height: 568 };
const DESKTOP = { width: 1280, height: 800 };
const IMG_HOSTS = new Set(['perspective.imgix.net', 'images.unsplash.com']);
const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#2a2b2f"/><circle cx="400" cy="300" r="90" fill="#3a3b40"/></svg>';
const isPhoto404 = (u) => /\/img\/180\//.test(u);
const waRequests = [];

/** A fresh browser context = one person's phone: its own localStorage, nothing shared. Requests to wa.me are recorded and aborted (the link is read, never followed). */
async function newContext(vp, { scheme = 'dark', theme = '', reducedMotion = '' } = {}) {
  const ctx = await browser.newContext({
    viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: scheme, isMobile: vp.width < 600, hasTouch: vp.width < 600,
    ...(reducedMotion ? { reducedMotion } : {})
  });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* blocked */ } }, theme);
  await ctx.route((u) => IMG_HOSTS.has(u.hostname), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
  await ctx.route((u) => u.hostname === 'wa.me', (route) => { waRequests.push(route.request().url()); return route.abort(); });
  return ctx;
}

/** Everything that should stay empty: console errors and warnings, page errors, off-site requests (except his photos) and failed requests (except the aborted wa.me ones). */
function watch(page) {
  const log = { errors: [], offsite: [], failed: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/Failed to load resource/.test(m.text()) && m.location && (isPhoto404(m.location().url || '') || /wa\.me/.test(m.location().url || ''))) return;
    log.errors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    const url = new URL(u);
    if (url.origin === ORIGIN || url.hostname === 'wa.me') return;
    if (IMG_HOSTS.has(url.hostname) && r.resourceType() === 'image') return;
    log.offsite.push(u);
  });
  page.on('requestfailed', (r) => { if (!isPhoto404(r.url()) && !/wa\.me/.test(r.url())) log.failed.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400 && !isPhoto404(r.url())) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}
const clean = (log) => log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0;
const dump = (log) => [...log.errors, ...log.offsite, ...log.failed].join(' | ');
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const txt = async (page, id) => (await tid(page, id).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const attr = (page, id, name) => tid(page, id).first().getAttribute(name).catch(() => null);
const shot = async (page, name, full = false) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); } };
const dash = (page, hash = '#/today') => page.goto(`${BASE}/dashboard.html?${CLOCK}${hash}`, { waitUntil: 'load' });
const hashOf = (page) => page.evaluate(() => location.hash);
const stateOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('vm_state_v1')));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const viewState = (page) => attr(page, 'f4-view', 'data-state');
/** Resolves true once the Import screen is up in the given data-state. */
const inState = (page, st) => until(async () => (await viewState(page)) === st);
/** Open the dashboard on an import link (the form WhatsApp texts: #import=<payload>) and wait for the screen. */
async function openImport(page, hash) {
  await dash(page, hash);
  await tid(page, 'f4-view').waitFor({ timeout: WAIT });
}
const hashPart = (link) => link.slice(link.indexOf('dashboard.html') + 'dashboard.html'.length);

/** Run axe on part of the page; the serious and critical violations (nothing when axe-core is not installed). */
async function axeSerious(page, context) {
  if (!AXE_SOURCE) return { count: 0, detail: 'axe-core not installed' };
  await page.evaluate(AXE_SOURCE);
  const res = await page.evaluate(async (ctxSel) => {
    const out = await window.axe.run(ctxSel ? { include: [ctxSel] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return out.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`);
  }, context || null);
  return { count: res.length, detail: res.join(' | ') };
}

/** Layout facts for the Import screen as it is now: overflow, every control inside it at least 44px, and whether the decision bar is on screen. */
async function layoutFacts(page) {
  await sleep(450); // the screen rises in over 260ms: measure it where it comes to rest
  return page.evaluate(() => {
    const root = document.documentElement;
    const view = document.querySelector('[data-testid="f4-view"]');
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const controls = view ? [...view.querySelectorAll('a[href], button, textarea, input, select, summary')].filter(visible) : [];
    const small = controls.map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.height < 43.5 || r.width < 43.5)
      .map(({ el, r }) => `${el.getAttribute('data-testid') || el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
    const bar = document.querySelector('[data-testid="f4-bar"]');
    const br = bar ? bar.getBoundingClientRect() : null;
    const wide = view ? [...view.querySelectorAll('*')].filter((el) => { const r = el.getBoundingClientRect(); return r.right > root.clientWidth + 1 && visible(el); }).slice(0, 3).map((el) => el.getAttribute('data-testid') || el.className || el.tagName) : [];
    return {
      overflow: root.scrollWidth > root.clientWidth, small, wide,
      bar: br ? { onScreen: br.bottom <= window.innerHeight + 1 && br.top >= 0, bottom: Math.round(br.bottom), vh: window.innerHeight } : null
    };
  });
}

// ---------------------------------------------------------------- the customer's phone
/** Walk the funnel on a customer's phone and submit; resolves the confirmation, the real wa.me link read from it, the text inside it and the dashboard link in that text. */
async function customerEnquiry({ name, phone, email, postcode = 'BT9 6QP', note = '', optIn = false, vp = PHONE, scheme = 'dark', theme = '' }) {
  const ctx = await newContext(vp, { scheme, theme });
  const page = await ctx.newPage();
  const log = watch(page);
  await page.goto(`${BASE}/index.html?${CLOCK}#book`, { waitUntil: 'load' });
  await tid(page, 'funnel-postcode').fill(postcode);
  await tid(page, 'funnel-continue').click();
  const steps = [['parking', 'driveway', 'vehicle'], ['vehicle', 'ordered', 'timing'], ['timing', 'asap', 'permission'], ['permission', 'yes', null]];
  for (const [key, value, next] of steps) {
    await tid(page, `funnel-option-${key}-${value}`).waitFor({ timeout: WAIT });
    await tid(page, `funnel-option-${key}-${value}`).click();
    if (next) await tid(page, `funnel-option-${next}-${next === 'vehicle' ? 'ordered' : next === 'timing' ? 'asap' : 'yes'}`).waitFor({ timeout: WAIT });
  }
  await tid(page, 'field-name').waitFor({ timeout: WAIT });
  await tid(page, 'field-name').fill(name);
  await tid(page, 'field-phone').fill(phone);
  await tid(page, 'funnel-email').fill(email);
  if (note) await tid(page, 'field-note').fill(note);
  if (optIn) await tid(page, 'funnel-optin').check({ force: true });
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
  await tid(page, 'wa-send-card').waitFor({ timeout: WAIT });
  const href = await tid(page, 'wa-send').getAttribute('href');
  const text = decodeURIComponent(href.split('?text=')[1] || '');
  const link = text.trim().split('\n').pop().trim();
  const ref = (await txt(page, 'confirmation-ref')).trim();
  return { ctx, page, log, href, text, link, ref };
}

/** Make a quote for a booking and send it, inside Daniel's page (the store, exactly what his buttons call). Resolves { id, link, portable, total }. */
function makeAndSendQuote(page, bookingId) {
  return page.evaluate(async (id) => {
    const s = await import('/js/core/store.js');
    const q = await import('/js/core/selectors.js');
    const made = s.createQuote({ bookingId: id });
    if (!made.ok) return { error: 'create ' + made.reason };
    const sent = s.sendQuote(made.quote.id, { via: 'whatsapp' });
    if (!sent.ok) return { error: 'send ' + sent.reason };
    return { id: made.quote.id, link: sent.link, portable: sent.linkPortable, total: q.quoteTotal(sent.quote) };
  }, bookingId);
}
/** On the customer's phone: read the quote link and build the acceptance (or decline) message the way the quote page does. Resolves { ok, link, url, text }. */
function customerReply(page, quoteLink, kind, details) {
  return page.evaluate(async ({ quoteLink, kind, details }) => {
    const h = await import('/js/core/handoff.js');
    const m = await import('/js/core/messages.js');
    const s = await import('/js/core/store.js');
    const parsed = h.parseQuoteLink(quoteLink);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const out = kind === 'acc' ? m.acceptanceHandoff({ quote: parsed.data, ...details }, s.getState()) : m.declineHandoff({ quote: parsed.data, ...details }, s.getState());
    return { ok: out.ok, link: out.link, url: out.url, text: out.text };
  }, { quoteLink, kind, details });
}
/** In any page: a payload object with a valid checksum, as the encoded string. */
const encodeIn = (page, obj) => page.evaluate(async (o) => (await import('/js/core/handoff.js')).encodePayload(o), obj);

// ================================================================ 1. the customer's phone: the WhatsApp card on the confirmation
let A = null; // Aoife, the first customer (kept for the later sections)
await section('1. customer phone: the WhatsApp send card and the real wa.me link', async () => {
  A = await customerEnquiry({
    name: 'Aoife Ní Bhriain', phone: '07700 900231', email: 'aoife@example.com',
    note: 'Charger by the side gate, <b>please</b> call after 5. Ceart go leor! éü'
  });
  const { page } = A;
  check('the confirmation shows the WhatsApp send card', (await tid(page, 'wa-send-card').count()) === 1 && (await attr(page, 'wa-send-card', 'data-state')) === 'ready');
  check('the primary button reads "Send my enquiry on WhatsApp", under the headline "Send your enquiry to 180 Electrical." (no thank-you before the tap)', (await txt(page, 'wa-send')) === 'Send my enquiry on WhatsApp' && (await txt(page, 'confirmation-title')) === 'Send your enquiry to 180 Electrical.' && (await tid(page, 'confirmation-lead').count()) === 0, await txt(page, 'wa-send') + ' | ' + await txt(page, 'confirmation-title'));
  check('the button is a real https://wa.me/447885496800 link with the message in ?text=', A.href.startsWith('https://wa.me/447885496800?text='), A.href.slice(0, 80));
  check('it opens in a new tab without giving the tab access to this page', (await attr(page, 'wa-send', 'target')) === '_blank' && /noopener/.test((await attr(page, 'wa-send', 'rel')) || ''));
  check('the text says who, the ref, mobile, email, postcode, the five answers and the note in plain words',
    /^Hi Daniel, it's Aoife Ní Bhriain\./.test(A.text) && /Ref: EL-\d+/.test(A.text) && A.text.includes('Mobile: 07700 900231') && A.text.includes('Email: aoife@example.com') && A.text.includes('Postcode: BT9 6QP')
    && A.text.includes('Parking: Private driveway') && A.text.includes('Timing: As soon as possible') && A.text.includes('Permission to install: Yes') && A.text.includes('Anything else: Charger by the side gate'), A.text);
  check('the dashboard import link is on its own LAST line and carries the data in the fragment', A.link.startsWith(`${BASE}/dashboard.html#import=`) && A.link.length > 400 && A.link.length < 1100 && !/\s/.test(A.link), String(A.link.length));
  check('the one-line note lives in the dashed PROTOTYPE block, is data-proto (the live site does this through the webhook), and the card itself stays clean; the button is not data-proto, so it works in a clean preview',
    (await attr(page, 'wa-send-note', 'data-proto')) !== null && (await attr(page, 'wa-send', 'data-proto')) === null && (await attr(page, 'wa-send-card', 'data-proto')) === null
    && (await txt(page, 'wa-send-note')) === "In your live site this happens automatically through your funnel's webhook.", await txt(page, 'wa-send-note'));
  const box = await tid(page, 'wa-send').boundingBox();
  check('the button is at least 44px tall and sits inside the 375px screen', box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 375, JSON.stringify(box));
  check('the page has no horizontal scroll', await noOverflow(page));
  const filled = await page.evaluate(() => [...document.querySelectorAll('[data-testid="confirmation"] .ui-btn--primary')].filter((b) => { const cs = getComputedStyle(b); return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor === getComputedStyle(document.querySelector('[data-testid="wa-send"]')).backgroundColor; }).map((b) => b.getAttribute('data-testid')));
  check('the WhatsApp send is the confirmation\'s one FILLED button (the photo prompt below is drawn as an outline)', filled.length === 1 && filled[0] === 'wa-send', filled.join(','));
  await shot(page, 'f4-1-card-375');
  const demo = await tid(page, 'demo-toggle').count();
  if (demo) { await tid(page, 'demo-toggle').click(); await tid(page, 'demo-panel').waitFor({ timeout: WAIT }); }
  const sub = await page.locator('.bk-demo__sub').first().innerText().catch(() => '');
  check('the DEMO panel does not contradict the card: it no longer says nothing was sent', demo === 1 && !/Nothing was really sent/.test(sub) && /only gets the enquiry when the customer sends the WhatsApp message/.test(sub), sub);
  const [popup] = await Promise.all([A.ctx.waitForEvent('page', { timeout: WAIT }), tid(page, 'wa-send').click()]);
  await popup.close().catch(() => {});
  check('tapping it opens WhatsApp in a new tab (the request to wa.me is aborted here, never followed)', waRequests.some((u) => u.startsWith('https://wa.me/447885496800?text=')), String(waRequests.length));
  check('the card then says "Opened in WhatsApp", with a calm "Open WhatsApp again" and never claims it was delivered',
    (await until(async () => (await attr(page, 'wa-send-card', 'data-state')) === 'opened')) && ((await tid(page, 'wa-send-title').textContent()) || '').trim() === 'Opened in WhatsApp' && (await txt(page, 'confirmation-title')) === 'Thanks, your enquiry has been received.' && (await txt(page, 'wa-send-again')) === 'Open WhatsApp again' && !/delivered|has been sent/i.test(await txt(page, 'wa-send-text')), await txt(page, 'wa-send-text'));
  check('the opened link is the same address', (await attr(page, 'wa-send-again', 'href')) === A.href);
  const remembered = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vm_handoff_v1')); } catch (e) { return null; } });
  check('this browser remembers that it opened WhatsApp for the ref (vm_handoff_v1)', remembered && remembered.items && Object.keys(remembered.items).some((k) => k.startsWith('enq:EL-')), JSON.stringify(remembered));
  await page.reload({ waitUntil: 'load' });
  await tid(page, 'wa-send-card').waitFor({ timeout: WAIT });
  check('after a reload the card still says opened (and the enquiry is still saved on the customer\'s own phone)', (await attr(page, 'wa-send-card', 'data-state')) === 'opened' && (await stateOf(page)).bookings.some((b) => b.ref === A.ref && b.serviceId === 'ev_quote'));
  check('no console errors on the customer phone', clean(A.log), dump(A.log));
});

// ================================================================ 2. Daniel's phone: the import screen and Add to my dashboard
let D = null;       // Daniel's context (kept for the later sections)
let aoifeId = '';   // the booking id of Aoife's enquiry in Daniel's store
await section('2. Daniel phone: #import= opens the Import screen, shows everything, adds exactly once', async () => {
  D = await newContext(PHONE);
  const page = await D.newPage();
  D.log = watch(page);
  D.page = page;
  await openImport(page, hashPart(A.link));
  check('a fresh browser on dashboard.html#import=... lands on the Import screen (the hash became #/import?d=)', /^#\/import\?d=/.test(await hashOf(page)), (await hashOf(page)).slice(0, 30));
  check('the screen is the ready state for an enquiry', await inState(page, 'ready') && (await attr(page, 'f4-view', 'data-kind')) === 'enq');
  check('the title says who sent an enquiry', /Aoife Ní Bhriain sent an enquiry/.test(await txt(page, 'view-title')), await txt(page, 'view-title'));
  check('it shows the name, ref and when it was sent', (await txt(page, 'f4-name')) === 'Aoife Ní Bhriain' && /^EL-\d+$/.test(await txt(page, 'f4-ref')) && /Sent Fri 23 Oct, 20:30/.test(await txt(page, 'f4-sent')), await txt(page, 'f4-sent'));
  check('"Received via WhatsApp link" is there', (await txt(page, 'f4-received-tag')) === 'Received via WhatsApp link');
  check('the mobile is shown with Call (tel:) and WhatsApp (wa.me to the CUSTOMER) buttons', (await txt(page, 'f4-phone')) === '07700 900231' && (await attr(page, 'f4-call', 'href')) === 'tel:+447700900231' && /^https:\/\/wa\.me\/447700900231\?text=/.test((await attr(page, 'f4-whatsapp', 'href')) || ''));
  check('the email is a mailto link', (await attr(page, 'f4-email', 'href') || '').startsWith('mailto:aoife@example.com'));
  const answers = await txt(page, 'f4-answers');
  check('all five answers are there in his wording (postcode, parking, car, timing, permission)', /Postcode BT9 6QP/.test(answers) && /Parking Private driveway/.test(answers) && /Car It's ordered or arriving soon/.test(answers) && /Timing As soon as possible/.test(answers) && /Permission Yes/.test(answers), answers);
  check('a BT postcode has no "Outside Northern Ireland" tag', (await tid(page, 'f4-outside').count()) === 0);
  const notes = await txt(page, 'f4-notes');
  check('the note arrives as plain text: the tags are gone, the words and accents are kept, nothing is rendered as HTML', /Charger by the side gate, please call after 5\. Ceart go leor! éü/.test(notes) && (await tid(page, 'f4-notes').locator('b').count()) === 0, notes);
  check('it says what adding does and that nothing happens until the tap', (await txt(page, 'f4-does')).includes('pencilled into the next free slot') && /Nothing is added until you tap/.test(await txt(page, 'f4-reassure')));
  check('the provenance line is honest and tagged data-proto', (await attr(page, 'f4-how', 'data-proto')) !== null && /inside the WhatsApp link itself/.test(await txt(page, 'f4-how')) && /webhook and a database/.test(await txt(page, 'f4-how')));
  const before = await stateOf(page);
  check('NOTHING was added just by opening the link', !before.bookings.some((b) => b.importId));
  check('Add to my dashboard and Not now are in the decision bar', (await txt(page, 'f4-add')) === 'Add to my dashboard' && (await txt(page, 'f4-not-now')) === 'Not now');
  await shot(page, 'f4-2-enquiry-ready-375');
  await tid(page, 'f4-add').click();
  check('the success state appears', await inState(page, 'success') && (await tid(page, 'f4-success').count()) === 1 && (await txt(page, 'f4-success-title')) === 'Added to your dashboard', await viewState(page));
  check('success focus moves to its heading', await until(async () => (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'))) === 'f4-success-title'));
  check('it names the pencilled survey slot and the reply clock', /pencilled in/.test(await txt(page, 'f4-success-slot')) && /Reply due in/.test(await txt(page, 'f4-success-sla')), await txt(page, 'f4-success-slot') + ' | ' + await txt(page, 'f4-success-sla'));
  await shot(page, 'f4-2-enquiry-success-375');
  const after = await stateOf(page);
  const added = after.bookings.filter((b) => b.importId);
  check('exactly one booking was added', added.length === 1 && after.bookings.length === before.bookings.length + 1);
  const b = added[0] || {};
  aoifeId = b.id;
  check('it is a website quote enquiry, new, with the customer\'s details exactly (unicode kept)', b.serviceId === 'ev_quote' && b.source === 'website' && b.status === 'new' && b.customer && b.customer.name === 'Aoife Ní Bhriain' && b.customer.phone === '07700 900231' && b.customer.email === 'aoife@example.com' && b.address.postcode === 'BT9 6QP', JSON.stringify(b.customer));
  check('it keeps the customer\'s own ref and their answers', /^EL-\d+$/.test(b.ref) && b.ref === A.ref && b.answers && b.answers.parking === 'driveway' && b.answers.vehicle === 'ordered' && b.answers.timing === 'asap' && b.answers.permission === 'yes', b.ref + ' vs ' + A.ref);
  check('the reply clock starts when the CUSTOMER sent it, and the survey slot is pencilled in from HIS diary', b.createdAt === NOW && b.tentative === true && b.durationMin > 0 && b.seenByOwner === false, `${b.createdAt} ${b.tentative} ${b.durationMin}`);
  check('the note is stored clean (no tags)', /Charger by the side gate, please call after 5/.test(b.notes) && !/[<>]/.test(b.notes), b.notes);
  check('the history says it came from a WhatsApp link, and the simulated owner alert was logged', (b.history || []).some((h) => /Added from a WhatsApp link/.test(h.note || '')) && after.messages.some((m) => m.bookingId === b.id && m.kind === 'owner_new_booking'));
  await tid(page, 'f4-open').click();
  check('"Open the enquiry" opens that booking on his dashboard', await until(async () => (await hashOf(page)) === `#/bookings/${aoifeId}`) && !!(await until(async () => /Aoife Ní Bhriain/.test(await tid(page, 'view-title').first().innerText().catch(() => '')) || /Aoife Ní Bhriain/.test(await page.locator('main').innerText()))));
});

// ================================================================ 3. idempotency, and two customers who both sent EL-1043
let B = null;       // the second customer (same ref on their own phone)
let bobId = '';     // her booking id in Daniel's store
await section('3. idempotent: the same link twice never duplicates; two phones with the same ref are both kept', async () => {
  const page = D.page;
  const n0 = (await stateOf(page)).bookings.length;
  await openImport(page, hashPart(A.link));
  check('the same link again says "Already in your dashboard" and offers no add button', await inState(page, 'done') && (await txt(page, 'f4-existing')).includes('Already in your dashboard') && (await tid(page, 'f4-add').count()) === 0, await viewState(page));
  check('"Open the enquiry" leads to the booking made earlier', (await attr(page, 'f4-existing-open', 'href')) === `#/bookings/${aoifeId}`);
  const second = await D.newPage();
  const log2 = watch(second);
  await openImport(second, hashPart(A.link));
  check('the same link in a second tab of the same browser is also "done"', await inState(second, 'done'));
  check('nothing was duplicated (still one booking for Aoife)', (await stateOf(page)).bookings.length === n0 && (await stateOf(page)).bookings.filter((x) => x.importId).length === 1);
  const twice = await page.evaluate(async (link) => {
    const s = await import('/js/core/store.js');
    const one = s.importHandoff(link);
    const two = s.importHandoff(link);
    return { one: one.ok && one.existed === true, two: two.ok && two.existed === true && one.bookingId === two.bookingId };
  }, A.link);
  check('the store API is idempotent too: importHandoff twice returns existed:true with the same bookingId', twice.one && twice.two, JSON.stringify(twice));
  await second.close();
  check('no console errors on Daniel\'s second tab', clean(log2), dump(log2));

  B = await customerEnquiry({ name: 'Bronagh Quinn', phone: '07700 900777', email: 'bronagh@example.com', postcode: 'BT7 3AB', note: '', optIn: true });
  check('a second customer on a different phone also got the ref ' + A.ref + ' (every browser numbers from EL-1043)', B.ref === A.ref, B.ref + ' vs ' + A.ref);
  await openImport(page, hashPart(B.link));
  check('Daniel sees HER enquiry as new (not "already added"), with her opt-in and no note', await inState(page, 'ready') && (await txt(page, 'f4-name')) === 'Bronagh Quinn' && /Happy to receive/.test(await txt(page, 'f4-optin')) && (await tid(page, 'f4-notes-none').count()) === 1);
  await tid(page, 'f4-add').click();
  check('adding her works', await inState(page, 'success'));
  const s = await stateOf(page);
  const imported = s.bookings.filter((x) => x.importId);
  const bob = imported.find((x) => x.customer.name === 'Bronagh Quinn') || {};
  bobId = bob.id;
  check('both customers are now in his store, with different refs', imported.length === 2 && imported[0].ref !== imported[1].ref, imported.map((x) => x.ref).join(' / '));
  check('no console errors on Daniel\'s phone so far', clean(D.log), dump(D.log));
  check('no console errors on the second customer phone', clean(B.log), dump(B.log));
});

// ================================================================ 4. the quote loop: sent by Daniel, accepted and declined from the customer phones
let accLink = '';
await section('4. quote loop: accepted, declined, undo, not on this phone, changed total, a quote link by mistake', async () => {
  const page = D.page;
  // Daniel builds and sends a quote for Aoife; her phone (which has no copy of it) builds the acceptance from the link alone.
  await dash(page, '#/today');
  const q = await makeAndSendQuote(page, aoifeId);
  check('Daniel\'s sent quote link is the self-contained quote.html#d= link', !q.error && q.portable === true && q.link.startsWith(`${BASE}/quote.html#d=`), JSON.stringify(q).slice(0, 200));
  const acc = await customerReply(A.page, q.link, 'acc', { days: ['thu', 'fri'], part: 'am', note: 'Side gate code is 1943' });
  accLink = acc.link;
  check('Aoife\'s phone builds a wa.me acceptance to Daniel with a dashboard link on the last line', acc.ok && acc.url.startsWith('https://wa.me/447885496800?text=') && acc.text.includes(`quote ${q.id}`) && acc.text.includes('Thu or Fri mornings') && acc.text.trim().split('\n').pop() === acc.link, acc.text);
  await openImport(page, hashPart(acc.link));
  check('Daniel sees the acceptance: "Aoife accepted quote ' + q.id + ' (' + '£' + q.total.toLocaleString('en-GB') + '), prefers Thu/Fri mornings"',
    await inState(page, 'ready') && (await attr(page, 'f4-view', 'data-kind')) === 'acc' && (await txt(page, 'f4-summary')) === `Aoife accepted quote ${q.id} (£${q.total.toLocaleString('en-GB')}), prefers Thu/Fri mornings`, await txt(page, 'f4-summary'));
  check('the days that suit, the time of day, the note and the total are all shown', (await txt(page, 'f4-days')).includes('Thu') && (await txt(page, 'f4-days')).includes('Fri') && (await txt(page, 'f4-days')).includes('Morning') && (await txt(page, 'f4-decision-note')) === 'Side gate code is 1943' && (await txt(page, 'f4-accepted-total')) === `£${q.total.toLocaleString('en-GB')}`);
  check('the one action reads "Mark quote accepted and plan the install"', (await txt(page, 'f4-add')) === 'Mark quote accepted and plan the install', await txt(page, 'f4-add'));
  check('opening the link changed nothing yet', (await stateOf(page)).quotes[q.id].status === 'sent');
  await shot(page, 'f4-4-accept-ready-375');
  await tid(page, 'f4-add').click();
  check('accepting shows "Quote accepted" with a plan-the-install action', await inState(page, 'success') && (await txt(page, 'f4-success-title')) === 'Quote accepted' && (await txt(page, 'f4-open')) === 'Plan the install day');
  await shot(page, 'f4-4-accept-success-375');
  const s = await stateOf(page);
  const quote = s.quotes[q.id];
  const install = s.bookings.find((x) => x.id === quote.installBookingId) || {};
  check('the quote is accepted (via WhatsApp) and an UNSCHEDULED install job exists with the preferences in its notes', quote.status === 'accepted' && quote.acceptedVia === 'whatsapp' && install.serviceId === 'ev' && install.status === 'new' && install.quoteId === q.id && install.durationMin === 0 && install.tentative !== true
    && /Thu or Fri mornings/.test(install.notes) && /Side gate code is 1943/.test(install.notes), JSON.stringify({ st: quote.status, via: quote.acceptedVia, n: install.notes, d: install.durationMin }));
  await tid(page, 'f4-open').click();
  check('"Plan the install day" opens the install job', await until(async () => (await hashOf(page)) === `#/bookings/${install.id}`));
  await dash(page, '#/pipeline?s=accepted');
  check('the pipeline shows it under Accepted, with the "Confirm the install day" action', !!(await until(async () => /Aoife N\u00ed Bhriain/.test(await txt(page, 'p1-panel')))) && /Aoife N\u00ed Bhriain[^]*Confirm the install day/.test(await txt(page, 'p1-panel')), await txt(page, 'p1-panel'));
  await shot(page, 'f4-4-pipeline-accepted-375');
  await openImport(page, hashPart(acc.link));
  check('the same acceptance again is "Already in your dashboard" (and offers the install)', await inState(page, 'done') && (await txt(page, 'f4-existing')).includes('Already in your dashboard') && (await attr(page, 'f4-existing-open', 'href')) === `#/bookings/${install.id}`);

  // Decline, from Bronagh's phone, with undo.
  await dash(page, '#/today');
  const q2 = await makeAndSendQuote(page, bobId);
  const dec = await customerReply(B.page, q2.link, 'dec', { reason: 'price', note: 'A bit over budget' });
  check('Bronagh\'s phone builds a decline with the reason', dec.ok && /Too expensive/.test(dec.text) && dec.text.trim().split('\n').pop() === dec.link, dec.text);
  await openImport(page, hashPart(dec.link));
  check('Daniel sees "Bronagh declined quote ' + q2.id + ' (Too expensive)" and "Mark quote declined"', await inState(page, 'ready') && (await txt(page, 'f4-summary')) === `Bronagh declined quote ${q2.id} (Too expensive)` && (await txt(page, 'f4-add')) === 'Mark quote declined' && (await txt(page, 'f4-reason')) === 'Too expensive' && (await txt(page, 'f4-decision-note')) === 'A bit over budget');
  await tid(page, 'f4-add').click();
  check('declining shows "Quote marked declined"', await inState(page, 'success') && (await txt(page, 'f4-success-title')) === 'Quote marked declined');
  const s2 = await stateOf(page);
  check('the quote is declined via WhatsApp with the reason', s2.quotes[q2.id].status === 'declined' && s2.quotes[q2.id].declinedVia === 'whatsapp' && /^Too expensive/.test(s2.quotes[q2.id].declineReason), s2.quotes[q2.id].declineReason);
  await tid(page, 'f4-undo').click();
  check('Undo takes it back: the screen is ready again and the quote is sent again', await inState(page, 'ready') && (await stateOf(page)).quotes[q2.id].status === 'sent', await viewState(page));
  await tid(page, 'f4-add').click();
  check('and it can be applied again', await inState(page, 'success') && (await stateOf(page)).quotes[q2.id].status === 'declined');

  // A quote that is not on this phone.
  const bogus = await page.evaluate(async () => {
    const s = await import('/js/core/store.js');
    const h = await import('/js/core/handoff.js');
    const base = Object.values(s.getState().quotes).find((x) => x.status === 'sent');
    return h.dashboardImportLink(h.buildAcceptancePayload({ quote: { ...base, id: 'Q-EL-9999', customerName: 'Sinead Walsh' }, days: ['mon'], part: 'any' }));
  });
  await openImport(page, hashPart(bogus));
  check('a quote that is not on this phone: a calm explanation, the summary still shown, and no add button', await inState(page, 'blocked') && (await attr(page, 'f4-blocked', 'data-reason')) === 'quote_not_found' && /This quote isn't on this phone/.test(await txt(page, 'f4-blocked')) && /Open the link on the phone where you made the quote/.test(await txt(page, 'f4-blocked'))
    && /Sinead accepted quote Q-EL-9999/.test(await txt(page, 'f4-summary')) && (await tid(page, 'f4-add').count()) === 0 && (await tid(page, 'f4-today').count()) === 1, await txt(page, 'f4-blocked'));
  await shot(page, 'f4-4-not-on-this-phone-375');

  // The owner changed a sent quote after the customer opened it: the total no longer matches.
  const stale = await page.evaluate(async () => {
    const s = await import('/js/core/store.js');
    const h = await import('/js/core/handoff.js');
    const base = Object.values(s.getState().quotes).find((x) => x.status === 'sent' && x.seed);
    const grown = { ...base, lines: [...base.lines, { id: 'ln_x', label: 'Extra', detail: '', qty: 1, unitPrice: 100 }] };
    return { id: base.id, link: h.dashboardImportLink(h.buildAcceptancePayload({ quote: grown, days: ['tue'], part: 'pm' })) };
  });
  await openImport(page, hashPart(stale.link));
  check('a changed total is NOT applied silently: it says so, shows both totals, and needs a deliberate "Accept anyway"', await inState(page, 'blocked') && (await attr(page, 'f4-blocked', 'data-reason')) === 'total_changed' && (await tid(page, 'f4-force').count()) === 1 && (await tid(page, 'f4-add').count()) === 0 && /the quote now says/.test(await txt(page, 'f4-decision-card')), await txt(page, 'f4-blocked'));
  check('nothing changed before that tap', (await stateOf(page)).quotes[stale.id].status === 'sent');
  await tid(page, 'f4-force').click();
  check('"Accept anyway" applies it', await inState(page, 'success') && (await stateOf(page)).quotes[stale.id].status === 'accepted');

  // Replies that cannot apply, each with its own plain sentence and a way to the quote.
  const odd = await page.evaluate(async (id) => {
    const s = await import('/js/core/store.js');
    const h = await import('/js/core/handoff.js');
    const stored = s.getState().quotes[id];
    return {
      lateDecline: h.dashboardImportLink(h.buildDeclinePayload({ quote: stored, reason: 'time' })),
      otherName: h.dashboardImportLink(h.buildAcceptancePayload({ quote: { ...stored, customerName: 'Zed Other' }, days: ['wed'], part: 'pm' }))
    };
  }, q.id);
  await openImport(page, hashPart(odd.lateDecline));
  check('a decline that arrives after the quote was accepted is explained and not applied', await inState(page, 'blocked') && (await attr(page, 'f4-blocked', 'data-reason')) === 'already_accepted' && (await txt(page, 'f4-blocked-text')).length > 20 && (await tid(page, 'f4-add').count()) === 0 && (await tid(page, 'f4-open-quote').count()) === 1 && (await stateOf(page)).quotes[q.id].status === 'accepted', await txt(page, 'f4-blocked-text'));
  await openImport(page, hashPart(odd.otherName));
  check('a reply for a quote number that belongs to a different customer here is refused with a sentence', await inState(page, 'blocked') && (await attr(page, 'f4-blocked', 'data-reason')) === 'quote_mismatch' && (await tid(page, 'f4-add').count()) === 0 && (await txt(page, 'f4-blocked-text')).length > 20, await txt(page, 'f4-blocked-text'));

  // A customer's quote link opened on the dashboard by mistake.
  const mistaken = '#import=' + q.link.split('#d=')[1];
  await openImport(page, mistaken);
  check('a quote link opened on the dashboard is explained, with a way to open it as the customer sees it', (await inState(page, 'quote-link')) && /That link is the quote a customer opens/.test(await txt(page, 'f4-wrong-kind')) && /^quote\.html(\?[^#]*)?#d=/.test(await attr(page, 'f4-open-quote-page', 'href') || ''));
  check('no console errors on Daniel\'s phone', clean(D.log), dump(D.log));
});

// ================================================================ 5. hostile, damaged and odd payloads
await section('5. hostile and damaged payloads: calm errors, nothing added, nothing injected', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/today');
  const n0 = (await stateOf(page)).bookings.length;
  const good = A.link.split('#import=')[1];
  const base = { v: 1, t: 'enq', i: 'EL-2001', c: '2026-10-23T20:00', n: 'Hostile Test', p: '07700 900555', z: 'BT1 1AA', a: { parking: 'driveway' }, o: 0 };
  const errorCases = [
    ['a link cut off in the middle', good.slice(0, good.length - 12), 'damaged'],
    ['one character changed', good.slice(0, 120) + (good[120] === 'A' ? 'B' : 'A') + good.slice(121), 'damaged'],
    ['plain words', 'hello', 'no_payload'],
    ['an enormous payload (60,000 characters)', 'A'.repeat(60000), 'too_long'],
    ['percent-encoded rubbish', '%E0%A4%A', ''],
    ['a payload from a different version of the site', await encodeIn(page, { ...base, v: 2 }), 'unsupported'],
    ['a payload with no customer name', await encodeIn(page, { ...base, n: '' }), 'invalid'],
    ['a name that is not text', await encodeIn(page, { ...base, n: 12345 }), 'invalid'],
    ['a mobile that is not a mobile', await encodeIn(page, { ...base, p: '020 7946 0000' }), 'invalid'],
    ['an unknown kind', await encodeIn(page, { v: 1, t: 'zzz', i: 'x' }), 'unsupported']
  ];
  for (const [label, payload, reason] of errorCases) {
    await openImport(page, '#import=' + payload);
    const state = await viewState(page);
    const rsn = await attr(page, 'f4-error', 'data-reason');
    check(`${label}: a calm error${reason ? ' (' + reason + ')' : ''}, no add button, the paste fallback offered`, state === 'error' && (reason ? rsn === reason : !!rsn) && (await txt(page, 'f4-error-message')).length > 10 && (await tid(page, 'f4-add').count()) === 0 && (await tid(page, 'f4-paste-input').count()) === 1, `${state} ${rsn} ${await txt(page, 'f4-error-message')}`);
  }
  check('none of those added anything', (await stateOf(page)).bookings.length === n0);
  await openImport(page, '#import=' + 'A'.repeat(60000));
  await shot(page, 'f4-5-error-375', true);

  // Content that tries to be code: it must arrive as inert text.
  const evil = await encodeIn(page, {
    ...base, i: 'EL-2002', n: '<img src=x onerror=window.__pwned=1>Bob‮ Hostile​', e: 'javascript:alert(1)', m: '<script>window.__pwned=2</script>Hello <a href="javascript:alert(3)">click</a> there'.padEnd(900, '!'), a: { parking: '<svg onload=window.__pwned=4>', vehicle: 'ordered' }, u: '<b>facebook</b>'
  });
  await openImport(page, '#import=' + evil);
  check('hostile text is cleaned: tags and invisible characters are gone', await inState(page, 'ready') && (await txt(page, 'f4-name')) === 'Bob Hostile', await txt(page, 'f4-name'));
  const dom = await page.evaluate(() => ({
    pwned: window.__pwned === undefined, imgs: document.querySelectorAll('[data-testid="f4-view"] img, [data-testid="f4-view"] script, [data-testid="f4-view"] svg[onload], [data-testid="f4-view"] [onerror]').length,
    hrefs: [...document.querySelectorAll('[data-testid="f4-view"] a[href]')].map((a) => a.getAttribute('href')), notes: (document.querySelector('[data-testid="f4-notes"] .f4-note__text') || {}).innerText || ''
  }));
  check('no script ran and no element was injected', dom.pwned && dom.imgs === 0, JSON.stringify(dom).slice(0, 200));
  check('every link on the screen is a safe kind (tel, mailto, wa.me, or an in-app hash): no javascript: address, and the bad email was dropped', dom.hrefs.length > 0 && dom.hrefs.every((h) => /^(tel:|mailto:|https:\/\/wa\.me\/|#\/|\/|dashboard\.html|quote\.html|index\.html|https:\/\/www\.google\.com\/maps)/.test(h) || h === '#') && !dom.hrefs.some((h) => /javascript:/i.test(h)) && (await tid(page, 'f4-email').count()) === 0, dom.hrefs.join(' , '));
  check('the unknown answer value was dropped, the valid one kept, and the long note was cut', !/svg/i.test(await txt(page, 'f4-answers')) && /Car It's ordered/.test(await txt(page, 'f4-answers')) && dom.notes.length <= 420 && !/<|>/.test(dom.notes), String(dom.notes.length));
  await tid(page, 'f4-add').click();
  await inState(page, 'success');
  const hostile = (await stateOf(page)).bookings.find((x) => x.importId && /Hostile/.test(x.customer.name)) || {};
  check('what was stored is the cleaned text', hostile.customer && hostile.customer.name === 'Bob Hostile' && hostile.notes && !/[<>]/.test(hostile.notes) && hostile.notes.length <= 400, JSON.stringify(hostile.customer) + ' ' + (hostile.notes || '').length);

  // Dates: the reply clock must never start in the future or a lifetime ago.
  const future = await encodeIn(page, { ...base, i: 'EL-2003', n: 'Future Person', p: '07700 900556', c: '2030-01-01T10:00' });
  await openImport(page, '#import=' + future);
  check('a sent time in the future is shown as wrong and counted from now', await inState(page, 'ready') && /The sent time looked wrong/.test(await txt(page, 'f4-clamped')) && (await txt(page, 'f4-clamped')).includes('Fri 23 Oct, 20:30'), await txt(page, 'f4-clamped'));
  await tid(page, 'f4-add').click();
  await inState(page, 'success');
  const fut = (await stateOf(page)).bookings.find((x) => x.importId && /Future Person/.test(x.customer.name)) || {};
  check('and stored no later than now', fut.createdAt === NOW, fut.createdAt);
  const ancient = await encodeIn(page, { ...base, i: 'EL-2004', n: 'Ancient Person', p: '07700 900557', c: '2020-01-01T10:00' });
  await openImport(page, '#import=' + ancient);
  await inState(page, 'ready');
  await tid(page, 'f4-add').click();
  await inState(page, 'success');
  const old = (await stateOf(page)).bookings.find((x) => x.importId && /Ancient Person/.test(x.customer.name)) || {};
  check('a years-old sent time is held to 30 days ago', old.createdAt === '2026-09-23T20:30', old.createdAt);
  const outside = await encodeIn(page, { ...base, i: 'EL-2005', n: 'Outside Person', p: '07700 900558', z: 'SW1A 1AA' });
  await openImport(page, '#import=' + outside);
  check('a valid non-BT postcode carries the "Outside Northern Ireland" tag', await inState(page, 'ready') && (await txt(page, 'f4-outside')) === 'Outside Northern Ireland');

  // A phone with no room left: nothing is lost, nothing is half-added, and a retry works.
  const roomy = await encodeIn(page, { ...base, i: 'EL-2006', n: 'Storage Person', p: '07700 900559' });
  await openImport(page, '#import=' + roomy);
  await inState(page, 'ready');
  const inMemory = () => page.evaluate(async () => (await import('/js/core/store.js')).getState().bookings.filter((x) => x.importId && /Storage Person/.test(x.customer.name)).length);
  await page.evaluate(() => { window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await tid(page, 'f4-add').click();
  check('when the phone is full: a plain sentence, still the ready screen with its button, and nothing added', await until(async () => (await tid(page, 'f4-problem').count()) === 1) && /no room left/.test(await txt(page, 'f4-problem')) && (await viewState(page)) === 'ready' && (await tid(page, 'f4-add').count()) === 1 && (await inMemory()) === 0, await txt(page, 'f4-problem'));
  await shot(page, 'f4-5-storage-full-375');
  await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
  await tid(page, 'f4-add').click();
  check('after freeing space the same tap works, once', await inState(page, 'success') && (await inMemory()) === 1);
  check('no console errors while all that was thrown at it', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 6. paste fallback, an empty screen, and #import= while the app is already open
await section('6. paste the message, the empty screen, and a link opened while the dashboard is already running', async () => {
  const ctx = await newContext(PHONE);
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/import');
  await tid(page, 'f4-view').waitFor({ timeout: WAIT });
  check('#/import with nothing in it is a calm empty screen with the paste box', (await viewState(page)) === 'empty' && /Nothing to import yet/.test(await txt(page, 'f4-error')) && (await tid(page, 'f4-paste-input').count()) === 1);
  await tid(page, 'f4-paste-input').fill('hello there, nothing useful');
  await tid(page, 'f4-paste-read').click();
  check('pasting words with no link gives a plain inline error and stays', (await txt(page, 'f4-paste-error')).length > 10 && (await viewState(page)) === 'empty', await txt(page, 'f4-paste-error'));
  await tid(page, 'f4-paste-input').fill(A.text);
  await tid(page, 'f4-paste-read').click();
  check('pasting the WHOLE WhatsApp message finds the link inside it and opens the enquiry', await inState(page, 'ready') && (await txt(page, 'f4-name')) === 'Aoife Ní Bhriain' && /^#\/import\?d=/.test(await hashOf(page)));
  await dash(page, '#/today');
  await tid(page, 'tabbar').waitFor({ timeout: WAIT }).catch(() => {});
  const good = A.link.split('#import=')[1];
  await page.evaluate((p) => { location.hash = '#import=' + p; }, good);
  check('setting location.hash to #import=... while the dashboard is open still routes to the Import screen', await until(async () => (await tid(page, 'f4-view').count()) === 1 && /^#\/import\?d=/.test(await hashOf(page))) && (await txt(page, 'f4-name')) === 'Aoife Ní Bhriain', await hashOf(page));
  await page.evaluate((p) => { location.hash = '#/import?d=' + p; }, good);
  check('the canonical #/import?d= form works too', (await txt(page, 'f4-name')) === 'Aoife Ní Bhriain');
  await tid(page, 'f4-not-now').click();
  check('"Not now" goes back to Today and adds nothing', await until(async () => (await hashOf(page)) === '#/today') && !(await stateOf(page)).bookings.some((x) => x.importId));
  await dash(page, '#/more');
  check('other routes are untouched by the import rewrite (More still opens)', await until(async () => (await hashOf(page)) === '#/more'));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 7. layout, themes, accessibility, reduced motion
await section('7. layout at 320 / 375 / 1280 in dark and light, axe, reduced motion', async () => {
  const good = A.link.split('#import=')[1];
  for (const [vpName, vp] of [['320', SMALL], ['375', PHONE], ['1280', DESKTOP]]) {
    for (const theme of ['dark', 'light']) {
      const ctx = await newContext(vp, { scheme: theme, theme });
      const page = await ctx.newPage();
      const log = watch(page);
      await dash(page, '#/today');
      const links = await page.evaluate(async () => {
        const s = await import('/js/core/store.js');
        const h = await import('/js/core/handoff.js');
        const base = Object.values(s.getState().quotes).find((x) => x.status === 'sent' && x.seed);
        const link = (p) => h.dashboardImportLink(p).split('#import=')[1];
        return {
          acc: link(h.buildAcceptancePayload({ quote: base, days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], part: 'any', note: 'Any day is fine, we work from home, and the dog is friendly.' })),
          dec: link(h.buildDeclinePayload({ quote: base, reason: 'other_installer', note: 'Another installer was cheaper' })),
          bogus: link(h.buildAcceptancePayload({ quote: { ...base, id: 'Q-EL-9999', customerName: 'Sinead Walsh' }, days: ['mon'], part: 'am' })),
          quo: h.quoteLink(base, {}).split('#d=')[1]
        };
      });
      const tag = `${vpName} ${theme}`;
      const states = [
        ['enquiry ready', good, 'ready'], ['accepted ready', links.acc, 'ready'], ['declined ready', links.dec, 'ready'],
        ['quote not on this phone', links.bogus, 'blocked'], ['damaged link', good.slice(0, 90), 'error'], ['a quote link by mistake', links.quo, 'quote-link']
      ];
      for (const [name, payload, st] of states) {
        await openImport(page, '#import=' + payload);
        const ok = await inState(page, st);
        const f = await layoutFacts(page);
        check(`${tag}, ${name}: shows the ${st} state, no horizontal overflow, every control at least 44px, the bar on screen`, ok && !f.overflow && f.wide.length === 0 && f.small.length === 0 && (!f.bar || f.bar.onScreen), JSON.stringify(f));
        if (vpName !== '320' || theme === 'dark') {
          const ax = await axeSerious(page, '[data-testid="f4-view"]');
          check(`${tag}, ${name}: axe finds no serious or critical issue`, ax.count === 0, ax.detail);
        }
        if (vpName === '375' || (vpName === '1280' && theme === 'dark') || (vpName === '320' && theme === 'dark')) await shot(page, `f4-7-${name.replace(/\s+/g, '-')}-${vpName}-${theme}`);
      }
      await openImport(page, '#import=' + good);
      await tid(page, 'f4-add').click();
      const okSuccess = await inState(page, 'success');
      const fs1 = await layoutFacts(page);
      check(`${tag}, success: no overflow, controls 44px, the bar on screen`, okSuccess && !fs1.overflow && fs1.small.length === 0 && (!fs1.bar || fs1.bar.onScreen), JSON.stringify(fs1));
      if (vpName !== '320' || theme === 'dark') {
        const ax = await axeSerious(page, '[data-testid="f4-view"]');
        check(`${tag}, success: axe finds no serious or critical issue`, ax.count === 0, ax.detail);
      }
      if (vpName === '375' || vpName === '1280') await shot(page, `f4-7-success-${vpName}-${theme}`);
      await page.reload({ waitUntil: 'load' });
      await tid(page, 'f4-view').waitFor({ timeout: WAIT });
      const okDone = await inState(page, 'done');
      const fd = await layoutFacts(page);
      check(`${tag}, already-added: no overflow, controls 44px, the bar on screen`, okDone && !fd.overflow && fd.small.length === 0 && (!fd.bar || fd.bar.onScreen), JSON.stringify(fd));
      if (vpName === '375') await shot(page, `f4-7-done-${vpName}-${theme}`);
      check(`${tag}: no console errors`, clean(log), dump(log));
      await ctx.close();
    }
  }
  // The customer's card too, at the three widths, in both themes.
  for (const [vpName, vp] of [['320', SMALL], ['1280', DESKTOP]]) {
    for (const theme of ['dark', 'light']) {
      const c = await customerEnquiry({ name: 'Layout Check', phone: '07700 900888', email: 'layout@example.com', vp, scheme: theme, theme });
      const f = await c.page.evaluate(() => {
        const card = document.querySelector('[data-testid="wa-send-card"]').getBoundingClientRect();
        const btn = document.querySelector('[data-testid="wa-send"]').getBoundingClientRect();
        const root = document.documentElement;
        const sheet = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body');
        return { overflow: root.scrollWidth > root.clientWidth || (sheet && sheet.scrollWidth > sheet.clientWidth), cardRight: Math.round(card.right), btnH: Math.round(btn.height), btnRight: Math.round(btn.right), vw: root.clientWidth };
      });
      check(`customer card ${vpName} ${theme}: no overflow, the button 44px or taller and inside the card`, !f.overflow && f.btnH >= 44 && f.btnRight <= f.cardRight && f.cardRight <= f.vw, JSON.stringify(f));
      if (vpName === '320' || theme === 'dark') {
        await c.page.locator('[data-testid="wa-send-card"]').scrollIntoViewIfNeeded();
        const ax = await axeSerious(c.page, '[data-testid="wa-send-card"]');
        check(`customer card ${vpName} ${theme}: axe finds no serious or critical issue`, ax.count === 0, ax.detail);
        await shot(c.page, `f4-7-card-${vpName}-${theme}`);
      }
      check(`customer card ${vpName} ${theme}: no console errors`, clean(c.log), dump(c.log));
      await c.ctx.close();
    }
  }
  // Reduced motion: the success tick is drawn in its final state, with no animation.
  const rm = await newContext(PHONE, { reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  await openImport(rp, '#import=' + good);
  await tid(rp, 'f4-add').click();
  await inState(rp, 'success');
  const anim = await rp.evaluate(() => ['.f4-tick__disc', '.f4-tick__ring', '.f4-tick__check'].map((s) => getComputedStyle(document.querySelector(s)).animationName));
  check('reduced motion: the success tick has no animation', anim.every((a) => a === 'none'), anim.join(','));
  await rm.close();
});

// ================================================================ 8. source rules for the files this role owns
await section('8. source rules: no Date.now, new Date, innerHTML, eval, no hard-coded colours in the new CSS, relative URLs only', async () => {
  const read = (p) => fs.readFileSync(path.join(SITE_ROOT, p), 'utf8');
  const view = read('js/dashboard/views/import.js');
  const css = read('css/import.css');
  const booking = read('css/booking.css');
  const mine = booking.slice(booking.indexOf('V4 (F4): the WhatsApp send card'));
  const conf = read('js/booking/confirmation.js');
  const sendCard = conf.slice(conf.indexOf('function WhatsAppSendCard'), conf.indexOf('function DemoPanel'));
  const forbidden = /Date\.now\(|new Date\(|innerHTML|outerHTML|insertAdjacentHTML|\beval\(|new Function\(|document\.write|dangerouslySetInnerHTML/;
  check('import.js has none of the banned calls', !forbidden.test(view));
  check('the WhatsApp card code has none of the banned calls', sendCard.length > 200 && !forbidden.test(sendCard));
  check('import.css and the new booking.css block hold no hard-coded colours (tokens only)', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css) && mine.length > 200 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(mine));
  check('the new view has no absolute http(s) URLs (relative only)', !/https?:\/\//.test(view.replace(/https?:\/\/wa\.me/g, '')));
  check('no new file stores its own state: the only storage touched on the customer side is vm_handoff_v1 through core', !/localStorage|sessionStorage/.test(view) && !/localStorage|sessionStorage/.test(sendCard));
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
