// js/core/store.js: the persisted store (localStorage with memory fallback), every mutation, cross-tab sync and undo
// Owner: WP1 (v1), A3 (v3 additions: quotes, connections, marketing, photos, storage guard)
import {
  AD_CHANNELS, BUSINESS_TEXT_MAX, DEFAULT_IMAGES, DEFAULT_QUOTE_NOTES, EMERGENCY_REASONS, HALF_DAY_STARTS, IMAGE_KEYS, KIND_LABELS, PAID_METHODS, PROMISES, QUOTE_VIA, SCHEMA_VERSION,
  LEGACY_QUOTE_NOTES, SOURCES, STORAGE_KEYS, WHATSAPP_DEMO_CODE, WHATSAPP_TEMPLATE_KINDS, WINDOWS,
  chargerItemId, makeChargerItem, makeDefaultBusiness, makeDefaultConnections, makeDefaultQuoteItems, makeDefaultSettings, normaliseAnswers
} from './config.js';
import { now, nowStamp, nowStampSec, todayKey } from './clock.js';
import { addDays, addMinutes, isDayKey, makeStamp, stampDay } from './dates.js';
import { bookingWindowIds, bookingWhenArrival, isSlotFree, isUnscheduled, nextFreeSlot, nextFreeSlots, occupiedBy } from './availability.js';
import {
  makeId as freshId, normaliseDemoPhone, normalisePhone, normalisePostcode, own, plainText, postcodeZone,
  validateLine1, validateName, validatePhone, validatePostcode
} from './format.js';
import { alertHeading, buildMessage, buildSystemMessage, messageIsScheduled, reminderSendAt } from './messages.js';
import { buildSeed, SIM_POOL } from './seed.js';
import { isWithinChangeCutoff, quotedPriceFor } from './selectors.js';
import { assessQuoteDecision, defaultQuoteLines, latestQuoteFor, normaliseQuoteItems, normaliseQuoteLines, quoteStatus, quoteTotal } from './quotes.js';
import { declineReasonText, describePreferences, parseImport, quoteLinkInfo } from './handoff.js';
import {
  GCAL_GROUP_ID, domainRecords, isValidEmail, normaliseWhatsAppNumber, settleConnectionsIn, simulatedBusyBlocks, validateConnectionPatch, validateHostname
} from './connections.js';
import { PHOTO_LIMITS, normalisePhotos, validatePhoto } from './photos.js';
import { normaliseUtm } from './utm.js';
import { repairState } from './repair.js';

// ---------- module state ----------

let state = null; // the current frozen State
let storage = null; // StorageLike while persisting, else null (memory mode)
let mode = 'memory';
let lastRaw = null; // the raw JSON this page last read or wrote
let listenersInstalled = false;
const subscribers = new Set();
const tokens = new Map(); // undo tokens live in memory only (max 20)
const MAX_TOKENS = 20;
// A missing migration discards the (demo) data and reseeds. v1 -> v2 is the move to the 180 Electrical model (see migrateV1);
// v2 -> v3 adds quotes, the pipeline settings and the simulated connections (see migrateV2).
const MIGRATIONS = { 1: (old) => migrateV1(old), 2: (old) => migrateV2(old) };
const settleTimers = new Set(); // real-time timers that finish a simulated delay (cleared by initStore({ force }))

// ---------- cross-tab lineage: every write names itself in meta.writes, and a write another tab overwrote is replayed ----------
// localStorage is shared by every tab of this browser, but a tab can read a stale copy for a few milliseconds after another tab wrote, and a tab running a
// synchronous burst reads nothing new at all. Two tabs can therefore each save a state that lacks the other's change, and the last save would win.
// So each write appends a random id to meta.writes (the last WRITES_KEPT of them travel with the state). A tab keeps the mutations it made, and when
// it reads back a state whose journal does not hold one of them it knows that write was overwritten, and runs the same mutation again on top of the
// state it just read. That re-runs the rules (the next free ref, the next free window, the next message number) against the real latest state, so
// nothing is lost and nothing double-books. The ids a mutation generated are reused, so a booking keeps its id.
const WRITES_KEPT = 200;
const PENDING_MAX = 60;
let pending = []; // [{ id, rev, fn, ids }] this tab's writes not yet seen in a state read back from storage, oldest first
let idTape = null; // while a mutation runs: { record: [[prefix, id]], replay: [[prefix, id]] }

/** makeId, but a mutation that is run again gets the ids it generated the first time (when they are still free). */
function makeId(prefix) {
  if (idTape) {
    const next = idTape.replay[0];
    if (next && next[0] === prefix) {
      idTape.replay.shift();
      idTape.record.push(next);
      return next[1];
    }
    const id = freshId(prefix);
    idTape.record.push([prefix, id]);
    return id;
  }
  return freshId(prefix);
}

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

// ---------- storage ----------

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null; // some browser modes throw on the property access itself
  }
}

function canWrite(s) {
  try {
    s.setItem('vm_probe', '1');
    s.removeItem('vm_probe');
    return true;
  } catch (e) {
    return false;
  }
}

function readTheme(s) {
  try {
    const t = s && s.getItem(STORAGE_KEYS.theme);
    return t === 'light' || t === 'dark' || t === 'auto' ? t : null;
  } catch (e) {
    return null;
  }
}

function looksValid(st) {
  return !!st && typeof st === 'object' && st.v === SCHEMA_VERSION
    && Array.isArray(st.bookings) && Array.isArray(st.blocks) && Array.isArray(st.messages)
    && !!st.settings && typeof st.settings === 'object' && !!st.settings.business
    && Array.isArray(st.settings.services) && Array.isArray(st.settings.hours)
    && Array.isArray(st.settings.daysOff) && Array.isArray(st.settings.fullDays)
    && !!st.meta && typeof st.meta === 'object' && Number.isFinite(st.meta.rev) && Number.isFinite(st.meta.msgSeq)
    && Number.isFinite(st.refSeq) && typeof st.seededFor === 'string'
    && !!st.quotes && typeof st.quotes === 'object' && !Array.isArray(st.quotes)
    && !!st.settings.sla && !!st.settings.marketing && Array.isArray(st.settings.marketing.adSpend)
    && Array.isArray(st.settings.quoteItems) && !!st.settings.quoteDefaults
    && !!st.settings.connections && !!st.settings.connections.whatsapp && !!st.settings.connections.domain;
}

// An older "v1" state (the generic electrician, or the first 180 rebrand) gains the new fields and services. Demo records
// (seed: true) are dropped and seededFor is cleared so the next load re-seeds them EV-led; whatever the owner or a customer
// made is kept. The old placeholder contact details are swapped for his real ones, anything else he edited stays.
function migrateV1(old) {
  const next = clone(old);
  const base = makeDefaultSettings();
  const settings = next.settings && typeof next.settings === 'object' ? next.settings : {};
  const biz = settings.business && typeof settings.business === 'object' ? settings.business : {};
  const wasGeneric = Array.isArray(biz.coveredOutward) && biz.coveredOutward.includes('MB1'); // the old fictional area
  const merged = wasGeneric ? makeDefaultBusiness() : { ...makeDefaultBusiness(), ...biz };
  if (merged.phone === '07700 900412') merged.phone = base.business.phone;
  if (typeof merged.email === 'string' && merged.email.endsWith('.example')) merged.email = base.business.email;
  if (merged.ownerFirstName === 'Dan' && merged.ownerFullName === 'Dan') {
    merged.ownerFirstName = base.business.ownerFirstName;
    merged.ownerFullName = base.business.ownerFullName;
  }
  if (!Array.isArray(merged.credentials)) merged.credentials = base.business.credentials;
  if (!Array.isArray(merged.brands)) merged.brands = base.business.brands;
  if (merged.schemeLine && /\(sample\)/.test(merged.schemeLine)) merged.schemeLine = '';
  if (merged.insuranceLine && /\(sample\)/.test(merged.insuranceLine)) merged.insuranceLine = '';
  settings.business = merged;

  const stored = Array.isArray(settings.services) ? settings.services : [];
  const services = base.services.map((def) => {
    const had = stored.find((x) => x && x.id === def.id);
    if (!had) return def;
    if (def.id === 'ev_quote' || def.id === 'ev') {
      const price = def.id === 'ev' && Number.isInteger(had.price) && had.price >= 0 ? had.price : def.price;
      return { ...def, price, active: had.active !== false };
    }
    return { ...had, showOnWebsite: had.showOnWebsite === true };
  });
  for (const extra of stored) if (extra && !services.some((x) => x.id === extra.id)) services.push({ ...extra, showOnWebsite: extra.showOnWebsite === true });
  settings.services = services;
  settings.takingEmergencies = false;
  if (!['auto', 'light', 'dark'].includes(settings.theme)) settings.theme = base.theme;
  next.settings = settings;

  next.bookings = (Array.isArray(next.bookings) ? next.bookings : []).filter((b) => b && !b.seed);
  next.blocks = (Array.isArray(next.blocks) ? next.blocks : []).filter((b) => b && !b.seed);
  next.messages = (Array.isArray(next.messages) ? next.messages : []).filter((m) => m && !m.seed);
  next.seededFor = ''; // not today: initStore runs the rollover, which seeds fresh demo records around the kept ones
  next.v = 2;
  return next;
}

// A v2 state gains the v3 fields with defaults. The old demo records (seed: true) are dropped and seededFor is cleared so the next
// load seeds the v3 demo around whatever the owner or a customer made. Everything the person set is kept.
function migrateV2(old) {
  const next = clone(old);
  const base = makeDefaultSettings();
  const settings = next.settings && typeof next.settings === 'object' ? next.settings : {};
  const biz = settings.business && typeof settings.business === 'object' ? settings.business : {};
  settings.business = {
    ...base.business,
    ...biz,
    address: typeof biz.address === 'string' ? biz.address : '',
    images: { ...base.business.images, ...(biz.images && typeof biz.images === 'object' ? biz.images : {}) }
  };
  settings.sla = settings.sla && Number.isInteger(settings.sla.replyHours) ? settings.sla : base.sla;
  settings.marketing = { adSpend: [] };
  settings.quoteDefaults = base.quoteDefaults;
  settings.quoteItems = makeDefaultQuoteItems(Array.isArray(settings.business.brands) ? settings.business.brands : base.business.brands);
  settings.connections = makeDefaultConnections();
  next.settings = settings;
  next.quotes = {};
  next.bookings = (Array.isArray(next.bookings) ? next.bookings : []).filter((b) => b && !b.seed);
  next.blocks = (Array.isArray(next.blocks) ? next.blocks : []).filter((b) => b && !b.seed);
  next.messages = (Array.isArray(next.messages) ? next.messages : []).filter((m) => m && !m.seed).map((m) => ({ ...m, channel: m.channel === 'email' ? 'email' : 'whatsapp' }));
  next.seededFor = '';
  next.v = 3;
  return next;
}

// A v3 save made before the polish round: its catalogue has no `optional` flag (the consumer unit upgrade is the one possible extra) and its
// quoteDefaults.notes may still hold the longer sample text that made payment-style promises. Both are brought up to date in place; anything the
// owner edited stays. Quote lines need nothing: a line without `optional` has always counted in its total.
function refreshQuoteContent(st) {
  const settings = st && st.settings;
  if (!settings || typeof settings !== 'object') return st;
  if (Array.isArray(settings.quoteItems)) {
    for (const item of settings.quoteItems) {
      if (item && typeof item === 'object' && typeof item.optional !== 'boolean') item.optional = item.id === 'consumer_unit';
    }
  }
  const defaults = settings.quoteDefaults;
  if (defaults && typeof defaults === 'object' && LEGACY_QUOTE_NOTES.includes(defaults.notes)) defaults.notes = DEFAULT_QUOTE_NOTES;
  return st;
}

let lastRepairs = 0; // how many entries or fields the last parseState had to drop or fix (0 for a clean save)

/**
 * Parse + migrate + validate + repair. Returns a State or null (garbage, newer schema, missing migration, an outline that is wrong).
 * Nothing in here may throw: a save that cannot be read is the same as no save, and initStore re-seeds.
 */
function parseState(raw) {
  lastRepairs = 0;
  try {
    let parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Number.isInteger(parsed.v) || parsed.v > SCHEMA_VERSION) return null;
    while (parsed.v < SCHEMA_VERSION) {
      const step = MIGRATIONS[parsed.v];
      if (!step) return null;
      parsed = step(parsed);
    }
    if (!looksValid(parsed)) return null;
    // right outline: make sure every entry the screens read is usable (drops what cannot be shown, never touches a clean state)
    const { state: repaired, changes } = repairState(parsed, { today: todayKey() });
    lastRepairs = changes;
    return refreshQuoteContent(repaired);
  } catch (e) {
    return null;
  }
}

// A save that could not be used is replaced by a fresh seed; a copy of it is kept aside (best effort, small ones only) so nothing is lost for good.
const BAD_COPY_MAX = 400000;
function keepBadCopy(s, raw) {
  if (!s || typeof raw !== 'string' || !raw || raw.length > BAD_COPY_MAX) return;
  try {
    s.setItem(STORAGE_KEYS.backup, raw);
  } catch (e) {
    // no room for a copy: the fresh start matters more
  }
}

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || '')));
}

