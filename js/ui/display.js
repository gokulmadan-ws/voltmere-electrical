// js/ui/display.js: Icon, BrandMark, Chip, StatusPill, SampleTag, Card, Avatar, EmptyState, Stat, Banner, Skeleton, PageHeader, TextLink.
// Owner: WP2
import { h, html } from '../vendor/preact-htm.js';
import { ICONS } from './icons.js';
import { IconButton } from './button.js';
import { cx } from './util.js';
import { initials, hashHue } from '../core/format.js';

const DEV = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
const warned = new Set();

/** An svg icon from ICONS data, drawn through h() (never as an HTML string). Decorative unless `title` is given. */
export function Icon({ name, size = 24, title, class: cls, ...rest }) {
  const nodes = ICONS[name];
  if (!nodes) {
    if (DEV && !warned.has(name)) { warned.add(name); console.warn('Icon: unknown name', name); }
    return h('span', { class: cx('ui-icon ui-icon--missing', cls), style: { width: size + 'px', height: size + 'px' }, 'aria-hidden': 'true' });
  }
  return h('svg', {
    class: cx('ui-icon', cls),
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor',
    // Thin strokes vanish when an icon is drawn small, so small icons get a heavier stroke.
    'stroke-width': size <= 18 ? 2.1 : 1.75,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    focusable: 'false',
    'aria-hidden': title ? undefined : 'true',
    role: title ? 'img' : undefined,
    'aria-label': title || undefined,
    ...rest
  }, nodes.map(([tag, attrs], i) => h(tag, { ...attrs, key: i })));
}

/** The logo mark (amber rounded square, navy bolt) drawn inline; same artwork as img/logo-mark.svg. Colours come from tokens. */
export function BrandMark({ size = 32, class: cls, ...rest }) {
  return h('svg', {
    class: cx('ui-brandmark', cls), width: size, height: size, viewBox: '0 0 64 64',
    'aria-hidden': 'true', focusable: 'false', ...rest
  },
  h('rect', { class: 'ui-brandmark__bg', width: 64, height: 64, rx: 16 }),
  h('path', { class: 'ui-brandmark__bolt', d: 'M36.5 10 18 35.5h12.2L26.8 54 46 27.5H33.6z' }));
}

/** Small pill. A <button> or <a> (44px high) when interactive, a <span> otherwise. */
export function Chip({ selected, tone = 'neutral', icon, onClick, href, class: cls, children, ...rest }) {
  const interactive = !!(onClick || href);
  const classes = cx('ui-chip', tone !== 'neutral' && `ui-chip--${tone}`, interactive && 'ui-chip--interactive', selected && 'is-selected', cls);
  const inner = [
    icon ? h(Icon, { name: icon, size: 16, key: 'i' }) : null,
    h('span', { class: 'ui-chip__label', key: 'l' }, children)
  ];
  if (href) return h('a', { class: classes, href, onClick, ...rest }, inner);
  if (onClick) {
    return h('button', {
      type: 'button', class: classes, onClick,
      'aria-pressed': selected === undefined ? undefined : !!selected,
      ...rest
    }, inner);
  }
  return h('span', { class: classes, ...rest }, inner);
}

// Label, icon and colour class for each status (contract 4.5).
const STATUS_META = {
  new: { label: 'New request', icon: 'bell', mod: 'new' },
  confirmed: { label: 'Confirmed', icon: 'calendar-check', mod: 'confirmed' },
  on_the_way: { label: 'On the way', icon: 'navigation', mod: 'on-the-way' },
  done: { label: 'Done', icon: 'badge-check', mod: 'done' },
  cancelled: { label: 'Cancelled', icon: 'ban', mod: 'cancelled' }
};

// CONTRACT-GAP: `urgentTestid` is not in the StatusPill props of 12.3; detail-urgent (14.2) needs a way to tag the URGENT pill.
/**
 * Status pill: always icon + word (colour is never the only signal). `done` with paid === false reads
 * "To collect". `urgent` adds a second URGENT pill; `urgentTestid` is an addition so a screen can tag it.
 * Extra props (data-testid) go on the status pill itself.
 */
export function StatusPill({ status, paid, urgent, urgentTestid, compact, class: cls, ...rest }) {
  const meta = STATUS_META[status] || STATUS_META.new;
  const owed = status === 'done' && paid === false;
  const main = h('span', {
    class: cx('ui-pill', `ui-pill--${owed ? 'owed' : meta.mod}`, compact && 'ui-pill--compact', cls),
    ...rest
  }, h(Icon, { name: owed ? 'pound-sterling' : meta.icon, size: 16 }), h('span', { class: 'ui-pill__label' }, owed ? 'To collect' : meta.label));
  if (!urgent) return main;
  const alert = h('span', { class: cx('ui-pill', 'ui-pill--urgent', compact && 'ui-pill--compact'), 'data-testid': urgentTestid },
    h(Icon, { name: 'siren', size: 16 }), h('span', { class: 'ui-pill__label' }, 'URGENT'));
  return h('span', { class: 'ui-pill-group' }, main, alert);
}

