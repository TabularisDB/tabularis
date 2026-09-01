/**
 * Bridge from "I hit a plugin problem" to a correctly pre-filled GitHub Issue
 * Form in the plugin's own repo.
 *
 * The plugin repo ships structured YAML Issue Forms (not the old markdown
 * templates): `migration-failure.yml`, `capability-gap.yml`, and
 * `bug_report.yml`. GitHub's query-param prefill targets a specific form's
 * fields by their `id`, which enforces that a report contains the named
 * fields it needs — unlike the plain `issues/new?title=&body=` mechanism,
 * which only prefills a single free-text body and breaks on repos with an
 * issue-template chooser.
 *
 * `buildPluginIssueUrl` assembles the URL; the caller opens it with
 * `openUrl` from `@tauri-apps/plugin-opener`. The app assembles a draft and
 * nothing is sent on the user's behalf — the same trust model as a
 * `mailto:` link. The user lands on the pre-filled form on GitHub's own page,
 * reviews it, and submits it themselves.
 *
 * Security constraint: only a fixed, named set of fields is ever interpolated
 * into the URL — plugin id/version, app version, OS, the specific error, which
 * driver the connection came from. Never a raw `params` object. There is no
 * code path here by which a credential or connection string can end up in a
 * public issue.
 */

/** Which Issue Form template to target. Each maps to a `.yml` file in the
 * plugin repo's `.github/ISSUE_TEMPLATE/` directory. */
export type IssueTemplate = "migration-failure" | "capability-gap" | "bug-report";

/** Which kind of migration failure happened, for the `migration-failure`
 * form's `failure_mode` dropdown. */
export type FailureMode = "process" | "connection";

/** Inputs to `buildPluginIssueUrl`. `repoUrl` is the plugin's own repository
 * URL (e.g. "https://github.com/TabularisDB/tabularis-postgresql-plugin"),
 * resolved from the registry catalogue, not from the driver manifest. */
export interface BuildPluginIssueUrlInput {
  /** Plugin id (e.g. "postgresql"). */
  pluginId: string;
  /** Installed plugin version, for the `plugin_version` field. */
  pluginVersion: string;
  /** Plugin repository URL, the base of the new-issue link. */
  repoUrl: string;
  /** Running app version, for the `app_version` field. */
  appVersion: string;
  /** Operating system string, for the `os` field. */
  os: string;
  /** Which Issue Form template to target. */
  template: IssueTemplate;
  /** Required for `migration-failure`: which kind of failure. */
  failureMode?: FailureMode;
  /** Required for `migration-failure`: the exact error message. */
  error?: string;
  /** Required for `migration-failure`: the built-in driver migrated from. */
  migratedFromDriver?: string;
  /** Required for `capability-gap`: the feature name with the gap. */
  feature?: string;
}

/**
 * Build a `github.com/<org>/<repo>/issues/new?template=<form>.yml&<field>=…`
 * URL targeting a specific Issue Form by field id.
 *
 * Pure: returns the URL string only. Opening it (via `openUrl`) is the
 * caller's job, so this stays unit-testable without a browser/opener.
 *
 * @throws if a required field for the chosen template is missing — better to
 *   fail loudly here than to hand GitHub a malformed, un-submittable form.
 */
/**
 * Known repo URLs for first-party plugins, used only as a fallback when the
 * live registry lookup can't resolve one (e.g. the Tabularium API is
 * unreachable but the plugin's repo location is stable and well-known).
 * Registry data always wins when available — this only fills the gap so
 * that an unrelated outage (the registry API) doesn't silently disable
 * "Report an issue" for a plugin whose repo never moves.
 */
const KNOWN_PLUGIN_REPOS: Record<string, string> = {
  postgresql: "https://github.com/TabularisDB/tabularis-postgresql-plugin",
};

/**
 * Resolve a plugin's repo URL, preferring the live registry entry and
 * falling back to `KNOWN_PLUGIN_REPOS` when the registry didn't provide one.
 */
export function resolvePluginRepoUrl(
  pluginId: string,
  registryRepoUrl: string | null | undefined,
): string | undefined {
  return registryRepoUrl ?? KNOWN_PLUGIN_REPOS[pluginId];
}

export function buildPluginIssueUrl(input: BuildPluginIssueUrlInput): string {
  const {
    pluginId,
    pluginVersion,
    repoUrl,
    appVersion,
    os,
    template,
    failureMode,
    error,
    migratedFromDriver,
    feature,
  } = input;

  // Validate required-per-template fields up front. A migration-failure form
  // with no error isn't submittable; a capability-gap with no feature isn't
  // meaningful. Fail closed.
  if (template === "migration-failure") {
    if (!error || error.trim() === "") {
      throw new Error("buildPluginIssueUrl: error is required for migration-failure");
    }
    if (!failureMode) {
      throw new Error("buildPluginIssueUrl: failureMode is required for migration-failure");
    }
    if (!migratedFromDriver) {
      throw new Error(
        "buildPluginIssueUrl: migratedFromDriver is required for migration-failure",
      );
    }
  }
  if (template === "capability-gap" && (!feature || feature.trim() === "")) {
    throw new Error("buildPluginIssueUrl: feature is required for capability-gap");
  }

  // Fixed field set: only these named values are ever interpolated. Adding a
  // field here is a deliberate decision — never pass a raw params object.
  const params = new URLSearchParams();
  params.set("template", `${template}.yml`);
  params.set("plugin_id", pluginId);
  params.set("plugin_version", pluginVersion);
  params.set("app_version", appVersion);
  params.set("os", os);

  if (template === "migration-failure") {
    // failureMode, migratedFromDriver, error are all defined here (validated above).
    params.set("failure_mode", failureMode as FailureMode);
    params.set("migrated_from_driver", migratedFromDriver as string);
    params.set("error", error as string);
  }
  if (template === "capability-gap") {
    params.set("feature", feature as string);
  }

  const base = repoUrl.replace(/\/+$/, "");
  return `${base}/issues/new?${params.toString()}`;
}
