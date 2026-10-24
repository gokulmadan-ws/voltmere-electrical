// js/core/store.js: the persisted store (localStorage with memory fallback), every mutation, cross-tab sync and undo
// Owner: WP1
import {
  EMERGENCY_REASONS, HALF_DAY_STARTS, KIND_LABELS, PAID_METHODS, PROMISES, SCHEMA_VERSION, SOURCES, STORAGE_KEYS, WINDOWS, makeDefaultSettings
} from './config.js';
import { now, nowStamp, todayKey } from './clock.js';
import { addDays, addMinutes, isDayKey, makeStamp, stampDay } from './dates.js';
import { bookingWindowIds, bookingWhen, isSlotFree, nextFreeSlot, nextFreeSlots, occupiedBy } from './availability.js';
import {
  makeId, normaliseDemoPhone, normalisePhone, normalisePostcode, postcodeZone,
  validateLine1, validateName, validatePhone, validatePostcode
} from './format.js';
import { buildMessage, messageIsScheduled, reminderSendAt } from './messages.js';
import { buildSeed, SIM_POOL } from './seed.js';
import { isWithinChangeCutoff, quotedPriceFor } from './selectors.js';

// ---------- module state ----------

let state = null; // the current frozen State
let storage = null; // StorageLike while persisting, else null (memory mode)
let mode = 'memory';
let lastRaw = null; // the raw JSON this page last read or wrote
let listenersInstalled = false;
const subscribers = new Set();
const tokens = new Map(); // undo tokens live in memory only (max 20)
const MAX_TOKENS = 20;
const MIGRATIONS = {}; // none yet: a missing migration discards the (demo) data and reseeds

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
    && Number.isFinite(st.refSeq) && typeof st.seededFor === 'string';
}

/** Parse + migrate + validate. Returns a State or null (garbage, newer schema, missing migration). */
function parseState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Number.isInteger(parsed.v) || parsed.v > SCHEMA_VERSION) return null;
  while (parsed.v < SCHEMA_VERSION) {
    const step = MIGRATIONS[parsed.v];
    if (!step) return null;
    parsed = step(parsed);
  }
  return looksValid(parsed) ? parsed : null;
}

function persist(st) {
  const json = JSON.stringify(st);
  if (mode === 'local' && storage) {
    try {
      storage.setItem(STORAGE_KEYS.state, json);
    } catch (e) {
      mode = 'memory'; // quota or a blocked write: carry on in memory for the rest of the page's life
    }
  }
  lastRaw = json;
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
  return {
    v: SCHEMA_VERSION,
    seededFor: todayKey(),
    refSeq: seed.refSeq,
    settings,
    bookings: seed.bookings,
    blocks: seed.blocks,
    messages: seed.messages,
    meta: { rev: 1, msgSeq: top, messagesSeenSeq: top, simCursor: 0 }
  };
}

/** 8.7.3: swap the seed records for a fresh seed relative to today, keeping everything the owner or a customer made. */
function rollover(st) {
  const today = todayKey();
  const next = clone(st);
  next.settings.daysOff = next.settings.daysOff.filter((d) => d.date >= today);
  next.settings.fullDays = next.settings.fullDays.filter((d) => d >= today);
  const keepBookings = next.bookings.filter((b) => !b.seed);
  const keepBlocks = next.blocks.filter((b) => !b.seed);
  const keepMessages = next.messages.filter((m) => !m.seed);
  const seed = buildSeed(now(), next.settings, { bookings: keepBookings, blocks: keepBlocks });
  const base = next.meta.msgSeq;
  const seedMessages = seed.messages.map((m) => ({ ...m, seq: m.seq + base }));
  next.bookings = [...seed.bookings, ...keepBookings];
  next.blocks = [...seed.blocks, ...keepBlocks];
  next.messages = [...seedMessages, ...keepMessages].sort((a, b) => a.seq - b.seq);
  next.refSeq = Math.max(next.refSeq, seed.refSeq);
  next.seededFor = today;
  next.meta.msgSeq = base + seed.messages.length;
  next.meta.rev += 1;
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
  const candidate = opts.storage || defaultStorage();
  storage = candidate && canWrite(candidate) ? candidate : null;
  mode = storage ? 'local' : 'memory';

  let loaded = null;
  let raw = null;
  if (candidate) {
    try {
      raw = candidate.getItem(STORAGE_KEYS.state);
    } catch (e) {
      raw = null;
    }
    loaded = raw ? parseState(raw) : null;
  }

  let next;
  let dirty = false;
  if (loaded) {
    if (loaded.seededFor !== todayKey()) {
      next = rollover(loaded);
      dirty = true;
    } else {
      next = loaded;
      lastRaw = raw;
    }
  } else {
    next = freshState(readTheme(candidate));
    dirty = true;
  }
  state = deepFreeze(next);
  if (dirty) persist(state);
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
  const next = parseState(raw);
  if (!next) return false; // somebody wrote garbage: keep what we have
  lastRaw = raw;
  const prev = state;
  state = deepFreeze(next);
  notify(prev);
  return true;
}

