# Rack standard: clean, band-scoped racks

Owner: `daw-sme`. Issue #94. A **rack** is a hook def (`hooks.def`, docs/HOOKS_SYNTAX.md) or a preset chain that makes one instrument or
effect. This file says what "standard quality" means for one, how it is measured, and how the shared cleanup is written once.
Thresholds live in `tools/racks/standard.json`; the audit is `tools/racks/audit.mjs`; the class of every audited item is in
`tools/racks/targets.json`.

## 1. The problem this fixes
A raw oscillator or noise source fills the whole spectrum: a sawtooth at C4 still carries -20 dB of its energy above 9 kHz, white noise
through a high-pass has more than half of its energy above 12 kHz, and a short note that starts at zero phase has a one-sided area that
shows up as energy below 20 Hz. A rack that only sets an envelope and a level passes all of that into the mix, where it eats headroom,
masks other parts and drives every later non-linear stage. The fix is the first thing a mix engineer does on any channel: **scope the band
first**, then shape.

## 2. Signal order
Every rack follows this order. superdough builds one voice per note in a fixed order (source, gain envelope, `lpf`, `hpf`, `bpf`, `vowel`,
`coarse`, `crush`, `shape`, `distort`, `tremolo`, `compressor`, `pan`, `phaser`, `postgain`, then delay and reverb sends: read from
`superdough.mjs` 1.3.0), so the order of the chain steps is documentation; what matters is which controls are set.

| # | stage | controls | rule |
|---|---|---|---|
| 1 | source | `s`, `unison`, `detune`, `noise`, `fm` | the simplest source that gives the timbre; unison only where the class is wide |
| 2 | band scope | `hpf`, `lpf` (hygiene rack) | a high-pass under the class band (removes DC and sub rumble) and a low-pass over it; always present |
| 3 | tone and shape | `lpf` + `lpenv` / `lpattack` / `lpdecay`, `bpf`, `vowel`, ADSR, `penv`, `vib` | the rack's own filter narrows the scope; filter envelope amounts in octaves; vibrato after the attack |
| 4 | drive | `shape`, `distort`, `crush`, `coarse` | after the scope (superdough filters first), so the shaper sees band-limited input and aliases less; DC that an asymmetric input makes in a shaper cannot be removed per voice: the bus or master high-pass does it (engine/master presets use 25 Hz) |
| 5 | dynamics | `compressor`, ducking (`duckorbit`, `.wire("gain", "kick:env")`) | per voice only where it is the sound; glue belongs on a return |
| 6 | sends | `room`, `delay`, `.send(name, amount)` | reverb and delay returns carry their own scope (`ret("verb").hpf(200).lpf(5000)`) |
| 7 | gain staging | `gain` (pre-FX), `postgain` | one voice (or one chord) peaks at -6 dBFS or lower (kick, snare, impact: -3); the mix bus keeps headroom for the master |

Conventional recipes inside that order:
- **Pluck**: triangle or saw, `decay` 0.15-0.3, `sustain` 0-0.2, low-pass 2-3 kHz with `lpenv` 2-3 octaves and `lpdecay` near the amp decay; echo as a send.
- **Stab**: saw or square chord, `attack` 2-5 ms, `decay` 0.12-0.2, `sustain` 0, low-pass 1.2-2 kHz with `lpenv` 2-3.
- **Pad**: supersaw `unison` 3-5, `detune` 0.15-0.3, `attack` 0.5-2 s, `release` 2-3 s, low-pass 1-2 kHz, slow filter envelope; high-pass 180 Hz so the low end stays with the bass.
- **Lead**: saw (or saw + square), low-pass 1.5-3 kHz with `lpenv` 1, `attack` 10-15 ms, vibrato 5 Hz at 0.1 semitone.
- **Bass**: saw or square, low-pass 300-800 Hz, `attack` 5 ms (no click), mono (no `jux`, no `spread`).
- **808 / sub**: sine, pitch envelope for the knock, `shape` 0.3-0.5 for harmonics that small speakers can play, low-pass 400-800 Hz after the idea of the drive, `attack` 4 ms.
- **Keys**: triangle or FM sine, `attack` 5-50 ms, `release` 0.3-0.5.
- **Bell / cowbell**: square or FM, band-pass 1-2 kHz or `fmh` non-integer, `decay` 0.15-0.6, `sustain` 0.
- **Arp**: pluck settings at shorter decay; delay as a send.
- **Supersaw**: `unison` 5-7, `detune` 0.2-0.4, `spread` up to 0.8 above 180 Hz only.
- **Noise FX** (riser, sweep, impact, reverse hit, texture): white or pink noise, 24 dB/oct scope, the sweep is the low-pass envelope (`lpenv` in octaves, `lpattack` as long as the rise); the top of the sweep stays under the scope.
- **Kick**: sine with `penv` 24-36 semitones and `pdecay` 40-80 ms, `decay` 0.2-0.3, `shape` for weight. **Snare**: body (triangle 150-200 Hz) plus noise, high-pass 150-180 Hz. **Hat**: white noise, high-pass 7 kHz, `decay` 30-60 ms.
- **Vox texture**: sample, high-pass 150-300 Hz, low-pass 3.5-8 kHz, `vowel` for formant colour, slow attack for pads.

