import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isVersionAtMost,
  isVersionNewer,
} from "@/utils/versionCompare";

describe("versionCompare", () => {
  it("compares semver components numerically", () => {
    expect(compareVersions("0.10.0", "0.9.21")).toBeGreaterThan(0);
    expect(compareVersions("0.9.21", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.10.0")).toBe(0);
  });

  it("detects newer versions without lexicographic ordering", () => {
    expect(isVersionNewer("0.10.0", "0.9.21")).toBe(true);
    expect(isVersionNewer("0.9.21", "0.10.0")).toBe(false);
  });

  it("supports upper-bound checks for installed app versions", () => {
    expect(isVersionAtMost("0.10.0", "0.10.0")).toBe(true);
    expect(isVersionAtMost("0.10.1", "0.10.0")).toBe(false);
  });
});
