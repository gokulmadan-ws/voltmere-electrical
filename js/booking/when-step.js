// js/booking/when-step.js: Step 1 "When suits you?" (service chip, EICR size, Soonest card, day picker, windows).
// Owner: WP3
import { html } from '../vendor/preact-htm.js';
import { Icon, Button, Chip, Segmented } from '../ui/index.js';
import { getBookableDays, getDaySlots, nextFreeSlot } from '../core/availability.js';
import { servicePriceLabel } from '../core/selectors.js';
import { PROMISES, WINDOWS } from '../core/config.js';
import { fmtDayShort, fmtDayLong } from '../core/dates.js';
import { todayKey } from '../core/clock.js';
import { gbp } from '../core/format.js';
import { StepTitle, SlotTakenBanner, ContactButtons } from './bk-shared.js';
import { DayPicker, dayIsSelectable } from './day-picker.js';

export function WhenStep({ ctx }) {
  const { state, now, ownerMode, brand, svc, form, setForm, pick, setPick, banner, setBanner, go, pickAlternative } = ctx;
  const opts = { now, ownerMode };
  // Owner mode and the reschedule sheet show 28 days; customers see the horizon (settings.maxDaysAhead).
  const days = getBookableDays(state, { count: ownerMode ? 28 : undefined, serviceOrBlocks: svc.id, now, ownerMode });
  const soonest = nextFreeSlot(state, svc.id, opts);
  const anyFree = days.some((d) => d.freeSlots > 0);
  const today = todayKey();

  // The selected day: the one the user tapped, else the Soonest slot's day (no window preselected).
  const tapped = days.find((d) => d.date === pick.date && dayIsSelectable(d));
  const day = tapped ? tapped.date : (soonest ? soonest.date : null);
  const slots = day ? getDaySlots(state, day, svc.id, opts).filter((s) => ['free', 'booked', 'blocked'].includes(s.state)) : [];
  const anyFreeOnDay = slots.some((s) => s.state === 'free');
  const chosenHere = ctx.chosen && ctx.chosen.date === day ? ctx.chosen : null;
  const soonestPicked = ctx.chosen && soonest && ctx.chosen.date === soonest.date && ctx.chosen.windowId === soonest.windowId;

  const variants = svc.priceType === 'by_size' ? svc.variants : [];
  const variantId = form.variantId || svc.defaultVariantId;
  const announce = ctx.chosen ? `Selected ${fmtDayLong(ctx.chosen.date)}, ${ctx.chosen.arriveLabel}.` : '';

  const chooseDay = (date) => { setPick({ date, windowId: null }); setBanner(null); };
  const chooseWindow = (windowId) => { setPick({ date: day, windowId }); setBanner(null); };

  return html`<div class="bk-step">
    <${StepTitle}>When suits you?<//>
    <${Chip} class="bk-svc-chip" icon=${svc.icon} onClick=${() => go({})} data-testid="booking-service-chip">${svc.name} · ${servicePriceLabel(svc)} · Change<//>

    ${variants.length ? html`<div class="bk-block">
      <p class="bk-eyebrow" id="bk-size-label">Property size</p>
      <${Segmented} class="bk-size" ariaLabel="Property size" value=${variantId} onChange=${(v) => setForm({ variantId: v })}
        options=${variants.map((v) => ({ value: v.id, testid: 'eicr-size-' + v.id, label: html`<span class="bk-size__name">${v.label}</span>${' '}<span class="bk-size__price">${gbp(v.price)}</span>` }))} />
    </div>` : null}

    <${SlotTakenBanner} banner=${banner} onPick=${pickAlternative} />

    ${!anyFree ? html`<div class="bk-empty" data-testid="no-slots">
      <${Icon} name="calendar-x" size=${32} />
      <p>No free times for this job in the next ${state.settings.maxDaysAhead} days. Call or WhatsApp ${brand.ownerFirst} and I'll fit you in if I can.</p>
      <${ContactButtons} brand=${brand} />
    </div>` : html`
      ${soonest ? html`<div class="bk-soonest" data-testid="soonest-card">
        <div class="bk-soonest__text">
          <p class="bk-eyebrow bk-eyebrow--accent">Soonest</p>
          <p class="bk-soonest__when">${soonest.human}</p>
        </div>
        <${Button} variant="primary" size="sm" icon=${soonestPicked ? 'check' : undefined} onClick=${() => { setPick({ date: soonest.date, windowId: soonest.windowId }); setBanner(null); }} data-testid="soonest-pick" aria-pressed=${!!soonestPicked}>${soonestPicked ? 'Picked' : 'Pick this'}<//>
      </div>` : null}

      <div class="bk-block">
        <p class="bk-eyebrow">Or choose another day</p>
        <${DayPicker} days=${days} selected=${day} onSelect=${chooseDay} todayKey=${today} />
      </div>

      ${day ? html`<div class="bk-block">
        <p class="bk-eyebrow">${fmtDayShort(day)}${svc.blocks === 2 ? ' · takes about half a day' : ''}</p>
        ${!anyFreeOnDay ? html`<p class="bk-note" data-testid="no-slots-day">Nothing free that day. Try another day.</p>` : null}
        <div class="bk-windows">
          ${slots.map((s) => {
    const free = s.state === 'free';
    const on = !!chosenHere && chosenHere.windowId === s.windowId;
    return html`<button type="button" key=${s.windowId} class=${'bk-window' + (on ? ' is-selected' : '') + (free ? '' : ' is-booked')}
      data-testid=${'window-' + s.windowId} aria-pressed=${on} disabled=${!free} onClick=${() => chooseWindow(s.windowId)}>
      <span class="bk-window__label">${s.label}</span>
      <span class="bk-window__help">${!free ? 'Booked' : (s.blocks === 2 ? 'Takes about half a day.' : 'Arrive ' + WINDOWS[s.windowId].arrive)}</span>
      ${on ? html`<${Icon} name="check" size=${22} class="bk-window__tick" />` : null}
    </button>`;
  })}
        </div>
      </div>` : null}
    `}
    <div class="u-sr-only" role="status" aria-live="polite">${announce}</div>
  </div>`;
}

export function WhenFooter({ ctx }) {
  const { chosen, svc, go, ownerMode } = ctx;
  const can = !!chosen;
  return html`<div class="bk-footer">
    <p class="bk-footer__summary" data-testid="booking-summary">${can ? `${fmtDayShort(chosen.date)} · arrive ${chosen.arriveLabel}` : 'Choose a time to continue'}</p>
    <${Button} variant="primary" size="lg" block class=${can ? '' : 'is-disabled'} aria-disabled=${can ? undefined : 'true'}
      onClick=${() => { if (can) go({ serviceId: svc.id, date: chosen.date, windowId: chosen.windowId }); }} data-testid="booking-continue">Continue<//>
    ${ownerMode ? null : html`<p class="bk-footer__note">No payment now. Free to change up to ${PROMISES.freeChangeHours} hours before.</p>`}
  </div>`;
}