/**
 * Write the whole state. Returns 'full' (and writes nothing) when the browser refuses because of its quota, so a failed write can
 * never leave the saved state half-written; a storage that is blocked outright drops to memory mode as before.
 */
function writeState(st) {
  const json = JSON.stringify(st);
  if (mode === 'local' && storage) {
    try {
      storage.setItem(STORAGE_KEYS.state, json);
    } catch (e) {
      if (isQuotaError(e) || canWrite(storage)) return 'full'; // too big for the quota (a small write still works)
      mode = 'memory'; // a blocked write: carry on in memory for the rest of the page's life
    }
  }
  lastRaw = json;
  return 'ok';
}

// ---------- seeding and rollover ----------

function maxSeq(messages) {
  return messages.reduce((m, x) => Math.max(m, x.seq || 0), 0);
}

function freshState(theme) {
  const settings = makeDefaultSettings();
  if (theme) settings.theme = theme;
  const seed = buildSeed(now(), settings);
  const top = maxSeq(seed.messages);
  settings.marketing.adSpend = seed.adSpend;
  return {
    v: SCHEMA_VERSION,
    seededFor: todayKey(),
    refSeq: seed.refSeq,
    settings,
    bookings: seed.bookings,
    blocks: seed.blocks,
    messages: seed.messages,
    quotes: seed.quotes,
    meta: { rev: 1, msgSeq: top, messagesSeenSeq: top, simCursor: 0 }
  };
}

// Demo ad spend (seed: true) is swapped for a fresh set; entries a person made win over a seed entry for the same month and channel.
function mergeAdSpend(keep, seeded) {
  const taken = new Set(keep.map((e) => `${e.month}|${e.channel}`));
  return [...keep, ...seeded.filter((e) => !taken.has(`${e.month}|${e.channel}`))].sort(adSpendOrder);
}

function adSpendOrder(a, b) {
  return a.month < b.month ? -1 : a.month > b.month ? 1 : AD_CHANNELS.indexOf(a.channel) - AD_CHANNELS.indexOf(b.channel);
}

// Replace the simulated Google Calendar busy blocks: removed when the calendar is not connected (or one-way), re-imported when it is.
// Returns the ids of the blocks added and removed (so an undo can bring them back).
function syncCalendarBlocks(draft) {
  const removed = draft.blocks.filter((b) => b.groupId === GCAL_GROUP_ID).map((b) => b.id);
  if (removed.length) draft.blocks = draft.blocks.filter((b) => b.groupId !== GCAL_GROUP_ID);
  const cal = draft.settings.connections.calendar;
  const added = cal.status === 'connected' && cal.twoWay ? simulatedBusyBlocks(draft, todayKey()) : [];
  if (added.length) draft.blocks.push(...added);
  return { added: added.map((b) => b.id), removed };
}

/** 8.7.3: swap the seed records for a fresh seed relative to today, keeping everything the owner or a customer made. */
function rollover(st) {
  const today = todayKey();
  const next = clone(st);
  next.settings.daysOff = next.settings.daysOff.filter((d) => d.date >= today);
  next.settings.fullDays = next.settings.fullDays.filter((d) => d >= today);
  const keepBookings = next.bookings.filter((b) => !b.seed);
  const keepBlocks = next.blocks.filter((b) => !b.seed && b.groupId !== GCAL_GROUP_ID);
  const keepMessages = next.messages.filter((m) => !m.seed);
  const keepQuotes = Object.fromEntries(Object.entries(next.quotes).filter(([, q]) => !q.seed));
  const keepSpend = next.settings.marketing.adSpend.filter((e) => !e.seed);
  const seed = buildSeed(now(), next.settings, { bookings: keepBookings, blocks: keepBlocks });
  const base = next.meta.msgSeq;
  const seedMessages = seed.messages.map((m) => ({ ...m, seq: m.seq + base }));
  next.bookings = [...seed.bookings, ...keepBookings];
  next.blocks = [...seed.blocks, ...keepBlocks];
  next.messages = [...seedMessages, ...keepMessages].sort((a, b) => a.seq - b.seq);
  next.quotes = { ...Object.fromEntries(Object.entries(seed.quotes).filter(([id]) => !keepQuotes[id])), ...keepQuotes };
  next.settings.marketing.adSpend = mergeAdSpend(keepSpend, seed.adSpend);
  next.refSeq = Math.max(next.refSeq, seed.refSeq);
  next.seededFor = today;
  next.meta.msgSeq = base + seed.messages.length;
  next.meta.rev += 1;
  syncCalendarBlocks(next);
  return next;
}

// ---------- lifecycle ----------

function installListeners() {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  const sync = () => {
    try {
      syncFromStorage();
    } catch (e) {
      // a failed re-read must never break the page
    }
  };
  try {
    window.addEventListener('storage', (e) => {
      if (!e || e.key === null || e.key === undefined || e.key === STORAGE_KEYS.state) sync();
    });
    window.addEventListener('pageshow', sync);
    window.addEventListener('focus', sync);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') sync();
      });
    }
  } catch (e) {
    // no usable window: the foreground re-read simply does not happen
  }
}

/** Load or seed the state, apply the day rollover, install the cross-tab listeners. Idempotent unless `force`. */
export function initStore(opts = {}) {
  if (state && !opts.force) return state;
  tokens.clear();
  pending = [];
  for (const t of settleTimers) clearTimeout(t);
  settleTimers.clear();
  const candidate = opts.storage || defaultStorage();
  storage = candidate && canWrite(candidate) ? candidate : null;
  mode = storage ? 'local' : 'memory';

  let loaded = null;
  let raw = null;
  let repairs = 0;
  if (candidate) {
    try {
      raw = candidate.getItem(STORAGE_KEYS.state);
    } catch (e) {
      raw = null;
    }
    loaded = raw ? parseState(raw) : null;
    repairs = loaded ? lastRepairs : 0;
    if (raw && (!loaded || repairs > 0)) keepBadCopy(storage, raw);
  }

  let next = null;
  let dirty = false;
  if (loaded) {
    try {
      if (loaded.seededFor !== todayKey()) {
        next = rollover(loaded);
        dirty = true;
      } else {
        next = loaded;
        lastRaw = raw;
        dirty = repairs > 0; // what was repaired is saved, so the next load starts clean
      }
    } catch (e) {
      next = null; // a save that got through every check and still cannot be rolled over: start fresh rather than fail
      keepBadCopy(storage, raw);
    }
  }
  if (!next) {
    next = freshState(readTheme(candidate));
    dirty = true;
  }
  state = deepFreeze(next);
  if (dirty) writeState(state);
  installListeners();
  return state;
}

export function getState() {
  return state || initStore();
}

export function getStorageStatus() {
  if (!state) initStore(); // the mode is only known once storage has been probed
  return { ok: mode === 'local', mode };
}

function notify(prev) {
  for (const fn of [...subscribers]) {
    try {
      fn(state, prev);
    } catch (e) {
      console.error('store subscriber failed', e);
    }
  }
}

/** fn(state, prevState) runs after every local mutation AND after an external change is detected. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Run `fn` on a copy of `base` the way mutate does, on behalf of an earlier write of this tab. Returns the new state, or null when the mutation is
 * refused or has nothing left to do on this base (a window another tab took meanwhile, a quote already accepted): such a write is dropped.
 */
function replayOnto(base, entry) {
  const draft = clone(base);
  idTape = { record: [], replay: entry.ids.map((x) => x.slice()) };
  let result = null;
  try {
    result = entry.fn(draft, base);
  } catch (e) {
    result = null;
  } finally {
    idTape = null;
  }
  if (!result || result.ok === false || result.__noop) return null;
  draft.meta.rev = base.meta.rev + 1;
  draft.meta.writes = [...(Array.isArray(base.meta.writes) ? base.meta.writes : []), entry.id].slice(-WRITES_KEPT);
  return draft;
}

/**
 * `remote` is a state another tab saved. If this tab has writes of its own that it does not hold (the other tab saved from a stale read and overwrote
 * them), run them again on top of it and save the result. Returns the state this tab should now show.
 */
function reconcile(remote) {
  if (pending.length === 0) return remote;
  // A state with no journal at all (a fresh seed after the data was cleared, or a save by a build that does not keep one) cannot say what it holds: take it as it is.
  if (!Array.isArray(remote.meta.writes)) { pending = []; return remote; }
  const held = new Set(remote.meta.writes);
  // A write so old that the journal has moved past it is taken as held (a duplicate booking would be worse than the vanishingly rare lost one).
  pending = pending.filter((p) => remote.meta.rev - p.rev < WRITES_KEPT);
  // A write the remote state holds is NOT forgotten: a state that held it can itself be overwritten by a third save made from a stale read, and only
  // this tab can redo this tab's write. It is redone whenever a state read back lacks its id.
  const missing = pending.filter((p) => !held.has(p.id));
  if (missing.length === 0) return remote;
  let base = remote;
  const refused = new Set();
  for (const entry of missing) {
    const next = replayOnto(base, entry);
    if (next) base = next; else refused.add(entry);
  }
  pending = pending.filter((p) => !refused.has(p)); // a write that is refused on the latest state (its window went) is dropped, not retried forever
  if (base === remote) return remote;
  if (writeState(base) === 'full') lastRaw = JSON.stringify(remote); // no room to save the merge: keep it in memory, the next write tries again
  return base;
}

/** Re-read storage; true when another tab changed the state (compares the raw string, not just meta.rev). */
export function syncFromStorage() {
  if (!state || mode !== 'local' || !storage) return false;
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEYS.state);
  } catch (e) {
    return false;
  }
  if (raw === null || raw === undefined || raw === lastRaw) return false;
  const remote = parseState(raw);
  if (!remote) return false; // somebody wrote garbage: keep what we have
  lastRaw = raw;
  const prev = state;
  state = deepFreeze(reconcile(remote));
  notify(prev);
  return true;
}

// ---------- mutation plumbing ----------

const noop = (result) => ({ ...result, __noop: true });

/**
 * The read-modify-write. fn(draft, prev) works on a deep copy and returns a result; on `ok: false` nothing is
 * written. A result may carry `touched` (ids to snapshot for undo), which becomes `undoToken`, and `afterCommit` (a function run
 * once the change is saved). When the browser refuses the write because of its quota the result is `{ ok: false, reason: 'storage_full' }`
 * and nothing changes.
 */
function mutate(fn) {
  initStore();
  syncFromStorage();
  const prev = state;
  const draft = clone(prev);
  idTape = { record: [], replay: [] };
  let result;
  let ids;
  try {
    result = fn(draft, prev);
  } finally {
    ids = idTape.record;
    idTape = null;
  }
  if (!result || result.ok === false) return result;
  const { __noop: skipWrite, touched, afterCommit, ...rest } = result;
  if (skipWrite) return rest;
  draft.meta.rev += 1;
  const writeId = freshId('w');
  draft.meta.writes = [...(Array.isArray(prev.meta.writes) ? prev.meta.writes : []), writeId].slice(-WRITES_KEPT);
  if (writeState(draft) === 'full') return fail('storage_full');
  if (mode === 'local') {
    pending.push({ id: writeId, rev: draft.meta.rev, fn, ids });
    if (pending.length > PENDING_MAX) pending.splice(0, pending.length - PENDING_MAX);
  }
  const token = touched ? makeToken(prev, draft, touched) : null;
  state = deepFreeze(draft);
  if (touched) rest.undoToken = token;
  notify(prev);
  if (afterCommit) afterCommit();
  return rest;
}

const findById = (list, id) => list.find((r) => r.id === id) || null;

// One undo entry per touched record: what it looked like before, what the mutation left, and where it sat in its list.
function snapshotOf(prevList, nextList, id) {
  return { id, before: findById(prevList, id), after: findById(nextList, id), index: prevList.findIndex((r) => r.id === id) };
}

// Settings are addressed by a dotted path ('marketing', 'connections.whatsapp'); quotes live in an object keyed by id.
function getPath(root, path) {
  let node = root;
  for (const part of path.split('.')) {
    if (node === null || node === undefined) return null;
    node = node[part];
  }
  return node === undefined ? null : node;
}

function setPath(root, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  let node = root;
  for (const part of parts) node = node[part];
  node[last] = value;
}

function makeToken(prev, next, touched) {
  const entry = { bookings: [], messages: [], blocks: [], daysOff: [], fullDays: [], quotes: [], settings: [] };
  for (const id of touched.bookings || []) entry.bookings.push(snapshotOf(prev.bookings, next.bookings, id));
  for (const id of touched.messages || []) entry.messages.push(snapshotOf(prev.messages, next.messages, id));
  for (const id of touched.blocks || []) entry.blocks.push(snapshotOf(prev.blocks, next.blocks, id));
  for (const id of touched.daysOff || []) entry.daysOff.push(snapshotOf(prev.settings.daysOff, next.settings.daysOff, id));
  for (const date of touched.fullDays || []) {
    entry.fullDays.push({ date, before: prev.settings.fullDays.includes(date), after: next.settings.fullDays.includes(date) });
  }
  for (const id of touched.quotes || []) {
    entry.quotes.push({ id, before: prev.quotes[id] ? clone(prev.quotes[id]) : null, after: next.quotes[id] ? clone(next.quotes[id]) : null });
  }
  for (const path of touched.settings || []) {
    const before = getPath(prev.settings, path);
    const after = getPath(next.settings, path);
    entry.settings.push({ path, before: before === null ? null : clone(before), after: after === null ? null : clone(after) });
  }
  const token = makeId('undo');
  tokens.set(token, entry);
  while (tokens.size > MAX_TOKENS) tokens.delete(tokens.keys().next().value);
  return token;
}

