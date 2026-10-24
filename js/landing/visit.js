// js/landing/visit.js: the "earliest visit" idea, an annotation in the margin of step 02 ("Discuss your installation", the step that already mentions a survey).
// It is OUR idea, not his words: data-proto, a dashed rule and the tag "Idea from us, not on your site today", so "Only my content" removes it with one rule and the step keeps his text.
// READ-ONLY (a fact from the diary, never a button). The soonest free visit comes from nextFreeSlots(state, 'ev_quote', 1), recomputed on every store change and every minute (useNow),
// so it always matches what the owner's diary can really take. Moved here from hero.js (V5); the logic is unchanged.
// Owner: B2 (landing V5, docs/LANDING-V5.md 6.1)
import { html, useMemo } from '../vendor/preact-htm.js';
import { useBrand, useNow, useStore } from '../ui/hooks.js';
import { nextFreeSlots } from '../core/availability.js';
import { dateKey } from '../core/dates.js';
import { ENQUIRY_SERVICE_ID, fillOwner } from './content.js';
import { VISIT } from './copy.js';
import { ProtoTag, protoProps } from './idea.js';
import { TextLink } from './ui.js';

// Stable selector function (useStore wants the same function every render).
const selectAll = (state) => state;

/** 'Mon 26 Oct, 8–10am' -> ['Mon 26 Oct', '8–10am'] (the first comma splits the day from the arrival window). */
function splitHuman(human) {
  const i = String(human).indexOf(', ');
  return i < 0 ? [String(human), ''] : [human.slice(0, i), human.slice(i + 2)];
}

/** 'Mon 26 Oct, 8–10am' -> 'Mon 26 Oct, 8 to 10am' (customers read words, not dashes). */
export function visitWords(human) {
  const [day, win] = splitHuman(human);
  const w = win.replace(/\s*[–—-]\s*/, ' to ');
  return w ? `${day}, ${w}` : day;
}

/**
 * "Earliest visit Daniel could offer / Mon 26 Oct, 8 to 10am / Daniel will confirm." The date is 24px/600 tabular with the day in a <time>. When the diary is full it says so
 * and offers the phone as a quiet text link.
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
    return html`<div class="lp-visit__slot lp-visit__slot--full" data-testid="live-availability">
      <p class="lp-visit__k">${VISIT.full.replace('{n}', String(maxDays))}</p>
      <${TextLink} quiet href=${brand.telHref}>${fillOwner(VISIT.call, o)}<//>
    </div>`;
  }
  const slot = slots[0];
  const words = visitWords(slot.human);
  const day = words.indexOf(', ') < 0 ? words : words.slice(0, words.indexOf(', '));
  const rest = words.slice(day.length);
  return html`<div class="lp-visit__slot" data-testid="live-availability">
    <p class="lp-visit__k">${fillOwner(VISIT.lead, o)}</p>
    <p class="lp-visit__date" data-testid="next-free-slot"><time datetime=${slot.date}>${day}</time>${rest}</p>
    <p class="lp-visit__conf">${fillOwner(VISIT.confirm, o)}${fullToday ? ` ${fillOwner(VISIT.today, o)}` : ''}</p>
  </div>`;
}

/** The whole annotation: a dashed rule, the tag, then the live visit. One idea, one data-proto. */
export function Visit() {
  return html`<div class="lp-visit" ...${protoProps({ 'data-testid': 'hero-visit' })}>
    <${ProtoTag} />
    <${LiveAvailability} />
  </div>`;
}
