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

export function resolveCreateTableSchema(
  schemaOverride: string | null | undefined,
  activeSchema: string | null,
): string | null {
  return schemaOverride === undefined ? activeSchema : schemaOverride;
}
