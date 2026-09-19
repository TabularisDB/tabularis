#!/usr/bin/env bash
# TEMPORARY issue #791 evidence helper. Remove with the temporary workflow.
# Run only on ephemeral Actions runners, from the separate subject checkout.
set -uo pipefail
: "${EVIDENCE_DIR:?}" "${PROFILE_DIR:?}"
check=$1
shift
[[ "$check" =~ ^[a-z-]+$ ]] || exit 2
mkdir -p "$EVIDENCE_DIR" "$PROFILE_DIR"/{home,tmp,config,cache,data,appdata,localappdata,tabularis}

# Retain the explicitly provisioned build tools while redirecting app/user data.
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
if command -v cygpath >/dev/null 2>&1; then
  export CARGO_HOME="$(cygpath -m "$CARGO_HOME")"
  export RUSTUP_HOME="$(cygpath -m "$RUSTUP_HOME")"
fi
export HOME="$PROFILE_DIR/home" USERPROFILE="$PROFILE_DIR/home"
export TMPDIR="$PROFILE_DIR/tmp" TMP="$PROFILE_DIR/tmp" TEMP="$PROFILE_DIR/tmp"
export XDG_CONFIG_HOME="$PROFILE_DIR/config" XDG_CACHE_HOME="$PROFILE_DIR/cache"
export XDG_DATA_HOME="$PROFILE_DIR/data"
export APPDATA="$PROFILE_DIR/appdata" LOCALAPPDATA="$PROFILE_DIR/localappdata"
export TABULARIS_DATA_DIR="$PROFILE_DIR/tabularis"

{
  printf 'Subject SHA: '; git rev-parse HEAD
  printf 'Command: '; printf '%q ' "$@"; printf '\n'
  printf 'Started UTC: '; date -u '+%Y-%m-%dT%H:%M:%SZ'
} > "$EVIDENCE_DIR/$check.command.txt"
# No errexit: preserve the command status and logs before returning failure.
"$@" 2>&1 | tee "$EVIDENCE_DIR/$check.log"
statuses=("${PIPESTATUS[@]}")
rc=${statuses[0]}
printf '%s\n' "$rc" > "$EVIDENCE_DIR/$check.exit"
printf 'Command exit: %s; log capture exit: %s\n' "$rc" "${statuses[1]}" >> "$EVIDENCE_DIR/$check.command.txt"
# A logging failure must not make the job green either.
if [[ "${statuses[1]}" != 0 ]]; then exit 1; fi
exit "$rc"
