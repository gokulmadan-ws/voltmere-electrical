// js/dashboard/views/pipeline.js: Pipeline, his sales process at a glance (a 3x2 grid of stage tiles, whole-card links with an urgency stripe, one slim
// reply reminder, Lost drawer, kanban of six compact columns from 1260px).
// Owner: P1 (round 2: T04)
import { html, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Button, Disclosure, EmptyState, Icon, IconButton, PageHeader, Segmented, cx, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { LEAD_SOURCE_LABELS } from '../../core/config.js';
import { selectPipeline, selectSla } from '../../core/selectors.js';
import { toStamp } from '../../core/dates.js';
import { firstName, outsideAreaLabel } from '../../core/format.js';
import { navigate, routeHref } from '../router.js';
import { QUOTE_STATUS_META, QuotePill } from './quotes.js';

export const title = 'Pipeline';
export const css = ['css/pipeline.css', 'css/quotes.css'];

// Whole state (identity is stable between mutations); the selectors build fresh objects, so they run inside useMemo.
const selectState = (state) => state;

// Six columns only fit side by side from here (about 150px each beside the 240px sidebar); below it the tiles and one list are used, so nothing scrolls sideways.
const WIDE = '(min-width: 1260px)';

// What each stage looks like and says when it is empty. The labels and hints come from PIPELINE_STAGES through selectPipeline.
const STAGE_UI = {
  enquiry: { icon: 'inbox', hint: 'Waiting for your reply', empty: { title: 'No enquiries waiting', body: 'New ones from your website land here, ready for your reply.' } },
  survey: { icon: 'calendar-check', hint: 'Free survey booked', empty: { title: 'No surveys booked', body: 'When you confirm an enquiry, its free survey shows here.' } },
  quote: { icon: 'file-text', hint: 'Quote to write, or out with the customer', empty: { title: 'No quotes to write or chase', body: 'After a survey, write the quote here and follow it up.' } },
  accepted: { icon: 'badge-check', hint: 'Accepted, install day to confirm', empty: { title: 'Nobody waiting for an install day', body: 'A customer who accepts a quote lands here until you confirm the day.' } },
  install: { icon: 'plug-zap', hint: 'Install day booked', empty: { title: 'No installs booked', body: 'Confirmed install days show here.' } },
  done: { icon: 'circle-check', hint: 'Installed', empty: { title: 'No finished installs yet', body: 'Completed jobs, and whether you have been paid, show here.' } }
};

const pounds = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
/** The core writes amounts in its summaries as £1394; show £1,394 like everywhere on this screen. */
const prettySummary = (text) => String(text || '').replace(/£(\d{4,})/g, (_, digits) => pounds(Number(digits)));

/** 12 min, 6 h, 3 days, 4 weeks. */
function spanText(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} days`;
  return `${Math.floor(d / 7)} weeks`;
}

const AGE_VERB = { enquiry: 'Arrived', survey: 'Confirmed', accepted: 'Accepted', install: 'Booked', done: 'Finished', lost: 'Closed' };

/** { verb, when }: 'Survey done' + '3 days ago'. The board's narrow card shows only the second half. */
function ageParts(item) {
  let verb = AGE_VERB[item.stage] || 'Updated';
  if (item.stage === 'quote') verb = item.quoteStatus === 'sent' || item.quoteStatus === 'viewed' ? 'Quote sent' : 'Survey done';
  return { verb, when: item.ageMinutes < 1 ? 'just now' : `${spanText(item.ageMinutes)} ago` };
}

/** The one-tap next step for a card: where to go and what to call it. */
function nextAction(item) {
  const enquiry = routeHref('bookings', { id: item.bookingId });
  const install = routeHref('bookings', { id: item.installBookingId || item.bookingId });
  switch (item.stage) {
    case 'enquiry':
      return { label: item.sla === 'overdue' ? 'Reply now' : 'Reply to enquiry', href: enquiry, icon: 'message-circle' };
    case 'survey':
      return { label: 'Open the survey', href: enquiry, icon: 'calendar-check' };
    case 'quote':
      if (!item.quoteId) return { label: 'Write the quote', href: routeHref('quote-detail', { id: 'new' }, { booking: item.bookingId }), icon: 'file-plus' };
      if (item.quoteStatus === 'draft') return { label: 'Finish the quote', href: routeHref('quote-detail', { id: item.quoteId }), icon: 'pencil' };
      return { label: item.quoteStatus === 'viewed' ? 'Follow up the quote' : 'Open the quote', href: routeHref('quote-detail', { id: item.quoteId }), icon: 'file-text' };
    case 'accepted':
      return { label: 'Confirm the install day', href: install, icon: 'calendar-check' };
    case 'install':
      return { label: 'Open the install', href: install, icon: 'plug-zap' };
    case 'done':
      return item.paid === false
        ? { label: 'Collect payment', href: install, icon: 'pound-sterling' }
        : { label: 'Open the job', href: install, icon: 'circle-check' };
    default:
      return item.quoteId && (item.quoteStatus === 'declined' || item.quoteStatus === 'expired')
        ? { label: 'Open the quote', href: routeHref('quote-detail', { id: item.quoteId }), icon: 'file-text' }
        : { label: 'Open the enquiry', href: enquiry, icon: 'inbox' };
  }
}

/** Reply urgency for a card: only an enquiry inside his area can be "overdue" or "due soon" (one outside Northern Ireland he will most likely decline). */
function urgencyOf(item) {
  if (outsideAreaLabel(item.postcode)) return '';
  return item.sla === 'overdue' ? 'overdue' : item.sla === 'due_soon' ? 'soon' : '';
}

/** SLA badge wording from the minutes left (negative = overdue). Never colour alone: icon + words. */
function slaBadge(item, replyHours) {
  if (!item.sla) return null;
  const left = replyHours * 60 - item.ageMinutes;
  const urgency = urgencyOf(item);
  if (item.sla === 'overdue') return { tone: urgency ? 'danger' : 'neutral', icon: 'triangle-alert', text: `Overdue by ${spanText(-left)}` };
  if (item.sla === 'due_soon') return { tone: urgency ? 'warn' : 'neutral', icon: 'timer', text: `Reply due in ${spanText(left)}` };
  return { tone: 'neutral', icon: 'clock', text: `Reply due in ${spanText(left)}` };
}

/** The ONE status icon a narrow (board) card shows in place of its chips, with the words for a screen reader. */
function statusGlyph(item, urgency) {
  if (urgency === 'overdue') return { icon: 'triangle-alert', tone: 'danger', label: 'Reply overdue' };
  if (urgency === 'soon') return { icon: 'timer', tone: 'warn', label: 'Reply due soon' };
  if (item.stage !== 'done' && item.stage !== 'lost' && outsideAreaLabel(item.postcode)) return { icon: 'map-pin', tone: 'warn', label: outsideAreaLabel(item.postcode) };
  if (item.stage === 'quote') {
    if (!item.quoteId) return { icon: 'file-plus', tone: 'warn', label: 'No quote yet' };
    const meta = QUOTE_STATUS_META[item.quoteStatus || 'sent'] || QUOTE_STATUS_META.sent;
    return { icon: meta.icon, tone: 'neutral', label: `Quote ${meta.label.toLowerCase()}` };
  }
  if (item.stage === 'done') return item.paid ? { icon: 'check', tone: 'ok', label: 'Paid' } : { icon: 'pound-sterling', tone: 'warn', label: 'To collect' };
  if (item.stage === 'survey') return { icon: 'calendar-check', tone: 'neutral', label: 'Survey booked' };
  if (item.stage === 'accepted') return { icon: 'badge-check', tone: 'neutral', label: 'Accepted' };
  if (item.stage === 'install') return { icon: 'plug-zap', tone: 'neutral', label: 'Install booked' };
  return null;
}

function Tag({ tone = 'neutral', icon, children, ...rest }) {
  return html`<span class=${cx('pl-chip', `pl-chip--${tone}`)} ...${rest}>${icon ? html`<${Icon} name=${icon} size=${14} />` : null}<span>${children}</span></span>`;
}

function Badges({ item, replyHours }) {
  const sla = slaBadge(item, replyHours);
  const out = [];
  if (sla) out.push(html`<${Tag} key="sla" tone=${sla.tone} icon=${sla.icon} data-testid=${`p1-sla-${item.bookingId}`}>${sla.text}<//>`);
  if (item.stage === 'quote') {
    // The same pill the Quotes list and the quote header use, so a quote is the same colour everywhere.
    if (!item.quoteId) out.push(html`<${Tag} key="q" tone="warn" icon="file-plus">No quote yet<//>`);
    else out.push(html`<${QuotePill} key="q" status=${item.quoteStatus || 'sent'} compact data-testid=${`p1-qpill-${item.bookingId}`} />`);
  }
  if (item.stage === 'done') {
    out.push(item.paid
      ? html`<${Tag} key="p" tone="ok" icon="check">Paid<//>`
      : html`<${Tag} key="p" tone="warn" icon="pound-sterling">To collect<//>`);
  }
  if (item.stage !== 'done' && item.stage !== 'lost' && outsideAreaLabel(item.postcode)) out.push(html`<${Tag} key="area" tone="warn" icon="map-pin"><span aria-hidden="true">Outside NI</span><span class="u-sr-only">${outsideAreaLabel(item.postcode)}</span><//>`);
  if (item.leadSource && item.leadSource !== 'other') out.push(html`<${Tag} key="src" tone="plain" icon="megaphone">${LEAD_SOURCE_LABELS[item.leadSource] || item.leadSource}<//>`);
  return out.length ? html`<span class="pl-card__badges">${out}</span>` : null;
}

