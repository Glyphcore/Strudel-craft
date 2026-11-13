#!/usr/bin/env bash
# One command for all 6 behavioral checks (issue #32): UI (4) + CLI (2).
# Usage: tests/smoke.sh [SUNO_LAB_DIR]   (or env SUNO_LAB; default /home/user/suno-track-lab)
HERE="$(cd "$(dirname "$0")" && pwd)"
LAB="${1:-${SUNO_LAB:-/home/user/suno-track-lab}}"
rc=0
node "$HERE/smoke.mjs" || rc=1
node "$LAB/engine/strudel-cli/test/smoke.mjs" || rc=1
[ $rc -eq 0 ] && echo "OVERALL: PASS" || echo "OVERALL: FAIL"
exit $rc
