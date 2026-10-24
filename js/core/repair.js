// js/core/repair.js: repairState(st), the second line of defence for a saved state that parses and has the right outline but is wrong deep inside
// (a null in the bookings list, a customer that is a number, a quote with no lines, a hand-edited or half-migrated save).
// Every entry the screens could not show is dropped, every field they read is given a usable type, and two bookings that carry the same
// reference are told apart. It never throws on a parsed object, mutates the object it is given, changes NOTHING in a clean state, and reports how
// many entries it dropped or fields it fixed.
// Owner: ROBUST (final gate). Pure: no storage, no clock reads (`today` is injected).
import { BUSINESS_TEXT_MAX, QUOTE_STATUSES, SOURCES, STATUSES, makeDefaultBusiness, makeDefaultConnections, makeDefaultSettings } from './config.js';
import { isDayKey } from './dates.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const STAMP = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const isStampStr = (v) => typeof v === 'string' && STAMP.test(v) && isDayKey(v.slice(0, 10));
const JPEG = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const REF = /^EL-(\d{3,9})$/;

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9; // a bound as well: 1e308 is finite, and counting up from it never ends
const inRange = (lo, hi) => (v) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isBool = (v) => typeof v === 'boolean';
const isStrList = (v) => Array.isArray(v) && v.every(isStr);
const strOrNull = (v) => v === null || isStr(v);
const stampOrNull = (v) => v === null || isStampStr(v);
const asText = (v, fallback = '') => (isStr(v) ? v : isNum(v) ? String(v) : fallback);

/**
 * Repair a parsed state in place. Returns `{ state, changes }` where `changes` counts the entries dropped and the fields fixed (0 for a clean state).
 * Call it on a state that already has the right outline (store.js looksValid): collections are arrays and objects, settings sub-objects exist.
 */