/**
 * One job. The whole card is the link (to the booking, the quote or the install: whichever is his next step), with a chevron and no "Open" footer.
 * It lays itself out for its own width: a phone gets name, £, a wrapped detail line and chips; a narrow board column gets name, £, ONE status icon and an
 * urgency dot. The stripe on the left is for urgency only (orange overdue, amber due soon).
 */
function PipelineCard({ item, replyHours }) {
  const action = nextAction(item);
  const hasValue = item.value > 0;
  const urgency = urgencyOf(item);
  const glyph = statusGlyph(item, urgency);
  const age = ageParts(item);
  return html`<li class=${cx('pl-card', `pl-card--${item.stage}`, urgency === 'overdue' && 'is-overdue', urgency === 'soon' && 'is-soon')} data-testid=${`p1-card-${item.bookingId}`}>
    <a class="pl-card__link" href=${action.href} data-testid=${`p1-action-${item.bookingId}`}>
      <span class="pl-card__name">${item.customerName}</span>
      ${hasValue || item.stage !== 'lost' ? html`<span class=${cx('pl-card__value', !hasValue && 'is-empty')}>${hasValue ? pounds(item.value) : 'To quote'}</span>` : null}
      <span class="pl-card__meta">${item.postcode ? html`<span class="pl-card__pc">${item.postcode}</span><span class="pl-card__sep" aria-hidden="true">·</span>` : null}<span class="pl-card__age"><span class="pl-card__verb">${age.verb} </span>${age.when}</span></span>
      ${item.stage === 'quote' ? null : html`<span class="pl-card__summary">${prettySummary(item.summary)}</span>`}
      <${Badges} item=${item} replyHours=${replyHours} />
      ${glyph ? html`<span class=${cx('pl-card__glyph', `pl-card__glyph--${glyph.tone}`)}><${Icon} name=${glyph.icon} size=${18} /><span class="u-sr-only">${glyph.label}</span></span>` : null}
      ${urgency ? html`<span class=${cx('pl-card__pip', `pl-card__pip--${urgency}`)} aria-hidden="true"></span>` : null}
      <${Icon} name="chevron-right" size=${20} class="pl-card__chev" />
      <span class="u-sr-only">${action.label}</span>
    </a>
  </li>`;
}