function addHistory(booking, event, by, note) {
  booking.history.push({ at: nowStamp(), event, by, ...(note ? { note } : {}) });
}

/** Build and insert a message. `buildState` lets a decline or cancel compute "next free" BEFORE its window is released. */
function addMessage(draft, kind, booking, extra = {}, buildState = draft) {
  const m = buildMessage(kind, booking, buildState, { at: nowStamp(), ...extra });
  const message = { id: makeId('msg'), ...m, seq: 0 };
  if (kind === 'owner_new_booking') message.title = alertHeading(booking); // names the enquiry in the Messages list (T10)
  draft.meta.msgSeq += 1;
  message.seq = draft.meta.msgSeq;
  draft.messages.push(message);
  return message;
}

/** Remove a booking's unsent scheduled messages; returns the removed ids (so undo can bring them back). */
function dropUnsent(draft, bookingId) {
  const stamp = nowStamp();
  const removed = draft.messages.filter((m) => m.bookingId === bookingId && messageIsScheduled(m, stamp)).map((m) => m.id);
  if (removed.length) draft.messages = draft.messages.filter((m) => !removed.includes(m.id));
  return removed;
}

function maybeReminder(draft, booking, extra = {}) {
  if (!draft.settings.remindersOn || booking.urgent || booking.status !== 'confirmed') return null;
  const sendAt = reminderSendAt(booking, nowStamp());
  return sendAt ? addMessage(draft, 'customer_reminder', booking, { sendAt, ...extra }) : null;
}

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

// ---------- createBooking (8.4) ----------

// `internal` is for the store's own callers (never the public createBooking): { createdAt (a stamp: when the customer sent it), importId, ref (the
// ref to keep when it is free here), notesMax }. It is how an enquiry that arrived through a WhatsApp link goes through the SAME code as a website one.
function createBookingIn(draft, input, internal = {}) {
  const d = input || {};
  const settings = draft.settings;
  const urgent = !!d.urgent;
  const asOwner = !!d.asOwner;
  const cust = d.customer || {};
  const addr = d.address || {};
  // Customer text is plain, well-formed and bounded before it is kept (no control or bidi-override characters, no half an emoji at a cut).
  const name = plainText(cust.name, 60);
  const notes = plainText(d.notes, internal.notesMax || 300, { multiline: true });
  const serviceId = urgent ? 'emergency' : d.serviceId;
  const service = settings.services.find((s) => s.id === serviceId) || null;
  // The free survey is an enquiry: only the postcode is required, it is never auto-confirmed, and with `pencil: true` and no
  // window given the engine pencils in the next free window itself (provisional until the owner confirms or moves it).
  const isEnquiry = !urgent && serviceId === 'ev_quote';
  const given = d.window && typeof d.window === 'object' ? d.window : d;
  const date = given.date;
  const windowId = given.windowId;
  const missing = (v) => v === undefined || v === null || v === '';
  const autoPencil = isEnquiry && d.pencil === true && missing(date) && missing(windowId);

  // CONTRACT-GAP: 13.2.3 fixes the messages for name, phone, postcode and line1 only; the other three are chosen here.
  const errors = {};
  if (!urgent && (typeof serviceId !== 'string' || !serviceId)) errors.serviceId = 'Choose a service';
  const nameError = validateName(name);
  if (nameError) errors.name = nameError;
  const phoneError = validatePhone(cust.phone);
  if (phoneError) errors.phone = phoneError;
  const postcodeError = validatePostcode(addr.postcode);
  if (postcodeError) errors.postcode = postcodeError;
  if (!urgent) {
    if (!isEnquiry) {
      const line1Error = validateLine1(addr.line1);
      if (line1Error) errors.line1 = line1Error;
    }
    if (!autoPencil) {
      if (!isDayKey(date)) errors.date = 'Choose a day';
      if (!Number.isInteger(windowId) || windowId < 0 || windowId > 3) errors.windowId = 'Choose a time';
      else if (service && service.blocks === 2 && !HALF_DAY_STARTS.includes(windowId)) errors.windowId = 'Choose morning or afternoon';
    }
  }
  const reasons = urgent
    ? [...new Set((Array.isArray(d.emergencyReasons) ? d.emergencyReasons : []).filter((id) => EMERGENCY_REASONS.some((r) => r.id === id)))]
    : [];
  if (urgent && reasons.length === 0) errors.emergencyReasons = 'Choose what is happening';
  if (Object.keys(errors).length) return fail('invalid', { errors });

  if (!service || !service.active) return fail('service_unavailable');
  if (urgent && !settings.takingEmergencies) return fail('emergencies_off');

  const blocks = urgent ? 0 : service.blocks === 2 ? 2 : 1;
  let startDate = date;
  let startWindow = windowId;
  let unscheduled = false;
  if (autoPencil) {
    // Never lose an enquiry because the diary is full: with no free window it is kept unscheduled and the owner places it.
    // For the free survey nextFreeSlot already applies SURVEY_MIN_LEAD_HOURS (24 h) for a customer, so nothing is pencilled sooner than that.
    const slot = nextFreeSlot(draft, service.id, { ownerMode: asOwner });
    if (slot) {
      startDate = slot.date;
      startWindow = slot.windowId;
    } else {
      unscheduled = true;
    }
  } else if (!urgent && !isSlotFree(draft, { date, windowId, blocks, ownerMode: asOwner })) {
    return fail('slot_taken', { alternatives: nextFreeSlots(draft, service.id, 3, { ownerMode: asOwner }) });
  }

  const created = internal.createdAt || nowStamp();
  let variant = null;
  if (service.priceType === 'by_size') {
    variant = service.variants.find((v) => v.id === d.variantId) || service.variants.find((v) => v.id === service.defaultVariantId) || null;
  }
  let refNumber = draft.refSeq;
  // An imported enquiry keeps the customer's own ref when it is free here and plausible, so the confirmation, the WhatsApp text and this
  // dashboard all say the same number; otherwise (or for a website enquiry) the next ref in this store's sequence.
  const wanted = typeof internal.ref === 'string' ? /^EL-(\d{4,7})$/.exec(internal.ref) : null;
  if (wanted && Number(wanted[1]) >= 1000 && Number(wanted[1]) < draft.refSeq + 100 && !draft.bookings.some((b) => b.ref === internal.ref)) refNumber = Number(wanted[1]);
  while (draft.bookings.some((b) => b.ref === `EL-${refNumber}`)) refNumber += 1;
  draft.refSeq = Math.max(draft.refSeq, refNumber + 1);
  let id = makeId('bk');
  while (draft.bookings.some((b) => b.id === id)) id = makeId('bk');

  const ownerPrice = asOwner && Number.isFinite(d.quotedPrice) && d.quotedPrice >= 0 ? Math.round(d.quotedPrice) : null;
  const zone = postcodeZone(addr.postcode, settings.business);
  const status = urgent ? 'new' : asOwner ? 'confirmed' : isEnquiry ? 'new' : settings.autoConfirm && zone === 'covered' ? 'confirmed' : 'new';
  const answers = normaliseAnswers(d.answers, addr.postcode);
  // CONTRACT-GAP: an owner-entered booking with no source is a phone booking (the owner's most common entry).
  const source = SOURCES.includes(d.source) ? d.source : asOwner ? 'phone' : 'website';
  const booking = {
    id,
    ref: `EL-${refNumber}`,
    createdAt: created,
    serviceId: service.id,
    serviceName: service.name,
    variantId: variant ? variant.id : null,
    variantLabel: variant ? variant.label : '',
    start: urgent || unscheduled ? created : makeStamp(startDate, WINDOWS[startWindow].start),
    durationMin: urgent || unscheduled ? 0 : blocks * 120,
    status,
    urgent,
    emergencyReasons: reasons,
    etaMinutes: null,
    etaAt: null,
    customer: { name, phone: normalisePhone(cust.phone), email: plainText(cust.email, 120) },
    address: { line1: plainText(addr.line1, 120), postcode: normalisePostcode(addr.postcode) },
    notes,
    internalNotes: '',
    source,
    quotedPrice: ownerPrice !== null ? ownerPrice : quotedPriceFor(service, variant ? variant.id : null),
    finalPrice: null,
    paid: false,
    paidMethod: null,
    paidAt: null,
    seenByOwner: asOwner,
    reviewRequested: false,
    cancelledBy: null,
    cancelReason: '',
    seed: false,
    history: []
  };
  if (answers) booking.answers = answers;
  const utm = normaliseUtm(d.utm);
  if (utm) booking.utm = utm; // where the enquiry came from (the funnel passes getUtm())
  let photosDropped = 0;
  if (d.photos !== undefined) {
    // Lenient on purpose: an enquiry is never refused because of a photo.
    const kept = normalisePhotos(d.photos);
    if (kept.photos.length) booking.photos = kept.photos;
    photosDropped = kept.dropped;
  }
  if (autoPencil && !unscheduled && status === 'new') booking.tentative = true; // provisional until the owner confirms or moves it
  addHistory(booking, 'created', asOwner ? 'owner' : 'customer', source);
  if (internal.createdAt) booking.history[0].at = created; // the timeline says when the customer sent it, not when it was imported
  if (internal.importId) booking.importId = internal.importId;
  if (status === 'confirmed') addHistory(booking, 'confirmed', asOwner ? 'owner' : 'system');
  draft.bookings.push(booking);

  // Insertion order matters (8.4 step 6): reminder, then the customer message, then the owner alert, so the
  // alert gets the highest seq of the group and sorts first on the newest-first Messages screen.
  const messages = [];
  const notifyCustomer = !asOwner || d.notifyCustomer !== false;
  if (notifyCustomer) {
    if (urgent) {
      messages.push(addMessage(draft, 'customer_emergency_received', booking));
    } else if (status === 'confirmed') {
      const reminder = maybeReminder(draft, booking);
      if (reminder) messages.push(reminder);
      messages.push(addMessage(draft, 'customer_confirmed', booking));
    } else {
      messages.push(addMessage(draft, 'customer_received', booking));
    }
  }
  if (!asOwner) messages.push(addMessage(draft, urgent ? 'owner_emergency' : 'owner_new_booking', booking));
  return { ok: true, booking, messages, ...(d.photos !== undefined ? { photosDropped } : {}) };
}

/**
 * Create a booking (customer or owner). Validates and re-checks the slot inside the read-modify-write.
 * `opts.pencil` is the same as `input.pencil` (pencil the next free survey window when the input names none).
 */
export function createBooking(draftInput, opts = {}) {
  const input = opts && opts.pencil && draftInput && typeof draftInput === 'object' && draftInput.pencil === undefined
    ? { ...draftInput, pencil: true }
    : draftInput;
  const result = mutate((draft) => createBookingIn(draft, input));
  // Photos are the heavy part of a booking: if the browser's quota refuses the write, keep the enquiry and drop the photos.
  if (result && result.ok === false && result.reason === 'storage_full' && input && Array.isArray(input.photos) && input.photos.length) {
    const retry = mutate((draft) => createBookingIn(draft, { ...input, photos: [] }));
    return retry && retry.ok ? { ...retry, photosDropped: input.photos.length } : retry;
  }
  return result;
}

// ---------- status changes (7.5) ----------

function liveBooking(draft, id) {
  return draft.bookings.find((b) => b.id === id) || null;
}

function addedIds(list) {
  return list.filter(Boolean).map((m) => m.id);
}

export function confirmBooking(id, by = 'owner') {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (b.status !== 'new' || b.urgent) return fail('bad_transition');
    if (isUnscheduled(b)) return fail('unscheduled'); // an enquiry with no window yet: move it into the diary first
    b.status = 'confirmed';
    if (b.tentative) b.tentative = false; // the provisional survey is now firm
    b.seenByOwner = true; // CONTRACT-GAP: acting on a booking counts as having seen it (so the Bookings dot clears)
    addHistory(b, 'confirmed', by === 'system' ? 'system' : 'owner');
    const reminder = maybeReminder(draft, b);
    const message = addMessage(draft, 'customer_confirmed', b);
    return { ok: true, booking: b, touched: { bookings: [b.id], messages: addedIds([reminder, message]) } };
  });
}

export function acceptEmergency(id, etaMinutes) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (!isPositiveInt(etaMinutes)) return fail('invalid', { errors: { etaMinutes: 'Choose how long you will be.' } });
    if (b.status !== 'new' || !b.urgent) return fail('bad_transition');
    b.status = 'confirmed';
    b.seenByOwner = true;
    b.etaMinutes = etaMinutes;
    b.etaAt = addMinutes(nowStamp(), etaMinutes);
    addHistory(b, 'confirmed', 'owner');
    const message = addMessage(draft, 'customer_emergency_accepted', b, { etaMinutes });
    return { ok: true, booking: b, touched: { bookings: [b.id], messages: [message.id] } };
  });
}

