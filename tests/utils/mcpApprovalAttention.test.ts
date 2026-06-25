import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

const getCurrentWindow = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  UserAttentionType: {
    Critical: 1,
    Informational: 2,
  },
  getCurrentWindow,
}));

describe("mcpApprovalAttention", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("restores minimized and hidden state after approval attention", async () => {
    const appWindow = {
      isAlwaysOnTop: vi.fn().mockResolvedValue(false),
      isVisible: vi.fn().mockResolvedValue(false),
      isMinimized: vi.fn().mockResolvedValue(true),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      minimize: vi.fn().mockResolvedValue(undefined),
      unminimize: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
      requestUserAttention: vi.fn().mockResolvedValue(undefined),
    };
    getCurrentWindow.mockReturnValue(appWindow);

    const attention = await import("../../src/utils/mcpApprovalAttention");

    await attention.focusWindowForApproval("approval-1");
    await attention.restoreWindowAlwaysOnTop("approval-1");

    expect(appWindow.show).toHaveBeenCalledTimes(1);
    expect(appWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(appWindow.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true);
    expect(appWindow.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false);
    expect(appWindow.minimize).toHaveBeenCalledTimes(1);
    expect(appWindow.hide).toHaveBeenCalledTimes(1);
  });

  it("does not force top-most when always-on-top snapshot capture fails", async () => {
    const appWindow = {
      isAlwaysOnTop: vi.fn().mockRejectedValue(new Error("boom")),
      isVisible: vi.fn().mockResolvedValue(true),
      isMinimized: vi.fn().mockResolvedValue(false),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      minimize: vi.fn().mockResolvedValue(undefined),
      unminimize: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
      requestUserAttention: vi.fn().mockResolvedValue(undefined),
    };
    getCurrentWindow.mockReturnValue(appWindow);

    const attention = await import("../../src/utils/mcpApprovalAttention");

    await attention.focusWindowForApproval("approval-2");
    await attention.restoreWindowAlwaysOnTop("approval-2");

    expect(appWindow.show).toHaveBeenCalledTimes(1);
    expect(appWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(appWindow.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(appWindow.requestUserAttention).toHaveBeenCalledTimes(1);
  });

  it("preserves partial window snapshots and retries failed restores", async () => {
    const appWindow = {
      isAlwaysOnTop: vi.fn().mockRejectedValue(new Error("boom")),
      isVisible: vi.fn().mockResolvedValue(false),
      isMinimized: vi.fn().mockResolvedValue(true),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi
        .fn()
        .mockRejectedValueOnce(new Error("hide failed"))
        .mockResolvedValue(undefined),
      minimize: vi
        .fn()
        .mockRejectedValueOnce(new Error("minimize failed"))
        .mockResolvedValue(undefined),
      unminimize: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
      requestUserAttention: vi.fn().mockResolvedValue(undefined),
    };
    getCurrentWindow.mockReturnValue(appWindow);

    const attention = await import("../../src/utils/mcpApprovalAttention");

    await attention.focusWindowForApproval("approval-partial");
    await attention.restoreWindowAlwaysOnTop("approval-partial");

    expect(appWindow.show).toHaveBeenCalledTimes(1);
    expect(appWindow.unminimize).toHaveBeenCalledTimes(1);
    expect(appWindow.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(appWindow.minimize).toHaveBeenCalledTimes(1);
    expect(appWindow.hide).toHaveBeenCalledTimes(1);

    await attention.restoreWindowAlwaysOnTop("approval-partial");

    expect(appWindow.minimize).toHaveBeenCalledTimes(2);
    expect(appWindow.hide).toHaveBeenCalledTimes(2);
  });

  it("sends native notifications and still plays the short alert sound", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.mocked(requestPermission).mockResolvedValue("granted");
    vi.mocked(sendNotification).mockResolvedValue(undefined);

    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const connect = vi.fn();
    const start = vi.fn();
    const stop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const oscillator = {
      type: "",
      frequency: { setValueAtTime },
      connect,
      start,
      stop,
      onended: null as (() => void) | null,
    };
    const gainNode = {
      gain: {
        setValueAtTime,
        exponentialRampToValueAtTime,
      },
      connect,
    };
    const createOscillator = vi.fn(() => oscillator);
    const createGain = vi.fn(() => gainNode);
    const audioContext = vi.fn().mockImplementation(function () {
      return {
      currentTime: 0,
      destination: {},
      createOscillator,
      createGain,
      close,
      };
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: audioContext,
    });

    const attention = await import("../../src/utils/mcpApprovalAttention");

    await attention.notifyApprovalRequest({
      title: "Approval needed",
      body: "Review pending approval",
    });

    expect(sendNotification).toHaveBeenCalledWith({
      title: "Approval needed",
      body: "Review pending approval",
    });
    expect(audioContext).toHaveBeenCalledTimes(1);
    expect(createOscillator).toHaveBeenCalledTimes(1);
    expect(createGain).toHaveBeenCalledTimes(1);
  });

  it("plays the OS notification sound on Linux instead of the autoplay-blocked web audio tone", async () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Linux x86_64",
    });

    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.mocked(requestPermission).mockResolvedValue("granted");
    vi.mocked(sendNotification).mockResolvedValue(undefined);

    const audioContext = vi.fn();
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: audioContext,
    });

    const attention = await import("../../src/utils/mcpApprovalAttention");

    await attention.notifyApprovalRequest({
      title: "Approval needed",
      body: "Review pending approval",
    });

    expect(sendNotification).toHaveBeenCalledWith({
      title: "Approval needed",
      body: "Review pending approval",
      sound: "message-new-instant",
    });
    // WebKitGTK keeps the programmatic AudioContext suspended, so on Linux we
    // rely on the OS notification sound and never attempt the in-page tone.
    expect(audioContext).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("still plays the short alert sound when notification permission is denied", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("denied");

    const createOscillator = vi.fn(() => ({
      type: "",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    }));
    const createGain = vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }));
    const audioContext = vi.fn().mockImplementation(function () {
      return {
      currentTime: 0,
      destination: {},
      createOscillator,
      createGain,
      close: vi.fn().mockResolvedValue(undefined),
      };
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: audioContext,
    });

    const attention = await import("../../src/utils/mcpApprovalAttention");

    await attention.notifyApprovalRequest({
      title: "Approval needed",
      body: "Review pending approval",
    });

    expect(sendNotification).not.toHaveBeenCalled();
    expect(audioContext).toHaveBeenCalledTimes(1);
    expect(createOscillator).toHaveBeenCalledTimes(1);
  });

  it("captures fresh snapshot when approval ID changes (prevents stale snapshot)", async () => {
    const appWindow = {
      isAlwaysOnTop: vi.fn().mockResolvedValue(false),
      isVisible: vi.fn().mockResolvedValue(true),
      isMinimized: vi.fn().mockResolvedValue(false),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      minimize: vi.fn().mockResolvedValue(undefined),
      unminimize: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
      requestUserAttention: vi.fn().mockResolvedValue(undefined),
    };
    getCurrentWindow.mockReturnValue(appWindow);

    const attention = await import("../../src/utils/mcpApprovalAttention");

    // First approval: normal flow, snapshot captured
    await attention.focusWindowForApproval("approval-A");

    expect(appWindow.isAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(appWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);

    // Partially restore: setAlwaysOnTop fails, leaving residual snapshot state
    appWindow.setAlwaysOnTop.mockRejectedValueOnce(new Error("restore failed"));
    await attention.restoreWindowAlwaysOnTop("approval-A");

    // reset calls for second approval
    appWindow.isAlwaysOnTop.mockClear();
    appWindow.isVisible.mockClear();
    appWindow.isMinimized.mockClear();
    appWindow.setAlwaysOnTop.mockClear();
    appWindow.show.mockClear();
    appWindow.setFocus.mockClear();
    appWindow.requestUserAttention.mockClear();

    // Second approval with different ID: should capture a fresh snapshot
    // instead of using stale residual snapshot from the failed restore
    appWindow.isAlwaysOnTop.mockResolvedValue(true); // window currently on top
    await attention.focusWindowForApproval("approval-B");

    // Fresh snapshot was captured isAlwaysOnTop was called during capture
    expect(appWindow.isAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(appWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);

    // Restore should work correctly with the fresh snapshot
    await attention.restoreWindowAlwaysOnTop("approval-B");

    expect(appWindow.setAlwaysOnTop).toHaveBeenCalledWith(true); // restored to true
  });

  it("resumes suspended audio contexts before playing the short alert sound", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.mocked(sendNotification).mockResolvedValue(undefined);

    const setValueAtTime = vi.fn();
    const exponentialRampToValueAtTime = vi.fn();
    const connect = vi.fn();
    const start = vi.fn();
    const stop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn();
    const oscillator = {
      type: "",
      frequency: { setValueAtTime },
      connect,
      start,
      stop,
      onended: null as (() => void) | null,
    };
    const gainNode = {
      gain: {
        setValueAtTime,
        exponentialRampToValueAtTime,
      },
      connect,
    };
    const audioContext = vi.fn().mockImplementation(function () {
      return {
        currentTime: 0,
        destination: {},
        state: "suspended",
        createOscillator: vi.fn(() => oscillator),
        createGain: vi.fn(() => gainNode),
        resume: resume.mockImplementation(function (this: { state: string }) {
          this.state = "running";
          return Promise.resolve();
        }),
        close,
      };
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: audioContext,
    });

    const attention = await import("../../src/utils/mcpApprovalAttention");

    await attention.notifyApprovalRequest({
      title: "Approval needed",
      body: "Review pending approval",
    });

    await Promise.resolve();

    expect(resume).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
