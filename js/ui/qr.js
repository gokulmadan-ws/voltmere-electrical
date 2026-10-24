// js/ui/qr.js: QrCode component plus makeQr and qrSvgMarkup (SVG QR codes from the vendored qrcode-generator, loaded lazily).
// Owner: B3 (V3 UI kit; contract in docs/V3-UI.md)
import { h, useEffect, useState } from '../vendor/preact-htm.js';
import { cx } from './util.js';

let generator = null;
/** Load the vendored generator once, on first use (pages without a QR code never download it). */
function loadGenerator() {
  if (!generator) generator = import('../vendor/qrcode.js').then((m) => m.default);
  return generator;
}

/** Build a QR matrix. Resolves { size, isDark(row, col) }; rejects when the text is too long for a QR code. */
export async function makeQr(value, { level = 'M' } = {}) {
  const qrcode = await loadGenerator();
  const qr = qrcode(0, level);
  qr.addData(String(value === undefined || value === null ? '' : value));
  qr.make();
  return { size: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

/** One path for all dark modules (a run of dark cells in a row is one rectangle), offset by the quiet-zone margin. */
function pathFor(qr, margin) {
  const parts = [];
  for (let r = 0; r < qr.size; r++) {
    let c = 0;
    while (c < qr.size) {
      if (!qr.isDark(r, c)) { c++; continue; }
      let end = c;
      while (end < qr.size && qr.isDark(r, end)) end++;
      parts.push(`M${c + margin} ${r + margin}h${end - c}v1h${c - end}z`);
      c = end;
    }
  }
  return parts.join('');
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A standalone SVG document as a string, for saving or printing (use saveFile). Colours are literal names because a saved
 * file has no CSS variables; the defaults (black on white) are what scanners read best.
 */
export async function qrSvgMarkup(value, { level = 'M', margin = 4, fg = 'black', bg = 'white', title = 'QR code', size } = {}) {
  const qr = await makeQr(value, { level });
  const n = qr.size + margin * 2;
  const dim = size ? ` width="${Number(size)}" height="${Number(size)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"${dim} shape-rendering="crispEdges" role="img" aria-label="${xml(title)}">`
    + `<title>${xml(title)}</title><rect width="${n}" height="${n}" fill="${xml(bg)}"/><path fill="${xml(fg)}" d="${pathFor(qr, margin)}"/></svg>`;
}

/**
 * QR code as inline SVG: black modules on a white square in both themes (scanners need that). `label` names it for
 * screen readers (say what it opens). Too much data shows a short notice instead of throwing.
 */
export function QrCode({ value, size = 192, level = 'M', margin = 4, label, class: cls, ...rest }) {
  const [res, setRes] = useState({ status: 'loading', d: '', n: 0, key: '' });
  const key = `${value}|${level}|${margin}`;
  useEffect(() => {
    let live = true;
    makeQr(value, { level }).then((qr) => {
      if (live) setRes({ status: 'ok', d: pathFor(qr, margin), n: qr.size + margin * 2, key });
    }).catch(() => { if (live) setRes({ status: 'error', d: '', n: 0, key }); });
    return () => { live = false; };
  }, [key]);

  const box = { width: size + 'px', height: size + 'px' };
  if (res.status === 'error' && res.key === key) {
    return h('div', { class: cx('ui-qr ui-qr--error', cls), style: box, role: 'img', 'aria-label': 'This link is too long for a QR code', 'data-testid': 'qr-code', ...rest },
      h('span', null, 'Too long for a QR code'));
  }
  if (res.status !== 'ok' || res.key !== key) {
    return h('div', { class: cx('ui-qr ui-qr--loading', cls), style: box, 'aria-hidden': 'true', 'data-testid': 'qr-code', ...rest });
  }
  return h('svg', {
    class: cx('ui-qr', cls), style: box, width: size, height: size, viewBox: `0 0 ${res.n} ${res.n}`,
    role: 'img', 'aria-label': label || 'QR code', 'shape-rendering': 'crispEdges', 'data-testid': 'qr-code', ...rest
  }, h('rect', { width: res.n, height: res.n, fill: 'white' }), h('path', { d: res.d, fill: 'black' }));
}
