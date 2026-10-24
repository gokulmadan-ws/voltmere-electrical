// js/booking/draft.js: sessionStorage draft of the in-progress customer booking or quote funnel (key vm_draft_v1).
// Owner: WP3, extended by D2 (funnel step, answers, email, opt-in)
import { STORAGE_KEYS } from '../core/config.js';

const TEXT_FIELDS = ['serviceId', 'variantId', 'date', 'name', 'phone', 'postcode', 'line1', 'note', 'email'];
const ANSWER_KEYS = ['parking', 'vehicle', 'timing', 'permission'];

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
    out.step = Number.isInteger(data.step) && data.step >= 1 && data.step <= 6 ? data.step : 1;
    out.optIn = data.optIn === true;
    out.answers = {};
    if (data.answers && typeof data.answers === 'object') {
      for (const key of ANSWER_KEYS) if (typeof data.answers[key] === 'string') out.answers[key] = data.answers[key];
    }
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

/** Put a postcode (typed on the landing page) into the quote funnel's draft, ready for Step 1. */
export function prefillFunnelPostcode(postcode) {
  const pc = String(postcode === undefined || postcode === null ? '' : postcode).trim().slice(0, 8);
  if (!pc) return;
  const prev = loadDraft() || {};
  saveDraft({
    serviceId: 'ev_quote', variantId: '', date: '', windowId: null, name: prev.name || '', phone: prev.phone || '',
    postcode: pc, line1: '', note: prev.note || '', email: prev.email || '', reasons: [],
    step: 1, optIn: !!prev.optIn, answers: prev.answers || {}
  });
}
