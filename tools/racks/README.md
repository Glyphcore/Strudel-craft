# Rack audit (`tools/racks`)

Checks every rack against the rack standard (docs/RACK_STANDARD.md, issue #94).

| file | what |
|---|---|
| `audit.mjs` | renders a test phrase per class through each rack with the strudel CLI, measures, judges, writes `out/report.json` and `out/report.md` |
| `standard.json` | classes: target band, thresholds, test phrase; global limits |
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
