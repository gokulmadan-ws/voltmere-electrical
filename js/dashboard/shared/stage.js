// js/dashboard/shared/stage.js: pipeline stage pill and a booking-id to journey lookup for list screens.
// Owner: E3
import { html } from '../../vendor/preact-htm.js';
import { Icon, cx, loadCss } from '../../ui/index.js';
import { PIPELINE_STAGES } from '../../core/config.js';

if (typeof document !== 'undefined') loadCss('css/bookings.css');

export const STAGE_IDS = PIPELINE_STAGES.map((s) => s.id);
export const STAGE_LABELS = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.id, s.label]));
const ICONS = { enquiry: 'bell', survey: 'clipboard-check', quote: 'file-text', accepted: 'badge-check', install: 'plug-zap', done: 'circle-check', lost: 'ban' };

/** Map of booking id -> PipelineItem, for the enquiry AND its install booking (so every row can show its stage). */
export function stageMapOf(pipeline) {
  const map = new Map();
  const add = (item) => {
    map.set(item.bookingId, item);
    if (item.installBookingId) map.set(item.installBookingId, item);
  };
  pipeline.stages.forEach((s) => s.items.forEach(add));
  pipeline.lost.forEach(add);
  return map;
}

export function StagePill({ stage, compact, class: cls, ...rest }) {
  if (!stage) return null;
  return html`<span class=${cx('sh-stage', `sh-stage--${stage}`, compact && 'sh-stage--compact', cls)} data-stage=${stage} ...${rest}>
    <${Icon} name=${ICONS[stage] || 'circle'} size=${14} /><span>${STAGE_LABELS[stage] || stage}</span>
  </span>`;
}
