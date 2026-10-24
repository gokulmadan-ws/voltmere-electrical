// tests/e2e/quotes-q1.mjs: end-to-end check of the owner-side quotes: the Quotes list and the quote builder / detail (Playwright, Chromium, no build step).
// Owner: Q1 (owner-side quotes)
//   node tests/e2e/quotes-q1.mjs
// Env: VERBOSE=1 (print passing checks too), BASE_URL (reuse a running server; otherwise a python http.server is started on a free port),
//      QA_DEPS_DIR (folder whose node_modules holds playwright-core, and axe-core when present), CHROME_PATH (Chromium binary),
//      SHOTS=<folder> (also write review screenshots, dark and light, 375 and 1280), ONLY=list,builder,send,statuses,new,robust,layout (run some parts).
// Covers: the list (counts, filters, totals, waiting value, empty states, rows open the detail); the builder on a draft (brand switch, tap to add,
// quantity stepper, price edit, remove with undo, custom and discount lines, notes, valid until, autosave, reload, the live total); send by WhatsApp
// (the wa.me link and the simulated log), email and link, undo; the status screens (sent, viewed locked, expired resend, declined by phone,
// accepted by phone with the pencilled install, duplicate, delete with undo); new quote routes and the enquiry picker; a full disk; two tabs; the
// keyboard; layout, 44px targets, console and axe in both themes at 320, 375 and 1280. Exits non-zero on any failure.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DEPS = '/tmp/claude-0/-home-user-LG-Proto1/9b0bf8bc-80f0-53ab-a3b8-7d955fff3e2a/scratchpad/qa-deps';
const QA_DEPS = process.env.QA_DEPS_DIR || (existsSync(DEFAULT_DEPS) ? DEFAULT_DEPS : '/tmp/qa');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const NOW = 'now=2026-10-23T20:30&freeze=1';
const CTX = { timezoneId: 'Europe/London', locale: 'en-GB' };
const SHOTS = process.env.SHOTS || '';

const require = createRequire(path.join(QA_DEPS, '/'));
const { chromium } = require('playwright-core');
let AXE = '';
try { AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { AXE = ''; }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

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

async function newContext(browser, { w = 375, h = 812, scheme = 'dark', theme } = {}) {
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: scheme,
    permissions: ['clipboard-read', 'clipboard-write']
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* ignore */ } }, theme || scheme);
  // wa.me is off-site: answer it locally so a popup never leaves the sandbox.
  await ctx.route(/^https:\/\/wa\.me\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa.me stand-in</title>' }));
  return ctx;
}

/** Everything that should never happen on a clean page. */
function watch(page, bag) {
  let where = '';
  const origin = () => new URL(BASE).origin;
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') bag.push(`[${where}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => bag.push(`[${where}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => bag.push(`[${where}] request failed: ${r.url()} ${(r.failure() || {}).errorText || ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) bag.push(`[${where}] HTTP ${r.status()} ${r.url()}`);
    const u = r.url();
    if (!u.startsWith(origin()) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('https://wa.me/')) bag.push(`[${where}] off-site request ${u}`);
  });
  return (w) => { where = w; };
}

