// js/ui/form.js: Field, Input, Select, Textarea, Switch (breaker lever), Segmented, Stepper.
// Owner: WP2
import { h, createContext, useContext, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx, uid } from './util.js';
import { gbp } from '../core/format.js';

// Field tells its control about the hint, the error and "required" so the control can set
// aria-describedby / aria-invalid / aria-required without the caller wiring ids by hand.
// (Context only reaches children in the SAME Preact root, which is the case for a Field and its control.)
const FieldContext = createContext(null);

function a11yFor(id, error, ctx, extraDescribedBy) {
  const invalid = !!(error || (ctx && ctx.error));
  const ids = [];
  if (extraDescribedBy) ids.push(extraDescribedBy);
  if (ctx && ctx.id === id && ctx.hint) ids.push(`${id}-hint`);
  if (ctx && ctx.id === id && ctx.error) ids.push(`${id}-error`);
  return {
    invalid,
    props: {
      'aria-invalid': invalid ? 'true' : undefined,
      'aria-describedby': ids.length ? ids.join(' ') : undefined,
      'aria-required': ctx && ctx.id === id && ctx.required ? 'true' : undefined
    }
  };
}

/** Label above the control (always visible), then the control, then the hint and the error. */
export function Field({ label, id, hint, error, errorTestid, required, class: cls, children, ...rest }) {
  const ctx = { id, hint: !!hint, error: !!error, required: !!required };
  return h(FieldContext.Provider, { value: ctx },
    h('div', { class: cx('ui-field', error && 'has-error', cls), ...rest },
      h('label', { class: 'ui-field__label', for: id }, label),
      children,
      hint ? h('p', { class: 'ui-field__hint', id: `${id}-hint` }, hint) : null,
      error
        ? h('p', { class: 'ui-field__error', id: `${id}-error`, role: 'alert', 'data-testid': errorTestid },
          h(Icon, { name: 'circle-alert', size: 16 }), h('span', null, error))
        : null));
}

/** Text input: 52px, 16px font (no iOS zoom). Controlled: value + onInput. */
export function Input({ id, value, onInput, type = 'text', error, class: cls, ...rest }) {
  const ctx = useContext(FieldContext);
  const a = a11yFor(id, error, ctx, rest['aria-describedby']);
  return h('input', {
    id, type, value, onInput,
    class: cx('ui-input', a.invalid && 'is-invalid', cls),
    ...a.props,
    ...rest,
    'aria-describedby': a.props['aria-describedby']
  });
}

/** Native <select> with a drawn chevron. Controlled: value + onChange. `options` is [{ value, label }]. */
export function Select({ id, value, onChange, options = [], error, class: cls, ...rest }) {
  const ctx = useContext(FieldContext);
  const a = a11yFor(id, error, ctx, rest['aria-describedby']);
  return h('span', { class: 'ui-select-wrap' },
    h('select', {
      id, value, onChange,
      class: cx('ui-select', a.invalid && 'is-invalid', cls),
      ...a.props,
      ...rest,
      'aria-describedby': a.props['aria-describedby']
    }, options.map((o) => h('option', { value: o.value, key: o.value }, o.label))),
    h(Icon, { name: 'chevron-down', size: 20, class: 'ui-select__chevron' }));
}

/** Multi-line input, 16px font. */
export function Textarea({ id, value, onInput, rows = 3, error, class: cls, ...rest }) {
  const ctx = useContext(FieldContext);
  const a = a11yFor(id, error, ctx, rest['aria-describedby']);
  return h('textarea', {
    id, value, onInput, rows,
    class: cx('ui-textarea', a.invalid && 'is-invalid', cls),
    ...a.props,
    ...rest,
    'aria-describedby': a.props['aria-describedby']
  });
}

/**
 * On/off switch drawn as a breaker lever. The whole 56px row is the target; state is also written as the
 * word On / Off, so it never relies on the green LED alone. `onChange(checked)` gets the NEW value.
 */
