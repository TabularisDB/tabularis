import type { Tab } from "../types/editor";

export function getSqlFileName(filePath: string): string {
  return filePath.split(/[/\\]/).filter(Boolean).pop() ?? "SQL File";
}

export function createSqlFileTab(
  filePath: string,
  query: string,
  schema?: string,
): Partial<Tab> {
  return {
    type: "console",
    title: getSqlFileName(filePath),
    query,
    sourceFilePath: filePath,
    sourceFileContent: query,
    sourceFileDirty: false,
    ...(schema ? { schema } : {}),
  };
}

/**
 * Tab fields after writing `savedContent` to `filePath`. The dirty flag is
 * recomputed against `currentQuery`, which may have moved on while the write
 * was in flight.
 */
export function savedSqlFileTab(
  filePath: string,
  savedContent: string,
  currentQuery: string = savedContent,
): Partial<Tab> {
  return {
    title: getSqlFileName(filePath),
    sourceFilePath: filePath,
    sourceFileContent: savedContent,
    sourceFileDirty: currentQuery !== savedContent,
  };
}

/**
 * Dirty means the editor text differs from what is on disk, so typing a
 * character and deleting it again leaves the file clean.
 */
export function isSqlFileDirty(
  tab: Pick<Tab, "sourceFilePath" | "sourceFileContent">,
  query: string,
): boolean {
  if (!tab.sourceFilePath) return false;
  return query !== (tab.sourceFileContent ?? "");
}

export function hasUnsavedSqlFileTabs(
  tabs: ReadonlyArray<
    Pick<Tab, "id" | "sourceFilePath" | "sourceFileDirty">
  >,
  tabIds: string[],
): boolean {
  const closingIds = new Set(tabIds);
  return tabs.some(
    (tab) =>
      closingIds.has(tab.id) &&
      Boolean(tab.sourceFilePath) &&
      tab.sourceFileDirty === true,
  );
}
