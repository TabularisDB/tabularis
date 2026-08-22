import { useCallback, useEffect, useState } from "react";

import type { RegistryPluginWithStatus } from "../types/plugins";
import { toErrorMessage } from "../utils/errors";
import { useTabularisClient } from "./useTabularisClient";

export function usePluginRegistry(): {
  plugins: RegistryPluginWithStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const client = useTabularisClient();
  const [plugins, setPlugins] = useState<RegistryPluginWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    client.call("fetch_plugin_registry", undefined)
      .then((result) => {
        setPlugins(result);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(toErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [client]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  return { plugins, loading, error, refresh };
}
