import { useCallback, useState } from "react";
import {
  PLUGIN_INSTALL_DEADLINE_MS,
  type PluginInstallRequest,
} from "../api/pluginLifecycle";
import { useTabularisClient } from "./useTabularisClient";

export interface PluginInstallConfirmation {
  confirm: (request: PluginInstallRequest | null) => Promise<boolean>;
  clearError: () => void;
  error: string | null;
  busy: boolean;
}

/** Executes a validated browser install request after explicit confirmation. */
export function usePluginInstallConfirmation(): PluginInstallConfirmation {
  const client = useTabularisClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clearError = useCallback(() => setError(null), []);
  const confirm = useCallback(
    async (request: PluginInstallRequest | null): Promise<boolean> => {
      if (!request) return false;
      setBusy(true);
      setError(null);
      try {
        await client.call(
          "install_plugin",
          {
            pluginId: request.slug,
            version: request.version ?? null,
            registryUrl: request.registry ?? null,
          },
          { deadlineMs: PLUGIN_INSTALL_DEADLINE_MS },
        );
        return true;
      } catch (installError) {
        setError(String(installError));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  return { confirm, clearError, error, busy };
}
