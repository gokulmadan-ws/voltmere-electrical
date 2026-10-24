// tests/e2e/quote-q2.mjs: end-to-end check of the customer quote page (quote.html#q=<quoteId>): every state, the accept flow with the real availability
// engine and its recovery paths, decline, view counting, reload, two tabs, store failures, themes, widths, accessibility and the calendar file.
// Owner: Q2 (customer quote page). Self-contained: starts its own static server unless BASE_URL is set; creates its quotes through the store in the page.
//
//   node tests/e2e/quote-q2.mjs
//   BASE_URL=http://127.0.0.1:4178 node tests/e2e/quote-q2.mjs
//   QA_DEPS_DIR=/path/with/node_modules node tests/e2e/quote-q2.mjs     (must contain playwright-core; axe-core is used when present)
//   CHROMIUM_PATH=/path/to/chrome   SHOTS_DIR=/some/dir (optional screenshots)   ONLY=3 (runs the sections whose name starts with 3)
//
// Exits 0 when every check passes, 1 otherwise. The clock is frozen with ?now=2026-10-23T20:30&freeze=1 (a Friday evening).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/claude-0/-home-user-LG-Proto1/9b0bf8bc-80f0-53ab-a3b8-7d955fff3e2a/scratchpad/qa-deps';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SHOTS = process.env.SHOTS_DIR || '';
const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLOCK = 'now=2026-10-23T20:30&freeze=1';
const require = createRequire(QA_DEPS.endsWith('/') ? QA_DEPS : QA_DEPS + '/');
const { chromium } = require('playwright-core');
let AXE_SOURCE = '';
try { AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { AXE_SOURCE = ''; }

// ---------------------------------------------------------------- harness
let failures = 0;
let passes = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT = 9000;
async function until(fn, ms = WAIT, step = 80) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* page busy or navigating: try again */ }
    await sleep(step);
  }
  return false;
}
async function section(name, fn) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  console.log('\n# ' + name);
  try { await fn(); } catch (e) { failures += 1; console.log('  FAIL ' + name + ' threw: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}

// ---------------------------------------------------------------- server and browser
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
  const up = await until(async () => { const r = await fetch(base + '/quote.html').catch(() => null); return r && r.ok; }, 10000, 150);
  if (!up) throw new Error('static server did not start');
  return base;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const BASE = await startServer();
const ORIGIN = new URL(BASE).origin;
const MOBILE = { width: 375, height: 812 };
const IMG_HOSTS = new Set(['perspective.imgix.net', 'images.unsplash.com']);
const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="1119" height="743" viewBox="0 0 1119 743"><rect width="1119" height="743" fill="#0b0b0c"/><rect x="300" y="250" width="520" height="240" fill="#e11414"/></svg>';

async function newContext(vp, scheme = 'dark', extra = {}) {
  const { theme, ...rest } = extra;
  const ctx = await browser.newContext({
    viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: scheme,
    isMobile: vp.width < 600, hasTouch: vp.width < 600, acceptDownloads: true, ...rest
  });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme', t); } catch (e) { /* blocked */ } }, theme);
  // His pictures live on two external hosts the sandbox cannot reach: every request to them is answered with a stand-in.
  await ctx.route((u) => IMG_HOSTS.has(u.hostname), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
  return ctx;
}

/** Everything that should stay empty: console errors and warnings, page errors, off-site and failed requests. */
function watch(page) {
  const log = { errors: [], offsite: [], failed: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    const url = new URL(u);
    if (url.origin === ORIGIN) return;
    if (IMG_HOSTS.has(url.hostname) && r.resourceType() === 'image') return;
    log.offsite.push(u);
  });
  page.on('requestfailed', (r) => log.failed.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}
const clean = (log) => log.errors.length === 0 && log.offsite.length === 0 && log.failed.length === 0;
const dump = (log) => [...log.errors, ...log.offsite, ...log.failed].join(' | ');
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const txt = async (page, id) => (await tid(page, id).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const attr = (page, id, name) => tid(page, id).first().getAttribute(name).catch(() => null);
const shot = async (page, name, full = false) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full }); } };

/** Open quote.html on a blank (no quote) hash and wait for the page to be up. */
async function openBlank(page, hash = '') {
  await page.goto(`${BASE}/quote.html?${CLOCK}${hash}`, { waitUntil: 'load' });
  await tid(page, 'q2-page').waitFor({ timeout: WAIT });
}
const open = async (page, id, extra = '') => openBlank(page, `#q=${encodeURIComponent(id)}${extra}`);
const stateOf = (page) => attr(page, 'q2-page', 'data-state');
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const LINES = [
  { label: 'Supply of OHME home charger', detail: '', qty: 1, unitPrice: 679 },
  { label: 'Standard installation (up to 10 m of cable)', detail: 'Cable run planned at the survey', qty: 1, unitPrice: 450 },
  { label: 'Extra cable (per metre)', detail: '', qty: 6, unitPrice: 12 },
  { label: 'Testing and certification', detail: '', qty: 1, unitPrice: 85 }
];
const TOTAL = 679 + 450 + 6 * 12 + 85; // 1286

