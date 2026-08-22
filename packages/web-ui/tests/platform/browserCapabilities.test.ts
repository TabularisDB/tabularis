import { describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import { BrowserPlatformCapabilities } from "../../src/platform/browserCapabilities";

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
