# Form profiles per genre and how to make a similar form

Issue #154. Data: docs/dawstudy/profiles/*.json (from `python3 tools/dawstudy/dawstudy.py forms`), sources and gaps docs/DAW_STUDY_SOURCES.md,
rules docs/RESEARCH_ETHICS.md. **No genre below has n >= 3 licensed projects**, so every measured number is an indicative example, not a
norm; the mixed electronic pool (n = 5) is the only n >= 3 profile and mixes genres. Section labels are inferred from density (DAW_STUDY 3):
`breakdown` here often means a short thinned block (a 4-bar build-in or a gap), not a composed breakdown.

## 1. Measured profiles (LMMS demo projects, statistics only)

| profile | n | tempo | length bars (median) | intro bars / layers | body or peak bars / layers | thinned sections (count, bars, layers) | most common clip lengths | automation (top) |
|---|---|---|---|---|---|---|---|---|
| electronic-mixed | 5 | 128.0-170.0 | 128 | 4 / 2.0 | peak 38.0 / 9.5; body 35 / 8.0 | 11, 4, 3.0 | 1.0: 395, 2.0: 342, 4.0: 141 | cutoff/lfo 24, wet/lfo 19, cutoff/rise 12 |
| trance | 2 | 140.0-144.0 | 133.5 | 6.0 / 2.25 | body 44 / 8.0 | 5, 4, 2.0 | 2.0: 298, 1.0: 261, 4.0: 112 | cutoff/rise 8, cutoff/fall 7, cutoff/curve 5 |
| dnb | 1 | 170.0-170.0 | 105 | 4 / 2.0 | peak 38.0 / 9.5; body 8 / 8.0 | 4, 4.0, 3.5 | 8.0: 44, 4.0: 14, 9.0: 14 | cutoff/rise 2 |
| hiphop | 1 | 140.0-140.0 | 145 | 16 / 2.0 | body 128 / 6.0 | - | 1.0: 42, 2.0: 20, 4.0: 14 | - |
| metal | 1 | 140.0-140.0 | 136 | 20 / 0.0 | body 36 / 3.5 | 2, 8.0, 2.0 | 1.0: 421 | - |
| eurodance | 1 | 128.0-128.0 | 120 | 4 / 2.0 | body 28.0 / 9.0 | 2, 6.0, 3.25 | 1.0: 90, 2.0: 14, 32.0: 5 | cutoff/lfo 22, wet/lfo 19, wet/curve 3 |

Density curves (median layers per 5 % of the song) are in each profile's .md. Rendering the same projects with the LMMS binary and
triaging the audio (method `project-rendered-then-analysed`, DAW_STUDY 5) checks the inferred boundaries; status in DAW_STUDY_SOURCES.md 3.
Genres with no licensed project (phonk, dubstep / industrial, house / electro, trap, rock): guides below are producer-reported or design calls.

## 2. How to make a similar form (Craft arrangement maps, forms as gates)
Each guide is a gate map (atoms) plus a layer ladder (lanes per section) and the transition grammar. Labels: **measured** (docs/dawstudy,
n given), **producer-reported** (cited reference doc), **design call** (ours), **UNVERIFIED**. Composition ids: docs/COMPOSITION.md (ARR-01 forms as gates and ARR-02 genre section maps apply to every guide).

### 2.1 Industrial riddim / heavy dubstep (glyphcore/industrial)
- Map (design call on genre convention, EDM_REFERENCES 3): intro 8, build 8, drop 16, break 8, build 8, drop 16 (switch-up) = 64 bars;
  gates `ind.intro` .. `ind.drop2`, `ind.vacuum`, `ind.pickup`, `ind.phraseEnd`. Longer: drop 32 split A / B (`ed.m32DropA / B`) and an
  8-bar outro.
- Layer ladder (lanes, LAY-03 with industrial 0.85): intro 2-5 (texture bed, servo, sparse hits), build 4-8 (kit enters, hiss riser,
  ratchet), drop 7-12 (kick, snare, chain, sub, riddim, 1-2 hit lanes), break 3-6.
- Transitions (TR-02 riser and impact, TEN-04 the gap, TR-01 pickup fill, TR-03 drop-out bar): riser ending on the drop, the vacuum (half bar of silence except the riser), pickup clang, slam on the 1;
  call / response bass `ind.riddimLine` / `ind.riddimAlt`; hit density by section (`hits1` -> `hits4` -> `hitsGap`, `hits7` on phrase ends).
