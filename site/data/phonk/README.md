# glyphcore/phonk: night phonk kit

Content pack (docs/PACK_SPEC.md) behind the Syntax entry **Track demo: night phonk**. Licence CC0-1.0 for everything authored here
(LICENSE.md); it ships no audio, and the credits for the vox banks the track preset plays are in LICENSE.md and the manifest.

| ingredient | kind / format | holds | host |
|---|---|---|---|
| `atoms` | `atoms` / `atoms@1` | 22 atoms under `ph.`: `chords` (Eb Gm F Eb, VI-i-VII-VI in G minor), `sub` (808 line) and `glide` (penv per note), `lead`, `counter`, `bell`, `kick`, `snare`, `ghost`, `hats`, `accent`, `roll`, `every4`, `lastBar`; gates `noDrums`, `noLow`, `noDrop`, `noRoll`, `noRise`, `dark`, `builds`, `drop2` | site and CLI: `atoms.import("pack:glyphcore/phonk:atoms")` |
| `racks` | `hooks` / `hooks@1` | instrument rigs as chain-only hook defs: `kick808`, `snareNoise`, `hat(len)`, `cowbell`, `sub808`, `hazePad(cut)`, `deepLead`, `wideLead`, `echoPluck`, `formant`, `chop`, `riser`, `reverseHit`, `impact`, `tape`; moves `murk` (dark filter walk), `thin(hz)`, `grit(amt)`, `pump(depth)` | CLI: `--hooks site/data/phonk/racks.json`; the site has no adapter for the `hooks` kind yet (coming, skipped with `W_PACK_KIND`) |
| `presets` | `recipes` / `recipes@1` | `night-phonk-demo`: the standalone track | site Rack browser (pack recipes) |

## Use
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