## 3. Hygiene racks (the cleanup, written once)
`site/engine/hygiene.js` holds one chain-only hook def per class: `hygiene-<class>`. They are standard-library defs of the hooks runtime:
resolvable on the site and in the CLI without a pack, replaced by a program's own `hooks.def("hygiene-pad", ...)`, never part of
`hooks.toJSON()`. Two ways to use one:

```js
$: note("c4 eb4 g4").s("sawtooth").hook("hygiene-pluck").decay(0.2).sustain(0)        // in place
hooks.def("glassPluck", { chain: [["hook", "hygiene-pluck"], ["s", "triangle"], ["lpf", 2400], ["lpenv", 3], ["decay", 0.22], ["sustain", 0], ["gain", 0.5]] })
```
`.hook(expr)` applies a hook expression in place, always on (no slot, no gate; a pipe works: `.hook("hygiene-pad | murk")`). Whatever the
rack sets after the hook wins, so the hygiene values are the widest band the class may occupy, not its tone. Catalog recipes stay plain
Strudel because they open on strudel.cc: they carry the same scope as literal `.hpf().lpf()`.

| hygiene rack | high-pass | low-pass | slope |
|---|---|---|---|
| `hygiene-kick` | 30 | 7000 | 12 dB/oct |
| `hygiene-sub` | 25 | - (the rack's own) | 12 |
| `hygiene-bass` | 40 | 3500 | 12 |
| `hygiene-snare` | 120 | 10000 | 24 |
| `hygiene-hat` | 5000 | 14500 | 24 |
| `hygiene-perc` | 80 | 8000 | 12 |
| `hygiene-bell` | 300 | 8000 | 12 |
| `hygiene-pluck` | 120 | 7000 | 12 |
| `hygiene-stab` | 120 | 8000 | 12 |
| `hygiene-pad` | 180 | 6000 | 12 |
| `hygiene-lead` | 150 | 8000 | 12 |
| `hygiene-keys` | 80 | 7000 | 12 |
| `hygiene-arp` | 150 | 8000 | 12 |
| `hygiene-supersaw` | 100 | 9000 | 12 |
| `hygiene-riser`, `hygiene-sweep` | 150 | 12500 | 24 |
| `hygiene-reverse` | 200 | 12000 | 24 |
| `hygiene-impact` | 25 | 5000 | 12 |
| `hygiene-texture` | 200 | 12500 | 24 |
| `hygiene-vox` | 150 | 8000 | 12 |

Design choices: tonal classes keep 12 dB/oct so a rack's own tone filter keeps its slope (`ftype` applies to every filter of the voice);
noise classes use 24 dB/oct because their filters are scope, not tone. Names have no dots (`hygiene-pad`): `name.param` is the address of
a hook param in `hooks.set`. Rejected: copying the filters into every rack; a new def key (`base`), which the model, schema and graph
would all have to learn; a slot with an `else` default.

## 4. Classes, target bands and thresholds
Energy ratios are in dB. **below / above**: energy outside the class band relative to the energy inside it. **sub20**: energy between
2 and 20 Hz relative to the total. **>18k**: energy above 18 kHz relative to the total. **DC**: absolute mean in dBFS. **side<120**:
side (L-R) energy below 120 Hz relative to the total (120 Hz is the mono-below point of the master presets). **alias**: on one steady
high note, power away from the harmonics (outside 2 % of each, at least 6 bins) relative to the power at the harmonics.

| class | band Hz | below | above | sub20 | >18k | peak dBFS | side<120 | alias (note, max) | test phrase |
|---|---|---|---|---|---|---|---|---|---|
| kick | 28-6000 | -30 | -30 | -40 | -45 | -3 | -50 | - | `s("x ~ x ~")` |
| sub | 25-400 | -26 | -24 | -30 | -45 | -6 | -50 | - | `note("eb1 f1 g1 bb0")` |
| bass | 30-2500 | -30 | -24 | -40 | -45 | -6 | -50 | c4 -40 | `note("c2 ~ c2 eb2 ~ g1 ~ c2")` |
| snare | 100-10000 | -24 | -24 | -40 | -45 | -3 | -30 | - | `s("~ x ~ x")` |
| hat | 3000-16000 | -30 | -15 | -40 | -15 | -6 | -30 | - | `s("x*8")` |
| perc | 80-9000 | -24 | -24 | -40 | -45 | -3 | -30 | - | `note("g2 d3 bb2 g2")` |
| bell | 300-9000 | -30 | -24 | -40 | -45 | -6 | -30 | c7 -40 | `note("g5 ~ bb5 g5 ~ d5 f5 ~")` |
| pluck | 120-9000 | -30 | -30 | -40 | -45 | -6 | -30 | c7 -40 | `note("c4 eb4 g4 bb4 c5 bb4 g4 eb4")` |
| stab | 100-10000 | -30 | -30 | -40 | -45 | -6 | -30 | c7 -40 | `note("[c4,eb4,g4] ~ [bb3,d4,f4] ~")` |
| pad | 100-8000 | -30 | -30 | -40 | -45 | -6 | -24 | c6 -34 | `note("<[c3,eb3,g3,bb3] [bb2,d3,f3,a3]>")` |
| lead | 150-10000 | -30 | -30 | -40 | -45 | -6 | -30 | c7 -40 | `note("g4 bb4 d5 a4 g4 f4 g4 bb4")` |
| keys | 80-8000 | -30 | -30 | -40 | -45 | -6 | -30 | c7 -40 | `note("[c3,g3,eb4] [f3,c4,ab4] [g3,d4,bb4] [c3,g3,eb4]")` |
| arp | 150-10000 | -30 | -30 | -40 | -45 | -6 | -30 | c7 -40 | `note("[c4 eb4 g4 c5 g4 eb4]*2")` |
| supersaw | 100-12000 | -30 | -30 | -40 | -45 | -6 | -24 | c6 -34 | `note("<[c3,g3,c4,eb4] [ab2,eb3,ab3,c4]>")` |
| riser | 150-14000 | -30 | -20 | -40 | -30 | -6 | -30 | - | `s("x/4")` |
| sweep | 150-14000 | -30 | -20 | -40 | -30 | -6 | -30 | - | `s("x/4")` |
| reverse | 200-14000 | -30 | -20 | -40 | -30 | -6 | -30 | - | `s("x")` |
| impact | 25-6000 | -30 | -30 | -30 | -45 | -3 | -50 | - | `s("x/2")` |
| texture | 200-14000 | -24 | -20 | -40 | -30 | -18 | -30 | - | `s("pink, brown")` |
| vox | 150-9000 | -30 | -30 | -40 | -45 | -6 | -30 | - | `s("<vs_o_pp vs_a_pp>").note("<g4 d4>")` |

Global limits (every class unless the table says otherwise): DC <= -60 dBFS, sub20 <= -40, >18k <= -45, no sample at or above 0.999,
peak between -36 and -3 dBFS, crest >= 3 dB, L/R correlation >= -0.1, side<120 <= -30.
Class `move` (FX-only racks such as `murk`, `grit`, `pumpHard`) is rendered over a band-scoped saw chord and gets the global checks with
DC <= -40 (a drive move cannot block DC per voice, see stage 4). Class `demo` (whole programs whose point is syntax or arrangement) gets
global safety checks only.

Why these numbers: the bands are where the instrument's fundamental range and useful harmonics sit (kick 28 Hz so a C1 sub-kick fits; pad
from 100 Hz with the high-pass at 180 so its fundamentals roll off gently; hat 3-16 kHz). -30 dB outside the band means the leak is under
a thousandth of the rack's energy; noise FX and hats get -15 to -20 above the band because their slope is finite and their top octave is
the sound. The sub and impact classes allow -30 dB under 20 Hz because a 29 Hz note that lasts half a second has envelope sidebands
there by physics; the 25 Hz high-pass is for the DC step, not for those.

