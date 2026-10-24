// tests/e2e/landing.mjs: lean end-to-end check of the landing page, the customer booking flow and the cross-page
// (landing <-> dashboard) flow. Self-contained: starts its own static server unless BASE_URL is set.
//
//   node tests/e2e/landing.mjs
//   BASE_URL=http://127.0.0.1:4121 node tests/e2e/landing.mjs
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
const ctxOpts = (vp, scheme = 'light') => ({
  viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: scheme,
  isMobile: vp.width < 600, hasTouch: vp.width < 600, acceptDownloads: true
});
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

/** Open a page and collect everything that should stay empty: console errors, page errors, off-site and failed requests. */
function watch(page) {
  const log = { errors: [], offsite: [], failed: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== ORIGIN) log.offsite.push(u); });
  page.on('requestfailed', (r) => log.failed.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const txt = async (page, id) => (await tid(page, id).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const site = (page, hash = '') => page.goto(`${BASE}/index.html?${CLOCK}${hash}`, { waitUntil: 'networkidle' });
const dash = (page, hash = '#/today') => page.goto(`${BASE}/dashboard.html?${CLOCK}${hash}`, { waitUntil: 'networkidle' });
const hashOf = (page) => page.evaluate(() => location.hash);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const sheetOpen = (page) => tid(page, 'booking-sheet').waitFor({ state: 'visible', timeout: 5000 });
const sheetGone = (page) => until(async () => (await tid(page, 'booking-sheet').count()) === 0, 4000);
const lum = (rgb) => { const m = rgb.match(/\d+(\.\d+)?/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };

// ================================================================ 1. landing page loads
async function landingLoad(name, vp, scheme) {
  await section(`1. landing page ${name}`, async () => {
    const ctx = await browser.newContext(ctxOpts(vp, scheme));
    const page = await ctx.newPage();
    const log = watch(page);
    await site(page);
    await page.waitForTimeout(500);
    check('no console errors or page errors', log.errors.length === 0, log.errors.join(' | '));
    check('no off-site requests', log.offsite.length === 0, log.offsite.join(' | '));
    check('no failed requests', log.failed.length === 0, log.failed.join(' | '));
    const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check('no horizontal overflow', dims.sw <= dims.cw, JSON.stringify(dims));
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return { fig: document.fonts.check('16px Figtree'), bri: document.fonts.check('800 20px "Bricolage Grotesque"'), loaded: [...document.fonts].filter((f) => f.status === 'loaded').length };
    });
    check('both local fonts loaded', fonts.fig && fonts.bri && fonts.loaded >= 2, JSON.stringify(fonts));
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(scheme === 'dark' ? 'dark mode background is dark' : 'light mode background is light', scheme === 'dark' ? lum(bg) < 0.2 : lum(bg) > 0.8, bg);
    check('prototype strip with What\'s real link', (await txt(page, 'prototype-strip')).includes('Sample data, nothing is really sent') && (await tid(page, 'prototype-strip-link').getAttribute('href')).includes('dashboard.html#/about'));
    check('document title is the live brand', (await page.title()) === 'Voltmere Electrical: Local electrician. Booked in 60 seconds.', await page.title());
    check('H1 has the promise', (await page.locator('h1').first().innerText()).includes('60 seconds'));

    // hero: live availability and price tiles
    const chips = await page.locator('[data-testid^="next-free-chip-"]').allInnerTexts();
    check('three live availability chips, first is Tomorrow 8-10am', chips.length === 3 && chips[0] === 'Tomorrow, 8–10am', JSON.stringify(chips));
    check('first chip deep-links to the details step', (await tid(page, 'next-free-chip-0').getAttribute('href')) === '#book/fault/2026-10-24/0');
    for (const [id, price] of [['fault', 'From £75'], ['eicr', 'From £150'], ['sockets', 'From £85'], ['consumer', 'From £540']]) {
      check(`hero tile ${id} shows ${price}`, (await txt(page, `hero-tile-${id}`)).includes(price), await txt(page, `hero-tile-${id}`));
    }
    check('hero trust line says (sample)', (await txt(page, 'hero-trust')).includes('4.9 rating (sample)'));

    // sample labelling, FAQ, footer
    check('reviews chip says SAMPLE REVIEWS', (await txt(page, 'reviews-sample-chip')).includes('SAMPLE REVIEWS'));
    const rv = await tid(page, 'reviews').innerText();
    check('every review card is tagged "Sample review"', (rv.match(/Sample review/g) || []).length === 3 && rv.includes('4.9 out of 5 from 212 reviews (sample)'));
    check('six FAQ items', (await page.locator('[data-testid^="faq-item-"]').count()) === 6);
    await tid(page, 'faq-item-0').locator('summary').click();
    check('FAQ item opens', await tid(page, 'faq-item-0').evaluate((el) => el.open));
    check('footer: owner login (demo) link to dashboard Today', (await txt(page, 'footer-owner-link')).includes('Owner login (demo)') && (await tid(page, 'footer-owner-link').getAttribute('href')).includes('dashboard.html#/today'));
    check('footer: about link', (await tid(page, 'footer-about-link').getAttribute('href')).includes('dashboard.html#/about'));
    check('footer: prototype disclosure', (await txt(page, 'footer-disclosure')).startsWith('This is a prototype.'));
    check('footer: appearance toggle', (await tid(page, 'theme-dark').count()) === 1);

    // sticky bar
    if (vp.width < 768) {
      check('sticky Call / WhatsApp / Book bar visible', await tid(page, 'sticky-bar').isVisible() && await tid(page, 'sticky-call').isVisible() && await tid(page, 'sticky-whatsapp').isVisible() && await tid(page, 'sticky-book').isVisible());
      check('sticky links are tel: and wa.me', (await tid(page, 'sticky-call').getAttribute('href')) === 'tel:+447700900412' && (await tid(page, 'sticky-whatsapp').getAttribute('href')).startsWith('https://wa.me/447700900412'));
      const box = await tid(page, 'sticky-bar').boundingBox();
      check('sticky bar is pinned to the bottom', Math.abs(box.y + box.height - vp.height) < 2, JSON.stringify(box));
      // the hero must show chip, H1, trust line and the first row of tiles above the sticky bar
      const hb = await tid(page, 'hero-tile-fault').boundingBox();
      check('first tile row is on the first screen', hb && hb.y + 60 < box.y, JSON.stringify(hb));
    } else {
      check('sticky bar hidden on desktop', !(await tid(page, 'sticky-bar').isVisible()));
      check('desktop header has phone link and Book a visit', await page.getByRole('link', { name: /07700 900412/ }).first().isVisible());
    }
    await shot(page, `landing-${name}`);
    await ctx.close();
  });
}
await landingLoad('375-light', MOBILE, 'light');
await landingLoad('375-dark', MOBILE, 'dark');
await landingLoad('1280-light', DESKTOP, 'light');

// ================================================================ 2. booking flow (customer mode, 375)
await section('2a. service tile -> When -> Details -> Confirmation -> calendar -> manage -> cancel', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'hero-tile-eicr').click();
  await sheetOpen(page);
  check('tile opens #book/eicr', (await hashOf(page)) === '#book/eicr');
  check('sticky bar hidden while the sheet is open', !(await tid(page, 'sticky-bar').isVisible()));
  check('EICR property size control, house preselected', (await tid(page, 'eicr-size-house').getAttribute('aria-checked') ?? await tid(page, 'eicr-size-house').getAttribute('aria-pressed') ?? 'true') !== 'false');
  check('soonest card is the EICR half-day answer (Mon 26 Oct morning)', (await txt(page, 'soonest-card')).includes('Mon 26 Oct, morning'), await txt(page, 'soonest-card'));
  check('continue is disabled until a window is chosen', (await tid(page, 'booking-continue').getAttribute('aria-disabled')) === 'true');
  await tid(page, 'soonest-pick').click();
  await tid(page, 'booking-continue').click();
  await until(async () => (await hashOf(page)) === '#book/eicr/2026-10-26/0');
  check('Continue goes to the Details deep link', (await hashOf(page)) === '#book/eicr/2026-10-26/0', await hashOf(page));
  check('ticket shows Fixed £195', (await txt(page, 'booking-ticket')).includes('Fixed £195'));
  // validation first
  await tid(page, 'booking-submit').click();
  await page.waitForTimeout(200);
  const bodyText = await tid(page, 'booking-sheet').innerText();
  check('empty submit shows the four inline errors', ['Enter your name', 'Enter your mobile number', 'Enter your postcode', 'Enter your house number and street'].every((m) => bodyText.includes(m)));
  await tid(page, 'demo-fill').click();
  check('demo-fill fills Priya Nair', (await tid(page, 'field-name').inputValue()) === 'Priya Nair' && (await tid(page, 'field-phone').inputValue()) === '07700 900231' && (await tid(page, 'field-postcode').inputValue()) === 'MB3 4QP');
  check('postcode hint says in Dan\'s area', (await txt(page, 'postcode-hint')).includes('In Dan'));
  check('submit button carries the price', (await txt(page, 'booking-submit')) === 'Confirm booking · £195');
  await tid(page, 'booking-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: 5000 });
  check('confirmation route #booked/VM-1043', (await hashOf(page)) === '#booked/VM-1043', await hashOf(page));
  check('ref shown in monospace', (await txt(page, 'confirmation-ref')) === 'VM-1043');
  check('title "You\'re booked in, Priya."', (await txt(page, 'confirmation-title')) === "You're booked in, Priya.");
  check('status chip Confirmed', (await txt(page, 'confirmation-status')) === 'Confirmed');
  const tl = await txt(page, 'confirmation-timeline');
  check('timeline has the four steps', ['Just now', 'Sunday evening', 'On the day', 'After the job'].every((s) => tl.includes(s)), tl);
  check('breaker art: six switches, the third is the customer\'s', (await page.locator('[data-testid="breaker-art"] .lp-breaker__unit').count()) === 6 && (await page.locator('[data-testid="breaker-art"] .lp-breaker__unit').nth(2).getAttribute('class')).includes('--yours'));
  check('ticket says Dan gets a WhatsApp alert (simulated)', (await txt(page, 'confirmation-ticket')).includes('WhatsApp alert (simulated'));
  check('DEMO panel labelled', (await txt(page, 'demo-panel')).includes('DEMO · SIMULATED'));
  const ob = await txt(page, 'demo-owner-bubble');
  check('DEMO panel owner bubble is the real owner alert', ob.includes('New booking VM-1043') && ob.includes('Priya Nair'), ob);
  check('DEMO panel customer bubble is the confirmation text', (await txt(page, 'demo-panel')).includes('Ref VM-1043'));
  check('Open Dan\'s dashboard deep-links to the booking', /dashboard\.html#\/bookings\/bk_/.test(await tid(page, 'demo-open-dashboard').getAttribute('href')));
  await page.waitForTimeout(3000);
  await shot(page, 'confirmation-375');
  // add to calendar
  await tid(page, 'add-to-calendar').scrollIntoViewIfNeeded();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), tid(page, 'add-to-calendar').click()]);
  check('Add to calendar downloads an .ics', !!dl && /\.ics$/.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : 'no download');
  if (dl) {
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    check('.ics is a valid VEVENT for Mon 26 Oct 08:00-10:00', ics.startsWith('BEGIN:VCALENDAR') && ics.includes('BEGIN:VEVENT') && ics.includes('DTSTART:20261026T080000') && ics.includes('DTEND:20261026T120000') || ics.includes('DTEND:20261026T100000'), ics.slice(0, 400));
    check('.ics has the reference and the address', ics.includes('VM-1043') && ics.includes('14 Alder Row'));
  }
  // survives a refresh
  await page.reload({ waitUntil: 'networkidle' });
  await tid(page, 'confirmation').waitFor({ timeout: 5000 });
  check('confirmation survives a refresh', (await txt(page, 'confirmation-ref')) === 'VM-1043' && (await tid(page, 'demo-owner-bubble').count()) === 1);
  // manage + cancel (Mon 26 is more than 24h away)
  await tid(page, 'confirmation-manage').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-manage').click();
  await tid(page, 'manage-page').waitFor({ timeout: 5000 });
  check('Manage link works', (await hashOf(page)) === '#manage/VM-1043');
  check('manage shows status timeline and cancel', (await tid(page, 'manage-status-timeline').count()) === 1 && await tid(page, 'manage-cancel').isVisible());
  await tid(page, 'manage-cancel').click();
  await tid(page, 'manage-cancel-confirm').click();
  await until(async () => (await txt(page, 'manage-page')).includes('This booking was cancelled.'));
  check('cancelling shows "This booking was cancelled." and Book again', (await txt(page, 'manage-page')).includes('This booking was cancelled.') && /Book again/.test(await tid(page, 'manage-page').innerText()));
  await tid(page, 'booking-close').click();
  await sheetGone(page);
  check('close returns to the landing page', (await hashOf(page)) === '' && await tid(page, 'sticky-bar').isVisible());
  await tid(page, 'hero-tile-eicr').click();
  await sheetOpen(page);
  check('the cancelled window is free again (soonest is Mon 26 Oct)', (await txt(page, 'soonest-card')).includes('Mon 26 Oct, morning'));
  await page.goBack();
  check('browser Back closes the sheet in one step', await sheetGone(page));
  check('no console errors or off-site requests', log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0, [...log.errors, ...log.offsite, ...log.failed].join(' | '));
  await ctx.close();
});

