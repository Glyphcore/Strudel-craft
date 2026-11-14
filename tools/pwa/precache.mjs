#!/usr/bin/env node
/* Offline precache manifest for the installed app (#73): writes site/precache.json, which site/sw.js reads at install.
   - files: every same-origin file Play and the views can need (all scripts incl. lazily imported modules, styles, pages, data, pack pins,
     fonts, icons, the user-space prelude and the demo vox bank that word() falls back to). Larger vox banks stay lazy pack content.
   - cdn:   the pinned CDN entry modules the site imports (unpkg Strudel bundle, esm.sh CodeMirror / jsdiff); sw.js crawls each module's
     import graph at install, so the whole graph is cached under one VERSION.
   - banks: the default sample maps (JSON only; their audio stays lazy in sc-banks-1, an uncached bank toasts offline).
   Usage (repo root): node tools/pwa/precache.mjs          -> writes site/precache.json
                      node tools/pwa/precache.mjs --check  -> exit 1 if site/precache.json is stale (used by the deploy and tests/site/pwa_offline.mjs) */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(SITE, 'precache.json');
const EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.woff2', '.png', '.svg', '.ogg', '.wav', '.mp3']);
const SKIP = new Set(['sw.js', 'precache.json']); /* the worker itself, and this manifest (read with cache:'reload' at install) */
const LAZY_VOX = (rel) => rel.startsWith('data/vox/') && !rel.startsWith('data/vox/demo/') && !/^data\/vox\/[^/]+$/.test(rel); /* pack banks: cached on activation in sc-packs-1; the bank index pack's own top-level files (craftpack.json, banks.json, #85) stay in the shell so the loader and the Banks list work offline */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(path.relative(SITE, f).split(path.sep).join('/'));
  }
  return out;
}
const files = walk(SITE).filter((r) => EXT.has(path.extname(r)) && !SKIP.has(r) && !LAZY_VOX(r)).sort();

/* CDN module entries: string literals in site scripts; ${NAME} / ${NAME.key} placeholders resolve from `const NAME = ...` in the same file */
const cdn = new Set();
for (const rel of files.filter((r) => /\.(m?js|html)$/.test(r))) {
  const src = fs.readFileSync(path.join(SITE, rel), 'utf8');
  const consts = {};
  for (const m of src.matchAll(/^const ([A-Z_][A-Z0-9_]*) = ([{'][^\n;]*?[}'])\s*;/gm)) { try { consts[m[1]] = Function('"use strict"; return (' + m[2] + ');')(); } catch (e) { /* not a literal */ } }
  for (const m of src.matchAll(/['"`](https:\/\/(?:esm\.sh|unpkg\.com)\/[^'"`\s]+)['"`]/g)) {
    const url = m[1].replace(/\$\{([A-Z_][A-Z0-9_]*)(?:\.(\w+))?\}/g, (all, n, k) => {
      const v = k ? consts[n] && consts[n][k] : consts[n];
      if (typeof v !== 'string') throw new Error(`${rel}: cannot resolve ${all} in ${m[1]}`);
      return v;
    });
    if (rel !== 'compose.html' && rel !== 'plugins.html' && rel !== 'practices.html') cdn.add(url);
  }
}

/* default sample maps from app.js (github:user/repo -> raw strudel.json, Strudel's rule) */
const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
const maps = Function('return ' + app.match(/const SAMPLE_MAPS = (\[[^\]]*\]);/)[1])();
const banks = maps.map((m) => m.startsWith('github:') ? `https://raw.githubusercontent.com/${m.slice(7).split('/').slice(0, 2).join('/')}/${m.slice(7).split('/')[2] || 'main'}/strudel.json` : m);

const doc = { precache: 1, generator: 'node tools/pwa/precache.mjs', files, cdn: [...cdn].sort(), banks };
const text = JSON.stringify(doc, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('site/precache.json is stale: run node tools/pwa/precache.mjs'); process.exit(1); }
  console.log(`site/precache.json up to date (${files.length} files, ${doc.cdn.length} cdn entries, ${banks.length} sample maps)`);
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote site/precache.json (${files.length} files, ${doc.cdn.length} cdn entries, ${banks.length} sample maps)`);
}
