#!/usr/bin/env bash
# wordbank.sh STEM.wav LYRICS.txt OUT_DIR [opts] | --selftest   (see wordbank.py)
exec python3 "$(dirname "$0")/wordbank.py" "$@"
