// js/landing/hero.js: the hero. His eyebrow, H1 and sub word for word, the quote button and ONE quiet block under it: his free quote line, his two credentials
// in full wording (one quiet line, never over the photo) and, tagged as an IDEA from us, the earliest visit Daniel could offer from his diary.
// The photo is framed: full-bleed to the top on a phone (4:5), a rounded card beside the copy from 720px.
// Owner: L3 (landing page for 180 Electrical; first built by C2)
import { html, useMemo } from '../vendor/preact-htm.js';
import { Button, Icon, useBrand, useNow, useStore } from '../ui/index.js';
import { credentialList } from '../booking/bk-shared.js';
import { nextFreeSlots } from '../core/availability.js';
import { dateKey } from '../core/dates.js';
import { CTA_LABEL, ENQUIRY_SERVICE_ID, HERO, IMAGES, bookClick } from './content.js';
import { Photo } from './media.js';
import { ProtoTag, protoProps } from './idea.js';

// Stable selector functions (useStore wants the same function every render).
const selectAll = (state) => state;
const selectBusiness = (state) => state.settings.business;

// The lead-in of the suggested visit (an idea from us: his site offers no visit date).
const VISIT_LEAD = 'Earliest visit';

/** 'Mon 26 Oct, 8–10am' -> ['Mon 26 Oct', '8–10am'] (the first comma splits the day from the arrival window). */
function splitHuman(human) {
  const i = String(human).indexOf(', ');
  return i < 0 ? [String(human), ''] : [human.slice(0, i), human.slice(i + 2)];
}

/** 'Mon 26 Oct, 8–10am' -> 'Mon 26 Oct, 8 to 10am' (customers read words, not dashes). */
export function visitWords(human) {
  const [day, win] = splitHuman(human);
  const w = win.replace(/\s*[\u2013\u2014-]\s*/, ' to ');
  return w ? `${day}, ${w}` : day;
}

/**
 * "Earliest visit Daniel could offer: Mon 26 Oct, 8 to 10am. Daniel will confirm.": the soonest free visit from nextFreeSlots(state, 'ev_quote', 1),
 * recomputed on every store change and every minute (useNow), so it always matches what the owner's diary can really take. It is an IDEA from us
 * (his site offers no visit date), so HeroProof tags it, and it has ONE status only: an offer Daniel will confirm. READ-ONLY (a fact, not a
 * button). When the diary is full it says so and offers the phone instead.
 */
export function LiveAvailability() {
  const state = useStore(selectAll);
  const brand = useBrand();
  const nowDate = useNow(60000);
  const minute = Math.floor(nowDate.getTime() / 60000);
  const { slots, fullToday, maxDays } = useMemo(() => ({
    slots: nextFreeSlots(state, ENQUIRY_SERVICE_ID, 1, { now: nowDate }),
    fullToday: (state.settings.fullDays || []).includes(dateKey(nowDate)),
    maxDays: state.settings.maxDaysAhead
  }), [state, minute]);
  const o = brand.ownerFirst;

  if (!slots.length) {
    return html`<span class="lp-proof__slot lp-proof__slot--full" data-testid="live-availability">
      <span class="lp-proof__lead"><${Icon} name="calendar-x" size=${18} /></span><span>Diary full for the next ${maxDays} days. <a class="lp-proof__link" href=${brand.telHref}>Call ${o}</a></span>
    </span>`;
  }
  return html`<span class="lp-proof__slot" data-testid="live-availability">
    <span class="lp-proof__lead"><${Icon} name="calendar-clock" size=${18} /></span>
    <span>${VISIT_LEAD} ${o} could offer: <strong class="lp-proof__when" data-testid="next-free-slot">${visitWords(slots[0].human)}</strong>. ${o} will confirm.${fullToday ? html` <span class="lp-proof__note">(${o} is fully booked today.)</span>` : null}</span>
  </span>`;
}

/**
 * The quiet block under the hero button. Two lines are HIS words (a free quote; his two credentials, one quiet line, never over the photo);
 * the third is our IDEA (the earliest visit from his diary): data-proto, with the tag, so "Only my content" removes it. Nothing here is a button.
 */
export function HeroProof() {
  return html`<ul class="lp-proof" data-testid="hero-proof" aria-label="At a glance">
    <li class="lp-proof__item" data-testid="hero-proof-free"><span class="lp-proof__lead"><${Icon} name="shield-check" size=${18} /></span><span>${HERO.proofFree}</span></li>
    <li class="lp-proof__item lp-proof__item--creds"><${HeroCredentials} /></li>
    <li class="lp-proof__item lp-proof__item--visit" ...${protoProps({ 'data-testid': 'hero-visit' })}>
      <${ProtoTag} />
      <${LiveAvailability} />
    </li>
  </ul>`;
}

/** His two credentials, in full wording, as one quiet line under the button (they wrap to two lines on a narrow phone, never over the photo). */
export function HeroCredentials() {
  const business = useStore(selectBusiness);
  const list = credentialList({ settings: { business } });
  return html`<ul class="lp-hero__creds" data-testid="hero-creds" aria-label="Accredited and qualified">
    ${list.map((c, i) => html`<li class="lp-hero__cred" key=${c} data-testid=${`hero-cred-${i}`}><span class="lp-proof__lead"><${Icon} name="badge-check" size=${18} /></span><span>${c}</span></li>`)}
  </ul>`;
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
      <div class="lp-container lp-hero__inner">
        <div class="lp-hero__media" data-testid="l3-hero-visual">
          <span class="lp-hero__slashes" aria-hidden="true"></span>
          <div class="lp-hero__frame">
            <${Photo} img=${IMAGES.hero} ratio="4 / 5" eager=${true} sizes="(min-width: 720px) 46vw, 100vw" widths=${[640, 960, 1280]}
              class="lp-hero__photo" data-testid="hero-photo" />
            <span class="lp-hero__shade" aria-hidden="true"></span>
          </div>
        </div>
        <div class="lp-hero__copy">
          <p class="lp-eyebrow lp-hero__eyebrow">${HERO.eyebrow}</p>
          <h1 class="lp-hero__title" id="hero-title"><${HeroTitle} /></h1>
          <p class="lp-hero__sub">${HERO.sub}</p>
          <div class="lp-hero__cta">
            <${Button} variant="primary" size="lg" iconRight="arrow-right" class="lp-cta lp-hero__btn" data-testid="hero-cta" onClick=${bookClick({})}>${CTA_LABEL}<//>
          </div>
          <${HeroProof} />
        </div>
      </div>
    </section>
  `;
}
