// js/landing/idea.js: the "Idea from us" tag and the data-proto plumbing every public page shares (landing, funnel, quote page).
// Owner: LP1 (polish round 3); the tag re-drawn for LANDING-V5 (4.7) by B1. The rule: a public page may say only what 180 Electrical's own site says, plus clearly tagged IDEAS. An idea is
// anything we added that he has not said: a priced example quote, savings figures, product specs, payment terms, guarantees, "pay after", a
// suggested visit date, a free survey. Every such block gets data-proto (protoProps) and a small visible tag (ProtoTag). The switch in the
// prototype strip ("Show: With ideas | Only my content") hides every [data-proto] (css/base.css and css/landing.css).
//
//   <section class="x" ...${protoProps()}> <${ProtoTag} /> ... </section>        a whole idea block
//   <p ...${protoProps({ 'data-testid': 'x' })}>...</p>                          merge more props in
import { html } from '../vendor/preact-htm.js';
import { cx } from '../ui/util.js';

export { IDEAS_KEY, IdeasSwitch, getIdeasMode, initIdeasMode, setIdeasMode, useIdeasMode } from '../ui/ideas.js';

/** The tag's words (his site does not say it, so we say so on the page itself). */
export const IDEA_LABEL = 'Idea from us, not on your site today';

/** Props that mark a block as an idea (it vanishes under "Only my content"). Pass extra props to merge them in. */
export function protoProps(extra) {
  return { 'data-proto': 'true', ...(extra || {}) };
}

/**
 * The small visible tag: a 7px outlined diamond (the cut's 45 degrees) and "Idea from us, not on your site today", plain 13px grey text, no border, no fill, no radius (a label,
 * never a button, never red: red means act or selected). It always sits directly under the dashed rule that opens an idea block. `label` overrides the words for a tighter spot;
 * the default is the lead's wording. Styled in css/landing.css (.ui-idea-tag, .ui-idea-tag__d).
 */
export function ProtoTag({ label = IDEA_LABEL, class: cls, ...rest }) {
  return html`<span class=${cx('ui-idea-tag', cls)} data-testid="idea-tag" ...${rest}><i class="ui-idea-tag__d" aria-hidden="true"></i><span>${label}</span></span>`;
}
