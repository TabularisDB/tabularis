import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import schema from "../../src/schemas/theme-snapshot-v1.json";
import vectors from "../../../../tests/fixtures/themes/snapshot-editor-vectors.json";
import legacy from "../../../../tests/fixtures/themes/legacy-frontend.json";

const validate = new Ajv({ strict: false }).compile(schema);
describe("portable snapshot public schema", () => {
  it.each(vectors)("agrees with native editor vector: $name", ({ valid, editor }) => {
    expect(validate({ themeSnapshotVersion: 1, source: JSON.stringify(legacy), editor })).toBe(valid);
  });
  it("rejects unsupported versions and top-level ownership claims", () => {
    const snapshot = { themeSnapshotVersion: 1, source: JSON.stringify(legacy), editor: { base: "vs-dark", inherit: true } };
    expect(validate(snapshot)).toBe(true);
    expect(validate({ ...snapshot, themeSnapshotVersion: 2 })).toBe(false);
    expect(validate({ ...snapshot, readOnly: false })).toBe(false);
  });
});
