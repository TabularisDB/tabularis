import { describe, expect, it } from "vitest";
import { isProductionConnection } from "../../src/utils/environment";

describe("environment", () => {
  describe("isProductionConnection", () => {
    const connections = [
      { id: "dev", environment: "development" as const },
      { id: "prod", environment: "production" as const },
      { id: "plain" },
    ];

    it("returns true for the matching production connection", () => {
      expect(isProductionConnection(connections, "prod")).toBe(true);
    });

    it("returns false for non-production, missing, and empty connection ids", () => {
      expect(isProductionConnection(connections, "dev")).toBe(false);
      expect(isProductionConnection(connections, "missing")).toBe(false);
      expect(isProductionConnection(connections, null)).toBe(false);
      expect(isProductionConnection(connections, undefined)).toBe(false);
    });
  });
});
