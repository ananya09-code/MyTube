#!/bin/sh
# ------------------------------------------------------------------
#  Native messaging launcher for mytube.
#  The manifest "path" points at this file; it runs host.py and
#  forwards stdin/stdout untouched.
#  Nothing may be echoed: stdout carries only protocol messages.
# ------------------------------------------------------------------
HERE="$(cd "$(dirname "$0")" && pwd)"

for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
        exec "$candidate" "$HERE/host.py"
    fi
done

# No Python: record the reason in the log and exit non-zero.
printf '%s ERROR: python3 was not found in PATH\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$HERE/host.log" 2>/dev/null
exit 1
