// tests/e2e/handoff-journey.mjs: the WHOLE two-phone loop of docs/V4-HANDOFF.md, end to end, with SEPARATE browser contexts (no shared storage):
//
//   customer phone: funnel -> "Send my enquiry on WhatsApp" (a real wa.me address) ......................... (section 1)
//   Daniel's phone: taps the link in that message -> Import screen -> "Add to my dashboard" (idempotent) ............... (section 2)
//   Daniel's phone: builds and sends a quote (the test reads the quote link from the send sheet, not from wa.me) ...... (section 3)
//   customer phone: opens the quote link (link mode), "Which days suit you?", opens WhatsApp with the reply ........... (section 4)
//   Daniel's phone: taps the reply link -> "Mark quote accepted and plan the install" -> Pipeline, Accepted -> he plans
//                   and confirms the install day ................................................................... (section 5)
//   a second customer on a third phone declines ............................................................ (section 6)
//   tampered, cut-off and wrong-kind links, an acceptance for a quote Daniel does not hold, the same link twice ........ (section 7)
//
// The only thing the test stands in for is WhatsApp itself: wa.me is not reachable from the sandbox (and a test must never message anyone),
// so a tab that opens WhatsApp lands on a stand-in page and the test reads the address and the message text from that tab, exactly what a
// person's WhatsApp would receive. Every link a person would tap is taken from those messages.
//
//   node tests/e2e/handoff-journey.mjs
//   BASE_URL=http://127.0.0.1:4178 node tests/e2e/handoff-journey.mjs
//   QA_DEPS_DIR=/path/with/node_modules node tests/e2e/handoff-journey.mjs     (must contain playwright-core; axe-core is used when present)
//   CHROMIUM_PATH=/path/to/chrome   SHOTS_DIR=/some/dir (optional screenshots)   ONLY=3 (runs the sections whose name starts with 3; later ones need earlier ones)
//
// Exits 0 when every check passes, 1 otherwise. The clock is frozen with ?now=2026-10-23T20:30&freeze=1 (a Friday evening) on every page.
// Owner: Q4.
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
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + String(extra).slice(0, 400) + ']' : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAIT = 12000;
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
  try { await fn(); } catch (e) {
    failures += 1;
    const at = String(e && e.stack ? e.stack : '').match(/handoff-journey\.mjs:(\d+)/);
    console.log('  FAIL ' + name + ' threw: ' + (e && e.message ? e.message.split('\n')[0] : e) + (at ? ` (line ${at[1]})` : ''));
  }
}

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

/** One PHONE: its own browser context, so its own localStorage. Nothing is shared between two of these. */
async function newPhone(vp = MOBILE, scheme = 'dark') {
  const ctx = await browser.newContext({
    viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: scheme,
    isMobile: vp.width < 600, hasTouch: vp.width < 600, permissions: ['clipboard-read', 'clipboard-write']
  });
  // His pictures live on two external hosts the sandbox cannot reach: every request to them is answered with a stand-in.
  await ctx.route((u) => IMG_HOSTS.has(u.hostname), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
  // WhatsApp: a tab that opens wa.me lands on a stand-in page; the test reads its address.
  await ctx.route((u) => u.hostname === 'wa.me', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp stand-in</title><p>WhatsApp stand-in</p>' }));
  return ctx;
}

/** Everything that should stay empty: console errors and warnings, page errors, off-site and failed requests. */
function watch(page, label) {
  const log = { errors: [], offsite: [], failed: [], label };
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
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const hashOf = (link) => link.slice(link.indexOf('#'));
const storeOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vm_state_v1')); } catch (e) { return null; } });
const bookingNamed = async (page, name) => ((await storeOf(page)).bookings || []).filter((b) => b.customer && b.customer.name === name);
const quoteFor = async (page, bookingId) => Object.values((await storeOf(page)).quotes || {}).find((q) => q.bookingId === bookingId) || null;
async function axeSerious(page) {
  if (!AXE_SOURCE) return { count: 0, detail: 'axe-core not installed' };
  await page.evaluate(AXE_SOURCE);
  const res = await page.evaluate(async () => {
    const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return out.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ' x' + v.nodes.length + ' ' + v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; '));
  });
  return { count: res.length, detail: res.join(' | ') };
}

/** Tap a link that opens WhatsApp in a new tab: that tab's address (wa.me/<digits>?text=...), the message text and the link at its end. */
async function tapWhatsApp(ctx, page, testId) {
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: WAIT }), tid(page, testId).click()]);
  await pop.waitForURL((u) => u.hostname === 'wa.me', { timeout: WAIT });
  const url = pop.url();
  await pop.close().catch(() => {});
  const u = new URL(url);
  const text = u.searchParams.get('text') || '';
  return { url, host: u.hostname, path: u.pathname, text, link: (text.match(/https?:\/\/\S+$/) || [''])[0] };
}

