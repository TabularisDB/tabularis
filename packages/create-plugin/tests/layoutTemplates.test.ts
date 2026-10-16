import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const recipes = readFileSync(new URL("../templates/rust-driver/justfile.tmpl", import.meta.url), "utf8");

describe("driver development installation layout", () => {
  it("installs only into the driver kind on Linux and macOS", () => {
    expect(recipes).toContain("~/.local/share/tabularis/plugins/drivers/${ID}");
    expect(recipes).toContain("$HOME/Library/Application Support/tabularis/plugins/drivers/${ID}");
    expect(recipes).not.toContain("plugins/${ID}");
  });

  it("uses the driver kind on Windows too", () => {
    expect(recipes).toContain('"tabularis\\plugins\\drivers\\${ID}"');
    expect(recipes).not.toContain('"tabularis\\plugins\\${ID}"');
  });

  it("copies the binary from Cargo's real target directory, not a hard-coded target/", () => {
    expect(recipes).not.toContain("target/debug/");
    expect(recipes).not.toContain("target\\debug\\");
    // Unix recipes read target_directory from `cargo metadata`, which honours
    // CARGO_TARGET_DIR and `build.target-dir`.
    expect(recipes.match(/cargo metadata --format-version 1 --no-deps \| sed/g)).toHaveLength(2);
    expect(recipes).toContain('cp "$target_dir/debug/${BIN_NAME}"');
    // Windows does the same lookup with ConvertFrom-Json in a single line, since
    // just runs every recipe line in its own shell.
    expect(recipes).toContain(
      '(cargo metadata --format-version 1 --no-deps | ConvertFrom-Json).target_directory "debug\\${BIN_NAME}.exe"',
    );
  });

  it("copies locales when present on Linux, macOS, and Windows", () => {
    expect(recipes).toContain("@if [ -d locales ]; then");
    expect(recipes).toContain("~/.local/share/tabularis/plugins/drivers/${ID}/locales");
    expect(recipes).toContain('"$HOME/Library/Application Support/tabularis/plugins/drivers/${ID}/locales"');
    expect(recipes).toContain('if (Test-Path "locales")');
    expect(recipes).toContain('(Join-Path $dest "locales")');
  });
});
