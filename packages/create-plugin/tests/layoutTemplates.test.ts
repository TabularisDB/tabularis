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
});
