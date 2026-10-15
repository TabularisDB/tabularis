import { describe, expect, it } from "vitest";
import vectors from "../../../../tests/fixtures/themes/validation-v1.json";
import { parseThemeDefinition, parseThemePackageManifest } from "../../src/utils/themePackageValidation";

describe("shared native/frontend v1 validation vectors", () => {
  it.each(vectors)("$kind: $name", ({ source, kind, valid }) => {
    const parse = () => kind === "definition" ? parseThemeDefinition(source) : parseThemePackageManifest(source);
    if (valid) expect(parse).not.toThrow();
    else expect(parse).toThrow();
  });
});
