#!/bin/sh
# Translates TABULARIS_* environment variables into `tabularis web` flags.
#
#   docker run ... ghcr.io/tabularisdb/tabularis              -> tabularis web <flags from env>
#   docker run ... ghcr.io/tabularisdb/tabularis --debug      -> extra flags are appended
#   docker run ... ghcr.io/tabularisdb/tabularis healthcheck  -> container health probe
#   docker run ... ghcr.io/tabularisdb/tabularis sh           -> any other command runs as is
set -eu

port="${TABULARIS_PORT:-8080}"
public_url="${TABULARIS_PUBLIC_URL:-http://localhost:${port}}"
public_url="${public_url%/}"

# The server only answers Host headers of its public URL, probes included.
public_host() {
    host="${public_url#*://}"
    printf '%s' "${host%%/*}"
}

is_true() {
    case "$1" in 1 | true | TRUE | True | yes | on) return 0 ;; *) return 1 ;; esac
}

# VAR_FILE -> VAR, the Docker/Kubernetes secrets convention.
file_env() {
    var="$1"
    eval "value=\${$var:-}"
    eval "file=\${${var}_FILE:-}"
    if [ -n "$value" ] && [ -n "$file" ]; then
        echo "tabularis: set either $var or ${var}_FILE, not both" >&2
        exit 1
    fi
    if [ -n "$file" ]; then
        value="$(cat "$file")"
        export "$var=$value"
    fi
    unset "${var}_FILE"
}

if [ "${1:-}" = "healthcheck" ]; then
    exec curl -fsS --max-time 4 -o /dev/null \
        -H "Host: $(public_host)" "http://127.0.0.1:${port}/healthz"
fi

case "${1:-web}" in
    web) shift $(($# > 0 ? 1 : 0)) ;;
    -*) ;;
    *) exec "$@" ;;
esac

file_env TABULARIS_WEB_PASSWORD
file_env TABULARIS_WEB_PROXY_SECRET

auth="${TABULARIS_AUTH:-password}"
case "$auth" in
    password)
        if [ -z "${TABULARIS_WEB_PASSWORD:-}" ]; then
            password_file="${TABULARIS_DATA_DIR:-/data}/web-password"
            if [ ! -s "$password_file" ]; then
                (umask 077 && head -c 18 /dev/urandom | base64 | tr '+/' '-_' >"$password_file")
                {
                    echo
                    echo "  No TABULARIS_WEB_PASSWORD set. Generated login password:"
                    echo
                    echo "      $(cat "$password_file")"
                    echo
                    echo "  Stored in $password_file; set TABULARIS_WEB_PASSWORD to choose your own."
                    echo
                } >&2
            else
                echo "tabularis: using the generated login password from $password_file" >&2
            fi
            TABULARIS_WEB_PASSWORD="$(cat "$password_file")"
            export TABULARIS_WEB_PASSWORD
        fi
        ;;
    proxy)
        if [ -z "${TABULARIS_WEB_PROXY_SECRET:-}" ]; then
            echo "tabularis: TABULARIS_AUTH=proxy requires TABULARIS_WEB_PROXY_SECRET" >&2
            exit 1
        fi
        ;;
    *)
        echo "tabularis: TABULARIS_AUTH must be 'password' or 'proxy', got '$auth'" >&2
        exit 1
        ;;
esac

set -- web --no-open \
    --host "${TABULARIS_HOST:-0.0.0.0}" \
    --port "$port" \
    --auth "$auth" \
    --public-url "$public_url" \
    --allowed-origin "$public_url" \
    "$@"

# Comma or whitespace separated; the public URL is always allowed.
for origin in $(printf '%s' "${TABULARIS_ALLOWED_ORIGINS:-}" | tr ',' ' '); do
    origin="${origin%/}"
    [ "$origin" = "$public_url" ] || set -- "$@" --allowed-origin "$origin"
done
for proxy in $(printf '%s' "${TABULARIS_TRUSTED_PROXIES:-}" | tr ',' ' '); do
    set -- "$@" --trusted-proxy "$proxy"
done
for root in $(printf '%s' "${TABULARIS_SERVER_FILE_ROOTS:-}" | tr ',' ' '); do
    set -- "$@" --server-file-browser-root "$root"
done
if is_true "${TABULARIS_ALLOW_HIGH_RISK:-false}"; then
    set -- "$@" --allow-high-risk
fi
if is_true "${TABULARIS_DEBUG:-false}"; then
    set -- "$@" --debug
fi

echo "tabularis: serving $public_url (auth: $auth)" >&2
exec tabularis "$@"
