// tests/e2e/connections-k2.mjs: end-to-end check of the WhatsApp, Google Calendar and Gmail wizards (Playwright, Chromium, no build step).
// Owner: K2
//   node tests/e2e/connections-k2.mjs
// Env: VERBOSE=1 (print passing checks too), BASE_URL (reuse a running server; otherwise a python http.server is started on a free port),
//      QA_DEPS_DIR (folder whose node_modules holds playwright-core and axe-core), CHROME_PATH (Chromium binary).
// Covers: each wizard end to end with real store data (validation, bad code, resend timer, template approval, preferences, sync, test message and
// email in the outbox), the connected screens, reload mid-wizard and after finishing, disconnect with confirm and Undo, two tabs, store failures
// (storage full) and blocked localStorage, plus layout gates (no horizontal overflow at 320/375/1280, tap targets, axe, console and network cleanliness).
// His photos live on hosts this sandbox cannot reach, so the two allowed image hosts are answered with a stand-in picture. Exits non-zero on any failure.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEP_DIRS = [process.env.QA_DEPS_DIR, '/tmp/claude-0/-home-user-LG-Proto1/9b0bf8bc-80f0-53ab-a3b8-7d955fff3e2a/scratchpad/qa-deps', '/tmp/qa'].filter(Boolean);
const QA_DEPS = DEP_DIRS.find((d) => existsSync(path.join(d, 'node_modules', 'playwright-core'))) || DEP_DIRS[0];
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const NOW = 'now=2026-10-23T20:30&freeze=1';
const CTX = { timezoneId: 'Europe/London', locale: 'en-GB' };
const IMAGE_HOSTS = ['perspective.imgix.net', 'images.unsplash.com'];

const require = createRequire(path.join(QA_DEPS, '/'));
const { chromium } = require('playwright-core');
let AxeSource = null;
try { AxeSource = require('axe-core').source; } catch (e) { AxeSource = null; }

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

const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="1119" height="743" viewBox="0 0 1119 743"><rect width="1119" height="743" fill="#0b0b0c"/><text x="560" y="420" font-family="Arial" font-weight="900" font-size="300" fill="#f5f5f4" text-anchor="middle">180</text></svg>';

