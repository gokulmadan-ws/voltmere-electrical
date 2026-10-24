// js/booking/funnel.js: the 6-step quote funnel (his verbatim copy): postcode, four option cards, contact, submit.
// Owner: D2, motion, keyboard and UTM by D3
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Button, Banner, Field, Input, Textarea, cx } from '../ui/index.js';
import { createBooking } from '../core/store.js';
import { getUtm } from '../core/utm.js';
import { ENQUIRY_STEPS, PROMISES } from '../core/config.js';
import { isValidPostcode, normalisePostcode, postcodeZone, validateName, validatePhone } from '../core/format.js';
import { clearDraft } from './draft.js';
import { ReassureRow } from './bk-shared.js';
import { Glyph } from '../landing/glyphs.js';

export const FUNNEL_TOTAL = 6;
export const FUNNEL_SERVICE_ID = 'ev_quote';

// ---- his verbatim copy (docs/reference/180-site-report.md). Steps 2 to 5 come from ENQUIRY_STEPS in core/config.js. ----
export const FUNNEL_STEP1 = {
  eyebrow: "Let's find the right home charging setup for you",
  title: "What's your installation postcode?",
  label: 'UK postcode',
  placeholder: 'e.g. BT7 3AB',
  error: 'Please enter a valid UK postcode so we can check your location.',
  button: 'Continue',
  help: 'Your postcode helps us confirm we cover your area.',
  time: 'About 1 minute',
  free: 'Free, no-obligation quote.' // from his hero, under the CTA
};

/** His three steps ("From first enquiry to charging at home", docs/reference/180-site-report.md). No longer drawn on step 1 (the numbered list competed with "Step 1 of 6"); kept as his copy. */
export const FUNNEL_NEXT = [
  { title: 'Tell us about your home', body: 'Answer a few short questions about your location, parking and plans.' },
  { title: 'Discuss your installation', body: 'The team will review your enquiry and explain the next steps.' },
  { title: 'Arrange your installation', body: 'Once you are happy with the agreed quote and scope, arrange a suitable installation date.' }
];

export const FUNNEL_STEP6 = {
  title: (owner, business = '180 Electrical') => `Where can ${business} contact you about your quote?`, // his words; `owner` stays for the call sites
  promise: (owner, hours, business = '180 Electrical') => `${business} will contact you within ${hours} hours. Free, no-obligation quote.`,
  name: 'Full name',
  namePlaceholder: 'e.g. Aoife Magee',
  postcode: 'Installation postcode',
  postcodePlaceholder: 'e.g. BT7 3AB',
  phone: 'Mobile number',
  phonePlaceholder: '07xxx xxx xxx',
  phoneHint: () => 'We may text or WhatsApp you', // the owner argument stays for the call sites; the customer hears the business
  email: 'Email address',
  emailPlaceholder: 'name@email.com',
  emailHint: 'Your written quote comes here',
  notes: 'Anything else?', // his label was "Anything else we should know? (optional)": it wrapped over two lines of wide caps, so the question is short and "Optional" is the helper line
  notesHint: 'Optional',
  notesPlaceholder: 'Your vehicle, preferred charger or anything about your property',
  optIn: (business) => `Keep me updated with occasional offers and EV charging tips from ${business}. Optional, and you can opt out at any time.`,
  submit: 'Request my installation quote',
  footLine: 'We only use this to reply to your enquiry.',
  privacy: 'Privacy',
  check: (n) => (n === 1 ? 'Please check 1 field' : `Please check ${n} fields`),
  smallPrint: (business) => `${business} will use these details to respond to your installation enquiry. By submitting your details you give us permission to contact you.`
};

/** The hours promised on the thank-you page: the owner's reply target when set, else the promise from his own site (24). */
export function replyHours(state) {
  const h = state && state.settings && state.settings.sla ? state.settings.sla.replyHours : 0;
  return Number.isInteger(h) && h > 0 ? h : PROMISES.contactWithinHours;
}

