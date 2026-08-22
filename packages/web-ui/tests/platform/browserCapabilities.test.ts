import { describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import { BrowserPlatformCapabilities } from "../../src/platform/browserCapabilities";
import { BROWSER_CAPABILITY_FALLBACK_EVENT } from "../../src/platform/browserFallbacks";

function clientFixture(overrides: Partial<TabularisClient>): TabularisClient {
  return overrides as TabularisClient;
}

const request = {
  connectionId: "connection-1",
  table: "files",
  colName: "payload",
  pkMap: { id: 1 },
};

describe("BrowserPlatformCapabilities secondary routes", () => {
  it("opens a standalone connection route in a browser tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const capabilities = new BrowserPlatformCapabilities(clientFixture({}));

    await capabilities.openConnectionRoute({
      connectionId: "connection/id",
      title: "Primary",
    });

    expect(open).toHaveBeenCalledWith(
      "/connections?connect=connection%2Fid&standalone=connection",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("shares typed route events between browser contexts", async () => {
    const publisher = new BrowserPlatformCapabilities(clientFixture({}));
    const subscriber = new BrowserPlatformCapabilities(clientFixture({}));
    const event = `secondary-route-test:${crypto.randomUUID()}`;
    let resolveReceived: (payload: { sessionId: string }) => void = () => {};
    const received = new Promise<{ sessionId: string }>((resolve) => {
      resolveReceived = resolve;
    });
    const unsubscribe = await subscriber.subscribeRouteEvent(
      event,
      resolveReceived,
    );

    await publisher.publishRouteEvent(event, { sessionId: "session-1" });

    await expect(received).resolves.toEqual({ sessionId: "session-1" });
    unsubscribe();
  });
});

describe("BrowserPlatformCapabilities browser adaptations", () => {
  it("advertises browser dialogs while keeping server paths explicit", () => {
    const capabilities = new BrowserPlatformCapabilities(clientFixture({}));

    expect(capabilities.supports("confirm")).toBe(true);
    expect(capabilities.supports("showMessage")).toBe(true);
    expect(capabilities.negotiation.capabilities.chooseServerPath).toEqual({
      supported: false,
      adaptation: "unsupported",
      reason: "Browsers cannot select paths on the Tabularis server",
    });
  });

  it("normalizes clipboard permission denial as a typed error", async () => {
    const clipboard = {
      readText: vi.fn().mockRejectedValue(
        new DOMException("Permission denied", "NotAllowedError"),
      ),
      writeText: vi.fn(),
    };
    vi.stubGlobal("navigator", { ...navigator, clipboard });
    const capabilities = new BrowserPlatformCapabilities(clientFixture({}));

    await expect(capabilities.readClipboard()).rejects.toMatchObject({
      code: "PLATFORM_CAPABILITY_PERMISSION_DENIED",
      capability: "readClipboard",
      environment: "browser",
    });

    vi.unstubAllGlobals();
  });

  it("uses browser-native accessible confirmation and message dialogs", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const capabilities = new BrowserPlatformCapabilities(clientFixture({}));

    await expect(
      capabilities.confirm({ message: "Drop table?", title: "Warning" }),
    ).resolves.toBe(true);
    await capabilities.showMessage({ message: "Export complete" });

    expect(confirm).toHaveBeenCalledWith("Warning\n\nDrop table?");
    expect(alert).toHaveBeenCalledWith("Export complete");
  });

  it("falls back in-app when browser notification permission is denied", async () => {
    class DeniedNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = vi.fn().mockImplementation(async () => {
        DeniedNotification.permission = "denied";
        return "denied" as NotificationPermission;
      });
    }
    vi.stubGlobal("Notification", DeniedNotification);
    const listener = vi.fn();
    window.addEventListener(BROWSER_CAPABILITY_FALLBACK_EVENT, listener);
    const capabilities = new BrowserPlatformCapabilities(clientFixture({}));

    await expect(
      capabilities.notify({ title: "Ready", body: "Export complete" }),
    ).resolves.toBe("permission-denied");
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      kind: "notification",
      title: "Ready",
      body: "Export complete",
    });

    window.removeEventListener(BROWSER_CAPABILITY_FALLBACK_EVENT, listener);
    vi.unstubAllGlobals();
  });

  it("publishes an accessible fallback when an external popup is blocked", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const listener = vi.fn();
    window.addEventListener(BROWSER_CAPABILITY_FALLBACK_EVENT, listener);
    const capabilities = new BrowserPlatformCapabilities(clientFixture({}));

    await capabilities.openExternalUrl("https://tabularis.dev");

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      kind: "external-url",
      url: "https://tabularis.dev/",
    });
    window.removeEventListener(BROWSER_CAPABILITY_FALLBACK_EVENT, listener);
    open.mockRestore();
  });
});

