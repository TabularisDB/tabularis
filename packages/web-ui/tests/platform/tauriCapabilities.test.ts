import { describe, expect, it, vi } from "vitest";
import { createPlatformCapabilityNegotiation } from "../../src/platform/capabilities";
import {
  TauriPlatformCapabilities,
  type TauriPlatformOperations,
} from "../../src/platform/tauriCapabilities";

const createOperations = (): TauriPlatformOperations => ({
  chooseInputPath: vi.fn(),
  chooseSavePath: vi.fn(),
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
  writeFileContents: vi.fn(),
  openUrl: vi.fn(),
  isNotificationPermissionGranted: vi.fn(),
  requestNotificationPermission: vi.fn(),
  sendNotification: vi.fn(),
  openRoute: vi.fn(),
  closeRoute: vi.fn(),
  requestAttention: vi.fn(),
  restartApplication: vi.fn(),
});

describe("TauriPlatformCapabilities", () => {
  it("advertises every semantic capability as native", () => {
    const capabilities = new TauriPlatformCapabilities(createOperations());

    expect(capabilities.negotiation.environment).toBe("tauri");
    expect(
      Object.values(capabilities.negotiation.capabilities).every(
        (availability) =>
          availability.supported && availability.adaptation === "native",
      ),
    ).toBe(true);
    expect(capabilities.supports("chooseInputFile")).toBe(true);
  });

  it("normalizes Tauri input and save dialog paths as opaque references", async () => {
    const operations = createOperations();
    vi.mocked(operations.chooseInputPath).mockResolvedValue(
      "/tmp/example.sql",
    );
    vi.mocked(operations.chooseSavePath).mockResolvedValue(
      "/tmp/export.csv",
    );
    const capabilities = new TauriPlatformCapabilities(operations);

    await expect(
      capabilities.chooseInputFile({
        title: "Import",
        filters: [{ name: "SQL", extensions: ["sql"] }],
      }),
    ).resolves.toEqual({ name: "example.sql", reference: "/tmp/example.sql" });
    await expect(
      capabilities.chooseSaveTarget({ suggestedName: "export.csv" }),
    ).resolves.toEqual({ reference: "/tmp/export.csv" });
  });

  it("delegates clipboard, URL, route, attention, and restart operations", async () => {
    const operations = createOperations();
    vi.mocked(operations.readClipboardText).mockResolvedValue("SELECT 1");
    const capabilities = new TauriPlatformCapabilities(operations);

    await expect(capabilities.readClipboard()).resolves.toBe("SELECT 1");
    await capabilities.writeClipboard("SELECT 2");
    await capabilities.openExternalUrl("https://tabularis.dev");
    await capabilities.openRoute({
      route: "/results-window?tab=1",
      target: "new",
      label: "results-window-1",
    });
    await capabilities.closeRoute();
    await capabilities.requestAttention("critical");
    await capabilities.restartApplication();

    expect(operations.writeClipboardText).toHaveBeenCalledWith("SELECT 2");
    expect(operations.openUrl).toHaveBeenCalledWith("https://tabularis.dev");
    expect(operations.openRoute).toHaveBeenCalledWith({
      route: "/results-window?tab=1",
      target: "new",
      label: "results-window-1",
    });
    expect(operations.closeRoute).toHaveBeenCalledOnce();
    expect(operations.requestAttention).toHaveBeenCalledWith("critical");
    expect(operations.restartApplication).toHaveBeenCalledOnce();
  });

  it("writes downloads only after the user chooses a target", async () => {
    const operations = createOperations();
    vi.mocked(operations.chooseSavePath)
      .mockResolvedValueOnce("/tmp/data.csv")
      .mockResolvedValueOnce(null);
    const capabilities = new TauriPlatformCapabilities(operations);
    const contents = new Uint8Array([1, 2, 3]);

    await expect(
      capabilities.downloadFile({ fileName: "data.csv", contents }),
    ).resolves.toBe(true);
    await expect(
      capabilities.downloadFile({ fileName: "cancelled.csv", contents }),
    ).resolves.toBe(false);

    expect(operations.writeFileContents).toHaveBeenCalledOnce();
    expect(operations.writeFileContents).toHaveBeenCalledWith(
      "/tmp/data.csv",
      contents,
    );
  });

  it("negotiates notification permission without hiding denial", async () => {
    const operations = createOperations();
    vi.mocked(operations.isNotificationPermissionGranted)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(operations.requestNotificationPermission)
      .mockResolvedValueOnce("granted")
      .mockResolvedValueOnce("denied");
    const capabilities = new TauriPlatformCapabilities(operations);

    await expect(
      capabilities.notify({ title: "Ready", body: "Export complete" }),
    ).resolves.toBe("shown");
    await expect(
      capabilities.notify({ title: "Blocked" }),
    ).resolves.toBe("permission-denied");

    expect(operations.sendNotification).toHaveBeenCalledOnce();
    expect(operations.sendNotification).toHaveBeenCalledWith({
      title: "Ready",
      body: "Export complete",
    });
  });

  it("rejects calls disabled by negotiated capability flags", async () => {
    const operations = createOperations();
    const negotiation = createPlatformCapabilityNegotiation("tauri", {
      openExternalUrl: {
        supported: false,
        adaptation: "unsupported",
        reason: "Disabled for this session",
      },
    });
    const capabilities = new TauriPlatformCapabilities(
      operations,
      negotiation,
    );

    await expect(
      capabilities.openExternalUrl("https://tabularis.dev"),
    ).rejects.toMatchObject({
      code: "PLATFORM_CAPABILITY_UNSUPPORTED",
      capability: "openExternalUrl",
    });
    expect(operations.openUrl).not.toHaveBeenCalled();
  });
});
