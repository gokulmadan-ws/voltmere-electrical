// js/ui/util.js: small shared helpers (cx, uid, copyText, saveFile, failureMessage, pageHref, pageTarget, focusTitle).
// Owner: B3 (was WP2)
import { clockQuery } from '../core/clock.js';

/** Join the truthy class names; accepts strings, falsy values and nested arrays. */
export function cx(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (Array.isArray(p)) { const inner = cx(...p); if (inner) out.push(inner); } else out.push(String(p));
  }
  return out.join(' ');
}

let uidCounter = 0;
/** Counter-based id, unique per page load. There is no useId in the vendored Preact. */
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

/** Copy text to the clipboard. Resolves true on success. Falls back to a hidden textarea. */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) { /* fall through to the textarea route */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}

/** Cross-page link: the file name plus the ?now= clock override when present, then the hash. */
export function pageHref(file, hash = '') {
  return file + clockQuery() + hash;
}

/** Named tab so cross-page links reuse a tab per page instead of opening a new one each tap (16.1). */
export function pageTarget(file) {
  if (file === 'dashboard.html') return 'vm-dashboard';
  if (file === 'quote.html') return 'vm-quote';
  return 'vm-site';
}

/**
 * Offer a file to save (a Blob behind a temporary <a download>). `content` is a string or a Blob.
 * Returns true when the download was started; nothing is sent anywhere.
 */
export function saveFile(filename, content, mime = 'text/plain') {
  try {
    const blob = content instanceof Blob ? content : new Blob([String(content ?? '')], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) {
    return false;
  }
}

/** Move focus to the screen title (dashboard views render one h1 with this test id). */
export function focusTitle() {
  const el = document.querySelector('[data-testid="view-title"]');
  if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  return !!el;
}

const REASON_TEXT = {
  storage_full: 'This device has no room left to save that. Free some space and try again.',
  bad_code: 'That code is not right. Check it and try again.',
  not_found: 'That no longer exists. Reload the page and try again.',
  not_connected: 'Connect it first, then try again.',
  disabled: 'That is switched off at the moment.',
  no_email: 'There is no email address for this customer.',
  expired: 'That has expired.',
  already_accepted: 'That has already been accepted.',
  slot_taken: 'That time has just been taken. Pick another.',
  bad_transition: 'That cannot be done in its current state. Reload and check.',
  too_many: 'That is more than can be saved.',
  invalid: 'Please check the details and try again.'
};

/**
 * Plain-language text for a failed store call ({ ok: false, reason, errors? }): the first field error when there is one,
 * else a sentence for the reason, else `fallback`. Returns '' for a result that did not fail.
 */
export function failureMessage(res, fallback = 'That did not work. Please try again.') {
  if (!res || res.ok !== false) return '';
  if (res.errors && typeof res.errors === 'object') {
    const first = Object.values(res.errors).find((v) => typeof v === 'string' && v);
    if (first) return first;
  }
  return REASON_TEXT[res.reason] || fallback;
}
