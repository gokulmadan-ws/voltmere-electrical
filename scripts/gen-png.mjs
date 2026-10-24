// scripts/gen-png.mjs: one-off generator that renders the PNG icons from img/logo-mark.svg with Playwright.
// Owner: WP2
//
// Usage (Playwright is not installed in the repo; point QA_DEPS_DIR at a folder that holds
// node_modules/playwright-core):
//   QA_DEPS_DIR=/path/to/qa-deps node electrician/scripts/gen-png.mjs
// Writes img/icon-192.png, img/icon-512.png and img/apple-touch-icon.png (180x180).
// The apple icon is a full-bleed square (iOS rounds the corners itself, and would show black
// corners behind a transparent rounded icon); the other two keep the rounded mark.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const depsDir = process.env.QA_DEPS_DIR;
if (!depsDir) {
  console.error('Set QA_DEPS_DIR to the folder that contains node_modules/playwright-core.');
  process.exit(1);
}
const { chromium } = createRequire(depsDir.replace(/\/?$/, '/'))('playwright-core');
const chromePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'img', 'logo-mark.svg'), 'utf8')
  // The mark is decorative in a PNG; drop the img role so the inline copy adds no a11y noise.
  .replace(/ role="img" aria-label="[^"]*"/, '');

const jobs = [
  { file: 'icon-192.png', size: 192, square: false },
  { file: 'icon-512.png', size: 512, square: false },
  { file: 'apple-touch-icon.png', size: 180, square: true }
];

const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const job of jobs) {
    const markup = job.square ? svg.replace('rx="16"', 'rx="0"') : svg;
    await page.setViewportSize({ width: job.size, height: job.size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
      `<div style="width:${job.size}px;height:${job.size}px">${markup.replace('<svg ', `<svg style="width:${job.size}px;height:${job.size}px;display:block" `)}</div>` +
      `</body></html>`
    );
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: job.size, height: job.size } });
    writeFileSync(join(root, 'img', job.file), png);
    console.log(`Wrote img/${job.file} (${job.size}x${job.size}, ${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
