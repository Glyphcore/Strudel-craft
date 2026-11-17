#!/usr/bin/env bash
# Program == audio proof (issue #136): re-render 16-bar slices of the STANDALONE program, compare each with the same bars of the delivered mp3
# (decoded) by engine/similarity (suno-track-lab). Usage: proof_slices.sh MP3 OUT_DIR [FIRST_BAR ...]   (default slices 33 and 73)
# Supersaw voices draw random phases, so two renders of one program are never sample-identical; the score measures that they are the same music.
set -euo pipefail
MP3="$1"; OUT="$2"; shift 2; LAB="${LAB:-/home/user/suno-track-lab}"; HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."; export STRUDEL_CRAFT="$ROOT"
BAR=$(python3 -c "print(240/140)"); mkdir -p "$OUT"; [ $# -gt 0 ] || set -- 33 73
for a in "$@"; do b=$((a+15))
  "$LAB/engine/load/gate.sh" heavy -- node "$ROOT/tools/racks/render_track.cjs" "$HERE/track.standalone.strudel.js" "$OUT/slice_$a.wav" --bars $a-$b --tail 2 > "$OUT/render_$a.log"
  ffmpeg -y -v error -ss $(python3 -c "print(($a-1)*$BAR)") -t $(python3 -c "print(16*$BAR)") -i "$MP3" -af loudnorm=I=-14:TP=-1:LRA=20 -ac 2 -ar 44100 "$OUT/ref_$a.wav"
  ffmpeg -y -v error -t $(python3 -c "print(16*$BAR)") -i "$OUT/slice_$a.wav" -af loudnorm=I=-14:TP=-1:LRA=20 -ac 2 -ar 44100 "$OUT/cand_$a.wav"
  "$LAB/engine/similarity/compare.sh" "$OUT/ref_$a.wav" "$OUT/cand_$a.wav" "$OUT/sim_$a"
done
