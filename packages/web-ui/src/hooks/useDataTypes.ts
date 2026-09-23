import { useContext, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DatabaseContext } from "../contexts/DatabaseContext";
import type { DataTypeRegistry } from "../types/dataTypes";

const dataTypesCache = new Map<string, DataTypeRegistry>();

export function useDataTypes(driver: string | undefined, connectionId?: string | null) {
  const context = useContext(DatabaseContext);
  const targetId = connectionId === undefined ? context?.activeConnectionId : connectionId;
  const connection = targetId ? context?.connectionDataMap[targetId] : undefined;
  const metadata = connection?.driver === driver ? connection?.metadata : undefined;
  const cached = driver ? dataTypesCache.get(driver) : undefined;
  const [result, setResult] = useState<{
    driver: string;
    dataTypes: DataTypeRegistry | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!driver || metadata || cached) return;
    let cancelled = false;
    const fetchDataTypes = async () => {
      try {
        const registry = await invoke<DataTypeRegistry>("get_data_types", { driver });
        dataTypesCache.set(driver, registry);
        if (!cancelled) setResult({ driver, dataTypes: registry, error: null });
      } catch (err) {
        if (!cancelled) setResult({ driver, dataTypes: null, error: String(err) });
      }
    };

    void fetchDataTypes();
    return () => { cancelled = true; };
  }, [driver, metadata, cached]);

  if (driver && metadata) {
    return {
      dataTypes: { driver, types: metadata.data_types },
      loading: false,
      error: null,
    };
  }
  const current = result?.driver === driver ? result : null;
  return {
    dataTypes: current?.dataTypes ?? cached ?? null,
    loading: Boolean(driver && !current && !cached),
    error: current?.error ?? null,
  };
}
