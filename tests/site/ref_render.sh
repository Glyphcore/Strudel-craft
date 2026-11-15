#!/usr/bin/env bash
# CLI reference render of a night phonk window for tests/site/record_offline.mjs and engine_perf.mjs (--ref): strudel CLI (STRUDEL_CLI, default
# /home/user/suno-track-lab/engine/strudel-cli) with the site lock, both racks ingredients and the CLI site base, retried (superdough onended race).
#   tests/site/ref_render.sh OUT_DIR [v1|v2] [FROM_BAR] [BARS] [BPM]   -> OUT_DIR/mix.wav (bar B starts at cycle B-1)
# BPM (default 120): the site's Tempo knob rewrites the program's setcpm(...) to setcpm(BPM/4) (app.js withTempo), so the reference does the same.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SC="$(cd "$HERE/../.." && pwd)"; export STRUDEL_CRAFT="$SC"; CLI="${STRUDEL_CLI:-/home/user/suno-track-lab/engine/strudel-cli}"
OUT="$1"; V="${2:-v2}"; FROM="${3:-16}"; BARS="${4:-8}"; BPM="${5:-120}"; D="$SC/docs/tracks/night-phonk-demo"; SRC="$D/track$([ "$V" = v2 ] && echo .v2).standalone.strudel.js"
mkdir -p "$OUT"; HK="$(mktemp --suffix=.json)"; IN="$(mktemp --suffix=.strudel.js)"; trap 'rm -f "$HK" "$IN"' EXIT
sed -E "s#setcpm\(([^()]|\([^()]*\))*\)#setcpm(${BPM}/4)#" "$SRC" > "$IN"
python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2])); a["defs"].update(b["defs"]); json.dump(a, open(sys.argv[3], "w"))' "$SC/site/data/phonk/racks.json" "$SC/site/data/phonk/racks-v2.json" "$HK"
for try in 1 2 3 4 5; do
  "$CLI/strudel" render "$IN" "$OUT" --from "$FROM" --bars "$BARS" --packs "$SC/site/packs.lock.json" --hooks "$HK" --prelude "$D/cli-site-base.js" --prelude "$SC/site/prelude/word.js" > "$OUT/render.log" 2>&1 && [ -f "$OUT/mix.wav" ] && exit 0
  echo "retry $try" >&2
done
exit 1