- Composition fundamentals: motif = the riddim rhythm (repeat, then MOT-08 rhythmic displacement, MOT-06 fragmentation); foreshadow the drop
  bass filtered in the intro (FS-02); contrast = the break drops the low end entirely (LAY-08 contrast by subtraction); density from the hit
  grammar (LAY-02 layer ladder, LAY-03), not from more bass layers; second drop = ARR-04 switch-up; map = ARR-01 / ARR-02.
- Approach guide (artist style): docs/INDUSTRIAL_REFERENCES.md section 4 ("industrial riddim, in the style associated with Excision"):
  form and approach only, each claim labelled; his own sound-design chain is UNVERIFIED (no source).

### 2.2 Phonk (glyphcore/phonk)
- Map (producer-reported / design call, CONVENTIONS 3): intro 4, verse 16, hook 8, verse 16, hook 8, bridge 4, hook 8, outro 4 = 68 bars;
  gates `hh.intro` .. `hh.outro`, `hh.dropBar`, `hh.switch` (beat switch). No licensed phonk project was found (measured: none).
- Ladder: intro 2-4 (cowbell / melody only if the brief names them; never inferred), verse 5-8, hook 6-9, bridge 3-5.

### 2.3 Drum and bass (glyphcore/dnb-electro)
- Map (producer-reported, DNB_ELECTRO_REFERENCES): intro 16, build 8, drop 32, breakdown 16, build 8, drop 32, halftime 8, outro 8 = 128;
  gates `dnb.*`, `dnb.vacuum`. Measured (indicative, n = 1, CC-BY-SA, 170 bpm, 105 bars): density reaches 8-9 layers by 15 % of the song and stays
  there, two peak sections of median 38 bars with 9.5 layers separated by 4-bar thinned sections, 8-bar clips the most common: a
  dancefloor form that holds the drop and uses short breaks, consistent with the producer-reported long-drop map.

### 2.4 House / electro / trance (glyphcore/dnb-electro)
- Map: 32-bar blocks (`hs.map*`, producer-reported). Measured (indicative, trance n = 2, section 1): short clips dominate (2-bar 298, 1-bar 261, 4-bar 112 clips) and
  density climbs from about 2.4 median layers in the first 5 % to 10-12 at 45-80 % before falling to 2.6 at the end: a long build-up
  to a late peak, which the 32-bar block map encodes as successive blocks with one more layer group each.

### 2.5 Trap / hip-hop (glyphcore/phonk hip-hop family)
- Map: CONVENTIONS 3 (68 bars). Measured (indicative, n = 1 hip-hop LMMS demo): a 16-bar intro, then one long body with 6-7 layers;
  the beat switch / hook contrast of the convention is a design call, not visible in that one project.

### 2.6 Rock (glyphcore/rockmetal)
- Map (genre convention, design call): intro 4, verse 8, pre 4, chorus 8, verse 8, pre 4, chorus 8, bridge 8, solo 8, chorus 8, outro 4
  = 72; gates `rm.*`. Ladder (rock 0.8): verse 3-7 (drums, bass, one guitar), pre 4-8, chorus 6-11 (second guitar / organ / strings, crash
  ride), bridge 2-6. Fills on `rm.fills`, crash on `rm.crashBars`. Fundamentals: ROCKMETAL_REFERENCES 4.

### 2.7 Metal (glyphcore/rockmetal)
- Map: as rock with the bridge as a half-time breakdown (`rm.bridge` + `rm.breakdown` grammar) and riff sections (A A A B) between verses.
  Measured (indicative, n = 1 LMMS metal demo, section 1): a long, sparse intro (about 20 bars), then 36-44-bar bodies with 3-4 median
  layers and short drops in density (breakdown-like 4-12 bars): long sections and few layers, consistent with a riff-driven form.

## 3. Approach guide format (per artist style)
`### <style>: <artist>-style form and sound-design approach` with: tempo / feel range; section map with bars; layer ladder; sound-design
chain types (source -> processing -> resampling) with labels; mix / master habits; what is NOT described (melodies, riffs, rhythms or
arrangements of specific songs, presets); sources. Instance: docs/INDUSTRIAL_REFERENCES.md section 4.

