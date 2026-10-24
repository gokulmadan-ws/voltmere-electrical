// js/core/connections.js: pure helpers for the SIMULATED connections (hostnames, DNS records, patch validation, settling, summary)
// Owner: A3 core
import { CONNECTION_KEYS, CONNECTION_LABELS, DOMAIN_TARGETS, DOMAIN_VERIFY_SECONDS, TEMPLATE_APPROVAL_SECONDS } from './config.js';
import { nowStamp } from './clock.js';
import { addDays, secondsBetween, weekdayOf } from './dates.js';
import { occupiedBy } from './availability.js';
import { normalisePhone, toWaDigits } from './format.js';

// ---------- small validators ----------

export function isValidEmail(input) {
  const text = String(input === null || input === undefined ? '' : input).trim();
  return text.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text);
}

const DOMAIN_MESSAGE = 'Enter a website address like www.180electrical.co.uk';
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** { ok, host, message }: the cleaned hostname (no protocol, path, port or trailing dot) or the reason it is not one. */
export function validateHostname(input) {
  let text = String(input === null || input === undefined ? '' : input).trim().toLowerCase();
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  text = text.split(/[/?#]/)[0].replace(/\.$/, '');
  if (!text) return { ok: false, host: '', message: DOMAIN_MESSAGE };
  if (text.includes(':') || text.includes('@') || text.length > 253) return { ok: false, host: '', message: DOMAIN_MESSAGE };
  const labels = text.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false, host: '', message: DOMAIN_MESSAGE };
  if (!/^[a-z]{2,24}$/.test(labels[labels.length - 1])) return { ok: false, host: '', message: DOMAIN_MESSAGE };
  return { ok: true, host: text, message: '' };
}

const TWO_LEVEL_SUFFIXES = new Set(['co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'gov.uk', 'ac.uk', 'sch.uk']);

/**
 * The DNS records the owner would add at his registrar, using the FICTIONAL targets of DOMAIN_TARGETS.
 * A subdomain (www.x.co.uk) gets one CNAME. A bare domain (x.co.uk) gets an A record and a www CNAME.
 */
export function domainRecords(domain) {
  const check = validateHostname(domain);
  if (!check.ok) return [];
  const labels = check.host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const registrable = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  const ttl = 3600;
  if (labels.length <= registrable) {
    return [
      { type: 'A', host: '@', value: DOMAIN_TARGETS.a, ttl },
      { type: 'CNAME', host: 'www', value: DOMAIN_TARGETS.cname, ttl }
    ];
  }
  return [{ type: 'CNAME', host: labels.slice(0, labels.length - registrable).join('.'), value: DOMAIN_TARGETS.cname, ttl }];
}

/** The JSON a real funnel would POST for a new enquiry: SAMPLE values, shown on the Webhook screen. */
export function webhookSamplePayload(state) {
  const stamp = nowStamp();
  const url = state && state.settings && state.settings.connections && state.settings.connections.webhook ? state.settings.connections.webhook.url : '';
  return {
    event: 'enquiry.created',
    id: 'enq_sample_0001',
    createdAt: stamp,
    source: 'website',
    webhook: url,
    customer: { name: 'Sample Customer', phone: '07700 900123', email: 'sample@example.com' },
    answers: { postcode: 'BT9 6QP', parking: 'driveway', vehicle: 'ordered', timing: 'asap', permission: 'yes', marketingOptIn: false },
    utm: { source: 'facebook', medium: 'paid_social', campaign: 'ev_chargers_autumn' },
    notes: 'Sample values only.'
  };
}

// ---------- patches for setConnection ----------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isBool = (v) => typeof v === 'boolean';

function text(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

/** A UK mobile or an international number -> '+<digits>', else ''. */
export function normaliseWhatsAppNumber(input) {
  const raw = text(input);
  if (!raw || /[A-Za-z]/.test(raw)) return '';
  const uk = normalisePhone(raw);
  if (uk) return `+${toWaDigits(uk)}`;
  const compact = raw.replace(/[\s\-().]/g, '');
  if (!/^(\+|00)\d+$/.test(compact)) return '';
  const digits = compact.replace(/^\+|^00/, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
}

/**
 * Validate a setConnection patch. Returns { errors, changes } where `changes` holds only the fields that may be patched for
 * `key` (everything else is ignored). `current` is the stored connection (some rules depend on it).
 */
export function validateConnectionPatch(key, patch, current) {
  const errors = {};
  const changes = {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
  if (key === 'whatsapp') {
    if (has('displayName')) {
      const v = text(p.displayName);
      if (v.length < 1 || v.length > 40) errors.displayName = 'Enter a name up to 40 characters.';
      else changes.displayName = v;
    }
    for (const f of ['ownerAlerts', 'customerUpdates']) if (has(f)) isBool(p[f]) ? (changes[f] = p[f]) : (errors[f] = 'Choose on or off.');
    if (has('quietHours')) {
      const q = p.quietHours;
      if (q && isBool(q.on) && HHMM.test(String(q.from)) && HHMM.test(String(q.to))) changes.quietHours = { on: q.on, from: q.from, to: q.to };
      else errors.quietHours = 'Choose the quiet hours as times like 21:00 and 08:00.';
    }
    if (has('number')) {
      const n = normaliseWhatsAppNumber(p.number);
      if (n) changes.number = n;
      else errors.number = 'Enter the WhatsApp number, like 07885 496800';
    }
    if (has('status')) {
      if (p.status === 'verifying') {
        const number = changes.number || (current && current.number) || '';
        if (current && current.status !== 'disconnected') errors.status = 'Disconnect first to start again.';
        else if (!number) errors.number = 'Enter the WhatsApp number, like 07885 496800';
        else changes.status = 'verifying';
      } else if (p.status === 'disconnected') {
        if (current && current.status === 'verifying') changes.status = 'disconnected';
        else errors.status = 'Use disconnect to remove a connected number.';
      } else {
        errors.status = 'Use the connect steps to link WhatsApp.';
      }
    }
  } else if (key === 'calendar') {
    if (has('calendarName')) {
      const v = text(p.calendarName);
      if (v.length < 1 || v.length > 60) errors.calendarName = 'Enter a calendar name up to 60 characters.';
      else changes.calendarName = v;
    }
    for (const f of ['twoWay', 'addJobs']) if (has(f)) isBool(p[f]) ? (changes[f] = p[f]) : (errors[f] = 'Choose on or off.');
  } else if (key === 'email') {
    if (has('sendFrom')) {
      const v = text(p.sendFrom);
      if (isValidEmail(v)) changes.sendFrom = v;
      else errors.sendFrom = 'Enter an email address like daniel@180electrical.co.uk';
    }
    for (const f of ['confirmations', 'quotes']) if (has(f)) isBool(p[f]) ? (changes[f] = p[f]) : (errors[f] = 'Choose on or off.');
  } else if (key === 'webhook') {
    if (has('enabled')) isBool(p.enabled) ? (changes.enabled = p.enabled) : (errors.enabled = 'Choose on or off.');
  } else if (key === 'tracking') {
    if (has('metaPixelId')) {
      const v = text(p.metaPixelId);
      if (v === '' || /^\d{8,20}$/.test(v)) changes.metaPixelId = v;
      else errors.metaPixelId = 'A Meta Pixel ID is 8 to 20 digits.';
    }
    if (has('googleTagId')) {
      const v = text(p.googleTagId).toUpperCase();
      if (v === '' || /^(G|GT|AW|GTM)-[A-Z0-9]{4,12}$/.test(v)) changes.googleTagId = v;
      else errors.googleTagId = 'A Google tag ID looks like G-ABCD1234 or GTM-ABCD12.';
    }
    if (has('consentNote')) isBool(p.consentNote) ? (changes.consentNote = p.consentNote) : (errors.consentNote = 'Choose on or off.');
  }
  return { errors, changes };
}

// ---------- time-based simulation ----------

/**
 * Apply every simulated delay that is due at `nowSecStr` and return the connections (the SAME object when nothing changed).
 * `force` lists what a real-time timer may complete early: 'templates' and/or 'domain'.
 */
export function settleConnectionsIn(connections, nowSecStr, { force = [] } = {}) {
  let next = connections;
  const wa = connections.whatsapp;
  if (wa && wa.templates && Object.values(wa.templates).includes('pending')) {
    const due = force.includes('templates') || !wa.templatesSubmittedAt || secondsBetween(wa.templatesSubmittedAt, nowSecStr) >= TEMPLATE_APPROVAL_SECONDS;
    if (due) {
      const templates = {};
      for (const [kind, status] of Object.entries(wa.templates)) templates[kind] = status === 'pending' ? 'approved' : status;
      next = { ...next, whatsapp: { ...wa, templates } };
    }
  }
  const d = connections.domain;
  if (d && d.status === 'verifying' && d.firstCheckAt) {
    const due = force.includes('domain') || secondsBetween(d.firstCheckAt, nowSecStr) >= DOMAIN_VERIFY_SECONDS;
    if (due) next = { ...next, domain: { ...d, status: 'live', verifiedAt: nowSecStr.slice(0, 16) } };
  }
  return next;
}

// ---------- the hub summary ----------

/** [{ key, title, status: 'connected'|'pending'|'off', label, detail, raw, href }] in CONNECTION_KEYS order. */
export function summariseConnections(connections, nowSecStr) {
  const c = settleConnectionsIn(connections, nowSecStr);
  const rows = {};
  const d = c.domain;
  if (d.status === 'live') rows.domain = ['connected', 'Connected', `${d.domain}, security certificate ready`, d.status];
  else if (d.status === 'verifying') rows.domain = ['pending', 'Checking', `${d.domain}: we cannot see your records yet`, d.status];
  else if (d.status === 'pending') rows.domain = ['pending', 'Waiting for DNS', `${d.domain}: add the records, then check`, d.status];
  else rows.domain = ['off', 'Not set up', 'Use your own address, such as www.180electrical.co.uk', d.status];

  const w = c.webhook;
  rows.webhook = w.enabled
    ? ['connected', 'On', w.lastEventAt ? `Last test event ${w.lastEventAt.replace('T', ' ')}` : 'No events yet. Send a test event to see an enquiry arrive.', 'enabled']
    : ['off', 'Paused', 'Enquiries from your funnel are not being passed on.', 'disabled'];

  const t = c.tracking;
  if (t.metaPixelId || t.googleTagId) {
    rows.tracking = ['connected', 'Tags set', `Meta Pixel ${t.metaPixelId || 'not set'}, Google tag ${t.googleTagId || 'not set'}`, 'set'];
  } else {
    rows.tracking = ['off', 'Not set up', 'Add your Meta Pixel or Google tag to see which ads bring enquiries.', 'none'];
  }

  const wa = c.whatsapp;
  const states = Object.values(wa.templates || {});
  const pendingTemplates = states.filter((s) => s === 'pending').length;
  const approvedTemplates = states.filter((s) => s === 'approved').length;
  if (wa.status === 'connected') {
    if (pendingTemplates > 0) rows.whatsapp = ['pending', 'Templates pending', `${wa.number}: ${pendingTemplates} message templates waiting for approval`, wa.status];
    else if (approvedTemplates < states.length) rows.whatsapp = ['pending', 'Finish setup', `${wa.number}: submit your message templates`, wa.status];
    else rows.whatsapp = ['connected', 'Connected', `${wa.displayName}, ${wa.number}, templates approved`, wa.status];
  } else if (wa.status === 'verifying') {
    rows.whatsapp = ['pending', 'Waiting for code', `${wa.number}: enter the code from WhatsApp`, wa.status];
  } else {
    rows.whatsapp = ['off', 'Not set up', 'Send alerts, quotes and updates from your WhatsApp Business number.', wa.status];
  }

  const cal = c.calendar;
  rows.calendar = cal.status === 'connected'
    ? ['connected', 'Connected', `${cal.account}, ${cal.twoWay ? 'busy times shown in your diary' : 'jobs added only'}`, cal.status]
    : ['off', 'Not set up', 'Show your busy times in the diary and add jobs to your calendar.', cal.status];

  const em = c.email;
  rows.email = em.status === 'connected'
    ? ['connected', 'Connected', `${em.account}, sending from ${em.sendFrom}`, em.status]
    : ['off', 'Not set up', 'Send confirmations and quotes from your own address.', em.status];

  return CONNECTION_KEYS.map((key) => {
    const [status, label, detail, raw] = rows[key];
    return { key, title: CONNECTION_LABELS[key], status, label, detail, raw, href: `#/connections/${key}` };
  });
}

// ---------- the simulated Google Calendar busy blocks ----------

export const GCAL_GROUP_ID = 'grp_gcal_sim';
export const GCAL_LABEL = 'Google Calendar';

// Where the pretend busy times fall: day offset from today and the windows tried on the first open day at or after it.
const GCAL_PLAN = [{ offset: 3, windows: [3] }, { offset: 6, windows: [0, 1] }, { offset: 9, windows: [2] }];

/**
 * A few busy blocks as they would arrive from Google Calendar (SIMULATED): free windows only, never on a day off, never on top of a
 * booking or an existing block. Deterministic for a given state and day.
 */
export function simulatedBusyBlocks(state, todayKeyStr) {
  const blocks = [];
  const taken = new Set((state.blocks || []).filter((b) => b.groupId !== GCAL_GROUP_ID).map((b) => `${b.date}|${b.windowId}`));
  const hours = state.settings.hours;
  for (const { offset, windows } of GCAL_PLAN) {
    for (let step = 0; step < 14; step += 1) {
      const date = addDays(todayKeyStr, offset + step);
      const open = hours[weekdayOf(date)] || [];
      const off = (state.settings.daysOff || []).some((x) => x.date === date);
      const usable = windows.filter((w) => open.includes(w) && !off && !taken.has(`${date}|${w}`) && !occupiedBy(state, date, w));
      if (usable.length === windows.length) {
        for (const windowId of windows) {
          taken.add(`${date}|${windowId}`);
          blocks.push({ id: `blk_gcal_${date}_${windowId}`, date, windowId, label: GCAL_LABEL, groupId: GCAL_GROUP_ID, seed: false, source: 'google_calendar' });
        }
        break;
      }
    }
  }
  return blocks;
}