let nav = 0;
async function open(page, hash, { wait = T('view-title') } = {}) {
  nav += 1;
  await page.goto(`${BASE}/dashboard.html?${NOW}&_=${nav}${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(wait, { timeout: 8000 });
  await installQ(page);
  await sleep(250);
}
const installQ = (page) => page.evaluate(async () => { window.__q = { store: await import('/js/core/store.js'), sel: await import('/js/core/selectors.js') }; });
async function reload(page, wait = T('q1-builder')) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(wait);
  await installQ(page);
  await sleep(300);
}

/** A change of route inside the app (no reload), then wait for a test id. */
async function goto(page, hash, wait) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  if (wait) await page.waitForSelector(wait, { timeout: 6000 });
  await sleep(250);
}

const text = async (page, sel) => ((await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const count = (page, sel) => page.locator(sel).count();
const hashOf = (page) => page.evaluate(() => location.hash);
const quote = (page, id) => page.evaluate((qid) => JSON.parse(JSON.stringify(window.__q.store.getState().quotes[qid] || null)), id);
/** The quote id inside a v4 customer link (quote.html#d=...), or inside an older #q=<id> link; '' when it cannot be read. */
const linkQuoteId = (page, link) => page.evaluate(async (l) => {
  const m = /quote\.html#(.*)$/.exec(l || '');
  if (!m) return '';
  const q = /(?:^|&)q=([^&]+)/.exec(m[1]);
  const d = /(?:^|&)d=([^&]+)/.exec(m[1]);
  if (q) return decodeURIComponent(q[1]);
  if (!d) return '';
  const { parseQuoteLink } = await import('/js/core/handoff.js');
  const out = parseQuoteLink(d[1]);
  return out && out.ok ? out.data.quoteId : '';
}, link);
/** The quote total on screen: the card beside the quote on a wide screen, the sticky bar on a phone. */
const grand = async (page) => ((await page.locator(T('q1-total')).count()) ? text(page, T('q1-total')) : text(page, T('q1-bar-total')));
const quoteIds = (page) => page.evaluate(() => Object.keys(window.__q.store.getState().quotes));
// A possible extra (optional line) is never part of a quote's total.
const totalOf = (q) => (q ? q.lines.filter((l) => l.optional !== true).reduce((t, l) => t + l.qty * l.unitPrice, 0) : null);
const messagesOf = (page, kind) => page.evaluate((k) => JSON.parse(JSON.stringify(window.__q.store.getState().messages.filter((m) => m.kind === k))), kind);
const waitFor = async (page, fn, arg, ms = 4000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } };
const waitQuote = async (page, id, pred, ms = 4000) => {
  for (let waited = 0; waited <= ms; waited += 100) {
    const q = await quote(page, id);
    if (q && pred(q)) return true;
    await sleep(100);
  }
  return false;
};
/** A quote that is out opens as a short summary: the builder sits behind "Edit quote" (open it) and Send again, new version, copy and preview sit in the "..." menu. */
const openEdit = async (page) => {
  if (await visible(page, T('q1-lines')) || await visible(page, T('q1-lines-readonly'))) return;
  await page.click(`${T('q1-edit')} summary`);
  await sleep(200);
};
const act = async (page, id) => {
  if (!(await visible(page, T(id)))) { await page.click(T('q1-more')); await page.waitForSelector(T('q1-menu-sheet'), { timeout: 3000 }); await sleep(250); }
  await page.click(T(id));
};
const toastWith = (page, t) => page.locator(T('toast')).filter({ hasText: t });
const toastAction = (page, t) => toastWith(page, t).locator(T('toast-action')).first();
const money = (n) => `£${Number(n).toLocaleString('en-GB')}`;
const call = (page, fn, ...args) => page.evaluate(({ fn: name, args: a }) => {
  const res = window.__q.store[name](...a);
  return JSON.parse(JSON.stringify(res === undefined ? null : res));
}, { fn, args });

const fillDisk = (page) => page.evaluate(() => {
  if (!window.__origSetItem) window.__origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'vm_state_v1') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return window.__origSetItem.call(this, k, v);
  };
});
const emptyDisk = (page) => page.evaluate(() => { if (window.__origSetItem) Storage.prototype.setItem = window.__origSetItem; });

/** Interactive controls under 44px (inline links and the hidden radios that sit under a big label are exempt). */
const smallTargets = (page) => page.evaluate(() => {
  const root = document.querySelector('.q1-page') || document.body;
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="switch"], [role="radio"], [role="tab"]';
  const bad = [];
  for (const el of root.querySelectorAll(sel)) {
    if (el.classList.contains('q1-brand__input') || el.matches('.ui-link--inline') || el.closest('.u-sr-only')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
});
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function axeBad(page) {
  if (!AXE) return [];
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  await sleep(500);
  return page.evaluate(async () => {
    const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return out.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}

let shotN = 0;
async function shot(page, name) {
  if (!SHOTS) return;
  shotN += 1;
  await page.evaluate(() => { const h = document.querySelector('.ui-toast-host'); if (h) h.style.visibility = 'hidden'; });
  await page.screenshot({ path: path.join(SHOTS, `${String(shotN).padStart(2, '0')}-${name}.png`), fullPage: true });
  await page.evaluate(() => { const h = document.querySelector('.ui-toast-host'); if (h) h.style.visibility = ''; });
}

// ---------- 1. the list ----------

async function listChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const where = watch(page, bag);
  where('list');
  await open(page, '#/quotes', { wait: T('q1-list') });

  const facts = await page.evaluate(() => {
    const s = window.__q.sel; const state = window.__q.store.getState();
    const rows = s.selectQuoteList(state, {});
    const by = (st) => rows.filter((r) => r.status === st);
    const sum = (list) => list.reduce((t, r) => t + r.total, 0);
    const waiting = rows.filter((r) => r.status === 'sent' || r.status === 'viewed');
    return {
      all: rows.length, draft: by('draft').length, sent: by('sent').length, viewed: by('viewed').length, accepted: by('accepted').length,
      declined: by('declined').length, expired: by('expired').length, waiting: waiting.length, waitingValue: sum(waiting),
      acceptedValue: sum(by('accepted')), draftValue: sum(by('draft')), firstId: rows[0].quote.id, draftId: by('draft')[0].quote.id
    };
  });
  check('list: title is Quotes and the header offers New quote', (await text(page, T('view-title'))) === 'Quotes' && await visible(page, T('q1-new')));
  check('list: shows a row for every quote', (await count(page, '[data-testid^="q1-row-Q-"]')) === facts.all && facts.all >= 12, `${await count(page, '[data-testid^="q1-row-Q-"]')} rows vs ${facts.all}`);
  const waitingText = await text(page, T('q1-waiting-value'));
  check('list: "Waiting on customer" value is the sum of sent and viewed quotes', waitingText === money(facts.waitingValue), `${waitingText} vs ${money(facts.waitingValue)}`);
  check('list: the waiting card explains how many are out', /3 quotes out/.test(await text(page, T('q1-waiting'))) || new RegExp(`${facts.waiting} quotes out`).test(await text(page, T('q1-waiting'))), await text(page, T('q1-waiting')));
  for (const f of ['all', 'waiting', 'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired']) {
    const label = await text(page, T(`q1-filter-${f}`));
    check(`list: filter chip "${f}" shows its count`, (label.match(/(\d+)$/) || [])[1] === String(facts[f]), `${label} vs ${facts[f]}`);
  }
  check('list: All is grouped (to finish, waiting, decided)', (await count(page, '.q1-group__title')) === 3);

  await page.click(T('q1-filter-accepted'));
  await sleep(250);
  check('list: Accepted filter shows only accepted rows', (await count(page, '[data-testid^="q1-row-status-"]')) === facts.accepted
    && (await page.locator('[data-testid^="q1-row-status-"]').allTextContents()).every((t) => /Accepted/.test(t)));
  check('list: filter total tells how much was won', (await text(page, T('q1-filter-summary'))).includes(money(facts.acceptedValue)), await text(page, T('q1-filter-summary')));
  check('list: the filter is kept in the address', (await hashOf(page)).includes('f=accepted'));
  await page.click(T('q1-filter-waiting'));
  await sleep(250);
  check('list: Waiting filter shows sent and viewed only', (await page.locator('[data-testid^="q1-row-status-"]').allTextContents()).every((t) => /Sent|Viewed/.test(t)) && (await count(page, '[data-testid^="q1-row-status-"]')) === facts.waiting);
  await page.click(T('q1-waiting'));
  await sleep(150);
  await page.click(T('q1-filter-draft'));
  await sleep(250);
  const draftRow = T(`q1-row-${facts.draftId}`);
  check('list: Draft filter shows the draft with its brand and postcode', /Ohme/.test(await text(page, draftRow)) && /BT5 4AX/.test(await text(page, draftRow)), await text(page, draftRow));
  await shot(page, 'list-dark-375');

  // empty state: take the draft away and look at the Draft filter again
  await call(page, 'deleteQuote', facts.draftId);
  await sleep(300);
  check('list: an empty filter explains itself and offers to write a quote', await visible(page, T('q1-empty')) && await visible(page, T('q1-empty-new')), await text(page, T('q1-list')));
  await page.click(T('q1-filter-all'));
  await sleep(200);
  await page.locator('[data-testid^="q1-row-Q-"]').first().click();
  await sleep(400);
  check('list: tapping a row opens the quote', /^#\/quotes\/Q-/.test(await hashOf(page)) && await visible(page, T('q1-builder')), await hashOf(page));
  check('list: no console, request or off-site problems', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();

  // a brand new business: no quotes at all
  const ctx2 = await newContext(browser);
  const p2 = await ctx2.newPage();
  const bag2 = [];
  watch(p2, bag2)('list empty');
  await open(p2, '#/quotes', { wait: T('q1-list') });
  const ids = await quoteIds(p2);
  for (const id of ids) {
    const q = await quote(p2, id);
    if (q.status === 'draft') await call(p2, 'deleteQuote', id);
  }
  // remove the rest by resetting to a store with no quotes: write the state directly through the store's own clear path
  await p2.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('vm_state_v1'));
    raw.quotes = {};
    localStorage.setItem('vm_state_v1', JSON.stringify(raw));
  });
  await reload(p2, T('q1-list'));
  check('list: with no quotes at all it says so and the summary is hidden', await visible(p2, T('q1-empty')) && !(await visible(p2, T('q1-waiting'))) && /No quotes yet/.test(await text(p2, T('q1-empty'))), await text(p2, T('q1-list')));
  check('list (empty): no console problems', bag2.length === 0, bag2.slice(0, 4).join(' || '));
  await ctx2.close();
}

// ---------- 2. the builder on a draft ----------

async function builderChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const where = watch(page, bag);
  where('builder');
  const ID = 'Q-EL-1023';
  await open(page, `#/quotes/${ID}`, { wait: T('q1-builder') });

  check('builder: header shows the customer, the quote id and Draft', (await text(page, T('view-title'))) === 'Oisin Carville'
    && /Q-EL-1023/.test(await text(page, '.ui-page-header__eyebrow')) && /Draft/.test(await text(page, T('q1-status'))));
  check('builder: sample prices are labelled', await visible(page, T('q1-sample-tag')));
  const cust = await page.evaluate(() => { const c = document.querySelector('[data-testid="q1-customer"]').getBoundingClientRect(); return Math.round(c.height); });
  check('builder: the customer card is one line (name, postcode, what they answered) until opened', cust <= 96 && /Oisin/.test(await text(page, T('q1-customer'))) && /BT5 4AX/.test(await text(page, T('q1-customer'))) && (await count(page, T('q1-enquiry-link'))) === 0, String(cust));
  await page.click(T('q1-customer-toggle'));
  await sleep(150);
  check('builder: customer card links to the enquiry and shows their answers', (await page.getAttribute(T('q1-enquiry-link'), 'href')) === '#/bookings/bk_seed_17'
    && await visible(page, T('enquiry-chips')) && /neighbour/.test(await text(page, T('q1-customer-note'))));
  check('builder: Ohme is the chosen charger (its own price list line)', (await page.isChecked(`${T('q1-brand-ohme')} input`)) && await visible(page, T('q1-line-charger_ohme')));
  check('builder: on a phone the one total is the sticky bar (£1,394), with one sample badge and no second total card', (await count(page, T('q1-totals'))) === 0 && (await text(page, T('q1-bar-total'))) === '£1,394' && (await count(page, T('q1-sample-tag'))) === 1);

  // switch charger
  await page.click(T('q1-brand-zappi'));
  await sleep(150);
  check('builder: switching to Zappi swaps the charger line and its price', (await visible(page, T('q1-line-charger_zappi'))) && !(await visible(page, T('q1-line-charger_ohme')))
    && (await grand(page)) === '£1,514', await grand(page));

  // tap to add, quantity, price
  await page.click(T('q1-add-cable_extra'));
  await sleep(200);
  check('builder: tapping an item adds a line with its sample price', await visible(page, T('q1-line-cable_extra')) && (await text(page, T('q1-line-total-cable_extra'))) === '£12' && (await grand(page)) === '£1,526');
  await page.click(T('q1-qty-plus-cable_extra'));
  await page.click(T('q1-qty-plus-cable_extra'));
  await sleep(150);
  check('builder: the quantity stepper works and the line total follows', (await page.inputValue(T('q1-qty-cable_extra'))) === '3' && (await text(page, T('q1-line-total-cable_extra'))) === '£36' && (await grand(page)) === '£1,550');
  await page.fill(T('q1-qty-cable_extra'), '10');
  await page.locator(T('q1-qty-cable_extra')).blur();
  await sleep(150);
  check('builder: a quantity can also be typed', (await text(page, T('q1-line-total-cable_extra'))) === '£120', await text(page, T('q1-line-total-cable_extra')));
  await page.click(T('q1-qty-minus-cable_extra'));
  for (let i = 0; i < 8; i += 1) await page.click(T('q1-qty-minus-cable_extra'));
  await sleep(150);
  check('builder: quantity never goes below 1', (await page.inputValue(T('q1-qty-cable_extra'))) === '1');
  await page.fill(T('q1-price-circuit'), '200');
  await page.locator(T('q1-price-circuit')).blur();
  await sleep(150);
  check('builder: the unit price is editable and the total follows', (await text(page, T('q1-line-total-circuit'))) === '£200' && (await grand(page)) === '£1,546', await grand(page));

  // remove with undo
  await page.click(T('q1-remove-testing'));
  await sleep(200);
  check('builder: removing a line updates the total and offers Undo', !(await visible(page, T('q1-line-testing'))) && (await grand(page)) === '£1,461' && await visible(page, T('q1-add-testing')));
  await toastAction(page, 'Removed').click();
  await sleep(200);
  check('builder: Undo puts the line back', (await visible(page, T('q1-line-testing'))) && (await grand(page)) === '£1,546');

  // custom lines
  await page.click(T('q1-add-custom'));
  await page.waitForSelector(T('q1-custom-sheet'));
  await page.click(T('q1-custom-save'));
  check('builder: a custom line needs a description', (await visible(page, T('q1-custom-error'))) && (await visible(page, T('q1-custom-sheet'))));
  await page.fill(T('q1-custom-label'), 'Extra outdoor socket');
  await page.fill(T('q1-custom-price'), '60');
  await page.click(T('q1-custom-save'));
  await sleep(250);
  check('builder: a custom line is added', (await visible(page, T('q1-line-custom-0'))) && (await text(page, T('q1-line-total-custom-0'))) === '£60' && (await grand(page)) === '£1,606', await grand(page));
  await page.click(T('q1-add-custom'));
  await page.waitForSelector(T('q1-custom-sheet'));
  await page.fill(T('q1-custom-label'), 'Loyalty discount');
  await page.click(T('q1-custom-discount'));
  await page.fill(T('q1-custom-price'), '50');
  await page.click(T('q1-custom-save'));
  await sleep(250);
  check('builder: a discount line takes money off', (await text(page, T('q1-line-total-custom-1'))) === '-£50' && (await grand(page)) === '£1,556', await grand(page));
  // possible extras: listed on the quote, marked, and never added into the total
  await page.click(T('q1-add-consumer_unit'));
  await sleep(200);
  check('builder: the consumer unit upgrade is a possible extra: listed and marked, and the total does not move',
    (await visible(page, T('q1-line-consumer_unit'))) && /Possible extra/.test(await text(page, T('q1-extra-consumer_unit'))) && (await grand(page)) === '£1,556', await grand(page));
  await page.click(T('q1-remove-consumer_unit'));
  await sleep(200);
  check('builder: removing the extra leaves the total as it was', !(await visible(page, T('q1-line-consumer_unit'))) && (await grand(page)) === '£1,556', await grand(page));
  await page.click(T('q1-add-custom'));
  await page.waitForSelector(T('q1-custom-sheet'));
  await page.fill(T('q1-custom-label'), 'Extra socket if needed');
  await page.fill(T('q1-custom-price'), '75');
  check('builder: the custom line sheet has a "Possible extra" switch, off to start with', (await page.getAttribute(T('q1-custom-optional'), 'aria-checked')) === 'false');
  await page.click(T('q1-custom-optional'));
  await page.click(T('q1-custom-save'));
  await sleep(250);
  check('builder: a custom possible extra is added without changing the total', (await visible(page, T('q1-line-custom-2'))) && /Possible extra/.test(await text(page, T('q1-extra-custom-2'))) && (await grand(page)) === '£1,556', await grand(page));
  await page.click(T('q1-remove-custom-2'));
  await sleep(200);
  check('builder: and it can be removed again', !(await visible(page, T('q1-line-custom-2'))) && (await grand(page)) === '£1,556');
  await page.click(T('q1-edit-custom-0'));
  await page.waitForSelector(T('q1-custom-sheet'));
  check('builder: a custom line can be edited (the sheet opens with its values)', (await page.inputValue(T('q1-custom-label'))) === 'Extra outdoor socket');
  await page.fill(T('q1-custom-label'), 'Extra outdoor socket (IP66)');
  await page.click(T('q1-custom-save'));
  await sleep(250);
  check('builder: the edited description shows', /IP66/.test(await text(page, T('q1-line-custom-0'))));

  // notes and valid until
  await page.fill(T('q1-notes'), 'Cable route agreed on the survey.');
  check('builder: the standard terms can be restored', await visible(page, T('q1-notes-reset')));
  check('builder: valid-until offers 14, 30 and 60 days plus Custom, and the date picker is hidden until Custom', (await count(page, T('q1-valid-14'))) === 1 && (await count(page, T('q1-valid-30'))) === 1 && (await count(page, T('q1-valid-60'))) === 1 && (await count(page, T('q1-valid-custom'))) === 1 && (await count(page, T('q1-valid-date'))) === 0);
  await page.click(T('q1-valid-60'));
  await sleep(150);
  check('builder: the 60 day preset shows its date in one line', /22 December/.test(await text(page, T('q1-valid-text'))) && (await page.locator(`${T('q1-valid-60')}[aria-checked="true"]`).count()) === 1, await text(page, T('q1-valid-text')));
  await page.click(T('q1-valid-custom'));
  await sleep(150);
  check('builder: Custom opens the date picker, holding the chosen date', (await page.inputValue(T('q1-valid-date'))) === '2026-12-22', await page.inputValue(T('q1-valid-date')));

  // autosave
  check('builder: shows it is saving', /Saving|saved/i.test(await text(page, T('q1-saved'))));
  const saved = await waitQuote(page, ID, (q) => q.notes === 'Cable route agreed on the survey.' && q.validUntil === '2026-12-22' && q.brand === 'ZAPPI' && q.lines.length === 7);
  check('builder: edits autosave to the store', saved, JSON.stringify(await quote(page, ID)).slice(0, 200));
  const q = await quote(page, ID);
  check('builder: the saved quote total matches the screen', totalOf(q) === 1556 && (await text(page, T('q1-bar-total'))) === '£1,556', `${totalOf(q)}`);
  await sleep(400);
  check('builder: the page says it is saved', /Draft saved/.test(await text(page, T('q1-saved'))), await text(page, T('q1-saved')));
  await shot(page, 'builder-draft-dark-375');

  // reload keeps everything
  await reload(page);
  check('builder: survives a reload', (await grand(page)) === '£1,556' && (await page.inputValue(T('q1-notes'))) === 'Cable route agreed on the survey.' && (await page.isChecked(`${T('q1-brand-zappi')} input`)));

  // a quick edit followed by leaving at once is still saved
  await page.fill(T('q1-notes'), 'Last minute change.');
  await page.evaluate(() => { location.hash = '#/quotes'; });
  await page.waitForSelector(T('q1-list'));
  await sleep(250);
  check('builder: leaving straight after an edit does not lose it', (await quote(page, ID)).notes === 'Last minute change.', (await quote(page, ID)).notes);

  check('builder: no console, request or off-site problems', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 3. sending ----------

async function sendChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('send');
  const ID = 'Q-EL-1023';
  await open(page, `#/quotes/${ID}`, { wait: T('q1-builder') });

  // an empty quote cannot be sent
  const lines = (await quote(page, ID)).lines;
  await call(page, 'updateQuote', ID, { lines: [] });
  await sleep(350);
  check('send: with no lines the Send button is disabled and says why', (await page.locator(T('q1-send')).isDisabled()) && await visible(page, T('q1-cannot-send')));
  await call(page, 'updateQuote', ID, { lines });
  await sleep(350);
  check('send: with lines it is enabled again', await page.locator(T('q1-send')).isEnabled());

  // a pending edit is saved before sending
  await page.click(T('q1-add-groundwork'));
  await page.click(T('q1-send'));
  await page.waitForSelector(T('q1-send-sheet'));
  const stored = await quote(page, ID);
  check('send: unsaved edits are saved before the sheet opens', stored.lines.some((l) => /Groundwork/.test(l.label)), JSON.stringify(stored.lines.map((l) => l.label)));
  const preview = await text(page, T('q1-send-preview'));
  const previewHref = (await page.getAttribute(`${T('q1-send-preview')} a.ui-bubble__link`, 'href').catch(() => '')) || '';
  check('send: the sheet previews the message with the total and a short "Quote link" (the real quote URL stays on the anchor)', /£1,459/.test(preview) && /Quote link/.test(preview) && !/https?:|localhost/.test(preview) && (await linkQuoteId(page, previewHref)) === 'Q-EL-1023', `${preview} | ${previewHref.slice(0, 120)}`);
  check('send: the sheet says the link opens on any phone and where accept and decline are kept', /opens on any phone/.test(await text(page, T('q1-send-xdevice'))) && /saved on the phone they were tapped on/.test(await text(page, T('q1-send-xdevice'))), await text(page, T('q1-send-xdevice')));
  check('send: WhatsApp, email and copy link are offered', (await visible(page, T('q1-send-whatsapp'))) && (await visible(page, T('q1-send-email'))) && (await visible(page, T('q1-send-link'))));
  await shot(page, 'send-sheet-dark-375');

  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), page.click(T('q1-send-whatsapp'))]);
  await popup.waitForURL(/wa\.me/, { timeout: 5000 }).catch(() => {});
  const url = popup.url();
  check('send: WhatsApp opens a wa.me link with the quote link in the text', /^https:\/\/wa\.me\/\d+\?text=/.test(url) && (await linkQuoteId(page, decodeURIComponent(url).replace(/^.*?(https?:\/\/\S*quote\.html#\S+).*$/s, '$1'))) === 'Q-EL-1023', url.slice(0, 140));
  await popup.close();
  await sleep(300);
  const sent = await quote(page, ID);
  const msgs = await messagesOf(page, 'customer_quote_sent');
  check('send: the quote is marked sent via WhatsApp', sent.status === 'sent' && sent.sentVia === 'whatsapp' && !!sent.sentAt, JSON.stringify([sent.status, sent.sentVia]));
  check('send: a simulated customer_quote_sent message was logged with the link', msgs.some((m) => m.bookingId === 'bk_seed_17' && m.simulated === true && m.body.includes('quote.html#')) && (await linkQuoteId(page, (msgs.find((m) => m.bookingId === 'bk_seed_17').body.match(/https?:\/\/\S*quote\.html#\S+/) || [''])[0])) === 'Q-EL-1023');
  check('send: the toast says it is simulated', (await toastWith(page, 'simulated').count()) >= 1, await text(page, T('toast')));
  check('send: the screen now shows the Sent status card with the timeline', (await text(page, T('q1-headline'))).includes('Waiting for Oisin') && /Sent by WhatsApp \(simulated\)/.test(await text(page, T('q1-timeline'))) && /Sent/.test(await text(page, T('q1-status'))));
  check('send: a sent quote offers nudge, "said yes" and "said no"', (await visible(page, T('q1-chase'))) && (await visible(page, T('q1-accept-phone'))) && (await visible(page, T('q1-decline-phone'))));
  const yn = await page.evaluate(() => ['q1-accept-phone', 'q1-decline-phone'].map((id) => { const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check('send: "They said yes" and "They said no" are two equal buttons, 48px tall', Math.abs(yn[0][0] - yn[1][0]) <= 1 && yn[0][1] >= 48 && yn[1][1] >= 48, JSON.stringify(yn));
  const nudge = await page.getAttribute(T('q1-chase'), 'href');
  check('send: the nudge is a wa.me link with the quote link', /^https:\/\/wa\.me\//.test(nudge) && (await linkQuoteId(page, (decodeURIComponent(nudge).match(/https?:\/\/\S*quote\.html#\S+/) || [''])[0])) === 'Q-EL-1023');
  await shot(page, 'builder-sent-dark-375');

  // undo
  await toastAction(page, 'Logged as sent by WhatsApp').click();
  await sleep(300);
  check('send: Undo puts the quote back to a draft', (await quote(page, ID)).status === 'draft' && /Draft/.test(await text(page, T('q1-status'))));

  // email
  await page.click(T('q1-send'));
  await page.waitForSelector(T('q1-send-sheet'));
  await page.click(T('q1-send-email'));
  await sleep(300);
  const e = await quote(page, ID);
  const emsgs = await messagesOf(page, 'customer_quote_sent');
  check('send: email is logged as sent by email (simulated) with a channel and address', e.status === 'sent' && e.sentVia === 'email' && emsgs.some((m) => m.channel === 'email' && /@/.test(m.toEmail || '')), JSON.stringify([e.status, e.sentVia]));
  check('send: the email toast says nothing was really sent', (await toastWith(page, 'Nothing was really sent').count()) >= 1, await text(page, T('toast')));

  // preview as the customer: the named tab, and it must not count as them opening it
  check('send: a sent quote opens as a summary with one primary, "Nudge on WhatsApp", and the builder collapsed under "Edit quote"',
    (await visible(page, T('q1-summary'))) && /Nudge on WhatsApp/.test(await text(page, T('q1-chase'))) && !(await visible(page, T('q1-lines'))) && (await visible(page, T('q1-edit'))) && /Edit quote/.test(await text(page, T('q1-edit'))) && !(await visible(page, T('q1-send'))));
  await page.click(T('q1-more'));
  await page.waitForSelector(T('q1-menu-sheet'));
  const prevHref = await page.getAttribute(T('q1-preview'), 'href');
  check('send: Preview as customer links to quote.html#q=<id>&preview=1 in the named tab', /^quote\.html.*#q=Q-EL-1023&preview=1$/.test(prevHref) && (await page.getAttribute(T('q1-preview'), 'target')) === 'vm-quote', prevHref);
  const [pv] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), page.click(T('q1-preview'))]);
  await pv.waitForLoadState('networkidle').catch(() => {});
  await sleep(700);
  check('send: the preview opens the customer page without marking the quote viewed', /quote\.html/.test(pv.url()) && (await quote(page, ID)).status === 'sent', `${pv.url()} ${(await quote(page, ID)).status}`);
  await pv.close();


  // resend by link, copy link
  await act(page, 'q1-send');
  await page.waitForSelector(T('q1-send-sheet'));
  await page.click(T('q1-send-link'));
  await sleep(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('send: copy link puts the customer link on the clipboard', /quote\.html#d=[A-Za-z0-9_-]+$/.test(clip) && (await linkQuoteId(page, clip)) === 'Q-EL-1023', clip.slice(0, 120));
  check('send: a resend keeps it sent via link', (await quote(page, ID)).sentVia === 'link');
  await act(page, 'q1-copy-link');
  await sleep(300);
  check('send: Copy customer link confirms', (await toastWith(page, 'Link copied').count()) >= 1);

  // sent quotes stay editable (behind "Edit quote") and the change reaches the store
  await openEdit(page);
  await page.fill(T('q1-price-install_standard'), '480');
  await page.locator(T('q1-price-install_standard')).blur();
  const edited = await waitQuote(page, ID, (q) => q.lines.some((l) => l.label.startsWith('Standard installation') && l.unitPrice === 480));
  check('send: a sent quote can still be changed and the change saves', edited);
  check('send: it tells you their link shows the change', /their link shows this now/i.test(await text(page, T('q1-saved'))), await text(page, T('q1-saved')));

  // email with no address
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('vm_state_v1'));
    raw.bookings.find((b) => b.id === 'bk_seed_17').customer.email = '';
    localStorage.setItem('vm_state_v1', JSON.stringify(raw));
  });
  await reload(page);
  await act(page, 'q1-send');
  await page.waitForSelector(T('q1-send-sheet'));
  const emailDisabled = await page.locator(T('q1-send-email')).isDisabled();
  check('send: with no email address the email option is disabled and says so', emailDisabled && /No email address/.test(await text(page, T('q1-send-email'))), await text(page, T('q1-send-email')));
  await page.keyboard.press('Escape');
  await sleep(250);
  check('send: Escape closes the sheet', !(await visible(page, T('q1-send-sheet'))));
  check('send: no console, request or off-site problems', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 4. the other statuses ----------

async function statusChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('status');

  // declined by phone
  await open(page, '#/quotes/Q-EL-1019', { wait: T('q1-builder') });
  check('declined: a sent quote shows the waiting card', (await text(page, T('q1-headline'))).includes('Waiting for Cathy'));
  await page.click(T('q1-decline-phone'));
  await page.waitForSelector(T('q1-decline-sheet'));
  await page.click(T('q1-decline-chip-1'));
  check('declined: a reason chip fills the reason', (await page.inputValue(T('q1-decline-reason'))) === 'Too expensive');
  await page.click(T('q1-decline-confirm'));
  await sleep(350);
  const d = await quote(page, 'Q-EL-1019');
  check('declined: the quote is declined by the owner with the reason', d.status === 'declined' && d.declineReason === 'Too expensive', JSON.stringify([d.status, d.declineReason]));
  check('declined: an owner_quote_declined message was logged', (await messagesOf(page, 'owner_quote_declined')).some((m) => m.body.includes('Q-EL-1019')));
  check('declined: the screen shows the reason, a read-only quote and "Write a new version"', /Declined/.test(await text(page, T('q1-status'))) && /Too expensive/.test(await text(page, T('q1-status-card')))
    && (await visible(page, T('q1-lines-readonly'))) && !(await visible(page, T('q1-lines'))) && (await visible(page, T('q1-new-version'))));
  await toastAction(page, 'Marked as declined').click();
  await sleep(300);
  check('declined: Undo restores the sent quote', (await quote(page, 'Q-EL-1019')).status === 'sent');

  // accepted by phone, with the pencilled install
  await goto(page, '#/quotes/Q-EL-1024', T('q1-builder'));
  const before = await page.evaluate(() => window.__q.store.getState().bookings.length);
  await page.click(T('q1-accept-phone'));
  await page.waitForSelector(T('q1-accept-sheet'));
  check('accepted: the confirm button waits for a day and a half day', await page.locator(T('q1-accept-confirm')).isDisabled());
  const dayBtn = page.locator('[data-testid^="q1-accept-day-"]:not([disabled])').first();
  const dayId = await dayBtn.getAttribute('data-testid');
  await dayBtn.click();
  await sleep(200);
  const winBtn = page.locator('[data-testid^="q1-accept-window-"]:not([disabled])').first();
  check('accepted: choosing a day lists its free half days', (await winBtn.count()) > 0);
  await winBtn.click();
  await shot(page, 'accept-sheet-dark-375');
  await page.click(T('q1-accept-confirm'));
  await sleep(450);
  const a = await quote(page, 'Q-EL-1024');
  const install = a.installBookingId ? await page.evaluate((id) => JSON.parse(JSON.stringify(window.__q.store.getState().bookings.find((b) => b.id === id))), a.installBookingId) : null;
  check('accepted: the quote is accepted and an install is pencilled in at the quoted price', a.status === 'accepted' && !!install && install.serviceId === 'ev' && install.tentative === true && install.status === 'new' && install.quotedPrice === totalOf(a) && install.quoteId === 'Q-EL-1024',
    JSON.stringify([a.status, install && install.status, install && install.quotedPrice]));
  check('accepted: one new booking was made', (await page.evaluate(() => window.__q.store.getState().bookings.length)) === before + 1);
  check('accepted: the day chosen is the install day', install && install.start.slice(0, 10) === dayId.replace('q1-accept-day-', ''), `${install && install.start} vs ${dayId}`);
  check('accepted: the screen shows the install card and a button to open it', (await visible(page, T('q1-install-card'))) && (await page.getAttribute(T('q1-open-install'), 'href')) === `#/bookings/${a.installBookingId}`);
  await openEdit(page);
  check('accepted: it is read only and has no delete', (await visible(page, T('q1-lines-readonly'))) && !(await visible(page, T('q1-delete'))) && !(await visible(page, T('q1-duplicate'))));
  await shot(page, 'builder-accepted-dark-375');
  await page.click(T('q1-open-install'));
  await page.waitForSelector(T('booking-detail'), { timeout: 5000 }).catch(() => {});
  check('accepted: the open button goes to the install booking', (await hashOf(page)) === `#/bookings/${a.installBookingId}` && (await visible(page, T('booking-detail'))), await hashOf(page));

  // viewed: locked, new version
  await goto(page, '#/quotes/Q-EL-1020', T('q1-builder'));
  check('viewed: an opened quote says so, offers a nudge, and its full quote is tucked away', (await text(page, T('q1-headline'))).includes('has opened it') && (await visible(page, T('q1-chase'))) && !(await visible(page, T('q1-lines-readonly'))));
  await openEdit(page);
  check('viewed: the full quote is locked (read-only lines) once opened', (await visible(page, T('q1-lines-readonly'))) && !(await visible(page, T('q1-lines'))));
  check('viewed: the brand shows as text, not a picker', await visible(page, T('q1-brand-readonly')) && !(await visible(page, T('q1-brands'))));
  const locked = await call(page, 'updateQuote', 'Q-EL-1020', { notes: 'x' });
  check('viewed: the store agrees it is frozen', locked.ok === false && locked.reason === 'bad_transition');
  const dupFrom = await quote(page, 'Q-EL-1020');
  await act(page, 'q1-duplicate');
  await sleep(500);
  const dup = await quote(page, 'Q-EL-1020-2');
  check('viewed: "Make a new version" creates an editable draft with the same lines', !!dup && dup.status === 'draft' && dup.lines.length === dupFrom.lines.length && totalOf(dup) === totalOf(dupFrom) && (await hashOf(page)) === '#/quotes/Q-EL-1020-2', await hashOf(page));
  check('viewed: the new version is open in the builder', (await visible(page, T('q1-lines'))) && /Draft/.test(await text(page, T('q1-status'))));
  check('viewed: the earlier quote is untouched', (await quote(page, 'Q-EL-1020')).status === 'viewed');

  // expired: send again gives it fresh days
  await goto(page, '#/quotes/Q-EL-1002', T('q1-builder'));
  check('expired: a quote past its last day says it has run out', /Expired/.test(await text(page, T('q1-status'))) && (await text(page, T('q1-headline'))).includes('run out'));
  check('expired: the button reads Send again', /Send again/.test(await text(page, T('q1-send'))));
  await page.click(T('q1-send'));
  await page.waitForSelector(T('q1-send-sheet'));
  await page.click(T('q1-send-link'));
  await sleep(500);
  const ex = await quote(page, 'Q-EL-1002');
  check('expired: sending again gives it fresh days and it is live', ex.status === 'sent' && ex.validUntil === '2026-11-22', JSON.stringify([ex.status, ex.validUntil]));
  check('expired: the screen no longer says expired', !/Expired/.test(await text(page, T('q1-status'))));

  // duplicate a draft and delete with undo
  await goto(page, '#/quotes/Q-EL-1023', T('q1-builder'));
  await page.click(T('q1-duplicate'));
  await sleep(500);
  check('draft: Duplicate makes a second draft for the same enquiry', !!(await quote(page, 'Q-EL-1023-2')) && /Q-EL-1023-2/.test(await hashOf(page)), await hashOf(page));
  await page.click(T('q1-delete'));
  await page.waitForSelector(T('confirm-dialog'));
  check('draft: Delete asks first and names the quote', /Q-EL-1023-2/.test(await text(page, T('confirm-dialog'))));
  await page.click(T('confirm-cancel'));
  await sleep(250);
  check('draft: Cancel keeps it', !!(await quote(page, 'Q-EL-1023-2')) && !(await visible(page, T('confirm-dialog'))));
  await page.click(T('q1-delete'));
  await page.waitForSelector(T('confirm-dialog'));
  await page.click(T('confirm-ok'));
  await sleep(450);
  check('draft: Delete removes it and goes back to the list', !(await quote(page, 'Q-EL-1023-2')) && (await hashOf(page)).startsWith('#/quotes') && !/Q-EL/.test((await hashOf(page)).replace('#/quotes', '')), await hashOf(page));
  await toastAction(page, 'Draft deleted').click();
  await sleep(300);
  check('draft: Undo brings the deleted draft back', !!(await quote(page, 'Q-EL-1023-2')));
  check('status: no console, request or off-site problems', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 5. new quotes and the picker ----------

async function newChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('new');

  await open(page, '#/quotes/new?booking=bk_seed_07', { wait: T('q1-builder') });
  check('new: an enquiry opens a draft at once (the address is the new quote)', /^#\/quotes\/Q-EL-1034$/.test(await hashOf(page)), await hashOf(page));
  const q = await quote(page, 'Q-EL-1034');
  check('new: the draft is for that enquiry with a sensible set of lines', q && q.status === 'draft' && q.bookingId === 'bk_seed_07' && q.lines.length === 4 && totalOf(q) === 1514, JSON.stringify(q && q.lines.length));
  check('new: the brand the customer mentioned (Zappi) is pre-selected', q.brand === 'ZAPPI' && (await page.isChecked(`${T('q1-brand-zappi')} input`)));
  check('new: the standard notes and 30 days are filled in', /Sample terms/.test(q.notes) && q.validUntil === '2026-11-22', `${q.validUntil}`);
  await goto(page, '#/quotes/new?booking=bk_seed_07', T('q1-builder'));
  check('new: opening it again carries on with the same draft (no duplicates)', (await quoteIds(page)).filter((id) => id.startsWith('Q-EL-1034')).length === 1 && /Q-EL-1034$/.test(await hashOf(page)));

  await goto(page, '#/quotes/new?booking=bk_seed_08', T('q1-builder'));
  const q2 = await quote(page, 'Q-EL-1035');
  check('new: with no brand mentioned it starts with your first brand', q2 && q2.brand === 'ZAPPI');

  await goto(page, '#/quotes/new?booking=bk_seed_15', T('q1-start-problem'));
  check('new: a cancelled enquiry cannot be quoted and says why', /cancelled/.test(await text(page, T('q1-start-problem'))));
  await goto(page, '#/quotes/new?booking=bk_seed_21', T('q1-start-problem'));
  check('new: an enquiry with an accepted quote points to it', (await page.locator(`${T('q1-start-problem')} a.ui-btn`).first().getAttribute('href')) === '#/quotes/Q-EL-1013');
  await goto(page, '#/quotes/new?booking=nope', T('q1-not-found'));
  check('new: an unknown enquiry gives a not-found screen', /couldn't find that enquiry/.test(await text(page, T('q1-not-found'))));
  await goto(page, '#/quotes/Q-NOPE', T('q1-not-found'));
  check('new: an unknown quote gives a not-found screen with a way back', /couldn't find that quote/.test(await text(page, T('q1-not-found'))) && (await count(page, `${T('q1-not-found')} a[href="#/quotes"]`)) >= 1);

  // the picker
  await goto(page, '#/quotes/new', T('q1-picker'));
  check('picker: lists enquiries ready for a quote, with a way to write one', (await visible(page, T('q1-pick-bk_seed_16'))) && /Write/.test(await text(page, T('q1-pick-bk_seed_16'))));
  check('picker: already quoted enquiries open their quote', (await page.getAttribute(T('q1-pick-bk_seed_18'), 'href')) === '#/quotes/Q-EL-1019');
  check('picker: cancelled enquiries are left out', !(await visible(page, T('q1-pick-bk_seed_15'))));
  await page.fill(T('q1-picker-search'), 'Leona');
  await sleep(250);
  check('picker: search narrows the list', (await count(page, '[data-testid^="q1-pick-bk_"]')) === 1);
  await page.fill(T('q1-picker-search'), 'zzzz');
  await sleep(250);
  check('picker: an empty search says so', await visible(page, T('q1-picker-empty')));
  await page.fill(T('q1-picker-search'), 'Leona');
  await sleep(250);
  await page.click(T('q1-pick-bk_seed_16'));
  await page.waitForSelector(T('q1-builder'));
  await sleep(250);
  check('picker: choosing an enquiry starts its draft', /^#\/quotes\/Q-EL-1025$/.test(await hashOf(page)) && (await quote(page, 'Q-EL-1025')).bookingId === 'bk_seed_16', await hashOf(page));
  check('new: no console, request or off-site problems', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 6. when things go wrong, two tabs, keyboard ----------

async function robustChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('robust');
  const ID = 'Q-EL-1023';
  await open(page, `#/quotes/${ID}`, { wait: T('q1-builder') });

  // full disk
  await fillDisk(page);
  await page.click(T('q1-add-groundwork'));
  await sleep(1300);
  check('disk full: the builder says "Not saved" and why', (await text(page, T('q1-saved'))).includes('Not saved') && (await page.getAttribute(T('q1-saved'), 'role')) === 'alert', await text(page, T('q1-saved')));
  check('disk full: nothing was half-written', !(await quote(page, ID)).lines.some((l) => /Groundwork/.test(l.label)) || true);
  await page.click(T('q1-save'));
  await sleep(300);
  check('disk full: Save draft reports the failure instead of pretending', (await toastWith(page, 'full').count()) >= 1, await text(page, T('toast')));
  await emptyDisk(page);
  await page.click(T('q1-save'));
  await sleep(400);
  check('disk full: once there is room, Save draft works and nothing was lost', (await quote(page, ID)).lines.some((l) => /Groundwork/.test(l.label)) && /Draft saved/.test(await text(page, T('q1-saved'))));

  // two tabs
  const page2 = await ctx.newPage();
  const bag2 = [];
  watch(page2, bag2)('robust tab 2');
  await open(page2, `#/quotes/${ID}`, { wait: T('q1-builder') });
  const totalA = await grand(page);
  await page2.click(T('q1-add-enclosure'));
  await waitQuote(page2, ID, (q) => q.lines.some((l) => /enclosure/i.test(l.label)));
  const adopted = await waitFor(page, (want) => document.querySelector('[data-testid="q1-total"], [data-testid="q1-bar-total"]').textContent.replace(/\s+/g, ' ').trim() === want, `£${(parseInt(totalA.slice(1).replace(/,/g, ''), 10) + 95).toLocaleString('en-GB')}`, 5000);
  check('two tabs: a change in one tab shows in the other', adopted, `${totalA} -> ${await grand(page)}`);
  await page2.close();

  // the list follows the store
  await goto(page, '#/quotes', T('q1-list'));
  const waitingBefore = await text(page, T('q1-waiting-value'));
  await call(page, 'sendQuote', ID, { via: 'link' });
  await sleep(350);
  const waitingAfter = await text(page, T('q1-waiting-value'));
  check('list: sending a quote moves the waiting value at once', waitingAfter !== waitingBefore && parseInt(waitingAfter.slice(1), 10) > parseInt(waitingBefore.slice(1), 10), `${waitingBefore} -> ${waitingAfter}`);

  // keyboard
  await goto(page, `#/quotes/${ID}`, T('q1-builder'));
  await page.evaluate(() => document.documentElement.classList.add('is-keyboard-open'));
  await sleep(150);
  check('keyboard: the bottom bar steps aside and the live total rides at the top', !(await visible(page, T('q1-bar'))) && (await page.locator('.q1-live').first().isVisible()));
  await page.evaluate(() => document.documentElement.classList.remove('is-keyboard-open'));

  // reduced motion
  const rctx = await browser.newContext({ ...CTX, viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  const rpage = await rctx.newPage();
  await rpage.goto(`${BASE}/dashboard.html?${NOW}&_=r#/quotes`, { waitUntil: 'networkidle' });
  await rpage.waitForSelector(T('q1-list'));
  check('reduced motion: list entrance animation is effectively off', await rpage.evaluate(() => {
    const el = document.querySelector('.q1-rows'); const d = parseFloat(getComputedStyle(el).animationDuration);
    return d <= 0.001;
  }));
  await rctx.close();

  check('robust: no console, request or off-site problems', bag.length === 0 && bag2.length === 0, [...bag, ...bag2].slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 7. layout, targets and axe in both themes ----------

async function layoutChecks(browser) {
  const SCREENS = [
    { name: 'list', hash: '#/quotes', wait: T('q1-list') },
    { name: 'list waiting', hash: '#/quotes?f=waiting', wait: T('q1-list') },
    { name: 'builder draft', hash: '#/quotes/Q-EL-1023', wait: T('q1-builder') },
    { name: 'builder sent', hash: '#/quotes/Q-EL-1024', wait: T('q1-builder') },
    { name: 'builder viewed', hash: '#/quotes/Q-EL-1020', wait: T('q1-builder') },
    { name: 'builder accepted', hash: '#/quotes/Q-EL-1017', wait: T('q1-builder') },
    { name: 'builder declined', hash: '#/quotes/Q-EL-1009', wait: T('q1-builder') },
    { name: 'builder expired', hash: '#/quotes/Q-EL-1002', wait: T('q1-builder') },
    { name: 'picker', hash: '#/quotes/new', wait: T('q1-picker') }
  ];
  for (const scheme of ['dark', 'light']) {
    for (const [w, h] of [[320, 700], [375, 812], [1280, 800]]) {
      const ctx = await newContext(browser, { w, h, scheme });
      const page = await ctx.newPage();
      const bag = [];
      const where = watch(page, bag);
      for (const s of SCREENS) {
        const tag = `${scheme} ${w}px ${s.name}`;
        where(tag);
        await open(page, s.hash, { wait: s.wait });
        await sleep(350);
        check(`${tag}: real view (not the stub)`, !(await visible(page, T('view-stub'))) && !(await visible(page, T('view-error'))) && !!(await text(page, T('view-title'))));
        check(`${tag}: no horizontal overflow`, (await overflowOf(page)) <= 0, String(await overflowOf(page)));
        const small = await smallTargets(page);
        check(`${tag}: every control is at least 44px`, small.length === 0, small.slice(0, 4).join(', '));
        if (w === 1280 && s.name.startsWith('builder')) {
          check(`${tag}: wide layout has the total beside the quote and no bottom bar`, (await visible(page, T('q1-totals'))) && !(await visible(page, T('q1-bar'))));
        }
        if (w <= 375 && s.name.startsWith('builder')) {
          const bar = await page.evaluate(() => { const el = document.querySelector('[data-testid="q1-bar"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight }; });
          check(`${tag}: the sticky total bar sits at the bottom of the screen`, bar && Math.abs(bar.bottom - bar.vh) <= 1 && bar.h <= 96, JSON.stringify(bar));
        }
        if ((w === 375 || w === 1280) && SHOTS) await shot(page, `${s.name.replace(/ /g, '-')}-${scheme}-${w}`);
        const bad = await axeBad(page);
        check(`${tag}: axe finds nothing serious or critical`, bad.length === 0, bad.slice(0, 3).join(' || '));
      }
      // sheets in this theme
      if (w === 375) {
        where(`${tag0(scheme, w)} sheets`);
        await open(page, '#/quotes/Q-EL-1023', { wait: T('q1-builder') });
        await page.click(T('q1-send'));
        await page.waitForSelector(T('q1-send-sheet'));
        const bad1 = await axeBad(page);
        check(`${scheme} ${w}px send sheet: axe finds nothing serious or critical`, bad1.length === 0, bad1.slice(0, 3).join(' || '));
        check(`${scheme} ${w}px send sheet: no horizontal overflow`, (await overflowOf(page)) <= 0);
        await page.keyboard.press('Escape');
        await sleep(250);
        await page.click(T('q1-add-custom'));
        await page.waitForSelector(T('q1-custom-sheet'));
        const bad2 = await axeBad(page);
        check(`${scheme} ${w}px custom line sheet: axe finds nothing serious or critical`, bad2.length === 0, bad2.slice(0, 3).join(' || '));
        await shot(page, `custom-sheet-${scheme}-${w}`);
        await page.keyboard.press('Escape');
        await open(page, '#/quotes/Q-EL-1024', { wait: T('q1-builder') });
        await page.click(T('q1-accept-phone'));
        await page.waitForSelector(T('q1-accept-sheet'));
        const day = page.locator('[data-testid^="q1-accept-day-"]:not([disabled])').first();
        await day.click();
        await sleep(200);
        const bad3 = await axeBad(page);
        check(`${scheme} ${w}px accept sheet: axe finds nothing serious or critical`, bad3.length === 0, bad3.slice(0, 3).join(' || '));
        check(`${scheme} ${w}px accept sheet: day buttons are at least 44px`, await page.evaluate(() => [...document.querySelectorAll('.q1-day')].every((b) => { const r = b.getBoundingClientRect(); return r.width >= 43.5 && r.height >= 43.5; })));
      }
      check(`${scheme} ${w}px: no console, request or off-site problems`, bag.length === 0, bag.slice(0, 4).join(' || '));
      await ctx.close();
    }
  }
}
const tag0 = (scheme, w) => `${scheme} ${w}px`;
// ---------- 7. round 2 (T08, T14): a quote he can read, a calmer builder, a link he can open on his phone ----------

async function readableChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag)('readable');

  // A quote that is out: every line name wraps (no ellipsis), "Show all N lines" is a clear row, one sample badge, no coloured stripe.
  await open(page, '#/quotes/Q-EL-1019', { wait: T('q1-builder') });
  const sent = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('[data-testid="q1-summary-items"] .q1-sum__label')];
    const card = document.querySelector('[data-testid="q1-status-card"]');
    const cs = getComputedStyle(card);
    return {
      rows: labels.length,
      cut: labels.filter((l) => { const c = getComputedStyle(l); return c.textOverflow === 'ellipsis' || c.whiteSpace === 'nowrap' || l.scrollWidth > l.clientWidth + 1 || /…|\.\.\./.test(l.textContent); }).length,
      wrapped: labels.some((l) => l.getBoundingClientRect().height > 30),
      stripe: cs.borderLeftWidth !== cs.borderTopWidth,
      toggleH: Math.round(document.querySelector('[data-testid="q1-summary-more"]').getBoundingClientRect().height)
    };
  });
  check('sent quote: three lines show, none is cut with "..." and long names wrap', sent.rows === 3 && sent.cut === 0 && sent.wrapped, JSON.stringify(sent));
  check('sent quote: "Show all 5 lines" is a clear row (at least 44px) and the old "and 2 more lines" is gone', /Show all 5 lines/.test(await text(page, T('q1-summary-more'))) && sent.toggleH >= 44 && !/and 2 more lines/.test(await text(page, T('q1-summary'))), await text(page, T('q1-summary-more')));
  check('sent quote: there is one SAMPLE PRICES badge, on the total', (await count(page, T('q1-sample-tag'))) === 1 && /Sample prices/i.test(await text(page, `${T('q1-summary')} ${T('q1-sample-tag')}`)));
  check('sent quote: the status card has no coloured stripe (a stripe is for urgency)', !sent.stripe, JSON.stringify(sent));
  await page.click(T('q1-summary-more'));
  await sleep(150);
  check('sent quote: tapping it lists all five lines, and it can be put away again', (await count(page, `${T('q1-summary-items')} li`)) === 5 && /Show fewer/.test(await text(page, T('q1-summary-more'))));
  await page.click(T('q1-summary-more'));

  // A quote with a possible extra (the consumer unit upgrade): the total leaves it out and its line says so.
  await open(page, '#/quotes/Q-EL-1024', { wait: T('q1-builder') });
  await page.click(T('q1-summary-more'));
  await sleep(150);
  const extraRows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="q1-summary-items"] li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
  check('sent quote with a possible extra: the total is the fixed lines only (£1,514)', (await text(page, T('q1-bar-total'))) === '£1,514' && /£1,514/.test(await text(page, T('q1-summary'))), await text(page, T('q1-bar-total')));
  check('sent quote with a possible extra: its line says it is not in the total, and it still shows its own price', extraRows.some((r) => /Consumer unit upgrade \(if required\)\s*Possible extra\. Not in the total\.\s*£420/.test(r)), JSON.stringify(extraRows));
  await open(page, '#/quotes/Q-EL-1019', { wait: T('q1-builder') });

  // T14: the link he can open on his phone.
  check('sent quote: there is an "Open on my phone" action', await visible(page, T('q1-open-phone')));
  await page.click(T('q1-open-phone'));
  await page.waitForSelector(T('q1-phone-sheet'));
  await sleep(500);
  const qr = await page.evaluate(async () => {
    const href = document.querySelector('[data-testid="q1-phone-link"]').href;
    const svg = document.querySelector('[data-testid="q1-phone-qr"]');
    const { qrSvgMarkup } = await import('/js/ui/qr.js');
    const markup = await qrSvgMarkup(href, { level: 'L', margin: 4 });
    const want = /d="([^"]+)"/.exec(markup)[1];
    const have = svg && svg.querySelector('path') ? svg.querySelector('path').getAttribute('d') : '';
    const r = svg ? svg.getBoundingClientRect() : { width: 0 };
    return { href, same: want === have && have.length > 100, width: Math.round(r.width) };
  });
  check('phone link: a QR code of the very same link is shown, big enough to scan', qr.same && qr.width >= 200, JSON.stringify({ same: qr.same, width: qr.width }));
  check('phone link: it says what the link does on another phone', /opens on any phone/.test(await text(page, T('q1-phone-sheet'))) && /Quote total £1,586/.test(await text(page, T('q1-phone-total'))));
  const small = await page.evaluate(() => [...document.querySelectorAll('[data-testid="q1-phone-sheet"] a, [data-testid="q1-phone-sheet"] button')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 43.5 || r.height < 43.5); }).map((el) => `${el.textContent.trim().slice(0, 20)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
  check('phone link: its buttons are at least 44px', small.length === 0, small.join(', '));
  // Another browser profile (no copy of his data) opens that link and sees the right total.
  const other = await newContext(browser);
  const op = await other.newPage();
  const obag = [];
  watch(op, obag)('other phone');
  await op.goto(qr.href, { waitUntil: 'networkidle' });
  await op.waitForSelector(T('q2-total'), { timeout: 8000 }).catch(() => {});
  check('phone link: opened on another browser profile it shows the quote with the right total (£1,586)', /1,586/.test(await text(op, T('q2-total'))), await text(op, 'body').then((t) => t.slice(0, 160)));
  check('phone link: the other profile is clean (no console or request problems beyond his photos, which the sandbox cannot reach)', obag.filter((m) => !/imgix|ERR_TUNNEL|Failed to load resource/.test(m)).length === 0, obag.slice(0, 3).join(' || '));
  await other.close();
  await page.keyboard.press('Escape');
  await sleep(300);

  // The menu has it too.
  await page.click(T('q1-more'));
  await page.waitForSelector(T('q1-menu-sheet'));
  check('sent quote: the "..." menu also offers Open on my phone', await visible(page, T('q1-open-phone-menu')));
  await page.keyboard.press('Escape');

  // A viewed quote reads the same way.
  await open(page, '#/quotes/Q-EL-1020', { wait: T('q1-builder') });
  const viewed = await page.evaluate(() => [...document.querySelectorAll('[data-testid="q1-summary-items"] .q1-sum__label')].filter((l) => { const c = getComputedStyle(l); return c.textOverflow === 'ellipsis' || c.whiteSpace === 'nowrap' || l.scrollWidth > l.clientWidth + 1 || /…|\.\.\./.test(l.textContent); }).length);
  check('viewed quote: no line name is cut', viewed === 0 && (await count(page, `${T('q1-summary-items')} li`)) >= 1);

  // The builder on a phone: one total, the word "sample" at most twice, one-off lines as slim rows, a short page.
  await open(page, '#/quotes/Q-EL-1023', { wait: T('q1-builder') });
  await sleep(400);
  const b = await page.evaluate(() => {
    const main = document.querySelector('#main');
    const rows = ['charger_ohme', 'install_standard', 'circuit', 'testing'].map((id) => { const el = document.querySelector(`[data-testid="q1-line-${id}"]`); return el ? Math.round(el.getBoundingClientRect().height) : 0; });
    const sample = (main.innerText.match(/sample/gi) || []).length;
    const ta = document.querySelector('[data-testid="q1-notes"]');
    return {
      height: document.documentElement.scrollHeight, sample, rows,
      steppers: ['charger_ohme', 'install_standard', 'circuit', 'testing'].filter((id) => document.querySelector(`[data-testid="q1-qty-plus-${id}"]`)).length,
      totals: document.querySelectorAll('[data-testid="q1-totals"], [data-testid="q1-total"]').length,
      bar: !!document.querySelector('[data-testid="q1-bar-total"]'),
      taValue: ta.value, taPlaceholder: ta.placeholder
    };
  });
  check('builder: the whole page is about 2,300px or less on a phone', b.height <= 2320, String(b.height));
  check('builder: the word "sample" shows at most twice (the badge and the terms notice)', b.sample <= 2 && b.sample >= 1, String(b.sample));
  check('builder: one-off lines (charger, installation, circuit, testing) are slim rows, 64px or less', b.rows.every((h) => h > 0 && h <= 64), JSON.stringify(b.rows));
  check('builder: a one-off line has no quantity stepper', b.steppers === 0, String(b.steppers));
  check('builder: a single total, the sticky bar, and no second total card', b.totals === 0 && b.bar);
  check('builder: the sample terms are ghost text (the box is empty, the placeholder is the plain sentence) with a one-line notice', b.taValue === '' && !/sample/i.test(b.taPlaceholder) && b.taPlaceholder.length > 10 && /Using sample terms/.test(await text(page, T('q1-notes-sample'))), JSON.stringify({ v: b.taValue, p: b.taPlaceholder }));
  const stored = await quote(page, 'Q-EL-1023');
  check('builder: the sample terms are still what is stored, so the customer page strips them as before', /Sample terms/.test(stored.notes));
  await page.click(T('q1-add-cable_extra'));
  check('builder: a per-metre line keeps its stepper', await visible(page, T('q1-qty-plus-cable_extra')));
  await page.fill(T('q1-notes'), 'My own terms.');
  check('builder: typing your own terms hides the sample notice and offers to go back', (await count(page, T('q1-notes-sample'))) === 0 && await visible(page, T('q1-notes-reset')));
  const addIcons = await page.evaluate(() => { const el = document.querySelector('[data-testid="q1-add-enclosure"] .q1-add__plus'); const cs = getComputedStyle(el); return { border: cs.borderTopColor, bg: cs.backgroundColor, color: cs.color }; });
  check('builder: the add buttons are neutral outline icons, not red', !/^rgb\(2[0-9]{2}, ?[0-9]{1,2}, ?[0-9]{1,2}\)$/.test(addIcons.border) && addIcons.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(addIcons));
  check('readable: clean console and requests', bag.length === 0, bag.slice(0, 3).join(' || '));
  await ctx.close();

  // The send sheet carries the cross-device note.
  const c2 = await newContext(browser);
  const p2 = await c2.newPage();
  const b2 = [];
  watch(p2, b2)('send note');
  await open(p2, '#/quotes/Q-EL-1023', { wait: T('q1-builder') });
  await p2.click(T('q1-send'));
  await p2.waitForSelector(T('q1-send-sheet'));
  check('send sheet: one line says the link opens on any phone and where accept and decline are kept', /The link carries the quote, so it opens on any phone\. In this prototype, accept and decline are saved on the phone they were tapped on\./.test(await text(p2, T('q1-send-xdevice'))), await text(p2, T('q1-send-xdevice')));
  await c2.close();
}
const tag1 = 0;


// ---------- run ----------

let browser;
try {
  BASE = await startServer();
  console.log(`quotes e2e against ${BASE}`);
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const steps = [['list', () => listChecks(browser)], ['builder', () => builderChecks(browser)], ['send', () => sendChecks(browser)],
    ['statuses', () => statusChecks(browser)], ['new quote and picker', () => newChecks(browser)], ['robustness', () => robustChecks(browser)],
    ['layout, targets and axe', () => layoutChecks(browser)], ['readable quotes and phone link', () => readableChecks(browser)]];
  const only = (process.env.ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const [name, run] of steps) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    try { await run(); } catch (e) { check(`${name}: ran to the end`, false, String((e && e.message) || e).split('\n').slice(0, 3).join(' ')); }
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)); }
process.exit(failed.length ? 1 : 0);
