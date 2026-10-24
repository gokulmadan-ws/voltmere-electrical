// js/landing/hero.js: L3 hero: live next-free chips, H1, trust line, service tiles and the quiet links.
// Owner: WP3
import { html, useMemo } from '../vendor/preact-htm.js';
import { Button, Icon, useBrand, useNow, useStore } from '../ui/index.js';
import { nextFreeSlots } from '../core/availability.js';
import { dateKey } from '../core/dates.js';
import { waLink } from '../core/messages.js';
import { selectServices, servicePriceLabel } from '../core/selectors.js';
import { bookClick, bookLinkProps, HERO_TILES, SERVICE_ICONS, waUnsureText } from './content.js';

// Stable selector functions (useStore wants the same function every render).
const selectAll = (state) => state;
const selectActive = (state) => selectServices(state);

/**
 * "Next free repair visits": up to three chips from nextFreeSlots(state, 'fault', 3), recomputed on every store
 * change and every minute (useNow). Each chip opens the Details step with that window preselected (11.1).
 */
export function LiveAvailability() {
  const state = useStore(selectAll);
  const brand = useBrand();
  const nowDate = useNow(60000);
  const minute = Math.floor(nowDate.getTime() / 60000);
  const { slots, fullToday, maxDays } = useMemo(() => ({
    slots: nextFreeSlots(state, 'fault', 3, { now: nowDate }),
    fullToday: (state.settings.fullDays || []).includes(dateKey(nowDate)),
    maxDays: state.settings.maxDaysAhead
  }), [state, minute]);
  const o = brand.ownerFirst;

  return html`
    <div class="lp-live" data-testid="live-availability">
      <p class="lp-live__label"><span class="lp-live__dot" aria-hidden="true"></span>Next free repair visits</p>
      ${fullToday ? html`<p class="lp-live__note">${o} is fully booked today.</p>` : null}
      ${slots.length
        ? html`<ul class="lp-live__chips">
            ${slots.map((s, i) => html`<li key=${s.date + s.windowId}>
              <a class=${'lp-live__chip' + (i === 0 ? ' lp-live__chip--first' : '')} data-testid=${`next-free-chip-${i}`}
                ...${bookLinkProps({ serviceId: 'fault', date: s.date, windowId: s.windowId })}>${s.human}</a>
            </li>`)}
          </ul>`
        : html`<div class="lp-live__empty">
            <p>Diary full for the next ${maxDays} days. Call ${o}</p>
            <${Button} variant="primary" size="sm" icon="phone" href=${brand.telHref}>Call ${o}<//>
          </div>`}
    </div>
  `;
}

function HeroTiles() {
  const services = useStore(selectActive);
  const tiles = HERO_TILES
    .map((t) => ({ ...t, service: services.find((s) => s.id === t.id) }))
    .filter((t) => t.service); // an inactive service is not rendered
  return html`
    <ul class="lp-tiles">
      ${tiles.map((t) => html`<li key=${t.id}>
        <button type="button" class="lp-tile" data-testid=${`hero-tile-${t.id}`} onClick=${bookClick({ serviceId: t.id })}>
          <span class="lp-tile__top">
            <span class="lp-tile__icon"><${Icon} name=${t.service.icon || SERVICE_ICONS[t.id]} size=${24} /></span>
            <span class="lp-tile__price">${servicePriceLabel(t.service)}</span>
          </span>
          <span class="lp-tile__title">${t.title}</span>
          ${t.sub ? html`<span class="lp-tile__sub">${t.sub}</span>` : null}
        </button>
      </li>`)}
    </ul>
  `;
}

function QuietLinks() {
  const brand = useBrand();
  const wa = waLink(brand.phone, waUnsureText(brand), brand.demoPhoneDigits);
  const focusCoverage = () => {
    // The anchor jump has happened by now; put the cursor in the postcode box (13.1 L3).
    setTimeout(() => {
      const el = document.querySelector('[data-testid="coverage-input"]');
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }, 350);
  };
  return html`
    <ul class="lp-qlinks">
      <li><a class="lp-qlink" href="#services" data-testid="hero-see-prices"><span>EV charger, rewire and more: see all prices</span><${Icon} name="chevron-right" size=${20} /></a></li>
      <li><a class="lp-qlink" href="#area" data-testid="hero-check-postcode" onClick=${focusCoverage}><span>Do you cover me? Check your postcode</span><${Icon} name="chevron-right" size=${20} /></a></li>
      <li><a class="lp-qlink" href=${wa} target="_blank" rel="noopener noreferrer" data-testid="hero-whatsapp"><span>Not sure what you need? Message ${brand.ownerFirst} on WhatsApp</span><${Icon} name="chevron-right" size=${20} /></a></li>
    </ul>
  `;
}

export function Hero() {
  const brand = useBrand();
  return html`
    <section class="lp-hero" aria-labelledby="hero-title" id="top">
      <div class="lp-container lp-hero__inner">
        <div class="lp-hero__copy">
          <${LiveAvailability} />
          <h1 class="lp-hero__title" id="hero-title">A proper electrician, booked in <span class="lp-hero__accent">60 seconds</span>.</h1>
          <p class="lp-hero__sub">Pick a time from ${brand.ownerFirst}'s real diary. Clear prices, a certificate with every job, and you pay after.</p>
          <p class="lp-hero__trust" data-testid="hero-trust">4.9 rating (sample) · Certificate with every job · Insured (sample)</p>
        </div>
        <div class="lp-hero__panel">
          <p class="lp-hero__eyebrow">What do you need?</p>
          <${HeroTiles} />
        </div>
        <div class="lp-hero__links"><${QuietLinks} /></div>
      </div>
    </section>
  `;
}
