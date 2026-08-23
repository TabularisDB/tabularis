import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const guidePath = "web-ui-project/docs/WEB_MODE_OPERATIONS.md";
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("the Web operator guide covers every Web CLI option", () => {
  const guide = read(guidePath);
  const cli = read("src-tauri/src/cli.rs");
  const webOptions = cli.slice(cli.indexOf("pub struct WebArgs"));
  const optionOverrides = {
    allowed_origins: "allowed-origin",
    server_file_browser_roots: "server-file-browser-root",
  };
  const optionNames = [...webOptions.matchAll(/pub ([a-z_]+):/g)].map(([, name]) => {
    const optionName = optionOverrides[name] ?? name.replaceAll("_", "-");
    return `--${optionName}`;
  });

  assert.deepEqual(optionNames, [
    "--host",
    "--port",
    "--no-open",
    "--web-root",
    "--auth",
    "--public-url",
    "--allowed-origin",
    "--allow-high-risk",
    "--server-file-browser-root",
  ]);
  assert.ok(guide.includes("`web`"), "web subcommand is undocumented");
  for (const option of optionNames) {
    assert.ok(guide.includes(`\`${option}`), `${option} is undocumented`);
  }
});

test("the Web operator guide covers the WEB-102 operations contract", () => {
  const guide = read(guidePath);
  const requiredSections = [
    "CLI options",
    "Local security behavior",
    "Remote deployment and reverse proxy",
    "Data, configuration, and credential locations",
    "Browser limitations and adaptations",
    "Plugin compatibility",
    "Troubleshooting",
    "Upgrade and rollback",
  ];

  for (const section of requiredSections) {
    assert.match(guide, new RegExp(`^## ${section}$`, "m"), `${section} section is missing`);
  }

  for (const expected of [
    "TABULARIS_WEB_PASSWORD",
    "TABULARIS_WEB_PROXY_SECRET",
    "~/.config/tabularis",
    "~/.local/share/tabularis",
    "%APPDATA%\\tabularis",
    "OS credential store",
    "10,000 rows",
    "@tabularis/plugin-api",
  ]) {
    assert.ok(guide.includes(expected), `${expected} guidance is missing`);
  }
});

test("the Web documentation entry point and related guide links stay valid", () => {
  const guide = read(guidePath);
  const projectReadme = read("web-ui-project/README.md");

  assert.match(projectReadme, /docs\/WEB_MODE_OPERATIONS\.md/);

  const links = [...guide.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)].map(([, link]) => link);
  assert.ok(links.length >= 4, "expected links to the specialized Web guides");
  for (const link of links) {
    assert.ok(
      fs.existsSync(path.resolve(path.dirname(path.join(root, guidePath)), link)),
      `broken documentation link: ${link}`,
    );
  }
});
