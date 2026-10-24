// js/dashboard/shared/lead.js: lead source helpers and the LeadChip (where an enquiry came from).
// Owner: E3
import { html } from '../../vendor/preact-htm.js';
import { Icon, cx, loadCss } from '../../ui/index.js';
import { LEAD_SOURCE_LABELS } from '../../core/config.js';
import { leadSourceOf } from '../../core/selectors.js';

if (typeof document !== 'undefined') loadCss('css/bookings.css');

const ICONS = { facebook: 'megaphone', instagram: 'camera', google: 'search', referral: 'users', phone: 'phone', other: 'globe' };

/** { id, label, icon } for a booking's lead source. */
export function leadOf(booking) {
  const id = leadSourceOf(booking);
  return { id, label: LEAD_SOURCE_LABELS[id] || id, icon: ICONS[id] || 'globe' };
}

/** "Paid social · ev_charger_leads" style detail from the utm, or ''. */
export function leadDetail(booking) {
  const u = booking && booking.utm;
  if (!u) return '';
  const medium = String(u.medium || '').replace(/_/g, ' ');
  return [medium, u.campaign].filter(Boolean).join(' · ');
}

export function LeadChip({ booking, class: cls, ...rest }) {
  const lead = leadOf(booking);
  return html`<span class=${cx('sh-lead', `sh-lead--${lead.id}`, cls)} data-lead=${lead.id} ...${rest}>
    <${Icon} name=${lead.icon} size=${14} /><span>${lead.label}</span>
  </span>`;
}
