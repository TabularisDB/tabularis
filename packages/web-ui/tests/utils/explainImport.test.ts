import { describe, it, expect } from "vitest";
import {
  getExplainFileName,
  parseExplainFileParam,
  looksLikePostgresExplainJson,
} from "../../src/utils/explainImport";

describe("explainImport", () => {
  describe("getExplainFileName", () => {
    it("returns filename from POSIX path", () => {
      expect(getExplainFileName("/home/debba/Scaricati/Firefox/vNGHw7JB.txt")).toBe(
        "vNGHw7JB.txt",
      );
    });

    it("returns filename from Windows path", () => {
      expect(getExplainFileName("C:\\Users\\foo\\plan.json")).toBe("plan.json");
    });

    it("returns the original string when no separator present", () => {
      expect(getExplainFileName("plan.json")).toBe("plan.json");
    });

    it("returns empty string for empty input", () => {
      expect(getExplainFileName("")).toBe("");
    });

    it("handles trailing slash", () => {
      // trailing slash means no filename → empty tail
      expect(getExplainFileName("/tmp/")).toBe("");
    });
  });

  describe("parseExplainFileParam", () => {
    it("reads the file param", () => {
      expect(parseExplainFileParam("?file=/tmp/plan.json")).toBe("/tmp/plan.json");
    });

    it("decodes percent-encoded paths", () => {
      expect(parseExplainFileParam("?file=%2Ftmp%2Fplan%20with%20space.json")).toBe(
        "/tmp/plan with space.json",
      );
    });

    it("returns null when param missing", () => {
      expect(parseExplainFileParam("?other=1")).toBeNull();
    });

    it("returns null for empty param", () => {
      expect(parseExplainFileParam("?file=")).toBeNull();
    });

    it("returns null for whitespace-only param", () => {
      expect(parseExplainFileParam("?file=%20%20")).toBeNull();
    });

    it("accepts a bare search string (no leading ?)", () => {
      expect(parseExplainFileParam("file=/tmp/a.json")).toBe("/tmp/a.json");
    });
  });

  describe("looksLikePostgresExplainJson", () => {
    it("accepts a JSON array", () => {
      expect(looksLikePostgresExplainJson("  [\n  { }\n]")).toBe(true);
    });

    it("accepts a JSON object", () => {
      expect(looksLikePostgresExplainJson("{\"Plan\": {}}")).toBe(true);
    });

    it("rejects plain text", () => {
      expect(looksLikePostgresExplainJson("Seq Scan on users")).toBe(false);
    });

    it("rejects empty strings", () => {
      expect(looksLikePostgresExplainJson("")).toBe(false);
    });
  });
});
