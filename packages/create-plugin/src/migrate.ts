import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { substitute } from "./substitute";

/** Semver as the registry accepts it: MAJOR.MINOR.PATCH, optional pre-release/build. No leading "v". */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

const RELEASE_WORKFLOW = ".github/workflows/release.yml";

/** Files whose `manifest.json` references must follow the rename (release.yml only when not regenerated). */
const REFERENCE_FILES = ["justfile", "README.md"];

export interface MigrateOptions {
  /**
   * Regenerate `.github/workflows/release.yml` from the registry-ready template
   * instead of only renaming its `manifest.json` reference. Overwrites the file.
   */
  ci?: boolean;
}

export interface MigrateResult {
  /** Human-readable list of what changed, in apply order. */
  changed: string[];
  /** Non-fatal notices (e.g. a load-bearing `id` that was deliberately kept). */
  warnings: string[];
  /** True when the release workflow was regenerated from the template (`--ci`). */
  ciRegenerated: boolean;
}

/** Template root: `../templates` from this module, in both `src/` (tests) and `dist/` (published). */
function templateRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../templates");
}

/** Rename `manifest.json` → `.tabularium` references in a file, if present. */
function patchReferences(dir: string, rel: string, changed: string[]): void {
  const p = join(dir, rel);
  if (!existsSync(p)) return;
  const before = readFileSync(p, "utf8");
  // "manifest.json" is not a substring of "manifest.schema.json", so schema
  // links are left untouched.
  const after = before.split("manifest.json").join(".tabularium");
  if (after !== before) {
    writeFileSync(p, after, "utf8");
    changed.push(`${rel} (references updated)`);
  }
}

/** Render the registry-ready release workflow from the template with the plugin's binary name. */
function regenerateReleaseWorkflow(dir: string, binName: string): void {
  const tmplPath = join(templateRoot(), "rust-driver", RELEASE_WORKFLOW + ".tmpl");
  const rendered = substitute(readFileSync(tmplPath, "utf8"), { BIN_NAME: binName });
  const out = join(dir, RELEASE_WORKFLOW);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rendered, "utf8");
}

/**
 * Migrate a plugin project from the legacy `manifest.json` to the canonical
 * `.tabularium` bundle manifest the host now reads.
 *
 * Hard cutover (the `COMPAT(registry-ga)` fallback in the host is meant to go
 * away): writes `.tabularium`, deletes `manifest.json`, and renames the
 * `manifest.json` references in the release workflow, justfile, and README.
 *
 * With `options.ci`, the release workflow is instead **regenerated** from the
 * registry-ready template so `.tabularium` is published as a standalone release
 * asset (which the Tabularium registry requires). Without it, the CI structure
 * is left alone — only its `manifest.json` reference is renamed so the build
 * keeps working.
 *
 * `id` is dropped only when it equals `name`. The host falls back to `name` for
 * the plugin identity when `id` is absent, so an `id` that differs from `name`
 * is load-bearing and is kept (with a warning) rather than silently changing
 * the plugin's identity.
 *
 * Throws on a missing/invalid manifest or a missing/invalid `version` — the
 * registry rejects releases whose manifest has no semver `version`.
 */
export function migratePlugin(dir: string, options: MigrateOptions = {}): MigrateResult {
  const manifestPath = join(dir, "manifest.json");
  const tabulariumPath = join(dir, ".tabularium");

  if (!existsSync(manifestPath)) {
    if (existsSync(tabulariumPath)) {
      return {
        changed: [],
        warnings: [
          "Nothing to do: a .tabularium manifest is already present and there is no manifest.json to convert.",
        ],
        ciRegenerated: false,
      };
    }
    throw new Error(
      `No manifest.json found in ${dir}. Run this from a plugin project root, or pass the path (e.g. \`migrate ./my-driver\`).`,
    );
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const version = manifest.version;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(
      `manifest.json has no valid "version" (found ${JSON.stringify(version)}). ` +
        `The registry requires a semver version with no leading "v" (e.g. "1.0.0"). Add one, then migrate.`,
    );
  }

  const warnings: string[] = [];
  const changed: string[] = [];
  let ciRegenerated = false;

  const { id, name } = manifest as { id?: unknown; name?: unknown };
  if (typeof id === "string") {
    if (id === name) {
      delete manifest.id;
    } else {
      warnings.push(
        `Kept "id": ${JSON.stringify(id)} — it differs from "name" (${JSON.stringify(name)}), ` +
          `so it identifies the plugin and is not redundant. Remove it manually only if you also rename the install directory.`,
      );
    }
  }

  writeFileSync(tabulariumPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  changed.push(".tabularium (written)");

  rmSync(manifestPath);
  changed.push("manifest.json (removed)");

  // Follow the rename everywhere the bundle file is referenced.
  for (const rel of REFERENCE_FILES) {
    patchReferences(dir, rel, changed);
  }

  // Release workflow: regenerate to registry-ready only with --ci; otherwise
  // just rename its reference so the existing CI keeps building.
  if (options.ci) {
    const executable = typeof manifest.executable === "string" ? manifest.executable.trim() : "";
    if (!executable) {
      warnings.push(
        `--ci skipped for ${RELEASE_WORKFLOW}: the manifest has no "executable", so the workflow's binary name can't be derived. Renamed its reference instead — upgrade the CI by hand.`,
      );
      patchReferences(dir, RELEASE_WORKFLOW, changed);
    } else {
      const existed = existsSync(join(dir, RELEASE_WORKFLOW));
      regenerateReleaseWorkflow(dir, executable);
      changed.push(`${RELEASE_WORKFLOW} (${existed ? "regenerated" : "created"} from registry-ready template)`);
      if (existed) {
        warnings.push(
          `Overwrote ${RELEASE_WORKFLOW} from the registry-ready template — re-apply any custom CI steps you had.`,
        );
      }
      ciRegenerated = true;
    }
  } else {
    patchReferences(dir, RELEASE_WORKFLOW, changed);
  }

  return { changed, warnings, ciRegenerated };
}
