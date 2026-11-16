#!/usr/bin/env bash
# One command for all 6 behavioral checks (issue #32): UI (4) + CLI (2), plus the rack audit (#94).
# Usage: tests/smoke.sh [SUNO_LAB_DIR]   (or env SUNO_LAB; default /home/user/suno-track-lab)
HERE="$(cd "$(dirname "$0")" && pwd)"
LAB="${1:-${SUNO_LAB:-/home/user/suno-track-lab}}"
rc=0
node "$HERE/smoke.mjs" || rc=1
node "$LAB/engine/strudel-cli/test/smoke.mjs" || rc=1
# rack standard (#94, docs/RACK_STANDARD.md): every rack of the phonk pack against its class thresholds (needs the strudel CLI; a few minutes)
STRUDEL_CLI="$LAB/engine/strudel-cli" node "$HERE/../tools/racks/audit.mjs" --only racks --quiet || rc=1
# sound standard (#125): measure.mjs conformance on synthetic signals, genre files against the schema (plain Node, seconds)
node "$HERE/racks/measure.mjs" || rc=1
# hooks allowlist guard (groove regression): every hooks def step of every shipped pack must be in site/data/hooks-steps.json, else the site skips that def
for pk in "$HERE"/../site/data/*/craftpack.json; do [ -f "$pk" ] && { python3 "$HERE/../tools/packs/packs.py" validate "$pk" --site-allowlist >/dev/null || { echo "FAIL hooks allowlist: $pk"; rc=1; }; }; done
STRUDEL_MODULES="$LAB/engine/strudel-cli/node_modules" node "$HERE/packs/hooks_kind.mjs" >/dev/null || rc=1
node "$HERE/site/hooks_groove_pack.mjs" >/dev/null || rc=1
[ $rc -eq 0 ] && echo "OVERALL: PASS" || echo "OVERALL: FAIL"
exit $rc
