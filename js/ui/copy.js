// js/ui/copy.js: CopyField (read-only value with copy button and secret reveal) and CodeBlock.
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { h, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { Button } from './button.js';
import { copyText, cx, uid } from './util.js';

/** Shared copy-feedback state: idle, then "copied" (or "failed") for a couple of seconds. */
function useCopyFeedback() {
  const [state, setState] = useState('idle');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (next) => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2400);
  };
  return [state, flash];
}

/**
 * Read-only value, a copy button, and an optional mask. `secret` shows dots until "Show". Copy always copies the real value.
 * If the clipboard is blocked the value is revealed and selected so it can be copied by hand.
 * Additive props: `display` is a friendlier text to show (a link without its https://) while Copy still copies `value`;
 * `clamp` (a number of lines, with `multiline`) shows the text clamped with an ellipsis and a "Show full link" toggle that
 * opens the whole value. Every field carries the real value in `data-full`.
 */
export function CopyField({ label, value, secret, mono = true, hint, id, onCopy, testid, multiline, display, clamp, expandLabel = 'Show full link', class: cls, ...rest }) {
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = id || uid('copy');
  const fid = idRef.current;
  const inputRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [state, flash] = useCopyFeedback();
  const text = String(value === undefined || value === null ? '' : value);
  const masked = !!secret && !revealed;
  // A friendlier `display` text stands in for the value until the whole value is asked for (or a failed copy selects it by hand).
  const shown = !secret && !revealed && display !== undefined && display !== null ? String(display) : text;
  const canClamp = !!multiline && Number(clamp) > 0 && !revealed;
  const clamped = canClamp && !expanded;

  const copy = async () => {
    const ok = await copyText(text);
    if (!ok) {
      setRevealed(true);
      setTimeout(() => { const el = inputRef.current; if (el) { try { el.focus(); el.select(); } catch (e) { /* not selectable */ } } }, 0);
    }
    flash(ok ? 'copied' : 'failed');
    if (onCopy) onCopy(ok);
  };

  const common = {
    id: fid, class: cx('ui-copy__input', mono && 'ui-copy__input--mono'), readonly: true, value: multiline ? text : shown, ref: inputRef,
    spellcheck: false, autocomplete: 'off', 'data-testid': testid ? `${testid}-value` : undefined, 'data-full': text,
    'aria-describedby': hint ? `${fid}-hint` : undefined,
    onFocus: (e) => { const el = e.target; setTimeout(() => { try { el.select(); } catch (err) { /* ok */ } }, 0); }
  };
  let control;
  if (clamped) {
    // Clamped: a few lines with an ellipsis (a textarea cannot draw one). It is selectable, and the toggle below opens the whole value.
    control = h('div', {
      class: cx('ui-copy__input', 'ui-copy__clamp', mono && 'ui-copy__input--mono'), id: fid, role: 'textbox', 'aria-readonly': 'true', tabindex: 0,
      'aria-labelledby': `${fid}-label`, 'aria-describedby': hint ? `${fid}-hint` : undefined,
      'data-testid': testid ? `${testid}-value` : undefined, 'data-full': text, style: { '--lines': Number(clamp) }
    }, h('span', { class: 'ui-copy__clamp-text' }, multiline && display !== undefined && display !== null ? String(display) : text));
  } else if (multiline) control = h('textarea', { ...common, rows: expanded ? 4 : 3 });
  else control = h('input', { ...common, type: masked ? 'password' : 'text', 'data-lpignore': 'true', 'data-1p-ignore': 'true' });

  const copyLabel = state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy';

  return h('div', { class: cx('ui-copy', state === 'copied' && 'is-copied', multiline && Number(clamp) > 0 && 'ui-copy--clamp', cls), 'data-testid': testid, ...rest },
    h('label', { class: 'ui-field__label', for: fid, id: `${fid}-label` }, label),
    h('div', { class: 'ui-copy__row' },
      canClamp
        ? h('div', { class: 'ui-copy__stack' }, control,
          h('button', { type: 'button', class: 'ui-copy__more', 'aria-expanded': expanded ? 'true' : 'false', onClick: () => setExpanded(!expanded), 'data-testid': testid ? `${testid}-more` : undefined },
            expanded ? 'Show less' : expandLabel, h(Icon, { name: expanded ? 'chevron-up' : 'chevron-down', size: 18 })))
        : control,
      secret ? h(Button, {
        variant: 'secondary', size: 'sm', class: 'ui-copy__btn', icon: revealed ? 'eye-off' : 'eye',
        'aria-pressed': revealed ? 'true' : 'false', 'aria-label': `${revealed ? 'Hide' : 'Show'} ${label}`,
        onClick: () => setRevealed(!revealed), 'data-testid': testid ? `${testid}-reveal` : undefined
      }, h('span', { class: 'ui-copy__btn-text' }, revealed ? 'Hide' : 'Show')) : null,
      h(Button, {
        variant: state === 'copied' ? 'primary' : 'secondary', size: 'sm', class: 'ui-copy__btn ui-copy__copy',
        icon: state === 'copied' ? 'check' : 'copy', 'aria-label': `Copy ${label}`,
        onClick: copy, 'data-testid': testid ? `${testid}-copy` : undefined
      }, h('span', { class: 'ui-copy__btn-text' }, copyLabel))),
    hint ? h('p', { class: 'ui-field__hint', id: `${fid}-hint` }, hint) : null,
    h('span', { class: 'u-sr-only', role: 'status', 'aria-live': 'polite' }, state === 'copied' ? `${label} copied` : state === 'failed' ? `${label} selected. Press copy on your keyboard.` : ''));
}

/** Monospace block with a copy button. The scroll region is keyboard focusable and never widens the page. */
export function CodeBlock({ code, label, language, copy = true, wrap, testid, class: cls, ...rest }) {
  const [state, flash] = useCopyFeedback();
  const text = String(code === undefined || code === null ? '' : code);
  const onCopy = async () => { flash((await copyText(text)) ? 'copied' : 'failed'); };
  return h('figure', { class: cx('ui-code', wrap && 'ui-code--wrap', cls), 'data-testid': testid, ...rest },
    h('figcaption', { class: 'ui-code__bar' },
      h('span', { class: 'ui-code__label' }, label, language ? h('span', { class: 'ui-code__lang' }, language) : null),
      copy ? h(Button, {
        variant: 'ghost', size: 'sm', class: 'ui-code__copy', icon: state === 'copied' ? 'check' : 'copy',
        'aria-label': `Copy ${label}`, onClick: onCopy, 'data-testid': testid ? `${testid}-copy` : undefined
      }, state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy') : null),
    h('pre', { class: 'ui-code__pre', tabindex: 0, role: 'region', 'aria-label': label }, h('code', null, text)),
    h('span', { class: 'u-sr-only', role: 'status', 'aria-live': 'polite' }, state === 'copied' ? `${label} copied` : ''));
}