/** Tiny outlined SAMPLE tag that follows every credential claim (3.6). */
export function SampleTag({ class: cls, ...rest }) {
  return h('span', { class: cx('ui-tag-sample', cls), ...rest }, 'SAMPLE');
}

/** Card surface. `padded={false}` makes it flush (rows with their own padding). */
export function Card({ as = 'div', padded = true, tone = 'default', class: cls, children, ...rest }) {
  return h(as, {
    class: cx('ui-card', tone !== 'default' && `ui-card--${tone}`, !padded && 'ui-card--flush', cls),
    ...rest
  }, children);
}

/** Initials on one of six tints chosen by the name, so a customer always gets the same colour. */
export function Avatar({ name, size = 40, class: cls, ...rest }) {
  const tint = hashHue(name || '');
  return h('span', {
    class: cx('ui-avatar', `ui-avatar--${tint}`, cls),
    style: { width: size + 'px', height: size + 'px', fontSize: Math.max(12, Math.round(size * 0.4)) + 'px' },
    'aria-hidden': 'true',
    ...rest
  }, initials(name));
}

/** Friendly empty state: line drawing, title, optional body and action. */
export function EmptyState({ icon = 'plug', title, body, action, class: cls, ...rest }) {
  return html`<div class=${cx('ui-empty', cls)} ...${rest}>
    <${Icon} name=${icon} size=${48} class="ui-empty__icon" />
    <p class="ui-empty__title">${title}</p>
    ${body ? html`<p class="ui-empty__body">${body}</p>` : null}
    ${action ? html`<div class="ui-empty__action">${action}</div>` : null}
  </div>`;
}

/** Number tile. A link when `href` is given. */
export function Stat({ label, value, hint, href, tone, class: cls, ...rest }) {
  const classes = cx('ui-stat', tone && `ui-stat--${tone}`, href && 'ui-stat--link', cls);
  const inner = [
    h('span', { class: 'ui-stat__label', key: 'l' }, label),
    h('span', { class: 'ui-stat__value', key: 'v' }, value),
    hint ? h('span', { class: 'ui-stat__hint', key: 'h' }, hint) : null
  ];
  return href ? h('a', { class: classes, href, ...rest }, inner) : h('div', { class: classes, ...rest }, inner);
}

const BANNER_ICONS = { info: 'info', warn: 'triangle-alert', danger: 'circle-alert', ok: 'circle-check' };

/** Inline message block. `danger` is announced as an alert, the rest as status. */
export function Banner({ tone = 'info', icon, actions, class: cls, children, ...rest }) {
  return h('div', {
    class: cx('ui-banner', tone !== 'info' && `ui-banner--${tone}`, cls),
    role: tone === 'danger' ? 'alert' : 'status',
    ...rest
  },
  h(Icon, { name: icon || BANNER_ICONS[tone] || 'info', size: 22, class: 'ui-banner__icon' }),
  h('div', { class: 'ui-banner__body' },
    h('div', { class: 'ui-banner__text' }, children),
    actions ? h('div', { class: 'ui-banner__actions' }, actions) : null));
}

/** Shimmering placeholder bars (the view loader uses it). Static under reduced motion. */
export function Skeleton({ lines = 3, height = 16, class: cls, ...rest }) {
  const bars = [];
  for (let i = 0; i < lines; i++) {
    const last = i === lines - 1 && lines > 1;
    bars.push(h('span', { class: 'ui-skeleton__bar', key: i, 'aria-hidden': 'true', style: { height: height + 'px', width: last ? '62%' : '100%' } }));
  }
  return h('div', { class: cx('ui-skeleton', cls), role: 'status', ...rest }, h('span', { class: 'u-sr-only' }, 'Loading'), bars);
}

/**
 * Title row of every dashboard view. Renders the one <h1 data-testid="view-title" tabindex="-1"> that the shell
 * focuses after navigation. `back` is { href, label, onClick? }.
 */
export function PageHeader({ title, subtitle, back, actions, eyebrow, class: cls, ...rest }) {
  return html`<header class=${cx('ui-page-header', cls)} ...${rest}>
    ${back ? html`<${IconButton} icon="arrow-left" label=${back.label || 'Back'} href=${back.href} onClick=${back.onClick} size="lg" class="ui-page-header__back" data-testid="page-back" />` : null}
    <div class="ui-page-header__main">
      ${eyebrow ? html`<p class="ui-page-header__eyebrow">${eyebrow}</p>` : null}
      <h1 class="ui-page-header__title" data-testid="view-title" tabindex="-1">${title}</h1>
      ${subtitle ? html`<p class="ui-page-header__sub">${subtitle}</p>` : null}
    </div>
    ${actions ? html`<div class="ui-page-header__actions">${actions}</div>` : null}
  </header>`;
}

/** Text link. `inline` links inside a sentence are exempt from the 44px rule. External https links open in a new tab. */
export function TextLink({ href, inline, external, class: cls, children, ...rest }) {
  const isExt = external !== undefined ? external : /^https?:\/\//i.test(String(href));
  return h('a', {
    class: cx('ui-link', inline && 'ui-link--inline', cls),
    href,
    target: isExt ? '_blank' : undefined,
    rel: isExt ? 'noopener noreferrer' : undefined,
    ...rest
  }, children);
}
