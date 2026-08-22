import { describe, expect, it, vi } from "vitest";
import type { TabularisClient } from "../../src/api/client";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
import {
  prepareDatabaseImportSource,
  runDatabaseDump,
} from "../../src/utils/databaseTransfers";

function asClient(value: object): TabularisClient {
  return value as unknown as TabularisClient;
}

function asPlatform(value: object): PlatformCapabilities {
  return value as unknown as PlatformCapabilities;
}

describe("databaseTransfers", () => {
  it("uploads browser imports with a purpose-bound opaque token", async () => {
    const uploadFile = vi.fn().mockResolvedValue({ token: "upload-token" });
    const readInputBlob = vi.fn().mockResolvedValue(new Blob(["SELECT 1;"]));

    await expect(
      prepareDatabaseImportSource(
        asClient({ uploadFile }),
        asPlatform({
          negotiation: { environment: "browser" },
          readInputBlob,
        }),
        { name: "backup.sql", reference: "browser-file:1" },
      ),
    ).resolves.toEqual({ uploadToken: "upload-token" });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "backup.sql",
        purpose: "database-import",
      }),
    );
  });

  it("keeps desktop import paths local to the Tauri adapter", async () => {
    await expect(
      prepareDatabaseImportSource(
        asClient({}),
        asPlatform({ negotiation: { environment: "tauri" } }),
        { name: "backup.sql", reference: "/tmp/backup.sql" },
      ),
    ).resolves.toEqual({ filePath: "/tmp/backup.sql" });
  });

  it("requests and saves a streamed browser dump download", async () => {
    const call = vi.fn().mockResolvedValue({
      kind: "download",
      fileName: "database.sql",
      mimeType: "application/sql",
      token: "download-token",
      size: 42,
    });
    const requestDownload = vi.fn().mockResolvedValue(undefined);

    await expect(
      runDatabaseDump(
        asClient({ call, requestDownload }),
        asPlatform({ negotiation: { environment: "browser" } }),
        {
          connectionId: "connection-1",
          options: { structure: true, data: true, tables: ["users"] },
        },
        "database.sql",
      ),
    ).resolves.toBe(true);

    expect(call).toHaveBeenCalledWith("dump_database", {
      connectionId: "connection-1",
      options: { structure: true, data: true, tables: ["users"] },
    }, expect.any(Object));
    expect(requestDownload).toHaveBeenCalledWith("download-token");
  });

  it("uses a native save target without exposing a browser download", async () => {
    const chooseSaveTarget = vi
      .fn()
      .mockResolvedValue({ reference: "/tmp/database.sql" });
    const call = vi.fn().mockResolvedValue(null);

    await expect(
      runDatabaseDump(
        asClient({ call }),
        asPlatform({
          negotiation: { environment: "tauri" },
          chooseSaveTarget,
        }),
        {
          connectionId: "connection-1",
          options: { structure: true, data: false },
        },
        "database.sql",
      ),
    ).resolves.toBe(true);

    expect(call).toHaveBeenCalledWith(
      "dump_database",
      expect.objectContaining({ filePath: "/tmp/database.sql" }),
      expect.any(Object),
    );
  });
});
