// tests/e2e/landing.mjs: lean end-to-end check of the landing page, the 6-step quote funnel, the enquiry confirmation and Manage page,
// the owner's phone-job booking and the cross-page (landing <-> dashboard) flow. Self-contained: starts its own static server unless BASE_URL is set.
//
//   node tests/e2e/landing.mjs
//   BASE_URL=http://127.0.0.1:4164 node tests/e2e/landing.mjs
//   QA_DEPS_DIR=/path/with/node_modules node tests/e2e/landing.mjs     (must contain playwright-core)
//   CHROMIUM_PATH=/path/to/chrome   SHOTS_DIR=/some/dir (optional screenshots)
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

// ---------------------------------------------------------------- harness
let failures = 0;
let passes = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, step = 100) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = false; }
    await sleep(step);
  }
  return false;
}
async function section(name, fn) {
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
  const up = await until(async () => { const r = await fetch(base + '/index.html').catch(() => null); return r && r.ok; }, 8000, 150);
  if (!up) throw new Error('static server did not start');
  return base;
}

// ---------------------------------------------------------------- browser helpers
const browser = await (async () => chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }))();
const BASE = await startServer();
const ORIGIN = new URL(BASE).origin;
const ctxOpts = (vp, scheme = 'dark') => ({
  viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: scheme,
  isMobile: vp.width < 600, hasTouch: vp.width < 600, acceptDownloads: true
});
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

// His own photos (img/180/*) are placed later and the landing page polls for them: a 404 there is expected, not a bug.
const isPhoto404 = (u) => /\/img\/180\//.test(u);

/** Open a page and collect everything that should stay empty: console errors, page errors, off-site and failed requests. */
function watch(page) {
  const log = { errors: [], offsite: [], failed: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/Failed to load resource/.test(m.text()) && m.location && isPhoto404(m.location().url || '')) return;
    log.errors.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== ORIGIN) log.offsite.push(u); });
  page.on('requestfailed', (r) => { if (!isPhoto404(r.url())) log.failed.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400 && !isPhoto404(r.url())) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}
