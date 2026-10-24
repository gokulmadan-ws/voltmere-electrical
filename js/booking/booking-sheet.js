// js/booking/booking-sheet.js: BookingSheet, the booking frame for customer mode (hash driven) and owner mode (internal state).
// Owner: WP3
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Sheet, IconButton, useStore, useNow, loadCss, cx } from '../ui/index.js';
import { getState } from '../core/store.js';
import { selectBrand, selectService, selectCustomerByKey } from '../core/selectors.js';
import { isSlotFree, nextFreeSlots } from '../core/availability.js';
import { SOURCES, WINDOWS } from '../core/config.js';
import { SAMPLE_CUSTOMER } from '../core/seed.js';
import { goBooking, closeBooking, useBookRoute } from './nav.js';
import { loadDraft, saveDraft } from './draft.js';
import { HelpLine } from './bk-shared.js';
import { ServiceStep } from './service-step.js';
import { WhenStep, WhenFooter } from './when-step.js';
import { DetailsStep, DetailsFooter } from './details-step.js';
import { EmergencyStep, EmergencyFooter } from './emergency-step.js';
import { Confirmation } from './confirmation.js';
import { Manage } from './manage.js';

// Safety net: the pages link css/booking.css in their head; loadCss is idempotent and only adds it when missing.
if (typeof document !== 'undefined') loadCss('css/booking.css');

const selectAll = (state) => state;

const EMPTY_FORM = {
  variantId: null, name: '', phone: '', postcode: '', line1: '', note: '', noteOpen: false, reasons: [],
  source: 'phone', price: null, notify: true
};
const EMPTY_PICK = { date: null, windowId: null };

