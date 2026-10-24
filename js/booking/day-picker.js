// js/booking/day-picker.js: DayPicker, the wrapping grid of bookable days (7 columns from 375px, 5 below; 5.4).
// Owner: WP3
import { html } from '../vendor/preact-htm.js';
import { DAY_SHORT, fmtDayShort, weekdayOf } from '../core/dates.js';
import { cx } from '../ui/index.js';

/** Level and words for one getBookableDays() entry. It reads the SERVICE-specific freeSlots, never load.level (9.3). */
export function dayLevel(day) {
  const kind = day.status.kind;
  if (kind === 'past' || kind === 'beyond' || kind === 'dayoff' || kind === 'closed') return { level: 'closed', text: 'Closed' };
  if (kind === 'full' || day.freeSlots === 0) return { level: 'full', text: 'Full' };
  if (day.freeSlots === 1) return { level: 'few', text: '1 left' };
  return { level: 'good', text: '2 or more windows free' };
}

export const dayIsSelectable = (day) => {
  const l = dayLevel(day).level;
  return l === 'good' || l === 'few';
};

/** `days` from getBookableDays; `selected` a day key; `onSelect(dayKey)`; `todayKey` for the ring. */
export function DayPicker({ days, selected, onSelect, todayKey }) {
  return html`<div class="bk-days" role="group" aria-label="Choose a day">
    ${days.map((day) => {
    const lv = dayLevel(day);
    const on = day.date === selected;
    const dis = !dayIsSelectable(day);
    return html`<button type="button" key=${day.date}
      class=${cx('bk-day', 'bk-day--' + lv.level, on && 'is-selected', day.date === todayKey && 'is-today')}
      data-testid=${'day-chip-' + day.date}
      aria-pressed=${on} aria-label=${fmtDayShort(day.date) + ', ' + lv.text}
      disabled=${dis} onClick=${() => onSelect(day.date)}>
      <span class="bk-day__wd">${DAY_SHORT[weekdayOf(day.date)]}</span>
      <span class="bk-day__num">${Number(day.date.slice(8))}</span>
      <span class="bk-day__dot" aria-hidden="true"></span>
    </button>`;
  })}
  </div>
  <p class="bk-legend" aria-hidden="true">
    <span class="bk-legend__item"><i class="bk-legend__dot bk-legend__dot--good"></i>Plenty free</span>
    <span class="bk-legend__item"><i class="bk-legend__dot bk-legend__dot--few"></i>1 left</span>
    <span class="bk-legend__item"><i class="bk-legend__dot bk-legend__dot--full"></i>Full or closed</span>
    <span class="bk-legend__item"><i class="bk-legend__ring"></i>Today</span>
  </p>`;
}
