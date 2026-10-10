import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Tauri bundles the shared Web UI distribution as a resource", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));

  assert.equal(config.build.frontendDist, "../packages/web-ui/dist");
  assert.equal(config.bundle.resources["../packages/web-ui/dist/"], "web-ui/");
});

test("release builds verify packaged Web UI assets on every desktop platform", () => {
  const workflow = read(".github/workflows/build.yml");

  assert.match(workflow, /Verify packaged Web UI \(Linux\)/);
  assert.match(workflow, /Verify packaged Web UI \(macOS\)/);
  assert.match(workflow, /Verify packaged Web UI \(Windows\)/);
  assert.match(workflow, /bundle\/appimage\/\*\.AppImage/);
  assert.match(workflow, /Smoke-test headless Web mode \(Linux\)/);
});

test("Windows package extraction waits for MSI completion and checks its exit code", () => {
  const workflow = read(".github/workflows/build.yml");

  assert.match(workflow, /Start-Process msiexec\.exe/);
  assert.match(workflow, /\$msiExtraction\.ExitCode/);
});

test("the Windows portable artifact carries its Web UI resources", () => {
  const workflow = read(".github/workflows/build.yml");

  assert.match(workflow, /x64-portable\.zip/);
  assert.match(workflow, /Copy-Item packages\\web-ui\\dist/);
  assert.doesNotMatch(workflow, /x64-portable\.exe/);
});

test("deployment examples follow the completed remote security model", () => {
  const guide = read("web-ui-project/docs/WEB_REMOTE_SECURITY.md");

  assert.match(guide, /## systemd example/);
  assert.match(guide, /## Container example/);
  assert.match(guide, /TABULARIS_WEB_PASSWORD/);
  assert.match(guide, /--public-url https:\/\//);
});
