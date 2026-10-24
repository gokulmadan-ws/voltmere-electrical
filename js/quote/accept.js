// js/quote/accept.js: the install-day flow behind the red "Choose install day" button: choose a day from the real availability engine (step 1 of 2), check it and accept
// (step 2 of 2; only that last button says "Accept quote"), with friendly recovery.
// Owner: Q2 (customer quote page)
import { html, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Banner } from '../ui/display.js';
import { Button } from '../ui/button.js';
import { Sheet } from '../ui/sheet.js';
import { cx } from '../ui/util.js';
import { getBookableDays, getDaySlots, isSlotFree } from '../core/availability.js';
import { todayKey } from '../core/clock.js';
import { DAY_SHORT, MONTH_LONG, fmtDayLong, parseDayKey } from '../core/dates.js';
import { waLink } from '../core/messages.js';
import { DateBox, SheetBar, StepFocus } from './parts.js';
import { acceptQuote } from '../core/store.js';
import { WINDOWS } from '../core/config.js';
import { dayTitle, money, partOfDay, shownTotal, slotShort, soonestText, windowLine } from './format.js';

const HORIZON_DAYS = 14;

/**
 * Days in the next two weeks that still have at least one free half-day, each with BOTH halves (morning, afternoon) and whether each
 * is free. A half that is taken, blocked or closed is kept so the picker can show it as "Booked" instead of leaving a gap.
 */
export function installDays(state) {
  const days = getBookableDays(state, { count: HORIZON_DAYS, serviceOrBlocks: 'ev' });
  return days
    .map((day) => ({
      date: day.date,
      slots: getDaySlots(state, day.date, 'ev').map((s) => ({ windowId: s.windowId, free: s.state === 'free' }))
    }))
    .filter((day) => day.slots.some((s) => s.free));
}

/** The same days with ONLY their free halves. */
export function freeInstallDays(state) {
  return installDays(state).map((day) => ({ date: day.date, slots: day.slots.filter((s) => s.free) }));
}

/** A plain-English reading of a failed acceptQuote, with what to do about it. `close` means the sheet cannot help any more. */
export function explainFailure(result, brand) {
  switch (result && result.reason) {
    case 'slot_taken':
      return { tone: 'warn', title: 'That day was just taken', text: 'Sorry, someone got there first. Here are the next free days, or choose another below.', alternatives: result.alternatives || [] };
    case 'expired':
      return { tone: 'danger', title: 'This quote has expired', text: 'It can\'t be accepted any more. We can send you an updated one.', close: true };
    case 'already_accepted':
      return { tone: 'ok', title: 'This quote is already accepted', text: 'Nothing more to do. Your install day is on the page.', close: true };
    case 'bad_transition':
      return { tone: 'danger', title: "This quote can't be accepted now", text: 'It has been closed or is not ready yet. Please call us to sort it out.', close: true };
    case 'service_unavailable':
      return { tone: 'danger', title: "Install days can't be booked here right now", text: 'Please call or WhatsApp us to find a day.', contact: true };
    case 'invalid':
      return { tone: 'warn', title: 'Please choose a day', text: 'Pick a morning or afternoon first.' };
    case 'storage_full':
      return { tone: 'danger', title: "Couldn't save this on your device", text: 'Your device has no room left, so nothing was changed. Free up some space and try again, or call us.', contact: true };
    case 'not_found':
      return { tone: 'danger', title: "This quote is not on this device", text: 'Nothing was changed. Please call us.', contact: true };
    default:
      return { tone: 'danger', title: 'Something went wrong', text: 'Nothing was changed. Please try again, or call us.', contact: true };
  }
}

