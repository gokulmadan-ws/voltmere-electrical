// js/core/utm.js: capture utm_source / utm_medium / utm_campaign (or ?src=) for the session and normalise lead sources
// Owner: A3 core
import { LEAD_SOURCES, STORAGE_KEYS } from './config.js';

// Session memory fallback for when sessionStorage is missing or throws (private modes, Node).
let memory = null;

const SOURCE_ALIASES = {
  facebook: 'facebook', fb: 'facebook', meta: 'facebook', 'facebook.com': 'facebook', 'm.facebook.com': 'facebook', 'l.facebook.com': 'facebook',
  instagram: 'instagram', ig: 'instagram', 'instagram.com': 'instagram',
  google: 'google', googleads: 'google', 'google-ads': 'google', adwords: 'google',
  referral: 'referral', ref: 'referral', friend: 'referral',
  phone: 'phone'
};

/** Any spelling of a source -> one of LEAD_SOURCES ('other' when unknown or empty). */
export function normaliseLeadSource(value) {
  const key = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  const hit = SOURCE_ALIASES[key];
  return hit && LEAD_SOURCES.includes(hit) ? hit : 'other';
}

function cleanText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[^A-Za-z0-9_\-.+/ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Validate a { source, medium, campaign } object (what createBooking applies to draft.utm).
 * Returns null when there is nothing usable; the source is always one of LEAD_SOURCES.
 */
export function normaliseUtm(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const rawSource = typeof input.source === 'string' ? input.source.trim() : '';
  const medium = cleanText(input.medium);
  const campaign = cleanText(input.campaign);
  if (!rawSource && !medium && !campaign) return null;
  return { source: normaliseLeadSource(rawSource), medium, campaign };
}

function sessionStore(opts) {
  if (opts && opts.storage) return opts.storage;
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch (e) {
    return null;
  }
}

function read(opts) {
  const s = sessionStore(opts);
  if (s) {
    try {
      const raw = s.getItem(STORAGE_KEYS.utm);
      if (raw) {
        const parsed = normaliseUtm(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch (e) {
      // fall through to memory
    }
  }
  return memory ? { ...memory } : null;
}

function write(value, opts) {
  memory = { ...value };
  const s = sessionStore(opts);
  if (!s) return;
  try {
    s.setItem(STORAGE_KEYS.utm, JSON.stringify(value));
  } catch (e) {
    // the memory copy is enough for this page
  }
}

/** The capture made earlier in this session, or null. */
export function getUtm(opts = {}) {
  return read(opts);
}

/** Forget the capture (tests, and "start again" in a demo). */
export function clearUtm(opts = {}) {
  memory = null;
  const s = sessionStore(opts);
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEYS.utm);
  } catch (e) {
    // nothing to do
  }
}

function defaultSearch() {
  try {
    return (globalThis.location && globalThis.location.search) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Read the utm parameters from a query string (default location.search) and keep them for the session.
 * An existing capture is never overwritten. Returns the capture in force, or null when there is none.
 */
export function captureUtm(search, opts = {}) {
  const existing = read(opts);
  if (existing) return existing;
  let params;
  try {
    params = new URLSearchParams(search === undefined || search === null ? defaultSearch() : String(search));
  } catch (e) {
    return null;
  }
  const source = params.get('utm_source') || params.get('src') || '';
  const found = normaliseUtm({ source, medium: params.get('utm_medium') || '', campaign: params.get('utm_campaign') || '' });
  if (!found) return null;
  write(found, opts);
  return { ...found };
}