export function repairState(st, { today = '' } = {}) {
  let changes = 0;
  /** Make `o[k]` pass `ok`, else set it to `value` (or value()) and count one change. */
  const fix = (o, k, ok, value) => {
    if (ok(o[k])) return;
    o[k] = typeof value === 'function' ? value() : value;
    changes += 1;
  };
  const text = (o, k, fallback = '', max = 100000) => {
    if (isStr(o[k]) && o[k].length <= max) return;
    o[k] = isStr(o[k]) ? o[k].slice(0, max) : asText(o[k], fallback);
    changes += 1;
  };
  const keep = (list, fn) => {
    const out = [];
    for (const item of list) {
      const fixed = fn(item);
      if (fixed) out.push(fixed); else changes += 1;
    }
    return out;
  };
  const unique = (list, keyOf) => {
    const seen = new Set();
    return list.filter((x) => { const k = keyOf(x); if (seen.has(k)) { changes += 1; return false; } seen.add(k); return true; });
  };

  function repairBooking(b) {
    if (!isObj(b) || !isStr(b.id) || !b.id || b.id.length > 80 || !isStr(b.ref) || !b.ref || !isStampStr(b.start)) return null;
    fix(b, 'status', (v) => STATUSES.includes(v), 'new');
    for (const k of ['serviceId', 'serviceName', 'variantLabel', 'notes', 'internalNotes', 'cancelReason']) text(b, k);
    fix(b, 'variantId', strOrNull, null);
    fix(b, 'createdAt', isStampStr, b.start);
    fix(b, 'durationMin', inRange(0, 1440), 0);
    fix(b, 'urgent', isBool, !!b.urgent);
    fix(b, 'emergencyReasons', isStrList, () => (Array.isArray(b.emergencyReasons) ? b.emergencyReasons.filter(isStr) : []));
    fix(b, 'etaMinutes', (v) => v === null || Number.isInteger(v), null);
    fix(b, 'etaAt', stampOrNull, null);
    fix(b, 'customer', isObj, {});
    for (const k of ['name', 'phone', 'email']) text(b.customer, k, '', 300);
    fix(b, 'address', isObj, {});
    for (const k of ['line1', 'postcode']) text(b.address, k, '', 300);
    if (!Array.isArray(b.history) || !b.history.every((h) => isObj(h) && isStampStr(h.at) && isStr(h.event) && isStr(h.by))) {
      b.history = (Array.isArray(b.history) ? b.history : []).filter((h) => isObj(h) && isStampStr(h.at) && isStr(h.event)).map((h) => ({ ...h, by: asText(h.by, 'system') }));
      changes += 1;
    }
    fix(b, 'source', (v) => SOURCES.includes(v), 'website');
    fix(b, 'quotedPrice', (v) => v === null || (isNum(v) && v >= 0), 0);
    fix(b, 'finalPrice', (v) => v === null || isNum(v), null);
    fix(b, 'paid', isBool, false);
    fix(b, 'paidMethod', strOrNull, null);
    fix(b, 'paidAt', stampOrNull, null);
    fix(b, 'seenByOwner', isBool, true);
    fix(b, 'reviewRequested', isBool, false);
    fix(b, 'cancelledBy', strOrNull, null);
    fix(b, 'seed', isBool, false);
    if ('photos' in b) {
      const good = Array.isArray(b.photos) && b.photos.every((p) => isObj(p) && isStr(p.id) && isStr(p.name) && isStr(p.dataUrl) && JPEG.test(p.dataUrl));
      if (!good) {
        const photos = (Array.isArray(b.photos) ? b.photos : []).filter((p) => isObj(p) && isStr(p.id) && isStr(p.dataUrl) && JPEG.test(p.dataUrl)).map((p) => ({ ...p, name: asText(p.name, 'photo.jpg').slice(0, 60) }));
        if (photos.length) b.photos = photos; else delete b.photos;
        changes += 1;
      }
    }
    if ('answers' in b && !isObj(b.answers)) { delete b.answers; changes += 1; }
    if ('utm' in b && !isObj(b.utm)) { delete b.utm; changes += 1; }
    if ('tentative' in b) fix(b, 'tentative', isBool, false);
    return b;
  }

  function repairMessage(m) {
    if (!isObj(m) || !isStr(m.id) || !m.id || !isStampStr(m.at)) return null;
    for (const k of ['body', 'kind']) text(m, k);
    fix(m, 'to', isStr, 'customer');
    for (const k of ['toName', 'toPhone']) text(m, k, '', 300);
    fix(m, 'channel', (v) => v === 'whatsapp' || v === 'email', 'whatsapp');
    fix(m, 'sendAt', stampOrNull, null);
    fix(m, 'bookingId', strOrNull, null);
    fix(m, 'seq', inRange(0, 1e9), 0);
    fix(m, 'simulated', isBool, true);
    fix(m, 'seed', isBool, false);
    return m;
  }

  function repairBlock(b) {
    if (!isObj(b) || !isStr(b.id) || !b.id || !isDayKey(b.date) || !Number.isInteger(b.windowId) || b.windowId < 0 || b.windowId > 3) return null;
    text(b, 'label', 'Blocked', 300);
    fix(b, 'groupId', strOrNull, null);
    fix(b, 'seed', isBool, false);
    return b;
  }

  function repairQuote(key, q) {
    if (!isObj(q)) return null;
    fix(q, 'id', (v) => isStr(v) && !!v, key);
    for (const k of ['bookingId', 'customerName', 'brand']) text(q, k, '', 300);
    text(q, 'notes', '', 20000);
    fix(q, 'status', (v) => QUOTE_STATUSES.includes(v), 'draft');
    fix(q, 'createdAt', isStampStr, () => (isDayKey(today) ? `${today}T00:00` : '2026-01-01T00:00'));
    fix(q, 'validUntil', isDayKey, () => q.createdAt.slice(0, 10));
    for (const k of ['sentAt', 'viewedAt', 'acceptedAt', 'declinedAt']) fix(q, k, stampOrNull, null);
    fix(q, 'sentVia', strOrNull, null);
    text(q, 'declineReason', '', 2000);
    fix(q, 'installBookingId', strOrNull, null);
    fix(q, 'seed', isBool, false);
    const goodLines = Array.isArray(q.lines) && q.lines.every((l) => isObj(l) && isStr(l.id) && isStr(l.label) && isStr(l.detail) && isNum(l.qty) && isNum(l.unitPrice) && isBool(l.optional));
    if (!goodLines) {
      let n = 0;
      q.lines = (Array.isArray(q.lines) ? q.lines : []).filter((l) => isObj(l) && isNum(l.qty) && isNum(l.unitPrice)).map((l) => {
        n += 1;
        return { ...l, id: isStr(l.id) && l.id ? l.id : `ln_${q.id}_${n}`, label: asText(l.label, 'Item').slice(0, 200), detail: asText(l.detail).slice(0, 1000), optional: l.optional === true };
      });
      changes += 1;
    }
    return q;
  }

  function repairSettings(settings) {
    const base = makeDefaultSettings();
    const okHours = Array.isArray(settings.hours) && settings.hours.length === 7 && settings.hours.every((d) => Array.isArray(d) && d.every((w) => Number.isInteger(w) && w >= 0 && w <= 3));
    if (!okHours) { settings.hours = base.hours; changes += 1; }
    settings.daysOff = keep(settings.daysOff, (d) => (isObj(d) && isStr(d.id) && isDayKey(d.date) ? (text(d, 'label', 'Day off', 300), d) : null));
    settings.fullDays = keep(settings.fullDays, (d) => (isDayKey(d) ? d : null));
    settings.services = keep(settings.services, (s) => {
      if (!isObj(s) || !isStr(s.id) || !s.id) return null;
      text(s, 'name', s.id, 300);
      for (const k of ['description', 'priceNote', 'durationLabel', 'tag']) text(s, k, '', 2000);
      fix(s, 'icon', isStr, 'house');
      fix(s, 'priceType', isStr, 'free');
      fix(s, 'price', (v) => isNum(v) && v >= 0, 0);
      fix(s, 'variants', Array.isArray, []);
      if (!s.variants.every(isObj)) { s.variants = s.variants.filter(isObj); changes += 1; }
      fix(s, 'blocks', (v) => v === 0 || v === 1 || v === 2, 1);
      fix(s, 'durationMin', inRange(0, 1440), 120);
      fix(s, 'active', isBool, true);
      return s;
    });
    // the business: text stays text, lists stay lists, anything unusable falls back to his real defaults
    const def = makeDefaultBusiness();
    const biz = settings.business;
    for (const key of Object.keys(def)) {
      const d = def[key];
      if (isStr(d)) {
        if (!isStr(biz[key])) { biz[key] = asText(biz[key], d); changes += 1; }
        const max = BUSINESS_TEXT_MAX[key] || 300;
        if (biz[key].length > max) { biz[key] = biz[key].slice(0, max).trimEnd(); changes += 1; }
      }
      else if (Array.isArray(d)) { if (!isStrList(biz[key])) { biz[key] = Array.isArray(biz[key]) ? biz[key].filter(isStr) : d; changes += 1; } }
      else if (isObj(d)) { if (!isObj(biz[key])) { biz[key] = d; changes += 1; } }
    }
    fix(settings, 'leadMinutes', inRange(0, 100000), base.leadMinutes);
    fix(settings, 'maxDaysAhead', inRange(1, 730), base.maxDaysAhead);
    for (const k of ['autoConfirm', 'takingEmergencies', 'remindersOn']) fix(settings, k, isBool, base[k]);
    fix(settings, 'theme', (v) => v === 'auto' || v === 'light' || v === 'dark', base.theme);
    fix(settings, 'demoPhoneDigits', isStr, '');
    fix(settings, 'templates', isObj, base.templates);
    fix(settings.sla, 'replyHours', inRange(1, 1000), base.sla.replyHours);
    settings.marketing.adSpend = keep(settings.marketing.adSpend, (e) => (isObj(e) && isStr(e.id) && isStr(e.month) && isStr(e.channel) && isNum(e.amount) ? e : null));
    settings.quoteItems = keep(settings.quoteItems, (i) => {
      if (!isObj(i) || !isStr(i.id) || !i.id || !isNum(i.unitPrice)) return null;
      text(i, 'label', 'Item', 300);
      text(i, 'detail', '', 1000);
      fix(i, 'unit', (v) => v === 'each' || v === 'metre', 'each');
      fix(i, 'defaultQty', inRange(1, 999), 1);
      fix(i, 'kind', isStr, 'extra');
      fix(i, 'suggested', isBool, false);
      if ('optional' in i) fix(i, 'optional', isBool, false);
      return i;
    });
    const qd = settings.quoteDefaults;
    fix(qd, 'validDays', inRange(1, 3650), base.quoteDefaults.validDays);
    fix(qd, 'notes', isStr, base.quoteDefaults.notes);
    // connections: every field a wizard reads must exist with the type its default has (a null default is a stamp or nothing)
    const conform = (stored, def) => {
      for (const key of Object.keys(def)) {
        const d = def[key];
        const v = stored[key];
        if (isObj(d)) {
          if (!isObj(v)) { stored[key] = JSON.parse(JSON.stringify(d)); changes += 1; } else conform(v, d);
        } else if (Array.isArray(d)) {
          if (!Array.isArray(v)) { stored[key] = JSON.parse(JSON.stringify(d)); changes += 1; }
        } else if (d === null) {
          if (v !== null && !isStr(v)) { stored[key] = null; changes += 1; }
        } else if (typeof v !== typeof d || (typeof d === 'number' && !Number.isFinite(v))) {
          stored[key] = d; changes += 1;
        }
      }
    };
    const defConn = makeDefaultConnections();
    for (const key of Object.keys(defConn)) {
      if (!isObj(settings.connections[key])) { settings.connections[key] = defConn[key]; changes += 1; continue; }
      conform(settings.connections[key], defConn[key]);
    }
  }

  st.bookings = unique(keep(st.bookings, repairBooking), (b) => b.id);
  // the same ref twice (two tabs writing at once) is told apart: the later booking takes the next free number
  const refs = new Set();
  let maxRef = 0;
  for (const b of st.bookings) { const m = REF.exec(b.ref); if (m) maxRef = Math.max(maxRef, Number(m[1])); }
  if (!inRange(0, 99999999)(st.refSeq) || st.refSeq <= maxRef) { st.refSeq = Math.max(inRange(0, 99999999)(st.refSeq) ? st.refSeq : 0, maxRef + 1, 1000); changes += 1; }
  for (const b of st.bookings) {
    if (!refs.has(b.ref)) { refs.add(b.ref); continue; }
    let next = st.refSeq;
    while (refs.has(`EL-${next}`)) next += 1;
    b.ref = `EL-${next}`;
    refs.add(b.ref);
    st.refSeq = next + 1;
    changes += 1;
  }
  st.messages = unique(keep(st.messages, repairMessage), (m) => m.id);
  st.blocks = keep(st.blocks, repairBlock);
  const quotes = {};
  for (const [key, q] of Object.entries(st.quotes)) {
    const fixed = repairQuote(key, q);
    if (fixed && !quotes[fixed.id]) quotes[fixed.id] = fixed; else changes += 1;
  }
  st.quotes = quotes;
  repairSettings(st.settings);
  const top = st.messages.reduce((m, x) => Math.max(m, x.seq), 0);
  if (!inRange(0, 1e9)(st.meta.msgSeq) || st.meta.msgSeq < top) { st.meta.msgSeq = Math.max(inRange(0, 1e9)(st.meta.msgSeq) ? st.meta.msgSeq : 0, top); changes += 1; }
  fix(st.meta, 'messagesSeenSeq', (v) => inRange(0, 1e9)(v) && v <= st.meta.msgSeq, () => st.meta.msgSeq);
  fix(st.meta, 'simCursor', inRange(0, 1e9), 0);
  if ('writes' in st.meta && !isStrList(st.meta.writes)) { st.meta.writes = []; changes += 1; } // the journal of saves (store.js), never required
  return { state: st, changes };
}
