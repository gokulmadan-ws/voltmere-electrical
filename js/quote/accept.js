// js/quote/accept.js: the "Accept quote" flow: choose an install day from the real availability engine, check it, accept (with friendly recovery).
// Owner: Q2 (customer quote page)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Banner, Button, Icon, Sheet, cx } from '../ui/index.js';
import { acceptQuote } from '../core/store.js';
import { getBookableDays, getDaySlots, isSlotFree } from '../core/availability.js';
import { todayKey } from '../core/clock.js';
import { fmtDayLong } from '../core/dates.js';
import { waLink } from '../core/messages.js';
import { DateBox, StepFocus } from './parts.js';
import { WINDOWS } from '../core/config.js';
import { arriveText, dayHeading, money, partOfDay, slotShort } from './format.js';

const HORIZON_DAYS = 14;

/** Days in the next two weeks that still have a free half-day, each with its two options (morning, afternoon). */
export function freeInstallDays(state) {
  const days = getBookableDays(state, { count: HORIZON_DAYS, serviceOrBlocks: 'ev' });
  return days
    .filter((day) => day.freeSlots > 0)
    .map((day) => ({
      date: day.date,
      slots: getDaySlots(state, day.date, 'ev').map((s) => ({ windowId: s.windowId, free: s.state === 'free' }))
    }));
}

/** A plain-English reading of a failed acceptQuote, with what to do about it. `close` means the sheet cannot help any more. */
export function explainFailure(result, brand) {
  const owner = brand.ownerFirst;
  switch (result && result.reason) {
    case 'slot_taken':
      return { tone: 'warn', title: 'That day was just taken', text: 'Sorry, someone got there first. Here are the next free days, or choose another below.', alternatives: result.alternatives || [] };
    case 'expired':
      return { tone: 'danger', title: 'This quote has expired', text: `It can't be accepted any more. ${owner} can send you an updated one.`, close: true };
    case 'already_accepted':
      return { tone: 'ok', title: 'This quote is already accepted', text: 'Nothing more to do. Your install day is on the page.', close: true };
    case 'bad_transition':
      return { tone: 'danger', title: "This quote can't be accepted now", text: `It has been closed or is not ready yet. Please call ${owner} to sort it out.`, close: true };
    case 'service_unavailable':
      return { tone: 'danger', title: "Install days can't be booked here right now", text: `Please call or WhatsApp ${owner} and he will find you a day.`, contact: true };
    case 'invalid':
      return { tone: 'warn', title: 'Please choose a day', text: 'Pick a morning or afternoon first.' };
    case 'storage_full':
      return { tone: 'danger', title: "Couldn't save this on your device", text: `Your device has no room left, so nothing was changed. Free up some space and try again, or call ${owner}.`, contact: true };
    case 'not_found':
      return { tone: 'danger', title: "We can't find this quote on this device", text: `Nothing was changed. Please call ${owner}.`, contact: true };
    default:
      return { tone: 'danger', title: 'Something went wrong', text: `Nothing was changed. Please try again, or call ${owner}.`, contact: true };
  }
}

function SlotOption({ date, windowId, free, selected, onPick }) {
  const label = partOfDay(windowId);
  return html`
    <label class=${cx('q2-slot', selected && 'is-selected', !free && 'is-taken')} data-testid=${`q2-slot-${date}-${windowId}`}>
      <input class="q2-slot__input" type="radio" name="q2-slot" value=${`${date}|${windowId}`} checked=${selected}
        disabled=${!free} onChange=${() => onPick(date, windowId)} />
      <span class="q2-slot__main">
        <span class="q2-slot__part"><span class="u-sr-only">${fmtDayLong(date)}, </span>${label}</span>
        <span class="q2-slot__arrive">${free ? `Arrive ${WINDOWS[windowId].label}` : 'Not available'}</span>
      </span>
      <span class="q2-slot__tick" aria-hidden="true"><${Icon} name="check" size=${18} /></span>
    </label>
  `;
}

