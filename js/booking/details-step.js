// js/booking/details-step.js: Step 2 "Your details" (ticket, four fields, owner extras) and the shared customer fields.
// Owner: WP3
import { html, useEffect } from '../vendor/preact-htm.js';
import { Icon, Button, Banner, Field, Input, Textarea, Segmented, Switch, toast } from '../ui/index.js';
import { createBooking } from '../core/store.js';
import { quotedPriceFor, selectCustomerByKey } from '../core/selectors.js';
import {
  gbp, isUkMobile, toWaDigits, postcodeZone, validateName, validatePhone, validatePostcode, validateLine1
} from '../core/format.js';
import { fmtDayShort } from '../core/dates.js';
import { PROMISES, WINDOWS } from '../core/config.js';
import { StepTitle, SlotTakenBanner, priceText } from './bk-shared.js';
import { clearDraft } from './draft.js';

const FIELD_IDS = { name: 'bk-name', phone: 'bk-phone', postcode: 'bk-postcode', line1: 'bk-line1' };

/** Focus the first invalid field (13.2.2 item 3). Called after the errors are shown. */
export function focusField(key) {
  setTimeout(() => {
    const el = document.getElementById(FIELD_IDS[key]);
    if (el) el.focus();
  }, 0);
}

/**
 * Name, mobile, postcode (with the live zone hint) and house number + street, plus the optional note.
 * `urgent` makes the street optional (emergency path). Errors show after blur or a submit attempt (`ctx.shown`).
 */
