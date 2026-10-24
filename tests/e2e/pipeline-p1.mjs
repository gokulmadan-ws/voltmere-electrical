// tests/e2e/pipeline-p1.mjs: end-to-end check of the Pipeline (#/pipeline) and Insights (#/insights) screens (Playwright, Chromium, no build step).
// Owner: P1. Run: node tests/e2e/pipeline-p1.mjs   Env: VERBOSE=1, BASE_URL (reuse a server), QA_DEPS_DIR (folder whose node_modules holds playwright-core and axe-core), CHROME_PATH.
// Covers: seed numbers at the pinned clock, stage strip and kanban board, SLA flags, next-action links, Lost drawer, live and two-tab updates,
// the empty state, Insights money and marketing numbers, ad spend entry with Save, Undo, a failed save and honest blanks, axe, tap targets, overflow, reduced motion.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEPS = [process.env.QA_DEPS_DIR, '/tmp/qa', '/tmp/claude-0/-home-user-LG-Proto1/9b0bf8bc-80f0-53ab-a3b8-7d955fff3e2a/scratchpad/qa-deps'].filter(Boolean);
const QA_DEPS = DEPS.find((d) => existsSync(path.join(d, 'node_modules', 'playwright-core'))) || DEPS[0];
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const NOW = 'now=2026-10-23T20:30&freeze=1';
const CTX = { timezoneId: 'Europe/London', locale: 'en-GB' };

const require = createRequire(path.join(QA_DEPS, '/'));
const { chromium } = require('playwright-core');
let axeSource = '';
try { axeSource = require('axe-core').source; } catch (e) { /* axe is optional: the checks that need it are skipped with a note */ }

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
let n = 0;

async function newContext(browser, { w = 375, h = 812, scheme = 'dark', theme, reducedMotion } = {}) {
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: scheme,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference'
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* ignore */ } }, theme || scheme);
  return ctx;
}

