/**
 * Sync check: assert the public API surface declared by this package
 * mirrors the host barrel at `packages/web-ui/src/pluginApi.ts`.
 *
 * Catches the one drift scenario that matters: someone adds a hook or type
 * to the host without publishing it from `@tabularis/plugin-api`.
 *
 * Exits 1 on mismatch, 0 otherwise. Run via `pnpm --filter @tabularis/plugin-api check:sync`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

const HOST_BARREL = resolve(REPO_ROOT, "packages/web-ui/src/pluginApi.ts");
const PACKAGE_BARREL = resolve(__dirname, "../src/index.ts");

function extractExports(source: string): { values: Set<string>; types: Set<string> } {
  const values = new Set<string>();
  const types = new Set<string>();

  // Match `export { a, b, c } from "..."` and `export type { X, Y } from "..."`
  const exportBlock = /export\s+(type\s+)?\{\s*([^}]+)\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = exportBlock.exec(source)) !== null) {
    const isType = Boolean(match[1]);
    const names = match[2]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const aliasMatch = /([A-Za-z0-9_$]+)(?:\s+as\s+([A-Za-z0-9_$]+))?/.exec(n);
        return aliasMatch ? (aliasMatch[2] ?? aliasMatch[1]) : n;
      });
    for (const n of names) {
      (isType ? types : values).add(n);
    }
  }

  return { values, types };
}

function main(): void {
  const hostSource = readFileSync(HOST_BARREL, "utf8");
  const pkgSource = readFileSync(PACKAGE_BARREL, "utf8");

  const host = extractExports(hostSource);
  const pkg = extractExports(pkgSource);

  const missingValues: string[] = [];
  const missingTypes: string[] = [];

  for (const name of host.values) {
    // The host may export either as value or type — tolerate either form in the package.
    if (!pkg.values.has(name) && !pkg.types.has(name)) {
      missingValues.push(name);
    }
  }
  for (const name of host.types) {
    if (!pkg.types.has(name) && !pkg.values.has(name)) {
      missingTypes.push(name);
    }
  }

  if (missingValues.length === 0 && missingTypes.length === 0) {
    console.log(
      "[plugin-api check:sync] OK — host barrel and package barrel are in sync.",
    );
    console.log(
      `  host: ${host.values.size} values / ${host.types.size} types`,
    );
    console.log(
      `  pkg : ${pkg.values.size} values / ${pkg.types.size} types`,
    );
    return;
  }

  console.error("[plugin-api check:sync] FAIL — drift detected.");
  if (missingValues.length > 0) {
    console.error(
      `  Missing value exports in @tabularis/plugin-api (present in host):`,
    );
    for (const n of missingValues) console.error(`    - ${n}`);
  }
  if (missingTypes.length > 0) {
    console.error(
      `  Missing type exports in @tabularis/plugin-api (present in host):`,
    );
    for (const n of missingTypes) console.error(`    - ${n}`);
  }
  console.error(
    `\n  Host barrel : ${HOST_BARREL}`,
  );
  console.error(
    `  Pkg  barrel : ${PACKAGE_BARREL}`,
  );
  console.error(
    "\n  Either re-export the missing names from the package or mark the host export @internal.",
  );
  process.exit(1);
}

main();