export function declineBooking(id) {
  return mutate((draft, prev) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (b.status !== 'new') return fail('bad_transition');
    b.status = 'cancelled';
    b.cancelledBy = 'owner';
    b.cancelReason = 'declined';
    if (b.tentative) b.tentative = false;
    b.seenByOwner = true;
    addHistory(b, 'declined', 'owner');
    const removed = dropUnsent(draft, b.id);
    // Build the text against the diary as it was, so "next free" never offers the window just released.
    const message = addMessage(draft, 'customer_declined', b, {}, prev);
    return { ok: true, booking: b, touched: { bookings: [b.id], messages: [...removed, message.id] } };
  });
}

export function markOnTheWay(id, etaMinutes) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (!isPositiveInt(etaMinutes)) return fail('invalid', { errors: { etaMinutes: 'Choose how long you will be.' } });
    if (b.status !== 'confirmed') return fail('bad_transition');
    b.status = 'on_the_way';
    b.etaMinutes = etaMinutes;
    b.etaAt = addMinutes(nowStamp(), etaMinutes);
    // CONTRACT-GAP: history notes are 'created' = the source id, 'on_the_way' = the ETA clock (HH:mm), 'paid' = the
    // method id, 'cancelled' = the reason, 'rescheduled' = the new when, 'message' = the KIND_LABELS label.
    addHistory(b, 'on_the_way', 'owner', b.etaAt.slice(11, 16));
    const message = addMessage(draft, 'customer_on_my_way', b, { etaMinutes });
    return { ok: true, booking: b, touched: { bookings: [b.id], messages: [message.id] } };
  });
}

export function completeBooking(id, { finalPrice, paid = false, paidMethod = null, sendReview = true } = {}) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    const errors = {};
    if (!Number.isInteger(finalPrice) || finalPrice < 0) errors.finalPrice = 'Enter a whole number of pounds.';
    if (paid && !PAID_METHODS.includes(paidMethod)) errors.paidMethod = 'Choose how they paid.';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    if (b.status !== 'confirmed' && b.status !== 'on_the_way') return fail('bad_transition');
    const stamp = nowStamp();
    b.status = 'done';
    b.finalPrice = finalPrice;
    b.seenByOwner = true;
    addHistory(b, 'done', 'owner');
    if (paid) {
      b.paid = true;
      b.paidMethod = paidMethod;
      b.paidAt = stamp;
      addHistory(b, 'paid', 'owner', paidMethod);
    }
    // Review first so the visible "Job done" message ends up newest.
    let review = null;
    if (sendReview) {
      b.reviewRequested = true;
      review = addMessage(draft, 'customer_review_request', b, { sendAt: addMinutes(stamp, PROMISES.reviewDelayMinutes) });
    }
    const completed = addMessage(draft, 'customer_completed', b);
    return { ok: true, booking: b, touched: { bookings: [b.id], messages: addedIds([review, completed]) } };
  });
}

export function markPaid(id, method) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (!PAID_METHODS.includes(method)) return fail('invalid', { errors: { paidMethod: 'Choose how they paid.' } });
    if (b.status !== 'done' || b.paid) return fail('bad_transition');
    b.paid = true;
    b.paidMethod = method;
    b.paidAt = nowStamp();
    addHistory(b, 'paid', 'owner', method);
    return { ok: true, booking: b, touched: { bookings: [b.id] } };
  });
}

export function markUnpaid(id) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (b.status !== 'done' || !b.paid) return fail('bad_transition');
    b.paid = false;
    b.paidMethod = null;
    b.paidAt = null;
    addHistory(b, 'unpaid', 'owner');
    return { ok: true, booking: b };
  });
}

export function cancelBooking(id, by, { reason = '', notify = true } = {}) {
  return mutate((draft, prev) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (by !== 'owner' && by !== 'customer') return fail('invalid', { errors: { by: 'Cancelled by the owner or the customer.' } });
    if (by === 'customer') {
      if (b.urgent || (b.status !== 'new' && b.status !== 'confirmed') || isWithinChangeCutoff(b, nowStamp())) return fail('not_allowed');
    } else if (!['new', 'confirmed', 'on_the_way'].includes(b.status)) {
      return fail('bad_transition');
    }
    const why = String(reason || '').trim();
    b.status = 'cancelled';
    b.cancelledBy = by;
    b.cancelReason = why;
    if (b.tentative) b.tentative = false;
    addHistory(b, 'cancelled', by, why);
    const removed = dropUnsent(draft, b.id);
    const added = [];
    if (by === 'owner' && notify) added.push(addMessage(draft, 'customer_cancelled', b, { reason: why }, prev));
    if (by === 'customer') added.push(addMessage(draft, 'owner_customer_cancelled', b, { reason: why }, prev));
    return { ok: true, booking: b, touched: { bookings: [b.id], messages: [...removed, ...addedIds(added)] } };
  });
}

export function rescheduleBooking(id, { date, windowId } = {}, by = 'owner', { notify = true } = {}) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    const owner = by === 'owner';
    if (!owner && by !== 'customer') return fail('invalid', { errors: { by: 'Moved by the owner or the customer.' } });
    if (b.urgent || (b.status !== 'new' && b.status !== 'confirmed')) return fail(owner ? 'bad_transition' : 'not_allowed');
    if (!owner && isWithinChangeCutoff(b, nowStamp())) return fail('not_allowed');
    // An enquiry with no window yet takes its length from the service when it is first placed.
    const svc = isUnscheduled(b) ? draft.settings.services.find((x) => x.id === b.serviceId) : null;
    const blocks = svc ? (svc.blocks === 2 ? 2 : 1) : b.durationMin >= 240 ? 2 : 1;
    const errors = {};
    if (!isDayKey(date)) errors.date = 'Choose a day';
    if (!Number.isInteger(windowId) || windowId < 0 || windowId > 3) errors.windowId = 'Choose a time';
    else if (blocks === 2 && !HALF_DAY_STARTS.includes(windowId)) errors.windowId = 'Choose morning or afternoon';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    if (!isSlotFree(draft, { date, windowId, blocks, ignoreBookingId: b.id, ownerMode: owner })) {
      return fail('slot_taken', { alternatives: nextFreeSlots(draft, b.serviceId, 3, { ownerMode: owner, ignoreBookingId: b.id }) });
    }
    const oldWhen = bookingWhenArrival(b); // what the customer is told: the arrival window
    b.start = makeStamp(date, WINDOWS[windowId].start);
    if (!(b.durationMin > 0)) b.durationMin = blocks * 120;
    if (owner && b.tentative) b.tentative = false; // the owner has chosen the time: no longer a provisional pencil mark
    const newWhen = bookingWhenArrival(b);
    addHistory(b, 'rescheduled', by, newWhen);
    const removed = dropUnsent(draft, b.id);
    const added = [maybeReminder(draft, b)];
    if (owner && notify) added.push(addMessage(draft, 'customer_rescheduled', b, { oldWhen, newWhen }));
    if (!owner) added.push(addMessage(draft, 'owner_customer_rescheduled', b, { oldWhen, newWhen }));
    return { ok: true, booking: b, touched: { bookings: [b.id], messages: [...removed, ...addedIds(added)] } };
  });
}

export function updateBooking(id, patch = {}) {
  return mutate((draft, prev) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    const errors = {};
    const changes = {};
    if ('internalNotes' in patch) changes.internalNotes = String(patch.internalNotes === null || patch.internalNotes === undefined ? '' : patch.internalNotes).slice(0, 2000);
    for (const key of ['quotedPrice', 'finalPrice']) {
      if (!(key in patch)) continue;
      if (Number.isInteger(patch[key]) && patch[key] >= 0) changes[key] = patch[key];
      else errors[key] = 'Enter a whole number of pounds.';
    }
    if (Object.keys(errors).length) return fail('invalid', { errors });
    const unchanged = Object.keys(changes).every((k) => b[k] === changes[k]);
    if (unchanged) return noop({ ok: true, booking: findById(prev.bookings, id) });
    Object.assign(b, changes);
    return { ok: true, booking: b };
  });
}

export function markSeen(id) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (b.seenByOwner) return noop({ ok: true });
    b.seenByOwner = true;
    return { ok: true };
  });
}

export function markAllSeen() {
  return mutate((draft) => {
    const unseen = draft.bookings.filter((b) => !b.seenByOwner);
    if (!unseen.length) return noop({ ok: true });
    unseen.forEach((b) => {
      b.seenByOwner = true;
    });
    return { ok: true };
  });
}

// ---------- messages ----------

const QUICK_KINDS = ['customer_running_late', 'customer_need_access', 'customer_quote_ready', 'customer_photos_request'];

function logOwnerMessage(id, kind, guard) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    const problem = guard(b);
    if (problem) return fail(problem);
    const message = addMessage(draft, kind, b);
    addHistory(b, 'message', 'owner', KIND_LABELS[kind]);
    if (kind === 'customer_review_request') b.reviewRequested = true;
    return { ok: true, message };
  });
}

export function sendQuickMessage(bookingId, kind) {
  if (!QUICK_KINDS.includes(kind)) return fail('invalid', { errors: { kind: 'Not a quick message.' } });
  return logOwnerMessage(bookingId, kind, () => null);
}

export function sendPaymentNudge(bookingId) {
  return logOwnerMessage(bookingId, 'customer_payment_nudge', (b) => (b.status === 'done' && !b.paid ? null : 'bad_transition'));
}

export function sendReviewRequest(bookingId) {
  return logOwnerMessage(bookingId, 'customer_review_request', (b) => (b.status === 'done' && !b.reviewRequested ? null : 'bad_transition'));
}

export function sendMessageNow(messageId) {
  return mutate((draft, prev) => {
    const m = findById(draft.messages, messageId);
    if (!m) return fail('not_found');
    if (m.sendAt === null || m.sendAt === undefined) return noop({ ok: true, message: findById(prev.messages, messageId) });
    m.sendAt = null;
    m.at = nowStamp();
    return { ok: true, message: m };
  });
}

export function markMessagesSeen() {
  return mutate((draft) => {
    if (draft.meta.messagesSeenSeq === draft.meta.msgSeq) return noop({ ok: true });
    draft.meta.messagesSeenSeq = draft.meta.msgSeq;
    return { ok: true };
  });
}

// ---------- diary: blocks, days off, full days ----------

export function addBlock({ date, windowId, label } = {}) {
  return mutate((draft) => {
    const errors = {};
    if (!isDayKey(date)) errors.date = 'Choose a day';
    if (!Number.isInteger(windowId) || windowId < 0 || windowId > 3) errors.windowId = 'Choose a time';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    if (occupiedBy(draft, date, windowId)) return fail('booked');
    if (draft.blocks.some((b) => b.date === date && b.windowId === windowId)) return fail('invalid', { errors: { windowId: 'Already blocked' } });
    const block = { id: makeId('blk'), date, windowId, label: String(label || '').trim() || 'Blocked', groupId: null, seed: false };
    draft.blocks.push(block);
    return { ok: true, block, touched: { blocks: [block.id] } };
  });
}

export function blockRange({ fromDate, toDate = fromDate, windowIds = [0, 1, 2, 3], label } = {}) {
  return mutate((draft) => {
    const errors = {};
    if (!isDayKey(fromDate)) errors.fromDate = 'Choose a day';
    if (!isDayKey(toDate) || (isDayKey(fromDate) && toDate < fromDate)) errors.toDate = 'Choose a day on or after the first';
    const ids = (Array.isArray(windowIds) ? windowIds : []).filter((w) => Number.isInteger(w) && w >= 0 && w <= 3);
    if (ids.length === 0) errors.windowIds = 'Choose at least one window';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    // CONTRACT-GAP: only BOOKED windows are skipped (and reported). A window that is already blocked is neither added nor
    // reported, and a window outside the opening hours is blocked like any other (harmless; the engine says 'closed' first).
    const groupId = makeId('grp');
    const text = String(label || '').trim() || 'Blocked';
    const added = [];
    const skipped = [];
    for (let day = fromDate, guard = 0; day <= toDate && guard < 400; day = addDays(day, 1), guard += 1) {
      for (const windowId of ids) {
        if (occupiedBy(draft, day, windowId)) {
          skipped.push({ date: day, windowId, reason: 'booked' });
        } else if (!draft.blocks.some((b) => b.date === day && b.windowId === windowId)) {
          const block = { id: makeId('blk'), date: day, windowId, label: text, groupId, seed: false };
          draft.blocks.push(block);
          added.push(block);
        }
      }
    }
    const result = { ok: true, added, skipped };
    if (added.length === 0) return noop({ ...result, undoToken: null });
    return { ...result, touched: { blocks: added.map((b) => b.id) } };
  });
}

export function removeBlock(id) {
  return mutate((draft) => {
    if (!findById(draft.blocks, id)) return fail('not_found');
    draft.blocks = draft.blocks.filter((b) => b.id !== id);
    return { ok: true, touched: { blocks: [id] } };
  });
}

export function removeBlockGroup(groupId) {
  return mutate((draft) => {
    const ids = draft.blocks.filter((b) => b.groupId && b.groupId === groupId).map((b) => b.id);
    if (!ids.length) return fail('not_found');
    draft.blocks = draft.blocks.filter((b) => !ids.includes(b.id));
    return { ok: true, touched: { blocks: ids } };
  });
}

