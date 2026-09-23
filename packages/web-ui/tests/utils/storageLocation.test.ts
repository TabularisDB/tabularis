import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  defaultModeFor,
  pendingPathOf,
  getAppDataDir,
  resetAppDataDirCache,
  type StorageLocationInfo,
} from "../../src/utils/storageLocation";

const baseInfo: StorageLocationInfo = {
  currentPath: "/home/u/.config/tabularis",
  defaultPath: "/home/u/.config/tabularis",
  customPath: null,
  source: "default",
  restartRequired: false,
};

describe("storageLocation", () => {
  describe("defaultModeFor", () => {
    it("reuses data already present in the folder", () => {
      expect(
        defaultModeFor({ exists: true, isEmpty: false, hasTabularisData: true }),
      ).toBe("existing");
    });

    it("offers to copy into an empty or unrelated folder", () => {
      expect(
        defaultModeFor({ exists: true, isEmpty: true, hasTabularisData: false }),
      ).toBe("copy");
      expect(
        defaultModeFor({ exists: false, isEmpty: false, hasTabularisData: false }),
      ).toBe("copy");
      expect(
        defaultModeFor({ exists: true, isEmpty: false, hasTabularisData: false }),
      ).toBe("copy");
    });
  });

  describe("pendingPathOf", () => {
    it("returns null when no restart is pending", () => {
      expect(pendingPathOf(baseInfo)).toBeNull();
      expect(
        pendingPathOf({ ...baseInfo, customPath: "/x", source: "custom" }),
      ).toBeNull();
    });

    it("returns the recorded custom folder when one was just set", () => {
      expect(
        pendingPathOf({ ...baseInfo, customPath: "/sync/tabularis", restartRequired: true }),
      ).toBe("/sync/tabularis");
    });

    it("returns the default folder when the custom one was just cleared", () => {
      expect(
        pendingPathOf({
          ...baseInfo,
          currentPath: "/sync/tabularis",
          source: "custom",
          restartRequired: true,
        }),
      ).toBe("/home/u/.config/tabularis");
    });
  });

  describe("getAppDataDir", () => {
    beforeEach(() => {
      invokeMock.mockReset();
      resetAppDataDirCache();
    });

    it("invokes the backend once and caches the result", async () => {
      invokeMock.mockResolvedValue("/data/dir");
      await expect(getAppDataDir()).resolves.toBe("/data/dir");
      await expect(getAppDataDir()).resolves.toBe("/data/dir");
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith("get_app_data_dir");
    });

    it("does not cache a failure", async () => {
      invokeMock.mockRejectedValueOnce(new Error("boom"));
      await expect(getAppDataDir()).rejects.toThrow("boom");
      invokeMock.mockResolvedValueOnce("/data/dir");
      await expect(getAppDataDir()).resolves.toBe("/data/dir");
      expect(invokeMock).toHaveBeenCalledTimes(2);
    });
  });
});
