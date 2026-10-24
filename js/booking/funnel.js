// js/booking/funnel.js: the 6-step quote funnel (his verbatim copy): postcode, four option cards, contact, submit.
// Owner: D2
import { html, useEffect, useRef } from '../vendor/preact-htm.js';
import { Icon, Button, Banner, Field, Input, Textarea, cx } from '../ui/index.js';
import { createBooking } from '../core/store.js';
import { ENQUIRY_STEPS, PROMISES } from '../core/config.js';
import { isValidPostcode, normalisePostcode, validateName, validatePhone } from '../core/format.js';
import { clearDraft } from './draft.js';

export const FUNNEL_TOTAL = 6;
export const FUNNEL_SERVICE_ID = 'ev_quote';

// ---- his verbatim copy (docs/reference/180-site-report.md). Steps 2 to 5 come from ENQUIRY_STEPS in core/config.js. ----
export const FUNNEL_STEP1 = {
  eyebrow: "Let's find the right home charging setup for you",
  title: "What's your installation postcode?",
  label: 'UK postcode',
  placeholder: 'e.g. SW1A 1AA',
  error: 'Please enter a valid UK postcode so we can check your location.',
  button: 'Continue',
  help: 'Your postcode helps us confirm we cover your area.'
};

export const FUNNEL_STEP6 = {
  title: (business) => `Where can ${business} contact you about your quote?`,
  name: 'Full name',
  postcode: 'Installation postcode',
  postcodePlaceholder: 'e.g. DE1 1AA',
  phone: 'Mobile number',
  email: 'Email address',
  notes: 'Anything else we should know? (optional)',
  notesPlaceholder: 'Your vehicle, preferred charger or anything about your property',
  optIn: (business) => `Keep me updated with occasional offers and EV charging tips from ${business}. Optional, and you can opt out at any time.`,
  submit: 'Request my installation quote',
  smallPrint: (business) => `${business} will use these details to respond to your installation enquiry. By submitting your details you give us permission to contact you.`
};

export const FUNNEL_CONFIRM = {
  title: 'Thanks, your enquiry has been received.',
  body: (business) => `The team at ${business} will review your details and contact you to discuss your home charger installation within ${PROMISES.contactWithinHours} hours. Please also check your emails.`,
  readyTitle: 'Helpful to have ready',
  ready: 'If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation.',
  call: (phone) => `Prefer to speak to us? Call ${phone}`
};

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const ADVANCE_MS = 220; // long enough to see the selected state, short enough to feel instant
const ANSWER_STEP_KEYS = ['parking', 'vehicle', 'timing', 'permission']; // steps 2 to 5, in order
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return 'Enter your email address';
  return EMAIL_RE.test(s) ? '' : "That email address doesn't look right";
}

/** The furthest step the customer may be on: the first one whose answer is still missing (never skips a step). */
export function funnelAllowedStep(postcode, answers) {
  if (!isValidPostcode(postcode)) return 1;
  const missing = ANSWER_STEP_KEYS.findIndex((k) => !(answers && answers[k]));
  return missing === -1 ? FUNNEL_TOTAL : missing + 2;
}

/** The four contact errors ('' = fine) in field order. */
export function funnelContactErrors(form) {
  return {
    name: validateName(form.name),
    postcode: isValidPostcode(form.postcode) ? '' : FUNNEL_STEP1.error,
    phone: validatePhone(form.phone),
    email: validateEmail(form.email)
  };
}

const FIELD_IDS = { fnpostcode: 'fn-postcode', name: 'fn-name', postcode: 'fn-postcode-6', phone: 'fn-phone', email: 'fn-email' };

export function focusFunnelField(key) {
  setTimeout(() => {
    const el = document.getElementById(FIELD_IDS[key]);
    if (el) el.focus();
  }, 0);
}

// ---- Step 1: postcode ---------------------------------------------------------------------------------------------

export function continueFromPostcode(ctx) {
  const { form, fn } = ctx;
  if (!isValidPostcode(form.postcode)) {
    ctx.setShown((prev) => new Set([...prev, 'fnpostcode']));
    focusFunnelField('fnpostcode');
    return;
  }
  ctx.setForm({ postcode: normalisePostcode(form.postcode) });
  fn.setStep(2);
}

function PostcodeStep({ ctx }) {
  const { form, setForm, shown, setShown } = ctx;
  const error = shown.has('fnpostcode') && !isValidPostcode(form.postcode) ? FUNNEL_STEP1.error : '';
  return html`<div class="bk-step bk-fn" data-testid="funnel-step-1">
    <div class="bk-titleblock">
      <p class="bk-fn__eyebrow">${FUNNEL_STEP1.eyebrow}</p>
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="funnel-title">${FUNNEL_STEP1.title}</h2>
    </div>
    <${Field} label=${FUNNEL_STEP1.label} id="fn-postcode" hint=${FUNNEL_STEP1.help} error=${error} errorTestid="error-funnel-postcode" required>
      <${Input} id="fn-postcode" value=${form.postcode} placeholder=${FUNNEL_STEP1.placeholder}
        onInput=${(e) => setForm({ postcode: e.target.value })}
        onBlur=${() => { if (form.postcode.trim()) setShown((prev) => new Set([...prev, 'fnpostcode'])); }}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); continueFromPostcode(ctx); } }}
        type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters" spellcheck=${false} enterkeyhint="go" maxlength="8"
        data-testid="funnel-postcode" />
    <//>
  </div>`;
}

