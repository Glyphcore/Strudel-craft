# Conventions: genre components, forms, dovetails, groove and feel templates

Owner: `daw-sme`. Issues #109 (groove), #110 (framework), #111 (hip-hop / trap / hyphy components, forms, dovetails), #112 (feel templates).
This file says how a musical concept becomes data in this repo, so that more concepts can be dropped in later without new code. It sits
beside docs/RACK_STANDARD.md (how a rack sounds clean), docs/ATOMS.md (typed strings), docs/HOOKS_SYNTAX.md (slots, gates) and
docs/PACK_SPEC.md (how content ships). Everything authored here is CC0-1.0 (pack `glyphcore/phonk`, LICENSE.md).

## 1. One source, many outputs
Each concept family is one JSON file, `tools/concepts/families/<family>.json`. `node tools/concepts/build.mjs` turns all of them into:

| output | what | consumer |
|---|---|---|
| `site/data/phonk/racks-hiphop.json` | hooks@1 chain-only defs (instrument racks, dovetail moves) | site (pack hooks adapter, #91), CLI `--hooks`, rack audit |
| `site/data/phonk/atoms-<id>.json` | atoms@1 (`hh.` patterns and form gates, `dt.` dovetail atoms) | `atoms.import("pack:glyphcore/phonk:atoms-hiphop")` |
| `site/data/phonk/feel-<id>.json` | atoms@1, one per feel template (section 5) | `atoms.import("pack:glyphcore/phonk:feel-trap", { as: "feel" })` |
| `site/data/catalog.json` recipes with `origin: "concepts"` | `code` = the Craft form (atoms + `.hook("rack \| groove")`), `lowered` = plain Strudel generated from the same racks, atoms and grooves (opens on strudel.cc), `lowered_check` = event equality (docs/LOWERING.md) | Rack inspector (both forms as tabs) |
| `site/data/syntax.json` section `feels` | hooks / atoms / pack programs | Syntax view |
| `tools/racks/targets.json` | the class of every new rack, recipe and Syntax example | `node tools/racks/audit.mjs` |
| `site/data/phonk/craftpack.json` | the ingredient list (hashes by `packs.py hash --write`) | packs loader, lock |

DRY rules: a rack chain is written once (its catalog recipe is lowered from it); a pattern is an atom and recipes cite it as `@name`
(own family) or `@ns:name` (another family); a fade table is one atom that the fade racks cite with `{ "$atomBody": "xfadeOut" }`; groove
presets live once in `site/engine/groove.js` and the catalog gets their plain-Strudel lowering (`lowered`; the Craft form stays in `code`). `--check` exits 1 when any output is stale.

## 2. Components (hip-hop, trap, hyphy)
C minor throughout so components combine; one cycle is one bar of 4/4 on a 16-step grid. New racks (class in brackets, all start with
their hygiene rack): `bbKick` (kick), `clap` (snare), `snap` (perc), `openHat` (hat), `bbBass` (bass), `rhodes` (keys), `trapBell` (bell),
`airPad` (pad), `hyphyLead` (lead), `chopStab` (stab), `voxTag` (vox), `vinyl` (texture), `downlifter` (sweep), `knock808` (kick: the phonk
`kick808` with a 40 Hz scope, because at trap tempos its pitch-envelope bursts leak under 20 Hz). Reused from the phonk kit: `sub808`, `hat(len)`,
`snareNoise`, `riser`, `impact`. Mix level: the 808 sits at velocity 0.6 under a kick in the trap and cloud feels (a held 808 plus a kick clipped at 1.0).

| component | atoms (`hh.`) | rack | note |
|---|---|---|---|
| drums | `boomKick`, `boomSnare`, `trapKick`, `trapClap`, `hyphyKick`, `hyphyClap`, `stompKick`, `stompClap` | `bbKick`, `knock808`, `clap` | boom-bap kick on 1, the a of 2, the and of 3; trap is half-time (clap on 3); hyphy bounce 3+3+4+3+3 |
| 808 / sub | `trap808` | `sub808` | follows the kick; each note held to the next (`c2@10 c2@6`, an 808 rings), root C2: short notes on C1 put envelope sidebands under 20 Hz (audit sub20) |
| hats and rolls | `boomHats`, `trapHats`, `rollVel` | `hat(0.03)`, `openHat` | rolls as subdivisions inside one step (`[x x x]`, `[x x x x]`, `[x x x x x x]`), accents as a velocity atom |
| claps / snaps | `hyphySnap` | `clap`, `snap` | single band-passed bursts (no `.noise`, see RACK_STANDARD 5) |
| bass | `boomBass` | `bbBass` | mono triangle, 5 ms attack |
| keys | `boomChords` | `rhodes` | FM ratio 1, decaying index |
| pads | `cloudChords`, `trapChords` | `airPad` | 180 Hz scope, low end left to the bass |
| chops | `chops` | `chopStab` | a chopped chord rhythm without samples; sample chops use the vox racks (`chop`) and `voxBank` |
| FX | `fx` | `riser`, `impact`, `downlifter`, `vinyl` | |
| vox tags | `tag` | `voxTag` | a vowel-filtered saw; real tags use `word()` / vox banks (licences in the pack manifest) |

## 3. Forms (gate atoms)
One 68-bar song form: intro 4, verse 16, hook 8, verse 16, hook 8, bridge 4, hook 8, outro 4. Gates (`hh.`): `intro` `<5b`, `drop`
`@5b` (the beat drops in), `verse`, `hook`, `bridge`, `outro`, `dropBar` (drums out for the bar before each hook), `lastBeat` (the last
beat before each hook, `20.4b..21b`), `switch` `@29b` (beat switch), `bounce` and `stomp` (hyphy hook halves). A track mutes lanes by
gate (`tagged("drums").mute(atoms.hh.dropBar)`) or binds racks by gate (`hooks.bind("kick", "kick808", atoms.hh.switch)`); it never
copies patterns per section. Switch-up = same kit, new pattern (`<a!4 b!4>`); beat switch = new kit and feel at a point, same song.

## 4. Groove (`pat.groove`)
`pat.groove(swing, push, jitter, vel, drift, seed, grid)` or `pat.groove({ ... })`; built into the hooks runtime (site and CLI),
`site/engine/groove.js`. A step is 1/grid of a cycle; push, jitter and drift are tempo-free (percent of a 16th = 1/16 cycle), so a feel
keeps its character when the tempo changes.

| param | range | default | meaning |
|---|---|---|---|
| `swing` | 50-75 % | 50 | MPC swing: where the 2nd step of each pair sits (50 straight, 66.7 triplet, 75 dotted). A monotone piecewise-linear time map inside each pair, so order is kept and durations close up |
| `push` | -50..50 % of a 16th | 0 | constant offset per voice: + drags (late), - rushes (early). At 90 bpm 10 % = 16.7 ms |
| `jitter` | 0-25 % | 0 | per-hit timing spread, triangular (sum of two uniforms), never beyond +-jitter. 3-4 % at 90 bpm is about 2-3 ms SD, the order of a good drummer |
| `vel` | 0-0.5 | 0 | velocity x (1 - vel * u), u in [0, 1): only ever down, so a voice never peaks above its gain staging |
| `drift` | 0-20 % | 0 | slow timing wander, smooth value noise over 4 cycles |
| `seed` | 0-65535 | 0 | the random stream; give each voice its own |
| `grid` | 2-64 | 16 | swing grid (16 swings 16ths, 8 swings 8ths) |

Determinism: every offset is a hash of (seed, the hap's exact onset fraction); offsets are rounded to 1/15360 cycle, so hap times stay
exact. The method queries a span widened by the largest shift and crops, so a chunked offline render, a live query and a re-render give
the same haps (tests/hooks/p10_groove.mjs: chunks of 0.37 cycles equal one query; two CLI renders are bit-identical).
Presets (standard-library hook defs, a program or pack def of the same name wins): `groove-straight`, `groove-pocket` (swing 57,
jitter 3, vel 0.12, drift 1), `groove-lazy` (swing 55, push 8, jitter 4, vel 0.1, drift 3), `groove-bounce` (swing 53, push -3, jitter 2,
vel 0.15), `groove-rolling` (jitter 1.5, vel 0.18), `groove-cloud` (swing 56, push 5, jitter 5, vel 0.08, drift 5), all with `seed` as the one
param; `groove-swing(pct, grid)`, `groove-push(pct)`, `groove-human(jitter, vel, seed)`. Compose with a pipe:
`"clap | groove-pocket(2) | groove-push(4)"`. Do not stack two swings (they compose).
Plain-Strudel lowering (catalog): swing -> `.swingBy(2*swing/100 - 1, grid/2)`; vel -> `.mul(velocity(rand.late(seed+0.37).range(1-vel, 1)))`;
jitter -> `.late(rand.late(seed).range(0, 2J).segment(16))`; drift -> `.late(perlin.range(0, 2D).slow(4).segment(16))`; then one
`.late` / `.early` for push minus the centring. Strudel's `rand` is a function of time, so this is deterministic too; it is not
query-independent for notes that are off the 16-step grid.
Rejected: `nudge` (superdough applies it to samples only); a new `$rand` chain-argument kind (needs model, schema and graph support for
one use); swing via `swingBy` only (no per-voice push, no humanize, not monotone for long notes).

## 5. Feel templates
A feel template fills named slots. Template v1 (data: `tools/concepts/families/feels.json` `template`):

| template slot | voices | per voice atoms |
|---|---|---|
| drums | `kick`, `snare`, `perc` | `<v>` (mini pattern), `<v>Vel` (mini accents), `<v>Rack` (hook: `rack | groove(seed) [| groove-push(p)]`) |
| top | `hats`, `top` | same |
| bass | `bass` | same |
| harmony | `harmony` | same |
| fx | `fx` | same |
| groove | - | `groove` (hook: the feel's preset for any extra voice, `.hook(atoms.feel.groove)`) |

Feels shipped: `feel-boombap` (pocket), `feel-lazy` (lazy drag), `feel-trap` (rolling trap), `feel-hyphy` (bouncy hyphy), `feel-cloud`
(cloud / wave). Every feel ingredient has the same 25 atom names, so:
- **Pick a feel** = one line, `atoms.import("pack:glyphcore/phonk:feel-trap", { as: "feel" })`; the rest of the program (binds
  `hooks.bind("kick", atoms.feel.kickRack)`, lanes `kick: s(atoms.feel.kick).velocity(atoms.feel.kickVel).use("kick", { mode: "swap" })`)
  is the same for every feel (Syntax view, "Pick a feel").
- **Override a slot** = one later bind; the slots are in `swap` mode, so the latest bind wins (`hooks.bind("hats", "openHat | groove-lazy(3)")`).
- **Two feels** (beat switch) = two imports under two names (`{ as: "a" }`, `{ as: "b" }`), lane tags and gates.
Why this fits the existing specs: a feel is an atoms@1 ingredient (typed, hashed, pack-shipped), the slots are ordinary hooks slots and
the fillers are hook expressions of existing racks and groove presets. Rejected: a new `feel` pack kind or atom type (a parallel
mechanism); slot `else` defaults in a hooks ingredient (pack hooks install first-definition-wins, so two feels would collide); one hook def
per feel and slot (no per-voice patterns, and switching a feel would touch every bind line).
Atom ids are derived from `feel-<id>/<name>`, so two feels can be imported side by side.

## 6. Dovetails (how sections interlock)
| technique | data | hooks / lanes form | plain Strudel (catalog) |
|---|---|---|---|
| pickup into the next section | `dt.pickup({ at })` `${at}-0.25b..${at}`, `dt.pickupBar` | `hooks.bind("fill", "clap", atoms.dt.pickup({ at: "5b" }))` on `.use("fill", { else: "silence", quant: 0 })` | `dovetail-pickup-fill`, `dovetail-808-pickup` |
| overlapping tail | `tailHold` move, `dt.tail({ at, len })` | the split rule: a note that starts before a gate boundary rings through it | `dovetail-overlapping-tail` |
| call and response | `dt.callMask` `1 0`, `dt.answerMask` `0 1`, `dt.callBar`, `dt.answerBar` | `.mask(atoms.dt.callMask)` | `dovetail-call-response` |
| crossfade | `dt.xfadeOut` / `dt.xfadeIn` (8-step equal power, cos / sin), moves `fadeOut` / `fadeIn` | `hooks.bind("pad", "fadeOut", "4b..5b")` | `dovetail-crossfade` |
| ducked transition | move `duckUnder(depth)` (wires gain to `hit:env`) | `.tap("hit", { export: true })` on the impact lane | `dovetail-ducked-transition` (duckorbit) |
| riser / impact placement | `dt.rise({ at, len })` ends exactly on the point, `dt.hit({ at })` starts on it | `hooks.bind("rise", "riser", atoms.dt.rise({ at: "5b", len: 2 }))` | `dovetail-riser-impact` |
| delay throw | move `throw(fb)` | bound on `dt.pickup` | `dovetail-delay-throw` |
| turnaround | `dt.turnaround({ a, b })` `<[a]!3 [b]>` | | `dovetail-turnaround` |

Sub-bar gates (pickups, last beats) need `quant: 0` on the slot (`.use(name, { quant: 0 })`); bind gates are rounded up to whole cycles
by default (HOOKS_SYNTAX 4.3). Lane selections (`tagged(...).mute(gate)`) are always exact.

## 7. Add a concept (checklist)
1. Pick or create a family file in `tools/concepts/families/` (`family`, `title`, `doc`; `racksIngredient`, `atomsIngredient { id, ns, title, doc }` when it ships atoms).
2. Racks: add to `racks` with `class` (a class of `tools/racks/standard.json`; a new class needs an entry there and a `hygiene-<class>` def in
   `site/engine/hygiene.js`), `doc`, `chain` starting with `["hook", "hygiene-<class>"]` (moves: class `move`, no head), and `target` only
   to override the audit phrase or skip with a reason.
3. Atoms: add to `atoms` (`type` from `site/data/atoms/types.json`, `body`, `doc`, `params` for gates with a point).
4. Recipes: add to `recipes` (`id`, `title`, `intent`, `labels` from the catalog or a new label in build.mjs `NEWLABELS`, `class`, `cpm`,
   `bars`, `voices[]` of `{ src, pat, rack, args, vel, groove, move, more }`, patterns as `@atom` / `@ns:atom`). The builder writes both forms:
   `code` (Craft: `atoms.ns.name` for a whole-string ref, one `.hook("rack \| groove \| move")`) and `lowered` (plain Strudel); never write either by hand.
5. Syntax examples: add to `syntax` (`title`, `code`, `bars`); site syntax, packs and hooks allowed.
6. A feel: add to `feels` in feels.json (`title`, `tempo`, `cpm`, `groove` preset, `doc`, `labels`, `voices` for every template voice).
   A new template voice is one entry in `template.voices` / `template.src`, and every feel must then fill it (silence is `{ "pat": "~" }`).
7. Folder and tags are derived, not written: `tools/concepts/taxonomy.mjs` gives every recipe, atom and rack a folder (family, genre, role: `hiphop/trap/drums`, `dovetail/pickup`, `feels/trap/bass`) and tags (role, genre, feel, tempo-feel, mood, technique, status). A new concept needs only its family, labels and role word; to add a role, genre or technique word extend the lists at the top of that file and rerun. The hand-written phonk files and the pack `taxonomy` are filled by `node tools/packs/taxonomy_fill.mjs` (run it after the build, then hash). docs/PACKAGES.md section 4.
8. Run `node tools/concepts/build.mjs --render` (every recipe must come back `verified`), `python3 tools/packs/packs.py hash site/data/phonk --write`,
   `python3 tools/packs/shim.py`, `node tools/lowering/build.mjs` (verifies Craft = Strudel events, annotates the Syntax examples; docs/LOWERING.md),
   `node tools/packs/taxonomy_fill.mjs` (then hash and shim again), `python3 tools/packs/shim.py`, `node tools/pwa/precache.mjs`, then `node tools/racks/audit.mjs` (0 failures),
   `node tools/concepts/build.mjs --check` and `node tools/packs/taxonomy_fill.mjs --check` (exit 0), and `python3 tools/packs/audit.py --write-doc` (docs/PACKAGES.md numbers).
9. Docs follow code: this file (tables above), docs/LOWERING.md, docs/PACKAGES.md, site/README.md, docs/CONCEPT_DAG.md, the #56 tracker.
