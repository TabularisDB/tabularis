/**
 * End-to-end smoke test.
 *
 * 1. Scaffold a plugin into a temporary directory (network, file, and
 *    --with-ui variants).
 * 2. Run `cargo check` on each — must exit 0.
 * 3. For --with-ui, also verify the ui/ directory has the expected files.
 *
 * Intended to be run via `pnpm --filter @tabularis/create-plugin smoke`.
 * Requires cargo on PATH.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/cli.js");

function step(label: string): void {
  console.log(`\n▶ ${label}`);
}

function run(cmd: string, args: string[], cwd: string): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function scaffoldOne(kind: "network" | "file", withUi: boolean): void {
  const label = `${kind}${withUi ? "+ui" : ""}`;
  step(`scaffold ${label}`);
  const dir = mkdtempSync(join(tmpdir(), `ctp-smoke-${kind}-`));
  const target = join(dir, "plugin");

  const args = ["my-driver", "--db-type=" + kind, "--no-git", "--dir=" + target];
  if (withUi) args.push("--with-ui");
  run(process.execPath, [CLI, ...args], dir);

  for (const expected of ["Cargo.toml", ".tabularium", "src/main.rs", "justfile"]) {
    const p = join(target, expected);
    if (!existsSync(p) || statSync(p).size === 0) {
      throw new Error(`missing or empty: ${p}`);
    }
  }

  if (withUi) {
    for (const expected of ["ui/package.json", "ui/vite.config.ts", "ui/src/index.tsx", "locales/en.json"]) {
      const p = join(target, expected);
      if (!existsSync(p) || statSync(p).size === 0) {
        throw new Error(`missing or empty: ${p}`);
      }
    }
  }

  step(`cargo check ${label}`);
  run("cargo", ["check", "--quiet"], target);

  rmSync(dir, { recursive: true, force: true });
  console.log(`  ✓ ${label} — cargo check clean`);
}

function main(): void {
  if (!existsSync(CLI)) {
    throw new Error(
      `CLI not built at ${CLI}. Run \`pnpm --filter @tabularis/create-plugin build\` first.`,
    );
  }

  scaffoldOne("network", false);
  scaffoldOne("file", false);
  scaffoldOne("network", true);

  console.log("\n✓ smoke OK");
}

main();