// ---- Steps 2 to 5: option cards, auto-advance --------------------------------------------------------------------

function ChoiceStep({ ctx, def }) {
  const { fn } = ctx;
  const current = fn.answers[def.key] || '';
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const pick = (value) => {
    fn.setAnswer(def.key, value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn.setStep(def.step + 1), ADVANCE_MS);
  };
  return html`<div class="bk-step bk-fn" data-testid=${`funnel-step-${def.step}`}>
    <div class="bk-titleblock">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" id=${`fn-title-${def.step}`} data-testid="funnel-title">${def.title}</h2>
    </div>
    <div class="bk-fn-opts" role="group" aria-labelledby=${`fn-title-${def.step}`}>
      ${def.options.map((o, i) => {
    const on = current === o.value;
    return html`<button type="button" key=${o.value} class=${cx('bk-fn-opt', on && 'is-selected')} aria-pressed=${on ? 'true' : 'false'}
        data-testid=${`funnel-option-${def.key}-${o.value}`} onClick=${() => pick(o.value)}>
        <span class="bk-fn-opt__letter" aria-hidden="true">${LETTERS[i]}</span>
        <span class="bk-fn-opt__label">${o.label}</span>
        ${on ? html`<${Icon} name="check" size=${20} class="bk-fn-opt__tick" />` : null}
      </button>`;
  })}
    </div>
    ${def.note ? html`<p class="bk-fn__note" data-testid="funnel-note">${def.note}</p>` : null}
  </div>`;
}

// ---- Step 6: contact ----------------------------------------------------------------------------------------------