/** Everything that should never happen on a clean page. */
function watch(page, bag) {
  let where = '';
  const origin = () => new URL(BASE).origin;
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/QuotaExceeded|Failed to load resource.*(40[0-9]|50[0-9])/.test(m.text())) bag.push(`[${where}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => bag.push(`[${where}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => bag.push(`[${where}] request failed: ${r.url()} ${(r.failure() || {}).errorText || ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) bag.push(`[${where}] HTTP ${r.status()} ${r.url()}`);
    const u = r.url();
    if (!u.startsWith(origin()) && !u.startsWith('data:') && !u.startsWith('blob:')) bag.push(`[${where}] off-site request ${u}`);
  });
  return (w) => { where = w; };
}

async function gotoDash(page, hash) {
  n += 1;
  await page.goto(`${BASE}/dashboard.html?${NOW}&_=${n}${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(T('view-title'), { timeout: 5000 });
  await page.waitForSelector('.db-view', { timeout: 5000 });
  await sleep(250);
}

/** Wait until `fn` (run in the page) is truthy; returns the value or null. */
async function until(page, fn, arg, ms = 3000) {
  try { const h = await page.waitForFunction(fn, arg, { timeout: ms }); return await h.jsonValue(); } catch (e) { return null; }
}
const text = async (page, sel) => ((await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const count = (page, sel) => page.locator(sel).count();
/** The toast whose text contains `needle` (other toasts, such as the "new bookings" one, can be on screen too). */
const toastWith = (page, needle) => page.locator(T('toast')).filter({ hasText: needle });
const hashOf = (page) => page.evaluate(() => location.hash);
const pounds = (s) => { const m = /£\s?([\d,]+)/.exec(s || ''); return m ? Number(m[1].replace(/,/g, '')) : null; };

/** Run an in-page store call (the page already has the store loaded as an ES module). */
const store = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const mod = await import('/js/core/store.js');
  // eslint-disable-next-line no-new-func
  return new Function('store', 'arg', `return (${src})(store, arg);`)(mod, a);
}, [fn.toString(), arg]);

async function overflowOf(page) { return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); }

/** Interactive things inside the screen that are smaller than 44px (inline text links are exempt). */
async function smallTargets(page) {
  return page.evaluate(() => {
    const out = [];
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    for (const el of document.querySelectorAll('#main a[href], #main button, #main summary, #main input, #main [role="tab"], #main [role="radio"], #main [role="switch"]')) {
      if (!visible(el) || el.closest('.u-sr-only') || el.disabled) continue;
      const box = el.matches('input') && el.closest('.ui-money') ? el.closest('.ui-money') : el;
      const r = box.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') || el.className || el.textContent.trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

async function axeCheck(page, tag) {
  if (!axeSource) { check(`${tag}: axe skipped (axe-core not installed)`, true); return; }
  await page.addScriptTag({ content: axeSource });
  const res = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run({ include: ['#main'] }, { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((x) => x.target.join(' ')).join(' | ')}`);
  });
  check(`${tag}: axe finds no serious or critical problems`, res.length === 0, res.join(' || '));
}

// ---------- 1. Pipeline on a phone ----------

const STAGES = ['enquiry', 'survey', 'quote', 'accepted', 'install', 'done'];
const SEED_COUNTS = { enquiry: 2, survey: 3, quote: 5, accepted: 2, install: 3, done: 6 };

async function pipelinePhone(browser) {
  const ctx = await newContext(browser, { scheme: 'dark' });
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  setWhere('pipeline phone');
  await gotoDash(page, '#/pipeline');

  check('pipeline: shows its own title', (await text(page, T('view-title'))) === 'Pipeline', await text(page, T('view-title')));
  check('pipeline: no horizontal overflow at 375px', (await overflowOf(page)) <= 0, String(await overflowOf(page)));
  check('pipeline: the Bookings tab stays highlighted', (await page.locator(`${T('tab-bookings')}[aria-current="page"]`).count()) === 1);

  // Stage strip numbers (the pinned seed at the fixed clock).
  for (const id of STAGES) {
    const c = Number(await text(page, T(`p1-stage-count-${id}`)));
    check(`pipeline: ${id} stage count is ${SEED_COUNTS[id]}`, c === SEED_COUNTS[id], String(c));
  }
  check('pipeline: Quote stage value is the sum of its quotes, fixed lines only (£5,983)', pounds(await text(page, T('p1-stage-value-quote'))) === 5983, await text(page, T('p1-stage-value-quote')));
  check('pipeline: Done stage value is the money earned (£8,771)', pounds(await text(page, T('p1-stage-value-done'))) === 8771, await text(page, T('p1-stage-value-done')));
  check('pipeline: an enquiry with no quote reads "Not quoted yet"', /Not quoted yet/.test(await text(page, T('p1-stage-value-enquiry'))));
  check('pipeline: header says how much is still to earn', /£13,526 still to earn/.test(await text(page, '.ui-page-header__sub')), await text(page, '.ui-page-header__sub'));
  check('pipeline: the strip is a tablist of six tabs', (await count(page, `${T('p1-strip')}[role="tablist"] [role="tab"]`)) === 6);

  // The first stage with something in it opens first; its cards are shown.
  check('pipeline: opens on the Enquiry stage', (await page.locator(`${T('p1-stage-enquiry')}[aria-selected="true"]`).count()) === 1);
  check('pipeline: Enquiry stage lists its two cards', (await count(page, `${T('p1-list')} > li`)) === 2);

  // SLA: Conor Brennan (bk_seed_11) is past the 24 hour promise but lives outside Northern Ireland: he gets the badge, never the alarm.
  check('pipeline: no reply reminder row for an overdue enquiry from outside Northern Ireland', (await count(page, T('p1-sla-banner'))) === 0);
  check('pipeline: the overdue card still carries an "Overdue by 6 h" badge', /Overdue by 6 h/.test(await text(page, T('p1-sla-bk_seed_11'))), await text(page, T('p1-sla-bk_seed_11')));
  check('pipeline: an outside-NI card has no urgency stripe and the Enquiry tile has no overdue dot', (await count(page, '.pl-card.is-overdue')) === 0 && !/overdue/.test(await text(page, T('p1-stage-enquiry'))), await text(page, T('p1-stage-enquiry')));
  check('pipeline: a fresh enquiry has a reply-due badge, not an overdue one', /Reply due in 23 h/.test(await text(page, T('p1-sla-bk_seed_07'))), await text(page, T('p1-sla-bk_seed_07')));
  check('pipeline: the whole card is the link, into the booking (next step: reply)', /Reply now/.test(await text(page, T('p1-action-bk_seed_11'))) && (await page.locator(T('p1-action-bk_seed_11')).getAttribute('href')) === '#/bookings/bk_seed_11');
  check('pipeline: a card outside Northern Ireland says so', /Outside Northern Ireland/.test((await page.locator(T('p1-card-bk_seed_11')).textContent()) || ''));

  // The first screen is the work, not chrome: six whole tiles without sideways scrolling, and the first card high up.
  const first = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="p1-strip"]');
    const tiles = [...strip.querySelectorAll('[role="tab"]')].map((t) => t.getBoundingClientRect());
    const card = document.querySelector('[data-testid="p1-list"] > li').getBoundingClientRect();
    return {
      fit: tiles.every((r) => r.left >= 0 && r.right <= innerWidth && r.width > 60),
      noScroll: strip.scrollWidth <= strip.clientWidth + 1,
      rows: new Set(tiles.map((r) => Math.round(r.top))).size,
      tileHeight: Math.max(...tiles.map((r) => r.height)),
      cardTop: Math.round(card.top)
    };
  });
  check('pipeline: all six stage tiles are whole on screen in two rows, with no sideways scrolling', first.fit && first.noScroll && first.rows === 2, JSON.stringify(first));
  check('pipeline: the first card starts above y=420', first.cardTop < 420, String(first.cardTop));
  check('pipeline: each tile shows its count and its £ (or a dash) in a compact tile', (await Promise.all(STAGES.map((id) => text(page, T(`p1-stage-value-${id}`))))).every((t) => /£[\d,]+|Not quoted yet/.test(t)) && first.tileHeight < 80, JSON.stringify(first));
  const sel = await page.evaluate(() => { const t = document.querySelector('.pl-tile.is-selected'); const cs = getComputedStyle(t); return { border: cs.borderTopColor, text: getComputedStyle(document.body).color, bg: cs.backgroundColor }; });
  check('pipeline: the selected tile is neutral (an ink border), not brand red', sel.border === sel.text && !/^rgb\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\)$/.test(sel.bg), JSON.stringify(sel));
  const cardShape = await page.evaluate(() => {
    const links = [...document.querySelectorAll('.pl-card')];
    const sums = [...document.querySelectorAll('.pl-card__summary')];
    return {
      footers: document.querySelectorAll('.pl-card__action').length,
      chevrons: links.filter((c) => c.querySelector('a.pl-card__link .pl-card__chev')).length,
      cards: links.length,
      clipped: sums.filter((e) => { const cs = getComputedStyle(e); return cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis'; }).length
    };
  });
  check('pipeline: a card is one link with a chevron and has no "Open" footer', cardShape.footers === 0 && cardShape.cards > 0 && cardShape.chevrons === cardShape.cards, JSON.stringify(cardShape));
  check('pipeline: the detail line wraps (up to two lines) and is never cut mid-word', cardShape.clipped === 0, JSON.stringify(cardShape));

  // Pick a stage by tap: cards, URL, reload.
  await page.click(T('p1-stage-quote'));
  await until(page, () => document.querySelectorAll('[data-testid="p1-list"] > li').length === 5);
  check('pipeline: tapping Quote shows its five cards', (await count(page, `${T('p1-list')} > li`)) === 5);
  check('pipeline: the chosen stage is kept in the address (?s=quote)', /s=quote/.test(await hashOf(page)), await hashOf(page));
  check('pipeline: a draft quote card offers "Finish the quote"', /Finish the quote/.test(await text(page, T('p1-action-bk_seed_17'))) && (await page.locator(T('p1-action-bk_seed_17')).getAttribute('href')) === '#/quotes/Q-EL-1023', (await page.locator(T('p1-action-bk_seed_17')).getAttribute('href')) || '');
  check('pipeline: a card with no quote offers "Write the quote" into a new draft', /Write the quote/.test(await text(page, T('p1-action-bk_seed_16'))) && (await page.locator(T('p1-action-bk_seed_16')).getAttribute('href')) === '#/quotes/new?booking=bk_seed_16', (await page.locator(T('p1-action-bk_seed_16')).getAttribute('href')) || '');
  check('pipeline: a viewed quote offers a follow-up', /Follow up the quote/.test(await text(page, T('p1-action-bk_seed_19'))));
  check('pipeline: a sent quote shows its value', pounds(await text(page, T('p1-card-bk_seed_18'))) === 1586, await text(page, T('p1-card-bk_seed_18')));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(T('p1-strip'));
  check('pipeline: after a reload the same stage is selected', (await page.locator(`${T('p1-stage-quote')}[aria-selected="true"]`).count()) === 1);

  // Keyboard: arrow keys move through the stages.
  await page.focus(T('p1-stage-quote'));
  await page.keyboard.press('ArrowRight');
  await until(page, () => document.querySelector('[data-testid="p1-stage-accepted"]').getAttribute('aria-selected') === 'true');
  check('pipeline: ArrowRight moves to the next stage and focuses it', (await page.locator(`${T('p1-stage-accepted')}[aria-selected="true"]`).count()) === 1 && (await page.evaluate(() => document.activeElement.getAttribute('data-testid'))) === 'p1-stage-accepted');
  check('pipeline: an accepted job offers to confirm the install day', /Confirm the install day/.test(await text(page, T('p1-action-bk_seed_21'))) && (await page.locator(T('p1-action-bk_seed_21')).getAttribute('href')) === '#/bookings/bk_seed_34');
  await page.keyboard.press('ArrowDown');
  await until(page, () => document.querySelector('[data-testid="p1-stage-install"]').getAttribute('aria-selected') === 'false' && document.querySelector('[data-testid="p1-stage-enquiry"]').getAttribute('aria-selected') === 'true');
  check('pipeline: ArrowDown moves a row in the 3 x 2 grid (Accepted goes up to Enquiry)', (await page.locator(`${T('p1-stage-enquiry')}[aria-selected="true"]`).count()) === 1);
  await page.keyboard.press('End');
  await until(page, () => document.querySelector('[data-testid="p1-stage-done"]').getAttribute('aria-selected') === 'true');
  check('pipeline: End goes to the Done stage', (await page.locator(`${T('p1-stage-done')}[aria-selected="true"]`).count()) === 1);
  check('pipeline: a done job that is unpaid says To collect and offers payment', /To collect/.test(await text(page, T('p1-card-bk_seed_31'))) && /Collect payment/.test(await text(page, T('p1-action-bk_seed_31'))));
  check('pipeline: a paid job says Paid', /Paid/.test(await text(page, T('p1-card-bk_seed_29'))));

  // Lost drawer.
  check('pipeline: the Lost drawer summarises the count and the value', /3 · £2,908 not won/.test(await text(page, T('p1-lost'))), await text(page, T('p1-lost')));
  check('pipeline: the Lost drawer is closed to start with', !(await page.locator(T('p1-lost')).evaluate((el) => el.open)));
  await page.click(`${T('p1-lost')} summary`);
  await until(page, () => document.querySelector('[data-testid="p1-lost"]').open);
  check('pipeline: opening the Lost drawer lists three cards', (await count(page, `${T('p1-lost-list')} > li`)) === 3);
  check('pipeline: a declined quote keeps its reason', /Found a lower price elsewhere/.test(await text(page, T('p1-lost-list'))));

  // The List | Pipeline control.
  check('pipeline: List | Pipeline control has Pipeline selected', (await page.locator(`${T('p1-view-pipeline')}[aria-checked="true"]`).count()) === 1);
  check('pipeline: the switcher offers List | Pipeline | Customers, the same three as Bookings', (await page.locator(`${T('p1-view-toggle')} [role="radio"]`).allTextContents()).map((t) => t.trim()).join('|') === 'List|Pipeline|Customers');
  await page.click(T('p1-stage-quote'));
  await sleep(300);
  check('pipeline: a quote on a card wears the same pill as the Quotes list (viewed is amber, sent is blue)', (await page.locator('[data-testid^="p1-qpill-"].q1-pill--viewed').count()) >= 1 && (await page.locator('[data-testid^="p1-qpill-"].q1-pill--sent').count()) >= 1);
  await page.click(T('p1-view-list'));
  await until(page, () => location.hash.startsWith('#/bookings'));
  await page.waitForLoadState('networkidle');
  await sleep(300);
  check('pipeline: tapping List goes to the Bookings list', (await hashOf(page)).startsWith('#/bookings'), await hashOf(page));

  // Tap targets and axe.
  await gotoDash(page, '#/pipeline?s=quote');
  const small = await smallTargets(page);
  check('pipeline: every tap target is at least 44px', small.length === 0, small.slice(0, 5).join(', '));
  await axeCheck(page, 'pipeline (dark)');
  check('pipeline phone: no console errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();

  // Light theme and the narrowest phone.
  for (const w of [320, 390]) {
    const lctx = await newContext(browser, { w, scheme: 'light' });
    const lpage = await lctx.newPage();
    const lbag = [];
    watch(lpage, lbag)(`pipeline light ${w}`);
    await gotoDash(lpage, '#/pipeline');
    check(`pipeline (light, ${w}px): no horizontal overflow`, (await overflowOf(lpage)) <= 0, String(await overflowOf(lpage)));
    if (w === 320) await axeCheck(lpage, 'pipeline (light)');
    check(`pipeline (light, ${w}px): clean console and requests`, lbag.length === 0, lbag.slice(0, 3).join(' || '));
    await lctx.close();
  }
}

// ---------- 2. Pipeline on a wide screen ----------

async function pipelineWide(browser) {
  // From 1260px the six columns sit side by side (about 150px each) and nothing scrolls; below that the stage tiles and one list are used.
  for (const w of [1280, 1440, 1600]) {
    const ctx = await newContext(browser, { w, h: 900, scheme: 'dark' });
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag)(`pipeline ${w}`);
    await gotoDash(page, '#/pipeline');
    check(`pipeline (${w}px): shows the kanban board with six columns and no stage tiles`, (await count(page, `${T('p1-board')} > section`)) === 6 && (await count(page, T('p1-strip'))) === 0);
    check(`pipeline (${w}px): column counts match the seed`, (await Promise.all(STAGES.map(async (id) => Number(await text(page, `${T(`p1-col-${id}`)} ${T(`p1-stage-count-${id}`)}`))))).join() === STAGES.map((id) => SEED_COUNTS[id]).join());
    check(`pipeline (${w}px): no horizontal overflow of the page`, (await overflowOf(page)) <= 0, String(await overflowOf(page)));
    const geo = await page.evaluate(() => {
      const cols = [...document.querySelectorAll('.pl-col')].map((c) => c.getBoundingClientRect());
      const board = document.querySelector('.pl-board');
      const counts = [...document.querySelectorAll('.pl-col__count')].map((c) => { const r = c.getBoundingClientRect(); const p = c.closest('.pl-col').getBoundingClientRect(); return r.right <= p.right + 0.5 && r.left >= p.left; });
      return { fit: cols.every((r) => r.left >= 0 && r.right <= innerWidth + 0.5), widths: cols.map((r) => Math.round(r.width)), equal: new Set(cols.map((r) => Math.round(r.height))).size === 1, noScroll: board.scrollWidth <= board.clientWidth + 1, counts: counts.every(Boolean) };
    });
    check(`pipeline (${w}px): all six columns are whole on screen, about 150px or more each, with no sideways scroll and no clipped count`, geo.fit && geo.noScroll && geo.counts && Math.min(...geo.widths) >= 145, JSON.stringify(geo));
    check(`pipeline (${w}px): the lanes are the same height, so unequal piles read as intended`, geo.equal, JSON.stringify(geo));
    check(`pipeline (${w}px): cards sit inside their column`, await page.evaluate(() => [...document.querySelectorAll('.pl-col')].every((col) => [...col.querySelectorAll('.pl-card')].every((c) => c.getBoundingClientRect().right <= col.getBoundingClientRect().right + 1))));
    const compact = await page.evaluate(() => { const c = document.querySelector('[data-testid="p1-card-bk_seed_18"]'); return { chips: getComputedStyle(c.querySelector('.pl-card__badges')).display, glyph: getComputedStyle(c.querySelector('.pl-card__glyph')).display, h: Math.round(c.getBoundingClientRect().height) }; });
    if (w < 1600) check(`pipeline (${w}px): a board card is compact (name, £, one status icon), not the full phone card`, compact.chips === 'none' && compact.glyph !== 'none' && compact.h < 140, JSON.stringify(compact));
    if (w === 1280) {
      await page.setViewportSize({ width: 1280, height: 560 });
      const stick = await page.evaluate(async () => {
        const head = document.querySelector('.pl-col__head');
        const before = head.getBoundingClientRect().top;
        window.scrollTo(0, 300);
        await new Promise((r) => setTimeout(r, 150));
        return { position: getComputedStyle(head).position, before: Math.round(before), after: Math.round(head.getBoundingClientRect().top) };
      });
      check('pipeline (1280px): the column headers are sticky under the page header', stick.position === 'sticky' && stick.after > 40 && stick.after < 90 && stick.after < stick.before, JSON.stringify(stick));
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const small = await smallTargets(page);
      check('pipeline (1280px): every tap target is at least 44px', small.length === 0, small.slice(0, 5).join(', '));
      await axeCheck(page, 'pipeline board (dark)');
      await page.click(`${T('p1-lost')} summary`);
      check('pipeline (1280px): the Lost drawer opens under the board', (await count(page, `${T('p1-lost-list')} > li`)) === 3);
    }
    check(`pipeline (${w}px): clean console and requests`, bag.length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }
  // 1100: the sidebar leaves too little room for six columns, so the tablet layout is used (no clipped column, no hidden ones).
  {
    const ctx = await newContext(browser, { w: 1100, h: 900, scheme: 'dark' });
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag)('pipeline 1100');
    await gotoDash(page, '#/pipeline');
    check('pipeline (1100px): uses the six stage tiles in one row, no board to clip', (await count(page, `${T('p1-strip')} [role="tab"]`)) === 6 && (await count(page, T('p1-board'))) === 0);
    check('pipeline (1100px): no horizontal overflow of the page', (await overflowOf(page)) <= 0, String(await overflowOf(page)));
    check('pipeline (1100px): the tiles fit in one row', await page.evaluate(() => { const t = [...document.querySelectorAll('[data-testid="p1-strip"] [role="tab"]')].map((x) => x.getBoundingClientRect()); return new Set(t.map((r) => Math.round(r.top))).size === 1 && t.every((r) => r.right <= innerWidth); }));
    check('pipeline (1100px): clean console and requests', bag.length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }
}

// ---------- 2b. The reply reminder: one slim, dismissible row, only for an enquiry inside Northern Ireland ----------

async function pipelineSla(browser) {
  const ctx = await newContext(browser, { scheme: 'dark' });
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('pipeline sla');
  await gotoDash(page, '#/pipeline');
  // Make Sinead Doherty (BT42, inside the area) a day and a half old with no reply.
  const age = () => page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('vm_state_v1'));
    raw.bookings.find((b) => b.id === 'bk_seed_07').createdAt = '2026-10-22T10:00';
    raw.rev = (raw.rev || 0) + 3; raw.meta = { ...(raw.meta || {}), rev: ((raw.meta && raw.meta.rev) || 0) + 3 };
    localStorage.setItem('vm_state_v1', JSON.stringify(raw));
  });
  await age();
  await gotoDash(page, '#/pipeline');
  check('sla: one slim row names the overdue enquiry inside Northern Ireland', /Sinead/.test(await text(page, T('p1-sla-banner'))) && /10 h/.test(await text(page, T('p1-sla-banner'))), await text(page, T('p1-sla-banner')));
  const box = await page.locator(T('p1-sla-banner')).boundingBox();
  check('sla: the row is at most 56px tall', box && box.height <= 56 && box.height >= 44, JSON.stringify(box));
  check('sla: the reply button opens that enquiry', (await page.locator(T('p1-sla-reply')).getAttribute('href')) === '#/bookings/bk_seed_07');
  check('sla: the overdue card has the urgency stripe and the Enquiry tile an overdue dot', (await count(page, '.pl-card.is-overdue')) === 1 && /1 overdue/.test(await text(page, T('p1-stage-enquiry'))));
  const small = await smallTargets(page);
  check('sla: its buttons are at least 44px', small.length === 0, small.join(', '));
  await page.click(T('p1-sla-dismiss'));
  await until(page, () => !document.querySelector('[data-testid="p1-sla-banner"]'));
  check('sla: dismissing puts the row away', (await count(page, T('p1-sla-banner'))) === 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(T('p1-strip'));
  check('sla: it stays away for the rest of the session', (await count(page, T('p1-sla-banner'))) === 0);
  check('sla: the card still shows its overdue badge and stripe', /Overdue by 10 h/.test(await text(page, T('p1-sla-bk_seed_07'))) && (await count(page, '.pl-card.is-overdue')) === 1);
  // A reply clears the badge and the stripe too.
  await store(page, (s) => s.confirmBooking('bk_seed_07'));
  await until(page, () => !document.querySelector('.pl-card.is-overdue'));
  check('sla: once the enquiry is answered the stripe is gone', (await count(page, '.pl-card.is-overdue')) === 0);
  check('sla: clean console and requests', bag.length === 0, bag.slice(0, 3).join(' || '));
  await ctx.close();
}

// ---------- 3. Live updates, two tabs, and the empty state ----------

async function pipelineLive(browser) {
  const ctx = await newContext(browser, { scheme: 'dark' });
  const a = await ctx.newPage();
  const bag = [];
  watch(a, bag)('pipeline live');
  await gotoDash(a, '#/pipeline');
  const b = await ctx.newPage();
  watch(b, bag)('pipeline live b');
  await gotoDash(b, '#/pipeline?s=survey');

  // Confirm the fresh enquiry (Sinead Doherty, bk_seed_07) from tab A: it leaves Enquiry and joins Survey, in both tabs.
  const res = await store(a, (s) => s.confirmBooking('bk_seed_07'));
  check('live: confirming an enquiry in the store succeeds', res && res.ok === true, JSON.stringify(res));
  const moved = await until(a, () => document.querySelector('[data-testid="p1-stage-count-enquiry"]').textContent.trim() === '1' && document.querySelector('[data-testid="p1-stage-count-survey"]').textContent.trim() === '4');
  check('live: the strip moves the card from Enquiry to Survey at once', !!moved, `${await text(a, T('p1-stage-count-enquiry'))} / ${await text(a, T('p1-stage-count-survey'))}`);
  const movedB = await until(b, () => document.querySelector('[data-testid="p1-stage-count-survey"]').textContent.trim() === '4', undefined, 4000);
  check('live: a second tab shows the same change without a reload', !!movedB, await text(b, T('p1-stage-count-survey')));
  check('live: the second tab lists the new survey card', (await count(b, `${T('p1-list')} > li`)) === 4);

  // Empty state: a saved state with no bookings and no quotes.
  const ectx = await newContext(browser, { scheme: 'dark' });
  const e = await ectx.newPage();
  const ebag = [];
  watch(e, ebag)('pipeline empty');
  await gotoDash(e, '#/pipeline');
  await store(e, (s) => { const st = JSON.parse(JSON.stringify(s.getState())); return st.bookings.length; });
  await e.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('vm_state_v1'));
    raw.bookings = []; raw.quotes = {}; raw.messages = []; raw.blocks = [];
    raw.rev = (raw.rev || 0) + 5; raw.meta = { ...(raw.meta || {}), rev: ((raw.meta && raw.meta.rev) || 0) + 5 };
    localStorage.setItem('vm_state_v1', JSON.stringify(raw));
  });
  await e.goto(`${BASE}/dashboard.html?${NOW}&_=${n += 1}#/pipeline`, { waitUntil: 'networkidle' });
  await e.waitForSelector(T('view-title'));
  await sleep(300);
  const empty = (await count(e, T('p1-empty'))) === 1;
  check('empty: an empty pipeline shows a friendly message with a way to start', empty && /Nothing in your pipeline yet/.test(await text(e, T('p1-empty'))), await text(e, 'main'));
  if (empty) check('empty: the call to action goes to Share and promote', (await e.locator(`${T('p1-empty')} a`).first().getAttribute('href')) === '#/share');
  check('empty: no strip and no Lost drawer without any jobs', (await count(e, T('p1-strip'))) === 0 && (await count(e, T('p1-lost'))) === 0);
  check('empty: clean console and requests', ebag.length === 0, ebag.slice(0, 3).join(' || '));
  await ectx.close();
  check('live: clean console and requests', bag.length === 0, bag.slice(0, 3).join(' || '));
  await ctx.close();
}

// ---------- 4. Insights ----------

async function insightsPhone(browser) {
  const ctx = await newContext(browser, { scheme: 'dark' });
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  setWhere('insights');
  await gotoDash(page, '#/insights');

  // The figures the screen should show, worked out from the same store (so a change to the sample data never makes this test lie).
  const calc = await page.evaluate(async () => {
    const sel = await import('/js/core/selectors.js');
    const st = await import('/js/core/store.js');
    const state = st.getState();
    const now = '2026-10-23T20:30';
    const src = sel.selectLeadSources(state, 'month', now);
    const all = sel.selectLeadSources(state, 'all', now);
    return { ins: sel.selectInsights(state, now), q: sel.selectQuoteStats(state, '90d', now), sla: sel.selectSla(state, now), fb: src.sources.find((x) => x.id === 'facebook'), month: src, all };
  });
  const money = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;

  check('insights: the page and its tab are called Money', (await text(page, T('view-title'))) === 'Money' && /Money/.test(await text(page, T('tab-insights'))) && !/Insights/.test(await text(page, T('tab-insights'))), `${await text(page, T('view-title'))} | ${await text(page, T('tab-insights'))}`);
  check('insights: no horizontal overflow at 375px', (await overflowOf(page)) <= 0, String(await overflowOf(page)));

  // Order: what he is owed, then what he collected, then the small tiles, then the detail.
  const order = await page.evaluate(() => {
    const top = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().top) : -1; };
    return { title: top('[data-testid="view-title"]'), owed: top('[data-testid="insights-owed"]'), list: top('[data-testid="owed-list"]'), hero: top('[data-testid="insights-collected"]'), tiles: top('[data-testid="p1-headline"]'), reply: top('[data-testid="p1-reply"]'), firstNudge: top('[data-testid^="owed-nudge-"]'), firstPaid: top('[data-testid^="owed-mark-paid-"]') };
  });
  check('insights: the first thing under the title is "Owed to you", with Nudge and Mark paid on its first row', order.owed > order.title && order.owed < order.hero && order.firstNudge > 0 && order.firstNudge < 700 && order.firstPaid > 0 && order.firstPaid < 700, JSON.stringify(order));
  check('insights: then the hero (collected), then the tiles, then the reply card', order.hero < order.tiles && order.tiles < order.reply, JSON.stringify(order));
  const ot = await page.evaluate(() => { const t = document.querySelector('[data-testid="insights-owed-total"]'); const c = document.querySelector('[data-testid="insights-owed-count"]'); return { total: getComputedStyle(t).color, body: getComputedStyle(document.body).color, count: getComputedStyle(c).color }; });
  check('insights: owed to you is ink with an amber count, not red', ot.total === ot.body && !/^rgb\((2[0-9]{2}|1[89][0-9]), ?[0-9]{1,2}, ?[0-9]{1,2}\)$/.test(ot.count), JSON.stringify(ot));

  // The numbers.
  check(`insights: owed is ${money(calc.ins.owedTotal)} across ${calc.ins.owedCount} jobs`, pounds(await text(page, T('insights-owed-total'))) === Math.round(calc.ins.owedTotal) && new RegExp(`${calc.ins.owedCount} jobs`).test(await text(page, T('insights-owed-count'))), await text(page, T('insights-owed')));
  check(`insights: the hero says collected this month is ${money(calc.ins.collectedMonth)} from ${calc.ins.collectedMonthCount} jobs, and draws a sparkline of the weeks`, pounds(await text(page, T('insights-collected-value'))) === Math.round(calc.ins.collectedMonth) && new RegExp(`${calc.ins.collectedMonthCount} jobs`).test(await text(page, T('insights-collected'))) && (await count(page, `${T('insights-spark')} svg polyline`)) >= 2, await text(page, T('insights-collected')));
  check(`insights: quotes out is ${money(calc.q.waitingValue)} with ${calc.q.waitingCount} waiting`, pounds(await text(page, T('p1-quotes-out-value'))) === Math.round(calc.q.waitingValue) && new RegExp(`${calc.q.waitingCount} quotes? waiting`).test(await text(page, T('p1-quotes-out'))), await text(page, T('p1-quotes-out')));
  check('insights: quotes out links to the waiting quotes', (await page.locator(T('p1-quotes-out')).getAttribute('href')) === '#/quotes?f=waiting');
  const wantWin = calc.q.sent ? Math.round((100 * calc.q.accepted) / calc.q.sent) : null;
  const headText = await page.evaluate(() => document.querySelector('.in-top').innerText);
  check(`insights: ONE win rate, "Accepted ${wantWin}% of quotes sent", and no second conversion figure in the headline area`, (await text(page, T('p1-win-rate-value'))) === `${wantWin}%` && (headText.match(/\d+%/g) || []).filter((p) => p !== `${wantWin}%`).join('') === `${calc.sla.withinTargetPct}%` && !/win rate|decided|of enquiries/i.test(headText), headText.replace(/\s+/g, ' ').slice(0, 400));
  const defBefore = await count(page, T('p1-win-rate-def'));
  await page.click(T('p1-win-rate-info'));
  await until(page, () => !!document.querySelector('[data-testid="p1-win-rate-def"]'));
  check('insights: tapping the info button gives the definition', defBefore === 0 && /count as not accepted yet/.test(await text(page, T('p1-win-rate-def'))), await text(page, T('p1-win-rate-def')));
  check('insights: next 14 days and average job are tiles (a free survey is not in the average)', (await count(page, T('insights-booked-next'))) === 1 && pounds(await text(page, T('insights-avg-value'))) === Math.round(calc.ins.avgJob) && pounds(await text(page, T('insights-booked-next-value'))) === Math.round(calc.ins.bookedNext14), `${await text(page, T('insights-avg'))} ${await text(page, T('insights-booked-next'))}`);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.in-tile')].map((t) => {
    const r = t.getBoundingClientRect(); const l = t.querySelector('.in-tile__label').getBoundingClientRect(); const v = t.querySelector('.in-tile__value').getBoundingClientRect();
    return { n: t.querySelector('.in-tile__label').textContent.trim(), labelH: Math.round(l.height), valueY: Math.round(v.top - r.top), oneLine: t.querySelector('.in-tile__label').scrollWidth <= t.querySelector('.in-tile__label').clientWidth + 1, capLines: Math.round(t.querySelector('.in-tile__caption').getBoundingClientRect().height / parseFloat(getComputedStyle(t.querySelector('.in-tile__caption')).lineHeight)) };
  }));
  check('insights: the four small tiles have one-line labels of the same height, values at the same height and captions of at most two lines', tiles.length === 4 && new Set(tiles.map((t) => t.labelH)).size === 1 && new Set(tiles.map((t) => t.valueY)).size === 1 && tiles.every((t) => t.oneLine && t.capLines <= 2), JSON.stringify(tiles));
  check('insights: sample-driven figures carry a small Sample tag', (await count(page, `${T('insights-collected')} .ui-tag-sample`)) === 1 && (await count(page, '.in-tile .ui-tag-sample')) >= 1);
  check('insights: free surveys are listed as free, not as £0', /Free surveys/.test(await text(page, T('insights-by-service'))) && /Free/.test(await text(page, T('insights-by-service'))) && !/£0/.test(await text(page, T('insights-by-service'))));
  const figs = await page.evaluate(() => ['.in-hero__value', '.in-tile__value', '.in-owedhead__total'].map((q) => getComputedStyle(document.querySelector(q)).fontVariantNumeric));
  check('insights: display figures use proportional numerals, not tabular', figs.every((f) => /proportional-nums/.test(f) && !/tabular-nums/.test(f)), figs.join(' | '));

  // Owed list.
  check(`insights: owed list has ${calc.ins.owedCount} rows with Nudge and Mark paid`, (await count(page, `${T('owed-list')} > li`)) === calc.ins.owedCount && (await count(page, '[data-testid^="owed-nudge-"]')) === calc.ins.owedCount && (await count(page, '[data-testid^="owed-mark-paid-"]')) === calc.ins.owedCount);

  // Reply time vs the promise.
  const pctWant = calc.sla.withinTargetPct;
  check(`insights: ${pctWant}% were answered inside the 24 hour promise (the ring says ${pctWant}%, the sentence does not repeat it)`, new RegExp(`${pctWant}%`).test(await text(page, T('p1-reply-ring'))) && /24 hours/.test(await text(page, T('p1-reply-pct'))) && !new RegExp(String(pctWant)).test(await text(page, T('p1-reply-pct'))), `${await text(page, T('p1-reply-ring'))} | ${await text(page, T('p1-reply-pct'))}`);
  check('insights: the reply-rate tile agrees with the ring', (await text(page, T('p1-reply-rate-value'))) === `${pctWant}%`);
  check('insights: the average reply is 4 h 14 min', /4 h 14 min/.test(await text(page, T('p1-reply-avg'))), await text(page, T('p1-reply-avg')));
  check('insights: the overdue enquiry is listed with a Reply link', /Conor Brennan/.test(await text(page, T('p1-wait-bk_seed_11'))) && /Overdue by 6 h/.test(await text(page, T('p1-wait-bk_seed_11'))) && (await page.locator(T('p1-wait-reply-bk_seed_11')).getAttribute('href')) === '#/bookings/bk_seed_11');
  check('insights: the reply ring is a labelled meter', (await page.locator(`${T('p1-reply-ring')}[role="meter"]`).getAttribute('aria-valuenow')) === String(pctWant));

  // Where enquiries come from: This month, then All time.
  check(`sources: this month Facebook has ${calc.fb.enquiries} enquiries and ${money(calc.fb.revenue)} in`, Number(await text(page, T('p1-source-n-facebook'))) === calc.fb.enquiries && pounds(await text(page, T('p1-source-rev-facebook'))) === Math.round(calc.fb.revenue), `${await text(page, T('p1-source-n-facebook'))} ${await text(page, T('p1-source-rev-facebook'))}`);
  check('sources: sources with no enquiries are not listed', (await count(page, T('p1-source-other'))) === 0);
  check('sources: no money yet is said plainly', /No money in yet/.test(await text(page, T('p1-source-rev-instagram'))));
  const monthN = Object.fromEntries(calc.month.sources.map((x) => [x.id, x.enquiries]));
  const widths = await page.evaluate(() => ['facebook', 'instagram', 'google'].map((id) => { const f = document.querySelector(`[data-testid="p1-source-${id}"] .in-bar__fill`).getBoundingClientRect().width; const t = document.querySelector(`[data-testid="p1-source-${id}"] .in-bar`).getBoundingClientRect().width; return f / t; }));
  check('sources: bars are drawn to scale (Facebook full, Instagram and Google in proportion)', Math.abs(widths[0] - 1) < 0.02 && Math.abs(widths[1] - monthN.instagram / monthN.facebook) < 0.03 && Math.abs(widths[2] - monthN.google / monthN.facebook) < 0.03, widths.map((w) => w.toFixed(3)).join(' '));
  // Cost and funnel are folded into one closed section.
  check('insights: "Ads and results" is closed to start with, and holds the cost per enquiry and the funnel', !(await page.locator(T('p1-ads-results')).evaluate((el) => el.open)) && (await count(page, `${T('p1-ads-results')} ${T('p1-costs')}`)) === 1 && (await count(page, `${T('p1-ads-results')} ${T('p1-funnel')}`)) === 1 && !(await page.locator(T('p1-costs')).isVisible()));
  await page.click(`${T('p1-ads-results')} summary`);
  await until(page, () => document.querySelector('[data-testid="p1-ads-results"]').open);
  check('insights: opening it shows the cost per enquiry', await page.locator(T('p1-cost-enquiry')).isVisible());
  await page.click(`${T('p1-ads-results')} summary`);
  const fbAll = calc.all.sources.find((x) => x.id === 'facebook').enquiries;
  await page.click(T('p1-period-all'));
  await until(page, (n) => document.querySelector('[data-testid="p1-source-n-facebook"]').textContent.trim() === String(n), fbAll);
  check(`sources: All time shows ${fbAll} Facebook enquiries and the choice is in the address`, Number(await text(page, T('p1-source-n-facebook'))) === fbAll && /p=all/.test(await hashOf(page)), await hashOf(page));
  check('funnel: follows the same period (all time)', (await Promise.all(['enquiries', 'quotes', 'accepted', 'installs'].map((id) => text(page, `${T(`p1-funnel-${id}`)} strong`)))).join() === [calc.all.total.enquiries, calc.all.total.quotes, calc.all.total.accepted, calc.all.total.installs].join());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(T('p1-sources'));
  check('sources: after a reload the period is still All time', (await page.locator(`${T('p1-period-all')}[aria-checked="true"]`).count()) === 1);
  await page.click(T('p1-period-month'));
  await until(page, (n) => document.querySelector('[data-testid="p1-source-n-facebook"]').textContent.trim() === String(n), calc.fb.enquiries);
  await page.click(`${T('p1-ads-results')} summary`);
  await until(page, () => document.querySelector('[data-testid="p1-ads-results"]').open);
  const fw = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="p1-funnel-"] .in-bar__fill')].map((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width));
  const ft = calc.month.total;
  const fmax = Math.max(1, ft.enquiries, ft.quotes, ft.accepted, ft.installs);
  check(`funnel: bars are drawn to scale (${ft.enquiries}, ${ft.quotes}, ${ft.accepted}, ${ft.installs})`, fw.length === 4 && [ft.enquiries, ft.quotes, ft.accepted, ft.installs].every((n, i) => Math.abs(fw[i] - n / fmax) < 0.03), fw.map((w) => w.toFixed(3)).join(' '));
  check('funnel: the old paragraph that reconciled two conversion figures is gone', !(await count(page, T('p1-funnel-note'))));
  await page.click(`${T('p1-ads-results')} summary`);
  // "View as a table" is a small text toggle in the card header (it was a heavy full-width row under every chart).
  const tog = await page.locator(T('p1-sources-toggle')).boundingBox();
  check('sources: "View as a table" is a small text toggle in the header, not a full-width button', tog && tog.width < 220 && tog.height <= 48, JSON.stringify(tog));
  await page.click(T('p1-sources-toggle'));
  check('sources: the table twin replaces the chart and lists every source', (await count(page, `${T('p1-sources-table')} tbody tr`)) === calc.month.sources.filter((x) => x.enquiries > 0).length + 1 && (await count(page, T('p1-sources-list'))) === 0, String(await count(page, `${T('p1-sources-table')} tbody tr`)));
  check('sources: the toggle then offers the chart again', /chart/.test(await text(page, T('p1-sources-toggle'))));
  await page.click(T('p1-sources-toggle'));

  // Weekly money.
  check('weekly: six bars, oldest first, the current week last', (await count(page, '[data-testid^="insights-weekbar-"]')) === 6 && (await count(page, T('insights-weekbar-5'))) === 1);
  const wk = calc.ins.weeks;
  const best = wk.reduce((bi, w, i) => (w.total > wk[bi].total ? i : bi), 0);
  check(`weekly: the busiest week reads ${money(wk[best].total)}`, (await text(page, T(`insights-weekbar-${best}`))).includes(money(wk[best].total)), await text(page, T(`insights-weekbar-${best}`)));
  const zero = wk.findIndex((w) => w.total === 0);
  if (zero >= 0) {
    const zs = await page.evaluate((i) => { const li = document.querySelector(`[data-testid="insights-weekbar-${i}"]`); const stub = li.querySelector('.in-bar__stub'); return { label: li.querySelector('.in-bar__val').textContent.trim(), dashed: stub ? getComputedStyle(stub).borderTopStyle : '' }; }, zero);
    check('weekly: a week with nothing in it is a dashed bar labelled £0, not a bare stub', zs.label === '£0' && zs.dashed === 'dashed', JSON.stringify(zs));
  }
  const cs = await page.evaluate(() => { const li = document.querySelector('[data-testid="insights-weekbar-5"]'); const prev = document.querySelector('[data-testid="insights-weekbar-4"] .in-bar__fill'); const f = li.querySelector('.in-bar__fill'); return { label: li.querySelector('.in-bar__val').textContent.trim(), opacity: f ? Number(getComputedStyle(f).opacity) : 1, prev: prev ? Number(getComputedStyle(prev).opacity) : 1 }; });
  check('weekly: this week is drawn lighter and says "so far"', /so far/.test(cs.label) && cs.opacity < cs.prev, JSON.stringify(cs));
  await page.click(T('p1-weeks-toggle'));
  check('weekly: the table twin lists the six weeks and marks this one "so far"', (await count(page, `${T('p1-weeks-table')} tbody tr`)) === 6 && /so far/.test(await text(page, `${T('p1-weeks-table')} tbody tr:last-child`)));
  await page.click(T('p1-weeks-toggle'));

  const small = await smallTargets(page);
  check('insights: every tap target is at least 44px', small.length === 0, small.slice(0, 6).join(', '));
  await axeCheck(page, 'insights (dark)');
  check('insights: clean console and requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();

  for (const [w, scheme] of [[320, 'light'], [375, 'light'], [390, 'dark'], [768, 'dark']]) {
    const c2 = await newContext(browser, { w, scheme });
    const p2 = await c2.newPage();
    const b2 = [];
    watch(p2, b2)(`insights ${w}`);
    await gotoDash(p2, '#/insights');
    check(`insights (${scheme}, ${w}px): no horizontal overflow`, (await overflowOf(p2)) <= 0, String(await overflowOf(p2)));
    check(`insights (${scheme}, ${w}px): the period control is one row (and scrolls, with a fade, if the phone is too narrow)`, await p2.evaluate(() => { const el = document.querySelector('[data-testid="p1-period"]'); const tops = new Set([...el.querySelectorAll('.ui-seg__opt')].map((o) => Math.round(o.getBoundingClientRect().top))); return tops.size === 1 && getComputedStyle(el).display !== 'grid' && (el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).overflowX === 'auto'); }));
    if (w === 320) {
      const sm = await smallTargets(p2);
      check('insights (320px): every tap target is at least 44px', sm.length === 0, sm.slice(0, 6).join(', '));
      await axeCheck(p2, 'insights (light)');
    }
    check(`insights (${scheme}, ${w}px): clean console and requests`, b2.length === 0, b2.slice(0, 3).join(' || '));
    await c2.close();
  }

  const wctx = await newContext(browser, { w: 1280, h: 900, scheme: 'dark' });
  const wpage = await wctx.newPage();
  const wbag = [];
  watch(wpage, wbag)('insights 1280');
  await gotoDash(wpage, '#/insights');
  check('insights (1280px): two columns, money left and marketing right', await wpage.evaluate(() => {
    const l = document.querySelector('.in-col--money').getBoundingClientRect();
    const r = document.querySelector('.in-col--marketing').getBoundingClientRect();
    return r.left >= l.right - 1 && l.width > 300 && r.width > 300;
  }));
  check('insights (1280px): no horizontal overflow', (await overflowOf(wpage)) <= 0, String(await overflowOf(wpage)));
  check('insights (1280px): clean console and requests', wbag.length === 0, wbag.slice(0, 3).join(' || '));
  await wctx.close();
}

// ---------- 5. Ad spend ----------

/** "Ads and results" is closed until he opens it. */
async function openAds(page) {
  if (!(await page.locator(T('p1-ads-results')).evaluate((el) => el.open))) await page.click(`${T('p1-ads-results')} summary`);
  await until(page, () => document.querySelector('[data-testid="p1-ads-results"]').open);
  await sleep(150);
}

async function adSpend(browser) {
  const ctx = await newContext(browser, { scheme: 'dark' });
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('ad spend');
  await gotoDash(page, '#/insights');
  await openAds(page);
  const label = () => text(page, T('p1-month-label'));
  const val = (id) => text(page, `${T(id)} .in-cost__value`);

  check('ads: opens on the current month, marked as sample', /October 2026/.test(await label()) && /SAMPLE/i.test(await label()), await label());
  check('ads: October spend is £290', pounds(await text(page, T('p1-ad-spend'))) === 290, await text(page, T('p1-ad-spend')));
  check('ads: cost per enquiry £21, per accepted quote £48, per install £145', pounds(await val('p1-cost-enquiry')) === 21 && pounds(await val('p1-cost-accepted')) === 48 && pounds(await val('p1-cost-install')) === 145, `${await val('p1-cost-enquiry')} ${await val('p1-cost-accepted')} ${await val('p1-cost-install')}`);
  check('ads: the stored amounts fill the form (Facebook 220, Instagram 70, Google empty)', (await page.inputValue(T('p1-ad-input-facebook'))) === '220' && (await page.inputValue(T('p1-ad-input-instagram'))) === '70' && (await page.inputValue(T('p1-ad-input-google'))) === '');
  check('ads: Save is off until something changes', await page.locator(T('p1-ad-save')).isDisabled());
  check('ads: next month is not offered', await page.locator(T('p1-month-next')).isDisabled());
  check('ads: the honesty note says other leads are left out', /Word of mouth and phone enquiries are left out/.test(await text(page, T('p1-ads'))));

  // Previous month: September, £390 spent.
  await page.click(T('p1-month-prev'));
  await until(page, () => /September 2026/.test(document.querySelector('[data-testid="p1-month-label"]').textContent));
  check('ads: previous month is September with £390 spent', pounds(await text(page, T('p1-ad-spend'))) === 390, await text(page, T('p1-ad-spend')));
  check('ads: September costs £130 an enquiry, accepted quote and install', pounds(await val('p1-cost-enquiry')) === 130 && pounds(await val('p1-cost-install')) === 130, `${await val('p1-cost-enquiry')} ${await val('p1-cost-install')}`);

  // Honest blanks: a month with no spend.
  for (let i = 0; i < 4; i += 1) { await page.click(T('p1-month-prev')); await sleep(60); }
  await until(page, () => /May 2026/.test(document.querySelector('[data-testid="p1-month-label"]').textContent));
  check('ads: a month with no spend says so', /No ad spend recorded for May/.test(await text(page, T('p1-ads'))), await text(page, `${T('p1-ads')} .in-spend`));
  check('ads: and shows honest blanks, not £0', (await val('p1-cost-enquiry')) === '—No figure yet' || /^—/.test(await val('p1-cost-enquiry')), await val('p1-cost-enquiry'));
  check('ads: the blank tells him what to do', /Add what you spent below/.test(await text(page, T('p1-cost-enquiry'))), await text(page, T('p1-cost-enquiry')));

  // Enter spend for that month: Save, costs appear (no enquiries that month, so still a blank with a different reason), Undo.
  await page.fill(T('p1-ad-input-facebook'), '150');
  check('ads: typing enables Save and says there are unsaved changes', !(await page.locator(T('p1-ad-save')).isDisabled()) && /not saved yet/.test(await text(page, `${T('p1-ad-form')} .in-form__state`)));
  await page.click(T('p1-ad-save'));
  await until(page, () => /£150/.test(document.querySelector('[data-testid="p1-ad-spend"]').textContent));
  check('ads: saving puts the spend into the month at once', pounds(await text(page, T('p1-ad-spend'))) === 150, await text(page, T('p1-ad-spend')));
  check('ads: a month with spend but no enquiries stays blank and says why', /No enquiries yet from this spend/.test(await text(page, T('p1-cost-enquiry'))), await text(page, T('p1-cost-enquiry')));
  check('ads: a toast confirms the save with Undo', (await toastWith(page, 'Ad spend saved for May').count()) === 1 && (await toastWith(page, 'Ad spend saved for May').locator(T('toast-action')).count()) === 1, await text(page, T('toast')));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vm_state_v1')).settings.marketing.adSpend.filter((e) => e.month === '2026-05'));
  check('ads: it is stored on this device (survives a reload)', stored.length === 1 && stored[0].amount === 150 && stored[0].channel === 'facebook', JSON.stringify(stored));
  await toastWith(page, 'Ad spend saved for May').locator(T('toast-action')).click();
  await until(page, () => /£0/.test(document.querySelector('[data-testid="p1-ad-spend"]').textContent));
  check('ads: Undo takes the spend back out', pounds(await text(page, T('p1-ad-spend'))) === 0 && (await page.inputValue(T('p1-ad-input-facebook'))) === '', await text(page, T('p1-ad-spend')));

  // Back to October: add Google spend, watch the three costs move, then undo.
  await gotoDash(page, '#/insights');
  await openAds(page);
  await page.fill(T('p1-ad-input-google'), '100');
  await page.click(T('p1-ad-save'));
  await until(page, () => /£390/.test(document.querySelector('[data-testid="p1-ad-spend"]').textContent));
  check('ads: adding Google spend raises October to £390', pounds(await text(page, T('p1-ad-spend'))) === 390, await text(page, T('p1-ad-spend')));
  check('ads: Google enquiries now count, so cost per enquiry becomes £26', pounds(await val('p1-cost-enquiry')) === 26, await val('p1-cost-enquiry'));
  check('ads: the channel table lists Google with its spend', /£100/.test(await text(page, T('p1-ad-channels'))), await text(page, T('p1-ad-channels')));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(T('p1-ads'), { state: 'attached' });
  await openAds(page);
  check('ads: after a reload the spend is still there', pounds(await text(page, T('p1-ad-spend'))) === 390 && (await page.inputValue(T('p1-ad-input-google'))) === '100');
  check('ads: the SAMPLE tag stays on the month while sample entries remain', /SAMPLE/i.test(await label()));

  // Clearing a field removes the entry; the month label keeps its place when Save is used for several channels at once.
  await page.fill(T('p1-ad-input-google'), '');
  await page.fill(T('p1-ad-input-other'), '40');
  await page.click(T('p1-ad-save'));
  await until(page, () => /£330/.test(document.querySelector('[data-testid="p1-ad-spend"]').textContent));
  check('ads: clearing one channel and adding another saves both (£330)', pounds(await text(page, T('p1-ad-spend'))) === 330, await text(page, T('p1-ad-spend')));
  // A tap on the previous month with unsaved typing saves it first, never drops it.
  await page.fill(T('p1-ad-input-instagram'), '95');
  await page.click(T('p1-month-prev'));
  await until(page, () => /September 2026/.test(document.querySelector('[data-testid="p1-month-label"]').textContent));
  await page.click(T('p1-month-next'));
  await until(page, () => /October 2026/.test(document.querySelector('[data-testid="p1-month-label"]').textContent));
  check('ads: leaving a month with unsaved typing saves it first', (await page.inputValue(T('p1-ad-input-instagram'))) === '95' && pounds(await text(page, T('p1-ad-spend'))) === 355, `${await page.inputValue(T('p1-ad-input-instagram'))} ${await text(page, T('p1-ad-spend'))}`);

  // A failed save (the browser has no room): the numbers stay on screen, nothing is lost, he is told.
  await page.evaluate(() => { Storage.prototype.setItem = function setItem() { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; });
  await page.fill(T('p1-ad-input-facebook'), '999');
  await page.click(T('p1-ad-save'));
  await sleep(300);
  check('ads: a failed save keeps the typed number and shows an error', (await page.inputValue(T('p1-ad-input-facebook'))) === '999' && (await count(page, `${T('p1-ad-form')} .ui-field__error`)) >= 1, await text(page, T('p1-ad-form')));
  check('ads: a failed save says so in a toast', (await toastWith(page, 'did not save').count()) >= 1, await text(page, T('toast')));
  check('ads: Save is still available to try again', !(await page.locator(T('p1-ad-save')).isDisabled()));
  const sw = await smallTargets(page);
  check('ads: every tap target is at least 44px', sw.length === 0, sw.slice(0, 5).join(', '));
  check('ads: clean console and requests (quota errors are expected here)', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 6. Owed list still works, and reduced motion ----------

async function owedAndMotion(browser) {
  const ctx = await newContext(browser, { scheme: 'dark' });
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('owed');
  await gotoDash(page, '#/insights');
  const before = pounds(await text(page, T('insights-collected-value')));
  const owedBefore = pounds(await text(page, T('insights-owed-total')));
  const owedRowsBefore = await count(page, `${T('owed-list')} > li`);
  const first = await page.locator('[data-testid^="owed-mark-paid-"]').first().getAttribute('data-testid');
  const id = first.replace('owed-mark-paid-', '');
  const amount = pounds(await text(page, `${T(`owed-row-${id}`)} .in-owed__amount`));
  await page.click(T(first));
  await page.waitForSelector(T('paid-method-cash'));
  await page.click(T('paid-method-cash'));
  await page.click(T('paid-submit'));
  await page.waitForSelector(T('paid-submit'), { state: 'detached', timeout: 3000 }).catch(() => {});
  await until(page, (b) => !document.querySelector(`[data-testid="owed-row-${b}"]`), id);
  const after = pounds(await text(page, T('insights-collected-value')));
  const owedAfter = pounds(await text(page, T('insights-owed-total')));
  check('owed: marking a job paid moves its money from Owed to Collected', after === before + amount && owedAfter === owedBefore - amount, `${before}+${amount}=${after}; ${owedBefore}-${amount}=${owedAfter}`);
  check('owed: the row leaves the list', (await count(page, `${T('owed-list')} > li`)) === owedRowsBefore - 1);
  await ctx.close();

  // Reduced motion: the bars do not animate.
  const rctx = await newContext(browser, { scheme: 'dark', reducedMotion: true });
  const rpage = await rctx.newPage();
  await gotoDash(rpage, '#/insights');
  const dur = await rpage.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.in-bar__fill')).animationDuration));
  check('motion: with reduced motion the chart bars do not animate', dur < 0.01, String(dur));
  await gotoDash(rpage, '#/pipeline');
  const tdur = await rpage.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pl-card__chev')).transitionDuration));
  check('motion: with reduced motion the pipeline cards do not slide', tdur < 0.01, String(tdur));
  await rctx.close();
  check('owed: clean console and requests', bag.length === 0, bag.slice(0, 3).join(' || '));
}

// ---------- run ----------

(async () => {
  let browser;
  try {
    BASE = await startServer();
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    const parts = { pipelinePhone, pipelineWide, pipelineSla, pipelineLive, insightsPhone, adSpend, owedAndMotion };
    for (const [name, fn] of Object.entries(parts)) if (!only || only.includes(name)) await fn(browser);
  } catch (err) {
    check('the test run itself did not crash', false, String((err && err.stack) || err));
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
