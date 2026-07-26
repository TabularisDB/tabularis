import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve } from "path";

// File paths
const paths = {
  package: resolve("package.json"),
  tauri: resolve("src-tauri/tauri.conf.json"),
  cargo: resolve("src-tauri/Cargo.toml"),
  appVersion: resolve("src/version.ts"),
};

// All README files in the repo root, including translations (README.it.md, README.zh-CN.md, ...)
const readmeFiles = readdirSync(resolve("."))
  .filter((name) => /^README(\..+)?\.md$/.test(name))
  .map((name) => resolve(name));

// 1. Read the new version from package.json (already updated by npm version)
const pkg = JSON.parse(readFileSync(paths.package, "utf-8"));
const newVersion = pkg.version;

console.log(`🔄 Syncing version to ${newVersion}...`);

// 2. Update tauri.conf.json
const tauriConf = JSON.parse(readFileSync(paths.tauri, "utf-8"));
tauriConf.version = newVersion;
// Also update the version in the package node if present
if (tauriConf.package) tauriConf.package.version = newVersion;
writeFileSync(paths.tauri, JSON.stringify(tauriConf, null, 2));
console.log("✅ Updated tauri.conf.json");

// 3. Update Cargo.toml
let cargo = readFileSync(paths.cargo, "utf-8");
// Use a regex to replace only the version in the [package] block
cargo = cargo.replace(/^version = ".*"/m, `version = "${newVersion}"`);
writeFileSync(paths.cargo, cargo);
console.log("✅ Updated Cargo.toml");

// 4. Update src/version.ts
const versionContent = `export const APP_VERSION = "${newVersion}";\n`;
writeFileSync(paths.appVersion, versionContent);
console.log("✅ Updated src/version.ts");

// 5. Update download links in every README (all languages)
for (const readmePath of readmeFiles) {
  let readme = readFileSync(readmePath, "utf-8");

  readme = readme.replace(
    /releases\/download\/v.*?\//g,
    `releases/download/v${newVersion}/`,
  );

  readme = readme.replace(
    /tabularis_\d+\.\d+\.\d+_/g,
    `tabularis_${newVersion}_`,
  );

  // .rpm assets use dashes: tabularis-X.Y.Z-1.x86_64.rpm
  readme = readme.replace(
    /tabularis-\d+\.\d+\.\d+-/g,
    `tabularis-${newVersion}-`,
  );

  writeFileSync(readmePath, readme);
  console.log(`✅ Updated ${readmePath.split("/").pop()}`);
}
