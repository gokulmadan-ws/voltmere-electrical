// js/landing/hero.js: hero (his words, the quote CTA, three ticks), the live "Next free survey visits" chips and the hero photo.
// Owner: C2 (landing page for 180 Electrical)
import { html, useMemo } from '../vendor/preact-htm.js';
import { Button, Icon, useBrand, useNow, useStore } from '../ui/index.js';
import { nextFreeSlots } from '../core/availability.js';
import { dateKey } from '../core/dates.js';
import { CTA_LABEL, ENQUIRY_SERVICE_ID, HERO, PHOTOS, PHOTO_ALT, bookClick, bookLinkProps } from './content.js';
import { Photo } from './media.js';

// Stable selector function (useStore wants the same function every render).
const selectAll = (state) => state;

/**
 * "Next free survey visits": up to three chips from nextFreeSlots(state, 'ev_quote', 3), recomputed on every store
 * change and every minute (useNow), so it always matches what the owner's diary can really take. Tapping a chip opens
 * the enquiry funnel, which has no window of its own: the engine pencils in the soonest free one when the enquiry is sent,
 * and the customer is told it is provisional.
 */
export function LiveAvailability() {
  const state = useStore(selectAll);
  const brand = useBrand();
  const nowDate = useNow(60000);
  const minute = Math.floor(nowDate.getTime() / 60000);
  const { slots, fullToday, maxDays } = useMemo(() => ({
    slots: nextFreeSlots(state, ENQUIRY_SERVICE_ID, 3, { now: nowDate }),
    fullToday: (state.settings.fullDays || []).includes(dateKey(nowDate)),
    maxDays: state.settings.maxDaysAhead
  }), [state, minute]);
  const o = brand.ownerFirst;

  return html`
    <div class="lp-live" data-testid="live-availability">
      <p class="lp-live__label"><span class="lp-live__dot" aria-hidden="true"></span>Next free survey visits</p>
      ${fullToday ? html`<p class="lp-live__note">${o} is fully booked today.</p>` : null}
      ${slots.length
        ? html`<ul class="lp-live__chips">
            ${slots.map((s, i) => html`<li key=${s.date + s.windowId}>
              <a class=${'lp-live__chip' + (i === 0 ? ' lp-live__chip--first' : '')} data-testid=${`next-free-chip-${i}`}
                ...${bookLinkProps({})}>${s.human}</a>
            </li>`)}
          </ul>`
        : html`<div class="lp-live__empty">
            <p>Diary full for the next ${maxDays} days. Call ${o}</p>
            <${Button} variant="secondary" size="sm" icon="phone" href=${brand.telHref} class="lp-pill">Call ${o}<//>
          </div>`}
      <p class="lp-live__hint">The soonest free visit is pencilled in when you send your enquiry.</p>
    </div>
  `;
}

export function Hero() {
  return html`
    <section class="lp-hero" aria-labelledby="hero-title" id="top">
      <div class="lp-container lp-hero__inner">
        <div class="lp-hero__copy">
          <p class="lp-eyebrow">${HERO.eyebrow}</p>
          <h1 class="lp-hero__title" id="hero-title">${HERO.title}</h1>
          <p class="lp-hero__sub">${HERO.sub}</p>
          <div class="lp-hero__cta">
            <${Button} variant="primary" size="lg" class="lp-cta lp-hero__btn" data-testid="hero-cta" onClick=${bookClick({})}>${CTA_LABEL}<//>
            <p class="lp-hero__line">${HERO.line1}</p>
            <p class="lp-hero__free">${HERO.line2}</p>
          </div>
          <ul class="lp-ticks" data-testid="hero-ticks">
            ${HERO.ticks.map((t) => html`<li key=${t}><${Icon} name="check" size=${20} class="lp-ticks__icon" /><span>${t}</span></li>`)}
          </ul>
          <${LiveAvailability} />
        </div>
        <div class="lp-hero__visual">
          <${Photo} src=${PHOTOS.hero} alt=${PHOTO_ALT.hero} ratio="4x3" eager=${true} class="lp-hero__photo" data-testid="hero-photo" />
        </div>
      </div>
    </section>
  `;
}