// The two customers (each on their own phone) and what they type.
const AOIFE = { name: 'Aoife Ní Mhaoláin', first: 'Aoife', phone: '07700 900231', email: 'aoife@example.com', postcode: 'BT9 6QP', note: 'Café side wall, about 8 m of cable. Budget ≈ £1.5k.' };
const SEAN = { name: 'Seán Ó Briain', first: 'Seán', phone: '07700 900455', email: 'sean@example.com', postcode: 'BT7 3AB', note: '' };
const ANSWERS = [['parking', 'driveway'], ['vehicle', 'ordered'], ['timing', 'asap'], ['permission', 'yes']];

/** The funnel on a customer's phone, to the confirmation. */
async function submitEnquiry(page, who) {
  await page.goto(`${BASE}/index.html?${CLOCK}#book/ev_quote`, { waitUntil: 'load' });
  await tid(page, 'funnel-postcode').waitFor({ timeout: WAIT });
  await tid(page, 'funnel-postcode').fill(who.postcode);
  await tid(page, 'funnel-continue').click();
  for (const [key, value] of ANSWERS) {
    await tid(page, `funnel-option-${key}-${value}`).waitFor({ timeout: WAIT });
    await tid(page, `funnel-option-${key}-${value}`).click();
  }
  await tid(page, 'funnel-step-6').waitFor({ timeout: WAIT });
  await tid(page, 'field-name').fill(who.name);
  await tid(page, 'field-phone').fill(who.phone);
  await tid(page, 'funnel-email').fill(who.email);
  if (who.note) await tid(page, 'field-note').fill(who.note);
  await tid(page, 'funnel-submit').click();
  await tid(page, 'confirmation').waitFor({ timeout: WAIT });
}

/** The Pipeline shows one stage at a time on a phone (tabs) and every stage as a column on a wide screen: make sure `id` is the one on show. */
async function showStage(page, id) {
  await tid(page, 'p1-pipeline').waitFor({ timeout: WAIT });
  if (await tid(page, `p1-stage-${id}`).count()) { await tid(page, `p1-stage-${id}`).click(); await sleep(250); }
}

/** A link taken from a WhatsApp message, opened on Daniel's phone as a fresh page load (the way tapping it in WhatsApp does). */
async function openImport(page, link) {
  await page.goto('about:blank');
  await page.goto(`${BASE}/dashboard.html?${CLOCK}${hashOf(link)}`, { waitUntil: 'load' });
  await tid(page, 'f4-view').waitFor({ timeout: WAIT });
}
/** Daniel writes a quote for an enquiry he holds, from the Quotes screen, and sends it: resolves { quoteId, link, sent } with the link read off the send sheet. */
async function writeAndSendQuote(phone, page, bookingId, { notes } = {}) {
  await page.evaluate(() => { location.hash = '#/quotes'; });
  await tid(page, 'q1-new').waitFor({ timeout: WAIT });
  await tid(page, 'q1-new').click();
  await tid(page, `q1-pick-${bookingId}`).click();
  await tid(page, 'q1-builder').waitFor({ timeout: WAIT });
  const quoteId = decodeURIComponent((await page.evaluate(() => location.hash)).split('/quotes/')[1].split('?')[0]);
  if (notes) { await tid(page, 'q1-notes').fill(notes); await sleep(500); }
  await tid(page, 'q1-send').click();
  await tid(page, 'q1-send-sheet').waitFor({ timeout: WAIT });
  const link = (await page.locator('[data-testid="q1-send-preview"] a.ui-bubble__link').getAttribute('href')) || '';
  const sent = await tapWhatsApp(phone, page, 'q1-send-whatsapp'); // Daniel's own WhatsApp opens with the message; the test only closes it
  await sleep(300);
  return { quoteId, link, sent };
}

// ================================================================ the phones
const customerA = await newPhone(); // Aoife's phone
const danielPhone = await newPhone(); // Daniel's phone
const a = await customerA.newPage();
const d = await danielPhone.newPage();
const logA = watch(a, 'Aoife');
const logD = watch(d, 'Daniel');
const state = {}; // what one section hands to the next