export const FUNNEL_CONFIRM = {
  // Before WhatsApp has been opened nothing has reached the business, so the page leads with the one thing to do (no 24-hour promise yet).
  sendEyebrow: 'Nearly done',
  sendTitle: (business = '180 Electrical') => `Send your enquiry to ${business}.`,
  sendLead: 'One tap opens WhatsApp with your details already written. Then press send.',
  sendButton: 'Send my enquiry on WhatsApp',
  openedNote: (when) => `${when ? `You opened WhatsApp on ${when}. ` : ''}Press send there if you have not yet, so we get your details.`,
  // After it (his words, verbatim):
  title: 'Thanks, your enquiry has been received.',
  body: (owner, hours = PROMISES.contactWithinHours, business = '180 Electrical') => `The team at ${business} will review your details and contact you to discuss your home charger installation within ${hours} hours. Please also check your emails.`,
  readyTitle: 'Helpful to have ready',
  // His own words (docs/reference/180-site-report.md, "Helpful to have ready"); the owner's name is not in them, so the argument stays for the call sites.
  ready: () => 'If you can, have a photo of your consumer unit and preferred charger location ready. These may help the team assess your installation.',
  call: (phone) => `Prefer to speak to us? Call ${phone}`
};

// One line under each question: why it is asked. Generic and true, no promises (steps 2 to 5).
export const FUNNEL_WHY = {
  parking: () => 'We use this to plan the cable route.',
  vehicle: () => 'We use this to suggest a suitable charger.',
  timing: () => 'We use this to plan our diary around you.',
  permission: () => 'We use this to plan any permission needed.'
};

// A short grey line on each answer card (13px). Keep each one line at 375px wide. The answer values and labels are unchanged.
export const FUNNEL_OPTION_HINTS = {
  parking: {
    driveway: () => 'Off-street, at your home',
    garage: () => 'Attached or detached',
    allocated: () => 'A bay that comes with your home',
    street: () => 'On the road outside',
    other: () => 'We can talk it through'
  },
  vehicle: {
    have: () => 'Ready to charge at home',
    ordered: () => 'Plan the install in advance',
    choosing: () => 'Get help choosing a charger'
  },
  timing: {
    asap: () => 'Earliest date we can offer',
    month: () => 'In the next few weeks',
    one_to_three: () => 'Plenty of time to plan',
    researching: () => 'No rush, just exploring'
  },
  permission: {
    yes: () => 'You own it, or have the go-ahead',
    landlord: () => 'We can advise what is needed',
    unsure: () => 'That is fine, we can help'
  }
};

/** Shown under the answers when On-street is chosen on step 2 (the answer is kept; the step waits for Continue instead of moving on by itself). */
export const FUNNEL_STREET_NOTE = () => 'Home chargers usually need off-street parking. We can talk through options, or call';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const ADVANCE_MS = 380; // the chosen row stays filled ink this long (no transition) so the tap is seen, then the next question opens
const ANSWER_STEP_KEYS = ['parking', 'vehicle', 'timing', 'permission']; // steps 2 to 5, in order
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return 'Enter your email address';
  return EMAIL_RE.test(s) ? '' : "That email address doesn't look right";
}

/**
 * The furthest step the customer may be on: the first one whose answer is still missing (never skips a step).
 * `postcodeOk` is whether the postcode that got them past step 1 was a real one: booking-sheet.js remembers that when step 1 is left,
 * so editing the postcode again on step 6 can never throw them back to step 1 (the error shows under the field instead).
 */
export function funnelAllowedStepFor(postcodeOk, answers) {
  if (!postcodeOk) return 1;
  const missing = ANSWER_STEP_KEYS.findIndex((k) => !(answers && answers[k]));
  return missing === -1 ? FUNNEL_TOTAL : missing + 2;
}

