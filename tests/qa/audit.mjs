// tests/qa/audit.mjs: the CONTENT, HONESTY and DOCS gate. Static scans of the source plus a browser pass over every customer page and every dashboard route.
// Self-contained: starts its own static server and Chromium; exits non-zero on any finding. Owner: final audit role.
//
//   QA_DEPS_DIR=/path/with/node_modules node tests/qa/audit.mjs      (must contain playwright-core; the static part needs nothing)
//   STATIC_ONLY=1 node tests/qa/audit.mjs                            (source scans only: no browser)
//   ONLY=3 ...   run the sections whose title starts with this      DUMP=/some/dir   write each page's text to a file for reading
//   CHROMIUM_PATH=/path/to/chrome   BASE_URL=http://127.0.0.1:4213 (use a server that is already running)
//
// What it holds the prototype to (docs/V3-SPEC.md section 0 and 6, docs/V4-HANDOFF.md):
//   1  no leftover old-brand or placeholder strings (Voltmere, VM- refs, Dan, Marchbank, MB postcodes, lorem, old navy and amber colours, EICR-first wording)
//   2  the words pencilled / provisional / tentative are never read by a CUSTOMER (landing, funnel, confirmation, manage, quote page, customer messages, calendar files)
//   3  every invented claim (price, saving, guarantee, payment term, product spec, certificate, insurance, accreditation, years, reviews) sits inside a tagged idea
//      (data-proto plus the "Idea from us" tag) on the public pages
//   4  his own copy from docs/reference/180-site-report.md (hero, three steps, six FAQs, the six funnel steps with options and notes, the confirmation) is present EXACTLY
//   5  everything simulated says so on its own screen and in "What's real"
//   6  phone and email links are his (tel:+447885496800, wa.me/447885496800, mailto:daniel@180electrical.co.uk); page heads, manifest and icons are right
//   7  British English, no em dashes, one money format (£1,934), one date format (Mon 26 Oct), one name (Daniel)
//   8  the docs say what is true (README, DEMO-SCRIPT, PRODUCTION-PLAN, the historical-contract banner)
//
// Findings print as FAIL lines. A DELIBERATE_DEVIATIONS entry is the only way a difference from his site is allowed, and it is printed on every run.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QA_DEPS = process.env.QA_DEPS_DIR || '/tmp/qa';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const CLOCK = 'now=2026-10-23T20:30&freeze=1';
const DUMP = process.env.DUMP || '';
const STATIC_ONLY = !!process.env.STATIC_ONLY;

// ---------------------------------------------------------------- harness
let failures = 0;
let passes = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passes += 1; console.log('  ok   ' + name); } else { failures += 1; console.log('  FAIL ' + name + (extra ? '   [' + String(extra).slice(0, 700) + ']' : '')); }
};
const note = (text) => console.log('  note ' + text);
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
    const at = String(e && e.stack ? e.stack : '').match(/audit\.mjs:(\d+)/);
    console.log('  FAIL ' + name + ' threw: ' + (e && e.message ? e.message.split('\n').slice(0, process.env.VERBOSE ? 12 : 2).join(' | ') : e) + (at ? ` (line ${at[1]})` : ''));
  }
}

// ---------------------------------------------------------------- the one list of allowed differences from his site
// Each is a conscious product decision, printed on every run so it can be challenged. Nothing else may differ.
const DELIBERATE_DEVIATIONS = [
  'Postcode placeholders read "e.g. BT7 3AB" (his own form shows SW1A 1AA and DE1 1AA, a London and a Derby postcode: wrong for a Northern Ireland site).',
  'Extra one-line helpers that are not on his site: why each question is asked, a short hint on each answer, "About 1 minute". They make no claim.',
  'The quote page shows catalogue lines such as "Testing and certification" with a visible SAMPLE PRICE label: they are the owner\'s own editable quote lines, not site copy.'
];

// ---------------------------------------------------------------- files
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { if (e && e.code === 'ENOENT') return ''; throw e; } }; // a file another role removed mid-run reads as empty
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (['.git', 'node_modules', 'vendor', 'fonts', 'tests', 'reference'].includes(ent.name)) continue;
      walk(rel, out);
    } else out.push(rel);
  }
  return out;
}
const ALL = walk('');
const JS = ALL.filter((f) => f.startsWith('js/') && f.endsWith('.js'));
const CSS = ALL.filter((f) => f.startsWith('css/') && f.endsWith('.css'));
const HTML = ALL.filter((f) => /^[^/]+\.html$/.test(f));
const SVG = ALL.filter((f) => f.endsWith('.svg'));
// Docs that must tell the truth today. BUILD-CONTRACT.md is the historical v1 spec (it carries a banner saying so) and is not scanned.
const DOCS = ALL.filter((f) => (f === 'README.md' || (f.startsWith('docs/') && f.endsWith('.md'))) && f !== 'docs/BUILD-CONTRACT.md');

// ---------------------------------------------------------------- a small JS tokenizer: the text a person can read (strings and template text), with line numbers
const decodeEsc = (s) => s
  .replace(/\\u\{([0-9a-fA-F]+)\}/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\([nrt'"`\\$])/g, (m, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c));

/** Strings and template-literal text of a JS source, comments skipped: [{ line, text, tpl }]. */
function jsStrings(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let last = ''; // the last significant token: decides whether a / starts a regular expression
  const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'else', 'do', 'yield', 'await']);
  function template() { // after the opening backtick
    let text = '';
    let start = line;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { text += c + (src[i + 1] || ''); if (src[i + 1] === '\n') line += 1; i += 2; continue; }
      if (c === '`') { i += 1; out.push({ line: start, text: decodeEsc(text), tpl: true }); return; }
      if (c === '$' && src[i + 1] === '{') {
        out.push({ line: start, text: decodeEsc(text), tpl: true });
        text = '';
        i += 2;
        code(true);
        start = line;
        continue;
      }
      if (c === '\n') line += 1;
      text += c;
      i += 1;
    }
  }
  function code(inExpr) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line += 1; i += 1; continue; }
      if (/\s/.test(c)) { i += 1; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line += 1; i += 1; } i += 2; continue; }
      if (c === '"' || c === "'") {
        const q = c;
        const start = line;
        let text = '';
        i += 1;
        while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') { text += src[i] + (src[i + 1] || ''); i += 2; continue; } text += src[i]; i += 1; }
        i += 1;
        out.push({ line: start, text: decodeEsc(text), tpl: false });
        last = '"';
        continue;
      }
      if (c === '`') { i += 1; template(); last = '`'; continue; }
      if (c === '/' && (REGEX_AFTER.has(last) || REGEX_WORDS.has(last))) { // a regular expression literal
        i += 1;
        let inClass = false;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
          i += 1;
        }
        i += 1;
        while (i < n && /[a-z]/i.test(src[i])) i += 1;
        last = '/re/';
        continue;
      }
      if (c === '{') depth += 1;
      if (c === '}') { if (inExpr && depth === 0) { i += 1; return; } depth -= 1; }
      if (/[A-Za-z0-9_$]/.test(c)) {
        let w = '';
        while (i < n && /[A-Za-z0-9_$]/.test(src[i])) { w += src[i]; i += 1; }
        last = w;
        continue;
      }
      last = c;
      i += 1;
    }
  }
  code(false);
  return out;
}

