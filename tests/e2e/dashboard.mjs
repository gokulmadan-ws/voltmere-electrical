// tests/e2e/dashboard.mjs: lean end-to-end check of the owner dashboard (Playwright, Chromium, no build step).
//   node electrician/tests/e2e/dashboard.mjs
// Env: VERBOSE=1 (print passing checks too), BASE_URL (reuse a running server; otherwise a python http.server is started on a free port),
//      QA_DEPS_DIR (folder whose node_modules holds playwright-core), CHROME_PATH (Chromium binary).
// Covers: every dashboard route (375x812, light then dark: no console/page errors, no failed or off-site
// requests, no horizontal overflow, real views, tab bar), the WhatsApp label at 320px, toasts versus open
// sheets, and the owner journey (confirm, on my way, done + paid, insights, calendar block + undo,
// rebrand, messages and wa.me links) at the fixed clock. Exits non-zero on any failure.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/qa';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const NOW = 'now=2026-10-23T20:30&freeze=1';
const CTX = { timezoneId: 'Europe/London', locale: 'en-GB' };

const require = createRequire(path.join(QA_DEPS, '/'));
const { chromium } = require('playwright-core');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${detail}` : ''}`);
};

// ---------- server ----------

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

let server = null;
async function startServer() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const port = await freePort();
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', SITE_DIR], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i += 1) {
    try { const r = await fetch(`${base}/dashboard.html`); if (r.ok) return base; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('static server did not start');
}

// ---------- helpers ----------

const T = (id) => `[data-testid="${id}"]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let BASE = '';

async function newContext(browser, { w = 375, h = 812, scheme = 'light', theme } = {}) {
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: scheme
  });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* ignore */ } }, theme);
  return ctx;
}

/** Collect everything that should never happen on a clean page. */
function watch(page, bag) {
  let where = '';
  const origin = () => new URL(BASE).origin;
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') bag.push(`[${where}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => bag.push(`[${where}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => bag.push(`[${where}] request failed: ${r.url()} ${(r.failure() || {}).errorText || ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) bag.push(`[${where}] HTTP ${r.status()} ${r.url()}`);
    const u = r.url();
    if (!u.startsWith(origin()) && !u.startsWith('data:') && !u.startsWith('blob:')) bag.push(`[${where}] off-site request ${u}`);
  });
  return (w) => { where = w; };
}

async function gotoDash(page, hash, n = 0) {
  await page.goto(`${BASE}/dashboard.html?${NOW}&_=${n}${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(T('view-title'), { timeout: 5000 });
}

/** Wait until `fn` (run in the page) is truthy; returns the value or null. */
async function until(page, fn, arg, ms = 3000) {
  try { const h = await page.waitForFunction(fn, arg, { timeout: ms }); return await h.jsonValue(); } catch (e) { return null; }
}

const text = async (page, sel) => ((await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();

// ---------- 1. route sweep ----------

const ROUTES = ['today', 'calendar', 'bookings', 'bookings/bk_seed_08', 'customers', 'insights', 'more', 'settings', 'messages', 'demo', 'about', 'new'];
const IMMERSIVE = new Set(['bookings/bk_seed_08', 'new']);

async function sweep(browser, scheme) {
  const ctx = await newContext(browser, { scheme, theme: scheme });
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  let n = 0;
  for (const route of ROUTES) {
    setWhere(`${scheme} ${route}`);
    await gotoDash(page, `#/${route}`, n += 1);
    await sleep(350);
    const info = await page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tabbar"]');
      const r = tab ? tab.getBoundingClientRect() : null;
      return {
        over: document.documentElement.scrollWidth - window.innerWidth,
        stub: !!document.querySelector('[data-testid="view-stub"]') || /not built yet/i.test(document.body.innerText),
        crashed: !!document.querySelector('[data-testid="view-error"]'),
        title: (document.querySelector('[data-testid="view-title"]') || {}).textContent || '',
        tabVisible: !!(r && r.height > 0 && getComputedStyle(tab).display !== 'none' && r.bottom <= window.innerHeight + 1),
        dark: document.documentElement.getAttribute('data-theme')
      };
    });
    const tag = `${scheme} #/${route}`;
    check(`${tag}: real view with a title`, info.title.trim().length > 0 && !info.stub && !info.crashed, JSON.stringify(info));
    check(`${tag}: no horizontal overflow`, info.over <= 0, `scrollWidth - innerWidth = ${info.over}`);
    check(`${tag}: tab bar ${IMMERSIVE.has(route) ? 'hidden on detail screens' : 'visible'}`, IMMERSIVE.has(route) ? !info.tabVisible : info.tabVisible);
    if (scheme === 'dark') check(`${tag}: dark theme applied`, info.dark === 'dark', String(info.dark));
  }
  check(`${scheme}: no console errors, page errors, failed or off-site requests`, bag.length === 0, bag.slice(0, 6).join(' || '));
  await ctx.close();
}