/** The same, judged from a postcode string (unit tests and stale drafts use this). */
export function funnelAllowedStep(postcode, answers) {
  return funnelAllowedStepFor(isValidPostcode(postcode), answers);
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
const NEXT_FIELD = { 'fn-name': 'fn-postcode-6', 'fn-postcode-6': 'fn-phone', 'fn-phone': 'fn-email', 'fn-email': 'fn-note' };

/**
 * Put a field in view WITHOUT leaving the heading half cut (the old scrollIntoView({ block: 'center' }) left the H1 sliced under the progress bar).
 * The sheet body is the scroller and the sticky footer sits under it, so the visible height is the body's own client height. When the whole field
 * (label, box and its error line) fits above the footer from the top of the form, the body goes to scrollTop 0 and the H1 stays whole. Otherwise the
 * body scrolls so that the "Please check N fields" line (or, without one, the field's own label) is 16px below the top edge: everything above it,
 * H1 and promise included, is then fully out of view. A direct assignment, so no smooth scroll and nothing for reduced motion to switch off.
 */
export function revealFunnelField(el) {
  const body = el && el.closest ? el.closest('.ui-sheet__body') : null;
  if (!body) return;
  const field = el.closest('.ui-field') || el;
  const top = body.getBoundingClientRect().top;
  const offset = (node) => node.getBoundingClientRect().top - top + body.scrollTop; // y of a node's top edge inside the scrolled content
  const fieldBottom = field.getBoundingClientRect().bottom - top + body.scrollTop;
  if (fieldBottom + 16 <= body.clientHeight) { body.scrollTop = 0; return; }
  const prev = field.previousElementSibling;
  const lead = prev && prev.classList.contains('bk-fn__check') ? prev : field;
  body.scrollTop = Math.max(0, Math.round(offset(lead) - 16));
}

/**
 * A field the customer taps must not sit under the sticky footer or the progress bar. The shared handler in js/ui/boot.js centres it 250ms later (the funnel
 * opts out with data-keep-scroll, because centring is what left the heading half cut); this does the minimum instead, so nothing moves when the field is already clear.
 */
function keepFieldClear(e) {
  const el = e.target;
  if (!el || !el.matches || !el.matches('input, textarea, select')) return;
  setTimeout(() => {
    if (document.activeElement !== el) return;
    const body = el.closest('.ui-sheet__body');
    if (!body) return;
    const field = el.closest('.ui-field') || el;
    const r = field.getBoundingClientRect();
    const top = body.getBoundingClientRect().top;
    const over = r.bottom - (top + body.clientHeight - 8);
    if (over > 0) body.scrollTop += over;
    else if (r.top < top + 16) body.scrollTop = Math.max(0, body.scrollTop - (top + 16 - r.top));
  }, 250);
}

/** Focus a field (no browser scroll) and bring it into view (revealFunnelField). */
export function focusFunnelField(key) {
  setTimeout(() => {
    const el = document.getElementById(FIELD_IDS[key]);
    if (!el) return;
    el.focus({ preventScroll: true });
    revealFunnelField(el);
  }, 0);
}

/** "Privacy" in the footer: takes the visitor to the full wording above the opt-in (it lives in the form, not in the footer). */
export function showSmallPrint() {
  const el = document.getElementById('fn-smallprint');
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'auto' });
  el.focus({ preventScroll: true });
  el.classList.remove('is-flash');
  void el.offsetWidth; // restart the highlight
  el.classList.add('is-flash');
}

