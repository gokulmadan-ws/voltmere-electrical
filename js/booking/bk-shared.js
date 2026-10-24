// js/booking/bk-shared.js: small pieces shared by the booking steps (title, help line, price text, slot-taken banner).
// Owner: WP3, refreshed by D2 (quote-led price text, call-only help line)
import { html } from '../vendor/preact-htm.js';
import { Banner, BrandMark, Chip } from '../ui/display.js';
import { Button } from '../ui/button.js';
import { cx } from '../ui/util.js';
import { waLink } from '../core/messages.js';
import { PROMISES } from '../core/config.js';
import { gbp } from '../core/format.js';
import { LogoImg } from '../landing/media.js';
import { Glyph } from '../landing/glyphs.js';

/** Step heading. It is an h2 in both presentations (the dashboard page keeps its single h1) and takes focus on each step change. */
export function StepTitle({ children, sub }) {
  return html`<div class="bk-titleblock">
    <h2 class="bk-title" tabindex="-1" data-bk-title="true">${children}</h2>
    ${sub ? html`<p class="bk-sub">${sub}</p>` : null}
  </div>`;
}

/** True for a quote-led service (no number is ever shown): the EV charger installation. */
export function isQuoteLed(service) {
  return !!service && (service.priceType === 'quote' || service.priceType === 'quoted');
}

/** 'Fixed £195' (fixed and by_size), 'From £75', 'Free', 'Quoted for your home'. `service` may be null when the service was removed. */
export function priceText(service, price) {
  if (!service) return Number.isFinite(price) && price > 0 ? gbp(price) : 'Free';
  if (service.priceType === 'free') return 'Free';
  if (isQuoteLed(service)) return service.priceLabel || 'Quoted for your home';
  if (service.priceType === 'from') return `From ${gbp(price)}`;
  return `Fixed ${gbp(price)}`;
}

/** Short price for a service row or chip: 'Free', 'Quoted for your home', 'From £75', or the fixed amount. */
export function listPrice(service) {
  if (service.priceType === 'free') return 'Free';
  if (isQuoteLed(service)) return 'Quoted for your home';
  if (service.priceType === 'fixed') return gbp(service.price);
  return `From ${gbp(service.price)}`;
}

/** The two call / WhatsApp buttons used in empty states and the help line. */
export function ContactButtons({ brand, text, testids = {}, size = 'md' }) {
  const wa = waLink(brand.phone, text || `Hi ${brand.ownerFirst}, I'd like to book an electrician.`, brand.demoPhoneDigits);
  return html`<div class="bk-contact">
    <${Button} variant="secondary" size=${size} icon="phone" href=${brand.telHref} data-testid=${testids.call}>Call ${brand.ownerFirst}<//>
    <${Button} variant="secondary" size=${size} icon="message-circle" href=${wa} data-testid=${testids.whatsapp}>WhatsApp<//>
  </div>`;
}

/** Last item of a customer step's scrolling body: "Prefer to speak to us?" with one Call button (his site lists no WhatsApp). */
export function HelpLine({ brand }) {
  return html`<div class="bk-help">
    <p class="bk-help__text">Prefer to speak to us?</p>
    <div class="bk-contact">
      <${Button} variant="secondary" size="sm" icon="phone" href=${brand.telHref} data-testid="booking-call">Call ${brand.phone}<//>
    </div>
  </div>`;
}

/** Race recovery and stale-link banner with up to three alternative times (13.2.2 Step 2, item 5). */
export function SlotTakenBanner({ banner, onPick }) {
  if (!banner) return null;
  const alts = banner.alternatives || [];
  const text = banner.kind === 'stale'
    ? "That time isn't available any more. Here are the next free times:"
    : 'That window was just taken. Your details are saved. Here are the next free times:';
  return html`<${Banner} tone="warn" data-testid="slot-taken-banner" class="bk-banner"
    actions=${alts.length ? html`<div class="bk-alts">${alts.map((a, i) => html`<${Chip} key=${a.date + a.windowId} onClick=${() => onPick(a)} data-testid=${'slot-alt-' + i}>${a.human}<//>`)}</div>` : null}>
    ${text}
  <//>`;
}

// ---- the funnel's frame: brand lockup, one prototype strip, the reassurance line (steps 1 to 5) ----

/**
 * A credential at a width where the full wording will not fit: 'Level 3 Electrical Installation' -> 'Level 3 qualified',
 * '2391 Inspection and Testing' -> 'Inspection & Testing (2391)'. Never '2391 tested' (that reads as "2,391 things tested").
 * The hero shows both in full; this is for the rare tight chip.
 */
export function shortCredential(text) {
  const t = String(text || '').trim();
  if (/^level\s*3\b/i.test(t)) return 'Level 3 qualified';
  if (/^2391\b/.test(t)) return 'Inspection & Testing (2391)';
  return t;
}

const DEFAULT_CREDENTIALS = ['Level 3 Electrical Installation', '2391 Inspection and Testing'];