/** Attribute values that are never read by a person (class, ids, test ids, icon names): dropped from template text before scanning prose. */
const stripAttrs = (t) => t.replace(/\b(class|data-testid|id|name|key|for|type|role|href|src|aria-controls|aria-labelledby|aria-describedby|data-[a-z-]+|style|d|viewBox|xmlns|autocomplete|autocapitalize|inputmode|enterkeyhint|titleId)=("[^"]*"|'[^']*')/g, ' ').replace(/\b(center|centre)=/g, ' ');

/** Prose strings of a source: strings with a letter and a space (or template text), CSS-ish and identifier-ish strings dropped. */
function prose(file) {
  return jsStrings(read(file)).map((s) => ({ ...s, text: s.tpl ? stripAttrs(s.text) : s.text })).filter((s) => /[A-Za-z]{2}/.test(s.text) && (/\s/.test(s.text.trim()) || s.tpl) && !/^[\w\s.:;#%(),'"/>-]*[:;{]\s*[\w#.(-]/.test(s.text));
}

// ---------------------------------------------------------------- 1. old brand and placeholders
await section('1. no leftover old-brand or placeholder strings (source, data, docs)', async () => {
  const hits = [];
  const add = (id, file, line, text) => hits.push(`${id} ${file}:${line} ${String(text).trim().slice(0, 100)}`);
  const scanRaw = (file, rules) => {
    read(file).split('\n').forEach((text, k) => { for (const r of rules) if (r.re.test(text) && !(r.allow && r.allow(file, text))) add(r.id, file, k + 1, text); });
  };
  // Raw source (comments too): the old company name and its sample surnames and postcodes must not survive anywhere but the repository slug.
  const slug = (file, text) => !/voltmere/i.test(text.replace(/voltmere-electrical/g, ''));
  const RAW = [
    { id: 'old name "Voltmere"', re: /voltmere/i, allow: slug },
    { id: 'old surname "Marchbank"', re: /marchbank/i },
    { id: 'old reference "VM-"', re: /\bVM-\d/ },
    { id: 'placeholder text', re: /lorem|ipsum|dolor sit amet/i },
    { id: 'old navy/amber brand colour', re: /#(14213D|FFB400|FBF8F2|FFF8E8|1D2E57|FFD15C|FFF1C7|F2A200)\b/i }
  ];
  for (const f of [...JS, ...CSS, ...HTML, ...SVG, 'manifest.webmanifest', 'package.json', 'vercel.json', ...DOCS]) scanRaw(f, RAW);
  // Strings only (comments are not read by anyone): "Dan" for Daniel, an MB postcode, to-do words. store.js and repair.js hold the migration of OLD saved data and must mention them.
  const MIGRATION = /^js\/core\/(store|repair)\.js$/;
  for (const f of JS) {
    for (const s of prose(f)) {
      if (/\bDan\b/.test(s.text) && !MIGRATION.test(f)) add('"Dan" (the name is Daniel)', f, s.line, s.text);
      if (/\bMB\d{1,2}\b/.test(s.text) && !MIGRATION.test(f)) add('MB postcode', f, s.line, s.text);
      if (/\b(TBD|TODO|FIXME|XXX)\b/.test(s.text) || /\b(coming soon|your text here|sample text goes)\b/i.test(s.text)) add('placeholder word', f, s.line, s.text);
      if (/\bDaniel [A-Z][a-z]{2,}\b/.test(s.text) && !/\bDaniel (Will|Is|Can|Could|Has|Uses|Confirms|Sets|Checks|Installs|Works|Gives|Takes|Plans|Aims|Reviews|Charges|Adds|Wants|Gets|Needs|Only|Replies)\b/.test(s.text)) add('"Daniel <surname>" (his surname is unknown)', f, s.line, s.text);
    }
  }
  // Names in the demo data: Daniel never gets a surname, and no "Dan".
  for (const f of DOCS) { read(f).split('\n').forEach((text, k) => { if (/\bDan\b/.test(text)) add('"Dan" in docs', f, k + 1, text); }); }
  check('no Voltmere, Marchbank, VM- reference, lorem, "Dan", MB postcode, old navy or amber colour, or to-do word anywhere', hits.length === 0, hits.slice(0, 12).join(' | '));

  // EICR-first wording: nothing a customer reads leads with an EICR, and the first services in the data are the EV ones.
  const customerFiles = JS.filter((f) => /^js\/(landing|quote)\//.test(f) || /^js\/booking\/(funnel|confirmation|manage|photos|draft|nav|option-icons|visit-ics)\.js$/.test(f));
  const eicr = [];
  for (const f of customerFiles) for (const s of prose(f)) if (/\bEICR\b|safety report|landlord safety/i.test(s.text)) eicr.push(`${f}:${s.line} ${s.text.slice(0, 80)}`);
  check('no EICR or landlord-report wording in anything a customer reads (landing, funnel, confirmation, manage, quote page)', eicr.length === 0, eicr.join(' | '));
  const cfg = await import(path.join(ROOT, 'js/core/config.js'));
  const services = cfg.makeDefaultSettings().services;
  check('the first two services are the EV ones (quote visit, then installation); an EICR is never first', services[0].id === 'ev_quote' && services[1].id === 'ev' && services.findIndex((s) => s.id === 'eicr') > 1, services.map((s) => s.id).join(','));
  check('only the free EV charger quote is shown on the website by default', services.filter((s) => s.showOnWebsite).map((s) => s.id).join() === 'ev_quote');
  const biz = cfg.makeDefaultBusiness();
  check('the business block is his: 180 Electrical, Daniel (no surname), 07885 496800, daniel@180electrical.co.uk, no street address, only his two credentials',
    biz.name === '180 Electrical' && biz.ownerFirstName === 'Daniel' && biz.ownerFullName === 'Daniel' && biz.phone === '07885 496800' && biz.email === 'daniel@180electrical.co.uk' && biz.address === ''
    && JSON.stringify(biz.credentials) === JSON.stringify(['Level 3 Electrical Installation', '2391 Inspection and Testing']) && biz.schemeLine === '' && biz.insuranceLine === '', JSON.stringify(biz).slice(0, 300));
});

// ---------------------------------------------------------------- 2. punctuation and spelling in everything a person can read
await section('2. British English, no em dashes, no stray symbols in readable text', async () => {
  const dash = [];
  const us = [];
  const US_WORDS = [
    [/(?<![-\w])color(s|ed|ing|ful)?\b(?!-)/i, 'colour'], [/\bfavorite(s)?\b/i, 'favourite'], [/\bneighbor(s|hood)?\b/i, 'neighbour'], [/\bbehavior\b/i, 'behaviour'],
    [/\b(cancel(ed|ing)|travel(ed|ing)|label(ed|ing)|model(ed|ing)|fuel(ed|ing)|signal(ed|ing))\b/i, 'double l'], [/\bgray\b/i, 'grey'], [/\bdefense\b/i, 'defence'],
    [/\b(honor|humor|labor|flavor|harbor|odor)(s|ed)?\b/i, 'our'], [/\bcatalog(s)?\b/i, 'catalogue'], [/\b(zip ?code|zipcode)\b/i, 'postcode'], [/\bsidewalk\b/i, 'pavement'],
    [/\b(aluminum|gotten|mom|parking lot|vacation|flashlight|cellphone|apartment)\b/i, 'US word'], [/\bfulfill(s|ed|ing|ment)?\b/i, 'fulfil'], [/\benroll(ed|ing|ment)?\b/i, 'enrol'],
    [/\b(per|\d+ ?)meters?\b/i, 'metre'], [/\bcenter(s|ed|ing)?\b/i, 'centre'], [/\btheater\b/i, 'theatre'], [/\bdialog\b/i, 'dialogue'], [/\bpenciled\b/i, 'pencilled'], [/\bskeptic/i, 'sceptic'],
    [/\b(?!(?:resiz|siz|seiz|priz|capsiz|oversiz|downsiz|upsiz|bizarre|cize|ize|autocapitaliz|capitaliz)\w*)[a-z]{3,}(?:iz(?:e|es|ed|ing|ation|ations))\b/i, 'ise']
  ];
  // CSS values, API names and identifiers that look like prose (a dialog role, a "center" alignment, "organization" inside a schema) are not readable copy.
  const NOT_PROSE = /(text-align|align-items|justify-content|place-items|center center|aria-haspopup|role=|dialog|@media|color-scheme|theme-color|translate|background|currentColor|--[a-z])/i;
  for (const f of JS) {
    for (const s of jsStrings(read(f))) if (/\u2014|&mdash;|&#8212;|&#x2014;/.test(s.text)) dash.push(`${f}:${s.line} ${s.text.trim().slice(0, 70)}`); // every string, even a lone glyph
    for (const s of prose(f)) {
      if (NOT_PROSE.test(s.text)) continue;
      for (const [re, fix] of US_WORDS) if (re.test(s.text)) us.push(`${f}:${s.line} (${fix}) ${s.text.trim().slice(0, 80)}`);
    }
  }
  for (const f of HTML) {
    const text = read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    text.split('\n').forEach((l, k) => { if (/\u2014|&mdash;|&#8212;/.test(l)) dash.push(`${f}:${k + 1} ${l.trim().slice(0, 70)}`); });
  }
  check('no em dash (U+2014) or &mdash; in any string a person can read (JS strings, templates, HTML)', dash.length === 0, dash.slice(0, 10).join(' | '));
  check('no US spelling in any readable string (colour, favourite, cancelled, centre, -ise ...)', us.length === 0, us.slice(0, 10).join(' | '));
  // The docs: prose only (code spans and fenced blocks dropped).
  const docDash = [];
  const docUs = [];
  for (const f of DOCS) {
    const text = read(f).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    text.split('\n').forEach((l, k) => {
      if (/\u2014/.test(l)) docDash.push(`${f}:${k + 1}`);
      for (const [re, fix] of US_WORDS) if (re.test(l) && !NOT_PROSE.test(l)) docUs.push(`${f}:${k + 1} (${fix}) ${l.trim().slice(0, 60)}`);
    });
  }
  check('no em dash in README or the docs', docDash.length === 0, docDash.slice(0, 10).join(' | '));
  check('no US spelling in README or the docs', docUs.length === 0, docUs.slice(0, 8).join(' | '));
});

// ---------------------------------------------------------------- 3. what a customer never reads: pencilled, provisional, tentative
const PENCIL = /penci?l(l?ed|l?ing|s)?\b|provisional(ly)?|tentative(ly)?/i;
const CUSTOMER_TEXTS = []; // every message a customer receives or sends (section 3 fills it; section 3b scans it for claims)
await section('3. customers never read "pencilled", "provisional" or "tentative" (source, messages, calendar files)', async () => {
  const bad = [];
  // Everything a customer can read in the source: landing, funnel, confirmation, manage, photos, the quote page, the handoff messages, the calendar files, the shared kit.
  const CUSTOMER_SRC = JS.filter((f) => /^js\/(landing|quote|ui)\//.test(f) || /^js\/booking\//.test(f) || /^js\/core\/(handoff|ics)\.js$/.test(f));
  for (const f of CUSTOMER_SRC) for (const s of prose(f)) if (PENCIL.test(s.text)) bad.push(`${f}:${s.line} ${s.text.trim().slice(0, 90)}`);
  check('no customer-facing source string says pencilled, provisional or tentative', bad.length === 0, bad.slice(0, 10).join(' | '));

  // Every customer message the system writes, for every kind, in every state of an enquiry and an install.
  const cfg = await import(path.join(ROOT, 'js/core/config.js'));
  const msgs = await import(path.join(ROOT, 'js/core/messages.js'));
  const clock = await import(path.join(ROOT, 'js/core/clock.js'));
  const handoff = await import(path.join(ROOT, 'js/core/handoff.js'));
  clock.setClock(new Date(2026, 9, 23, 20, 30));
  const booking = (over = {}) => ({
    id: 'bk_a', ref: 'EL-1043', createdAt: '2026-10-23T20:30', serviceId: 'ev_quote', serviceName: 'Home EV charger quote', variantId: null, variantLabel: '', start: '2026-10-26T10:00', durationMin: 120,
    status: 'new', urgent: false, emergencyReasons: [], etaMinutes: null, etaAt: null, customer: { name: 'Aoife Magee', phone: '07700 900231', email: 'aoife@example.com' },
    address: { line1: '', postcode: 'BT9 6QP' }, notes: 'Driveway at the side.', internalNotes: '', source: 'website', quotedPrice: 0, finalPrice: null, paid: false, paidMethod: null, paidAt: null,
    seenByOwner: false, reviewRequested: false, cancelledBy: null, cancelReason: '', seed: false, history: [], tentative: true,
    answers: { postcode: 'BT9 6QP', parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes' }, ...over
  });
  const quote = { id: 'Q-EL-1043', bookingId: 'bk_a', customerName: 'Aoife Magee', createdAt: '2026-10-23T11:00', status: 'sent', brand: 'ZAPPI', lines: [{ id: 'a', label: 'Charger', detail: '', qty: 1, unitPrice: 1514 }], notes: '', validUntil: '2026-11-21', sentAt: '2026-10-23T12:00', sentVia: 'whatsapp', viewedAt: null, acceptedAt: null, declinedAt: null, declineReason: '', installBookingId: 'bk_i', seed: false };
  const install = (over = {}) => booking({ id: 'bk_i', ref: 'EL-1044', serviceId: 'ev', serviceName: 'EV charger installation', start: '2026-10-29T13:00', durationMin: 240, quotedPrice: 1514, quoteId: 'Q-EL-1043', ...over });
  const state = (extra = {}) => ({ settings: cfg.makeDefaultSettings(), bookings: [booking(), install()], blocks: [], messages: [], quotes: { [quote.id]: quote }, ...extra });
  const bodies = [];
  const variants = [
    booking(), booking({ tentative: false, status: 'confirmed' }), booking({ start: null, tentative: false }), booking({ status: 'done', tentative: false }), booking({ status: 'cancelled', tentative: false, cancelReason: 'Customer asked' }),
    booking({ address: { line1: '', postcode: 'SW1A 1AA' } }), install(), install({ tentative: false, status: 'confirmed' }), install({ start: null, tentative: false }), install({ status: 'done', tentative: false, paid: false, finalPrice: 1514 })
  ];
  for (const b of variants) {
    for (const kind of cfg.TEMPLATE_KINDS.filter((k) => k.startsWith('customer_'))) {
      const extra = { oldWhen: 'Mon 26 Oct, 8–10am', newWhen: 'Tue 27 Oct, 10am–12', etaMinutes: 30, reason: 'Customer asked', quote, installBooking: b.serviceId === 'ev' ? b : install() };
      let m;
      try { m = msgs.buildMessage(kind, b, state(), extra); } catch (e) { bad.push(`buildMessage ${kind} threw ${e.message}`); continue; }
      bodies.push({ kind, body: m.body });
    }
  }
  check('every customer message kind rendered in ten booking states (enquiry, install, unscheduled, done, cancelled, outside area)', bodies.length >= 18 * variants.length - 4, String(bodies.length));
  const pencilled = bodies.filter((m) => PENCIL.test(m.body)).map((m) => `${m.kind}: ${m.body.slice(0, 90)}`);
  CUSTOMER_TEXTS.push(...bodies.map((m) => ({ name: m.kind, body: m.body })));
  check('no customer message says pencilled, provisional or tentative', pencilled.length === 0, [...new Set(pencilled)].slice(0, 5).join(' | '));
  // The customer's own WhatsApp messages (they send them to Daniel) and the calendar files they download.
  const biz = cfg.makeDefaultBusiness();
  const link = 'https://example.invalid/dashboard.html#import=abc';
  const texts = [handoff.enquiryWhatsAppText(booking(), { link, business: biz }), handoff.acceptanceWhatsAppText({ quote, days: ['thu', 'fri'], part: 'am', note: 'Ring first.' }, { link, business: biz }),
    handoff.declineWhatsAppText({ quote, reason: 'price' }, { link, business: biz })].filter(Boolean);
  CUSTOMER_TEXTS.push(...texts.map((t, i) => ({ name: ['enquiry text', 'accept text', 'decline text'][i], body: t })));
  check('the customer\'s WhatsApp texts to Daniel (enquiry, accept, decline) exist and never say pencilled or provisional', texts.length === 3 && texts.every((t) => !PENCIL.test(t)), texts.join(' | ').slice(0, 200));
  const visitIcs = await import(path.join(ROOT, 'js/core/ics.js')).then((m) => m.buildIcs(booking(), cfg.makeDefaultSettings())).catch((e) => `error ${e.message}`);
  check('the core calendar file (what the customer downloads) says nothing of pencilled or provisional', typeof visitIcs === 'string' && !PENCIL.test(visitIcs.replace(/STATUS:TENTATIVE/g, '')), String(visitIcs).slice(0, 200));
  clock.setClock(null);
});

// ---------------------------------------------------------------- 4. his words, exactly: parse docs/reference/180-site-report.md
const REF = read('docs/reference/180-site-report.md');
/** The text of one bullet of the report: "- Label: text" returns text. */
function refLine(label, from = 0) {
  const key = label.endsWith(':') ? label : `${label}:`;
  const at = REF.indexOf(`- ${key}`, from);
  if (at < 0) throw new Error(`reference line "${label}" not found`);
  const end = REF.indexOf('\n', at);
  return { text: REF.slice(at + key.length + 2, end).trim(), at };
}
const unq = (s) => s.replace(/^"|"$/g, '');
/** A literal the audit relies on: it must exist in the reference file (so the audit itself cannot drift from his site). */
const ref = (s) => { if (!REF.includes(s)) throw new Error(`"${s}" is not in docs/reference/180-site-report.md`); return s; };

function parseReference() {
  const r = {};
  r.eyebrow = refLine('Eyebrow').text;
  r.h1 = refLine('H1').text;
  r.heroP = refLine('P', REF.indexOf('- H1')).text;
  r.cta = refLine('CTA').text.replace(/\s*\(.*$/, '');
  r.freeQuote = 'Free, no-obligation quote.';
  r.ticks = refLine('Ticks').text.split('|').map((s) => s.trim());
  r.credentials = REF.slice(REF.indexOf('- TRUST BAR')).split('\n')[0].replace(/^[^:]*":\s*/, '').split('|').map((x) => x.trim());
  const why = { at: REF.indexOf('- H2: Home charging that works around you.') };
  r.whyTitle = 'Home charging that works around you.';
  r.why = [];
  for (const m of REF.slice(why.at, REF.indexOf('- ABOUT')).matchAll(/^ {2}- ([^:\n]+): (.+)$/gm)) r.why.push({ title: m[1], body: m[2] });
  const stepsAt = REF.indexOf('- H2: From first enquiry');
  r.stepsTitle = 'From first enquiry to charging at home.';
  r.steps = [];
  for (const m of REF.slice(stepsAt, REF.indexOf('- PRICING')).matchAll(/^ {2}- (\d\d) ([^:\n]+): (.+)$/gm)) r.steps.push({ n: m[1], title: m[2], body: m[3] });
  const pricingAt = REF.indexOf('- PRICING H2:');
  r.pricingTitle = refLine('PRICING H2:').text;
  r.pricingP = refLine('P', pricingAt).text;
  const areaAt = REF.indexOf('- AREA H2:');
  r.areaTitle = refLine('AREA H2:').text;
  r.areaP = refLine('P', areaAt).text;
  const faqAt = REF.indexOf('- FAQ (accordion)');
  r.faqTitle = 'Frequently asked questions';
  r.faq = [];
  for (const m of REF.slice(faqAt, REF.indexOf('- FINAL CTA')).matchAll(/^ {2}- ([^?\n]+\?) (.+)$/gm)) r.faq.push({ q: m[1], a: m[2] });
  const aboutAt = REF.indexOf('- ABOUT H2:');
  r.aboutTitle = refLine('ABOUT H2:').text;
  r.aboutP1 = refLine('P1', aboutAt).text;
  r.aboutP2 = refLine('P2', aboutAt).text;
  const finalAt = REF.indexOf('- FINAL CTA H2:');
  r.finalTitle = refLine('FINAL CTA H2:').text;
  r.finalP = refLine('P', finalAt).text;
  return r;
}

// The six funnel steps and the confirmation, from the report's own lines (each literal is checked against the file by ref()).
const FUNNEL = {
  step1: { eyebrow: ref("Let's find the right home charging setup for you"), h1: ref("What's your installation postcode?"), field: ref('UK postcode'), error: ref('Please enter a valid UK postcode so we can check your location.'), button: ref('Continue'), help: ref('Your postcode helps us confirm we cover your area.'), placeholderDeviation: true },
  steps: [
    { n: 2, h1: ref('Where would you normally park to charge?'), options: ['Private driveway', 'Garage', 'Allocated parking space', 'On-street parking', 'Other or not sure'].map(ref), note: ref('Whatever you pick, we will check that a safe cable route and parking position can be arranged.') },
    { n: 3, h1: ref('Do you already have your electric or plug-in hybrid car?'), options: ['Yes', "It's ordered or arriving soon", "I'm choosing one"].map(ref), note: '' },
    { n: 4, h1: ref('When would you like your charger installed?'), options: ['As soon as possible', 'Within the next month', 'Within 1 to 3 months', 'Just researching'].map(ref), note: '' },
    { n: 5, h1: ref('Can you authorise installation work at the property?'), options: ['Yes', 'I need landlord or freeholder approval', "I'm not sure"].map(ref), note: ref("Not sure yet? That's fine. We will help you work out what is needed.") }
  ],
  step6: {
    h1: ref('Where can 180 Electrical contact you about your quote?'), labels: ['Full name', 'Installation postcode', 'Mobile number', 'Email address'].map(ref).concat(['Anything else?']), // round 1 (T14), a deliberate deviation: his note label "Anything else we should know? (optional)" wrapped over two lines of wide caps; "Optional" is the helper line
    notesPlaceholder: ref('Your vehicle, preferred charger or anything about your property'),
    optIn: ref('Keep me updated with occasional offers and EV charging tips from 180 Electrical. Optional, and you can opt out at any time.'),
    submit: ref('Request my installation quote'),
    smallPrint: ref('180 Electrical will use these details to respond to your installation enquiry. By submitting your details you give us permission to contact you.')
  },
  confirm: {
    h1: ref('Thanks, your enquiry has been received.'),
    p: ref('The team at 180 Electrical will review your details and contact you to discuss your home charger installation within 24 hours. Please also check your emails.'),
    boxTitle: ref('Helpful to have ready'),
    box: ref('If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation.'),
    button: ref('Prefer to speak to us? Call 07885 496800')
  }
};

await section('4a. the reference file itself parses (so the verbatim checks are real)', async () => {
  const r = parseReference();
  check('hero eyebrow, H1, paragraph and button text are read from the file', r.eyebrow === 'Local EV charger installation' && r.h1.startsWith('Your own EV charger.') && r.heroP.startsWith('Make charging fit') && r.cta === 'Get my installation quote', JSON.stringify([r.eyebrow, r.h1, r.heroP, r.cta]).slice(0, 200));
  check('3 reasons, 3 steps, 6 FAQ questions and 2 credentials are found', r.why.length === 3 && r.steps.length === 3 && r.faq.length === 6 && r.credentials.length === 2 && r.ticks.length === 3, `${r.why.length} ${r.steps.length} ${r.faq.length} ${r.credentials.length} ${r.ticks.length}`);
  check('the report has all six funnel steps and the confirmation', ['1. Location.', '2. Parking.', '3. Vehicle.', '4. Timing.', '5. Permission.', '6. Contact.', 'CONFIRMATION page'].every((s) => REF.includes(s)));
  check('the funnel literals this audit relies on all come from the file (ref() would have thrown)', FUNNEL.steps.length === 4);
});

// ---------------------------------------------------------------- browser
let chromium = null;
let server = null;
let BASE = '';
let ORIGIN = '';
let browser = null;
const IMG_HOSTS = new Set(['perspective.imgix.net', 'images.unsplash.com']);
const STAND_IN = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#2a2b2f"/><circle cx="400" cy="300" r="90" fill="#3a3b40"/></svg>';
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

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
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const up = await until(async () => { const r = await fetch(base + '/index.html').catch(() => null); return r && r.ok; }, 10000, 150);
  if (!up) throw new Error('static server did not start');
  return base;
}
process.on('exit', () => { try { if (server) server.kill(); } catch (e) { /* gone */ } });

async function newPhone(vp = MOBILE, extra = {}) {
  const ctx = await browser.newContext({ viewport: vp, timezoneId: 'Europe/London', locale: 'en-GB', colorScheme: 'dark', isMobile: vp.width < 600, hasTouch: vp.width < 600, acceptDownloads: true, ...extra });
  await ctx.route((u) => IMG_HOSTS.has(u.hostname), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STAND_IN }));
  await ctx.route((u) => u.hostname === 'wa.me', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp stand-in</title>' }));
  return ctx;
}

/** Console errors and warnings, page errors, off-site and failed requests: what should stay empty on every page. */
function watch(page) {
  const log = { errors: [], offsite: [], failed: [] };
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.errors.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    const url = new URL(u);
    if (url.origin === ORIGIN) return;
    if (IMG_HOSTS.has(url.hostname) && r.resourceType() === 'image') return;
    if (url.hostname === 'wa.me') return;
    log.offsite.push(u.slice(0, 120));
  });
  page.on('requestfailed', (r) => { const u = r.url(); if (u.startsWith(ORIGIN)) log.failed.push(u); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(ORIGIN)) log.failed.push(r.status() + ' ' + r.url()); });
  return log;
}

/** What a person can read on the page, and where: block-aware text (so "£" and "617" in two spans stay together), split into his own content and tagged ideas (data-proto). */
const SNAP = () => {
  const SKIP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'head']);
  const res = { text: '', proto: '', attrs: [], links: [], buttons: [], title: document.title, lang: document.documentElement.lang, ideaBlocks: [] };
  const own = [];
  const idea = [];
  const blockOf = (el) => { const d = getComputedStyle(el).display; return !(d.startsWith('inline') || d === 'contents'); };
  const walk = (el, inProto) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    const out = inProto ? idea : own;
    const block = blockOf(el);
    for (const a of ['alt', 'title', 'aria-label', 'placeholder', 'aria-description']) { const v = el.getAttribute(a); if (v) res.attrs.push({ tag, name: a, value: v, proto: inProto }); }
    if (tag === 'button' || el.getAttribute('role') === 'button') res.buttons.push({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(), proto: inProto, testid: el.getAttribute('data-testid') || '' });
    if (tag === 'a') res.links.push({ href: el.getAttribute('href') || '', text: (el.textContent || '').replace(/\s+/g, ' ').trim(), proto: inProto, testid: el.getAttribute('data-testid') || '' });
    if (block) out.push('\n');
    for (const node of el.childNodes) {
      if (node.nodeType === 3) out.push(node.nodeValue);
      else if (node.nodeType === 1) {
        const p = inProto || (node.hasAttribute('data-proto') && node.getAttribute('data-proto') !== 'false');
        if (p && !inProto) {
          const own2 = (node.textContent || '').replace(/\s+/g, ' ').trim();
          res.ideaBlocks.push({ text: own2.slice(0, 160), tagged: !!node.querySelector('.ui-idea-tag') || node.classList.contains('ui-idea-tag'), testid: node.getAttribute('data-testid') || '' });
        }
        // an idea block's text goes to the idea list; its parent's text stays his
        walk(node, p);
        if (p && !inProto) own.push(' ');
      }
    }
    if (block) out.push('\n');
  };
  walk(document.body, false);
  res.heroTicks = [...document.querySelectorAll('[data-testid="hero-ticks"] li')].map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim());
  const clean = (arr) => arr.join('').replace(/[ \t\r\f\v ]+/g, ' ').replace(/ ?\n[ \n]*/g, '\n').trim();
  res.text = clean(own);
  res.proto = clean(idea);
  return res;
};
const flat = (s) => s.replace(/\s+/g, ' ').trim();

async function snap(page, name) {
  await until(async () => (await page.evaluate(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0)), 8000, 60);
  // The landing page mounts everything below the hero a moment after the first paint, and views load lazily: read the page once its text has stopped growing.
  let last = -1;
  await until(async () => { const n = await page.evaluate(() => document.body.textContent.length); const same = n === last; last = n; return same && n > 0; }, 10000, 300);
  await sleep(150);
  const s = await page.evaluate(SNAP);
  s.name = name;
  s.url = page.url();
  s.flat = flat(s.text);
  s.all = flat(s.text + '\n' + s.proto);
  if (DUMP) {
    fs.mkdirSync(DUMP, { recursive: true });
    fs.writeFileSync(path.join(DUMP, name.replace(/[^a-z0-9]+/gi, '_') + '.txt'), `URL ${s.url}\nTITLE ${s.title}\n\n--- HIS CONTENT\n${s.text}\n\n--- IDEAS (data-proto)\n${s.proto}\n\n--- ATTRS\n${s.attrs.map((a) => `${a.tag} ${a.name}=${a.value}${a.proto ? ' [proto]' : ''}`).join('\n')}\n\n--- LINKS\n${s.links.map((l) => `${l.href}  | ${l.text}${l.proto ? ' [proto]' : ''}`).join('\n')}\n`);
  }
  return s;
}

const snaps = {}; // name -> snapshot, so the later sections can read what the first pass saw
const logs = []; // { name, log }
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
/** Tap a test id if it is there (never waits 30 s for something that is not). */
const tap = async (page, id) => { if (await page.locator(`[data-testid="${id}"]`).count()) { await page.locator(`[data-testid="${id}"]`).first().click(); return true; } return false; };
const hashRoute = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(250); };
const storeOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vm_state_v1')); } catch (e) { return null; } });

// ---- the checks that run on every snapshot
const MONEY_BAD = /£\s+\d|£\d{4,}(?!,)|£\d+,\d{1,2}\b(?!\d)|\bGBP\b|\d\s?pounds\b|£\d+\.\d\b(?!\d)/;
const DATE_BAD = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s+\d{1,2}\b|\b\d{1,2}(st|nd|rd|th)\s+(of\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\b\d{1,2}\s+(January|February|March|April|June|July|August|September|October|November|December)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}:\d{2}\s?(AM|PM)\b|\b\d{1,2}(AM|PM)\b/;
const BROKEN = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|\bnull\b(?!\s*,)|\{\{|\}\}|\$\{/;
const OLD_STRINGS = /voltmere|marchbank|\bVM-\d|\bDan\b|lorem|ipsum/i;
function commonChecks(s) {
  // "New enquiry received. Ciaran Boyle 07700 900371. 23/10 20:25." is the Messages screen's picture of his agency's plain ping (labelled illustrative): its date style is the point.
  const readable = (s.all + ' ' + s.attrs.map((a) => a.value).join(' ')).replace(/New enquiry received\. [^.]*\. \d{1,2}\/\d{1,2} \d{2}:\d{2}\./g, ' ');
  const out = [];
  if (OLD_STRINGS.test(readable)) out.push('old brand/placeholder: ' + (readable.match(OLD_STRINGS) || [''])[0]);
  if (/\u2014/.test(readable)) out.push('em dash');
  if (MONEY_BAD.test(readable)) out.push('money format: ' + (readable.match(MONEY_BAD) || [''])[0]);
  const dated = readable.replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)\b/g, ' '); // the long form (accessible labels, day pickers) is the second approved shape
  if (DATE_BAD.test(dated)) out.push('date format: ' + (dated.match(DATE_BAD) || [''])[0]);
  if (BROKEN.test(s.all)) out.push('broken value: ' + (s.all.match(BROKEN) || [''])[0] + ' in "' + (s.all.slice(Math.max(0, s.all.search(BROKEN) - 30), s.all.search(BROKEN) + 40)) + '"');
  if (s.lang !== 'en-GB') out.push('lang is ' + s.lang);
  return out.filter(Boolean);
}
const USW = [/\bcolor(s|ed)?\b/i, /\bfavorite\b/i, /\bcenter(ed)?\b/i, /\bneighbor/i, /\bcanceled\b|\bcanceling\b/i, /\bgray\b/i, /\bauthorize|\borganize|\bcustomize|\boptimize|\banalyze|\bcatalog\b|\bzip ?code\b|\bparking lot\b|\bsidewalk\b|\bfulfill\b/i];

// ---- claims: what only an idea may say on his public pages
const CLAIMS = [
  ['a price', /£\s?\d/], ['a saving', /\b(save|saving|savings|cheaper)\b/i], ['a guarantee', /\b(guarantee[sd]?|warrant(y|ies)|money.?back|lifetime)\b/i],
  ['insurance', /\b(insured|insurance|public liability|indemnity)\b/i], ['an accreditation', /\b(NICEIC|NAPIT|Part P|OZEV|OLEV|TrustMark|Checkatrade|Trustpilot|Which\?|approved installer|certified|registered|fully qualified|accredited)\b/i],
  ['a certificate', /\bcertificat(e|es|ion)\b/i], ['years in business', /\b(\d+|ten|twenty|thirty)\+?\s+years?\b|\bsince (19|20)\d\d\b|\bestablished\b|\bfamily.(run|owned)\b|\bdecades?\b/i],
  ['reviews or ratings', /\b(\d+ reviews|reviews (from|on|say)|rated|\d(\.\d)?\s?stars?|five.star|testimonials?|\d(\.\d)?\/5|trusted by|(leave|read|see|our|customer|google|five.star|5.star) reviews?|\d+\+? (happy )?(customers|homes|installs|installations))\b/i],
  ['a payment term', /\b(deposit|payable|invoice|balance due|up.?front|interest.free|instalments?|pay (after|on|when|by|in)|no payment)\b/i],
  ['a product spec', /\b(\d+(\.\d+)?\s?kW|\d+\s?amps?|\d+A\b|type 2|OCPP|untethered|wifi|wi-fi|RFID|solar|IP\d\d)\b/i],
  ['a grant or discount', /\b(grant|subsid|discount|\d+% off|VAT)\b/i], ['a superlative', /\b(cheapest|lowest price|number one|leading|top.rated|best price|market.leading)\b/i]
];
/** Every phrase of his own site that may legitimately contain one of those words ("the best choice depends", "Accredited and qualified"): removed before scanning. */
function ownWordsRemoved(text, r) {
  const pieces = [];
  for (const seg of REF.split(/\n/)) for (const p of seg.split(/(?<=[.?!])\s+|\s\|\s|: "|" \/ "/)) { const t = p.replace(/^[-\s]*(\w[\w ]*:)?\s*/, '').replace(/["]/g, '').trim(); if (t.length > 14) pieces.push(t); }
  pieces.push('Accredited and qualified', ...r.credentials, ...FUNNEL.step1.help.split(' | '));
  let out = text;
  for (const p of pieces.sort((a, b) => b.length - a.length)) if (out.includes(p)) out = out.split(p).join(' ');
  return out;
}

await section('3b. customer messages and the customer\'s WhatsApp texts make no invented claim (certificate, guarantee, insurance, accreditation, years, payment terms, specs)', async () => {
  if (!CUSTOMER_TEXTS.length) { note('no customer texts collected (section 3 was skipped)'); return; }
  const r = parseReference();
  const bad = [];
  for (const { name, body } of CUSTOMER_TEXTS) {
    const text = ownWordsRemoved(body.replace(/Ref [A-Z]+-\d+|Quote [A-Z]+-[A-Z]+-\d+/g, ' '), r);
    for (const [what, re] of CLAIMS) { if (what === 'a price') continue; const m = text.match(re); if (m) bad.push(`${name}: ${what} "${m[0]}" in "${body.slice(Math.max(0, body.search(re) - 30), body.search(re) + 40).replace(/\n/g, ' ')}"`); }
  }
  check(`${CUSTOMER_TEXTS.length} customer messages and texts: no certificate, guarantee, insurance, accreditation, years, review figure, payment term or product spec`, bad.length === 0, [...new Set(bad)].slice(0, 6).join(' | '));
});

// ---------------------------------------------------------------- 0. the detectors fire (so a clean run means something)
await section('0. self-test: every detector fires on a known-bad sample and stays quiet on a known-good one', async () => {
  const r = parseReference();
  const fires = (re, bad, good) => bad.every((t) => re.test(t)) && good.every((t) => !re.test(t));
  check('the JS tokenizer reads strings and template text, decodes \\u escapes, and skips comments and regular expressions',
    (() => {
      const got = jsStrings("// a comment with 'quotes'\nconst a = 'one'; const re = /['\"]x/g; const b = `two ${'three'} four`; /* 'no' */ const c = '\\u2014';").map((x) => x.text);
      return got.includes('one') && got.includes('three') && got.some((t) => t.includes('two')) && got.some((t) => t.includes('four')) && got.includes('\u2014') && !got.some((t) => /comment|no\b/.test(t)) && !got.includes('x');
    })());
  check('pencilled / provisional / tentative are caught in every form, and a plain word is not', fires(PENCIL, ['Survey pencilled in', 'Provisional until', 'tentatively booked', 'pencilling it in', 'Pencil'], ['A free survey visit', 'Daniel will confirm', 'the pen is mightier']));
  check('old-brand strings are caught', fires(OLD_STRINGS, ['Voltmere Electrical', 'ref VM-1042', 'Hi Dan,', 'lorem ipsum', 'Marchbank'], ['Daniel', 'dance', 'EL-1043', 'Danish']));
  check('bad money formats are caught and £1,934 is accepted', fires(MONEY_BAD, ['£ 1,934', '£1934', '£1,93', '1934 GBP', '£19.5'], ['£1,934', '£617', '£85', '£12,500', '£1,934.50']));
  check('bad dates are caught, and Mon 26 Oct is accepted', fires(DATE_BAD, ['Monday, 26 October', '26/10/2026', '2026-10-26', '26th October', '10:30 AM', 'Mon, 26 Oct'], ['Mon 26 Oct', 'Fri 23 Oct, 8–10am', 'Thu 29 Oct', '10am–12', '26 AM']));
  check('broken values are caught', fires(BROKEN, ['Hi undefined', 'Total NaN', '[object Object]', 'Invalid Date', 'Hello {{name}}', '${x}'], ['Hello Aoife', 'Nancy', 'nullable fields']));
  const claim = (name) => CLAIMS.find(([w]) => w === name)[1];
  check('every invented-claim detector fires on a sample and stays quiet on his own words',
    [['a price', '£1,299 fitted', 'Get my installation quote'], ['a saving', 'Save up to 60%', 'Choose with confidence'], ['a guarantee', '5 year guarantee', 'a clear quote'], ['insurance', 'Fully insured', 'Free, no-obligation quote'],
      ['an accreditation', 'NICEIC approved installer', 'Level 3 Electrical Installation'], ['a certificate', 'Certificate included', 'Photos or a survey may be needed'], ['years in business', '12 years in business', 'every year'],
      ['reviews or ratings', '4.9 stars from 200 reviews', 'He reviews your details'], ['a payment term', 'Pay a deposit of 20%', 'Submitting the form is an enquiry'], ['a product spec', '7.4 kW tethered', 'Zappi, Ohme or Sync'],
      ['a grant or discount', 'OZEV grant available', 'Make charging fit around your day'], ['a superlative', 'The cheapest in Ulster', 'the best choice depends on your vehicle']].every(([w, bad, good]) => claim(w).test(bad) && !claim(w).test(good)));
  const own = ownWordsRemoved('Most home chargers suit most electric and plug-in hybrid cars, but the best choice depends on your vehicle, how you drive and your preferences. Accredited and qualified Level 3 Electrical Installation 2391 Inspection and Testing', r);
  check('his own sentences are removed before the claim scan (so "the best choice depends" and his credentials are not flagged) and nothing else is', !/best|Accredited|Level 3|2391/.test(own) && /cheapest/.test(ownWordsRemoved('We are the cheapest. Level 3 Electrical Installation', r)));
  const ideaSample = '<p data-proto="true">Idea from us</p>';
  check('the ideas switch markup this audit relies on exists in the source (data-proto, .ui-idea-tag, data-clean)', read('js/landing/idea.js').includes("'data-proto': 'true'") && read('js/landing/idea.js').includes('ui-idea-tag') && read('css/base.css').includes('[data-clean="1"] [data-proto]') && ideaSample.includes('data-proto'));
});

if (!STATIC_ONLY) {
  const dep = createRequire(QA_DEPS.endsWith('/') ? QA_DEPS : QA_DEPS + '/');
  ({ chromium } = dep('playwright-core'));
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  BASE = await startServer();
  ORIGIN = new URL(BASE).origin;
}

const REFDATA = parseReference();
let state = {}; // what one section hands to the next

if (!STATIC_ONLY) {
  // ============================================================ 5. the customer's pages, driven end to end
  await section('5. the customer\'s journey: landing, funnel, confirmation, manage, in both "With ideas" and "Only my content"', async () => {
    const ctx = await newPhone();
    const page = await ctx.newPage();
    const log = watch(page);
    logs.push({ name: 'customer phone', log });
    const visit = async (name, url, ready) => { await page.goto(`${BASE}/${url}`, { waitUntil: 'load' }); if (ready) await tid(page, ready).first().waitFor({ timeout: WAIT }).catch(() => {}); return snap(page, name); };

    snaps.landing = await visit('landing 375', `index.html?${CLOCK}`, 'ideas-switch');
    snaps.landingClean = await visit('landing 375 only my content', `index.html?${CLOCK}&clean=1`);
    await page.goto(`${BASE}/index.html?${CLOCK}&clean=0`);
    snaps.landingDesktop = await (async () => { const c2 = await newPhone(DESKTOP); const p2 = await c2.newPage(); const l2 = watch(p2); logs.push({ name: 'landing 1280', log: l2 }); await p2.goto(`${BASE}/index.html?${CLOCK}`, { waitUntil: 'load' }); const s = await snap(p2, 'landing 1280'); await c2.close(); return s; })();

    // funnel
    await page.goto(`${BASE}/index.html?${CLOCK}#book/ev_quote`, { waitUntil: 'load' });
    await tid(page, 'funnel-postcode').waitFor({ timeout: WAIT });
    snaps.step1 = await snap(page, 'funnel step 1');
    snaps.step1placeholder = await page.locator('[data-testid="funnel-postcode"]').getAttribute('placeholder');
    await tid(page, 'funnel-continue').click();
    await sleep(300);
    snaps.step1error = await snap(page, 'funnel step 1 error');
    await tid(page, 'funnel-postcode').fill('BT9 6QP');
    await sleep(200);
    snaps.step1ok = await snap(page, 'funnel step 1 valid');
    await tid(page, 'funnel-continue').click();
    const picks = [['parking', 'street'], ['vehicle', 'ordered'], ['timing', 'asap'], ['permission', 'yes']];
    snaps.steps = {};
    for (let k = 0; k < picks.length; k += 1) {
      const [key, value] = picks[k];
      await tid(page, `funnel-option-${key}-${value}`).waitFor({ timeout: WAIT });
      const n = k + 2;
      snaps.steps[n] = await snap(page, `funnel step ${n}`);
      snaps.steps[n].optionLabels = await page.locator('.bk-fn-opt__label').allInnerTexts();
      snaps.steps[n].heading = (await tid(page, 'funnel-title').innerText()).trim();
      if (key === 'parking') {
        await tid(page, 'funnel-option-parking-street').click();
        await sleep(300);
        snaps.streetNote = await snap(page, 'funnel step 2 on-street note');
        await tid(page, 'funnel-option-parking-driveway').click();
      } else {
        await tid(page, `funnel-option-${key}-${value}`).click();
      }
    }
    await tid(page, 'funnel-step-6').waitFor({ timeout: WAIT });
    snaps.step6 = await snap(page, 'funnel step 6');
    snaps.step6.labels = await page.locator('.ui-field__label, .bk-fn label').allInnerTexts().catch(() => []);
    snaps.step6.notesPlaceholder = await tid(page, 'field-note').getAttribute('placeholder');
    snaps.step6.postcodePlaceholder = await tid(page, 'field-postcode').getAttribute('placeholder');
    await tid(page, 'funnel-submit').click();
    await sleep(300);
    snaps.step6error = await snap(page, 'funnel step 6 errors');
    await tid(page, 'field-name').fill('Aoife Magee');
    await tid(page, 'field-phone').fill('07700 900231');
    await tid(page, 'funnel-email').fill('aoife@example.com');
    await tid(page, 'field-note').fill('Driveway at the side, about 8 m of cable.');
    await tid(page, 'funnel-submit').click();
    await tid(page, 'confirmation').waitFor({ timeout: WAIT });
    await sleep(500);
    snaps.confirmFresh = await snap(page, 'confirmation fresh');
    snaps.confirmFresh.heading = (await tid(page, 'confirmation-title').innerText()).trim();
    snaps.waLink = await tid(page, 'wa-send').getAttribute('href').catch(() => null);
    snaps.confirmRef = (await tid(page, 'confirmation-ref').innerText()).trim();
    // Round 1 (T03): nothing has reached the business until WhatsApp is opened, so a fresh confirmation says "Send your enquiry to 180 Electrical." and his thank-you
    // replaces it once the customer has opened WhatsApp (the handoff memory is what the button writes when it is tapped).
    await page.evaluate(async (r) => { const m = await import('/js/core/handoff.js'); m.rememberHandoff('enq', r, {}); }, snaps.confirmRef);
    await page.reload({ waitUntil: 'load' });
    await tid(page, 'confirmation').waitFor({ timeout: WAIT });
    await sleep(500);
    snaps.confirm = await snap(page, 'confirmation');
    snaps.confirm.heading = (await tid(page, 'confirmation-title').innerText()).trim();
    // open the folded parts and the demo so their text is read too
    for (const id of ['funnel-ready-box', 'journey-box']) { await page.evaluate((t) => { const d = document.querySelector(`[data-testid="${t}"]`); if (d && d.tagName === 'DETAILS') d.open = true; }, id); }
    if (await tid(page, 'demo-toggle').count()) { await tid(page, 'demo-toggle').click(); await sleep(400); }
    snaps.confirmOpen = await snap(page, 'confirmation opened');
    // clean mode on the confirmation
    await page.goto(`${BASE}/index.html?${CLOCK}&clean=1#booked/${snaps.confirmRef}`, { waitUntil: 'load' });
    await tid(page, 'confirmation').waitFor({ timeout: WAIT });
    snaps.confirmClean = await snap(page, 'confirmation only my content');
    await page.goto(`${BASE}/index.html?${CLOCK}&clean=0#booked/${snaps.confirmRef}`, { waitUntil: 'load' });
    // manage, new
    await tid(page, 'confirmation').waitFor({ timeout: WAIT });
    await tid(page, 'confirmation-manage').click();
    await sleep(500);
    snaps.manageNew = await snap(page, 'manage (new enquiry)');
    // Daniel confirms the visit (through the store the page already loaded), then the customer reads confirmation and manage again
    const ref = snaps.confirmRef;
    const confirmed = await page.evaluate(async (r) => {
      const m = await import('/js/core/store.js');
      const b = m.getState().bookings.find((x) => x.ref === r);
      if (!b) return 'no booking';
      const res = m.confirmBooking(b.id);
      return res && res.ok ? 'ok' : JSON.stringify(res);
    }, ref);
    state.confirmedOk = confirmed;
    await page.goto(`${BASE}/index.html?${CLOCK}#booked/${ref}`, { waitUntil: 'load' });
    await tid(page, 'confirmation').waitFor({ timeout: WAIT });
    snaps.confirmConfirmed = await snap(page, 'confirmation (visit confirmed)');
    await page.goto(`${BASE}/index.html?${CLOCK}#manage/${ref}`, { waitUntil: 'load' });
    await sleep(600);
    snaps.manageConfirmed = await snap(page, 'manage (confirmed)');
    // cancelled
    await page.evaluate(async (r) => { const m = await import('/js/core/store.js'); const b = m.getState().bookings.find((x) => x.ref === r); m.cancelBooking(b.id, 'owner', 'Customer asked'); }, ref);
    await page.goto(`${BASE}/index.html?${CLOCK}#booked/${ref}`, { waitUntil: 'load' });
    await tid(page, 'confirmation').waitFor({ timeout: WAIT });
    snaps.confirmCancelled = await snap(page, 'confirmation (cancelled)');
    await page.goto(`${BASE}/index.html?${CLOCK}#booked/EL-9999`, { waitUntil: 'load' });
    await sleep(600);
    snaps.confirmUnknown = await snap(page, 'confirmation (unknown reference)');
    snaps.bookedRef = ref;
    await ctx.close();
    check('the customer pages loaded and every state was reached', !!snaps.confirm && !!snaps.manageNew && !!snaps.confirmConfirmed && !!snaps.confirmCancelled, JSON.stringify(state));
    check('the owner confirm used by this audit worked', state.confirmedOk === 'ok', state.confirmedOk);
  });

  // ============================================================ 6. the quote page in every state
  await section('6. the customer quote page: same-browser states and link mode on a phone that holds nothing', async () => {
    const ctx = await newPhone();
    const page = await ctx.newPage();
    const log = watch(page);
    logs.push({ name: 'quote phone', log });
    await page.goto(`${BASE}/index.html?${CLOCK}`, { waitUntil: 'load' }); // seeds the demo store
    await sleep(800);
    const one = async (name, hash, extra) => {
      await page.goto(`${BASE}/quote.html?${CLOCK}${extra || ''}${hash}`, { waitUntil: 'load' });
      await tid(page, 'q2-page').waitFor({ timeout: WAIT }).catch(() => {});
      return snap(page, name);
    };
    snaps.quoteSent = await one('quote (sent, same browser)', '#q=Q-EL-1019');
    snaps.quoteSentClean = await one('quote (sent) only my content', '#q=Q-EL-1019', '&clean=1');
    // the accept sheet (same browser: an install day from the real diary) and the decline sheet
    await one('quote (sent, same browser)', '#q=Q-EL-1019');
    if (await tid(page, 'q2-accept').count()) { await tid(page, 'q2-accept').click(); await sleep(600); snaps.quoteAcceptSheet = await snap(page, 'quote accept sheet (same browser)'); await page.keyboard.press('Escape'); await sleep(300); }
    if (await tid(page, 'q2-decline').count()) { await tid(page, 'q2-decline').click(); await sleep(600); snaps.quoteDeclineSheet = await snap(page, 'quote decline sheet (same browser)'); await page.keyboard.press('Escape'); await sleep(300); }
    snaps.quoteAccepted = await one('quote (accepted)', '#q=Q-EL-1013');
    snaps.quoteDeclined = await one('quote (declined)', '#q=Q-EL-1009');
    snaps.quoteDraft = await one('quote (draft)', '#q=Q-EL-1023');
    snaps.quoteInvalid = await one('quote (not found)', '#q=Q-EL-0000');
    snaps.quoteNone = await one('quote (no link)', '');
    snaps.quoteGarbage = await one('quote (garbage link)', '#d=not-a-real-payload');
    // an expired quote: Daniel's seed has one sent long ago (Q-EL-1002)
    snaps.quoteExpired = await one('quote (expired)', '#q=Q-EL-1002');
    // link mode: the quote travels in its own link, opened on a phone with an empty store
    const link = await page.evaluate(async () => {
      const m = await import('/js/core/store.js');
      const q = m.getState().quotes['Q-EL-1019'];
      const h = await import('/js/core/handoff.js');
      const b = m.getState().bookings.find((x) => x.id === q.bookingId);
      // A quote the second phone's own demo store does not hold (every phone seeds the same Q-EL-10xx ids), so the page must read it from the link
      const body = h.decodePayload(h.quoteLink(q, { booking: b }).split('#d=')[1]);
      body.i = 'Q-EL-1999';
      body.r = 'EL-1999';
      return `${location.origin}/quote.html#d=${h.encodePayload(body)}`;
    });
    state.quoteLink = link;
    await ctx.close();
    const ctx2 = await newPhone();
    const p2 = await ctx2.newPage();
    const log2 = watch(p2);
    logs.push({ name: 'quote link phone', log: log2 });
    await p2.goto(`${BASE}/quote.html?${CLOCK}${link.slice(link.indexOf('#'))}`, { waitUntil: 'load' });
    await tid(p2, 'q2-page').waitFor({ timeout: WAIT }).catch(() => {});
    snaps.quoteLink = await snap(p2, 'quote (link mode)');
    snaps.quoteLinkMode = await tid(p2, 'q2-page').getAttribute('data-mode').catch(() => null);
    snaps.quoteLinkHrefs = await p2.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || ''));
    await tid(p2, 'q2-accept').click();
    await tid(p2, 'q2-days-sheet').waitFor({ timeout: WAIT }).catch(() => {});
    snaps.quoteDays = await snap(p2, 'quote accept (which days suit you)');
    await tap(p2, 'q2-pday-thu');
    await tap(p2, 'q2-ppart-am');
    // Accept opens a real WhatsApp message to Daniel in a new tab: read the address off it (wa.me is answered by a stand-in page)
    snaps.quoteReplyHref = await (async () => {
      try {
        const [pop] = await Promise.all([ctx2.waitForEvent('page', { timeout: WAIT }), tid(p2, 'q2-reply-open').click()]);
        await pop.waitForURL((u) => u.hostname === 'wa.me', { timeout: WAIT });
        const u = pop.url();
        await pop.close().catch(() => {});
        return u;
      } catch (e) { return null; }
    })();
    await sleep(500);
    snaps.quoteSent2 = await snap(p2, 'quote accept (message ready)');
    await p2.keyboard.press('Escape');
    await sleep(300);
    await tap(p2, 'q2-decline');
    await sleep(600);
    snaps.quoteDeclineLink = await snap(p2, 'quote decline (link mode)');
    await ctx2.close();
    check('the quote page was reached in every state', ['quoteSent', 'quoteAccepted', 'quoteDeclined', 'quoteInvalid', 'quoteLink', 'quoteDays'].every((k) => !!snaps[k]));
  });

  // ============================================================ 7. the owner's dashboard, every route
  await section('7. the owner dashboard: every route (text only: old strings, formats, simulated labels)', async () => {
    const ctx = await newPhone();
    const page = await ctx.newPage();
    const log = watch(page);
    logs.push({ name: 'dashboard phone', log });
    await page.goto(`${BASE}/dashboard.html?${CLOCK}#/today`, { waitUntil: 'load' });
    await sleep(1200);
    const st = await storeOf(page);
    const enq = st.bookings.find((b) => b.serviceId === 'ev_quote' && b.status === 'new' && b.tentative);
    const accepted = Object.values(st.quotes).find((q) => q.status === 'accepted');
    const sentQ = Object.values(st.quotes).find((q) => q.status === 'sent');
    const draftQ = Object.values(st.quotes).find((q) => q.status === 'draft');
    const installB = st.bookings.find((b) => b.serviceId === 'ev' && b.tentative);
    const doneB = st.bookings.find((b) => b.status === 'done' && b.serviceId === 'ev_quote');
    const routes = [
      ['today', '#/today'], ['calendar', '#/calendar'], ['bookings', '#/bookings'], ['bookings (enquiry)', `#/bookings/${enq.id}`], ['bookings (install)', `#/bookings/${installB.id}`], ['bookings (done)', `#/bookings/${doneB.id}`],
      ['pipeline', '#/pipeline'], ['quotes', '#/quotes'], ['quotes (draft)', `#/quotes/${draftQ.id}`], ['quotes (sent)', `#/quotes/${sentQ.id}`], ['quotes (accepted)', `#/quotes/${accepted.id}`],
      ['insights', '#/insights'], ['messages', '#/messages'], ['more', '#/more'], ['settings', '#/settings'], ['share', '#/share'], ['customers', '#/customers'], ['about', '#/about'], ['demo', '#/demo'], ['new', '#/new'],
      ['connections', '#/connections'], ['connections domain', '#/connections/domain'], ['connections webhook', '#/connections/webhook'], ['connections tracking', '#/connections/tracking'],
      ['connections whatsapp', '#/connections/whatsapp'], ['connections calendar', '#/connections/calendar'], ['connections email', '#/connections/email']
    ];
    snaps.dash = {};
    for (const [name, hash] of routes) {
      await hashRoute(page, hash);
      await sleep(500);
      snaps.dash[name] = await snap(page, 'dashboard ' + name);
    }
    // the payment sheet: "Mark paid" only records a flag, and the sheet says so
    const unpaid = st.bookings.find((b) => b.status === 'done' && b.serviceId !== 'ev_quote' && !b.paid);
    if (unpaid) {
      await hashRoute(page, `#/bookings/${unpaid.id}`);
      await sleep(700);
      if (await tap(page, 'job-primary') && await tid(page, 'paid-sheet').waitFor({ timeout: 4000 }).then(() => true, () => false)) snaps.dash.paidSheet = await snap(page, 'dashboard paid sheet');
      await page.keyboard.press('Escape');
    }
    // the import screen with a real payload (what Daniel's phone opens)
    const link = await page.evaluate(async (id) => {
      const m = await import('/js/core/store.js');
      const h = await import('/js/core/messages.js');
      const b = m.getState().bookings.find((x) => x.id === id);
      return h.enquiryHandoff(b, m.getState()).link;
    }, enq.id);
    await page.goto(`${BASE}/dashboard.html?${CLOCK}${link.slice(link.indexOf('#'))}`, { waitUntil: 'load' });
    await sleep(900);
    snaps.dash.import = await snap(page, 'dashboard import (enquiry)');
    snaps.dash.messagesState = st.messages;
    check('every dashboard route rendered', Object.keys(snaps.dash).length >= routes.length, Object.keys(snaps.dash).join());
    await ctx.close();
  });

  // ============================================================ 8..: the checks, on what the browser saw
  await section('8. every page: no old strings, one money format, one date format, no broken values, en-GB, no console or network noise', async () => {
    const isSnap = (s) => s && typeof s === 'object' && typeof s.flat === 'string' && Array.isArray(s.attrs);
    const all = [...Object.values(snaps).filter(isSnap), ...Object.values(snaps.steps || {}).filter(isSnap), ...Object.values(snaps.dash || {}).filter(isSnap)];
    const bad = [];
    for (const s of all) for (const f of commonChecks(s)) bad.push(`${s.name}: ${f}`);
    check(`${all.length} pages and states read: no old brand, em dash, bad money or date format, broken value, or wrong lang`, bad.length === 0, bad.slice(0, 10).join(' | '));
    const us = [];
    for (const s of all) { const t = s.all + ' ' + s.attrs.map((a) => a.value).join(' '); for (const re of USW) { const m = t.match(re); if (m) us.push(`${s.name}: ${m[0]}`); } }
    check('no US spelling in any rendered page', us.length === 0, us.slice(0, 8).join(' | '));
    const noisy = logs.filter(({ log }) => log.errors.length || log.offsite.length || log.failed.length).map(({ name, log }) => `${name}: ${[...log.errors, ...log.offsite, ...log.failed].slice(0, 3).join(' ; ')}`);
    check('no console errors or warnings, no failed request, and nothing off-site except his two image hosts', noisy.length === 0, noisy.join(' | '));
    const titles = all.map((s) => `${s.name}: ${s.title}`);
    check('every page has a title naming 180', all.every((s) => /180/.test(s.title)), titles.filter((t) => !/180/.test(t)).slice(0, 4).join(' | '));
  });

  await section('9. customers never read "pencilled", "provisional" or "tentative" on any page', async () => {
    const customerPages = [snaps.landing, snaps.landingClean, snaps.landingDesktop, snaps.step1, snaps.step1error, snaps.step1ok, snaps.streetNote, ...Object.values(snaps.steps), snaps.step6, snaps.step6error,
      snaps.confirm, snaps.confirmClean, snaps.confirmConfirmed, snaps.confirmCancelled, snaps.confirmUnknown, snaps.manageNew, snaps.manageConfirmed,
      snaps.quoteSent, snaps.quoteSentClean, snaps.quoteAcceptSheet, snaps.quoteDeclineSheet, snaps.quoteAccepted, snaps.quoteDeclined, snaps.quoteDraft, snaps.quoteInvalid, snaps.quoteNone, snaps.quoteGarbage,
      snaps.quoteExpired, snaps.quoteLink, snaps.quoteDays, snaps.quoteDeclineLink].filter(Boolean);
    const bad = [];
    for (const s of customerPages) {
      // Daniel's own phone in the demo panel shows HIS alert (he reads "pencilled in"); that one bubble is his, not the customer's.
      const t = s.all.replace(/On (Daniel's|your) phone, just now[\s\S]*?What (you|the customer) received/i, ' ');
      const m = (t + ' ' + s.attrs.map((a) => a.value).join(' ')).match(PENCIL);
      if (m) bad.push(`${s.name}: "${m[0]}" in "${t.slice(Math.max(0, t.search(PENCIL) - 40), t.search(PENCIL) + 50)}"`);
    }
    check(`${customerPages.length} customer pages and states: none says pencilled, provisional or tentative`, bad.length === 0, bad.slice(0, 6).join(' | '));
    const st = snaps.dash && snaps.dash.messagesState ? snaps.dash.messagesState : [];
    const sent = st.filter((m) => m.to === 'customer' && PENCIL.test(m.body)).map((m) => `${m.kind}: ${m.body.slice(0, 70)}`);
    check('the demo diary\'s messages to customers (the Messages screen shows them as the customer got them) never say pencilled or provisional', sent.length === 0, sent.slice(0, 4).join(' | '));
  });

  await section('10. invented claims sit inside a tagged idea: his public pages carry only his own claims', async () => {
    const pages = { 'landing': snaps.landing, 'landing 1280': snaps.landingDesktop, 'funnel step 1': snaps.step1, 'funnel step 1 on-street note': snaps.streetNote, 'funnel step 6': snaps.step6, 'funnel step 6 errors': snaps.step6error,
      'confirmation': snaps.confirm, 'confirmation (confirmed)': snaps.confirmConfirmed, 'confirmation (cancelled)': snaps.confirmCancelled, 'manage': snaps.manageNew, 'manage (confirmed)': snaps.manageConfirmed };
    for (const [k, s] of Object.entries(snaps.steps)) pages[`funnel step ${k}`] = s;
    const bad = [];
    for (const [name, s] of Object.entries(pages)) {
      const text = ownWordsRemoved(s.flat + ' ' + s.attrs.filter((a) => !a.proto).map((a) => a.value).join(' '), REFDATA);
      for (const [what, re] of CLAIMS) { const m = text.match(re); if (m) bad.push(`${name}: ${what} "${m[0]}" in "${text.slice(Math.max(0, text.search(re) - 40), text.search(re) + 50)}"`); }
    }
    check(`${Object.keys(pages).length} public pages and states: no price, saving, guarantee, payment term, spec, certificate, insurance, accreditation, years or review claim outside a tagged idea`, bad.length === 0, bad.slice(0, 8).join(' | '));
    // the quote page: its figures are the quote itself (labelled sample); the wider promises must still be tagged ideas
    const quoteBad = [];
    const QUOTE_CLAIMS = CLAIMS.filter(([w]) => !['a price', 'a certificate', 'a payment term'].includes(w));
    for (const [name, s] of Object.entries({ 'quote (sent)': snaps.quoteSent, 'quote (accepted)': snaps.quoteAccepted, 'quote (link mode)': snaps.quoteLink })) {
      const text = ownWordsRemoved(s.flat, REFDATA).replace(/Testing and certification/g, ' ');
      for (const [what, re] of [...QUOTE_CLAIMS, ['a certificate', /\bcertificate\b/i], ['a payment term', /\b(payable|deposit|invoice|due when|pay (after|on|when|by))\b/i]]) { const m = text.match(re); if (m) quoteBad.push(`${name}: ${what} "${m[0]}"`); }
    }
    check('the quote page makes no claim outside the quote lines and the tagged "Sample terms" idea', quoteBad.length === 0, quoteBad.slice(0, 6).join(' | '));
    // tagging: every idea block says it is one (an "Idea from us" tag, or the word prototype, demo, simulated, sample, example, illustrative)
    const untagged = [];
    const LABELLED = /idea from us|prototype|demo|simulat|sample|example|illustrative|webhook|suggested|could offer|will confirm/i;
    for (const s of [snaps.landing, snaps.confirm, snaps.confirmOpen, snaps.step1, snaps.quoteSent, snaps.quoteLink]) {
      for (const b of s.ideaBlocks) if (!b.tagged && !LABELLED.test(b.text)) untagged.push(`${s.name}: ${b.testid || ''} "${b.text.slice(0, 60)}"`);
    }
    check('every data-proto block says it is an idea or a prototype note (tag or wording)', untagged.length === 0, untagged.slice(0, 6).join(' | '));
    // his clean view really is clean: nothing from the idea list survives "Only my content"
    check('"Only my content" hides every idea: no tag, no figure, no example quote on the landing page', !/Idea from us/.test(snaps.landingClean.flat) && !/£\s?\d/.test(snaps.landingClean.flat) && !/Illustrative estimate/.test(snaps.landingClean.flat), (snaps.landingClean.flat.match(/.{30}(Idea from us|£\s?\d|Illustrative estimate).{30}/) || [''])[0]);
    check('"Only my content" on the confirmation and the quote page hides the ideas too', !/Idea from us/.test(snaps.confirmClean.flat) && !/Idea from us/.test(snaps.quoteSentClean.flat), (snaps.confirmClean.flat.match(/.{30}Idea from us.{30}/) || snaps.quoteSentClean.flat.match(/.{30}Idea from us.{30}/) || [''])[0]);
  });

  await section('11. his words, exactly: hero, three steps, six FAQs, the six funnel steps with options and notes, the confirmation', async () => {
    const r = REFDATA;
    const L = snaps.landing.all;
    const must = (name, expected, hay) => { const missing = expected.filter((e) => !hay.includes(e)); check(name, missing.length === 0, 'missing: ' + missing.map((m) => `"${m.slice(0, 80)}"`).join(' ; ')); };
    must('hero: eyebrow, H1, paragraph and the button text are his, word for word', [r.eyebrow, r.h1, r.heroP, r.cta], L);
    must('hero: "Free, no-obligation quote" and his two credentials', ['Free, no-obligation quote', ...r.credentials], L);
    must('the three reasons: title and body, word for word', [r.whyTitle, ...r.why.flatMap((w) => [w.title, w.body])], L);
    must('the three steps: title, each heading and each body, word for word', [r.stepsTitle, ...r.steps.flatMap((s) => [s.title, s.body])], L);
    // his three ticks live in the hero spec strip (data-testid hero-ticks) and are not repeated further down the page; his two credentials sit in the same strip
    check('the three ticks are the hero\'s own list (hero-ticks), word for word and in his order', JSON.stringify(snaps.landing.heroTicks) === JSON.stringify(r.ticks), JSON.stringify(snaps.landing.heroTicks));
    check('his ticks and his credentials appear once each on the page (they are not repeated in About or the footer)', [...r.ticks, ...r.credentials].every((t) => L.split(t).length === 2), [...r.ticks, ...r.credentials].map((t) => `${t}: ${L.split(t).length - 1}`).join(' | '));
    must('the credentials', r.credentials, L);
    must('"Your installation, clearly quoted.", his paragraph and his area paragraph', [r.pricingTitle, r.pricingP, r.areaTitle, r.areaP], L);
    must('the final call to action: his heading and paragraph', [r.finalTitle, r.finalP], L);
    must('the six FAQ questions and the six answers, word for word', [r.faqTitle, ...r.faq.flatMap((f) => [f.q, f.a])], L);
    const cta = [...snaps.landing.buttons, ...snaps.landing.links].filter((b) => !b.proto && /quote/i.test(b.text) && !/^(Meet|Our work|How it works|Pricing|Costs|FAQ)/.test(b.text));
    check('every call to action on the landing page has his exact text "Get my installation quote" (header, hero, quote section, final call to action)', cta.length >= 3 && cta.every((b) => b.text === r.cta), JSON.stringify(cta.map((b) => b.text)));
    check('the first FAQ answer open is the cost one, as on his page', /How much will installation cost\?/.test(L));

    const f = FUNNEL;
    must('funnel step 1: his eyebrow, question, field label, error text, button and help line', [f.step1.eyebrow, f.step1.h1, f.step1.field, f.step1.button, f.step1.help], snaps.step1.all);
    must('funnel step 1: his error text appears on a bad postcode', [f.step1.error], snaps.step1error.all);
    check('funnel step 1 placeholder is an example postcode (a deliberate deviation: Northern Ireland)', /^e\.g\. BT\d/.test(snaps.step1placeholder || ''), snaps.step1placeholder);
    for (const st of f.steps) {
      const s = snaps.steps[st.n];
      check(`funnel step ${st.n}: his question "${st.h1}" and his options "${st.options.join(' | ')}"`, s.heading === st.h1 && JSON.stringify(s.optionLabels) === JSON.stringify(st.options), `${s.heading} / ${JSON.stringify(s.optionLabels)}`);
      if (st.note) check(`funnel step ${st.n}: his note "${st.note.slice(0, 50)}"`, s.all.includes(st.note), s.all.slice(0, 160));
    }
    const s6 = snaps.step6;
    check('funnel step 6: his question, his five field labels, textarea placeholder, opt-in, small print', s6.all.includes(f.step6.h1) && f.step6.labels.every((l) => s6.all.includes(l)) && s6.notesPlaceholder === f.step6.notesPlaceholder && s6.all.includes(f.step6.optIn) && s6.all.includes(f.step6.smallPrint),
      [s6.all.includes(f.step6.h1) ? '' : 'h1', f.step6.labels.filter((l) => !s6.all.includes(l)).join(','), s6.notesPlaceholder === f.step6.notesPlaceholder ? '' : 'placeholder', s6.all.includes(f.step6.optIn) ? '' : 'optin', s6.all.includes(f.step6.smallPrint) ? '' : 'smallprint'].filter(Boolean).join(' '));
    check('funnel step 6: the submit button says "Request my installation quote"', snaps.step6.all.includes(f.step6.submit), '');
    check('funnel step 6 postcode placeholder is an example postcode (deliberate deviation)', /^e\.g\. BT\d/.test(s6.postcodePlaceholder || ''), s6.postcodePlaceholder);
    const c = snaps.confirm;
    check('confirmation: his headline, his paragraph (24 hours), his "Helpful to have ready" box and his call line', c.heading === f.confirm.h1 && c.all.includes(f.confirm.p) && c.all.includes(f.confirm.boxTitle) && snaps.confirmOpen.all.includes(f.confirm.box) && c.all.includes(f.confirm.button),
      [c.heading === f.confirm.h1 ? '' : `title "${c.heading}"`, c.all.includes(f.confirm.p) ? '' : 'paragraph', c.all.includes(f.confirm.boxTitle) ? '' : 'box title', snaps.confirmOpen.all.includes(f.confirm.box) ? '' : 'box text', c.all.includes(f.confirm.button) ? '' : 'call button'].filter(Boolean).join(' | '));
    // The About band is verbatim (LANDING-V5 5.5): his heading and both paragraphs, no name, no caption. No deviation is allowed there any more.
    must('the About band uses his own heading and both paragraphs, word for word', [r.aboutTitle, r.aboutP1, r.aboutP2], L);
    check('the About band names nobody (the earlier "Meet Daniel" personalisation is gone)', !/Meet Daniel|Daniel, 180 Electrical/.test(L), (L.match(/.{30}(Meet Daniel|Daniel, 180 Electrical).{30}/) || [''])[0]);
    for (const d of DELIBERATE_DEVIATIONS) note('deliberate deviation: ' + d);
  });

  await section('12. everything simulated says so, on its own screen and in "What\'s real"', async () => {
    const d = snaps.dash;
    const sim = /simulat|practice mode|sample|prototype/i;
    for (const name of ['connections', 'connections domain', 'connections webhook', 'connections tracking', 'connections whatsapp', 'connections calendar', 'connections email']) {
      check(`${name}: says "Simulated in this prototype" on the screen`, /simulated in this prototype/i.test(d[name].all), d[name].all.slice(0, 100));
    }
    check('messages: the outbox says SIMULATED and "Nothing is sent from this prototype", and every bubble is "Sent (simulated)" or "Scheduled (simulated)"', /outbox \(simulated\)/i.test(d.messages.all) && /Nothing is sent from this prototype/.test(d.messages.all) && /Sent \(simulated\)/.test(d.messages.all), d.messages.all.slice(0, 160));
    check('demo tools: says what is stood in for', /simulat|stand/i.test(d.demo.all) && sim.test(d.demo.all));
    check('payments: the "How did they pay?" sheet says it only records the payment and that nothing is charged (simulated)', !!d.paidSheet && /simulated in this prototype/i.test(d.paidSheet.all) && /nothing is charged/i.test(d.paidSheet.all), d.paidSheet ? d.paidSheet.all.slice(0, 200) : 'the sheet did not open');
    check('more: the Connections row is labelled simulated or practice mode', /practice mode|simulated/i.test(d.more.all), d.more.all.slice(0, 120));
    check('the customer confirmation labels its demo "Demo, simulated" and every message "Sent (simulated)"', /DEMO, SIMULATED/i.test(snaps.confirmOpen.all) && /Sent \(simulated\)/.test(snaps.confirmOpen.all));
    check('the customer confirmation says the live site does this automatically through the funnel webhook (tagged)', /happens automatically through your funnel's webhook/.test(snaps.confirm.all) && snaps.confirm.ideaBlocks.some((b) => /webhook/.test(b.text)));
    check('the quote page says its prices are samples', /sample price|sample prices|prototype: sample/i.test(snaps.quoteSent.all) && /sample/i.test(snaps.quoteLink.all), snaps.quoteSent.all.slice(0, 160));
    const about = d.about.all;
    for (const [what, re] of [['WhatsApp', /whatsapp/i], ['email (Gmail)', /gmail/i], ['Google Calendar', /google calendar/i], ['the domain', /domain/i], ['the webhook', /webhook/i], ['payments', /payments?/i], ['ad tracking', /tracking|pixel/i], ['delivery between phones', /between phones|wa\.me/i], ['a database', /database/i], ['a login', /login/i]]) {
      check(`"What's real" covers ${what} as simulated and says what a real build needs`, re.test(about) && /simulated/i.test(about) && /real build/i.test(about), '');
    }
    check('"What\'s real" is honest about the handoff: real wa.me links and payloads, no server, you tap send', /wa\.me/.test(about) && /no server/i.test(about) && /tap(s)? send/i.test(about));
    check('"What\'s real" does not say the customer is told the survey is provisional or pencilled', !/customer told it is provisional|told it is provisional/i.test(about), (about.match(/.{60}provisional.{40}/i) || [''])[0]);
  });

  await section('13. links: his phone, his WhatsApp, his email, and nothing else', async () => {
    const pages = { landing: snaps.landing, 'landing 1280': snaps.landingDesktop, 'funnel step 1': snaps.step1, 'funnel step 6': snaps.step6, confirmation: snaps.confirm, manage: snaps.manageNew, quote: snaps.quoteSent, 'quote link': snaps.quoteLink };
    const bad = [];
    let tels = 0;
    let was = 0;
    let mails = 0;
    for (const [name, s] of Object.entries(pages)) {
      for (const l of s.links) {
        const h = l.href;
        if (/^tel:/i.test(h)) { tels += 1; if (h !== 'tel:+447885496800') bad.push(`${name}: ${h}`); }
        else if (/^mailto:/i.test(h)) { mails += 1; if (!/^mailto:daniel@180electrical\.co\.uk(\?|$)/.test(h)) bad.push(`${name}: ${h}`); }
        else if (/wa\.me/.test(h)) { was += 1; if (!/^https:\/\/wa\.me\/447885496800(\?|$)/.test(h)) bad.push(`${name}: ${h.slice(0, 60)}`); }
        else if (/^https?:\/\//i.test(h) && !h.startsWith(BASE)) bad.push(`${name}: off-site link ${h.slice(0, 70)}`);
        else if (/^sms:|^whatsapp:/i.test(h)) bad.push(`${name}: ${h}`);
      }
    }
    check(`every phone, WhatsApp and email link on the customer pages is his (${tels} tel, ${was} wa.me, ${mails} mailto)`, bad.length === 0 && tels >= 4 && was >= 3 && mails >= 1, bad.join(' | ') || `tel ${tels} wa ${was} mail ${mails}`);
    const wa = snaps.waLink || '';
    check('the "Send my enquiry to Daniel on WhatsApp" link goes to 447885496800 and ends with a dashboard.html#import= link', /^https:\/\/wa\.me\/447885496800\?text=/.test(wa) && /dashboard\.html%23import%3D[A-Za-z0-9_-]+$/.test(wa) || /dashboard\.html#import=/.test(decodeURIComponent(wa)), wa.slice(0, 100));
    const readable = Object.values(pages).map((s) => s.all).join(' ');
    const phones = [...new Set((readable.match(/\b0\d{3,4} ?\d{3} ?\d{3,4}\b/g) || []))];
    check('the only phone number printed on the customer pages is 07885 496800', phones.every((p) => p === '07885 496800'), phones.join(', '));
    const mails2 = [...new Set((readable.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []))];
    check('the only email address printed on the customer pages is daniel@180electrical.co.uk', mails2.every((m) => m === 'daniel@180electrical.co.uk'), mails2.join(', '));
    check('the quote page\'s own links are his too (call, WhatsApp, "Ask a question")', snaps.quoteLinkHrefs.filter((h) => /^tel:/.test(h)).every((h) => h === 'tel:+447885496800') && snaps.quoteLinkHrefs.filter((h) => /wa\.me/.test(h)).every((h) => h.startsWith('https://wa.me/447885496800')), snaps.quoteLinkHrefs.filter((h) => /tel:|wa\.me/.test(h)).join(' ').slice(0, 200));
    check('the quote page\'s accept reply opens WhatsApp to him with a dashboard.html#import= link', /^https:\/\/wa\.me\/447885496800\?text=/.test(snaps.quoteReplyHref || '') && /dashboard\.html(%23|#)import/.test(snaps.quoteReplyHref || ''), (snaps.quoteReplyHref || '').slice(0, 120));
  });
}

// ---------------------------------------------------------------- 14. page heads, manifest, icons (static)
await section('14. page heads, manifest and icons', async () => {
  const pngSize = (rel) => { const b = fs.readFileSync(path.join(ROOT, rel)); return b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
  const titles = [];
  for (const f of HTML) {
    const h = read(f);
    const title = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const desc = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    titles.push(title);
    check(`${f}: lang en-GB, charset, viewport with viewport-fit, noindex,nofollow, theme-color, colour-scheme (light and dark), manifest, favicon and apple-touch-icon`,
      /<html lang="en-GB"/.test(h) && /<meta charset="utf-8">/.test(h) && /name="viewport" content="[^"]*viewport-fit=cover/.test(h) && /<meta name="robots" content="noindex, nofollow">/.test(h) && /<meta name="theme-color" content="#[0-9A-Fa-f]{6}">/.test(h)
      && /<meta name="color-scheme" content="(dark light|light dark)">/.test(h) && /<link rel="manifest" href="manifest\.webmanifest">/.test(h) && /<link rel="icon" href="img\/favicon\.svg"/.test(h) && /<link rel="apple-touch-icon" href="img\/apple-touch-icon\.png">/.test(h));
    check(`${f}: title "${title}" is short, names 180 and has no old brand; description mentions the prototype and sample data`, title.length > 8 && title.length <= 70 && /180/.test(title) && !/voltmere/i.test(title) && /prototype/i.test(desc) && /sample data/i.test(desc) && desc.length <= 200, `${title} | ${desc}`);
    check(`${f}: noscript fallback is his number`, /<noscript>[^<]*07885 496800/.test(h));
    const assets = [...h.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:|^mailto:|^tel:/.test(u));
    const missing = assets.filter((u) => !exists(u));
    check(`${f}: every local file it links exists`, missing.length === 0, missing.join(', '));
  }
  check('the three page titles differ and each says what the page is', new Set(titles).size === 3 && /EV charger/i.test(titles.find((t) => /Home EV/.test(t)) || '') && titles.some((t) => /quote/i.test(t)) && titles.some((t) => /dashboard/i.test(t)), titles.join(' | '));
  const man = JSON.parse(read('manifest.webmanifest'));
  check('manifest: name 180 Electrical, lang en-GB, relative start_url and scope, black theme and background, a description naming the prototype', man.name === '180 Electrical' && man.lang === 'en-GB' && man.start_url === './index.html' && man.scope === './' && man.theme_color === '#0B0B0C' && man.background_color === '#0B0B0C' && /prototype/i.test(man.description) && /sample data/i.test(man.description), JSON.stringify(man).slice(0, 200));
  const iconOk = man.icons.every((ic) => { if (!exists(ic.src)) return false; if (ic.src.endsWith('.png')) { const sz = pngSize(ic.src); return sz && `${sz[0]}x${sz[1]}` === ic.sizes; } return true; });
  check('manifest: every icon exists and its PNG is the size it claims', iconOk && man.icons.length >= 3, JSON.stringify(man.icons));
  check('the apple-touch-icon is a 180 px PNG', (pngSize('img/apple-touch-icon.png') || [])[0] === 180, String(pngSize('img/apple-touch-icon.png')));
  check('the theme-color in each page head agrees with the manifest', HTML.every((f) => read(f).includes(`name="theme-color" content="${man.theme_color}"`)));
  const vercel = JSON.parse(read('vercel.json'));
  check('vercel.json: static site, no build, relative output', vercel.outputDirectory === '.' && vercel.buildCommand === null && vercel.installCommand === null);
  check('.nojekyll is present (GitHub Pages serves files that start with an underscore)', exists('.nojekyll'));
  const pkg = JSON.parse(read('package.json'));
  check('package.json: private, ES modules, test and serve scripts, and an audit script', pkg.private === true && pkg.type === 'module' && !!pkg.scripts.test && !!pkg.scripts.serve && !!pkg.scripts.audit, JSON.stringify(pkg.scripts));
  // the contact constants and link builders in core
  const msgs = await import(path.join(ROOT, 'js/core/messages.js'));
  check('link builders: telLink, waLink and mailtoLink make his links', msgs.telLink('07885 496800') === 'tel:+447885496800' && msgs.waLink('07885 496800', 'Hi').startsWith('https://wa.me/447885496800?text=') && msgs.mailtoLink('daniel@180electrical.co.uk').startsWith('mailto:daniel@180electrical.co.uk'), msgs.telLink('07885 496800'));
  // every phone number and email address typed into a source string is his, an Ofcom drama number, or an example address
  const stray = [];
  for (const f of [...JS, ...HTML]) {
    for (const s of f.endsWith('.js') ? jsStrings(read(f)) : [{ line: 0, text: read(f) }]) {
      for (const m of s.text.matchAll(/(?<![\d+])0\d{3,4} ?\d{3} ?\d{3,4}(?!\d)/g)) { if (!/^07885 ?496800$|^07700 ?900\d{3}$|^0800 ?\d{3} ?\d{4}$|^0123456789$/.test(m[0])) stray.push(`${f}:${s.line} ${m[0]}`); }
      for (const m of s.text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) { if (!/^(daniel@180electrical\.co\.uk|[\w.+-]+@example\.(com|org|invalid|co\.uk)|name@email\.com|name@gmail\.com)$/.test(m[0])) stray.push(`${f}:${s.line} ${m[0]}`); }
    }
  }
  check('every phone number and email address in the source is his, an Ofcom drama number (07700 900xxx) or an example address', stray.length === 0, stray.slice(0, 8).join(' | '));
});

// ---------------------------------------------------------------- 15. the docs
await section('15. docs say what is true', async () => {
  const readme = read('README.md');
  check('README: titled 180 Electrical, with the live links (site, dashboard, a quote link example)', /^# 180 Electrical/.test(readme) && readme.includes('https://gokulmadan-ws.github.io/voltmere-electrical/') && readme.includes('https://gokulmadan-ws.github.io/voltmere-electrical/dashboard.html') && /quote\.html#(d|q)=/.test(readme));
  check('README: two-phone demo script, the "Show: With ideas | Only my content" switch, Settings and config, real vs simulated table, a real build and a phase plan, tests, deploy, repo map',
    ['5-minute demo', 'With ideas', 'Only my content', 'Settings', 'Real or simulated', 'real build', 'Phase', 'node --test', 'GitHub Pages', 'Vercel', 'Repo map'].every((w) => readme.includes(w)), ['5-minute demo', 'With ideas', 'Only my content', 'Settings', 'Real or simulated', 'real build', 'Phase', 'node --test', 'GitHub Pages', 'Vercel', 'Repo map'].filter((w) => !readme.includes(w)).join(', '));
  check('README: no claim that the data stays on one device only, and no "3-minute demo" from the v1 contract', !/3-minute demo/i.test(readme) && !/does \*\*not\*\* reach the owner's phone/.test(readme));
  check('docs/DEMO-SCRIPT.md exists with numbered steps and the exact taps', exists('docs/DEMO-SCRIPT.md') && /Send my enquiry to Daniel on WhatsApp/.test(read('docs/DEMO-SCRIPT.md')) && /Add to my dashboard/.test(read('docs/DEMO-SCRIPT.md')) && /Mark quote accepted and plan the install/.test(read('docs/DEMO-SCRIPT.md')));
  check('docs/PRODUCTION-PLAN.md exists with scope, architecture, phases, risks, effort in weeks and open questions for Daniel', exists('docs/PRODUCTION-PLAN.md') && ['Scope', 'Architecture', 'Phase', 'Risks', 'weeks', 'Open questions'].every((w) => read('docs/PRODUCTION-PLAN.md').includes(w)));
  const contract = read('docs/BUILD-CONTRACT.md');
  check('BUILD-CONTRACT.md opens with a banner: historical v1 spec, superseded by V3-SPEC and V4-HANDOFF', /historical/i.test(contract.slice(0, 700)) && /V3-SPEC/.test(contract.slice(0, 700)) && /V4-HANDOFF/.test(contract.slice(0, 700)), contract.slice(0, 200));
  const misleading = [];
  for (const f of DOCS.filter((d) => d !== 'README.md')) {
    read(f).split('\n').forEach((l, k) => { if (/data lives in one browser|does not reach the owner's phone|no way to move data between phones/i.test(l)) misleading.push(`${f}:${k + 1} ${l.trim().slice(0, 80)}`); });
  }
  check('no doc still says data cannot cross phones (V4 made the WhatsApp loop real)', misleading.length === 0, misleading.join(' | '));
  const ids = new Set([...read('README.md').matchAll(/docs\/([A-Z0-9-]+\.md)/g)].map((m) => m[1]));
  check('every docs file README points to exists', [...ids].every((n) => exists(`docs/${n}`)), [...ids].filter((n) => !exists(`docs/${n}`)).join(', '));
});

// ---------------------------------------------------------------- end
if (browser) await browser.close();
console.log(`\n${failures === 0 ? 'AUDIT CLEAN' : 'AUDIT FAILED'}: ${passes} checks passed, ${failures} failed`);
if (server) server.kill();
process.exit(failures === 0 ? 0 : 1);