/** Enter on a single-line field moves to the next field (the keyboard's "next" key), like the on-screen keyboard hint promises. */
function enterToNext(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
  const next = NEXT_FIELD[e.target.id];
  if (!next) return;
  e.preventDefault();
  const el = document.getElementById(next);
  if (el) el.focus();
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

/** One line under the postcode box once it is a real postcode: what we can say without promising anything. */
function zoneHint(postcode, business) {
  if (!isValidPostcode(postcode)) return null;
  const zone = postcodeZone(postcode, business);
  if (zone === 'covered') return { tone: 'ok', glyph: 'tick', text: "Good news, that's in our area." };
  if (zone === 'edge') return { tone: 'warn', glyph: null, text: "That's on the edge of our area. We'll confirm it with you." };
  return { tone: 'neutral', glyph: null, text: "That looks like it's outside Northern Ireland. You can still send it and we will check." };
}

function PostcodeStep({ ctx }) {
  const { form, setForm, shown, setShown, state, fn, brand } = ctx;
  const error = shown.has('fnpostcode') && !isValidPostcode(form.postcode) ? FUNNEL_STEP1.error : '';
  const zone = zoneHint(form.postcode, state.settings.business);
  const covered = !!zone && zone.tone === 'ok'; // a Northern Ireland postcode: the verdict line gets the tick (anything else stays neutral)
  return html`<div class="bk-step bk-fn" data-testid="funnel-step-1" data-dir=${fn.dir} data-keep-scroll="true" onFocusCapture=${keepFieldClear}>
    <div class="bk-titleblock">
      <p class="bk-fn__eyebrow">${FUNNEL_STEP1.eyebrow}</p>
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="funnel-title">${FUNNEL_STEP1.title}</h2>
    </div>
    <${Field} label=${FUNNEL_STEP1.label} id="fn-postcode" hint=${FUNNEL_STEP1.help} error=${error} errorTestid="error-funnel-postcode" required class="bk-fn-postcode">
      <div class=${cx('bk-fn-input', covered && 'is-valid')}>
        <${Input} id="fn-postcode" value=${form.postcode} placeholder=${FUNNEL_STEP1.placeholder} class=${covered ? 'is-valid' : undefined}
          onInput=${(e) => setForm({ postcode: e.target.value })}
          onBlur=${() => { if (form.postcode.trim()) setShown((prev) => new Set([...prev, 'fnpostcode'])); }}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); continueFromPostcode(ctx); } }}
          type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters" spellcheck=${false} enterkeyhint="go" maxlength="8"
          data-testid="funnel-postcode" />
      </div>
    <//>
    <p class=${cx('bk-fn__zone', zone && `bk-fn__zone--${zone.tone}`, !zone && 'is-empty')} role="status" data-testid="funnel-zone-hint">${zone
    ? html`${zone.glyph ? html`<${Glyph} name=${zone.glyph} size=${18} />${' '}` : null}<span>${zone.text}</span>` : null}</p>
    <${ReassureRow} brand=${brand} state=${state} free=${false} credentials=${true} />
  </div>`;
}

// ---- Steps 2 to 5: option cards, auto-advance ---------------------------------------------------------------------

/**
 * One question, one tap. Keyboard: Tab reaches the group once (roving tab stop), the arrow keys, Home and End move between the
 * options, Enter or Space picks, and a number key (or the letters A to E, kept as quiet shortcuts) picks straight away. Picking advances by itself.
 * Each row carries a small line icon for its answer; the answers and the test ids are unchanged.
 */
function ChoiceStep({ ctx, def }) {
  const { fn, brand, state } = ctx;
  const current = fn.answers[def.key] || '';
  const count = def.options.length;
  const [advancing, setAdvancing] = useState(false);
  const [tabIdx, setTabIdx] = useState(() => Math.max(0, def.options.findIndex((o) => o.value === current)));
  const timer = useRef(null);
  const optRefs = useRef([]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // On-street parking is kept as the answer but does not move on by itself: the step shows a short note and a Continue button.
  const holds = (value) => def.key === 'parking' && value === 'street';
  const owner = brand.ownerFirst;
  const pick = (value, i) => {
    fn.setAnswer(def.key, value);
    setTabIdx(i);
    clearTimeout(timer.current);
    if (holds(value)) { setAdvancing(false); return; }
    setAdvancing(true);
    timer.current = setTimeout(() => fn.setStep(def.step + 1), ADVANCE_MS);
  };
  const focusOpt = (i) => {
    const j = (i + count) % count;
    setTabIdx(j);
    const el = optRefs.current[j];
    if (el) el.focus();
  };
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const at = optRefs.current.indexOf(document.activeElement);
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); focusOpt(at < 0 ? tabIdx : at + 1); return; }
    if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); focusOpt(at < 0 ? tabIdx : at - 1); return; }
    if (k === 'Home') { e.preventDefault(); focusOpt(0); return; }
    if (k === 'End') { e.preventDefault(); focusOpt(count - 1); return; }
    // 1 to 5 (or A to E) choose the row in that position; only while focus is inside the group
    const letter = k.length === 1 ? LETTERS.indexOf(k.toUpperCase()) : -1;
    const digit = /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
    const i = letter >= 0 ? letter : digit;
    if (i >= 0 && i < count) { e.preventDefault(); focusOpt(i); pick(def.options[i].value, i); }
  };

  return html`<div class="bk-step bk-fn" data-testid=${`funnel-step-${def.step}`} data-dir=${fn.dir} onKeyDown=${onKeyDown}>
    <div class="bk-titleblock">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" id=${`fn-title-${def.step}`} data-testid="funnel-title">${def.title}</h2>
      ${def.note || FUNNEL_WHY[def.key] ? html`<p class="bk-fn__why" data-testid="funnel-why">${def.note || FUNNEL_WHY[def.key](owner)}</p>` : null}
    </div>
    <div class=${cx('bk-fn-opts', advancing && 'is-advancing')} role="group" aria-labelledby=${`fn-title-${def.step}`}>
      ${def.options.map((o, i) => {
    const on = current === o.value;
    const hintFor = FUNNEL_OPTION_HINTS[def.key] && FUNNEL_OPTION_HINTS[def.key][o.value];
    const hint = hintFor ? hintFor(owner) : '';
    return html`<button type="button" key=${o.value} class=${cx('bk-fn-opt', on && 'is-selected')} aria-pressed=${on ? 'true' : 'false'}
        style=${{ '--i': i }} tabindex=${i === tabIdx ? 0 : -1} ref=${(el) => { optRefs.current[i] = el; }}
        onFocus=${() => setTabIdx(i)}
        data-testid=${`funnel-option-${def.key}-${o.value}`} onClick=${() => pick(o.value, i)}>
        <span class="bk-fn-opt__letter" aria-hidden="true">${LETTERS[i]}</span>
        <span class="bk-fn-opt__text"><span class="bk-fn-opt__label">${o.label}</span>${hint ? html`<span class="bk-fn-opt__hint" data-testid=${`funnel-hint-${def.key}-${o.value}`}>${hint}</span>` : null}</span>
        <span class="bk-fn-opt__tick" aria-hidden="true"><${Glyph} name="arrow" size=${20} /></span>
      </button>`;
  })}
    </div>
    ${def.key === 'parking' && current === 'street' ? html`<div class="bk-fn__street" data-testid="funnel-street-note" role="note">
      <p class="bk-fn__streettext"><span>${FUNNEL_STREET_NOTE(owner)}${' '}<a href=${brand.telHref} class="bk-nowrap">${brand.phone}</a>.</span></p>
      <${Button} variant="primary" size="lg" block class="bk-pill bk-cta" onClick=${() => fn.setStep(def.step + 1)} data-testid="funnel-next">Continue<//>
    </div>` : null}
    <${ReassureRow} brand=${brand} state=${state} />
  </div>`;
}