/** One half-day as a full-width button (a radio underneath, so the keyboard and screen readers get a proper group). A taken half reads "Booked". */
function SlotOption({ date, windowId, free, selected, onPick }) {
  const label = partOfDay(windowId);
  return html`
    <label class=${cx('q2-slot', selected && 'is-selected', !free && 'is-taken')} data-testid=${`q2-slot-${date}-${windowId}`}>
      <input class="q2-slot__input" type="radio" name="q2-slot" value=${`${date}|${windowId}`} checked=${selected}
        disabled=${!free} onChange=${() => onPick(date, windowId)} />
      <span class="q2-slot__main">
        <span class="q2-slot__part"><span class="u-sr-only">${fmtDayLong(date)}, </span>${label}</span>
        <span class="q2-slot__arrive">${free ? `Free · arrive ${WINDOWS[windowId].label}` : 'Booked'}</span>
      </span>
      <span class="q2-slot__tick" aria-hidden="true"></span>
    </label>
  `;
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What a screen reader hears for a day chip: 'Thursday 29 October, morning and afternoon free'. */
function chipLabel(day) {
  const free = day.slots.filter((s) => s.free).map((s) => partOfDay(s.windowId).toLowerCase());
  return `${fmtDayLong(day.date)}, ${free.join(' and ')} free`;
}

/**
 * The days as one horizontal strip of chips (weekday, date, and AM and PM marks: solid when free, crossed out when booked), each month under its own horizontal
 * name (October, November: it sticks to the left edge while that month's days scroll past). One radio group: choosing a chip chooses the day and shows its two
 * halves underneath. Until a chip is tapped NOTHING in the strip looks chosen.
 */
function DayStrip({ days, viewKey, pickDate, onView }) {
  const ref = useRef(null);
  // Keep the viewed chip in the middle of the strip (a chip chosen by "Soonest available" may start off screen).
  useLayoutEffect(() => {
    const strip = ref.current;
    const chip = strip && strip.querySelector('.q2-chip.is-viewed');
    if (!strip || !chip) return;
    const left = Math.max(0, chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2);
    if (typeof strip.scrollTo === 'function') strip.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
    else strip.scrollLeft = left;
  }, [viewKey]);
  const groups = [];
  for (const day of days) {
    const date = parseDayKey(day.date);
    const month = date.getMonth();
    if (!groups.length || groups[groups.length - 1].month !== month) groups.push({ month, key: day.date, chips: [] });
    const viewed = day.date === viewKey;
    groups[groups.length - 1].chips.push(html`
      <label class=${cx('q2-chip', viewed && 'is-viewed', pickDate === day.date && 'is-picked')} key=${day.date} data-testid=${`q2-day-${day.date}`}>
        <input class="q2-chip__input" type="radio" name="q2-day" value=${day.date} checked=${viewed} onChange=${() => onView(day.date)} />
        <span class="u-sr-only">${chipLabel(day)}</span>
        <span class="q2-chip__dow" aria-hidden="true">${DAY_SHORT[date.getDay()]}</span>
        <span class="q2-chip__num lp-logovoice" aria-hidden="true">${date.getDate()}</span>
        <span class="q2-chip__halves" aria-hidden="true">${day.slots.map((s) => html`<i class=${cx('q2-chip__half', s.free ? 'is-free' : 'is-booked')} key=${s.windowId}>${partOfDay(s.windowId) === 'Morning' ? 'AM' : 'PM'}</i>`)}</span>
      </label>`);
  }
  return html`<div class="q2-strip" role="radiogroup" aria-label="Choose a day" data-testid="q2-strip" ref=${ref}>
    ${groups.map((g) => html`<div class="q2-strip__group" key=${g.key}>
      <span class="q2-strip__month" aria-hidden="true">${MONTH_LONG[g.month]}</span>
      <div class="q2-strip__days">${g.chips}</div>
    </div>`)}
  </div>`;
}

function Problem({ problem, brand, onPickAlt }) {
  if (!problem) return null;
  const alts = Array.isArray(problem.alternatives) ? problem.alternatives : [];
  return html`
    <${Banner} tone=${problem.tone === 'ok' ? 'ok' : problem.tone} data-testid="q2-slot-problem" class="q2-problem"
      actions=${problem.contact ? html`<${Button} size="sm" variant="secondary" href=${brand.telHref}>Call ${brand.phone}<//>` : null}>
      <strong>${problem.title}.</strong> ${problem.text}
      ${alts.length ? html`<span class="q2-alts" data-testid="q2-slot-alts">
        ${alts.map((a, i) => html`<button type="button" class="q2-alt" key=${`${a.date}-${a.windowId}`} data-testid=${`q2-slot-alt-${i}`}
          onClick=${() => onPickAlt(a.date, a.windowId)}><span>${a.human}</span></button>`)}
      </span>` : null}
    <//>
  `;
}

/**
 * The accept flow in a sheet. Step 1 is a strip of the free days (live from the availability engine, so a day taken in the meantime
 * disappears) with the two halves of the chosen day underneath; step 2 shows what is being accepted, with Accept right under the
 * agreement. `onAccepted(result)` runs once the store has accepted the quote.
 */
export function AcceptFlow({ open, state, d, brand, onClose, onAccepted }) {
  const [step, setStep] = useState('pick');
  const [pick, setPick] = useState(null);
  const [viewDay, setViewDay] = useState('');
  const [problem, setProblem] = useState(null);
  const working = useRef(false);

  // A layout effect, not a passive one: the reset must land before the first key press or tap, or it could wipe a choice made that fast.
  useLayoutEffect(() => {
    if (open) { setStep('pick'); setPick(null); setViewDay(''); setProblem(null); working.current = false; }
  }, [open]);

  if (!open) return html`<${Sheet} open=${false} title="Choose your install day" />`;

  const days = installDays(state);
  const pickFree = !!pick && isSlotFree(state, { date: pick.date, windowId: pick.windowId, blocks: 2 });
  const active = pickFree ? pick : null;
  const gone = !!pick && !pickFree;
  const where = step === 'confirm' && active ? 'confirm' : 'pick';
  const shown = problem || (gone ? { tone: 'warn', title: 'That day was just taken', text: 'Please choose another.' } : null);
  const owner = brand.ownerFirst;

  const hasDay = (key) => !!key && days.some((day) => day.date === key);
  // Nothing is chosen (or even shown) until the customer taps a day: no day is pre-selected.
  const viewKey = hasDay(viewDay) ? viewDay : (active && hasDay(active.date) ? active.date : '');
  const viewed = days.find((day) => day.date === viewKey) || null;
  const soonest = days[0] ? { date: days[0].date, windowId: days[0].slots.find((slot) => slot.free).windowId } : null;
  const soonestChosen = !!active && !!soonest && active.date === soonest.date && active.windowId === soonest.windowId;

  const choose = (date, windowId) => { setPick({ date, windowId }); setViewDay(date); setProblem(null); };
  const quickPick = (date, windowId) => { setPick({ date, windowId }); setViewDay(date); setProblem(null); setStep('confirm'); };

  const accept = () => {
    if (working.current || !active) return;
    working.current = true;
    let result;
    try {
      result = acceptQuote(d.quote.id, { date: active.date, windowId: active.windowId });
    } catch (err) {
      console.error('acceptQuote failed', err);
      result = { ok: false, reason: 'error' };
    }
    working.current = false;
    if (result && result.ok) { onAccepted(result); return; }
    const info = explainFailure(result, brand);
    if (info.close) { onClose(info); return; }
    setProblem(info);
    setStep('pick');
    if (result && result.reason === 'slot_taken') setPick(null);
  };

  const helpText = `Hi ${owner}, it's ${d.quote.customerName}. I'd like to accept my quote ${d.quote.id} but I can't see a free install day. Could you suggest one?`;
  const title = where === 'confirm' ? 'Check and accept' : 'Choose your install day';

  let body;
  let footer = null;
  if (where === 'confirm') {
    body = html`
      <${StepFocus} key="confirm" as="h3" class="q2-sheet__h" testid="q2-confirm-heading">Your install day<//>
      <div class="q2-confirm__slot" data-testid="q2-confirm-slot">
        <${DateBox} dayKey=${active.date} />
        <div class="q2-confirm__when">
          <p class="q2-confirm__day">${fmtDayLong(active.date)}</p>
          <p class="q2-confirm__part">${windowLine(active.windowId)}</p>
          <button type="button" class="q2-changebtn" onClick=${() => setStep('pick')} data-testid="q2-slot-change"><span>Change</span></button>
        </div>
      </div>
      <dl class="q2-confirm__rows">
        <div><dt>Quote</dt><dd class="u-mono">${d.quote.id}</dd></div>
        ${d.quote.brand ? html`<div><dt>Charger</dt><dd>${d.quote.brand}</dd></div>` : null}
        <div class="q2-confirm__sum"><dt>Total</dt><dd>${money(shownTotal(d))}</dd></div>
      </dl>
      <p class="q2-confirm__fine">By accepting you agree to the prices and notes on this quote. We will confirm your install day with you. Nothing is paid on this page.</p>
      <${Problem} problem=${shown} brand=${brand} onPickAlt=${quickPick} />
      <div class="q2-sheet__actions" key="foot-confirm">
        <${Button} variant="secondary" size="lg" onClick=${() => setStep('pick')} data-testid="q2-slot-back" aria-label="Back to the choice of day"><span class="q2-back">Back</span><//>
        <${Button} variant="primary" size="lg" block onClick=${accept} data-testid="q2-slot-confirm">Accept quote<//>
      </div>`;
  } else {
    body = html`
      <${StepFocus} key="pick" class="q2-sheet__lead" testid="q2-pick-heading">
        Choose a day and a time of day that suit you, and we will confirm it with you.
      <//>
      <${Problem} problem=${shown} brand=${brand} onPickAlt=${quickPick} />
      ${days.length
    ? html`
        <button type="button" class=${cx('q2-soonest', soonestChosen && 'is-selected')} onClick=${() => choose(soonest.date, soonest.windowId)}
          aria-pressed=${soonestChosen ? 'true' : 'false'} data-testid="q2-soonest">
          <span class="q2-soonest__text">
            <span class="q2-soonest__k">Soonest available</span>
            <span class="q2-soonest__v">${soonestText(soonest.date, soonest.windowId)}</span>
          </span>
          <span class="q2-soonest__go" aria-hidden="true">${soonestChosen ? 'Chosen' : 'Choose'}</span>
        </button>
        <div class="q2-pickhead">
          <p class="q2-label q2-pickstep" data-testid="q2-pickstep-day">Choose a day</p>
          <p class="q2-key" aria-hidden="true" data-testid="q2-key">
            <span class="q2-key__item"><i class="q2-chip__half is-free">PM</i>Free</span>
            <span class="q2-key__item"><i class="q2-chip__half is-booked">PM</i>Booked</span>
          </p>
        </div>
        <${DayStrip} days=${days} viewKey=${viewKey} pickDate=${active ? active.date : ''} onView=${setViewDay} />
        ${viewed
    ? html`
        <div class="q2-slots" data-testid="q2-slots" role="radiogroup" aria-labelledby="q2-day-head">
          <p class="q2-label q2-pickstep" data-testid="q2-pickstep-half">Choose morning or afternoon</p>
          <h3 class="q2-day__head" id="q2-day-head" data-testid="q2-day-head">${dayTitle(viewed.date, todayKey())}</h3>
          <div class="q2-day__opts">
            ${viewed.slots.map((slot) => html`<${SlotOption} key=${`${viewed.date}-${slot.windowId}`} date=${viewed.date} windowId=${slot.windowId} free=${slot.free}
              selected=${!!active && active.date === viewed.date && active.windowId === slot.windowId} onPick=${choose} />`)}
          </div>
        </div>`
    : null}`
    : html`
        <div class="q2-empty" data-testid="q2-slot-empty">
          <p class="q2-empty__title">No free install days in the next two weeks</p>
          <p class="q2-empty__text">We can usually find you a day. Call or WhatsApp and we will sort it out.</p>
          <div class="q2-row q2-row--even">
            <${Button} variant="primary" href=${brand.telHref}>Call ${brand.phone}<//>
            <${Button} variant="secondary" href=${waLink(brand.phone, helpText, brand.demoPhoneDigits)}>WhatsApp<//>
          </div>
        </div>`}`;
    footer = html`
      <div class="q2-sheet__foot" key="foot-pick">
        <p class="q2-sheet__sum" data-testid="q2-slot-summary" aria-live="polite">${active ? slotShort(active.date, active.windowId) : (viewed ? 'Choose morning or afternoon' : 'Choose a day')}</p>
        <${Button} variant="primary" size="lg" block disabled=${!active} onClick=${() => setStep('confirm')} data-testid="q2-slot-continue">Continue<//>
      </div>`;
  }

  // Both steps are short, so the sheet fits its content: no void between the text and the buttons (Accept sits right under the agreement).
  // The same head on both steps: the funnel's black bar with his logo and "Close", then "Step 1 of 2" or "Step 2 of 2" and the title.
  const stepLabel = days.length || where === 'confirm' ? (where === 'confirm' ? 'Step 2 of 2' : 'Step 1 of 2') : '';
  const header = html`<${SheetBar} brand=${brand} title=${title} step=${stepLabel} onClose=${() => onClose(null)} />`;
  return html`<${Sheet} open=${true} size="auto" title=${title} header=${header} onClose=${() => onClose(null)} footer=${footer}
    initialFocus="[data-q2-focus]" testid="q2-accept-sheet">${body}<//>`;
}
