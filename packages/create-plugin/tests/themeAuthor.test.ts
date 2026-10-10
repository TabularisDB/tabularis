import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runThemeAuthor, scaffoldTheme, themeReleaseWorkflow, validateThemeDirectory } from "../src/themeAuthor";
import { themeValidationWorkflow } from "../src/themeCi";
import definitionSchema from "../../web-ui/src/schemas/theme-definition-v1.json";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "theme-author-test-")); roots.push(root);
  const bundle = join(root, "tool.mjs"); writeFileSync(bundle, "#!/usr/bin/env node\nconsole.log('test-only bundle');\n");
  const target = join(root, "theme"); scaffoldTheme(target, "test-theme", "0.24.0", bundle);
  return { root, target, bundle };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("theme author tooling", () => {
  it("uses public registry schema hints without fetching or packaging schemas", () => {
    const { target } = fixture();
    const { manifest, files } = validateThemeDirectory(target);
    expect(manifest.$schema).toBe("https://registry.tabularis.dev/manifest.schema.json?kind=theme");
    for (const variant of manifest.theme_variants) {
      expect(JSON.parse(files.get(variant.file)!).$schema).toBe(definitionSchema.$id);
    }
    expect([...files.keys()].some((file) => file.startsWith("schemas/"))).toBe(false);
    expect(JSON.parse(readFileSync(join(target, ".vscode/settings.json"), "utf8"))["files.associations"]).toEqual({ ".tabularium": "json" });
    expect(readFileSync(join(target, ".github/workflows/validate.yml"), "utf8")).toBe(themeValidationWorkflow());
  });
  it("keeps branch and PR validation read-only and separate from releases", () => {
    const workflow = themeValidationWorkflow();
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("gh release");
    expect(workflow).toContain("node tools/theme.mjs validate .");
    expect(workflow).toContain("node tools/theme.mjs package .");
    expect(workflow).toContain("persist-credentials: false");
  });
  it("scaffolds a self-contained two-variant repository without changing driver defaults", () => {
    const { target } = fixture(); const result = validateThemeDirectory(target, "v1.0.0");
    expect(result.manifest.kind).toBe("theme"); expect(result.manifest.theme_variants).toHaveLength(2);
    expect(existsSync(join(target, "tools/theme.mjs"))).toBe(true);
    expect(readFileSync(join(target, "LICENSE.txt"), "utf8")).toContain("redistribution rights");
    expect(readFileSync(join(target, ".github/workflows/release.yml"), "utf8")).toBe(themeReleaseWorkflow());
  });
  it("refuses mismatched tags, malformed declarations, symlinks and existing outputs", () => {
    const { root, target, bundle } = fixture();
    expect(() => validateThemeDirectory(target, "v2.0.0")).toThrow("Tag");
    expect(() => scaffoldTheme(target, "test-theme", "0.24.0", bundle)).toThrow("already exists");
    const output = join(root, "out.zip");
    runThemeAuthor(["package", target, "--output", output], bundle);
    expect(() => runThemeAuthor(["package", target, "--output", output], bundle)).toThrow();
    const definition = join(target, "themes/dark.json"); rmSync(definition); symlinkSync(bundle, definition);
    expect(() => validateThemeDirectory(target)).toThrow("Symlink");
  });
  it("packages deterministic bytes and validates actual edited source offline", () => {
    const { root, target, bundle } = fixture();
    const outputs = [join(root, "one.zip"), join(root, "two.zip")];
    for (const output of outputs) runThemeAuthor(["package", target, "--output", output], bundle);
    expect(readFileSync(outputs[0])).toEqual(readFileSync(outputs[1]));
    writeFileSync(join(target, "themes/dark.json"), '{"schemaVersion":1,"mode":"dark","run":"unsafe"}');
    expect(() => validateThemeDirectory(target)).toThrow("Invalid theme definition");
  });
  it("keeps workflow writes restricted to tag releases and quotes validated environment inputs", () => {
    const workflow = themeReleaseWorkflow();
    expect(workflow).not.toContain("pull_request"); expect(workflow).not.toContain("npm install");
    expect(workflow).toContain('validate . --tag "$THEME_TAG"'); expect(workflow).toContain("--draft");
    expect(workflow).toContain("persist-credentials: false"); expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
  });
  it("requires an explicit runtime floor and rejects unknown commands", () => {
    const { bundle } = fixture();
    expect(() => runThemeAuthor(["scaffold", "test-theme"], bundle)).toThrow("explicit");
    expect(() => runThemeAuthor(["unknown"], bundle)).toThrow("Unknown");
    expect(runThemeAuthor(["--help"], bundle)).toContain("--min-runtime-version");
  });
});
