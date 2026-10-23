#!/bin/sh
# Starts an image the way the docs do and checks health, the SPA shell, a
# password login and that the encrypted secret store survives a restart.
#   docker/smoke-test.sh ghcr.io/tabularisdb/tabularis:latest
set -eu

image="$1"
name="tabularis-smoke-$$"
volume="$name-data"
port="${SMOKE_PORT:-18080}"
base="http://localhost:$port"
password="smoke-test-password"
jar="$(mktemp)"

cleanup() {
    status=$?
    if [ "$status" -ne 0 ]; then docker logs "$name" 2>&1 | tail -50 || true; fi
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker volume rm "$volume" >/dev/null 2>&1 || true
    rm -f "$jar"
    exit "$status"
}
trap cleanup EXIT

wait_healthy() {
    i=0
    until [ "$(docker inspect -f '{{.State.Health.Status}}' "$name")" = healthy ]; do
        i=$((i + 1))
        [ "$i" -le 60 ] || fail "container did not become healthy"
        sleep 1
    done
}

check() {
    echo "ok - $1"
}

fail() {
    echo "not ok - $1" >&2
    exit 1
}

docker run -d --name "$name" \
    -p "127.0.0.1:$port:8080" \
    -e TABULARIS_PUBLIC_URL="$base" \
    -e TABULARIS_WEB_PASSWORD="$password" \
    -v "$volume:/data" \
    "$image" >/dev/null
wait_healthy
check "healthy"

location="$(curl -sS -o /dev/null -w '%{redirect_url}' "$base/")"
[ "$location" = "$base/login" ] || fail "redirects to the login page (got '$location')"
curl -fsS "$base/login" | grep -q 'name="password"' || fail "serves the login page"
check "redirects anonymous visitors to the login page"

code="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: attacker.invalid' "$base/healthz")"
[ "$code" = 403 ] || fail "rejects foreign Host headers (got $code)"
check "rejects foreign Host headers"

headers="$(curl -sS -D - -o /dev/null -c "$jar" \
    -H "Origin: $base" --data-urlencode "password=$password" "$base/api/v1/auth/login")"
printf '%s' "$headers" | grep -qi '^location: /' || fail "password login"
check "password login"
if printf '%s' "$headers" | grep -i '^set-cookie:' | grep -qi 'secure'; then
    fail "loopback HTTP login must not set a Secure cookie"
fi
curl -fsS -b "$jar" "$base/api/v1/session" >/dev/null || fail "session is valid"
check "session is valid"
curl -fsS -b "$jar" "$base/" | grep -q '<div id="root"' || fail "serves the web UI"
check "serves the web UI after login"

docker exec "$name" test -s /data/secrets.enc.json || fail "secret store created"
check "secret store created"
docker restart "$name" >/dev/null
wait_healthy
check "restarts with the existing secret store"