// ---------- mutation plumbing ----------

const noop = (result) => ({ ...result, __noop: true });

/**
 * The read-modify-write. fn(draft, prev) works on a deep copy and returns a result; on `ok: false` nothing is
 * written. A result may carry `touched` (ids to snapshot for undo), which becomes `undoToken`.
 */
function mutate(fn) {
  initStore();
  syncFromStorage();
  const prev = state;
  const draft = clone(prev);
  const result = fn(draft, prev);
  if (!result || result.ok === false) return result;
  const { __noop: skipWrite, touched, ...rest } = result;
  if (skipWrite) return rest;
  draft.meta.rev += 1;
  const token = touched ? makeToken(prev, draft, touched) : null;
  persist(draft);
  state = deepFreeze(draft);
  if (touched) rest.undoToken = token;
  notify(prev);
  return rest;
}

const findById = (list, id) => list.find((r) => r.id === id) || null;

// One undo entry per touched record: what it looked like before, what the mutation left, and where it sat in its list.
function snapshotOf(prevList, nextList, id) {
  return { id, before: findById(prevList, id), after: findById(nextList, id), index: prevList.findIndex((r) => r.id === id) };
}

function makeToken(prev, next, touched) {
  const entry = { bookings: [], messages: [], blocks: [], daysOff: [], fullDays: [] };
  for (const id of touched.bookings || []) entry.bookings.push(snapshotOf(prev.bookings, next.bookings, id));
  for (const id of touched.messages || []) entry.messages.push(snapshotOf(prev.messages, next.messages, id));
  for (const id of touched.blocks || []) entry.blocks.push(snapshotOf(prev.blocks, next.blocks, id));
  for (const id of touched.daysOff || []) entry.daysOff.push(snapshotOf(prev.settings.daysOff, next.settings.daysOff, id));
  for (const date of touched.fullDays || []) {
    entry.fullDays.push({ date, before: prev.settings.fullDays.includes(date), after: next.settings.fullDays.includes(date) });
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

function createBookingIn(draft, input) {
  const d = input || {};
  const settings = draft.settings;
  const urgent = !!d.urgent;
  const asOwner = !!d.asOwner;
  const cust = d.customer || {};
  const addr = d.address || {};
  const name = String(cust.name === undefined || cust.name === null ? '' : cust.name).trim().slice(0, 60);
  const notes = String(d.notes === undefined || d.notes === null ? '' : d.notes).trim().slice(0, 300);
  const serviceId = urgent ? 'emergency' : d.serviceId;
  const service = settings.services.find((s) => s.id === serviceId) || null;

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
    const line1Error = validateLine1(addr.line1);
    if (line1Error) errors.line1 = line1Error;
    if (!isDayKey(d.date)) errors.date = 'Choose a day';
    if (!Number.isInteger(d.windowId) || d.windowId < 0 || d.windowId > 3) errors.windowId = 'Choose a time';
    else if (service && service.blocks === 2 && !HALF_DAY_STARTS.includes(d.windowId)) errors.windowId = 'Choose morning or afternoon';
  }
  const reasons = urgent
    ? [...new Set((Array.isArray(d.emergencyReasons) ? d.emergencyReasons : []).filter((id) => EMERGENCY_REASONS.some((r) => r.id === id)))]
    : [];
  if (urgent && reasons.length === 0) errors.emergencyReasons = 'Choose what is happening';
  if (Object.keys(errors).length) return fail('invalid', { errors });

  if (!service || !service.active) return fail('service_unavailable');
  if (urgent && !settings.takingEmergencies) return fail('emergencies_off');

  const blocks = urgent ? 0 : service.blocks === 2 ? 2 : 1;
  if (!urgent && !isSlotFree(draft, { date: d.date, windowId: d.windowId, blocks, ownerMode: asOwner })) {
    return fail('slot_taken', { alternatives: nextFreeSlots(draft, service.id, 3, { ownerMode: asOwner }) });
  }

  const created = nowStamp();
  let variant = null;
  if (service.priceType === 'by_size') {
    variant = service.variants.find((v) => v.id === d.variantId) || service.variants.find((v) => v.id === service.defaultVariantId) || null;
  }
  let refNumber = draft.refSeq;
  while (draft.bookings.some((b) => b.ref === `VM-${refNumber}`)) refNumber += 1;
  draft.refSeq = refNumber + 1;
  let id = makeId('bk');
  while (draft.bookings.some((b) => b.id === id)) id = makeId('bk');

  const ownerPrice = asOwner && Number.isFinite(d.quotedPrice) && d.quotedPrice >= 0 ? Math.round(d.quotedPrice) : null;
  const zone = postcodeZone(addr.postcode, settings.business);
  const status = urgent ? 'new' : asOwner ? 'confirmed' : settings.autoConfirm && zone === 'covered' ? 'confirmed' : 'new';
  // CONTRACT-GAP: an owner-entered booking with no source is a phone booking (the owner's most common entry).
  const source = SOURCES.includes(d.source) ? d.source : asOwner ? 'phone' : 'website';
  const booking = {
    id,
    ref: `VM-${refNumber}`,
    createdAt: created,
    serviceId: service.id,
    serviceName: service.name,
    variantId: variant ? variant.id : null,
    variantLabel: variant ? variant.label : '',
    start: urgent ? created : makeStamp(d.date, WINDOWS[d.windowId].start),
    durationMin: urgent ? 0 : blocks * 120,
    status,
    urgent,
    emergencyReasons: reasons,
    etaMinutes: null,
    etaAt: null,
    customer: { name, phone: normalisePhone(cust.phone), email: String(cust.email === undefined || cust.email === null ? '' : cust.email).trim() },
    address: { line1: String(addr.line1 === undefined || addr.line1 === null ? '' : addr.line1).trim(), postcode: normalisePostcode(addr.postcode) },
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
  addHistory(booking, 'created', asOwner ? 'owner' : 'customer', source);
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
  return { ok: true, booking, messages };
}

/** Create a booking (customer or owner). Validates and re-checks the slot inside the read-modify-write. */
export function createBooking(draftInput) {
  return mutate((draft) => createBookingIn(draft, draftInput));
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
    b.status = 'confirmed';
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
    const blocks = b.durationMin >= 240 ? 2 : 1;
    const errors = {};
    if (!isDayKey(date)) errors.date = 'Choose a day';
    if (!Number.isInteger(windowId) || windowId < 0 || windowId > 3) errors.windowId = 'Choose a time';
    else if (blocks === 2 && !HALF_DAY_STARTS.includes(windowId)) errors.windowId = 'Choose morning or afternoon';
    if (Object.keys(errors).length) return fail('invalid', { errors });
    if (!isSlotFree(draft, { date, windowId, blocks, ignoreBookingId: b.id, ownerMode: owner })) {
      return fail('slot_taken', { alternatives: nextFreeSlots(draft, b.serviceId, 3, { ownerMode: owner, ignoreBookingId: b.id }) });
    }
    const oldWhen = bookingWhen(b);
    b.start = makeStamp(date, WINDOWS[windowId].start);
    const newWhen = bookingWhen(b);
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

const QUICK_KINDS = ['customer_running_late', 'customer_need_access', 'customer_quote_ready'];

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

export function updateSettings(patch = {}) {
  return mutate((draft) => {
    const errors = {};
    const next = {};
    const biz = patch.business;
    const nextBiz = {};
    if (biz && typeof biz === 'object') {
      for (const key of REQUIRED_BUSINESS) {
        if (!(key in biz)) continue;
        const text = String(biz[key] === null || biz[key] === undefined ? '' : biz[key]).trim();
        if (text) nextBiz[key] = text;
        else errors[key] = "This can't be empty.";
      }
      if ('phone' in biz) {
        const phone = normalisePhone(biz.phone);
        if (phone) nextBiz.phone = phone;
        else errors.phone = 'Enter a UK mobile like 07700 900412';
      }
      for (const key of TEXT_BUSINESS) {
        if (key in biz) nextBiz[key] = String(biz[key] === null || biz[key] === undefined ? '' : biz[key]).trim();
      }
      for (const key of ['towns', 'coveredOutward', 'edgeOutward']) {
        if (Array.isArray(biz[key])) nextBiz[key] = biz[key].map((t) => String(t).trim()).filter(Boolean);
      }
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
      // Keep "Dan Mercer" coherent when only the first name is edited: swap the first word.
      const rest = s.business.ownerFullName.trim().split(/\s+/).slice(1).join(' ');
      nextBiz.ownerFullName = rest ? `${nextBiz.ownerFirstName} ${rest}` : nextBiz.ownerFirstName;
    }
    Object.assign(s.business, nextBiz);
    Object.assign(s, next);
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
    if (keepSettings) {
      settings = draft.settings;
      settings.daysOff = [];
      settings.fullDays = [];
    } else {
      settings = makeDefaultSettings();
      settings.theme = draft.settings.theme;
      settings.demoPhoneDigits = draft.settings.demoPhoneDigits;
    }
    const seed = buildSeed(now(), settings);
    const top = maxSeq(seed.messages);
    draft.settings = settings;
    draft.bookings = seed.bookings;
    draft.blocks = seed.blocks;
    draft.messages = seed.messages;
    draft.refSeq = seed.refSeq;
    draft.seededFor = todayKey();
    draft.meta.msgSeq = top;
    draft.meta.messagesSeenSeq = top;
    draft.meta.simCursor = 0;
    tokens.clear();
    return { ok: true };
  });
}

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
      const slot = nextFreeSlot(draft, 'fault');
      if (!slot) return fail('slot_taken');
      // An edge-zone postcode forces the "needs your OK" path.
      input = { ...base, serviceId: 'fault', date: slot.date, windowId: slot.windowId, address: { ...base.address, postcode: kind === 'approval' ? 'MB11 5HD' : person.postcode } };
    }
    const result = createBookingIn(draft, input);
    if (result.ok) draft.meta.simCursor += 1;
    return result;
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