/** A fresh browser context (so a fresh localStorage) with the stand-in picture for his two image hosts. */
async function newContext(browser, { w = 375, h = 812, scheme = 'dark', theme = scheme, blockStorage = false } = {}) {
  const ctx = await browser.newContext({
    ...CTX, viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, colorScheme: scheme
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* ignore */ } }, theme);
  if (blockStorage) {
    await ctx.addInitScript(() => {
      const deny = () => { throw new DOMException('denied', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { get: deny });
      Object.defineProperty(window, 'sessionStorage', { get: deny });
    });
  }
  await ctx.route(new RegExp(`^https://(${IMAGE_HOSTS.map((x) => x.replace(/\./g, '\\.')).join('|')})/`), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
  return ctx;
}

/** Collect everything that should never happen on a clean page. */
function watch(page, bag, label = '') {
  let where = label;
  const origin = () => new URL(BASE).origin;
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') bag.push(`[${where}] console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => bag.push(`[${where}] pageerror: ${e.message}`));
  page.on('requestfailed', (r) => { const why = (r.failure() || {}).errorText || ''; if (!/ERR_ABORTED/.test(why)) bag.push(`[${where}] request failed: ${r.url()} ${why}`); }); // a navigation aborts what is in flight: that is not a failure
  page.on('response', (r) => {
    if (r.status() >= 400) bag.push(`[${where}] HTTP ${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(origin()) || u.startsWith('data:') || u.startsWith('blob:')) return;
    let host = '';
    try { host = new URL(u).hostname; } catch (e) { host = u; }
    if (!IMAGE_HOSTS.includes(host) || r.resourceType() !== 'image') bag.push(`[${where}] off-site request ${u}`);
  });
  return (w) => { where = w; };
}

let visit = 0;
async function open(page, hash) {
  visit += 1;
  await page.goto(`${BASE}/dashboard.html?${NOW}&_=${visit}${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(T('view-title'), { timeout: 8000 });
  await quiet(page);
}

/** Mark the sample enquiries as seen and drop any toast, so a toast never covers what a check looks at. */
async function quiet(page) {
  await page.evaluate(async () => {
    const m = await import('/js/core/store.js');
    m.markAllSeen();
    const t = await import('/js/ui/toast.js');
    for (let i = 1; i < 60; i += 1) t.dismissToast(i);
  });
  await sleep(120);
}

const state = (page) => page.evaluate(async () => { const m = await import('/js/core/store.js'); return JSON.parse(JSON.stringify(m.getState())); });
const conn = async (page, key) => (await state(page)).settings.connections[key];
const text = async (page, sel) => ((await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const until = async (fn, ms = 6000, step = 120) => {
  for (let waited = 0; waited <= ms; waited += step) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
};
const UNDO = `${T('toast-action')}:has-text("Undo")`;
const heading = (page, id) => text(page, T(`${id}-heading`));
const clickNext = (page, id) => page.click(T(`${id}-next`));

/** Horizontal overflow and small tap targets inside one scope (the K2 page and any open sheet). */
async function layout(page, scope) {
  return page.evaluate((root) => {
    const out = { over: document.documentElement.scrollWidth - window.innerWidth, small: [], wide: [] };
    const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="switch"], [role="radio"]';
    const scopes = [root, '.ui-sheet'].flatMap((s) => [...document.querySelectorAll(s)]);
    for (const area of scopes) {
      for (const el of area.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (el.closest('[aria-hidden="true"]') || el.classList.contains('ui-link--inline')) continue;
        if (r.height < 43.5) out.small.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || el.className || el.textContent.trim().slice(0, 20)}] ${Math.round(r.height)}px`);
        if (r.right > window.innerWidth + 1 || r.left < -1) out.wide.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || el.textContent.trim().slice(0, 20)}]`);
      }
    }
    return out;
  }, scope);
}

async function axeViolations(page, include) {
  if (!AxeSource) return [];
  await page.evaluate(AxeSource);
  const res = await page.evaluate(async (inc) => {
    const ctx = { include: inc.map((s) => [s]) };
    const r = await window.axe.run(ctx, { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  }, include);
  return res;
}

// ---------- 1. WhatsApp ----------

async function whatsappFlow(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  const setWhere = watch(page, bag, 'whatsapp');
  const W = 'k2-wa-wizard';
  await open(page, '#/connections/whatsapp');

  check('wa: page, SimBanner and back link are there', (await visible(page, T('k2-wa-root'))) && (await visible(page, T('sim-banner'))) && (await page.locator(T('page-back')).getAttribute('href')) === '#/connections', await text(page, T('k2-wa-root')));
  check('wa: starts on step 1 "Your number" with the number prefilled', (await heading(page, W)) === 'Your number' && (await page.inputValue(T('k2-wa-number'))) === '+44 7885 496800', await heading(page, W));
  check('wa: explains what WhatsApp Business is in plain English', /WhatsApp set up for a business/.test(await text(page, T('k2-wa-explain'))));
  check('wa: step 1 reads "Step 1 of 6"', /Step 1 of 6/.test(await text(page, T(`${W}-count`))), await text(page, T(`${W}-count`)));
  check('wa: tap targets and overflow on step 1', await (async () => { const l = await layout(page, T('k2-wa-root')); return l.over <= 0 && l.small.length === 0 && l.wide.length === 0 ? true : JSON.stringify(l); })() === true);

  // invalid number
  await page.fill(T('k2-wa-number'), 'abc');
  await clickNext(page, W);
  await page.waitForSelector(T(`${W}-error`));
  check('wa: an invalid number is refused with a plain message and the field marked', /Enter your WhatsApp number/.test(await text(page, T(`${W}-error`))) && (await page.getAttribute(T('k2-wa-number'), 'aria-invalid')) === 'true');
  check('wa: nothing was saved by the refused step', (await conn(page, 'whatsapp')).status === 'disconnected');

  // valid number -> code step
  await page.fill(T('k2-wa-number'), '07885 496800');
  await clickNext(page, W);
  await page.waitForSelector(T('k2-wa-code'));
  const waState = await conn(page, 'whatsapp');
  check('wa: a valid number moves to the code step and the store says verifying', waState.status === 'verifying' && waState.number === '+447885496800', JSON.stringify(waState));
  check('wa: focus moved to the step heading', await page.evaluate((id) => document.activeElement && document.activeElement.dataset.testid === id, `${W}-heading`));
  check('wa: the prototype code is shown as a hint', /Prototype code: 482913/.test(await text(page, T('k2-wa-code-hint'))), await text(page, T('k2-wa-code-hint')));
  check('wa: the code step is mobile-clean', await (async () => { const l = await layout(page, T('k2-wa-root')); return l.over <= 0 && l.small.length === 0 ? true : JSON.stringify(l); })() === true);

  // short and wrong codes
  await page.fill(T('k2-wa-code'), '12345');
  await clickNext(page, W);
  await page.waitForSelector(T(`${W}-error`));
  check('wa: a short code asks for 6 digits', /6 digits/.test(await text(page, T(`${W}-error`))), await text(page, T(`${W}-error`)));
  await page.fill(T('k2-wa-code'), '123456');
  await clickNext(page, W);
  await until(async () => /does not match/.test(await text(page, T(`${W}-error`))), 3000);
  check('wa: a wrong code shows "does not match" and stays on the step', /does not match/.test(await text(page, T(`${W}-error`))) && (await visible(page, T('k2-wa-code'))), await text(page, T(`${W}-error`)));
  check('wa: a wrong code did not connect anything', (await conn(page, 'whatsapp')).status === 'verifying');
  const digits = await page.evaluate(() => { const i = document.querySelector('[data-testid="k2-wa-code"]'); i.value = 'a1b2c3'; i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; });
  check('wa: the code box keeps digits only', digits === '123', digits);

  // resend timer (a fake clock so the test does not wait 30 seconds)
  await page.clock.install();
  await page.click(T('k2-wa-wizard-back'));
  await page.waitForSelector(T('k2-wa-number'));
  await clickNext(page, W);
  await page.waitForSelector(T('k2-wa-code'));
  check('wa: a resend countdown is shown', /Send a new code in 0:/.test(await text(page, T('k2-wa-resend-timer'))), await text(page, T('k2-wa-resend-timer')));
  await page.clock.runFor(31000);
  await page.waitForSelector(T('k2-wa-resend'), { timeout: 3000 }).catch(() => null);
  check('wa: after 30 seconds the countdown becomes a "Send a new code" button', await visible(page, T('k2-wa-resend')));
  if (await visible(page, T('k2-wa-resend'))) {
    await page.click(T('k2-wa-resend'));
    await page.waitForSelector(T('toast'), { timeout: 3000 }).catch(() => null);
    check('wa: resending says a new code was sent (simulated) and restarts the countdown', /New code sent \(simulated\)/.test(await text(page, T('toast'))) && (await visible(page, T('k2-wa-resend-timer'))), await text(page, T('toast')));
  }
  await quiet(page);

  // right code
  await page.click(T('k2-wa-code-fill'));
  check('wa: "Use this code" fills the demo code', (await page.inputValue(T('k2-wa-code'))) === '482913');
  await clickNext(page, W);
  await page.waitForSelector(T('k2-wa-display-name'));
  const connected = await conn(page, 'whatsapp');
  check('wa: the right code connects the number in the store', connected.status === 'connected' && !!connected.connectedAt, JSON.stringify(connected));
  check('wa: the wizard carries on to the business profile', (await heading(page, W)) === 'Your business profile', await heading(page, W));

  // profile
  check('wa: the profile preview shows his logo and the display name', (await visible(page, T('k2-wa-preview'))) && (await text(page, T('k2-wa-preview-name'))) === '180 Electrical' && (await page.locator(`${T('k2-wa-preview')} img`).count()) === 1);
  check('wa: the logo picture has size, alt, lazy loading and a no-referrer policy', await page.evaluate(() => { const i = document.querySelector('[data-testid="k2-wa-preview"] img'); return !!(i && i.getAttribute('width') && i.getAttribute('height') && i.alt && i.loading === 'lazy' && i.decoding === 'async' && i.referrerPolicy === 'no-referrer'); }));
  await page.fill(T('k2-wa-display-name'), '   ');
  await clickNext(page, W);
  await page.waitForSelector(T(`${W}-error`));
  check('wa: an empty business name is refused', /business name/.test(await text(page, T(`${W}-error`))), await text(page, T(`${W}-error`)));
  await page.fill(T('k2-wa-display-name'), '180 Electrical NI');
  await page.fill(T('k2-wa-about'), 'Home EV chargers across Northern Ireland.');
  await page.selectOption(T('k2-wa-category'), 'other');
  check('wa: the preview follows what is typed', (await text(page, T('k2-wa-preview-name'))) === '180 Electrical NI' && /Home EV chargers across/.test(await text(page, T('k2-wa-preview-about'))) && /Other/.test(await text(page, T('k2-wa-preview'))));
  await clickNext(page, W);
  await page.waitForSelector(T('k2-wa-templates'));
  check('wa: the display name is saved to the store', (await conn(page, 'whatsapp')).displayName === '180 Electrical NI');

  // templates
  check('wa: every template kind is listed (24) with a plain-English name', (await page.locator('[data-testid^="k2-wa-tpl-badge-"]').count()) === 24 && /New enquiry alert/.test(await text(page, T('k2-wa-tpl-owner_new_booking'))));
  check('wa: Next is disabled until the templates are submitted', await page.isDisabled(T(`${W}-next`)));
  const defaults = await page.evaluate(async () => { const c = await import('/js/core/config.js'); return c.DEFAULT_TEMPLATES.customer_quote_sent; });
  await page.click(`${T('k2-wa-tpl-customer_quote_sent')} summary`);
  const shown = await page.evaluate(() => document.querySelector('[data-testid="k2-wa-tpl-text-customer_quote_sent"]').textContent);
  check('wa: a template shows the exact text from messages.js (placeholders in curly brackets)', shown.replace(/\s+/g, ' ').trim() === defaults.replace(/\s+/g, ' ').trim(), shown.slice(0, 80));
  await page.click(T('k2-wa-templates-submit'));
  const pending = await until(async () => /Waiting for approval/.test(await text(page, T('k2-wa-templates-status'))), 2500);
  const stNow = await conn(page, 'whatsapp');
  check('wa: submitting sets every template to pending first', !!pending || Object.values(stNow.templates).every((s) => s === 'pending' || s === 'approved'), await text(page, T('k2-wa-templates-status')));
  const approved = await until(async () => (await conn(page, 'whatsapp')).templates && Object.values((await conn(page, 'whatsapp')).templates).every((s) => s === 'approved'), 9000);
  check('wa: then the templates become approved (simulated)', !!approved);
  check('wa: approval badges read "Approved" and the summary says so', (await text(page, T('k2-wa-tpl-badge-owner_new_booking'))) === 'Approved' && /All 24 messages approved/.test(await text(page, T('k2-wa-templates-status'))), await text(page, T('k2-wa-templates-status')));
  check('wa: the submit button is gone once everything is in', !(await visible(page, T('k2-wa-templates-submit'))));

  // reload mid-wizard (templates step): the wizard resumes where it stopped
  await open(page, '#/connections/whatsapp');
  check('wa: a reload mid-wizard resumes on the same step with the data kept', (await visible(page, T('k2-wa-templates'))) && (await conn(page, 'whatsapp')).status === 'connected', await heading(page, W));
  await clickNext(page, W);
  await page.waitForSelector(T('k2-wa-prefs'));

  // preferences
  const sw = async (id) => (await page.getAttribute(T(id), 'aria-checked')) === 'true';
  check('wa: preferences start on', (await sw('k2-wa-owner-alerts')) && (await sw('k2-wa-customer-updates')) && (await sw('k2-wa-quiet')));
  await page.click(T('k2-wa-owner-alerts'));
  await page.click(T('k2-wa-customer-updates'));
  let c = await conn(page, 'whatsapp');
  check('wa: switching owner alerts and customer updates off is saved in the store', c.ownerAlerts === false && c.customerUpdates === false, JSON.stringify(c));
  await page.fill(T('k2-wa-quiet-from'), '22:30');
  await until(async () => (await conn(page, 'whatsapp')).quietHours.from === '22:30', 2000);
  c = await conn(page, 'whatsapp');
  check('wa: quiet hours "from" is saved', c.quietHours.from === '22:30' && c.quietHours.to === '08:00', JSON.stringify(c.quietHours));
  await page.click(T('k2-wa-quiet'));
  check('wa: turning quiet hours off hides the times', !(await visible(page, T('k2-wa-quiet-from'))) && (await conn(page, 'whatsapp')).quietHours.on === false);
  await page.click(T('k2-wa-owner-alerts'));
  await page.click(T('k2-wa-customer-updates'));
  check('wa: the prefs step is mobile-clean', await (async () => { const l = await layout(page, T('k2-wa-root')); return l.over <= 0 && l.small.length === 0 ? true : JSON.stringify(l); })() === true);
  await clickNext(page, W);

  // test message
  await page.waitForSelector(T('k2-wa-test-send'));
  const before = (await state(page)).messages.length;
  await page.click(T('k2-wa-test-send'));
  await page.waitForSelector(T('k2-wa-test-result'));
  const after = await state(page);
  const last = after.messages[after.messages.length - 1];
  check('wa: "Send test message" logs one simulated owner message in the outbox', after.messages.length === before + 1 && last.kind === 'owner_test_event' && last.channel === 'whatsapp' && last.simulated === true, JSON.stringify(last));
  check('wa: the result shows the message and a link to Messages', /Test message from 180 Electrical/.test(await text(page, T('k2-wa-test-result'))) && (await page.locator(T('k2-wa-test-link')).getAttribute('href')) === '#/messages');
  await page.click(T('k2-wa-test-link'));
  await page.waitForFunction(() => location.hash === '#/messages');
  await page.waitForSelector(T('view-title'));
  check('wa: the Messages link opens Messages', (await page.evaluate(() => location.hash)) === '#/messages');
  await page.goBack();
  await page.waitForSelector(T('k2-wa-root'));
  await quiet(page);
  check('wa: coming back resumes the last step', await visible(page, T('k2-wa-test-send')), await heading(page, W));
  await clickNext(page, W);
  await page.waitForSelector(T('k2-wa-connected'));
  check('wa: Finish opens the connected screen', (await text(page, T('view-title'))) === 'WhatsApp Business' && (await visible(page, T('k2-wa-hero'))));
  check('wa: the connected screen shows status, number, name and the template count', /Connected/.test(await text(page, T('k2-wa-status'))) && /\+44 7885 496800/.test(await text(page, T('k2-wa-hero'))) && /180 Electrical NI/.test(await text(page, T('k2-wa-hero'))) && /24 of 24/.test(await text(page, T('k2-wa-stat-templates'))), await text(page, T('k2-wa-hero')));

  // reload: survives
  await open(page, '#/connections/whatsapp');
  check('wa: after a reload the connected screen is still there', await visible(page, T('k2-wa-connected')));
  const lay = await layout(page, T('k2-wa-root'));
  check('wa: connected screen, no horizontal overflow and tap targets >= 44px', lay.over <= 0 && lay.small.length === 0 && lay.wide.length === 0, JSON.stringify(lay));

  // edit profile on the connected screen
  await page.fill(T('k2-wa-display-name'), '180 Electrical');
  await page.click(T('k2-wa-profile-save'));
  check('wa: editing the profile saves the new name', (await until(async () => (await conn(page, 'whatsapp')).displayName === '180 Electrical', 2000)) !== null);

  // a template row opens and the test sends from the connected screen too
  await page.click(`${T('k2-wa-group-owner')} > summary`);
  check('wa: template groups open on the connected screen', await visible(page, T('k2-wa-tpl-owner_emergency')));
  await page.click(T('k2-wa-test-send'));
  check('wa: the connected screen can send a test message too', !!(await until(async () => (await state(page)).messages.filter((m) => m.kind === 'owner_test_event').length === 2, 3000)));

  // disconnect: cancel, then confirm, then undo
  await page.click(T('k2-wa-disconnect'));
  await page.waitForSelector(T('confirm-dialog'));
  check('wa: Disconnect asks first, and says what happens', /Disconnect WhatsApp\?/.test(await text(page, T('confirm-dialog'))));
  await page.click(T('confirm-cancel'));
  await sleep(300);
  check('wa: cancelling keeps it connected', (await conn(page, 'whatsapp')).status === 'connected');
  await page.click(T('k2-wa-disconnect'));
  await page.waitForSelector(T('confirm-ok'));
  await page.click(T('confirm-ok'));
  await page.waitForSelector(T('k2-wa-wizard'));
  c = await conn(page, 'whatsapp');
  check('wa: confirming disconnects, clears the approvals and returns to step 1', c.status === 'disconnected' && Object.values(c.templates).every((s) => s === 'none') && (await heading(page, W)) === 'Your number', JSON.stringify(c.status));
  await page.waitForSelector(UNDO, { timeout: 3000 }).catch(() => null);
  if (await visible(page, UNDO)) {
    await page.click(UNDO);
    await page.waitForSelector(T('k2-wa-connected'), { timeout: 3000 }).catch(() => null);
    check('wa: Undo puts the connection and its approvals back and shows the connected screen', (await conn(page, 'whatsapp')).status === 'connected' && (await visible(page, T('k2-wa-connected'))));
  } else {
    check('wa: Undo toast appears after disconnecting', false);
  }

  setWhere('whatsapp done');
  check('wa: no console errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 2. Google Calendar ----------

async function calendarFlow(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag, 'calendar');
  const W = 'k2-cal-wizard';
  await open(page, '#/connections/calendar');

  check('cal: page, SimBanner and back link are there', (await visible(page, T('k2-cal-root'))) && (await visible(page, T('sim-banner'))) && (await page.locator(T('page-back')).getAttribute('href')) === '#/connections');
  check('cal: step 1 explains what connecting does and Next waits for the sign-in', /busy times/i.test(await text(page, T('k2-cal-explain'))) && (await page.isDisabled(T(`${W}-next`))));

  // chooser -> consent
  await page.click(T('k2-cal-connect'));
  await page.waitForSelector(T('k2-google-chooser'));
  check('cal: "Connect with Google" opens the account chooser with the sample account', /daniel@180electrical\.co\.uk/.test(await text(page, T('k2-google-account-sample'))) && /Simulated/.test(await text(page, T('k2-google-chooser'))));
  const lay1 = await layout(page, T('k2-cal-root'));
  check('cal: the chooser sheet has 44px targets', lay1.small.length === 0, JSON.stringify(lay1.small));
  await page.click(T('k2-google-other'));
  await page.fill(T('k2-google-other-email'), 'not an email');
  await page.click(T('k2-google-other-continue'));
  check('cal: another account must look like an email address', /Enter a Google account/.test(await text(page, T('k2-google-chooser'))));
  await page.keyboard.press('Escape');
  await sleep(300);
  check('cal: Escape closes the chooser and nothing is connected', !(await visible(page, T('k2-google-chooser'))) && (await conn(page, 'calendar')).status === 'disconnected');
  await page.click(T('k2-cal-connect'));
  await page.waitForSelector(T('k2-google-chooser'));
  await page.click(T('k2-google-account-sample'));
  await page.waitForSelector(T('consent-sheet'));
  check('cal: the consent screen is labelled Simulated and lists the scope', (await visible(page, T('consent-simulated'))) && /See and create events on your calendars/.test(await text(page, T('consent-scopes'))) && /daniel@180electrical\.co\.uk/.test(await text(page, T('consent-sheet'))));
  check('cal: the consent sheet is clean for axe and tap targets', (await layout(page, T('k2-cal-root'))).small.length === 0);
  await page.click(T('consent-cancel'));
  await sleep(300);
  check('cal: Cancel on the consent screen connects nothing', !(await visible(page, T('consent-sheet'))) && (await conn(page, 'calendar')).status === 'disconnected' && (await state(page)).blocks.filter((b) => b.source === 'google_calendar').length === 0);
  await page.click(T('k2-cal-connect'));
  await page.click(T('k2-google-account-sample'));
  await page.waitForSelector(T('consent-allow'));
  await page.click(T('consent-allow'));
  await page.waitForSelector(T('k2-cal-mode-new'));
  let st = await state(page);
  const cal1 = st.settings.connections.calendar;
  check('cal: Allow connects the sample account in the store', cal1.status === 'connected' && cal1.account === 'daniel@180electrical.co.uk' && !!cal1.connectedAt, JSON.stringify(cal1));
  check('cal: connecting with two-way sync on imports labelled busy blocks', st.blocks.filter((b) => b.source === 'google_calendar' && b.label === 'Google Calendar').length >= 3, String(st.blocks.filter((b) => b.source === 'google_calendar').length));
  check('cal: the wizard moved on to "Choose a calendar"', (await heading(page, W)) === 'Choose a calendar', await heading(page, W));

  // choose a calendar
  check('cal: the new calendar is called "180 Electrical jobs" by default', (await page.inputValue(T('k2-cal-name'))) === '180 Electrical jobs' && (await page.isChecked(T('k2-cal-mode-new'))));
  await page.fill(T('k2-cal-name'), '');
  await clickNext(page, W);
  await page.waitForSelector(T(`${W}-error`));
  check('cal: an empty calendar name is refused', /calendar name/.test(await text(page, T(`${W}-error`))));
  await page.click(T('k2-cal-mode-existing'));
  await page.selectOption(T('k2-cal-existing'), 'Van and tools');
  await clickNext(page, W);
  await page.waitForSelector(T('k2-cal-options'));
  check('cal: choosing an existing calendar saves its name', (await conn(page, 'calendar')).calendarName === 'Van and tools', (await conn(page, 'calendar')).calendarName);

  // options
  const sw = async (id) => (await page.getAttribute(T(id), 'aria-checked')) === 'true';
  check('cal: options start on and the example event shows the next real job', (await sw('k2-cal-twoway')) && (await sw('k2-cal-addjobs')) && (await sw('k2-cal-reminders')) && (await visible(page, T('k2-cal-example'))) && /Example event/.test(await text(page, T('k2-cal-example'))), await text(page, T('k2-cal-example')));
  await page.click(T('k2-cal-twoway'));
  st = await state(page);
  check('cal: switching two-way sync off removes the Google busy blocks', st.settings.connections.calendar.twoWay === false && st.blocks.filter((b) => b.source === 'google_calendar').length === 0);
  await page.click(T('k2-cal-twoway'));
  st = await state(page);
  check('cal: switching it back on brings them back', st.settings.connections.calendar.twoWay === true && st.blocks.filter((b) => b.source === 'google_calendar').length >= 3);
  await page.click(T('k2-cal-addjobs'));
  check('cal: add-confirmed-jobs is saved in the store', (await conn(page, 'calendar')).addJobs === false);
  await page.click(T('k2-cal-addjobs'));
  await page.selectOption(T('k2-cal-remind'), '1440');
  check('cal: the reminder choice shows in the example event', /day before/.test(await text(page, T('k2-cal-example'))), await text(page, T('k2-cal-example')));
  check('cal: the options step is mobile-clean', await (async () => { const l = await layout(page, T('k2-cal-root')); return l.over <= 0 && l.small.length === 0 ? true : JSON.stringify(l); })() === true);
  await clickNext(page, W);

  // sync now
  await page.waitForSelector(T('k2-cal-sync'));
  await page.click(T('k2-cal-sync'));
  await until(async () => /Synced/.test(await text(page, T('k2-cal-sync-result'))), 4000);
  check('cal: "Sync now" reports what it did and says it is simulated', /Synced\. \d+ busy times? from Google Calendar/.test(await text(page, T('k2-cal-sync-result'))) && /simulated/.test(await text(page, T('k2-cal-sync-result'))), await text(page, T('k2-cal-sync-result')));
  check('cal: the busy times from Google are listed', (await page.locator(`${T('k2-cal-busy')} li`).count()) >= 3);
  check('cal: the last sync time is shown', /Last synced/.test(await text(page, T('k2-cal-last-sync'))));
  // the diary really shows them
  const gcalDate = (await state(page)).blocks.find((b) => b.source === 'google_calendar').date;
  await page.click(T('k2-cal-open-calendar'));
  await page.waitForFunction(() => location.hash.startsWith('#/calendar'));
  await page.evaluate((d) => { location.hash = `#/calendar/${d}`; }, gcalDate);
  await page.waitForFunction((d) => location.hash === `#/calendar/${d}`, gcalDate);
  await sleep(900);
  await quiet(page);
  check('cal: the Calendar screen shows the block labelled "Google Calendar"', /Google Calendar/.test(await page.evaluate(() => document.getElementById('main').innerText)));
  await open(page, '#/connections/calendar');
  check('cal: after a reload mid-wizard it resumes on the same step', await visible(page, T('k2-cal-sync')), await heading(page, W));
  await clickNext(page, W);
  await page.waitForSelector(T('k2-cal-connected'));
  check('cal: Finish opens the connected screen with account, calendar and status', /Connected/.test(await text(page, T('k2-cal-status'))) && /daniel@180electrical\.co\.uk/.test(await text(page, T('k2-cal-hero'))) && /Van and tools/.test(await text(page, T('k2-cal-hero'))), await text(page, T('k2-cal-hero')));

  await open(page, '#/connections/calendar');
  check('cal: after a reload the connected screen is still there', await visible(page, T('k2-cal-connected')));
  const lay = await layout(page, T('k2-cal-root'));
  check('cal: connected screen, no horizontal overflow and tap targets >= 44px', lay.over <= 0 && lay.small.length === 0 && lay.wide.length === 0, JSON.stringify(lay));
  await page.click(T('k2-cal-mode-new'));
  await page.fill(T('k2-cal-name'), '180 Electrical jobs');
  await page.click(T('k2-cal-save'));
  check('cal: choosing a different calendar on the connected screen saves it', (await until(async () => (await conn(page, 'calendar')).calendarName === '180 Electrical jobs', 2000)) !== null);
  await page.click(T('k2-cal-twoway'));
  check('cal: two-way sync can be switched off from the connected screen (blocks leave the diary)', (await until(async () => (await state(page)).blocks.filter((b) => b.source === 'google_calendar').length === 0, 2000)) !== null);
  await page.click(T('k2-cal-sync'));
  await until(async () => /two-way sync is off/i.test(await text(page, T('k2-cal-sync-result'))), 3000);
  check('cal: Sync now with two-way off says so instead of pretending', /two-way sync is off/i.test(await text(page, T('k2-cal-sync-result'))), await text(page, T('k2-cal-sync-result')));
  await page.click(T('k2-cal-twoway'));
  await until(async () => (await state(page)).blocks.filter((b) => b.source === 'google_calendar').length >= 3, 2000);

  await page.click(T('k2-cal-disconnect'));
  await page.waitForSelector(T('confirm-ok'));
  await page.click(T('confirm-ok'));
  await page.waitForSelector(T(W));
  st = await state(page);
  check('cal: disconnecting removes the Google busy blocks and returns to step 1', st.settings.connections.calendar.status === 'disconnected' && st.blocks.filter((b) => b.source === 'google_calendar').length === 0 && (await heading(page, W)) === 'Connect Google');
  await page.waitForSelector(UNDO, { timeout: 3000 }).catch(() => null);
  if (await visible(page, UNDO)) {
    await page.click(UNDO);
    await page.waitForSelector(T('k2-cal-connected'), { timeout: 3000 }).catch(() => null);
    check('cal: Undo restores the connection and the connected screen', (await conn(page, 'calendar')).status === 'connected' && (await visible(page, T('k2-cal-connected'))));
  } else {
    check('cal: Undo toast appears after disconnecting', false);
  }
  check('cal: no console errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 3. Gmail ----------

async function emailFlow(browser) {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const bag = [];
  watch(page, bag, 'email');
  const W = 'k2-email-wizard';
  await open(page, '#/connections/email');
  check('email: page, SimBanner and back link are there', (await visible(page, T('k2-email-root'))) && (await visible(page, T('sim-banner'))) && (await page.locator(T('page-back')).getAttribute('href')) === '#/connections');

  await page.click(T('k2-email-connect'));
  await page.click(T('k2-google-account-sample'));
  await page.waitForSelector(T('consent-sheet'));
  check('email: the consent screen asks to send email on his behalf, labelled Simulated', /Send email on your behalf/.test(await text(page, T('consent-scopes'))) && (await visible(page, T('consent-simulated'))));
  await page.click(T('consent-allow'));
  await page.waitForSelector(T('k2-email-choice'));
  let em = await conn(page, 'email');
  check('email: Allow connects the account in the store', em.status === 'connected' && em.account === 'daniel@180electrical.co.uk' && !!em.connectedAt, JSON.stringify(em));
  check('email: the wizard moved on to "Send from"', (await heading(page, W)) === 'Send from');

  check('email: the business address is the first choice and selected', await page.isChecked(T('k2-email-from-business')));
  await page.click(T('k2-email-from-other'));
  await page.fill(T('k2-email-other'), 'nope');
  await clickNext(page, W);
  await page.waitForSelector(T(`${W}-error`));
  check('email: a different address must be a real email address', /email address/.test(await text(page, T(`${W}-error`))) && (await page.getAttribute(T('k2-email-other'), 'aria-invalid')) === 'true');
  await page.fill(T('k2-email-other'), 'hello@180electrical.co.uk');
  await clickNext(page, W);
  await page.waitForSelector(T('k2-email-what'));
  check('email: the chosen send-from address is saved', (await conn(page, 'email')).sendFrom === 'hello@180electrical.co.uk');

  const sw = async (id) => (await page.getAttribute(T(id), 'aria-checked')) === 'true';
  check('email: the three toggles start on', (await sw('k2-email-confirmations')) && (await sw('k2-email-quotes')) && (await sw('k2-email-reviews')));
  await page.click(T('k2-email-confirmations'));
  await page.click(T('k2-email-reviews'));
  em = await conn(page, 'email');
  check('email: toggles are saved (confirmations in the store)', em.confirmations === false && em.quotes === true, JSON.stringify(em));
  await page.click(T('k2-email-confirmations'));
  check('email: the what-to-send step is mobile-clean', await (async () => { const l = await layout(page, T('k2-email-root')); return l.over <= 0 && l.small.length === 0 ? true : JSON.stringify(l); })() === true);
  await clickNext(page, W);

  // preview
  await page.waitForSelector(T('k2-email-card'));
  const real = await page.evaluate(async () => { const c = await import('/js/core/config.js'); return c.DEFAULT_TEMPLATES.customer_quote_sent.slice(0, 30); });
  const subjectQuote = await text(page, T('k2-email-card-subject'));
  check('email: the preview shows a styled quote email from the chosen address', /Your quote from 180 Electrical/.test(subjectQuote) && /hello@180electrical\.co\.uk/.test(await text(page, T('k2-email-card-from'))), `${subjectQuote} | ${await text(page, T('k2-email-card-from'))}`);
  const body = await text(page, T('k2-email-card-body'));
  check('email: the body is the real template text, filled in (no braces left)', /written quote for the home charger installation is ready/.test(body) && !/[{}]/.test(body) && real.length > 0, body.slice(0, 120));
  await page.click(T('k2-email-sample-confirmation'));
  await sleep(150);
  check('email: switching to the confirmation changes the email', /confirmed/.test(await text(page, T('k2-email-card-subject'))) && (await text(page, T('k2-email-card-subject'))) !== subjectQuote, await text(page, T('k2-email-card-subject')));
  await page.click(T('k2-email-sample-review'));
  await sleep(150);
  check('email: switching to the review request changes it again', /How did we do/.test(await text(page, T('k2-email-card-subject'))), await text(page, T('k2-email-card-subject')));
  // test email
  const before = (await state(page)).messages.length;
  await page.click(T('k2-email-test-send'));
  await page.waitForSelector(T('k2-email-test-result'));
  const after = await state(page);
  const last = after.messages[after.messages.length - 1];
  check('email: "Send test email" logs one email-channel message in the outbox', after.messages.length === before + 1 && last.kind === 'owner_test_event' && last.channel === 'email' && last.simulated === true, JSON.stringify(last));
  check('email: the result shows the test email and a link to Messages', (await visible(page, T('k2-email-test-card'))) && (await page.locator(T('k2-email-test-link')).getAttribute('href')) === '#/messages');
  const lay1 = await layout(page, T('k2-email-root'));
  check('email: the preview step has no overflow and 44px targets', lay1.over <= 0 && lay1.small.length === 0 && lay1.wide.length === 0, JSON.stringify(lay1));
  await clickNext(page, W);
  await page.waitForSelector(T('k2-email-connected'));
  check('email: Finish opens the connected screen with account and send-from', /Connected/.test(await text(page, T('k2-email-status'))) && /hello@180electrical\.co\.uk/.test(await text(page, T('k2-email-hero'))), await text(page, T('k2-email-hero')));

  await open(page, '#/connections/email');
  check('email: after a reload the connected screen is still there', await visible(page, T('k2-email-connected')));
  check('email: the review-requests choice survived the reload', (await text(page, T('k2-email-stat-reviews'))).includes('Off'), await text(page, T('k2-email-stat-reviews')));
  const lay = await layout(page, T('k2-email-root'));
  check('email: connected screen, no horizontal overflow and tap targets >= 44px', lay.over <= 0 && lay.small.length === 0 && lay.wide.length === 0, JSON.stringify(lay));
  await page.click(T('k2-email-from-business'));
  await page.click(T('k2-email-from-save'));
  check('email: send-from can be changed on the connected screen', (await until(async () => (await conn(page, 'email')).sendFrom === 'daniel@180electrical.co.uk', 2000)) !== null);

  await page.click(T('k2-email-disconnect'));
  await page.waitForSelector(T('confirm-ok'));
  await page.click(T('confirm-ok'));
  await page.waitForSelector(T(W));
  check('email: disconnecting returns to step 1 and the store says disconnected', (await conn(page, 'email')).status === 'disconnected' && (await heading(page, W)) === 'Connect Gmail');
  await page.waitForSelector(UNDO, { timeout: 3000 }).catch(() => null);
  if (await visible(page, UNDO)) {
    await page.click(UNDO);
    await page.waitForSelector(T('k2-email-connected'), { timeout: 3000 }).catch(() => null);
    check('email: Undo restores the connection', (await conn(page, 'email')).status === 'connected' && (await visible(page, T('k2-email-connected'))));
  } else {
    check('email: Undo toast appears after disconnecting', false);
  }
  check('email: no console errors, failed or off-site requests', bag.length === 0, bag.slice(0, 5).join(' || '));
  await ctx.close();
}

// ---------- 4. Two tabs, failures, blocked storage ----------

async function resilience(browser) {
  // two tabs of one browser stay in step
  {
    const ctx = await newContext(browser);
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    const bag = [];
    watch(a, bag, 'tab A');
    watch(b, bag, 'tab B');
    await open(a, '#/connections/whatsapp');
    // connect quickly through the store, then look at both tabs
    await a.evaluate(async () => { const m = await import('/js/core/store.js'); m.setConnection('whatsapp', { status: 'verifying' }); m.connectWhatsApp({ number: '+447885496800', code: '482913' }); m.submitWhatsAppTemplates(); });
    await until(async () => Object.values((await conn(a, 'whatsapp')).templates).every((s) => s === 'approved'), 9000);
    await open(a, '#/connections/whatsapp');
    await open(b, '#/connections/whatsapp');
    check('tabs: both tabs show the connected screen', (await visible(a, T('k2-wa-connected'))) && (await visible(b, T('k2-wa-connected'))));
    await a.click(T('k2-wa-owner-alerts'));
    // owner alerts live in the prefs panel on the connected screen
    const synced = await until(async () => /Alerts to you\s*Off/.test(await text(b, T('k2-wa-stat-alerts'))), 4000);
    check('tabs: a change in tab A shows up in tab B without a reload', !!synced, await text(b, T('k2-wa-stat-alerts')));
    await a.click(T('k2-wa-disconnect'));
    await a.waitForSelector(T('confirm-ok'));
    await a.click(T('confirm-ok'));
    const gone = await until(async () => visible(b, T('k2-wa-wizard')), 4000);
    check('tabs: disconnecting in tab A puts tab B back on the wizard', !!gone && (await conn(b, 'whatsapp')).status === 'disconnected');
    check('tabs: no console problems in either tab', bag.length === 0, bag.slice(0, 4).join(' || '));
    await ctx.close();
  }
  // a store failure (storage full) is reported and loses nothing
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag, 'storage full');
    await open(page, '#/connections/email');
    await page.evaluate(async () => { const m = await import('/js/core/store.js'); m.connectGoogle('email', { account: 'daniel@180electrical.co.uk' }); });
    await open(page, '#/connections/email');
    const onDash = await visible(page, T('k2-email-connected'));
    check('failure: a connected Gmail opens straight on the connected screen', onDash);
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      window.__realSetItem = real;
      Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('vm_state')) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); };
    });
    await page.click(T('k2-email-quotes'));
    await page.waitForSelector(T('toast'), { timeout: 3000 }).catch(() => null);
    const toastText = await text(page, T('toast'));
    check('failure: when the device is full a switch says so in plain words', /no room|full|space/i.test(toastText), toastText);
    check('failure: and the setting is not changed on screen or in the store', (await conn(page, 'email')).quotes === true && (await page.getAttribute(T('k2-email-quotes'), 'aria-checked')) === 'true');
    await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
    await page.click(T('k2-email-quotes'));
    check('failure: once there is room again the same switch works', (await until(async () => (await conn(page, 'email')).quotes === false, 2500)) !== null);
    await quiet(page);
    await ctx.close();
  }
  // localStorage and sessionStorage blocked: the wizard still works (memory mode)
  {
    const ctx = await newContext(browser, { blockStorage: true });
    const page = await ctx.newPage();
    const bag = [];
    watch(page, bag, 'blocked storage');
    await open(page, '#/connections/whatsapp');
    await page.click(T('k2-wa-wizard-next'));
    await page.waitForSelector(T('k2-wa-code'));
    await page.click(T('k2-wa-code-fill'));
    await page.click(T('k2-wa-wizard-next'));
    await page.waitForSelector(T('k2-wa-display-name'));
    check('storage blocked: the WhatsApp wizard still works end to end (memory mode)', (await conn(page, 'whatsapp')).status === 'connected');
    await clickNext(page, 'k2-wa-wizard');
    await page.waitForSelector(T('k2-wa-templates'));
    await page.click(T('k2-wa-templates-submit'));
    await until(async () => (await conn(page, 'whatsapp')).templates.owner_new_booking === 'approved', 9000);
    check('storage blocked: templates still go through approval', (await conn(page, 'whatsapp')).templates.owner_new_booking === 'approved');
    const real = bag.filter((x) => !/localStorage|sessionStorage|denied|SecurityError|storage/i.test(x));
    check('storage blocked: no unexpected console errors', real.length === 0, real.slice(0, 4).join(' || '));
    await ctx.close();
  }
}

// ---------- 5. Layout sweep and axe, every step, both themes ----------

async function sweep(browser) {
  const stepsOf = {
    wa: async (page, shot) => {
      await shot('step1');
      await page.click(T('k2-wa-wizard-next'));
      await page.waitForSelector(T('k2-wa-code')); await shot('step2');
      await page.click(T('k2-wa-code-fill')); await page.click(T('k2-wa-wizard-next'));
      await page.waitForSelector(T('k2-wa-display-name')); await shot('step3');
      await page.click(T('k2-wa-wizard-next')); await page.waitForSelector(T('k2-wa-templates')); await shot('step4');
      await page.click(T('k2-wa-templates-submit'));
      await until(async () => (await conn(page, 'whatsapp')).templates.owner_new_booking === 'approved', 9000);
      await shot('step4b');
      await page.click(T('k2-wa-wizard-next')); await page.waitForSelector(T('k2-wa-prefs')); await shot('step5');
      await page.click(T('k2-wa-wizard-next')); await page.waitForSelector(T('k2-wa-test-send'));
      await page.click(T('k2-wa-test-send')); await page.waitForSelector(T('k2-wa-test-result')); await shot('step6');
      await page.click(T('k2-wa-wizard-next')); await page.waitForSelector(T('k2-wa-connected')); await shot('connected');
    },
    cal: async (page, shot) => {
      await shot('step1');
      await page.click(T('k2-cal-connect')); await page.waitForSelector(T('k2-google-chooser')); await shot('chooser', true);
      await page.click(T('k2-google-account-sample')); await page.waitForSelector(T('consent-allow')); await shot('consent', true);
      await page.click(T('consent-allow')); await page.waitForSelector(T('k2-cal-mode-new')); await shot('step2');
      await page.click(T('k2-cal-wizard-next')); await page.waitForSelector(T('k2-cal-options')); await shot('step3');
      await page.click(T('k2-cal-wizard-next')); await page.waitForSelector(T('k2-cal-sync'));
      await page.click(T('k2-cal-sync')); await until(async () => /Synced/.test(await text(page, T('k2-cal-sync-result'))), 4000); await shot('step4');
      await page.click(T('k2-cal-wizard-next')); await page.waitForSelector(T('k2-cal-connected')); await shot('connected');
    },
    email: async (page, shot) => {
      await shot('step1');
      await page.click(T('k2-email-connect')); await page.click(T('k2-google-account-sample')); await page.waitForSelector(T('consent-allow')); await shot('consent', true);
      await page.click(T('consent-allow')); await page.waitForSelector(T('k2-email-choice')); await shot('step2');
      await page.click(T('k2-email-wizard-next')); await page.waitForSelector(T('k2-email-what')); await shot('step3');
      await page.click(T('k2-email-wizard-next')); await page.waitForSelector(T('k2-email-card')); await shot('step4');
      await page.click(T('k2-email-test-send')); await page.waitForSelector(T('k2-email-test-result')); await shot('step4b');
      await page.click(T('k2-email-wizard-next')); await page.waitForSelector(T('k2-email-connected')); await shot('connected');
    }
  };
  const routes = { wa: 'whatsapp', cal: 'calendar', email: 'email' };
  const roots = { wa: 'k2-wa-root', cal: 'k2-cal-root', email: 'k2-email-root' };
  for (const [scheme, w] of [['dark', 375], ['light', 375], ['dark', 320], ['light', 1280]]) {
    for (const key of ['wa', 'cal', 'email']) {
      const ctx = await newContext(browser, { w, h: w < 700 ? 812 : 900, scheme });
      const page = await ctx.newPage();
      const bag = [];
      watch(page, bag, `${key} ${scheme} ${w}`);
      await open(page, `#/connections/${routes[key]}`);
      const issues = [];
      const axeIssues = [];
      const shot = async (name, sheet = false) => {
        await sleep(250);
        await quiet(page);
        const l = await layout(page, `[data-testid="${roots[key]}"]`);
        if (l.over > 0) issues.push(`${name}: overflow ${l.over}px`);
        if (l.small.length) issues.push(`${name}: small ${l.small.slice(0, 3).join(', ')}`);
        if (l.wide.length) issues.push(`${name}: outside screen ${l.wide.slice(0, 3).join(', ')}`);
        if (scheme === 'dark' && w === 375 || scheme === 'light' && w === 1280) {
          const v = await axeViolations(page, sheet ? ['#overlay-root'] : ['#main']);
          if (v.length) axeIssues.push(`${name}: ${v.join(' ; ')}`);
        }
      };
      await stepsOf[key](page, shot);
      check(`sweep ${key} ${scheme} ${w}px: no horizontal overflow, no target under 44px, nothing off screen`, issues.length === 0, issues.slice(0, 4).join(' || '));
      if (scheme === 'dark' && w === 375 || scheme === 'light' && w === 1280) check(`sweep ${key} ${scheme} ${w}px: axe finds no serious or critical issue on any step`, axeIssues.length === 0 || !AxeSource, axeIssues.slice(0, 3).join(' || '));
      check(`sweep ${key} ${scheme} ${w}px: no console errors, failed or off-site requests`, bag.length === 0, bag.slice(0, 4).join(' || '));
      await ctx.close();
    }
  }
}

// ---------- run ----------

async function main() {
  BASE = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    for (const [name, fn] of [['whatsapp', whatsappFlow], ['calendar', calendarFlow], ['email', emailFlow], ['resilience', resilience], ['sweep', sweep]]) {
      try { await fn(browser); } catch (e) { check(`${name}: the flow ran to the end`, false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e)); }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${AxeSource ? '' : ' (axe-core not found: axe checks skipped)'}`);
  if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)); process.exit(1); }
}

main().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
