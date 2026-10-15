import { afterEach, describe, expect, it, vi } from "vitest";
import { isLinuxDesktop } from "../../src/utils/systemTheme";

describe("isLinuxDesktop", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["Mozilla/5.0 (X11; Linux x86_64)", true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X)", false],
    ["Mozilla/5.0 (Windows NT 10.0)", false],
    ["Mozilla/5.0 (Linux; Android 15)", false],
  ])("classifies %s", (userAgent, expected) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
    expect(isLinuxDesktop()).toBe(expected);
  });
});
