# glyphcore/phonk: night phonk kit

Content pack (docs/PACK_SPEC.md) behind the Syntax entry **Track demo: night phonk**. Licence CC0-1.0 for everything authored here
(LICENSE.md); it ships no audio, and the credits for the vox banks the track preset plays are in LICENSE.md and the manifest.

| ingredient | kind / format | holds | host |
|---|---|---|---|
| `atoms` | `atoms` / `atoms@1` | 22 atoms under `ph.`: `chords` (Eb Gm F Eb, VI-i-VII-VI in G minor), `sub` (808 line) and `glide` (penv per note), `lead`, `counter`, `bell`, `kick`, `snare`, `ghost`, `hats`, `accent`, `roll`, `every4`, `lastBar`; gates `noDrums`, `noLow`, `noDrop`, `noRoll`, `noRise`, `dark`, `builds`, `drop2` | site and CLI: `atoms.import("pack:glyphcore/phonk:atoms")` |
| `racks` | `hooks` / `hooks@1` | instrument rigs as chain-only hook defs: `kick808`, `snareNoise`, `hat(len)`, `cowbell`, `sub808`, `hazePad(cut)`, `deepLead`, `wideLead`, `echoPluck`, `formant`, `chop`, `riser`, `reverseHit`, `impact`, `tape`; moves `murk` (dark filter walk), `thin(hz)`, `grit(amt)`, `pump(depth)` | site: installed on every evaluation of a program that names `glyphcore/phonk` (#91); CLI: `--hooks site/data/phonk/racks.json` |
| `atoms-v2` | `atoms` / `atoms@1` | v2 (#93) under `ph2.`: `slides`, `toms`, `rim`, `stab`, `stut`, `rise`, `heart`; section gates `noDrums`, `noKick`, `noSub`, `noConf`, `noRelief`, `dropB`, `vac`, `noRoll`, `noRise`, `noRev`, `noHit`, `drops`, `conf`, `reliefs`, `relief2`, `dark`, `slams`, `builds` | site and CLI: `atoms.import("pack:glyphcore/phonk:atoms-v2")` |
| `racks-v2` | `hooks` / `hooks@1` | v2: `pumpHard(depth)` (duckorbit pump on orbits 3-8 from the kick), `tom`, `rimshot`, `slam`, `open`, `swellPad`, `hush` | site: with `racks` (#91); CLI with `racks` (render.sh merges both) |
| `presets` | `recipes` / `recipes@1` | `night-phonk-demo` and `night-phonk-demo-v2`: the standalone tracks | site Rack browser (pack recipes) |
| `racks-hiphop` | `hooks` / `hooks@1` | hip-hop, trap and hyphy racks (#111): `bbKick`, `knock808`, `clap`, `snap`, `openHat`, `bbBass`, `rhodes`, `trapBell`, `airPad`, `hyphyLead`, `chopStab`, `voxTag`, `vinyl`, `downlifter`; dovetail moves `fadeOut`, `fadeIn`, `throw(fb)`, `tailHold`, `duckUnder(depth)` | site with the other racks (#91); CLI `--hooks` |
| `atoms-hiphop` | `atoms` / `atoms@1` | `hh.`: boom-bap, trap (rolls, accents, 808) and hyphy (bounce, stomp) patterns, chords, chops, tag, fx; form gates `intro`, `drop`, `verse`, `hook`, `bridge`, `outro`, `dropBar`, `lastBeat`, `switch`, `bounce`, `stomp` | `atoms.import("pack:glyphcore/phonk:atoms-hiphop")` |
| `atoms-dovetail` | `atoms` / `atoms@1` | `dt.`: `pickup({ at })`, `pickupBar`, `rise({ at, len })`, `hit`, `tail`, call / answer masks, `xfadeOut` / `xfadeIn`, `turnaround({ a, b })` | `atoms.import("pack:glyphcore/phonk:atoms-dovetail")` |
| `feel-boombap`, `feel-lazy`, `feel-trap`, `feel-hyphy`, `feel-cloud` | `atoms` / `atoms@1` | feel templates (#112): the same 25 names each (`<v>`, `<v>Vel`, `<v>Rack` for kick, snare, perc, hats, top, bass, harmony, fx; `groove`) | `atoms.import("pack:glyphcore/phonk:feel-trap", { as: "feel" })` |

The hip-hop, dovetail and feel ingredients are generated: edit `tools/concepts/families/*.json`, then `node tools/concepts/build.mjs --render` (docs/CONVENTIONS.md section 7).

## Rack standard (#94)
Every instrument rack starts with the band scope of its class, `["hook", "hygiene-<class>"]` (built-in hook defs, `site/engine/hygiene.js`): `kick808` kick, `snareNoise` snare,
`hat` hat, `cowbell` bell, `sub808` sub, `hazePad` pad, `deepLead` / `wideLead` lead, `echoPluck` pluck, `formant` / `chop` vox, `riser` riser, `reverseHit` reverse, `impact` impact,
`tape` texture, `tom` / `rimshot` perc. Moves (`murk`, `thin`, `grit`, `pump`, `pumpHard`, `slam`, `open`, `swellPad`, `hush`) have no scope of their own. With the scope came two level
and shape changes: `sub808` has a 4 ms attack and `postgain` 0.87 (one voice peaks under -6 dBFS; the drive is unchanged), and the track sets `.postgain(1)` on its sub lane to keep the 808 at its old level in the mix, `riser` sweeps 3.5 octaves (was 4; the top stays under the scope).
Check: `node tools/racks/audit.mjs --only racks` (docs/RACK_STANDARD.md). A new rack: name its class at the head of the chain and add it to `tools/racks/targets.json`.

```js
atoms.import("pack:glyphcore/phonk:atoms")
hooks.bind("kick", "kick808"); hooks.bind("sub", "sub808")          // a rack goes into a slot; swapping it is one bind
kick: s(atoms.ph.kick).use("kick").tap("kick", { export: true }).tags("drums")
sub: note(atoms.ph.sub).penv(atoms.ph.glide).use("sub").tags("low")
tagged("drums").mute(atoms.ph.noDrums)                              // the form is gates, never copied patterns
```

## Build
The source of truth is `docs/tracks/night-phonk-demo/track.standalone.strudel.js` (its header inlines the atoms and racks). After an
edit there: `node tools/packs/phonk.mjs` (writes atoms.json, racks.json, presets.json, the pack version of the track and the Syntax
entry; `--check` exits 1 when stale), then `python3 tools/packs/packs.py hash site/data/phonk --write` and `python3 tools/packs/shim.py`
(pins this manifest and the Syntax data in site/packs.lock.json). Extending the track (a new section or instrument) is a new atom, rack
or lane plus a gate: existing lines stay as they are.
