# Design: Migrating users from the builtin PostgreSQL driver to the plugin

> Scratch design doc for branch `postgres-plugin-force-install`. Delete
> before opening the PR.

## Summary

Tabularis ships a builtin `postgres` driver and a standalone plugin
(`TabularisDB/tabularis-postgresql-plugin`, driver id `postgresql`) that is
now the source of truth for Postgres support — the in-tree driver was
extracted into the plugin in `4149839f`. Plugin adoption is low. This doc
designs an interim step ahead of the builtin's eventual removal: install
the plugin for any user who already has a connection that needs it, make
the builtin's deprecated status visible everywhere it appears, and give
users a low-friction, reversible path to move their existing connections
onto the plugin — without ever forcing the migration in this iteration or
removing the builtin outright.

## Background

The postgres plugin is maintained by the same team as the builtin driver,
so functional gaps between them are bugs to close, not permanent platform
differences to design around. The plan below treats every capability gap
and migration failure it detects as a forcing function for plugin parity —
each one becomes a tracked issue in the plugin repo, not a silent
exception.

This is also the first of several planned deprecations — mysql and sqlite
builtins are expected to follow the same path later. The design is written
driver-agnostic wherever that costs nothing extra, so the next deprecation
is a matter of adding a driver-id pair to a couple of lists, not repeating
this design.

## Goals

1. Any user with an existing builtin-postgres connection gets the
   `postgresql` plugin installed automatically, so it's ready before
   they're asked to migrate anything. Users with no Postgres connections
   at all aren't affected — this avoids bloating installs with drivers
   nobody needs, the same principle already behind treating plugins as
   separate from the app in the first place.
2. Those users are shown a clear, low-pressure path to migrate their
   existing connections to the plugin.
3. New connections are steered toward the plugin by default.
4. Migrating is reversible and safe: a bad outcome is a one-click Undo,
   not a support ticket.
5. Any friction the migration surfaces — a failed connection, a missing
   capability — becomes a pre-filled, reviewable GitHub issue in the
   plugin repo, not a dead end.
