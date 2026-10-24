// js/ui/tabs.js: Tabs and TabPanel (in-page WAI-ARIA tabs with a sliding indicator).
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { h, useEffect, useLayoutEffect, useRef } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx, uid } from './util.js';

/**
 * Tab strip. tabs: [{ id, label, icon, count, testid }]; value is the active id; onChange(id) fires on click and arrow keys.
 * `idPrefix` pairs the tabs with their <TabPanel>s (ids are `${idPrefix}-tab-${id}` and `${idPrefix}-panel-${id}`).
 * variant: 'underline' (default) or 'pill'. A strip wider than its container scrolls inside itself.
 * `panels={false}` when the tabs only filter one shared list (no <TabPanel>s): then no aria-controls is written.
 */
export function Tabs({ tabs = [], value, onChange, ariaLabel, idPrefix, variant = 'underline', panels = true, class: cls, ...rest }) {
  const prefixRef = useRef(null);
  if (!prefixRef.current) prefixRef.current = idPrefix || uid('tabs');
  const prefix = idPrefix || prefixRef.current;
  const listRef = useRef(null);
  const readyRef = useRef(false);
  const active = Math.max(0, tabs.findIndex((t) => t.id === value));

  // Slide the indicator under the active tab; the first placement has no transition.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const place = () => {
      const el = list.children[active + 1]; // child 0 is the indicator
      if (!el || !el.offsetWidth) return;
      list.style.setProperty('--ind-x', el.offsetLeft + 'px');
      list.style.setProperty('--ind-w', el.offsetWidth + 'px');
      if (!readyRef.current) { readyRef.current = true; requestAnimationFrame(() => list.classList.add('is-ready')); }
    };
    place();
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(place); ro.observe(list); }
    return () => { if (ro) ro.disconnect(); };
  }, [active, tabs.length, tabs.map((t) => t.label).join('|')]);

  // Keep the active tab visible inside a scrolling strip.
  useEffect(() => {
    const list = listRef.current;
    const el = list && list.children[active + 1];
    if (list && el && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2);
    }
  }, [active]);

  const onKeyDown = (e) => {
    const n = tabs.length;
    if (!n) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (active + 1) % n;
    else if (e.key === 'ArrowLeft') next = (active - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    if (onChange) onChange(tabs[next].id);
    const btn = listRef.current && listRef.current.children[next + 1];
    if (btn) btn.focus();
  };

  return h('div', { class: cx('ui-tabs', `ui-tabs--${variant}`, cls), ...rest },
    h('div', { class: 'ui-tabs__list', role: 'tablist', 'aria-label': ariaLabel, ref: listRef, onKeyDown },
      h('span', { class: 'ui-tabs__indicator', 'aria-hidden': 'true' }),
      tabs.map((t, i) => h('button', {
        type: 'button', role: 'tab', key: t.id,
        id: `${prefix}-tab-${t.id}`, 'aria-controls': panels ? `${prefix}-panel-${t.id}` : undefined,
        'aria-selected': i === active ? 'true' : 'false', tabindex: i === active ? 0 : -1,
        class: cx('ui-tabs__tab', i === active && 'is-selected'),
        'data-testid': t.testid,
        onClick: () => { if (onChange) onChange(t.id); }
      },
      t.icon ? h(Icon, { name: t.icon, size: 18 }) : null,
      h('span', { class: 'ui-tabs__label' }, t.label),
      t.count !== undefined && t.count !== null ? h('span', { class: 'ui-tabs__count' }, String(t.count)) : null))));
}

/** Panel for one tab. Renders its children only while active; keeps the tab/panel ids paired. */
export function TabPanel({ idPrefix, id, value, class: cls, children, ...rest }) {
  const on = value === id;
  return h('div', {
    class: cx('ui-tabpanel', cls), role: 'tabpanel', id: `${idPrefix}-panel-${id}`, 'aria-labelledby': `${idPrefix}-tab-${id}`,
    tabindex: 0, hidden: on ? undefined : true, ...rest
  }, on ? children : null);
}