/** The credentials in full wording: the owner's own list from Settings, else his two. */
export function credentialList(state) {
  const list = state && state.settings && state.settings.business && Array.isArray(state.settings.business.credentials) && state.settings.business.credentials.length
    ? state.settings.business.credentials : DEFAULT_CREDENTIALS;
  return list.map((c) => String(c || '').trim()).filter(Boolean);
}

/** The credentials as short chips (see shortCredential). */
export function credentialChips(state) {
  return credentialList(state).map(shortCredential).filter(Boolean);
}

/**
 * The mark and the business name (the bolt in a square). Kept for the owner's screens; the customer-facing funnel and thank-you use
 * BrandLogo (his real logo picture) instead: the bolt mark is only for the favicon and the dashboard.
 */
export function BrandLockup({ brand, size = 28, testid = 'booking-brand', class: cls }) {
  return html`<span class=${cx('bk-brand', cls)} style=${`--lock:${size}px`} data-testid=${testid}><${BrandMark} size=${size} class="bk-brand__mark" /><span class="bk-brand__name">${brand.name}</span></span>`;
}

/**
 * HIS logo (LogoImg: the real picture cropped to the "180 ELECTRICAL" lockup, with the local copy as the fallback) as the funnel's brand.
 * The business name stays in the page for screen readers (and for anyone reading the text), so the name never depends on the picture loading.
 */
export function BrandLogo({ brand, testid = 'booking-brand', class: cls }) {
  return html`<span class=${cx('bk-brand bk-brand--logo', cls)} data-testid=${testid}><${LogoImg} name=${brand.name} decorative=${true} eager=${true} /><span class="u-sr-only">${brand.name}</span></span>`;
}

/**
 * ONE quiet line at the foot of each funnel step: honest, never a button, never at the top. It used to be a strip in the header; the funnel is a
 * full-screen sheet, so the page's own prototype strip (Show: With ideas / Only my content, Prototype tools) lives behind it and this line
 * says what the sheet is. data-proto: it vanishes under "Only my content".
 */
export function PrototypeStrip() {
  return html`<p class="bk-strip" data-proto="true" data-testid="booking-proto-strip"><span class="bk-strip__tag">Prototype</span><span class="bk-strip__text">Sample data, nothing is really sent</span></p>`;
}

/** The hours the business promises to reply within (his own target from Settings, else the 24 of his site). */
function replyHoursOf(state) {
  const h = state && state.settings && state.settings.sla ? state.settings.sla.replyHours : 0;
  return Number.isInteger(h) && h > 0 ? h : PROMISES.contactWithinHours;
}

/**
 * A credential as typography: 'Level 3 Electrical Installation' -> figure 'Level 3' + descriptor 'Electrical Installation', '2391 Inspection and Testing' ->
 * '2391' + 'Inspection and Testing' (the same split as the landing page's spec strip). A credential that does not start with a figure is the descriptor alone.
 */
export function splitCredential(text) {
  const m = /^(Level\s+\d+|\d+[A-Za-z]?)\s+(.*)$/i.exec(String(text || '').trim());
  return m ? { figure: m[1], rest: m[2] } : { figure: '', rest: String(text || '').trim() };
}

/**
 * Anchored at the foot of a funnel step. Steps 2 to 5 carry ONE thing here: a tap-to-call link ("Questions? Call us on 07885 496800", one continuous 1px
 * underline). Step 1 adds his two credentials as ruled rows in type (the figure in the logo voice, no chip, no badge). The free-quote line is shown once, on
 * step 1 (under the button) and in step 6's promise, so it is `free={false}` by default; with `free` it reads in the business's voice ("We will contact you ...").
 */
export function ReassureRow({ brand, state, free = false, credentials = false }) {
  const creds = credentials ? credentialList(state) : [];
  return html`<div class="bk-reassure" data-testid="funnel-reassure">
    ${free ? html`<p class="bk-reassure__free"><${Glyph} name="tick" size=${18} /><span>Free, no-obligation quote. We will contact you within ${replyHoursOf(state)} hours.</span></p>` : null}
    ${creds.length ? html`<div class="bk-reassure__creds"><p class="bk-reassure__k" id="bk-creds-k">Accredited and qualified</p>
      <ul class="bk-reassure__chips" aria-labelledby="bk-creds-k" data-testid="funnel-credentials">${creds.map((c) => {
    const parts = splitCredential(c);
    return html`<li class="bk-reassure__chip" key=${c}>${parts.figure ? html`<span class="bk-reassure__fig lp-logovoice">${parts.figure}</span>${' '}<span class="bk-reassure__desc">${parts.rest}</span>` : html`<span class="bk-reassure__desc">${parts.rest}</span>`}</li>`;
  })}</ul></div>` : null}
    <a class="bk-reassure__call" href=${brand.telHref} data-testid="booking-call"><span class="bk-reassure__calltext">Questions? Call us on ${brand.phone}</span></a>
  </div>`;
}
