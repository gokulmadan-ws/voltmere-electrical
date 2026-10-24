// tests/e2e/connections-k1.mjs: end-to-end check of the Connections hub, Domain wizard, Webhook and Tracking screens (Playwright, Chromium, no build step).
// Owner: K1 (connections hub, domain, webhook, tracking)
//   node tests/e2e/connections-k1.mjs
// Env: VERBOSE=1 (print passing checks too), BASE_URL (reuse a running server; otherwise a python http.server is started on a free port),
//      QA_DEPS_DIR (folder whose node_modules holds playwright-core, and axe-core when present), CHROME_PATH (Chromium binary).
// Covers: layout, console and tap-target sweeps in both themes at 320, 375 and 1280; axe (serious and critical) on every state; the hub
// (progress ring, six cards, live updates, two tabs); the Domain wizard end to end (address choice and validation, DNS records, the simulated
// check, live state, remove and undo, resume after reload, a clock that moves on, two tabs, a full disk); the Webhook (copy, secret reveal and
// rotate, field mapping, pause, test enquiry and its link, undo); Tracking (format validation, save, undo, remove, lead sources); reduced
// motion and blocked storage. Exits non-zero on any failure.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DEPS = '/tmp/claude-0/-home-user-LG-Proto1/9b0bf8bc-80f0-53ab-a3b8-7d955fff3e2a/scratchpad/qa-deps';
const QA_DEPS = process.env.QA_DEPS_DIR || (existsSync(DEFAULT_DEPS) ? DEFAULT_DEPS : '/tmp/qa');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const NOW = 'now=2026-10-23T20:30&freeze=1';
const CTX = { timezoneId: 'Europe/London', locale: 'en-GB' };

const require = createRequire(path.join(QA_DEPS, '/'));
const { chromium } = require('playwright-core');
let AXE = '';
try { AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { AXE = ''; }

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

async function newContext(browser, { w = 375, h = 812, scheme = 'dark', reducedMotion, init } = {}) {
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: scheme,
    reducedMotion: reducedMotion || 'no-preference', permissions: ['clipboard-read', 'clipboard-write']
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* ignore */ } }, scheme);
  if (init) await ctx.addInitScript(init);
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