const clean = (log) => log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0;
const dump = (log) => [...log.errors, ...log.offsite, ...log.failed].join(' | ');
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const txt = async (page, id) => (await tid(page, id).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const site = (page, hash = '') => page.goto(`${BASE}/index.html?${CLOCK}${hash}`, { waitUntil: 'networkidle' });
const dash = (page, hash = '#/today') => page.goto(`${BASE}/dashboard.html?${CLOCK}${hash}`, { waitUntil: 'networkidle' });
const hashOf = (page) => page.evaluate(() => location.hash);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const sheetOpen = (page) => tid(page, 'booking-sheet').waitFor({ state: 'visible', timeout: 5000 });
const sheetGone = (page) => until(async () => (await tid(page, 'booking-sheet').count()) === 0, 4000);
const lum = (rgb) => { const m = rgb.match(/\d+(\.\d+)?/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
const stepLabel = (page) => txt(page, 'funnel-step-label');
const titleOf = (page) => txt(page, 'funnel-title');
/** True when nothing in the open sheet is wider than the sheet (no horizontal overflow, page or body). */
const noOverflow = (page) => page.evaluate(() => {
  const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body');
  const root = document.documentElement;
  return root.scrollWidth <= root.clientWidth && (!body || body.scrollWidth <= body.clientWidth);
});
/** Type a valid BT postcode and walk steps 1 to 5 with the answers of ANSWERS_LINE. */
async function walkToContact(page, postcode = 'BT9 6QP') {
  await tid(page, 'funnel-postcode').fill(postcode);
  await tid(page, 'funnel-continue').click();
  for (const [key, value] of [['parking', 'driveway'], ['vehicle', 'ordered'], ['timing', 'asap'], ['permission', 'yes']]) {
    await tid(page, `funnel-option-${key}-${value}`).waitFor({ timeout: 3000 });
    await tid(page, `funnel-option-${key}-${value}`).click();
  }
  await tid(page, 'funnel-step-6').waitFor({ timeout: 3000 });
}

// ================================================================ 1. landing page loads and opens the funnel
async function landingLoad(name, vp, scheme) {
  await section(`1. landing page ${name}`, async () => {
    const ctx = await browser.newContext(ctxOpts(vp, scheme));
    const page = await ctx.newPage();
    const log = watch(page);
    await site(page);
    await page.waitForTimeout(500);
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
await section('2. the 6 steps: his verbatim copy, validation, auto-advance, Back, refresh', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  const s1 = await tid(page, 'booking-sheet').innerText();
  check('step 1 eyebrow, H1, label and help are verbatim', s1.includes(COPY.step1.eyebrow) && (await titleOf(page)) === COPY.step1.title && s1.includes(COPY.step1.label) && s1.includes(COPY.step1.help), (await titleOf(page)));
  check('step 1 placeholder is verbatim', (await tid(page, 'funnel-postcode').getAttribute('placeholder')) === COPY.step1.placeholder);
  check('no Back link on step 1, progress bar at 1 of 6', (await tid(page, 'booking-back').count()) === 0 && (await tid(page, 'booking-progress').getAttribute('aria-valuenow')) === '1');
  await shot(page, 'funnel-1-postcode');
  await tid(page, 'funnel-continue').click();
  check('empty postcode shows his exact error and stays on step 1', (await txt(page, 'error-funnel-postcode')) === COPY.step1.error && (await stepLabel(page)) === 'Step 1 of 6', await txt(page, 'error-funnel-postcode'));
  await tid(page, 'funnel-postcode').fill('not a postcode');
  await tid(page, 'funnel-continue').click();
  check('a malformed postcode is refused with the same error', (await txt(page, 'error-funnel-postcode')) === COPY.step1.error && (await stepLabel(page)) === 'Step 1 of 6');
  await shot(page, 'funnel-1b-postcode-error');
  await tid(page, 'funnel-postcode').fill('sw1a1aa');
  await tid(page, 'funnel-continue').click();
  await tid(page, 'funnel-step-2').waitFor({ timeout: 3000 });
  check('a valid non-BT postcode is accepted (flagged for the owner later)', (await stepLabel(page)) === 'Step 2 of 6');
  check('Back link appears on step 2', (await tid(page, 'booking-back').count()) === 1);
  await tid(page, 'booking-back').click();
  await tid(page, 'funnel-step-1').waitFor({ timeout: 3000 });
  check('Back returns to step 1 with the postcode kept (normalised)', (await tid(page, 'funnel-postcode').inputValue()) === 'SW1A 1AA', await tid(page, 'funnel-postcode').inputValue());
  await tid(page, 'funnel-postcode').fill('BT9 6QP');
  await tid(page, 'funnel-postcode').press('Enter');
  await tid(page, 'funnel-step-2').waitFor({ timeout: 3000 });
  check('Enter on the postcode field continues', (await stepLabel(page)) === 'Step 2 of 6');

  // steps 2 to 5: verbatim title, note, options with A..E letters; clicking auto-advances
  for (const s of COPY.steps) {
    await tid(page, `funnel-step-${s.n}`).waitFor({ timeout: 3000 });
    const sheet = await tid(page, 'booking-sheet').innerText();
    check(`step ${s.n} label, H1 and note are verbatim`, (await stepLabel(page)) === `Step ${s.n} of 6` && (await titleOf(page)) === s.title && (s.note ? (await txt(page, 'funnel-note')) === s.note : (await tid(page, 'funnel-note').count()) === 0), await titleOf(page));
    const labels = (await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__label`).allInnerTexts()).map((t) => t.trim());
    const letters = (await page.locator(`[data-testid^="funnel-option-${s.key}-"] .bk-fn-opt__letter`).allInnerTexts()).map((t) => t.trim());
    check(`step ${s.n} options are verbatim, lettered A to ${'ABCDE'[s.options.length - 1]}`, JSON.stringify(labels) === JSON.stringify(s.options) && letters.join('') === 'ABCDE'.slice(0, s.options.length), JSON.stringify(labels));
    check(`step ${s.n} has no Continue button (it auto-advances)`, (await tid(page, 'funnel-continue').count()) === 0 && (await tid(page, 'funnel-submit').count()) === 0 && !sheet.includes('Continue'));
    check(`step ${s.n} nothing overflows sideways`, await noOverflow(page));
    const pick = tid(page, `funnel-option-${s.key}-${s.values[0]}`);
    await pick.click();
    check(`step ${s.n} the tapped option shows the selected state`, (await pick.getAttribute('aria-pressed')) === 'true' && (await pick.getAttribute('class')).includes('is-selected'));
    if (s.n === 2) await shot(page, 'funnel-2-selected');
    await tid(page, `funnel-step-${s.n + 1}`).waitFor({ timeout: 3000 });
    check(`step ${s.n} advanced by itself to step ${s.n + 1}`, (await stepLabel(page)) === `Step ${s.n + 1} of 6`);
    if (s.n === 2) {
      // Back keeps the answer; picking another option advances again
      await tid(page, 'booking-back').click();
      await tid(page, 'funnel-step-2').waitFor({ timeout: 3000 });
      check('Back to step 2 shows the earlier answer still selected', (await tid(page, 'funnel-option-parking-driveway').getAttribute('aria-pressed')) === 'true');
      await tid(page, 'funnel-option-parking-garage').click();
      await tid(page, 'funnel-step-3').waitFor({ timeout: 3000 });
      await tid(page, 'booking-back').click();
      await tid(page, 'funnel-step-2').waitFor({ timeout: 3000 });
      check('changing an answer replaces it (Garage now selected, Driveway not)', (await tid(page, 'funnel-option-parking-garage').getAttribute('aria-pressed')) === 'true' && (await tid(page, 'funnel-option-parking-driveway').getAttribute('aria-pressed')) === 'false');
      await tid(page, 'funnel-option-parking-driveway').click();
      await tid(page, 'funnel-step-3').waitFor({ timeout: 3000 });
    }
    if (s.n === 3) await shot(page, 'funnel-4-timing-next');
  }

  // step 6
  await tid(page, 'funnel-step-6').waitFor({ timeout: 3000 });
  const s6 = await tid(page, 'booking-sheet').innerText();
  check('step 6 H1, field labels, opt-in and small print are verbatim', (await titleOf(page)) === COPY.step6.title && COPY.step6.labels.every((l) => s6.includes(l)) && s6.includes(COPY.step6.optIn) && (await txt(page, 'funnel-small-print')) === COPY.step6.small, await titleOf(page));
  check('step 6 submit button is verbatim and progress is 6 of 6', (await txt(page, 'funnel-submit')) === COPY.step6.submit && (await tid(page, 'booking-progress').getAttribute('aria-valuenow')) === '6');
  check('step 6 installation postcode is prefilled from step 1', (await tid(page, 'field-postcode').inputValue()) === 'BT9 6QP');
  const attrs = await page.evaluate(() => {
    const g = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); return { ac: el.getAttribute('autocomplete'), im: el.getAttribute('inputmode'), eh: el.getAttribute('enterkeyhint'), type: el.getAttribute('type'), fs: parseFloat(getComputedStyle(el).fontSize) }; };
    return { name: g('field-name'), pc: g('field-postcode'), phone: g('field-phone'), email: g('funnel-email'), note: g('field-note') };
  });
  check('inputs carry autocomplete / inputmode / enterkeyhint / type', attrs.name.ac === 'name' && attrs.pc.ac === 'postal-code' && attrs.phone.ac === 'tel' && attrs.phone.im === 'tel' && attrs.email.ac === 'email' && attrs.email.type === 'email' && attrs.name.eh === 'next' && attrs.note.eh === 'done', JSON.stringify(attrs));
  check('every input is 16px or larger (no iOS zoom)', Object.values(attrs).every((a) => a.fs >= 16), JSON.stringify(attrs));
  await shot(page, 'funnel-6-contact');
  // refresh restores the funnel (draft in sessionStorage)
  await tid(page, 'field-name').fill('Aoife Magee');
  await tid(page, 'field-name').blur();
  await page.reload({ waitUntil: 'networkidle' });
  await sheetOpen(page);
  check('a refresh on step 6 comes back to step 6 with the name kept', (await stepLabel(page)) === 'Step 6 of 6' && (await tid(page, 'field-name').inputValue()) === 'Aoife Magee', await stepLabel(page));
  await tid(page, 'booking-back').click();
  await tid(page, 'funnel-step-5').waitFor({ timeout: 3000 });
  check('the answers survived the refresh (step 5 shows Yes selected)', (await tid(page, 'funnel-option-permission-yes').getAttribute('aria-pressed')) === 'true');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 3. submit: contact validation, confirmation, manage, cancel
await section('3. submit -> confirmation (his copy + pencilled survey + DEMO panel) -> Manage -> cancel', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  await walkToContact(page);
  await tid(page, 'funnel-submit').click();
  await page.waitForTimeout(200);
  const body6 = await tid(page, 'booking-sheet').innerText();
  check('empty step 6 shows name, mobile and email errors and does not submit', ['Enter your name', 'Enter your mobile number', 'Enter your email address'].every((m) => body6.includes(m)) && (await stepLabel(page)) === 'Step 6 of 6', body6.slice(0, 300));
  await shot(page, 'funnel-6b-errors');
  await tid(page, 'field-name').fill('Aoife Magee');
  await tid(page, 'field-phone').fill('12345');
  await tid(page, 'funnel-email').fill('not-an-email');
  await tid(page, 'funnel-submit').click();
  await page.waitForTimeout(200);
  const bad = await tid(page, 'booking-sheet').innerText();
  check('a bad mobile and a bad email are refused with a clear message', /doesn't look like a UK mobile/.test(bad) && /email address doesn't look right/.test(bad), bad.slice(0, 400));
  await tid(page, 'demo-fill').click();
  check('Demo: fill sample details fills name, mobile and email', (await tid(page, 'field-name').inputValue()).length > 1 && (await tid(page, 'field-phone').inputValue()).startsWith('07700 900') && (await tid(page, 'funnel-email').inputValue()).includes('@'));
  await tid(page, 'field-note').fill('Charger on the garage wall please');
  await tid(page, 'funnel-optin').check();
  check('the optional marketing checkbox ticks', await tid(page, 'funnel-optin').isChecked());
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: 5000 });
  check('confirmation route is #booked/EL-1043', (await hashOf(page)) === '#booked/EL-1043', await hashOf(page));
  await page.waitForTimeout(1200);
  await shot(page, 'funnel-7-confirmation');
  check('H1 is his "Thanks, your enquiry has been received."', (await txt(page, 'confirmation-title')) === COPY.confirm.title, await txt(page, 'confirmation-title'));
  check('his paragraph, "within 24 hours" and "check your emails"', (await txt(page, 'confirmation-lead')) === COPY.confirm.body, await txt(page, 'confirmation-lead'));
  check('reference EL-1043 in monospace', (await txt(page, 'confirmation-ref')) === 'EL-1043' && (await tid(page, 'confirmation-ref').getAttribute('class')).includes('u-mono'));
  const pencilled = await txt(page, 'confirmation-pencilled');
  check('"We\'ve pencilled in a free survey visit for {when}. It\'s provisional until Daniel confirms."', /^We've pencilled in a free survey visit for (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} \w{3}, [^.]+\. It's provisional until Daniel confirms\.$/.test(pencilled), pencilled);
  const ready = await txt(page, 'funnel-ready-box');
  check('"Helpful to have ready" box is verbatim', ready.includes(COPY.confirm.readyTitle) && ready.includes(COPY.confirm.ready), ready);
  check('"Prefer to speak to us? Call 07885 496800" is a tel: button', (await txt(page, 'confirmation-call')) === COPY.confirm.call && (await tid(page, 'confirmation-call').getAttribute('href')) === 'tel:+447885496800', await tid(page, 'confirmation-call').getAttribute('href'));
  check('status chip says Daniel still has to confirm; no calendar download, no breaker art', (await txt(page, 'confirmation-status')).includes('Waiting for Daniel to confirm') && (await tid(page, 'add-to-calendar').count()) === 0 && (await tid(page, 'breaker-art').count()) === 0);
  check('animated tick is drawn', (await tid(page, 'confirmation-tick').count()) === 1);
  check('timeline has the four steps of the quote-led process', (await tid(page, 'confirmation-timeline').locator('li').count()) === 4);
  check('DEMO panel is labelled simulated', (await txt(page, 'demo-panel')).includes('DEMO · SIMULATED'));
  const ob = await txt(page, 'demo-owner-bubble');
  check('DEMO: the owner bubble has name, postcode and the one-line answers', ob.includes('EL-1043') && ob.includes('BT9 6QP') && ob.includes(ANSWERS_LINE), ob);
  const cb = await txt(page, 'demo-customer-bubble');
  check('DEMO: the customer text says pencilled, provisional, within 24 hours', /pencilled/.test(cb) && /provisional/.test(cb) && /24 hours/.test(cb) && cb.includes('EL-1043'), cb);
  check('Open Daniel\'s dashboard deep-links to the booking', /dashboard\.html(\?[^#]*)?#\/bookings\/bk_/.test(await tid(page, 'demo-open-dashboard').getAttribute('href')));
  check('the draft is cleared after submitting', await page.evaluate(() => sessionStorage.getItem('vm_draft_v1') === null));
  check('confirmation fits the phone width', await noOverflow(page));
  // survives a refresh
  await page.reload({ waitUntil: 'networkidle' });
  await tid(page, 'confirmation').waitFor({ timeout: 5000 });
  check('confirmation survives a refresh', (await txt(page, 'confirmation-ref')) === 'EL-1043' && (await tid(page, 'demo-owner-bubble').count()) === 1);
  // manage
  await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-manage').click();
  await tid(page, 'manage-page').waitFor({ timeout: 5000 });
  check('Manage opens at #manage/EL-1043', (await hashOf(page)) === '#manage/EL-1043');
  check('a pending enquiry says "We\'ll be in touch within 24 hours." (no time promise)', (await txt(page, 'manage-reply-note')) === "We'll be in touch within 24 hours.", await txt(page, 'manage-reply-note'));
  check('Manage shows the status timeline and a Cancel enquiry button', (await tid(page, 'manage-status-timeline').count()) === 1 && (await txt(page, 'manage-cancel')) === 'Cancel enquiry');
  await shot(page, 'funnel-8-manage');
  await tid(page, 'manage-cancel').click();
  await tid(page, 'manage-cancel-confirm').click();
  await until(async () => (await txt(page, 'manage-page')).includes('This enquiry was cancelled.'));
  check('cancelling shows "This enquiry was cancelled." and a way to start again', (await txt(page, 'manage-page')).includes('This enquiry was cancelled.') && (await txt(page, 'manage-page')).includes('Get my installation quote'));
  await tid(page, 'booking-close').click();
  await sheetGone(page);
  check('close returns to the landing page (no hash)', (await hashOf(page)) === '');
  await tid(page, 'hero-cta').click();
  await sheetOpen(page);
  check('opening the funnel again starts fresh at step 1 with an empty postcode', (await stepLabel(page)) === 'Step 1 of 6' && (await tid(page, 'funnel-postcode').inputValue()) === '');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 4. layout: keyboard open, deep links, postcode prefill
await section('4. keyboard-open layout, old deep links, landing postcode prefill', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
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
  await page.waitForTimeout(250);
  check('step 1 with the keyboard open: Continue is fully visible above it', await visible('funnel-continue'), JSON.stringify(await tid(page, 'funnel-continue').boundingBox()));
  const sh = await tid(page, 'booking-sheet').boundingBox();
  check('step 1 with the keyboard open: the sheet shrinks to the space above the keyboard', sh.y + sh.height <= MOBILE.height - KB + 1, JSON.stringify(sh));
  await shot(page, 'funnel-1-keyboard');
  await keyboard(false);
  await walkToContact(page);
  await tid(page, 'field-phone').focus();
  await keyboard(true);
  await page.waitForTimeout(250);
  check('step 6 with the keyboard open: the submit button is fully visible above it', await visible('funnel-submit'), JSON.stringify(await tid(page, 'funnel-submit').boundingBox()));
  const fb = await tid(page, 'field-phone').boundingBox();
  check('step 6 with the keyboard open: the focused field is still on screen', fb && fb.y >= 0 && fb.y + fb.height <= MOBILE.height - KB, JSON.stringify(fb));
  await shot(page, 'funnel-6-keyboard');
  await keyboard(false);

  // old deep links and '#book' all open the funnel (the website offers only the enquiry)
  for (const hash of ['#book', '#book/fault/2026-10-24/0', '#book/eicr']) {
    // Leave the open sheet first (its pagehide flush re-saves the draft), clear the draft on the bare page, then deep-link.
    await page.goto(`${BASE}/index.html?${CLOCK}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${BASE}/index.html?${CLOCK}${hash}`, { waitUntil: 'networkidle' });
    await sheetOpen(page);
    check(`${hash} opens the quote funnel at step 1`, (await stepLabel(page)) === 'Step 1 of 6' && (await tid(page, 'funnel-step-1').count()) === 1, await stepLabel(page));
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

// ================================================================ 5. light theme still works
await section('5. light theme: funnel and confirmation are readable', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE, 'light'));
  await ctx.addInitScript(() => { try { localStorage.setItem('vm_theme', 'light'); } catch (e) { /* ignore */ } });
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page, '#book/ev_quote');
  await sheetOpen(page);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="booking-sheet"]')).backgroundColor);
  check('the sheet is light in the light theme', lum(bg) > 0.8, bg);
  await walkToContact(page);
  await tid(page, 'funnel-option-permission-yes').count();
  await shot(page, 'funnel-6-contact-light');
  await tid(page, 'demo-fill').click();
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  await shot(page, 'funnel-7-confirmation-light');
  const ink = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="confirmation-title"]')).color);
  check('confirmation text is dark on light', lum(ink) < 0.3, ink);
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 6. owner's phone job (BookingSheet owner mode, #/new)
await section('6. owner mode: New booking route books an EV installation by phone', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const page = await ctx.newPage();
  const log = watch(page);
  await dash(page, '#/new');
  await tid(page, 'new-booking-page').waitFor({ timeout: 6000 });
  check('step 0 lists the free quote visit and the EV installation (no emergency row)', (await tid(page, 'service-option-ev_quote').count()) === 1 && (await tid(page, 'service-option-ev').count()) === 1 && (await tid(page, 'booking-emergency-link').count()) === 0);
  check('the installation shows "Quoted for your home", never a price', (await txt(page, 'service-option-ev')).includes('Quoted for your home') && !/£\d/.test(await txt(page, 'service-option-ev')), await txt(page, 'service-option-ev'));
  await tid(page, 'service-option-ev').click();
  await tid(page, 'soonest-card').waitFor({ timeout: 4000 });
  await tid(page, 'soonest-pick').click();
  await tid(page, 'booking-continue').click();
  await tid(page, 'field-name').waitFor({ timeout: 4000 });
  check('details step ticket says Quoted for your home', (await txt(page, 'booking-ticket')).includes('Quoted for your home'), await txt(page, 'booking-ticket'));
  await tid(page, 'demo-fill').click();
  check('postcode hint says it is in Northern Ireland', (await txt(page, 'postcode-hint')).includes('Northern Ireland'), await txt(page, 'postcode-hint'));
  await tid(page, 'booking-submit').click();
  await until(async () => /#\/bookings\/bk_/.test(await hashOf(page)), 6000);
  check('Add to diary lands on the booking page', /#\/bookings\/bk_/.test(await hashOf(page)), await hashOf(page));
  const jobPage = await until(async () => (await page.locator('body').innerText()).includes('EV charger installation'), 4000);
  check('the booking page shows the installation', !!jobPage);
  await shot(page, 'owner-new-installation');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 7. cross-page flow (one context, two pages)
await section('7. cross-page: the website enquiry reaches the dashboard, and Daniel confirming flips the customer page live', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const A = await ctx.newPage();
  const logA = watch(A);
  await dash(A, '#/today');
  await A.waitForTimeout(600);
  const B = await ctx.newPage();
  const logB = watch(B);
  await site(B, '#book/ev_quote');
  await sheetOpen(B);
  await walkToContact(B);
  await tid(B, 'demo-fill').click();
  await tid(B, 'funnel-submit').click();
  await tid(B, 'confirmation').waitFor({ timeout: 5000 });
  const ref = await txt(B, 'confirmation-ref');
  check('B: the enquiry is EL-1043 and waits for Daniel', ref === 'EL-1043' && (await txt(B, 'confirmation-status')).includes('Waiting for Daniel to confirm'), ref);
  const href = await tid(B, 'demo-open-dashboard').getAttribute('href');
  const bookingId = (href.match(/#\/bookings\/(bk_[a-z0-9]+)/) || [])[1];
  check('B: the DEMO panel links to the dashboard job card', !!bookingId, href);

  const toast = await until(async () => A.getByText(/New (booking|enquiry): /).first().isVisible(), 8000, 150);
  check('A: a new-enquiry toast appeared without a reload', !!toast);
  await A.evaluate((id) => { location.hash = '#/bookings/' + id; }, bookingId);
  await tid(A, 'job-primary').waitFor({ timeout: 5000 });
  const jobText = (await A.locator('body').innerText()).replace(/\s+/g, ' ');
  check('A: the job card shows the five funnel answers', ['BT9 6QP', 'Private driveway', 'ordered or arriving soon', 'As soon as possible'].every((t) => jobText.includes(t)), jobText.slice(0, 300));
  check('A: the job card primary action is Confirm', /confirm/i.test(await txt(A, 'job-primary')), await txt(A, 'job-primary'));
  await tid(A, 'job-primary').click();
  await A.waitForTimeout(500);
  const flipped = await until(async () => (await txt(B, 'confirmation-status')) === 'Confirmed', 8000, 150);
  check('B: the chip flipped to Confirmed without a reload', !!flipped, await txt(B, 'confirmation-status'));
  check('B: the survey line now says it is confirmed (no longer provisional)', /Your free survey visit is confirmed for/.test(await txt(B, 'confirmation-pencilled')) && !/provisional/.test(await txt(B, 'confirmation-pencilled')), await txt(B, 'confirmation-pencilled'));
  const bubble = await until(async () => /then, when daniel confirmed/i.test(await txt(B, 'demo-panel')), 4000);
  check('B: the confirmation text appeared in the DEMO panel', !!bubble);
  check('no console errors on either page', logA.errors.length + logB.errors.length === 0, [...logA.errors, ...logB.errors].join(' | '));
  check('no off-site or failed requests on either page', logA.offsite.length + logB.offsite.length + logA.failed.length + logB.failed.length === 0, [...logA.offsite, ...logB.offsite, ...logA.failed, ...logB.failed].join(' | '));
  await ctx.close();
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
