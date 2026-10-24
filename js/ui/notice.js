// js/ui/notice.js: PrototypeNotice, the "prototype / sample data" strip, footer paragraph and inline banner (3.7).
// Owner: WP2 (disclosure wording updated for 180 Electrical by role B2; the public strip with its "Prototype tools" popover and the
// "Show: With ideas | Only my content" switch by LP1, polish round 3)
import { h, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx, pageHref, pageTarget, uid } from './util.js';
import { isCleanMode } from './clean.js';
import { IdeasSwitch } from './ideas.js';
import { ThemeToggle } from './theme.js';

// Must keep starting "This is a prototype." (the landing test checks it). The business name, phone and email are his real
// public details (taken from his own website); everything else is made up.
const FOOTER_TEXT = 'This is a prototype. The business name, phone number and email are 180 Electrical\'s real public details; the enquiries, bookings, customers, diary and messages are samples. Nothing is really sent: no WhatsApp, SMS, email or payment.';
const LANDING_EXTRA = ' Enquiries are saved only in this browser.';
const DASHBOARD_EXTRA = ' Everything you see here is stored in this browser only.';

/** False for an in-page link whose section is not shown right now (an idea section hidden under "Only my content"). */
function linkShown(href) {
  if (typeof document === 'undefined' || String(href).charAt(0) !== '#') return true;
  const el = document.getElementById(String(href).slice(1));
  return !el || el.getClientRects().length > 0;
}

/**
 * The public pages' strip (landing, funnel, quote page): "Prototype tools" on the left, "Show: With ideas | Only my content" on the right.
 * The tools open in a small popover (a non-modal disclosure: focus moves into it, Esc or the close button closes it and gives focus back,
 * a tap or focus outside closes it too). It holds everything that used to clutter the footer: the owner login, what's real, the theme, the
 * disclosure and (landing) the page links. The strip itself is never data-proto: it carries the way back from "Only my content".
 * `links` is a list of { href, label } page links; `disclosure` replaces the default paragraph.
 */
