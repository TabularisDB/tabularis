import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("WinGet build configuration", () => {
  it("passes a config file path that survives PowerShell and pnpm cmd shims", () => {
    const workflow = readFileSync(resolve(".github/workflows/build.yml"), "utf8");
    const step = workflow.split("- name: Build WinGet-managed installer")[1]?.split("- name:")[0];
    expect(step).toBeDefined();
    const command = step!.match(/run: (.+)/)?.[1];
    expect(command).toBeDefined();
    const args = command!.trim().split(/\s+/);
    expect(args.slice(0, 5)).toEqual(["pnpm", "tauri", "build", "--bundles", "nsis"]);
    expect(args[5]).toBe("--config");
    expect(args).toHaveLength(7);
    expect(args[6]).not.toMatch(/[\s'"{}]/);
    const config: unknown = JSON.parse(readFileSync(resolve(args[6]), "utf8"));
    expect(config).toEqual({
      $schema: "../node_modules/@tauri-apps/cli/config.schema.json",
      bundle: { createUpdaterArtifacts: false },
    });
    expect(step).toContain("PACKAGE_MANAGER_SRC: winget");
    expect(step).toContain("PACKAGE_MANAGER_NAME: winget");
    expect(step).toContain("!inputs.preview && !inputs.prerelease");
    const direct: { bundle: { createUpdaterArtifacts: boolean } } = JSON.parse(
      readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"),
    );
    expect(direct.bundle.createUpdaterArtifacts).toBe(true);
  });
});
