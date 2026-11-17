# Performance: eager shell budget (#166)

Guard: `node tests/site/shell_budget.mjs [--list]` (static; also in smoke). Raw bytes of index.html + every eager file + the static import graph.
Network view: `node tests/site/first_paint_bytes.mjs [SITE_DIR] [--idle MS]` (bytes by category until the Recipes list shows every row, then idle).

## Eager shell by file (guard), 2026-11-17
| file | before | after |
|---|---|---|
| data/catalog.json (recipe index) | 147,931 | 72,348 |
| app.js | 92,134 | 92,077 |
| packs.js | 48,564 | 48,564 |
| style.css | 46,320 | 46,320 |
| index.html | 19,121 | 19,121 |
| craftpack.json (shim manifest) | 19,111 | 19,110 |
| packs-kinds.js / engine/packs-core.js | 17,184 / 13,401 | same |
| remaining 12 small files (vox manifest, fonts, ui/pwa/palette/forms, css, lock) | 65,502 | 65,502 |
| **total** | **469,268** (budget 470,000) | **393,627** (budget 433,000) |

By category (after): code 219,901 (incl. index.html), CSS 61,068, recipe index 72,348, manifests and lock 30,354, font 9,956.

## Fetched by list-ready / idle (first_paint_bytes, 6 s idle)
| category | before | after |
|---|---|---|
| shell: recipes index | 167,981 | 72,362 |
| shell total at list-ready | 627,359 | 512,539 (incl. pack manifests and presets 147 K that the packs loader fetches next to the shell) |
| idle: syntax data (syntax.json 209 K) | 233,556 | 24,332 (plugins, practices) |

## What moved and why
- Index rows keep id, title, folder, tags, labels, family, verified, needs_samples, stackable, has_lowered, body. `intent, origin, unverified, bpm_hint, rms_dbfs, centroid_hz, peak` live in `data/recipes/<family>.json` (`tools/catalog/lib.mjs` BODY_FIELDS). Index is compact JSON.
- The `syntax` ingredient is `load: lazy` and `syntax.js` reads it on first use (view open, quick play, first completion), not at module load; composition.json was already lazy.
- Not done (follow-up): per-family split of syntax/composition files, per-pack lazy taxonomy, lazy intellisense/strudel.json (64 K, shared by params and editors, needed by literals on first editor use).
