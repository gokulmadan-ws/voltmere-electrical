// js/ui/notice.js: PrototypeNotice, the "prototype / sample data" strip, footer paragraph and inline banner (3.7).
// Owner: WP2 (disclosure wording updated for 180 Electrical by role B2)
import { h } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx, pageHref, pageTarget } from './util.js';

// Must keep starting "This is a prototype." (the landing test checks it). The business name, phone and email are his real
// public details (taken from his own website); everything else is made up.
const FOOTER_TEXT = 'This is a prototype. The business name, phone number and email are 180 Electrical\'s real public details; the enquiries, bookings, customers, diary and messages are samples. Nothing is really sent: no WhatsApp, SMS, email or payment.';
const LANDING_EXTRA = ' Enquiries are saved only in this browser.';
const DASHBOARD_EXTRA = ' Everything you see here is stored in this browser only.';

/**
 * variant 'strip' (top of both pages, 28px, not sticky), 'footer' (disclosure paragraph) or 'inline' (children text,
 * e.g. the Messages banner). `page` is 'landing' or 'dashboard' and only changes the strip link and the footer text.
 */
export function PrototypeNotice({ variant = 'strip', page = 'landing', children, class: cls, ...rest }) {
  if (variant === 'footer') {
    return h('p', { class: cx('ui-notice ui-notice--footer', cls), 'data-testid': 'footer-disclosure', ...rest },
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
    'data-testid': 'prototype-strip', ...rest
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
