// tests/unit/landing-ui.test.mjs: the landing page's primitives (docs/LANDING-V5.md 4.1, 4.2, 4.14, 5.2, 5.3, 5.13): LpButton, TextLink, Glyph, splitCredential, his hero words and the gallery's display order.
// Pure functions and vnodes only (no DOM): the browser behaviour is checked by tests/e2e/landing.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LpButton, TextLink } from '../../js/landing/ui.js';
import { Glyph, GLYPH_NAMES } from '../../js/landing/glyphs.js';
import { splitCredential } from '../../js/landing/hero.js';
import { CTA_LABEL, HERO, IMAGES, DEFAULT_CREDENTIALS, fillOwner } from '../../js/landing/content.js';
import { ProtoTag, IDEA_LABEL, protoProps } from '../../js/landing/idea.js';

const classes = (vnode) => String(vnode.props.class).split(/\s+/);
const kids = (vnode) => [].concat(vnode.props.children).filter(Boolean);

test('LpButton: a <button type="button"> with lp-btn and lp-cta, label first and the arrow glyph last', () => {
  const v = LpButton({ 'data-testid': 'x', children: CTA_LABEL });
  assert.equal(v.type, 'button');
  assert.equal(v.props.type, 'button');
  assert.deepEqual(classes(v).slice(0, 2), ['lp-btn', 'lp-cta']);
  assert.equal(v.props['data-testid'], 'x');
  const k = kids(v);
  assert.equal(k.length, 2, 'label and arrow');
  assert.equal(k[0].type, 'span');
  assert.equal(k[1].props.name, 'arrow');
});

test('LpButton: size sm has no arrow, xl and lg keep it; an href makes it an <a>; outline is not a quote button (no lp-cta, no arrow) and takes a leading glyph', () => {
  const sm = LpButton({ size: 'sm', children: 'x' });
  assert.ok(classes(sm).includes('lp-btn--sm') && classes(sm).includes('lp-cta'));
  assert.equal(kids(sm).length, 1, 'no arrow at 44px');
  for (const size of ['lg', 'xl']) assert.equal(kids(LpButton({ size, children: 'x' })).length, 2, `${size} keeps its arrow`);
  const a = LpButton({ href: 'tel:07885496800', variant: 'outline', icon: 'phone', 'aria-label': 'Call 07885 496800', children: 'Call' });
  assert.equal(a.type, 'a');
  assert.equal(a.props.href, 'tel:07885496800');
  assert.ok(classes(a).includes('lp-btn--outline') && !classes(a).includes('lp-cta'));
  const ak = kids(a);
  assert.equal(ak.length, 2, 'icon then label, no arrow');
  assert.equal(ak[0].props.name, 'phone');
  assert.equal(a.props['aria-label'], 'Call 07885 496800');
  assert.ok(!classes(LpButton({ cta: false, children: 'x' })).includes('lp-cta'), 'cta={false} drops the funnel marker');
  assert.ok(classes(LpButton({ block: true, class: 'mine', children: 'x' })).includes('lp-btn--block') && classes(LpButton({ class: 'mine', children: 'x' })).includes('mine'));
});

test('TextLink: lp-link with an arrow by default, quiet has none; <a> with href, else a <button type="button">', () => {
  const a = TextLink({ href: 'quote.html', children: 'See how a quote looks' });
  assert.equal(a.type, 'a');
  assert.ok(classes(a).includes('lp-link'));
  assert.equal(kids(a).length, 2);
  const q = TextLink({ quiet: true, children: 'Reset', 'data-testid': 'l3-calc-reset' });
  assert.equal(q.type, 'button');
  assert.ok(classes(q).includes('lp-link--quiet'));
  assert.equal(kids(q).length, 1);
});

test('Glyph: the five names only, stroke only, square caps, decorative; unknown names draw nothing', () => {
  assert.deepEqual([...GLYPH_NAMES].sort(), ['arrow', 'chev', 'phone', 'tick', 'x']);
  for (const name of GLYPH_NAMES) {
    const g = Glyph({ name });
    assert.equal(g.type, 'svg');
    assert.equal(g.props.fill, 'none');
    assert.equal(g.props.stroke, 'currentColor');
    assert.equal(g.props['aria-hidden'], 'true');
    assert.ok(classes(g).includes('lp-glyph') && classes(g).includes(`lp-glyph--${name}`));
    assert.ok(g.props['stroke-linecap'] === 'square');
  }
  assert.equal(Glyph({ name: 'arrow' }).props.width, 20);
  assert.equal(Glyph({ name: 'chev' }).props.width, 12);
  assert.equal(Glyph({ name: 'phone', size: 18 }).props.width, 18);
  assert.equal(Glyph({ name: 'nope' }), null);
});

