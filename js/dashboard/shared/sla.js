// js/dashboard/shared/sla.js: reply-promise helpers (waiting test, countdown text) and the SlaChip shown on enquiries.
// Owner: E3
import { html } from '../../vendor/preact-htm.js';
import { Icon, cx, loadCss } from '../../ui/index.js';
import { SLA_DUE_SOON_MINUTES } from '../../core/config.js';
import { addMinutes, minutesBetween } from '../../core/dates.js';

if (typeof document !== 'undefined') loadCss('css/bookings.css');

// Mirrors js/core/pipeline.js: these history events are not a "reply" to a new enquiry.
const NOT_A_REPLY = ['created', 'note', 'paid', 'unpaid'];

/** An enquiry still waiting for its first reply from the owner (the clock the reply promise runs on). */
export function isWaitingForReply(b) {
  if (!b || b.serviceId !== 'ev_quote' || b.urgent || b.status !== 'new') return false;
  return !(b.history || []).some((h) => h.by === 'owner' && !NOT_A_REPLY.includes(h.event));
}

/** Minutes as short plain text: "45 min", "3 h 20 min", "23 h", "3 days". */
export function fmtSpan(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 600) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  if (m < 2880) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} days`;
}

/**
 * The reply countdown for one enquiry, or null when it is not waiting.
 * { state: 'ok' | 'due_soon' | 'overdue', minutes (left, or past due), dueAt, label, short }
 */
export function slaFor(booking, replyHours, nowStampStr) {
  if (!isWaitingForReply(booking)) return null;
  const dueAt = addMinutes(booking.createdAt, replyHours * 60);
  const left = minutesBetween(nowStampStr, dueAt);
  if (left < 0) return { state: 'overdue', minutes: -left, dueAt, label: `Overdue by ${fmtSpan(-left)}`, short: `${fmtSpan(-left)} overdue` };
  const state = left <= SLA_DUE_SOON_MINUTES ? 'due_soon' : 'ok';
  return { state, minutes: left, dueAt, label: state === 'ok' ? `Reply due in ${fmtSpan(left)}` : `Due in ${fmtSpan(left)}`, short: fmtSpan(left) };
}

const ICON = { ok: 'timer', due_soon: 'hourglass', overdue: 'triangle-alert' };
const MOD = { ok: 'ok', due_soon: 'soon', overdue: 'late' };

/** Countdown chip. Never colour alone: icon plus words. `sla` comes from slaFor(). */
export function SlaChip({ sla, class: cls, ...rest }) {
  if (!sla) return null;
  return html`<span class=${cx('sh-sla', `sh-sla--${MOD[sla.state]}`, cls)} data-sla=${sla.state} ...${rest}>
    <${Icon} name=${ICON[sla.state]} size=${16} /><span>${sla.label}</span>
  </span>`;
}