// ================================================================ 1. the customer's enquiry becomes a WhatsApp message
await section('1. Aoife finishes the funnel and sends her enquiry to Daniel on WhatsApp', async () => {
  await submitEnquiry(a, AOIFE);
  check('the confirmation offers "Send my enquiry on WhatsApp" as the primary button', /Send my enquiry on WhatsApp/.test(await txt(a, 'wa-send')) && (await tid(a, 'wa-send').evaluate((el) => el.classList.contains('ui-btn--primary'))));
  check('the card says honestly that in a live site this is automatic, tagged data-proto', /happens automatically through your funnel's webhook/.test(await txt(a, 'wa-send-note')) && (await attr(a, 'wa-send-note', 'data-proto')) !== null);
  check('before the tap the page does not claim anything reached Daniel', !/\b(sent|delivered)\b/i.test((await txt(a, 'wa-send-text')).replace(/press send/i, '')), await txt(a, 'wa-send-text'));
  await shot(a, 'journey-1-confirmation-375-dark', true);
  const sent = await tapWhatsApp(customerA, a, 'wa-send');
  state.enqText = sent.text;
  state.enqLink = sent.link;
  check('it opens a real wa.me address to Daniel\'s number', sent.host === 'wa.me' && sent.path === '/447885496800', sent.url.slice(0, 90));
  check('the message lists who, mobile, email, postcode and the five answers in plain words',
    sent.text.includes(`it's ${AOIFE.name}`) && sent.text.includes(`Mobile: ${AOIFE.phone}`) && sent.text.includes(`Email: ${AOIFE.email}`) && sent.text.includes(`Postcode: ${AOIFE.postcode}`)
    && /Parking: Private driveway/.test(sent.text) && /Electric car: It's ordered or arriving soon/.test(sent.text) && /Timing: As soon as possible/.test(sent.text) && /Permission to install: Yes/.test(sent.text), sent.text.slice(0, 500));
  check('the notes survive, accents and symbols included', sent.text.includes(AOIFE.note), sent.text.slice(0, 600));
  check('it ends with the link Daniel taps: dashboard.html#import=<payload>, a sensible length', /dashboard\.html#import=[A-Za-z0-9_-]+$/.test(sent.link) && sent.link.length < 1400, `${sent.link.length}`);
  check('the card then says "Opened in WhatsApp" (never "sent") and offers to open it again', await until(async () => (await attr(a, 'wa-send-card', 'data-state')) === 'opened') && /Opened in WhatsApp/.test((await tid(a, 'wa-send-title').textContent()) || '') && (await tid(a, 'wa-send-again').count()) === 1);
  const mine = await bookingNamed(a, AOIFE.name);
  check('the enquiry is also saved in Aoife\'s own browser, as before', mine.length === 1 && mine[0].ref === 'EL-1043', JSON.stringify(mine.map((b) => b.ref)));
  state.ref = mine[0] ? mine[0].ref : '';
  check('Aoife\'s phone: no console errors, off-site or failed requests', clean(logA), dump(logA));
});

// ================================================================ 2. Daniel taps the link
await section('2. Daniel taps the link in WhatsApp: the Import screen, then "Add to my dashboard"', async () => {
  const before = await (async () => { await d.goto(`${BASE}/dashboard.html?${CLOCK}#/today`, { waitUntil: 'load' }); await tid(d, 'view-title').waitFor({ timeout: WAIT }); return storeOf(d); })();
  state.daniel0 = (before.bookings || []).length;
  check('Daniel\'s phone starts with its own demo diary and no sign of Aoife', (await bookingNamed(d, AOIFE.name)).length === 0 && state.daniel0 > 5, `${state.daniel0}`);
  await openImport(d, state.enqLink);
  check('the link opens the Import screen, even on a fresh browser', /#\/import\?d=/.test(await d.evaluate(() => location.hash)) && (await attr(d, 'f4-view', 'data-state')) !== 'error', await d.evaluate(() => location.hash.slice(0, 40)));
  check('it shows exactly what Aoife entered: name, mobile, postcode, and the answers in Daniel\'s words', await (async () => {
    const t = await txt(d, 'f4-view');
    return t.includes(AOIFE.name) && t.includes(AOIFE.phone) && t.includes('BT9 6QP') && /Private driveway/.test(t) && /ordered or arriving soon/.test(t) && /As soon as possible/.test(t);
  })(), await txt(d, 'f4-view'));
  check('and her notes and the source ("Received via WhatsApp link")', (await txt(d, 'f4-notes')).includes(AOIFE.note) && /Received via WhatsApp link/.test(await txt(d, 'f4-received-tag')), await txt(d, 'f4-notes'));
  check('reading it adds nothing: the page is a preview until Daniel taps', (await bookingNamed(d, AOIFE.name)).length === 0);
  check('Import screen: no horizontal overflow', await noOverflow(d));
  await shot(d, 'journey-2-import-enquiry-375-dark', true);
  await tid(d, 'f4-add').click();
  await tid(d, 'f4-success').waitFor({ timeout: WAIT });
  const mine = await bookingNamed(d, AOIFE.name);
  const b = mine[0];
  state.enqBookingId = b ? b.id : '';
  check('"Add to my dashboard" creates ONE enquiry in Daniel\'s store, with her accents intact', mine.length === 1 && b.customer.name === AOIFE.name && b.customer.phone === AOIFE.phone && b.address.postcode === AOIFE.postcode, JSON.stringify(mine.map((x) => x.customer)));
  check('it is a website enquiry with her answers, notes and a pencilled survey slot from HIS diary', !!b && b.source === 'website' && b.serviceId === 'ev_quote' && b.answers.parking === 'driveway' && b.answers.vehicle === 'ordered' && b.notes === AOIFE.note && b.tentative === true && !!b.start, b ? JSON.stringify({ s: b.source, t: b.tentative, st: b.start }) : '');
  check('the 24 hour reply clock runs from when she sent it (Fri 23 Oct 20:30), and he keeps her reference', !!b && b.createdAt === '2026-10-23T20:30' && b.ref === state.ref, b ? `${b.createdAt} ${b.ref}` : '');
  const st = await storeOf(d);
  check('the simulated owner alert and customer message were logged, like a website enquiry', st.messages.some((m) => m.bookingId === state.enqBookingId && m.kind === 'owner_new_booking') && st.messages.some((m) => m.bookingId === state.enqBookingId && m.kind === 'customer_received'));
  check('success state links on to the enquiry and says what happens next', (await tid(d, 'f4-open').count()) === 1 && /24/.test(await txt(d, 'f4-success-sla')), await txt(d, 'f4-success'));
  await shot(d, 'journey-2-import-added-375-dark', true);
  // The same link again (Daniel taps it twice, or the customer sends it twice).
  await openImport(d, state.enqLink);
  check('tapping the same link a second time adds nothing (idempotent): it says it is already on the dashboard', (await bookingNamed(d, AOIFE.name)).length === 1 && (await tid(d, 'f4-existing').count()) === 1, await txt(d, 'f4-view'));
  check('and offers to open the enquiry it already made', (await tid(d, 'f4-existing-open').count()) === 1 || (await tid(d, 'f4-open').count()) === 1);
  check('Daniel\'s bookings grew by exactly one (plus nothing else)', ((await storeOf(d)).bookings || []).length === state.daniel0 + 1, `${((await storeOf(d)).bookings || []).length} vs ${state.daniel0}`);
  check('Daniel\'s phone: no console errors, off-site or failed requests', clean(logD), dump(logD));
});

// ================================================================ 3. Daniel builds and sends a quote
await section('3. Daniel builds a quote and sends it (the link is read from the send sheet)', async () => {
  await d.goto(`${BASE}/dashboard.html?${CLOCK}#/quotes`, { waitUntil: 'load' });
  const made = await writeAndSendQuote(danielPhone, d, state.enqBookingId, { notes: 'Cable route agreed on the survey, café side.' });
  state.quoteId = made.quoteId;
  state.quoteLink = made.link;
  check('the quote takes the enquiry\'s reference: Q-EL-1043', made.quoteId === `Q-${state.ref}`, made.quoteId);
  check('the send sheet\'s link is the self-contained quote.html#d=<payload>, under 1,800 characters', /quote\.html#d=[A-Za-z0-9_-]+$/.test(made.link) && made.link.length < 1800, `${made.link.length} ${made.link.slice(0, 60)}`);
  check('that is the link inside the WhatsApp message Daniel opens too', made.sent.text.includes(made.link), made.sent.text.slice(0, 300));
  const st = await storeOf(d);
  const q = st.quotes[made.quoteId];
  state.total = q ? q.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0) : 0;
  check('the quote is marked sent in Daniel\'s store, and the simulated message carries the same link', !!q && q.status === 'sent' && st.messages.some((m) => m.kind === 'customer_quote_sent' && m.bookingId === state.enqBookingId && m.body.includes(made.link)), q ? q.status : 'no quote');
  check('Daniel\'s phone: no console errors, off-site or failed requests', clean(logD), dump(logD));
});

// ================================================================ 4. the customer opens the quote link on her phone
await section('4. Aoife opens the quote link on her own phone (link mode) and accepts with the days that suit her', async () => {
  await a.goto(`${BASE}/quote.html?${CLOCK}${hashOf(state.quoteLink)}`, { waitUntil: 'load' });
  await tid(a, 'q2-page').waitFor({ timeout: WAIT });
  const money = `£${state.total.toLocaleString('en-GB')}`;
  check('the quote renders from the link alone, in link mode', (await attr(a, 'q2-page', 'data-state')) === 'open' && (await attr(a, 'q2-page', 'data-mode')) === 'link' && (await txt(a, 'q2-greeting')).toLowerCase() === `Hi ${AOIFE.first},`.toLowerCase());
  check('the reference, the total, the lines and Daniel\'s own notes are all there', (await txt(a, 'q2-ref')) === state.quoteId && (await txt(a, 'q2-total')) === money && (await tid(a, 'q2-line').count()) >= 3 && /Cable route agreed on the survey, café side\./.test(await txt(a, 'q2-notes')), `${await txt(a, 'q2-total')} ${await txt(a, 'q2-notes')}`);
  check('it says "Prototype: sample prices" and carries the credentials, call and WhatsApp', /Prototype: sample prices/.test(await txt(a, 'q2-sample-note')) && /Level 3/.test(await txt(a, 'q2-credentials')) && (await attr(a, 'q2-call', 'href')) === 'tel:+447885496800');
  check('opening it wrote nothing to Aoife\'s store, and Daniel\'s phone cannot know she looked (still "sent", not "viewed")', !((await storeOf(a)).quotes || {})[state.quoteId] && (await storeOf(d)).quotes[state.quoteId].status === 'sent');
  await shot(a, 'journey-4-quote-link-375-dark', true);
  await tid(a, 'q2-accept').click();
  await tid(a, 'q2-days-sheet').waitFor({ timeout: WAIT });
  await tid(a, 'q2-pday-thu').click();
  await tid(a, 'q2-pday-fri').click();
  await tid(a, 'q2-ppart-am').click();
  await tid(a, 'q2-days-note').fill('Please ring first, the gate sticks.');
  await sleep(400);
  await shot(a, 'journey-4-days-375-dark');
  const sent = await tapWhatsApp(customerA, a, 'q2-reply-open');
  state.accText = sent.text;
  state.accLink = sent.link;
  check('Accept opens a real WhatsApp message to Daniel with the quote, the total, the days and her note', sent.path === '/447885496800' && sent.text.includes(`quote ${state.quoteId} (${money})`) && /Best: Thu or Fri mornings\./.test(sent.text) && sent.text.includes('Note: Please ring first, the gate sticks.'), sent.text.slice(0, 300));
  check('and ends with the link Daniel taps to add her reply to his dashboard', /dashboard\.html#import=[A-Za-z0-9_-]+$/.test(sent.link) && sent.link.length < 900, `${sent.link.length}`);
  await tid(a, 'q2-reply-sent').waitFor({ timeout: WAIT });
  check('the page then shows the calm "Your message is ready in WhatsApp. Tap send and we will confirm your install day"', /Your message is ready in WhatsApp/.test(await txt(a, 'q2-sent-title')) && /Tap send and we will confirm your install day\./.test(await txt(a, 'q2-reply-sent')));
  check('nothing claims it was sent, and there are Copy message and Open WhatsApp again fallbacks', !/(has|was|been) sent\b/i.test(await txt(a, 'q2-reply-sent')) && (await tid(a, 'q2-copy').count()) === 1 && (await tid(a, 'q2-reopen').count()) === 1);
  check('Aoife\'s store holds no accepted quote (the only thing that left her phone is the WhatsApp message)', !((await storeOf(a)).quotes || {})[state.quoteId] && (await storeOf(d)).quotes[state.quoteId].status === 'sent');
  await shot(a, 'journey-4-ready-375-dark', true);
  check('Aoife\'s phone: no console errors, off-site or failed requests', clean(logA), dump(logA));
});

// ================================================================ 5. Daniel taps the reply link
await section('5. Daniel taps her reply: "Mark quote accepted and plan the install", then the Pipeline, then he confirms the day', async () => {
  await openImport(d, state.accLink);
  const money = `£${state.total.toLocaleString('en-GB')}`;
  check('the Import screen says who accepted what, for how much, and which days suit', (await txt(d, 'f4-summary')).includes(`${AOIFE.first} accepted quote ${state.quoteId} (${money}), prefers Thu/Fri mornings`), await txt(d, 'f4-summary'));
  check('it shows her days, the time of day, her note and the total she accepted', /Thu or Fri mornings/.test(await txt(d, 'f4-view')) && (await txt(d, 'f4-view')).includes('Please ring first, the gate sticks.') && (await txt(d, 'f4-view')).includes(money), await txt(d, 'f4-view'));
  check('the button is "Mark quote accepted and plan the install"', /Mark quote accepted and plan the install/.test(await txt(d, 'f4-add')), await txt(d, 'f4-add'));
  check('reading it changed nothing yet', (await storeOf(d)).quotes[state.quoteId].status === 'sent');
  await shot(d, 'journey-5-import-acceptance-375-dark', true);
  await tid(d, 'f4-add').click();
  await tid(d, 'f4-success').waitFor({ timeout: WAIT });
  let st = await storeOf(d);
  const q = st.quotes[state.quoteId];
  const install = (st.bookings || []).find((b) => b.id === q.installBookingId);
  state.installId = install ? install.id : '';
  check('the quote is accepted in Daniel\'s store, through WhatsApp', q.status === 'accepted' && q.acceptedVia === 'whatsapp' && !!q.acceptedAt, `${q.status} ${q.acceptedVia}`);
  check('an install booking exists with NO day yet (status new, not pencilled) and her preferences in its notes', !!install && install.serviceId === 'ev' && install.status === 'new' && !install.tentative && /Thu or Fri mornings/.test(install.notes) && /Please ring first, the gate sticks\./.test(install.notes) && install.quotedPrice === state.total, install ? JSON.stringify({ s: install.status, t: install.tentative, n: install.notes }) : 'no install');
  await shot(d, 'journey-5-accepted-375-dark', true);
  // The Pipeline shows it under Accepted.
  await d.evaluate(() => { location.hash = '#/pipeline'; });
  await tid(d, 'p1-pipeline').waitFor({ timeout: WAIT });
  await showStage(d, 'accepted');
  const panel = (await txt(d, 'p1-panel')) || (await d.evaluate(() => { const c = document.querySelector('[data-testid="p1-col-accepted"]'); return c ? c.innerText.replace(/\s+/g, ' ') : ''; }));
  check('the Pipeline shows the new install under Accepted', (await tid(d, `p1-card-${state.enqBookingId}`).count()) === 1 && /Aoife/.test(panel), panel.slice(0, 240));
  check('with the "Confirm the install day" action', /Confirm the install day/.test(await txt(d, `p1-action-${state.enqBookingId}`)), await txt(d, `p1-action-${state.enqBookingId}`));
  await shot(d, 'journey-5-pipeline-375-dark', true);
  // The booking carries the preferences.
  await d.evaluate((id) => { location.hash = `#/bookings/${id}`; }, state.installId);
  await tid(d, 'booking-detail').waitFor({ timeout: WAIT });
  check('opening the install shows "To be arranged" and her preferences', /To be arranged/.test(await txt(d, 'booking-detail')) && /Install preferences: Thu or Fri mornings/.test(await txt(d, 'booking-detail')), (await txt(d, 'booking-detail')).slice(0, 300));
  // "Confirm install day" on an install with no day yet opens the day picker (it used to fail with a generic "did not work" toast).
  await tid(d, 'job-primary').click();
  await tid(d, 'reschedule-sheet').waitFor({ timeout: WAIT });
  check('"Confirm install day" on an install with no day opens the day picker ("Choose a day", "Set this day"), not an error toast', /Choose a day/.test(await txt(d, 'reschedule-sheet')) && /Set this day/.test(await txt(d, 'reschedule-submit')) && (await d.locator('.ui-toast', { hasText: 'did not work' }).count()) === 0, await txt(d, 'reschedule-sheet'));
  await d.keyboard.press('Escape');
  await until(async () => (await tid(d, 'reschedule-sheet').count()) === 0);
  check('and the install is still waiting for a day (nothing was confirmed by that tap)', ((await storeOf(d)).bookings.find((b) => b.id === state.installId) || {}).status === 'new');
  // Daniel agrees a day with her (he moves it into his diary), then confirms it.
  await tid(d, 'detail-overflow').click();
  await tid(d, 'job-secondary-reschedule').click();
  await tid(d, 'reschedule-sheet').waitFor({ timeout: WAIT });
  // He tries days from the top of the picker until one takes the whole half-day (the sheet offers free two-hour windows; an install needs both halves).
  let placed = false;
  const dayIds = await d.locator('[data-testid^="reschedule-day-"]:not([disabled])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  for (const dayId of dayIds.slice(0, 8)) {
    await tid(d, dayId).click();
    const wins = await d.locator('[data-testid^="reschedule-window-"]:not([disabled])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    for (const winId of wins) {
      await tid(d, winId).click();
      await tid(d, 'reschedule-submit').click();
      placed = !!(await until(async () => (await tid(d, 'reschedule-sheet').count()) === 0, 1500));
      if (placed) break;
    }
    if (placed) break;
  }
  if (!placed) { await shot(d, 'journey-5-reschedule-stuck'); throw new Error('Daniel could not place the install in any free window'); }
  st = await storeOf(d);
  let inst = st.bookings.find((b) => b.id === state.installId);
  check('he can place it in his diary (a day, a window)', !!inst && inst.durationMin > 0 && inst.status === 'new', inst ? JSON.stringify({ s: inst.start, dur: inst.durationMin, st: inst.status }) : '');
  await tid(d, 'job-primary').click();
  await until(async () => ((await storeOf(d)).bookings.find((b) => b.id === state.installId) || {}).status === 'confirmed');
  st = await storeOf(d);
  inst = st.bookings.find((b) => b.id === state.installId);
  check('"Confirm install day" confirms it, and Aoife is told (simulated)', inst.status === 'confirmed' && st.messages.some((m) => m.bookingId === state.installId && /confirm/i.test(m.kind)), inst.status);
  await d.evaluate(() => { location.hash = '#/pipeline'; });
  await tid(d, 'p1-pipeline').waitFor({ timeout: WAIT });
  await showStage(d, 'install');
  check('and the install moves on to the Install stage of the Pipeline', (await tid(d, `p1-card-${state.enqBookingId}`).count()) === 1, (await txt(d, 'p1-panel')).slice(0, 200));
  // The same acceptance link again.
  await openImport(d, state.accLink);
  st = await storeOf(d);
  check('tapping her reply a second time changes nothing: still ONE install booking for the quote', st.bookings.filter((b) => b.quoteId === state.quoteId && b.serviceId === 'ev').length === 1 && st.quotes[state.quoteId].status === 'accepted', await txt(d, 'f4-view'));
  check('and the screen says it is already done, with no button that would repeat it', (await tid(d, 'f4-add').count()) === 0 && /already|done/i.test(await txt(d, 'f4-view')), await txt(d, 'f4-view'));
  check('Daniel\'s phone: no console errors, off-site or failed requests', clean(logD), dump(logD));
});

// ================================================================ 6. a decline, from a different customer on a third phone
await section('6. a second customer, on a third phone, declines: the reason travels and Daniel marks it declined', async () => {
  const customerB = await newPhone();
  const b = await customerB.newPage();
  const logB = watch(b, 'Seán');
  await submitEnquiry(b, SEAN);
  const enq = await tapWhatsApp(customerB, b, 'wa-send');
  check('Seán\'s enquiry is a different message with his own details (his phone numbers its enquiry EL-1043 too)', enq.text.includes(SEAN.name) && enq.text.includes(SEAN.phone) && /EL-1043/.test(enq.text) && enq.link !== state.enqLink);
  await openImport(d, enq.link);
  check('Daniel sees Seán\'s enquiry, not Aoife\'s', (await txt(d, 'f4-view')).includes(SEAN.name) && !(await txt(d, 'f4-view')).includes(AOIFE.name));
  await tid(d, 'f4-add').click();
  await tid(d, 'f4-success').waitFor({ timeout: WAIT });
  const seans = await bookingNamed(d, SEAN.name);
  state.seanId = seans[0] ? seans[0].id : '';
  check('he is added as a SECOND enquiry (same reference number from his phone, so Daniel\'s next free one is used), and Aoife\'s is untouched', seans.length === 1 && (await bookingNamed(d, AOIFE.name)).filter((x) => x.serviceId === 'ev_quote').length === 1 && seans[0].ref !== state.ref, JSON.stringify(seans.map((x) => x.ref)));
  const made = await writeAndSendQuote(danielPhone, d, state.seanId);
  check('Daniel writes and sends him a quote with its own number', made.quoteId === `Q-${seans[0].ref}` && made.quoteId !== state.quoteId && /quote\.html#d=/.test(made.link), made.quoteId);
  const total = (await storeOf(d)).quotes[made.quoteId].lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
  await b.goto(`${BASE}/quote.html?${CLOCK}${hashOf(made.link)}`, { waitUntil: 'load' });
  await tid(b, 'q2-page').waitFor({ timeout: WAIT });
  check('Seán opens it on his phone in link mode', (await attr(b, 'q2-page', 'data-mode')) === 'link' && (await txt(b, 'q2-greeting')).toLowerCase() === `Hi ${SEAN.first},`.toLowerCase(), await txt(b, 'q2-greeting'));
  await tid(b, 'q2-decline').click();
  await tid(b, 'q2-decline-sheet').waitFor({ timeout: WAIT });
  await tid(b, 'q2-reason-price').click();
  await tid(b, 'q2-reason-note').fill('Found it cheaper nearby.');
  const dec = await tapWhatsApp(customerB, b, 'q2-decline-whatsapp');
  check('Decline opens WhatsApp with the reason chip and his own words', dec.path === '/447885496800' && dec.text.includes(`quote ${made.quoteId} (£${total.toLocaleString('en-GB')}), but I won't be going ahead this time.`) && dec.text.includes('Reason: Too expensive: Found it cheaper nearby.') && /dashboard\.html#import=/.test(dec.link), dec.text.slice(0, 300));
  await tid(b, 'q2-reply-sent').waitFor({ timeout: WAIT });
  check('his page shows the same calm "ready in WhatsApp" view, worded for a decline', (await attr(b, 'q2-reply-sent', 'data-kind')) === 'dec' && /Tap send so we know/.test(await txt(b, 'q2-reply-sent')));
  await openImport(d, dec.link);
  check('Daniel\'s Import screen: "Seán declined quote ... (Too expensive)" with the note', (await txt(d, 'f4-summary')).includes(`${SEAN.first} declined quote ${made.quoteId} (Too expensive)`) && (await txt(d, 'f4-view')).includes('Found it cheaper nearby.'), await txt(d, 'f4-summary'));
  await tid(d, 'f4-add').click();
  await tid(d, 'f4-success').waitFor({ timeout: WAIT });
  const q = (await storeOf(d)).quotes[made.quoteId];
  check('the quote is declined in Daniel\'s store with the reason, through WhatsApp; Aoife\'s accepted quote is untouched', q.status === 'declined' && q.declinedVia === 'whatsapp' && /Too expensive: Found it cheaper nearby\./.test(q.declineReason) && (await storeOf(d)).quotes[state.quoteId].status === 'accepted', JSON.stringify([q.status, q.declineReason]));
  await openImport(d, dec.link);
  check('the same decline again changes nothing and says so', (await storeOf(d)).quotes[made.quoteId].status === 'declined' && (await tid(d, 'f4-add').count()) === 0, await txt(d, 'f4-view'));
  await shot(d, 'journey-6-declined-375-dark', true);
  check('Seán\'s and Daniel\'s phones: no console errors, off-site or failed requests', clean(logB) && clean(logD), dump(logB) + dump(logD));
  await customerB.close();
});

// ================================================================ 7. damaged, wrong and unmatched links
await section('7. a tampered link, a cut-off link, the wrong kind of link, and a reply for a quote Daniel does not hold', async () => {
  const bookingsBefore = ((await storeOf(d)).bookings || []).length;
  const tampered = state.enqLink.replace(/(#import=.{50})(.)/, (m, p, ch) => p + (ch === 'A' ? 'B' : 'A'));
  await openImport(d, tampered);
  check('a link with one character changed shows a calm "cut off or damaged" state and nothing else', (await attr(d, 'f4-view', 'data-state')) === 'error' && /cut off or damaged|damaged/i.test(await txt(d, 'f4-error-message')) && (await tid(d, 'f4-add').count()) === 0, await txt(d, 'f4-view'));
  check('and says nothing was added', (await tid(d, 'f4-error-nothing').count()) === 1 || /nothing was (added|changed)/i.test(await txt(d, 'f4-view')), await txt(d, 'f4-view'));
  await shot(d, 'journey-7-tampered-375-dark', true);
  await openImport(d, state.enqLink.slice(0, -14));
  check('a cut-off link is the same calm state', (await attr(d, 'f4-view', 'data-state')) === 'error' && (await tid(d, 'f4-add').count()) === 0, await txt(d, 'f4-view'));
  await d.goto('about:blank');
  await d.goto(`${BASE}/dashboard.html?${CLOCK}#import=not-a-real-payload`, { waitUntil: 'load' });
  await tid(d, 'f4-view').waitFor({ timeout: WAIT });
  check('garbage after #import= is calm too', (await attr(d, 'f4-view', 'data-state')) === 'error' && (await tid(d, 'f4-add').count()) === 0);
  await openImport(d, state.quoteLink.replace('quote.html#d=', 'dashboard.html#import='));
  check('a QUOTE link opened as an import says what it is and offers the customer view (it is not an enquiry)', (await tid(d, 'f4-add').count()) === 0 && ((await attr(d, 'f4-view', 'data-state')) === 'quote-link' || (await tid(d, 'f4-wrong-kind').count()) === 1), await txt(d, 'f4-view'));
  check('none of that added a booking', ((await storeOf(d)).bookings || []).length === bookingsBefore);
  // The customer's side: a tampered quote link.
  await a.goto(`${BASE}/quote.html?${CLOCK}${hashOf(state.quoteLink).replace(/(#d=.{40})(.)/, (m, p, ch) => p + (ch === 'A' ? 'B' : 'A'))}`, { waitUntil: 'load' });
  await tid(a, 'q2-page').waitFor({ timeout: WAIT });
  check('a tampered QUOTE link on the customer\'s phone is refused, in plain words, with Call and WhatsApp to get it sent again', (await attr(a, 'q2-page', 'data-state')) === 'invalid' && /cut short or damaged/.test(await txt(a, 'q2-damaged')) && (await tid(a, 'q2-total').count()) === 0 && /^tel:/.test((await attr(a, 'q2-call', 'href')) || ''));
  await shot(a, 'journey-7-quote-tampered-375-dark', true);
  // A reply for a quote Daniel's OTHER phone never held.
  const otherPhone = await newPhone();
  const o = await otherPhone.newPage();
  const logO = watch(o, 'Daniel\'s other phone');
  await openImport(o, state.accLink);
  const heldBefore = ((await storeOf(o)).bookings || []).length;
  check('an acceptance opened on a phone that does not hold the quote says so in plain words, and cannot be applied', (await attr(o, 'f4-view', 'data-state')) === 'blocked' && (await tid(o, 'f4-blocked').count()) === 1 && /isn't on this phone|isn't on this device|don't have quote/i.test(await txt(o, 'f4-blocked')) && (await tid(o, 'f4-add').count()) === 0, await txt(o, 'f4-view'));
  check('and nothing was added there', ((await storeOf(o)).bookings || []).length === heldBefore && !Object.keys((await storeOf(o)).quotes || {}).includes(state.quoteId));
  check('the other phone: no console errors', clean(logO), dump(logO));
  await otherPhone.close();
  // Every phone ends clean.
  check('Aoife\'s phone: no console errors, off-site or failed requests (whole journey)', clean(logA), dump(logA));
  check('Daniel\'s phone: no console errors, off-site or failed requests (whole journey)', clean(logD), dump(logD));
});

// ================================================================ done
await browser.close();
if (server) server.kill();
console.log(`\n${passes} checks passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
