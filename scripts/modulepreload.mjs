// scripts/modulepreload.mjs: keeps the <link rel="modulepreload"> block in index.html, quote.html and dashboard.html equal to the page's STATIC import graph.
// Why: the app is unbundled ES modules, so the browser only learns about a module's imports after it has fetched and parsed it: a graph 5 levels deep is 5 round trips
// (about 750 ms on a 150 ms phone connection) before anything can run. Listing every statically imported module in the page head lets the browser fetch them all at once.
// Dynamic import() targets (the booking sheet, the dashboard views) are NOT listed: they load when needed.
//
//   node scripts/modulepreload.mjs            rewrite the blocks (no output when nothing changed)
//   node scripts/modulepreload.mjs --check    exit 1 and say which page is stale (tests/unit/modulepreload.test.mjs runs this)
//
// The block sits between `<!-- modulepreload:begin -->` and `<!-- modulepreload:end -->`. Order: the order the modules will run (dependencies first).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGES = [
  { html: 'index.html', entry: 'js/landing/app.js' },
  { html: 'quote.html', entry: 'js/quote/app.js' },
  // The dashboard's default view (#/today) is a dynamic import of the shell, so its own chain (the view, then the modules it imports, then its two stylesheets) is a second waterfall
  // behind the first. An inline script in the head starts it at once, but only when the page is opened on that route (a deep link to another route does not pay for it).
  { html: 'dashboard.html', entry: 'js/dashboard/app.js', route: { view: 'js/dashboard/views/today.js', hashPattern: '^#/today(?:[/?]|$)' } }
];
const BEGIN = '<!-- modulepreload:begin (generated: node scripts/modulepreload.mjs) -->';
const END = '<!-- modulepreload:end -->';
const ROUTE_BEGIN = '<!-- routepreload:begin (generated: node scripts/modulepreload.mjs) -->';
const ROUTE_END = '<!-- routepreload:end -->';

/** The static imports of one module source: `import ... from 'x'`, `export ... from 'x'` and `import 'x'` (never `import('x')`). Relative specifiers only. */
export function staticImports(source) {
  const out = [];
  // `import { a, b } from 'x'` (the braces may span lines), `import x from 'x'`, `export ... from 'x'`, and the bare `import 'x'`; a line that starts with // or * is a comment and never matches
  const re = /(?:^|[\n;])[ \t]*(?:import|export)(?:\s+[^'";]*?\sfrom\s*|\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) if (m[1].startsWith('.')) out.push(m[1]);
  return out;
}

/** Every module the entry loads before it can run, in execution order (a module after the modules it imports). Paths are relative to the site root. */
export function staticGraph(entry, root = ROOT) {
  const order = [];
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const spec of staticImports(source)) visit(path.relative(root, path.resolve(path.dirname(path.join(root, rel)), spec)).split(path.sep).join('/'));
    order.push(rel);
  };
  visit(entry);
  return order;
}

export function blockFor(entry, root = ROOT) {
  return [BEGIN, ...staticGraph(entry, root).map((m) => `  <link rel="modulepreload" href="${m}">`), '  ' + END].join('\n');
}

/** The module paths currently listed in a page's block, or null when the page has no block. */
export function listedModules(htmlText) {
  const a = htmlText.indexOf('<!-- modulepreload:begin');
  const b = htmlText.indexOf(END);
  if (a < 0 || b < 0) return null;
  return [...htmlText.slice(a, b).matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
}

export function stalePages(root = ROOT) {
  const stale = [];
  for (const p of PAGES) {
    const text = fs.readFileSync(path.join(root, p.html), 'utf8');
    const listed = listedModules(text);
    const wanted = staticGraph(p.entry, root);
    const missing = wanted.filter((m) => !(listed || []).includes(m));
    const extra = (listed || []).filter((m) => !wanted.includes(m));
    if (!listed || missing.length || extra.length) stale.push({ page: p.html, missing, extra, noBlock: !listed });
    if (p.route) {
      const a = text.indexOf('<!-- routepreload:begin');
      const b = text.indexOf(ROUTE_END);
      const have = a >= 0 && b >= 0 ? text.slice(a, b + ROUTE_END.length) : '';
      if (have !== routeBlockFor(p, root)) stale.push({ page: p.html + ' (route block)', missing: [], extra: [], noBlock: !have });
    }
  }
  return stale;
}

/** The view's own modules (not already in the page's first-load graph) and its stylesheets (`export const css = [...]` in the view). */
export function routeAssets(page, root = ROOT) {
  const base = new Set(staticGraph(page.entry, root));
  const modules = staticGraph(page.route.view, root).filter((m) => !base.has(m));
  const source = fs.readFileSync(path.join(root, page.route.view), 'utf8');
  const m = /export const css = \[([^\]]*)\]/.exec(source);
  const css = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  return { modules, css };
}

export function routeBlockFor(page, root = ROOT) {
  const { modules, css } = routeAssets(page, root);
  return [
    ROUTE_BEGIN,
    '  <script>',
    '    (function () {',
    '      var h = location.hash;',
    `      if (h && h !== '#' && h !== '#/' && !/${page.route.hashPattern.replace(/\//g, '\\/')}/.test(h)) return;`,
    '      var add = function (rel, href, as) { var l = document.createElement(\'link\'); l.rel = rel; l.href = href; if (as) l.as = as; document.head.appendChild(l); };',
    `      ${JSON.stringify(modules).replace(/"/g, "'")}.forEach(function (m) { add('modulepreload', m); });`,
    `      ${JSON.stringify(css).replace(/"/g, "'")}.forEach(function (c) { add('preload', c, 'style'); });`,
    '    })();',
    '  </script>',
    '  ' + ROUTE_END
  ].join('\n');
}

function rewrite(root = ROOT) {
  let changed = 0;
  for (const p of PAGES) {
    const file = path.join(root, p.html);
    const text = fs.readFileSync(file, 'utf8');
    const block = blockFor(p.entry, root);
    const a = text.indexOf('<!-- modulepreload:begin');
    const b = text.indexOf(END);
    let next;
    if (a >= 0 && b >= 0) {
      const lineStart = text.lastIndexOf('\n', a) + 1;
      next = text.slice(0, lineStart) + '  ' + block + text.slice(b + END.length);
    } else {
      // first run: replace the hand-written modulepreload lines
      const lines = text.split('\n');
      const idx = lines.map((l, i) => (/<link rel="modulepreload"/.test(l) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) throw new Error(`${p.html}: no modulepreload lines to replace`);
      lines.splice(idx[0], idx.length, '  ' + block);
      next = lines.join('\n');
    }
    if (p.route) {
      const ra = next.indexOf('<!-- routepreload:begin');
      const rb = next.indexOf(ROUTE_END);
      const rblock = routeBlockFor(p, root);
      if (ra >= 0 && rb >= 0) {
        const lineStart = next.lastIndexOf('\n', ra) + 1;
        next = next.slice(0, lineStart) + '  ' + rblock + next.slice(rb + ROUTE_END.length);
      } else {
        const at = next.indexOf(END) + END.length;
        next = next.slice(0, at) + '\n  ' + rblock + next.slice(at);
      }
    }
    if (next !== text) { fs.writeFileSync(file, next); changed += 1; console.log('updated', p.html); }
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = stalePages();
    for (const s of stale) console.log(`${s.page} is stale${s.noBlock ? ' (no block)' : ''}: missing ${s.missing.join(', ') || 'nothing'}; extra ${s.extra.join(', ') || 'nothing'}`);
    if (stale.length) { console.log('run: node scripts/modulepreload.mjs'); process.exit(1); }
  } else {
    rewrite();
  }
}