export function CustomerFields({ ctx, urgent = false }) {
  const { form, setForm, shown, setShown, brand } = ctx;
  const err = (key, fn) => (shown.has(key) ? fn(form[key]) : '');
  const touch = (key) => () => setShown((prev) => new Set([...prev, key]));
  const zone = postcodeZone(form.postcode, brand);
  const noteOpen = form.noteOpen || !!form.note;
  const hints = {
    covered: { icon: 'circle-check', text: `In ${brand.ownerFirst}'s area` },
    edge: { icon: 'info', text: `On the edge of the area: ${brand.ownerFirst} will confirm any travel charge` },
    outside: { icon: 'info', text: 'A bit outside the area: you can still send it' }
  };
  const hint = hints[zone];

  return html`<div class="bk-fields">
    <${Field} label="Your name" id="bk-name" error=${err('name', validateName)} errorTestid="error-name" required>
      <${Input} id="bk-name" value=${form.name} onInput=${(e) => setForm({ name: e.target.value })} onBlur=${touch('name')}
        type="text" autocomplete="name" autocapitalize="words" enterkeyhint="next" maxlength="60" data-testid="field-name" />
    <//>
    <${Field} label="Mobile number" id="bk-phone" error=${err('phone', validatePhone)} errorTestid="error-phone" required
      hint=${`For your confirmation and the ${PROMISES.awayMinutes}-minutes-away message. No marketing.`}>
      <${Input} id="bk-phone" value=${form.phone} onInput=${(e) => setForm({ phone: e.target.value })} onBlur=${touch('phone')}
        type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" maxlength="20" data-testid="field-phone" />
    <//>
    <${Field} label="Postcode" id="bk-postcode" error=${err('postcode', validatePostcode)} errorTestid="error-postcode" required>
      <${Input} id="bk-postcode" value=${form.postcode} onInput=${(e) => setForm({ postcode: e.target.value })} onBlur=${touch('postcode')}
        type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters" spellcheck=${false} enterkeyhint="next" maxlength="8" data-testid="field-postcode" />
      <p class=${'bk-zone' + (hint ? ' bk-zone--' + zone : '')} data-testid="postcode-hint" aria-live="polite">${hint ? html`<${Icon} name=${hint.icon} size=${16} />${' '}<span>${hint.text}</span>` : ''}</p>
    <//>
    <${Field} label=${urgent ? 'House number and street (optional)' : 'House number and street'} id="bk-line1" error=${urgent ? '' : err('line1', validateLine1)} errorTestid="error-line1" required=${!urgent}>
      <${Input} id="bk-line1" value=${form.line1} onInput=${(e) => setForm({ line1: e.target.value })} onBlur=${touch('line1')}
        type="text" autocomplete="address-line1" enterkeyhint="next" maxlength="80" data-testid="field-line1" />
    <//>
    ${noteOpen ? html`<${Field} label=${`Note for ${brand.ownerFirst} (optional)`} id="bk-note">
      <${Textarea} id="bk-note" rows=${3} value=${form.note} onInput=${(e) => setForm({ note: e.target.value })}
        placeholder="e.g. flat 3, buzzer broken, dog is friendly" enterkeyhint="done" maxlength="300" data-testid="field-note" />
    <//>` : html`<button type="button" class="bk-linkbtn" onClick=${() => setForm({ noteOpen: true })} data-testid="note-toggle" aria-expanded="false">+ Add a note for ${brand.ownerFirst}</button>`}
  </div>`;
}

/** Owner mode only: existing-customer chip + fill, Source, Price, Send confirmation message. */
function OwnerExtras({ ctx, quoted }) {
  const { state, form, setForm, brand } = ctx;
  const key = isUkMobile(form.phone) ? toWaDigits(form.phone) : '';
  const existing = key ? selectCustomerByKey(state, key) : null;
  useEffect(() => {
    if (!existing) return;
    const last = existing.addresses[0] || {};
    setForm({
      name: form.name || existing.name,
      line1: form.line1 || last.line1 || '',
      postcode: form.postcode || last.postcode || ''
    });
  }, [existing ? existing.key : '']);
  const price = form.price === null || form.price === undefined ? quoted : form.price;
  return html`<div class="bk-fields bk-fields--owner">
    ${existing ? html`<p class="bk-existing" data-testid="existing-customer-chip"><${Icon} name="user" size=${16} />${' '}Existing customer</p>` : null}
    <div class="bk-field-group">
      <p class="bk-eyebrow" id="bk-source-label">Source</p>
      <${Segmented} ariaLabel="Source" value=${form.source} onChange=${(v) => setForm({ source: v })}
        options=${[
    { value: 'phone', label: 'Phone', testid: 'source-phone' },
    { value: 'whatsapp', label: 'WhatsApp', testid: 'source-whatsapp' },
    { value: 'referral', label: 'Word of mouth', testid: 'source-referral' }
  ]} />
    </div>
    <${Field} label="Price (£)" id="bk-price" hint=${`Quoted ${gbp(quoted)}. Change it if you agreed something else.`}>
      <${Input} id="bk-price" value=${String(price)} onInput=${(e) => { const d = e.target.value.replace(/[^0-9]/g, '').slice(0, 5); setForm({ price: d === '' ? '' : Number(d) }); }}
        type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" data-testid="field-price" />
    <//>
    <${Switch} checked=${form.notify} onChange=${(v) => setForm({ notify: v })} label="Send confirmation message" description=${`Simulated WhatsApp to the customer from ${brand.ownerFirst}.`} data-testid="notify-toggle" />
  </div>`;
}

export function DetailsStep({ ctx }) {
  const { svc, route, form, ownerMode, banner, pickAlternative, go, state } = ctx;
  const variantId = svc.priceType === 'by_size' ? (form.variantId || svc.defaultVariantId) : null;
  const variant = variantId ? svc.variants.find((v) => v.id === variantId) : null;
  const quoted = quotedPriceFor(svc, variantId);
  const win = WINDOWS[route.windowId];
  const half = svc.blocks === 2;
  const unavailable = banner && banner.kind === 'unavailable';

  return html`<div class="bk-step">
    <${StepTitle} sub=${ownerMode ? 'Customer details for the diary.' : 'No account, four fields.'}>Your details<//>
    ${unavailable
    ? html`<${Banner} tone="danger" class="bk-banner" data-testid="service-unavailable-banner">That service isn't available right now. Please call ${ctx.brand.ownerFirst}.<//>`
    : html`<${SlotTakenBanner} banner=${banner} onPick=${pickAlternative} />`}
    <div class="bk-ticket" data-testid="booking-ticket">
      <div class="bk-ticket__main">
        <p class="bk-ticket__service">${svc.name}</p>
        ${variant ? html`<p class="bk-ticket__variant">${variant.label}</p>` : null}
        <p class="bk-ticket__when">${fmtDayShort(route.date)} · arrive ${win ? win.label : ''}</p>
        ${half ? html`<p class="bk-ticket__sub">${route.windowId === 0 ? 'Morning' : 'Afternoon'} visit, about half a day</p>` : null}
      </div>
      <div class="bk-ticket__side">
        <p class="bk-ticket__price">${priceText(svc, quoted)}</p>
        <button type="button" class="bk-linkbtn" onClick=${() => go({ serviceId: svc.id })}>Edit</button>
      </div>
    </div>
    <${CustomerFields} ctx=${ctx} />
    ${ownerMode ? html`<${OwnerExtras} ctx=${ctx} quoted=${quoted} />` : null}
  </div>`;
}

export function DetailsFooter({ ctx }) {
  const { svc, form, ownerMode, brand, submitting } = ctx;
  const variantId = svc.priceType === 'by_size' ? (form.variantId || svc.defaultVariantId) : null;
  const quoted = quotedPriceFor(svc, variantId);
  let label = 'Confirm booking';
  if (ownerMode) label = 'Add to diary';
  else if (svc.priceType === 'from') label = `Confirm booking · from ${gbp(quoted)}`;
  else if (svc.priceType !== 'free') label = `Confirm booking · ${gbp(quoted)}`;
  return html`<div class="bk-footer">
    <${Button} variant="primary" size="lg" block loading=${submitting} onClick=${() => submitDetails(ctx)} data-testid="booking-submit">${label}<//>
    ${ownerMode ? null : html`<p class="bk-footer__note">No payment now. You pay ${brand.ownerFirst} after the job.</p>
    <p class="bk-footer__consent">By booking you agree ${brand.ownerFirst} may message you on this number about this visit.</p>`}
  </div>`;
}

/** Validate, createBooking, then handle slot_taken / invalid / success. Re-entry is ignored while a submit is in flight (8.3). */
export function submitDetails(ctx) {
  const { form, svc, route, ownerMode, lock, brand } = ctx;
  if (lock.current) return;
  const errors = {
    name: validateName(form.name), phone: validatePhone(form.phone),
    postcode: validatePostcode(form.postcode), line1: validateLine1(form.line1)
  };
  ctx.setShown(new Set(['name', 'phone', 'postcode', 'line1']));
  const firstBad = ['name', 'phone', 'postcode', 'line1'].find((k) => errors[k]);
  if (firstBad) { focusField(firstBad); return; }

  lock.current = true;
  ctx.setSubmitting(true);
  const variantId = svc.priceType === 'by_size' ? (form.variantId || svc.defaultVariantId) : undefined;
  const draft = {
    serviceId: svc.id, variantId, date: route.date, windowId: route.windowId,
    customer: { name: form.name, phone: form.phone }, address: { line1: form.line1, postcode: form.postcode },
    notes: form.note, source: ownerMode ? form.source : 'website'
  };
  if (ownerMode) {
    draft.asOwner = true;
    draft.notifyCustomer = form.notify;
    const price = form.price === null || form.price === undefined || form.price === '' ? null : Number(form.price);
    if (price !== null && Number.isFinite(price)) draft.quotedPrice = price;
  }
  const res = createBooking(draft);
  if (res.ok) {
    // The lock stays on: the route changes (customer) or the owner view navigates away, so a second tap can never double-book.
    clearDraft();
    ctx.onSuccess(res.booking);
    return;
  }
  lock.current = false;
  ctx.setSubmitting(false);
  if (res.reason === 'slot_taken') {
    ctx.setBanner({ kind: 'taken', alternatives: res.alternatives || [] });
  } else if (res.reason === 'invalid') {
    const keys = Object.keys(res.errors || {});
    ctx.setShown(new Set(['name', 'phone', 'postcode', 'line1']));
    const bad = ['name', 'phone', 'postcode', 'line1'].find((k) => keys.includes(k));
    if (bad) focusField(bad);
    else toast({ message: 'That did not work: the diary changed. Please check and try again.', tone: 'danger' });
  } else if (res.reason === 'service_unavailable') {
    ctx.setBanner({ kind: 'unavailable', alternatives: [] });
  } else {
    toast({ message: 'That did not work: the diary changed. Please check and try again.', tone: 'danger' });
  }
}
