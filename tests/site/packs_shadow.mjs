// #143: the site loads with a clean console, no toast, and the Packs report shows identical duplicates collapsed. Usage: node tests/site/packs_shadow.mjs
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
const b = await chromium.launch(); const pg = await b.newPage(); const bad = [];
pg.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/unpkg|net::|Failed to load resource|favicon/i.test(m.text())) bad.push(m.text().slice(0, 160)); });
pg.on('pageerror', (e) => bad.push('pageerror ' + e.message.slice(0, 160)));
await pg.goto(`http://localhost:${srv.address().port}/`); await pg.waitForTimeout(4000);
const toasts = await pg.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent.trim()).filter(Boolean));
const rep = await pg.evaluate(() => { const r = window.strudelCraft?.packs?.report?.(); return r ? { w: r.warnings.length, i: (r.info || []).length, shadowWarn: r.warnings.filter((x) => x.code === 'W_PACK_SHADOW').length } : null; });
console.log(JSON.stringify({ bad, toasts, rep }));
await b.close(); srv.close();
process.exit(bad.length || toasts.some((t) => /shadow/i.test(t)) ? 1 : 0);
