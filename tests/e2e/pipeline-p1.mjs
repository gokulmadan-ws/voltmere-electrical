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
  check('pipeline: Quote stage value is the sum of its quotes (£6,403)', pounds(await text(page, T('p1-stage-value-quote'))) === 6403, await text(page, T('p1-stage-value-quote')));
  check('pipeline: Done stage value is the money earned (£9,191)', pounds(await text(page, T('p1-stage-value-done'))) === 9191, await text(page, T('p1-stage-value-done')));
  check('pipeline: an enquiry with no quote reads "Not quoted yet"', /Not quoted yet/.test(await text(page, T('p1-stage-value-enquiry'))));
  check('pipeline: header says how much is still to earn', /£14,366 still to earn/.test(await text(page, '.ui-page-header__sub')), await text(page, '.ui-page-header__sub'));
  check('pipeline: the strip is a tablist of six tabs', (await count(page, `${T('p1-strip')}[role="tablist"] [role="tab"]`)) === 6);

  // The first stage with something in it opens first; its cards are shown.
  check('pipeline: opens on the Enquiry stage', (await page.locator(`${T('p1-stage-enquiry')}[aria-selected="true"]`).count()) === 1);
  check('pipeline: Enquiry stage lists its two cards', (await count(page, `${T('p1-list')} > li`)) === 2);

  // SLA: Conor Brennan (bk_seed_11) is past the 24 hour promise.
  check('pipeline: SLA banner names the overdue enquiry', /Conor Brennan/.test(await text(page, T('p1-sla-banner'))) && /24 hour/.test(await text(page, T('p1-sla-banner'))), await text(page, T('p1-sla-banner')));
  check('pipeline: the overdue card carries an "Overdue by 6 h" badge', /Overdue by 6 h/.test(await text(page, T('p1-sla-bk_seed_11'))), await text(page, T('p1-sla-bk_seed_11')));
  check('pipeline: the Enquiry tile flags 1 overdue', /1 overdue/.test(await text(page, T('p1-stage-enquiry'))));
  check('pipeline: a fresh enquiry has a reply-due badge, not an overdue one', /Reply due in 23 h/.test(await text(page, T('p1-sla-bk_seed_07'))), await text(page, T('p1-sla-bk_seed_07')));
  check('pipeline: the SLA banner reply button opens that enquiry', (await page.locator(T('p1-sla-reply')).getAttribute('href')) === '#/bookings/bk_seed_11');
  check('pipeline: the overdue card action is "Reply now" into the booking', /Reply now/.test(await text(page, T('p1-action-bk_seed_11'))) && (await page.locator(T('p1-action-bk_seed_11')).getAttribute('href')) === '#/bookings/bk_seed_11');
  check('pipeline: a card outside Northern Ireland says so', /Outside Northern Ireland/.test((await page.locator(T('p1-card-bk_seed_11')).textContent()) || ''));

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
  for (const w of [1100, 1280, 1440]) {
    const ctx = await newContext(browser, { w, h: 900, scheme: 'dark' });
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag)(`pipeline ${w}`);
    await gotoDash(page, '#/pipeline');
    check(`pipeline (${w}px): shows the kanban board with six columns and no stage strip`, (await count(page, `${T('p1-board')} > section`)) === 6 && (await count(page, T('p1-strip'))) === 0);
    check(`pipeline (${w}px): column counts match the seed`, (await Promise.all(STAGES.map(async (id) => Number(await text(page, `${T(`p1-col-${id}`)} ${T(`p1-stage-count-${id}`)}`))))).join() === STAGES.map((id) => SEED_COUNTS[id]).join());
    check(`pipeline (${w}px): no horizontal overflow of the page`, (await overflowOf(page)) <= 0, String(await overflowOf(page)));
    check(`pipeline (${w}px): cards sit inside their column`, await page.evaluate(() => [...document.querySelectorAll('.pl-col')].every((col) => [...col.querySelectorAll('.pl-card')].every((c) => c.getBoundingClientRect().right <= col.getBoundingClientRect().right + 1))));
    if (w === 1280) {
      const small = await smallTargets(page);
      check('pipeline (1280px): every tap target is at least 44px', small.length === 0, small.slice(0, 5).join(', '));
      await axeCheck(page, 'pipeline board (dark)');
      await page.click(`${T('p1-lost')} summary`);
      check('pipeline (1280px): the Lost drawer opens under the board', (await count(page, `${T('p1-lost-list')} > li`)) === 3);
    }
    check(`pipeline (${w}px): clean console and requests`, bag.length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }
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

  // Replying to the overdue one clears the banner.
  await store(a, (s) => s.confirmBooking('bk_seed_11'));
  const bannerGone = await until(a, () => !document.querySelector('[data-testid="p1-sla-banner"]'));
  check('live: once the overdue enquiry is answered the SLA banner goes', !!bannerGone);

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

  check('insights: shows its own title', (await text(page, T('view-title'))) === 'Insights');
  check('insights: no horizontal overflow at 375px', (await overflowOf(page)) <= 0, String(await overflowOf(page)));

  // Headline row.
  check('insights: collected this month is £3,038 from 5 jobs', pounds(await text(page, `${T('insights-collected')} .ui-stat__value`)) === 3038 && /5 jobs/.test(await text(page, `${T('insights-collected')} .ui-stat__hint`)), await text(page, T('insights-collected')));
  check('insights: owed is £3,609 across 4 jobs', pounds(await text(page, `${T('insights-owed')} .ui-stat__value`)) === 3609 && /4 jobs/.test(await text(page, T('insights-owed'))), await text(page, T('insights-owed')));
  check('insights: quotes out is £5,009 with 3 waiting', pounds(await text(page, `${T('p1-quotes-out')} .ui-stat__value`)) === 5009 && /3 quotes with customers/.test(await text(page, T('p1-quotes-out'))), await text(page, T('p1-quotes-out')));
  check('insights: quotes out links to the waiting quotes', (await page.locator(T('p1-quotes-out')).getAttribute('href')) === '#/quotes?f=waiting');
  check('insights: win rate is 85% (11 won of 13 decided)', /85%/.test(await text(page, T('p1-win-rate'))) && /11 won of 13/.test(await text(page, T('p1-win-rate'))), await text(page, T('p1-win-rate')));
  check('insights: the old booked-next-14-days and average-job tiles are still there', (await count(page, T('insights-booked-next'))) === 1 && (await count(page, T('insights-avg'))) === 1);
  check('insights: a free survey is not counted in the average job (£826)', pounds(await text(page, `${T('insights-avg')} .ui-stat__value`)) === 826, await text(page, T('insights-avg')));
  check('insights: free surveys are listed as free, not as £0', /Free surveys/.test(await text(page, T('insights-by-service'))) && /Free/.test(await text(page, T('insights-by-service'))) && !/£0/.test(await text(page, T('insights-by-service'))));

  // Owed list (existing behaviour).
  check('insights: owed list has four rows with Nudge and Mark paid', (await count(page, `${T('owed-list')} > li`)) === 4 && (await count(page, '[data-testid^="owed-nudge-"]')) === 4 && (await count(page, '[data-testid^="owed-mark-paid-"]')) === 4);

  // Reply time vs the promise.
  check('insights: 89% were answered inside the 24 hour promise', /89%/.test(await text(page, T('p1-reply-pct'))), await text(page, T('p1-reply-pct')));
  check('insights: the average reply is 4 h 14 min', /4 h 14 min/.test(await text(page, T('p1-reply-avg'))), await text(page, T('p1-reply-avg')));
  check('insights: the overdue enquiry is listed with a Reply link', /Conor Brennan/.test(await text(page, T('p1-wait-bk_seed_11'))) && /Overdue by 6 h/.test(await text(page, T('p1-wait-bk_seed_11'))) && (await page.locator(T('p1-wait-reply-bk_seed_11')).getAttribute('href')) === '#/bookings/bk_seed_11');
  check('insights: the reply ring is a labelled meter', (await page.locator(`${T('p1-reply-ring')}[role="meter"]`).getAttribute('aria-valuenow')) === '89');

  // Where enquiries come from: This month, then All time.
  check('sources: this month Facebook has 11 enquiries and £3,364 in', Number(await text(page, T('p1-source-n-facebook'))) === 11 && pounds(await text(page, T('p1-source-rev-facebook'))) === 3364, `${await text(page, T('p1-source-n-facebook'))} ${await text(page, T('p1-source-rev-facebook'))}`);
  check('sources: sources with no enquiries are not listed', (await count(page, T('p1-source-other'))) === 0);
  check('sources: no money yet is said plainly', /No money in yet/.test(await text(page, T('p1-source-rev-instagram'))));
  const widths = await page.evaluate(() => ['facebook', 'instagram', 'google'].map((id) => { const f = document.querySelector(`[data-testid="p1-source-${id}"] .in-bar__fill`).getBoundingClientRect().width; const t = document.querySelector(`[data-testid="p1-source-${id}"] .in-bar`).getBoundingClientRect().width; return f / t; }));
  check('sources: bars are drawn to scale (Facebook full, Instagram 3 of 11, Google 1 of 11)', Math.abs(widths[0] - 1) < 0.02 && Math.abs(widths[1] - 3 / 11) < 0.03 && Math.abs(widths[2] - 1 / 11) < 0.03, widths.map((w) => w.toFixed(3)).join(' '));
  await page.click(T('p1-period-all'));
  await until(page, () => document.querySelector('[data-testid="p1-source-n-facebook"]').textContent.trim() === '13');
  check('sources: All time shows 13 Facebook enquiries and the choice is in the address', Number(await text(page, T('p1-source-n-facebook'))) === 13 && /p=all/.test(await hashOf(page)), await hashOf(page));
  check('funnel: follows the same period (24 enquiries, 16 quotes, 11 accepted, 6 installed)', (await Promise.all(['enquiries', 'quotes', 'accepted', 'installs'].map((id) => text(page, `${T(`p1-funnel-${id}`)} strong`)))).join() === '24,16,11,6');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(T('p1-sources'));
  check('sources: after a reload the period is still All time', (await page.locator(`${T('p1-period-all')}[aria-checked="true"]`).count()) === 1);
  await page.click(T('p1-period-month'));
  await until(page, () => document.querySelector('[data-testid="p1-source-n-facebook"]').textContent.trim() === '11');
  const fw = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="p1-funnel-"] .in-bar__fill')].map((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width));
  check('funnel: bars are drawn to scale (19, 11, 7, 2)', fw.length === 4 && Math.abs(fw[0] - 1) < 0.02 && Math.abs(fw[1] - 11 / 19) < 0.03 && Math.abs(fw[2] - 7 / 19) < 0.03 && Math.abs(fw[3] - 2 / 19) < 0.03, fw.map((w) => w.toFixed(3)).join(' '));
  await page.click(`${T('p1-sources-table')} summary`);
  check('sources: the table twin opens and lists every source', (await count(page, `${T('p1-sources-table')} tbody tr`)) === 6, String(await count(page, `${T('p1-sources-table')} tbody tr`)));

  // Weekly money.
  check('weekly: six bars, oldest first, the current week last', (await count(page, '[data-testid^="insights-weekbar-"]')) === 6 && (await count(page, T('insights-weekbar-5'))) === 1);
  check('weekly: the busiest week reads £1,684', /£1,684/.test(await text(page, T('insights-weekbar-2'))), await text(page, T('insights-weekbar-2')));

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
    check(`insights (${scheme}, ${w}px): the period control never clips an option`, await p2.evaluate(() => { const el = document.querySelector('[data-testid="p1-period"]'); return el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).display === 'grid'; }));
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

