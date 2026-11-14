// Relative Lighthouse (mobile, default config, simulated throttling): site/ of several commits,
// each served from a clean `git archive` by the same static server, runs interleaved.
// Usage: LIGHTHOUSE_BIN=<path> CHROME_PATH=<chrome> node tests/site/lighthouse_relative.mjs [--runs 5] <commit> <commit> ...
// Prints every individual performance score and the median per commit. Writes nothing into the repo.
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { spawn, execFileSync } from 'child_process';
const argv = process.argv.slice(2); let runs = 5; const commits = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--runs') runs = +argv[++i]; else commits.push(argv[i]); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lhrel-'));
const sites = [];
for (const c of commits) {
  const dir = path.join(tmp, c.replace(/\W/g, '_')); fs.mkdirSync(dir);
  const tar = execFileSync('git', ['archive', c, 'site'], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  const root = path.join(dir, 'site');
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); sites.push({ c, srv, url: `http://127.0.0.1:${srv.address().port}/`, scores: [] });
}
const run = (args) => new Promise((res, rej) => spawn(process.env.LIGHTHOUSE_BIN || 'lighthouse', args, { stdio: 'ignore' }).on('exit', (c) => (c === 0 ? res() : rej(new Error('exit ' + c)))));
for (let i = 0; i < runs; i++) for (const s of sites) {
  const out = path.join(tmp, `${s.c.replace(/\W/g, '_')}-${i}.json`);
  await run([s.url, '--quiet', '--output=json', `--output-path=${out}`, '--only-categories=performance', '--chrome-flags=--headless=new --no-sandbox']);
  const lhr = JSON.parse(fs.readFileSync(out, 'utf8')); s.scores.push(Math.round(lhr.categories.performance.score * 100));
  console.error(`run ${i + 1} ${s.c}: ${s.scores.at(-1)} (LCP ${Math.round(lhr.audits['largest-contentful-paint'].numericValue)} ms)`);
}
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
for (const s of sites) { console.log(`${s.c}: scores [${s.scores}] median ${median(s.scores)}`); s.srv.close(); }
fs.rmSync(tmp, { recursive: true, force: true });