let loads = 0;
async function open(page, hash, { now = NOW, root } = {}) {
  loads += 1;
  await page.goto(`${BASE}/dashboard.html?${now}&_=${loads}#${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(T('view-title'), { timeout: 6000 });
  if (root) await page.waitForSelector(T(root), { timeout: 6000 });
}

const text = async (page, sel) => ((await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const value = async (page, sel) => page.locator(sel).first().inputValue({ timeout: 3000 }).catch(() => null);
const visible = async (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const exists = async (page, sel) => (await page.locator(sel).count()) > 0;
const toastWith = (page, t) => page.locator(T('toast')).filter({ hasText: t });
const conns = (page) => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/js/core/store.js')).getState().settings.connections)));
const bookingCount = (page) => page.evaluate(async () => (await import('/js/core/store.js')).getState().bookings.length);
const hash = (page) => page.evaluate(() => location.hash);

/** Run a store function in the page: await call(page, 'startDomainSetup', 'x.co.uk'). */
const call = (page, fn, ...args) => page.evaluate(async ({ fn: name, args: a }) => {
  const m = await import('/js/core/store.js');
  const res = m[name](...a);
  return JSON.parse(JSON.stringify(res === undefined ? null : res));
}, { fn, args });

/** Make the next localStorage write fail like a full disk (the store must answer { ok: false, reason: 'storage_full' }). */
const fillDisk = (page) => page.evaluate(() => {
  if (!window.__origSetItem) window.__origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'vm_state_v1') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return window.__origSetItem.call(this, k, v);
  };
});
const emptyDisk = (page) => page.evaluate(() => { if (window.__origSetItem) Storage.prototype.setItem = window.__origSetItem; });

/** Interactive controls under 44px (inline links, hidden radios and scroll regions are exempt). */
const smallTargets = (page) => page.evaluate(() => {
  const root = document.querySelector('.k1-page') || document.body;
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="switch"], [role="radio"]';
  const bad = [];
  for (const el of root.querySelectorAll(sel)) {
    if (el.classList.contains('k1-choice__input') || el.matches('.k1-link, .ui-link--inline') || el.closest('.u-sr-only')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
});

const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** axe, serious and critical only. */
async function axeBad(page) {
  if (!AXE) return [];
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  await sleep(450); // entrance animations change colours mid-flight; axe reads settled colours
  return page.evaluate(async () => {
    const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return out.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  });
}

// ---------- 1. layout sweep ----------

const SCREENS = [
  { hash: '/connections', root: 'k1-hub' }, { hash: '/connections/domain', root: 'k1-domain' },
  { hash: '/connections/webhook', root: 'k1-webhook' }, { hash: '/connections/tracking', root: 'k1-tracking' }
];

async function sweep(browser) {
  for (const scheme of ['dark', 'light']) {
    for (const [w, h] of [[320, 700], [375, 812], [1280, 800]]) {
      const ctx = await newContext(browser, { w, h, scheme });
      const page = await ctx.newPage();
      const bag = [];
      const setWhere = watch(page, bag);
      for (const s of SCREENS) {
        const tag = `${scheme} ${w}px ${s.hash}`;
        setWhere(tag);
        await open(page, s.hash, { root: s.root });
        await sleep(350);
        check(`${tag}: real view with a title (not the stub)`, !!(await text(page, T('view-title'))) && !(await exists(page, T('view-stub'))) && !(await exists(page, T('view-error'))));
        check(`${tag}: no horizontal overflow`, (await overflowOf(page)) <= 0, String(await overflowOf(page)));
        check(`${tag}: shows the simulated banner`, await visible(page, T('sim-banner')));
        const small = await smallTargets(page);
        check(`${tag}: every control is at least 44px`, small.length === 0, small.slice(0, 4).join(', '));
        if (w === 375 || (w === 1280 && scheme === 'dark')) {
          const bad = await axeBad(page);
          check(`${tag}: axe finds nothing serious or critical`, bad.length === 0, bad.slice(0, 3).join(' || '));
        }
      }
      check(`${scheme} ${w}px: no console errors, page errors, failed or off-site requests`, bag.length === 0, bag.slice(0, 5).join(' || '));
      await ctx.close();
    }
  }
}

// ---------- 2. hub ----------

async function hubChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  setWhere('hub');
  await open(page, '/connections', { root: 'k1-hub' });

  check('hub: title reads "Connect your business"', (await text(page, T('view-title'))) === 'Connect your business', await text(page, T('view-title')));
  check('hub: progress reads "1 of 6 set up" (only the webhook is on by default)', (await text(page, T('k1-progress-text'))) === '1 of 6 set up', await text(page, T('k1-progress-text')));
  const ring = await page.locator(T('k1-progress')).evaluate((el) => ({ now: el.getAttribute('aria-valuenow'), max: el.getAttribute('aria-valuemax'), text: el.getAttribute('aria-valuetext'), role: el.getAttribute('role') }));
  check('hub: the ring is a labelled meter 1 of 6', ring.role === 'meter' && ring.now === '1' && ring.max === '6' && ring.text === '1 of 6 set up', JSON.stringify(ring));
  const order = await page.locator('[data-testid^="k1-card-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('k1-card-', '')));
  check('hub: six cards in the order domain, whatsapp, calendar, email, webhook, tracking', order.join(',') === 'domain,whatsapp,calendar,email,webhook,tracking', order.join(','));
  const hrefs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^="k1-cta-"]')].map((a) => [a.dataset.testid.replace('k1-cta-', ''), a.getAttribute('href')])));
  check('hub: every card button goes to its own screen', hrefs.domain === '#/connections/domain' && hrefs.whatsapp === '#/connections/whatsapp' && hrefs.calendar === '#/connections/calendar'
    && hrefs.email === '#/connections/email' && hrefs.webhook === '#/connections/webhook' && hrefs.tracking === '#/connections/tracking', JSON.stringify(hrefs));
  check('hub: webhook card says On, the rest Not set up', (await text(page, T('k1-badge-webhook'))) === 'On' && (await text(page, T('k1-badge-domain'))) === 'Not set up' && (await text(page, T('k1-badge-whatsapp'))) === 'Not set up');
  check('hub: each card has a one-line value proposition',
    /own web address/.test(await text(page, T('k1-card-domain'))) && /WhatsApp the second an enquiry lands/.test(await text(page, T('k1-card-whatsapp'))));
  check('hub: the hero suggests WhatsApp next and links to it', /Up next: WhatsApp/.test(await text(page, T('k1-next-text'))) && (await page.locator(T('k1-hero-cta')).getAttribute('href')) === '#/connections/whatsapp');

  // Live updates: a change in the store (this tab) moves the ring and the card.
  await call(page, 'connectGoogle', 'calendar', { account: 'daniel@gmail.example' });
  await call(page, 'connectGoogle', 'email', { account: 'daniel@gmail.example' });
  await page.waitForFunction(() => /3 of 6/.test(document.querySelector('[data-testid="k1-progress-text"]').textContent), null, { timeout: 3000 }).catch(() => {});
  check('hub: connecting Calendar and Gmail moves the progress to 3 of 6', (await text(page, T('k1-progress-text'))) === '3 of 6 set up', await text(page, T('k1-progress-text')));
  check('hub: a connected card says Connected and shows its detail', (await page.locator(T('k1-card-calendar')).getAttribute('data-status')) === 'connected' && /daniel@gmail\.example/.test(await text(page, T('k1-detail-calendar'))), await text(page, T('k1-card-calendar')));
  check('hub: the button on a connected card says Manage', /Manage calendar/.test(await text(page, T('k1-cta-calendar'))), await text(page, T('k1-cta-calendar')));

  // A second tab: a change made there shows up here.
  const second = await ctx.newPage();
  watch(second, bag)('hub tab 2');
  await open(second, '/connections', { root: 'k1-hub' });
  await call(second, 'setConnection', 'tracking', { metaPixelId: '123456789012345' });
  await page.waitForFunction(() => /4 of 6/.test(document.querySelector('[data-testid="k1-progress-text"]').textContent), null, { timeout: 4000 }).catch(() => {});
  check('hub: a change made in a second tab shows up in the first (4 of 6)', (await text(page, T('k1-progress-text'))) === '4 of 6 set up', await text(page, T('k1-progress-text')));
  check('hub: the tracking card shows the saved pixel', /123456789012345/.test(await text(page, T('k1-detail-tracking'))), await text(page, T('k1-detail-tracking')));
  await second.close();

  // Everything on: the hero says so, honestly.
  await call(page, 'startDomainSetup', 'book.180electrical.co.uk');
  await call(page, 'checkDomain');
  await call(page, 'checkDomain');
  await call(page, 'connectWhatsApp', { number: '07885 496800', code: '482913' });
  await call(page, 'submitWhatsAppTemplates');
  await page.waitForFunction(() => /6 of 6/.test(document.querySelector('[data-testid="k1-progress-text"]').textContent), null, { timeout: 8000 }).catch(() => {});
  check('hub: with everything set up the progress reads 6 of 6', (await text(page, T('k1-progress-text'))) === '6 of 6 set up', await text(page, T('k1-progress-text')));
  check('hub: the finished hero still says it is simulated', /simulated/i.test(await text(page, T('k1-hero'))) && !(await exists(page, T('k1-hero-cta'))), await text(page, T('k1-hero')));
  const bad = await axeBad(page);
  check('hub (all connected): axe finds nothing serious or critical', bad.length === 0, bad.slice(0, 3).join(' || '));

  check('hub: no console errors, page errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 3. domain wizard ----------

const WIZ = 'k1-domain-wizard';

async function domainChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  setWhere('domain');
  await open(page, '/connections/domain', { root: WIZ });

  // Step 1: choose
  check('domain: starts on step 1 "Choose your web address" with Cancel as the back button', (await text(page, T(`${WIZ}-heading`))) === 'Choose your web address' && (await text(page, T(`${WIZ}-back`))) === 'Cancel', await text(page, T(`${WIZ}-heading`)));
  check('domain: the suggested address book.180electrical.co.uk is selected by default', (await page.locator(`${T('k1-domain-choice-suggested')} input`).isChecked()) && /book\.180electrical\.co\.uk/.test(await text(page, T('k1-domain-choice-suggested'))));
  check('domain: "use my main domain" is offered', /180electrical\.co\.uk/.test(await text(page, T('k1-domain-choice-main'))) && /main domain/i.test(await text(page, T('k1-domain-choice-main'))));

  await page.click(T('k1-domain-choice-custom'));
  await page.waitForSelector(T('k1-domain-input'));
  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(T('k1-domain-error'));
  check('domain: an empty custom address gets a friendly error and the field is flagged', /Type the address you want/.test(await text(page, T('k1-domain-error'))) && (await page.locator(T('k1-domain-input')).getAttribute('aria-invalid')) === 'true', await text(page, T('k1-domain-error')));
  check('domain: the error means we stay on step 1 and nothing was saved', (await exists(page, T(`${WIZ}-step-address`))) && (await conns(page)).domain.status === 'none');
  await page.fill(T('k1-domain-input'), 'not a domain');
  await page.click(T(`${WIZ}-next`));
  check('domain: spaces get "cannot have spaces"', /cannot have spaces/.test(await text(page, T('k1-domain-error'))), await text(page, T('k1-domain-error')));
  await page.fill(T('k1-domain-input'), '180electrical');
  await page.click(T(`${WIZ}-next`));
  check('domain: a missing ending gets "needs an ending"', /needs an ending/.test(await text(page, T('k1-domain-error'))), await text(page, T('k1-domain-error')));
  await page.fill(T('k1-domain-input'), 'daniel@180electrical.co.uk');
  await page.click(T(`${WIZ}-next`));
  check('domain: an email address is recognised as one', /looks like an email address/.test(await text(page, T('k1-domain-error'))), await text(page, T('k1-domain-error')));
  await page.fill(T('k1-domain-input'), 'https://Book.Test-Site.co.uk/page?x=1');
  check('domain: a pasted link is cleaned up and previewed', /We will use book\.test-site\.co\.uk/.test(await text(page, T(`${WIZ}-step-address`))), await text(page, T(`${WIZ}-step-address`)));
  const bad1 = await axeBad(page);
  check('domain step 1 (custom, with an error): axe finds nothing serious or critical', bad1.length === 0, bad1.slice(0, 3).join(' || '));

  // The main domain: two records (an A record and a www CNAME)
  await page.click(T('k1-domain-choice-main'));
  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(T(`${WIZ}-step-records`));
  check('domain: main domain gives two records, an A and a www CNAME', (await text(page, T('k1-record-type-0'))) === 'A' && (await text(page, T('k1-record-type-1'))) === 'CNAME'
    && (await value(page, T('k1-record-value-0-value'))) === '192.0.2.10' && (await value(page, T('k1-record-name-1-value'))) === 'www' && (await value(page, T('k1-record-value-1-value'))) === 'sites.example',
  `${await text(page, T('k1-records'))}`);
  check('domain: the store holds the main domain as pending', (await conns(page)).domain.domain === '180electrical.co.uk' && (await conns(page)).domain.status === 'pending');
  const savedToast = toastWith(page, 'Address saved');
  check('domain: saving the address shows a toast with Undo', (await savedToast.count()) >= 1 && /Undo/.test(await savedToast.first().innerText()) && /180electrical\.co\.uk/.test(await savedToast.first().innerText()), await savedToast.first().innerText().catch(() => ''));
  await savedToast.first().locator(T('toast-action')).click();
  await page.waitForSelector(T(`${WIZ}-step-address`), { timeout: 3000 }).catch(() => {});
  check('domain: Undo on that toast takes the wizard back to step 1 and clears the store', (await exists(page, T(`${WIZ}-step-address`))) && (await conns(page)).domain.status === 'none');
  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(T(`${WIZ}-step-records`));
  await page.click(T(`${WIZ}-back`));
  await page.waitForSelector(T(`${WIZ}-step-address`));
  check('domain: Back returns to step 1 with the main domain still chosen', await page.locator(`${T('k1-domain-choice-main')} input`).isChecked());

  // The suggested subdomain: one CNAME
  await page.click(T('k1-domain-choice-suggested'));
  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(T(`${WIZ}-step-records`));
  check('domain: the subdomain gives one CNAME record: name "book", value sites.example, TTL 3600',
    (await page.locator('[data-testid^="k1-record-type-"]').count()) === 1 && (await text(page, T('k1-record-type-0'))) === 'CNAME' && (await value(page, T('k1-record-name-0-value'))) === 'book'
    && (await value(page, T('k1-record-value-0-value'))) === 'sites.example' && /3600/.test(await text(page, T('k1-record-0'))), await text(page, T('k1-record-0')));
  check('domain: only the fictional targets appear on the page', !/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test((await text(page, T('k1-records'))).replace(/192\.0\.2\.10/g, '')) && /not real servers/.test(await text(page, T('k1-records-example-note'))));
  check('domain: "where do I paste this" explains registrar steps and the 48 hour wait', /GoDaddy|123-reg|Namecheap/.test(await text(page, T('k1-where-paste'))) && /48 hours/.test(await text(page, T('k1-dns-wait'))));
  check('domain: the store holds book.180electrical.co.uk as pending', (await conns(page)).domain.domain === 'book.180electrical.co.uk' && (await conns(page)).domain.status === 'pending');
  await page.click(T('k1-record-value-0-copy'));
  await sleep(150);
  check('domain: the copy button says Copied', /Copied/.test(await text(page, T('k1-record-value-0-copy'))), await text(page, T('k1-record-value-0-copy')));
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check('domain: the clipboard holds the value', clip === null || clip === 'sites.example', String(clip));
  await page.click(T('k1-records-copyall'));
  await toastWith(page, 'Records copied').first().waitFor({ timeout: 2000 }).catch(() => {});
  check('domain: "Copy all records" confirms with a toast', (await toastWith(page, 'Records copied').count()) === 1);
  const clipAll = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check('domain: the copied text holds the domain and the record', clipAll === null || (/book\.180electrical\.co\.uk/.test(clipAll) && /CNAME\s+book\s+sites\.example/.test(clipAll)), String(clipAll));
  const bad2 = await axeBad(page);
  check('domain step 2: axe finds nothing serious or critical', bad2.length === 0, bad2.slice(0, 3).join(' || '));

  // Reload part way: resume on the records step
  await open(page, '/connections/domain', { root: WIZ });
  check('domain: reloading mid-way resumes on the records step', await exists(page, T(`${WIZ}-step-records`)) && (await value(page, T('k1-record-value-0-value'))) === 'sites.example');

  // Step 3: the check
  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(T(`${WIZ}-step-check`));
  check('domain: step 3 starts with "We look for your records" and the button says Check my DNS', /We look for your records/.test(await text(page, T('k1-tl-found'))) && (await text(page, T(`${WIZ}-next`))) === 'Check my DNS', await text(page, T('k1-tl-found')));
  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(`${T('k1-tl-found')}:has-text("cannot see")`, { timeout: 4000 }).catch(() => {});
  check('domain: the first check says "We cannot see your records yet"', /We cannot see your records yet/.test(await text(page, T('k1-tl-found'))), await text(page, T('k1-tl-found')));
  check('domain: while checking it shows a waiting meter and the certificate is still to come', (await exists(page, T('k1-check-meter'))) && /Security certificate/.test(await text(page, T('k1-tl-ssl'))) && !/Security certificate issued/.test(await text(page, T('k1-tl-ssl'))), await text(page, T('k1-tl-ssl')));
  check('domain: the store says verifying after one check', (await conns(page)).domain.status === 'verifying' && (await conns(page)).domain.checks === 1);
  check('domain: the button now says Check again', (await text(page, T(`${WIZ}-next`))) === 'Check again');
  const bad3 = await axeBad(page);
  check('domain step 3 (not found yet): axe finds nothing serious or critical', bad3.length === 0, bad3.slice(0, 3).join(' || '));
  await open(page, '/connections/domain', { root: WIZ });
  check('domain: reloading while checking resumes on the check step', await exists(page, T(`${WIZ}-step-check`)) && /cannot see/.test(await text(page, T('k1-tl-found'))), await text(page, T('k1-tl-found')));

  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(T('k1-check-success'), { timeout: 4000 }).catch(() => {});
  check('domain: the second check verifies and issues the certificate', (await exists(page, T('k1-check-success'))) && /Security certificate issued/.test(await text(page, T('k1-tl-ssl'))) && (await conns(page)).domain.status === 'live', await text(page, T('k1-tl-ssl')));
  check('domain: the success is labelled simulated', /simulated/i.test(await text(page, T('k1-check-success'))));
  check('domain: the button now says Done', (await text(page, T(`${WIZ}-next`))) === 'Done');
  const bad4 = await axeBad(page);
  check('domain step 3 (live): axe finds nothing serious or critical', bad4.length === 0, bad4.slice(0, 3).join(' || '));
  await page.click(T(`${WIZ}-next`));
  await page.waitForSelector(T('k1-live'));
  check('domain: Done shows the live state with his address and a live badge', (await text(page, T('k1-live-host'))) === 'book.180electrical.co.uk' && /Live/.test(await text(page, T('k1-domain-badge'))));
  check('domain: Open site is disabled and the reason is written next to it', (await page.locator(T('k1-open-site')).isDisabled()) && /simulated/i.test(await text(page, T('k1-open-why'))) && (await page.locator(T('k1-open-site')).getAttribute('aria-describedby')) === 'k1-open-why');
  check('domain: the share link is https://book.180electrical.co.uk and can be copied', (await value(page, T('k1-live-link-value'))) === 'https://book.180electrical.co.uk' && (await exists(page, T('k1-live-link-copy'))));
  check('domain: a "what a real build needs" note is there', await exists(page, T('real-build-note')));
  const bad5 = await axeBad(page);
  check('domain (live state): axe finds nothing serious or critical', bad5.length === 0, bad5.slice(0, 3).join(' || '));
  await open(page, '/connections/domain', { root: 'k1-live' });
  check('domain: reloading keeps the live state', (await text(page, T('k1-live-host'))) === 'book.180electrical.co.uk');

  // Remove, with a confirmation and an Undo
  await page.click(T('k1-domain-remove'));
  await page.waitForSelector(T('confirm-dialog'));
  await page.click(T('confirm-cancel'));
  await sleep(250);
  check('domain: "Keep it" leaves the domain live', (await conns(page)).domain.status === 'live' && !(await exists(page, T('confirm-dialog'))));
  await page.click(T('k1-domain-remove'));
  await page.waitForSelector(T('confirm-dialog'));
  await page.click(T('confirm-ok'));
  await page.waitForSelector(T(`${WIZ}-step-address`), { timeout: 3000 }).catch(() => {});
  check('domain: Remove goes back to step 1 and the store is clear', (await exists(page, T(`${WIZ}-step-address`))) && (await conns(page)).domain.status === 'none');
  const undoToast = toastWith(page, 'Address removed');
  check('domain: Remove shows a toast with Undo', (await undoToast.count()) === 1 && /Undo/.test(await undoToast.innerText()));
  await undoToast.locator(T('toast-action')).click();
  await page.waitForSelector(T('k1-live'), { timeout: 3000 }).catch(() => {});
  check('domain: Undo brings the live address back, without a "you are live" banner', (await exists(page, T('k1-live'))) && (await conns(page)).domain.status === 'live' && !(await exists(page, T('k1-live-banner'))));

  check('domain: no console errors, page errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

async function domainEdgeChecks(browser) {
  // A clock that moves on: a domain left "verifying" goes live by itself after 20 seconds.
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag)('domain clock');
    await open(page, '/connections/domain', { root: WIZ });
    await call(page, 'startDomainSetup', 'book.180electrical.co.uk');
    await call(page, 'checkDomain');
    await open(page, '/connections/domain', { root: WIZ, now: 'now=2026-10-23T20:31&freeze=1' });
    await page.waitForSelector(T('k1-check-success'), { timeout: 4000 }).catch(() => {});
    check('domain clock: 60 seconds later the verifying domain has gone live by itself', (await conns(page)).domain.status === 'live' && (await exists(page, T('k1-check-success'))), JSON.stringify((await conns(page)).domain));
    check('domain clock: no console errors', bag.length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }

  // Two tabs: removing the domain in one sends the other back to step 1.
  {
    const ctx = await newContext(browser);
    const a = await ctx.newPage();
    const bag = [];
    watch(a, bag)('domain tabs');
    await open(a, '/connections/domain', { root: WIZ });
    await a.click(T(`${WIZ}-next`));
    await a.waitForSelector(T(`${WIZ}-step-records`));
    const b = await ctx.newPage();
    await open(b, '/connections/domain', { root: WIZ });
    check('domain tabs: a second tab resumes on the records step', await exists(b, T(`${WIZ}-step-records`)));
    await call(b, 'disconnect', 'domain');
    await a.waitForSelector(T(`${WIZ}-step-address`), { timeout: 4000 }).catch(() => {});
    check('domain tabs: removing the domain in one tab returns the other to step 1', await exists(a, T(`${WIZ}-step-address`)));
    check('domain tabs: no console errors', bag.length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }

  // A full disk: the wizard says so and keeps what he typed.
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag)('domain full disk');
    await open(page, '/connections/domain', { root: WIZ });
    await fillDisk(page);
    await page.click(T(`${WIZ}-next`));
    await page.waitForSelector(T('k1-domain-error'), { timeout: 3000 }).catch(() => {});
    check('domain full disk: the wizard says there is no room left and stays on step 1', /no room left/.test(await text(page, T('k1-domain-error'))) && (await exists(page, T(`${WIZ}-step-address`))), await text(page, T('k1-domain-error')));
    check('domain full disk: nothing was half-saved', (await conns(page)).domain.status === 'none');
    await emptyDisk(page);
    await page.click(T(`${WIZ}-next`));
    await page.waitForSelector(T(`${WIZ}-step-records`), { timeout: 3000 }).catch(() => {});
    check('domain full disk: once there is room again, Continue works', await exists(page, T(`${WIZ}-step-records`)));
    check('domain full disk: no page errors', bag.filter((m) => /pageerror/.test(m)).length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }
}

// ---------- 4. webhook ----------

async function webhookChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  setWhere('webhook');
  await open(page, '/connections/webhook', { root: 'k1-webhook' });
  const before = await conns(page);

  check('webhook: explains in plain English how the existing funnel keeps running', /funnel keeps running/i.test(await text(page, T('k1-how'))) && /webhook/i.test(await text(page, T('k1-how'))));
  check('webhook: it is on by default and says no events yet', (await text(page, T('k1-hook-badge'))) === 'On' && /No events yet/.test(await text(page, T('k1-last-event'))));
  check('webhook: the URL field holds the store URL', (await value(page, T('k1-webhook-url-value'))) === before.webhook.url && /^https:\/\/hooks\.example\//.test(before.webhook.url));
  check('webhook: the secret is masked until revealed', (await page.locator(T('k1-webhook-secret-value')).getAttribute('type')) === 'password');
  await page.click(T('k1-webhook-secret-reveal'));
  check('webhook: Show reveals the secret', (await page.locator(T('k1-webhook-secret-value')).getAttribute('type')) === 'text' && (await value(page, T('k1-webhook-secret-value'))) === before.webhook.secret);
  await page.click(T('k1-webhook-url-copy'));
  await sleep(150);
  check('webhook: copying the URL says Copied', /Copied/.test(await text(page, T('k1-webhook-url-copy'))));

  // mapping and payload
  const rows = await page.locator('[data-testid^="k1-map-row-"]').evaluateAll((els) => els.map((e) => e.dataset.testid.replace('k1-map-row-', '')));
  check('webhook: the mapping table lists the funnel fields (postcode to notes, plus the tick box and the ad source)',
    ['postcode', 'parking', 'vehicle', 'timing', 'permission', 'name', 'mobile', 'email', 'notes'].every((k) => rows.includes(k)), rows.join(','));
  check('webhook: the mapping shows the exact field names and accepted words', /answers\.parking/.test(await text(page, T('k1-map-row-parking'))) && /driveway/.test(await text(page, T('k1-map-row-parking'))) && /customer\.phone/.test(await text(page, T('k1-map-row-mobile'))));
  check('webhook: an example payload is shown in a code block', /"event": "enquiry\.created"/.test(await text(page, T('k1-payload'))) && /"answers"/.test(await text(page, T('k1-payload'))));
  check('webhook: a what-a-real-build-needs note is there', await exists(page, T('real-build-note')));

  // rotate the secret, with a confirm and an Undo
  await page.click(T('k1-secret-rotate'));
  await page.waitForSelector(T('confirm-dialog'));
  await page.click(T('confirm-cancel'));
  await sleep(250);
  check('webhook: cancelling the rotate keeps the secret', (await conns(page)).webhook.secret === before.webhook.secret);
  await page.click(T('k1-secret-rotate'));
  await page.waitForSelector(T('confirm-dialog'));
  await page.click(T('confirm-ok'));
  await sleep(250);
  const rotated = (await conns(page)).webhook.secret;
  check('webhook: rotating makes a new whsec_ secret', rotated !== before.webhook.secret && /^whsec_[a-z0-9]{24}$/.test(rotated), rotated);
  const rotToast = toastWith(page, 'New secret created');
  check('webhook: the rotate toast offers Undo', (await rotToast.count()) === 1 && /Undo/.test(await rotToast.innerText()));
  await rotToast.locator(T('toast-action')).click();
  await sleep(250);
  check('webhook: Undo puts the old secret back', (await conns(page)).webhook.secret === before.webhook.secret);

  // pause: the test enquiry is refused with a reason
  await page.click(T('k1-hook-switch'));
  await sleep(250);
  check('webhook: switching off pauses it (badge, store)', (await text(page, T('k1-hook-badge'))) === 'Paused' && (await conns(page)).webhook.enabled === false);
  const n0 = await bookingCount(page);
  await page.click(T('k1-test-send'));
  await page.waitForSelector(T('k1-test-error'), { timeout: 3000 }).catch(() => {});
  check('webhook: a test while paused says it is paused and creates nothing', /paused/i.test(await text(page, T('k1-test-error'))) && (await bookingCount(page)) === n0, await text(page, T('k1-test-error')));
  const offToast = toastWith(page, 'Webhook is paused');
  await offToast.locator(T('toast-action')).click().catch(() => {});
  await sleep(250);
  check('webhook: Undo on the pause toast switches it back on', (await conns(page)).webhook.enabled === true && (await text(page, T('k1-hook-badge'))) === 'On');

  // send a test enquiry
  await page.click(T('k1-test-send'));
  await page.waitForSelector(T('k1-test-result'), { timeout: 4000 }).catch(() => {});
  check('webhook: the test enquiry confirms with the customer, postcode and reference', /Test enquiry received/.test(await text(page, T('k1-test-result'))) && /\(EL-\d+\)/.test(await text(page, T('k1-test-result'))), await text(page, T('k1-test-result')));
  check('webhook: the test is labelled simulated', /Simulated/.test(await text(page, T('k1-test-result'))));
  check('webhook: one enquiry was created with the webhook as its source', (await bookingCount(page)) === n0 + 1);
  const made = await page.evaluate(async () => { const b = (await import('/js/core/store.js')).getState().bookings.filter((x) => x.utm && x.utm.medium === 'webhook'); return b.map((x) => ({ id: x.id, src: x.utm.source, camp: x.utm.campaign, status: x.status, service: x.serviceId })); });
  check('webhook: it is an enquiry (ev_quote) tagged medium webhook', made.length === 1 && made[0].service === 'ev_quote' && made[0].camp === 'test_event', JSON.stringify(made));
  check('webhook: the last event time is shown', /Fri 23 Oct, 20:30/.test(await text(page, T('k1-last-event'))), await text(page, T('k1-last-event')));
  const bad = await axeBad(page);
  check('webhook (after a test): axe finds nothing serious or critical', bad.length === 0, bad.slice(0, 3).join(' || '));
  await page.click(T('k1-test-send'));
  await page.waitForSelector(T('k1-test-result'), { timeout: 4000 }).catch(() => {});
  const openHref = await page.locator(T('k1-test-open')).getAttribute('href');
  await page.click(T('k1-test-open'));
  await sleep(500);
  check('webhook: "Open the enquiry" opens that enquiry in Bookings', /^#\/bookings\/bk_/.test(openHref) && (await hash(page)) === openHref && !!(await text(page, T('view-title'))), `${openHref} vs ${await hash(page)}`);

  // reload: the link to the latest webhook enquiry survives
  await open(page, '/connections/webhook', { root: 'k1-webhook' });
  check('webhook: after a reload the latest webhook enquiry is still linked', (await exists(page, T('k1-test-latest-open'))) && /20:30/.test(await text(page, T('k1-last-event'))));

  // another tab pauses it
  const second = await ctx.newPage();
  watch(second, bag)('webhook tab 2');
  await open(second, '/connections/webhook', { root: 'k1-webhook' });
  await call(second, 'setConnection', 'webhook', { enabled: false });
  await page.waitForFunction(() => /Paused/.test(document.querySelector('[data-testid="k1-hook-badge"]').textContent), null, { timeout: 4000 }).catch(() => {});
  check('webhook: pausing in a second tab shows in the first', (await text(page, T('k1-hook-badge'))) === 'Paused');
  await second.close();

  // full disk
  await fillDisk(page);
  await page.click(T('k1-hook-switch'));
  await sleep(300);
  check('webhook full disk: the switch fails with a toast and stays paused', (await toastWith(page, 'no room left').count()) >= 1 && (await text(page, T('k1-hook-badge'))) === 'Paused', await text(page, T('k1-hook-badge')));
  await emptyDisk(page);

  check('webhook: no console errors, page errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 5. tracking ----------

async function trackingChecks(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag);
  setWhere('tracking');
  await open(page, '/connections/tracking', { root: 'k1-tracking' });

  check('tracking: starts empty and not set up, consent note on', (await value(page, T('k1-track-meta'))) === '' && (await text(page, T('k1-track-badge'))) === 'Not set up' && (await page.locator(T('k1-track-consent')).getAttribute('aria-checked')) === 'true');
  check('tracking: the consent note is explained', /asks first/i.test(await text(page, T('k1-track-consent'))));

  await page.fill(T('k1-track-meta'), 'abc');
  await page.locator(T('k1-track-meta')).blur();
  check('tracking: letters in the Meta Pixel ID get a friendly error on blur', /just numbers/.test(await text(page, T('k1-track-meta-error'))), await text(page, T('k1-track-meta-error')));
  await page.fill(T('k1-track-meta'), '123');
  await page.locator(T('k1-track-meta')).blur();
  check('tracking: a short Meta Pixel ID says it is too short', /too short/.test(await text(page, T('k1-track-meta-error'))));
  await page.fill(T('k1-track-google'), 'XYZ-1');
  await page.locator(T('k1-track-google')).blur();
  check('tracking: a Google tag without a G- prefix says what it should start with', /starts with G-/.test(await text(page, T('k1-track-google-error'))), await text(page, T('k1-track-google-error')));
  await page.fill(T('k1-track-google'), 'G-A');
  await page.locator(T('k1-track-google')).blur();
  check('tracking: a short Google tag says how long it should be', /4 to 12/.test(await text(page, T('k1-track-google-error'))));
  const badErr = await axeBad(page);
  check('tracking (with errors): axe finds nothing serious or critical', badErr.length === 0, badErr.slice(0, 3).join(' || '));
  await page.click(T('k1-track-save'));
  await sleep(300);
  const c1 = await conns(page);
  check('tracking: saving with errors saves nothing and moves focus to the first bad field', c1.tracking.metaPixelId === '' && c1.tracking.googleTagId === '' && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'k1-track-meta');

  // a good save: spaces tolerated, lower case fixed
  await page.fill(T('k1-track-meta'), '1234 5678 9012 345');
  await page.fill(T('k1-track-google'), 'g-abcd1234');
  await page.click(T('k1-track-save'));
  await sleep(350);
  const c2 = await conns(page);
  check('tracking: Save stores the pixel without spaces and the tag in capitals', c2.tracking.metaPixelId === '123456789012345' && c2.tracking.googleTagId === 'G-ABCD1234', JSON.stringify(c2.tracking));
  check('tracking: the fields show the cleaned values and the badge says Saved', (await value(page, T('k1-track-google'))) === 'G-ABCD1234' && (await value(page, T('k1-track-meta'))) === '123456789012345' && (await text(page, T('k1-track-badge'))) === 'Saved');
  const saveToast = toastWith(page, 'Tracking saved');
  check('tracking: a toast says saved on this device only and offers Undo', (await saveToast.count()) === 1 && /Undo/.test(await saveToast.innerText()) && /this device only/.test(await saveToast.innerText()), await saveToast.first().innerText().catch(() => ''));
  check('tracking: the Save button reads Saved', (await text(page, T('k1-track-save'))) === 'Saved');
  const bad = await axeBad(page);
  check('tracking (saved): axe finds nothing serious or critical', bad.length === 0, bad.slice(0, 3).join(' || '));

  await open(page, '/connections/tracking', { root: 'k1-tracking' });
  check('tracking: reloading keeps the IDs', (await value(page, T('k1-track-meta'))) === '123456789012345' && (await value(page, T('k1-track-google'))) === 'G-ABCD1234');
  await page.click(T('k1-track-consent'));
  await page.click(T('k1-track-save'));
  await sleep(350);
  check('tracking: turning the consent note off and saving is stored', (await conns(page)).tracking.consentNote === false);

  // undo restores the previous values and the form follows
  const undoT = toastWith(page, 'Tracking saved');
  await undoT.locator(T('toast-action')).click();
  await sleep(350);
  check('tracking: Undo puts the consent note back on and the form follows', (await conns(page)).tracking.consentNote === true && (await page.locator(T('k1-track-consent')).getAttribute('aria-checked')) === 'true');

  // remove
  await page.click(T('k1-track-clear'));
  await page.waitForSelector(T('confirm-dialog'));
  await page.click(T('confirm-ok'));
  await sleep(350);
  check('tracking: Remove IDs (after a confirm) clears both and the form follows', (await conns(page)).tracking.metaPixelId === '' && (await value(page, T('k1-track-meta'))) === '' && (await value(page, T('k1-track-google'))) === '');
  await toastWith(page, 'Tracking IDs removed').locator(T('toast-action')).click();
  await sleep(350);
  check('tracking: Undo brings the IDs back', (await conns(page)).tracking.googleTagId === 'G-ABCD1234' && (await value(page, T('k1-track-meta'))) === '123456789012345');

  // lead sources
  check('tracking: "Where your enquiries come from" shows the sources with counts', /24 enquiries/.test(await text(page, T('k1-sources-total'))) && /13/.test(await text(page, T('k1-source-facebook'))) && (await exists(page, T('k1-source-instagram'))), await text(page, T('k1-sources')));
  check('tracking: the lead-source numbers are labelled as sample data', /Sample data/.test(await text(page, T('k1-sources'))));
  check('tracking: it links to Insights', (await page.locator(T('k1-sources-insights')).getAttribute('href')) === '#/insights');

  // the hub reflects it
  await open(page, '/connections', { root: 'k1-hub' });
  check('hub: the tracking card now reads Tags set with the pixel', /Tags set/.test(await text(page, T('k1-badge-tracking'))) && /123456789012345/.test(await text(page, T('k1-detail-tracking'))), await text(page, T('k1-card-tracking')));

  // full disk
  await open(page, '/connections/tracking', { root: 'k1-tracking' });
  await page.fill(T('k1-track-meta'), '999999999999999');
  await fillDisk(page);
  await page.click(T('k1-track-save'));
  await sleep(350);
  check('tracking full disk: Save fails with a clear toast and nothing is saved', (await toastWith(page, 'no room left').count()) >= 1 && (await conns(page)).tracking.metaPixelId === '123456789012345');
  check('tracking full disk: what he typed is kept and marked unsaved', (await value(page, T('k1-track-meta'))) === '999999999999999' && /not saved yet/.test(await text(page, T('k1-track-state'))), await text(page, T('k1-track-state')));
  await emptyDisk(page);
  await page.click(T('k1-track-save'));
  await sleep(350);
  check('tracking full disk: once there is room it saves', (await conns(page)).tracking.metaPixelId === '999999999999999');

  check('tracking: no console errors, page errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 6. reduced motion and blocked storage ----------

async function resilience(browser) {
  {
    const ctx = await newContext(browser, { reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const bag = [];
    const setWhere = watch(page, bag);
    for (const s of SCREENS) {
      setWhere(`reduced ${s.hash}`);
      await open(page, s.hash, { root: s.root });
      check(`reduced motion ${s.hash}: renders and does not overflow`, (await overflowOf(page)) <= 0 && !!(await text(page, T('view-title'))));
    }
    const anim = await page.evaluate(() => [...document.querySelectorAll('.k1-card, .k1-hero')].map((el) => parseFloat(getComputedStyle(el).animationDuration) * (/ms/.test(getComputedStyle(el).animationDuration) ? 1 : 1000)));
    check('reduced motion: card entrance animations are effectively off', anim.every((ms) => ms <= 1), anim.join(','));
    check('reduced motion: no console errors', bag.length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }
  {
    // Storage blocked: the page still works from memory and says so.
    const ctx = await newContext(browser, {
      init: () => { try { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); } catch (e) { /* ignore */ } }
    });
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag)('blocked storage');
    await open(page, '/connections', { root: 'k1-hub' });
    check('blocked storage: the hub renders and says nothing will be saved', (await exists(page, T('k1-card-domain'))) && /not letting the page save/.test(await text(page, T('k1-storage-note'))), await text(page, T('k1-storage-note')));
    await open(page, '/connections/webhook', { root: 'k1-webhook' });
    await page.click(T('k1-hook-switch'));
    await sleep(300);
    check('blocked storage: the webhook switch still works (from memory)', (await text(page, T('k1-hook-badge'))) === 'Paused');
    check('blocked storage: no page errors', bag.filter((m) => /pageerror/.test(m)).length === 0, bag.slice(0, 3).join(' || '));
    await ctx.close();
  }
}

// ---------- run ----------

let browser;
try {
  BASE = await startServer();
  console.log(`connections K1 e2e against ${BASE}${AXE ? '' : ' (axe-core not found: accessibility checks skipped)'}`);
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const steps = [['layout sweep', sweep], ['hub', hubChecks], ['domain wizard', domainChecks], ['domain edge cases', domainEdgeChecks],
    ['webhook', webhookChecks], ['tracking', trackingChecks], ['reduced motion and blocked storage', resilience]];
  for (const [name, run] of steps) {
    try { await run(browser); } catch (e) { check(`${name}: ran to the end`, false, String((e && e.message) || e).split('\n').slice(0, 3).join(' ')); }
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)); }
process.exit(failed.length ? 1 : 0);
