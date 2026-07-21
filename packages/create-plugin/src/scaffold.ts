import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { substitute } from "./substitute";
import type { DbType, IdentifierQuote } from "./validate";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the template root. In dev (tsup watching) this lives next to `src/`;
 * in a published package it lives next to `dist/`. Both resolve correctly via
 * `../templates` from the compiled output.
 */
function templateRoot(): string {
  return resolve(__dirname, "../templates");
}

export interface ScaffoldOptions {
  slug: string;
  displayName: string;
  dbType: DbType;
  quote: IdentifierQuote;
  withUi: boolean;
  targetDir: string;
  gitInit: boolean;
  pluginApiVersion: string;
  minTabularisVersion: string;
}

/** Derive all template variables from the high-level scaffold options. */
function buildVars(opts: ScaffoldOptions): Record<string, string> {
  const fileBased = opts.dbType === "file";
  const folderBased = opts.dbType === "folder";
  const apiBased = opts.dbType === "api";

  const defaultPort = opts.dbType === "network" ? "5432" : "null";
  // The .rs template uses this constant as a literal Rust expression
  // (`Some(5432)` or `None`) — translate here.
  const defaultPortRust = opts.dbType === "network" ? "Some(5432)" : "None";

  // The manifest expects an actual JSON quote character, not the escaped string.
  // For "  → "\"" (already escaped inside JSON string). For ` → "`".
  const quoteJson = opts.quote === "\"" ? "\\\"" : "`";

  return {
    NAME: opts.slug,
    DISPLAY_NAME: opts.displayName,
    ID: opts.slug,
    BIN_NAME: `${opts.slug}-plugin`,
    DB_TYPE: opts.dbType,
    QUOTE: opts.quote,
    QUOTE_JSON: quoteJson,
    FILE_BASED: String(fileBased),
    FOLDER_BASED: String(folderBased),
    API_BASED: String(apiBased),
    NO_CONNECTION_REQUIRED: String(apiBased),
    DEFAULT_PORT: defaultPort,
    DEFAULT_PORT_RUST: defaultPortRust,
    YEAR: String(new Date().getUTCFullYear()),
    PLUGIN_API_VERSION: opts.pluginApiVersion,
    MIN_TABULARIS_VERSION: opts.minTabularisVersion,
    UI_EXTENSIONS_ENTRY: opts.withUi
      ? `    {\n      "slot": "data-grid.toolbar.actions",\n      "module": "ui/dist/index.js"\n    }\n  `
      : "",
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Copy a template subdirectory with substitution and .tmpl-stripping. */
function copyTemplate(
  templateSubdir: string,
  targetDir: string,
  vars: Record<string, string>,
): void {
  const sourceRoot = join(templateRoot(), templateSubdir);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Template not found at ${sourceRoot}`);
  }

  for (const sourcePath of walk(sourceRoot)) {
    const rel = relative(sourceRoot, sourcePath);
    const isTemplate = rel.endsWith(".tmpl");
    const outRel = isTemplate ? rel.slice(0, -".tmpl".length) : rel;
    const outPath = join(targetDir, outRel);

    mkdirSync(dirname(outPath), { recursive: true });

    const raw = readFileSync(sourcePath, "utf8");
    const out = isTemplate ? substitute(raw, vars) : raw;
    writeFileSync(outPath, out, "utf8");
  }
}

export function scaffold(opts: ScaffoldOptions): void {
  if (existsSync(opts.targetDir)) {
    const contents = readdirSync(opts.targetDir);
    if (contents.length > 0) {
      throw new Error(
        `Target directory ${opts.targetDir} already exists and is not empty. ` +
          `Refusing to overwrite. Pick a new --dir or remove the existing one.`,
      );
    }
  }
  mkdirSync(opts.targetDir, { recursive: true });

  const vars = buildVars(opts);

  copyTemplate("rust-driver", opts.targetDir, vars);

  if (opts.withUi) {
    copyTemplate("ui-extension", join(opts.targetDir, "ui"), vars);
    // i18n strings live at the plugin root (`<root>/locales/<lang>.json`), not
    // under `ui/` — that's where the host loads them from.
    copyTemplate("ui-extension-locales", opts.targetDir, vars);
  }

  if (opts.gitInit) {
    try {
      execFileSync("git", ["init", "--quiet"], {
        cwd: opts.targetDir,
        stdio: "ignore",
      });
    } catch {
      // Non-fatal — user can still init manually.
    }
  }
}
