// js/booking/booking-sheet.js: BookingSheet, the booking frame: customer mode = the 6-step quote funnel (hash driven), owner mode = phone-job steps.
// Owner: WP3, rebuilt for the quote funnel by D2, step history, motion and announcements by D3
import { html, useEffect, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Sheet, IconButton, useStore, useNow, loadCss, cx } from '../ui/index.js';
import { getState } from '../core/store.js';
import { selectBrand, selectService, selectCustomerByKey, selectBookingByRef } from '../core/selectors.js';
import { isSlotFree, nextFreeSlots } from '../core/availability.js';
import { SOURCES, WINDOWS } from '../core/config.js';
import { SAMPLE_CUSTOMER } from '../core/seed.js';
import { isValidPostcode } from '../core/format.js';
import {
  goBooking, closeBooking, useBookRoute, pushFunnelStep, replaceFunnelStep, backFunnelSteps, syncFunnelHistory, finishFunnel,
  funnelHistoryStep, isUnwinding
} from './nav.js';
import { loadDraft, saveDraft } from './draft.js';
import { HelpLine, BrandLogo, PrototypeStrip } from './bk-shared.js';
import { Glyph } from '../landing/glyphs.js';
import { ServiceStep } from './service-step.js';
import { WhenStep, WhenFooter } from './when-step.js';
import { DetailsStep, DetailsFooter } from './details-step.js';
import { EmergencyStep, EmergencyFooter } from './emergency-step.js';
import { FunnelBody, FunnelFooter, FUNNEL_TOTAL, FUNNEL_SERVICE_ID, FUNNEL_STEP1, funnelAllowedStepFor } from './funnel.js';
import { Confirmation } from './confirmation.js';
import { Manage } from './manage.js';

// Safety net: the pages link css/booking.css in their head; loadCss is idempotent and only adds it when missing.
if (typeof document !== 'undefined') loadCss('css/booking.css');

const selectAll = (state) => state;

const EMPTY_FORM = {
  variantId: null, name: '', phone: '', email: '', postcode: '', line1: '', note: '', noteOpen: false, reasons: [], optIn: false,
  source: 'phone', price: null, notify: true
};
const EMPTY_PICK = { date: null, windowId: null };

const DIALOG_TITLES = {
  service: 'Book a visit', when: 'Book a visit', details: 'Book a visit', emergency: 'Emergency visit', funnel: 'Request your installation quote',
  confirmation: 'Booking confirmation', manage: 'Manage booking'
};

/** opts like goBooking's -> a route object (owner mode keeps the route in state instead of the hash). */
function routeFromOpts(opts = {}) {
  if (opts.bookedRef) return { kind: 'booked', ref: opts.bookedRef };
  if (opts.manageRef) return { kind: 'manage', ref: opts.manageRef };
  const r = { kind: 'book' };
  if (opts.emergency) r.emergency = true;
  else if (opts.serviceId) {
    r.serviceId = opts.serviceId;
    if (opts.date && opts.windowId !== undefined && opts.windowId !== null) { r.date = opts.date; r.windowId = Number(opts.windowId); }
  }
  return r;
}

const asWindow = (v) => (v === undefined || v === null || v === '' || !Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 3 ? null : Number(v));

/**
 * Customer mode: the website offers one thing, the free quote enquiry, so '#book', '#book/ev_quote' and any service that is
 * not shown on the website all open the 6-step funnel. A service the owner has switched on for the website keeps the classic flow.
 */
function usesFunnel(ownerMode, route, state) {
  if (ownerMode || route.kind !== 'book' || route.emergency) return false;
  if (!route.serviceId || route.serviceId === FUNNEL_SERVICE_ID) return true;
  const s = selectService(state, route.serviceId);
  return !(s && s.active && s.showOnWebsite);
}

