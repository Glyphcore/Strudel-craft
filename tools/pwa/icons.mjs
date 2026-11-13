/* Render the PWA icons from the SVG sources (site/icons/icon.svg, maskable.svg) with Playwright Chromium.
   Usage (repo root): node tools/pwa/icons.mjs   -> site/icons/icon-192.png, icon-512.png, maskable-192.png, maskable-512.png, apple-touch-icon.png (180) */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site/icons');
const jobs = [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['maskable.svg', 'maskable-192.png', 192], ['maskable.svg', 'maskable-512.png', 512], ['maskable.svg', 'apple-touch-icon.png', 180]];
const browser = await chromium.launch();
for (const [src, out, size] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = fs.readFileSync(path.join(DIR, src), 'utf8');
  await page.setContent(`<html><body style="margin:0;background:transparent"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
  await page.waitForFunction(() => document.images[0].complete);
  await page.screenshot({ path: path.join(DIR, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close(); console.log('wrote', out, size + 'px');
}
await browser.close();
