// tests/unit/whatsapp-links.test.mjs: a URL in a simulated message shows as a short label (display only); the stored body is untouched.
// Owner: SHARED
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_BASE_URL } from '../../js/core/config.js';
import { linkLabel, WhatsAppBubble } from '../../js/ui/whatsapp.js';

// Walk a Preact vnode tree: { text, links: [{ label, href }] }.
function walk(node, acc = { text: '', links: [] }) {
  if (node === null || node === undefined || node === false || node === true) return acc;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, acc)); return acc; }
  if (typeof node === 'string' || typeof node === 'number') { acc.text += String(node); return acc; }
  const props = node.props || {};
  if (node.type === 'a' && String(props.class).split(' ').includes('ui-bubble__link')) {
    acc.links.push({ label: [].concat(props.children).join(''), href: props.href, rel: props.rel, target: props.target });
    acc.text += [].concat(props.children).join('');
    return acc;
  }
  walk(props.children, acc);
  return acc;
}
const bodyOf = (vnode) => {
  const find = (n) => {
    if (!n || typeof n !== 'object') return null;
    if (Array.isArray(n)) { for (const c of n) { const r = find(c); if (r) return r; } return null; }
    if (n.props && n.props.class === 'ui-bubble__body') return n;
    return find(n.props && n.props.children);
  };
  return find(vnode);
};

test('linkLabel picks a short label from the path, never an origin, host or id', () => {
  assert.equal(linkLabel(`${SITE_BASE_URL}dashboard.html#/bookings/bk_27wf925h`), 'Job link');
  assert.equal(linkLabel('http://localhost:4191/dashboard.html#/bookings/bk_27wf925h'), 'Job link');
  assert.equal(linkLabel(`${SITE_BASE_URL}dashboard.html#/quotes/Q-EL-1043`), 'Dashboard link');
  assert.equal(linkLabel(`${SITE_BASE_URL}quote.html#q=Q-EL-1043`), 'Quote link');
  assert.equal(linkLabel(`${SITE_BASE_URL}index.html#manage/EL-1043`), 'Manage link');
  assert.equal(linkLabel(`${SITE_BASE_URL}index.html`), 'Booking page');
  assert.equal(linkLabel('https://example.invalid/whatever/else'), 'Link');
  assert.equal(linkLabel('not a url'), 'Link');
});

test('a bubble shows "Open: Job link" with the real href on the anchor, and keeps bold and plain text', () => {
  const href = 'http://localhost:4191/dashboard.html#/bookings/bk_27wf925h';
  const body = `*New enquiry EL-1043*\nAoife Magee · 07700 900231\nOpen: ${href}`;
  const tree = walk(bodyOf(WhatsAppBubble({ body })));
  assert.equal(tree.text, 'New enquiry EL-1043\nAoife Magee · 07700 900231\nOpen: Job link', 'the *bold* marks become <strong>, the URL becomes a label');
  assert.ok(!/localhost|http|bk_/.test(tree.text), 'no origin, scheme or raw id is shown');
  assert.deepEqual(tree.links, [{ label: 'Job link', href, rel: 'noopener noreferrer', target: '_blank' }]);
});

test('trailing sentence punctuation stays outside the link; two links in one body both become labels; no link means plain text', () => {
  const base = 'https://180.example/app/';
  const quote = `${base}quote.html#q=Q-EL-1043`;
  const tree = walk(bodyOf(WhatsAppBubble({ body: `Read it here: ${quote}. Or manage it: ${base}index.html#manage/EL-1043, thanks.` })));
  assert.equal(tree.text, 'Read it here: Quote link. Or manage it: Manage link, thanks.');
  assert.deepEqual(tree.links.map((l) => [l.label, l.href]), [['Quote link', quote], ['Manage link', `${base}index.html#manage/EL-1043`]]);
  const plain = walk(bodyOf(WhatsAppBubble({ body: 'Call 07885 496800. Ref EL-1043' })));
  assert.equal(plain.text, 'Call 07885 496800. Ref EL-1043');
  assert.deepEqual(plain.links, []);
  assert.equal(walk(bodyOf(WhatsAppBubble({ body: undefined }))).text, '');
});
