import { useEffect } from "react";
import type { Monaco } from "@monaco-editor/react";
import { loader } from "@monaco-editor/react";
import { useDatabase } from "./useDatabase";
import { isMultiDatabaseCapable } from "../utils/database";
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
    activeCapabilities,
    schemaDataMap,
    databaseDataMap,
    selectedDatabases,
  } = useDatabase();

  const schema = options?.schema ?? activeSchema;
  const isMultiDb =
    isMultiDatabaseCapable(activeCapabilities) && selectedDatabases.length > 1;

  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!connectionId || !enabled) return;

    let cancelled = false;

    const register = (monaco: Monaco) => {
      if (cancelled) return;

      let effectiveTables = tables;
      if (activeCapabilities?.schemas && schema) {
        effectiveTables = schemaDataMap[schema]?.tables ?? tables;
      } else if (isMultiDb) {
        effectiveTables = selectedDatabases.flatMap(
          (db) => databaseDataMap[db]?.tables ?? [],
        );
      }

      registerSqlAutocomplete(
        monaco,
        connectionId,
        effectiveTables,
        schema,
        activeDriver ?? null,
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
    tables,
    activeDriver,
    activeCapabilities,
    schemaDataMap,
    databaseDataMap,
    isMultiDb,
    selectedDatabases,
  ]);
}
