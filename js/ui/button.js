// js/ui/button.js: Button and IconButton (the only two button components).
// Owner: WP2
import { h } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx } from './util.js';

const isExternal = (href) => /^https?:\/\//i.test(String(href));

/**
 * Button. Renders <a> when `href` is given (external https links open in a new tab with
 * rel="noopener noreferrer"; tel: and sms: links do not) and <button> otherwise.
 * `loading` keeps the button focusable but ignores taps (double-tap guard, 8.3).
 */
export function Button({
  variant = 'secondary', size = 'md', block, icon, iconRight, loading, disabled,
  href, target, rel, type = 'button', onClick, class: cls, children, ...rest
}) {
  const inactive = !!(disabled || loading);
  const classes = cx(
    'ui-btn', `ui-btn--${variant}`, size !== 'md' && `ui-btn--${size}`,
    block && 'ui-btn--block', loading && 'is-loading', disabled && 'is-disabled', cls
  );
  const iconSize = size === 'lg' ? 24 : 20;
  const inner = [
    loading
      ? h('span', { class: 'ui-btn__spinner', 'aria-hidden': 'true', key: 's' })
      : (icon ? h(Icon, { name: icon, size: iconSize, class: 'ui-btn__icon', key: 'i' }) : null),
    children !== undefined && children !== null && children !== false
      ? h('span', { class: 'ui-btn__label', key: 'l' }, children) : null,
    iconRight ? h(Icon, { name: iconRight, size: iconSize, class: 'ui-btn__icon', key: 'r' }) : null
  ];
  const handle = (e) => {
    if (inactive) { e.preventDefault(); return; }
    if (onClick) onClick(e);
  };

  if (href !== undefined && href !== null) {
    const external = isExternal(href);
    return h('a', {
      class: classes,
      href: inactive ? undefined : href,
      role: inactive ? 'link' : undefined,
      'aria-disabled': inactive ? 'true' : undefined,
      'aria-busy': loading ? 'true' : undefined,
      target: target !== undefined ? target : (external ? '_blank' : undefined),
      rel: rel !== undefined ? rel : (external ? 'noopener noreferrer' : undefined),
      onClick: handle,
      ...rest
    }, inner);
  }
  return h('button', {
    type,
    class: classes,
    disabled: disabled ? true : undefined,
    'aria-disabled': loading ? 'true' : undefined,
    'aria-busy': loading ? 'true' : undefined,
    onClick: handle,
    ...rest
  }, inner);
}

// CONTRACT-GAP: `badgeTestid` is not in the IconButton props of 12.3; the shell needs it for db-messages-badge (14.2).
/**
 * Round icon-only button with an accessible name (`label`) and an optional count badge.
 * `badgeTestid` is an addition for the shell (db-messages-badge); the badge is hidden when `badge` is 0 or falsy.
 */
export function IconButton({ icon, label, href, onClick, badge, badgeTestid, size = 'md', class: cls, ...rest }) {
  const classes = cx('ui-icon-btn', size === 'lg' && 'ui-icon-btn--lg', cls);
  const count = Number(badge) || 0;
  const inner = [
    h(Icon, { name: icon, size: 24, key: 'i' }),
    count > 0
      ? h('span', { class: 'ui-badge', 'aria-hidden': 'true', 'data-testid': badgeTestid, key: 'b' }, count > 99 ? '99+' : String(count))
      : null
  ];
  if (href !== undefined && href !== null) {
    const external = isExternal(href);
    return h('a', {
      class: classes, href, 'aria-label': label, onClick,
      target: external ? '_blank' : undefined,
      rel: external ? 'noopener noreferrer' : undefined,
      ...rest
    }, inner);
  }
  return h('button', { type: 'button', class: classes, 'aria-label': label, onClick, ...rest }, inner);
}