describe("BrowserPlatformCapabilities file transfers", () => {
  it("adapts browser-selected files to single-use opaque references", async () => {
    const file = {
      name: "analysis.tabularis-notebook",
      arrayBuffer: vi.fn().mockResolvedValue(
        new TextEncoder().encode("notebook contents").buffer,
      ),
    } as unknown as File;
    const filePicker = vi.fn().mockResolvedValue(file);
    const capabilities = new BrowserPlatformCapabilities(
      clientFixture({}),
      filePicker,
    );

    const selected = await capabilities.chooseInputFile({
      filters: [
        { name: "Tabularis Notebook", extensions: ["tabularis-notebook"] },
      ],
    });

    expect(selected?.name).toBe("analysis.tabularis-notebook");
    expect(selected?.reference).toMatch(/^browser-file:/);
    expect(selected?.reference).not.toContain("analysis.tabularis-notebook");
    expect(filePicker).toHaveBeenCalledWith(".tabularis-notebook");
    await expect(
      capabilities
        .readInputFile(selected?.reference ?? "")
        .then((contents) => Array.from(contents)),
    ).resolves.toEqual(Array.from(new TextEncoder().encode("notebook contents")));
    await expect(
      capabilities.readInputFile(selected?.reference ?? ""),
    ).rejects.toThrow("Invalid or expired browser file reference");
  });
});

describe("BrowserPlatformCapabilities BLOB transfers", () => {
  it("resolves session-scoped upload previews without exposing a path", async () => {
    const uploadedBlobUrl = vi.fn(
      (token: string) => `/api/v1/uploads/blobs/${token}`,
    );
    const capabilities = new BrowserPlatformCapabilities(
      clientFixture({ uploadedBlobUrl }),
    );

    await expect(
      capabilities.previewBlobReference(
        "BLOB_UPLOAD_REF:8:image/png:00000000-0000-4000-8000-000000000000",
      ),
    ).resolves.toBe(
      "/api/v1/uploads/blobs/00000000-0000-4000-8000-000000000000",
    );
    expect(uploadedBlobUrl).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000000",
    );
    await expect(
      capabilities.previewBlobReference("BLOB_UPLOAD_REF:4:text/plain:token"),
    ).resolves.toBeNull();
  });

  it("reads pending upload references through the authenticated transport", async () => {
    const readUploadedBlob = vi
      .fn()
      .mockResolvedValue(new Blob([new Uint8Array([0, 1, 2, 3])], { type: "image/png" }));
    const capabilities = new BrowserPlatformCapabilities(
      clientFixture({ readUploadedBlob }),
    );

    await expect(
      capabilities.fetchBlobReference(
        "BLOB_UPLOAD_REF:4:image/png:00000000-0000-4000-8000-000000000000",
      ),
    ).resolves.toEqual({
      contents: new Uint8Array([0, 1, 2, 3]),
      mimeType: "image/png",
    });
    expect(readUploadedBlob).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000000",
    );
  });

  it("consumes tokenized database downloads", async () => {
    const call = vi.fn().mockResolvedValue({
      kind: "download",
      token: "download-token",
      size: 4,
      mimeType: "application/octet-stream",
    });
    const consumeBlobDownload = vi
      .fn()
      .mockResolvedValue(new Blob([new Uint8Array([0, 1, 2, 3])]));
    const capabilities = new BrowserPlatformCapabilities(
      clientFixture({ call, consumeBlobDownload }),
    );

    await expect(capabilities.fetchDatabaseBlob(request)).resolves.toEqual({
      contents: new Uint8Array([0, 1, 2, 3]),
      mimeType: "application/octet-stream",
    });
    expect(call).toHaveBeenCalledWith("fetch_blob", request);
    expect(consumeBlobDownload).toHaveBeenCalledWith("download-token");
  });

  it("accepts inline BLOB responses for transport contract compatibility", async () => {
    const call = vi.fn().mockResolvedValue({
      kind: "inline",
      wireValue: "BLOB:4:application/octet-stream:AAECAw==",
    });
    const capabilities = new BrowserPlatformCapabilities(clientFixture({ call }));

    await expect(capabilities.fetchDatabaseBlob(request)).resolves.toEqual({
      contents: new Uint8Array([0, 1, 2, 3]),
      mimeType: "application/octet-stream",
    });
  });
});
