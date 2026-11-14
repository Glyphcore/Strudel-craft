#!/usr/bin/env bash
# Render the night phonk demo headless with the strudel CLI (suno-track-lab engine/strudel-cli).
#   docs/tracks/night-phonk-demo/render.sh OUT_DIR [standalone|pack] [BARS]
# pack = track.strudel.js with the site lock (atoms.import) and the racks ingredient as hooks config; standalone = the paste-ready file.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; SC="${STRUDEL_CRAFT:-$(cd "$HERE/../../.." && pwd)}"; export STRUDEL_CRAFT="$SC"
CLI="${STRUDEL_CLI:-/home/user/suno-track-lab/engine/strudel-cli}"
OUT="$1"; KIND="${2:-standalone}"; BARS="${3:-80}"
if [ "$KIND" = pack ]; then IN="$HERE/track.strudel.js"; else IN="$HERE/track.standalone.strudel.js"; fi
python3 "$CLI/chunk_render.py" "$IN" "$OUT" --bars "$BARS" --chunk 8 --preroll 2 -- \
  --packs "$SC/site/packs.lock.json" --hooks "$SC/site/data/phonk/racks.json" --prelude "$HERE/cli-site-base.js" --prelude "$SC/site/prelude/word.js"