// ---------- 2. known issues ----------

async function narrowChecks(browser) {
  // (a) WhatsApp label stays on one line at 320px and 375px.
  for (const w of [320, 375]) {
    const ctx = await newContext(browser, { w });
    const page = await ctx.newPage();
    await gotoDash(page, '#/today', w);
    await sleep(300);
    const wrapped = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="needs-you-whatsapp-"], [data-testid="next-up-whatsapp"]')].map((el) => {
      const label = [...el.querySelectorAll('*')].reverse().find((n) => /^\s*WhatsApp\s*$/.test(n.textContent)) || el;
      const range = document.createRange(); range.selectNodeContents(label);
      const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      return { id: el.dataset.testid, lines };
    }));
    check(`today @${w}px: WhatsApp labels render on one line (${wrapped.length} found)`, wrapped.length >= 2 && wrapped.every((x) => x.lines === 1), JSON.stringify(wrapped));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`today @${w}px: no horizontal overflow`, over <= 0, String(over));
    await ctx.close();
  }

  // (b) a toast must not cover an open sheet's primary action.
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await gotoDash(page, '#/bookings/bk_seed_08', 90);
    await page.click(T('job-primary')); // On my way -> ETA sheet
    await page.waitForSelector(T('eta-sheet'));
    await page.evaluate(async () => {
      const m = await import('/js/ui/toast.js');
      m.toast({ message: 'A toast that arrives while a sheet is open, long enough to wrap onto two lines.', actionLabel: 'View', duration: 20000 });
    });
    await sleep(450);
    const geo = await page.evaluate(() => {
      const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      return { toast: box('[data-testid="toast"]'), send: box('[data-testid="eta-send"]'), sheet: box('[data-testid="eta-sheet"]') };
    });
    const overlap = geo.toast && geo.send && !(geo.toast.bottom <= geo.send.top || geo.toast.top >= geo.send.bottom);
    check('toast with a sheet open: visible and does not cover the sheet primary button', !!geo.toast && !!geo.send && !overlap, JSON.stringify(geo));
    await ctx.close();
  }
}

// ---------- 3. the owner journey ----------