function CardList({ items, replyHours, empty, testid }) {
  if (!items.length) {
    return html`<div class="pl-empty" data-testid=${testid}>
      <${EmptyState} icon=${empty.icon} title=${empty.title} body=${empty.body} />
    </div>`;
  }
  return html`<ul class="pl-cards" data-testid=${testid}>
    ${items.map((item) => html`<${PipelineCard} key=${item.bookingId} item=${item} replyHours=${replyHours} />`)}
  </ul>`;
}

const stageValueText = (stage) => (stage.value > 0 ? pounds(stage.value) : 'Not quoted yet');

// ---------- phone and tablet: six stage tiles (3 x 2 on a phone, one row from 640px) and the selected stage ----------

function StageTiles({ stages, selected, onSelect, urgentCount }) {
  const gridRef = useRef(null);

  const onKeyDown = (e) => {
    const ids = stages.map((s) => s.id);
    const at = ids.indexOf(selected);
    const grid = gridRef.current;
    // Up and Down move a row in the 3 x 2 grid (a step of the column count); in one row they wrap like Left and Right.
    let cols = 3;
    try { cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length); } catch (err) { cols = 3; }
    let next = -1;
    if (e.key === 'ArrowRight') next = (at + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length;
    else if (e.key === 'ArrowDown') next = (at + cols) % ids.length;
    else if (e.key === 'ArrowUp') next = (at - cols + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(ids[next]);
    const btn = grid && grid.querySelector(`[data-stage="${ids[next]}"]`);
    if (btn) btn.focus();
  };

  return html`<div class="pl-tiles" role="tablist" aria-label="Pipeline stages" ref=${gridRef} onKeyDown=${onKeyDown} data-testid="p1-strip">
    ${stages.map((s) => {
      const isSel = s.id === selected;
      const flagged = s.id === 'enquiry' && urgentCount > 0;
      return html`<button type="button" role="tab" key=${s.id} id=${`p1-tab-${s.id}`} data-stage=${s.id}
        class=${cx('pl-tile', isSel && 'is-selected', flagged && 'is-flagged')}
        aria-selected=${isSel ? 'true' : 'false'} aria-controls="p1-panel" tabindex=${isSel ? 0 : -1}
        aria-label=${`${s.label}: ${s.count} ${s.count === 1 ? 'job' : 'jobs'}${s.value > 0 ? `, ${pounds(s.value)}` : ''}${flagged ? `, ${urgentCount} overdue` : ''}`}
        onClick=${() => onSelect(s.id)} data-testid=${`p1-stage-${s.id}`}>
        <span class="pl-tile__label">${s.label}${flagged ? html`<span class="pl-tile__flag"><span class="pl-tile__pip" aria-hidden="true"></span><span class="u-sr-only">${urgentCount} overdue</span></span>` : null}</span>
        <span class="pl-tile__nums">
          <span class="pl-tile__count" data-testid=${`p1-stage-count-${s.id}`}>${s.count}</span>
          <span class=${cx('pl-tile__value', s.value <= 0 && 'is-empty')} data-testid=${`p1-stage-value-${s.id}`}>${s.value > 0
            ? pounds(s.value)
            : html`<span aria-hidden="true">—</span><span class="u-sr-only">Not quoted yet</span>`}</span>
        </span>
      </button>`;
    })}
  </div>`;
}

function StagePanel({ stage, replyHours }) {
  const ui = STAGE_UI[stage.id] || { empty: { title: 'Nothing here', body: '' } };
  // The selected tile already names the stage, so the heading is for screen readers and the visible line is just what the stage means.
  return html`<section class="pl-panel" id="p1-panel" role="tabpanel" aria-labelledby=${`p1-tab-${stage.id}`} data-testid="p1-panel" tabindex="-1">
    <header class="pl-panel__head">
      <h2 class="u-sr-only">${stage.label}</h2>
      <p class="pl-panel__hint">${ui.hint || stage.hint}</p>
    </header>
    <${CardList} items=${stage.items} replyHours=${replyHours} empty=${{ icon: ui.icon, ...ui.empty }} testid="p1-list" />
  </section>`;
}

// ---------- 1260px and up: the kanban board, six compact columns ----------

function Board({ stages, replyHours, urgentCount }) {
  return html`<div class="pl-board" role="group" aria-label="Pipeline board" data-testid="p1-board">
    ${stages.map((s) => {
      const ui = STAGE_UI[s.id] || { empty: { title: 'Nothing here', body: '' } };
      const flagged = s.id === 'enquiry' && urgentCount > 0;
      return html`<section class="pl-col" key=${s.id} aria-labelledby=${`p1-col-title-${s.id}`} data-testid=${`p1-col-${s.id}`}>
        <header class=${cx('pl-col__head', flagged && 'is-flagged')}>
          <h2 class="pl-col__title" id=${`p1-col-title-${s.id}`}><${Icon} name=${ui.icon || 'circle'} size=${16} /><span>${s.label}</span>${flagged ? html`<span class="pl-tile__flag"><span class="pl-tile__pip" aria-hidden="true"></span><span class="u-sr-only">${urgentCount} overdue</span></span>` : null}</h2>
          <span class="pl-col__count" data-testid=${`p1-stage-count-${s.id}`}>${s.count}</span>
          <span class=${cx('pl-col__value', s.value <= 0 && 'is-empty')} data-testid=${`p1-stage-value-${s.id}`}>${stageValueText(s)}</span>
        </header>
        ${s.items.length
          ? html`<ul class="pl-cards">${s.items.map((item) => html`<${PipelineCard} key=${item.bookingId} item=${item} replyHours=${replyHours} />`)}</ul>`
          : html`<p class="pl-col__none" data-testid=${`p1-empty-${s.id}`}>${ui.empty.title}</p>`}
      </section>`;
    })}
  </div>`;
}

// ---------- Lost drawer ----------

function LostDrawer({ pipeline, replyHours }) {
  const n = pipeline.lostCount;
  const summary = n ? `${n} · ${pipeline.lostValue > 0 ? `${pounds(pipeline.lostValue)} not won` : 'no quote value'}` : 'None';
  return html`<${Disclosure} title="Lost" summary=${summary} class="pl-lost" testid="p1-lost">
    ${n
      ? html`<p class="pl-lost__note">Declined, cancelled, or a quote that was turned down or ran out. Worth a call back if it was only the price.</p>
        <ul class="pl-cards pl-cards--lost" data-testid="p1-lost-list">
          ${pipeline.lost.map((item) => html`<${PipelineCard} key=${item.bookingId} item=${item} replyHours=${replyHours} />`)}
        </ul>`
      : html`<p class="pl-lost__note">Nothing lost. Enquiries that are declined, cancelled or turned down show here.</p>`}
  <//>`;
}

// ---------- the reply reminder: one slim row, only for an enquiry inside his area that is past his promise ----------

const SLA_OFF_KEY = 'vm_pl_sla_off';
let slaOffMemory = '';
/** Which reminder he put away this session (the oldest overdue enquiry's id). Session storage, with a memory fallback when the browser blocks it. */
function readSlaOff() {
  try { return sessionStorage.getItem(SLA_OFF_KEY) || slaOffMemory; } catch (e) { return slaOffMemory; }
}
function writeSlaOff(id) {
  slaOffMemory = id;
  try { sessionStorage.setItem(SLA_OFF_KEY, id); } catch (e) { /* kept in memory for this page */ }
}

function SlaRow({ oldest, count, replyHours, onDismiss }) {
  return html`<div class="pl-sla" role="status" data-testid="p1-sla-banner">
    <${Icon} name="triangle-alert" size=${20} class="pl-sla__icon" />
    <p class="pl-sla__text">
      <strong class="pl-sla__who">${count === 1
        ? html`<span class="pl-sla__first">${firstName(oldest.customerName)}</span><span class="pl-sla__full">${oldest.customerName}</span>`
        : `${count} enquiries`}</strong>
      <span class="pl-sla__what"> · ${spanText(oldest.minutesOverdue)} <span class="pl-sla__more">past your ${replyHours} hour promise</span><span class="pl-sla__short">over</span></span>
    </p>
    <${Button} size="sm" icon="message-circle" href=${routeHref('bookings', { id: oldest.bookingId })} class="pl-sla__reply" aria-label=${`Reply to ${firstName(oldest.customerName)}`} data-testid="p1-sla-reply">Reply<//>
    <${IconButton} icon="x" label="Dismiss this reminder" onClick=${onDismiss} class="pl-sla__x" data-testid="p1-sla-dismiss" />
  </div>`;
}

// ---------- view ----------

export default function PipelineView({ route }) {
  const state = useStore(selectState);
  const stamp = toStamp(useNow(60000));
  const wide = useMediaQuery(WIDE);
  const pipeline = useMemo(() => selectPipeline(state, stamp), [state, stamp]);
  const sla = useMemo(() => selectSla(state, stamp), [state, stamp]);
  const [slaOff, setSlaOff] = useState(readSlaOff);

  // The stage that opens first: the earliest one that has something in it. It is chosen once, so a card moving on never jumps the screen.
  const [startStage] = useState(() => {
    const live = pipeline.stages.filter((s) => s.id !== 'done');
    const hit = live.find((s) => s.count > 0);
    return (hit || pipeline.stages[0]).id;
  });
  const wanted = route && route.query ? route.query.s : '';
  const selected = pipeline.stages.some((s) => s.id === wanted) ? wanted : startStage;
  const select = (id) => navigate(routeHref('pipeline', {}, { s: id }), { replace: true });
  const stage = pipeline.stages.find((s) => s.id === selected) || pipeline.stages[0];

  const inProgress = pipeline.stages.filter((s) => s.id !== 'done').reduce((t, s) => t + s.count, 0);
  const subtitle = pipeline.totalCount === 0
    ? 'Nothing in the pipeline yet'
    : `${inProgress} in progress${pipeline.openValue > 0 ? ` · ${pounds(pipeline.openValue)} still to earn` : ''}`;

  // Only an enquiry inside Northern Ireland counts: one from outside the area he will most likely decline, so it never raises the alarm.
  const postcodes = useMemo(() => new Map(pipeline.stages.flatMap((s) => s.items).map((i) => [i.bookingId, i.postcode])), [pipeline]);
  const overdue = sla.overdue.filter((r) => !outsideAreaLabel(postcodes.get(r.bookingId)));
  const oldest = overdue[0] || null;
  const showSla = !!oldest && slaOff !== oldest.bookingId;
  const dismissSla = () => { if (oldest) { writeSlaOff(oldest.bookingId); setSlaOff(oldest.bookingId); } };

  return html`<div class="db-page pl-page" data-testid="p1-pipeline">
    <${PageHeader} title="Pipeline" subtitle=${subtitle} />

    <div class="pl-toggle">
      <${Segmented} ariaLabel="Bookings view" value="pipeline" data-testid="p1-view-toggle"
        options=${[
          { value: 'list', label: 'List', testid: 'p1-view-list' },
          { value: 'pipeline', label: 'Pipeline', testid: 'p1-view-pipeline' },
          { value: 'customers', label: 'Customers', testid: 'p1-view-customers' }
        ]}
        onChange=${(v) => { if (v === 'list') navigate(routeHref('bookings')); else if (v === 'customers') navigate('#/customers'); }} />
    </div>

    ${showSla ? html`<${SlaRow} oldest=${oldest} count=${overdue.length} replyHours=${sla.replyHours} onDismiss=${dismissSla} />` : null}

    ${pipeline.totalCount === 0
      ? html`<${EmptyState} icon="columns-3" title="Nothing in your pipeline yet"
          body="Enquiries from your website funnel land here, then move across as you survey, quote and install."
          action=${html`<${Button} variant="primary" href=${routeHref('share')} icon="share-2">Share your enquiry link<//>`} data-testid="p1-empty" />`
      : wide
        ? html`<${Board} stages=${pipeline.stages} replyHours=${sla.replyHours} urgentCount=${overdue.length} />`
        : html`<${StageTiles} stages=${pipeline.stages} selected=${selected} onSelect=${select} urgentCount=${overdue.length} />
          <${StagePanel} stage=${stage} replyHours=${sla.replyHours} />`}

    ${pipeline.totalCount === 0 ? null : html`<${LostDrawer} pipeline=${pipeline} replyHours=${sla.replyHours} />`}

    <p class="pl-note">Figures come from the sample bookings in this browser. Ages count from when each job reached its stage.</p>
  </div>`;
}
