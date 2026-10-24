// js/booking/draft.js: sessionStorage draft of the in-progress customer booking (13.2.1, key vm_draft_v1).
// Owner: WP3
import { STORAGE_KEYS } from '../core/config.js';

const TEXT_FIELDS = ['serviceId', 'variantId', 'date', 'name', 'phone', 'postcode', 'line1', 'note'];

/** The saved draft or null. Every read is guarded: sessionStorage can throw or be missing (private modes). */
export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.draft);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const out = {};
    for (const key of TEXT_FIELDS) out[key] = typeof data[key] === 'string' ? data[key] : '';
    out.windowId = Number.isInteger(data.windowId) ? data.windowId : null;
    out.reasons = Array.isArray(data.reasons) ? data.reasons.filter((r) => typeof r === 'string') : [];
    return out;
  } catch (e) {
    return null;
  }
}

/** Replace the draft with `draft` (same keys as loadDraft returns). */
export function saveDraft(draft) {
  try {
    sessionStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
  } catch (e) { /* storage blocked: the draft is a convenience only */ }
}

export function clearDraft() {
  try { sessionStorage.removeItem(STORAGE_KEYS.draft); } catch (e) { /* ignore */ }
}
