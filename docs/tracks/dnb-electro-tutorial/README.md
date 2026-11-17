# DnB, electro and house tutorial tracks (#124)

Three programs on pack `glyphcore/dnb-electro` (#122, #123) and the EDM foundations of `glyphcore/edm`. Every production technique is written
out as syntax: sidechain (`sidechain(orbit, depth, release)` on the kick, `ducked(orbit)` on what it ducks: superdough `duckorbit`), risers,
impacts, crashes and downlifters on gated binds, filter moves on section gates, the gap before each drop, chops on a gated slot, and bus processing
on `ret()` returns. Sources: docs/DNB_ELECTRO_REFERENCES.md. Conventions: docs/CONVENTIONS.md 9-11.
Every voice in the three programs is native (no `shape`, `distort` or `supersaw` AudioWorklet stage): the supersaw racks are played as a saw pair
after the hook (`.s("sawtooth").add(note("-0.08,0.08"))`) and impacts use `subDrop`, because worklet voices render 20-250x slower in the headless CLI
(measured, #140). Delete those two calls to hear the racks' supersaw on the site.

| file | what |
|---|---|
| `track.strudel.js` | **DnB tutorial, pack version (source of truth)**: `atoms.import` of `atoms-dnb` and `atoms-edm-core`, racks from both packs |
| `track.standalone.strudel.js` | generated (`node tools/packs/dnb_electro.mjs`): the used atoms and racks inlined, pastes into the site with no pack |
| `electro.strudel.js`, `electro.standalone.strudel.js` | electro example (8 bars per section), pack version + generated standalone |
| `house.strudel.js`, `house.standalone.strudel.js` | house / techno / trance / big room example (8 bars per section) |
| `render.sh OUT [track\|electro\|house] [standalone\|pack]` | chunked CLI render -> master (`--preset dnb\|electro\|house`) -> genre score |

## 1. DnB tutorial: F minor, 174 bpm, 128 bars = 2:56.6
Arrangement map (bars, 1-based; a gate `a..b` is half-open, `25b..57b` = bars 25-56):

| bars | section | lanes playing | moves on gates |
|---|---|---|---|
| 1-16 | intro | Rhodes comp, liquid pad (both low-passed at 700 Hz); strings from 9; the amen-style break from 9, high-passed at 700 Hz | `tone` = `[["lpf", 700]]` on `dnb.intro`; `btone` = `[["hpf", 700]]` before bar 17 |
| 17-24 | build 1 | + snare roll (`ec.roll8`, density doubling, velocity `ec.rollVel8`), noise riser over 8 bars | `tone` = `thinBuild` (high-pass 30 -> 800 Hz bar by bar); the gap 24.3b..25b mutes all but the riser |
| 25-56 | drop 1 (liquid) | two-step kick + snare, ghosts on 2.5 / 4.5 (pushed 3 %), shaker, sub (F1 Db2 Bb1 C2), Rhodes, pad; ride and rolling bass from 41; vocal chops from 33; strings from 41 | `subDrop` + `crash` on bar 25; the liquid groove `groove-swing(54) | groove-human(2.5, 0.15, seed)` on kick, snare and ghosts; the kick ducks orbit 2 (pad, keys, strings, chops, mid-bass) by 0.5 |
| 57-72 | breakdown | pad, strings, vocal chops; sub back from 65; the break returns at 69-72, low-passed at 1.8 kHz and chopped (`dnb.chops`) | `downSweep` on 57; `chop` slot = `.bite(16, dnb.chops)` |
| 73-80 | build 2 | the break in jungle chops (`dnb.chopsWild`), reese whose low-pass opens (`filterBuild`), riser, 16th / 32nd ghost roll in 77-80 (`ec.roll4`) | `thinBuild` on the harmony, gap 80.3b..81b |
| 81-112 | drop 2 (neuro) | two-step, rolling ghosts and 8th hats on the tight groove (`groove-human(0.5, 0.05, seed)`); 81-96 the neuro riff (FM growl) with the sub tracking its notes; 97-112 reese + sub + pad + Rhodes + strings; the chopped break layered from 89 (high-passed at 260 Hz); chops from 105 | impact + crash on 81, crash on 97; `chop` slot on 89-112 |
| 113-120 | halftime | kick on 1, snare on 3 (the 87 bpm feel), jump-up envelope wobble with a sub tracking it | `downSweep` on 113 |
| 121-128 | outro | two-step drums, ghosts and shaker, pad, Rhodes; sub out at 125 | crash on 121 |

### Lessons, one per section
1. **Intro: liquid harmony and a filtered break.** `dnb.chords` is Fm9 - Dbmaj9 - Bbm9 - Cm7, one chord per two bars (slow harmony over fast drums).
   The Rhodes is an FM sine (`fmh 1`, decaying index) high-passed at 120 Hz so it stays off the bass. The intro filter is one gated bind:
   `hooks.bind("tone", [["lpf", 700]], atoms.dnb.intro)`; the drop opens it by ending the gate, nothing is copied. The break enters at bar 9 high-passed
   (`btone`): a DJ-friendly intro keeps the low end free for the mix.
2. **Build: tension by thinning, density and a riser that ends on the point.** The low end thins bar by bar (`thinBuild`), the roll doubles (`ec.roll8`:
   quarters, 8ths, 16ths, 32nds), the riser is one note eight bars long (`s("x/8").use("rise")` with `noiseRiser(11)`: 8 bars at 174 bpm = 11.03 s), and the
   last half bar is a gap (`tagged("!rise").mute(atoms.dnb.vacuum)`).
3. **Drop 1: two-step, ghost notes, the low end in layers, gentle sidechain.** Kick on 1 and the and of 3, snare on 2 and 4; ghosts are a separate lane with
   their own rack (`ghostSnare`, shorter and darker) and a 16-step velocity atom, pushed 3 % of a 16th behind the beat (`groove-swing(54) | groove-human(2.5, 0.15, 3) | groove-push(3)`).
   The sub is a mono sine (`dnbSub`, 5 ms attack, low-pass 250 Hz) on orbit 3, which the kick does not duck; everything on orbit 2 is ducked by 0.5 with a
   0.12 s release. The rolling bass from bar 41 sits on the mid-bass bus.
4. **Breakdown: release, and a chop teaser.** Drums out, a downlifter, pad and chops with reverb; the break returns for four bars, low-passed and chopped:
   `hooks.bind("chop", [["bite", 16, { $mini: atoms.dnb.chops }]], "69b..73b, 89b..113b")` cuts every break lane into 16 slices and re-sequences them by
   the same order, so kick, snare and ride stay together.
5. **Build 2: jungle chops and a reese opening.** A second chop order (`dnb.chopsWild`: doubled slices, a reversed beat, a closing roll) on the build
   gate; the reese (a saw played as a pair 18 cents apart, `.add(note("0,0.18"))`, mono, 100 Hz high-pass at 24 dB/oct) opens with `filterBuild`.
6. **Drop 2: neuro and multiband by layers.** The neuro riff is `neuroBass`: an FM saw (ratio 1, index 4) high-passed at 110 Hz, a resonant snap
   and a vowel `a` formant: a modulated mid bass whose energy sits at 0.5-2 kHz; the grit is FM sidebands and resonance. Serial drive would be `glyphcore/edm` `drive(amt)` on top (superdough runs filters first, so
   a drive sees a band-limited signal); the headless render leaves it out because drive is an AudioWorklet stage (#140). A mono sine sub plays the
   same notes (`subN`); the mid layers (neuro, reese, rolling, wobble) share a glued bus: `ret("bassbus").compressor("-22:4:6:.005:.12")` fed by
   `tagged("mid").send("bassbus", 0.5)`. The split is by layers (sub / mid), so no crossover filter smears the sub.
7. **Halftime: same tempo, half the backbeat.** Kick on 1, snare on 3; the jump-up wobble keeps 3+3+2 notes running at full speed, each note re-opening
   its filter envelope (`jumpWobble`); the synced LFO alternative is `glyphcore/edm` `wobble(sync, depth)`.
8. **Outro: DJ-friendly.** Two-step drums and harmony, the sub out four bars before the end, so the next record can come in.

## 2. Electro example: 128 bpm, 40 bars = 75 s
| bars | section | what |
|---|---|---|
| 1-8 | intro (electro-funk) | 808-style kick (`boom808`, 0.7 s), clap, 16th hats with accents, two-bar cowbell (`[c#5,g#5]`), syncopated square bass; the robot lead from bar 5 (vowel per beat) |
| 9-16 | build | the funk kit thins (`thinBuild`), the house bass opens (`filterBuild`), the clap roll (`ec.roll8` on `clap808`), an 8-bar riser, the gap |
| 17-24 | drop (electro house) | four-on-the-floor `houseKick | sidechain(3, 0.8, 0.18)`, clap, offbeat hat, `filterBass | ducked(3)`, `sawStab | ducked(3)` on the offbeats; impact + crash |
| 25-32 | break | electro-funk again with robot stabs (vowel formant), downlifter, a 4-bar riser into 33 |
| 33-40 | drop 2 | the drop plus the robot stabs |

## 3. House / techno / trance / big room example: 128 bpm, 56 bars = 105 s
| bars | section | what |
|---|---|---|
| 1-8 | house | four-on-the-floor, offbeat open hat, clap and 16th hats on the house shuffle (`groove-swing(56) | groove-human(1, 0.1, seed)`), offbeat bass |
| 9-16 | techno | + rumble (mono sine in the kick's gaps) and rolling bass (every free 16th) on the drive groove (`groove-human(0.8, 0.08, seed)`), offbeat ride; crash on 9 |
| 17-24 | trance breakdown | no kick; supersaw chords low-passed at 900 Hz, pluck arp with a dotted-8th echo; downlifter |
| 25-32 | uplifting build | roll (`ec.roll8`), chords under `filterBuild`, gated pad from 29, 8-bar riser, gap |
| 33-40 | trance drop | kick ducks orbit 3 (bass, gated pad, arp, chords) by 0.5; `subDrop` + crash; 4-bar 16th / 32nd roll and a 2-bar riser into 41 |
| 41-48 | big-room drop | the kick slot swaps to `bigKick | sidechain(3, 0.65, 0.16)` (`hooks.slot("kick", { mode: "swap" })` and a gated bind); stripped to kick, clap, offbeat hat and the lead motif |
| 49-56 | house outro | the house groove again |
A club track uses 16 / 32-bar blocks: `atoms.hs.mapIntro` .. `mapOutro` (160 bars) and `hs.phrase8` give the gates.

## 4. Render, master, score (measured, 2026-11-16)
Genre files: the score here uses the **suno-track-lab** targets `docs/genres/{dnb,electro,house}.json` (the `engine/genre/score.py` format, #121).
This repo's `docs/genres/drum-and-bass.json`, `electro.json`, `house.json`, `techno.json`, `trance.json` are the separate **Strudel-craft** sound
standard (`genre-standard@1`, read by `tools/racks/measure.mjs`, #125); the two sets are not the same files and use different names for DnB.

Masters at `--ceiling -2.0` (render.sh `CEILING=-2.0`; at -1.0 the 112 kbit/s mp3s decoded at -0.0 to +0.6 dBTP), mp3 at 192 kbit/s
(`MP3_BITRATE=192k engine/audio/publish_audio.sh`). Master WAV numbers from `engine/genre/score.py`; decoded mp3 numbers from
`ffmpeg -af ebur128=peak=true` (its LRA algorithm differs from score.py's).

| program | length | master WAV: LUFS / dBTP / crest / LRA | centroid | low end < 150 Hz | onsets / bar | section span | genre score | decoded mp3: LUFS / dBTP / LRA |
|---|---|---|---|---|---|---|---|---|
| DnB tutorial (`--preset dnb`, suno-track-lab `docs/genres/dnb.json`) | 176.6 s | -8.4 / -2.02 / 7.6 dB / 1.7 LU (miss, min 3) | 2287 Hz | 0.54 | 6.4 | 2.8 dB (miss, min 3) | 7 / 9 | -8.7 / -1.80 / 1.6 |
| electro (`--preset electro`, suno-track-lab `docs/genres/electro.json`) | 75.0 s | -9.9 / -2.01 / 8.9 / 1.4 (miss, min 2) | 3232 | 0.69 (miss, max 0.65) | 12.0 | 2.4 | 7 / 9 | -10.1 / -1.49 / 1.4 |
| house / techno / trance (`--preset house`, suno-track-lab `docs/genres/house.json`) | 105.0 s | -9.5 / -2.01 / 8.3 / 1.9 (miss, min 2) | 3465 (miss, max 3200) | 0.68 | 12.1 | 4.9 | 7 / 9 | -9.8 / -1.59 / 1.9 |

Tempo 174 / 128 / 128 bpm passed with `--bpm`. Standalone and pack versions give identical `strudel events` (6087 / 2531 / 3445 events, same hash).
The LRA and DnB section-span misses come from the master limiter (the DnB mix measures 6.9 LU before it, and the -2.0 ceiling limits harder); targets marked (G) in the genre files are guesses. mp3s:
suno-track-lab `audio/dnb-electro-tutorial/` (dnb_tutorial_master, electro_master, house_master).

Centroid measures (they differ by design, so compare like with like): the genre score (`engine/genre/score.py`, the table above) is librosa's
spectral centroid, magnitude-weighted per 2048-point frame and averaged over frames; the catalog `centroid_hz` (tools/concepts/build.mjs) is
magnitude-weighted over 4096-point blocks; the rack audit (`tools/racks/audit.mjs`) and the neuroBass numbers in #122 are power-weighted over the
long-term spectrum. Power weighting leans to the loudest partials, so it reads lower on bass (neuro-bass: about 700 Hz power-weighted, 1118 Hz in the catalog).

```
docs/tracks/dnb-electro-tutorial/render.sh /tmp/dnb track standalone     # chunked CLI render, master --preset dnb, genre score vs docs/genres/dnb.json
docs/tracks/dnb-electro-tutorial/render.sh /tmp/el electro standalone
docs/tracks/dnb-electro-tutorial/render.sh /tmp/hs house standalone
```