function PublicStrip({ page, links, disclosure, class: cls, ...rest }) {
  const [open, setOpen] = useState(false);
  const [panelId] = useState(() => uid('ptools'));
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const close = (refocus) => {
    setOpen(false);
    if (refocus && btnRef.current) btnRef.current.focus();
  };

  // A layout effect: the listeners and the focus move are in place the moment the popover is on screen (a passive effect can land a frame late).
  useLayoutEffect(() => {
    if (!open) return undefined;
    const outside = (e) => rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };
    const onDown = (e) => { if (outside(e)) setOpen(false); };
    const onFocus = (e) => { if (outside(e)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('focusin', onFocus);
    if (panelRef.current) panelRef.current.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  const text = disclosure || (FOOTER_TEXT + LANDING_EXTRA);
  const pageLinks = Array.isArray(links) ? links.filter((l) => l && l.href && l.label && linkShown(l.href)) : [];

  return h('aside', {
    class: cx('ui-notice ui-notice--strip ui-notice--public', cls), 'aria-label': 'Prototype notice', 'data-testid': 'prototype-strip', 'data-page': page, ref: rootRef, ...rest
  },
  h('div', { class: 'ui-notice__inner' },
    h('button', {
      type: 'button', class: 'ui-tools__btn', ref: btnRef, 'data-testid': 'prototype-tools',
      'aria-expanded': open ? 'true' : 'false', 'aria-controls': open ? panelId : undefined, 'aria-haspopup': 'dialog',
      onClick: () => setOpen(!open)
    },
    h('span', { class: 'ui-tools__pill' },
      h(Icon, { name: 'wrench', size: 14, class: 'ui-tools__icon' }),
      h('span', { class: 'ui-tools__long' }, 'Prototype tools'),
      h('span', { class: 'ui-tools__short' }, 'Tools'),
      h(Icon, { name: 'chevron-down', size: 14, class: 'ui-tools__chev' }))),
    h(IdeasSwitch, null),
    open ? h('div', {
      class: 'ui-tools__panel', id: panelId, role: 'dialog', 'aria-label': 'Prototype tools', tabIndex: -1, ref: panelRef, 'data-testid': 'prototype-tools-panel'
    },
    h('div', { class: 'ui-tools__head' },
      h('h2', { class: 'ui-tools__title' }, 'Prototype tools'),
      h('button', { type: 'button', class: 'ui-tools__close', 'aria-label': 'Close prototype tools', 'data-testid': 'prototype-tools-close', onClick: () => close(true) },
        h(Icon, { name: 'x', size: 20 }))),
    h('p', { class: 'ui-tools__text', 'data-testid': 'footer-disclosure' }, text),
    h('p', { class: 'ui-tools__text ui-tools__text--ideas' },
      'Blocks tagged "Idea from us" are not on your site today. "Only my content" hides them.'),
    h('div', { class: 'ui-tools__row' },
      h('p', { class: 'ui-tools__label' }, 'Appearance'),
      h(ThemeToggle, { variant: 'segmented', size: 'sm' })),
    h('div', { class: 'ui-tools__group' },
      h('p', { class: 'ui-tools__label' }, 'Owner area'),
      h('ul', { class: 'ui-tools__list' },
        h('li', null, h('a', {
          class: 'ui-tools__link ui-tools__link--strong', href: pageHref('dashboard.html', '#/today'), target: pageTarget('dashboard.html'), 'data-testid': 'footer-owner-link'
        }, h('span', null, 'Owner login (demo)'), h(Icon, { name: 'arrow-right', size: 16 }))),
        h('li', null, h('a', {
          class: 'ui-tools__link', href: pageHref('dashboard.html', '#/about'), target: pageTarget('dashboard.html'), 'data-testid': 'footer-about-link'
        }, h('span', null, "What's real in this prototype"), h(Icon, { name: 'arrow-right', size: 16 }))))),
    pageLinks.length ? h('nav', { class: 'ui-tools__group', 'aria-label': 'On this page', 'data-testid': 'prototype-tools-links' },
      h('p', { class: 'ui-tools__label' }, 'On this page'),
      h('ul', { class: 'ui-tools__chips' },
        pageLinks.map((l) => h('li', { key: l.href }, h('a', { class: 'ui-tools__chip', href: l.href, onClick: () => close(false) }, l.label))))) : null) : null));
}

/**
 * variant 'strip' (top of the pages, not sticky), 'footer' (disclosure paragraph) or 'inline' (children text,
 * e.g. the Messages banner). `page` is 'landing', 'funnel' or 'quote' (the public strip: tools popover and the ideas switch) or
 * 'dashboard' (the thin strip with a link, unchanged), and only changes the strip and the footer text.
 * In the opt-in clean preview (?clean=1, see clean.js) the dashboard's 'strip' and 'footer' variants render nothing (they also carry
 * data-proto, so base.css hides them if clean mode is switched on later). The public strip never hides: it holds the switch back.
 * The 'inline' variant is a dashboard label about what is simulated: it always shows.
 */
export function PrototypeNotice({ variant = 'strip', page = 'landing', children, class: cls, links, disclosure, ...rest }) {
  if (variant === 'strip' && page !== 'dashboard') return h(PublicStrip, { page, links, disclosure, class: cls, ...rest });
  if (variant !== 'inline' && isCleanMode()) return null;
  if (variant === 'footer') {
    return h('p', { class: cx('ui-notice ui-notice--footer', cls), 'data-testid': 'footer-disclosure', 'data-proto': 'true', ...rest },
      FOOTER_TEXT + (page === 'dashboard' ? DASHBOARD_EXTRA : LANDING_EXTRA));
  }
  if (variant === 'inline') {
    return h('div', { class: cx('ui-notice ui-notice--inline', cls), role: 'note', ...rest },
      h(Icon, { name: 'info', size: 22, class: 'ui-notice__icon' }),
      h('div', { class: 'ui-notice__body' }, children));
  }
  const onDashboard = page === 'dashboard';
  return h('div', {
    class: cx('ui-notice ui-notice--strip', cls), role: 'note', 'aria-label': 'Prototype notice',
    'data-testid': 'prototype-strip', 'data-proto': 'true', ...rest
  },
  h('span', { class: 'ui-notice__badge' }, 'PROTOTYPE'),
  // The tail is visually hidden (not removed) on narrow phones so the 28px strip never ends in an ellipsis.
  h('span', { class: 'ui-notice__text' }, 'Sample data', h('span', { class: 'ui-notice__more' }, ', nothing is really sent.')),
  h('a', {
    class: 'ui-notice__link', 'data-testid': 'prototype-strip-link',
    href: onDashboard ? '#/about' : pageHref('dashboard.html', '#/about'),
    target: onDashboard ? undefined : pageTarget('dashboard.html')
  }, "What's real?"));
}
