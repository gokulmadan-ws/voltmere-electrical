// js/landing/hero.js: hero (his words, the quote CTA, three ticks, his photo under a red-tinted gradient) and the live "Next free survey visits" card.
// Owner: L3 (landing page for 180 Electrical; first built by C2)
import { html, useMemo } from '../vendor/preact-htm.js';
import { Button, Icon, cx, useBrand, useNow, useStore } from '../ui/index.js';
import { nextFreeSlots } from '../core/availability.js';
import { dateKey } from '../core/dates.js';
import { CTA_LABEL, ENQUIRY_SERVICE_ID, HERO, IMAGES, bookClick, bookLinkProps } from './content.js';
import { Photo } from './media.js';

// Stable selector function (useStore wants the same function every render).
const selectAll = (state) => state;

/** 'Mon 26 Oct, 8–10am' -> ['Mon 26 Oct', '8–10am'] (the first comma splits the day from the arrival window). */
function splitHuman(human) {
  const i = String(human).indexOf(', ');
  return i < 0 ? [String(human), ''] : [human.slice(0, i), human.slice(i + 2)];
}

/**
 * "Next free survey visits": up to three chips from nextFreeSlots(state, 'ev_quote', 3), recomputed on every store
 * change and every minute (useNow), so it always matches what the owner's diary can really take. Tapping a chip opens
 * the enquiry funnel, which has no window of its own: the engine pencils in the soonest free one when the enquiry is sent,
 * and the customer is told it is provisional. Each chip's text is exactly the slot's `human` string.
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
            ${slots.map((s, i) => {
              const [day, win] = splitHuman(s.human);
              return html`<li key=${s.date + s.windowId}>
                <a class=${cx('lp-live__chip', i === 0 && 'lp-live__chip--first')} data-testid=${`next-free-chip-${i}`} ...${bookLinkProps({})}>
                  <${Icon} name=${i === 0 ? 'calendar-check' : 'calendar'} size=${18} class="lp-live__chip-icon" />
                  <span><span class="lp-live__day">${day}</span>${win ? html`, <span class="lp-live__win">${win}</span>` : null}</span>
                </a>
              </li>`;
            })}
          </ul>`
        : html`<div class="lp-live__empty">
            <p>Diary full for the next ${maxDays} days. Call ${o}</p>
            <${Button} variant="secondary" size="sm" icon="phone" href=${brand.telHref} class="lp-pill">Call ${o}<//>
          </div>`}
      <p class="lp-live__hint">The soonest free visit is pencilled in when you send your enquiry.</p>
    </div>
  `;
}

/** His H1, word for word, with the last phrase in the brand red (a span, so the text itself is untouched). */
function HeroTitle() {
  const at = HERO.title.lastIndexOf(HERO.accent);
  if (at < 0) return HERO.title;
  return html`${HERO.title.slice(0, at)}<span class="lp-hl">${HERO.accent}</span>${HERO.title.slice(at + HERO.accent.length)}`;
}

export function Hero() {
  return html`
    <section class="lp-hero" aria-labelledby="hero-title" id="top">
      <div class="lp-hero__media" data-testid="l3-hero-visual">
        <${Photo} img=${IMAGES.hero} ratio="3 / 2" eager=${true} sizes="(min-width: 900px) 56vw, 100vw" widths=${[640, 960, 1280]}
          class="lp-hero__photo" data-testid="hero-photo" />
        <span class="lp-hero__shade" aria-hidden="true"></span>
        <span class="lp-hero__slashes" aria-hidden="true"></span>
      </div>
      <div class="lp-container lp-hero__inner">
        <div class="lp-hero__copy">
          <p class="lp-eyebrow lp-hero__eyebrow">${HERO.eyebrow}</p>
          <h1 class="lp-hero__title" id="hero-title"><${HeroTitle} /></h1>
          <p class="lp-hero__sub">${HERO.sub}</p>
          <div class="lp-hero__cta">
            <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta lp-hero__btn" data-testid="hero-cta" onClick=${bookClick({})}>${CTA_LABEL}<//>
            <p class="lp-hero__line">${HERO.line1}</p>
            <p class="lp-hero__free"><${Icon} name="circle-check" size=${18} />${HERO.line2}</p>
          </div>
          <ul class="lp-ticks" data-testid="hero-ticks">
            ${HERO.ticks.map((t) => html`<li key=${t}><span class="lp-ticks__mark"><${Icon} name="check" size=${14} /></span><span>${t}</span></li>`)}
          </ul>
          <${LiveAvailability} />
        </div>
      </div>
    </section>
  `;
}
