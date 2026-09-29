import { describe, expect, it } from "vitest";
import manifestSchema from "../../plugins/manifest.schema.json";
import extensionsSchema from "../../plugins/tabularium-extensions.schema.json";

describe("table query template manifest contract", () => {
  for (const [name, schema] of Object.entries({ manifestSchema, extensionsSchema })) {
    it(`declares an optional, default-false capability in ${name}`, () => {
      const capabilities = schema.properties.capabilities;
      expect(capabilities.properties.table_query_templates).toMatchObject({
        type: "boolean",
        default: false,
      });
      if ("required" in capabilities) {
        expect(capabilities.required).not.toContain("table_query_templates");
      }
    });
  }
});
