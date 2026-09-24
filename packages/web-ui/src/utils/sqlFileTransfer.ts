import type { TabularisClient } from "../api/client";
import type { PlatformCapabilities, PlatformFileFilter } from "../platform/capabilities";
import { choosePlatformSavePath, choosePlatformServerPath } from "../platform/dialogs";
import { getSqlFileName } from "./sqlFile";

type SqlFileClient = Pick<TabularisClient, "call">;

export type OpenedSqlFile =
  /** A host (desktop) or server (browser) path the tab can be saved back to. */
  | { readonly kind: "path"; readonly path: string; readonly query: string }
  /** A browser upload: there is no path to write back to. */
  | { readonly kind: "upload"; readonly name: string; readonly query: string };

export type SavedSqlFile =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "download" };

/**
 * Pick and read a SQL file. Desktop uses the native dialog, browsers use the
 * server file picker when the server exposes one and fall back to an upload.
 */
export async function openSqlFile(
  platform: PlatformCapabilities,
  client: SqlFileClient,
  filters: readonly PlatformFileFilter[],
): Promise<OpenedSqlFile | null> {
  if (!platform.supports("chooseServerPath")) {
    const selected = await platform.chooseInputFile({ filters });
    if (!selected) return null;
    const query = new TextDecoder().decode(
      await platform.readInputFile(selected.reference),
    );
    return { kind: "upload", name: selected.name, query };
  }

  const path = await choosePlatformServerPath(platform, { filters });
  if (!path) return null;
  return { kind: "path", path, query: await client.call("read_sql_file", { path }) };
}

interface SaveSqlFileRequest {
  readonly query: string;
  readonly title: string;
  readonly sourceFilePath?: string;
  readonly saveAs?: boolean;
  readonly filters: readonly PlatformFileFilter[];
}

/**
 * Write a SQL tab to its file, asking for a target when it has none (or on
 * "save as"). Browsers without server file browsing download the file.
 */
export async function saveSqlFile(
  platform: PlatformCapabilities,
  client: SqlFileClient,
  { query, title, sourceFilePath, saveAs = false, filters }: SaveSqlFileRequest,
): Promise<SavedSqlFile | null> {
  if (!platform.supports("chooseSaveTarget")) {
    const fileName = getSqlFileName(sourceFilePath ?? title);
    const saved = await platform.downloadFile({
      fileName: /\.(sql|psql|pgsql)$/i.test(fileName) ? fileName : `${fileName}.sql`,
      contents: new TextEncoder().encode(query),
      mimeType: "application/sql",
      filters,
    });
    return saved ? { kind: "download" } : null;
  }

  let path = sourceFilePath;
  if (saveAs || !path) {
    const selected = await choosePlatformSavePath(platform, {
      defaultPath: path ?? title,
      filters,
    });
    if (!selected) return null;
    path = selected;
  }
  await client.call("write_sql_file", { path, content: query });
  return { kind: "path", path };
}
