// js/dashboard/views/pipeline.js: Pipeline, his sales process at a glance (stage strip, cards with SLA flags and a next action, Lost drawer, kanban from 1100px).
// Owner: P1
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Avatar, Banner, Button, Disclosure, EmptyState, Icon, PageHeader, Segmented, cx, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { LEAD_SOURCE_LABELS } from '../../core/config.js';
import { selectPipeline, selectSla } from '../../core/selectors.js';
import { toStamp } from '../../core/dates.js';
import { firstName, outsideAreaLabel } from '../../core/format.js';
import { navigate, routeHref } from '../router.js';

export const title = 'Pipeline';
export const css = ['css/pipeline.css'];

// Whole state (identity is stable between mutations); the selectors build fresh objects, so they run inside useMemo.
const selectState = (state) => state;

const WIDE = '(min-width: 1100px)';

// What each stage looks like and says when it is empty. The labels and hints come from PIPELINE_STAGES through selectPipeline.
const STAGE_UI = {
  enquiry: { icon: 'inbox', empty: { title: 'No enquiries waiting', body: 'New ones from your website land here, ready for your reply.' } },
  survey: { icon: 'calendar-check', empty: { title: 'No surveys booked', body: 'When you confirm an enquiry, its free survey shows here.' } },
  quote: { icon: 'file-text', empty: { title: 'No quotes to write or chase', body: 'After a survey, write the quote here and follow it up.' } },
  accepted: { icon: 'badge-check', empty: { title: 'Nobody waiting for an install day', body: 'A customer who accepts a quote lands here until you confirm the day.' } },
  install: { icon: 'plug-zap', empty: { title: 'No installs booked', body: 'Confirmed install days show here.' } },
  done: { icon: 'circle-check', empty: { title: 'No finished installs yet', body: 'Completed jobs, and whether you have been paid, show here.' } }
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

function ageLine(item) {
  let verb = AGE_VERB[item.stage] || 'Updated';
  if (item.stage === 'quote') verb = item.quoteStatus === 'sent' || item.quoteStatus === 'viewed' ? 'Quote sent' : 'Survey done';
  return item.ageMinutes < 1 ? `${verb} just now` : `${verb} ${spanText(item.ageMinutes)} ago`;
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

/** SLA badge wording from the minutes left (negative = overdue). Never colour alone: icon + words. */
function slaBadge(item, replyHours) {
  if (!item.sla) return null;
  const left = replyHours * 60 - item.ageMinutes;
  if (item.sla === 'overdue') return { tone: 'danger', icon: 'triangle-alert', text: `Overdue by ${spanText(-left)}` };
  if (item.sla === 'due_soon') return { tone: 'warn', icon: 'timer', text: `Reply due in ${spanText(left)}` };
  return { tone: 'neutral', icon: 'clock', text: `Reply due in ${spanText(left)}` };
}

function Tag({ tone = 'neutral', icon, children, ...rest }) {
  return html`<span class=${cx('pl-chip', `pl-chip--${tone}`)} ...${rest}>${icon ? html`<${Icon} name=${icon} size=${14} />` : null}<span>${children}</span></span>`;
}

function Badges({ item, replyHours }) {
  const sla = slaBadge(item, replyHours);
  const out = [];
  if (sla) out.push(html`<${Tag} key="sla" tone=${sla.tone} icon=${sla.icon} data-testid=${`p1-sla-${item.bookingId}`}>${sla.text}<//>`);
  if (item.stage === 'quote') {
    if (!item.quoteId) out.push(html`<${Tag} key="q" tone="warn" icon="file-plus">No quote yet<//>`);
    else if (item.quoteStatus === 'draft') out.push(html`<${Tag} key="q" tone="neutral" icon="pencil">Draft<//>`);
    else if (item.quoteStatus === 'viewed') out.push(html`<${Tag} key="q" tone="accent" icon="eye">Viewed<//>`);
    else out.push(html`<${Tag} key="q" tone="neutral" icon="send">Not opened yet<//>`);
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

function PipelineCard({ item, replyHours }) {
  const action = nextAction(item);
  const hasValue = item.value > 0;
  return html`<li class=${cx('pl-card', `pl-card--${item.stage}`, item.sla === 'overdue' && 'is-overdue')} data-testid=${`p1-card-${item.bookingId}`}>
    <a class="pl-card__main" href=${routeHref('bookings', { id: item.bookingId })} data-testid=${`p1-card-open-${item.bookingId}`}>
      <${Avatar} name=${item.customerName} size=${36} class="pl-card__avatar" />
      <span class="pl-card__name">${item.customerName}</span>
      ${hasValue || item.stage !== 'lost' ? html`<span class=${cx('pl-card__value', !hasValue && 'is-empty')}>${hasValue ? pounds(item.value) : 'To quote'}</span>` : null}
      <span class="pl-card__meta">${item.postcode ? html`<span class="pl-card__pc">${item.postcode}</span>` : null}<span class="pl-card__age">${ageLine(item)}</span></span>
      ${item.stage === 'quote' ? null : html`<span class="pl-card__summary">${prettySummary(item.summary)}</span>`}
      <${Badges} item=${item} replyHours=${replyHours} />
    </a>
    <a class="pl-card__action" href=${action.href} data-testid=${`p1-action-${item.bookingId}`}>
      <${Icon} name=${action.icon} size=${18} />
      <span class="pl-card__action-label">${action.label}</span>
      <${Icon} name="arrow-right" size=${18} class="pl-card__action-arrow" />
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

// ---------- phone and tablet: the stage strip and the selected stage ----------

function StageStrip({ stages, selected, onSelect, overdueCount }) {
  const wrapRef = useRef(null);
  const stripRef = useRef(null);
  const first = useRef(true);

  // Soft fades on the edges that still have more tiles behind them.
  const syncEdges = () => {
    const strip = stripRef.current;
    const wrap = wrapRef.current;
    if (!strip || !wrap) return;
    wrap.dataset.left = strip.scrollLeft > 4 ? '1' : '0';
    wrap.dataset.right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4 ? '1' : '0';
  };

  // Bring the selected tile into view: instantly on first paint, smoothly afterwards (not at all under reduced motion).
  useEffect(() => {
    const strip = stripRef.current;
    const tile = strip && strip.querySelector('[aria-selected="true"]');
    if (!strip || !tile) return;
    let behavior = 'smooth';
    try { if (first.current || matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto'; } catch (e) { behavior = 'auto'; }
    first.current = false;
    const target = Math.max(0, tile.offsetLeft - (strip.clientWidth - tile.offsetWidth) / 2);
    if (typeof strip.scrollTo === 'function') strip.scrollTo({ left: target, behavior }); else strip.scrollLeft = target;
    syncEdges();
  }, [selected]);

  useEffect(() => {
    syncEdges();
    window.addEventListener('resize', syncEdges);
    return () => window.removeEventListener('resize', syncEdges);
  }, []);

  const onKeyDown = (e) => {
    const ids = stages.map((s) => s.id);
    const at = ids.indexOf(selected);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % ids.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(ids[next]);
    const btn = stripRef.current && stripRef.current.querySelector(`[data-stage="${ids[next]}"]`);
    if (btn) btn.focus();
  };

  return html`<div class="pl-strip-wrap" ref=${wrapRef} data-left="0" data-right="1">
    <div class="pl-strip" role="tablist" aria-label="Pipeline stages" ref=${stripRef} onScroll=${syncEdges} onKeyDown=${onKeyDown} data-testid="p1-strip">
      ${stages.map((s) => {
        const isSel = s.id === selected;
        const ui = STAGE_UI[s.id] || {};
        const flagged = s.id === 'enquiry' && overdueCount > 0;
        return html`<button type="button" role="tab" key=${s.id} id=${`p1-tab-${s.id}`} data-stage=${s.id}
          class=${cx('pl-tile', isSel && 'is-selected', flagged && 'is-flagged')}
          aria-selected=${isSel ? 'true' : 'false'} aria-controls="p1-panel" tabindex=${isSel ? 0 : -1}
          aria-label=${`${s.label}: ${s.count} ${s.count === 1 ? 'job' : 'jobs'}${s.value > 0 ? `, ${pounds(s.value)}` : ''}${flagged ? `, ${overdueCount} overdue` : ''}`}
          onClick=${() => onSelect(s.id)} data-testid=${`p1-stage-${s.id}`}>
          <span class="pl-tile__step"><${Icon} name=${ui.icon || 'circle'} size=${16} /><span class="pl-tile__label">${s.label}</span></span>
          <span class="pl-tile__count" data-testid=${`p1-stage-count-${s.id}`}>${s.count}</span>
          <span class=${cx('pl-tile__value', s.value <= 0 && 'is-empty')} data-testid=${`p1-stage-value-${s.id}`}>${stageValueText(s)}</span>
          ${flagged ? html`<span class="pl-tile__flag"><${Icon} name="triangle-alert" size=${12} />${overdueCount} overdue</span>` : null}
        </button>`;
      })}
    </div>
  </div>`;
}

function StagePanel({ stage, replyHours }) {
  const ui = STAGE_UI[stage.id] || { empty: { title: 'Nothing here', body: '' } };
  return html`<section class="pl-panel" id="p1-panel" role="tabpanel" aria-labelledby=${`p1-tab-${stage.id}`} data-testid="p1-panel" tabindex="-1">
    <header class="pl-panel__head">
      <h2 class="pl-panel__title">${stage.label}</h2>
      <p class="pl-panel__hint">${stage.hint}</p>
    </header>
    <${CardList} items=${stage.items} replyHours=${replyHours} empty=${{ icon: ui.icon, ...ui.empty }} testid="p1-list" />
  </section>`;
}

// ---------- 1100px and up: the kanban board ----------

function Board({ stages, replyHours, overdueCount }) {
  return html`<div class="pl-board" role="group" aria-label="Pipeline board" data-testid="p1-board">
    ${stages.map((s) => {
      const ui = STAGE_UI[s.id] || { empty: { title: 'Nothing here', body: '' } };
      const flagged = s.id === 'enquiry' && overdueCount > 0;
      return html`<section class="pl-col" key=${s.id} aria-labelledby=${`p1-col-title-${s.id}`} data-testid=${`p1-col-${s.id}`}>
        <header class=${cx('pl-col__head', flagged && 'is-flagged')}>
          <h2 class="pl-col__title" id=${`p1-col-title-${s.id}`}><${Icon} name=${ui.icon || 'circle'} size=${16} />${s.label}</h2>
          <span class="pl-col__count" data-testid=${`p1-stage-count-${s.id}`}>${s.count}</span>
          <span class=${cx('pl-col__value', s.value <= 0 && 'is-empty')} data-testid=${`p1-stage-value-${s.id}`}>${stageValueText(s)}</span>
          ${flagged ? html`<span class="pl-tile__flag"><${Icon} name="triangle-alert" size=${12} />${overdueCount} overdue</span>` : null}
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

// ---------- view ----------

export default function PipelineView({ route }) {
  const state = useStore(selectState);
  const stamp = toStamp(useNow(60000));
  const wide = useMediaQuery(WIDE);
  const pipeline = useMemo(() => selectPipeline(state, stamp), [state, stamp]);
  const sla = useMemo(() => selectSla(state, stamp), [state, stamp]);

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

  const oldest = sla.overdue[0] || null;
  const soonest = !oldest && sla.dueSoon[0] ? sla.dueSoon[0] : null;

  return html`<div class="db-page pl-page" data-testid="p1-pipeline">
    <${PageHeader} title="Pipeline" subtitle=${subtitle} />

    <div class="pl-toggle">
      <${Segmented} ariaLabel="Bookings view" value="pipeline" data-testid="p1-view-toggle"
        options=${[
          { value: 'list', label: 'List', icon: 'layout-list', testid: 'p1-view-list' },
          { value: 'pipeline', label: 'Pipeline', icon: 'columns-3', testid: 'p1-view-pipeline' }
        ]}
        onChange=${(v) => { if (v === 'list') navigate(routeHref('bookings')); }} />
    </div>

    ${oldest
      ? html`<${Banner} tone="danger" class="pl-banner" data-testid="p1-sla-banner"
          actions=${html`<${Button} size="sm" icon="message-circle" href=${routeHref('bookings', { id: oldest.bookingId })} data-testid="p1-sla-reply">Reply to ${firstName(oldest.customerName)}<//>`}>
          <strong>${sla.overdueCount === 1 ? oldest.customerName : `${sla.overdueCount} enquiries`}</strong>
          ${sla.overdueCount === 1 ? html` is ${spanText(oldest.minutesOverdue)} past your ${sla.replyHours} hour reply promise.` : html` are past your ${sla.replyHours} hour reply promise. Longest: ${oldest.customerName}, ${spanText(oldest.minutesOverdue)} over.`}
        <//>`
      : soonest
        ? html`<${Banner} tone="warn" class="pl-banner" data-testid="p1-sla-banner"
            actions=${html`<${Button} size="sm" icon="message-circle" href=${routeHref('bookings', { id: soonest.bookingId })} data-testid="p1-sla-reply">Reply to ${firstName(soonest.customerName)}<//>`}>
            <strong>${sla.dueSoonCount === 1 ? soonest.customerName : `${sla.dueSoonCount} enquiries`}</strong>
            ${sla.dueSoonCount === 1 ? html` needs a reply within ${spanText(soonest.minutesLeft)} to keep your ${sla.replyHours} hour promise.` : html` need a reply soon to keep your ${sla.replyHours} hour promise. First: ${soonest.customerName}, in ${spanText(soonest.minutesLeft)}.`}
          <//>`
        : null}

    ${pipeline.totalCount === 0
      ? html`<${EmptyState} icon="columns-3" title="Nothing in your pipeline yet"
          body="Enquiries from your website funnel land here, then move across as you survey, quote and install."
          action=${html`<${Button} variant="primary" href=${routeHref('share')} icon="share-2">Share your enquiry link<//>`} data-testid="p1-empty" />`
      : wide
        ? html`<${Board} stages=${pipeline.stages} replyHours=${sla.replyHours} overdueCount=${sla.overdueCount} />`
        : html`<${StageStrip} stages=${pipeline.stages} selected=${selected} onSelect=${select} overdueCount=${sla.overdueCount} />
          <${StagePanel} stage=${stage} replyHours=${sla.replyHours} />`}

    ${pipeline.totalCount === 0 ? null : html`<${LostDrawer} pipeline=${pipeline} replyHours=${sla.replyHours} />`}

    <p class="pl-note">Figures come from the sample bookings in this browser. Ages count from when each job reached its stage.</p>
  </div>`;
}