function stepOf(route, svc, funnel) {
  if (route.kind === 'booked') return 'confirmation';
  if (route.kind === 'manage') return 'manage';
  if (route.emergency) return 'emergency';
  if (funnel) return 'funnel';
  if (!route.serviceId || !svc || !svc.active) return 'service';
  if (route.date && route.windowId !== undefined && route.windowId !== null) return 'details';
  return 'when';
}

function initialForm(ownerMode, intent, route, draft) {
  const f = { ...EMPTY_FORM };
  if (ownerMode) {
    if (SOURCES.includes(intent.source)) f.source = intent.source;
    if (intent.variantId) f.variantId = intent.variantId;
    if (intent.customerKey) {
      const c = selectCustomerByKey(getState(), String(intent.customerKey));
      if (c) {
        const a = c.addresses[0] || {};
        Object.assign(f, { name: c.name, phone: c.phone, email: c.email || '', line1: a.line1 || '', postcode: a.postcode || '' });
      }
    }
    return f;
  }
  if (draft) {
    Object.assign(f, {
      name: draft.name, phone: draft.phone, email: draft.email, postcode: draft.postcode, line1: draft.line1, note: draft.note,
      reasons: draft.reasons, optIn: draft.optIn
    });
    // The variant is restored only when the draft's service is the one in the URL (13.2.1).
    if (draft.serviceId && draft.serviceId === route.serviceId) f.variantId = draft.variantId || null;
  }
  if (typeof intent.postcode === 'string' && intent.postcode.trim()) f.postcode = intent.postcode.trim().slice(0, 8);
  return f;
}

/** "Back" on the black bar: a text link with the arrow glyph turned round (never a pill, never an icon button). */
function BarBack({ onBack }) {
  return html`<button type="button" class="bk-fn-back" onClick=${onBack} data-testid="booking-back"><${Glyph} name="arrow" size=${20} class="bk-fn-back__a" /><span>Back</span></button>`;
}

/** "Close" on the black bar: the word, underlined (the same as the lightbox's), a 44px target. */
function BarClose({ onClose }) {
  return html`<button type="button" class="bk-fn-close" onClick=${onClose} data-testid="booking-close"><span>Close</span></button>`;
}

/**
 * The funnel header (LANDING-V5 section 10): a black bar with Back (steps 2 to 6), HIS logo and Close, then on the paper "Step N of 6" in the label voice
 * (with "About 1 minute" on step 1) and six 2px progress segments in ink. No prototype strip in here: the sheet is full screen and the page's own strip sits
 * behind it (a quiet note closes each step instead). The bar is near-black in both themes so his logo picture sits on its own colour. Segment N is fully
 * filled on step N, the same on every step, including the sixth.
 */
function FunnelHeader({ step, brand, onBack, onClose }) {
  return html`<div class="bk-header bk-header--fn">
    <div class="bk-header__bar bk-header--dark">
      <div class="bk-header__row bk-header__row--fn">
        ${step > 1 ? html`<${BarBack} onBack=${onBack} />` : html`<span class="bk-header__spacer" aria-hidden="true"></span>`}
        <${BrandLogo} brand=${brand} />
        <${BarClose} onClose=${onClose} />
      </div>
    </div>
    <div class="bk-header__meta">
      <p class="bk-header__step" data-testid="funnel-step-label">Step <span class="bk-header__num" key=${step}>${step}</span> of ${FUNNEL_TOTAL}</p>
      ${step === 1 ? html`<p class="bk-header__time" data-testid="funnel-time"><span>${FUNNEL_STEP1.time}</span></p>` : null}
    </div>
    <div class="bk-fn-progress" data-testid="booking-progress" role="progressbar" aria-label="Quote progress" aria-valuemin="1" aria-valuemax=${FUNNEL_TOTAL}
      aria-valuenow=${step} aria-valuetext=${`Step ${step} of ${FUNNEL_TOTAL}`}>
      ${Array.from({ length: FUNNEL_TOTAL }, (_, i) => html`<span key=${i} class=${cx('bk-fn-progress__seg', i < step && 'is-done', i === step - 1 && 'is-current')}></span>`)}
    </div>
  </div>`;
}

