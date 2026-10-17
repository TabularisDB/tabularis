import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const recipes = readFileSync(new URL("../templates/rust-driver/justfile.tmpl", import.meta.url), "utf8");

interface Recipe {
  name: string;
  attributes: string[];
  body: string[];
}

/** The `[windows]` recipes of a justfile, with their attributes and body lines. */
function windowsRecipes(source: string): Recipe[] {
  const lines = source.split("\n");
  const found: Recipe[] = [];
  let attributes: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const attribute = /^\[(.+)\]$/.exec(lines[i]);
    if (attribute) {
      attributes.push(attribute[1]);
      continue;
    }
    const header = /^([a-z][\w-]*)\s*:(?!=)/.exec(lines[i]);
    if (header && attributes.includes("windows")) {
      const body: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) body.push(lines[++i]);
      found.push({ name: header[1], attributes, body });
    }
    attributes = [];
  }
  return found;
}

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
    // Windows does the same lookup with ConvertFrom-Json.
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

describe("Windows recipes", () => {
  const windows = windowsRecipes(recipes);

  it("finds the Windows recipes", () => {
    expect(windows.map((recipe) => recipe.name)).toEqual(["build-ui", "dev-install", "uninstall"]);
  });

  // just runs each line of a plain recipe in a fresh shell, so `$dest` and
  // multi-line `if { ... }` blocks only work when the recipe is one script.
  // Indented lines in a plain recipe even stop the justfile from loading.
  it("runs every multi-line Windows recipe as a single PowerShell script", () => {
    for (const recipe of windows.filter((r) => r.body.length > 1)) {
      expect(recipe.attributes, recipe.name).toContain("script");
    }
  });

  it("runs script recipes with Windows PowerShell and stops on the first error", () => {
    expect(recipes).toContain(
      'set script-interpreter := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]',
    );
    for (const recipe of windows.filter((r) => r.attributes.includes("script"))) {
      expect(recipe.body[0], recipe.name).toBe('    $ErrorActionPreference = "Stop"');
    }
  });
});
