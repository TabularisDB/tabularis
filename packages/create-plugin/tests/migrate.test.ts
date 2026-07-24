import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migratePlugin } from "../src/migrate";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ctp-migrate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeManifest(manifest: Record<string, unknown>): void {
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

describe("migratePlugin", () => {
  it("writes .tabularium, removes manifest.json, and reports both", () => {
    writeManifest({ id: "my-driver", name: "My Driver", version: "1.2.3", description: "x" });

    const result = migratePlugin(dir);

    expect(existsSync(join(dir, ".tabularium"))).toBe(true);
    expect(existsSync(join(dir, "manifest.json"))).toBe(false);
    expect(result.changed).toContain(".tabularium (written)");
    expect(result.changed).toContain("manifest.json (removed)");

    const written = JSON.parse(readFileSync(join(dir, ".tabularium"), "utf8"));
    expect(written.version).toBe("1.2.3");
  });

  it("keeps a load-bearing id that differs from name (with a warning)", () => {
    writeManifest({ id: "my-driver", name: "My Driver", version: "1.0.0", description: "x" });

    const result = migratePlugin(dir);

    const written = JSON.parse(readFileSync(join(dir, ".tabularium"), "utf8"));
    expect(written.id).toBe("my-driver");
    expect(result.warnings.join("\n")).toMatch(/Kept "id"/);
  });

  it("drops a redundant id that equals name", () => {
    writeManifest({ id: "my-driver", name: "my-driver", version: "1.0.0", description: "x" });

    migratePlugin(dir);

    const written = JSON.parse(readFileSync(join(dir, ".tabularium"), "utf8"));
    expect(written.id).toBeUndefined();
    expect(written.name).toBe("my-driver");
  });

  it("rewrites manifest.json references in workflow, justfile, and README", () => {
    writeManifest({ name: "d", version: "1.0.0", description: "x" });
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".github/workflows/release.yml"), "cp manifest.json staging/\n", "utf8");
    writeFileSync(join(dir, "justfile"), "cp manifest.json ~/plugins/\n", "utf8");
    // A schema link must NOT be rewritten — "manifest.json" is not a substring of it.
    writeFileSync(join(dir, "README.md"), "See manifest.json and manifest.schema.json\n", "utf8");

    migratePlugin(dir);

    expect(readFileSync(join(dir, ".github/workflows/release.yml"), "utf8")).toBe("cp .tabularium staging/\n");
    expect(readFileSync(join(dir, "justfile"), "utf8")).toBe("cp .tabularium ~/plugins/\n");
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("See .tabularium and manifest.schema.json\n");
  });

  it("throws when version is missing or not semver", () => {
    writeManifest({ name: "d", description: "x" });
    expect(() => migratePlugin(dir)).toThrow(/version/);

    writeManifest({ name: "d", version: "v1.0", description: "x" });
    expect(() => migratePlugin(dir)).toThrow(/version/);
  });

  it("throws on invalid JSON", () => {
    writeFileSync(join(dir, "manifest.json"), "{ not json", "utf8");
    expect(() => migratePlugin(dir)).toThrow(/valid JSON/);
  });

  it("is a no-op when only .tabularium is present", () => {
    writeFileSync(join(dir, ".tabularium"), "{}\n", "utf8");
    const result = migratePlugin(dir);
    expect(result.changed).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/already present/);
  });

  it("throws when there is no manifest at all", () => {
    expect(() => migratePlugin(dir)).toThrow(/No manifest.json/);
  });

  it("only renames the release.yml reference without --ci (CI structure untouched)", () => {
    writeManifest({ name: "d", version: "1.0.0", description: "x", executable: "d-plugin" });
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".github/workflows/release.yml"), "cp manifest.json staging/\n", "utf8");

    const result = migratePlugin(dir);

    expect(result.ciRegenerated).toBe(false);
    expect(readFileSync(join(dir, ".github/workflows/release.yml"), "utf8")).toBe("cp .tabularium staging/\n");
  });

  it("regenerates release.yml from the registry-ready template with --ci", () => {
    writeManifest({ name: "d", version: "1.0.0", description: "x", executable: "duckdb-plugin" });
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".github/workflows/release.yml"), "cp manifest.json staging/\n", "utf8");

    const result = migratePlugin(dir, { ci: true });

    expect(result.ciRegenerated).toBe(true);
    const yml = readFileSync(join(dir, ".github/workflows/release.yml"), "utf8");
    // Registry-ready structure + standalone manifest asset.
    expect(yml).toContain("actions/upload-artifact");
    expect(yml).toContain("Publish GitHub release");
    expect(yml).toMatch(/files: \|[\s\S]*\.tabularium/);
    // BIN_NAME substituted from manifest.executable; no template placeholders left.
    expect(yml).toContain("duckdb-plugin-${{ matrix.platform-label }}.zip");
    expect(yml).not.toContain("${BIN_NAME}");
    expect(yml).not.toContain(".tmpl");
    // Overwriting an existing workflow warns.
    expect(result.warnings.join("\n")).toMatch(/Overwrote .*release\.yml/);
  });

  it("falls back to a reference rename when --ci has no executable to work with", () => {
    writeManifest({ name: "d", version: "1.0.0", description: "x" });
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".github/workflows/release.yml"), "cp manifest.json staging/\n", "utf8");

    const result = migratePlugin(dir, { ci: true });

    expect(result.ciRegenerated).toBe(false);
    expect(result.warnings.join("\n")).toMatch(/--ci skipped/);
    expect(readFileSync(join(dir, ".github/workflows/release.yml"), "utf8")).toBe("cp .tabularium staging/\n");
  });
});