function StepHeader({ step, page, enquiry, brand, onBack, onClose }) {
  const idx = step === 'when' ? 1 : step === 'details' ? 2 : 0;
  const showProgress = step === 'service' || step === 'when' || step === 'details';
  const showBack = step !== 'service' && step !== 'confirmation';
  // The customer's enquiry screens (thank-you, Manage) carry the same strip and name as the funnel itself.
  if (enquiry && !page) {
    return html`<div class="bk-header bk-header--fn bk-header--enquiry">
      <div class="bk-header__bar bk-header--dark">
        <div class="bk-header__row bk-header__row--fn">
          ${showBack ? html`<${BarBack} onBack=${onBack} />` : html`<span class="bk-header__spacer" aria-hidden="true"></span>`}
          <${BrandLogo} brand=${brand} />
          <${BarClose} onClose=${onClose} />
        </div>
      </div>
    </div>`;
  }
  return html`<div class=${cx('bk-header', step === 'confirmation' && !enquiry && 'bk-header--ok', enquiry && 'bk-header--fn', page && 'bk-header--page')}>
    ${page && !showBack ? null : html`<div class="bk-header__row">
      ${showBack
    ? html`<${IconButton} icon="chevron-left" label="Back" size="lg" onClick=${onBack} data-testid="booking-back" />`
    : html`<span class="bk-header__spacer" aria-hidden="true"></span>`}
      <p class="bk-header__step">${idx ? `Step ${idx} of 2` : ''}</p>
      ${page
    ? html`<span class="bk-header__spacer" aria-hidden="true"></span>`
    : html`<${IconButton} icon="x" label="Close" size="lg" onClick=${onClose} data-testid="booking-close" />`}
    </div>`}
    ${showProgress ? html`<div class="bk-progress" data-testid="booking-progress" role="progressbar" aria-label="Booking progress" aria-valuemin="0" aria-valuemax="2" aria-valuenow=${idx}>
      <span class=${cx('bk-progress__seg', idx >= 1 && 'is-done')}></span><span class=${cx('bk-progress__seg', idx >= 2 && 'is-done')}></span>
    </div>` : null}
  </div>`;
}

