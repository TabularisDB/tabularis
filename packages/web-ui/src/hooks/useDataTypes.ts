import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DataTypeRegistry } from "../types/dataTypes";

const dataTypesCache = new Map<string, DataTypeRegistry>();

export function useDataTypes(driver: string | undefined) {
  const [dataTypes, setDataTypes] = useState<DataTypeRegistry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!driver) {
      setDataTypes(null);
      setLoading(false);
      return;
    }

    const fetchDataTypes = async () => {
      try {
        setLoading(true);
        setError(null);

        if (dataTypesCache.has(driver)) {
          setDataTypes(dataTypesCache.get(driver)!);
          setLoading(false);
          return;
        }

        const registry = await invoke<DataTypeRegistry>("get_data_types", {
          driver,
        });

        dataTypesCache.set(driver, registry);
        setDataTypes(registry);
      } catch (err) {
        console.error("Failed to fetch data types:", err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    fetchDataTypes();
  }, [driver]);

  return { dataTypes, loading, error };
}