export function addDaysOff(dates, label = 'Day off') {
  return mutate((draft) => {
    const days = [...new Set(Array.isArray(dates) ? dates : [])];
    if (days.length === 0 || !days.every(isDayKey)) return fail('invalid', { errors: { dates: 'Choose a day' } });
    const text = String(label || '').trim() || 'Day off';
    const added = [];
    for (const date of days) {
      if (draft.settings.daysOff.some((d) => d.date === date)) continue;
      const off = { id: makeId('off'), date, label: text };
      draft.settings.daysOff.push(off);
      added.push(off);
    }
    const bookedCount = draft.bookings.filter((b) => ['new', 'confirmed', 'on_the_way'].includes(b.status) && days.includes(stampDay(b.start))).length;
    return { ok: true, added, bookedCount, touched: { daysOff: added.map((o) => o.id) } };
  });
}

export function removeDayOff(id) {
  return mutate((draft) => {
    if (!findById(draft.settings.daysOff, id)) return fail('not_found');
    draft.settings.daysOff = draft.settings.daysOff.filter((d) => d.id !== id);
    return { ok: true, touched: { daysOff: [id] } };
  });
}

export function setDayFull(date, full) {
  return mutate((draft) => {
    if (!isDayKey(date)) return fail('invalid', { errors: { date: 'Choose a day' } });
    const has = draft.settings.fullDays.includes(date);
    if (!!full === has) return noop({ ok: true, undoToken: null });
    draft.settings.fullDays = full ? [...draft.settings.fullDays, date].sort() : draft.settings.fullDays.filter((d) => d !== date);
    return { ok: true, touched: { fullDays: [date] } };
  });
}

// ---------- settings ----------

const LEAD_CHOICES = [60, 90, 120, 180, 240];
const AHEAD_CHOICES = [7, 14, 21, 28];
const REQUIRED_BUSINESS = ['name', 'shortName', 'ownerFirstName'];
const TEXT_BUSINESS = ['descriptor', 'ownerFullName', 'tagline', 'email', 'areaName', 'areaText', 'schemeLine', 'insuranceLine'];
// A 10,000 character business name must be refused with a plain sentence, never kept (the limits are in config.js, repair.js cuts old saves to them).
const BUSINESS_MAX = BUSINESS_TEXT_MAX;
const tooLong = (key) => `Keep this under ${BUSINESS_MAX[key]} characters.`;
const BUSINESS_LIST_MAX = { items: 200, itemLength: 60 };
const IMAGE_OK = /^(https:\/\/\S+|(?![a-z][a-z0-9+.-]*:)\S+)$/i; // https URLs and relative paths only
// A photo picked on the owner's phone is stored as a downscaled JPEG data URL (Settings > Website photos); kept small so localStorage has room for all seven.
const IMAGE_DATA_OK = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const IMAGE_DATA_MAX = 300000;

// Keep the charger lines of the quote catalogue in step with business.brands: a line per brand, none for a brand that is gone.
function syncChargerItems(settings) {
  const brands = settings.business.brands;
  const kept = settings.quoteItems.filter((i) => i.kind !== 'charger' || brands.includes(i.brand));
  const chargers = [];
  for (const brand of brands) {
    if (chargers.some((c) => c.brand === brand)) continue;
    chargers.push(kept.find((i) => i.kind === 'charger' && i.brand === brand) || makeChargerItem(brand));
  }
  const taken = new Set(kept.filter((i) => i.kind !== 'charger').map((i) => i.id));
  settings.quoteItems = [...chargers.filter((c) => !taken.has(c.id)), ...kept.filter((i) => i.kind !== 'charger')];
}

export function updateSettings(patch = {}) {
  return mutate((draft) => {
    const errors = {};
    const next = {};
    const biz = patch.business;
    const nextBiz = {};
    const nextImages = {};
    if (biz && typeof biz === 'object') {
      for (const key of REQUIRED_BUSINESS) {
        if (!(key in biz)) continue;
        const text = plainText(biz[key], 10000);
        if (!text) errors[key] = "This can't be empty.";
        else if (text.length > BUSINESS_MAX[key]) errors[key] = tooLong(key);
        else nextBiz[key] = text;
      }
      if ('phone' in biz) {
        const phone = normalisePhone(biz.phone);
        if (phone) nextBiz.phone = phone;
        else errors.phone = 'Enter a UK mobile like 07700 900412';
      }
      for (const key of TEXT_BUSINESS) {
        if (!(key in biz)) continue;
        const text = plainText(biz[key], 10000);
        if (text.length > BUSINESS_MAX[key]) errors[key] = tooLong(key);
        else nextBiz[key] = text;
      }
      for (const key of ['towns', 'coveredOutward', 'edgeOutward', 'credentials', 'brands']) {
        if (!Array.isArray(biz[key])) continue;
        const list = biz[key].map((t) => plainText(t, 10000)).filter(Boolean);
        if (list.length > BUSINESS_LIST_MAX.items || list.some((t) => t.length > BUSINESS_LIST_MAX.itemLength)) errors[key] = `Keep each entry under ${BUSINESS_LIST_MAX.itemLength} characters, and the list under ${BUSINESS_LIST_MAX.items} entries.`;
        else nextBiz[key] = list;
      }
      if ('address' in biz) {
        const address = plainText(biz.address, 10000);
        if (address.length > BUSINESS_MAX.address) errors.address = 'Keep the address under 200 characters.';
        else nextBiz.address = address;
      }
      if (biz.images && typeof biz.images === 'object') {
        for (const key of IMAGE_KEYS) {
          if (!(key in biz.images)) continue;
          const raw = String(biz.images[key] === null || biz.images[key] === undefined ? '' : biz.images[key]).trim();
          if (!raw) nextImages[key] = DEFAULT_IMAGES[key];
          else if (IMAGE_DATA_OK.test(raw)) {
            if (raw.length > IMAGE_DATA_MAX) errors[`images.${key}`] = 'That photo is too big. Try a smaller one.';
            else nextImages[key] = raw;
          } else if (raw.length > 600 || raw.startsWith('//') || !IMAGE_OK.test(raw)) errors[`images.${key}`] = 'Use a web address starting with https:// or a file path.';
          else nextImages[key] = raw;
        }
      }
    }
    if (patch.sla && typeof patch.sla === 'object' && 'replyHours' in patch.sla) {
      const h = patch.sla.replyHours;
      if (Number.isInteger(h) && h >= 1 && h <= 168) next.sla = { replyHours: h };
      else errors.replyHours = 'Choose a whole number of hours from 1 to 168.';
    }
    if (patch.quoteDefaults && typeof patch.quoteDefaults === 'object') {
      const q = patch.quoteDefaults;
      const merged = { ...draft.settings.quoteDefaults };
      if ('validDays' in q) {
        if (Number.isInteger(q.validDays) && q.validDays >= 1 && q.validDays <= 365) merged.validDays = q.validDays;
        else errors.validDays = 'Choose a whole number of days from 1 to 365.';
      }
      if ('notes' in q) {
        const notes = String(q.notes === null || q.notes === undefined ? '' : q.notes).trim();
        if (notes.length > 1500) errors.notes = 'Keep the terms under 1500 characters.';
        else merged.notes = notes;
      }
      next.quoteDefaults = merged;
    }
    if ('quoteItems' in patch) {
      const checked = normaliseQuoteItems(patch.quoteItems);
      if (checked.error) errors.quoteItems = checked.error;
      else next.quoteItems = checked.items;
    }
    if ('hours' in patch) {
      const h = patch.hours;
      const ok = Array.isArray(h) && h.length === 7 && h.every((day) => Array.isArray(day) && day.every((w) => Number.isInteger(w) && w >= 0 && w <= 3));
      if (ok) next.hours = h.map((day) => [...new Set(day)].sort((a, b) => a - b));
      else errors.hours = 'Choose the windows you work.';
    }
    if ('leadMinutes' in patch) {
      if (LEAD_CHOICES.includes(patch.leadMinutes)) next.leadMinutes = patch.leadMinutes;
      else errors.leadMinutes = 'Choose 1 hour, 90 minutes, 2, 3 or 4 hours.';
    }
    if ('maxDaysAhead' in patch) {
      if (AHEAD_CHOICES.includes(patch.maxDaysAhead)) next.maxDaysAhead = patch.maxDaysAhead;
      else errors.maxDaysAhead = 'Choose 7, 14, 21 or 28 days.';
    }
    for (const key of ['autoConfirm', 'takingEmergencies', 'remindersOn']) {
      if (key in patch) next[key] = !!patch[key];
    }
    if (patch.templates && typeof patch.templates === 'object') next.templates = { ...patch.templates };
    if (Object.keys(errors).length) return fail('invalid', { errors });

    const s = draft.settings;
    if (nextBiz.ownerFirstName && !('ownerFullName' in nextBiz) && nextBiz.ownerFirstName !== s.business.ownerFirstName) {
      // Keep a full name such as "Dan Murphy" coherent when only the first name is edited: swap the first word.
      const rest = s.business.ownerFullName.trim().split(/\s+/).slice(1).join(' ');
      nextBiz.ownerFullName = rest ? `${nextBiz.ownerFirstName} ${rest}` : nextBiz.ownerFirstName;
    }
    Object.assign(s.business, nextBiz);
    if (Object.keys(nextImages).length) s.business.images = { ...s.business.images, ...nextImages };
    Object.assign(s, next);
    if (nextBiz.brands) syncChargerItems(s);
    return { ok: true, settings: s };
  });
}

function validPrice(n) {
  return Number.isInteger(n) && n >= 0 && n <= 99999;
}

export function updateService(id, patch = {}) {
  return mutate((draft) => {
    const service = findById(draft.settings.services, id);
    if (!service) return fail('not_found');
    const errors = {};
    if ('name' in patch && !String(patch.name === null || patch.name === undefined ? '' : patch.name).trim()) errors.name = "This can't be empty.";
    if ('price' in patch && service.priceType !== 'free' && !validPrice(patch.price)) errors.price = 'Enter a whole number of pounds.';
    if ('variants' in patch) {
      const list = Array.isArray(patch.variants) ? patch.variants : [];
      if (!list.every((v) => v && validPrice(v.price))) errors.price = 'Enter a whole number of pounds.';
    }
    if (Object.keys(errors).length) return fail('invalid', { errors });
    if ('name' in patch) service.name = String(patch.name).trim();
    if ('description' in patch) service.description = String(patch.description === null || patch.description === undefined ? '' : patch.description).trim();
    if ('active' in patch) service.active = !!patch.active;
    if ('showOnWebsite' in patch) service.showOnWebsite = !!patch.showOnWebsite;
    if ('price' in patch && service.priceType !== 'free') service.price = patch.price;
    if ('variants' in patch) {
      for (const v of patch.variants) {
        const target = service.variants.find((x) => x.id === v.id);
        if (target) target.price = v.price;
      }
      if (service.variants.length) service.price = Math.min(...service.variants.map((v) => v.price));
    }
    return { ok: true, service };
  });
}

export function setTheme(choice) {
  if (choice !== 'auto' && choice !== 'light' && choice !== 'dark') return fail('invalid', { errors: { theme: 'Choose auto, light or dark.' } });
  initStore();
  try {
    if (storage) storage.setItem(STORAGE_KEYS.theme, choice); // vm_theme is authoritative: the head script reads it before paint
  } catch (e) {
    // blocked storage: the choice still applies for this page through settings.theme
  }
  return mutate((draft) => {
    if (draft.settings.theme === choice) return noop({ ok: true });
    draft.settings.theme = choice;
    return { ok: true };
  });
}

export function setDemoPhone(input) {
  const digits = normaliseDemoPhone(input);
  if (digits === null) return fail('invalid', { errors: { demoPhone: 'Enter a UK mobile or an international number.' } });
  return mutate((draft) => {
    if (draft.settings.demoPhoneDigits === digits) return noop({ ok: true, digits });
    draft.settings.demoPhoneDigits = digits;
    return { ok: true, digits };
  });
}

// ---------- demo tools ----------

export function resetDemo({ keepSettings = true } = {}) {
  return mutate((draft) => {
    let settings;
    let keepSpend = [];
    if (keepSettings) {
      settings = draft.settings;
      settings.daysOff = [];
      settings.fullDays = [];
      keepSpend = settings.marketing.adSpend.filter((e) => !e.seed);
    } else {
      settings = makeDefaultSettings();
      settings.theme = draft.settings.theme;
      settings.demoPhoneDigits = draft.settings.demoPhoneDigits;
    }
    const seed = buildSeed(now(), settings);
    const top = maxSeq(seed.messages);
    settings.marketing.adSpend = mergeAdSpend(keepSpend, seed.adSpend);
    draft.settings = settings;
    draft.bookings = seed.bookings;
    draft.blocks = seed.blocks;
    draft.messages = seed.messages;
    draft.quotes = seed.quotes;
    draft.refSeq = seed.refSeq;
    draft.seededFor = todayKey();
    draft.meta.msgSeq = top;
    draft.meta.messagesSeenSeq = top;
    draft.meta.simCursor = 0;
    syncCalendarBlocks(draft);
    // The undo list is forgotten only once the reset is really saved: a write the browser refuses must leave it (and everything else) as it was.
    return { ok: true, afterCommit: () => tokens.clear() };
  });
}

// The simulator rotates the lead source too, so a demo run shows up in Lead sources.
const SIM_UTM = [
  { source: 'facebook', medium: 'paid_social', campaign: 'ev_charger_leads' },
  { source: 'facebook', medium: 'paid_social', campaign: 'home_charging_video' },
  { source: 'instagram', medium: 'paid_social', campaign: 'charger_reels' },
  { source: 'google', medium: 'organic', campaign: '' },
  { source: 'facebook', medium: 'paid_social', campaign: 'ev_charger_leads' }
];

