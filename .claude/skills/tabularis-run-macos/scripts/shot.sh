#!/usr/bin/env bash
# Captures the app window, even when other windows cover it.
# WebDriver's own screenshot renders the DOM without the app's CSS: don't use it.
# Usage: shot.sh <out.png>
set -euo pipefail
RUN_DIR=${RUN_DIR:-${TMPDIR:-/tmp}/tabularis-run}
pid=$(pgrep -f "target/debug/tabularis" | head -1)
screencapture -x -o -l"$("$RUN_DIR/wid" "$pid")" "$1"
sips -Z 1400 "$1" >/dev/null
