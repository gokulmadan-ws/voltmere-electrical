// js/dashboard/views/insights.js: Insights (collected, owed, nudge, mark paid, weekly bars, by service).
// Owner: WP7
import { html, useMemo } from '../../vendor/preact-htm.js';
import {
  Button, Card, EmptyState, PageHeader, Stat, toast, useBrand, useNow, useStore
} from '../../ui/index.js';
import { selectInsights, selectOwed } from '../../core/selectors.js';
import { sendPaymentNudge } from '../../core/store.js';
import { MONTH_LONG, diffDays, parseDayKey, stampDay, toStamp } from '../../core/dates.js';
import { gbp, plural } from '../../core/format.js';
import { waLink } from '../../core/messages.js';
import { routeHref } from '../router.js';
import { PaidButton } from '../shared/job-actions.js';

export const title = 'Insights';
export const css = ['css/insights.css', 'css/bookings.css'];

// Whole state (identity is stable between mutations); the selectors below build fresh objects, so they run inside useMemo.
const selectState = (state) => state;

const priceOf = (b) => (b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);

/** Generic failure rule (8.3): a reason this screen does not handle specially. */
function failToast(res) {
  toast({
    message: res && res.reason === 'not_found'
      ? 'That booking no longer exists.'
      : 'That did not work: the diary changed. Please check and try again.',
    tone: 'danger'
  });
}

function daysAgoText(booking, todayDay) {
  const n = diffDays(stampDay(booking.start), todayDay);
  if (n <= 0) return 'today';
  return n === 1 ? '1 day ago' : `${n} days ago`;
}

function OwedRow({ booking, todayDay, brand }) {
  const b = booking;
  const nudge = () => {
    const res = sendPaymentNudge(b.id);
    if (!res || !res.ok) { failToast(res); return; }
    // The message is only logged here; the wa.me link opens the owner's own WhatsApp with the same text.
    window.open(waLink(b.customer.phone, res.message.body, brand.demoPhoneDigits), '_blank', 'noopener,noreferrer');
    toast({ message: 'Payment reminder logged (simulated).' });
  };
  return html`<li class="in-owed__row" data-testid=${`owed-row-${b.id}`}>
    <div class="in-owed__top">
      <a class="in-owed__who" href=${routeHref('bookings', { id: b.id })}>
        <span class="in-owed__name">${b.customer.name}</span>
        <span class="in-owed__meta">${b.serviceName} · ${daysAgoText(b, todayDay)}</span>
      </a>
      <span class="in-owed__amount">${gbp(priceOf(b))}</span>
    </div>
    <div class="in-owed__actions">
      <${Button} size="sm" icon="message-circle" onClick=${nudge} data-testid=${`owed-nudge-${b.id}`}>Nudge<//>
      <${PaidButton} booking=${b} size="sm" />
    </div>
  </li>`;
}

function WeekBars({ weeks }) {
  const max = Math.max(1, ...weeks.map((w) => w.total));
  return html`<div class="in-weeks" data-testid="insights-weeks">
    <ol class="in-weeks__list" aria-hidden="true">
      ${weeks.map((w, i) => {
        // A tiny payment still gets a visible sliver.
        const pct = w.total > 0 ? Math.max(4, Math.round((w.total / max) * 100)) : 0;
        return html`<li class=${`in-week${i === weeks.length - 1 ? ' is-current' : ''}`} key=${w.weekStart} data-testid=${`insights-weekbar-${i}`}>
          <span class="in-week__label">${w.label}</span>
          <span class="in-week__track"><span class="in-week__fill" style=${{ width: `${pct}%` }}></span></span>
          <span class="in-week__value">${gbp(w.total)}</span>
        </li>`;
      })}
    </ol>
    <div class="u-sr-only">
      <table>
        <caption>Collected per week, weeks starting on the Monday shown</caption>
        <thead><tr><th scope="col">Week starting</th><th scope="col">Collected</th></tr></thead>
        <tbody>${weeks.map((w) => html`<tr key=${w.weekStart}><th scope="row">${w.label}</th><td>${gbp(w.total)}</td></tr>`)}</tbody>
      </table>
    </div>
  </div>`;
}

export default function InsightsView() {
  const state = useStore(selectState);
  const brand = useBrand();
  const stamp = toStamp(useNow(60000));
  const todayDay = stampDay(stamp);
  const ins = useMemo(() => selectInsights(state, stamp), [state, stamp]);
  const owed = useMemo(() => selectOwed(state), [state]);
  const monthName = MONTH_LONG[parseDayKey(todayDay).getMonth()];

  return html`<div class="db-page in-page">
    <${PageHeader} title="Insights" subtitle=${`${monthName} so far`} />

    <div class="in-stats">
      <${Stat} label="Collected this month" value=${gbp(ins.collectedMonth)} hint=${plural(ins.collectedMonthCount, 'job')} tone="ok" data-testid="insights-collected" />
      <${Stat} label="Owed to you" value=${gbp(ins.owedTotal)} hint=${plural(ins.owedCount, 'job')} tone=${ins.owedCount > 0 ? 'accent' : undefined} data-testid="insights-owed" />
      <${Stat} label="Booked next 14 days" value=${gbp(ins.bookedNext14)} hint=${plural(ins.bookedNext14Count, 'booking')} data-testid="insights-booked-next" />
      <${Stat} label="Average job" value=${gbp(ins.avgJob)} hint="last 30 days" data-testid="insights-avg" />
    </div>

    <div class="db-two-col in-cols">
      <div class="db-stack">
        <section class="db-section">
          <h2 class="db-section__title">Owed to you</h2>
          ${owed.length === 0
            ? html`<${Card}><${EmptyState} icon="circle-check" title="Nothing to collect. Nice." data-testid="owed-empty" /><//>`
            : html`<ul class="db-list in-owed" data-testid="owed-list">
              ${owed.map((b) => html`<${OwedRow} key=${b.id} booking=${b} todayDay=${todayDay} brand=${brand} />`)}
            </ul>`}
        </section>
      </div>

      <div class="db-stack">
        <section class="db-section">
          <h2 class="db-section__title">Collected per week</h2>
          <${Card}>
            <${WeekBars} weeks=${ins.weeks} />
            <p class="in-caption">Counted in the week the payment was marked. Weeks start on Monday.</p>
          <//>
        </section>

        ${ins.byService.length > 0 ? html`<section class="db-section">
          <h2 class="db-section__title">By service</h2>
          <ul class="db-list" data-testid="insights-by-service">
            ${ins.byService.map((s) => html`<li class="db-list__item in-svc" key=${s.serviceId}>
              <span class="in-svc__name">${s.name}</span>
              <span class="in-svc__jobs">${plural(s.jobs, 'job')}</span>
              <span class="in-svc__total">${gbp(s.total)}</span>
            </li>`)}
          </ul>
        </section>` : null}
      </div>
    </div>

    <p class="in-note">Figures come from the sample bookings in this browser.</p>
  </div>`;
}