export function simulateIncomingBooking({ kind = 'standard' } = {}) {
  return mutate((draft) => {
    const person = SIM_POOL[draft.meta.simCursor % SIM_POOL.length];
    const base = {
      customer: { name: person.name, phone: person.phone },
      address: { line1: person.line1, postcode: person.postcode },
      notes: person.notes,
      source: 'website'
    };
    let input;
    if (kind === 'emergency') {
      input = { ...base, serviceId: 'emergency', urgent: true, date: todayKey(), windowId: null, emergencyReasons: ['no_power'], notes: 'Power went off suddenly' };
    } else {
      // A website enquiry like the funnel makes: the postcode and the four answers, and the next free survey window pencilled in.
      // A postcode outside Northern Ireland (not BT) is the "check before you confirm" case.
      input = {
        ...base, serviceId: 'ev_quote', pencil: true, answers: person.answers, utm: SIM_UTM[draft.meta.simCursor % SIM_UTM.length],
        address: { line1: '', postcode: kind === 'approval' ? 'DG9 8PQ' : person.postcode }
      };
    }
    const result = createBookingIn(draft, input);
    if (result.ok) draft.meta.simCursor += 1;
    return result;
  });
}

// ---------- quotes (v3) ----------

const quoteOf = (draft, id) => own(draft.quotes, id);

// A person's first change to a demo quote makes it theirs: a day rollover keeps it.
const adopt = (quote) => {
  quote.seed = false;
};

function nextRefAndId(draft) {
  let refNumber = draft.refSeq;
  while (draft.bookings.some((b) => b.ref === `EL-${refNumber}`)) refNumber += 1;
  draft.refSeq = refNumber + 1;
  let id = makeId('bk');
  while (draft.bookings.some((b) => b.id === id)) id = makeId('bk');
  return { ref: `EL-${refNumber}`, id };
}

/** Quote ids come from the enquiry ref: Q-EL-1043, then Q-EL-1043-2 for a second version. */
function nextQuoteId(draft, booking) {
  const base = `Q-${booking.ref}`;
  if (!draft.quotes[base]) return base;
  for (let n = 2; n < 100; n += 1) if (!draft.quotes[`${base}-${n}`]) return `${base}-${n}`;
  return `${base}-${makeId('v').slice(2)}`;
}

