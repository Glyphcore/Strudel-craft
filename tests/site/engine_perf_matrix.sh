#!/usr/bin/env bash
# Run tests/site/engine_perf.mjs over the measurement matrix of docs/AUDIO_ENGINE.md (v1 and v2; x1, x4, x6 CPU throttling; x4 hidden) and
# print one summary line per cell. Usage: tests/site/engine_perf_matrix.sh OUT_DIR [--site DIR] [--query k=v ...] [--secs 20] [--cells "v2:4 v2:6h"]
set -uo pipefail; HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$1"; shift; mkdir -p "$OUT"
CELLS="v2:1 v2:4 v2:6 v2:4h v1:1 v1:4 v1:6"; EXTRA=()
while [ $# -gt 0 ]; do case "$1" in --cells) CELLS="$2"; shift 2;; *) EXTRA+=("$1"); shift;; esac; done
for c in $CELLS; do p="${c%%:*}"; r="${c#*:}"; h=""; case "$r" in *h) h="--hidden"; r="${r%h}";; esac
  timeout 600 node "$HERE/engine_perf.mjs" --prog "$p" --throttle "$r" $h "${EXTRA[@]}" --json "$OUT/$c.json" > /dev/null 2>"$OUT/$c.err" || echo "cell $c failed (see $OUT/$c.err)"
  python3 - "$OUT/$c.json" "$c" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception as e: print(sys.argv[2], 'no result', e); sys.exit()
b=d['bg']; lt=d['longTasks']; g=(d.get('capture') or {}).get('glitch') or {}
print(f"{sys.argv[2]:6} busy {d['cpu'].get('busyPct', 0):5.1f}% lt {lt['n']:4} sum {lt['totalMs']:6} worst {lt['worstMs']:5} | ticks {b['ticks']} late {b['lateTicks']} maxGap {b['maxGapMs']} underruns {b['underruns']} | query {b['queryMs']} voice {b['voiceMs']} haps {b['haps']} late {b['lateHaps']} tight {b['tightHaps']} minMargin {b['minMarginMs']} | sd dropped {d['superdough']['droppedPast']}" + (f" | cap onsets {g.get('matched')}/{g.get('refOnsets')} dev p95 {g.get('onsetDevP95Ms')} drift {g.get('driftMsPerS')} dropouts {g.get('dropouts')} clicks {g.get('clicks')} lvl3dB {g.get('levelWithin3dB')}" if g else ''))
PY
done
