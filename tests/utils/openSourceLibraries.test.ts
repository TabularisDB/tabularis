import { describe, expect, it } from "vitest";
import {
  getOpenSourceLibraryTotal,
  getOpenSourceLibraryUrl,
  OPEN_SOURCE_LIBRARY_SECTIONS,
} from "../../src/utils/openSourceLibraries";

describe("openSourceLibraries", () => {
  it("should expose all direct dependencies declared by the project manifests", () => {
    expect(OPEN_SOURCE_LIBRARY_SECTIONS).toHaveLength(4);
    expect(getOpenSourceLibraryTotal()).toBe(92);
  });

  it("should keep section counts aligned with manifest groups", () => {
    const counts = Object.fromEntries(
      OPEN_SOURCE_LIBRARY_SECTIONS.map((section) => [
        section.id,
        section.libraries.length,
      ]),
    );

    expect(counts).toEqual({
      "npm-runtime": 29,
      "npm-tooling": 24,
      "cargo-runtime": 37,
      "cargo-tooling": 2,
    });
  });

  it("should build external package links for each ecosystem", () => {
    expect(getOpenSourceLibraryUrl("npm", "@tauri-apps/api")).toBe(
      "https://www.npmjs.com/package/%40tauri-apps%2Fapi",
    );
    expect(getOpenSourceLibraryUrl("cargo", "sqlx")).toBe(
      "https://crates.io/crates/sqlx",
    );
  });
});
