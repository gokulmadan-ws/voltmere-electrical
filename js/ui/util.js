// js/ui/util.js: small shared helpers (cx, uid, copyText, pageHref, pageTarget, focusTitle).
// Owner: WP2
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

/** Named tab so cross-page links reuse two tabs instead of opening a new one each tap (16.1). */
export function pageTarget(file) {
  return file === 'dashboard.html' ? 'vm-dashboard' : 'vm-site';
}

/** Move focus to the screen title (dashboard views render one h1 with this test id). */
export function focusTitle() {
  const el = document.querySelector('[data-testid="view-title"]');
  if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  return !!el;
}
