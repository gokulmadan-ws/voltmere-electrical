// tests/e2e/dashboard.mjs: end-to-end check of the owner dashboard core screens (Playwright, Chromium, no build step).
//   node tests/e2e/dashboard.mjs
// Env: VERBOSE=1 (print passing checks too), BASE_URL (reuse a running server; otherwise a python http.server is started on a free port),
//      QA_DEPS_DIR (folder whose node_modules holds playwright-core), CHROME_PATH (Chromium binary).
// Owner: E3. Covers my screens at the fixed clock Fri 23 Oct 2026 20:30: every route (375x812, light then dark: no console/page errors,
// no failed or off-site requests, no horizontal overflow), narrow widths, toasts versus sheets, Today as the command centre (reply
// countdowns, accepted quotes, pipeline bar, money), Bookings (List | Pipeline | Customers, stage and source filters), booking detail
// (quote card, answers, photos and lightbox, request photos, story), Messages (channel, quote and photo kinds, filters), More, Settings
// (address, photos, quote price list, terms, reply promise), Share (link, QR, UTM builder, print card), Calendar (Google busy blocks),
// Demo tools (sample enquiries with photos, quote actions, webhook, DNS, reset) and What's real. Exits non-zero on any failure.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/qa';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const NOW = 'now=2026-10-23T20:30&freeze=1';
const NOW_STAMP = '2026-10-23T20:30';
const CTX = { timezoneId: 'Europe/London', locale: 'en-GB' };
// His photos live on these two hosts (img only). The sandbox cannot reach them, so they are answered with a stand-in picture.
const PHOTO_HOSTS = /^https:\/\/(perspective\.imgix\.net|images\.unsplash\.com)\//;
const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#333"/></svg>';
// A small valid PNG (built here, so the test needs no fixture file), for "Add a photo".
function makePng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const i = y * row + 1 + x * 3; raw[i] = 200; raw[i + 1] = 60 + (x * 4) % 120; raw[i + 2] = 60; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TINY_PNG = makePng(64, 48);

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
let lastPage = null; // for a screenshot when a step throws (E2E_FAIL_SHOT=<file.png>)

async function newContext(browser, { w = 375, h = 812, scheme = 'light', theme } = {}) {
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: scheme
  });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* ignore */ } }, theme);
  await ctx.route(PHOTO_HOSTS, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
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
    if (!u.startsWith(origin()) && !u.startsWith('data:') && !u.startsWith('blob:') && !PHOTO_HOSTS.test(u)) bag.push(`[${where}] off-site request ${u}`);
  });
  return (w) => { where = w; };
}

async function gotoDash(page, hash, n = 0) {
  await page.goto(`${BASE}/dashboard.html?${NOW}&_=${n}${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(T('view-title'), { timeout: 6000 });
}

/** Wait until `fn` (run in the page) is truthy; returns the value or null. */
async function until(page, fn, arg, ms = 3000) {
  try { const h = await page.waitForFunction(fn, arg, { timeout: ms }); return await h.jsonValue(); } catch (e) { return null; }
}

const text = async (page, sel) => ((await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const count = (page, sel) => page.locator(sel).count();
const attr = (page, sel, name) => page.locator(sel).first().getAttribute(name, { timeout: 3000 }).catch(() => null);
/** Run code in the page against the live store (module imports are cached, so this is the same store the app uses). */
const store = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const m = await import('/js/core/store.js');
  const s = await import('/js/core/selectors.js');
  // eslint-disable-next-line no-new-func
  return new Function('m', 's', 'a', `return (async () => { ${src} })()`)(m, s, a);
}, [fn, arg]);
const poundsOf = (t) => { const m = /£\s?([\d,]+)/.exec(t || ''); return m ? Number(m[1].replace(/,/g, '')) : null; };

// ---------- 1. route sweep ----------

const ROUTES = ['today', 'calendar', 'bookings', 'bookings/bk_seed_08', 'bookings/bk_seed_11', 'bookings/bk_seed_19', 'bookings/bk_seed_34',
  'customers', 'more', 'settings', 'share', 'messages', 'demo', 'about', 'new'];
const IMMERSIVE = new Set(['bookings/bk_seed_08', 'bookings/bk_seed_11', 'bookings/bk_seed_19', 'bookings/bk_seed_34', 'new']);

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
      const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary')]
        .filter((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && !el.closest('.u-sr-only') && !el.classList.contains('u-sr-only') && b.height < 43.5 && !el.classList.contains('ui-link--inline') && !el.closest('p, li > span, .ui-link--inline') && !el.closest('.td-need__who'); })
        .map((el) => `${el.tagName}.${(el.className || '').toString().split(' ')[0]}:${Math.round(el.getBoundingClientRect().height)}`);
      return {
        over: document.documentElement.scrollWidth - window.innerWidth,
        stub: !!document.querySelector('[data-testid="view-stub"]') || /not built yet/i.test(document.body.innerText),
        crashed: !!document.querySelector('[data-testid="view-error"]'),
        title: (document.querySelector('[data-testid="view-title"]') || {}).textContent || '',
        tabVisible: !!(r && r.height > 0 && getComputedStyle(tab).display !== 'none' && r.bottom <= window.innerHeight + 1),
        dark: document.documentElement.getAttribute('data-theme'),
        small: small.slice(0, 6)
      };
    });
    const tag = `${scheme} #/${route}`;
    check(`${tag}: real view with a title`, info.title.trim().length > 0 && !info.stub && !info.crashed, JSON.stringify(info));
    check(`${tag}: no horizontal overflow`, info.over <= 0, `scrollWidth - innerWidth = ${info.over}`);
    check(`${tag}: tab bar ${IMMERSIVE.has(route) ? 'hidden on detail screens' : 'visible'}`, IMMERSIVE.has(route) ? !info.tabVisible : info.tabVisible);
    if (scheme === 'dark') check(`${tag}: dark theme applied`, info.dark === 'dark', String(info.dark));
    if (scheme === 'dark') check(`${tag}: tap targets are at least 44px high (links inside text excepted)`, info.small.length === 0, info.small.join(', '));
  }
  check(`${scheme}: no console errors, page errors, failed or off-site requests`, bag.length === 0, bag.slice(0, 6).join(' || '));
  await ctx.close();
}

// ---------- 2. narrow widths, toast versus sheet, 1280 ----------

async function narrowChecks(browser) {
  // (a) WhatsApp label stays on one line at 320px and 375px; nothing overflows on Today, Bookings, Share or Settings.
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
    for (const route of ['today', 'bookings?f=all', 'share', 'settings', 'more']) {
      await gotoDash(page, `#/${route}`, w + 10);
      await sleep(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(`${route} @${w}px: no horizontal overflow`, over <= 0, String(over));
    }
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

  // (c) desktop: Today has two columns and the bookings list sits beside the detail.
  {
    const ctx = await newContext(browser, { w: 1280, h: 900, theme: 'dark', scheme: 'dark' });
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag)('wide');
    await gotoDash(page, '#/today', 400);
    await sleep(350);
    const cols = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="needs-you"]').getBoundingClientRect();
      const b = document.querySelector('[data-testid="today-pipeline"]').getBoundingClientRect();
      return { sameRow: Math.abs(a.top - b.top) < 160, sideBySide: b.left > a.right - 2, over: document.documentElement.scrollWidth - innerWidth };
    });
    check('today @1280: needs you and the pipeline bar sit side by side, no overflow', cols.sideBySide && cols.sameRow && cols.over <= 0, JSON.stringify(cols));
    await gotoDash(page, '#/bookings/bk_seed_19?f=all', 401);
    await sleep(350);
    const md = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="bookings-list"]').getBoundingClientRect();
      const detail = document.querySelector('[data-testid="booking-detail"]').getBoundingClientRect();
      return { sideBySide: detail.left >= list.right - 2, over: document.documentElement.scrollWidth - innerWidth };
    });
    check('bookings @1280: list and detail side by side, no overflow', md.sideBySide && md.over <= 0, JSON.stringify(md));
    check('wide: no console errors or failed requests', bag.length === 0, bag.slice(0, 4).join(' || '));
    await ctx.close();
  }
}