// ---- Step 6: contact ----------------------------------------------------------------------------------------------

function ContactStep({ ctx }) {
  const { form, setForm, shown, setShown, brand, banner, fn, state } = ctx;
  const owner = brand.ownerFirst;
  const errors = funnelContactErrors(form);
  const err = (key) => (shown.has(key) ? errors[key] : '');
  const touch = (key) => () => setShown((prev) => new Set([...prev, key]));
  // A helper line is only worth the space while there is no error to show under the same field.
  const hint = (key, text) => (err(key) ? undefined : text);
  // "Please check N fields": a label-voice line with a 1px --err rule, in the form, directly above the field that was the first error when Submit was pressed
  // (submitFunnel records it as "at:<key>"; the line then stays put while the customer types, so the box under their thumb never jumps). N stays live.
  const bad = Object.values(errors).filter(Boolean).length;
  const anchor = shown.has('attempt') && bad > 0 ? ['name', 'postcode', 'phone', 'email'].find((k) => shown.has(`at:${k}`)) || ['name', 'postcode', 'phone', 'email'].find((k) => errors[k]) : '';
  const check = (key) => (key === anchor ? html`<p class="bk-fn__check" role="alert" data-testid="funnel-check-summary"><span>${FUNNEL_STEP6.check(bad)}</span></p>` : null);
  return html`<div class="bk-step bk-fn bk-fn--contact" data-testid="funnel-step-6" data-dir=${fn.dir} data-keep-scroll="true" onFocusCapture=${keepFieldClear}>
    <div class="bk-titleblock">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="funnel-title">${FUNNEL_STEP6.title(owner, brand.name)}</h2>
      <p class="bk-fn__promise" data-testid="funnel-promise"><span>${FUNNEL_STEP6.promise(owner, replyHours(state), brand.name)}</span></p>
    </div>
    ${banner && banner.kind === 'fn_error'
    ? html`<${Banner} tone=${banner.tone || 'danger'} class="bk-banner" data-testid="funnel-error-banner">${banner.text}<//>` : null}
    <div class="bk-fields">
      ${check('name')}
      <${Field} label=${FUNNEL_STEP6.name} id="fn-name" error=${err('name')} errorTestid="error-name" required>
        <${Input} id="fn-name" value=${form.name} placeholder=${FUNNEL_STEP6.namePlaceholder} onInput=${(e) => setForm({ name: e.target.value })} onBlur=${touch('name')} onKeyDown=${enterToNext}
          type="text" autocomplete="name" autocapitalize="words" enterkeyhint="next" maxlength="60" data-testid="field-name" />
      <//>
      ${check('postcode')}
      <${Field} label=${FUNNEL_STEP6.postcode} id="fn-postcode-6" error=${err('postcode')} errorTestid="error-postcode" required>
        <${Input} id="fn-postcode-6" value=${form.postcode} placeholder=${FUNNEL_STEP6.postcodePlaceholder}
          onInput=${(e) => setForm({ postcode: e.target.value })} onBlur=${touch('postcode')} onKeyDown=${enterToNext}
          type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters" spellcheck=${false} enterkeyhint="next" maxlength="8" data-testid="field-postcode" />
      <//>
      ${check('phone')}
      <${Field} label=${FUNNEL_STEP6.phone} id="fn-phone" hint=${hint('phone', FUNNEL_STEP6.phoneHint(owner))} error=${err('phone')} errorTestid="error-phone" required>
        <${Input} id="fn-phone" value=${form.phone} placeholder=${FUNNEL_STEP6.phonePlaceholder} onInput=${(e) => setForm({ phone: e.target.value })} onBlur=${touch('phone')} onKeyDown=${enterToNext}
          type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" maxlength="20" data-testid="field-phone" />
      <//>
      ${check('email')}
      <${Field} label=${FUNNEL_STEP6.email} id="fn-email" hint=${hint('email', FUNNEL_STEP6.emailHint)} error=${err('email')} errorTestid="error-email" required>
        <${Input} id="fn-email" value=${form.email} placeholder=${FUNNEL_STEP6.emailPlaceholder} onInput=${(e) => setForm({ email: e.target.value })} onBlur=${touch('email')} onKeyDown=${enterToNext}
          type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck=${false} enterkeyhint="next" maxlength="100" data-testid="funnel-email" />
      <//>
      <${Field} label=${FUNNEL_STEP6.notes} id="fn-note" hint=${FUNNEL_STEP6.notesHint}>
        <${Textarea} id="fn-note" rows=${3} value=${form.note} onInput=${(e) => setForm({ note: e.target.value })}
          placeholder=${FUNNEL_STEP6.notesPlaceholder} enterkeyhint="done" maxlength="300" data-testid="field-note" />
      <//>
    </div>
    <div class="bk-fn__legal" id="fn-smallprint" tabindex="-1" data-testid="funnel-legal">
      <label class="bk-fn-check">
        <input type="checkbox" class="bk-fn-check__input" checked=${!!form.optIn} onChange=${(e) => setForm({ optIn: e.target.checked })} data-testid="funnel-optin" />
        <span class="bk-fn-check__box" aria-hidden="true"><${Glyph} name="tick" size=${16} /></span>
        <span class="bk-fn-check__text">${FUNNEL_STEP6.optIn(brand.name)}</span>
      </label>
      <p class="bk-fn__small" data-testid="funnel-small-print">${FUNNEL_STEP6.smallPrint(brand.name)}</p>
    </div>
  </div>`;
}

/** The body of the sheet while the customer is in the funnel. `ctx.fn.step` is the (already clamped) current step. */
export function FunnelBody({ ctx }) {
  const { svc, brand, fn } = ctx;
  if (!svc || !svc.active) {
    return html`<div class="bk-step" data-testid="funnel-unavailable">
      <div class="bk-titleblock"><h2 class="bk-title" tabindex="-1" data-bk-title="true">Online enquiries are paused</h2></div>
      <p class="bk-note">We are not taking online enquiries right now. Please call us instead.</p>
      <${Button} variant="primary" size="lg" block class="bk-pill bk-callbtn" icon="phone" href=${brand.telHref}>Call ${brand.phone}<//>
    </div>`;
  }
  if (fn.step === 1) return html`<${PostcodeStep} ctx=${ctx} />`;
  if (fn.step === 6) return html`<${ContactStep} ctx=${ctx} />`;
  const def = ENQUIRY_STEPS.find((s) => s.step === fn.step);
  return def ? html`<${ChoiceStep} key=${def.step} ctx=${ctx} def=${def} />` : null;
}

/** Sticky footer: Continue on step 1; on step 6 the submit button and one line of reassurance. Steps 2 to 5 have none. ("Please check N fields" lives in the form, above the first error.) */
export function FunnelFooter({ ctx }) {
  const { fn, submitting, svc } = ctx;
  if (!svc || !svc.active) return null;
  if (fn.step === 1) {
    return html`<div class="bk-footer bk-footer--fn">
      <${Button} variant="primary" size="lg" block class="bk-pill bk-cta" onClick=${() => continueFromPostcode(ctx)} data-testid="funnel-continue">${FUNNEL_STEP1.button}<//>
      <p class="bk-footer__note bk-fn__free"><${Glyph} name="tick" size=${16} />${' '}<span>${FUNNEL_STEP1.free}</span></p>
    </div>`;
  }
  if (fn.step === 6) {
    return html`<div class="bk-footer bk-footer--fn">
      <${Button} variant="primary" size="lg" block class="bk-pill bk-cta" loading=${submitting} onClick=${() => submitFunnel(ctx)} data-testid="funnel-submit">${FUNNEL_STEP6.submit}<//>
      <p class="bk-footer__note bk-fn__foot" data-testid="funnel-foot-line"><span>${FUNNEL_STEP6.footLine}</span><button type="button" class="bk-fn__privacy" onClick=${showSmallPrint} data-testid="funnel-privacy">${FUNNEL_STEP6.privacy}</button></p>
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

/** The utm capture from this browser session (js/core/utm.js), or null. Never throws: a blocked sessionStorage just means no source. */
function currentUtm() {
  try { return getUtm(); } catch (e) { return null; }
}

/** Validate, createBooking, then handle every failure reason with a friendly message. Re-entry is ignored while in flight. */
export function submitFunnel(ctx) {
  const { form, fn, lock, brand } = ctx;
  if (lock.current) return;
  const errors = funnelContactErrors(form);
  const keys = ['name', 'postcode', 'phone', 'email'];
  ctx.setShown(new Set([...keys, 'attempt']));
  ctx.setBanner(null);
  const bad = keys.find((k) => errors[k]);
  if (bad) { ctx.setShown(new Set([...keys, 'attempt', `at:${bad}`])); focusFunnelField(bad); return; }

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
  const utm = currentUtm();
  if (utm) input.utm = utm;
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
  const call = `call us on ${brand.phone}`;
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
  } else if (res.reason === 'storage_full') {
    showError(ctx, `This device has no room left to save your enquiry. Your details are still here: free up some space and try again, or ${call}.`);
  } else {
    showError(ctx, `That did not go through. Your details are saved: please try again, or ${call}.`);
  }
}
