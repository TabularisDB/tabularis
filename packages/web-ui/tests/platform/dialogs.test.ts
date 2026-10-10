import { describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
import {
  choosePlatformSavePath,
  choosePlatformServerPath,
  confirmPlatformDialog,
} from "../../src/platform/dialogs";

function platformFixture(
  overrides: Partial<PlatformCapabilities>,
): PlatformCapabilities {
  return {
    supports: vi.fn(() => true),
    negotiation: {
      environment: "browser",
      capabilities: {
        chooseServerPath: {
          supported: false,
          adaptation: "unsupported",
          reason: "Server path selection is unavailable",
        },
        chooseSaveTarget: {
          supported: false,
          adaptation: "unsupported",
          reason: "Browser downloads replace save paths",
        },
      },
    },
    ...overrides,
  } as unknown as PlatformCapabilities;
}

describe("platform dialogs", () => {
  it("provides an accessible message when server paths are unavailable", async () => {
    const showMessage = vi.fn().mockResolvedValue(undefined);
    const platform = platformFixture({
      supports: vi.fn(() => false),
      showMessage,
    });

    await expect(
      choosePlatformServerPath(platform, { directory: true }),
    ).resolves.toBeNull();
    await expect(choosePlatformSavePath(platform)).resolves.toBeNull();

    expect(showMessage).toHaveBeenNthCalledWith(1, {
      message: "Server path selection is unavailable",
      kind: "info",
    });
    expect(showMessage).toHaveBeenNthCalledWith(2, {
      message: "Browser downloads replace save paths",
      kind: "info",
    });
  });

  it("normalizes native confirmation options", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const platform = platformFixture({ confirm });

    await expect(
      confirmPlatformDialog(platform, "Drop table?", {
        title: "Warning",
        kind: "warning",
      }),
    ).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith({
      message: "Drop table?",
      title: "Warning",
      kind: "warning",
    });
  });
});
