# Night phonk demo (#89)

A 2:29 wavephonk / cloudphonk night phonk track written as Strudel-craft syntax. Key, tempo and harmony follow the owner's Call Me Baby
analysis (G minor, VI-i-VII-VI = Eb Gm F Eb, 128.8 bpm grid with a half-time feel: `setcpm(128.8 / 4)`, 1 bar = 1 cycle, snare on beat 3);
the lead comes from hook M1, the counter-melody from counterline M10, the 808 from bass ostinato M6. No sung lyrics.

| file | what |
|---|---|
| `track.standalone.strudel.js` | paste-ready program for the site's code field (no pack needed): atoms and racks inlined at the top. **Source of truth.** |
| `track.strudel.js` | the pack version, generated: the header is `atoms.import("pack:glyphcore/phonk:atoms")` and the racks come from `glyphcore/phonk:racks` |
| `render.sh OUT [standalone\|pack] [BARS]` | headless render with the strudel CLI (chunked, see below) |
| `cli-site-base.js` | CLI-only prelude: resolves the site's relative `data/vox/...` bank URLs against `$STRUDEL_CRAFT/site` |

Form (bars): intro 1-8 (pad, filtered lead, vocal pad, tape), build 9-16 (hats, snare, ghosts, hpf on pad/lead, riser from 13, roll 15-16,
reverse hit), drop 17-32 (kick, 808 with glide and ducking, cowbell, counter-melody, chops; impact on 17), breakdown 33-40, build 2 41-48,
drop 2 49-72 (lead rack swaps to `wideLead`, grit on kick/808/lead), outro 73-80 (low end out at 75, drums at 77).

## Structure (what to edit)
- **atoms** (`ph.*`): every chord, line, rhythm and gate string, declared once. A new section is a new gate atom plus one `tagged(...).mute(...)` or `hooks.bind(...)` line.
- **racks**: `hooks.def` chains (sound source, envelope, filter); a lane names its rack through a slot (`.use("kick")`) and one `hooks.bind` fills it,
  so swapping an instrument is one bind, and `hooks.slot("lead", { mode: "swap" })` lets a gated bind replace a rack for drop 2.
- **lanes**: one responsibility each (kick, snare, ghost, roll, hats, bell, sub, pad, lead, ctr, voxpad, chop, swell, rise, rev, hit, tex, crackle) and two returns (verb, glue).
- **mix**: `tagged("wet").send("verb", 0.35)`, `tagged("drums | low").send("glue", 0.6)` (parallel glue compressor), ducking by the `pump` module (`kick:env` onto gain).
- **macros**: `ctl` knobs macro, space, grit, energy mapped with `hooks.map` (op `mul`, so 1 / 0.5 = as written).

## Pack version and racks
`node tools/packs/phonk.mjs` regenerates `track.strudel.js`, the pack files in `site/data/phonk/` and the Syntax entry from the standalone file
(`--check` exits 1 when stale). Both versions give the same `strudel events --cycles 80` output. The site loads the pack's atoms and presets;
it has no adapter for the `hooks` kind yet (#91, coming), so only the standalone plays on the site; the CLI passes the racks
ingredient as hooks config (`--hooks site/data/phonk/racks.json`, done by `render.sh pack`).

## Render and checks
```
docs/tracks/night-phonk-demo/render.sh /tmp/np standalone 80     # -> /tmp/np/mix.wav, render.json (chunked: 8 bars + 2 bars pre-roll per chunk)
python3 engine/master/master.py /tmp/np/mix.wav /tmp/np/master.wav --preset wavephonk --report /tmp/np/master.json   (suno-track-lab)
python3 engine/genre/score.py /tmp/np/master.wav docs/genres/wavephonk.json --bpm 128.8 --form form.json --out score.json   (suno-track-lab)
node tests/site/track_demo.mjs [--live URL]                      # site at 360 px: Syntax entry loads the exact text, plays, peak and scope
```
The CLI renders a bus program in one offline context and the cost grows faster than its length (80 bars > 20 min), hence the chunked renderer
`engine/strudel-cli/chunk_render.py` (suno-track-lab) with 2 bars of pre-roll and 20 ms cross-fades.