function cleanNotes(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

export function createQuote(input = {}) {
  return mutate((draft) => {
    const d = input && typeof input === 'object' ? input : {};
    const booking = liveBooking(draft, d.bookingId);
    if (!booking) return fail('not_found');
    if (booking.serviceId !== 'ev_quote') return fail('invalid', { errors: { bookingId: 'A quote belongs to a home charger enquiry.' } });
    if (booking.status === 'cancelled') return fail('bad_transition');
    const settings = draft.settings;
    const defaults = settings.quoteDefaults;
    const errors = {};
    const brand = d.brand === undefined || d.brand === null ? settings.business.brands[0] || '' : String(d.brand).trim().slice(0, 40);
    let lines = [];
    if (d.lines === undefined) {
      lines = defaultQuoteLines(settings, { brand });
    } else {
      const checked = normaliseQuoteLines(d.lines);
      if (checked.error) errors.lines = checked.error;
      else lines = checked.lines;
    }
    const notes = d.notes === undefined ? defaults.notes : cleanNotes(d.notes);
    if (notes.length > 1500) errors.notes = 'Keep the notes under 1500 characters.';
    const validUntil = d.validUntil === undefined ? addDays(todayKey(), defaults.validDays) : d.validUntil;
    if (!isDayKey(validUntil)) errors.validUntil = 'Choose the last day the quote is valid.';
    const customerName = d.customerName === undefined ? booking.customer.name : String(d.customerName === null ? '' : d.customerName).trim().slice(0, 60);
    if (!customerName) errors.customerName = 'Enter the customer name.';
    if (!errors.lines && quoteTotal({ lines }) < 0) errors.lines = 'The total cannot be below zero.';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    const quote = {
      id: nextQuoteId(draft, booking), bookingId: booking.id, customerName, createdAt: nowStamp(), status: 'draft', brand, lines, notes, validUntil,
      sentAt: null, sentVia: null, viewedAt: null, acceptedAt: null, declinedAt: null, declineReason: '', installBookingId: null, seed: false
    };
    draft.quotes[quote.id] = quote;
    return { ok: true, quote, touched: { quotes: [quote.id] } };
  });
}

export function updateQuote(id, patch = {}) {
  return mutate((draft, prev) => {
    const quote = quoteOf(draft, id);
    if (!quote) return fail('not_found');
    if (quote.status !== 'draft' && quote.status !== 'sent') return fail('bad_transition');
    const p = patch && typeof patch === 'object' ? patch : {};
    const errors = {};
    const changes = {};
    if ('brand' in p) changes.brand = String(p.brand === null || p.brand === undefined ? '' : p.brand).trim().slice(0, 40);
    if ('lines' in p) {
      const checked = normaliseQuoteLines(p.lines);
      if (checked.error) errors.lines = checked.error;
      else changes.lines = checked.lines;
    }
    if ('notes' in p) {
      const notes = cleanNotes(p.notes);
      if (notes.length > 1500) errors.notes = 'Keep the notes under 1500 characters.';
      else changes.notes = notes;
    }
    if ('validUntil' in p) {
      if (isDayKey(p.validUntil)) changes.validUntil = p.validUntil;
      else errors.validUntil = 'Choose the last day the quote is valid.';
    }
    if ('customerName' in p) {
      const name = String(p.customerName === null || p.customerName === undefined ? '' : p.customerName).trim().slice(0, 60);
      if (name) changes.customerName = name;
      else errors.customerName = 'Enter the customer name.';
    }
    const lines = changes.lines || quote.lines;
    if (!errors.lines && quoteTotal({ lines }) < 0) errors.lines = 'The total cannot be below zero.';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    if (Object.keys(changes).every((k) => deepEqual(quote[k], changes[k]))) return noop({ ok: true, quote: prev.quotes[id] });
    Object.assign(quote, changes);
    adopt(quote);
    return { ok: true, quote };
  });
}

export function deleteQuote(id) {
  return mutate((draft) => {
    const quote = quoteOf(draft, id);
    if (!quote) return fail('not_found');
    if (quote.status !== 'draft') return fail('bad_transition');
    delete draft.quotes[id];
    return { ok: true, touched: { quotes: [id] } };
  });
}

export function sendQuote(id, { via } = {}) {
  return mutate((draft) => {
    const quote = quoteOf(draft, id);
    if (!quote) return fail('not_found');
    if (!QUOTE_VIA.includes(via)) return fail('invalid', { errors: { via: 'Choose WhatsApp, email or a link.' } });
    if (!['draft', 'sent', 'viewed'].includes(quote.status)) return fail('bad_transition');
    const booking = liveBooking(draft, quote.bookingId);
    if (!booking) return fail('not_found');
    if (booking.status === 'cancelled') return fail('bad_transition');
    if (!quote.lines.length || quoteTotal(quote) <= 0) return fail('invalid', { errors: { lines: 'Add at least one line with a price.' } });
    if (via === 'email' && !String(booking.customer.email || '').trim()) return fail('no_email', { errors: { email: 'There is no email address for this customer.' } });
    const stamp = nowStamp();
    if (quote.validUntil < stampDay(stamp)) quote.validUntil = addDays(stampDay(stamp), draft.settings.quoteDefaults.validDays);
    quote.sentAt = stamp;
    quote.sentVia = via;
    if (quote.status === 'draft') quote.status = 'sent';
    adopt(quote);
    const message = addMessage(draft, 'customer_quote_sent', booking, { quote, channel: via === 'email' ? 'email' : 'whatsapp' });
    addHistory(booking, 'message', 'owner', KIND_LABELS.customer_quote_sent);
    const info = quoteLinkInfo(quote, { booking }); // the self-contained link (quote.html#d=...), the same one the message carries
    return { ok: true, quote, message, link: info.url, linkPortable: info.portable, touched: { quotes: [id], messages: [message.id], bookings: [booking.id] } };
  });
}

export function recordQuoteViewed(id) {
  return mutate((draft, prev) => {
    const quote = quoteOf(draft, id);
    if (!quote) return fail('not_found');
    if (quote.status !== 'sent' || quoteStatus(quote, nowStamp()) !== 'sent') return noop({ ok: true, quote: prev.quotes[id], changed: false });
    quote.status = 'viewed';
    quote.viewedAt = nowStamp();
    adopt(quote);
    return { ok: true, quote, changed: true };
  });
}

// The install booking an accepted quote makes, the quote's new state, the history line and the two simulated messages. Shared by acceptQuote (the
// customer picked a day on the owner's own diary: date and windowId) and importQuoteDecision (an acceptance that came back through WhatsApp: no day yet,
// `date: null`, so the install is UNSCHEDULED, like an enquiry the diary had no room for, and the preferences are in its notes).
function createInstallFor(draft, quote, enquiry, service, { stamp, date, windowId, notes = '', via = '' }) {
  const unscheduled = date === null || date === undefined;
  const { ref, id: bookingId } = nextRefAndId(draft);
  const install = {
    id: bookingId,
    ref,
    createdAt: stamp,
    serviceId: service.id,
    serviceName: service.name,
    variantId: null,
    variantLabel: '',
    start: unscheduled ? stamp : makeStamp(date, WINDOWS[windowId].start),
    durationMin: unscheduled ? 0 : 240,
    status: 'new',
    urgent: false,
    emergencyReasons: [],
    etaMinutes: null,
    etaAt: null,
    customer: { ...enquiry.customer },
    address: { ...enquiry.address },
    notes,
    internalNotes: '',
    source: enquiry.source,
    quotedPrice: quoteTotal(quote),
    finalPrice: null,
    paid: false,
    paidMethod: null,
    paidAt: null,
    seenByOwner: false,
    reviewRequested: false,
    cancelledBy: null,
    cancelReason: '',
    seed: false,
    history: [],
    quoteId: quote.id
  };
  if (!unscheduled) install.tentative = true; // pencilled in until the owner confirms the day
  if (enquiry.answers) install.answers = { ...enquiry.answers }; // the job card keeps what the customer said about their home
  addHistory(install, 'created', 'customer', enquiry.source);
  draft.bookings.push(install);
  quote.status = 'accepted';
  quote.acceptedAt = stamp;
  quote.installBookingId = install.id;
  if (via) quote.acceptedVia = via;
  adopt(quote);
  addHistory(enquiry, 'message', 'customer', 'Quote accepted');
  // Insertion order as in createBooking: the owner alert last, so it sorts first on the Messages screen.
  const customerMessage = addMessage(draft, 'customer_quote_accepted', install, { quote, installBooking: install });
  const ownerMessage = addMessage(draft, 'owner_quote_accepted', install, { quote, installBooking: install });
  return { install, messages: [customerMessage, ownerMessage] };
}

export function acceptQuote(id, { date, windowId } = {}) {
  return mutate((draft) => {
    const quote = quoteOf(draft, id);
    if (!quote) return fail('not_found');
    if (quote.status === 'accepted') return fail('already_accepted', { installBookingId: quote.installBookingId });
    if (quote.status !== 'sent' && quote.status !== 'viewed') return fail('bad_transition');
    const stamp = nowStamp();
    if (quoteStatus(quote, stamp) === 'expired') return fail('expired');
    const errors = {};
    if (!isDayKey(date)) errors.date = 'Choose a day';
    if (!Number.isInteger(windowId) || windowId < 0 || windowId > 3) errors.windowId = 'Choose a time';
    else if (!HALF_DAY_STARTS.includes(windowId)) errors.windowId = 'Choose morning or afternoon';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    const enquiry = liveBooking(draft, quote.bookingId);
    if (!enquiry) return fail('not_found');
    const service = draft.settings.services.find((x) => x.id === 'ev');
    if (!service || !service.active) return fail('service_unavailable');
    // The customer picked this day from the live diary, so it is re-checked here in customer mode, inside the same write.
    if (!isSlotFree(draft, { date, windowId, blocks: 2, ownerMode: false })) {
      return fail('slot_taken', { alternatives: nextFreeSlots(draft, 'ev', 3) });
    }
    const { install, messages } = createInstallFor(draft, quote, enquiry, service, { stamp, date, windowId });
    return {
      ok: true, quote, booking: install, messages,
      touched: { quotes: [id], bookings: [install.id, enquiry.id], messages: messages.map((m) => m.id) }
    };
  });
}

// Mark a quote declined, log the owner alert on the enquiry and the history line. Shared by declineQuote and importQuoteDecision.
function declineIn(draft, quote, enquiry, { reason, by, via = '' }) {
  quote.status = 'declined';
  quote.declinedAt = nowStamp();
  quote.declineReason = reason;
  if (via) quote.declinedVia = via;
  adopt(quote);
  addHistory(enquiry, 'message', by, 'Quote declined');
  return addMessage(draft, 'owner_quote_declined', enquiry, { quote, reason });
}

export function declineQuote(id, { reason = '', by = 'customer' } = {}) {
  return mutate((draft) => {
    const quote = quoteOf(draft, id);
    if (!quote) return fail('not_found');
    if (by !== 'customer' && by !== 'owner') return fail('invalid', { errors: { by: 'Declined by the customer or the owner.' } });
    if (quote.status !== 'sent' && quote.status !== 'viewed') return fail('bad_transition');
    const enquiry = liveBooking(draft, quote.bookingId);
    if (!enquiry) return fail('not_found');
    const why = plainText(reason, 200);
    const message = declineIn(draft, quote, enquiry, { reason: why, by });
    return { ok: true, quote, message, touched: { quotes: [id], bookings: [enquiry.id], messages: [message.id] } };
  });
}

/**
 * A customer opened a self-contained quote link (quote.html#q=<id>&d=<payload>) in a browser that has never seen the quote, and is
 * about to accept or decline it. This writes the quote (and a small enquiry to hang it on) into THIS browser's store, as the
 * "sent and viewed" quote the link describes, so acceptQuote and declineQuote can run unchanged. `link` is the parsed payload
 * (parseQuotePayload). Idempotent: a quote that already exists here is left alone, except a demo (seed) quote that has not been
 * decided and is older than the link, which the link replaces. No message is added.
 */
export function importLinkedQuote(link) {
  return mutate((draft) => {
    const l = link && typeof link === 'object' ? link : {};
    const id = typeof l.id === 'string' ? l.id : '';
    if (!/^Q-[A-Za-z0-9-]{1,50}$/.test(id)) return fail('invalid');
    const existing = quoteOf(draft, id);
    const replaceable = !!existing && existing.seed === true && ['draft', 'sent', 'viewed'].includes(existing.status);
    if (existing && !replaceable) return noop({ ok: true, quote: existing, existing: true });
    const checked = normaliseQuoteLines(Array.isArray(l.lines) ? l.lines.map((x) => ({ label: x.label, detail: x.detail, qty: x.qty, unitPrice: x.unitPrice })) : null);
    if (checked.error) return fail('invalid', { errors: { lines: checked.error } });
    if (!checked.lines.length || quoteTotal({ lines: checked.lines }) <= 0) return fail('invalid', { errors: { lines: 'The link has no priced lines.' } });
    if (!isDayKey(l.validUntil)) return fail('invalid', { errors: { validUntil: 'The link has no valid-until day.' } });
    const name = String(l.customerName || '').trim().slice(0, 60);
    if (!name) return fail('invalid', { errors: { customerName: 'The link has no customer name.' } });
    const service = draft.settings.services.find((x) => x.id === 'ev_quote');
    if (!service) return fail('service_unavailable');
    const stamp = nowStamp();
    const sentAt = typeof l.sentAt === 'string' && l.sentAt ? l.sentAt.slice(0, 16) : stamp;
    // The enquiry reference is the one the quote id came from when that is free here, else the next one.
    const m = /^Q-(EL-\d+)/.exec(id);
    let ref = m && !draft.bookings.some((b) => b.ref === m[1]) ? m[1] : '';
    let bookingId = makeId('bk');
    while (draft.bookings.some((b) => b.id === bookingId)) bookingId = makeId('bk');
    if (!ref) ref = nextRefAndId(draft).ref;
    const enquiry = {
      id: bookingId, ref, createdAt: sentAt, serviceId: service.id, serviceName: service.name, variantId: null, variantLabel: '',
      start: stamp, durationMin: 0, status: 'new', urgent: false, emergencyReasons: [], etaMinutes: null, etaAt: null,
      customer: { name, phone: '', email: '' }, address: { line1: '', postcode: String(l.postcode || '').slice(0, 10) },
      notes: '', internalNotes: '', source: 'website', quotedPrice: 0, finalPrice: null, paid: false, paidMethod: null, paidAt: null,
      seenByOwner: true, reviewRequested: false, cancelledBy: null, cancelReason: '', seed: false, history: []
    };
    addHistory(enquiry, 'created', 'customer', 'quote link');
    draft.bookings.push(enquiry);
    draft.quotes[id] = {
      id, bookingId: enquiry.id, customerName: name, createdAt: sentAt, status: 'viewed', brand: String(l.brand || '').trim().slice(0, 40), lines: checked.lines,
      notes: cleanNotes(l.notes).slice(0, 1500), validUntil: l.validUntil, sentAt, sentVia: 'link', viewedAt: stamp, acceptedAt: null, declinedAt: null,
      declineReason: '', installBookingId: null, seed: false
    };
    return { ok: true, quote: draft.quotes[id], booking: enquiry, imported: true, touched: { quotes: [id], bookings: [enquiry.id] } };
  });
}

// ---------- the WhatsApp link handoff (v4): what arrives from the other phone, validated and applied exactly once ----------

// A failed parse (js/core/handoff.js parseImport) as a store failure: the reason, a calm sentence to show, and the field errors when there are some.
const importFailure = (parsed) => fail(parsed.reason, { message: parsed.message, ...(parsed.errors ? { errors: parsed.errors } : {}) });

const WRONG_KIND = {
  enq: 'This link is a quote for a customer, not an enquiry. Customers open it on the quote page.',
  reply: 'This link is a new enquiry, not a reply to a quote.'
};

/**
 * An enquiry the customer sent through WhatsApp (dashboard.html#import=...). `input` is the parseImport result, its data or payload, or the encoded
 * link text: everything is re-validated here. It goes through createBookingIn, the same code as a website enquiry (pencilled survey from THIS diary,
 * the owner alert, seenByOwner false), with the customer's own sent time as createdAt (never in the future) so the reply clock is honest.
 * Idempotent: the same enquiry again returns { ok: true, existed: true, bookingId } and changes nothing.
 */
export function importEnquiry(input) {
  return mutate((draft, prev) => {
    const parsed = parseImport(input);
    if (!parsed.ok) return importFailure(parsed);
    if (parsed.kind !== 'enq') return fail('wrong_kind', { message: parsed.kind === 'quo' ? WRONG_KIND.enq : 'This link is a reply to a quote, not a new enquiry.' });
    const d = parsed.data;
    const existing = draft.bookings.find((b) => b.importId === d.importId);
    if (existing) return noop({ ok: true, existed: true, bookingId: existing.id, booking: findById(prev.bookings, existing.id) });
    const result = createBookingIn(draft, {
      customer: { name: d.name, phone: d.phone, email: d.email },
      address: { line1: '', postcode: d.postcode },
      notes: d.notes,
      source: 'website',
      serviceId: 'ev_quote',
      pencil: true,
      answers: { postcode: d.postcode, ...d.answers, marketingOptIn: d.marketingOptIn },
      utm: d.utmSource ? { source: d.utmSource, medium: '', campaign: '' } : undefined
    }, { createdAt: d.createdAt, importId: d.importId, ref: d.ref, notesMax: 400 });
    if (!result.ok) {
      return fail(result.reason, { ...result, message: result.reason === 'service_unavailable' ? 'Home charger enquiries are switched off on this device, so this one was not added.' : 'This enquiry could not be added.' });
    }
    addHistory(result.booking, 'note', 'system', 'Added from a WhatsApp link');
    return { ...result, existed: false, bookingId: result.booking.id };
  });
}

// What the install booking's notes say: the days that suit and the customer's own words.
function installNotesFor(d) {
  const text = `Install preferences: ${describePreferences(d.days, d.part)}.${d.note ? ` Customer note: ${d.note}` : ''}`;
  return text.slice(0, 300);
}

/**
 * A customer's acceptance or decline that came back through WhatsApp. The rules live in quotes.js assessQuoteDecision (the import screen shows the
 * same verdict). Accepted: the quote is accepted (acceptedVia 'whatsapp') and the UNSCHEDULED install booking is made, with the preferences in its
 * notes. Declined: the quote is declined with the reason. Idempotent; a failure changes nothing and carries a plain `message`.
 * `force: true` applies an acceptance whose total no longer matches the quote (the owner changed a sent quote and has checked with the customer).
 */
export function importQuoteDecision(input, { force = false } = {}) {
  return mutate((draft, prev) => {
    const parsed = parseImport(input);
    if (!parsed.ok) return importFailure(parsed);
    if (parsed.kind !== 'acc' && parsed.kind !== 'dec') return fail('wrong_kind', { message: parsed.kind === 'quo' ? WRONG_KIND.enq : WRONG_KIND.reply });
    const d = parsed.data;
    const stamp = nowStamp();
    let verdict = assessQuoteDecision(draft.quotes, d, stamp);
    if (verdict.reason === 'total_changed' && force === true) verdict = { ...verdict, state: 'ready', reason: '', message: '' };
    if (verdict.state === 'blocked') {
      return fail(verdict.reason, {
        message: verdict.message,
        ...(verdict.expected !== undefined ? { expected: verdict.expected, accepted: verdict.accepted } : {}),
        ...(verdict.bookingId ? { bookingId: verdict.bookingId } : {})
      });
    }
    const quote = own(draft.quotes, d.quoteId);
    if (verdict.state === 'done') {
      return noop({
        ok: true, existed: true, kind: d.kind, quote: prev.quotes[d.quoteId],
        ...(d.kind === 'acc' && quote.installBookingId ? { bookingId: quote.installBookingId, booking: findById(prev.bookings, quote.installBookingId) } : {})
      });
    }
    const enquiry = liveBooking(draft, quote.bookingId);
    if (!enquiry) return fail('not_found', { message: `The enquiry for quote ${quote.id} is no longer on this device.` });
    if (d.kind === 'dec') {
      const message = declineIn(draft, quote, enquiry, { reason: declineReasonText(d.reasonId, d.note), by: 'customer', via: 'whatsapp' });
      return { ok: true, existed: false, kind: 'dec', quote, message, touched: { quotes: [quote.id], bookings: [enquiry.id], messages: [message.id] } };
    }
    const service = draft.settings.services.find((x) => x.id === 'ev');
    if (!service || !service.active) return fail('service_unavailable', { message: 'Installations are switched off on this device, so this acceptance was not applied.' });
    const { install, messages } = createInstallFor(draft, quote, enquiry, service, { stamp, date: null, windowId: null, notes: installNotesFor(d), via: 'whatsapp' });
    return {
      ok: true, existed: false, kind: 'acc', quote, booking: install, bookingId: install.id, messages,
      touched: { quotes: [quote.id], bookings: [install.id, enquiry.id], messages: messages.map((m) => m.id) }
    };
  });
}

/** One entry point for the import screen: an enquiry goes to importEnquiry, an acceptance or decline to importQuoteDecision (a quote link is { ok: false, reason: 'wrong_kind' }). */
export function importHandoff(input, opts = {}) {
  const parsed = parseImport(input);
  if (!parsed.ok) return importFailure(parsed);
  if (parsed.kind === 'enq') return importEnquiry(parsed);
  if (parsed.kind === 'acc' || parsed.kind === 'dec') return importQuoteDecision(parsed, opts);
  return fail('wrong_kind', { message: WRONG_KIND.enq });
}

// ---------- photos (v3) ----------

export function addBookingPhotos(id, photos) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    const list = Array.isArray(photos) ? photos : [];
    if (list.length === 0) return fail('invalid', { errors: { photos: 'Choose a photo.' } });
    const held = Array.isArray(b.photos) ? b.photos : [];
    if (held.length >= PHOTO_LIMITS.maxPhotos) return fail('too_many', { max: PHOTO_LIMITS.maxPhotos });
    const kept = normalisePhotos(list, { existing: held.length });
    if (kept.photos.length === 0) {
      const first = list.map(validatePhoto).find(Boolean) || 'Choose a photo.';
      return fail('invalid', { errors: { photos: first } });
    }
    const used = new Set(held.map((p) => p.id));
    const added = kept.photos.map((p) => {
      let photoId = used.has(p.id) ? makeId('ph') : p.id;
      while (used.has(photoId)) photoId = makeId('ph');
      used.add(photoId);
      return { ...p, id: photoId };
    });
    b.photos = [...held, ...added];
    return { ok: true, booking: b, added: added.length, dropped: list.length - added.length, touched: { bookings: [b.id] } };
  });
}

export function removeBookingPhoto(id, photoId) {
  return mutate((draft) => {
    const b = liveBooking(draft, id);
    if (!b) return fail('not_found');
    if (!Array.isArray(b.photos) || !b.photos.some((p) => p.id === photoId)) return fail('not_found');
    b.photos = b.photos.filter((p) => p.id !== photoId);
    if (b.photos.length === 0) delete b.photos;
    return { ok: true, booking: b, touched: { bookings: [b.id] } };
  });
}

// ---------- marketing (v3) ----------

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function setAdSpend(month, channel, amount) {
  return mutate((draft) => {
    const errors = {};
    if (typeof month !== 'string' || !MONTH_KEY.test(month)) errors.month = 'Choose a month';
    if (!AD_CHANNELS.includes(channel)) errors.channel = 'Choose where the ads ran';
    if (!Number.isInteger(amount) || amount < 0 || amount > 999999) errors.amount = 'Enter a whole number of pounds.';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    const list = draft.settings.marketing.adSpend;
    const existing = list.find((e) => e.month === month && e.channel === channel);
    if (amount === 0) {
      if (!existing) return noop({ ok: true, entry: null });
      draft.settings.marketing.adSpend = list.filter((e) => e.id !== existing.id);
      return { ok: true, entry: null, touched: { settings: ['marketing'] } };
    }
    let entry = existing;
    if (entry) {
      if (entry.amount === amount && !entry.seed) return noop({ ok: true, entry });
      entry.amount = amount;
      delete entry.seed; // a figure a person typed is theirs
    } else {
      entry = { id: makeId('ad'), month, channel, amount };
      list.push(entry);
    }
    draft.settings.marketing.adSpend = [...draft.settings.marketing.adSpend].sort(adSpendOrder);
    return { ok: true, entry, touched: { settings: ['marketing'] } };
  });
}

