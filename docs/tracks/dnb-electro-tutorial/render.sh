#!/usr/bin/env bash
# Render a dnb-electro track demo headless, master it and score it against its genre (#124).
#   docs/tracks/dnb-electro-tutorial/render.sh OUT_DIR [track|electro|house] [standalone|pack] [BARS]
# chunked CLI render (suno-track-lab engine/strudel-cli/chunk_render.py: 8-bar chunks, 2 bars pre-roll) -> OUT/mix.wav
# -> engine/master/master.py --preset dnb|electro|house -> OUT/master.wav (+ master.json) -> engine/genre/score.py -> OUT/score.json, score.md
# pack = the pack version with the site lock (atoms.import) and both packs' racks as one hooks config; standalone = the generated paste-ready file.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SC="${STRUDEL_CRAFT:-$(cd "$HERE/../../.." && pwd)}"; export STRUDEL_CRAFT="$SC"
LAB="${SUNO_TRACK_LAB:-/home/user/suno-track-lab}"; CLI="${STRUDEL_CLI:-$LAB/engine/strudel-cli}"
OUT="$1"; NAME="${2:-track}"; KIND="${3:-standalone}"
case "$NAME" in track) BPM=174; BARS_D=128; PRE=dnb; G=dnb;; electro) BPM=128; BARS_D=40; PRE=electro; G=electro;; house) BPM=128; BARS_D=56; PRE=house; G=house;; *) echo "unknown track $NAME" >&2; exit 2;; esac
BARS="${4:-$BARS_D}"; mkdir -p "$OUT"
if [ "$KIND" = pack ]; then
  IN="$HERE/$NAME.strudel.js"; HK="$(mktemp --suffix=.json)"; trap 'rm -f "$HK"' EXIT
  python3 -c 'import json,sys; a={"model":1,"defs":{}}; [a["defs"].update({k:v for k,v in json.load(open(f))["defs"].items() if k not in a["defs"]}) for f in sys.argv[2:]]; json.dump(a, open(sys.argv[1], "w"))' "$HK" "$SC/site/data/dnb-electro/racks-dnb-electro.json" "$SC/site/data/edm/racks-edm-core.json"
  EXTRA=(--packs "$SC/site/packs.lock.json" --hooks "$HK")
else IN="$HERE/$NAME.standalone.strudel.js"; EXTRA=(); fi
python3 "$CLI/chunk_render.py" "$IN" "$OUT" --bars "$BARS" --chunk 8 --preroll 2 ${EXTRA[@]+-- "${EXTRA[@]}"}
python3 "$LAB/engine/master/master.py" "$OUT/mix.wav" "$OUT/master.wav" --preset "$PRE" --report "$OUT/master.json"
python3 "$LAB/engine/genre/score.py" "$OUT/master.wav" "$LAB/docs/genres/$G.json" --out "$OUT/score.json" --md "$OUT/score.md" --bpm "$BPM" --form "$HERE/form.$NAME.json"
