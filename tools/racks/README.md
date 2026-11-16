# Rack audit (`tools/racks`)

Checks every rack against the rack standard (docs/RACK_STANDARD.md, issue #94).

| file | what |
|---|---|
| `audit.mjs` | renders a test phrase per class through each rack with the strudel CLI, measures, judges, writes `out/report.json` and `out/report.md` |
| `standard.json` | classes: target band, thresholds, test phrase; global limits |
| `measure.mjs` | measures one WAV (loudness BS.1770, LRA Tech 3342, true peak, spectral, mono low end, onsets per bar, duck depth) and scores it against `docs/genres/*.json` (issue #125, RACK_STANDARD.md section 8) |
| `render_demo.cjs` | renders the night phonk demo to a float WAV through the site's offline recorder (Playwright; env `PLAYWRIGHT_MODULES`, `CHROMIUM_PATH`); example: `docs/genres/examples/night-phonk-demo.measure.json` |
| `targets.json` | the class of every audited item: racks (hook def name), catalog recipes (id), Syntax examples (`section/title`); unlisted catalog and Syntax items are class `demo` |

```
node tools/racks/audit.mjs                          # racks + catalog + Syntax examples; exit 1 on a failure, 2 when the CLI is missing
node tools/racks/audit.mjs --only racks             # the standing test (tests/smoke.sh)
node tools/racks/audit.mjs --item hazePad --keep    # one item, keep its WAVs under the temp dir it prints in report.json
node tools/racks/audit.mjs --baseline OLD/report.json   # report.md shows before -> after per metric
node tools/racks/audit.mjs --hooks A.json --hooks B.json --catalog C.json --syntax S.json   # other inputs (an old state, another pack)
```
Needs the strudel CLI (`STRUDEL_CLI`, default `/home/user/suno-track-lab/engine/strudel-cli`); the audit sets `STRUDEL_CRAFT` to this repo.
The full run renders about 150 programs (10 to 30 minutes); `--only racks` is 26 racks. `--jobs N` (default up to 4).

Adding a rack: start its chain with `["hook", "hygiene-<class>"]`, add `"name": { "class": "<class>" }` to `targets.json` `racks`, run
`--item name`. Adding a class: an entry in `standard.json` `classes` (band, limits, phrase) and a `hygiene-<class>` def in
`site/engine/hygiene.js` (`tests/hooks/p9_hook.mjs` checks that every class has one).
Result of the first pass: docs/RACK_STANDARD.md section 7.

Measure and score a render (no CLI needed, plain Node): `node tools/racks/measure.mjs [--bpm N] [--kick K.wav --bass B.wav] FILE.wav`,
add `--score docs/genres/dubstep.json [--strict]` for pass or miss per criterion (exit 1 on a miss; `convention` misses only with `--strict`).
Duck depth (`--kick` and `--bass` stems): kick onsets from the kick stem; bass envelope = analytic-signal (Hilbert) magnitude smoothed 5 ms; per kick interval the minimum from 10 ms before the onset to 150 ms after against the 90th percentile of the whole interval; median in dB over kicks (`duck_kicks_used`); null with `duck_unavailable` under 4 usable intervals. Held ducks read within 0.3 dB; an exponential release (tau 40 ms) starting at full depth reads 1 to 2 dB shallow (2.5 / 4.8 / 6.8 for true 3 / 6 / 9 dB), so `--score` prints duck as "unreliable, not scored". Same text as RACK_STANDARD.md section 8.
Test: `node tests/racks/measure.mjs` (synthetic conformance signals, genre files against `docs/genres/genre.schema.json`).

## Sample kit and browser checks (#106)
- `samples/kit/` is a pinned, synthesized CC0 drum kit (`samples/make_samples.py`, `samples/LICENSE.md`); the audit passes it as `--samples-dir`, so the catalog recipes that need a drum bank (`bd`, `hh`, `sd`, `.bank("RolandTR909")`) render offline instead of being skipped. `--samples-dir DIR` swaps it.
- Syntax examples that only the browser can evaluate (`strudelCraft.*`, `_pianoroll`, `_punchcard`, `lib:` refs) carry `skip: "noaudio: ..."` in `targets.json` with the reason.
- `PLAYWRIGHT_DIR=... node tools/racks/alias_chromium.mjs [--json OUT]` measures the aliasing of sine, triangle, sawtooth, square (raw oscillators) and supersaw (site render host) at C7 in headless Chromium with the audit's estimator; numbers in docs/RACK_STANDARD.md section 5.
