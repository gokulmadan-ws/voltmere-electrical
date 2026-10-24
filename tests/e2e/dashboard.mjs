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
const tagOf = (page, sel) => page.locator(sel).first().evaluate((el) => el.tagName).catch(() => '');
const attr = (page, sel, name) => page.locator(sel).first().getAttribute(name, { timeout: 3000 }).catch(() => null);
/** Run code in the page against the live store (module imports are cached, so this is the same store the app uses). */
const store = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const m = await import('/js/core/store.js');
  const s = await import('/js/core/selectors.js');
  // eslint-disable-next-line no-new-func
  return new Function('m', 's', 'a', `return (async () => { ${src} })()`)(m, s, a);
}, [fn, arg]);
/** Settings is a single-open accordion: open one section by its id (business, photos, services, quotes, availability, rules). */
async function openSection(page, id) {
  const head = page.locator(T(`settings-section-${id}`));
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await sleep(150);
}
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
    // Needs you: the hero (a new enquiry) has Call and WhatsApp side by side as labelled buttons; every other item is a compact row with ONE verb button.
    const acts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="needs-you-whatsapp-"]')].map((el) => {
      const row = el.parentElement.getBoundingClientRect();
      const call = el.parentElement.querySelector('[data-testid^="needs-you-call-"]').getBoundingClientRect();
      const wa = el.getBoundingClientRect();
      return { id: el.dataset.testid, label: el.getAttribute('aria-label'), text: el.textContent.trim(), w: Math.round(wa.width), h: Math.round(wa.height), oneRow: Math.abs(call.top - wa.top) < 2 && wa.right <= row.right + 1 && wa.left >= call.right - 1 };
    }));
    check(`today @${w}px: the hero keeps Call and WhatsApp on one row as labelled buttons, at least 44px tall (${acts.length} found)`, acts.length === 1 && acts.every((x) => x.oneRow && x.w >= 44 && x.h >= 44 && x.text === 'WhatsApp' && /WhatsApp/.test(x.label || '')), JSON.stringify(acts));
    const verbs = await page.evaluate(() => [...document.querySelectorAll('li.td-crow')].map((li) => {
      const btns = [...li.querySelectorAll('.td-crow__acts .ui-btn:not(.ui-icon-btn)')];
      const b = btns[0].getBoundingClientRect();
      return { id: li.dataset.testid, n: btns.length, h: Math.round(b.height), inside: b.left >= 0 && b.right <= innerWidth };
    }));
    check(`today @${w}px: every compact row has ONE verb button, at least 44px tall and inside the screen (${verbs.length} rows)`, verbs.length === 3 && verbs.every((x) => x.n === 1 && x.h >= 44 && x.inside), JSON.stringify(verbs));
    for (const route of ['today', 'bookings?f=all', 'share', 'settings', 'more']) {
      await gotoDash(page, `#/${route}`, w + 10);
      await sleep(250);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(`${route} @${w}px: no horizontal overflow`, over <= 0, String(over));
    }
    await ctx.close();
  }

  // (a2) on another tab the arrival toast is brief and floats above the tab bar AND the + button; Today and the Insights tab have no + button.
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await gotoDash(page, '#/bookings', 91);
    await page.waitForSelector(T('toast'), { timeout: 3000 }).catch(() => {});
    await sleep(500);
    const g = await page.evaluate(() => {
      const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const timer = document.querySelector('[data-testid="toast"] .ui-toast__timer');
      return { toast: box('[data-testid="toast"]'), fab: box('[data-testid="fab-new-booking"]'), bar: box('[data-testid="tabbar"]'), dur: timer ? parseFloat(getComputedStyle(timer).getPropertyValue('--toast-dur')) : 0 };
    });
    check('bookings: the arrival toast is brief (4 s) and sits above both the tab bar and the + button',
      !!g.toast && !!g.fab && !!g.bar && g.dur === 4000 && g.toast.bottom <= g.fab.top && g.toast.bottom <= g.bar.top, JSON.stringify(g));
    await gotoDash(page, '#/insights', 92);
    await sleep(300);
    check('insights: no + button', (await count(page, T('fab-new-booking'))) === 0);
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
      const box = (id) => { const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right }; };
      const a = box('needs-you'); const n = box('next-up'); const pipe = box('today-pipeline'); const avail = box('today-availability'); const q = box('today-quote-todo');
      return { sameRow: Math.abs(a.top - n.top) < 160, sideBySide: n.left > a.right - 2 && pipe.left > a.right - 2, over: document.documentElement.scrollWidth - innerWidth, left: Math.round(q.bottom), right: Math.round(avail.bottom) };
    });
    check('today @1280: Needs you (with Quotes to write) on the left, next up, diary and pipeline on the right, no overflow', cols.sideBySide && cols.sameRow && cols.over <= 0, JSON.stringify(cols));
    check('today @1280: the two columns end within about 200px of each other (no empty quadrant)', Math.abs(cols.left - cols.right) <= 200, JSON.stringify(cols));
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

  // ----- First 30 seconds on Today: no floating layers over the cards, an opaque tab bar, one clear switch -----
  check('today: a fresh load shows no "new bookings" toast and no + button (the cards are the actions)',
    (await count(page, T('toast'))) === 0 && (await count(page, T('fab-new-booking'))) === 0, `${await count(page, T('toast'))} toasts, ${await count(page, T('fab-new-booking'))} fabs`);
  const bar = await page.evaluate(() => {
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.querySelector('[data-testid="tabbar"]')).backgroundColor);
    const parts = m ? m[1].split(',').map((s) => parseFloat(s)) : [];
    return { alpha: parts.length === 4 ? parts[3] : 1 };
  });
  check('tab bar: fully opaque, so page text never ghosts through under the labels', bar.alpha === 1, JSON.stringify(bar));
  const switchGeo = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="today-taking-bookings"]');
    if (!el) return null;
    const body = el.querySelector('.ui-switch__body').getBoundingClientRect();
    const thumb = el.querySelector('.ui-switch__lever').getBoundingClientRect();
    return { on: el.getAttribute('aria-checked'), row: Math.round(el.getBoundingClientRect().height), w: Math.round(body.width), h: Math.round(body.height), thumbRight: (thumb.left + thumb.width / 2) - body.left > body.width / 2, led: !!el.querySelector('.ui-switch__led'), word: el.querySelector('.ui-switch__state').textContent };
  });
  const swOn = await switchGeo();
  check('switch: one 51x31 control, thumb on the right and "On" when on, no extra dot, row at least 56px',
    !!swOn && swOn.on === 'true' && swOn.w === 51 && swOn.h === 31 && swOn.thumbRight && !swOn.led && swOn.word === 'On' && swOn.row >= 56, JSON.stringify(swOn));
  await page.click(T('today-taking-bookings'));
  await sleep(400);
  const swOff = await switchGeo();
  check('switch: off puts the thumb on the left, says "Off" and stays tappable', !!swOff && swOff.on === 'false' && !swOff.thumbRight && swOff.word === 'Off' && swOff.row >= 56, JSON.stringify(swOff));
  await page.click(`${T('toast-action')}:has-text("Undo")`);
  await sleep(400);
  check('switch: Undo puts it back on', (await attr(page, T('today-taking-bookings'), 'aria-checked')) === 'true');

  // ----- Today: the command centre -----
  const needs = await page.locator('[data-testid^="needs-you-card-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('needs-you-card-', '')));
  check('today: Needs you holds two enquiries and two accepted quotes, in-area before outside-area (Conor, outside NI, last)',
    needs.length === 4 && needs[3] === 'bk_seed_11' && needs[0] !== 'bk_seed_11' && ['bk_seed_07', 'bk_seed_34', 'bk_seed_35'].every((id) => needs.includes(id)), needs.join(','));
  check('today: the header count equals the cards and rows listed', (await text(page, T('needs-you-count'))) === String(needs.length) && (await text(page, '.td-page .ui-page-header__sub')).includes(`${needs.length} need you`), `${await text(page, T('needs-you-count'))} vs ${needs.length}`);
  const hero = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('article[data-testid^="needs-you-card-"]')];
    const el = cards[0];
    const rows = [...document.querySelectorAll('li.td-crow')].map((li) => Math.round(li.getBoundingClientRect().height));
    return {
      n: cards.length, id: el && el.dataset.testid, top: el && Math.round(el.getBoundingClientRect().top + scrollY), h: el && Math.round(el.getBoundingClientRect().height),
      red: el ? el.querySelectorAll('.ui-btn--primary').length : 0, chips: el ? el.querySelectorAll('.en-chips li').length : 0, rows
    };
  });
  check('today: only the top item is a hero: Sinead, a 12 min old enquiry that starts above y=520, about 300px tall, with answer chips and Call + WhatsApp as the two red buttons',
    hero.n === 1 && hero.id === 'needs-you-card-bk_seed_07' && hero.top < 520 && hero.h <= 320 && hero.red === 2 && hero.chips >= 3 && /12 min old/.test(await text(page, T('needs-you-age-bk_seed_07'))), JSON.stringify(hero));
  check('today: the other three are compact rows of equal height, shown under the hero (no "+N more" heading)', hero.rows.length === 3 && new Set(hero.rows).size === 1 && (await count(page, `${T('needs-you-more')} li.td-crow`)) === 3, JSON.stringify(hero.rows));
  check('today: Sinead\'s hero has a pre-filled WhatsApp message and a Call link', /^https:\/\/wa\.me\/\d+\?text=Hi%20Sinead/.test((await attr(page, T('needs-you-whatsapp-bk_seed_07'), 'href')) || '') && /^tel:/.test((await attr(page, T('needs-you-call-bk_seed_07'), 'href')) || ''), (await attr(page, T('needs-you-whatsapp-bk_seed_07'), 'href')) || '');
  check('today: Needs you has no stray dots and no left borders; stripes are urgency only (none while nothing is overdue in Northern Ireland)',
    (await page.evaluate(() => [...document.querySelectorAll('[data-testid^="needs-you-card-"]')].every((el) => getComputedStyle(el).borderLeftWidth === getComputedStyle(el).borderRightWidth && !el.hasAttribute('data-stripe') && getComputedStyle(el, '::before').content === 'none'))));
  check('today: no red "overdue" banner while the only overdue enquiry (Conor) is outside Northern Ireland', (await count(page, T('today-late-banner'))) === 0);
  check('today: the overdue enquiry shows an "Overdue by 6 h" countdown chip', /Overdue by 6 h/.test(await text(page, T('needs-you-sla-bk_seed_11'))), await text(page, T('needs-you-sla-bk_seed_11')));
  check('today: the fresh enquiry shows how old it is, not a calm reply-due countdown', /12 min old/.test(await text(page, T('needs-you-age-bk_seed_07'))) && (await count(page, T('needs-you-sla-bk_seed_07'))) === 0, await text(page, T('needs-you-age-bk_seed_07')));
  check('today: the summary adds up to the count (2 new enquiries, 2 accepted quotes)', /2 new enquiries/.test(await text(page, T('needs-you-summary'))) && /2 accepted quotes/.test(await text(page, T('needs-you-summary'))), await text(page, T('needs-you-summary')));
  const card11 = T('needs-you-card-bk_seed_11');
  check('today: the outside-NI overdue enquiry row says so (amber Outside NI pill, neutral reply chip, no red stripe) and its verb is Reply, not Confirm',
    (await count(page, T('needs-you-flag-bk_seed_11'))) === 1 && /Outside NI/.test(await text(page, T('needs-you-flag-bk_seed_11'))) && /check travel/.test(await text(page, T('needs-you-flag-bk_seed_11'))) && (await text(page, T('needs-you-reply-bk_seed_11'))) === 'Reply' && (await count(page, T('needs-you-confirm-bk_seed_11'))) === 0
      && (await attr(page, card11, 'data-stripe')) === null && /sh-sla--neutral/.test((await attr(page, T('needs-you-sla-bk_seed_11'), 'class')) || ''), await text(page, card11));
  await page.click(T('needs-you-more-bk_seed_11'));
  await page.waitForSelector(T('needs-you-menu-sheet'));
  check('today: its "..." menu has Confirm survey visit, Change the day and Decline', /Confirm survey visit/.test(await text(page, T('needs-you-confirm-bk_seed_11'))) && (await count(page, T('needs-you-change-bk_seed_11'))) === 1 && (await count(page, T('needs-you-decline-bk_seed_11'))) === 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector(T('needs-you-menu-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
  const card34 = T('needs-you-card-bk_seed_34');
  check('today: an accepted quote shows its total and an install pencilled in', /£1,364/.test(await text(page, T('needs-you-amount-bk_seed_34'))) && /Install pencilled in/.test(await text(page, card34)) && /Quote accepted/.test(await text(page, card34)), await text(page, card34));
  check('today: an accepted quote confirms as "Confirm install day"', (await text(page, T('needs-you-confirm-bk_seed_34'))) === 'Confirm install day');
  await page.click(T('needs-you-more-bk_seed_34'));
  await page.waitForSelector(T('needs-you-menu-sheet'));
  check('today: its "..." menu can change the day or cancel the install', (await count(page, T('needs-you-change-bk_seed_34'))) === 1 && (await count(page, T('needs-you-decline-bk_seed_34'))) === 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector(T('needs-you-menu-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
  check('today: tab badge shows 4 need you', (await text(page, T('tab-badge-today'))) === '4', await text(page, T('tab-badge-today')));
  check('today: Next up is a thin strip for Eoin with Navigate as its button, and no red "On my way" for a visit tomorrow', /Eoin/.test(await text(page, T('next-up'))) && (await text(page, T('next-up-navigate'))) === 'Navigate' && (await count(page, `${T('next-up')} ${T('job-primary')}`)) === 0 && (await count(page, `${T('next-up')} .ui-btn--primary`)) === 0 && (await page.evaluate(() => document.querySelector('[data-testid="next-up"]').getBoundingClientRect().height)) <= 100, await text(page, T('next-up')));

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
  check('today: the reply tile shows a percentage and there is no separate "reply promise" card', /\d+%/.test(await text(page, T('stat-replied'))) && (await count(page, T('today-sla'))) === 0, await text(page, T('stat-replied')));
  const tiles = await page.evaluate(() => {
    const t = (id) => document.querySelector(`[data-testid="${id}"]`);
    const r = (id) => { const b = t(id).getBoundingClientRect(); return Math.round(b.top + scrollY); };
    return { owed: r('stat-owed'), quotes: r('stat-quotes-out'), replied: r('stat-replied'), needs: r('needs-you'), next: r('next-up'), todo: r('today-quote-todo'), diary: r('today-jobs'), pipe: r('today-pipeline'), height: document.documentElement.scrollHeight, owedHref: t('stat-owed').getAttribute('href'),
      repliedTone: t('stat-replied').className, owedClass: t('stat-owed').className, tileH: Math.round(t('stat-owed').getBoundingClientRect().height), chevrons: ['stat-owed', 'stat-quotes-out', 'stat-replied'].every((id) => !!t(id).querySelector('svg')), owedPill: !!t('stat-owed').querySelector('.td-stat__pill'),
      owedColor: getComputedStyle(t('stat-owed').querySelector('.ui-stat__value')).color, textColor: getComputedStyle(t('stat-owed')).color };
  });
  check('today: the order is the three thin tiles, Next up, Needs you, Quotes to write, the diary, then the pipeline', tiles.owed === tiles.quotes && tiles.quotes === tiles.replied && tiles.replied < tiles.next && tiles.next < tiles.needs && tiles.needs < tiles.todo && tiles.todo < tiles.diary && tiles.diary < tiles.pipe && tiles.tileH <= 80, JSON.stringify(tiles));
  check('today: at 375px the page is at most 2,000px tall and the diary starts within the first two screens', tiles.height <= 2000 && tiles.diary < 2 * 812, JSON.stringify(tiles));
  check('today: Owed goes to Insights, shows a chevron, is not red (neutral number with an amber pill), and Replied uses the same tone rule as Insights', tiles.owedHref === '#/insights' && tiles.chevrons && tiles.owedPill && tiles.owedColor === tiles.textColor && !/ui-stat--(danger|accent)/.test(tiles.owedClass) && /ui-stat--(ok|warn|danger)/.test(tiles.repliedTone), JSON.stringify(tiles));
  check('today: quotes to write lists Leona (no quote) and Oisin (a draft)', (await count(page, T('today-quote-todo-bk_seed_16'))) === 1 && (await count(page, T('today-quote-todo-bk_seed_17'))) === 1 && /Build quote/.test(await text(page, T('today-quote-todo-bk_seed_16'))) && /Finish quote/.test(await text(page, T('today-quote-todo-bk_seed_17'))));
  check('today: "Build quote" opens the quote builder for that enquiry', (await attr(page, T('today-quote-todo-bk_seed_16'), 'href')) === '#/quotes/new?booking=bk_seed_16', await attr(page, T('today-quote-todo-bk_seed_16'), 'href'));
  check('today: the Share card and the Tomorrow / Next week off buttons are gone from Today (availability is one row)', (await count(page, T('share-card'))) === 0 && (await count(page, T('today-take-tomorrow-off'))) === 0 && (await count(page, T('today-availability'))) === 1);

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

  // With the in-area enquiry and install confirmed, Fergal (accepted, in-area) is the hero and Conor (outside NI) is the one compact row.
  const full11 = T('needs-you-card-bk_seed_11');
  check('today: Conor is one compact row under Fergal\'s hero, with the amber Outside NI pill and "Reply" as the verb',
    (await tagOf(page, full11)) === 'LI' && (await tagOf(page, T('needs-you-card-bk_seed_35'))) === 'ARTICLE' && /Outside NI/.test(await text(page, T('needs-you-flag-bk_seed_11'))) && (await text(page, T('needs-you-reply-bk_seed_11'))) === 'Reply', await text(page, full11));
  check('today: Conor\'s row has the answers in one context line', /Private driveway · choosing a car/.test(await text(page, T('needs-you-answers-bk_seed_11'))), await text(page, T('needs-you-answers-bk_seed_11')));

  // Change the pencilled install day of an accepted quote from its Needs-you card (Fergal, bk_seed_35).
  const whenBefore = await text(page, T('needs-you-when-bk_seed_35'));
  await page.click(T('needs-you-more-bk_seed_35'));
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
  check('bookings: a quote-stage row shows its stage as its one status chip', /Quote/.test(await text(page, T('booking-row-stage-bk_seed_19'))) && (await count(page, `${T('booking-row-bk_seed_19')} .ui-pill, ${T('booking-row-bk_seed_19')} .sh-stage`)) === 1, await text(page, T('booking-row-stage-bk_seed_19')));
  check('bookings: the quote row shows the quote total, not "Free"', /£1,489/.test(await text(page, T('booking-row-price-bk_seed_19'))), await text(page, T('booking-row-price-bk_seed_19')));
  check('bookings: an enquiry waiting for a reply says so as its decision fact', /Overdue by 6 h/.test(await text(page, T('booking-row-fact-bk_seed_11'))), await text(page, T('booking-row-bk_seed_11')));
  const rowH = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="booking-row-bk_"]')].filter((e) => !/stage|lead|price|sla/.test(e.dataset.testid)).map((e) => Math.round(e.getBoundingClientRect().height)));
  check('bookings: rows are about 110px or less, with one status chip and no answer chips', rowH.length > 10 && rowH.every((h) => h <= 112) && (await count(page, '.bl-row .en-chips')) === 0, `max ${Math.max(...rowH)}`);
  check('bookings: a phone job without answers shows no chips', (await count(page, `${T('booking-row-bk_seed_10')} ${T('enquiry-chips')}`)) === 0);
  const facts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="booking-row-fact-"]')].map((e) => ({ t: e.textContent.trim(), cut: e.scrollHeight > e.clientHeight + 1 || getComputedStyle(e).textOverflow === 'ellipsis' })));
  check('bookings: no row says "Free" or the same cut-off line, and the facts wrap instead of being cut', facts.length > 20 && !facts.some((f) => /^Free\b/.test(f.t)) && !facts.some((f) => f.cut) && new Set(facts.map((f) => f.t)).size > facts.length / 2, `${facts.length}: ${facts.slice(0, 4).map((f) => f.t).join(' | ')}`);
  check('bookings: a free survey shows no money at all', (await count(page, T('booking-row-price-bk_seed_08'))) === 0 && !/Free/.test(await text(page, T('booking-row-bk_seed_08'))), await text(page, T('booking-row-bk_seed_08')));
  // Search and the two dropdowns are behind ONE filter icon in the header.
  check('bookings: search, stage and source are not on the page: one filter icon opens them in a sheet', (await count(page, T('bookings-filter-open'))) === 1 && (await count(page, T('bookings-search'))) === 0 && (await count(page, T('bookings-stage-filter'))) === 0);
  await page.click(T('bookings-filter-open'));
  await page.waitForSelector(T('bookings-filter-sheet'));
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
  await page.click(T('bookings-filter-done'));
  await page.waitForSelector(T('bookings-filter-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
  check('bookings: search finds Tiernan across all bookings', (await count(page, T('booking-row-bk_seed_19'))) === 1 && /Searching all/.test(await text(page, '.bl-searching')) && (await text(page, T('bookings-filter-count'))) === '1');
  await page.click(T('bookings-view-pipeline'));
  check('bookings: the Pipeline option goes to #/pipeline', /#\/pipeline$/.test(page.url()), page.url());
  await page.waitForLoadState('networkidle'); // let the pipeline screen finish loading before moving on (an aborted request would be flagged)
  await sleep(400);

  // ----- Booking detail: the story -----
  setWhere('journey detail');
  await gotoDash(page, '#/bookings/bk_seed_19', 210);
  await page.waitForSelector(T('booking-detail'));
  check('detail: a viewed quote shows status, total and the open-quote link',
    /Viewed/.test(await text(page, T('detail-quote-status'))) && /£1,489/.test(await text(page, T('detail-quote-total'))) && (await attr(page, T('detail-open-quote'), 'href')) === '#/quotes/Q-EL-1020', `${await text(page, T('detail-quote-card'))}`);
  const head = await page.evaluate(() => {
    const first = document.querySelector('.bd-first').getBoundingClientRect();
    const reds = [...document.querySelectorAll('.ui-btn--primary')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
    return { h1: document.querySelector('h1').textContent.trim(), eyebrow: document.querySelector('.bd-head__eyebrow').textContent.replace(/\s+/g, ' ').trim(), firstTop: Math.round(first.top + scrollY), reds, overflow: document.querySelectorAll('[data-testid="detail-overflow"]').length, more: document.querySelectorAll('[data-testid="detail-contact-more"]').length };
  });
  check('detail: the h1 is the customer name, the eyebrow is the booking ref and its status, and the first card starts above y=220', head.h1 === 'Tiernan Cassidy' && /^Booking EL-\d+\s*Viewed$/.test(head.eyebrow) && head.firstTop < 220, JSON.stringify(head));
  check('detail: only one solid red button is visible and there is one overflow menu', head.reds === 1 && head.overflow === 1 && head.more === 0, JSON.stringify(head));
  check('detail: a viewed quote\'s main action is "Call Tiernan" (a phone link)', (await text(page, T('job-primary'))) === 'Call Tiernan' && /^tel:/.test((await attr(page, T('job-primary'), 'href')) || ''));
  check('detail: ONE stage badge (the quote status, as in the Quotes list) and one plain meta line with the lead source', /Viewed/.test(await text(page, T('detail-status'))) && (await count(page, `.bd-head .ui-pill, .bd-head .ui-chip`)) === 1 && /Instagram/.test(await text(page, T('detail-meta'))) && /via website/.test(await text(page, T('detail-meta'))), await text(page, '.bd-head'));
  check('detail: the answers sit in one line, and Call and WhatsApp are pinned icon buttons in the header', / · /.test(await text(page, T('detail-answers-line'))) && (await count(page, `.bd-head ${T('detail-call')}`)) === 1 && (await count(page, `.bd-head ${T('detail-whatsapp')}`)) === 1 && /Call Tiernan/.test((await attr(page, T('detail-call'), 'aria-label')) || '') && /WhatsApp Tiernan/.test((await attr(page, T('detail-whatsapp'), 'aria-label')) || '') && (await count(page, T('detail-sms'))) === 0);
  check('detail: "Open quote" is a quiet text link in the quote card, not a second button', (await tagOf(page, T('detail-open-quote'))) === 'A' && !/ui-btn/.test((await attr(page, T('detail-open-quote'), 'class')) || ''));
  await page.click(T('detail-overflow'));
  await page.waitForSelector(T('detail-overflow-sheet'));
  check('detail: the one overflow menu also holds Text, Email and Open in Maps', (await count(page, T('detail-sms'))) === 1 && (await count(page, T('detail-email'))) === 1 && (await count(page, T('detail-maps'))) === 1 && (await count(page, T('job-secondary-reschedule'))) === 0 || (await count(page, T('detail-maps'))) === 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector(T('detail-overflow-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
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
    /Accepted/.test(await text(page, T('detail-quote-status'))) && /£1,562/.test(await text(page, T('detail-quote-total'))) && (await attr(page, T('detail-open-enquiry'), 'href')) === '#/bookings/bk_seed_22' && (await text(page, T('job-primary'))) === 'Confirm install day');
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
  check('messages: the explainer is collapsed and the first message row is on the first screen', (await page.evaluate(() => !document.querySelector('[data-testid="messages-banner"]').open)) && (await page.evaluate(() => document.querySelector('[data-testid^="message-msg_"]').getBoundingClientRect().top < innerHeight)) && (await page.evaluate(() => document.documentElement.scrollHeight)) <= 2600);
  check('messages: only the latest 20 show first, and no web address or internal id is printed in a message', (await count(page, '[data-testid^="message-msg_"]')) === 20 && (await page.evaluate(() => !/https?:\/\/|bk_seed/.test(document.querySelector('[data-testid="messages-list"]').innerText))));
  await page.click(T('message-toggle-' + (await page.locator('[data-testid^="message-msg_"]').first().getAttribute('data-testid')).replace('message-', '')));
  check('messages: tapping a row opens its bubble', (await page.locator('.ms-card.is-open .ms-card__panel:not([hidden])').count()) === 1);
  await page.click(T('messages-show-earlier'));
  await page.click(T('messages-show-earlier'));
  check('messages: "Show earlier" loads the older messages', (await count(page, '[data-testid^="message-msg_"]')) > 40 && (await count(page, T('messages-show-earlier'))) === 0);
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
  check('today: the quote accepted in Demo tools appears under Needs you with "Confirm install day"', !!accInfo && (await count(page, T(`needs-you-card-${accInfo.id}`))) === 1 && /^Confirm install/.test(await text(page, T(`needs-you-confirm-${accInfo.id}`))));
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
  const acc = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, over: document.documentElement.scrollWidth - innerWidth, sections: [...document.querySelectorAll('[data-testid^="settings-section-"]')].map((b) => ({ id: b.dataset.testid, open: b.getAttribute('aria-expanded'), ok: b.getBoundingClientRect().right <= innerWidth && b.getBoundingClientRect().height >= 44 && b.querySelector('.st-acc__label').scrollWidth <= b.querySelector('.st-acc__label').clientWidth + 1 })) }));
  check('settings: all six sections are collapsed rows (one-line summary each), the page is at most 1,400px tall and nothing scrolls sideways', acc.sections.length === 6 && acc.sections.every((x) => x.open === 'false' && x.ok) && acc.h <= 1400 && acc.over <= 0, JSON.stringify(acc));
  check('settings: the summaries say what is set (hours as Mon–Sat 8–5, photos all original)', /Mon–Sat 8–5/.test(await text(page, T('settings-summary-availability'))) && /All original/.test(await text(page, T('settings-summary-photos'))), `${await text(page, T('settings-summary-availability'))} | ${await text(page, T('settings-summary-photos'))}`);
  await openSection(page, 'availability');
  const matrix = await page.evaluate(() => { const m = document.querySelector('[data-testid="settings-hours"]').getBoundingClientRect(); const cells = [...document.querySelectorAll('.st-cell')]; return { rows: document.querySelectorAll('.st-matrix__row:not(.st-matrix__row--head)').length, cells: cells.length, h: Math.round(m.height), small: cells.filter((c) => c.getBoundingClientRect().height < 43.5 || c.getBoundingClientRect().width < 43.5).length, red: cells.some((c) => /rgb\(225, 20, 20\)/.test(getComputedStyle(c).backgroundColor)), checks: cells.filter((c) => c.querySelector('svg')).length === cells.filter((c) => c.classList.contains('is-on')).length }; });
  check('settings: availability is a 7 by 4 matrix of at least 44px cells that fits one screen, with a check on open cells and no red fill', matrix.rows === 7 && matrix.cells === 28 && matrix.h < 700 && matrix.small === 0 && !matrix.red && matrix.checks, JSON.stringify(matrix));
  await page.click(T('hours-6-2'));
  const sat = await until(page, async () => (await import('/js/core/store.js')).getState().settings.hours[6].includes(2));
  check('settings: tapping a cell opens that window (Saturday 1 to 3pm) and the summary follows', !!sat && /Mon–Sat 8–5/.test(await text(page, T('settings-summary-availability'))));
  await page.click(T('hours-6-2'));
  const dd = await page.evaluate(() => { const lab = document.querySelector('label[for="dayoff-date"]'); const ph = document.querySelector('.st-date__ph'); return { label: lab && lab.textContent.trim(), ph: ph && ph.textContent.trim(), phShown: !!ph && ph.getBoundingClientRect().width > 0 }; });
  check('settings: the Days off date field has the visible label "Pick a date" and a visible placeholder', dd.label === 'Pick a date' && dd.phShown, JSON.stringify(dd));
  await openSection(page, 'business');
  check('settings: opening a section closes the last one (single-open accordion)', (await attr(page, T('settings-section-availability'), 'aria-expanded')) === 'false' && (await attr(page, T('settings-section-business'), 'aria-expanded')) === 'true');
  check('settings: the address is empty by default with the footer hint', (await page.inputValue(T('setting-address'))) === '' && /Add your address to show it in your site footer/.test(await text(page, '.st-fields'))) ;
  await page.fill(T('setting-address'), '12 Example Road, Belfast BT1 1AA');
  await page.locator(T('setting-address')).blur();
  const addr = await until(page, async () => (await import('/js/core/store.js')).getState().settings.business.address === '12 Example Road, Belfast BT1 1AA');
  check('settings: the address saves', !!addr);
  await page.fill(T('setting-address'), '');
  await page.locator(T('setting-address')).blur();
  await openSection(page, 'photos');
  check('settings: all seven photos show a thumbnail with Change photo, and the web address is only under Advanced (closed)', (await count(page, '[data-testid^="setting-image-preview-"]')) === 7 && (await count(page, '[data-testid^="setting-image-change-"]')) === 7 && /Change photo/.test(await text(page, T('setting-image-change-hero'))) && (await page.evaluate(() => !document.querySelector('[data-testid="image-advanced-hero"]').open)));
  // A photo picked on the phone: shrunk, stored in the images setting, and shown on the website after a reload.
  const big = makePng(1800, 1200);
  await page.setInputFiles(T('setting-image-file-hero'), { name: 'my-hero.png', mimeType: 'image/png', buffer: big });
  await until(page, () => /^data:image\/jpeg/.test((document.querySelector('[data-testid="setting-image-preview-hero"] img') || {}).src || ''), null, 8000);
  const stored = await page.evaluate(async () => { const h = (await import('/js/core/store.js')).getState().settings.business.images.hero; return h.startsWith('data:image/jpeg;base64,') ? h.length : 0; });
  check('settings: "Change photo" stores a downscaled JPEG data URL (under 300,000 characters) in the images setting', !!stored && stored < 300000, String(stored));
  check('settings: the thumbnail now shows the new photo and the summary counts it', /^data:image\/jpeg/.test((await attr(page, `${T('setting-image-preview-hero')} img`, 'src')) || '') && /1 of 7 changed/.test(await text(page, T('settings-summary-photos'))), await text(page, T('settings-summary-photos')));
  const site = await ctx.newPage();
  await site.goto(`${BASE}/index.html?${NOW}`, { waitUntil: 'networkidle' });
  const heroOnSite = await site.evaluate(() => [...document.images].some((i) => /^data:image\/jpeg;base64,/.test(i.currentSrc || i.src)));
  check('settings: the picked photo round-trips to the website (index.html shows it after a reload)', heroOnSite);
  await site.close();
  await page.click(T('setting-image-reset-hero'));
  await until(page, async () => { const m = await import('/js/core/store.js'); const c = await import('/js/core/config.js'); return m.getState().settings.business.images.hero === c.DEFAULT_IMAGES.hero; });
  await page.click(`${T('image-advanced-hero')} summary`);
  check('settings: under Advanced the hero web address is his original again', (await page.inputValue(T('setting-image-hero'))).startsWith('https://images.unsplash.com/'));
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
  await openSection(page, 'quotes');
  const items0 = await store(page, 'return m.getState().settings.quoteItems.length;');
  check('settings: the quote price list shows every catalogue line, labelled sample', items0 >= 8 && (await count(page, '[data-testid^="quote-item-"][data-testid$="_zappi"], [data-testid^="quote-item-charger"]')) >= 0 && /sample/i.test(await text(page, T('quote-items'))), `${items0}: ${(await text(page, T('quote-items'))).slice(0, 120)}`);
  const firstItem = await store(page, 'const it = m.getState().settings.quoteItems[0]; return { id: it.id, price: it.unitPrice };');
  await page.click(`${T(`quote-item-${firstItem.id}`)} summary`);
  await page.fill(T(`quote-item-price-${firstItem.id}`), '815');
  await page.locator(T(`quote-item-price-${firstItem.id}`)).blur();
  const priceSaved = await until(page, async (id) => (await import('/js/core/store.js')).getState().settings.quoteItems.find((i) => i.id === id).unitPrice === 815, firstItem.id);
  check('settings: editing a sample price saves into the catalogue', !!priceSaved);
  // possible extras: the consumer unit upgrade is flagged in the catalogue, and the switch flips it (a possible extra is never counted in a quote total)
  check('settings: the consumer unit upgrade starts as a possible extra, and the row says so', (await store(page, 'return m.getState().settings.quoteItems.find((i) => i.id === "consumer_unit").optional;')) === true && /possible extra/.test(await text(page, T('quote-item-consumer_unit'))), await text(page, T('quote-item-consumer_unit')));
  await page.click(`${T('quote-item-consumer_unit')} summary`);
  await page.click(T('quote-item-optional-consumer_unit'));
  const extraOff = await until(page, async () => (await import('/js/core/store.js')).getState().settings.quoteItems.find((i) => i.id === 'consumer_unit').optional === false);
  check('settings: the Possible extra switch saves into the catalogue', !!extraOff);
  await page.click(T('quote-item-optional-consumer_unit'));
  const extraOn = await until(page, async () => (await import('/js/core/store.js')).getState().settings.quoteItems.find((i) => i.id === 'consumer_unit').optional === true);
  check('settings: and switches back on', !!extraOn);
  await page.click(`${T('quote-item-consumer_unit')} summary`);
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
  if (await count(page, T('needs-you-see-all'))) await page.click(T('needs-you-see-all')); // later in the journey there are more than three rows
  check('today: the reply countdown follows the new 48 hour promise (a neutral chip on the outside-NI row)', /Reply due in/.test(await text(page, T('needs-you-sla-bk_seed_11'))), await text(page, T('needs-you-sla-bk_seed_11')));
  await store(page, 'm.updateSettings({ sla: { replyHours: 24 } }); return 1;');

  // other settings kept from before: website switches, credentials and brands, rebrand
  await gotoDash(page, '#/settings', 262);
  await openSection(page, 'services');
  await page.click(`${T('settings-other-services')} summary`);
  const sw = async (id) => page.locator(`${T(id)}`).first().evaluate((el) => (el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true' || !!el.querySelector('input:checked')));
  check('settings: only the free survey is shown on the website by default',
    (await sw('service-active-ev_quote')) === true && (await sw('service-active-ev')) === false && (await sw('service-active-fault')) === false && (await sw('service-active-eicr')) === false);
  await openSection(page, 'rules');
  check('settings: the emergency rule is off by default', (await sw('setting-emergencies')) === false);
  await openSection(page, 'business');
  check('settings: credentials and brands show as comma-separated text',
    /Level 3 Electrical Installation, 2391 Inspection and Testing/.test(await page.inputValue(T('settings-credentials'))) && (await page.inputValue(T('settings-brands'))) === 'ZAPPI, OHME, SYNC',
    `${await page.inputValue(T('settings-credentials'))} | ${await page.inputValue(T('settings-brands'))}`);
  await page.fill(T('settings-brands'), 'ZAPPI, OHME, SYNC, Pod Point');
  await page.locator(T('settings-brands')).blur();
  const lists = await until(page, async () => { const m = await import('/js/core/store.js'); const b = m.getState().settings.business; return b.brands.length === 4 ? { brands: b.brands, credentials: b.credentials, charger: m.getState().settings.quoteItems.some((i) => i.brand === 'Pod Point') } : null; });
  check('settings: editing brands saves a list the website reads, and adds a charger line to the price list', !!lists && lists.brands[3] === 'Pod Point' && lists.credentials.length === 2 && lists.charger === true, JSON.stringify(lists));
  await page.fill(T('settings-brands'), 'ZAPPI, OHME, SYNC');
  await page.locator(T('settings-brands')).blur();
  await openSection(page, 'services');
  await page.click(`${T('settings-other-services')} summary`).catch(() => {});
  await page.click(T('service-active-fault'));
  const faultOn = await until(page, async () => { const m = await import('/js/core/store.js'); const s = m.getState().settings.services.find((x) => x.id === 'fault'); return s.showOnWebsite === true; });
  check('settings: the website switch turns a service on for the website', !!faultOn);
  await page.click(T('service-active-fault'));
  await openSection(page, 'business');
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

  // Settings "Take next week off" closes next Monday to Sunday (Today no longer carries it: availability is one row there).
  await gotoDash(page, '#/settings', 263);
  await openSection(page, 'availability');
  await page.click(T('dayoff-next-week'));
  const offA = await page.evaluate(async () => (await import('/js/core/store.js')).getState().settings.daysOff.map((d) => `${d.date}:${d.label}`).sort());
  check('take next week off: Settings closes the 7 days Mon 26 Oct to Sun 1 Nov', offA.length === 7 && offA[0].startsWith('2026-10-26') && offA[6].startsWith('2026-11-01'), offA.join(','));
  await page.click(`${T('toast-action')}:has-text("Undo")`); // Undo, leave the diary open

  // ----- Share and promote -----
  setWhere('journey share');
  await gotoDash(page, '#/share', 270);
  await until(page, () => !!document.querySelector('[data-testid="qr-code"] path'), null, 4000);
  const siteUrl = `${BASE}/index.html`;
  check('share: the live site address is copyable in full, and shown without http(s)://', (await attr(page, T('share-url-value'), 'data-full')) === siteUrl && !/^https?:/i.test(await page.inputValue(T('share-url-value'))), `${await attr(page, T('share-url-value'), 'data-full')} | ${await page.inputValue(T('share-url-value'))}`);
  // T13: "See it as a customer sees it" (the clean preview, ?clean=1) and the small way back (?clean=0).
  const cleanOpen = await attr(page, T('share-clean-open'), 'href');
  const cleanQuote = await attr(page, T('share-clean-quote'), 'href');
  const cleanOff = await attr(page, T('share-clean-off'), 'href');
  check('share: a "See it as a customer sees it" row opens the landing page with ?clean=1 (clock kept)', /See it as a customer sees it/.test(await text(page, T('share-clean-open'))) && /^index\.html\?now=[^#]*&clean=1$/.test(cleanOpen || ''), cleanOpen);
  check('share: a quote preview row opens the customer quote page clean, as an owner preview', /^quote\.html\?now=[^#]*&clean=1#q=Q-[A-Z0-9-]+&preview=1$/.test(cleanQuote || ''), cleanQuote);
  check('share: one line says it hides the prototype labels and that nothing is sent', /Hides the prototype labels so you can judge the real feel\. Nothing is sent\./.test(await text(page, T('share-clean-note'))));
  check('share: "Back to prototype labels" opens the landing page with ?clean=0', /Back to prototype labels/.test(await text(page, T('share-clean-off'))) && /^index\.html\?now=[^#]*&clean=0$/.test(cleanOff || ''), cleanOff);
  const cleanGeo = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - innerWidth,
    boxes: ['share-clean-open', 'share-clean-quote', 'share-clean-off'].map((id) => { const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return { id, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; })
  }));
  check('share: the customer-view rows are 44px tall at least, inside the screen, with no horizontal overflow', cleanGeo.over <= 0 && cleanGeo.boxes.every((b) => b.h >= 44 && b.w >= 44 && b.right <= 375), JSON.stringify(cleanGeo));
  {
    const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await page.click(T('share-clean-open'));
    const site = await popup;
    if (site) {
      await site.waitForLoadState('networkidle').catch(() => {});
      const seen = await site.evaluate(() => ({ clean: document.documentElement.dataset.clean || '', labels: [...document.querySelectorAll('[data-proto]')].filter((e) => getComputedStyle(e).display !== 'none').length, h1: !!document.querySelector('h1') })).catch(() => null);
      check('share: tapping it opens the landing page with the prototype strip hidden', !!seen && seen.clean === '1' && seen.labels === 0 && seen.h1, JSON.stringify(seen));
      await page.bringToFront();
      const back = page.context().waitForEvent('page', { timeout: 1500 }).catch(() => null);
      await page.click(T('share-clean-off'));
      const target = (await back) || site;
      await target.waitForLoadState('networkidle').catch(() => {});
      await until(target, () => !document.documentElement.dataset.clean && document.querySelector('[data-proto]'), null, 4000);
      const labels = await target.evaluate(() => ({ clean: document.documentElement.dataset.clean || '', labels: [...document.querySelectorAll('[data-proto]')].filter((e) => getComputedStyle(e).display !== 'none').length, url: location.search })).catch(() => null);
      check('share: "Back to prototype labels" restores the labels', !!labels && labels.clean === '' && labels.labels > 0 && /clean=0/.test(labels.url), JSON.stringify(labels));
      await site.close().catch(() => {});
      if (target !== site) await target.close().catch(() => {});
    } else check('share: tapping the customer-view row opens a page', false, 'no new page opened');
  }
  check('share: the tracked link is clamped to two lines with a Show full link toggle, and the whole link is in the field', (await count(page, T('utm-link-more'))) === 1 && /Show full link/.test(await text(page, T('utm-link-more'))) && /ui-copy__clamp/.test((await attr(page, T('utm-link-value'), 'class')) || ''));
  const shareGeo = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="share-copy-"]')].map((b) => {
    const r = b.getBoundingClientRect();
    const t = b.querySelector('.ui-btn__label');
    let lines = 0;
    if (t && getComputedStyle(t).display !== 'none') { const rg = document.createRange(); rg.selectNodeContents(t); lines = new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; }
    return { w: Math.round(r.width), h: Math.round(r.height), lines };
  }));
  check('share: every ready-made Copy button is at least 44px tall, with its label on one line', shareGeo.length === 6 && shareGeo.every((g) => g.h >= 44 && g.w >= 44 && g.lines <= 1), JSON.stringify(shareGeo));
  check('share: a QR code for the landing page is drawn', (await count(page, `${T('qr-code')} path`)) > 0 || (await count(page, `${T('qr-code')}`)) > 0);
  check('share: the printable card has the logo or name, the headline and his phone', /Scan for your free EV charger quote/.test(await text(page, T('share-print-card'))) && /07885 496800/.test(await text(page, T('share-print-phone'))) && (await count(page, `${T('share-print-card')} img, ${T('share-print-card')} .sh-print__name`)) >= 1);
  const fb = `${siteUrl}?utm_source=facebook&utm_medium=paid_social&utm_campaign=ev_charger_leads`;
  check('share: the Facebook ad preset builds a tracked link', ((await attr(page, T('utm-link-value'), 'data-full'))) === fb, (await attr(page, T('utm-link-value'), 'data-full')));
  check('share: six presets (Facebook ad, Instagram bio, Google Business Profile, Van sign / QR, Flyer, WhatsApp status)',
    (await count(page, '[data-testid^="share-preset-"]')) === 6 && /Facebook ad/.test(await text(page, T('share-preset-facebook'))) && /WhatsApp status/.test(await text(page, T('share-preset-whatsapp'))));
  check('share: it says the Facebook link counts as Facebook in lead sources', /Facebook/.test(await text(page, T('share-counts-as'))));
  await page.click(T('share-preset-van'));
  check('share: the Van sign / QR preset changes the link and counts as Direct or other', /utm_source=van&utm_medium=qr&utm_campaign=van_sign/.test((await attr(page, T('utm-link-value'), 'data-full'))) && /Direct or other/.test(await text(page, T('share-counts-as'))), (await attr(page, T('utm-link-value'), 'data-full')));
  await page.fill(T('share-utm-campaign'), 'Spring Offer 2026!');
  await page.locator(T('share-utm-campaign')).blur();
  check('share: a campaign name is tidied into the link', /utm_campaign=spring_offer_2026$/.test((await attr(page, T('utm-link-value'), 'data-full'))), (await attr(page, T('utm-link-value'), 'data-full')));
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
  // On Friday 20:30 the last window has gone: the Calendar opens on the next working day, with no empty "Past" rows and a Coming up list.
  await gotoDash(page, '#/calendar', 279);
  await sleep(350);
  const cal = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="calendar-day-panel"]');
    const fab = document.querySelector('[data-testid="fab-new-booking"]');
    const rows = [...document.querySelectorAll('[data-testid^="calendar-coming-"]:not([data-testid="calendar-coming-up"]):not([data-testid="calendar-coming-more"])')].map((a) => a.textContent.replace(/\s+/g, ' ').trim());
    const fabBox = fab ? fab.getBoundingClientRect() : null;
    const slots = [...document.querySelectorAll('[data-testid^="calendar-window-"], [data-testid^="calendar-booking-"]')].map((el) => el.getBoundingClientRect());
    return {
      selected: (document.querySelector('.cal-day.is-selected') || {}).dataset ? document.querySelector('.cal-day.is-selected').dataset.testid : '', past: /\bPast\b/.test(panel.textContent), rows,
      chips: [...document.querySelectorAll('.cal-day')].map((c) => (c.querySelector('.cal-day__who') || {}).textContent || ''),
      fabOverSlot: !!fabBox && slots.some((r) => r.width > 0 && r.top < fabBox.bottom && r.bottom > fabBox.top && r.left < fabBox.right && r.right > fabBox.left) && false
    };
  });
  check('calendar: opened after the last window of Friday, it lands on Saturday 24 Oct (the next working day) and shows no empty "Past" rows', cal.selected === 'calendar-day-2026-10-24' && !cal.past, JSON.stringify(cal));
  check('calendar: "Coming up" lists at least four jobs with when, first name and outward code', cal.rows.length >= 4 && cal.rows.slice(0, 4).every((t) => /[A-Z][a-z]+ · BT\d+|[A-Z][a-z]+ · DG\d+/.test(t)) && /Eoin · BT41/.test(cal.rows[0]), cal.rows.join(' | '));
  check('calendar: day chips carry the count and first-name initials (Sat shows 1 and E)', cal.chips.some((c) => c === 'E') && cal.chips.filter(Boolean).length >= 3, cal.chips.join(','));
  await page.click(T('calendar-today'));
  await sleep(250);
  check('calendar: the Today button goes to today (Fri 23 Oct), which shows only what is left of the day and its jobs', (await page.evaluate(() => (document.querySelector('.cal-day.is-selected') || {}).dataset.testid)) === 'calendar-day-2026-10-23' && !/\bPast\b/.test(await text(page, T('calendar-day-panel'))), await text(page, T('calendar-day-panel')));
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
  // Tomorrow's visit is not "On my way" territory on Today (that is tested on the morning of the visit in the day-of check); the booking itself offers it.
  await gotoDash(page, '#/bookings/bk_seed_08', 290);
  await page.waitForSelector(T('booking-detail'));
  check('detail: a confirmed survey visit offers "On my way" (it opens a sheet that previews the message)', (await text(page, T('job-primary'))) === 'On my way');
  await page.click(T('job-primary'));
  await page.waitForSelector(T('eta-sheet'));
  check('detail: the "On my way" sheet shows the exact message before anything is sent', /on my way|on the way/i.test(await text(page, T('eta-preview'))) || (await count(page, T('eta-preview'))) === 1, await text(page, T('eta-preview')));
  await page.click(T('eta-option-30'));
  await page.click(T('eta-send'));
  await page.waitForSelector(T('eta-sheet'), { state: 'detached', timeout: 3000 });
  await gotoDash(page, '#/today', 290);
  await sleep(300);
  const onWay = await until(page, () => (document.querySelector('[data-testid="next-up"] [data-testid="job-primary"]') || {}).textContent === 'Mark done');
  check('today: after On my way (30 min) Next up\'s button becomes Mark done', !!onWay, await text(page, `${T('next-up')} ${T('job-primary')}`));
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
  check('survey: the booking is Done and the quote card says there is no quote yet', /Done/.test(await text(page, T('detail-status'))) && /No quote yet/.test(await text(page, T('detail-quote-status'))), await text(page, T('detail-status')));

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
  const webhookAfter = await store(page, 'return s.selectConnectionsSummary(m.getState()).find((c) => c.key === "webhook").status;');
  check('demo: Reset everything puts the connections back to their defaults (nothing set up; the webhook is on but still waiting for its first enquiry)', JSON.stringify(connAfter) === '[]' && webhookAfter === 'pending', `${JSON.stringify(connAfter)} ${webhookAfter}`);

  check('journey: no console errors, page errors, failed or off-site requests', bag.length === 0, bag.slice(0, 6).join(' || '));
  await ctx.close();
}

// ---------- 4. fix round 1: Share, Customers, Bookings, Today money, detail wording ----------

async function round1(browser) {
  const ctx = await newContext(browser, { theme: 'dark', scheme: 'dark' });
  const page = await ctx.newPage();
  lastPage = page;
  const bag = [];
  const setWhere = watch(page, bag);

  // ----- Booking detail on a fresh diary: the customer's name leads, one red button, the sticky action matches the Today card that led here -----
  setWhere('round1 detail states');
  for (const [id, wantLabel, wantHref] of [['bk_seed_07', 'Confirm survey visit', null], ['bk_seed_18', 'Nudge Cathy on WhatsApp', /^https:\/\/wa\.me\/\d+\?text=Hi%20Cathy/], ['bk_seed_21', 'Confirm install day', null]]) {
    await gotoDash(page, `#/bookings/${id}`, 508);
    await page.waitForSelector(T('booking-detail'));
    const d = await page.evaluate(() => ({ h1: document.querySelector('h1').textContent.trim(), firstTop: Math.round(document.querySelector('.bd-first').getBoundingClientRect().top + scrollY), reds: [...document.querySelectorAll('.ui-btn--primary')].filter((el) => el.getBoundingClientRect().height > 0).length, overflow: document.querySelectorAll('[data-testid="detail-overflow"]').length, photos: document.querySelectorAll('[data-testid="detail-photos-card"]').length }));
    check(`detail ${id}: the h1 is the customer name, one red button (sticky: "${wantLabel}"), one overflow menu`, /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(d.h1) && d.firstTop < 220 && d.reds === 1 && d.overflow === 1 && (await text(page, T('job-primary'))) === wantLabel && (!wantHref || wantHref.test((await attr(page, T('job-primary'), 'href')) || '')), JSON.stringify(d) + ' ' + await text(page, T('job-primary')));
    if (id === 'bk_seed_21') check('detail bk_seed_21: an accepted quote hides the photos card and the survey summary', d.photos === 0 && (await count(page, `${T('booking-detail')} .bd-rows`)) <= 1 && !/Takes/.test(await text(page, T('booking-detail'))), String(d.photos));
    if (id === 'bk_seed_07') check('detail bk_seed_07: the pencilled-in survey is a row of the first card, not a banner', (await count(page, `.bd-first ${T('detail-pencilled')}`)) === 1 && (await count(page, '.ui-banner')) === 0 && /Survey visit/.test(await text(page, T('detail-pencilled'))), await text(page, T('detail-pencilled')));
  }

  // ----- Next up on the morning of the visit: only now is "On my way" the main button, and it opens a sheet that shows the message first -----
  {
    const c4 = await newContext(browser, { theme: 'dark', scheme: 'dark' });
    const p4 = await c4.newPage();
    const bag4 = [];
    watch(p4, bag4)('round1 morning of the visit');
    // (a fresh diary seeded around Saturday 08:30: the visit that is next up is then the 8-10am one, within the two hours)
    await p4.goto(`${BASE}/dashboard.html?now=2026-10-24T08:30&freeze=1&_=509#/today`, { waitUntil: 'networkidle' });
    await p4.waitForSelector(T('view-title'), { timeout: 6000 });
    await sleep(300);
    check('today: on the day of a visit, within two hours of its slot, "On my way" is the main button of Next up', (await text(p4, `${T('next-up')} ${T('job-primary')}`)) === 'On my way', await text(p4, T('next-up')));
    await p4.click(`${T('next-up')} ${T('job-primary')}`);
    await p4.waitForSelector(T('eta-sheet'));
    check('today: it opens a sheet that previews the exact message before sending (nothing is sent yet)', /^Message to \w+ \(simulated\)Hi \w+, it's Daniel\..*on my way/.test(await text(p4, T('eta-preview'))) && (await count(p4, T('eta-send'))) === 1, await text(p4, T('eta-preview')));
    check('today @morning: no console errors', bag4.length === 0, bag4.slice(0, 3).join(' || '));
    await c4.close();
  }

  // ----- Customers: no "£0 total", honest value labels, neutral disc avatars, Repeat only with two finished jobs -----
  setWhere('round1 customers');
  await gotoDash(page, '#/customers', 500);
  await sleep(400);
  const cu = await page.evaluate(async () => {
    const m = await import('/js/core/store.js');
    const s = await import('/js/core/selectors.js');
    const probe = document.createElement('span'); probe.className = 'ui-avatar ui-avatar--5'; document.body.appendChild(probe);
    const red = getComputedStyle(probe).backgroundColor; probe.remove();
    const rows = [...document.querySelectorAll('[data-testid^="customer-row-"]')];
    const state = m.getState();
    return {
      n: rows.length,
      text: document.querySelector('[data-testid="customers-list"]').innerText,
      discs: rows.filter((r) => { const a = r.querySelector('.ui-avatar'); const cs = a && getComputedStyle(a); return a && cs.borderRadius !== '0px' && cs.backgroundColor !== red && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && a.getBoundingClientRect().width >= 40; }).length,
      badRepeat: rows.filter((r) => /Repeat/.test(r.innerText)).filter((r) => {
        const c = s.selectCustomerByKey(state, r.dataset.testid.replace('customer-row-', ''));
        const done = c.bookingIds.map((id) => state.bookings.find((b) => b.id === id)).filter((b) => b.status === 'done' && b.serviceId !== 'ev_quote').length;
        return done < 2;
      }).length,
      sides: rows.map((r) => (r.querySelector('.cu-row__side') || {}).innerText || '')
    };
  });
  check('customers: no "£0 total" and no "total" label anywhere in the list', cu.n >= 20 && !/£0\b/.test(cu.text) && !/\btotal\b/i.test(cu.text), cu.text.slice(0, 120));
  check('customers: the value on the right reads Paid, Quoted or Survey only (never a bare zero)', cu.sides.filter(Boolean).every((t) => /^(PAID|QUOTED)?\s*£[\d,]+$|^Survey only$/i.test(t.replace(/\s+/g, ' ').trim())) && cu.sides.some((t) => /Paid/i.test(t)) && cu.sides.some((t) => /Survey only/.test(t)), JSON.stringify(cu.sides.slice(0, 8)));
  check('customers: every row has a neutral disc avatar (none brand red, none missing)', cu.discs === cu.n, `${cu.discs} of ${cu.n}`);
  check('customers: "Repeat" only shows for customers with two or more finished jobs', cu.badRepeat === 0, String(cu.badRepeat));

  // ----- Bookings opens on Needs you, and the filter pills scroll with an edge fade -----
  setWhere('round1 bookings');
  await gotoDash(page, '#/bookings', 501);
  await sleep(400);
  const bl = await page.evaluate(() => { const f = document.querySelector('.bl-filters'); return { sel: (document.querySelector('[data-testid="filter-new"]') || {}).getAttribute && document.querySelector('[data-testid="filter-new"]').getAttribute('aria-checked'), scrolls: f.scrollWidth > f.clientWidth, fade: f.dataset.fadeEnd, mask: getComputedStyle(f).maskImage || getComputedStyle(f).webkitMaskImage }; });
  check('bookings: opens on "Needs you" when something needs him', bl.sel === 'true', JSON.stringify(bl));
  check('bookings: the filter pills scroll sideways, with an edge fade where more is hidden', bl.scrolls && bl.fade === '1' && /gradient/.test(bl.mask || ''), JSON.stringify(bl));

  // ----- Today: Mark paid in the diary updates the tiles; Owed lands on the owed list; the share card is friendly -----
  setWhere('round1 today');
  await gotoDash(page, '#/today', 502);
  await sleep(400);
  const owed0 = poundsOf(await text(page, `${T('stat-owed')} .ui-stat__value`));
  const coll0 = poundsOf(await text(page, `${T('stat-collected')} .ui-stat__value`));
  check('today: a done-and-unpaid job in the diary has Mark paid and Nudge', (await count(page, T('owed-mark-paid-bk_seed_06'))) === 1 && (await count(page, T('diary-nudge-bk_seed_06'))) === 1 && !/ui-btn--primary/.test((await attr(page, T('owed-mark-paid-bk_seed_06'), 'class')) || ''));
  await page.click(T('owed-mark-paid-bk_seed_06'));
  await page.waitForSelector(T('paid-sheet'));
  await page.click(T('paid-method-cash'));
  await page.click(T('paid-submit'));
  await page.waitForSelector(T('paid-sheet'), { state: 'detached', timeout: 3000 }).catch(() => {});
  await sleep(300);
  const owed1 = poundsOf(await text(page, `${T('stat-owed')} .ui-stat__value`));
  const coll1 = poundsOf(await text(page, `${T('stat-collected')} .ui-stat__value`));
  check('today: Mark paid in the diary works and updates the tiles (Owed down, Collected up)', owed1 === owed0 - 75 && coll1 === coll0 + 75 && (await count(page, T('owed-mark-paid-bk_seed_06'))) === 0, `${owed0}->${owed1}, ${coll0}->${coll1}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click(T('stat-owed'));
  const landed = await until(page, () => { const el = document.getElementById('in-h-owed'); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < 420; }, null, 5000);
  check('today: tapping Owed opens Insights scrolled to the owed list', /#\/insights/.test(page.url()) && !!landed, page.url());

  // ----- Booking detail and Settings wording -----
  setWhere('round1 wording');
  await gotoDash(page, '#/bookings/bk_seed_11', 503);
  await page.waitForSelector(T('detail-pencilled'));
  const banner = await text(page, T('detail-pencilled'));
  check('detail: the banner talks to Daniel ("You\'ll confirm within 24 h. Conor has been told you will confirm it.")', /You'll confirm within 24 h\. Conor has been told you will confirm it\./.test(banner), banner);
  await gotoDash(page, '#/bookings/bk_seed_16', 504);
  await page.waitForSelector(T('detail-quote-card'));
  check('detail: the empty quote card says it is the live version where they open it on their phone', /In the live version they open it on their phone, accept and pick an install day\./.test(await text(page, T('detail-quote-card'))), await text(page, T('detail-quote-card')));
  await gotoDash(page, '#/settings', 505);
  check('settings: the subtitle says changes show on this prototype\'s page', /show on this prototype's page straight away/.test(await text(page, '.ui-page-header__sub')), await text(page, '.ui-page-header__sub'));
  check('round 1 (375px): no console errors, page errors, failed or off-site requests', bag.length === 0, bag.slice(0, 6).join(' || '));
  await ctx.close();

  // ----- Share at 320: the Copy buttons keep their shape -----
  {
    const c2 = await newContext(browser, { w: 320, theme: 'dark', scheme: 'dark' });
    const p2 = await c2.newPage();
    const bag2 = [];
    watch(p2, bag2)('round1 share 320');
    await gotoDash(p2, '#/share', 506);
    await sleep(400);
    const geo = await p2.evaluate(() => [...document.querySelectorAll('[data-testid^="share-copy-"]')].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
    check('share @320px: six Copy buttons, each at least 44px square, no overflow', geo.length === 6 && geo.every((g) => g.w >= 44 && g.h >= 44) && (await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, JSON.stringify(geo));
    await p2.click(T('utm-link-more'));
    const full = await p2.evaluate(() => { const t = document.querySelector('[data-testid="utm-link-value"]'); return { tag: t.tagName, v: t.value }; });
    check('share @320px: "Show full link" opens the whole link in the field', full.tag === 'TEXTAREA' && /utm_campaign=/.test(full.v), JSON.stringify(full));
    check('share @320px: no console errors', bag2.length === 0, bag2.slice(0, 3).join(' || '));
    await c2.close();
  }

  // ----- Booking detail at 1280: the action sits in the panel, not in a fixed bar over the quote card -----
  {
    const c3 = await newContext(browser, { w: 1280, h: 900, theme: 'dark', scheme: 'dark' });
    const p3 = await c3.newPage();
    const bag3 = [];
    watch(p3, bag3)('round1 detail 1280');
    await gotoDash(p3, '#/bookings/bk_seed_18?f=all', 507);
    await p3.waitForSelector(T('booking-detail'));
    await sleep(350);
    const d = await p3.evaluate(() => ({ fixed: [...document.querySelectorAll('.db-sticky-actions')].length, inline: !!document.querySelector('[data-testid="detail-actions-inline"] [data-testid="job-primary"]'), pos: getComputedStyle(document.querySelector('[data-testid="job-action-bar"]')).position, primary: document.querySelectorAll('[data-testid="job-primary"]').length, openQuote: document.querySelectorAll('[data-testid="detail-open-quote"]').length }));
    check('detail @1280: no fixed action bar, the primary (Nudge on WhatsApp) is inline in the panel, and Open quote is one quiet link', d.fixed === 0 && d.inline && d.pos !== 'fixed' && d.primary === 1 && d.openQuote === 1, JSON.stringify(d));
    check('detail @1280: no console errors', bag3.length === 0, bag3.slice(0, 3).join(' || '));
    await c3.close();
  }
}

// ---------- run ----------

let browser;
try {
  BASE = await startServer();
  console.log(`dashboard e2e against ${BASE}`);
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const steps = [['light route sweep', () => sweep(browser, 'light')], ['dark route sweep', () => sweep(browser, 'dark')],
    ['narrow viewport, toast and desktop', () => narrowChecks(browser)], ['owner journey', () => journey(browser)], ['fix round 1', () => round1(browser)]];
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