function Flow({ mode, presentation, intent, customerRoute, onClose, onBooked }) {
  const ownerMode = mode === 'owner';
  const page = presentation === 'page';
  const state = useStore(selectAll);
  const now = useNow(30000);
  const brand = selectBrand(state);

  const [ownerRoute, setOwnerRoute] = useState(() => {
    const r = routeFromOpts({ serviceId: intent.serviceId, date: intent.date, windowId: asWindow(intent.windowId) });
    if (intent.emergency) r.emergency = true;
    return r;
  });
  const route = ownerMode ? ownerRoute : customerRoute;
  const funnel = usesFunnel(ownerMode, route, state);
  const svc = funnel ? selectService(state, FUNNEL_SERVICE_ID) : route.serviceId ? selectService(state, route.serviceId) : null;

  // The saved draft is read once, when the flow opens (customer mode only).
  const draftRef0 = useRef(undefined);
  if (draftRef0.current === undefined) draftRef0.current = !ownerMode && route.kind === 'book' ? loadDraft() : null;
  const draft0 = draftRef0.current;

  // A deep link or chip that points at a window which is not free (or a service that is off) opens the When step with a banner.
  // Checked ONCE on entry: a later change must not yank the customer off the Details step (the race banner handles that, 13.2.2).
  // The quote funnel has no window of its own (the engine pencils one in), so it skips this check.
  const entry = useRef(null);
  if (entry.current === null) {
    entry.current = { pending: false, alternatives: [] };
    if (!funnel && route.kind === 'book' && route.serviceId && route.date && route.windowId !== undefined && route.windowId !== null) {
      const blocks = svc && svc.blocks === 2 ? 2 : 1;
      const free = svc && svc.active && isSlotFree(state, { date: route.date, windowId: route.windowId, blocks, ownerMode, now });
      if (!free) entry.current = { pending: true, alternatives: svc && svc.active ? nextFreeSlots(state, svc.id, 3, { ownerMode, now }) : [] };
    }
  }
  const effRoute = entry.current.pending ? { kind: 'book', serviceId: route.serviceId } : route;
  const step = stepOf(effRoute, svc, funnel);

  const [form, setFormState] = useState(() => initialForm(ownerMode, intent, route, draft0));
  const [pick, setPickState] = useState(() => {
    if (entry.current.pending) return EMPTY_PICK;
    return {
      date: route.date || intent.date || null,
      windowId: route.windowId !== undefined && route.windowId !== null ? route.windowId : asWindow(intent.windowId)
    };
  });
  const [answers, setAnswers] = useState(() => (draft0 && draft0.serviceId === FUNNEL_SERVICE_ID ? { ...draft0.answers } : {}));
  const [fstepRaw, setFstep] = useState(() => (draft0 && draft0.serviceId === FUNNEL_SERVICE_ID ? draft0.step : 1));
  const [dir, setDir] = useState('none'); // which way the funnel just moved: 'fwd' | 'back' | 'none' (first paint, restore)
  const [banner, setBanner] = useState(null);
  const [shown, setShown] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);

  const setForm = (patch) => setFormState((prev) => ({ ...prev, ...patch }));
  const setPick = (patch) => setPickState((prev) => ({ ...prev, ...patch }));

  // The funnel never lets the customer past a step whose answer is missing (a stale draft, a hand-edited URL). The postcode counts only
  // as it stood when step 1 was left (or restored): fixing a typo in it on step 6 must never throw the customer back to step 1, because
  // every keystroke would re-judge it. While step 1 itself is on screen the ref follows the box, so Continue and Forward still agree with it.
  const postcodeOk = useRef(null);
  if (postcodeOk.current === null || fstepRaw <= 1) postcodeOk.current = isValidPostcode(form.postcode);
  const fstep = Math.max(1, Math.min(fstepRaw, funnelAllowedStepFor(postcodeOk.current, answers)));
  const fstepRef = useRef(fstep);
  fstepRef.current = fstep;
  const inFunnel = funnel && !ownerMode;
  const inFunnelRef = useRef(inFunnel);
  inFunnelRef.current = inFunnel;

  // Every funnel step is a history entry (nav.js), so the phone's Back goes one step back. Forward pushes, Back walks the
  // history (the popstate listener below applies the step); with no earlier entry (a restored draft) it moves in place.
  // `fstepRef` is the step the funnel is on or already moving to, so a second tap that lands before the screen has re-rendered (a double tap, a
  // triple tap) never pushes a second history entry for the same step. A Back is `history.go` (asynchronous): further taps are ignored until it lands.
  const moving = useRef(null);
  const setStep = (n) => {
    setBanner(null);
    const cur = fstepRef.current;
    if (n === cur) return;
    if (!inFunnel) { setFstep(n); return; }
    if (moving.current !== null) return;
    if (n > cur) { setDir('fwd'); pushFunnelStep(n); fstepRef.current = n; setFstep(n); return; }
    setDir('back');
    if (!backFunnelSteps(cur - n)) { replaceFunnelStep(n); fstepRef.current = n; setFstep(n); return; }
    moving.current = n;
    setTimeout(() => { if (moving.current === n) moving.current = null; }, 800);
  };
  const fn = { step: fstep, setStep, dir, answers, setAnswer: (key, value) => setAnswers((prev) => ({ ...prev, [key]: value })) };

  // Keep the history in step with what is on screen whenever the funnel (re)opens: a refresh, a deep link with a saved draft, a restart.
  useLayoutEffect(() => {
    if (inFunnelRef.current) syncFunnelHistory(fstepRef.current);
  }, [inFunnel]);
  // The browser's Back and Forward buttons (and swipe gestures) move between funnel steps; the entry's step number is the truth.
  // A layout effect, so the listener is on before the first paint: a very quick Back after a refresh must not be missed.
  useLayoutEffect(() => {
    const onPop = () => {
      moving.current = null; // a Back that was walking to a step has landed
      if (!inFunnelRef.current || isUnwinding()) return;
      const s = funnelHistoryStep();
      if (!s || s === fstepRef.current) return;
      setDir(s > fstepRef.current ? 'fwd' : 'back');
      setBanner(null);
      setFstep(s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (opts = {}) => {
    // A new service resets the size (variants belong to a service). The picked day and window stay: they are re-checked
    // against the new service every render (`chosen`), and the owner's #/new?date&window intent must survive Step 0.
    if (opts.serviceId && opts.serviceId !== effRoute.serviceId) setForm({ variantId: null });
    if (opts.date) setPickState({ date: opts.date, windowId: opts.windowId === undefined ? null : opts.windowId });
    setBanner(null);
    if (ownerMode) setOwnerRoute(routeFromOpts(opts));
    else goBooking(opts);
  };

  // Customer mode: X, Esc and the scrim call closeBooking() (11.1). It ignores a second call while closing, so an
  // onClose that also calls it is harmless. Owner mode hands over to the page.
  const close = () => {
    if (ownerMode) { if (onClose) onClose(); return; }
    closeBooking();
    if (onClose) onClose();
  };

  useEffect(() => {
    if (!entry.current.pending) return;
    entry.current.pending = false;
    go({ serviceId: route.serviceId });
    setBanner({ kind: 'stale', alternatives: entry.current.alternatives });
  }, []);

  // Selection that is still bookable right now (state can change under the user, so it is re-checked every render).
  const blocks = svc && svc.blocks === 2 ? 2 : 1;
  const pw = pick.windowId;
  const chosen = !funnel && svc && pick.date && pw !== null && pw !== undefined && isSlotFree(state, { date: pick.date, windowId: pw, blocks, ownerMode, now })
    ? { date: pick.date, windowId: pw, arriveLabel: WINDOWS[pw].label }
    : null;

  const pickAlternative = (alt) => {
    setBanner(null);
    setPickState({ date: alt.date, windowId: alt.windowId });
    if (step === 'details') go({ serviceId: svc.id, date: alt.date, windowId: alt.windowId });
  };

  const onSuccess = (booking) => {
    const reset = () => {
      setFormState({ ...EMPTY_FORM, source: form.source });
      setPickState(EMPTY_PICK);
      setAnswers({});
      setFstep(1);
      setDir('none');
    };
    if (ownerMode) { reset(); if (onBooked) onBooked(booking); return; }
    // The funnel's step entries collapse first, so the phone's Back from the confirmation leaves the sheet instead of reopening step 5.
    if (funnel) finishFunnel({ bookedRef: booking.ref }, reset);
    else { reset(); go({ bookedRef: booking.ref }); }
  };

  const ctx = {
    mode, ownerMode, page, state, now, brand, svc, route: effRoute, step,
    form, setForm, pick, setPick, chosen, banner, setBanner, shown, setShown,
    submitting, setSubmitting, lock, go, close, pickAlternative, onSuccess, fn
  };

  // Draft: customer flow only; the URL stays the source of truth for service, date and window (13.2.1).
  // Saved after each change and again on pagehide, because a passive effect may not have run when the page is refreshed.
  const draftRef = useRef(null);
  draftRef.current = (ownerMode || step === 'confirmation' || step === 'manage') ? null : {
    serviceId: funnel ? FUNNEL_SERVICE_ID : (effRoute.serviceId || ''), variantId: form.variantId || '', date: pick.date || '',
    windowId: pick.windowId === undefined ? null : pick.windowId,
    name: form.name, phone: form.phone, email: form.email, postcode: form.postcode, line1: form.line1, note: form.note, reasons: form.reasons,
    step: fstep, optIn: !!form.optIn, answers
  };
  useEffect(() => {
    if (draftRef.current) saveDraft(draftRef.current);
  }, [form, pick, step, fstep, answers]);
  useEffect(() => {
    const flush = () => { if (draftRef.current) saveDraft(draftRef.current); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // Step change: release the double-tap lock, scroll to the top and move focus to the new heading.
  const stepKey = step + ':' + (effRoute.ref || '') + ':' + (step === 'funnel' ? fstep : '');
  const seenStep = useRef(stepKey);
  useEffect(() => {
    lock.current = false;
    setSubmitting(false);
    if (seenStep.current === stepKey) return;
    seenStep.current = stepKey;
    const title = document.querySelector('[data-bk-title]');
    const body = document.querySelector('[data-testid="booking-sheet"] .ui-sheet__body');
    if (body) body.scrollTop = 0; else if (page) window.scrollTo(0, 0);
    if (title) title.focus({ preventScroll: true });
  }, [stepKey]);

  const onBack = () => {
    if (step === 'funnel') { if (fstep > 1) fn.setStep(fstep - 1); }
    else if (step === 'when' || step === 'emergency') go({});
    else if (step === 'details') go({ serviceId: effRoute.serviceId });
    else if (step === 'manage') go({ bookedRef: effRoute.ref });
  };

  const fillDemo = () => {
    if (step === 'funnel') {
      setForm({
        name: fstep === 6 ? SAMPLE_CUSTOMER.name : form.name,
        phone: fstep === 6 ? SAMPLE_CUSTOMER.phone : form.phone,
        email: fstep === 6 ? (SAMPLE_CUSTOMER.email || 'aoife.magee@example.com') : form.email,
        postcode: fstep === 6 && isValidPostcode(form.postcode) ? form.postcode : SAMPLE_CUSTOMER.postcode
      });
    } else {
      setForm({ name: SAMPLE_CUSTOMER.name, phone: SAMPLE_CUSTOMER.phone, postcode: SAMPLE_CUSTOMER.postcode, line1: SAMPLE_CUSTOMER.line1 });
    }
    setShown(new Set());
    setTimeout(() => {
      const btn = document.querySelector('[data-testid="booking-submit"], [data-testid="emergency-submit"], [data-testid="funnel-submit"], [data-testid="funnel-continue"]');
      if (btn) btn.focus();
    }, 80);
  };

  // The booking behind a confirmation or Manage page decides whether it is an enquiry (header and title differ).
  const refBooking = step === 'confirmation' || step === 'manage' ? selectBookingByRef(state, effRoute.ref) : null;
  const enquiry = !!refBooking && refBooking.serviceId === FUNNEL_SERVICE_ID;

  let body = null;
  let footer = null;
  if (step === 'funnel') {
    body = html`<${FunnelBody} ctx=${ctx} />`;
    // Steps 2 to 5 auto-advance and have no footer; an empty footer vnode would still draw a bar.
    if (svc && svc.active && (fstep === 1 || fstep === 6)) footer = html`<${FunnelFooter} ctx=${ctx} />`;
  }
  else if (step === 'service') body = html`<${ServiceStep} ctx=${ctx} />`;
  else if (step === 'when') { body = html`<${WhenStep} ctx=${ctx} />`; footer = html`<${WhenFooter} ctx=${ctx} />`; }
  else if (step === 'details') { body = html`<${DetailsStep} ctx=${ctx} />`; footer = html`<${DetailsFooter} ctx=${ctx} />`; }
  else if (step === 'emergency') { body = html`<${EmergencyStep} ctx=${ctx} />`; footer = html`<${EmergencyFooter} ctx=${ctx} />`; }
  else if (step === 'confirmation') body = html`<${Confirmation} ctx=${ctx} refId=${effRoute.ref} />`;
  else body = html`<${Manage} ctx=${ctx} refId=${effRoute.ref} />`;

  const showFill = (step === 'details' || (step === 'emergency' && state.settings.takingEmergencies) || (step === 'funnel' && (fstep === 1 || fstep === 6) && svc && svc.active));
  // The funnel and the enquiry screens have no prototype strip of their own (the sheet is full screen). The demo shortcut sits BELOW the answers
  // there (a 12px grey text link, marked data-proto so clean mode can hide it), never above the question.
  const strip = !page && (step === 'funnel' || enquiry);
  const fillBtn = showFill
    ? html`<button type="button" class=${cx('bk-demofill', strip && 'bk-demofill--quiet')} data-proto="true" onClick=${fillDemo} data-testid="demo-fill">Demo: fill sample details</button>` : null;
  const ribbon = page
    ? (fillBtn ? html`<div class="bk-ribbon bk-ribbon--page">${fillBtn}</div>` : null)
    : strip
      ? null
      : html`<div class="bk-ribbon"><span class="bk-ribbon__tag">Prototype</span>${fillBtn || html`<span class="bk-ribbon__text">Sample data, nothing is really sent</span>`}</div>`;
  // The quiet prototype line and the demo shortcut close step 1 and step 6 only (steps 2 to 5 end with the phone link and nothing else).
  const protoStep = step === 'funnel' && (fstep === 1 || fstep === 6);
  const belowFill = strip && (fillBtn || protoStep)
    ? html`<div class="bk-demofill-row">${fillBtn}${protoStep ? html`<${PrototypeStrip} />` : null}</div>` : null;
  // The funnel's steps carry their own reassurance row (free quote, credentials, tap to call), so it has no separate help line.
  const showHelp = step === 'funnel' ? false : (!ownerMode && step !== 'confirmation' && step !== 'manage');

  // Screen readers hear "Step 3 of 6" on every step change (focus moves to the new heading as well).
  const announce = step === 'funnel' && svc && svc.active ? `Step ${fstep} of ${FUNNEL_TOTAL}` : '';
  const content = html`<div class=${cx('bk', page ? 'bk--page' : 'bk--sheet')} data-step=${step}>
    <div class="u-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="funnel-announce">${announce}</div>
    ${ribbon}
    ${body}
    ${belowFill}
    ${showHelp ? html`<${HelpLine} brand=${brand} />` : null}
  </div>`;
  const header = step === 'funnel'
    ? html`<${FunnelHeader} step=${fstep} brand=${brand} onBack=${onBack} onClose=${close} />`
    : html`<${StepHeader} step=${step} page=${page} enquiry=${enquiry} brand=${brand} onBack=${onBack} onClose=${close} />`;
  const dialogTitle = enquiry && step === 'confirmation' ? 'Enquiry received' : enquiry ? 'Manage enquiry' : DIALOG_TITLES[step];

  if (page) {
    return html`<div class="bk-page" data-testid="new-booking-page">
      ${header}
      ${content}
      ${footer ? html`<div class="db-sticky-actions bk-page-footer">${footer}</div>` : null}
    </div>`;
  }
  return html`<${Sheet} open=${true} onClose=${close} title=${dialogTitle} size="full" testid="booking-sheet"
    header=${header} footer=${footer} initialFocus="[data-bk-title]">
    ${content}
  <//>`;
}

/**
 * The booking flow. Customer mode follows the URL hash (nav.js) and renders nothing while no booking route is active;
 * owner mode keeps its steps in component state (the dashboard owns the hash).
 * Customer mode opens the 6-step quote funnel; `intent.postcode` (optional) prefills Step 1.
 */
export function BookingSheet({ mode = 'customer', presentation = 'sheet', intent = {}, onClose, onBooked }) {
  const route = useBookRoute();
  if (mode !== 'owner' && !route) return null;
  return html`<${Flow} mode=${mode} presentation=${presentation} intent=${intent || {}} customerRoute=${mode === 'owner' ? null : route}
    onClose=${onClose} onBooked=${onBooked} />`;
}
