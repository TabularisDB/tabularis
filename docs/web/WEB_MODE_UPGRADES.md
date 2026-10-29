# Upgrading a Tabularis Web server

Tabularis Web deliberately does not let a browser replace or restart the server binary. Server upgrades are an administrator operation and must use the same installation or deployment method that installed Tabularis.

## Before upgrading

1. Open **Settings → Info → Updates** and record the displayed server version and build information.
2. Review the target release and its notes on the [Tabularis Releases page](https://github.com/TabularisDB/tabularis/releases).
3. Back up the Tabularis configuration and data directories according to your deployment policy.
4. Record the server's launch arguments, service configuration, user account, and data-directory overrides.

## Upgrade procedure

1. Stop accepting new browser sessions.
2. Stop the `tabularis web` process or its service manager unit.
3. Upgrade Tabularis through the original installation method. For a package-managed installation, use that package manager. For a directly installed release, replace it with the matching release artifact.
4. Start `tabularis web` with the same service account, data locations, and arguments.
5. Reopen the Web UI and verify that **Settings → Info → Updates** reports the expected server version and build.
6. Run a connection and read-only query smoke test before restoring normal access.

The browser UI bundle is served by the Tabularis process, so restarting the upgraded server also serves the matching UI. Do not copy a frontend bundle from a different release onto the server.

## Rollback

If verification fails, stop the server, restore the previous Tabularis installation and any deployment files changed during the upgrade, then restart it with the original configuration. Preserve the failed server logs for diagnosis. Data migrations and release-specific rollback notes, when applicable, are documented in the corresponding release notes.

## Build identifiers

The Web UI reports the server version, target platform, build profile, and an optional source commit. Release automation can set `TABULARIS_BUILD_COMMIT` while compiling to include the source commit in session negotiation and the Info screen.
