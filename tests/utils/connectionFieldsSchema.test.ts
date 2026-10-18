import { describe, expect, it } from "vitest";
import manifestSchema from "../../plugins/manifest.schema.json";
import extensionsSchema from "../../plugins/tabularium-extensions.schema.json";

const FIELDS = ["host", "port", "username", "password", "database"];

describe("connection_fields manifest contract", () => {
  it("declares optional per-field overrides in the runtime manifest schema", () => {
    const connectionFields = manifestSchema.properties.connection_fields;
    expect(connectionFields.type).toBe("object");
    expect(connectionFields.additionalProperties).toBe(false);
    const [pattern, override] = Object.entries(connectionFields.patternProperties)[0];
    for (const field of FIELDS) {
      expect(new RegExp(pattern).test(field)).toBe(true);
    }
    expect(new RegExp(pattern).test("ssh_host")).toBe(false);
    expect(Object.keys(override.properties)).toEqual(["hidden", "label", "placeholder"]);
    expect(override.properties.hidden.default).toBe(false);
    expect(manifestSchema.required).not.toContain("connection_fields");
  });

  it("declares the same overrides in the Tabularium extension schema", () => {
    const connectionFields = extensionsSchema.properties.connection_fields;
    expect(connectionFields.additionalProperties).toBe(false);
    expect(Object.keys(connectionFields.properties)).toEqual(FIELDS);
    for (const field of FIELDS) {
      const override =
        connectionFields.properties[field as keyof typeof connectionFields.properties];
      expect(override.additionalProperties).toBe(false);
      expect(Object.keys(override.properties)).toEqual(["hidden", "label", "placeholder"]);
    }
  });
});
