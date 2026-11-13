// Lighthouse (mobile, default config) against site/ served locally. Issue #10.
// Usage: npm i -g lighthouse@12 (or set LIGHTHOUSE_BIN), then: node tests/site/lighthouse.mjs
// Writes docs/screens/lighthouse-mobile.json (summary) and exits non-zero if perf or a11y < 90.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'docs/screens');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const tmp = path.join(OUT, '.lh-full.json');
const lhBin = process.env.LIGHTHOUSE_BIN || 'lighthouse';
// The server lives in this process, so Lighthouse must run asynchronously (a sync exec would block it).
const run = (cmd, args, opts) => new Promise((res, rej) => spawn(cmd, args, { stdio: 'inherit', ...opts }).on('exit', (c) => (c === 0 ? res() : rej(new Error('lighthouse exit ' + c)))));
try {
  await run(lhBin, [url, '--quiet', '--output=json', `--output-path=${tmp}`, '--only-categories=performance,accessibility,best-practices',
    `--chrome-flags=--headless=new --no-sandbox`], { env: { ...process.env, CHROME_PATH: CHROME } });
} finally { server.close(); }
const lhr = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.unlinkSync(tmp);
const sc = Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
const a = lhr.audits; const num = (k) => a[k] && a[k].numericValue != null ? +a[k].numericValue.toFixed(0) : null;
const failing = Object.values(lhr.categories.accessibility.auditRefs).map((r) => a[r.id]).filter((x) => x && x.score !== null && x.score < 1).map((x) => x.id);
const summary = { date: lhr.fetchTime, lighthouse: lhr.lighthouseVersion, formFactor: lhr.configSettings.formFactor, throttling: lhr.configSettings.throttlingMethod, url: 'site/ served locally', scores: sc,
  metrics_ms: { FCP: num('first-contentful-paint'), LCP: num('largest-contentful-paint'), TBT: num('total-blocking-time'), SI: num('speed-index') }, CLS: a['cumulative-layout-shift'].numericValue, a11y_failing_audits: failing };
fs.writeFileSync(path.join(OUT, 'lighthouse-mobile.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(sc.performance >= 90 && sc.accessibility >= 90 ? 0 : 1);
