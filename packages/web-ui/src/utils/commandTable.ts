import type { TableTarget } from "../types/databaseObjects";
import type { Tab } from "../types/editor";

interface ResolveCommandTableOptions {
  pathname: string;
  activeConnectionId: string | null;
  activeSchema: string | null;
  activeTab: Pick<Tab, "type" | "activeTable" | "schema"> | null;
}

export function resolveCommandTable({
  activeConnectionId,
  activeSchema,
  activeTab,
  pathname,
}: ResolveCommandTableOptions): TableTarget | null {
  if (
    pathname !== "/editor" ||
    activeConnectionId === null ||
    activeTab?.type !== "table" ||
    activeTab.activeTable === null
  ) {
    return null;
  }

  return {
    connectionId: activeConnectionId,
    tableName: activeTab.activeTable,
    schema: activeTab.schema ?? activeSchema ?? undefined,
  };
}
