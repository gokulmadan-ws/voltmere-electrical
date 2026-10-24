// tests/e2e/quote-q2.mjs: end-to-end check of the customer quote page (quote.html#q=<quoteId> in the browser that holds the quote; quote.html#d=<payload>
// anywhere): every state, the accept flow with the real availability engine and its recovery paths, decline, view counting, reload, two tabs, store
// failures, themes, widths, accessibility, the calendar file, and (sections 13 to 15) LINK MODE: the quote opened from a v4 link on a phone that never
// held it, where Accept and Not for me end in a real WhatsApp message to the owner (wa.me is stubbed by the test; nothing is ever sent).
// Owner: Q2 (customer quote page), link mode by Q4. Self-contained: starts its own static server unless BASE_URL is set; creates its quotes through the store in the page.
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
    isMobile: vp.width < 600, hasTouch: vp.width < 600, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...rest
  });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('vm_theme_public', t); } catch (e) { /* blocked */ } }, theme);
  // His pictures live on two external hosts the sandbox cannot reach: every request to them is answered with a stand-in.
  await ctx.route((u) => IMG_HOSTS.has(u.hostname), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
  // wa.me is not reachable from the sandbox (and a test must never message anyone): a tab that opens WhatsApp lands on a stand-in page.
  await ctx.route((u) => u.hostname === 'wa.me', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp stand-in</title><p>WhatsApp stand-in</p>' }));
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
async function makeQuote(page, { name = 'Sean Doherty', send = true, validUntil = '', lines = LINES, brand = 'OHME', notes = 'The price covers the work listed above.' } = {}) {
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
    if (o.notes !== undefined && o.notes !== null) input.notes = o.notes;
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
// The picker is a strip of day chips with the two halves of the chosen day underneath: a slot is reached by choosing its day first.
const slotDay = (slot) => slot.split('-').slice(2, 5).join('-');
const slotWin = (slot) => Number(slot.split('-')[5]);
/** The first `n` free half-days (as the slot test ids), found by choosing each day chip in turn. */
async function firstFreeSlots(page, n = 3) {
  const chips = await page.$$eval('label.q2-chip', (els) => els.map((e) => e.getAttribute('data-testid')));
  const out = [];
  for (const chip of chips) {
    await tid(page, chip).click();
    const free = await page.$$eval('label.q2-slot:not(.is-taken)', (els) => els.map((e) => e.getAttribute('data-testid')));
    out.push(...free);
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}
/** Choose a slot found by firstFreeSlots: its day chip, then its half. */
async function pickSlot(page, slot) {
  await tid(page, `q2-day-${slotDay(slot)}`).click();
  await tid(page, slot).click();
}

// ================================================================ 1. the quiet states
await section('1. no quote: missing reference, unknown reference, draft', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  check('no hash gives the invalid state, in plain words', (await stateOf(page)) === 'invalid' && (await txt(page, 'q2-title')) === 'We could not open this quote', await txt(page, 'q2-title'));
  await openBlank(page, '#q=Q-NOPE-9');
  check('unknown id gives the same plain state', (await stateOf(page)) === 'invalid' && (await txt(page, 'q2-title')) === 'We could not open this quote', await txt(page, 'q2-title'));
  const body = await txt(page, 'q2-invalid');
  check('it speaks in customer words, in our voice: cut short, Call or WhatsApp us, we will send it again', /The link may have been cut short\. Call or WhatsApp us and we will send it again\./.test(body), body.slice(0, 240));
  check('no customer-visible "prototype" wording outside [data-proto]', await page.evaluate(() => {
    const clone = document.getElementById('app').cloneNode(true);
    clone.querySelectorAll('[data-proto], [data-testid="prototype-strip"]').forEach((n) => n.remove());
    return !/prototype/i.test(clone.textContent);
  }));
  check('the prototype explanation lives in its own data-proto card', (await tid(page, 'q2-demo').getAttribute('data-proto')) !== null && /kept in the browser that made them/.test(await txt(page, 'q2-demo')));
  check('Call is the primary button and WhatsApp the secondary one', await page.evaluate(() => document.querySelector('[data-testid="q2-call"]').classList.contains('ui-btn--primary') && document.querySelector('[data-testid="q2-whatsapp"]').classList.contains('ui-btn--secondary')));
  check('T06: "Visit 180 Electrical" is an ordinary underlined text link, flush left under the WhatsApp button (nothing on this page is centred)', await page.evaluate(() => {
    const home = document.querySelector('[data-testid="q2-home"]');
    const wa = document.querySelector('[data-testid="q2-whatsapp"]').getBoundingClientRect();
    const r = home.getBoundingClientRect();
    return home.tagName === 'A' && home.classList.contains('lp-link') && Math.abs(r.left - wa.left) <= 1 && r.top >= wa.bottom - 1 && r.width < wa.width * 0.8 && getComputedStyle(home, '::after').height === '1px' && r.height >= 43.5 && [...document.querySelectorAll('.q2-main *')].every((e) => getComputedStyle(e).textAlign !== 'center');
  }));
  check('WhatsApp is prefilled: "Hi Daniel, I cannot open my quote Q-NOPE-9."', decodeURIComponent((await attr(page, 'q2-whatsapp', 'href')) || '').endsWith('text=Hi Daniel, I cannot open my quote Q-NOPE-9.'), decodeURIComponent((await attr(page, 'q2-whatsapp', 'href')) || ''));
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
  check('D3: his logo picture is in the footer (decorative: the business name is printed in the link label) and the header', (await tid(page, 'q2-logo-img').evaluate((el) => !!el.closest('[data-testid="q2-footer"]') && el.getAttribute('alt') === '')) && (await tid(page, 'q2-header-logo-img').evaluate((el) => !!el.closest('[data-testid="q2-header"]'))));
  check('D3 header: HIS logo (the cropped lockup, 48px tall, 56px from 1024) is the brand: no bolt-in-a-square mark, "Quote for Sean" for screen readers, and Call', await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="q2-header"]');
    const logo = bar.querySelector('.q2-logo');
    const call = bar.querySelector('[data-testid="q2-top-call"]');
    const link = bar.querySelector('[data-testid="q2-logo"]');
    return !!logo && Math.round(logo.getBoundingClientRect().height) === (innerWidth >= 1024 ? 56 : 48) && !bar.querySelector('svg.ui-brandmark') && /^180 Electrical home page$/.test(link.getAttribute('aria-label'))
      && /^Quote for Sean$/.test(bar.querySelector('[data-testid="q2-for"]').textContent.trim()) && !!call && call.getBoundingClientRect().height >= 44;
  }));
  check('D3 header: the black bar is 64px (72 from 1024) with the logo centred in it, on one row with Call, and the bar is the logo\'s own near-black', await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="q2-header"]');
    const black = document.querySelector('.q2-bar');
    const logo = bar.querySelector('.q2-logo').getBoundingClientRect();
    const call = bar.querySelector('[data-testid="q2-top-call"]').getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return Math.abs(b.height - (innerWidth >= 1024 ? 72 : 64)) <= 1 && Math.abs((logo.top + logo.bottom) / 2 - (b.top + b.bottom) / 2) <= 1.5 && Math.abs((logo.top + logo.bottom) / 2 - (call.top + call.bottom) / 2) <= 3
      && getComputedStyle(black).backgroundColor === 'rgb(11, 11, 12)';
  }));
  check('D1/D4: the prototype strip (Prototype tools + "Show: With ideas | Only my content") sits above the header, is never data-proto, and is the only one', await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="prototype-strip"]');
    const bar = document.querySelector('[data-testid="q2-header"]');
    return !!strip && !strip.hasAttribute('data-proto') && strip.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1 && document.querySelectorAll('[data-testid="prototype-strip"]').length === 1
      && !!document.querySelector('[data-testid="prototype-tools"]') && !!document.querySelector('[data-testid="ideas-switch"]');
  }));
  check('T08: no Appearance / theme control on the customer page', !/Appearance/.test(await txt(page, 'q2-page')) && (await page.locator('[data-testid^="theme-"]').count()) === 0);
  check('T08: no dark-red arc beside the card (the hero ends in a straight edge)', await page.evaluate(() => getComputedStyle(document.querySelector('.q2-hero')).borderBottomLeftRadius === '0px' && getComputedStyle(document.querySelector('.q2-hero')).borderBottomRightRadius === '0px'));
  const pageText = await txt(page, 'q2-page');
  check('T02: no invented promises on the page (12-month, Fixed written, no hidden)', !/12-month|Fixed written|no hidden/i.test(pageText) && !/guarantee/i.test(pageText), pageText.match(/12-month|Fixed written|no hidden|guarantee/i) + '');
  check('T11: it speaks as "we": the visible text of the open quote never says "Daniel" (no "Call Daniel", no "Notes from Daniel", no "Daniel confirms")', !/Daniel/.test(pageText), (pageText.match(/.{0,30}Daniel.{0,30}/) || [''])[0]);
  check('T02: at 375 the first screen shows the total, Accept and the "Accepting takes no payment" line directly under Accept', await page.evaluate(() => {
    const r = (t) => document.querySelector(`[data-testid="${t}"]`).getBoundingClientRect();
    const accept = r('q2-accept');
    const nopay = r('q2-nopay');
    return r('q2-total').bottom < innerHeight && accept.bottom < innerHeight && nopay.bottom <= innerHeight && nopay.top >= accept.bottom && nopay.top - accept.bottom < 24;
  }), JSON.stringify(await page.evaluate(() => ['q2-total', 'q2-accept', 'q2-nopay'].map((t) => Math.round(document.querySelector(`[data-testid="${t}"]`).getBoundingClientRect().bottom)))));
  check('D1: the line under the button states no payment TERM ("pay after" is an idea): "Accepting takes no payment. We confirm your install day with you."', (await txt(page, 'q2-nopay')) === 'Accepting takes no payment. We confirm your install day with you.', await txt(page, 'q2-nopay'));
  check('greeting by first name', (await txt(page, 'q2-greeting')).toLowerCase() === 'hi sean,');
  check('title is "Your EV charger installation quote"', (await txt(page, 'q2-title')) === 'Your EV charger installation quote');
  check('quote reference and customer shown', (await txt(page, 'q2-ref')) === id && (await txt(page, 'q2-for')) === 'Quote for Sean', id);
  check('total is whole pounds with a separator', (await txt(page, 'q2-total')) === '£1,286', await txt(page, 'q2-total'));
  check('charger brand shown', /OHME home charger/.test(await txt(page, 'q2-brand')));
  check('four itemised lines', (await tid(page, 'q2-line').count()) === 4);
  const lines = await tid(page, 'q2-lines').innerText();
  check('lines show quantity times price and line totals', /6 × £12/.test(lines) && /£72/.test(lines) && /£679/.test(lines) && /Cable run planned at the survey/.test(lines), lines.replace(/\s+/g, ' '));
  check('lines total matches', (await txt(page, 'q2-lines-total')) === '£1,286');
  check('notes shown, without the developer placeholder sentence', /The price covers the work listed above/.test(await txt(page, 'q2-notes')) && !/to be replaced/i.test(await txt(page, 'q2-page')), await txt(page, 'q2-notes'));
  // T09: it reads as a proposal, not a receipt
  check('D1: the decision card names the charger (the brand he chose) and carries NO spec line, no kW and no picture of ours', /OHME home charger/.test(await txt(page, 'q2-product')) && (await tid(page, 'q2-spec').count()) === 0 && (await tid(page, 'q2-thumb-img').count()) === 0 && !/\bkW\b|smart|solar|schedul/i.test(await txt(page, 'q2-decision')), await txt(page, 'q2-decision'));
  check('D1: nothing on the page states a product spec of ours (no kW, no "smart", no "solar")', !/\bkW\b|smart charger|solar/i.test(await txt(page, 'q2-page')), (await txt(page, 'q2-page')).match(/\bkW\b|smart charger|solar/i) + '');
  check('T12: the tick list under the total is gone (no "A written quote", no "Itemised, line by line", no q2-summary)', (await tid(page, 'q2-summary').count()) === 0 && !/A written quote|Itemised, line by line/.test(await txt(page, 'q2-page')));
  check('T12: the first screen goes total, product line, then the red button with nothing between them but the sample signature and the jump link', await page.evaluate(() => {
    const r = (t) => document.querySelector(`[data-testid="${t}"]`).getBoundingClientRect();
    const card = document.querySelector('[data-testid="q2-decision"]');
    const between = [...card.children].filter((c) => c.getBoundingClientRect().top >= r('q2-product').bottom - 1 && c.getBoundingClientRect().bottom <= r('q2-accept').top + 1 && c.contains(document.querySelector('[data-testid="q2-accept"]')) === false).map((c) => c.getAttribute('data-testid') || c.className);
    return r('q2-total').bottom < innerHeight && r('q2-product').bottom < r('q2-accept').top && r('q2-accept').bottom < innerHeight && between.every((b) => /q2-sample|q2-seeall|q2-see-breakdown/.test(b));
  }), await page.evaluate(() => JSON.stringify(['q2-total', 'q2-product', 'q2-accept'].map((t) => Math.round(document.querySelector(`[data-testid="${t}"]`).getBoundingClientRect().bottom)))));
  check('T12: "Valid until" is the fourth fact in the Quote / Quoted / Postcode row, and it appears once on the page body (the sticky bar keeps its own single value)', await page.evaluate(() => {
    const facts = [...document.querySelectorAll('.q2-meta li .q2-meta__k')].map((e) => e.textContent.trim());
    const clone = document.getElementById('app').cloneNode(true);
    clone.querySelectorAll('[data-testid="q2-sticky"], [data-testid="prototype-strip"]').forEach((n) => n.remove());
    return facts.join('|') === 'Quote|Quoted|Postcode|Valid until' && (clone.textContent.match(/valid until/gi) || []).length === 1 && (document.querySelector('[data-testid="q2-sticky"]').textContent.match(/valid until/gi) || []).length === 1;
  }), await page.evaluate(() => [...document.querySelectorAll('.q2-meta li .q2-meta__k')].map((e) => e.textContent.trim()).join('|')));
  check('the total and the facts come before the line items', await page.evaluate(() => { const y = (t) => document.querySelector(`[data-testid="${t}"]`).getBoundingClientRect().top; return y('q2-total') < y('q2-lines-card') && y('q2-fixed') < y('q2-lines-card'); }));
  check('the total is shown at most twice on the page (card and table)', (await page.evaluate(() => document.getElementById('app').textContent.split('£1,286').length - 1)) <= 2, String(await page.evaluate(() => document.getElementById('app').textContent.split('£1,286').length - 1)));
  check('"Not for me" is a small grey underlined link below the card, not a button inside it', await page.evaluate(() => {
    const el = document.querySelector('[data-testid="q2-decline"]');
    const cs = getComputedStyle(el);
    const [r, g, b] = cs.color.match(/\d+/g).map(Number);
    return !el.closest('[data-testid="q2-decision"]') && el.classList.contains('lp-link') && parseFloat(getComputedStyle(el, '::after').height) === 1 && parseFloat(cs.fontSize) <= 15 && Math.max(r, g, b) - Math.min(r, g, b) < 24
      && el.getBoundingClientRect().top >= document.querySelector('[data-testid="q2-decision"]').getBoundingClientRect().bottom;
  }));
  check('T08: the terms are a tagged IDEA headed "Terms" (dashed rule, data-proto, the visible "Idea from us, not on your site today" tag), with no "(Daniel sets these)", no repeated "Example:", no guarantee row, no payment methods', (await tid(page, 'q2-terms').getAttribute('data-proto')) !== null && /^Terms$/.test(await page.locator('#q2-terms-h').innerText()) && /Idea from us, not on your site today/.test(await txt(page, 'q2-terms-tag')) && !/Daniel|Example|Sample terms/.test(await txt(page, 'q2-terms')) && !/guarantee|card, bank|cash/i.test(await txt(page, 'q2-terms')) && (await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="q2-terms"]')).borderTopStyle)) === 'dashed');
  check('T08: below the total there is exactly ONE display-size heading ("What\'s included", the landing H2 size: 30px at 390), "Accredited and qualified" is the 13px label, and the other headings are the 20px title voice with no ink rule above them', await page.evaluate(() => {
    const hs = [...document.querySelectorAll('.q2-main h2')].filter((h) => h.getBoundingClientRect().width > 0 && !h.classList.contains('u-sr-only'));
    const big = hs.filter((h) => parseFloat(getComputedStyle(h).fontSize) >= 28);
    const trust = document.querySelector('#q2-trust-h');
    const title = (id) => { const h = document.querySelector(id); const cs = getComputedStyle(h); const rule = getComputedStyle(h.closest('section')); return parseFloat(cs.fontSize) === 20 && cs.fontWeight === '600' && rule.borderTopColor !== 'rgb(11, 11, 12)'; };
    return big.length === 1 && big[0].id === 'q2-lines-h' && parseFloat(getComputedStyle(big[0]).fontSize) === 30 && getComputedStyle(trust).fontSize === '13px' && getComputedStyle(trust).textTransform === 'uppercase' && trust.innerText.trim() === 'ACCREDITED AND QUALIFIED' && title('#q2-steps-h') && title('#q2-contact-h') && title('#q2-notes-h') && title('#q2-terms-h');
  }), await page.evaluate(() => [...document.querySelectorAll('.q2-main h2')].map((h) => h.id + ':' + getComputedStyle(h).fontSize).join(' ')));
  check('T08: body copy is 17px or larger at 390 (notes, steps, the contact line, the credentials, the line items, the note under the button) and neither "(Daniel sets these)" nor "Example:" appears anywhere', await page.evaluate(() => {
    const sizes = ['.q2-notes__text', '.q2-step__text', '.q2-contact__intro', '.q2-badge__text', '.q2-line__label', '.q2-nopay', '.q2-product__name', '.q2-facts li'].map((s) => [s, parseFloat(getComputedStyle(document.querySelector(s)).fontSize)]);
    return sizes.every(([, px]) => px >= 17) && !/\(Daniel sets these\)|Example:/.test(document.getElementById('app').innerText);
  }), await page.evaluate(() => JSON.stringify(['.q2-notes__text', '.q2-step__text', '.q2-contact__intro', '.q2-badge__text', '.q2-line__label', '.q2-nopay'].map((s) => getComputedStyle(document.querySelector(s)).fontSize))));
  check('T13: before the confirm sheet no button on the page reads "Accept quote": the card button and the sticky button both say "Choose install day"', (await txt(page, 'q2-accept')) === 'Choose install day' && (await tid(page, 'q2-accept-sticky').evaluate((e) => e.textContent.trim())) === 'Choose install day' && !(await page.evaluate(() => [...document.querySelectorAll('#app button, #app a')].some((b) => /^Accept quote$/.test(b.textContent.trim())))));
  check('D1: outside tagged ideas the page states no payment term, no "pay after", no guarantee and no spec', await page.evaluate(() => {
    const clone = document.getElementById('app').cloneNode(true);
    clone.querySelectorAll('[data-proto], [data-testid="prototype-strip"]').forEach((n) => n.remove());
    return !/pay after|pay on|due when|deposit|guarantee|warranty|certificate issued|\bkW\b/i.test(clone.textContent);
  }));
  check('the top bar says "Call us" and carries his real number (T11: it does not name him)', (await txt(page, 'q2-owner-name')) === 'us' && (await txt(page, 'q2-top-call')) === 'Call us' && (await attr(page, 'q2-top-call', 'href')) === 'tel:+447885496800' && /Call us on 07885 496800/.test((await attr(page, 'q2-top-call', 'aria-label')) || ''));
  check('the quote date and installation postcode are shown', /^Quoted Fri 23 Oct$/i.test(await txt(page, 'q2-quote-date')) && /BT9 6QP/.test(await txt(page, 'q2-postcode')), (await txt(page, 'q2-quote-date')) + ' | ' + (await txt(page, 'q2-postcode')));
  await tid(page, 'q2-see-breakdown').click();
  check('T12: "See full breakdown" is a plain jump link (an anchor to the one "What\'s included" table, no disclosure, no second copy) and scrolls there without changing the address', await until(async () => page.evaluate(() => { const r = document.querySelector('[data-testid="q2-lines-card"]').getBoundingClientRect(); return r.top >= 0 && r.top < 200; })) && /^#(q=|d=)/.test(await page.evaluate(() => location.hash)) && await page.evaluate(() => { const a = document.querySelector('[data-testid="q2-see-breakdown"]'); return a.tagName === 'A' && a.getAttribute('href') === '#q2-lines-card' && !a.hasAttribute('aria-expanded') && document.querySelectorAll('[data-testid="q2-lines-card"]').length === 1 && document.querySelectorAll('[data-testid="q2-lines"]').length === 1; }), await page.evaluate(() => location.hash));
  await page.evaluate(() => window.scrollTo(0, 0));
  const until30 = await txt(page, 'q2-valid-until');
  check('valid until shown (the fact in the row under the title)', /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/.test(until30), until30);
  const creds = (await tid(page, 'q2-credentials').innerText()).replace(/\s+/g, ' ');
  check('both credentials as type: the figure in the logo voice, the descriptor beside it, and the text reads exactly as his', /Level 3 Electrical Installation/.test(creds) && /2391 Inspection and Testing/.test(creds) && (await page.locator('[data-testid="q2-credentials"] .lp-logovoice').count()) === 2
    && (await page.$$eval('[data-testid="q2-credentials"] .q2-badge', (els) => els.map((e) => e.textContent.trim()))).join('|') === 'Level 3 Electrical Installation|2391 Inspection and Testing');
  check('call button uses his real number', (await attr(page, 'q2-call', 'href')) === 'tel:+447885496800' && /07885 496800/.test(await txt(page, 'q2-call')));
  const wa = (await attr(page, 'q2-whatsapp', 'href')) || '';
  check('WhatsApp button uses his real number', /^https:\/\/wa\.me\/447885496800\?text=/.test(wa), wa);
  const ask = decodeURIComponent((await attr(page, 'q2-ask', 'href')) || '');
  check('"Ask a question" opens WhatsApp with a prefilled message', /^https:\/\/wa\.me\/447885496800\?text=Hi Daniel, it's Sean Doherty\. I have a question about my EV charger quote Q-EL-\d+ \(£1,286\)\.$/.test(ask), ask);
  check('"Ask a question" opens in a new tab safely', (await attr(page, 'q2-ask', 'target')) === '_blank' && /noopener/.test((await attr(page, 'q2-ask', 'rel')) || ''));
  check('accept, ask and not-for-me are all there', (await tid(page, 'q2-accept').count()) === 1 && (await tid(page, 'q2-decline').count()) === 1);
  check('D4 footer: the black ground and the landing\'s keyed rows (Phone, Email, Area), his logo, real phone, real email, "Serving Northern Ireland", a small copyright line, no credentials line (they are in the Accredited section) and no stripes', /07885 496800/.test(await txt(page, 'q2-footer-phone')) && /daniel@180electrical.co.uk/.test(await txt(page, 'q2-footer-email')) && /Serving Northern Ireland/.test(await txt(page, 'q2-footer')) && /^© 2026 180 Electrical$/.test(await txt(page, 'q2-footer-copyright'))
    && (await page.$$eval('[data-testid="q2-footer"] dt', (els) => els.map((e) => e.textContent.trim()))).join('|') === 'Phone|Email|Area' && (await tid(page, 'q2-footer-credentials').count()) === 0
    && (await page.evaluate(() => { const f = document.querySelector('[data-testid="q2-footer"]'); return getComputedStyle(f).backgroundColor === 'rgb(11, 11, 12)' && getComputedStyle(f, '::after').content === 'none' && getComputedStyle(f, '::before').content === 'none'; })), await txt(page, 'q2-footer'));
  check('D4 footer: no owner login, no "What\'s real", no theme switch, no disclosure, no link cloud', !/Owner login|What's real|Light|Dark|Auto|This is a prototype|On this page/.test(await txt(page, 'q2-footer')) && (await page.locator('[data-testid="q2-footer"] [data-testid^="theme-"]').count()) === 0);
  await tid(page, 'prototype-tools').click();
  check('D4: the Prototype tools popover (from the strip) holds the disclosure, the owner login, what\'s real and the theme', await until(async () => /This is a prototype/.test(await txt(page, 'footer-disclosure'))) && /Owner login \(demo\)/.test(await txt(page, 'prototype-tools-panel')) && /What's real in this prototype/.test(await txt(page, 'prototype-tools-panel')) && /appearance/i.test(await txt(page, 'prototype-tools-panel')));
  await tid(page, 'prototype-tools-close').click();
  check('the footer shows no invented street address', !/\d+ [A-Z][a-z]+ (Road|Street|Avenue|Lane)/.test(await txt(page, 'q2-footer')));

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

// ================================================================ 2b. one system with the landing page and the funnel (LANDING-V5 section 10)
await section('2b. the quote page is one system with the landing page and the funnel: light by default, square and flat, red only on the one primary button, a ruled table for the lines', async () => {
  const ctx = await newContext(MOBILE, 'dark'); // a phone in dark mode: the public pages still open light
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page, { name: 'Sean Doherty' });
  await open(page, id);
  await tid(page, 'q2-total').waitFor();
  check('empty storage and a dark-mode phone: the page is LIGHT (data-scope public, data-theme light, the paper background)', await page.evaluate(() => document.documentElement.getAttribute('data-scope') === 'public' && document.documentElement.getAttribute('data-theme') === 'light' && getComputedStyle(document.body).backgroundColor === 'rgb(245, 245, 244)'));
  check('the title is the display voice (Archivo, width 108, weight 650, -0.03em) in solid ink, and the page uses one family', await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('[data-testid="q2-title"]'));
    const fam = new Set([...document.querySelectorAll('#app *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => getComputedStyle(e).fontFamily.split(',')[0].trim().replace(/['"]/g, '')));
    return /Archivo/.test(t.fontFamily) && t.fontStretch === '108%' && t.fontWeight === '650' && parseFloat(t.letterSpacing) < 0 && t.color === 'rgb(11, 11, 12)' && [...fam].every((f) => /^Archivo/.test(f));
  }));
  check('the bar and the footer are the logo\'s near-black; the hero between them is flat paper', await page.evaluate(() => {
    const bar = getComputedStyle(document.querySelector('.q2-bar')).backgroundColor;
    const foot = getComputedStyle(document.querySelector('[data-testid="q2-footer"]')).backgroundColor;
    const hero = getComputedStyle(document.querySelector('.q2-hero')).backgroundColor;
    return bar === 'rgb(11, 11, 12)' && foot === 'rgb(11, 11, 12)' && hero === 'rgb(245, 245, 244)';
  }));
  const flat = await page.evaluate(() => {
    const bad = { radius: [], shadow: [], gradient: [], heavy: [], bolt: 0 };
    for (const el of document.querySelectorAll('#app *')) {
      const cs = getComputedStyle(el);
      if (el.closest('[data-testid="prototype-strip"]')) continue; // the strip is the landing's own skin
      if (cs.display === 'none') continue;
      const tag = (el.getAttribute('data-testid') || el.className || el.tagName).toString().slice(0, 40);
      if (/[1-9]/.test(cs.borderTopLeftRadius + cs.borderBottomRightRadius)) bad.radius.push(tag + ' ' + cs.borderTopLeftRadius);
      if (cs.boxShadow !== 'none' && !/^rgba?\([^)]*\) (0px 0px 0px 1px( inset)?|0px 1px 0px 0px|0px 0px 0px 2px inset|inset 0px 0px 0px (1|2)px)$/.test(cs.boxShadow) && !/^rgb[a]?\([^)]*\) 0px 0px 0px (1|2)px( inset)?$/.test(cs.boxShadow)) bad.shadow.push(tag + ' ' + cs.boxShadow);
      if (/gradient/.test(cs.backgroundImage)) bad.gradient.push(tag);
      if (parseInt(cs.fontWeight, 10) >= 800 && !el.classList.contains('lp-logovoice') && !el.closest('.lp-logovoice') && !el.closest('.u-sr-only') && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) bad.heavy.push(tag + ' ' + cs.fontWeight);
    }
    bad.bolt = document.querySelectorAll('.ui-brandmark, [class*="bolt"], [class*="wiring"]').length;
    return bad;
  });
  check('no rounded corner, no shadow beyond a 1px hairline, no gradient, no weight 800 outside the logo voice, no bolt anywhere on the page', flat.radius.length === 0 && flat.shadow.length === 0 && flat.gradient.length === 0 && flat.heavy.length === 0 && flat.bolt === 0, JSON.stringify(flat));
  const lines = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="q2-line"]')];
    const amt = rows.map((r) => getComputedStyle(r.querySelector('.q2-line__amt')));
    const head = document.querySelector('.q2-lines__head');
    const sum = getComputedStyle(document.querySelector('[data-testid="q2-lines-total"]'));
    const first = rows[0].getBoundingClientRect();
    const right = rows.map((r) => Math.round(r.querySelector('.q2-line__total').getBoundingClientRect().right));
    return { n: rows.length, tab: amt.every((a) => /tabular-nums/.test(a.fontVariantNumeric)), right: new Set(right).size === 1, head: !!head && head.getAttribute('aria-hidden') === 'true' && /No\.\s*Line\s*Amount/i.test(head.textContent), nums: rows.map((r) => r.querySelector('.q2-line__n').textContent.trim()).join(','), rule: getComputedStyle(rows[1]).borderTopWidth + ' ' + getComputedStyle(rows[1]).borderTopStyle, sumStretch: sum.fontStretch, sumWeight: sum.fontWeight, bg: getComputedStyle(rows[0]).backgroundColor, first: first.width > 200 };
  });
  check('the lines are a ruled table: a No. / Line / Amount header, numbered rows split by 1px hairlines, the amounts right-aligned in one column in tabular figures, and the sum in the display voice', lines.n === 4 && lines.tab && lines.right && lines.head && lines.nums === '01,02,03,04' && lines.rule === '1px solid' && lines.sumStretch === '108%' && lines.sumWeight === '650' && lines.bg === 'rgba(0, 0, 0, 0)', JSON.stringify(lines));
  // red is the one primary button: never two at a time, at any scroll stop
  const reds = [];
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (const y of [0, 500, 1000, 1500, 2200, 3000, height]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await sleep(350);
    reds.push(await page.evaluate(() => [...document.querySelectorAll('a, button')].filter((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return cs.backgroundColor === 'rgb(225, 20, 20)' && cs.visibility !== 'hidden' && r.width > 0 && r.bottom > 0 && r.top < innerHeight && !b.closest('[inert]'); }).map((b) => b.getAttribute('data-testid'))));
  }
  check('at most ONE red button is on screen at every scroll stop (Accept in the card, or Accept in the sticky bar once the card has gone)', reds.every((r) => r.length <= 1) && reds.some((r) => r.length === 1), JSON.stringify(reds));
  await page.evaluate(() => window.scrollTo(0, 0));
  const red = await page.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('#app *')) { const cs = getComputedStyle(el); if (cs.display === 'none') continue; const isBtn = el.matches('.ui-btn--primary, .ui-btn--primary *'); const txt = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!isBtn && txt && cs.color === 'rgb(225, 20, 20)') bad.push(el.className); if (!isBtn && cs.backgroundColor === 'rgb(225, 20, 20)' && !el.matches('.q2-chip')) bad.push('bg:' + el.className); } return bad; });
  check('red never appears as text or as a fill outside the primary button', red.length === 0, JSON.stringify(red));
  { const css = fs.readFileSync(path.join(SITE_ROOT, 'css/quote.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = css.split('\n').filter((l) => /var\(--(err|red)\b/.test(l) && !/\.ui-field__error|\.ui-btn--primary/.test(l));
    check('T06: css/quote.css uses --err only for field errors and --red only for the primary button (no red or --err text, rule or fill anywhere else)', bad.length === 0, bad.join(' | ')); }
  check('no console errors, off-site or failed requests', clean(log), dump(log));
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
        await pickSlot(page, one);
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
  check('sticky accept bar is OPAQUE (a solid background, no blur): no text ghosts through it', await tid(page, 'q2-sticky').evaluate((el) => { const cs = getComputedStyle(el); const m = cs.backgroundColor.match(/[\d.]+/g).map(Number); return (m.length === 3 || m[3] === 1) && (!cs.backdropFilter || cs.backdropFilter === 'none'); }), await tid(page, 'q2-sticky').evaluate((el) => getComputedStyle(el).backgroundColor + ' ' + getComputedStyle(el).backdropFilter));
  check('sticky bar shows how long the quote is valid, not the price a third time', /valid until/i.test(await txt(page, 'q2-sticky')) && !/£/.test(await txt(page, 'q2-sticky')), await txt(page, 'q2-sticky'));
  await shot(page, 'quote-sticky-375');
  await page.evaluate(() => window.scrollTo(0, 0));
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-accept-sheet').waitFor();
  check('the install-day sheet opens with a title', /Choose your install day/.test(await txt(page, 'q2-accept-sheet')));
  check('the page behind is inert while the sheet is open', await page.evaluate(() => document.getElementById('app').hasAttribute('inert')));
  const chrome = () => page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="q2-accept-sheet"]');
    const top = sheet.getBoundingClientRect().top;
    const bar = sheet.querySelector('.q2-sheetbar__bar').getBoundingClientRect();
    const close = sheet.querySelector('[data-testid="sheet-close"]').getBoundingClientRect();
    const step = sheet.querySelector('[data-testid="q2-sheet-step"]');
    return { bar: [Math.round(bar.top - top), Math.round(bar.height), Math.round(bar.width)], close: [Math.round(close.left), Math.round(close.top - top), Math.round(close.width), Math.round(close.height)], step: step ? step.innerText.trim() : '' };
  });
  const chrome1 = await chrome();
  check('T13: the sheet is headed in the funnel\'s chrome: a black bar with his logo and "Close" as an underlined word (no X glyph, no icon button), then "STEP 1 OF 2" in the label voice and the title', await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="q2-accept-sheet"]');
    const bar = sheet.querySelector('.q2-sheetbar__bar');
    const close = sheet.querySelector('[data-testid="sheet-close"]');
    const step = sheet.querySelector('[data-testid="q2-sheet-step"]');
    return getComputedStyle(bar).backgroundColor === 'rgb(11, 11, 12)' && !!bar.querySelector('.q2-logo') && close.innerText.trim() === 'Close' && getComputedStyle(close.querySelector('span')).textDecorationLine === 'underline' && getComputedStyle(close).fontSize === '14px' && !close.querySelector('svg') && !sheet.querySelector('.ui-icon-btn, .ui-sheet__close')
      && /^STEP 1 OF 2$/.test(step.innerText.trim()) && getComputedStyle(step).fontSize === '13px' && getComputedStyle(step).textTransform === 'uppercase' && /Choose your install day/.test(sheet.querySelector('.q2-sheetbar__title').textContent) && sheet.querySelector('h2.u-sr-only').textContent === 'Choose your install day'
      && close.getBoundingClientRect().height >= 43.5 && close.getBoundingClientRect().width >= 43.5;
  }), JSON.stringify(chrome1));
  check('T13: the day sheet has ONE intro sentence, no legend paragraph, no "Tap a day above" line, no black numeral squares, and a plain Free / Booked key', await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="q2-accept-sheet"]');
    const lead = sheet.querySelector('.q2-sheet__lead').textContent.trim();
    const key = sheet.querySelector('[data-testid="q2-key"]');
    return (lead.match(/[.!?](\s|$)/g) || []).length === 1 && !sheet.querySelector('.q2-sheet__small, .q2-slots__hint, .q2-pickstep__n') && !/AM is morning|crossed-out|Tap a day above|Showing the next two weeks/.test(sheet.innerText) && !!key && /Free/.test(key.textContent) && /Booked/.test(key.textContent) && key.querySelector('.is-booked') !== null && getComputedStyle(key.querySelector('.is-booked')).textDecorationLine === 'line-through';
  }));
  check('T13: "Soonest available" is a ruled row (a rule above and below, no box, no fill) and there is no checkbox anywhere in the sheet', await page.evaluate(() => {
    const row = document.querySelector('[data-testid="q2-soonest"]');
    const cs = getComputedStyle(row);
    return cs.boxShadow === 'none' && cs.borderTopWidth === '1px' && cs.borderTopColor === 'rgb(11, 11, 12)' && cs.borderBottomWidth === '1px' && cs.borderLeftWidth === '0px' && cs.borderRightWidth === '0px' && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && !document.querySelector('[data-testid="q2-accept-sheet"] input[type="checkbox"]');
  }));
  await sleep(450); // let the sheet's slide-in finish before measuring contrast
  { const ax = await axeSerious(page); check('install-day sheet: axe zero serious/critical', ax.count === 0, ax.detail); }

  // T09: the picker is one strip of day chips, with both halves of the chosen day as full-width buttons underneath.
  const chips = await page.$$eval('label.q2-chip', (els) => els.map((e) => ({ id: e.getAttribute('data-testid').slice('q2-day-'.length), top: Math.round(e.getBoundingClientRect().top), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })));
  const days = chips.map((c) => c.id);
  check('every free day is a chip in ONE horizontal strip (same row, scrollable)', chips.length >= 4 && chips.every((c) => c.top === chips[0].top) && (await page.evaluate(() => { const s = document.querySelector('[data-testid="q2-strip"]'); return getComputedStyle(s).overflowX === 'auto' || getComputedStyle(s).overflowX === 'scroll'; })), JSON.stringify(chips.slice(0, 3)));
  check('day chips are at least 44px in both directions', chips.every((c) => c.h >= 44 && c.w >= 44));
  check('T13: each month is named by a HORIZONTAL line above its own days (October, November), not rotated', await page.evaluate(() => { const m = [...document.querySelectorAll('.q2-strip__month')]; return m.map((e) => e.textContent).join(',') === 'October,November' && m.every((e) => getComputedStyle(e).writingMode === 'horizontal-tb' && !/rotate|matrix\(-1/.test(getComputedStyle(e).transform) && e.getBoundingClientRect().bottom <= e.closest('.q2-strip__group').querySelector('.q2-chip').getBoundingClientRect().top + 1); }));
  check('days are within the next 14 days, none in the past', days.every((d) => d >= '2026-10-23' && d <= '2026-11-05'), days.join(','));
  check('Sunday and closed days are not offered', !days.includes('2026-10-25') && !days.includes('2026-11-01'));
  // Nothing looks chosen until the customer chooses: no day is pre-selected, so no chip (and no half) wears the selected look.
  check('UX: on opening nothing is chosen: no chip is selected, no half is shown, "Soonest" is not pressed, Continue is off', await page.evaluate(() => !document.querySelector('.q2-chip.is-viewed') && !document.querySelector('.q2-chip.is-picked') && !document.querySelector('label.q2-slot') && !document.querySelector('.q2-soonest.is-selected')) && (await attr(page, 'q2-soonest', 'aria-pressed')) === 'false' && await tid(page, 'q2-slot-continue').isDisabled());
  check('UX: the helper text names exactly what is missing: "Choose a day" (the label above the strip says it too), and there is no "Tap a day above" line', (await txt(page, 'q2-slot-summary')) === 'Choose a day' && /Choose a day/i.test(await txt(page, 'q2-pickstep-day')) && (await tid(page, 'q2-slots-hint').count()) === 0, await txt(page, 'q2-slot-summary'));
  check('UX: each day chip shows AM and PM marks (the word, not only a colour)', await page.$$eval('label.q2-chip', (els) => els.every((e) => [...e.querySelectorAll('.q2-chip__half')].map((h) => h.textContent).join(',') === 'AM,PM')));
  await tid(page, `q2-day-${days[0]}`).click();
  check('UX: after tapping a day the helper text says "Choose morning or afternoon", nothing is ticked and Continue is still off', (await txt(page, 'q2-slot-summary')) === 'Choose morning or afternoon' && /Choose morning or afternoon/i.test(await txt(page, 'q2-pickstep-half')) && (await page.$$eval('label.q2-slot input', (els) => els.every((e) => !e.checked))) && await tid(page, 'q2-slot-continue').isDisabled(), await txt(page, 'q2-slot-summary'));
  check('UX: the tapped day chip is the one chosen day (selected look on that chip only, no tick mark yet)', await page.evaluate((d) => document.querySelectorAll('.q2-chip.is-viewed').length === 1 && document.querySelector(`[data-testid="q2-day-${d}"]`).classList.contains('is-viewed') && !document.querySelector('.q2-chip.is-picked'), days[0]));
  const halves = await page.$$eval('label.q2-slot', (els) => els.map((e) => ({ id: e.getAttribute('data-testid'), taken: e.classList.contains('is-taken'), text: e.innerText.replace(/\s+/g, ' ').trim(), w: e.getBoundingClientRect().width, off: e.parentElement.getBoundingClientRect().width })));
  check('the chosen day shows BOTH halves, Morning and Afternoon', halves.length === 2 && /Morning/.test(halves[0].text) && /Afternoon/.test(halves[1].text), JSON.stringify(halves));
  check('both halves are full-width buttons', halves.every((h) => h.w >= h.off - 2), JSON.stringify(halves.map((h) => [h.w, h.off])));
  const free = [];
  let takenText = '';
  let takenOk = true;
  for (const c of days) {
    await tid(page, `q2-day-${c}`).click();
    free.push(...(await page.$$eval('label.q2-slot:not(.is-taken)', (els) => els.map((e) => e.getAttribute('data-testid')))));
    const freeText = await page.$$eval('label.q2-slot:not(.is-taken)', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    if (!freeText.every((t) => /(Morning|Afternoon) Free · arrive \d/.test(t))) takenOk = false;
    const taken = await page.$$eval('label.q2-slot.is-taken', (els) => els.map((e) => ({ text: e.innerText.replace(/\s+/g, ' ').trim(), off: e.querySelector('input').disabled })));
    if (taken.length && !takenText) takenText = JSON.stringify(taken);
    if (taken.some((t) => !/Booked/.test(t.text) || !t.off)) takenOk = false;
    const booked = await page.evaluate((d) => [...document.querySelectorAll(`[data-testid="q2-day-${d}"] .q2-chip__half.is-booked`)].length, c);
    if (booked !== taken.length) takenOk = false;
  }
  check('free/booked are clear: a free half reads "Free · arrive 8–10am", a taken half reads "Booked", is disabled, and its chip mark is crossed out (no empty gap, no "Not available")', !!takenText && takenOk && !/Not available/.test(await txt(page, 'q2-slots')), takenText);
  check('there are free halves to pick across the days', free.length >= 3);
  check('the day heading follows the chosen chip', /^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+$|^(Today|Tomorrow) · /.test(await txt(page, 'q2-day-head')), await txt(page, 'q2-day-head'));
  check('"Soonest available" names the first free half-day', /Soonest available/i.test(await txt(page, 'q2-soonest')) && /Thu 29 Oct · Afternoon/.test(await txt(page, 'q2-soonest')), await txt(page, 'q2-soonest'));
  check('the sheet fits its content: no empty void between the text and the buttons', await page.evaluate(() => {
    const body = document.querySelector('[data-testid="q2-accept-sheet"] .ui-sheet__body');
    const foot = document.querySelector('[data-testid="q2-accept-sheet"] .ui-sheet__footer');
    const last = body.lastElementChild.getBoundingClientRect();
    return foot.getBoundingClientRect().top - last.bottom < 80;
  }));
  check('Continue is still off while only a day (no half) is chosen', await tid(page, 'q2-slot-continue').isDisabled());
  await tid(page, 'q2-soonest').click();
  check('"Soonest available" chooses it in one tap (Continue on, summary names it)', !(await tid(page, 'q2-slot-continue').isDisabled()) && /Thu 29 Oct · Afternoon/.test(await txt(page, 'q2-slot-summary')) && (await attr(page, 'q2-soonest', 'aria-pressed')) === 'true', await txt(page, 'q2-slot-summary'));
  const pick = free[1]; // a second option, to make sure it is not just the first one that works
  await pickSlot(page, pick);
  check('choosing a slot ticks it (radio checked)', await page.evaluate((t) => document.querySelector(`[data-testid="${t}"] input`).checked, pick));
  check('T13: morning and afternoon are radio-style rows with a square marker that fills when chosen (no checkbox, no tick glyph)', await page.evaluate((t) => {
    const rows = [...document.querySelectorAll('label.q2-slot:not(.is-taken)')];
    const row = document.querySelector(`[data-testid="${t}"]`);
    const mark = row.querySelector('.q2-slot__tick');
    const other = rows.find((r) => r !== row);
    return rows.every((r) => r.querySelector('input').type === 'radio' && !r.querySelector('svg')) && getComputedStyle(mark).borderRadius === '0px' && getComputedStyle(mark, '::after').opacity === '1' && getComputedStyle(mark, '::after').backgroundColor === 'rgb(11, 11, 12)' && (!other || getComputedStyle(other.querySelector('.q2-slot__tick'), '::after').opacity === '0');
  }, pick));
  check('the chosen day chip is marked, and "Soonest" is no longer the choice', await page.evaluate((d) => document.querySelector(`[data-testid="q2-day-${d}"]`).classList.contains('is-picked'), slotDay(pick)) && (await attr(page, 'q2-soonest', 'aria-pressed')) === 'false');
  check('summary names the chosen slot', /· (Morning|Afternoon), /.test(await txt(page, 'q2-slot-summary')), await txt(page, 'q2-slot-summary'));
  check('Continue is enabled', !(await tid(page, 'q2-slot-continue').isDisabled()));
  await shot(page, 'quote-pick-375');
  // keyboard: arrow keys move through the radio group
  await tid(page, 'q2-slot-continue').click();
  check('confirm step shows the day, the total and ONE promise (we confirm), with no "pencilled" and no "provisional"', /Your install day/.test(await txt(page, 'q2-accept-sheet')) && /£1,286/.test(await txt(page, 'q2-accept-sheet')) && /We will confirm your install day with you/.test(await txt(page, 'q2-accept-sheet')) && !/Daniel/.test(await txt(page, 'q2-accept-sheet')) && !/pencilled|provisional/i.test(await txt(page, 'q2-accept-sheet')));
  check('focus moved to the new step heading', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'q2-confirm-heading'));
  { const chrome2 = await chrome();
    check('T13: the confirm sheet wears the SAME header chrome as the day sheet (same bar, same Close position) and says "STEP 2 OF 2"', JSON.stringify(chrome2.bar) === JSON.stringify(chrome1.bar) && JSON.stringify(chrome2.close) === JSON.stringify(chrome1.close) && chrome2.step === 'STEP 2 OF 2' && /^Accept quote$/.test(await txt(page, 'q2-slot-confirm')), JSON.stringify([chrome1, chrome2])); }
  await shot(page, 'quote-confirm-375');
  check('confirm step: the summary card is at most three lines, the date on one line', await page.evaluate(() => {
    const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    const day = document.querySelector('.q2-confirm__day');
    const part = document.querySelector('.q2-confirm__part');
    return lines(day) === 1 && lines(day) + lines(part) <= 3;
  }));
  check('confirm step: Change sits below the text, as a text link (underlined word, no icon)', await page.evaluate(() => {
    const part = document.querySelector('.q2-confirm__part').getBoundingClientRect();
    const btn = document.querySelector('[data-testid="q2-slot-change"]');
    return btn.getBoundingClientRect().top >= part.bottom - 1 && !btn.querySelector('svg') && /^Change$/.test(btn.innerText.trim()) && getComputedStyle(btn.querySelector('span')).textDecorationLine === 'underline';
  }));
  check('confirm step: Accept sits directly under the agreement text (no void)', await page.evaluate(() => {
    const fine = document.querySelector('.q2-confirm__fine').getBoundingClientRect();
    const acc = document.querySelector('[data-testid="q2-slot-confirm"]').getBoundingClientRect();
    return acc.top - fine.bottom <= 32 && acc.top >= fine.bottom;
  }));
  check('confirm step: the agreement states no payment term (only that nothing is paid on this page)', /Nothing is paid on this page/.test(await txt(page, 'q2-accept-sheet')) && !/pay after|installed and tested/i.test(await txt(page, 'q2-accept-sheet')));
  { const ax = await axeSerious(page); check('confirm step: axe zero serious/critical', ax.count === 0, ax.detail); }
  check('confirm step: tap targets >= 44px', (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' ; '));
  await tid(page, 'q2-slot-back').click();
  check('Back returns to the list with the choice kept', await page.evaluate((t) => !!document.querySelector(`[data-testid="${t}"] input:checked`), pick));
  await tid(page, 'q2-slot-continue').click();
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-confirm').waitFor({ timeout: WAIT });
  check('the confirmation says the quote is accepted and we will confirm the day (not yet confirmed): no "pencilled", no "provisional", no "Daniel"', (await txt(page, 'q2-confirm-title')) === 'Thanks Sean, quote accepted' && !/pencilled|provisional/i.test(await txt(page, 'q2-confirm')) && !/Daniel/.test(await txt(page, 'q2-confirm')), await txt(page, 'q2-confirm-title'));
  check('the sheet is gone', (await tid(page, 'q2-accept-sheet').count()) === 0);
  check('the headline has focus', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'q2-confirm-title'));
  const [dayKey, win] = [pick.split('-').slice(2, 5).join('-'), Number(pick.split('-')[5])];
  check('D2: the install day shows ONE status, "To be confirmed", and the day', (await txt(page, 'q2-install-status')).toLowerCase() === 'to be confirmed' && (await txt(page, 'q2-install-part')).startsWith(win === 0 ? 'Morning' : 'Afternoon'), await txt(page, 'q2-install-part'));
  check('install booking reference and quote reference shown', /^EL-\d+$/.test(await txt(page, 'q2-install-ref')) && (await txt(page, 'q2-quote-ref')) === id);

  const st = await stateInStore(page);
  const q = st.quotes[id];
  const install = st.bookings.find((b) => b.id === q.installBookingId);
  check('store: quote accepted with a time', q.status === 'accepted' && !!q.acceptedAt);
  check('store: a tentative ev install exists for the chosen day and window', !!install && install.serviceId === 'ev' && install.tentative === true && install.status === 'new' && install.start.startsWith(dayKey) && install.start.endsWith(win === 0 ? '08:00' : '13:00'), JSON.stringify(install && { s: install.start, t: install.tentative }));
  check('store: install carries the quote and its price', install.quoteId === id && install.quotedPrice === TOTAL);
  check('store: owner and customer messages logged', st.messages.some((m) => m.kind === 'owner_quote_accepted' && m.bookingId === install.id) && st.messages.some((m) => m.kind === 'customer_quote_accepted' && m.bookingId === install.id));
  check('the page says it is a prototype (nobody was really notified)', /not really notified/.test(await txt(page, 'q2-simnote')));
  check('T05: accepted: no black square above the label (no .q2-mark, no svg in the hero), and "Quote accepted" is an ink label over the headline', await page.evaluate(() => {
    const hero = document.querySelector('.q2-hero--done .q2-hero__body');
    return !document.querySelector('.q2-mark') && !document.querySelector('[data-testid="q2-mark"]') && !hero.querySelector('svg') && hero.firstElementChild.classList.contains('q2-eyebrow') && getComputedStyle(hero.querySelector('.q2-eyebrow')).color === 'rgb(11, 11, 12)' && /^QUOTE ACCEPTED$/.test(hero.querySelector('.q2-eyebrow').innerText.trim());
  }));
  check('T05: the install-day heading is ONE label-voice line with the status beside it in sentence case: no underline, no pill, never red', await page.evaluate(() => {
    const label = document.querySelector('#q2-install-h');
    const st = document.querySelector('[data-testid="q2-install-status"]');
    const cs = getComputedStyle(st);
    const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    return lines(label) === 1 && lines(st) === 1 && Math.abs((label.getBoundingClientRect().top + label.getBoundingClientRect().bottom) / 2 - (st.getBoundingClientRect().top + st.getBoundingClientRect().bottom) / 2) < 8 && cs.textDecorationLine === 'none' && cs.borderBottomWidth === '0px' && cs.textTransform === 'none' && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderRadius === '0px' && cs.fontSize === '15px' && st.classList.contains('q2-status--wait') && !/225, 20, 20|176, 14, 18/.test(cs.color) && document.querySelectorAll('.q2-status').length === 1 && st.innerText.trim() === 'To be confirmed';
  }));
  check('accepted: the steps are logo-voice numerals, the ones already done muted (not green)', await page.evaluate(() => {
    const done = [...document.querySelectorAll('.q2-step.is-done .q2-step__num')];
    const next = document.querySelector('.q2-step:not(.is-done) .q2-step__num');
    return done.length >= 1 && done.every((n) => n.classList.contains('lp-logovoice') && /^0\d$/.test(n.textContent.trim()) && getComputedStyle(n).color === 'rgb(107, 107, 112)') && getComputedStyle(next).color === 'rgb(11, 11, 12)';
  }));
  check('accepted: exactly one filled button (Add to calendar), Call us and WhatsApp as a side-by-side pair, Done as an underlined text link flush with the 24px margin', await page.evaluate(() => {
    const card = document.querySelector('[data-testid="q2-install"]');
    const filled = [...card.querySelectorAll('.ui-btn--primary')];
    const call = card.querySelector('[data-testid="q2-call"]').getBoundingClientRect();
    const wa = card.querySelector('[data-testid="q2-whatsapp"]').getBoundingClientRect();
    const done = card.querySelector('[data-testid="q2-done"]');
    const dr = done.getBoundingClientRect();
    return filled.length === 1 && filled[0].getAttribute('data-testid') === 'q2-ics' && Math.abs(call.top - wa.top) < 2 && call.right <= wa.left + 1 && call.height < 60 && wa.height < 60 && /^Call us$/.test(card.querySelector('[data-testid="q2-call"]').innerText.trim())
      && done.tagName === 'A' && done.classList.contains('lp-link') && /^Done$/.test(done.innerText.trim()) && Math.abs(dr.left - 24) <= 0.5 && Math.abs(dr.left - call.left) <= 0.5 && dr.height >= 43.5 && getComputedStyle(done, '::after').height === '1px';
  }));
  await shot(page, 'quote-accepted-375', true);

  // Calendar file
  const dl = page.waitForEvent('download', { timeout: WAIT });
  await tid(page, 'q2-ics').click();
  const download = await dl;
  const icsText = fs.readFileSync(await download.path(), 'utf8');
  check('calendar file is a "To be confirmed" install on the chosen day (and never says pencilled or provisional)', /BEGIN:VCALENDAR/.test(icsText) && /STATUS:TENTATIVE/.test(icsText) && /To be confirmed/.test(icsText.replace(/\r\n /g, '')) && !/pencilled|provisional/i.test(icsText) && icsText.includes('DTSTART:' + dayKey.replace(/-/g, '') + 'T' + (win === 0 ? '0800' : '1300') + '00'), icsText.slice(0, 400));
  check('calendar file says what it is (EV charger installation)', /EV charger installation/.test(icsText.replace(/\r\n /g, '')));
  check('a saved note appears', await tid(page, 'q2-ics-saved').isVisible());
  check('calendar file name uses the install reference', /^180-EL-\d+\.ics$/.test(download.suggestedFilename()), download.suggestedFilename());

  // Reload persistence
  await page.reload({ waitUntil: 'load' });
  await tid(page, 'q2-confirm').waitFor();
  check('after a reload it still says the quote is accepted and the day is to be confirmed', (await txt(page, 'q2-confirm-title')) === 'Thanks Sean, quote accepted' && (await stateOf(page)) === 'accepted');
  check('the same day is still shown', (await txt(page, 'q2-install-part')).startsWith(win === 0 ? 'Morning' : 'Afternoon'));
  check('the owner confirming the day flips the page to Confirmed', await (async () => {
    await page.evaluate(async (bid) => { const s = await import('/js/core/store.js'); s.confirmBooking(bid, 'owner'); }, install.id);
    return until(async () => (await txt(page, 'q2-install-status')).toLowerCase() === 'confirmed');
  })());
  check('once he confirms, the headline is "You\'re all set"', await until(async () => /You're all set, Sean\./.test(await txt(page, 'q2-confirm-title'))), await txt(page, 'q2-confirm-title'));
  check('and the install booking reference is still there, with no "to be confirmed" left', (await tid(page, 'q2-install-ref').count()) === 1 && !/To be confirmed/i.test(await txt(page, 'q2-install')));
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
  await pickSlot(page, first);
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
  check('it goes back to the list of days (nothing was accepted, nothing is chosen any more)', (await tid(page, 'q2-strip').count()) === 1 && (await tid(page, 'q2-slot-continue').isDisabled()) && (await quoteInStore(page, id)).status !== 'accepted');
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
  await pickSlot(page, pick2);
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
  check('a thank-you state replaces the quote (in our voice)', /Thanks for letting us know/.test(await txt(page, 'q2-title')) && !/Daniel/.test(await txt(page, 'q2-declined')));
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
  check('T06: the black header is the first thing under the prototype strip on an expired quote; the expired row sits inside the decision card directly above the total, in ink with a 2px ink rule on its left (no --err, no red text)', await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="prototype-strip"]').getBoundingClientRect();
    const bar = document.querySelector('[data-testid="q2-header"]').getBoundingClientRect();
    const b = document.querySelector('[data-testid="q2-expired"]');
    const card = document.querySelector('[data-testid="q2-decision"]');
    const cs = getComputedStyle(b);
    const strong = getComputedStyle(b.querySelector('strong'));
    const total = document.querySelector('[data-testid="q2-total"]').getBoundingClientRect();
    return Math.abs(bar.top - strip.bottom) <= 1.5 && card.contains(b) && b.getBoundingClientRect().top >= bar.bottom && b.getBoundingClientRect().bottom <= total.top && cs.borderLeftWidth === '2px' && cs.borderLeftColor === 'rgb(11, 11, 12)' && cs.color === 'rgb(11, 11, 12)' && strong.color === 'rgb(11, 11, 12)' && strong.fontWeight === '600' && !b.querySelector('svg');
  }));
  check('T06: the expired row, "Valid until" and the status line are ink: no text on the page is red (--err or the brand red) outside the primary button', await page.evaluate(() => { const bad = []; for (const el of document.querySelectorAll('#app *')) { const cs = getComputedStyle(el); if (cs.display === 'none' || el.closest('.ui-btn--primary')) continue; if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && /^rgb\((225, 20, 20|176, 14, 18)\)$/.test(cs.color)) bad.push(el.className || el.tagName); } return bad.length === 0; }));
  check('T06: "Valid until" in the facts row reads "Thu 20 Oct"-style with "Expired" under it, in ink', await page.evaluate(() => { const li = document.querySelector('[data-testid="q2-fixed"]'); return /Expired/.test(li.innerText) && getComputedStyle(li.querySelector('.q2-meta__v')).color === 'rgb(11, 11, 12)' && getComputedStyle(li.querySelector('.q2-meta__note')).color === 'rgb(11, 11, 12)'; }));
  check('an expired quote has NO Accept button at all (not even a disabled one), no sticky bar and no "Not for me"', (await tid(page, 'q2-accept').count()) === 0 && (await tid(page, 'q2-sticky').count()) === 0 && (await tid(page, 'q2-decline').count()) === 0 && (await tid(page, 'q2-accept-sheet').count()) === 0);
  const ask = decodeURIComponent((await attr(page, 'q2-ask', 'href')) || '');
  check('the one primary action is "Ask us for an updated quote" and it opens WhatsApp with a prefilled request to him', (await txt(page, 'q2-ask')) === 'Ask us for an updated quote' && (await page.evaluate(() => document.querySelector('[data-testid="q2-ask"]').classList.contains('ui-btn--primary'))) && /wa\.me\/447885496800\?text=Hi Daniel, it's Una Kerr\. My EV charger quote Q-EL-\d+ has expired/.test(ask) && !/Daniel/.test(await txt(page, 'q2-page')), ask);
  check('the expired total is MUTED (grey, smaller than a live total) and carries no ticks', await page.evaluate(() => {
    const t = document.querySelector('[data-testid="q2-total"]');
    const [r, g, b] = getComputedStyle(t).color.match(/\d+/g).map(Number);
    return parseFloat(getComputedStyle(t).fontSize) < 40 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r < 200 && !document.querySelector('[data-testid="q2-summary"]') && /Total when quoted/i.test(document.querySelector('#q2-total-label').textContent);
  }));
  check('the quote is still readable below (the lines and the total)', (await tid(page, 'q2-line').count()) === 4 && (await txt(page, 'q2-total')) === '£1,286');
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
  await pickSlot(b, pickB);
  await tid(a, 'q2-accept').click();
  await tid(a, 'q2-accept-sheet').waitFor();
  const slotsA = await firstFreeSlots(a, 3);
  await pickSlot(a, slotsA[2]);
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
  await pickSlot(page, pick);
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
  await pickSlot(page, pick);
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
  check('desktop (T08): the total and Accept card sits beside the H1, in the right half of the hero', await page.evaluate(() => {
    const card = document.querySelector('[data-testid="q2-decision"]').getBoundingClientRect();
    const h1 = document.querySelector('[data-testid="q2-title"]').getBoundingClientRect();
    const hero = document.querySelector('.q2-hero').getBoundingClientRect();
    return card.left >= h1.right && card.top < h1.bottom && card.top > hero.top && card.top < hero.bottom - 120 && card.left > innerWidth / 2 - 40;
  }), await page.evaluate(() => JSON.stringify([document.querySelector('[data-testid="q2-decision"]').getBoundingClientRect().toJSON(), document.querySelector('[data-testid="q2-title"]').getBoundingClientRect().toJSON()])));
  check('desktop (T08): the logo, the hero copy and the sections share one left edge, Call and the decision card one right edge, inside the 1280px page', await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    const mark = r('[data-testid="q2-header"] .q2-logo');
    const title = r('[data-testid="q2-title"]');
    const lines = r('[data-testid="q2-lines-card"]');
    const call = r('[data-testid="q2-top-call"]');
    const card = r('[data-testid="q2-decision"]');
    return Math.abs(mark.left - lines.left) <= 1.5 && Math.abs(title.left - lines.left) <= 1.5 && Math.abs(call.right - card.right) <= 1.5 && card.right - lines.left <= 1281;
  }));
  check('T08 at 1280: below the total there is exactly ONE display-size heading ("What\'s included", the landing H2 size 52px), body copy is 18px and "Accredited and qualified" is the 13px label', await page.evaluate(() => {
    const big = [...document.querySelectorAll('.q2-main h2')].filter((h) => parseFloat(getComputedStyle(h).fontSize) >= 30 && h.getBoundingClientRect().width > 1);
    return big.length === 1 && big[0].id === 'q2-lines-h' && getComputedStyle(big[0]).fontSize === '52px' && getComputedStyle(document.querySelector('.q2-line__label')).fontSize === '18px' && getComputedStyle(document.querySelector('.q2-step__text')).fontSize === '18px' && getComputedStyle(document.querySelector('#q2-trust-h')).fontSize === '13px';
  }));
  check('T12 at 1280: the table sits beside the card (which stays in view), so the jump link is not shown and the four facts are in one row', await page.evaluate(() => { const li = [...document.querySelectorAll('.q2-meta li')].map((e) => Math.round(e.getBoundingClientRect().top)); return getComputedStyle(document.querySelector('[data-testid="q2-see-breakdown"]')).display === 'none' && li.length === 4 && new Set(li).size === 1; }));
  check('desktop (T08): the Accept button is on the first screen (no scrolling)', await page.evaluate(() => document.querySelector('[data-testid="q2-accept"]').getBoundingClientRect().bottom < innerHeight));
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
  check('Tab reaches "Soonest available" first', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'q2-soonest'));
  await page.keyboard.press('Tab');
  check('Tab then reaches the day chips (one radio group)', await page.evaluate(() => document.activeElement && document.activeElement.type === 'radio' && document.activeElement.name === 'q2-day'));
  check('no day is chosen until a key is pressed', await page.evaluate(() => !document.querySelector('.q2-chip.is-viewed') && !document.querySelector('label.q2-slot')));
  await page.keyboard.press('ArrowRight');
  const firstChip = await until(async () => page.evaluate(() => { const c = document.querySelector('.q2-chip.is-viewed'); return c && c.getAttribute('data-testid'); }));
  check('the arrow keys choose a day', !!firstChip);
  await page.keyboard.press('ArrowRight');
  check('and move through the days', await until(async () => page.evaluate((c) => document.querySelector('.q2-chip.is-viewed').getAttribute('data-testid') !== c, firstChip)));
  await page.keyboard.press('Tab');
  check('Tab then reaches the half-day radios', await page.evaluate(() => document.activeElement && document.activeElement.type === 'radio' && document.activeElement.name === 'q2-slot'));
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
  await pickSlot(page, pick);
  await tid(page, 'q2-slot-continue').click();
  await tid(page, 'q2-slot-confirm').focus();
  await page.keyboard.press('Enter');
  await tid(page, 'q2-confirm').waitFor();
  check('T05: accepting from the keyboard puts focus on the headline and draws NO ring around it (it is not a control)', await until(async () => page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return a.getAttribute('data-testid') === 'q2-confirm-title' && a.matches(':focus-visible') && cs.outlineStyle === 'none'; })), await page.evaluate(() => { const a = document.activeElement; return a.tagName + ' ' + a.getAttribute('data-testid') + ' ' + a.matches(':focus-visible') + ' ' + getComputedStyle(a).outlineStyle; }));
  check('reduced motion: the accepted page has no tick mark to animate, and its hero copy does not animate either', await page.evaluate(() => !document.querySelector('.q2-mark') && getComputedStyle(document.querySelector('.q2-title')).animationName === 'none'));
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

