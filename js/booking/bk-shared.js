// js/booking/bk-shared.js: small pieces shared by the booking steps (title, help line, price text, slot-taken banner).
// Owner: WP3, refreshed by D2 (quote-led price text, call-only help line)
import { html } from '../vendor/preact-htm.js';
import { Banner, Button, Chip } from '../ui/index.js';
import { waLink } from '../core/messages.js';
import { gbp } from '../core/format.js';

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
