import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scaffold } from "../src/scaffold";

const tempDirs: string[] = [];

function scaffoldPlugin(withUi: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "create-plugin-"));
  tempDirs.push(root);
  const targetDir = join(root, "demo");
  scaffold({
    slug: "demo",
    displayName: "Demo",
    dbType: "network",
    quote: '"',
    withUi,
    targetDir,
    gitInit: false,
    pluginApiVersion: "0.1.0",
    minTabularisVersion: "0.1.0",
  });
  return targetDir;
}

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, ".tabularium"), "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scaffold", () => {
  describe("manifest ui_extensions", () => {
    it("declares the UI bundle when --with-ui is set", () => {
      const manifest = readManifest(scaffoldPlugin(true));
      expect(manifest.ui_extensions).toEqual([
        { slot: "data-grid.toolbar.actions", module: "ui/dist/index.js" },
      ]);
    });

    it("leaves ui_extensions out and keeps valid JSON without --with-ui", () => {
      const manifest = readManifest(scaffoldPlugin(false));
      expect(manifest).not.toHaveProperty("ui_extensions");
      expect(manifest.name).toBe("demo");
    });
  });

  describe("UI locale", () => {
    it("uses i18next double-brace interpolation for the table name", () => {
      const locale = JSON.parse(
        readFileSync(join(scaffoldPlugin(true), "locales", "en.json"), "utf8"),
      ) as Record<string, string>;
      expect(locale["toolbar.greeting"]).toContain("{{table}}");
      expect(locale["toolbar.greeting"]).not.toMatch(/(^|[^{])\{table\}/);
    });
  });
});
