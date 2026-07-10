import { describe, it, expect } from "vitest";
import {
  binDirFromLink,
  pathExportLine,
  isForceableInstallError,
} from "../../src/utils/cli";

describe("cli", () => {
  describe("binDirFromLink", () => {
    it("returns the parent directory of the link", () => {
      expect(binDirFromLink("/usr/local/bin/tabularis")).toBe("/usr/local/bin");
      expect(binDirFromLink("/home/user/.local/bin/tabularis")).toBe(
        "/home/user/.local/bin",
      );
    });

    it("returns the input when there is no parent directory", () => {
      expect(binDirFromLink("tabularis")).toBe("tabularis");
      expect(binDirFromLink("/tabularis")).toBe("/tabularis");
    });
  });

  describe("pathExportLine", () => {
    it("builds an export line for the given directory", () => {
      expect(pathExportLine("/home/user/.local/bin")).toBe(
        'export PATH="/home/user/.local/bin:$PATH"',
      );
    });
  });

  describe("isForceableInstallError", () => {
    it("detects the foreign-entry error from the backend", () => {
      expect(
        isForceableInstallError(
          "/usr/local/bin/tabularis already exists (use --force to replace it)",
        ),
      ).toBe(true);
    });

    it("is false for unrelated errors", () => {
      expect(isForceableInstallError("permission denied")).toBe(false);
      expect(isForceableInstallError("")).toBe(false);
    });
  });
});