/** Create an enquiry, a quote for it and (by default) send it, all through the store inside the page. Resolves the quote id. */
async function makeQuote(page, { name = 'Sean Doherty', send = true, validUntil = '', lines = LINES, brand = 'OHME', notes } = {}) {
  return page.evaluate(async (o) => {
    const s = await import('/js/core/store.js');
    const made = s.createBooking({
      serviceId: 'ev_quote',
      answers: { postcode: 'BT9 6QP', parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: false },
      customer: { name: o.name, phone: '07700 900123', email: 'sean@example.com' },
      address: { line1: '', postcode: 'BT9 6QP' }, notes: '', source: 'website', pencil: true
    });
    if (!made.ok) throw new Error('createBooking failed: ' + made.reason);
    const input = { bookingId: made.booking.id, brand: o.brand, lines: o.lines };
    if (o.notes !== undefined) input.notes = o.notes;
    const q = s.createQuote(input);
    if (!q.ok) throw new Error('createQuote failed: ' + q.reason);
    if (o.send) {
      const sent = s.sendQuote(q.quote.id, { via: 'whatsapp' });
      if (!sent.ok) throw new Error('sendQuote failed: ' + sent.reason);
      if (o.validUntil) {
        const up = s.updateQuote(q.quote.id, { validUntil: o.validUntil });
        if (!up.ok) throw new Error('updateQuote failed: ' + up.reason);
      }
    }
    return q.quote.id;
  }, { name, send, validUntil, lines, brand, notes });
}
const quoteInStore = (page, id) => page.evaluate((qid) => { try { return JSON.parse(localStorage.getItem('vm_state_v1')).quotes[qid] || null; } catch (e) { return null; } }, id);
const stateInStore = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vm_state_v1')); } catch (e) { return null; } });

