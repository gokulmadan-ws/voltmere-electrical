// js/ui/rows.js: ListRow, DataTable (responsive list rows) and KeyValueList.
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { h } from '../vendor/preact-htm.js';
import { Icon } from './display.js';
import { cx } from './util.js';

/**
 * One row of a `db-list` (it carries `db-list__item`, so dividers and the 56px minimum come from there).
 * A link when `href`, a button when `onClick`, otherwise a plain row. `as="li"` wraps it for a <ul class="db-list">.
 */
export function ListRow({
  title, subtitle, meta, leading, trailing, value, valueHint, href, onClick, chevron, selected, tone = 'default', as = 'div', testid, class: cls, ...rest
}) {
  const interactive = !!(href || onClick);
  const showChevron = chevron === undefined ? interactive : !!chevron;
  const classes = cx('db-list__item', 'ui-row', tone !== 'default' && `ui-row--${tone}`, selected && 'is-selected', interactive && 'ui-row--interactive', cls);
  const inner = [
    leading ? h('span', { class: 'ui-row__lead', key: 'l' }, leading) : null,
    h('span', { class: 'ui-row__main', key: 'm' },
      h('span', { class: 'ui-row__title' }, title),
      subtitle ? h('span', { class: 'ui-row__sub' }, subtitle) : null,
      meta ? h('span', { class: 'ui-row__meta' }, meta) : null),
    (value !== undefined && value !== null) || valueHint || trailing
      ? h('span', { class: 'ui-row__end', key: 'e' },
        value !== undefined && value !== null ? h('span', { class: 'ui-row__value' }, value) : null,
        valueHint ? h('span', { class: 'ui-row__hint' }, valueHint) : null,
        trailing || null)
      : null,
    showChevron ? h(Icon, { name: 'chevron-right', size: 20, class: 'ui-row__chev', key: 'c' }) : null
  ];
  const attrs = { class: classes, 'data-testid': testid, 'aria-current': selected ? 'true' : undefined, ...rest };
  let row;
  if (href) row = h('a', { ...attrs, href, onClick }, inner);
  else if (onClick) row = h('button', { ...attrs, type: 'button', onClick }, inner);
  else row = h(as === 'li' ? 'li' : 'div', attrs, inner);
  // An interactive row inside a <ul> needs the li around it; the divider rule (db-list > * + *) works on the li.
  return as === 'li' && interactive ? h('li', { class: 'ui-row__li', key: testid }, row) : row;
}

/**
 * Table on wide screens, stack of cards on phones. Div based with explicit ARIA roles, so it stays a table for screen readers.
 * columns: [{ key, header, render(row), primary, align: 'start'|'end', width, hideBelow: 'md', label: false }]
 */
export function DataTable({
  columns = [], rows = [], rowKey, rowHref, onRowClick, rowTestid, empty, caption, testid, class: cls, ...rest
}) {
  if (!rows.length && empty) return h('div', { class: cx('ui-table-empty', cls), 'data-testid': testid }, empty);
  const primaryKey = (columns.find((c) => c.primary) || columns[0] || {}).key;
  const cols = columns.map((c) => c.width || (c.align === 'end' ? 'auto' : 'minmax(0, 1fr)')).join(' ');
  const keyOf = (row, i) => (rowKey ? rowKey(row, i) : i);
  return h('div', { class: cx('ui-table', cls), role: 'table', 'aria-label': caption, 'data-testid': testid, style: { '--cols': cols }, ...rest },
    h('div', { class: 'ui-table__head', role: 'rowgroup' },
      h('div', { class: 'ui-table__row ui-table__row--head', role: 'row' },
        columns.map((c) => h('div', {
          class: cx('ui-table__cell', 'ui-table__cell--head', c.align === 'end' && 'is-end', c.hideBelow === 'md' && 'is-md'),
          role: 'columnheader', key: c.key
        }, c.header)))),
    h('div', { class: 'ui-table__body', role: 'rowgroup' },
      rows.map((row, i) => {
        const href = rowHref ? rowHref(row) : null;
        const click = onRowClick ? () => onRowClick(row) : null;
        const interactive = !!(href || click);
        return h('div', {
          class: cx('ui-table__row', interactive && 'is-interactive'), role: 'row', key: keyOf(row, i),
          'data-testid': rowTestid ? rowTestid(row) : (rowKey ? `row-${keyOf(row, i)}` : undefined)
        },
        columns.map((c) => {
          const content = c.render ? c.render(row) : row[c.key];
          const primary = c.key === primaryKey;
          let inner = content;
          if (primary && href) inner = h('a', { class: 'ui-table__link', href }, content);
          else if (primary && click) inner = h('button', { class: 'ui-table__link', type: 'button', onClick: click }, content);
          return h('div', {
            class: cx('ui-table__cell', primary && 'is-primary', c.align === 'end' && 'is-end', c.hideBelow === 'md' && 'is-md', c.label === false && 'is-nolabel'),
            role: 'cell', key: c.key, 'data-label': c.label === false || primary ? undefined : c.header
          }, inner);
        }));
      })));
}

/** Label and value pairs as a description list. items: [{ label, value, mono }]. */
export function KeyValueList({ items = [], class: cls, ...rest }) {
  return h('dl', { class: cx('ui-kv', cls), ...rest },
    items.filter((it) => it && it.value !== undefined && it.value !== null && it.value !== false).map((it, i) => h('div', { class: 'ui-kv__row', key: it.key || it.label || i },
      h('dt', { class: 'ui-kv__label' }, it.label),
      h('dd', { class: cx('ui-kv__value', it.mono && 'ui-kv__value--mono') }, it.value))));
}