const DIALOG_TITLES = {
  service: 'Book a visit', when: 'Book a visit', details: 'Book a visit', emergency: 'Emergency visit',
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

function stepOf(route, svc) {
  if (route.kind === 'booked') return 'confirmation';
  if (route.kind === 'manage') return 'manage';
  if (route.emergency) return 'emergency';
  if (!route.serviceId || !svc || !svc.active) return 'service';
  if (route.date && route.windowId !== undefined && route.windowId !== null) return 'details';
  return 'when';
}

function initialForm(ownerMode, intent, route) {
  const f = { ...EMPTY_FORM };
  if (ownerMode) {
    if (SOURCES.includes(intent.source)) f.source = intent.source;
    if (intent.variantId) f.variantId = intent.variantId;
    if (intent.customerKey) {
      const c = selectCustomerByKey(getState(), String(intent.customerKey));
      if (c) {
        const a = c.addresses[0] || {};
        Object.assign(f, { name: c.name, phone: c.phone, line1: a.line1 || '', postcode: a.postcode || '' });
      }
    }
    return f;
  }
  const d = route && route.kind === 'book' ? loadDraft() : null;
  if (d) {
    Object.assign(f, { name: d.name, phone: d.phone, postcode: d.postcode, line1: d.line1, note: d.note, reasons: d.reasons });
    // The variant is restored only when the draft's service is the one in the URL (13.2.1).
    if (d.serviceId && d.serviceId === route.serviceId) f.variantId = d.variantId || null;
  }
  return f;
}

function StepHeader({ step, page, onBack, onClose }) {
  const idx = step === 'when' ? 1 : step === 'details' ? 2 : 0;
  const showProgress = step === 'service' || step === 'when' || step === 'details';
  const showBack = step !== 'service' && step !== 'confirmation';
  return html`<div class=${cx('bk-header', step === 'confirmation' && 'bk-header--ok', page && 'bk-header--page')}>
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
  const svc = route.serviceId ? selectService(state, route.serviceId) : null;

  // A deep link or chip that points at a window which is not free (or a service that is off) opens the When step with a banner.
  // Checked ONCE on entry: a later change must not yank the customer off the Details step (the race banner handles that, 13.2.2).
  const entry = useRef(null);
  if (entry.current === null) {
    entry.current = { pending: false, alternatives: [] };
    if (route.kind === 'book' && route.serviceId && route.date && route.windowId !== undefined && route.windowId !== null) {
      const blocks = svc && svc.blocks === 2 ? 2 : 1;
      const free = svc && svc.active && isSlotFree(state, { date: route.date, windowId: route.windowId, blocks, ownerMode, now });
      if (!free) entry.current = { pending: true, alternatives: svc && svc.active ? nextFreeSlots(state, svc.id, 3, { ownerMode, now }) : [] };
    }
  }
  const effRoute = entry.current.pending ? { kind: 'book', serviceId: route.serviceId } : route;
  const step = stepOf(effRoute, svc);

  const [form, setFormState] = useState(() => initialForm(ownerMode, intent, route));
  const [pick, setPickState] = useState(() => {
    if (entry.current.pending) return EMPTY_PICK;
    return {
      date: route.date || intent.date || null,
      windowId: route.windowId !== undefined && route.windowId !== null ? route.windowId : asWindow(intent.windowId)
    };
  });
  const [banner, setBanner] = useState(null);
  const [shown, setShown] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);

  const setForm = (patch) => setFormState((prev) => ({ ...prev, ...patch }));
  const setPick = (patch) => setPickState((prev) => ({ ...prev, ...patch }));

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
  const chosen = svc && pick.date && pw !== null && pw !== undefined && isSlotFree(state, { date: pick.date, windowId: pw, blocks, ownerMode, now })
    ? { date: pick.date, windowId: pw, arriveLabel: WINDOWS[pw].label }
    : null;

  const pickAlternative = (alt) => {
    setBanner(null);
    setPickState({ date: alt.date, windowId: alt.windowId });
    if (step === 'details') go({ serviceId: svc.id, date: alt.date, windowId: alt.windowId });
  };

  const onSuccess = (booking) => {
    setFormState({ ...EMPTY_FORM, source: form.source });
    setPickState(EMPTY_PICK);
    if (ownerMode) { if (onBooked) onBooked(booking); } else go({ bookedRef: booking.ref });
  };

  const ctx = {
    mode, ownerMode, page, state, now, brand, svc, route: effRoute, step,
    form, setForm, pick, setPick, chosen, banner, setBanner, shown, setShown,
    submitting, setSubmitting, lock, go, close, pickAlternative, onSuccess
  };

  // Draft: customer flow only; the URL stays the source of truth for service, date and window (13.2.1).
  // Saved after each change and again on pagehide, because a passive effect may not have run when the page is refreshed.
  const draftRef = useRef(null);
  draftRef.current = (ownerMode || step === 'confirmation' || step === 'manage') ? null : {
    serviceId: effRoute.serviceId || '', variantId: form.variantId || '', date: pick.date || '', windowId: pick.windowId === undefined ? null : pick.windowId,
    name: form.name, phone: form.phone, postcode: form.postcode, line1: form.line1, note: form.note, reasons: form.reasons
  };
  useEffect(() => {
    if (draftRef.current) saveDraft(draftRef.current);
  }, [form, pick, step]);
  useEffect(() => {
    const flush = () => { if (draftRef.current) saveDraft(draftRef.current); };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // Step change: release the double-tap lock, scroll to the top and move focus to the new heading.
  const stepKey = step + ':' + (effRoute.ref || '');
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
    if (step === 'when' || step === 'emergency') go({});
    else if (step === 'details') go({ serviceId: effRoute.serviceId });
    else if (step === 'manage') go({ bookedRef: effRoute.ref });
  };

  const fillDemo = () => {
    setForm({ name: SAMPLE_CUSTOMER.name, phone: SAMPLE_CUSTOMER.phone, postcode: SAMPLE_CUSTOMER.postcode, line1: SAMPLE_CUSTOMER.line1 });
    setShown(new Set());
    setTimeout(() => {
      const btn = document.querySelector('[data-testid="booking-submit"], [data-testid="emergency-submit"]');
      if (btn) btn.focus();
    }, 80);
  };

  let body = null;
  let footer = null;
  if (step === 'service') body = html`<${ServiceStep} ctx=${ctx} />`;
  else if (step === 'when') { body = html`<${WhenStep} ctx=${ctx} />`; footer = html`<${WhenFooter} ctx=${ctx} />`; }
  else if (step === 'details') { body = html`<${DetailsStep} ctx=${ctx} />`; footer = html`<${DetailsFooter} ctx=${ctx} />`; }
  else if (step === 'emergency') { body = html`<${EmergencyStep} ctx=${ctx} />`; footer = html`<${EmergencyFooter} ctx=${ctx} />`; }
  else if (step === 'confirmation') body = html`<${Confirmation} ctx=${ctx} refId=${effRoute.ref} />`;
  else body = html`<${Manage} ctx=${ctx} refId=${effRoute.ref} />`;

  const showFill = (step === 'details' || (step === 'emergency' && state.settings.takingEmergencies));
  const fillBtn = showFill
    ? html`<button type="button" class="bk-demofill" onClick=${fillDemo} data-testid="demo-fill">Demo: fill sample details</button>` : null;
  const ribbon = page
    ? (fillBtn ? html`<div class="bk-ribbon bk-ribbon--page">${fillBtn}</div>` : null)
    : html`<div class="bk-ribbon"><span class="bk-ribbon__tag">Prototype</span>${fillBtn || html`<span class="bk-ribbon__text">Sample data, nothing is really sent</span>`}</div>`;
  const showHelp = !ownerMode && step !== 'confirmation' && step !== 'manage';

  const content = html`<div class=${cx('bk', page ? 'bk--page' : 'bk--sheet')} data-step=${step}>
    ${ribbon}
    ${body}
    ${showHelp ? html`<${HelpLine} brand=${brand} />` : null}
  </div>`;
  const header = html`<${StepHeader} step=${step} page=${page} onBack=${onBack} onClose=${close} />`;

  if (page) {
    return html`<div class="bk-page" data-testid="new-booking-page">
      ${header}
      ${content}
      ${footer ? html`<div class="db-sticky-actions bk-page-footer">${footer}</div>` : null}
    </div>`;
  }
  return html`<${Sheet} open=${true} onClose=${close} title=${DIALOG_TITLES[step]} size="full" testid="booking-sheet"
    header=${header} footer=${footer} initialFocus="[data-bk-title]">
    ${content}
  <//>`;
}

/**
 * The booking flow. Customer mode follows the URL hash (nav.js) and renders nothing while no booking route is active;
 * owner mode keeps its steps in component state (the dashboard owns the hash).
 */
export function BookingSheet({ mode = 'customer', presentation = 'sheet', intent = {}, onClose, onBooked }) {
  const route = useBookRoute();
  if (mode !== 'owner' && !route) return null;
  return html`<${Flow} mode=${mode} presentation=${presentation} intent=${intent || {}} customerRoute=${mode === 'owner' ? null : route}
    onClose=${onClose} onBooked=${onBooked} />`;
}
