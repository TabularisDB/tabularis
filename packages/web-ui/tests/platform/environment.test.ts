import { isTauri } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { detectPlatformEnvironment } from "../../src/platform/environment";

describe("detectPlatformEnvironment", () => {
  it("uses the centralized Tauri runtime probe", () => {
    const tauriProbe = vi.fn().mockReturnValue(true);
    const browserProbe = vi.fn().mockReturnValue(false);

    expect(detectPlatformEnvironment(tauriProbe)).toBe("tauri");
    expect(detectPlatformEnvironment(browserProbe)).toBe("browser");
    expect(tauriProbe).toHaveBeenCalledOnce();
    expect(browserProbe).toHaveBeenCalledOnce();
  });

  it("uses the Tauri API as its default runtime probe", () => {
    vi.mocked(isTauri).mockReturnValueOnce(false);

    expect(detectPlatformEnvironment()).toBe("browser");
    expect(isTauri).toHaveBeenCalledOnce();
  });
});