async function journey(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  setWhere('journey');
  await gotoDash(page, '#/today', 200);
  await sleep(400);

  // Today: Needs you + Next up.
  const needs = await page.locator('[data-testid^="needs-you-card-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('needs-you-card-', '')));
  check('today: Needs you lists the two seeded requests (urgent first)', needs.length === 2 && needs[0] === 'bk_seed_07' && needs[1] === 'bk_seed_11', needs.join(','));
  check('today: Next up is Hannah, button reads "On my way"',
    /Hannah/.test(await text(page, T('next-up'))) && (await text(page, `${T('next-up')} ${T('job-primary')}`)) === 'On my way');
  check('today: tab badge shows 2 need you', (await text(page, T('tab-badge-today'))) === '2');

  // Open the non-urgent needs-you booking and Confirm it.
  await page.click(T('needs-you-open-bk_seed_11'));
  await page.waitForSelector(T('booking-detail'));
  check('detail: Sam shows "New request" with a Confirm button', /New request/.test(await text(page, T('detail-status'))) && (await text(page, T('job-primary'))) === 'Confirm', await text(page, T('detail-status')));
  await page.click(T('job-primary'));
  const confirmed = await until(page, () => /Confirmed/.test((document.querySelector('[data-testid="detail-status"]') || {}).textContent || ''));
  check('detail: after Confirm the status reads Confirmed', !!confirmed, await text(page, T('detail-status')));
  check('detail: a toast with an Undo button appears', (await page.locator(T('toast-action'), { hasText: 'Undo' }).count()) > 0, await text(page, T('toast')));

  // Back on Today the card has left Needs you.
  await gotoDash(page, '#/today', 201);
  await sleep(300);
  check('today: confirmed request left Needs you', (await page.locator(T('needs-you-card-bk_seed_11')).count()) === 0);

  // Next job: On my way (30 min), Mark done (cash).
  await page.click(`${T('next-up')} ${T('job-primary')}`);
  await page.waitForSelector(T('eta-sheet'));
  await page.click(T('eta-option-30'));
  await page.click(T('eta-send'));
  await page.waitForSelector(T('eta-sheet'), { state: 'detached', timeout: 3000 });
  const onWay = await until(page, () => (document.querySelector('[data-testid="next-up"] [data-testid="job-primary"]') || {}).textContent === 'Mark done');
  check('today: after On my way (30 min) the button becomes Mark done', !!onWay, await text(page, `${T('next-up')} ${T('job-primary')}`));
  check('today: Next up shows "On the way since"', /On the way since/.test(await text(page, T('next-up'))), await text(page, T('next-up')));

  await page.click(`${T('next-up')} ${T('job-primary')}`);
  await page.waitForSelector(T('complete-sheet'));
  await page.click(T('paid-method-cash'));
  await page.click(T('complete-submit'));
  await page.waitForSelector(T('complete-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
  check('today: Mark done closes the sheet', (await page.locator(T('complete-sheet')).count()) === 0);

  // Insights: Collected rose from 850 to 925; Owed unchanged.
  await gotoDash(page, '#/insights', 202);
  await sleep(300);
  check('insights: Collected rose to £925', (await text(page, T('insights-collected'))).includes('£925'), await text(page, T('insights-collected')));
  check('insights: Owed stays £245', (await text(page, T('insights-owed'))).includes('£245'), await text(page, T('insights-owed')));

  // Calendar: block the free Saturday 8-10am window, Undo it; then block again and unblock from the row.
  await gotoDash(page, '#/calendar/2026-10-24', 203);
  await sleep(300);
  const win = T('calendar-window-2026-10-24-0');
  check('calendar: Sat 24 Oct 8-10am starts free', !/Blocked/.test(await text(page, win)), await text(page, win));
  await page.click(win);
  await page.click(T('calendar-block-open'));
  await page.click(T('block-label-dentist'));
  await page.click(T('block-confirm'));
  const blocked = await until(page, (s) => /Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  check('calendar: the window now reads Blocked', !!blocked, await text(page, win));
  await page.click(T('toast-action'));
  const reopened = await until(page, (s) => !/Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  check('calendar: Undo on the toast frees the window again', !!reopened, await text(page, win));

  await page.click(win);
  await page.click(T('calendar-block-open'));
  await page.click(T('block-label-dentist'));
  await page.click(T('block-confirm'));
  await until(page, (s) => /Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  const unblockBtn = page.locator('[data-testid^="calendar-unblock-"]:not([data-testid="calendar-unblock-group"])').first();
  await unblockBtn.click({ timeout: 3000 }).catch(() => {});
  // A single block unblocks with one tap, or after a confirm dialog; accept either.
  if (await page.locator(T('confirm-ok')).count()) await page.click(T('confirm-ok'));
  const freed = await until(page, (s) => !/Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  check('calendar: unblocking from the row frees the window', !!freed, await text(page, win));

  // Settings: rebrand and see it in the header.
  await gotoDash(page, '#/settings', 204);
  await page.fill(T('setting-business-name'), 'Ashby Sparks');
  await page.fill(T('setting-short-name'), 'Ashby');
  await page.locator(T('setting-short-name')).blur();
  const renamed = await until(page, () => (document.querySelector('.db-header__name') || {}).textContent === 'Ashby');
  check('settings: header shows the new short name', !!renamed, await text(page, '.db-header__name'));
  check('settings: document title uses the new name', /Ashby/.test(await page.title()), await page.title());
  check('settings: "Saved" indicator is present', (await page.locator(T('setting-saved')).count()) > 0);

  // Settings and Today agree on "Take next week off" (next Monday to Sunday).
  await gotoDash(page, '#/settings', 205);
  await page.click(T('dayoff-next-week'));
  const offA = await page.evaluate(async () => (await import('/js/core/store.js')).getState().settings.daysOff.map((d) => `${d.date}:${d.label}`).sort());
  await page.click(T('toast-action')); // Undo
  await gotoDash(page, '#/today', 206);
  await page.click(T('today-take-week-off'));
  const offB = await page.evaluate(async () => (await import('/js/core/store.js')).getState().settings.daysOff.map((d) => `${d.date}:${d.label}`).sort());
  check('take next week off: Settings and Today close the same 7 days (Mon 26 Oct to Sun 1 Nov)',
    offA.length === 7 && JSON.stringify(offA) === JSON.stringify(offB) && offA[0].startsWith('2026-10-26') && offA[6].startsWith('2026-11-01'), `${offA.join(',')} vs ${offB.join(',')}`);
  await page.click(T('toast-action')); // Undo, leave the diary open

  // Messages: new customer bubbles and wa.me links.
  await gotoDash(page, '#/messages', 207);
  await sleep(300);
  const msgs = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid^="message-msg_"]')];
    return cards.map((c) => ({
      id: c.dataset.testid, label: c.getAttribute('aria-label') || '', body: (c.querySelector('.ui-bubble') || c).textContent || '',
      href: (c.querySelector('[data-testid^="message-open-wa-"]') || {}).href || ''
    }));
  });
  const confirmedMsg = msgs.find((m) => /Confirmed/i.test(m.label) && /Sam/.test(m.label));
  const onWayMsg = msgs.find((m) => /way/i.test(m.label) && /Hannah/.test(m.label));
  check('messages: customer bubble for Sam\'s confirmation exists', !!confirmedMsg, msgs.slice(0, 4).map((m) => m.label).join(' | '));
  check('messages: customer bubble for Hannah\'s "on my way" exists and says 30 minutes', !!onWayMsg && /30/.test(onWayMsg.body), onWayMsg ? onWayMsg.body : 'missing');
  check('messages: every Open in WhatsApp href starts https://wa.me/44', msgs.length > 5 && msgs.every((m) => m.href.startsWith('https://wa.me/44')), msgs.filter((m) => !m.href.startsWith('https://wa.me/44')).map((m) => m.href).slice(0, 3).join(' '));

  check('journey: no console errors, page errors, failed or off-site requests', bag.length === 0, bag.slice(0, 6).join(' || '));
  await ctx.close();
}

// ---------- run ----------

let browser;
try {
  BASE = await startServer();
  console.log(`dashboard e2e against ${BASE}`);
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const steps = [['light route sweep', () => sweep(browser, 'light')], ['dark route sweep', () => sweep(browser, 'dark')],
    ['narrow viewport and toast', () => narrowChecks(browser)], ['owner journey', () => journey(browser)]];
  for (const [name, run] of steps) {
    try { await run(); } catch (e) { check(`${name}: ran to the end`, false, String(e && e.message || e).split('\n').slice(0, 3).join(' ')); }
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)); }
process.exit(failed.length ? 1 : 0);
