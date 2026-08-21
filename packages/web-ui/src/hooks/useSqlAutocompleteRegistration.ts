import { useEffect } from "react";
import type { Monaco } from "@monaco-editor/react";
import { loader } from "@monaco-editor/react";
import { useDatabase } from "./useDatabase";
import { usesMultiDatabaseLayout } from "../utils/database";
import { registerSqlAutocomplete, disposeSqlAutocomplete } from "../utils/autocomplete";

type Options = {
  monaco?: Monaco | null;
  schema?: string | null;
  /** When false, skips registration (e.g. inactive notebook tabs). Defaults to true. */
  enabled?: boolean;
};

/**
 * Keeps the global SQL completion provider in sync with the active connection.
 * Pass `monaco` from the main editor when available; otherwise Monaco is loaded via loader.init (notebook).
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
    selectedDatabases,
  } = useDatabase();

  const schema = options?.schema ?? activeSchema;
  const defaultNamespace =
    schema ?? (activeCapabilities?.schemas === true ? null : activeDatabaseName);
  const isMultiDb = usesMultiDatabaseLayout(activeCapabilities, selectedDatabases);

  const enabled = options?.enabled ?? true;

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
      if (activeCapabilities?.schemas && schema) {
        effectiveTables = (schemaDataMap[schema]?.tables ?? tables).map(
          (table) => ({ ...table, schema: table.schema ?? schema }),
        );
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
    };

    const cleanup = () => {
      cancelled = true;
      disposeSqlAutocomplete();
    };

    if (options?.monaco) {
      register(options.monaco);
      return cleanup;
    }

    loader.init().then((monaco) => register(monaco));
    return cleanup;
  }, [
    connectionId,
    enabled,
    options?.monaco,
    schema,
    defaultNamespace,
    tables,
    activeDriver,
    activeCapabilities,
    schemaDataMap,
    databaseDataMap,
    isMultiDb,
    selectedDatabases,
  ]);
}
