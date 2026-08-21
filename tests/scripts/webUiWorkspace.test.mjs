import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const webUiRoot = join(repositoryRoot, "packages/web-ui");
const frontendConfigFiles = [
  "postcss.config.js",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vitest.config.ts",
];
const delegatedScripts = [
  "build",
  "dev",
  "lint",
  "preview",
  "test",
  "test:coverage",
  "typecheck",
];

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("web UI workspace", () => {
  it("owns the frontend package scripts and configuration", () => {
    const webUiPackage = readPackageJson(join(webUiRoot, "package.json"));

    expect(webUiPackage.name).toBe("@tabularis/web-ui");
    expect(webUiPackage.private).toBe(true);
    for (const script of delegatedScripts) {
      expect(webUiPackage.scripts[script]).toEqual(expect.any(String));
    }
    for (const configFile of frontendConfigFiles) {
      expect(existsSync(join(webUiRoot, configFile)), configFile).toBe(true);
      expect(existsSync(join(repositoryRoot, configFile)), configFile).toBe(false);
    }
  });

  it("keeps root frontend scripts as compatibility delegators", () => {
    const rootPackage = readPackageJson(join(repositoryRoot, "package.json"));

    for (const script of delegatedScripts) {
      expect(rootPackage.scripts[script]).toBe(
        `pnpm --filter @tabularis/web-ui ${script}`,
      );
    }
  });
});
