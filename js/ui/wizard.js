// js/ui/wizard.js: Wizard, a stepper with progress, Back/Next, validation callbacks and focus management.
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { Button } from './button.js';
import { cx, failureMessage } from './util.js';

const GENERIC = 'That did not work. Please check this step and try again.';

/** Turn whatever validate() or onFinish() returned into an error message ('' means fine). */
function verdict(res) {
  if (res === undefined || res === null || res === true) return '';
  if (res === false) return GENERIC;
  if (typeof res === 'string') return res;
  if (typeof res === 'object') {
    if (res.ok === false) return res.message || failureMessage(res, GENERIC);
    return '';
  }
  return '';
}

/**
 * Multi-step flow. Steps hold content, the wizard holds the position (or the parent does, when `step` is passed).
 * steps: [{ id, title, hint, nextLabel, canNext, validate(ctx), content: vnode | (ctx) => vnode }]
 * onFinish() runs after the last step validates; true / { ok: true } completes, a string or { ok: false, message } stays.
 */
export function Wizard({
  title, steps = [], step, onStepChange, onFinish, finishLabel = 'Finish', onCancel,
  backLabel = 'Back', cancelLabel = 'Cancel', busy, testid = 'wizard', class: cls, ...rest
}) {
  const count = steps.length;
  const controlled = step !== undefined && step !== null;
  const [inner, setInner] = useState(0);
  const found = controlled ? steps.findIndex((s) => s.id === step) : inner;
  const index = Math.min(Math.max(found, 0), Math.max(count - 1, 0));
  const cur = steps[index];
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const rootRef = useRef(null);
  const headingRef = useRef(null);
  const errorRef = useRef(null);
  const alive = useRef(true);
  const prevIndex = useRef(index);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Focus management: every step change moves focus to the new heading and keeps the wizard in view.
  useEffect(() => {
    if (prevIndex.current === index) return;
    prevIndex.current = index;
    const root = rootRef.current;
    if (root) {
      const top = root.getBoundingClientRect().top;
      if (top < 64) { try { root.scrollIntoView({ block: 'start' }); } catch (e) { /* old browser */ } }
    }
    if (headingRef.current) { try { headingRef.current.focus({ preventScroll: true }); } catch (e) { headingRef.current.focus(); } }
  }, [index]);

  if (!cur) return null;
  const isFirst = index === 0;
  const isLast = index === count - 1;

  const goTo = (target) => {
    const i = typeof target === 'number' ? target : steps.findIndex((s) => s.id === target);
    if (i < 0 || i >= count || i === index) return;
    setError('');
    if (!controlled) setInner(i);
    if (onStepChange) onStepChange(steps[i].id, i);
  };

  const ctx = {
    id: cur.id, index, count, busy: !!(busy || working),
    next: () => goTo(index + 1), back: () => goTo(index - 1), goTo, setError
  };

  const showError = (message) => {
    setError(message);
    // Put the cursor where the problem is: the first invalid field in this step, else the alert itself.
    setTimeout(() => {
      const root = rootRef.current;
      const bad = root && root.querySelector('.ui-wizard__panel [aria-invalid="true"]');
      const target = bad || errorRef.current;
      if (target) { try { target.focus({ preventScroll: false }); } catch (e) { /* not focusable */ } }
    }, 30);
  };

  const next = async () => {
    if (working || busy) return;
    if (cur.canNext === false) return;
    setError('');
    setWorking(true);
    let res = true;
    try { res = cur.validate ? await cur.validate(ctx) : true; } catch (e) { res = GENERIC; }
    if (!alive.current) return;
    const message = verdict(res);
    if (message) { setWorking(false); showError(message); return; }
    if (!isLast) { setWorking(false); goTo(index + 1); return; }
    let done = true;
    try { done = onFinish ? await onFinish(ctx) : true; } catch (e) { done = GENERIC; }
    if (!alive.current) return;
    setWorking(false);
    const failed = verdict(done);
    if (failed) showError(failed);
  };

  const back = () => {
    if (working || busy) return;
    if (isFirst) { if (onCancel) onCancel(); return; }
    goTo(index - 1);
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
    const el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (/^(checkbox|radio|button|submit|range|file)$/i.test(el.type)) return;
    e.preventDefault();
    next();
  };

  const body = typeof cur.content === 'function' ? cur.content(ctx) : cur.content;
  const pct = Math.round(((index + 1) / count) * 100);
  const stepText = `Step ${index + 1} of ${count}`;
  const loading = !!(working || busy);
  const showBack = !isFirst || !!onCancel;

  return html`<section class=${cx('ui-wizard', cls)} ref=${rootRef} aria-label=${title || 'Set-up steps'} data-testid=${testid} onKeyDown=${onKeyDown} ...${rest}>
    <div class="ui-wizard__head">
      <p class="ui-wizard__count" data-testid=${`${testid}-count`}>${title ? html`<span class="ui-wizard__title">${title}</span><span class="ui-wizard__dot" aria-hidden="true"> · </span>` : null}<span>${stepText}</span></p>
      <div class="ui-wizard__bar" role="progressbar" aria-label=${title ? `${title} progress` : 'Progress'} aria-valuemin="1" aria-valuemax=${count} aria-valuenow=${index + 1} aria-valuetext=${`${stepText}: ${cur.title}`} data-testid=${`${testid}-progress`}>
        <span class="ui-wizard__fill" style=${{ '--p': pct / 100 }}></span>
      </div>
      <ol class="ui-wizard__steps" aria-hidden="true">
        ${steps.map((s, i) => html`<li key=${s.id} class=${cx('ui-wizard__step', i < index && 'is-done', i === index && 'is-current')}>
          <span class="ui-wizard__mark">${i < index ? html`<${Icon} name="check" size=${14} />` : i + 1}</span>
          <span class="ui-wizard__step-title">${s.title}</span>
        </li>`)}
      </ol>
    </div>
    <p class="u-sr-only" role="status" aria-live="polite">${`${stepText}: ${cur.title}`}</p>
    <div class="ui-wizard__panel" key=${cur.id} data-testid=${`${testid}-step-${cur.id}`}>
      <h2 class="ui-wizard__heading" tabindex="-1" ref=${headingRef} data-testid=${`${testid}-heading`}>${cur.title}</h2>
      ${cur.hint ? html`<p class="ui-wizard__hint">${cur.hint}</p>` : null}
      <div class="ui-wizard__content">${body}</div>
    </div>
    <div class="ui-wizard__error" role="alert" aria-atomic="true">${error ? html`<p class="ui-wizard__error-text" tabindex="-1" ref=${errorRef} data-testid=${`${testid}-error`}><${Icon} name="circle-alert" size=${18} /><span>${error}</span></p>` : null}</div>
    <div class="ui-wizard__footer">
      ${showBack ? html`<${Button} variant=${isFirst ? 'ghost' : 'secondary'} size="lg" icon=${isFirst ? undefined : 'arrow-left'} onClick=${back} disabled=${loading} data-testid=${`${testid}-back`}>${isFirst ? cancelLabel : backLabel}<//>` : null}
      <${Button} variant="primary" size="lg" class="ui-wizard__next" iconRight=${isLast ? 'check' : 'arrow-right'} onClick=${next} loading=${loading} disabled=${cur.canNext === false} data-testid=${`${testid}-next`}>${isLast ? (cur.nextLabel || finishLabel) : (cur.nextLabel || 'Next')}<//>
    </div>
  </section>`;
}
