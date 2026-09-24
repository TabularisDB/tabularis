import { invoke } from "@tauri-apps/api/core";

export type TableQueryTab = "select-all" | "select-fields" | "update" | "delete";
export type TableQueryTemplates = Partial<Record<TableQueryTab, string | null>>;

export interface TableQueryTemplateRequest {
  table: string;
  schema: string | null;
  kind: "select" | "update" | "delete";
  columns: string[];
  limit: number | null;
}

/** Only call for opted-in drivers. A null response selects the legacy template;
 * errors must propagate instead of silently substituting another dialect. */
export async function loadTableQueryTemplates(
  connectionId: string,
  table: string,
  schema: string | undefined,
  columns: string[],
): Promise<TableQueryTemplates> {
  const tabs: TableQueryTab[] = ["select-all", "select-fields", "update", "delete"];
  const entries = await Promise.all(tabs.map(async (tab) => {
    const request: TableQueryTemplateRequest = {
      table,
      schema: schema ?? null,
      kind: tab === "select-all" || tab === "select-fields" ? "select" : tab,
      columns: tab === "select-fields" || tab === "update" ? columns : [],
      limit: tab === "select-fields" ? 100 : null,
    };
    const sql = await invoke<string | null>("get_table_query_template", { connectionId, request });
    return [tab, sql] as const;
  }));
  return Object.fromEntries(entries);
}
