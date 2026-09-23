import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { PluginRegistryContext } from "./PluginRegistryContext";
import { useSettings } from "../hooks/useSettings";
import { useTabularisClient } from "../hooks/useTabularisClient";
import type { RegistryPluginWithStatus } from "../types/plugins";
import { toErrorMessage } from "../utils/errors";
import { getPluginUpdates } from "../utils/pluginUpdates";
import { APP_VERSION } from "../version";

export function PluginRegistryProvider({ children }: { children: ReactNode }) {
  const { settings, isLoading: settingsLoading } = useSettings();
  const client = useTabularisClient();
  const [plugins, setPlugins] = useState<RegistryPluginWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(() => {
    const request = ++requestId.current;
    // Defer state changes so this can also run from startup/config effects.
    void Promise.resolve().then(async () => {
      if (request !== requestId.current) return;
      setLoading(true);
      setError(null);
      try {
        const result = await client.call("fetch_plugin_registry", undefined);
        if (request === requestId.current) setPlugins(result);
      } catch (err) {
        if (request === requestId.current) setError(toErrorMessage(err));
      } finally {
        if (request === requestId.current) setLoading(false);
      }
    });
  }, [client]);

  useEffect(() => {
    if (settingsLoading) return;
    refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh, settingsLoading, settings.tabulariumRegistryUrl]);

  useEffect(() => {
    let mounted = true;
    const subscriptions = [
      "tabularis://plugin-installed",
      "tabularis://plugin-activated",
    ].map((event) =>
      listen(event, () => {
        if (mounted) refresh();
      }),
    );
    for (const subscription of subscriptions) {
      void subscription.catch((err) =>
        console.warn("Failed to subscribe to plugin changes:", err),
      );
    }
    return () => {
      mounted = false;
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, [refresh]);

  const updates = useMemo(
    () => getPluginUpdates(plugins, APP_VERSION),
    [plugins],
  );
  const value = useMemo(
    () => ({ plugins, updates, loading, error, refresh }),
    [plugins, updates, loading, error, refresh],
  );

  return (
    <PluginRegistryContext.Provider value={value}>
      {children}
    </PluginRegistryContext.Provider>
  );
}
