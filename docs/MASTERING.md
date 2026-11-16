# Mastering fundamentals

Issue #158. Own words; sources at the end (section 8). Tools: suno-track-lab `engine/master/master.py` (genre presets), `engine/master/chain.py`
(preset chains), `engine/master/check.py` (per-file fundamentals with pass / fail), `engine/genre/score.py` (genre targets per bar), strudel CLI
`--master`. Genre files: suno-track-lab `docs/genres/*.json` (sound ranges) and Strudel-craft `docs/genres/*.json` (measured targets, #125).

## 1. Loudness, normalisation and why "louder" stopped winning
- **Integrated loudness (LUFS)** is ITU-R BS.1770: K-weighting (a high shelf around 1.7 kHz plus a high-pass around 38 Hz, roughly how loud
  we hear a band), mean square per channel, 400 ms blocks, an absolute gate at -70 LUFS and a relative gate 10 LU under the ungated level.
  EBU R128 adds short-term (3 s) and momentary (400 ms) readings and **LRA** (loudness range, EBU Tech 3342: the spread between the 10th and
  95th percentile of gated short-term loudness).
- **Streaming normalisation**: services play every track at about the same loudness. Spotify normalises to -14 LUFS by default (quiet -19,
  loud -11), turning loud masters down and lifting quiet ones only as far as their true peak allows; YouTube and Tidal sit near -14; Apple
  Music Sound Check near -16; AES TD1008 recommends -16 LUFS distribution loudness for track-normalised music. Consequence: a -7 LUFS master
  is played 7 dB down and keeps only the side effects of its limiting (fewer transients, less punch, more distortion), while a -12 master
  with intact peaks plays at the same level and sounds more open. Club and download masters are still loud (-9 to -6 for DnB, dubstep,
  metal, trap); our presets target those and the CLI's `--lufs -14` makes a streaming master.
- **PLR / PSR**: peak-to-loudness ratio (true peak minus integrated) and peak-to-short-term-loudness ratio. They are the headroom numbers that
  matter after normalisation: PLR 6-8 dB is very dense, 10-14 is open. `check.py` reports both.

## 2. True peak, headroom, inter-sample overs
Sample peaks miss the peaks between samples that a DAC or a lossy decoder reconstructs; true peak (BS.1770 annex 2) estimates them by 4x
oversampling. Lossy encoders add overshoot that grows as the bit rate falls, so delivery ceilings are -1 dBTP (AES TD1008, Spotify; Spotify
suggests -2 dBTP for masters louder than -14 LUFS). Mix headroom: leave the mix bus peaking around -6 to -3 dBFS before mastering so the
master chain has room; never fix a mix by limiting harder. Our limiter (master.py stage 7) uses the meter's own oversampled detector, so what
it limits is what the meter reads.

## 3. Mono compatibility, low end and the stereo image
- Sub and kick belong in the centre: below about 100-120 Hz human localisation is weak, club systems sum to mono subs, vinyl cutting needs
  it, and side energy there costs headroom. The presets apply mono-below (LR4 high-pass on the side channel at 100 / 120 Hz; RACK_STANDARD
  side<120 limits per rack).
- Mono fold-down: sum L and R and compare loudness; a loss of more than about 3 LU means phase-cancelling layers (wide supersaws, Haas
  delays, out-of-phase bass). `check.py` reports the fold-down loss, the L/R correlation below the mono frequency (>= 0.9 wanted) and the
  side / mid ratio per band.
- Width by band: wide above ~4 kHz (air, cymbals), moderate in the mids (pads, doubled guitars), near zero in the lows.

## 4. The chain and its order
1. **Clean-up**: DC removal / high-pass at 20-30 Hz (infrasonic energy eats limiter headroom), mono-below.
2. **Corrective EQ** before dynamics (a resonance would otherwise drive the compressor); broad **tonal EQ** (shelves) next.
3. **Glue compression**: low ratio (1.5-4), 1-3 dB gain reduction, attack slow enough (10-30 ms) to let transients through, release timed to
   the groove (80-200 ms at club tempos). Multiband (or OTT-style upward + downward) only where one band misbehaves.
4. **Saturation / soft clip**: adds density without a limiter's pumping; drive a few dB at most, oversampled (master.py clips at 4x).
5. **Limiter last**: lookahead, true-peak aware, at the delivery ceiling; it should catch peaks, not create the loudness. If it reduces more
   than ~3-4 dB on average the loudness should come from earlier stages or a denser mix.
6. **Dither** when the word length drops (32-bit float -> 24 or 16 bit): TPDF dither (optionally noise-shaped) at the very end, once.
   Float masters for further processing need none.
Rejected orders: limiter before EQ (EQ moves peaks past the ceiling), saturation after the limiter (overs), several limiters in series
(each smears transients for less than 1 dB).

## 5. Targets per genre (starting points)
Ranges are those in the genre files (S = a source, G = our estimate, D = design call); check a reference track in the same genre at the
same loudness before trusting any number.

| genre | integrated LUFS (club / download) | TP max | PLR dB | LRA LU | crest min | mono below | preset |
|---|---|---|---|---|---|---|---|
| folk-pop | -14..-9 | -1 | - | - | - | 100 | folk-pop |
| wave phonk | -14..-10 | -1 | - | - | - | 120 | wavephonk |
| dubstep / industrial | -9..-6 (S) | -1 | 5..8 | 4..9 | 6 | 120 | dubstep, industrial |
| DnB | -10..-6 (S) | -1 | - | 3..10 | 6 | 120 | dnb |
| house / electro | -10.5..-7 / -11..-7 | -1 | - | - | - | 120 | house, electro |
| trap / hip-hop | -10..-6 (S secondary, G) | -1 | 6..12 (D) | 3..8 (G) | 6 | 120 | trap |
| rock | -12..-8 (S secondary, D) | -1 | 8..14 (D) | 4..10 (G) | 7 | 100 | rock |
| metal | -10..-6 (S secondary, D) | -1 | 6..11 (D) | 2..7 (G) | 5 | 120 | metal |
| streaming master (any) | -14 (Spotify, YouTube), -16 (Apple, AES TD1008) | -1 (-2 when louder than -14) | | | | | `--lufs -14` |

Preset details (shelves, compressor, clip): suno-track-lab engine/master/README.md. Rock keeps the most transient room (drums carry the
energy; slow attack 30 ms, ratio 2); metal is denser but its high-gain guitars already compress themselves, so the master adds little
(0 dB low shelf to keep the low end tight, gentle top); industrial and dubstep take the most soft clip (3 dB: their impacts are short and
loud); trap keeps a slight low shelf for the 808 with a 22 Hz high-pass (808 fundamentals sit at 30-50 Hz).

## 6. Reference matching
Pick 2-3 commercial references in the genre, level-match them to your master (same integrated LUFS, by ear or with the meter; louder always
sounds "better"), then compare tonal balance (spectrum or `engine/spectral_align`), low-end weight (`low_end_ratio` in score.py), stereo
width per band (`check.py`), and dynamics (PLR, LRA). Change the mix, not only the master, when the gap is large. Never copy a reference's
arrangement or sounds (docs/RESEARCH_ETHICS.md 5): match balance and loudness, not content.

## 7. Export
Master in 32-bit float WAV at the session rate (44.1 or 48 kHz); deliver 24-bit WAV (dithered) for distribution, 16-bit 44.1 kHz only for
CD (dithered); lossy previews from the 24-bit master (MP3 320 kbps / AAC 256 kbps), checked for true peak after encoding. Keep the
un-limited premaster (the CLI writes `mix_premaster.wav`) so a new loudness target is a re-master, not a re-limit.

## 8. Sources
- ITU-R BS.1770 (loudness and true peak): https://www.itu.int/rec/R-REC-BS.1770
- EBU R128 and EBU Tech 3342 (loudness range): https://tech.ebu.ch/publications/r128 , https://tech.ebu.ch/publications/tech3342
- AES TD1008 (2021) distribution loudness for streaming, -16 LUFS music, -1 dBTP at the codec input: summary at https://productionadvice.co.uk/td1008/
- Spotify for Artists, loudness normalisation (-14 / -19 / -11 LUFS, true-peak advice): https://support.spotify.com/artists/article/loudness-normalization/
- ITU-R BS.2434 (loudness for internet delivery): https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BS.2434-2018-PDF-E.pdf
- Bob Katz, *Mastering Audio: The Art and the Science* (Focal Press): chain order, dither, K-system metering (paraphrased).
- Lipshitz, Wannamaker, Vanderkooy, "Quantization and Dither: A Theoretical Survey", JAES 40(5), 1992 (TPDF dither).
- Genre loudness ranges marked (S) secondary: mastering-engineer loudness surveys summarised in suno-track-lab docs/genres/*.md; UNVERIFIED as
  population statistics (no measured corpus of our own except the tracks in this repo).