// ================================================================ 13. v4: the link carries the quote, so it opens on any phone (link mode)
/** The link the customer is really sent: the one inside the WhatsApp message the store logged for this quote, with the frozen clock added. */
const sentLink = (page, id) => page.evaluate((qid) => {
  const st = JSON.parse(localStorage.getItem('vm_state_v1'));
  const bookingId = st.quotes[qid] ? st.quotes[qid].bookingId : '';
  const msg = st.messages.filter((m) => m.kind === 'customer_quote_sent' && m.bookingId === bookingId).pop();
  return msg ? (msg.body.match(/https?:\/\/\S+/) || [''])[0] : '';
}, id);
const withClock = (link) => link.replace('quote.html#', `quote.html?${CLOCK}#`);
const hashOf = (link) => link.slice(link.indexOf('#'));
/** Tap a control that opens WhatsApp in a new tab: that tab's address (wa.me/<digits>?text=...), the message text and the dashboard link at its end. */
async function tapWhatsApp(ctx, page, testId) {
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: WAIT }), tid(page, testId).click()]);
  await pop.waitForURL((u) => u.hostname === 'wa.me', { timeout: WAIT });
  const url = pop.url();
  await pop.close().catch(() => {});
  const u = new URL(url);
  const text = u.searchParams.get('text') || '';
  return { url, host: u.hostname, path: u.pathname, text, link: (text.match(/https?:\/\/\S+$/) || [''])[0] };
}
/** Is this href the same WhatsApp message as one tapWhatsApp captured? (The browser normalises a quote mark in the address, so compare what the address SAYS.) */
const sameWa = (href, sent) => { try { const u = new URL(href); return u.hostname === sent.host && u.pathname === sent.path && u.searchParams.get('text') === sent.text; } catch (e) { return false; } };
const storedIds = (page) => page.evaluate(() => { try { return Object.keys(JSON.parse(localStorage.getItem('vm_state_v1')).quotes || {}); } catch (e) { return []; } });