test('splitCredential: "Level 3" and "2391" become logo-voice figures; anything else is a descriptor only; the text is never altered', () => {
  assert.deepEqual(splitCredential('Level 3 Electrical Installation'), { fig: 'Level 3', rest: 'Electrical Installation' });
  assert.deepEqual(splitCredential('2391 Inspection and Testing'), { fig: '2391', rest: 'Inspection and Testing' });
  assert.deepEqual(splitCredential('Level 2 Award in Something'), { fig: 'Level 2', rest: 'Award in Something' });
  assert.deepEqual(splitCredential('NICEIC approved contractor'), { fig: '', rest: 'NICEIC approved contractor' });
  assert.deepEqual(splitCredential('Fully insured'), { fig: '', rest: 'Fully insured' });
  for (const c of DEFAULT_CREDENTIALS) { const { fig, rest } = splitCredential(c); assert.equal(fig ? `${fig} ${rest}` : rest, c); }
  assert.deepEqual(DEFAULT_CREDENTIALS, ['Level 3 Electrical Installation', '2391 Inspection and Testing']);
});

test('his hero words are verbatim (docs/reference/180-site-report.md), the H1 splits into its two parts without changing a letter, and the button label is his', () => {
  assert.equal(CTA_LABEL, 'Get my installation quote');
  assert.equal(HERO.eyebrow, 'Local EV charger installation');
  assert.equal(HERO.title, 'Your own EV charger. Installed at home in Northern Ireland.');
  assert.equal(`${HERO.titleFirst} ${HERO.titleSecond}`, HERO.title);
  assert.ok(HERO.titleSecond.endsWith(HERO.titleNoWrap));
  assert.equal(HERO.sub, 'Make charging fit around your day. 180 Electrical helps homeowners across Northern Ireland choose and install the right charger for their home and vehicle.');
  assert.equal(HERO.note, 'Tell us a little about your home and what you need.');
  assert.equal(HERO.proofFree, 'Free, no-obligation quote.');
  assert.deepEqual(HERO.ticks, ['Advice on charger options', 'Installation tailored to your property', 'Speak directly with 180 Electrical']);
  assert.equal(HERO.credLabel, 'Accredited and qualified');
});

test('IMAGES.work is in display order (so the testid indices equal it) with a wall-type caption each and no charger make anywhere', () => {
  assert.deepEqual(IMAGES.work.map((w) => w.key), ['work1', 'work2', 'work4', 'work3']);
  assert.deepEqual(IMAGES.work.map((w) => w.caption), ['Red brick wall', 'Pebbledash wall', 'Orange brick wall', 'Brick pillar']);
  assert.ok(IMAGES.work[1].zoom >= 1.4, 'gallery-photo-1 is the zoomed phone screenshot');
  assert.equal(IMAGES.work[2].position, '50% 39%', 'the landscape keeps the charger above centre');
  for (const w of IMAGES.work) { assert.ok(!('chip' in w) && !('title' in w), 'the old chip and title fields are gone'); assert.ok(w.alt.length > 20 && !/zappi|ohme|fox/i.test(w.alt + w.caption)); assert.ok(w.w > 0 && w.h > 0, 'the box is reserved from the original size'); }
  assert.equal(IMAGES.hero.position, '50% 42%');
  assert.equal(IMAGES.about.position, '50% 59%');
});

test('ProtoTag and protoProps: the tag is a plain label with a diamond (no icon), the words are ours, data-proto marks an idea', () => {
  assert.equal(IDEA_LABEL, 'Idea from us, not on your site today');
  const t = ProtoTag({});
  assert.equal(t.type, 'span');
  assert.ok(classes(t).includes('ui-idea-tag'));
  assert.equal(t.props['data-testid'], 'idea-tag');
  const k = kids(t);
  assert.equal(k[0].type, 'i');
  assert.ok(String(k[0].props.class).includes('ui-idea-tag__d') && k[0].props['aria-hidden'] === 'true');
  assert.equal(k[1].props.children, IDEA_LABEL);
  assert.equal(ProtoTag({ label: 'Short' }).props.children[1].props.children, 'Short');
  assert.deepEqual(protoProps({ 'data-testid': 'x' }), { 'data-proto': 'true', 'data-testid': 'x' });
});

test('fillOwner still fills the {owner} token (default Daniel)', () => {
  assert.equal(fillOwner('Call {owner}', 'Dan'), 'Call Dan');
  assert.equal(fillOwner('Call {owner}'), 'Call Daniel');
});
