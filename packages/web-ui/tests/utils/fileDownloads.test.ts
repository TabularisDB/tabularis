import { describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
import {
  downloadGeneratedFile,
  downloadTextFile,
} from "../../src/utils/fileDownloads";

function fixture() {
  const requestDownload = vi.fn().mockResolvedValue(undefined);
  const downloadFile = vi.fn().mockResolvedValue(true);
  return {
    client: { requestDownload } as unknown as TabularisClient,
    platform: { downloadFile } as unknown as PlatformCapabilities,
    requestDownload,
    downloadFile,
  };
}

describe("fileDownloads", () => {
  it("starts token downloads without buffering their contents in the UI", async () => {
    const { client, platform, requestDownload, downloadFile } = fixture();

    await expect(
      downloadGeneratedFile(client, platform, {
        kind: "download",
        fileName: "large.csv",
        mimeType: "text/csv",
        token: "opaque-token",
        size: 50_000_000,
      }),
    ).resolves.toBe(true);

    expect(requestDownload).toHaveBeenCalledWith("opaque-token");
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("encodes inline text through the semantic platform capability", async () => {
    const { platform, downloadFile } = fixture();
    await downloadTextFile(platform, {
      fileName: "schema.dbml",
      contents: "Table users {}",
      mimeType: "text/plain",
      filters: [{ name: "DBML", extensions: ["dbml"] }],
    });

    expect(downloadFile).toHaveBeenCalledWith({
      fileName: "schema.dbml",
      contents: new TextEncoder().encode("Table users {}"),
      mimeType: "text/plain",
      title: undefined,
      filters: [{ name: "DBML", extensions: ["dbml"] }],
    });
  });
});