await section('13. the quote link is self-contained (opens on another phone, in link mode)', async () => {
  const ctxA = await newContext(MOBILE);
  const a = await ctxA.newPage();
  const logA = watch(a);
  await openBlank(a);
  const id = await makeQuote(a, { name: 'Sean Doherty' });
  const link = await sentLink(a, id);
  check('the link in the sent message is quote.html#d=<payload>', /quote\.html#d=[A-Za-z0-9_-]+$/.test(link), link);
  check('the link is short enough for a message (under 1,500 characters)', link.length < 1500, String(link.length));
  const decoded = await a.evaluate(async (l) => { const h = await import('/js/core/handoff.js'); const r = h.parseQuoteLink(new URL(l).hash); return r.ok ? r.data : r; }, link);
  check('it holds quote id, first name, charger, lines, total, valid-until, notes, postcode and the sample flag', !!decoded && decoded.quoteId === id && decoded.customerFirst === 'Sean' && decoded.brand === 'OHME' && decoded.lines.length === 4 && decoded.total === TOTAL && /^\d{4}-\d\d-\d\d$/.test(decoded.validUntil) && /BT9/.test(decoded.postcode) && decoded.sample === true, JSON.stringify(decoded).slice(0, 300));

  // The id-only link still works where the quote was made, and so does the full one (the store is the live copy there).
  await open(a, id);
  check('the plain #q=<id> link still works in the browser that made the quote', (await stateOf(a)) === 'open' && (await txt(a, 'q2-total')) === '£1,286');
  await openBlank(a, hashOf(link));
  check('the full link opens it there too, from the store (same-browser mode: the day picker, not WhatsApp)', (await stateOf(a)) === 'open' && (await attr(a, 'q2-page', 'data-mode')) === 'store' && (await quoteInStore(a, id)).status === 'viewed');

  // A fresh browser: empty storage, a phone.
  const ctxB = await newContext(MOBILE);
  const b = await ctxB.newPage();
  const logB = watch(b);
  await b.goto(withClock(link), { waitUntil: 'load' });
  await tid(b, 'q2-page').waitFor({ timeout: WAIT });
  check('the full quote renders on a device that never saw it, in link mode', (await stateOf(b)) === 'open' && (await attr(b, 'q2-page', 'data-mode')) === 'link', String(await stateOf(b)));
  check('greeting and customer name come from the link', (await txt(b, 'q2-greeting')).toLowerCase() === 'hi sean,' && /Sean/.test(await txt(b, 'q2-for')) && (await txt(b, 'q2-ref')) === id);
  check('the four lines, the charger and the total', (await tid(b, 'q2-line').count()) === 4 && (await txt(b, 'q2-total')) === '£1,286' && /OHME home charger/.test(await txt(b, 'q2-brand')) && (await txt(b, 'q2-lines-total')) === '£1,286');
  check('quantities and line detail survive the trip', /6 × £12/.test(await txt(b, 'q2-lines')) && /Cable run planned at the survey/.test(await txt(b, 'q2-lines')));
  check('valid-until, the quote date, the postcode and our call button are there', /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/.test(await txt(b, 'q2-valid-until')) && /Fri 23 Oct/.test(await txt(b, 'q2-quote-date')) && /BT9 6QP/.test(await txt(b, 'q2-postcode')) && (await txt(b, 'q2-top-call')) === 'Call us' && !/Daniel/.test(await txt(b, 'q2-page')));
  check('the notes come with it, without the placeholder sentence', /The price covers the work listed above/.test(await txt(b, 'q2-notes')) && !/to be replaced/i.test(await txt(b, 'q2-page')));
  check('credentials, call and WhatsApp to his real number are there', /Level 3 Electrical Installation/.test(await txt(b, 'q2-credentials')) && (await attr(b, 'q2-call', 'href')) === 'tel:+447885496800' && /^https:\/\/wa\.me\/447885496800\?text=/.test((await attr(b, 'q2-whatsapp', 'href')) || ''));
  check('an honest small note "Prototype: sample prices" (tagged data-proto) is shown because the link flags its prices as samples', /Prototype: sample prices/.test(await txt(b, 'q2-sample-note')) && (await attr(b, 'q2-sample-note', 'data-proto')) !== null);
  check('"What happens next" describes the WhatsApp reply, not an install-day picker', /Send your reply on WhatsApp/.test(await txt(b, 'q2-steps')) && !/Pick a morning or afternoon in the next two weeks/.test(await txt(b, 'q2-steps')));
  await tid(b, 'prototype-tools').click();
  check('the Prototype tools popover says what is real (the WhatsApp message) and starts "This is a prototype"', await until(async () => /^This is a prototype\./.test(await txt(b, 'footer-disclosure'))) && /WhatsApp message you send is real/.test(await txt(b, 'footer-disclosure')) && !/Nothing is really sent/.test(await txt(b, 'footer-disclosure')));
  await tid(b, 'prototype-tools-close').click();
  check('the footer carries no disclosure at all (it is finished and quiet)', !/This is a prototype/.test(await txt(b, 'q2-footer')) && (await tid(b, 'q2-footer-disclosure').count()) === 0);
  check('opening the link writes nothing to the store (it is only read)', (await quoteInStore(b, id)) === null);
  check('zero horizontal overflow and tap targets >= 44px', (await noOverflow(b)) && (await smallTargets(b)).length === 0, (await smallTargets(b)).join(' ; '));
  { const ax = await axeSerious(b); check('link page: axe zero serious/critical', ax.count === 0, ax.detail); }
  await shot(b, 'quote-link-fresh-375-dark', true);

  // Accept in link mode: "Which days suit you?", then the real WhatsApp message to Daniel.
  await tid(b, 'q2-accept').click();
  await tid(b, 'q2-days-sheet').waitFor();
  check('the sheet is "Which days suit you?" (no install-day picker, no diary of ours)', /Which days suit you\?/.test(await txt(b, 'q2-days-sheet')) && (await b.locator('label.q2-chip').count()) === 0 && (await b.locator('label.q2-slot').count()) === 0);
  check('six weekday chips Mon to Sat, three times of day (Any time is the default), an optional note', await b.evaluate(() => {
    const days = [...document.querySelectorAll('[data-testid="q2-days"] label')].map((l) => l.textContent.replace(/\s+/g, ' ').trim());
    const parts = [...document.querySelectorAll('[data-testid="q2-parts"] label')].map((l) => l.textContent.trim());
    const any = document.querySelector('[data-testid="q2-ppart-any"] input');
    return days.length === 6 && /^Mon/.test(days[0]) && /^Sat/.test(days[5]) && parts.join('|') === 'Morning|Afternoon|Any time' && any.checked && !!document.querySelector('[data-testid="q2-days-note"]');
  }));
  check('with nothing chosen the message says any day', /Best: any day\./.test(await txt(b, 'q2-reply-summary')), await txt(b, 'q2-reply-summary'));
  await tid(b, 'q2-pday-thu').click();
  await tid(b, 'q2-pday-fri').click();
  await tid(b, 'q2-ppart-am').click();
  await tid(b, 'q2-days-note').fill('Please ring before 9, the dog barks.');
  check('the summary follows the taps: "Best: Thu or Fri mornings."', /Best: Thu or Fri mornings\./.test(await txt(b, 'q2-reply-summary')), await txt(b, 'q2-reply-summary'));
  await sleep(450);
  { const ax = await axeSerious(b); check('days sheet: axe zero serious/critical', ax.count === 0, ax.detail); }
  check('days sheet: chips and the button are at least 44px tall', await b.evaluate(() => [...document.querySelectorAll('.q2-pref, [data-testid="q2-reply-open"]')].every((e) => e.getBoundingClientRect().height >= 43.5 && e.getBoundingClientRect().width >= 43.5)));
  await shot(b, 'quote-link-days-375-dark');
  const sentA = await tapWhatsApp(ctxB, b, 'q2-reply-open');
  check('Open WhatsApp opens a real wa.me address to his number', sentA.host === 'wa.me' && sentA.path === '/447885496800', sentA.url.slice(0, 80));
  check('the message is in plain words: who, the quote and total, the days, the note', new RegExp(`^Hi Daniel, it's Sean\\. I'd like to go ahead with quote ${id} \\(£1,286\\)\\.\\nBest: Thu or Fri mornings\\.\\nNote: Please ring before 9, the dog barks\\.`).test(sentA.text), sentA.text.slice(0, 200));
  check('and it ends with the link Daniel taps: dashboard.html#import=<payload>', /dashboard\.html#import=[A-Za-z0-9_-]+$/.test(sentA.link), sentA.link);
  await tid(b, 'q2-reply-sent').waitFor({ timeout: WAIT });
  check('the page then shows the calm "ready in WhatsApp" view', (await stateOf(b)) === 'reply' && (await txt(b, 'q2-sent-title')) === 'Your message is ready in WhatsApp', await txt(b, 'q2-sent-title'));
  check('"Tap send and we will confirm your install day."', /Tap send and we will confirm your install day\./.test(await txt(b, 'q2-reply-sent')) && !/Daniel/.test(await txt(b, 'q2-steps')));
  const sentText = await txt(b, 'q2-reply-sent');
  check('it never claims the message was sent', !/\b(has|have|was|been|got) sent\b|\bsent to Daniel\b|Message sent|Sent\./i.test(sentText.replace(/Nothing reaches us until you do\./, '').replace(/whether you sent it/, '')), sentText.match(/.{30}\bsent\b.{30}/i) + '');
  check('the preview shows the message, with the long link as a short chip', /Best: Thu or Fri mornings/.test(await txt(b, 'q2-reply-message')) && /Link to your reply/.test(await txt(b, 'q2-reply-message')) && !/dashboard\.html#import=/.test(await txt(b, 'q2-reply-message')));
  check('"Open WhatsApp again" has the same address', sameWa(await attr(b, 'q2-reopen', 'href'), sentA) && (await attr(b, 'q2-reopen', 'target')) === '_blank' && /noopener/.test((await attr(b, 'q2-reopen', 'rel')) || ''));
  check('the "prototype" note says the page cannot tell whether it was sent (tagged data-proto)', /cannot tell whether you sent it/.test(await txt(b, 'q2-simnote')) && (await attr(b, 'q2-simnote', 'data-proto')) !== null);
  check('the customer\'s own store holds nothing about this quote (nothing is accepted here)', !(await storedIds(b)).includes(id));
  const remembered = await b.evaluate(() => JSON.parse(localStorage.getItem('vm_handoff_v1') || '{}'));
  check('this browser remembers only that it OPENED the message', !!remembered.items && !!remembered.items[`acc:${id}`] && remembered.items[`acc:${id}`].part === 'am' && remembered.items[`acc:${id}`].days.join(',') === 'thu,fri', JSON.stringify(remembered).slice(0, 200));
  // Copy fallback (a pop-up blocker, or a phone that will not open the app).
  await tid(b, 'q2-copy').click();
  check('Copy message puts the whole message on the clipboard', await until(async () => (await b.evaluate(() => navigator.clipboard.readText())) === sentA.text), (await b.evaluate(() => navigator.clipboard.readText().catch(() => 'no clipboard'))).slice(0, 80));
  check('and says so, with what to do next', /Copied\. In WhatsApp, open your chat with 180 Electrical and paste it\./.test(await txt(b, 'q2-copy-status')), await txt(b, 'q2-copy-status'));
  await tid(b, 'q2-fulltext-disclosure').locator('summary').click();
  check('the whole message is also there to select by hand', (await tid(b, 'q2-reply-fulltext').inputValue()) === sentA.text);
  check('sent view: no overflow, tap targets >= 44px', (await noOverflow(b)) && (await smallTargets(b)).length === 0, (await smallTargets(b)).join(' ; '));
  { const ax = await axeSerious(b); check('sent view: axe zero serious/critical', ax.count === 0, ax.detail); }
  await shot(b, 'quote-link-sent-375-dark', true);
  // A reload remembers it was opened, in words that do not claim delivery.
  await b.reload({ waitUntil: 'load' });
  await tid(b, 'q2-reply-sent').waitFor({ timeout: WAIT });
  check('after a reload it still shows the message that is ready, "Opened in WhatsApp on Fri 23 Oct"', /Opened in WhatsApp on Fri 23 Oct/i.test(await txt(b, 'q2-reply-sent')) && sameWa(await attr(b, 'q2-reopen', 'href'), sentA));
  // The owner changes the price and sends the same quote again: the old "ready in WhatsApp" view must not hide the updated quote.
  const link2 = await a.evaluate(async (qid) => {
    const quotes = await import('/js/core/quotes.js');
    const q = JSON.parse(localStorage.getItem('vm_state_v1')).quotes[qid];
    const lines = q.lines.map((l, i) => (i === 0 ? { ...l, unitPrice: l.unitPrice + 50 } : l));
    return quotes.quoteShareUrl({ ...q, lines }, { postcode: 'BT9 6QP' }); // the link Daniel's phone would make after he changes a price
  }, id);
  check('the updated quote makes a different link', link2 !== link && /quote\.html#d=/.test(link2));
  await b.goto(withClock(link2), { waitUntil: 'load' });
  await tid(b, 'q2-page').waitFor({ timeout: WAIT });
  check('an updated quote (same number, new total) opens as a fresh quote, not as the old "ready" view', (await stateOf(b)) === 'open' && (await txt(b, 'q2-total')) === '£1,336', `${await stateOf(b)} ${await txt(b, 'q2-total')}`);
  await b.goto(withClock(link), { waitUntil: 'load' });
  await tid(b, 'q2-page').waitFor({ timeout: WAIT });
  check('and the first link still shows the message that was opened for it', (await stateOf(b)) === 'reply');
  // Back to the quote: the reply is forgotten and the quote is open again.
  await tid(b, 'q2-reply-change').click();
  await tid(b, 'q2-open').waitFor({ timeout: WAIT });
  check('"Back to my quote" shows the open quote again and forgets the reply', (await stateOf(b)) === 'open' && (await b.evaluate((qid) => !(JSON.parse(localStorage.getItem('vm_handoff_v1') || '{"items":{}}').items || {})['acc:' + qid], id)));
  await tid(b, 'q2-accept').click();
  await tid(b, 'q2-days-sheet').waitFor();
  check('a fresh days sheet starts empty again', /Best: any day\./.test(await txt(b, 'q2-reply-summary')));
  await b.keyboard.press('Escape');
  await b.locator('[data-testid="q2-days-sheet"]').waitFor({ state: 'detached', timeout: WAIT });
  check('closing the sheet changes nothing', (await stateOf(b)) === 'open');
  check('no console errors, off-site or failed requests (fresh browser)', clean(logB), dump(logB));
  await ctxB.close();

  // Decline from a fresh browser: the reason chip, then the same pattern.
  const ctxC = await newContext(MOBILE);
  const c = await ctxC.newPage();
  const logC = watch(c);
  await c.goto(withClock(link), { waitUntil: 'load' });
  await tid(c, 'q2-decline').waitFor({ timeout: WAIT });
  await tid(c, 'q2-decline').click();
  await tid(c, 'q2-decline-sheet').waitFor();
  check('the decline sheet asks the reason (chips) and offers "Decline in WhatsApp"', (await c.locator('[data-testid^="q2-reason-"]').count()) >= 5 && /Decline in WhatsApp/.test(await txt(c, 'q2-decline-whatsapp')));
  await tid(c, 'q2-reason-time').click();
  await tid(c, 'q2-reason-note').fill('Back in the spring.');
  const sentC = await tapWhatsApp(ctxC, c, 'q2-decline-whatsapp');
  check('the decline message: who, the quote and total, "won\'t be going ahead", the reason, and the import link', new RegExp(`^Hi Daniel, it's Sean\\. Thanks for the quote ${id} \\(£1,286\\), but I won't be going ahead this time\\.\\nReason: I need more time: Back in the spring\\.`).test(sentC.text) && /dashboard\.html#import=[A-Za-z0-9_-]+$/.test(sentC.link), sentC.text.slice(0, 200));
  await tid(c, 'q2-reply-sent').waitFor({ timeout: WAIT });
  check('declining shows the same calm view, worded for a decline', (await attr(c, 'q2-reply-sent', 'data-kind')) === 'dec' && /Tap send so we know/.test(await txt(c, 'q2-reply-sent')) && (await tid(c, 'q2-steps').count()) === 0);
  check('nothing is written to the customer\'s quote store', !(await storedIds(c)).includes(id));
  await shot(c, 'quote-link-decline-sent-375-dark', true);
  check('no console errors (decline from the link)', clean(logC), dump(logC));
  await ctxC.close();

  // A link that has expired reads as expired and cannot be accepted.
  const late = await makeQuote(a, { name: 'Una Kerr', validUntil: '2026-10-20' });
  // (makeQuote changes the day after sending, so the link is rebuilt from the stored quote, the way "Copy link" builds it.)
  const lateLink = await a.evaluate(async (qid) => {
    const q = await import('/js/core/quotes.js');
    const st = JSON.parse(localStorage.getItem('vm_state_v1'));
    return q.quoteShareUrl(st.quotes[qid], { postcode: 'BT9 6QP' });
  }, late);
  const ctxD = await newContext(MOBILE);
  const d = await ctxD.newPage();
  await d.goto(withClock(lateLink), { waitUntil: 'load' });
  await tid(d, 'q2-page').waitFor({ timeout: WAIT });
  await tid(d, 'q2-expired').waitFor({ timeout: WAIT });
  check('an expired link says so (the row above the total), there is no Accept at all and no "Not for me", and "Ask us for an updated quote" is the primary action', (await stateOf(d)) === 'expired' && /This quote has expired/.test(await txt(d, 'q2-expired')) && (await tid(d, 'q2-accept').count()) === 0 && (await txt(d, 'q2-ask')) === 'Ask us for an updated quote' && (await tid(d, 'q2-decline').count()) === 0 && (await attr(d, 'q2-page', 'data-mode')) === 'link');
  check('it offers to ask for an updated quote on WhatsApp', /^https:\/\/wa\.me\/447885496800\?text=/.test((await attr(d, 'q2-ask', 'href')) || ''));
  await shot(d, 'quote-link-expired-375-dark', true);
  await ctxD.close();

  // Damaged, cut off, edited, the wrong kind of link: friendly, never a half-built quote.
  const ctxE = await newContext(MOBILE);
  const e = await ctxE.newPage();
  const logE = watch(e);
  await e.goto(`${BASE}/quote.html?${CLOCK}#d=garbage`, { waitUntil: 'load' });
  await tid(e, 'q2-page').waitFor({ timeout: WAIT });
  check('#d=garbage shows the quiet invalid state', (await stateOf(e)) === 'invalid' && /We could not open this quote/.test(await txt(e, 'q2-title')));
  check('and says the link looks cut short or damaged (with no "missing reference" line)', /cut short or damaged/.test(await txt(e, 'q2-damaged')) && !/missing the quote reference/.test(await txt(e, 'q2-invalid')));
  await openBlank(e, hashOf(link).slice(0, -9));
  check('a cut-off link is the same quiet state (never a half-built quote)', (await stateOf(e)) === 'invalid' && (await tid(e, 'q2-total').count()) === 0 && /cut short or damaged/.test(await txt(e, 'q2-damaged')));
  const flipped = hashOf(link).replace(/(#d=.{40})(.)/, (m, p, ch) => p + (ch === 'A' ? 'B' : 'A'));
  await openBlank(e, flipped);
  check('a link with one character changed fails its checksum and is refused', (await stateOf(e)) === 'invalid' && /cut short or damaged/.test(await txt(e, 'q2-damaged')));
  const accPayloadHash = await a.evaluate(async (qid) => { const h = await import('/js/core/handoff.js'); const p = h.buildAcceptancePayload({ quote: { id: qid, customerFirst: 'Sean', lines: [{ qty: 1, unitPrice: 100 }] }, days: ['mon'], part: 'am' }); return '#d=' + h.encodePayload(p); }, id);
  await openBlank(e, accPayloadHash);
  check('a link that is not a quote (an acceptance) says so in plain words', (await stateOf(e)) === 'invalid' && /not a quote link/.test(await txt(e, 'q2-damaged')), await txt(e, 'q2-invalid'));
  await openBlank(e, `#q=Q-NOPE-7&d=${hashOf(link).slice(3)}`);
  check('a link whose reference differs from the quote inside it is refused', (await stateOf(e)) === 'invalid' && /does not match/.test(await txt(e, 'q2-damaged')));
  check('the invalid state still offers Call and WhatsApp to get the quote sent again', /^tel:/.test((await attr(e, 'q2-call', 'href')) || '') && /wa\.me\/447885496800/.test((await attr(e, 'q2-whatsapp', 'href')) || ''));
  check('no console errors on the invalid states', clean(logE), dump(logE));
  await ctxE.close();

  // A v3 link already in the wild (quote.html#q=<id>&d=<legacy payload>) still opens, in link mode.
  const legacy = await a.evaluate(async (qid) => {
    const q = await import('/js/core/quotes.js');
    const st = JSON.parse(localStorage.getItem('vm_state_v1'));
    return q.legacyQuoteShareUrl(st.quotes[qid], { ownerFirst: 'Daniel', postcode: 'BT9 6QP' });
  }, id);
  const ctxL = await newContext(MOBILE);
  const l = await ctxL.newPage();
  const logL = watch(l);
  await l.goto(withClock(legacy), { waitUntil: 'load' });
  await tid(l, 'q2-page').waitFor({ timeout: WAIT });
  check('a v3 link still opens in a fresh browser, in link mode', (await stateOf(l)) === 'open' && (await attr(l, 'q2-page', 'data-mode')) === 'link' && (await txt(l, 'q2-total')) === '£1,286' && (await txt(l, 'q2-greeting')).toLowerCase() === 'hi sean,');
  await tid(l, 'q2-accept').click();
  await tid(l, 'q2-days-sheet').waitFor();
  const sentL = await tapWhatsApp(ctxL, l, 'q2-reply-open');
  check('and its Accept also ends in the WhatsApp message (the reply reaches Daniel instead of staying on this phone)', sentL.path === '/447885496800' && new RegExp(`quote ${id} \\(£1,286\\)`).test(sentL.text) && /dashboard\.html#import=/.test(sentL.link), sentL.text.slice(0, 120));
  check('no console errors (v3 link)', clean(logL), dump(logL));
  await ctxL.close();

  // Garbage d= on a quote this browser DOES hold: the store copy is used.
  await openBlank(a, `#q=${id}&d=garbage`);
  check('a damaged d= is ignored when this browser holds the quote', (await stateOf(a)) === 'open' && (await txt(a, 'q2-total')) === '£1,286');

  // Two browsers number their quotes alike: a link must never touch someone else's quote that shares its reference.
  const ctxF = await newContext(MOBILE);
  const f = await ctxF.newPage();
  await openBlank(f);
  const other = await makeQuote(f, { name: 'Aoife Gray' });
  if (other !== id) {
    check('(skipped) the two browsers did not number their quotes alike', true);
  } else {
    await f.goto(withClock(link), { waitUntil: 'load' });
    await tid(f, 'q2-page').waitFor({ timeout: WAIT });
    await f.reload({ waitUntil: 'load' });
    await tid(f, 'q2-total').waitFor({ timeout: WAIT });
    check('a link wins over another customer\'s quote with the same number (the page shows Sean, in link mode)', (await txt(f, 'q2-greeting')).toLowerCase() === 'hi sean,' && (await attr(f, 'q2-page', 'data-mode')) === 'link');
    await tid(f, 'q2-accept').click();
    await tid(f, 'q2-days-sheet').waitFor();
    await tapWhatsApp(ctxF, f, 'q2-reply-open');
    check('replying leaves the other customer\'s quote in this browser untouched', (await quoteInStore(f, id)).customerName === 'Aoife Gray' && (await quoteInStore(f, id)).status !== 'accepted');
  }
  await ctxF.close();

  // The skip link must not break the page (it used to change the address bar).
  const ctxG = await newContext(MOBILE);
  const g = await ctxG.newPage();
  await g.goto(withClock(link), { waitUntil: 'load' });
  await tid(g, 'q2-page').waitFor({ timeout: WAIT });
  await g.keyboard.press('Tab');
  await g.keyboard.press('Enter');
  await sleep(300);
  check('the skip link moves focus to the quote and leaves the page showing it', (await stateOf(g)) === 'open' && (await g.evaluate(() => location.hash.startsWith('#d='))) && (await g.evaluate(() => document.activeElement && document.activeElement.id)) === 'q2-main');
  await ctxG.close();
  check('no console errors in the first browser', clean(logA), dump(logA));
  await ctxA.close();
});

// ================================================================ 14. a bare link is swapped for the self-contained one
await section('14. a bare link opened in the owner\'s browser becomes a link that works on any phone', async () => {
  const ctxA = await newContext(MOBILE);
  const a = await ctxA.newPage();
  const logA = watch(a);
  await openBlank(a);
  const id = await makeQuote(a, { name: 'Sean Doherty' });
  await a.evaluate(() => { window.__hashchanges = 0; window.addEventListener('hashchange', () => { window.__hashchanges += 1; }); });
  await a.evaluate((qid) => { location.hash = `#q=${qid}`; }, id); // a BARE link (the confirmation, the landing sample, "Customer view")
  check('the bare link opens the quote', await until(async () => (await stateOf(a)) === 'open'));
  const href = await until(async () => { const h = await a.evaluate(() => location.href); return /#d=[A-Za-z0-9_-]+$/.test(h) ? h : false; });
  check('the address bar now holds #d=<payload> (whatever is copied from it opens anywhere)', !!href, await a.evaluate(() => location.href));
  const viewed = (await quoteInStore(a, id)).viewedAt;
  await sleep(700);
  check('it did not loop: one hashchange only (the visit itself), no second render of the route', (await a.evaluate(() => window.__hashchanges)) === 1, String(await a.evaluate(() => window.__hashchanges)));
  check('the view was counted once and is not re-counted', (await quoteInStore(a, id)).status === 'viewed' && (await quoteInStore(a, id)).viewedAt === viewed);
  check('the open quote is still shown, from this browser\'s own copy', (await stateOf(a)) === 'open' && (await attr(a, 'q2-page', 'data-mode')) === 'store' && (await txt(a, 'q2-total')) === '£1,286');
  await a.reload({ waitUntil: 'load' });
  await tid(a, 'q2-total').waitFor({ timeout: WAIT });
  check('reloading the rewritten address still works (and still counts no second view)', (await stateOf(a)) === 'open' && (await quoteInStore(a, id)).viewedAt === viewed);

  // The address-bar URL, opened in a fresh browser on another "phone".
  const ctxB = await newContext(MOBILE);
  const b = await ctxB.newPage();
  const logB = watch(b);
  await b.goto(href, { waitUntil: 'load' });
  await tid(b, 'q2-page').waitFor({ timeout: WAIT });
  check('context B: the full quote renders from the address-bar URL', (await stateOf(b)) === 'open' && (await txt(b, 'q2-total')) === '£1,286' && (await tid(b, 'q2-line').count()) === 4 && /Hi Sean,/i.test(await txt(b, 'q2-greeting')));
  await shot(b, 'quote-address-bar-fresh-375-dark', true);
  await tid(b, 'q2-accept').click();
  await tid(b, 'q2-days-sheet').waitFor();
  check('context B: the Accept sheet is "Which days suit you?"', (await page_count(b, 'label.q2-pref')) === 9 && /Which days suit you\?/.test(await txt(b, 'q2-days-sheet')));
  check('context B: no console errors, off-site or failed requests', clean(logB), dump(logB));
  await ctxB.close();

  // A bare link in a fresh browser: the plain "could not open" state, with Call as the way forward.
  const ctxC = await newContext(MOBILE);
  const c = await ctxC.newPage();
  const logC = watch(c);
  await openBlank(c, `#q=${id}`);
  check('context C: a bare link in a fresh browser shows the invalid state', (await stateOf(c)) === 'invalid');
  check('context C: Call is the primary button, WhatsApp the secondary one (prefilled with the reference)', await c.evaluate(() => document.querySelector('[data-testid="q2-call"]').classList.contains('ui-btn--primary') && document.querySelector('[data-testid="q2-whatsapp"]').classList.contains('ui-btn--secondary')) && decodeURIComponent((await attr(c, 'q2-whatsapp', 'href')) || '').endsWith(`text=Hi Daniel, I cannot open my quote ${id}.`));
  check('context C: no "prototype" outside [data-proto]', await c.evaluate(() => {
    const clone = document.getElementById('app').cloneNode(true);
    clone.querySelectorAll('[data-proto], [data-testid="prototype-strip"]').forEach((n) => n.remove());
    return !/prototype/i.test(clone.textContent);
  }));
  check('context C: the "Trying the prototype?" card carries data-proto, and the strip (which holds the way back) does not', (await tid(c, 'q2-demo').getAttribute('data-proto')) !== null && (await tid(c, 'prototype-strip').getAttribute('data-proto')) === null);
  await shot(c, 'quote-invalid-375-dark', true);
  check('context C: tap targets >= 44px and no horizontal overflow', (await noOverflow(c)) && (await smallTargets(c)).length === 0, (await smallTargets(c)).join(' ; '));
  { const ax = await axeSerious(c); check('context C: axe zero serious/critical', ax.count === 0, ax.detail); }
  check('context C: no console errors', clean(logC), dump(logC));
  await ctxC.close();

  // The other states: accepted and expired bare links are swapped too; a declined one is not (a link would reopen it elsewhere).
  const accId = await makeQuote(a, { name: 'Roisin Kane' });
  await open(a, accId);
  await tid(a, 'q2-accept').click();
  await tid(a, 'q2-accept-sheet').waitFor();
  const [slot] = await firstFreeSlots(a, 1);
  await pickSlot(a, slot);
  await tid(a, 'q2-slot-continue').click();
  await tid(a, 'q2-slot-confirm').click();
  await tid(a, 'q2-confirm').waitFor({ timeout: WAIT });
  await open(a, accId);
  check('an accepted quote opened by a bare link is swapped too', await until(async () => /#d=/.test(await a.evaluate(() => location.hash))));
  const expId = await makeQuote(a, { name: 'Una Kerr', validUntil: '2026-10-20' });
  await open(a, expId);
  check('an expired quote opened by a bare link is swapped too', await until(async () => /#d=/.test(await a.evaluate(() => location.hash))));
  const decId = await makeQuote(a, { name: 'Dara Gallagher' });
  await open(a, decId);
  await tid(a, 'q2-decline').click();
  await tid(a, 'q2-decline-confirm').click();
  await tid(a, 'q2-declined').waitFor({ timeout: WAIT });
  await open(a, decId);
  await sleep(500);
  check('a declined quote is NOT swapped (a link must not reopen it on another phone)', !/#d=/.test(await a.evaluate(() => location.hash)));
  await open(a, id, '&preview=1');
  await tid(a, 'q2-preview').waitFor();
  check('an owner preview is swapped and keeps its preview flag', await until(async () => { const h = await a.evaluate(() => location.hash); return /^#d=/.test(h) && /&preview=1$/.test(h); }));
  await a.reload({ waitUntil: 'load' });
  await tid(a, 'q2-preview').waitFor({ timeout: WAIT });
  check('and the swapped preview address reloads as a preview (store mode, not counted)', (await attr(a, 'q2-page', 'data-mode')) === 'store');
  check('no console errors in the first browser', clean(logA), dump(logA));
  await ctxA.close();
});
async function page_count(page, selector) { return page.locator(selector).count(); }

// ================================================================ 15. link mode: widths, themes, keyboard, reduced motion
await section('15. link mode on every width and theme', async () => {
  const ctxA = await newContext(MOBILE);
  const a = await ctxA.newPage();
  await openBlank(a);
  const id = await makeQuote(a, { name: 'Maria Fitzpatrick-Montgomery', notes: 'Line one of the notes.\nLine two with a very long unbroken word: ' + 'x'.repeat(60) });
  const link = await sentLink(a, id);
  await ctxA.close();
  for (const [w, h] of [[320, 640], [375, 812], [1280, 900]]) {
    for (const theme of ['dark', 'light']) {
      const ctx = await newContext({ width: w, height: h }, theme, { theme });
      const page = await ctx.newPage();
      const log = watch(page);
      await page.goto(withClock(link), { waitUntil: 'load' });
      await tid(page, 'q2-total').waitFor({ timeout: WAIT });
      check(`${w} ${theme}: link mode, no horizontal overflow, tap targets >= 44px`, (await attr(page, 'q2-page', 'data-mode')) === 'link' && (await noOverflow(page)) && (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' ; '));
      { const ax = await axeSerious(page); check(`${w} ${theme}: open quote axe zero serious/critical`, ax.count === 0, ax.detail); }
      if (w !== 320) await shot(page, `quote-link-open-${w}-${theme}`, true);
      await tid(page, w >= 960 ? 'q2-accept' : 'q2-accept').click();
      await tid(page, 'q2-days-sheet').waitFor();
      await tid(page, 'q2-pday-thu').click();
      await tid(page, 'q2-pday-fri').click();
      await tid(page, 'q2-ppart-am').click();
      await sleep(450);
      check(`${w} ${theme}: days sheet fits, chips >= 44px, Mon to Sat each on one line`, await page.evaluate(() => {
        const sheet = document.querySelector('[data-testid="q2-days-sheet"]').getBoundingClientRect();
        const chips = [...document.querySelectorAll('.q2-pref')];
        return sheet.left >= 0 && sheet.right <= innerWidth + 0.5 && chips.every((c) => c.getBoundingClientRect().height >= 43.5 && c.getBoundingClientRect().width >= 43.5 && c.querySelector('.q2-pref__label').getBoundingClientRect().height < 24);
      }));
      { const ax = await axeSerious(page); check(`${w} ${theme}: days sheet axe zero serious/critical`, ax.count === 0, ax.detail); }
      await shot(page, `quote-link-days-${w}-${theme}`);
      if (w === 375 || w === 1280) {
        await tapWhatsApp(ctx, page, 'q2-reply-open');
        await tid(page, 'q2-reply-sent').waitFor({ timeout: WAIT });
        await sleep(900);
        check(`${w} ${theme}: ready view, no overflow, tap targets >= 44px`, (await noOverflow(page)) && (await smallTargets(page)).length === 0, (await smallTargets(page)).join(' ; '));
        { const ax = await axeSerious(page); check(`${w} ${theme}: ready view axe zero serious/critical`, ax.count === 0, ax.detail); }
        await shot(page, `quote-link-sent-${w}-${theme}`, true);
        // decline, from a fresh load
        await tid(page, 'q2-reply-change').click();
        await tid(page, 'q2-decline').click();
        await tid(page, 'q2-decline-sheet').waitFor();
        await tid(page, 'q2-reason-price').click();
        await sleep(450);
        { const ax = await axeSerious(page); check(`${w} ${theme}: decline sheet axe zero serious/critical`, ax.count === 0, ax.detail); }
        await shot(page, `quote-link-decline-${w}-${theme}`);
      }
      check(`${w} ${theme}: clean console`, clean(log), dump(log));
      await ctx.close();
    }
  }
  // Keyboard only, and reduced motion.
  const ctx = await newContext(MOBILE, 'dark', { reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(withClock(link), { waitUntil: 'load' });
  await tid(page, 'q2-accept').waitFor({ timeout: WAIT });
  await tid(page, 'q2-accept').focus();
  await page.keyboard.press('Enter');
  await tid(page, 'q2-days-sheet').waitFor();
  check('keyboard: focus lands on the sheet\'s first line', await page.evaluate(() => !!document.activeElement && document.activeElement.getAttribute('data-testid') === 'q2-days-lead'));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  check('keyboard: Tab then Space ticks the first day (Mon)', await page.evaluate(() => document.querySelector('[data-testid="q2-pday-mon"] input').checked));
  check('keyboard: the sheet keeps focus inside (the page behind is inert)', await page.evaluate(() => document.getElementById('app').hasAttribute('inert')));
  check('reduced motion: the hero copy does not animate', await (async () => {
    await page.keyboard.press('Escape');
    return page.evaluate(() => getComputedStyle(document.querySelector('.q2-hero__body > *')).animationName === 'none');
  })());
  await ctx.close();
});

// ================================================================ 16. round 3: possible extras, the ideas switch, the quiet page
const EXTRA_LINES = [
  { label: 'Supply of OHME home charger', detail: '', qty: 1, unitPrice: 679 },
  { label: 'Standard installation (up to 10 m of cable)', detail: '', qty: 1, unitPrice: 450 },
  { label: 'Consumer unit upgrade (if required)', detail: '', qty: 1, unitPrice: 420 }, // not flagged: the LABEL says it is optional, whatever the data says
  { label: 'Groundwork (per metre), only if needed', detail: '', qty: 2, unitPrice: 65 },
  { label: 'Surface-mounted enclosure', detail: '', qty: 1, unitPrice: 95, optional: true }, // flagged by the owner's builder
  { label: 'Testing and certification', detail: '', qty: 1, unitPrice: 85 }
];
const EXTRA_FIXED_TOTAL = 679 + 450 + 85; // 1214
await section('16. possible extras, the ideas switch, the quiet page', async () => {
  const ctx = await newContext(MOBILE);
  const page = await ctx.newPage();
  const log = watch(page);
  await openBlank(page);
  const id = await makeQuote(page, { name: 'Gavin Rooney', lines: EXTRA_LINES });
  await open(page, id);
  await tid(page, 'q2-total').waitFor();
  check('D1: lines that say "if required" / "only if needed" (or are flagged optional) are NOT in the total: £1,214, not £1,914', (await txt(page, 'q2-total')) === '£1,214' && (await txt(page, 'q2-lines-total')) === '£1,214', await txt(page, 'q2-total'));
  check('the three fixed lines are the itemised list; the three possible extras are a separate group', (await tid(page, 'q2-line').count()) === 3 && (await tid(page, 'q2-extra').count()) === 3 && (await tid(page, 'q2-extras-list').locator('[data-testid="q2-line"]').count()) === 0);
  const extrasText = await txt(page, 'q2-extras');
  check('the group is headed "Possible extras, quoted separately" and says it is not in the total, with each price', /Possible extras, quoted separately/.test(extrasText) && /Not included in the total/.test(extrasText) && /£420/.test(extrasText) && /£130/.test(extrasText) && /£95/.test(extrasText), extrasText);
  check('the extras sit AFTER the total row, never before it', await page.evaluate(() => { const sum = document.querySelector('.q2-lines__sum').getBoundingClientRect(); const ex = document.querySelector('[data-testid="q2-extras"]').getBoundingClientRect(); return ex.top >= sum.bottom - 1; }));
  check('the main list holds no extra', !/if required|only if needed|enclosure/i.test(await txt(page, 'q2-lines')));
  check('the question to Daniel quotes the same total the page shows (£1,214)', /\(£1,214\)/.test(decodeURIComponent((await attr(page, 'q2-ask', 'href')) || '')));
  await shot(page, 'quote-extras-375-dark', true);
  // accept: the sheet and the confirmation count the same total
  await tid(page, 'q2-accept').click();
  await tid(page, 'q2-accept-sheet').waitFor();
  const [one] = await firstFreeSlots(page, 1);
  await pickSlot(page, one);
  await tid(page, 'q2-slot-continue').click();
  check('the confirm step shows £1,214', /£1,214/.test(await txt(page, 'q2-accept-sheet')) && !/£1,914/.test(await txt(page, 'q2-accept-sheet')));
  await tid(page, 'q2-slot-confirm').click();
  await tid(page, 'q2-confirm').waitFor({ timeout: WAIT });
  check('the confirmation shows £1,214 as the total, and the quote read again lists the extras apart', (await txt(page, 'q2-total')) === '£1,214' && /Possible extras, quoted separately/.test(await page.evaluate(() => document.querySelector('[data-testid="q2-quote-disclosure"]').textContent)));

  // A quote left with the default note shows no note of the owner's (the default is not his writing).
  const idDefault = await makeQuote(page, { name: 'Default Note', notes: null });
  const stored = await quoteInStore(page, idDefault);
  await open(page, idDefault);
  await tid(page, 'q2-total').waitFor();
  check('a quote that still carries the default "Sample terms: ..." note shows no "Notes from" card (the tagged idea block says it)', /^Sample terms/.test(stored.notes) && (await tid(page, 'q2-notes-card').count()) === 0, stored.notes);

  // The hero is flat paper: no tint, no mask, no gradient, no watermark, no shadow, no bolt.
  check('the hero is flat paper in the page colour: no background image, no gradient, no pseudo-element art, no shadow, and no hero-wiring picture on the page', await page.evaluate(() => {
    const hero = document.querySelector('.q2-hero');
    const cs = getComputedStyle(hero);
    const before = getComputedStyle(hero, '::before');
    return cs.backgroundImage === 'none' && cs.boxShadow === 'none' && before.content === 'none' && cs.backgroundColor === getComputedStyle(document.body).backgroundColor && !document.documentElement.outerHTML.includes('hero-wiring');
  }));

  // "Show: With ideas | Only my content" (on a quote that is still open: the one just accepted shows the confirmation instead)
  await open(page, idDefault);
  await tid(page, 'q2-total').waitFor();
  const ideasState = () => page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-clean'), stored: (() => { try { return localStorage.getItem('ec_clean'); } catch (e) { return 'blocked'; } })(), pressed: document.querySelector('[data-testid="ideas-only"]').getAttribute('aria-pressed') }));
  const visibleText = () => page.evaluate(() => document.getElementById('app').innerText);
  const st0 = await ideasState();
  check('D1: the default is "With ideas" (no data-clean on <html>); the sample terms and their tag show', !st0.attr && st0.pressed === 'false' && /\bTerms\b/.test(await visibleText()) && /Payment\. Due when/.test(await visibleText()) && !/\(Daniel sets these\)|Example:/.test(await visibleText()) && /Idea from us, not on your site today/.test(await visibleText()));
  await tid(page, 'ideas-only').click();
  const st1 = await ideasState();
  const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-proto]')].every((el) => el.getClientRects().length === 0));
  check('D1: "Only my content" sets <html data-clean>, remembers it per device in localStorage ec_clean, and hides EVERY [data-proto]', st1.attr === '1' && st1.stored === '1' && st1.pressed === 'true' && hidden, JSON.stringify(st1));
  const clean1 = await visibleText();
  check('D1: in "Only my content" the page shows no sample terms, no idea tag and no payment term, but still the total, the lines and Accept', !/Terms|Idea from us|pay after|SAMPLE PRICE|Due when/i.test(clean1) && /£1,286|£1,214/.test(clean1) && (await tid(page, 'q2-accept').isVisible()));
  await page.reload({ waitUntil: 'load' });
  await tid(page, 'q2-total').waitFor();
  const st2 = await ideasState();
  check('D1: the choice survives a reload (before the first paint: <html data-clean> is already set)', st2.attr === '1' && st2.pressed === 'true' && !/Payment\. Due when/.test(await visibleText()), JSON.stringify(st2));
  check('D1: the strip itself is still there in "Only my content" (it holds the way back)', await tid(page, 'ideas-with').isVisible() && await tid(page, 'prototype-tools').isVisible());
  await tid(page, 'ideas-with').click();
  const st3 = await ideasState();
  check('D1: "With ideas" brings them back and is remembered', !st3.attr && st3.stored === '0' && /\bTerms\b/.test(await visibleText()) && /Payment\. Due when/.test(await visibleText()), JSON.stringify(st3));
  check('no console errors', clean(log), dump(log));
  await ctx.close();

  // The same quote read from its link on another phone: the extras travel, and so does the total.
  const ctxA = await newContext(MOBILE);
  const a = await ctxA.newPage();
  await openBlank(a);
  const idL = await makeQuote(a, { name: 'Gavin Rooney', lines: EXTRA_LINES });
  const linkL = await sentLink(a, idL);
  await ctxA.close();
  const ctxB = await newContext(MOBILE);
  const b = await ctxB.newPage();
  const logB = watch(b);
  await b.goto(withClock(linkL), { waitUntil: 'load' });
  await tid(b, 'q2-total').waitFor({ timeout: WAIT });
  check('link mode: the same split (fixed lines and total, then the possible extras apart)', (await attr(b, 'q2-page', 'data-mode')) === 'link' && (await txt(b, 'q2-total')) === '£1,214' && (await tid(b, 'q2-line').count()) === 3 && (await tid(b, 'q2-extra').count()) === 3, await txt(b, 'q2-total'));
  check('link mode: the finished quiet footer and no "pencilled" / "provisional" anywhere', !/pencilled|provisional/i.test(await txt(b, 'q2-page')) && /Serving Northern Ireland/.test(await txt(b, 'q2-footer')));
  check('link mode: no console errors', clean(logB), dump(logB));
  await ctxB.close();
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