## 5. What the engine does (measured, CLI = superdough 1.3.0 on node-web-audio-api)
| what | measured | consequence |
|---|---|---|
| raw `sawtooth`, C4-C5 phrase, no filter | above 9 kHz: -20.4 dB of in-band; above 18 kHz: -30.8 dB of total | every saw rack needs the scope low-pass |
| raw `square`, same phrase | above 9 kHz: -22.2 dB; above 18 kHz: -32.5 dB | same |
| white noise through `hpf(7000)` only | above 16 kHz: -3.6 dB of in-band; above 18 kHz: -7.4 dB of total | hats and noise FX need a low-pass, 24 dB/oct |
| short note starting at zero phase (e.g. `note("c2*8").s("sawtooth")`, triangle `decay(0.1)`) | 2-20 Hz: -23 to -37 dB of total | the one-sided area of each burst is infrasonic energy; the scope high-pass removes it, a 4-5 ms attack helps on bass |
| aliasing, steady C7 (2093 Hz), inharmonic vs harmonic power | `sine` -95.5 dB, `square` -59.1, `sawtooth` -54.8, `triangle` -47.0, `supersaw` (default unison) -43.1, one supersaw voice -58 | saw and square are band-limited well enough; the triangle of node-web-audio-api is the weakest (Chromium uses band-limited tables: not measured here, UNVERIFIED); limit -40 dB |
| `supersaw` with `unison 4`, `detune 0.22` at C6 | -36 to -45 dB across identical renders | the worklet draws its phases outside the CLI's seeded generator, so supersaw renders are not bit-identical; pad and supersaw limit -34 dB |
| `shape` on a filtered saw chord (`grit`) | DC -42 dBFS | an odd shaper on an asymmetric wave makes DC; superdough has no filter after the shaper, so the bus or master high-pass removes it |
| supersaw pad, chords from Bb2, default `spread` | side energy below 120 Hz: -22 dB of total with a 120 Hz high-pass, -27.7 dB with 180 Hz | pad scope high-pass is 180 Hz; superdough cannot narrow only the low band of one voice |
| `.noise(x)` on an oscillator voice | the render worker crashed on some racks (`tom`, `rimshot`, `impact`) | superdough 1.3.0 teardown order (docs/KNOWN_ISSUES.md, #92); guarded in the CLI's `lib/boot.mjs` as on the site |

## 6. Audit
```
node tools/racks/audit.mjs                       # racks + catalog recipes + Syntax examples -> tools/racks/out/report.json, report.md; exit 1 on a failure
node tools/racks/audit.mjs --only racks          # the standing test (tests/smoke.sh runs it)
node tools/racks/audit.mjs --item hazePad --keep # one item, keep the WAVs
node tools/racks/audit.mjs --baseline OLD/report.json   # before -> after columns in report.md
```
For a rack it writes a program (`setcpm(30)`, `hooks.bind("x", rack)`, the class phrase from standard.json through `.use("x")`), renders it
with the strudel CLI (`STRUDEL_CLI`, default `/home/user/suno-track-lab/engine/strudel-cli`), then measures: Welch long-term average
spectrum (32768-point Hann, 50 % overlap, 1.35 Hz bins) of the channel power, mid and side; peak, gated RMS and crest; clipping; DC;
L/R correlation. A second render of one dry high note gives the aliasing estimate. A classed rack must also start with
`["hook", "hygiene-<class>"]` (check `head`). Catalog recipes and Syntax examples are rendered as they are; items that need a sample
bank or a browser-only API are listed as skipped with the reason. A new class is a new entry in standard.json plus a `hygiene-<class>`
def; a new rack is one line in targets.json.

## 7. Result of the first pass (2026-11-15)
Same thresholds before and after (standard v1). Before = main at 6eb2f72; the `head` check (a rack starts with its hygiene hook) is not counted before, since it did not exist.

| group | before: pass / fail / skipped | after: pass / fail / skipped |
|---|---|---|
| rack | 15 / 10 / 1 | 25 / 0 / 1 |
| catalog | 12 / 28 / 6 | 40 / 0 / 6 |
| syntax | 16 / 15 / 36 | 41 / 0 / 36 |
| all | 43 / 53 / 43 | 106 / 0 / 43 |

Skipped = needs a sample bank or a browser-only API in the offline render (listed with the reason in report.md); `pump` needs a kick tap and is covered by the track render.

Items that failed before (value before -> after for the checks that failed; dB):

| item | class | failed before | before -> after | now |
|---|---|---|---|---|
| rack: kick808 | kick | sub20, ultra | sub20 -31.9 -> -46.9; ultra -41 -> -80.4 | pass |
| rack: snareNoise | snare | above, ultra | above -11.8 -> -28.5; ultra -18.2 -> -73.8 | pass |
| rack: hat | hat | below, above, ultra | below -28.2 -> -49.3; above -3.6 -> -21.2; ultra -7.4 -> -40.1 | pass |
| rack: sub808 | sub | below, sub20, dc, peak | below -23.2 -> -30.1; sub20 -24.8 -> -35.9; dc -52.3 -> -74.1; peak -5.9 -> -6.4 | pass |
| rack: hazePad | pad | lowmono | lowmono -21.4 -> -28.4 | pass |
| rack: riser | riser | above, ultra | above -12.8 -> -35.4; ultra -29.8 -> -66.7 | pass |
| rack: reverseHit | reverse | above, ultra | above -2.5 -> -21.7; ultra -7.4 -> -53.9 | pass |
| rack: impact | impact | below, above, sub20, ultra | below -24.2 -> -33; above -25.9 -> -37.8; sub20 -25 -> -37.7; ultra -33.9 -> -80.9 | pass |
| rack: tape | texture | above, ultra | above -6.8 -> -22.5; ultra -11.1 -> -55.7 | pass |
| rack: tom | perc | below, sub20, ultra | below -21.7 -> -28.4; sub20 -28.7 -> -56.9; ultra -36.5 -> -73.4 | pass |
| catalog: reese-style-detuned-bass | bass | below, sub20, peak | below -27.4 -> -38.4; sub20 -29.9 -> -49.5; peak -5.1 -> -6.1 | pass |
| catalog: sub-bass | sub | below, sub20, dc | below -11 -> -30.2; sub20 -15.8 -> -38.1; dc -48.7 -> -89 | pass |
| catalog: filter-sweep-build | demo | sub20 | sub20 -34 -> -51.3 | pass |
| catalog: riser | riser | above, ultra | above -1.9 -> -26.9; ultra -7.2 -> -59.2 | pass |
| catalog: chord-stabs | stab | below, sub20, peak | below -27.6 -> -35.5; sub20 -36.3 -> -74.8; peak -3.6 -> -6.1 | pass |
| catalog: fade-out | demo | sub20 | sub20 -37.7 -> -69.6 | pass |
| catalog: synth-kick | kick | below, sub20 | below -23.4 -> -39.9; sub20 -27.2 -> -44.7 | pass |
| catalog: synth-hat-offbeat | hat | below, above, ultra | below -28.2 -> -49.2; above -3.6 -> -21.2; ultra -7.4 -> -40.1 | pass |
| catalog: synth-euclid | kick | below, sub20 | below -18.7 -> -38; sub20 -21.4 -> -44.1 | pass |
| catalog: syncopated-bass | bass | below, sub20 | below -24.6 -> -32; sub20 -27.4 -> -43.3 | pass |
| catalog: supersaw-pad | supersaw | lowmono | lowmono -17.5 -> -24.8 | pass |
| catalog: minor-arp | arp | below | below -29 -> -33.8 | pass |
| catalog: chord-progression | keys | peak | peak -4 -> -6.3 | pass |
| catalog: root-bass | sub | sub20 | sub20 -27.3 -> -42.6 | pass |
| catalog: stereo-jux | demo | sub20 | sub20 -39.9 -> -71.4 | pass |
| catalog: dry-tight | demo | sub20 | sub20 -28.4 -> -64.6 | pass |
| catalog: tremolo-pad | demo | sub20 | sub20 -34.4 -> -52.6 | pass |
| catalog: fm-bell | bell | above | above -18.4 -> -27 | pass |
| catalog: lofi-crunch | demo | sub20 | sub20 -37.5 -> -46.9 | pass |
| catalog: perlin-drift | demo | sub20 | sub20 -26.3 -> -43.9 | pass |
| catalog: crescendo | demo | sub20 | sub20 -35.5 -> -67.4 | pass |
| catalog: accents | demo | sub20, dc | sub20 -23.2 -> -43.4; dc -55.8 -> -86.4 | pass |
| catalog: sidechain-synth | demo | sub20 | sub20 -29.5 -> -47.3 | pass |
| catalog: layers-in | demo | sub20 | sub20 -25.8 -> -43 | pass |
| catalog: filter-open-intro | demo | sub20 | sub20 -33.4 -> -51.6 | pass |
| catalog: random-thin | hat | below, above, ultra | below -27.5 -> -48.3; above -4.6 -> -21.9; ultra -8.3 -> -41.1 | pass |
| catalog: polymeter | demo | sub20 | sub20 -30.8 -> -57.4 | pass |
| catalog: dark-drone | bass | below, sub20 | below -22.4 -> -33.4; sub20 -28.1 -> -59.5 | pass |
| syntax: slots/A slot and a hook | demo | sub20 | sub20 -34.2 -> -52.4 | pass |
| syntax: slots/Before bar 3 (<3b) | demo | sub20 | sub20 -38.5 -> -70.3 | pass |
| syntax: slots/Range with fallback (2b..4b) | demo | sub20 | sub20 -34.3 -> -53.1 | pass |
| syntax: taps/Tap to param: ducking | demo | sub20, dc | sub20 -23.3 -> -40.8; dc -54.6 -> -78 | pass |
| syntax: taps/Variable with a key change | demo | sub20 | sub20 -31.3 -> -50.6 | pass |
| syntax: lanes/A bus as an audio-rate modulator: growl (.wire, depthabs) | demo | sub20, dc | sub20 -34.6 -> -65.9; dc -41.2 -> -95.9 | pass |
| syntax: controls/A cutoff knob | demo | sub20, dc | sub20 -26.1 -> -43.5; dc -58.7 -> -79.8 | pass |
| syntax: controls/Strudel slider() | demo | sub20 | sub20 -37.4 -> -68.9 | pass |
| syntax: controls/Inspect a control (long-press the knob) | demo | sub20, dc | sub20 -26.1 -> -43.8; dc -58.6 -> -81.3 | pass |
| syntax: word/Syllables | demo | sub20 | sub20 -36.3 -> -83.6 | pass |
| syntax: word/VocalSet vowels as a pad (CC BY 4.0) | demo | sub20 | sub20 -39.4 -> -78.2 | pass |
| syntax: word/Formant-preserving retune (variants need a --formant-steps bank; else plain retune + one warning) | demo | sub20 | sub20 -38.7 -> -85.6 | pass |
| syntax: banks/Sound bank keys | demo | sub20 | sub20 -39.7 -> -78.5 | pass |
| syntax: ghost/Try: type .lpf( then Tab | demo | sub20 | sub20 -34.1 -> -52.7 | pass |
| syntax: atoms/One name for a gate and a tap ref | demo | sub20, dc | sub20 -26 -> -44.9; dc -58.6 -> -86.2 | pass |

New items in the after run: racks/Scope a source first (.hook) (pass), racks/A rack names its class at the head of its chain (pass), racks/Stab: short chord, filter envelope, scoped (pass), racks/Pad: slow attack, unison, low end kept out (pass), racks/Lead: vibrato, filter envelope, scoped (pass), racks/808 / sub: soft attack, drive after the scope, mono (pass), racks/Drums: kick, snare, hat (pass), racks/Noise riser: the sweep stays inside the scope (pass), racks/Replace a hygiene rack for the whole program (pass), racks/The same scope in plain Strudel (opens on strudel.cc) (pass).


### Night phonk v2 with the scoped racks (CLI render, 84 bars, wavephonk master)
| measure | before (a66ee4e) | after | note |
|---|---|---|---|
| genre targets passed | 9 of 12 | 9 of 12 | same three misses (two onsets-per-bar keys, bpm) |
| master loudness | -12.0 LUFS | -12.0 LUFS | |
| master true peak | -1.06 dBTP | -1.09 dBTP | |
| spectral centroid | 2134 Hz | 1800 Hz | the top above about 14.5 kHz of hats and noise FX is gone; target 900-2200 Hz |
| loudness range | 8.7 LU | 8.0 LU | |
| crest | 11.9 dB | 11.7 dB | |
| low-end ratio (below 150 Hz) | 0.558 | 0.60 | at the top of the 0.35-0.6 target |
| drops minus reliefs (short-term, minimum) | 8.4 LU | 7.8 LU | reliefs are 0.7 LU louder, drops unchanged |
| mix before the master | -10.1 LUFS, +5.5 dBTP | -9.5 LUFS, +6.8 dBTP | the mix bus was already over full scale; the master limiter works about the same (5.9 vs 6.0 dB) |

Open point: superdough's high-pass has a default Q of 1 (a bump of about 1.2 dB just above the cutoff, measured); `hpq(0)` measures flat
(+0.2 dB). The bump is the likely reason for the louder reliefs and the higher low-end ratio. Setting `["hpq", 0]` in the hygiene racks and
re-rendering is the next step on #94; it was measured on noise but not yet applied.

## 8. Sound standard: measured per-genre and per-role acceptance (issue #125)
"Studio-worthy" is measured. `tools/racks/measure.mjs` (plain Node, no dependencies) measures one WAV; `docs/genres/<genre>.json` holds the
numbers; `measure.mjs --score docs/genres/<genre>.json FILE.wav` prints pass, miss or skip per criterion (value, range, basis) and exits 0 on all
pass, 1 on a miss. Test: `node tests/racks/measure.mjs` (synthetic signals with known answers; schema and basis checks of the genre files).

### Basis rule
Every number carries `basis`, `source` and `confidence`. `standard` (ITU / EBU) and `platform` (a streaming service's published rule) need a
source URL (a test fails on null). `convention` is practitioner convention, source null, `confidence: low`, provisional: it is reported as a
miss marked provisional but never fails a track unless `--strict` is given. `reference` is measured from audio the owner holds the rights to;
no reference audio is committed, only the measurements JSON (numbers) the tool writes. No published per-genre loudness, crest, spectral or
sidechain data was found (research 2026-11-16), so the per-genre ranges are all `convention` until references replace them.

### Method (basis: standard)
Integrated loudness and gating per ITU-R BS.1770 (K-weighting, 400 ms blocks at 75 % overlap, absolute gate -70 LUFS, relative gate -10 LU),
loudness range per EBU Tech 3342 (3 s blocks, relative gate -20 LU, 10th to 95th percentile), true peak by 4x oversampling. The tool is
checked against synthetic signals with hand-derived answers (1 kHz at -23 and -33 dBFS, a -36/-23/-36 gating sequence, an fs/4 sine at 45
degrees for true peak, identical and anti-phase channels), not against its own output.

### Delivery rule (basis: platform)
A finished track render is normalised to -14 LUFS integrated, tolerance 1 LU, true peak at or below -1.0 dBTP (Spotify for Artists, "Loudness
normalization", fetched 2026-11-16). Everything else uses gain-independent measures (PLR, LRA, shares, tilt, onsets), so a quiet render is not
mistaken for a dynamic one.

The same Spotify page adds: when the master is louder than -14 LUFS, keep true peak below -2 dBTP. Our delivery is normalised to -14, so the
rule above (-1.0 dBTP) stays; a render that is louder than -14 LUFS should meet -2 dBTP instead.

### Measured keys (measure.mjs output)
`lufs_integrated`, `lra_lu`, `true_peak_dbtp`, `sample_peak_dbfs`, `plr_db` (true peak minus LUFS), `crest_db` (sample peak minus RMS),
`dc_offset_dbfs`, `clipped_samples` (at or above 0.999), `low_share_pct` (20-250 Hz of 20 Hz to Nyquist power), `spectral_tilt_db_oct` (PSD slope
100 Hz to 10 kHz in 1/3-octave bands, pink = -3), `spectral_centroid_hz`, `lr_correlation_below_120` and `side_to_mid_db_below_120`
(4th-order low-pass at 120 Hz; -200 stands for minus infinity). With `--bpm N` (`--beats-per-bar`, default 4): `tempo_bpm` (declared, not
detected), `bars`, `onsets_per_bar` (spectral-flux peaks of the whole mix), `spectral_centroid_densest_8_bars_hz`. With `--kick` and `--bass`
stems: `duck_depth_db` with `duck_kicks_used`. Method: kick onsets from the kick stem (its 8 ms RMS crossing 20 % of its maximum); the bass envelope is the magnitude of the analytic signal (Hilbert transform via FFT) smoothed over 5 ms; per kick interval, ducked level = minimum of that envelope from 10 ms before the onset to 150 ms after (bounded by the interval), unducked level = its 90th percentile over the whole interval; depth = 20 log10(unducked / ducked), median over kicks. Intervals where the bass is silent are skipped; with fewer than 4 usable intervals the value is null and `duck_unavailable` gives the reason. Accuracy (synthetic, `tests/racks/measure.mjs`): a held duck (60 ms hold) reads within 0.3 dB at 3, 6 and 9 dB; no duck reads 0; a 1.3 Hz tremolo of +-1 dB unrelated to the kick reads 0.99 dB. Known limit: an exponential release (tau 40 ms) that starts at full depth reads about 2.5, 4.8 and 6.8 dB for true 3, 6 and 9 dB (the envelope of a 55 Hz tone cannot follow a drop faster than about a quarter period). So `--score` prints the duck criterion as "unreliable, not scored", never pass or miss.

### Genres (all `convention`, `confidence: low`, provisional)
Every file also carries the delivery rule (platform) and the mono low end (side-to-mid at or below -20 dB and correlation at or above 0.95
below 120 Hz), no clipped samples and DC at or below -60 dBFS (convention); spectral tilt -6 to -3 dB per octave for all.

| genre | file | BPM | PLR dB | LRA LU | low share % | duck dB | onsets/bar |
|---|---|---|---|---|---|---|---|
| dubstep | `docs/genres/dubstep.json` | 138-142 | 7-10 | 3-8 | 50-70 | 3-6 | 8-24 |
| drum and bass | `docs/genres/drum-and-bass.json` | 170-176 | 7-10 | 3-7 | 45-65 | 2-5 | 16-40 |
| house | `docs/genres/house.json` | 120-128 | 8-11 | 3-6 | 40-60 | 4-8 | 12-24 |
| tech house | `docs/genres/tech-house.json` | 124-128 | 8-11 | 3-6 | 40-60 | 3-6 | 12-28 |
| techno | `docs/genres/techno.json` | 125-140 | 8-11 | 2-6 | 40-60 | 2-6 | 12-32 |
| trance | `docs/genres/trance.json` | 132-142 | 8-11 | 4-9 | 35-55 | 6-10 | 16-32 |
| electro | `docs/genres/electro.json` | 125-135 | 8-11 | 3-7 | 40-60 | 3-6 | 12-28 |

Schema: `docs/genres/genre.schema.json`. Criteria whose input is missing (`--bpm`, stems) are skipped, not missed. Hip-hop, trap and hyphy
(#109 to #112) have no file yet: they get one in the same schema with their existing numbers moved in unchanged.

### Per role (soloed lane render, same tool)
Section 4 defines the classes, bands and thresholds (`audit.mjs`, per rack). The per-role criteria measurable on one soloed render with
`measure.mjs` are: band containment (the section 4 below/above/sub20/>18k columns), peak into the bus (section 4 `peak dBFS`), mono below 120
Hz for kick and sub (`lr_correlation_below_120` at or above 0.95, `side_to_mid_db_below_120` at or below -20; the audit's side<120 column is
the stricter gate), no clipped samples, DC at or below -60 dBFS. Master: the delivery rule above. Roles: kick, sub/bass, lead, pad, hats, vocal,
FX return, master. A per-role `--score` file is not built yet (coming); only the genre files score.

### Not done
No example measurement is committed yet: the night phonk demo needs the strudel CLI (suno-track-lab `engine/strudel-cli`), which was absent in
the sandbox that built this. Rejected: one loudness target per genre from blog tables, six-band target curves per genre, matching commercial
masters at -6 to -8 LUFS.

### Example measurement: night phonk demo (issue #125)
`node tools/racks/render_demo.cjs OUT.wav` renders the demo with the site's offline recorder (needs Playwright, Chromium, network; env
`PLAYWRIGHT_MODULES`, `CHROMIUM_PATH`), then `node tools/racks/measure.mjs --bpm 128.8 --score docs/genres/electro.json OUT.wav`. Numbers only:
`docs/genres/examples/night-phonk-demo.measure.json`. None of the seven genre files is phonk; electro (125-135 BPM, 808 drum machine) is the closest
fit and is used with that caveat. The take is post site master (-6 dB default gain). Duck depth was skipped here (no stems); see the duck method and its known limit above.
