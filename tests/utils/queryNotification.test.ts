import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

const getCurrentWindow = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow,
}));

const CONTENT = { title: "Query finished", body: "tab · 25.00 s" };

async function importQueryNotification() {
  return await import("../../src/utils/queryNotification");
}

describe("queryNotification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  describe("shouldNotifyQueryFinished", () => {
    it("does not notify when the window is focused", async () => {
      const { shouldNotifyQueryFinished } = await importQueryNotification();
      expect(
        shouldNotifyQueryFinished({
          enabled: true,
          thresholdSec: 20,
          durationMs: 30000,
          windowFocused: true,
        }),
      ).toBe(false);
    });

    it("does not notify when the setting is disabled", async () => {
      const { shouldNotifyQueryFinished } = await importQueryNotification();
      expect(
        shouldNotifyQueryFinished({
          enabled: false,
          thresholdSec: 20,
          durationMs: 30000,
          windowFocused: false,
        }),
      ).toBe(false);
    });

    it("does not notify below the threshold", async () => {
      const { shouldNotifyQueryFinished } = await importQueryNotification();
      expect(
        shouldNotifyQueryFinished({
          enabled: true,
          thresholdSec: 20,
          durationMs: 19999,
          windowFocused: false,
        }),
      ).toBe(false);
    });

    it("notifies at the threshold", async () => {
      const { shouldNotifyQueryFinished } = await importQueryNotification();
      expect(
        shouldNotifyQueryFinished({
          enabled: true,
          thresholdSec: 20,
          durationMs: 20000,
          windowFocused: false,
        }),
      ).toBe(true);
    });

    it("notifies above the threshold", async () => {
      const { shouldNotifyQueryFinished } = await importQueryNotification();
      expect(
        shouldNotifyQueryFinished({
          enabled: true,
          thresholdSec: 20,
          durationMs: 60000,
          windowFocused: false,
        }),
      ).toBe(true);
    });

    it("treats an undefined enabled setting as on", async () => {
      const { shouldNotifyQueryFinished } = await importQueryNotification();
      expect(
        shouldNotifyQueryFinished({
          enabled: undefined,
          thresholdSec: 20,
          durationMs: 30000,
          windowFocused: false,
        }),
      ).toBe(true);
    });

    it.each([undefined, 0, -5, Number.NaN])(
      "falls back to the default 20s threshold when thresholdSec is %s",
      async (thresholdSec) => {
        const { shouldNotifyQueryFinished, DEFAULT_NOTIFY_THRESHOLD_SEC } =
          await importQueryNotification();

        expect(DEFAULT_NOTIFY_THRESHOLD_SEC).toBe(20);
        // Below 20s: no notification even with a broken threshold value.
        expect(
          shouldNotifyQueryFinished({
            enabled: true,
            thresholdSec,
            durationMs: 19999,
            windowFocused: false,
          }),
        ).toBe(false);
        // At 20s the default threshold applies.
        expect(
          shouldNotifyQueryFinished({
            enabled: true,
            thresholdSec,
            durationMs: 20000,
            windowFocused: false,
          }),
        ).toBe(true);
      },
    );
  });

  describe("notifyQueryFinished", () => {
    it("sends a notification when the window is unfocused and the query ran long", async () => {
      getCurrentWindow.mockReturnValue({
        isFocused: vi.fn().mockResolvedValue(false),
      });
      vi.mocked(isPermissionGranted).mockResolvedValue(true);
      vi.mocked(sendNotification).mockResolvedValue(undefined);

      const { notifyQueryFinished } = await importQueryNotification();

      await notifyQueryFinished({
        enabled: true,
        thresholdSec: 20,
        durationMs: 25000,
        content: CONTENT,
      });

      expect(getCurrentWindow).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledWith({
        title: "Query finished",
        body: "tab · 25.00 s",
      });
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it("does not send when the window is focused", async () => {
      getCurrentWindow.mockReturnValue({
        isFocused: vi.fn().mockResolvedValue(true),
      });
      vi.mocked(isPermissionGranted).mockResolvedValue(true);

      const { notifyQueryFinished } = await importQueryNotification();

      await notifyQueryFinished({
        enabled: true,
        thresholdSec: 20,
        durationMs: 25000,
        content: CONTENT,
      });

      expect(sendNotification).not.toHaveBeenCalled();
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it("does not send when the query finished below the threshold", async () => {
      getCurrentWindow.mockReturnValue({
        isFocused: vi.fn().mockResolvedValue(false),
      });
      vi.mocked(isPermissionGranted).mockResolvedValue(true);

      const { notifyQueryFinished } = await importQueryNotification();

      await notifyQueryFinished({
        enabled: true,
        thresholdSec: 20,
        durationMs: 2000,
        content: CONTENT,
      });

      expect(sendNotification).not.toHaveBeenCalled();
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it("requests permission when not granted and does not send when denied", async () => {
      getCurrentWindow.mockReturnValue({
        isFocused: vi.fn().mockResolvedValue(false),
      });
      vi.mocked(isPermissionGranted).mockResolvedValue(false);
      vi.mocked(requestPermission).mockResolvedValue("denied");

      const { notifyQueryFinished } = await importQueryNotification();

      await notifyQueryFinished({
        enabled: true,
        thresholdSec: 20,
        durationMs: 25000,
        content: CONTENT,
      });

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("sends after permission is granted on request", async () => {
      getCurrentWindow.mockReturnValue({
        isFocused: vi.fn().mockResolvedValue(false),
      });
      vi.mocked(isPermissionGranted).mockResolvedValue(false);
      vi.mocked(requestPermission).mockResolvedValue("granted");
      vi.mocked(sendNotification).mockResolvedValue(undefined);

      const { notifyQueryFinished } = await importQueryNotification();

      await notifyQueryFinished({
        enabled: true,
        thresholdSec: 20,
        durationMs: 25000,
        content: CONTENT,
      });

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it("treats a rejecting focus probe as unfocused and never throws", async () => {
      getCurrentWindow.mockReturnValue({
        isFocused: vi.fn().mockRejectedValue(new Error("boom")),
      });
      vi.mocked(isPermissionGranted).mockResolvedValue(true);
      vi.mocked(sendNotification).mockResolvedValue(undefined);

      const { notifyQueryFinished } = await importQueryNotification();

      await expect(
        notifyQueryFinished({
          enabled: true,
          thresholdSec: 20,
          durationMs: 25000,
          content: CONTENT,
        }),
      ).resolves.toBeUndefined();

      expect(sendNotification).toHaveBeenCalledTimes(1);
    });
  });
});
