# syntax=docker/dockerfile:1.7
#
# Tabularis Web as a container image:
#   docker build -f docker/Dockerfile -t tabularis .
#
# The server is built without the desktop app, so the image carries no GUI
# libraries. Debian rather than Alpine: registry driver plugins are glibc
# binaries and do not run on musl, not even through gcompat.

ARG NODE_VERSION=24.18.0
ARG DEBIAN_VERSION=trixie

# ── Frontend: platform independent, built once on the build host ───────────
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS web-ui
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch --frozen-lockfile
COPY roadmap.json ./
COPY packages ./packages
COPY plugins/manifest.schema.json ./plugins/manifest.schema.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline \
    && pnpm build

# ── Server ───────────────────────────────────────────────────────────────────
# Built without the `desktop` feature: no Tauri, GTK or WebKitGTK, only the
# `tabularis web` and `--mcp` entry points.
FROM rust:1-${DEBIAN_VERSION} AS server
ARG TABULARIS_BUILD_COMMIT=
RUN apt-get update \
    && apt-get install -y --no-install-recommends libdbus-1-dev pkg-config perl make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# JSON schemas and themes the crate embeds from outside src-tauri.
COPY plugins/manifest.schema.json ./plugins/manifest.schema.json
COPY packages/web-ui/src/schemas ./packages/web-ui/src/schemas
COPY packages/web-ui/src/themes ./packages/web-ui/src/themes
COPY src-tauri ./src-tauri
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-target,target=/src/src-tauri/target \
    cd src-tauri \
    && cargo build --release --locked --no-default-features --bin tabularis \
    && install -Dm755 target/release/tabularis /out/tabularis


# ── Runtime ──────────────────────────────────────────────────────────────────
FROM debian:${DEBIAN_VERSION}-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl tini openssh-client libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --user-group --home-dir /data --no-create-home tabularis \
    && install -d -o 10001 -g 10001 -m 0750 /data
COPY --from=server /out/tabularis /usr/bin/tabularis
RUN tabularis --help >/dev/null
COPY --from=web-ui /src/packages/web-ui/dist /usr/lib/tabularis/web-ui
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV HOME=/data \
    TABULARIS_DATA_DIR=/data \
    TABULARIS_SECRET_STORE=file \
    TABULARIS_PORT=8080
USER 10001:10001
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["docker-entrypoint.sh", "healthcheck"]
ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]
CMD ["web"]