export function Switch({ checked, onChange, label, description, disabled, id, class: cls, ...rest }) {
  const idsRef = useRef(null);
  if (!idsRef.current) {
    const base = id || uid('sw');
    idsRef.current = { label: `${base}-label`, desc: `${base}-desc` };
  }
  const ids = idsRef.current;
  const on = !!checked;
  return h('button', {
    type: 'button', role: 'switch', id,
    class: cx('ui-switch', on && 'is-on', disabled && 'is-disabled', cls),
    'aria-checked': on ? 'true' : 'false',
    'aria-labelledby': ids.label,
    'aria-describedby': description ? ids.desc : undefined,
    disabled: disabled ? true : undefined,
    onClick: () => { if (!disabled && onChange) onChange(!on); },
    ...rest
  },
  h('span', { class: 'ui-switch__text' },
    h('span', { class: 'ui-switch__label', id: ids.label }, label),
    description ? h('span', { class: 'ui-switch__desc', id: ids.desc }, description) : null),
  h('span', { class: 'ui-switch__state', 'aria-hidden': 'true' }, on ? 'On' : 'Off'),
  h('span', { class: 'ui-switch__body', 'aria-hidden': 'true' },
    h('span', { class: 'ui-switch__led' }),
    h('span', { class: 'ui-switch__lever' })));
}

/**
 * Radio-style choice strip. Roving tabindex (the selected option is the tab stop), arrow keys move and select.
 * Wider than its container: it scrolls inside itself and brings the selected option into view on mount.
 */
export function Segmented({ options = [], value, onChange, ariaLabel, size = 'md', class: cls, ...rest }) {
  const wrapRef = useRef(null);
  const selected = options.findIndex((o) => o.value === value);
  const stop = selected >= 0 ? selected : 0;

  useEffect(() => {
    const wrap = wrapRef.current;
    const el = wrap && wrap.querySelector('[aria-checked="true"]');
    if (wrap && el && wrap.scrollWidth > wrap.clientWidth) {
      wrap.scrollLeft = Math.max(0, el.offsetLeft - (wrap.clientWidth - el.offsetWidth) / 2);
    }
  }, []);

  const onKeyDown = (e) => {
    const n = options.length;
    if (!n) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (stop + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (stop - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    const btn = wrapRef.current && wrapRef.current.children[next];
    if (btn) btn.focus();
  };

  return h('div', {
    class: cx('ui-seg', size === 'sm' && 'ui-seg--sm', cls),
    role: 'radiogroup', 'aria-label': ariaLabel, ref: wrapRef, onKeyDown, ...rest
  }, options.map((o, i) => h('button', {
    type: 'button', role: 'radio', key: o.value,
    class: cx('ui-seg__opt', i === selected && 'is-selected'),
    'aria-checked': i === selected ? 'true' : 'false',
    tabindex: i === stop ? 0 : -1,
    'data-testid': o.testid,
    onClick: () => onChange(o.value)
  }, o.icon ? h(Icon, { name: o.icon, size: 18 }) : null, h('span', { class: 'ui-seg__label' }, o.label))));
}

/** Whole-number stepper with big minus and plus buttons (48px) and a typeable amount. */
export function Stepper({ value, onChange, step = 5, min = 0, max = 99999, format = gbp, label, testids = {}, class: cls, ...rest }) {
  const [text, setText] = useState(null); // the raw digits while the input has focus, else null
  const clamp = (n) => Math.min(max, Math.max(min, n));
  const num = Number(value) || 0;
  const onInput = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, String(max).length);
    setText(raw);
    if (raw !== '') { const n = parseInt(raw, 10); if (n >= min && n <= max) onChange(n); }
  };
  const onBlur = () => {
    if (text === null) return;
    onChange(clamp(text === '' ? min : parseInt(text, 10)));
    setText(null);
  };
  // Selecting on focus lets a tap-and-type replace the amount. The shown text is NOT changed on focus: a test
  // (or a paste) that selects first and types second must still replace the whole value.
  const onFocus = (e) => {
    const el = e.target;
    setTimeout(() => { try { el.select(); } catch (err) { /* not selectable */ } }, 0);
  };
  return h('div', { class: cx('ui-stepper', cls), role: 'group', 'aria-label': label, ...rest },
    h('button', {
      type: 'button', class: 'ui-stepper__btn', 'aria-label': `Decrease ${label}`, 'data-testid': testids.minus,
      disabled: num <= min ? true : undefined, onClick: () => onChange(clamp(num - step))
    }, h('span', { 'aria-hidden': 'true' }, '−')),
    h('input', {
      class: 'ui-stepper__input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', enterkeyhint: 'done',
      autocomplete: 'off', 'aria-label': label, 'data-testid': testids.input,
      value: text !== null ? text : format(num), onInput, onBlur, onFocus
    }),
    h('button', {
      type: 'button', class: 'ui-stepper__btn', 'aria-label': `Increase ${label}`, 'data-testid': testids.plus,
      disabled: num >= max ? true : undefined, onClick: () => onChange(clamp(num + step))
    }, h('span', { 'aria-hidden': 'true' }, '+')));
}
