// js/ui/load-css.js: loadCss(href), an idempotent stylesheet loader used by the view loader.
// Owner: WP2

const pending = new Map();

/**
 * Load a stylesheet once. `href` is relative to the page (dashboard.html), like a <link href>.
 * Resolves true when loaded, false when it failed (a missing view stylesheet must not block the view).
 */
export function loadCss(href) {
  if (pending.has(href)) return pending.get(href);
  const promise = new Promise((resolve) => {
    let link = null;
    for (const el of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (el.getAttribute('href') === href) { link = el; break; }
    }
    if (link && link.sheet) { resolve(true); return; }
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
    link.addEventListener('load', () => resolve(true), { once: true });
    link.addEventListener('error', () => { console.warn('Stylesheet failed to load:', href); resolve(false); }, { once: true });
  });
  pending.set(href, promise);
  return promise;
}