function Problem({ problem, brand, onPickAlt }) {
  if (!problem) return null;
  const alts = Array.isArray(problem.alternatives) ? problem.alternatives : [];
  return html`
    <${Banner} tone=${problem.tone === 'ok' ? 'ok' : problem.tone} data-testid="q2-slot-problem" class="q2-problem"
      actions=${problem.contact ? html`<${Button} size="sm" variant="secondary" icon="phone" href=${brand.telHref}>Call ${brand.phone}<//>` : null}>
      <strong>${problem.title}.</strong> ${problem.text}
      ${alts.length ? html`<span class="q2-alts" data-testid="q2-slot-alts">
        ${alts.map((a, i) => html`<button type="button" class="q2-alt" key=${`${a.date}-${a.windowId}`} data-testid=${`q2-slot-alt-${i}`}
          onClick=${() => onPickAlt(a.date, a.windowId)}><${Icon} name="calendar-check" size=${18} /><span>${a.human}</span></button>`)}
      </span>` : null}
    <//>
  `;
}

/**
 * The accept flow in a sheet. Step 1 lists the free half-days (live from the availability engine, so a day taken in the meantime
 * disappears), step 2 shows what is being accepted. `onAccepted(result)` runs once the store has accepted the quote.
 */
export function AcceptFlow({ open, state, d, brand, onClose, onAccepted }) {
  const [step, setStep] = useState('pick');
  const [pick, setPick] = useState(null);
  const [problem, setProblem] = useState(null);
  const working = useRef(false);

  useEffect(() => {
    if (open) { setStep('pick'); setPick(null); setProblem(null); working.current = false; }
  }, [open]);

  if (!open) return html`<${Sheet} open=${false} title="Choose your install day" />`;

  const days = freeInstallDays(state);
  const pickFree = !!pick && isSlotFree(state, { date: pick.date, windowId: pick.windowId, blocks: 2 });
  const active = pickFree ? pick : null;
  const gone = !!pick && !pickFree;
  const where = step === 'confirm' && active ? 'confirm' : 'pick';
  const shown = problem || (gone ? { tone: 'warn', title: 'That day was just taken', text: 'Please choose another.' } : null);

  const choose = (date, windowId) => { setPick({ date, windowId }); setProblem(null); };
  const quickPick = (date, windowId) => { setPick({ date, windowId }); setProblem(null); setStep('confirm'); };

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

  const helpText = `Hi ${brand.ownerFirst}, it's ${d.quote.customerName}. I'd like to accept my quote ${d.quote.id} but I can't see a free install day. Could you suggest one?`;
  const title = where === 'confirm' ? 'Check and accept' : 'Choose your install day';

  let body;
  let footer;
  if (where === 'confirm') {
    body = html`
      <${StepFocus} key="confirm" as="h3" class="q2-sheet__h" testid="q2-confirm-heading">Your install day<//>
      <div class="q2-confirm__slot" data-testid="q2-confirm-slot">
        <${DateBox} dayKey=${active.date} />
        <div class="q2-confirm__when">
          <p class="q2-confirm__day">${fmtDayLong(active.date)}</p>
          <p class="q2-confirm__part">${partOfDay(active.windowId)}, arriving ${arriveText(active.windowId)}</p>
        </div>
        <button type="button" class="q2-linkbtn" onClick=${() => setStep('pick')} data-testid="q2-slot-change">Change</button>
      </div>
      <dl class="q2-confirm__rows">
        <div><dt>Quote</dt><dd class="u-mono">${d.quote.id}</dd></div>
        ${d.quote.brand ? html`<div><dt>Charger</dt><dd>${d.quote.brand}</dd></div>` : null}
        <div class="q2-confirm__sum"><dt>Total</dt><dd>${money(d.total)}</dd></div>
      </dl>
      <p class="q2-confirm__fine">By accepting you agree to the prices and notes on this quote. Your day is pencilled in until ${brand.ownerFirst} confirms it with you. No payment is taken on this page.</p>
      <${Problem} problem=${shown} brand=${brand} onPickAlt=${quickPick} />`;
    footer = html`
      <div class="q2-sheet__actions" key="foot-confirm">
        <${Button} variant="secondary" size="lg" icon="arrow-left" onClick=${() => setStep('pick')} data-testid="q2-slot-back" aria-label="Back to the list of days"><span class="q2-back">Back</span><//>
        <${Button} variant="primary" size="lg" block icon="check" onClick=${accept} data-testid="q2-slot-confirm">Accept quote<//>
      </div>`;
  } else {
    body = html`
      <${StepFocus} key="pick" class="q2-sheet__lead" testid="q2-pick-heading">
        Installation takes about half a day. Pick a morning or afternoon that suits you, and ${brand.ownerFirst} will confirm it.
      <//>
      <${Problem} problem=${shown} brand=${brand} onPickAlt=${quickPick} />
      ${days.length
    ? html`
        <fieldset class="q2-slots" data-testid="q2-slots">
          <legend class="u-sr-only">Install day</legend>
          ${days.map((day) => html`
            <div class="q2-day" key=${day.date} role="group" aria-labelledby=${`q2-day-${day.date}`}>
              <h3 class="q2-day__head" id=${`q2-day-${day.date}`}>${dayHeading(day.date, todayKey())}</h3>
              <div class="q2-day__opts">
                ${day.slots.map((s) => html`<${SlotOption} key=${s.windowId} date=${day.date} windowId=${s.windowId} free=${s.free}
                  selected=${!!active && active.date === day.date && active.windowId === s.windowId} onPick=${choose} />`)}
              </div>
            </div>`)}
        </fieldset>
        <p class="q2-sheet__small">Showing the next two weeks. Days that are full or closed are left out.</p>`
    : html`
        <div class="q2-empty" data-testid="q2-slot-empty">
          <${Icon} name="calendar-x" size=${40} />
          <p class="q2-empty__title">No free install days in the next two weeks</p>
          <p class="q2-empty__text">${brand.ownerFirst} can usually find you a day. Call or WhatsApp and he will sort it out.</p>
          <div class="q2-row q2-row--even">
            <${Button} variant="primary" icon="phone" href=${brand.telHref}>Call ${brand.phone}<//>
            <${Button} variant="secondary" icon="message-circle" href=${waLink(brand.phone, helpText, brand.demoPhoneDigits)}>WhatsApp<//>
          </div>
        </div>`}`;
    footer = html`
      <div class="q2-sheet__foot" key="foot-pick">
        <p class="q2-sheet__sum" data-testid="q2-slot-summary" aria-live="polite">${active ? slotShort(active.date, active.windowId) : 'Choose a day to continue'}</p>
        <${Button} variant="primary" size="lg" block iconRight="arrow-right" disabled=${!active} onClick=${() => setStep('confirm')} data-testid="q2-slot-continue">Continue<//>
      </div>`;
  }

  return html`<${Sheet} open=${true} size="full" title=${title} onClose=${() => onClose(null)} footer=${footer}
    initialFocus="[data-q2-focus]" testid="q2-accept-sheet">${body}<//>`;
}
