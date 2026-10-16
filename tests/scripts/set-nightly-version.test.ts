import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/set-nightly-version.mjs");
const directories: string[] = [];
const originalCargo = '[package]\nname = "tabularis"\nversion = "0.25.0"\n\n[dependencies.example]\nversion = "1.2.3"\n';

function fixture(cargo = originalCargo): string {
  const directory = mkdtempSync(join(tmpdir(), "tabularis-nightly-"));
  directories.push(directory);
  mkdirSync(join(directory, "src-tauri"));
  mkdirSync(join(directory, "src"));
  writeFileSync(join(directory, "src-tauri/Cargo.toml"), cargo);
  writeFileSync(join(directory, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "0.25.0", identifier: "tabularis" }));
  writeFileSync(join(directory, "src/version.ts"), 'export const APP_VERSION = "0.25.0";\n');
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("nightly version stamping", () => {
  it.each(["\n", "\r\n"])("aligns all three version sources with %j line endings", (ending) => {
    const directory = fixture(originalCargo.replaceAll("\n", ending));
    execFileSync(process.execPath, [script, "0.25.1-6"], { cwd: directory });
    expect(readFileSync(join(directory, "src-tauri/Cargo.toml"), "utf8"))
      .toBe(originalCargo.replace('version = "0.25.0"', 'version = "0.25.1-6"'));
    expect(JSON.parse(readFileSync(join(directory, "src-tauri/tauri.conf.json"), "utf8")))
      .toEqual({ version: "0.25.1-6", identifier: "tabularis" });
    expect(readFileSync(join(directory, "src/version.ts"), "utf8"))
      .toBe('export const APP_VERSION = "0.25.1-6";\n');
  });

  it("fails before writes when Cargo has no literal package version", () => {
    const directory = fixture('[package]\nname = "tabularis"\nversion.workspace = true\n');
    expect(() => execFileSync(process.execPath, [script, "0.25.1-6"], { cwd: directory, stdio: "pipe" })).toThrow();
    expect(JSON.parse(readFileSync(join(directory, "src-tauri/tauri.conf.json"), "utf8")).version).toBe("0.25.0");
    expect(readFileSync(join(directory, "src/version.ts"), "utf8")).toContain('"0.25.0"');
  });

  it.each(["0.25.1-nightly.6", "0.25.1", "0.25.1-06", "not-a-version"])("rejects invalid nightly version %s before writes", (version) => {
    const directory = fixture();
    expect(() => execFileSync(process.execPath, [script, version], { cwd: directory, stdio: "pipe" })).toThrow();
    expect(readFileSync(join(directory, "src-tauri/Cargo.toml"), "utf8")).toBe(originalCargo);
  });
});
