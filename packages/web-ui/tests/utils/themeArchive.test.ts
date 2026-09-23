import { describe, expect, it } from "vitest";
import { createThemeArchive } from "../../src/utils/themeArchive";

const manifest = { name: "test-theme", version: "1.0.0", kind: "theme", min_runtime_version: "0.24.0", theme_schema_version: 1, theme_variants: [{ id: "dark", name: "Dark", file: "themes/dark.json" }] };
const files = () => new Map([[".tabularium", JSON.stringify(manifest)], ["themes/dark.json", '{"schemaVersion":1,"mode":"dark"}']]);

describe("createThemeArchive", () => {
  it("produces byte-identical sorted stored ZIPs independent of map insertion order", () => {
    const entries = files();
    const first = createThemeArchive(entries);
    expect(first).toEqual(createThemeArchive(new Map([...entries].reverse())));
    expect(new DataView(first.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(new DataView(first.buffer).getUint32(first.length - 22, true)).toBe(0x06054b50);
    expect(new TextDecoder().decode(first)).toContain("themes/dark.json");
  });
  it("refuses executable/unexpected payloads and missing definitions", () => {
    const unexpected = files(); unexpected.set("main.js", "execute()");
    expect(() => createThemeArchive(unexpected)).toThrow("Unsupported package path");
    const missing = files(); missing.delete("themes/dark.json");
    expect(() => createThemeArchive(missing)).toThrow();
  });
  it("validates actual source, duplicate decoded keys and metadata limits", () => {
    for (const source of ['{"schemaVersion":1,"mode":"dark","mode":"light"}', '{"schemaVersion":1,"mode":"dark","script":"x"}']) {
      const bad = files(); bad.set("themes/dark.json", source); expect(() => createThemeArchive(bad)).toThrow();
    }
    const large = files(); large.set("README.md", "a".repeat(262145)); expect(() => createThemeArchive(large)).toThrow("limit");
  });
  it("rejects traversal and case-colliding manifest paths", () => {
    for (const file of ["../escape.json", "C:/escape.json", "themes/CON.json"]) {
      const bad = files(); bad.set(".tabularium", JSON.stringify({ ...manifest, theme_variants: [{ ...manifest.theme_variants[0], file }] }));
      expect(() => createThemeArchive(bad)).toThrow();
    }
  });
});
