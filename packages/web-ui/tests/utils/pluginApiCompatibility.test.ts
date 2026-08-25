import { describe, expect, it } from "vitest";
import { isPluginApiCompatible } from "../../src/utils/pluginApiCompatibility";

describe("pluginApiCompatibility", () => {
  it("should accept legacy declarations and compatible patch versions", () => {
    expect(isPluginApiCompatible("0.1.1")).toBe(true);
    expect(isPluginApiCompatible("0.1.1", "0.1.0")).toBe(true);
    expect(isPluginApiCompatible("0.1.1", "0.1.1")).toBe(true);
  });

  it("should reject newer, incompatible, and malformed API versions", () => {
    expect(isPluginApiCompatible("0.1.1", "0.1.2")).toBe(false);
    expect(isPluginApiCompatible("0.1.1", "0.2.0")).toBe(false);
    expect(isPluginApiCompatible("1.2.0", "2.0.0")).toBe(false);
    expect(isPluginApiCompatible("0.1.1", "latest")).toBe(false);
  });

  it("should apply stable-major compatibility after version one", () => {
    expect(isPluginApiCompatible("1.3.0", "1.2.5")).toBe(true);
    expect(isPluginApiCompatible("1.2.0", "1.3.0")).toBe(false);
  });
});
