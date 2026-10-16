import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(0|[1-9]\d*)$/.test(version ?? "")) {
  throw new Error("Expected a nightly version with one numeric suffix, e.g. 0.25.1-6");
}

const configPath = "src-tauri/tauri.conf.json";
const cargoPath = "src-tauri/Cargo.toml";
const frontendPath = "src/version.ts";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const cargo = readFileSync(cargoPath, "utf8");
const lines = cargo.split(/\r?\n/);
const packageStart = lines.findIndex((line) => line.trim() === "[package]");
if (packageStart < 0) throw new Error("Cargo.toml has no [package] section");
let packageEnd = lines.findIndex((line, index) => index > packageStart && /^\s*\[/.test(line));
if (packageEnd < 0) packageEnd = lines.length;
const versionLines = lines.flatMap((line, index) =>
  index > packageStart && index < packageEnd && /^\s*version\s*=\s*"[^"]+"/.test(line) ? [index] : [],
);
if (versionLines.length !== 1) throw new Error("Expected one literal Cargo package version");

// Validate every input before writing. A BSD/GNU sed mismatch previously left
// CARGO_PKG_VERSION at the stable version while the app advertised a nightly.
readFileSync(frontendPath, "utf8");
config.version = version;
lines[versionLines[0]] = lines[versionLines[0]].replace(/^(\s*version\s*=\s*)"[^"]+"/, `$1"${version}"`);
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
writeFileSync(cargoPath, lines.join("\n"));
writeFileSync(frontendPath, `export const APP_VERSION = "${version}";\n`);
console.log(`Patched Tauri, Cargo and frontend versions to ${version}`);
