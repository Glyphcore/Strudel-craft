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
[ $rc -eq 0 ] && echo "OVERALL: PASS" || echo "OVERALL: FAIL"
exit $rc
