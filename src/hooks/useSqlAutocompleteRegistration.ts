import { useEffect } from "react";
import type { Monaco } from "@monaco-editor/react";
import { ensureMonaco } from "../utils/monaco";
import { useDatabase } from "./useDatabase";
import { usesMultiDatabaseLayout, isSchemaBasedMultiDb } from "../utils/database";
import { registerSqlAutocomplete, disposeSqlAutocomplete } from "../utils/autocomplete";

type Options = {
  monaco?: Monaco | null;
  schema?: string | null;
  /** The database the editor's tab is scoped to (nested multi-db). When set,
   * autocomplete reads tables from this database's nested schema data. */
  database?: string | null;
  /** When false, skips registration (e.g. inactive notebook tabs). Defaults to true. */
  enabled?: boolean;
};

/**
 * Keeps the global SQL completion provider in sync with the active connection.
 * Pass `monaco` from the main editor when available; otherwise load it on demand.
 */
export function useSqlAutocompleteRegistration(
  connectionId: string | null,
  options?: Options,
) {
  const {
    tables,
    activeDriver,
    activeSchema,
    activeDatabaseName,
    activeCapabilities,
    schemaDataMap,
    databaseDataMap,
    nestedDatabaseDataMap,
    selectedDatabases,
    loadNestedSchemaData,
  } = useDatabase();

  const schema = options?.schema ?? activeSchema;
  const tabDatabase = options?.database ?? null;
  const defaultNamespace =
    schema ?? (activeCapabilities?.schemas === true ? null : activeDatabaseName);
  const isMultiDb = usesMultiDatabaseLayout(activeCapabilities, selectedDatabases);
  const isNestedMultiDb = isSchemaBasedMultiDb(activeCapabilities, selectedDatabases);

  const enabled = options?.enabled ?? true;

  // For a nested multi-db console, the schema's tables may not be loaded yet
  // (opening a console doesn't expand the sidebar schema node). Trigger a
  // lazy load so autocomplete has tables to offer. The guard avoids redundant
  // fetches: only load when the schema data is missing or not yet loaded.
  useEffect(() => {
    if (!connectionId || !enabled || !isNestedMultiDb || !schema) return;
    const activeDb = tabDatabase ?? activeDatabaseName ?? selectedDatabases[0];
    if (!activeDb) return;
    const nestedDb = nestedDatabaseDataMap[activeDb];
    const schemaData = nestedDb?.schemaDataMap[schema];
    if (!schemaData || (!schemaData.isLoaded && !schemaData.isLoading)) {
      loadNestedSchemaData(activeDb, schema, connectionId);
    }
  }, [
    connectionId,
    enabled,
    isNestedMultiDb,
    schema,
    tabDatabase,
    activeDatabaseName,
    selectedDatabases,
    nestedDatabaseDataMap,
    loadNestedSchemaData,
  ]);

  useEffect(() => {
    if (!connectionId || !enabled) return;

    let cancelled = false;

    const register = (monaco: Monaco) => {
      if (cancelled) return;

      let effectiveTables = tables.map((table) =>
        defaultNamespace && !table.schema
          ? { ...table, schema: defaultNamespace }
          : table,
      );
      if (activeCapabilities?.schemas && schema && !isNestedMultiDb) {
        effectiveTables = (schemaDataMap[schema]?.tables ?? tables).map(
          (table) => ({ ...table, schema: table.schema ?? schema }),
        );
      } else if (isNestedMultiDb) {
        // Schema-based multi-db (PostgreSQL browsing several databases): each
        // database has its own schemaDataMap. Collect tables from the tab's
        // database (if set) or every selected database's active/chosen schema.
        // The flat databaseDataMap doesn't hold the nested schema -> table
        // structure, so nestedDatabaseDataMap is the right source.
        const dbs = tabDatabase ? [tabDatabase] : selectedDatabases;
        effectiveTables = dbs.flatMap((db) => {
          const nestedDb = nestedDatabaseDataMap[db];
          if (!nestedDb) return [];
          const targetSchema = schema ?? nestedDb.activeSchema ?? undefined;
          if (!targetSchema) return [];
          const schemaTables = nestedDb.schemaDataMap[targetSchema]?.tables ?? [];
          return schemaTables.map((table) => ({
            ...table,
            schema: table.schema ?? targetSchema,
          }));
        });
      } else if (isMultiDb) {
        effectiveTables = selectedDatabases.flatMap((db) =>
          (databaseDataMap[db]?.tables ?? []).map((table) => ({
            ...table,
            schema: table.schema ?? db,
          })),
        );
      }

      registerSqlAutocomplete(
        monaco,
        connectionId,
        effectiveTables,
        defaultNamespace,
        activeCapabilities ?? activeDriver ?? null,
      );

      // E2E: expose the effective tables for tauri-wd tests. The bug: this
      // hook reads databaseDataMap (not nestedDatabaseDataMap), so nested-database
      // tables (e.g. secondary-only tables) are missing from autocomplete.
      (window as unknown as Record<string, unknown>).__e2e_autocomplete_tables = effectiveTables;
    };

    const cleanup = () => {
      cancelled = true;
      disposeSqlAutocomplete();
    };

    if (options?.monaco) {
      register(options.monaco);
      return cleanup;
    }

    ensureMonaco().then(register).catch((error: unknown) => {
      console.error("Failed to initialize SQL autocomplete:", error);
    });
    return cleanup;
  }, [
    connectionId,
    enabled,
    options?.monaco,
    schema,
    tabDatabase,
    defaultNamespace,
    tables,
    activeDriver,
    activeCapabilities,
    schemaDataMap,
    databaseDataMap,
    nestedDatabaseDataMap,
    isMultiDb,
    isNestedMultiDb,
    selectedDatabases,
  ]);
}