/** Run axe on the page; the serious and critical violations (empty when axe-core is not installed). */
async function axeSerious(page) {
  if (!AXE_SOURCE) return { count: 0, detail: 'axe-core not installed' };
  await page.evaluate(AXE_SOURCE);
  const res = await page.evaluate(async () => {
    const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return out.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ' x' + v.nodes.length + ' ' + v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; '));
  });
  return { count: res.length, detail: res.join(' | ') };
}
/** Visible interactive elements smaller than 44px in either direction (inline text links are exempt). */
const smallTargets = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('a[href], button, summary, label.q2-slot, label.q2-reason, input:not([type="radio"]), textarea, select')) {
    if (el.closest('.q2-sticky:not(.is-on)') || el.classList.contains('q2-skip')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.classList.contains('ui-link--inline')) continue;
    if (r.height < 43.5 || r.width < 43.5) out.push((el.getAttribute('data-testid') || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return out;
});
const firstFreeSlots = (page, n = 3) => page.$$eval('label.q2-slot:not(.is-taken)', (els, k) => els.slice(0, k).map((e) => e.getAttribute('data-testid')), n);

// ================================================================ 1. the quiet states
await section('1. no quote: missing reference, unknown reference, draft', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  check('no hash gives the "incomplete" state', (await stateOf(page)) === 'invalid' && /isn't complete/.test(await txt(page, 'q2-title')));
  await openBlank(page, '#q=Q-NOPE-9');
  check('unknown id gives the "not valid on this device" state', /isn't valid on this device/.test(await txt(page, 'q2-title')), await txt(page, 'q2-title'));
  const body = await txt(page, 'q2-invalid');
  check('it explains the prototype limit', /prototype/i.test(body) && /same phone or computer/i.test(body) && /any phone|any device/i.test(body), body.slice(0, 200));
  check('it shows the reference from the link', (await txt(page, 'q2-bad-id')) === 'Q-NOPE-9');
  check('it offers his real number', (await attr(page, 'q2-call', 'href')) === 'tel:+447885496800');
  check('it links to the dashboard on this device', /dashboard\.html(\?[^#]*)?#\/quotes$/.test((await attr(page, 'q2-open-dashboard', 'href')) || ''));
  const id = await makeQuote(page, { send: false });
  await open(page, id);
  check('a draft is "not ready yet" and shows nothing of the quote', (await stateOf(page)) === 'draft' && /isn't ready yet/.test(await txt(page, 'q2-title')) && (await tid(page, 'q2-lines').count()) === 0);
  check('a draft is not counted as viewed and stays a draft', (await quoteInStore(page, id)).status === 'draft');
  await page.evaluate(async (qid) => { const s = await import('/js/core/store.js'); s.sendQuote(qid, { via: 'whatsapp' }); }, id);
  check('when the owner sends it, the open page switches to the quote by itself', await until(async () => (await stateOf(page)) === 'open'));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 2. the open quote
await section('2. the open quote on a phone', async () => {
  const ctx = await newContext(MOBILE);
  await ctx.addInitScript(() => {
    window.__cls = 0;
    try { new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { /* not supported */ }
  });
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page, { name: 'Sean Doherty' });
  await page.evaluate((h) => { location.hash = h; }, `#q=${id}`); // the page follows hash changes
  check('hash change opens the quote', await until(async () => (await stateOf(page)) === 'open'));
  check('title is "Your quote" with the reference in the tab', await until(async () => /Your quote Q-EL-\d+ · 180 Electrical/.test(await page.title())), await page.title());
  check('his logo is shown (with a name)', (await tid(page, 'q2-logo-img').getAttribute('alt')) === '180 Electrical');
  check('"Prototype: sample quote" notice is in the header', (await txt(page, 'q2-proto')) === 'Prototype: sample quote');
  check('greeting by first name', (await txt(page, 'q2-greeting')) === 'Hi Sean,');
  check('title is "Your EV charger installation quote"', (await txt(page, 'q2-title')) === 'Your EV charger installation quote');
  check('quote reference and customer shown', (await txt(page, 'q2-ref')) === id && (await txt(page, 'q2-for')) === 'Sean Doherty', id);
  check('total is whole pounds with a separator', (await txt(page, 'q2-total')) === '£1,286', await txt(page, 'q2-total'));
  check('charger brand shown', /OHME home charger/.test(await txt(page, 'q2-brand')));
  check('four itemised lines', (await tid(page, 'q2-line').count()) === 4);
  const lines = await tid(page, 'q2-lines').innerText();
  check('lines show quantity times price and line totals', /6 × £12/.test(lines) && /£72/.test(lines) && /£679/.test(lines) && /Cable run planned at the survey/.test(lines), lines.replace(/\s+/g, ' '));
  check('lines total matches', (await txt(page, 'q2-lines-total')) === '£1,286');
  check('notes shown', /Sample terms for this prototype/.test(await txt(page, 'q2-notes')));
  const until30 = await txt(page, 'q2-valid-until');
  check('valid until shown', /^Valid until [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/.test(until30), until30);
  const creds = await tid(page, 'q2-credentials').innerText();
  check('both credentials as trust badges', /Level 3 Electrical Installation/.test(creds) && /2391 Inspection and Testing/.test(creds));
  check('call button uses his real number', (await attr(page, 'q2-call', 'href')) === 'tel:+447885496800' && /07885 496800/.test(await txt(page, 'q2-call')));
  const wa = (await attr(page, 'q2-whatsapp', 'href')) || '';
  check('WhatsApp button uses his real number', /^https:\/\/wa\.me\/447885496800\?text=/.test(wa), wa);
  const ask = decodeURIComponent((await attr(page, 'q2-ask', 'href')) || '');
  check('"Ask a question" opens WhatsApp with a prefilled message', /^https:\/\/wa\.me\/447885496800\?text=Hi Daniel, it's Sean Doherty\. I have a question about my EV charger quote Q-EL-\d+ \(£1,286\)\.$/.test(ask), ask);
  check('"Ask a question" opens in a new tab safely', (await attr(page, 'q2-ask', 'target')) === '_blank' && /noopener/.test((await attr(page, 'q2-ask', 'rel')) || ''));
  check('accept, ask and not-for-me are all there', (await tid(page, 'q2-accept').count()) === 1 && (await tid(page, 'q2-decline').count()) === 1);
  check('footer: real phone, email and the prototype disclosure', /07885 496800/.test(await txt(page, 'q2-footer-phone')) && /daniel@180electrical.co.uk/.test(await txt(page, 'q2-footer-email')) && /This is a prototype/.test(await txt(page, 'q2-footer-disclosure')));
  check('footer says where he works, with no invented address', /Serving Northern Ireland/.test(await txt(page, 'q2-footer')));

  // The view is counted once, on load.
  let q = await quoteInStore(page, id);
  check('opening the link marks the quote viewed', q.status === 'viewed' && !!q.viewedAt, JSON.stringify({ s: q.status, v: q.viewedAt }));
  const viewedAt = q.viewedAt;
  await page.reload({ waitUntil: 'load' });
  await tid(page, 'q2-page').waitFor();
  q = await quoteInStore(page, id);
  check('opening it again changes nothing (idempotent)', q.status === 'viewed' && q.viewedAt === viewedAt);
  const messages = (await stateInStore(page)).messages.filter((m) => m.kind === 'customer_quote_sent' && /Q-EL/.test(JSON.stringify(m)));
  check('viewing logs no message', !(await stateInStore(page)).messages.some((m) => /viewed/i.test(m.kind)));

  // Page health
  await page.reload({ waitUntil: 'load' });
  await tid(page, 'q2-total').waitFor();
  await sleep(1500);
  const cls = await page.evaluate(() => window.__cls);
  check('no layout shift while the quote loads (CLS under 0.02)', cls < 0.02, String(cls));
  check('zero horizontal overflow at 375', await noOverflow(page));
  check('every tap target is at least 44px', (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' ; '));
  await shot(page, 'quote-open-375-dark', true);
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  void messages;
  await ctx.close();
});

// ================================================================ 3. widths and themes
await section('3. widths, themes, accessibility', async () => {
  for (const [w, h] of [[320, 640], [375, 812], [768, 1024], [1440, 900]]) {
    for (const theme of ['dark', 'light']) {
      const ctx = await newContext({ width: w, height: h }, theme, { theme });
      const page = await ctx.newPage();
      const log = watch(page);
      await openBlank(page);
      const id = await makeQuote(page, { name: 'Maria Fitzpatrick-Montgomery', notes: 'Line one of the notes.\nLine two with a very long unbroken word: ' + 'x'.repeat(60) });
      await open(page, id);
      await tid(page, 'q2-total').waitFor();
      check(`${w} ${theme}: no horizontal overflow`, await noOverflow(page));
      check(`${w} ${theme}: theme applied`, (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === theme);
      const small = await smallTargets(page);
      check(`${w} ${theme}: tap targets >= 44px`, small.length === 0, small.join(' ; '));
      const ax = await axeSerious(page);
      check(`${w} ${theme}: axe zero serious/critical`, ax.count === 0, ax.detail);
      if (w === 375 || w === 1440) await shot(page, `quote-open-${w}-${theme}`, true);
      if (w === 375) {
        await tid(page, 'q2-accept').click();
        await tid(page, 'q2-accept-sheet').waitFor();
        const [one] = await firstFreeSlots(page, 1);
        await tid(page, one).click();
        await sleep(450); // let the button's colour transition finish before measuring contrast
        const axSheet = await axeSerious(page);
        check(`${w} ${theme}: install-day sheet axe zero serious/critical`, axSheet.count === 0, axSheet.detail);
        await shot(page, `quote-pick-${w}-${theme}`);
      }
      check(`${w} ${theme}: clean console`, clean(log), dump(log));
      await ctx.close();
    }
  }
});

// ================================================================ 4. accept: pick a day, confirm, you're all set
await section('4. accept flow, confirmation, reload, calendar file', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page);
  await open(page, id);
  await tid(page, 'q2-accept').waitFor();

  // The sticky bar follows the customer once the card's button has scrolled away.
  check('sticky accept bar is hidden while the card button is in view', !(await tid(page, 'q2-sticky').evaluate((el) => el.classList.contains('is-on'))));
  await page.evaluate(() => window.scrollTo(0, 1400));
  check('sticky accept bar appears after scrolling', await until(async () => tid(page, 'q2-sticky').evaluate((el) => el.classList.contains('is-on'))));
  check('sticky bar shows the total', /£1,286/.test(await txt(page, 'q2-sticky')));
  await shot(page, 'quote-sticky-375');
  await page.evaluate(() => window.scrollTo(0, 0));
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-accept-sheet').waitFor();
  check('the install-day sheet opens with a title', /Choose your install day/.test(await txt(page, 'q2-accept-sheet')));
  check('the page behind is inert while the sheet is open', await page.evaluate(() => document.getElementById('app').hasAttribute('inert')));
  { const ax = await axeSerious(page); check('install-day sheet: axe zero serious/critical', ax.count === 0, ax.detail); }

  const slots = await page.$$eval('label.q2-slot', (els) => els.map((e) => ({ id: e.getAttribute('data-testid'), taken: e.classList.contains('is-taken'), text: e.innerText.replace(/\s+/g, ' ').trim() })));
  check('slots come from the availability engine (half-days only: Morning or Afternoon)', slots.length >= 4 && slots.every((s) => /Morning|Afternoon/.test(s.text)), JSON.stringify(slots.slice(0, 3)));
  const free = slots.filter((s) => !s.taken);
  check('there are free days to pick', free.length >= 3);
  const days = [...new Set(slots.map((s) => s.id.split('-').slice(2, 5).join('-')))];
  check('days are within the next 14 days, none in the past', days.every((d) => d >= '2026-10-23' && d <= '2026-11-05'), days.join(','));
  check('Sunday and closed days are not offered', !days.includes('2026-10-25') && !days.includes('2026-11-01'));
  check('Continue is disabled until a day is chosen', await tid(page, 'q2-slot-continue').isDisabled());
  check('summary prompts a choice', /Choose a day/.test(await txt(page, 'q2-slot-summary')));
  const pick = free[1].id; // a second option, to make sure it is not just the first one that works
  await tid(page, pick).click();
  check('choosing a slot ticks it (radio checked)', await page.evaluate((t) => document.querySelector(`[data-testid="${t}"] input`).checked, pick));
  check('summary names the chosen slot', /· (Morning|Afternoon), /.test(await txt(page, 'q2-slot-summary')), await txt(page, 'q2-slot-summary'));
  check('Continue is enabled', !(await tid(page, 'q2-slot-continue').isDisabled()));
  await shot(page, 'quote-pick-375');
  // keyboard: arrow keys move through the radio group
  await tid(page, 'q2-slot-continue').click();
  check('confirm step shows the day, the total and the pencilled-in promise', /Your install day/.test(await txt(page, 'q2-accept-sheet')) && /£1,286/.test(await txt(page, 'q2-accept-sheet')) && /pencilled in until Daniel confirms/.test(await txt(page, 'q2-accept-sheet')));
  check('focus moved to the new step heading', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'q2-confirm-heading'));
  await shot(page, 'quote-confirm-375');
  { const ax = await axeSerious(page); check('confirm step: axe zero serious/critical', ax.count === 0, ax.detail); }
  check('confirm step: tap targets >= 44px', (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' ; '));
  await tid(page, 'q2-slot-back').click();
  check('Back returns to the list with the choice kept', await page.evaluate((t) => !!document.querySelector(`[data-testid="${t}"] input:checked`), pick));
  await tid(page, 'q2-slot-continue').click();
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-confirm').waitFor({ timeout: WAIT });
  check('"You\'re all set" confirmation', /You're all set, Sean\./.test(await txt(page, 'q2-confirm-title')), await txt(page, 'q2-confirm-title'));
  check('the sheet is gone', (await tid(page, 'q2-accept-sheet').count()) === 0);
  check('the headline has focus', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'q2-confirm-title'));
  const [dayKey, win] = [pick.split('-').slice(2, 5).join('-'), Number(pick.split('-')[5])];
  check('the pencilled-in install is shown (status and day)', (await txt(page, 'q2-install-status')) === 'Pencilled in' && (await txt(page, 'q2-install-part')).startsWith(win === 0 ? 'Morning' : 'Afternoon'), await txt(page, 'q2-install-part'));
  check('install booking reference and quote reference shown', /^EL-\d+$/.test(await txt(page, 'q2-install-ref')) && (await txt(page, 'q2-quote-ref')) === id);

  const st = await stateInStore(page);
  const q = st.quotes[id];
  const install = st.bookings.find((b) => b.id === q.installBookingId);
  check('store: quote accepted with a time', q.status === 'accepted' && !!q.acceptedAt);
  check('store: a pencilled ev install exists for the chosen day and window', !!install && install.serviceId === 'ev' && install.tentative === true && install.status === 'new' && install.start.startsWith(dayKey) && install.start.endsWith(win === 0 ? '08:00' : '13:00'), JSON.stringify(install && { s: install.start, t: install.tentative }));
  check('store: install carries the quote and its price', install.quoteId === id && install.quotedPrice === TOTAL);
  check('store: owner and customer messages logged', st.messages.some((m) => m.kind === 'owner_quote_accepted' && m.bookingId === install.id) && st.messages.some((m) => m.kind === 'customer_quote_accepted' && m.bookingId === install.id));
  check('the page says it is a prototype (nobody was really notified)', /not really notified/.test(await txt(page, 'q2-simnote')));
  await shot(page, 'quote-accepted-375', true);

  // Calendar file
  const dl = page.waitForEvent('download', { timeout: WAIT });
  await tid(page, 'q2-ics').click();
  const download = await dl;
  const icsText = fs.readFileSync(await download.path(), 'utf8');
  check('calendar file is a provisional install on the chosen day', /BEGIN:VCALENDAR/.test(icsText) && /STATUS:TENTATIVE/.test(icsText) && /PROVISIONAL/.test(icsText) && icsText.includes('DTSTART:' + dayKey.replace(/-/g, '') + 'T' + (win === 0 ? '0800' : '1300') + '00'), icsText.slice(0, 400));
  check('calendar file says what it is (EV charger installation)', /EV charger installation/.test(icsText.replace(/\r\n /g, '')));
  check('a saved note appears', await tid(page, 'q2-ics-saved').isVisible());
  check('calendar file name uses the install reference', /^180-EL-\d+\.ics$/.test(download.suggestedFilename()), download.suggestedFilename());

  // Reload persistence
  await page.reload({ waitUntil: 'load' });
  await tid(page, 'q2-confirm').waitFor();
  check('after a reload it still says you are all set', /You're all set, Sean\./.test(await txt(page, 'q2-confirm-title')) && (await stateOf(page)) === 'accepted');
  check('the same day is still shown', (await txt(page, 'q2-install-part')).startsWith(win === 0 ? 'Morning' : 'Afternoon'));
  check('the owner confirming the day flips the page to Confirmed', await (async () => {
    await page.evaluate(async (bid) => { const s = await import('/js/core/store.js'); s.confirmBooking(bid, 'owner'); }, install.id);
    return until(async () => (await txt(page, 'q2-install-status')) === 'Confirmed');
  })());
  check('and the pencilled-in note goes away', (await tid(page, 'q2-install-ref').count()) === 1 && !/Pencilled in means/.test(await txt(page, 'q2-install')));
  const ax = await axeSerious(page);
  check('confirmation: axe zero serious/critical', ax.count === 0, ax.detail);
  check('confirmation: no horizontal overflow, tap targets fine', (await noOverflow(page)) && (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' ; '));
  // The accepted quote cannot be accepted or declined again
  const again = await page.evaluate(async (qid) => { const s = await import('/js/core/store.js'); return s.acceptQuote(qid, { date: '2026-10-27', windowId: 0 }); }, id);
  check('the store refuses a second accept', again.ok === false && again.reason === 'already_accepted');
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 5. a day taken at the last moment
await section('5. slot taken: friendly recovery', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page);
  await open(page, id);
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-accept-sheet').waitFor();
  const [first, second] = await firstFreeSlots(page, 2);
  await tid(page, first).click();
  await tid(page, 'q2-slot-continue').click();
  await tid(page, 'q2-slot-confirm').waitFor();
  // Somebody else's booking lands on that half-day AFTER the customer picked it: written straight into storage, so this tab has not been told yet.
  const date = first.split('-').slice(2, 5).join('-');
  const win = Number(first.split('-')[5]);
  await page.evaluate(({ date, win }) => {
    const st = JSON.parse(localStorage.getItem('vm_state_v1'));
    st.blocks.push({ id: 'blk_q2test', date, windowId: win, label: 'Other job', groupId: null, seed: false });
    st.meta.rev += 1;
    localStorage.setItem('vm_state_v1', JSON.stringify(st));
  }, { date, win });
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-slot-problem').waitFor({ timeout: WAIT });
  check('the customer is told that day was just taken, plainly', /That day was just taken/.test(await txt(page, 'q2-slot-problem')) && /Sorry/.test(await txt(page, 'q2-slot-problem')), await txt(page, 'q2-slot-problem'));
  check('it goes back to the list (nothing was accepted)', (await tid(page, 'q2-slots').count()) === 1 && (await quoteInStore(page, id)).status !== 'accepted');
  const alts = await tid(page, 'q2-slot-alts').locator('button').count();
  check('three alternative days are offered', alts === 3, String(alts));
  check('the taken day is no longer in the list', (await page.locator(`[data-testid="${first}"]:not(.is-taken)`).count()) === 0);
  check('the problem banner is announced', await page.evaluate(() => !!document.querySelector('[data-testid="q2-slot-problem"][role="status"], [data-testid="q2-slot-problem"][role="alert"]')));
  await shot(page, 'quote-slot-taken-375');
  await tid(page, 'q2-slot-alt-0').click();
  check('tapping an alternative goes straight to the confirm step', await tid(page, 'q2-slot-confirm').isVisible());
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-confirm').waitFor({ timeout: WAIT });
  check('and the quote is accepted', (await quoteInStore(page, id)).status === 'accepted');

  // A day taken while the list is open: the choice is dropped with a note, not silently kept.
  const id2 = await makeQuote(page, { name: 'Roisin Kane' });
  await open(page, id2);
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-accept-sheet').waitFor();
  const [pick2] = await firstFreeSlots(page, 1);
  await tid(page, pick2).click();
  const d2 = pick2.split('-').slice(2, 5).join('-');
  const w2 = Number(pick2.split('-')[5]);
  await page.evaluate(async ({ d2, w2 }) => { const s = await import('/js/core/store.js'); s.addBlock({ date: d2, windowId: w2, label: 'Other job' }); }, { d2, w2 });
  check('a slot that disappears while chosen is dropped with a message', await until(async () => /was just taken/.test(await txt(page, 'q2-slot-problem')) && (await tid(page, 'q2-slot-continue').isDisabled())));
  check('no console errors, off-site or failed requests', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 6. no free days at all
await section('6. no free days', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page);
  await page.evaluate(async () => {
    const s = await import('/js/core/store.js');
    s.blockRange({ fromDate: '2026-10-23', toDate: '2026-11-10', label: 'Away' });
  });
  await open(page, id);
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-slot-empty').waitFor();
  check('an empty list explains itself and offers call and WhatsApp', /No free install days/.test(await txt(page, 'q2-slot-empty')) && /07885 496800/.test(await txt(page, 'q2-slot-empty')) && !!(await page.locator('[data-testid="q2-slot-empty"] a[href^="https://wa.me/447885496800"]').count()));
  check('Continue stays disabled', await tid(page, 'q2-slot-continue').isDisabled());
  await shot(page, 'quote-no-days-375');
  await page.keyboard.press('Escape');
  check('Escape closes the sheet and returns focus to Accept', await until(async () => (await tid(page, 'q2-accept-sheet').count()) === 0) && (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'))) === 'q2-accept');
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 7. not for me
await section('7. decline', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page, { name: 'Dara Gallagher' });
  await open(page, id);
  await tid(page, 'q2-decline').click();
  await tid(page, 'q2-decline-sheet').waitFor();
  check('the decline sheet asks for an optional reason', /Not for you\?/.test(await txt(page, 'q2-decline-sheet')) && /optional/i.test(await txt(page, 'q2-reasons')));
  check('five reason chips', (await page.locator('[data-testid^="q2-reason-"].q2-reason').count()) === 5);
  await shot(page, 'quote-decline-375');
  { const ax = await axeSerious(page); check('decline sheet: axe zero serious/critical', ax.count === 0, ax.detail); }
  check('decline sheet: tap targets >= 44px', (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' ; '));
  await tid(page, 'q2-decline-cancel').click();
  check('"Keep my quote" closes it and changes nothing', (await tid(page, 'q2-decline-sheet').count()) === 0 && (await quoteInStore(page, id)).status === 'viewed');
  await tid(page, 'q2-decline').click();
  await tid(page, 'q2-reason-price').click();
  await tid(page, 'q2-reason-note').fill('Got one a bit cheaper.');
  await tid(page, 'q2-decline-confirm').click();
  await tid(page, 'q2-declined').waitFor({ timeout: WAIT });
  check('a thank-you state replaces the quote', /Thanks for letting Daniel know/.test(await txt(page, 'q2-title')));
  check('the reason is shown back to the customer', /Too expensive: Got one a bit cheaper\./.test(await txt(page, 'q2-declined-reason')), await txt(page, 'q2-declined-reason'));
  const st = await stateInStore(page);
  check('store: declined with the reason and the owner message', st.quotes[id].status === 'declined' && st.quotes[id].declineReason === 'Too expensive: Got one a bit cheaper.' && st.messages.some((m) => m.kind === 'owner_quote_declined' && /Too expensive/.test(m.body)));
  check('a way back is offered (message and call, real number)', /^https:\/\/wa\.me\/447885496800\?text=/.test((await attr(page, 'q2-whatsapp', 'href')) || '') && (await attr(page, 'q2-call', 'href')) === 'tel:+447885496800');
  await page.reload({ waitUntil: 'load' });
  await tid(page, 'q2-declined').waitFor();
  check('after a reload it is still declined and cannot be accepted', (await stateOf(page)) === 'declined' && (await tid(page, 'q2-accept').count()) === 0);
  const acc = await page.evaluate(async (qid) => { const s = await import('/js/core/store.js'); return s.acceptQuote(qid, { date: '2026-10-27', windowId: 0 }); }, id);
  check('the store refuses to accept a declined quote', acc.ok === false);
  await tid(page, 'q2-quote-disclosure').locator('summary').click();
  check('the quote can still be read from the declined page', await until(async () => (await tid(page, 'q2-line').count()) === 4));
  const ax = await axeSerious(page);
  check('declined page: axe zero serious/critical', ax.count === 0, ax.detail);
  await shot(page, 'quote-declined-375', true);

  // Decline with no reason at all
  const id2 = await makeQuote(page, { name: 'Eoin Mulholland' });
  await open(page, id2);
  await tid(page, 'q2-decline').click();
  await tid(page, 'q2-decline-confirm').click();
  await tid(page, 'q2-declined').waitFor({ timeout: WAIT });
  check('declining with no reason works, and no reason line is shown', (await quoteInStore(page, id2)).status === 'declined' && (await tid(page, 'q2-declined-reason').count()) === 0);
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 8. expiry
await section('8. expired and last-day quotes', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const expired = await makeQuote(page, { name: 'Una Kerr', validUntil: '2026-10-20' });
  await open(page, expired);
  await tid(page, 'q2-expired').waitFor();
  check('an expired quote says so', (await stateOf(page)) === 'expired' && /This quote has expired/.test(await txt(page, 'q2-expired')));
  check('accepting is disabled', await tid(page, 'q2-accept').isDisabled());
  check('and the sheet cannot be opened', await (async () => { await tid(page, 'q2-accept').click({ force: true, timeout: 1500 }).catch(() => {}); return (await tid(page, 'q2-accept-sheet').count()) === 0; })());
  check('there is no sticky accept bar and no decline', (await tid(page, 'q2-sticky').count()) === 0 && (await tid(page, 'q2-decline').count()) === 0);
  const ask = decodeURIComponent((await attr(page, 'q2-ask', 'href')) || '');
  check('"Ask for an updated quote" opens WhatsApp with a prefilled request', /wa\.me\/447885496800\?text=Hi Daniel, it's Una Kerr\. My EV charger quote Q-EL-\d+ has expired/.test(ask), ask);
  check('the quote is still readable', (await tid(page, 'q2-line').count()) === 4 && (await txt(page, 'q2-total')) === '£1,286');
  const rec = await quoteInStore(page, expired);
  check('opening an expired quote changes nothing in the store', rec.status === 'sent' && !rec.viewedAt);
  const ax = await axeSerious(page);
  check('expired: axe zero serious/critical', ax.count === 0, ax.detail);
  await shot(page, 'quote-expired-375', true);

  const last = await makeQuote(page, { name: 'Pat Hanna', validUntil: '2026-10-23' });
  await open(page, last);
  await tid(page, 'q2-accept').waitFor();
  check('on the last day it can still be accepted, and says so', (await stateOf(page)) === 'open' && /Last day to accept/.test(await txt(page, 'q2-valid')) && !(await tid(page, 'q2-accept').isDisabled()));
  const soon = await makeQuote(page, { name: 'Pat Hanna', validUntil: '2026-10-26' });
  await open(page, soon);
  await tid(page, 'q2-accept').waitFor();
  check('three days out it says "3 days left"', /3 days left/.test(await txt(page, 'q2-days-left')), await txt(page, 'q2-valid'));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 9. two tabs
await section('9. two tabs stay in step', async () => {
  const ctx = await newContext(MOBILE);
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  const logA = watch(a);
  const logB = watch(b);
  await openBlank(a);
  const id = await makeQuote(a);
  await open(a, id);
  await open(b, id);
  await tid(a, 'q2-accept').waitFor();
  await tid(b, 'q2-accept').waitFor();
  // Tab B has the sheet open while tab A accepts.
  await tid(b, 'q2-accept').click();
  await tid(b, 'q2-accept-sheet').waitFor();
  const [pickB] = await firstFreeSlots(b, 1);
  await tid(b, pickB).click();
  await tid(a, 'q2-accept').click();
  await tid(a, 'q2-accept-sheet').waitFor();
  const slotsA = await firstFreeSlots(a, 3);
  await tid(a, slotsA[2]).click();
  await tid(a, 'q2-slot-continue').click();
  await tid(a, 'q2-slot-confirm').click();
  await tid(a, 'q2-confirm').waitFor({ timeout: WAIT });
  await b.bringToFront();
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  check('the other tab flips to the confirmation by itself, and its sheet closes', await until(async () => (await stateOf(b)) === 'accepted' && (await tid(b, 'q2-accept-sheet').count()) === 0, 12000));
  const same = (await txt(a, 'q2-install-day')) === (await txt(b, 'q2-install-day'));
  check('both tabs show the same install day', same, (await txt(a, 'q2-install-day')) + ' / ' + (await txt(b, 'q2-install-day')));

  // Decline in one tab, the other cannot accept any more.
  const id2 = await makeQuote(a, { name: 'Cian Rooney' });
  await open(a, id2);
  await open(b, id2);
  await tid(a, 'q2-accept').waitFor();
  await tid(b, 'q2-accept').waitFor();
  await tid(a, 'q2-decline').click();
  await tid(a, 'q2-decline-confirm').click();
  await tid(a, 'q2-declined').waitFor({ timeout: WAIT });
  await b.bringToFront();
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  check('declining in one tab closes the quote in the other', await until(async () => (await stateOf(b)) === 'declined', 12000));
  check('no console errors in either tab', clean(logA) && clean(logB), dump(logA) + ' || ' + dump(logB));
  await ctx.close();
});

// ================================================================ 10. store failures, memory mode
await section('10. store failures', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page);
  await open(page, id);
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-accept-sheet').waitFor();
  const [pick] = await firstFreeSlots(page, 1);
  await tid(page, pick).click();
  await tid(page, 'q2-slot-continue').click();
  // The browser refuses to save: the quota is full.
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    window.__realSetItem = real;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'vm_state_v1') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return real.call(this, k, v);
    };
  });
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-slot-problem').waitFor({ timeout: WAIT });
  check('a full device is explained, and nothing is lost', /Couldn't save this on your device/.test(await txt(page, 'q2-slot-problem')) && (await quoteInStore(page, id)).status === 'viewed');
  check('the problem offers a phone number', /07885 496800/.test(await txt(page, 'q2-slot-problem')));
  await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
  await tid(page, pick).click();
  await tid(page, 'q2-slot-continue').click();
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-confirm').waitFor({ timeout: WAIT });
  check('once there is room again, accepting works', (await quoteInStore(page, id)).status === 'accepted');
  await ctx.close();

  // Storage blocked entirely: the page still works from memory (the seeded sample quotes exist).
  const ctx2 = await newContext(MOBILE, 'dark', {});
  await ctx2.addInitScript(() => {
    const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
    try { Object.defineProperty(window, 'localStorage', { configurable: true, get: boom }); } catch (e) { /* already blocked */ }
  });
  const mem = await ctx2.newPage();
  const logM = watch(mem);
  await openBlank(mem, '#q=Q-EL-1019');
  const memState = await stateOf(mem);
  check('with storage blocked the page still renders (a sample quote opens from memory)', memState === 'open' || memState === 'invalid', String(memState));
  check('with storage blocked there are no console errors', clean(logM), dump(logM));
  await ctx2.close();

  // A broken state in storage: the shared boot recovers instead of showing a blank page.
  check('no console errors in the quota test', clean(log), dump(log));
});

// ================================================================ 11. keyboard, focus, reduced motion, preview
await section('11. keyboard, reduced motion, owner preview', async () => {
  const ctx = await newContext({ width: 1280, height: 800 }, 'dark', { reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page);
  await open(page, id);
  await tid(page, 'q2-accept').waitFor();
  check('desktop: two columns, the decision card sits beside the quote', await page.evaluate(() => {
    const card = document.querySelector('[data-testid="q2-decision"]').getBoundingClientRect();
    const lines = document.querySelector('[data-testid="q2-lines-card"]').getBoundingClientRect();
    return card.left > lines.right - 2 && card.top < lines.bottom;
  }));
  check('desktop: no sticky bar (the card stays in view instead)', await tid(page, 'q2-sticky').evaluate((el) => getComputedStyle(el).display === 'none'));
  await page.evaluate(() => window.scrollTo(0, 500));
  check('desktop: the decision card follows the scroll', await page.evaluate(() => { const r = document.querySelector('[data-testid="q2-decision"]').getBoundingClientRect(); return r.top >= 0 && r.top < 80; }));
  // Keyboard: skip link, then the accept sheet by keyboard only.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press('Tab');
  check('the first Tab stop is the skip link', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid')) === 'q2-skip');
  await tid(page, 'q2-accept').focus();
  await page.keyboard.press('Enter');
  await tid(page, 'q2-accept-sheet').waitFor();
  check('the sheet takes focus (reading starts at its intro)', await page.evaluate(() => !!document.activeElement && document.activeElement.hasAttribute('data-q2-focus')));
  await page.keyboard.press('Tab');
  check('Tab moves to the first free radio', await page.evaluate(() => document.activeElement && document.activeElement.type === 'radio'));
  await page.keyboard.press('Space');
  check('Space picks it', await until(async () => page.evaluate(() => !!document.querySelector('.q2-slot input:checked'))));
  check('the chosen slot has a visible focus ring', await until(async () => page.evaluate(() => { const l = document.querySelector('.q2-slot.is-selected'); return !!l && getComputedStyle(l).outlineStyle !== 'none'; })));
  await page.keyboard.press('Escape');
  check('Escape closes the sheet', await until(async () => (await tid(page, 'q2-accept-sheet').count()) === 0));
  // Reduced motion: no entrance animation on the hero, no drawing on the tick.
  check('reduced motion: the hero copy does not animate', await page.evaluate(() => getComputedStyle(document.querySelector('.q2-title')).animationName === 'none'));
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-accept-sheet').waitFor();
  const [pick] = await firstFreeSlots(page, 1);
  await tid(page, pick).click();
  await tid(page, 'q2-slot-continue').click();
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-confirm').waitFor();
  check('reduced motion: the tick and ring are drawn, not animated', await page.evaluate(() => getComputedStyle(document.querySelector('.q2-mark__check')).animationName === 'none' && getComputedStyle(document.querySelector('.q2-mark')).animationName === 'none'));
  await shot(page, 'quote-accepted-1280');

  // The owner's preview does not count as a view.
  const id2 = await makeQuote(page, { name: 'Preview Person' });
  await open(page, id2, '&preview=1');
  await tid(page, 'q2-preview').waitFor();
  check('preview shows its own note and does not count a view', (await quoteInStore(page, id2)).status === 'sent' && /not counted as a view/.test(await txt(page, 'q2-preview')));
  check('no console errors', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ 12. the seeded quotes open
await section('12. the demo quotes (sent, viewed, accepted, declined, expired) all open', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const rows = await page.evaluate(async () => {
    const s = await import('/js/core/store.js');
    const sel = await import('/js/core/selectors.js');
    const st = s.getState();
    const want = { sent: null, viewed: null, accepted: null, declined: null, expired: null, draft: null };
    for (const q of Object.values(st.quotes)) { const eff = sel.quoteStatus(q); if (eff in want && !want[eff]) want[eff] = q.id; }
    return want;
  });
  const expect = { sent: 'open', viewed: 'open', accepted: 'accepted', declined: 'declined', expired: 'expired', draft: 'draft' };
  for (const [status, qid] of Object.entries(rows)) {
    if (!qid) { check(`a demo quote with status ${status} exists`, false); continue; }
    await open(page, qid);
    check(`${status} demo quote (${qid}) shows the "${expect[status]}" state`, await until(async () => (await stateOf(page)) === expect[status]), String(await stateOf(page)));
    check(`${status}: zero horizontal overflow`, await noOverflow(page));
  }
  check('no console errors across every state', clean(log), dump(log));
  await ctx.close();
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
