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
| shell: recipes index | 147,945 | 72,362 |
| shell total at list-ready | 588,179 | 512,539 (incl. pack manifests and presets 147 K that the packs loader fetches next to the shell) |
| idle: syntax data (syntax.json 209 K) | 233,556 | 24,332 (plugins, practices) |

## What moved and why
- Index rows keep id, title, folder, tags, labels, family, verified, needs_samples, stackable, has_lowered, body. `intent, origin, unverified, bpm_hint, rms_dbfs, centroid_hz, peak` live in `data/recipes/<family>.json` (`tools/catalog/lib.mjs` BODY_FIELDS). Index is compact JSON.
- The `syntax` ingredient is `load: lazy` and `syntax.js` reads it on first use, not at module load; composition.json was already lazy. syntax.js itself only loads when the Syntax view opens (or a syntax quick play needs it), so a cold editor completion has no syntax snippets until then (same as before this change).
- Cost moved to first search: the first query fetches every recipe body (13 files, 254,180 bytes vs 215,185 before, +39 KB, because intent and measurements moved there).
- Honest scope: the index is still O(recipes) in the shell (about 335 bytes per row). The ~75 KB saved is compact JSON plus moving fields to the bodies; it buys headroom, not a different growth curve. A real fix for growth needs a per-family index or an index of ids only (follow-up).
- Not done (follow-up): per-family split of syntax/composition files, per-pack lazy taxonomy, lazy intellisense/strudel.json (64 K, shared by params and editors, needed by literals on first editor use).