async function adSpend(browser) {
  const ctx = await newContext(browser, { scheme: 'dark' });
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('ad spend');
  await gotoDash(page, '#/insights');
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
  await page.fill(T('p1-ad-input-google'), '100');
  await page.click(T('p1-ad-save'));
  await until(page, () => /£390/.test(document.querySelector('[data-testid="p1-ad-spend"]').textContent));
  check('ads: adding Google spend raises October to £390', pounds(await text(page, T('p1-ad-spend'))) === 390, await text(page, T('p1-ad-spend')));
  check('ads: Google enquiries now count, so cost per enquiry becomes £26', pounds(await val('p1-cost-enquiry')) === 26, await val('p1-cost-enquiry'));
  check('ads: the channel table lists Google with its spend', /£100/.test(await text(page, T('p1-ad-channels'))), await text(page, T('p1-ad-channels')));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(T('p1-ads'));
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
  const before = pounds(await text(page, `${T('insights-collected')} .ui-stat__value`));
  const owedBefore = pounds(await text(page, `${T('insights-owed')} .ui-stat__value`));
  const first = await page.locator('[data-testid^="owed-mark-paid-"]').first().getAttribute('data-testid');
  const id = first.replace('owed-mark-paid-', '');
  const amount = pounds(await text(page, `${T(`owed-row-${id}`)} .in-owed__amount`));
  await page.click(T(first));
  await page.waitForSelector(T('paid-method-cash'));
  await page.click(T('paid-method-cash'));
  await page.click(T('paid-submit'));
  await page.waitForSelector(T('paid-submit'), { state: 'detached', timeout: 3000 }).catch(() => {});
  await until(page, (b) => !document.querySelector(`[data-testid="owed-row-${b}"]`), id);
  const after = pounds(await text(page, `${T('insights-collected')} .ui-stat__value`));
  const owedAfter = pounds(await text(page, `${T('insights-owed')} .ui-stat__value`));
  check('owed: marking a job paid moves its money from Owed to Collected', after === before + amount && owedAfter === owedBefore - amount, `${before}+${amount}=${after}; ${owedBefore}-${amount}=${owedAfter}`);
  check('owed: the row leaves the list', (await count(page, `${T('owed-list')} > li`)) === 3);
  await ctx.close();

  // Reduced motion: the bars do not animate.
  const rctx = await newContext(browser, { scheme: 'dark', reducedMotion: true });
  const rpage = await rctx.newPage();
  await gotoDash(rpage, '#/insights');
  const dur = await rpage.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.in-bar__fill')).animationDuration));
  check('motion: with reduced motion the chart bars do not animate', dur < 0.01, String(dur));
  await gotoDash(rpage, '#/pipeline');
  const tdur = await rpage.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pl-card__action-arrow')).transitionDuration));
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
    const parts = { pipelinePhone, pipelineWide, pipelineLive, insightsPhone, adSpend, owedAndMotion };
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