6. The opt-in migration flow here is step one. A later, separate decision
   can flip migration from opt-in to forced, per builtin driver, once
   there's real adoption/quality signal to justify it (see
   [Staging toward forced migration](#staging-toward-forced-migration)).

## Non-goals

- Removing or disabling the builtin driver.
- Forcing migration in this iteration — every migration here requires
  explicit user confirmation. A future, separately-decided switch to
  forced migration is designed below, but not enabled by this design.
- Installing the plugin for users who have no need for it yet.
- Adding telemetry or usage tracking (see [Measuring adoption](#measuring-adoption)).

## Design

### Installing the plugin when it's needed

The plugin is installed only when triggered by an existing need, not
unconditionally for every user — a user with no Postgres connections at
all never gets it installed. This follows an already-shipped precedent in
this codebase: `NewConnectionModal.tsx` (line ~291) already installs a
driver on the fly, right before connecting, if the user picks one that
isn't installed yet. The trigger here is the same idea applied to existing
connections instead of a new-connection pick: on launch, if at least one
saved connection has `params.driver == "postgres"` (builtin), the app
ensures the `postgresql` plugin is installed before offering to migrate
anything.

This runs as a background async task spawned from `src-tauri/src/lib.rs`'s
`setup()` closure, right after the existing plugin-loading block
(`plugins::manager::load_plugins(...)`, ~line 276) — spawned via
`tauri::async_runtime::spawn`, not `block_on`, so a slow or failed
registry fetch never delays window creation. This mirrors the existing
health-check-ping-loop spawn a few lines below it.

```rust
{
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        plugins::force_install::ensure_plugin_installed_if_needed(
            &handle, "postgres", "postgresql",
        ).await;
    });
}
```

A new module, `src-tauri/src/plugins/force_install.rs`, checks for a
triggering connection before installing:

```rust
pub async fn ensure_plugin_installed_if_needed(
    app: &AppHandle,
    builtin_id: &str,
    plugin_id: &str,
) {
    match connections_use_driver(app, builtin_id) {
        Ok(false) => return, // nothing on this builtin driver, nothing to do
        Ok(true) => {}
        Err(e) => {
            log::warn!("[force-install] could not read connections: {e}");
            return;
        }
    }
    ensure_plugin_installed(app, plugin_id).await;
}

pub async fn ensure_plugin_installed(app: &AppHandle, plugin_id: &str) {
    match installer::list_installed() {
        Ok(installed) if installed.iter().any(|p| p.id == plugin_id) => return,
        Ok(_) => {}
        Err(e) => {
            log::warn!("[force-install] could not list installed plugins: {e}");
            return;
        }
    }
    if !plugin_compatible_with_this_app(plugin_id).await {
        log::warn!(
            "[force-install] {plugin_id} has no compatible release, skipping"
        );
        return;
    }
    if let Err(e) =
        commands::install_plugin(app.clone(), plugin_id.to_string(), None).await
    {
        log::warn!("[force-install] {plugin_id} install failed: {e}");
    }
}
```

`ensure_plugin_installed_if_needed` and `ensure_plugin_installed` both
take driver ids as parameters rather than hardcoding postgres, so future
deprecations add a call, not a new function. Which builtin/plugin pairs
this applies to is a small static list, `MIGRATABLE_DRIVERS: &[(&str, &str)]`
of `(builtin_id, plugin_id)` pairs — one line per future deprecation.
`connections_use_driver` reuses the same connection-reading path
`get_connections` already uses (`commands.rs:1432`) — no new persistence
code.

This reuses `install_plugin` (`src-tauri/src/plugins/commands.rs:153`)
as-is: it already resolves the latest version via Tabularium, verifies
sha256, downloads, and hot-registers the driver. No new download or verify
code is needed.

**Version compatibility.** `install_plugin` doesn't currently check a
release's `min_tabularis_version` before installing — that field exists on
the manifest but today is used only to inform a human choosing a version
manually (`RegistryReleaseWithStatus.min_tabularis_version`). Left as-is,
an unattended install could silently install a plugin release that
requires a newer Tabularis than the user is running, leaving them
installed-but-non-functional with no explanation. `plugin_compatible_with_this_app`
closes this gap by checking the latest release's `min_tabularis_version`
against the running app's own version (`env!("CARGO_PKG_VERSION")`) using
the same semver comparison `classify_install` already implements
(`registry.rs:43`, reused rather than reimplemented). An incompatible
release is skipped for this launch and retried on the next one — the same
posture as any other install failure below.

**Failure behavior.** Every failure path — can't read connections, can't
list installed plugins, incompatible version, install itself fails —
logs via `log::warn!` and returns silently; there's no UI-visible error
and no retry loop within a single launch. The check re-runs from scratch
on every launch, so a transient failure (network blip, temporary
incompatibility) self-heals on its own without any additional state to
manage.

**Disclosure.** Installing a plugin with no visible trace is a trust
problem as well as a UX one — it runs as a subprocess with its own code on
the user's machine. Rather than building new UI for this, the release's
`WhatsNewModal` changelog entry gets one line: "Existing PostgreSQL
connections now get the new plugin installed automatically — see Settings
→ Plugins." That's enough for a user who notices or goes looking to find
an explanation, without a dedicated notification.

**Reinstall after manual uninstall.** If a user with a builtin-postgres
connection uninstalls the plugin, the trigger condition (a builtin-postgres
connection exists) is still true, so it installs again on the next launch —
there's no "user opted out" state tracked anywhere. That's consistent with
the same on-demand-install precedent this section is modeled on
(`NewConnectionModal.tsx`), but it should still be called out explicitly
in the PR description, since it's the piece of this design most likely to
surprise someone.

### Flagging the builtin as deprecated

Everything above only reaches existing users. Nothing stops someone from
creating a *new* builtin-postgres connection, which would immediately be
subject to the same eventual removal — undoing the migration effort in
real time. Closing this is as important as the migration flow itself.

`PluginManifest` (`src-tauri/src/drivers/driver_trait.rs`, mirrored in
`src/types/plugins.ts`) gains a `deprecated: Option<DeprecationInfo>` field,
where `DeprecationInfo` carries `{ replacementId, removalDate, removalVersion }`.
It's populated the same way as `MIGRATABLE_DRIVERS` — a small static
table, stamped onto the builtin's manifest at driver registration time in
`lib.rs` — not a registry round-trip, since this is an app-level decision
about the app's own builtins.

**Removal date: October 5, 2026 (tentative).** Stated explicitly rather
than left open, following the pattern used by every mature ecosystem that
handles deprecation well (Homebrew formula deprecation, VS Code extension
deprecation, npm's install-time warning, browser API deprecation notices —
all name a timeline and a replacement up front rather than leaving it
open-ended, since "no date yet" tends to read as "maybe never" and
undercuts the push). It's marked tentative everywhere it's shown, since
it isn't yet a committed release date, and gets revisited once real
migration data exists (see [Measuring adoption](#measuring-adoption)).

The deprecated badge appears consistently everywhere the builtin driver is
visible, since different users encounter it through different entry
points:

1. The connection-type picker (`NewConnectionModal.tsx`) — a small
   "Deprecated" badge on the builtin's entry, tooltip naming the
   replacement and timeline.
2. Settings → Plugins (`PluginsTab.tsx`) — the same badge, plus an "N of M
   connections migrated" indicator so a user with many connections has one
   place to see overall progress.
3. Every Connections-list row still on the builtin driver.
4. The connection's own edit/settings view.

Beyond badging, `connectionCatalogue.ts`'s existing `groupByEngine` (which
already groups the builtin and plugin entries for the same engine)
promotes the plugin entry to appear first within that group — so the path
of least resistance for a new connection is the plugin even for someone
who never reads a tooltip.

Because `deprecated` is a manifest field keyed by driver id, the mysql and
sqlite builtins' eventual deprecation is "set the field on that manifest,"
not new UI work.

### Migrating existing connections

For users with connections already on the builtin driver, the nudge to
migrate is a **dismissible banner**, not a modal. `App.tsx` already stacks
up to four launch-time modals (Update, Community, WhatsNew,
PluginInstallConfirm); a fifth recurring one for a non-blocking
recommendation would be a notification pile-up, and it's the wrong tool
for a decision that isn't required to proceed. This is the same
distinction JetBrains, VS Code, and GitHub draw between required
confirmations (modals) and recommendations (non-blocking, dismissible
banners that don't reappear every session).

The banner is triggered by at least one saved connection having
`params.driver == "postgres"` — checked frontend-side against data already
returned by `get_connections` (`commands.rs:1432`), no new backend command
needed. It's shown once: dismissing it sets a persisted setting,
`postgresPluginMigrationBannerDismissed`, and it only resurfaces if a new
builtin-postgres connection appears after that (the same
"did-the-condition-change" logic `WhatsNewModal` uses for its own
version-gating). There's no separate "don't show again" checkbox in
Settings — dismissing the banner is the opt-out.

Alongside the banner, a **persistent per-connection contextual action** —
"Switch to plugin" on each builtin-postgres row and its context menu —
gives the same migration path without any dismissal state, so the option
never disappears even after the banner is dismissed.

Both entry points share one hook, `useBuiltinDriverMigration(builtinId, pluginId)`
(a thin `useBuiltinPostgresMigration()` wrapper covers this rollout),
which owns connection detection, banner dismissal, and the migration
action itself.

**Before migrating, a lightweight inline confirm** — not a full modal —
states what's about to happen: "Switch `{connectionName}` to the
PostgreSQL plugin? If it's currently connected, it'll be disconnected and
reopened using the plugin." This guards against an accidental click on a
live connection; it's a different risk than the post-migration Undo below
covers (which recovers from a considered click that didn't pan out), so
both stay rather than one substituting for the other.

If the connection is currently open, it's disconnected automatically
before the driver flips — not offered as a separate opt-in toggle. This
reuses an existing, already-shipped pattern: `PluginsTab.tsx`'s
plugin-uninstall flow (line ~791) already calls
`findConnectionsForDrivers(openConnectionIds, connectionDataMap, [pluginId])`
and then `disconnect()` before removing a driver. The migration action
calls the same helper (`src/utils/connectionManager.ts:71`) against the
builtin `postgres` id first.

The migration itself is a call to the existing `update_connection`
command (`commands.rs:1123`) with `params.driver` flipped from `"postgres"`
to `"postgresql"` — no new backend command needed, since `update_connection`
already handles a driver change correctly (dropping keychain-stored
credentials that belonged to the old driver):

```ts
for (const conn of selectedConnections) {
  await invoke("update_connection", {
    ...conn,
    params: { ...conn.params, driver: "postgresql" },
  });
}
refreshConnections();
```

One thing to verify during implementation, not a design change: whether
any Postgres-specific `params` fields — `ssl_mode` spelling in particular,
which `connection_migrations.rs` already documents as differing between
the builtin's and the plugin's expected spellings — need translating
alongside the `driver` flip. Since that file already treats builtin
`"postgres"` as always using the correct (non-stale) spelling, and the
plugin expects the same hyphenated spelling, this should be a no-op; worth
a unit test regardless.

### Making migration reversible

`update_connection` already supports flipping the driver back, so nothing
new is needed on the backend for a mechanical revert. What matters is
making the user aware that the door is still open, at the moment they'd
need it.

Immediately after migrating, the app runs `test_connection`
(`commands.rs:2300`) against the connection using its new driver, before
declaring success. The result determines what the user sees next:

- **The connection test itself fails** (bad credentials, unreachable host,
  TLS mismatch — the same class of failure the builtin driver could hit
  too): "Couldn't connect to `{name}` using the plugin: `{error}`" with
  both **Undo** and **Report an issue**.
- **The plugin process never started** (missing/wrong interpreter, crash —
  detectable because `driver_registry::get_driver("postgresql")` returns
  `None`, or the plugin id shows up in `get_plugin_startup_errors()`,
  `manager.rs:25`): "The PostgreSQL plugin didn't start: `{startupError}`.
  This isn't specific to `{name}` — no connection was attempted." Also with
  Undo and Report an issue, but framed around the plugin, not the
  connection's credentials, since they were never the problem.

Both signals already exist in the codebase with no new plumbing — the
distinction is purely in which one the migration flow checks and how the
resulting message is worded. `buildPluginIssueUrl` (below) carries a
`failureMode: "process" | "connection"` field so the drafted issue
reflects which one actually happened.

When the test succeeds, a dismissible toast — "Switched `{name}` to the
PostgreSQL plugin. [Undo]" — confirms it, in the same spirit as an email
client's "Message sent — Undo." It stays visible until dismissed, and that
dismissal is persisted (a `toastDismissed` flag on the migration record
below), not session-only — otherwise a user who relaunches without
clicking dismiss would see it again on every single launch. Its lifetime
matters less than it might seem, though: the per-connection contextual
action becomes bidirectional once a connection is migrated — "Switch to
plugin" becomes "Switch back to builtin" — so nothing is actually lost
once the toast disappears; the toast is a courtesy nudge, not the only way
back.

Every migration is recorded — `{ connectionId, fromDriver, toDriver,
migratedAt, toastDismissed }` — in a new `Settings` field,
`driverMigrationHistory`, following the same
array-of-records shape `AppConfig` already uses for
`columnMaskingOverrides`/`schema_preferences`. Records are kept even after
an undo, so a filed issue has the actual before/after to attach, and a
future deprecation pass can see who already tried and bounced off a given
plugin.

### Staging toward forced migration

Everything above is opt-in: a user chooses to migrate, and can choose to
undo it. That's deliberate for this first release — it lets the plugin
prove itself against real, varied connections before anyone is migrated
without asking. But opt-in isn't the end state; the goal is still to get
everyone off the builtin driver eventually, and low opt-in uptake alone
shouldn't be treated as "done, ship it" — the plan is to revisit and
tighten this once there's real signal the plugin is ready.

That transition is modeled as a per-builtin-driver setting rather than a
single global switch, because postgres, mysql, and sqlite won't reach
"ready to force" on the same schedule — postgres could move to forced
migration while mysql's plugin is still opt-in and hasn't even started
generating its own adoption data. `AppConfig` gains
`migration_mode_by_driver: Option<HashMap<String, MigrationMode>>` (Rust)
/ `migrationModeByDriver?: Record<string, "opt-in" | "forced">` (TS),
keyed by builtin driver id, every entry defaulting to `"opt-in"` if unset.
`useBuiltinDriverMigration(builtinId, pluginId)` reads its own driver's
entry from this map, so flipping postgres to `"forced"` has no effect on
any other driver's migration flow.

**What "forced" changes, precisely — and what it doesn't.** Forced mode
skips the inline confirm dialog before migrating (the "guard against an
accidental click" mechanic from the previous section is unnecessary once
the app itself decides to migrate, not the user), and it may migrate
proactively rather than waiting for a banner click. Forced mode does
**not** skip the post-migration `test_connection` check or the Undo toast
— those are a safety net, not a consent mechanic, and matter more, not
less, once the user didn't personally choose the timing. Turning "forced"
into "no confirm, no test, no undo, just flip the driver and hope" would
recreate exactly the silent-failure risk the reversibility design above
exists to prevent — worse here, since the user never opted in to begin
with.

This isn't built in this iteration — `migrationModeByDriver` is designed
now, defaults to `opt-in` everywhere, and the actual decision to flip
postgres to `forced` is a separate, later call, gated on the same
adoption/quality signals that revisit the tentative removal date (see
[Measuring adoption](#measuring-adoption)) — not a fixed timer or an
arbitrary toggle flipped without that evidence.

### Turning failures into GitHub issues

The person best positioned to report a plugin bug is the one who just hit
it, with the connection and error still on screen — not someone
reconstructing it later from memory in a bare issue form. The app already
has everything an issue needs: driver id, plugin version, OS, app version,
the exact error. The only missing piece is a bridge from "I hit this" to a
correctly filled-out issue in the *plugin's own repo* — which is also
where its maintainers actually triage reports, and the reason the plugin
was split into its own repo in the first place.

This is built without any new telemetry or auto-collection, and without
relying on GitHub's plain `issues/new?title=&body=` prefill — that
mechanism only prefills a single free-text body, has no way to enforce
that a report actually contains what's needed, and stops working outright
on any repo with an issue-template chooser configured. Instead, the plugin
repo ships **GitHub Issue Forms**
(`.github/ISSUE_TEMPLATE/migration-failure.yml` and `capability-gap.yml`,
plus a third general-purpose form covered below — structured YAML forms,
not the old markdown templates), each with named, typed fields — a
required `error` textarea, a `failure_mode` dropdown,
`plugin_version`/`app_version`/`os` inputs — and a label already set in
the form's own frontmatter, so labels apply automatically instead of
depending on a `labels=` query param.

A shared helper, `src/utils/pluginIssueReport.ts`, exposes
`buildPluginIssueUrl({ pluginId, pluginVersion, repoUrl, appVersion, os,
failureMode, context })`, which builds a
`github.com/<org>/<repo>/issues/new?template=migration-failure.yml&plugin_version=...&error=...`
URL — GitHub's query-param prefill targets a specific form's fields by
their `id`, not a raw body string — and opens it with the existing
`openUrl` from `@tauri-apps/plugin-opener` (already used for exactly this
in `InfoTab.tsx`/`SocialLinks.tsx`). `repoUrl` comes from the plugin's own
registry manifest (`RegistryPluginWithStatus.repo_url`, already fetched by
`useDrivers`, `registry.rs:93` → `types/plugins.ts:133`), so no new
backend field is needed. The user lands on the pre-filled form on GitHub's
own page, reviews it, and submits it themselves — the app assembles a
draft, nothing is sent on the user's behalf, the same trust model as a
`mailto:` link.

Only a fixed, named set of fields is ever interpolated into the URL —
plugin id/version, app version, OS, the specific error, which driver the
connection came from — never a raw `params` object. That's a deliberate
constraint, not an oversight: there's no code path by which a credential
or connection string can end up in a public issue.

Filing an issue this way still requires the user to have and be signed
into a GitHub account — GitHub has no anonymous issue-creation path, and
building one (a hosted proxy holding a bot token with `issues:write`)
would be new infrastructure disproportionate to this feature and
inconsistent with the no-new-backend approach used everywhere else in
this design. That's an accepted constraint, not a gap to solve here. A
logged-out user who clicks "Report an issue" is redirected to GitHub's
login page first — confirmed hands-on that the prefilled query string
survives that round-trip via GitHub's `return_to` mechanism, so they land
back on the same pre-filled form after signing in, not a blank one.

Two entry points surface "Report an issue": right next to Undo on a
failed post-migration test (above), targeting `migration-failure.yml`; and
a standing "Report a plugin issue" link on the plugin's own Settings page
(`PluginSettingsPage.tsx`) for problems found later, unrelated to the
migration moment itself. That link targets a third, general-purpose
template, `bug_report.yml` — `migration-failure.yml`'s fields
(`failure_mode`, `migrated_from_driver`) only make sense mid-migration, so
a generic bug needs its own form rather than a forced fit into either
migration-specific template.

### Feature-parity gaps

A connection that uses a builtin-only capability — SSH tunneling, IAM
auth, Kubernetes port-forwarding — shouldn't be silently excluded from
migration forever. Since the plugin is maintained by the same team as the
builtin, a capability gap is a bug to fix, not a permanent platform
difference to design around.

Before offering to migrate a connection, a pure function,
`findUnsupportedFeatures(connection, pluginManifest)`, compares what the
connection actually uses against the plugin's declared
`DriverCapabilities` (`driver_trait.rs:45`). A connection with an
unsupported feature stays **unchecked by default** in the migration
checklist — the safety property from the original design is unchanged —
but it's still shown, with the specific gap named inline ("uses IAM
auth — not yet supported by the plugin") and a "Report this gap" action
next to it.

That action uses the same `buildPluginIssueUrl` helper, targeting the
`capability-gap.yml` form instead, and the fact that it was reported is
recorded locally (a `knownCapabilityGaps: Record<pluginId, string[]>` map)
so the same user isn't prompted to re-report a gap already filed.

No separate parity checklist needs to be maintained in the plugin repo —
its own test suite is the checklist, and the builtin-vs-plugin capability
diff already runs as part of every plugin release. A builtin capability
without a corresponding test in the plugin *is* the gap; closing it is
ordinary TDD work, add the test and make it pass. What that existing
release-time diff turns up should get filed as real issues in
`tabularis-postgresql-plugin`, using the `capability-gap` template, so the
migration flow's exclusion list reflects tracked issues rather than an
untracked known-gaps list. (Tracking issue for the Issue Form templates
and labels:
[tabularis-postgresql-plugin#56](https://github.com/TabularisDB/tabularis-postgresql-plugin/issues/56).)
The intent is for the "unchecked by default" list to shrink release over
release as the plugin catches up — a temporary state, not a permanent
exception list.

### Generalizing to future driver deprecations

Every piece above takes a driver-id parameter rather than hardcoding
postgres, so the mysql and sqlite deprecations later are additive, not a
redesign:

- `force_install.rs`'s `MIGRATABLE_DRIVERS` list gains a
  `(builtin_id, plugin_id)` pair.
- `useBuiltinDriverMigration(builtinId, pluginId)` gets a new call site;
  the banner, contextual action, rollback toast, and issue helper all
  already key off that pair, not a string literal.
- `deprecated` on `PluginManifest`, `driverMigrationHistory`'s
  `fromDriver`/`toDriver` fields, and `migrationModeByDriver`'s keys are
  already generic.
- `pluginIssueReport.ts` takes a plugin id/repo/version and nothing else —
  it's directly reusable, and arguably useful as a general "report a
  plugin issue" feature independent of any deprecation.

Shipping the next one becomes: add one list entry, one banner trigger
condition, and new copy — not another design pass.

### Measuring adoption

No new telemetry is added — this repo has none today, and introducing
first-run usage tracking would be a much bigger decision than this feature
warrants. Adoption is instead read from signals that already exist: the
Tabularium registry's download counter (`tracked_download_url`/
`tracked_latest_download_url`, `commands.rs:141-147`) already increments
on every `install_plugin` call, including the on-demand installs from this
flow; and issue volume under the `migration`/`capability-gap` labels in
the plugin repo serves as a proxy for both uptake and friction. These
same signals are what a later decision to flip a given driver's
`migrationModeByDriver` entry to `forced` (above) should be based on,
along with the tentative removal date — neither is firmed up on a fixed
timer, only once real data justifies it.

## Draft copy

Non-final; refine during implementation or PR review. The constraints that
matter more than the exact words: name the replacement, name the timeline
as tentative, never sound punitive, and always pair a failure state with
an Undo or Report action.

**Migration banner** (Connections list, dismissible):
> **Try the new PostgreSQL plugin** — the builtin PostgreSQL driver is
> being retired (tentatively Oct 5, 2026). The plugin has the same
> features and gets updates faster. [Review connections] [×]

**Deprecated badge** (connection-type picker, Settings → Plugins,
Connections row), small tag, not alarming red:
> `Deprecated`
> Tooltip: "This built-in driver is being replaced by the PostgreSQL
> plugin, tentatively by Oct 5, 2026. [Switch to plugin]"

**Per-connection contextual action** (row-level, bidirectional):
> Not yet migrated: `Switch to plugin`
> Already migrated: `Switch back to builtin`

**Migration confirm** (inline, before calling `update_connection`):
> Switch `prod-analytics-db` to the PostgreSQL plugin? If it's currently
> connected, it'll be disconnected and reopened using the plugin.
> [Cancel] [Switch]

**Migration checklist item, unsupported feature:**
> ☐ `prod-analytics-db` — uses SSH tunneling, not yet supported by the
> plugin. [Report this gap]
> *(unchecked, greyed if "select all" is used; the report action stays
> active either way)*

**Post-migration success toast** (persists until dismissed):
> Switched `prod-analytics-db` to the PostgreSQL plugin. [Undo]

**Post-migration failure — connection-level:**
> Couldn't connect to `prod-analytics-db` using the plugin: *{error}*
> [Undo] [Report an issue]

**Post-migration failure — process-level:**
> The PostgreSQL plugin didn't start: *{startupError}*. This isn't
> specific to `prod-analytics-db` — no connection was attempted.
> [Undo] [Report an issue]

**Issue Form prefill — migration failure** (targets
`migration-failure.yml`, connection-level example):
> `github.com/TabularisDB/tabularis-postgresql-plugin/issues/new?template=migration-failure.yml&failure_mode=connection&plugin_version={pluginVersion}&app_version={appVersion}&os={os}&migrated_from_driver=postgres&error={error}`
>
> Renders as a form with those fields already filled in; `error` and
> `failure_mode` are required, so the user can't submit without them.

**Issue Form prefill — capability gap** (targets `capability-gap.yml`):
> `github.com/TabularisDB/tabularis-postgresql-plugin/issues/new?template=capability-gap.yml&feature={feature}&plugin_version={pluginVersion}&app_version={appVersion}`

## Implementation summary

**Rust:**

- `src-tauri/src/plugins/force_install.rs` (new) —
  `ensure_plugin_installed_if_needed(app, builtin_id, plugin_id)` and
  `ensure_plugin_installed(app, plugin_id)`,
  driven by a `MIGRATABLE_DRIVERS` list of `(builtin_id, plugin_id)`
  pairs; includes the `min_tabularis_version` compatibility check
- `src-tauri/src/lib.rs` — spawn the install-if-needed call(s) in
  `setup()`; stamp `deprecated` onto builtin manifests at driver registration
- `src-tauri/src/config.rs` — new `postgres_plugin_migration_banner_dismissed`,
  `driver_migration_history: Option<Vec<DriverMigrationRecord>>`,
  `known_capability_gaps: Option<HashMap<String, Vec<String>>>`, and
  `migration_mode_by_driver: Option<HashMap<String, MigrationMode>>` fields
  (all generic, none postgres-specific)
- `src-tauri/src/drivers/driver_trait.rs` — `deprecated: Option<DeprecationInfo>`
  on `PluginManifest`

**TypeScript:**

- `src/contexts/SettingsContext.ts` — the four new settings fields above + defaults
- `src/types/plugins.ts` — `deprecated` field on the manifest type
- `src/hooks/useBuiltinDriverMigration.ts` (new, parameterized by
  `(builtinId, pluginId)`) — detection, dismissal, migration, and
  rollback-toast state; a thin postgres-specific wrapper covers this rollout
- `src/utils/findUnsupportedFeatures.ts` (new) — pure comparison of a
  connection's used params against a plugin's declared `DriverCapabilities`
- `src/utils/pluginIssueReport.ts` (new) — `buildPluginIssueUrl(...)`,
  driver-agnostic, targets a plugin's Issue Form templates
  (`migration-failure.yml`, `capability-gap.yml`, `bug_report.yml`) by
  field id rather than assembling a free-text body
- `src/components/banners/PostgresPluginMigrationBanner.tsx` (new)
- `src/pages/Connections.tsx` — render the banner inline
- Connections list row / context menu — bidirectional "Switch to plugin" /
  "Switch back to builtin" action, plus the deprecated badge on builtin rows
- `src/components/modals/NewConnectionModal.tsx` — deprecated badge on the
  builtin's picker entry
- `src/utils/connectionCatalogue.ts` — promote the non-deprecated entry
  first within an engine group
- `src/components/settings/PluginsTab.tsx` — deprecated badge + "N of M
  connections migrated" indicator
- `src/components/settings/PluginSettingsPage.tsx` — "Report a plugin issue" link
- `src/components/modals/WhatsNewModal` changelog content — one line
  disclosing the auto-install (release notes only, no code change)
- Migration confirm's auto-disconnect reuses the existing
  `findConnectionsForDrivers` + `disconnect()` (`src/utils/connectionManager.ts:71`)
  — a new call site, not a new helper

## Verification plan

- Rust unit tests for `ensure_plugin_installed_if_needed`: no triggering
  connection is a no-op (install never called), a triggering connection
  present calls through to `ensure_plugin_installed`. Rust unit tests for
  `ensure_plugin_installed` itself: already-installed is a no-op,
  not-installed calls install, and an incompatible `min_tabularis_version`
  skips the install (mock/stub `installer::list_installed`).
- Frontend test for `findUnsupportedFeatures`: flags SSH/IAM/k8s-using
  connections against a manifest missing those capabilities, and returns
  empty for a fully-covered connection.
- Frontend test for `useBuiltinDriverMigration`'s gating: dismissed
  setting, empty vs. non-empty connection list, banner reappearing only
  when a new builtin connection of that type is added post-dismissal.
- Frontend test for `buildPluginIssueUrl`: confirms the generated URL
  never contains connection params beyond the explicitly listed fields,
  and that it targets the correct template (`migration-failure.yml`,
  `capability-gap.yml`, or `bug_report.yml`) for each call site — a
  security-relevant test, not just a happy-path one.
- Manual, full lifecycle:
  1. Fresh app data dir, no Postgres connections → launch → the
     `postgresql` plugin is **not** installed; nothing in Settings →
     Plugins changes.
  2. Add a builtin-postgres connection → relaunch → the `postgresql`
     plugin is now installed automatically, and the release's WhatsNew
     entry mentions it. The banner appears in Connections (not a modal)
     → dismiss it → relaunch → it stays dismissed.
  3. Use the per-connection action to migrate one connection → it flips
     driver in `connections.json`, runs a post-migration `test_connection`,
     and shows the "Switched — Undo" toast.
  4. Click Undo → the driver flips back and the row's action reverts to
     "Switch to plugin".
  5. Migrate again against an unreachable host → the failure state offers
     both Undo and Report an issue, and Report opens the
     `migration-failure.yml` Issue Form on
     `TabularisDB/tabularis-postgresql-plugin` with its fields already
     filled in and no credentials anywhere in the URL or form.
  6. Open the connection-type picker for a new connection → the builtin
     postgres entry shows the deprecated badge, the plugin entry appears
     first in the group, and the tooltip names the replacement and timeline.
  7. Create a connection with SSH tunneling on the builtin driver → open
     the migration checklist → it's shown unchecked by default with the
     specific gap named, and "Report this gap" opens the
     `capability-gap.yml` Issue Form, distinct from the migration-failure one.
  8. While signed out of GitHub in the browser, click "Report an issue" →
     the login redirect lands back on the pre-filled form with fields
     intact, not a blank one — confirmed via GitHub's `return_to`
     mechanism, which preserves the full original query string through
     the login round-trip.

## Follow-ups

- Firm up (or deliberately push) the October 5, 2026 tentative removal
  date into a committed date/version, once the signals in
  [Measuring adoption](#measuring-adoption) show real migration uptake.
- Decide when (and whether) to flip `migrationModeByDriver["postgres"]`
  from `opt-in` to `forced` — a separate, later decision gated on the same
  adoption signals, not part of this iteration's scope (see
  [Staging toward forced migration](#staging-toward-forced-migration)).
- Refine the draft copy above during implementation or PR review.
- Filing an issue this way requires a GitHub account — there is no
  anonymous path, and a hosted proxy to work around that was considered
  and deliberately not pursued (see the design section above). Revisit
  only if this turns out to be a real adoption blocker in practice.
