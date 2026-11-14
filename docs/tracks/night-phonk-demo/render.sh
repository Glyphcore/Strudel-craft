#!/usr/bin/env bash
# Render the night phonk demo headless with the strudel CLI (suno-track-lab engine/strudel-cli).
#   docs/tracks/night-phonk-demo/render.sh OUT_DIR [standalone|pack|v2|v2pack] [BARS]
# pack = track.strudel.js with the site lock (atoms.import) and the racks ingredient as hooks config; standalone = the paste-ready file.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SC="${STRUDEL_CRAFT:-$(cd "$HERE/../../.." && pwd)}"; export STRUDEL_CRAFT="$SC"
CLI="${STRUDEL_CLI:-/home/user/suno-track-lab/engine/strudel-cli}"
OUT="$1"; KIND="${2:-standalone}"; BARS="${3:-80}"
case "$KIND" in pack) IN="$HERE/track.strudel.js";; v2) IN="$HERE/track.v2.standalone.strudel.js";; v2pack) IN="$HERE/track.v2.strudel.js";; *) IN="$HERE/track.standalone.strudel.js";; esac
# racks: v1 + v2 hooks@1 ingredients merged into one hooks config (the CLI takes one --hooks file)
HK="$(mktemp --suffix=.json)"; trap 'rm -f "$HK"' EXIT
python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2])); a["defs"].update(b["defs"]); json.dump(a, open(sys.argv[3], "w"))' "$SC/site/data/phonk/racks.json" "$SC/site/data/phonk/racks-v2.json" "$HK"
python3 "$CLI/chunk_render.py" "$IN" "$OUT" --bars "$BARS" --chunk 8 --preroll 2 -- \
  --packs "$SC/site/packs.lock.json" --hooks "$HK" --prelude "$HERE/cli-site-base.js" --prelude "$SC/site/prelude/word.js"
