import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { convertVsCodeTheme } from "../../web-ui/src/utils/vsCodeThemeImport";
import { resolveCatalogEntry } from "../../web-ui/src/utils/themeCatalog";
import { exportThemePackage } from "../../web-ui/src/utils/themePackageExport";
import type { ThemePackageManifestV1 } from "../../web-ui/src/types/themePackage";

const root = mkdtempSync(join(process.env.THEME_SMOKE_PARENT ?? tmpdir(), "tabularis-theme-smoke-"));
const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/theme.js");
const target = join(root, "original");
const run = (tool: string, args: string[]) => execFileSync(process.execPath, [tool, ...args], { stdio: "pipe" }).toString();
try {
  console.log(run(cli, ["scaffold", "fixture-theme", "--dir", target, "--min-runtime-version", "0.24.0"]));
  const tool = join(target, "tools/theme.mjs");
  const manifestPath = join(target, ".tabularium");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ThemePackageManifestV1;
  const dark = join(target, "themes/dark.json");
  writeFileSync(dark, JSON.stringify({ schemaVersion: 1, mode: "dark", colors: { accent: { primary: "#91b6ff" } }, editor: { rules: [{ token: "keyword.sql", foreground: "#abcdef", fontStyle: "bold" }] } }));
  console.log(run(tool, ["validate", target, "--tag", "v1.0.0"]));
  for (const name of ["original-v1.zip", "original-repeat.zip"]) console.log(run(tool, ["package", target, "--tag", "v1.0.0", "--output", join(root, name)]));
  assert.deepEqual(readFileSync(join(root, "original-v1.zip")), readFileSync(join(root, "original-repeat.zip")));
  assert.throws(() => run(tool, ["validate", target, "--tag", "v9.0.0"]));
  manifest.version = "2.0.0"; writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(dark, '{"schemaVersion":1,"mode":"dark","colors":{"accent":{"primary":"#ffcc88"}}}');
  console.log(run(tool, ["package", target, "--tag", "v2.0.0", "--output", join(root, "original-v2.zip")]));

  const converted = convertVsCodeTheme(`// Local fixture: no include or remote access\n{"name":"Imported fixture","type":"dark","author":"Fixture author; rights reviewed separately","colors":{"editor.background":"#101820","editor.foreground":"#ddeeff"},"tokenColors":[{"scope":"keyword.control.sql","settings":{"foreground":"#91b6ff","fontStyle":"italic"}}],}`);
  assert.ok(converted.diagnostics.some((diagnostic) => diagnostic.code === "scopeApproximation"));
  // UI acknowledgement is separately tested; this smoke deliberately inspects
  // the diagnostic instead of silently treating approximation as full parity.
  const declaration = converted.definition;
  declaration.colors = { ...declaration.colors, accent: { primary: "#91b6ff" } };
  const imported = resolveCatalogEntry({ id: "custom-author-smoke", name: "Imported fixture", origin: { kind: "personal" }, revision: "1", source: JSON.stringify(declaration), mode: "dark", format: "v1", available: true, readOnly: false });
  const importedManifest: ThemePackageManifestV1 = { ...manifest, version: "1.0.0", theme_variants: [{ id: "dark", name: "Imported dark", file: "themes/dark.json" }] };
  writeFileSync(join(root, "imported-v1.zip"), exportThemePackage(imported, importedManifest, "Fixture only; not a public release."));
  declaration.colors.accent = { primary: "#ffcc88" };
  const edited = resolveCatalogEntry({ ...imported.entry, revision: "2", source: JSON.stringify(declaration) });
  writeFileSync(join(root, "imported-v2.zip"), exportThemePackage(edited, { ...importedManifest, version: "2.0.0" }, "Fixture only; not a public release."));
  writeFileSync(join(root, "imported-definition.json"), JSON.stringify(declaration, null, 2));
  const artifacts = ["original-v1.zip", "original-v2.zip", "imported-v1.zip", "imported-v2.zip"];
  const hashes = Object.fromEntries(artifacts.map((name) => [name, createHash("sha256").update(readFileSync(join(root, name))).digest("hex")]));
  writeFileSync(join(root, "evidence.json"), JSON.stringify({ root, fixturesOnlyRuntime: "0.24.0", hashes, diagnostics: converted.diagnostics }, null, 2));
  console.log(JSON.stringify({ root, hashes }, null, 2));
  console.log("PASS: scaffold/edit/offline validation/deterministic packaging, generated workflow commands, VS Code conversion/edit/export; no install, account or release publication.");
} finally {
  if (process.env.THEME_SMOKE_KEEP !== "1") rmSync(root, { recursive: true, force: true });
}
