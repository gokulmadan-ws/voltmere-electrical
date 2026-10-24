// js/ui/whatsapp.js: WhatsAppBubble and PhoneMock (the simulated chat look; no WhatsApp artwork or logo).
// Owner: WP2
import { h } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx } from './util.js';

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const URL_TAIL_RE = /[.,;:!?)\]]+$/; // sentence punctuation that is not part of a link

/**
 * The short label a link shows in a bubble, chosen from its path, so a message never prints an origin, a host or a raw id.
 * The stored message body and the wa.me text keep the full URL; this is display only.
 */
export function linkLabel(href) {
  let file = '';
  let hash = '';
  try {
    const u = new URL(String(href));
    file = u.pathname.slice(u.pathname.lastIndexOf('/') + 1).toLowerCase();
    hash = u.hash;
  } catch (e) {
    return 'Link';
  }
  if (file === 'dashboard.html') return /^#\/bookings\//.test(hash) ? 'Job link' : 'Dashboard link';
  if (file === 'quote.html') return 'Quote link';
  if (file === 'index.html' || file === '') return /^#manage/.test(hash) ? 'Manage link' : 'Booking page';
  return 'Link';
}

/** Split plain text into strings and short tappable <a> labels (each keeps the real href). Nothing can inject markup. */
function linkify(text, nextKey) {
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    const href = m[0].replace(URL_TAIL_RE, '');
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', {
      key: nextKey(), class: 'ui-bubble__link ui-link--inline', href, target: '_blank', rel: 'noopener noreferrer' // inline in a sentence, so exempt from the 44px rule
    }, linkLabel(href)));
    last = m.index + href.length;
    URL_RE.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Turn `*bold*` into <strong> children and any http(s) URL into a short link label. Everything else stays text. */
function withBold(body) {
  const text = String(body === undefined || body === null ? '' : body);
  const out = [];
  const re = /\*([^*\n]+)\*/g;
  let last = 0;
  let key = 0;
  const nextKey = () => key++;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), nextKey));
    out.push(h('strong', { key: nextKey() }, ...linkify(m[1], nextKey)));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), nextKey));
  return out;
}

const isWeb = (href) => /^https?:\/\//i.test(String(href));

// CONTRACT-GAP: `messageId` and `actions[].testid` are not in the WhatsAppBubble props of 12.3; bubble-action-<messageId>-<actionId> (14.2) needs them.
/**
 * One simulated message bubble. `direction` 'out' = to customers (right, green), 'in' = owner alerts (left).
 * `actions` is [{ id, label, href?, testid? }]: with an href the action is a link, without one it is a button that
 * calls onAction(id). `messageId` (an addition) gives every action the test id bubble-action-<messageId>-<actionId>.
 */
export function WhatsAppBubble({
  body, direction = 'out', stateLabel, scheduled, time, actions, onAction, toLabel, messageId, class: cls, ...rest
}) {
  const list = Array.isArray(actions) ? actions : [];
  return h('div', { class: cx('ui-bubble-wrap', `ui-bubble-wrap--${direction}`, cls), ...rest },
    toLabel ? h('p', { class: 'ui-bubble__to' }, toLabel) : null,
    h('div', { class: cx('ui-bubble', `ui-bubble--${direction}`, scheduled && 'is-scheduled') },
      h('div', { class: 'ui-bubble__body' }, withBold(body)),
      (time || stateLabel)
        ? h('div', { class: 'ui-bubble__meta' },
          time ? h('span', { class: 'ui-bubble__time' }, time) : null,
          stateLabel ? h('span', { class: 'ui-bubble__state' }, stateLabel) : null,
          h(Icon, { name: scheduled ? 'clock' : 'check-check', size: 16, class: cx('ui-bubble__tick', !scheduled && 'is-sent') }))
        : null),
    list.length
      ? h('div', { class: 'ui-bubble__actions' }, list.map((a) => {
        const testid = a.testid || (messageId ? `bubble-action-${messageId}-${a.id}` : undefined);
        if (a.href) {
          const web = isWeb(a.href);
          return h('a', {
            class: 'ui-bubble__action', key: a.id, href: a.href, 'data-testid': testid,
            target: web ? '_blank' : undefined, rel: web ? 'noopener noreferrer' : undefined
          }, a.label);
        }
        return h('button', {
          type: 'button', class: 'ui-bubble__action', key: a.id, 'data-testid': testid,
          onClick: () => { if (onAction) onAction(a.id); }
        }, a.label);
      }))
      : null);
}

/** Rounded phone frame with a chat header strip and a flat wallpaper; hosts bubbles. */
export function PhoneMock({ title, subtitle, children, class: cls, ...rest }) {
  return h('div', { class: cx('ui-phone', cls), ...rest },
    h('div', { class: 'ui-phone__bar' },
      h('span', { class: 'ui-phone__avatar', 'aria-hidden': 'true' }, h(Icon, { name: 'message-circle', size: 20 })),
      h('div', { class: 'ui-phone__who' },
        h('p', { class: 'ui-phone__title' }, title),
        subtitle ? h('p', { class: 'ui-phone__sub' }, subtitle) : null)),
    h('div', { class: 'ui-chat' }, children));
}
