// js/quote/decline.js: the "Not for me" flow: an optional reason chip and note, then declineQuote.
// Owner: Q2 (customer quote page)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Banner, Button, Field, Sheet, Textarea, cx } from '../ui/index.js';
import { declineQuote } from '../core/store.js';
import { StepFocus } from './parts.js';

export const DECLINE_REASONS = [
  { id: 'price', label: 'Too expensive' },
  { id: 'other_installer', label: 'I found another installer' },
  { id: 'time', label: 'I need more time' },
  { id: 'plans', label: 'My plans have changed' },
  { id: 'other', label: 'Something else' }
];

/** The reason as the owner reads it: the chip, then the customer's own words after a colon. */
export function reasonText(reasonId, note) {
  const chip = DECLINE_REASONS.find((r) => r.id === reasonId);
  return [chip ? chip.label : '', String(note || '').trim()].filter(Boolean).join(': ').slice(0, 200);
}

function failureText(result, brand) {
  switch (result && result.reason) {
    case 'bad_transition':
    case 'not_found':
      return { close: true };
    case 'storage_full':
      return { text: `Your device has no room left to save this, so nothing was changed. Free up some space and try again, or call ${brand.ownerFirst}.` };
    default:
      return { text: `Something went wrong and nothing was changed. Please try again, or call ${brand.ownerFirst} on ${brand.phone}.` };
  }
}

/** The decline sheet. `onDeclined(result)` runs after the store has recorded it; `onClose()` just dismisses. */
export function DeclineFlow({ open, d, brand, onClose, onDeclined }) {
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const working = useRef(false);

  useEffect(() => {
    if (open) { setReasonId(''); setNote(''); setError(''); working.current = false; }
  }, [open]);

  const submit = () => {
    if (working.current) return;
    working.current = true;
    let result;
    try {
      result = declineQuote(d.quote.id, { reason: reasonText(reasonId, note), by: 'customer' });
    } catch (err) {
      console.error('declineQuote failed', err);
      result = { ok: false, reason: 'error' };
    }
    working.current = false;
    if (result && result.ok) { onDeclined(result); return; }
    const info = failureText(result, brand);
    if (info.close) { onClose(); return; }
    setError(info.text);
  };

  const footer = html`
    <div class="q2-sheet__actions q2-sheet__actions--even">
      <${Button} variant="primary" size="lg" block onClick=${onClose} data-testid="q2-decline-cancel">Keep my quote<//>
      <${Button} variant="secondary" size="lg" block onClick=${submit} data-testid="q2-decline-confirm">Decline quote<//>
    </div>`;

  return html`<${Sheet} open=${open} size="auto" title="Not for you?" onClose=${onClose} footer=${footer}
    initialFocus="[data-q2-focus]" testid="q2-decline-sheet">
    <${StepFocus} class="q2-sheet__lead">No problem. If you tell ${brand.ownerFirst} why, it helps him. You can also skip this.<//>
    <fieldset class="q2-reasons" data-testid="q2-reasons">
      <legend class="q2-reasons__legend">Why? <span class="q2-muted">(optional)</span></legend>
      <div class="q2-reasons__list">
        ${DECLINE_REASONS.map((r) => html`
          <label class=${cx('q2-reason', reasonId === r.id && 'is-selected')} key=${r.id} data-testid=${`q2-reason-${r.id}`}>
            <input class="q2-reason__input" type="radio" name="q2-reason" value=${r.id} checked=${reasonId === r.id} onChange=${() => setReasonId(r.id)} />
            <span>${r.label}</span>
          </label>`)}
      </div>
    </fieldset>
    <div class="q2-sheet__field">
      <${Field} label=${`Anything else you'd like ${brand.ownerFirst} to know? (optional)`} id="q2-decline-note">
        <${Textarea} id="q2-decline-note" rows=${3} value=${note} maxlength="140" onInput=${(e) => setNote(e.target.value)} data-testid="q2-reason-note" />
      <//>
    </div>
    ${error ? html`<${Banner} tone="danger" data-testid="q2-decline-problem">${error}<//>` : null}
  <//>`;
}