await section('2b. hero chip -> Details, then the emergency path', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const page = await ctx.newPage();
  const log = watch(page);
  await site(page);
  await tid(page, 'next-free-chip-0').click();
  await sheetOpen(page);
  check('chip opens Details with the window preselected', (await hashOf(page)) === '#book/fault/2026-10-24/0' && (await txt(page, 'booking-ticket')).includes('Sat 24 Oct · arrive 8–10am'), await hashOf(page));
  await tid(page, 'demo-fill').click();
  await tid(page, 'booking-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: 5000 });
  check('chip booking confirmed (VM-1043, From £75)', (await txt(page, 'confirmation-ref')) === 'VM-1043' && (await txt(page, 'confirmation-ticket')).includes('From £75'));
  await tid(page, 'confirmation-done').scrollIntoViewIfNeeded();
  await tid(page, 'confirmation-done').click();
  await sheetGone(page);
  check('Done closes the sheet', (await tid(page, 'booking-sheet').count()) === 0 && (await hashOf(page)) === '');
  check('the hero chip moved on after that booking', (await txt(page, 'next-free-chip-0')) !== 'Tomorrow, 8–10am', await txt(page, 'next-free-chip-0'));
  // emergency
  await tid(page, 'emergency-toggle').scrollIntoViewIfNeeded();
  await tid(page, 'emergency-toggle').click();
  check('emergency strip opens with 999 advice and a tel: button', (await tid(page, 'emergency-call').getAttribute('href')) === 'tel:+447700900412' && (await tid(page, 'emergency-strip').innerText()).includes('999'));
  await tid(page, 'emergency-request').click();
  await sheetOpen(page);
  check('emergency path #book/emergency, 999 banner', (await hashOf(page)) === '#book/emergency' && (await tid(page, 'booking-sheet').innerText()).includes('call 999'));
  await tid(page, 'emergency-submit').click();
  check('no reason chosen shows the error', (await txt(page, 'error-reasons')).includes('Choose what is happening'));
  await tid(page, 'demo-fill').click();
  await tid(page, 'emergency-reason-no_power').click();
  await tid(page, 'emergency-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: 5000 });
  check('emergency confirmation: "Request sent, Priya." waiting for Dan', (await txt(page, 'confirmation-title')) === 'Request sent, Priya.' && (await txt(page, 'confirmation-status')).includes('Waiting for Dan to confirm'));
  check('emergency has no Add to calendar and shows the urgent timeline', (await tid(page, 'add-to-calendar').count()) === 0 && (await txt(page, 'confirmation-timeline')).includes('Dan has been alerted (simulated)'));
  check('emergency owner bubble is in the DEMO panel', (await txt(page, 'demo-owner-bubble')).length > 20);
  await shot(page, 'emergency-confirmation-375');
  check('no console errors or off-site requests', log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0, [...log.errors, ...log.offsite, ...log.failed].join(' | '));
  await ctx.close();
});

// ================================================================ 3. cross-page flow (one context, two pages)
await section('3. cross-page: landing (B) and dashboard (A) share one store', async () => {
  const ctx = await browser.newContext(ctxOpts(MOBILE));
  const A = await ctx.newPage();
  const logA = watch(A);
  await dash(A, '#/today');
  await A.waitForTimeout(600);
  const B = await ctx.newPage();
  const logB = watch(B);
  await site(B);
  const firstChipBefore = await txt(B, 'next-free-chip-0');
  check('B hero starts at Tomorrow 8-10am', firstChipBefore === 'Tomorrow, 8–10am', firstChipBefore);
  await A.bringToFront().catch(() => {});

  // (i) book on B at an edge postcode (needs Dan's OK) via the deep link for Fri 30 Oct 10-12
  await B.goto(`${BASE}/index.html?${CLOCK}#book/fault/2026-10-30/1`, { waitUntil: 'networkidle' });
  await sheetOpen(B);
  await tid(B, 'demo-fill').click();
  await tid(B, 'field-postcode').fill('MB12 6AB');
  await tid(B, 'booking-submit').click();
  await tid(B, 'confirmation').waitFor({ timeout: 5000 });
  const ref = await txt(B, 'confirmation-ref');
  check('B: booking made at the edge postcode, waits for Dan', ref === 'VM-1043' && (await txt(B, 'confirmation-status')).includes('Waiting for Dan to confirm'), ref + ' / ' + await txt(B, 'confirmation-status'));
  const href = await tid(B, 'demo-open-dashboard').getAttribute('href');
  const bookingId = (href.match(/#\/bookings\/(bk_[a-z0-9]+)/) || [])[1];
  check('B: DEMO panel links to the dashboard booking', !!bookingId, href);

  const toast = await until(async () => A.getByText(/New booking: Priya/).first().isVisible(), 8000, 150);
  check('A: "New booking: Priya" toast appeared without a reload', !!toast);
  await shot(A, 'A-toast-375');
  check('A: document title carries the unseen count', /^\(\d+\) /.test(await A.title()), await A.title());
  check('A: Bookings tab shows the new-booking badge', (await tid(A, 'tab-badge-bookings').count()) > 0 || (await tid(A, 'tab-badge-today').count()) > 0);
  await A.evaluate(() => { location.hash = '#/bookings'; });
  await until(async () => (await tid(A, 'bookings-list').count()) > 0, 4000);
  check('A: the booking is in #/bookings', (await tid(A, `booking-row-${bookingId}`).count()) === 1, bookingId);
  await A.evaluate(() => { location.hash = '#/messages'; });
  await until(async () => (await tid(A, 'messages-list').count()) > 0, 4000);
  const msgs = await txt(A, 'messages-list');
  check('A: Messages has the owner alert bubble for VM-1043', msgs.includes('New booking VM-1043') && msgs.includes('Priya Nair'), msgs.slice(0, 200));
  check('A: no customer confirmation yet (still waiting for Dan)', !msgs.includes("You're booked in: Fault finding"));

  // (ii) confirm on A -> customer confirmation appears, B flips live
  await A.evaluate((id) => { location.hash = '#/bookings/' + id; }, bookingId);
  await tid(A, 'job-primary').waitFor({ timeout: 5000 });
  check('A: job card primary action is Confirm', /confirm/i.test(await txt(A, 'job-primary')), await txt(A, 'job-primary'));
  await tid(A, 'job-primary').click();
  await A.waitForTimeout(500);
  await shot(A, 'A-after-confirm-375');
  const flipped = await until(async () => (await txt(B, 'confirmation-status')) === 'Confirmed', 8000, 150);
  check('B: confirmation chip flipped to Confirmed without a reload', !!flipped, await txt(B, 'confirmation-status'));
  const bubble = await until(async () => (await txt(B, 'demo-panel')).includes("You're booked in"), 4000);
  check('B: the customer confirmation bubble appeared in the DEMO panel', !!bubble);
  await A.evaluate(() => { location.hash = '#/messages'; });
  await until(async () => (await tid(A, 'messages-list').count()) > 0, 4000);
  const msgs2 = await txt(A, 'messages-list');
  check('A: Messages now has the customer confirmation for Priya', msgs2.includes('Hi Priya') && msgs2.includes('VM-1043'), msgs2.slice(0, 200));
  await B.locator('[data-testid="confirmation-done"]').scrollIntoViewIfNeeded();
  await tid(B, 'confirmation-done').click();
  await sheetGone(B);

  // (iii) block the first free window the hero advertises
  const advertised = await txt(B, 'next-free-chip-0');
  check('B: hero still advertises Tomorrow, 8–10am', advertised === 'Tomorrow, 8–10am', advertised);
  await A.evaluate(() => { location.hash = '#/calendar'; });
  await tid(A, 'calendar-view').waitFor({ timeout: 5000 });
  const dayBtn = tid(A, 'calendar-day-2026-10-24');
  await dayBtn.first().click();
  await tid(A, 'calendar-window-2026-10-24-0').first().click();
  await tid(A, 'calendar-block-open').click();
  await tid(A, 'block-label-dentist').click();
  await tid(A, 'block-confirm').click();
  const blockedShown = await until(async () => (await A.getByText('Blocked: Dentist').count()) > 0, 4000);
  check('A: Sat 24 Oct 8-10am shows "Blocked: Dentist"', !!blockedShown);
  await shot(A, 'A-blocked-375');
  await B.reload({ waitUntil: 'networkidle' });
  const after = await txt(B, 'next-free-chip-0');
  check('B (reloaded): the hero chip moved on', after !== advertised && after === 'Mon 26 Oct, 8–10am', after);
  const allChips = await B.locator('[data-testid^="next-free-chip-"]').allInnerTexts();
  check('B: no chip offers the blocked window', !allChips.includes('Tomorrow, 8–10am'), JSON.stringify(allChips));
  await B.goto(`${BASE}/index.html?${CLOCK}#book/fault`, { waitUntil: 'networkidle' });
  await sheetOpen(B);
  const cell = tid(B, 'day-chip-2026-10-24');
  const cellLabel = await cell.getAttribute('aria-label');
  const cellDisabled = (await cell.isDisabled()) || (await cell.getAttribute('aria-disabled')) === 'true';
  check('B: Sat 24 Oct is unselectable ("Full") in the booking sheet', cellDisabled && /Full/i.test(cellLabel || ''), cellLabel);
  await B.goto(`${BASE}/index.html?${CLOCK}#book/fault/2026-10-24/0`, { waitUntil: 'networkidle' });
  await sheetOpen(B);
  const stale = await until(async () => (await tid(B, 'slot-taken-banner').count()) > 0 || (await tid(B, 'booking-continue').count()) > 0, 3000);
  check('B: deep link to the blocked window falls back to When (not Details)', !!stale && (await tid(B, 'field-name').count()) === 0);
  await shot(B, 'B-blocked-window-375');
  await tid(B, 'booking-close').click();
  await sheetGone(B);

  // (iv) rebrand in Settings
  await A.evaluate(() => { location.hash = '#/settings'; });
  await tid(A, 'setting-business-name').waitFor({ timeout: 5000 });
  await tid(A, 'setting-business-name').fill('Sparkwell Electrical');
  await tid(A, 'setting-business-name').blur();
  await tid(A, 'setting-phone').fill('07700 900555');
  await tid(A, 'setting-phone').blur();
  await tid(A, 'service-price-fault').fill('90');
  await tid(A, 'service-price-fault').blur();
  await A.waitForTimeout(500);
  await shot(A, 'A-settings-375');
  await B.reload({ waitUntil: 'networkidle' });
  check('B (reloaded): document title has the new business name', (await B.title()).startsWith('Sparkwell Electrical'), await B.title());
  check('B: footer shows the new business name', (await txt(B, 'footer')).includes('Sparkwell Electrical'));
  check('B: sticky Call uses the new phone', (await tid(B, 'sticky-call').getAttribute('href')) === 'tel:+447700900555', await tid(B, 'sticky-call').getAttribute('href'));
  check('B: footer shows the new phone', (await txt(B, 'footer')).includes('07700 900555'));
  check('B: fault tile and service card show From £90', (await txt(B, 'hero-tile-fault')).includes('From £90') && (await txt(B, 'service-card-fault')).includes('From £90'), await txt(B, 'hero-tile-fault'));
  await shot(B, 'B-rebranded-375');

  // (v) resets
  await A.evaluate(() => { location.hash = '#/demo'; });
  await tid(A, 'demo-reset').waitFor({ timeout: 5000 });
  await tid(A, 'demo-reset').click();
  await tid(A, 'confirm-ok').click();
  await A.waitForTimeout(500);
  await B.reload({ waitUntil: 'networkidle' });
  check('B: after "Reset diary and messages" the blocked window is back on the hero', (await txt(B, 'next-free-chip-0')) === 'Tomorrow, 8–10am', await txt(B, 'next-free-chip-0'));
  check('B: the booking is gone from the diary (Manage says not found)', await (async () => { await B.goto(`${BASE}/index.html?${CLOCK}#manage/VM-1043`, { waitUntil: 'networkidle' }); await sheetOpen(B); const nf = (await tid(B, 'manage-not-found').count()) > 0; if (!nf) return false; await tid(B, 'booking-close').click(); await sheetGone(B); return true; })());
  check('B: diary reset keeps the new brand', (await B.title()).startsWith('Sparkwell Electrical'));
  await tid(A, 'demo-reset-all').click();
  await tid(A, 'confirm-ok').click();
  await A.waitForTimeout(500);
  await B.goto(`${BASE}/index.html?${CLOCK}`, { waitUntil: 'networkidle' });
  check('B: after "Reset everything" the default business name is back', (await B.title()).startsWith('Voltmere Electrical'), await B.title());
  check('B: default phone and price are back', (await tid(B, 'sticky-call').getAttribute('href')) === 'tel:+447700900412' && (await txt(B, 'hero-tile-fault')).includes('From £75'));
  await B.goto(`${BASE}/index.html?${CLOCK}#book`, { waitUntil: 'networkidle' });
  const errs = [...logA.errors, ...logB.errors];
  check('no console errors on either page', errs.length === 0, errs.join(' | '));
  check('no off-site or failed requests on either page', logA.offsite.length + logB.offsite.length + logA.failed.length + logB.failed.length === 0, [...logA.offsite, ...logB.offsite, ...logA.failed, ...logB.failed].join(' | '));
  await ctx.close();
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