function ContactStep({ ctx }) {
  const { form, setForm, shown, setShown, brand, banner } = ctx;
  const errors = funnelContactErrors(form);
  const err = (key) => (shown.has(key) ? errors[key] : '');
  const touch = (key) => () => setShown((prev) => new Set([...prev, key]));
  return html`<div class="bk-step bk-fn" data-testid="funnel-step-6">
    <div class="bk-titleblock">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="funnel-title">${FUNNEL_STEP6.title(brand.name)}</h2>
    </div>
    ${banner && banner.kind === 'fn_error'
    ? html`<${Banner} tone=${banner.tone || 'danger'} class="bk-banner" data-testid="funnel-error-banner">${banner.text}<//>` : null}
    <div class="bk-fields">
      <${Field} label=${FUNNEL_STEP6.name} id="fn-name" error=${err('name')} errorTestid="error-name" required>
        <${Input} id="fn-name" value=${form.name} onInput=${(e) => setForm({ name: e.target.value })} onBlur=${touch('name')}
          type="text" autocomplete="name" autocapitalize="words" enterkeyhint="next" maxlength="60" data-testid="field-name" />
      <//>
      <${Field} label=${FUNNEL_STEP6.postcode} id="fn-postcode-6" error=${err('postcode')} errorTestid="error-postcode" required>
        <${Input} id="fn-postcode-6" value=${form.postcode} placeholder=${FUNNEL_STEP6.postcodePlaceholder}
          onInput=${(e) => setForm({ postcode: e.target.value })} onBlur=${touch('postcode')}
          type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters" spellcheck=${false} enterkeyhint="next" maxlength="8" data-testid="field-postcode" />
      <//>
      <${Field} label=${FUNNEL_STEP6.phone} id="fn-phone" error=${err('phone')} errorTestid="error-phone" required>
        <${Input} id="fn-phone" value=${form.phone} onInput=${(e) => setForm({ phone: e.target.value })} onBlur=${touch('phone')}
          type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" maxlength="20" data-testid="field-phone" />
      <//>
      <${Field} label=${FUNNEL_STEP6.email} id="fn-email" error=${err('email')} errorTestid="error-email" required>
        <${Input} id="fn-email" value=${form.email} onInput=${(e) => setForm({ email: e.target.value })} onBlur=${touch('email')}
          type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck=${false} enterkeyhint="next" maxlength="100" data-testid="funnel-email" />
      <//>
      <${Field} label=${FUNNEL_STEP6.notes} id="fn-note">
        <${Textarea} id="fn-note" rows=${3} value=${form.note} onInput=${(e) => setForm({ note: e.target.value })}
          placeholder=${FUNNEL_STEP6.notesPlaceholder} enterkeyhint="done" maxlength="300" data-testid="field-note" />
      <//>
    </div>
    <label class="bk-fn-check">
      <input type="checkbox" class="bk-fn-check__input" checked=${!!form.optIn} onChange=${(e) => setForm({ optIn: e.target.checked })} data-testid="funnel-optin" />
      <span class="bk-fn-check__box" aria-hidden="true"><${Icon} name="check" size=${16} /></span>
      <span class="bk-fn-check__text">${FUNNEL_STEP6.optIn(brand.name)}</span>
    </label>
  </div>`;
}

/** The body of the sheet while the customer is in the funnel. `ctx.fn.step` is the (already clamped) current step. */
export function FunnelBody({ ctx }) {
  const { svc, brand, fn } = ctx;
  if (!svc || !svc.active) {
    return html`<div class="bk-step" data-testid="funnel-unavailable">
      <div class="bk-titleblock"><h2 class="bk-title" tabindex="-1" data-bk-title="true">Online enquiries are paused</h2></div>
      <p class="bk-note">We are not taking online enquiries right now. Please call ${brand.ownerFirst} instead.</p>
      <${Button} variant="primary" size="lg" block class="bk-pill bk-callbtn" icon="phone" href=${brand.telHref}>Call ${brand.phone}<//>
    </div>`;
  }
  if (fn.step === 1) return html`<${PostcodeStep} ctx=${ctx} />`;
  if (fn.step === 6) return html`<${ContactStep} ctx=${ctx} />`;
  const def = ENQUIRY_STEPS.find((s) => s.step === fn.step);
  return def ? html`<${ChoiceStep} key=${def.step} ctx=${ctx} def=${def} />` : null;
}

/** Sticky footer: Continue on step 1, the submit button (and the small print) on step 6. Steps 2 to 5 have none. */
export function FunnelFooter({ ctx }) {
  const { fn, brand, submitting, svc } = ctx;
  if (!svc || !svc.active) return null;
  if (fn.step === 1) {
    return html`<div class="bk-footer">
      <${Button} variant="primary" size="lg" block class="bk-pill" onClick=${() => continueFromPostcode(ctx)} data-testid="funnel-continue">${FUNNEL_STEP1.button}<//>
    </div>`;
  }
  if (fn.step === 6) {
    return html`<div class="bk-footer">
      <${Button} variant="primary" size="lg" block class="bk-pill" loading=${submitting} onClick=${() => submitFunnel(ctx)} data-testid="funnel-submit">${FUNNEL_STEP6.submit}<//>
      <p class="bk-footer__consent bk-fn__small" data-testid="funnel-small-print">${FUNNEL_STEP6.smallPrint(brand.name)}</p>
    </div>`;
  }
  return null;
}

// ---- Submit -------------------------------------------------------------------------------------------------------

function showError(ctx, text, tone = 'danger') {
  ctx.setBanner({ kind: 'fn_error', tone, text });
  setTimeout(() => {
    const el = document.querySelector('[data-testid="funnel-error-banner"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, 0);
}

/** Validate, createBooking, then handle every failure reason with a friendly message. Re-entry is ignored while in flight. */
export function submitFunnel(ctx) {
  const { form, fn, lock, brand } = ctx;
  if (lock.current) return;
  const errors = funnelContactErrors(form);
  const keys = ['name', 'postcode', 'phone', 'email'];
  ctx.setShown(new Set(keys));
  ctx.setBanner(null);
  const bad = keys.find((k) => errors[k]);
  if (bad) { focusFunnelField(bad); return; }

  lock.current = true;
  ctx.setSubmitting(true);
  const postcode = normalisePostcode(form.postcode);
  const input = {
    serviceId: FUNNEL_SERVICE_ID,
    answers: {
      postcode,
      parking: fn.answers.parking,
      vehicle: fn.answers.vehicle,
      timing: fn.answers.timing,
      permission: fn.answers.permission,
      marketingOptIn: !!form.optIn
    },
    customer: { name: form.name, phone: form.phone, email: form.email },
    address: { line1: '', postcode },
    notes: form.note,
    source: 'website',
    pencil: true
  };
  let res = createBooking(input);
  // The pencilled window was taken between the engine's pick and the write: ask again, the engine picks the next free one.
  if (!res.ok && res.reason === 'slot_taken') res = createBooking(input);
  if (res.ok) {
    // The lock stays on: the route changes to the confirmation, so a second tap can never send two enquiries.
    clearDraft();
    ctx.onSuccess(res.booking);
    return;
  }
  lock.current = false;
  ctx.setSubmitting(false);
  const call = `call ${brand.ownerFirst} on ${brand.phone}`;
  if (res.reason === 'invalid') {
    const e = res.errors || {};
    const answerKey = ANSWER_STEP_KEYS.find((k) => e[k] || (e.answers && e.answers[k]));
    if (answerKey) { fn.setStep(ANSWER_STEP_KEYS.indexOf(answerKey) + 2); return; }
    if (e.postcode && !e.name && !e.phone && !e.email) { focusFunnelField('postcode'); return; }
    const first = keys.find((k) => e[k]);
    if (first) { focusFunnelField(first); return; }
    showError(ctx, `Something in your details was not accepted. Please check them and try again, or ${call}.`);
  } else if (res.reason === 'service_unavailable') {
    showError(ctx, `We are not taking online enquiries right now. Please ${call}.`, 'warn');
  } else {
    showError(ctx, `That did not go through. Your details are saved: please try again, or ${call}.`);
  }
}
