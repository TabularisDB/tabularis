import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
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
const frontendOwnedPaths = ["index.html", "public", "src", "tests/setup.ts"];

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

  it("owns the frontend source, assets, and tests", () => {
    for (const ownedPath of frontendOwnedPaths) {
      expect(existsSync(join(webUiRoot, ownedPath)), ownedPath).toBe(true);
    }
    for (const movedPath of ["index.html", "public", "src"]) {
      expect(existsSync(join(repositoryRoot, movedPath)), movedPath).toBe(false);
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

  it("configures desktop development and builds to use the web UI package", () => {
    const tauriConfig = readPackageJson(
      join(repositoryRoot, "src-tauri/tauri.conf.json"),
    );

    expect(tauriConfig.build.frontendDist).toBe("../packages/web-ui/dist");
    expect(tauriConfig.build.devUrl).toBe("http://localhost:5173");
    expect(tauriConfig.build.beforeDevCommand).toBe("pnpm dev");
    expect(tauriConfig.build.beforeBuildCommand).toBe("pnpm build");
  });
});