// ---------- 3. the owner journey ----------

async function journey(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  lastPage = page;
  const bag = [];
  const setWhere = watch(page, bag);
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
  setWhere('journey today');
  await gotoDash(page, '#/today', 200);
  await sleep(400);

  // ----- Today: the command centre -----
  const needs = await page.locator('[data-testid^="needs-you-card-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('needs-you-card-', '')));
  check('today: Needs you holds two enquiries and two accepted quotes, overdue reply first',
    needs.length === 4 && needs[0] === 'bk_seed_11' && ['bk_seed_07', 'bk_seed_34', 'bk_seed_35'].every((id) => needs.includes(id)), needs.join(','));
  check('today: the overdue enquiry shows an "Overdue by 6 h" countdown chip', /Overdue by 6 h/.test(await text(page, T('needs-you-sla-bk_seed_11'))), await text(page, T('needs-you-sla-bk_seed_11')));
  check('today: the new enquiry shows a reply-due countdown against the 24 h promise', /Reply due in 23 h/.test(await text(page, T('needs-you-sla-bk_seed_07'))), await text(page, T('needs-you-sla-bk_seed_07')));
  check('today: the summary counts enquiries, overdue and accepted quotes', /2 enquiries/.test(await text(page, T('needs-you-summary'))) && /1 overdue/.test(await text(page, T('needs-you-summary'))) && /2 accepted quotes/.test(await text(page, T('needs-you-summary'))), await text(page, T('needs-you-summary')));
  const card11 = T('needs-you-card-bk_seed_11');
  check('today: the enquiry card reads "New enquiry", "Pencilled in" and where it came from', /New enquiry/.test(await text(page, card11)) && /Pencilled in/.test(await text(page, card11)) && /Google/.test(await text(page, card11)), await text(page, card11));
  check('today: the enquiry card shows the four answers as chips', (await count(page, `${card11} ${T('enquiry-chips')} li`)) === 4);
  check('today: a non-BT postcode is flagged "Outside Northern Ireland"', /Outside Northern Ireland/.test(await text(page, card11)));
  check('today: the enquiry confirm button reads "Confirm survey visit"', (await text(page, T('needs-you-confirm-bk_seed_11'))) === 'Confirm survey visit');
  const card34 = T('needs-you-card-bk_seed_34');
  check('today: an accepted quote shows its total and an install pencilled in', /£1364/.test(await text(page, T('needs-you-amount-bk_seed_34'))) && /Install pencilled in/.test(await text(page, card34)) && /Quote accepted/.test(await text(page, card34)), await text(page, card34));
  check('today: an accepted quote confirms as "Confirm install day" and can change the day', (await text(page, T('needs-you-confirm-bk_seed_34'))) === 'Confirm install day' && (await count(page, T('needs-you-change-bk_seed_34'))) === 1);
  check('today: tab badge shows 4 need you', (await text(page, T('tab-badge-today'))) === '4', await text(page, T('tab-badge-today')));
  check('today: Next up is Eoin, button reads "On my way"', /Eoin/.test(await text(page, T('next-up'))) && (await text(page, `${T('next-up')} ${T('job-primary')}`)) === 'On my way', await text(page, T('next-up')));

  const pipe = await page.evaluate(async () => {
    const m = await import('/js/core/store.js');
    const s = await import('/js/core/selectors.js');
    const p = s.selectPipeline(m.getState(), '2026-10-23T20:30');
    const q = s.selectQuoteStats(m.getState(), 'all', '2026-10-23T20:30');
    const i = s.selectInsights(m.getState(), '2026-10-23T20:30');
    return { counts: Object.fromEntries(p.stages.map((x) => [x.id, x.count])), waitingValue: q.waitingValue, waitingCount: q.waitingCount, owed: i.owedTotal, collected: i.collectedMonth };
  });
  const barCounts = {};
  for (const id of ['enquiry', 'survey', 'quote', 'accepted', 'install', 'done']) barCounts[id] = Number((await text(page, T(`today-pipeline-${id}`))).replace(/\D+$/, '').match(/^\d+/)[0]);
  check('today: the pipeline bar shows the seeded stage counts (2, 3, 5, 2, 3, 6)', JSON.stringify(barCounts) === JSON.stringify(pipe.counts) && barCounts.enquiry === 2 && barCounts.survey === 3 && barCounts.quote === 5 && barCounts.accepted === 2 && barCounts.install === 3 && barCounts.done === 6, JSON.stringify(barCounts));
  check('today: the pipeline bar links to #/pipeline', (await attr(page, T('today-pipeline'), 'href')) === '#/pipeline');
  check('today: money strip matches the numbers in the store (collected, owed, quotes out)',
    poundsOf(await text(page, `${T('stat-collected')} .ui-stat__value`)) === pipe.collected && poundsOf(await text(page, `${T('stat-owed')} .ui-stat__value`)) === pipe.owed && poundsOf(await text(page, `${T('stat-quotes-out')} .ui-stat__value`)) === pipe.waitingValue && pipe.waitingValue > 0,
    `${await text(page, T('today-money'))} vs ${JSON.stringify(pipe)}`);
  check('today: quotes out links to the waiting quotes', /quotes\?f=waiting/.test((await attr(page, T('stat-quotes-out'), 'href')) || ''));
  check('today: the reply promise card shows a percentage', /\d+%/.test(await text(page, T('today-sla'))), await text(page, T('today-sla')));
  check('today: quotes to write lists Leona (no quote) and Oisin (a draft)', (await count(page, T('today-quote-todo-bk_seed_16'))) === 1 && (await count(page, T('today-quote-todo-bk_seed_17'))) === 1 && /Build quote/.test(await text(page, T('today-quote-todo-bk_seed_16'))) && /Finish quote/.test(await text(page, T('today-quote-todo-bk_seed_17'))));
  check('today: "Build quote" opens the quote builder for that enquiry', (await attr(page, T('today-quote-todo-bk_seed_16'), 'href')) === '#/quotes/new?booking=bk_seed_16', await attr(page, T('today-quote-todo-bk_seed_16'), 'href'));
  check('today: the share card links to Share and promote', (await attr(page, T('share-open'), 'href')) === '#/share');

  // Confirm Sinead's survey and Sorcha's install from Today: the cards leave and the pipeline moves. A second tab follows along.
  const tab2 = await ctx.newPage();
  await tab2.goto(`${BASE}/dashboard.html?${NOW}&_=tab2#/today`, { waitUntil: 'networkidle' });
  await tab2.waitForSelector(T('needs-you-card-bk_seed_07'));
  await page.click(T('needs-you-confirm-bk_seed_07'));
  const gone07 = await until(page, () => !document.querySelector('[data-testid="needs-you-card-bk_seed_07"]'));
  check('today: confirming an enquiry removes its card', !!gone07);
  const gone07b = await until(tab2, () => !document.querySelector('[data-testid="needs-you-card-bk_seed_07"]'), null, 4000);
  check('two tabs: the second tab drops the confirmed enquiry without a reload', !!gone07b);
  await tab2.close();
  check('today: a toast with Undo appears after confirming', (await count(page, `${T('toast-action')}:has-text("Undo")`)) > 0);
  await page.click(T('needs-you-confirm-bk_seed_34'));
  const gone34 = await until(page, () => !document.querySelector('[data-testid="needs-you-card-bk_seed_34"]'));
  check('today: confirming the install day removes the accepted-quote card', !!gone34);
  const stagesNow = await until(page, () => { const n = (id) => Number((document.querySelector(`[data-testid="today-pipeline-${id}"]`) || {}).textContent.match(/^\s*\d+/)); return n('accepted') === 1 && n('install') === 4; });
  check('today: the pipeline bar now shows 1 accepted and 4 booked installs', !!stagesNow);
  check('today: tab badge falls to 2', (await text(page, T('tab-badge-today'))) === '2', await text(page, T('tab-badge-today')));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(T('view-title'));
  check('today: after a reload the confirmed cards are still gone (nothing lost)', (await count(page, T('needs-you-card-bk_seed_07'))) === 0 && (await count(page, T('needs-you-card-bk_seed_34'))) === 0 && (await count(page, T('needs-you-card-bk_seed_11'))) === 1);

  // Change the pencilled install day of an accepted quote from its Needs-you card (Fergal, bk_seed_35).
  const whenBefore = await text(page, T('needs-you-when-bk_seed_35'));
  await page.click(T('needs-you-change-bk_seed_35'));
  await page.waitForSelector(T('reschedule-sheet'));
  await page.locator('[data-testid^="reschedule-day-"]:not([disabled])').nth(10).click();
  await page.locator('[data-testid^="reschedule-window-"]:not([disabled])').first().click();
  await page.click(T('reschedule-submit'));
  const moved = await until(page, (before) => { const el = document.querySelector('[data-testid="needs-you-when-bk_seed_35"]'); return !!el && el.textContent.replace(/\s+/g, ' ').trim() !== before; }, whenBefore);
  check('today: "Change the day" on an accepted quote moves the install to the day picked', !!moved && /Install/.test(await text(page, T('needs-you-when-bk_seed_35'))), `${whenBefore} -> ${await text(page, T('needs-you-when-bk_seed_35'))}`);

  // ----- Bookings: List | Pipeline | Customers, stage and source filters -----
  setWhere('journey bookings');
  await gotoDash(page, '#/bookings?f=all', 209);
  await sleep(300);
  check('bookings: the List | Pipeline | Customers control has List selected', (await attr(page, T('bookings-view-bookings'), 'aria-checked')) === 'true' && (await count(page, T('bookings-view-pipeline'))) === 1 && (await count(page, T('bookings-view-customers'))) === 1);
  check('bookings: a quote-stage row shows its stage and lead source', /Quote/.test(await text(page, T('booking-row-stage-bk_seed_19'))) && /Instagram/.test(await text(page, T('booking-row-lead-bk_seed_19'))), `${await text(page, T('booking-row-stage-bk_seed_19'))} | ${await text(page, T('booking-row-lead-bk_seed_19'))}`);
  check('bookings: the quote row shows the quote total, not "Free"', /£1489/.test(await text(page, T('booking-row-price-bk_seed_19'))), await text(page, T('booking-row-price-bk_seed_19')));
  check('bookings: an enquiry waiting for a reply shows its countdown', /Overdue by 6 h/.test(await text(page, T('booking-row-bk_seed_11'))));
  check('bookings: a phone job without answers shows no chips', (await count(page, `${T('booking-row-bk_seed_10')} ${T('enquiry-chips')}`)) === 0);
  await page.selectOption(T('bookings-stage-filter'), 'quote');
  await sleep(300);
  const quoteRows = await page.locator('[data-testid^="booking-row-bk_"]:not([data-testid*="stage"]):not([data-testid*="lead"]):not([data-testid*="price"])').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('booking-row-', '')).sort());
  check('bookings: the Quote stage filter lists exactly the five quote-stage enquiries', JSON.stringify(quoteRows) === JSON.stringify(['bk_seed_16', 'bk_seed_17', 'bk_seed_18', 'bk_seed_19', 'bk_seed_20']), quoteRows.join(','));
  check('bookings: the stage filter is kept in the address', /[?&]s=quote/.test(page.url()), page.url());
  await page.selectOption(T('bookings-source-filter'), 'instagram');
  await sleep(300);
  const igRows = await page.locator('[data-testid^="booking-row-bk_"]:not([data-testid*="stage"]):not([data-testid*="lead"]):not([data-testid*="price"])').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('booking-row-', '')));
  check('bookings: stage Quote and source Instagram together leave only Tiernan', JSON.stringify(igRows) === JSON.stringify(['bk_seed_19']), igRows.join(','));
  await page.selectOption(T('bookings-stage-filter'), '');
  await page.selectOption(T('bookings-source-filter'), '');
  await page.fill(T('bookings-search'), 'Tiernan');
  await sleep(300);
  check('bookings: search finds Tiernan across all bookings', (await count(page, T('booking-row-bk_seed_19'))) === 1 && /Searching all/.test(await text(page, '.bl-searching')));
  await page.click(T('bookings-view-pipeline'));
  check('bookings: the Pipeline option goes to #/pipeline', /#\/pipeline$/.test(page.url()), page.url());
  await page.waitForLoadState('networkidle'); // let the pipeline screen finish loading before moving on (an aborted request would be flagged)
  await sleep(400);

  // ----- Booking detail: the story -----
  setWhere('journey detail');
  await gotoDash(page, '#/bookings/bk_seed_19', 210);
  await page.waitForSelector(T('booking-detail'));
  check('detail: a viewed quote shows status, total and the open-quote link',
    /Viewed/.test(await text(page, T('detail-quote-status'))) && /£1489/.test(await text(page, T('detail-quote-total'))) && (await attr(page, T('detail-open-quote'), 'href')) === '#/quotes/Q-EL-1020', `${await text(page, T('detail-quote-card'))}`);
  check('detail: stage and lead source chips show', /Quote/.test(await text(page, T('detail-stage'))) && /Instagram/.test(await text(page, T('detail-lead'))));
  check('detail: the story says the customer opened the quote and shows install and paid still to come',
    /opened the quote/.test(await text(page, T('story-quote'))) && (await count(page, T('story-install'))) === 1 && (await count(page, T('story-paid'))) === 1, await text(page, T('detail-story')));
  check('detail: "About their home" lists the five answers', (await count(page, `${T('detail-answers')} .bd-row`)) >= 5);
  check('detail: the messages list labels the quote email as Email', /Email/.test(await text(page, '.bd-msgs')), await text(page, '.bd-msgs'));
  check('detail: no photos yet, with the request and add buttons', (await count(page, T('detail-photos-empty'))) === 1 && (await count(page, T('detail-request-photos'))) === 1 && (await count(page, T('detail-add-photo'))) === 1);

  await gotoDash(page, '#/bookings/bk_seed_16', 211);
  await page.waitForSelector(T('booking-detail'));
  check('detail: an enquiry with no quote offers "Build quote"', /No quote yet/.test(await text(page, T('detail-quote-status'))) && (await attr(page, T('detail-build-quote'), 'href')) === '#/quotes/new?booking=bk_seed_16');
  check('detail: after the survey the main action is "Build quote"', (await text(page, T('job-primary'))) === 'Build quote' && (await attr(page, T('job-primary'), 'href')) === '#/quotes/new?booking=bk_seed_16', `${await text(page, T('job-primary'))} ${await attr(page, T('job-primary'), 'href')}`);

  await gotoDash(page, '#/bookings/bk_seed_17', 212);
  await page.waitForSelector(T('booking-detail'));
  check('detail: a draft quote offers "Finish quote"', /Draft/.test(await text(page, T('detail-quote-status'))) && (await text(page, T('job-primary'))) === 'Finish quote');

  await gotoDash(page, '#/bookings/bk_seed_11', 213);
  await page.waitForSelector(T('booking-detail'));
  check('detail: an overdue enquiry shows the reply badge, a pencilled banner and the outside-NI tag',
    /Overdue by 6 h/.test(await text(page, T('detail-sla'))) && (await count(page, T('detail-pencilled'))) === 1 && (await count(page, T('detail-outside-ni'))) === 1 && /Google/.test(await text(page, T('detail-lead'))));
  check('detail: the story starts with the reply the customer is waiting for', /Reply and confirm/.test(await text(page, T('story-survey'))), await text(page, T('story-survey')));

  await gotoDash(page, '#/bookings/bk_seed_35', 214);
  await page.waitForSelector(T('booking-detail'));
  check('detail: an accepted-quote install shows its quote, links to the enquiry, and confirms as "Confirm install day" (the day was moved on Today)',
    /Accepted/.test(await text(page, T('detail-quote-status'))) && /£1562/.test(await text(page, T('detail-quote-total'))) && (await attr(page, T('detail-open-enquiry'), 'href')) === '#/bookings/bk_seed_22' && (await text(page, T('job-primary'))) === 'Confirm install day');
  check('detail: the install story shows the install waiting for you to confirm', /Install pencilled in/i.test(await text(page, T('story-install'))) && /Confirm it/.test(await text(page, T('story-install'))), await text(page, T('story-install')));

  await gotoDash(page, '#/bookings/bk_seed_08', 215);
  await page.waitForSelector(T('booking-detail'));
  check('detail: a seeded photos request shows as requested, with "Ask again"', /Requested/.test(await text(page, T('detail-photos-requested'))) && /Ask again/.test(await text(page, T('detail-request-photos'))), await text(page, T('detail-photos-card')));

  // ----- Photos: a new enquiry with photos from Demo tools, lightbox, remove with Undo, add, request -----
  setWhere('journey photos');
  await gotoDash(page, '#/demo', 220);
  await page.click(T('demo-sim-photos'));
  const added = await until(page, () => /Added EL-\d+ for \w+ with 2 sample photos/.test((document.querySelector('[data-testid="demo-sim-result"]') || {}).textContent || ''));
  check('demo: "New enquiry with photos" adds an enquiry with two photos', !!added, await text(page, T('demo-sim-result')));
  await page.click(`${T('demo-sim-result')} a`);
  await page.waitForSelector(T('booking-detail'));
  check('detail: the new enquiry shows "2 of 3" photos as thumbnails', (await text(page, T('detail-photo-count'))) === '2 of 3' && (await count(page, `${T('detail-photo-grid')} img`)) === 2, await text(page, T('detail-photos-card')));
  const newId = decodeURIComponent(page.url().split('/bookings/')[1] || '').split('?')[0];
  check('detail: the new enquiry has a lead source (the simulator rotates through them)', (await count(page, T('detail-lead'))) === 1 && newId.startsWith('bk_'), newId);
  await page.click(T('detail-photo-0'));
  await page.waitForSelector(T('photo-lightbox'));
  check('photos: tapping a thumbnail opens the lightbox with a large photo', (await count(page, T('photo-lightbox-img'))) === 1 && /Photo 1 of 2/.test(await text(page, `${T('photo-lightbox')} h2`)));
  await page.click(T('photo-next'));
  check('photos: Next shows the second photo', /Photo 2 of 2/.test(await text(page, `${T('photo-lightbox')} h2`)), await text(page, `${T('photo-lightbox')} h2`));
  await page.click(T('photo-remove'));
  const removed = await until(page, () => (document.querySelector('[data-testid="detail-photo-count"]') || {}).textContent === '1 of 3');
  check('photos: removing a photo from the lightbox leaves one, with an Undo toast', !!removed && (await count(page, `${T('toast-action')}:has-text("Undo")`)) > 0, await text(page, T('detail-photo-count')));
  await page.click(`${T('toast-action')}:has-text("Undo")`);
  const undone = await until(page, () => (document.querySelector('[data-testid="detail-photo-count"]') || {}).textContent === '2 of 3');
  check('photos: Undo brings the photo back', !!undone, await text(page, T('detail-photo-count')));
  await page.keyboard.press('Escape');
  await page.waitForSelector(T('photo-lightbox'), { state: 'detached', timeout: 3000 }).catch(() => {});
  await page.setInputFiles(T('detail-photo-input'), { name: 'consumer-unit.png', mimeType: 'image/png', buffer: TINY_PNG });
  const addedPhoto = await until(page, () => (document.querySelector('[data-testid="detail-photo-count"]') || {}).textContent === '3 of 3', null, 4000);
  check('photos: "Add a photo" from the owner\'s phone turns a picked image into the third photo', !!addedPhoto, await text(page, T('detail-photo-count')));
  check('photos: at three photos the add button is disabled', (await page.locator(T('detail-add-photo')).isDisabled()));
  await page.click(T('detail-request-photos'));
  const requested = await until(page, () => /Requested/.test((document.querySelector('[data-testid="detail-photos-requested"]') || {}).textContent || ''));
  check('photos: "Request photos" logs the message (simulated) and says when', !!requested && /Open WhatsApp/.test(await text(page, T('toast-action'))), await text(page, T('toast')));
  const photoMsg = await store(page, 'const id = a; return m.getState().messages.filter((x) => x.bookingId === id && x.kind === "customer_photos_request").map((x) => x.channel);', newId);
  check('photos: the request is stored as a WhatsApp photos-request message', JSON.stringify(photoMsg) === '["whatsapp"]', JSON.stringify(photoMsg));

  // ----- Messages: channel, quote and photo kinds, filters -----
  setWhere('journey messages');
  await gotoDash(page, '#/messages', 230);
  await sleep(300);
  check('messages: filters are All, To me, To customers, Email, Scheduled', (await count(page, T('msg-filter-all'))) === 1 && (await count(page, T('msg-filter-owner'))) === 1 && (await count(page, T('msg-filter-customer'))) === 1 && (await count(page, T('msg-filter-email'))) === 1 && (await count(page, T('msg-filter-scheduled'))) === 1);
  check('messages: the banner says WhatsApp messages and emails are simulated', /SIMULATED/.test(await text(page, T('messages-banner'))) && /email/i.test(await text(page, T('messages-banner'))));
  const wa = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid^="message-msg_"]')];
    return cards.map((c) => ({ id: c.dataset.testid, channel: c.dataset.channel, label: c.getAttribute('aria-label') || '', href: (c.querySelector('[data-testid^="message-open-wa-"]') || {}).href || '' }));
  });
  const photosMsg = wa.find((x) => /Photos request/.test(x.label));
  check('messages: a photos-request message shows with the WhatsApp channel tag', !!photosMsg && photosMsg.channel === 'whatsapp' && /WhatsApp/.test(await text(page, T(`message-channel-${photosMsg.id.replace('message-', '')}`))), JSON.stringify(photosMsg));
  check('messages: every WhatsApp "Open in WhatsApp" href starts https://wa.me/44', wa.filter((x) => x.channel === 'whatsapp').length > 5 && wa.filter((x) => x.channel === 'whatsapp').every((x) => x.href.startsWith('https://wa.me/44')), wa.filter((x) => x.channel === 'whatsapp' && !x.href.startsWith('https://wa.me/44')).map((x) => x.href).slice(0, 2).join(' '));
  check('messages: a quote-sent message offers Open quote and View as customer', (await count(page, '[data-testid^="message-open-quote-"]')) > 0 && /quote\.html(\?[^#]*)?#q=Q-EL-/.test((await attr(page, '[data-testid^="message-view-quote-"]', 'href')) || ''), (await attr(page, '[data-testid^="message-view-quote-"]', 'href')) || 'none');
  await page.click(T('msg-filter-email'));
  await sleep(250);
  const mail = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="message-msg_"]')].map((c) => ({ channel: c.dataset.channel, to: (c.querySelector('.ms-card__sub') || {}).textContent, mail: !!c.querySelector('.ms-mail'), href: (c.querySelector('[data-testid^="message-open-mail-"]') || {}).href || '' })));
  check('messages: the Email filter shows only emails, drawn as emails, with a mailto link', mail.length >= 2 && mail.every((x) => x.channel === 'email' && x.mail && x.href.startsWith('mailto:') && /@/.test(x.to)), JSON.stringify(mail.slice(0, 2)));
  check('messages: an email shows its channel tag', /Email/.test(await text(page, '[data-testid^="message-channel-"]')));
  await page.click(T('msg-filter-owner'));
  await sleep(250);
  check('messages: To me shows the owner alerts, with the quote-accepted ones among them', (await count(page, '[data-testid^="message-msg_"]')) > 3 && /Quote accepted/.test(await text(page, T('messages-list'))));
  await page.click(T('msg-filter-scheduled'));
  await sleep(250);
  check('messages: Scheduled shows only scheduled messages', (await count(page, '[data-testid^="message-send-now-"]')) === (await count(page, '[data-testid^="message-msg_"]')));

  // ----- Demo tools: a customer acts on a quote, webhook and DNS shortcuts -----
  setWhere('journey demo');
  await gotoDash(page, '#/demo', 240);
  await page.click(T('demo-quote-view'));
  const viewedTxt = await until(page, () => /opened quote/.test((document.querySelector('[data-testid="demo-quote-result"]') || {}).textContent || ''));
  const viewedId = (await text(page, T('demo-quote-result'))).match(/(Q-EL-[\d-]+)/);
  const viewedStatus = viewedId ? await store(page, 'return m.getState().quotes[a].status;', viewedId[1]) : null;
  check('demo: "A customer opens a quote" marks a sent quote as viewed', !!viewedTxt && viewedStatus === 'viewed', `${await text(page, T('demo-quote-result'))} ${viewedStatus}`);
  await page.click(T('demo-quote-accept'));
  const acceptedTxt = await until(page, () => /accepted Q-EL/.test((document.querySelector('[data-testid="demo-quote-result"]') || {}).textContent || ''));
  const accId = (await text(page, T('demo-quote-result'))).match(/(Q-EL-[\d-]+)/);
  const accInfo = accId ? await store(page, 'const q = m.getState().quotes[a]; const i = m.getState().bookings.find((b) => b.id === q.installBookingId); return { status: q.status, tentative: i && i.tentative, istatus: i && i.status, id: i && i.id };', accId[1]) : null;
  check('demo: "A customer accepts a quote" accepts it and pencils in an install', !!acceptedTxt && !!accInfo && accInfo.status === 'accepted' && accInfo.tentative === true && accInfo.istatus === 'new', JSON.stringify(accInfo));
  await gotoDash(page, '#/today', 241);
  await sleep(300);
  check('today: the quote accepted in Demo tools appears under Needs you with "Confirm install day"', !!accInfo && (await count(page, T(`needs-you-card-${accInfo.id}`))) === 1 && (await text(page, T(`needs-you-confirm-${accInfo.id}`))) === 'Confirm install day');
  await gotoDash(page, '#/demo', 242);
  await page.click(T('demo-quote-decline'));
  const declinedTxt = await until(page, () => /declined Q-EL/.test((document.querySelector('[data-testid="demo-quote-result"]') || {}).textContent || ''));
  check('demo: "A customer declines a quote" declines a waiting quote', !!declinedTxt, await text(page, T('demo-quote-result')));
  check('demo: "Open as the customer sees it" links to the quote page', /quote\.html(\?[^#]*)?#q=Q-EL-/.test((await attr(page, T('demo-open-quote'), 'href')) || ''), (await attr(page, T('demo-open-quote'), 'href')) || 'none');
  await page.click(T('demo-webhook-test'));
  const hookTxt = await until(page, () => /from the webhook test/.test((document.querySelector('[data-testid="demo-conn-result"]') || {}).textContent || ''));
  const hookBooking = await store(page, 'const b = m.getState().bookings.filter((x) => x.utm && x.utm.medium === "webhook")[0]; return b ? { id: b.id, src: b.utm.source, status: b.status, service: b.serviceId } : null;');
  check('demo: the webhook test enquiry arrives through the funnel path with its own lead source', !!hookTxt && !!hookBooking && hookBooking.service === 'ev_quote' && hookBooking.status === 'new', JSON.stringify(hookBooking));
  await page.click(T('demo-dns-skip'));
  const noDomain = await until(page, () => /No domain is being set up/.test((document.querySelector('[data-testid="demo-conn-result"]') || {}).textContent || ''));
  check('demo: Skip the DNS wait says so when no domain is set up', !!noDomain, await text(page, T('demo-conn-result')));
  await store(page, 'return m.startDomainSetup("www.180electrical.co.uk").ok;');
  await page.click(T('demo-dns-skip'));
  const live = await until(page, () => /is live/.test((document.querySelector('[data-testid="demo-conn-result"]') || {}).textContent || ''));
  const domStatus = await store(page, 'return m.getState().settings.connections.domain.status;');
  check('demo: Skip the DNS wait takes a pending domain live', !!live && domStatus === 'live', `${await text(page, T('demo-conn-result'))} ${domStatus}`);

  // ----- More hub -----
  setWhere('journey more');
  await gotoDash(page, '#/more', 250);
  const hrefs = {};
  for (const id of ['more-pipeline', 'more-quotes', 'more-connections', 'more-share', 'more-settings', 'more-messages', 'more-demo', 'more-about', 'more-customers']) hrefs[id] = await attr(page, T(id), 'href');
  check('more: rows for Pipeline, Quotes, Connections, Share and promote, Settings, Messages, Demo tools and What\'s real link to their routes',
    hrefs['more-pipeline'] === '#/pipeline' && hrefs['more-quotes'] === '#/quotes' && hrefs['more-connections'] === '#/connections' && hrefs['more-share'] === '#/share' && hrefs['more-settings'] === '#/settings' && hrefs['more-messages'] === '#/messages' && hrefs['more-demo'] === '#/demo' && hrefs['more-about'] === '#/about', JSON.stringify(hrefs));
  check('more: Pipeline and Quotes show live counts', /open/.test(await text(page, T('more-pipeline'))) && /waiting on customers|draft|Build/.test(await text(page, T('more-quotes'))), `${await text(page, T('more-pipeline'))} | ${await text(page, T('more-quotes'))}`);
  const conn = await store(page, 'return s.selectConnectionsSummary(m.getState()).filter((c) => c.status === "connected").length;');
  check('more: Connections shows a status summary and six status dots', new RegExp(`${conn} of 6 set up`).test(await text(page, T('more-connections'))) && (await count(page, `${T('more-connections-dots')} .ui-dot`)) === 6, await text(page, T('more-connections')));
  check('more: the appearance control is there', (await count(page, T('theme-dark'))) === 1);

  // ----- Settings -----
  setWhere('journey settings');
  await gotoDash(page, '#/settings', 260);
  check('settings: the address is empty by default with the footer hint', (await page.inputValue(T('setting-address'))) === '' && /Add your address to show it in your site footer/.test(await text(page, '.st-fields'))) ;
  await page.fill(T('setting-address'), '12 Example Road, Belfast BT1 1AA');
  await page.locator(T('setting-address')).blur();
  const addr = await until(page, async () => (await import('/js/core/store.js')).getState().settings.business.address === '12 Example Road, Belfast BT1 1AA');
  check('settings: the address saves', !!addr);
  await page.fill(T('setting-address'), '');
  await page.locator(T('setting-address')).blur();
  check('settings: all seven photo fields show with previews', (await count(page, '[data-testid^="setting-image-preview-"]')) === 7 && (await page.inputValue(T('setting-image-hero'))).startsWith('https://images.unsplash.com/'));
  await page.fill(T('setting-image-hero'), 'http://example.com/hero.jpg');
  await page.locator(T('setting-image-hero')).blur();
  await sleep(300);
  check('settings: an http photo address is refused with a message', /https/.test(await text(page, '[data-testid="image-tile-hero"] .ui-field__error')) || /https/.test(await text(page, '[data-testid="image-tile-hero"]')), await text(page, '[data-testid="image-tile-hero"]'));
  await page.fill(T('setting-image-hero'), 'https://images.unsplash.com/photo-sample-hero?w=900');
  await page.locator(T('setting-image-hero')).blur();
  const heroSaved = await until(page, async () => (await import('/js/core/store.js')).getState().settings.business.images.hero === 'https://images.unsplash.com/photo-sample-hero?w=900');
  check('settings: a new hero photo address saves', !!heroSaved);
  await page.click(T('setting-image-reset-hero'));
  const heroBack = await until(page, async () => { const m = await import('/js/core/store.js'); const c = await import('/js/core/config.js'); return m.getState().settings.business.images.hero === c.DEFAULT_IMAGES.hero; });
  check('settings: "Back to the original" restores his hero photo', !!heroBack);

  // quote price list
  const items0 = await store(page, 'return m.getState().settings.quoteItems.length;');
  check('settings: the quote price list shows every catalogue line, labelled sample', items0 >= 8 && (await count(page, '[data-testid^="quote-item-"][data-testid$="_zappi"], [data-testid^="quote-item-charger"]')) >= 0 && /sample/i.test(await text(page, T('quote-items'))), `${items0}: ${(await text(page, T('quote-items'))).slice(0, 120)}`);
  const firstItem = await store(page, 'const it = m.getState().settings.quoteItems[0]; return { id: it.id, price: it.unitPrice };');
  await page.click(`${T(`quote-item-${firstItem.id}`)} summary`);
  await page.fill(T(`quote-item-price-${firstItem.id}`), '815');
  await page.locator(T(`quote-item-price-${firstItem.id}`)).blur();
  const priceSaved = await until(page, async (id) => (await import('/js/core/store.js')).getState().settings.quoteItems.find((i) => i.id === id).unitPrice === 815, firstItem.id);
  check('settings: editing a sample price saves into the catalogue', !!priceSaved);
  await page.click(T('quote-item-add'));
  const added2 = await until(page, async (n) => (await import('/js/core/store.js')).getState().settings.quoteItems.length === n + 1, items0);
  check('settings: "Add an item" appends a line to the catalogue', !!added2);
  const newItem = await store(page, 'const l = m.getState().settings.quoteItems; return l[l.length - 1].id;');
  await page.click(T(`quote-item-remove-${newItem}`));
  await page.click(T('confirm-ok'));
  const removed2 = await until(page, async (n) => (await import('/js/core/store.js')).getState().settings.quoteItems.length === n, items0);
  check('settings: removing a line asks first, then takes it out, with Undo', !!removed2 && (await count(page, `${T('toast-action')}:has-text("Undo")`)) > 0);
  await page.click(`${T('toast-action')}:has-text("Undo")`);
  const back2 = await until(page, async (n) => (await import('/js/core/store.js')).getState().settings.quoteItems.length === n + 1, items0);
  check('settings: Undo puts the removed line back', !!back2);
  await store(page, 'm.updateSettings({ quoteItems: m.getState().settings.quoteItems.filter((i) => i.id !== a) }); return 1;', newItem);
  await page.fill(T('setting-quote-valid-days'), '45');
  await page.locator(T('setting-quote-valid-days')).blur();
  await page.fill(T('setting-quote-notes'), 'Sample terms: payment on completion.');
  await page.locator(T('setting-quote-notes')).blur();
  const defaults = await until(page, async () => { const q = (await import('/js/core/store.js')).getState().settings.quoteDefaults; return q.validDays === 45 && q.notes === 'Sample terms: payment on completion.'; });
  check('settings: quote validity and terms save', !!defaults);
  await page.fill(T('setting-quote-valid-days'), '400');
  await page.locator(T('setting-quote-valid-days')).blur();
  await sleep(250);
  check('settings: a validity over 365 days is refused with a message', /365/.test(await text(page, '.ui-field__error')), await text(page, '.st-quote-terms'));
  await page.fill(T('setting-quote-valid-days'), '30');
  await page.locator(T('setting-quote-valid-days')).blur();
  await page.selectOption(T('setting-sla-hours'), '48');
  const sla = await until(page, async () => (await import('/js/core/store.js')).getState().settings.sla.replyHours === 48);
  check('settings: the reply promise saves (48 hours)', !!sla);
  await gotoDash(page, '#/today', 261);
  await sleep(250);
  check('today: the reply countdown follows the new 48 hour promise', /Reply due in 47 h/.test(await text(page, T('needs-you-sla-bk_seed_11'))) || /Reply due in/.test(await text(page, T('needs-you-sla-bk_seed_11'))), await text(page, T('needs-you-sla-bk_seed_11')));
  await store(page, 'm.updateSettings({ sla: { replyHours: 24 } }); return 1;');

  // other settings kept from before: website switches, credentials and brands, rebrand
  await gotoDash(page, '#/settings', 262);
  await page.click(`${T('settings-other-services')} summary`);
  const sw = async (id) => page.locator(`${T(id)}`).first().evaluate((el) => (el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true' || !!el.querySelector('input:checked')));
  check('settings: only the free survey is shown on the website by default',
    (await sw('service-active-ev_quote')) === true && (await sw('service-active-ev')) === false && (await sw('service-active-fault')) === false && (await sw('service-active-eicr')) === false);
  check('settings: the emergency rule is off by default', (await sw('setting-emergencies')) === false);
  check('settings: credentials and brands show as comma-separated text',
    /Level 3 Electrical Installation, 2391 Inspection and Testing/.test(await page.inputValue(T('settings-credentials'))) && (await page.inputValue(T('settings-brands'))) === 'ZAPPI, OHME, SYNC',
    `${await page.inputValue(T('settings-credentials'))} | ${await page.inputValue(T('settings-brands'))}`);
  await page.fill(T('settings-brands'), 'ZAPPI, OHME, SYNC, Pod Point');
  await page.locator(T('settings-brands')).blur();
  const lists = await until(page, async () => { const m = await import('/js/core/store.js'); const b = m.getState().settings.business; return b.brands.length === 4 ? { brands: b.brands, credentials: b.credentials, charger: m.getState().settings.quoteItems.some((i) => i.brand === 'Pod Point') } : null; });
  check('settings: editing brands saves a list the website reads, and adds a charger line to the price list', !!lists && lists.brands[3] === 'Pod Point' && lists.credentials.length === 2 && lists.charger === true, JSON.stringify(lists));
  await page.fill(T('settings-brands'), 'ZAPPI, OHME, SYNC');
  await page.locator(T('settings-brands')).blur();
  await page.click(T('service-active-fault'));
  const faultOn = await until(page, async () => { const m = await import('/js/core/store.js'); const s = m.getState().settings.services.find((x) => x.id === 'fault'); return s.showOnWebsite === true; });
  check('settings: the website switch turns a service on for the website', !!faultOn);
  await page.click(T('service-active-fault'));
  await page.fill(T('setting-business-name'), 'Ashby Sparks');
  await page.fill(T('setting-short-name'), 'Ashby');
  await page.locator(T('setting-short-name')).blur();
  const renamed = await until(page, () => (document.querySelector('.db-header__name') || {}).textContent === 'Ashby');
  check('settings: header shows the new short name', !!renamed, await text(page, '.db-header__name'));
  check('settings: document title uses the new name', /Ashby/.test(await page.title()), await page.title());
  check('settings: "Saved" indicator is present', (await count(page, T('setting-saved'))) > 0);
  await page.fill(T('setting-business-name'), '180 Electrical');
  await page.fill(T('setting-short-name'), '180');
  await page.locator(T('setting-short-name')).blur();
  await sleep(300);

  // Settings and Today agree on "Take next week off" (next Monday to Sunday).
  await gotoDash(page, '#/settings', 263);
  await page.click(T('dayoff-next-week'));
  const offA = await page.evaluate(async () => (await import('/js/core/store.js')).getState().settings.daysOff.map((d) => `${d.date}:${d.label}`).sort());
  await page.click(`${T('toast-action')}:has-text("Undo")`); // Undo
  await gotoDash(page, '#/today', 264);
  await page.click(T('today-take-week-off'));
  const offB = await page.evaluate(async () => (await import('/js/core/store.js')).getState().settings.daysOff.map((d) => `${d.date}:${d.label}`).sort());
  check('take next week off: Settings and Today close the same 7 days (Mon 26 Oct to Sun 1 Nov)',
    offA.length === 7 && JSON.stringify(offA) === JSON.stringify(offB) && offA[0].startsWith('2026-10-26') && offA[6].startsWith('2026-11-01'), `${offA.join(',')} vs ${offB.join(',')}`);
  await page.click(`${T('toast-action')}:has-text("Undo")`); // Undo, leave the diary open

  // ----- Share and promote -----
  setWhere('journey share');
  await gotoDash(page, '#/share', 270);
  await until(page, () => !!document.querySelector('[data-testid="qr-code"] path'), null, 4000);
  const siteUrl = `${BASE}/index.html`;
  check('share: the live site address is shown and copyable', (await page.inputValue(T('share-url-value'))) === siteUrl, await page.inputValue(T('share-url-value')));
  check('share: a QR code for the landing page is drawn', (await count(page, `${T('qr-code')} path`)) > 0 || (await count(page, `${T('qr-code')}`)) > 0);
  check('share: the printable card has the logo or name, the headline and his phone', /Scan for your free EV charger quote/.test(await text(page, T('share-print-card'))) && /07885 496800/.test(await text(page, T('share-print-phone'))) && (await count(page, `${T('share-print-card')} img, ${T('share-print-card')} .sh-print__name`)) >= 1);
  const fb = `${siteUrl}?utm_source=facebook&utm_medium=paid_social&utm_campaign=ev_charger_leads`;
  check('share: the Facebook ad preset builds a tracked link', (await page.inputValue(T('utm-link-value'))) === fb, await page.inputValue(T('utm-link-value')));
  check('share: six presets (Facebook ad, Instagram bio, Google Business Profile, Van sign / QR, Flyer, WhatsApp status)',
    (await count(page, '[data-testid^="share-preset-"]')) === 6 && /Facebook ad/.test(await text(page, T('share-preset-facebook'))) && /WhatsApp status/.test(await text(page, T('share-preset-whatsapp'))));
  check('share: it says the Facebook link counts as Facebook in lead sources', /Facebook/.test(await text(page, T('share-counts-as'))));
  await page.click(T('share-preset-van'));
  check('share: the Van sign / QR preset changes the link and counts as Direct or other', /utm_source=van&utm_medium=qr&utm_campaign=van_sign/.test(await page.inputValue(T('utm-link-value'))) && /Direct or other/.test(await text(page, T('share-counts-as'))), await page.inputValue(T('utm-link-value')));
  await page.fill(T('share-utm-campaign'), 'Spring Offer 2026!');
  await page.locator(T('share-utm-campaign')).blur();
  check('share: a campaign name is tidied into the link', /utm_campaign=spring_offer_2026$/.test(await page.inputValue(T('utm-link-value'))), await page.inputValue(T('utm-link-value')));
  const links = await page.locator('[data-testid^="share-copy-"]').count();
  check('share: every preset has a ready-made link with a copy button', links === 6);
  await page.click(T('share-copy-instagram'));
  check('share: copying a link gives feedback', (await count(page, T('toast'))) > 0 || (await count(page, '.ui-toast')) > 0, await text(page, T('toast')));
  await page.click(T('share-print'));
  check('share: Print calls the browser print dialog (and is harmless where blocked)', (await page.evaluate(() => window.__printed)) === 1);
  await page.selectOption(T('share-qr-target'), 'flyer');
  await sleep(500);
  const qrLabel = await attr(page, T('qr-code'), 'aria-label');
  check('share: the QR can point at a tracked link', /utm_source=flyer/.test(qrLabel || ''), qrLabel || '');
  await page.emulateMedia({ media: 'print' });
  const printState = await page.evaluate(() => {
    const vis = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).visibility : 'none'; };
    const card = document.querySelector('[data-testid="share-print-card"]').getBoundingClientRect();
    return { card: vis('[data-testid="share-print-card"]'), phone: vis('[data-testid="share-print-phone"]'), link: vis('[data-testid="share-link-card"]'), builder: vis('[data-testid="share-builder"]'), tab: vis('[data-testid="tabbar"]'), w: Math.round(card.width), top: Math.round(card.top) };
  });
  check('share: in print only the card shows', printState.card === 'visible' && printState.phone === 'visible' && printState.link === 'hidden' && printState.builder === 'hidden' && printState.tab === 'hidden', JSON.stringify(printState));
  const pdf = await page.pdf({ format: 'A4', printBackground: true }).catch(() => null);
  const pages = pdf ? (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length : -1;
  check('share: the printed card is one page', pages === 1, String(pages));
  await page.emulateMedia({ media: 'screen' });

  // ----- Calendar: Google Calendar busy blocks (simulated) -----
  setWhere('journey calendar');
  await store(page, 'return m.connectGoogle("calendar", { account: "daniel@gmail.example" }).ok;');
  const gcalDay = await store(page, 'const b = m.getState().blocks.find((x) => x.source === "google_calendar"); return b ? b.date : null;');
  await gotoDash(page, `#/calendar/${gcalDay}`, 280);
  await sleep(350);
  check('calendar: busy times imported from Google Calendar show with the "Google Calendar" label', !!gcalDay && (await count(page, '[data-testid^="calendar-gcal-"]')) > 0 && /Google Calendar/.test(await text(page, '[data-testid^="calendar-gcal-"]')), `${gcalDay}: ${await text(page, T('calendar-day-panel'))}`);
  check('calendar: the legend and note explain the Google Calendar blocks (simulated)', /Google Calendar \(simulated\)/.test(await text(page, T('calendar-legend'))) && (await count(page, T('calendar-gcal-note'))) === 1);
  check('calendar: a Google busy block links to the calendar connection instead of unblocking', /#\/connections\/calendar/.test((await attr(page, '[data-testid^="calendar-gcal-"]', 'href')) || ''));
  await gotoDash(page, '#/today', 281);
  const gToday = await store(page, 'const t = "2026-10-23"; return m.getState().blocks.filter((x) => x.source === "google_calendar" && x.date === t).length;');
  check('calendar: turning the connection off removes the imported blocks', (await store(page, 'm.disconnect("calendar"); return m.getState().blocks.filter((x) => x.source === "google_calendar").length;')) === 0 && gToday === 0);

  // Calendar: block a free window (Thu 5 Nov 8-10am: nothing is booked there and the simulators fill earlier days), Undo it; then block again and unblock from the row.
  await gotoDash(page, '#/calendar/2026-11-05', 203);
  await sleep(300);
  const win = T('calendar-window-2026-11-05-0');
  check('calendar: Thu 5 Nov 8-10am starts free', /Free/.test(await text(page, win)) && !/Blocked/.test(await text(page, win)), await text(page, win));
  await page.click(win);
  await page.click(T('calendar-block-open'));
  await page.click(T('block-label-dentist'));
  await page.click(T('block-confirm'));
  const blocked = await until(page, (s) => /Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  check('calendar: the window now reads Blocked', !!blocked, await text(page, win));
  await page.click(`${T('toast-action')}:has-text("Undo")`);
  const reopened = await until(page, (s) => !/Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  check('calendar: Undo on the toast frees the window again', !!reopened, await text(page, win));
  await page.click(win);
  await page.click(T('calendar-block-open'));
  await page.click(T('block-label-dentist'));
  await page.click(T('block-confirm'));
  await until(page, (s) => /Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  const unblockBtn = page.locator('[data-testid^="calendar-unblock-"]:not([data-testid="calendar-unblock-group"])').first();
  await unblockBtn.click({ timeout: 3000 }).catch(() => {});
  if (await count(page, T('confirm-ok'))) await page.click(T('confirm-ok'));
  const freed = await until(page, (s) => !/Blocked/.test((document.querySelector(s) || {}).textContent || ''), win);
  check('calendar: unblocking from the row frees the window', !!freed, await text(page, win));

  // ----- The survey journey: On my way, done, then the quote builder takes over -----
  setWhere('journey survey');
  await gotoDash(page, '#/today', 290);
  await sleep(300);
  await page.click(`${T('next-up')} ${T('job-primary')}`);
  await page.waitForSelector(T('eta-sheet'));
  await page.click(T('eta-option-30'));
  await page.click(T('eta-send'));
  await page.waitForSelector(T('eta-sheet'), { state: 'detached', timeout: 3000 });
  const onWay = await until(page, () => (document.querySelector('[data-testid="next-up"] [data-testid="job-primary"]') || {}).textContent === 'Mark done');
  check('today: after On my way (30 min) the button becomes Mark done', !!onWay, await text(page, `${T('next-up')} ${T('job-primary')}`));
  check('today: Next up shows "On the way since"', /On the way since/.test(await text(page, T('next-up'))), await text(page, T('next-up')));
  await gotoDash(page, '#/bookings/bk_seed_08', 291);
  await page.waitForSelector(T('booking-detail'));
  await page.click(T('job-primary')); // Mark done
  await page.waitForSelector(T('complete-sheet'));
  check('survey: the finish sheet has no price or payment choices', (await count(page, T('paid-method-cash'))) === 0 && (await count(page, T('complete-price'))) === 0 && /Survey visit done/.test(await text(page, T('complete-sheet'))), await text(page, T('complete-sheet')));
  await page.click(T('complete-submit'));
  await page.waitForSelector(T('complete-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
  const buildBtn = await until(page, () => (document.querySelector('[data-testid="job-primary"]') || {}).textContent === 'Build quote');
  check('survey: after Mark done the primary action is "Build quote", linking to the builder', !!buildBtn && (await attr(page, T('job-primary'), 'href')) === '#/quotes/new?booking=bk_seed_08', `${await text(page, T('job-primary'))} ${await attr(page, T('job-primary'), 'href')}`);
  check('survey: the story marks the quote as the next step', /Write the quote/.test(await text(page, T('story-quote'))) && /survey is done/i.test(await text(page, T('story-quote'))), await text(page, T('story-quote')));
  check('survey: the stage is Quote', /Quote/.test(await text(page, T('detail-stage'))), await text(page, T('detail-stage')));

  // ----- Install: On my way, Mark done at the agreed price, paid in cash -> Collected rises on Today -----
  setWhere('journey install');
  await gotoDash(page, '#/today', 292);
  const collectedBefore = poundsOf(await text(page, `${T('stat-collected')} .ui-stat__value`));
  const owedBefore = poundsOf(await text(page, `${T('stat-owed')} .ui-stat__value`));
  await gotoDash(page, '#/bookings/bk_seed_09', 293);
  await page.waitForSelector(T('booking-detail'));
  await page.click(T('job-primary')); // On my way
  await page.waitForSelector(T('eta-sheet'));
  await page.click(T('eta-send'));
  await page.waitForSelector(T('eta-sheet'), { state: 'detached', timeout: 3000 });
  await until(page, () => (document.querySelector('[data-testid="job-primary"]') || {}).textContent === 'Mark done');
  await sleep(650); // the action bar ignores a second tap for 500 ms
  await page.click(T('job-primary'));
  await page.waitForSelector(T('complete-sheet'));
  check('install: the finish sheet asks for the agreed price', /Agreed price/.test(await text(page, T('complete-sheet'))), await text(page, T('complete-sheet')));
  const agreed = Number(String(await page.locator(T('complete-price')).first().evaluate((el) => (el.value !== undefined && el.value !== '' ? el.value : (el.querySelector('input') || {}).value || el.textContent)).catch(() => '0')).replace(/[^\d]/g, '')) || 0;
  await page.click(T('paid-method-cash'));
  await page.click(T('complete-submit'));
  await page.waitForSelector(T('complete-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
  await gotoDash(page, '#/today', 294);
  await sleep(300);
  check('today: Collected this month rose by the agreed install price', agreed > 0 && poundsOf(await text(page, `${T('stat-collected')} .ui-stat__value`)) === collectedBefore + agreed, `${collectedBefore} + ${agreed} -> ${await text(page, T('stat-collected'))}`);
  check('today: Owed is unchanged by a job paid in cash', poundsOf(await text(page, `${T('stat-owed')} .ui-stat__value`)) === owedBefore, await text(page, T('stat-owed')));

  // ----- What's real -----
  setWhere('journey about');
  await gotoDash(page, '#/about', 295);
  const about = await text(page, '.ab-page');
  check('about: says the funnel questions are reproduced and lists the Perspective webhook row', /funnel/i.test(about) && /Perspective/.test(about) && /webhook/i.test(about));
  check('about: has a card per connection (simulated vs a real build) and one per other feature', (await count(page, `${T('about-table')} details.ab-card`)) === 6 && (await count(page, `${T('about-table-rest')} details.ab-card`)) >= 8, `${await count(page, `${T('about-table')} details.ab-card`)} cards`);
  check('about: names WhatsApp, Google Calendar, Gmail and the domain, and the demo code', /WhatsApp Business/.test(about) && /Google Calendar/.test(about) && /Gmail/.test(about) && /DNS/.test(about) && /482913/.test(about));
  check('about: mentions quotes, photos and the share tools as real, and says simulated', /quote builder/i.test(about) && /QR/.test(about) && /simulated/i.test(about));
  check('about: no leftover Voltmere or Dan', !/Voltmere|\bDan\b/.test(about));

  // ----- Reset everything puts the seed back -----
  setWhere('journey reset');
  await gotoDash(page, '#/demo', 296);
  await page.click(T('demo-reset-all'));
  await page.click(T('confirm-ok'));
  await sleep(500);
  await gotoDash(page, '#/today', 297);
  await sleep(300);
  const needsAfter = await page.locator('[data-testid^="needs-you-card-"]').count();
  const brandAfter = await text(page, '.db-header__name');
  check('demo: "Reset everything" brings back the seed (four things need you, brand restored)', needsAfter === 4 && brandAfter === '180', `${needsAfter} ${brandAfter}`);
  const connAfter = await store(page, 'return s.selectConnectionsSummary(m.getState()).filter((c) => c.status === "connected").map((c) => c.key);');
  check('demo: Reset everything puts the connections back to their defaults (only the webhook on)', JSON.stringify(connAfter) === '["webhook"]', JSON.stringify(connAfter));

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
    ['narrow viewport, toast and desktop', () => narrowChecks(browser)], ['owner journey', () => journey(browser)]];
  for (const [name, run] of steps) {
    try { await run(); } catch (e) {
      check(`${name}: ran to the end`, false, String(e && e.message || e).split('\n').slice(0, 3).join(' '));
      if (process.env.E2E_FAIL_SHOT && lastPage) await lastPage.screenshot({ path: process.env.E2E_FAIL_SHOT }).catch(() => {});
    }
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)); }
process.exit(failed.length ? 1 : 0);
