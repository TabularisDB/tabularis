import { describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import type { GeneratedFile } from "../../src/api/contract";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
import {
  prepareConnectionImportFile,
  saveGeneratedFile,
} from "../../src/utils/connectionFiles";

function platform(
  environment: "tauri" | "browser",
): PlatformCapabilities {
  return {
    negotiation: {
      environment,
      capabilities: {} as PlatformCapabilities["negotiation"]["capabilities"],
    },
    readInputFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    downloadFile: vi.fn().mockResolvedValue(true),
  } as unknown as PlatformCapabilities;
}

describe("connectionFiles", () => {
  it("keeps desktop import paths on the native side", async () => {
    const capabilities = platform("tauri");
    const client = {} as TabularisClient;

    await expect(
      prepareConnectionImportFile(client, capabilities, {
        name: "connections.json",
        reference: "/tmp/connections.json",
      }),
    ).resolves.toEqual({ kind: "serverPath", path: "/tmp/connections.json" });
    expect(capabilities.readInputFile).not.toHaveBeenCalled();
  });

  it("uploads browser files behind a purpose-bound opaque token", async () => {
    const capabilities = platform("browser");
    const uploadFile = vi.fn().mockResolvedValue({ token: "upload-token" });
    const client = { uploadFile } as unknown as TabularisClient;

    await expect(
      prepareConnectionImportFile(client, capabilities, {
        name: "connections.json",
        reference: "browser-file:1",
      }),
    ).resolves.toEqual({ kind: "upload", token: "upload-token" });
    expect(uploadFile).toHaveBeenCalledWith({
      contents: expect.any(Blob),
      fileName: "connections.json",
      purpose: "connection-import",
    });
  });

  it("consumes server-generated downloads without exposing server paths", async () => {
    const capabilities = platform("browser");
    const consumeDownload = vi
      .fn()
      .mockResolvedValue(new Blob(["encrypted"], { type: "application/json" }));
    const client = { consumeDownload } as unknown as TabularisClient;
    const generated: GeneratedFile = {
      kind: "download",
      fileName: "tabularis-connections.json",
      mimeType: "application/json",
      token: "download-token",
      size: 9,
    };

    await expect(
      saveGeneratedFile(client, capabilities, generated),
    ).resolves.toBe(true);
    expect(consumeDownload).toHaveBeenCalledWith("download-token");
    expect(capabilities.downloadFile).toHaveBeenCalledWith({
      fileName: "tabularis-connections.json",
      mimeType: "application/json",
      contents: expect.any(Uint8Array),
    });
  });
});