export function removeAdSpend(id) {
  return mutate((draft) => {
    const list = draft.settings.marketing.adSpend;
    if (!list.some((e) => e.id === id)) return fail('not_found');
    draft.settings.marketing.adSpend = list.filter((e) => e.id !== id);
    return { ok: true, touched: { settings: ['marketing'] } };
  });
}

// ---------- connections (v3): ALL SIMULATED, saved on this device only ----------

const CONNECTION_KEY_LIST = ['domain', 'webhook', 'tracking', 'whatsapp', 'calendar', 'email'];

function armSettle(ms, force) {
  if (typeof setTimeout !== 'function') return;
  const timer = setTimeout(() => {
    settleTimers.delete(timer);
    try {
      runSettle(force);
    } catch (e) {
      // a failed settle must never break the page
    }
  }, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  settleTimers.add(timer);
}

function runSettle(force) {
  return mutate((draft) => {
    const before = draft.settings.connections;
    const after = settleConnectionsIn(before, nowStampSec(), { force });
    if (after === before) return noop({ ok: true, changed: false });
    draft.settings.connections = after;
    return { ok: true, changed: true };
  });
}

/** Apply any simulated delay that is due (templates approved, a verifying domain gone live). Cheap and idempotent. */
export function settleConnections() {
  return runSettle([]);
}

function connectionResult(draft, key, extra = {}) {
  return { ok: true, connection: draft.settings.connections[key], ...extra };
}

export function setConnection(key, patch = {}) {
  return mutate((draft, prev) => {
    if (!CONNECTION_KEY_LIST.includes(key)) return fail('invalid', { errors: { key: 'Unknown connection.' } });
    const current = draft.settings.connections[key];
    const { errors, changes } = validateConnectionPatch(key, patch, current);
    if (Object.keys(errors).length) return fail('invalid', { errors });
    if (Object.keys(changes).every((k) => deepEqual(current[k], changes[k]))) return noop({ ok: true, connection: prev.settings.connections[key] });
    Object.assign(current, changes);
    const touched = { settings: [`connections.${key}`] };
    if (key === 'calendar' && 'twoWay' in changes && current.status === 'connected') {
      const sync = syncCalendarBlocks(draft);
      touched.blocks = [...sync.added, ...sync.removed];
    }
    return connectionResult(draft, key, { touched });
  });
}

export function connectWhatsApp({ number, code } = {}) {
  return mutate((draft) => {
    const wa = draft.settings.connections.whatsapp;
    const normalised = normaliseWhatsAppNumber(number === undefined ? wa.number : number);
    if (!normalised) return fail('invalid', { errors: { number: 'Enter the WhatsApp number, like 07885 496800' } });
    if (String(code === undefined || code === null ? '' : code).trim() !== WHATSAPP_DEMO_CODE) return fail('bad_code');
    wa.status = 'connected';
    wa.number = normalised;
    wa.connectedAt = nowStamp();
    return connectionResult(draft, 'whatsapp', { touched: { settings: ['connections.whatsapp'] } });
  });
}

export function submitWhatsAppTemplates() {
  return mutate((draft) => {
    const wa = draft.settings.connections.whatsapp;
    if (wa.status !== 'connected') return fail('not_connected');
    for (const kind of WHATSAPP_TEMPLATE_KINDS) if (!wa.templates[kind] || wa.templates[kind] === 'none') wa.templates[kind] = 'pending';
    wa.templatesSubmittedAt = nowStampSec();
    return connectionResult(draft, 'whatsapp', { touched: { settings: ['connections.whatsapp'] } });
  });
}

/** PROTOTYPE ONLY: skip the one to two day wait and approve every pending template now. Behind the wizard's "Prototype: fast-forward" button. */
export function fastForwardWhatsAppTemplates() {
  return runSettle(['templates']);
}

export function connectGoogle(service, { account } = {}) {
  return mutate((draft) => {
    if (service !== 'calendar' && service !== 'email') return fail('invalid', { errors: { service: 'Choose calendar or email.' } });
    const text = String(account === undefined || account === null ? '' : account).trim();
    if (!isValidEmail(text)) return fail('invalid', { errors: { account: 'Enter the Google account, like name@gmail.com' } });
    const c = draft.settings.connections[service];
    c.status = 'connected';
    c.account = text;
    c.connectedAt = nowStamp();
    const touched = { settings: [`connections.${service}`] };
    if (service === 'calendar') {
      const sync = syncCalendarBlocks(draft);
      touched.blocks = [...sync.added, ...sync.removed];
    }
    return connectionResult(draft, service, { touched });
  });
}

export function disconnect(key) {
  return mutate((draft) => {
    if (!CONNECTION_KEY_LIST.includes(key)) return fail('invalid', { errors: { key: 'Unknown connection.' } });
    const c = draft.settings.connections;
    const fresh = makeDefaultConnections();
    const touched = { settings: [`connections.${key}`] };
    if (key === 'domain') c.domain = fresh.domain;
    else if (key === 'whatsapp') c.whatsapp = { ...c.whatsapp, status: 'disconnected', templates: fresh.whatsapp.templates, templatesSubmittedAt: null, connectedAt: null };
    else if (key === 'calendar') c.calendar = { ...c.calendar, status: 'disconnected', account: '', connectedAt: null };
    else if (key === 'email') c.email = { ...c.email, status: 'disconnected', account: '', connectedAt: null };
    else if (key === 'webhook') c.webhook = { ...c.webhook, enabled: false };
    else c.tracking = { ...c.tracking, metaPixelId: '', googleTagId: '' };
    if (key === 'calendar') {
      const sync = syncCalendarBlocks(draft);
      touched.blocks = [...sync.added, ...sync.removed];
    }
    return connectionResult(draft, key, { touched });
  });
}

export function startDomainSetup(domain) {
  return mutate((draft) => {
    const check = validateHostname(domain);
    if (!check.ok) return fail('invalid', { errors: { domain: check.message } });
    draft.settings.connections.domain = { status: 'pending', domain: check.host, checks: 0, verifiedAt: null, firstCheckAt: null };
    return connectionResult(draft, 'domain', { records: domainRecords(check.host), touched: { settings: ['connections.domain'] } });
  });
}

export function checkDomain() {
  return mutate((draft) => {
    const d = draft.settings.connections.domain;
    if (d.status === 'none') return fail('bad_transition');
    if (d.status === 'live') return noop({ ok: true, found: true, status: 'live', unchanged: true, sslIssued: true, connection: d });
    const stampSec = nowStampSec();
    d.checks += 1;
    if (d.checks === 1 && !d.firstCheckAt) {
      d.status = 'verifying';
      d.firstCheckAt = stampSec;
      return {
        ok: true, found: false, status: 'verifying', sslIssued: false, connection: d,
        message: 'We cannot see your records yet. DNS changes can take a while, so try again in a minute.',
        afterCommit: () => armSettle(20000, ['domain'])
      };
    }
    d.status = 'live';
    d.verifiedAt = stampSec.slice(0, 16);
    return {
      ok: true, found: true, status: 'live', sslIssued: true, connection: d,
      message: 'Your website address is connected and the security certificate is ready (simulated).'
    };
  });
}

export function rotateWebhookSecret() {
  return mutate((draft) => {
    let secret = 'whsec_';
    for (let i = 0; i < 24; i += 1) secret += Math.floor(Math.random() * 36).toString(36);
    draft.settings.connections.webhook.secret = secret;
    return connectionResult(draft, 'webhook', { secret, touched: { settings: ['connections.webhook'] } });
  });
}

function addSystemMessage(draft, kind, extra) {
  const m = buildSystemMessage(kind, draft, { at: nowStamp(), ...extra });
  const message = { id: makeId('msg'), ...m, seq: 0 };
  draft.meta.msgSeq += 1;
  message.seq = draft.meta.msgSeq;
  draft.messages.push(message);
  return message;
}

export function sendTestEvent(key) {
  return mutate((draft) => {
    const c = draft.settings.connections;
    if (key === 'webhook') {
      if (!c.webhook.enabled) return fail('disabled');
      // The same code path as the website funnel: a customer enquiry with the next survey window pencilled in.
      const person = SIM_POOL[draft.meta.simCursor % SIM_POOL.length];
      const result = createBookingIn(draft, {
        customer: { name: person.name, phone: person.phone, email: '' },
        address: { line1: '', postcode: person.postcode },
        notes: 'Sample enquiry from the webhook test (simulated).',
        source: 'website',
        serviceId: 'ev_quote',
        pencil: true,
        answers: person.answers,
        utm: { source: 'other', medium: 'webhook', campaign: 'test_event' }
      });
      if (!result.ok) return result;
      draft.meta.simCursor += 1;
      c.webhook.lastEventAt = nowStamp();
      return { ...result, connection: c.webhook };
    }
    if (key === 'whatsapp' || key === 'email') {
      if (c[key].status !== 'connected') return fail('not_connected');
      const message = addSystemMessage(draft, 'owner_test_event', { channel: key, toEmail: key === 'email' ? c.email.account : '' });
      return { ok: true, message, touched: { messages: [message.id] } };
    }
    return fail('invalid', { errors: { key: 'Send a test event to the webhook, WhatsApp or email.' } });
  });
}

// ---------- undo ----------

function sameRecord(current, expected) {
  return current === null || expected === null ? current === expected : deepEqual(current, expected);
}

// Put a record back where it was (list order is part of how the diary reads), or remove it again.
function restoreRecords(list, snapshots) {
  for (const t of [...snapshots].sort((a, b) => a.index - b.index)) {
    const idx = list.findIndex((r) => r.id === t.id);
    if (t.before === null) {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      list[idx] = clone(t.before);
    } else {
      list.splice(t.index >= 0 ? Math.min(t.index, list.length) : list.length, 0, clone(t.before));
    }
  }
}

/** Reverse one mutation if everything it touched is still exactly as that mutation left it. */
export function undo(token) {
  const entry = tokens.get(token);
  if (!entry) {
    initStore();
    return fail('stale');
  }
  return mutate((draft) => {
    const stale = () => fail('stale');
    for (const t of entry.bookings) if (!sameRecord(findById(draft.bookings, t.id), t.after)) return stale();
    for (const t of entry.messages) if (!sameRecord(findById(draft.messages, t.id), t.after)) return stale();
    for (const t of entry.blocks) if (!sameRecord(findById(draft.blocks, t.id), t.after)) return stale();
    for (const t of entry.daysOff) if (!sameRecord(findById(draft.settings.daysOff, t.id), t.after)) return stale();
    for (const t of entry.fullDays) if (draft.settings.fullDays.includes(t.date) !== t.after) return stale();
    for (const t of entry.quotes) if (!sameRecord(draft.quotes[t.id] || null, t.after)) return stale();
    for (const t of entry.settings) if (!sameRecord(getPath(draft.settings, t.path), t.after)) return stale();

    // Put nothing back on top of somebody else's work: windows a restored job re-occupies must still be free.
    for (const t of entry.bookings) {
      const b = t.before;
      if (!b || b.urgent || !['new', 'confirmed', 'on_the_way'].includes(b.status)) continue;
      const a = t.after;
      const reoccupies = !a || a.status === 'cancelled' || a.start !== b.start;
      if (!reoccupies) continue;
      const ids = bookingWindowIds(b);
      if (ids.length === 0) continue;
      if (!isSlotFree(draft, { date: stampDay(b.start), windowId: ids[0], blocks: ids.length === 2 ? 2 : 1, ignoreBookingId: b.id, ownerMode: true })) return stale();
    }
    for (const t of entry.blocks) {
      if (!t.before || t.after) continue; // only a block being put back can clash
      const { date, windowId } = t.before;
      if (occupiedBy(draft, date, windowId)) return stale();
      if (draft.blocks.some((k) => k.date === date && k.windowId === windowId)) return stale(); // blocked again since
    }

    restoreRecords(draft.bookings, entry.bookings);
    restoreRecords(draft.messages, entry.messages);
    restoreRecords(draft.blocks, entry.blocks);
    restoreRecords(draft.settings.daysOff, entry.daysOff);
    for (const t of entry.quotes) {
      if (t.before === null) delete draft.quotes[t.id];
      else draft.quotes[t.id] = clone(t.before);
    }
    for (const t of entry.settings) setPath(draft.settings, t.path, t.before === null ? null : clone(t.before));
    for (const t of entry.fullDays) {
      const has = draft.settings.fullDays.includes(t.date);
      if (t.before && !has) draft.settings.fullDays = [...draft.settings.fullDays, t.date].sort();
      if (!t.before && has) draft.settings.fullDays = draft.settings.fullDays.filter((d) => d !== t.date);
    }
    draft.messages.sort((a, b) => a.seq - b.seq);
    tokens.delete(token);
    return { ok: true };
  });
}
