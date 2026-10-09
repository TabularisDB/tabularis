export type CreateTableTarget =
  | { kind: "connection"; schema: null }
  | { kind: "schema"; schema: string }
  | { kind: "database"; schema: string };

export type CreateTableRefreshPlan =
  | { scope: "connection"; schema: null }
  | { scope: "schema"; schema: string }
  | { scope: "database"; schema: string };

export const DEFAULT_CREATE_TABLE_TARGET: CreateTableTarget = { kind: "connection", schema: null };

export function getCreateTableRefreshPlan(target: CreateTableTarget): CreateTableRefreshPlan {
  if (target.kind === "schema") {
    return { scope: "schema", schema: target.schema };
  }

  if (target.kind === "database") {
    return { scope: "database", schema: target.schema };
  }

  return { scope: "connection", schema: null };
}

/**
 * Import from Clipboard writes into the active schema (the active database in the
 * multi-database layout), so it refreshes the same tree Create Table would there.
 */
export function getClipboardImportTarget(
  activeSchema: string | null,
  layout: { schemaLayout: boolean; multiDatabaseLayout: boolean },
): CreateTableTarget {
  if (activeSchema && layout.schemaLayout) {
    return { kind: "schema", schema: activeSchema };
  }

  if (activeSchema && layout.multiDatabaseLayout) {
    return { kind: "database", schema: activeSchema };
  }

  return DEFAULT_CREATE_TABLE_TARGET;
}

export function resolveCreateTableSchema(
  schemaOverride: string | null | undefined,
  activeSchema: string | null,
): string | null {
  return schemaOverride === undefined ? activeSchema : schemaOverride;
}
