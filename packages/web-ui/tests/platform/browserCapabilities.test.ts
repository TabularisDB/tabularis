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
