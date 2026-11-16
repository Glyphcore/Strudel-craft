#!/usr/bin/env bash
# CLI reference render of a night phonk window for tests/site/record_offline.mjs and engine_perf.mjs (--ref): strudel CLI (STRUDEL_CLI, default
# /home/user/suno-track-lab/engine/strudel-cli) with the site lock, both racks ingredients and the CLI site base, retried (superdough onended race).
#   tests/site/ref_render.sh OUT_DIR [v1|v2] [FROM_BAR] [BARS] [BPM]   -> OUT_DIR/mix.wav (bar B starts at cycle B-1)
# BPM (optional): the program's own setcpm wins on the site (128.8 BPM for night phonk), so the reference keeps it. An explicit BPM rewrites setcpm(...) to setcpm(BPM/4),
# PIN_SUPERSAW=1 pins the supersaw phases (see below). Reference for record_offline.mjs: PIN_SUPERSAW=1 ref_render.sh REF v2 16 8 128.8
# which is what the site does only after the user touches the Tempo knob (app.js withTempo, S.tempoOv).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SC="$(cd "$HERE/../.." && pwd)"; export STRUDEL_CRAFT="$SC"; CLI="${STRUDEL_CLI:-/home/user/suno-track-lab/engine/strudel-cli}"
OUT="$1"; V="${2:-v2}"; FROM="${3:-16}"; BARS="${4:-8}"; BPM="${5:-}"; D="$SC/docs/tracks/night-phonk-demo"; SRC="$D/track$([ "$V" = v2 ] && echo .v2).standalone.strudel.js"
mkdir -p "$OUT"; HK="$(mktemp --suffix=.json)"; IN="$(mktemp --suffix=.strudel.js)"; trap 'rm -f "$HK" "$IN"' EXIT
if [ -n "$BPM" ]; then sed -E "s#setcpm\(([^()]|\([^()]*\))*\)#setcpm(${BPM}/4)#" "$SRC" > "$IN"; else cp "$SRC" "$IN"; fi
python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2])); a["defs"].update(b["defs"]); json.dump(a, open(sys.argv[3], "w"))' "$SC/site/data/phonk/racks.json" "$SC/site/data/phonk/racks-v2.json" "$HK"
# PIN_SUPERSAW=1 (tests/site/record_offline.mjs fixture): the reference program's one supersaw voice (hazePad) is rendered as a plain sawtooth, because the supersaw worklet
# draws its phases from Math.random on the audio thread and no two renders (or engines) agree; the track itself is unchanged. record_offline.mjs aliases the same sound in Chrome.
[ -n "${PIN_SUPERSAW:-}" ] && sed -i 's/"supersaw"/"sawtooth"/g' "$IN"
for try in 1 2 3 4 5; do
  "$CLI/strudel" render "$IN" "$OUT" --from "$FROM" --bars "$BARS" --packs "$SC/site/packs.lock.json" --hooks "$HK" --prelude "$D/cli-site-base.js" --prelude "$SC/site/prelude/word.js" > "$OUT/render.log" 2>&1 && [ -f "$OUT/mix.wav" ] && exit 0
  echo "retry $try" >&2
done
exit 1
