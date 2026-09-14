import { useCallback, useEffect, useState } from "react";

import type { RegistryPluginWithStatus } from "../types/plugins";
import { toErrorMessage } from "../utils/errors";
import {
  fetchPluginRegistry,
  invalidatePluginRegistryCache,
} from "../utils/pluginRegistryFetch";

export function usePluginRegistry(): {
  plugins: RegistryPluginWithStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [plugins, setPlugins] = useState<RegistryPluginWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((force = false) => {
    if (force) {
      invalidatePluginRegistryCache();
    }
    return fetchPluginRegistry({ force })
      .then((result) => {
        setPlugins(result);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(toErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load(true);
  }, [load]);

  useEffect(() => {
    void load(false);
  }, [load]);

  return { plugins, loading, error, refresh };
}
