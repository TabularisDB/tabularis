import { describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities } from "../../src/platform/capabilities";
import { openSqlFile, saveSqlFile } from "../../src/utils/sqlFileTransfer";

const filters = [{ name: "SQL", extensions: ["sql"] }];

function platformFixture(serverFiles: boolean) {
  return {
    supports: vi.fn((capability: string) =>
      capability === "chooseServerPath" || capability === "chooseSaveTarget"
        ? serverFiles
        : true,
    ),
    chooseServerPath: vi.fn().mockResolvedValue({ reference: "/srv/q.sql" }),
    chooseSaveTarget: vi.fn().mockResolvedValue({ reference: "/srv/new.sql" }),
    chooseInputFile: vi.fn().mockResolvedValue({ name: "local.sql", reference: "browser-file:1" }),
    readInputFile: vi.fn().mockResolvedValue(new TextEncoder().encode("select 1")),
    downloadFile: vi.fn().mockResolvedValue(true),
    showMessage: vi.fn(),
  };
}

function clientFixture() {
  return { call: vi.fn(async (command: string) => (command === "read_sql_file" ? "select 2" : undefined)) };
}

const asPlatform = (value: ReturnType<typeof platformFixture>) =>
  value as unknown as PlatformCapabilities;

describe("openSqlFile", () => {
  it("reads a host or server path through the backend", async () => {
    const platform = platformFixture(true);
    const client = clientFixture();
    await expect(openSqlFile(asPlatform(platform), client, filters)).resolves.toEqual({
      kind: "path",
      path: "/srv/q.sql",
      query: "select 2",
    });
    expect(platform.chooseServerPath).toHaveBeenCalledWith({ kind: "file", filters });
    expect(client.call).toHaveBeenCalledWith("read_sql_file", { path: "/srv/q.sql" });
  });

  it("falls back to a browser upload without server file browsing", async () => {
    const platform = platformFixture(false);
    const client = clientFixture();
    await expect(openSqlFile(asPlatform(platform), client, filters)).resolves.toEqual({
      kind: "upload",
      name: "local.sql",
      query: "select 1",
    });
    expect(client.call).not.toHaveBeenCalled();
  });

  it("returns null when the picker is cancelled", async () => {
    const platform = platformFixture(true);
    platform.chooseServerPath.mockResolvedValue(null);
    await expect(openSqlFile(asPlatform(platform), clientFixture(), filters)).resolves.toBeNull();
  });
});

describe("saveSqlFile", () => {
  it("writes back to the known path without asking", async () => {
    const platform = platformFixture(true);
    const client = clientFixture();
    await expect(
      saveSqlFile(asPlatform(platform), client, {
        query: "select 3",
        title: "q.sql",
        sourceFilePath: "/srv/q.sql",
        filters,
      }),
    ).resolves.toEqual({ kind: "path", path: "/srv/q.sql" });
    expect(platform.chooseSaveTarget).not.toHaveBeenCalled();
    expect(client.call).toHaveBeenCalledWith("write_sql_file", { path: "/srv/q.sql", content: "select 3" });
  });

  it("asks for a target on save as", async () => {
    const platform = platformFixture(true);
    const client = clientFixture();
    await expect(
      saveSqlFile(asPlatform(platform), client, {
        query: "select 3",
        title: "q.sql",
        sourceFilePath: "/srv/q.sql",
        saveAs: true,
        filters,
      }),
    ).resolves.toEqual({ kind: "path", path: "/srv/new.sql" });
    expect(platform.chooseSaveTarget).toHaveBeenCalledWith({ suggestedName: "/srv/q.sql", filters });
  });

  it("downloads the file in a browser without server file browsing", async () => {
    const platform = platformFixture(false);
    const client = clientFixture();
    await expect(
      saveSqlFile(asPlatform(platform), client, { query: "select 4", title: "Console", filters }),
    ).resolves.toEqual({ kind: "download" });
    expect(platform.downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "Console.sql", mimeType: "application/sql" }),
    );
    expect(client.call).not.toHaveBeenCalled();
  });
});
