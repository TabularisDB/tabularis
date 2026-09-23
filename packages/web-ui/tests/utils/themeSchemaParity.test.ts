import { describe, expect, it } from "vitest";
import packageSchema from "../../src/schemas/theme-package-v1.json";
import registryExtensions from "../../src/schemas/theme-registry-extensions-v1.json";

/** The runtime fields shared with Tabularium have one definition. The host
 * schema must match what the registry merges into its kind=theme manifest schema. */
describe("theme package schema ownership", () => {
  it("keeps runtime fields identical to the registry extensions", () => {
    for (const [field, definition] of Object.entries(registryExtensions)) {
      const { required, ...shared } = definition as { required?: boolean } & Record<string, unknown>;
      expect(packageSchema.properties).toHaveProperty(field);
      expect((packageSchema.properties as Record<string, unknown>)[field]).toEqual(shared);
      if (required) expect(packageSchema.required).toContain(field);
    }
  });
  it("validates identity and runtime fields only, tolerating registry metadata", () => {
    expect(packageSchema.additionalProperties).toBe(true);
    expect(Object.keys(packageSchema.properties).sort()).toEqual(
      ["$schema", "id", "kind", "min_runtime_version", "name", "theme_schema_version", "theme_variants", "version"],
    );
    for (const catalogField of ["description", "tags", "license", "screenshots", "homepage", "support"]) {
      expect(packageSchema.properties).not.toHaveProperty(catalogField);
    }
  });
});
