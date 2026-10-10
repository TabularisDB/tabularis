import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
const platform = vi.hoisted(() => ({ notify: vi.fn().mockResolvedValue({ status: "sent" }) }));
vi.mock("../../src/platform/activeCapabilities", () => ({
  getActivePlatformCapabilitiesOrNull: () => platform as unknown as PlatformCapabilities,
}));
const CONTENT = { title: "Query finished", body: "tab · 25.00 s" };
async function importQueryNotification() { return import("../../src/utils/queryNotification"); }
describe("queryNotification", () => {
  beforeEach(() => { vi.clearAllMocks(); });
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
    it("notifies through the active platform when unfocused", async () => {
      const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
      try {
        const { notifyQueryFinished } = await importQueryNotification();
        await notifyQueryFinished({ durationMs: 25000, content: CONTENT });
        expect(platform.notify).toHaveBeenCalledWith(CONTENT);
        focus.mockReturnValue(true);
        await notifyQueryFinished({ durationMs: 25000, content: CONTENT });
        expect(platform.notify).toHaveBeenCalledOnce();
      } finally { focus.mockRestore(); }
    });
    it("skips disabled or short queries", async () => {
      const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
      try {
        const { notifyQueryFinished } = await importQueryNotification();
        await notifyQueryFinished({ durationMs: 1000, content: CONTENT });
        await notifyQueryFinished({ enabled: false, durationMs: 25000, content: CONTENT });
        expect(platform.notify).not.toHaveBeenCalled();
      } finally { focus.mockRestore(); }
    });
    it("treats a failed focus probe as unfocused", async () => {
      const focus = vi.spyOn(document, "hasFocus").mockImplementation(() => { throw new Error("unavailable"); });
      try {
        const { notifyQueryFinished } = await importQueryNotification();
        await notifyQueryFinished({ durationMs: 25000, content: CONTENT });
        expect(platform.notify).toHaveBeenCalledWith(CONTENT);
      } finally { focus.mockRestore(); }
    });
    it("never lets notification failures break query execution", async () => {
      const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
      platform.notify.mockRejectedValueOnce(new Error("denied"));
      try {
        const { notifyQueryFinished } = await importQueryNotification();
        await expect(notifyQueryFinished({ durationMs: 25000, content: CONTENT })).resolves.toBeUndefined();
      } finally { focus.mockRestore(); }
    });
  });
});
