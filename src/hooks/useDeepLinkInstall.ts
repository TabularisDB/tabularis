import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

/**
 * Payload emitted by the Rust backend when the OS hands us a
 * `tabularis://install/<slug>?version=&registry=` URL. Field names match
 * the camelCased Serde rename of `plugins::deep_link::PluginInstallRequest`.
 */
export interface DeepLinkInstallRequest {
  slug: string;
  version?: string | null;
  registry?: string | null;
}

const EVENT_NAME = "tabularis://plugin-install";

interface UseDeepLinkInstallResult {
  pending: DeepLinkInstallRequest | null;
  /** Run the install on the backend and resolve `true` on success. */
  confirm: () => Promise<boolean>;
  /** Dismiss without installing. */
  cancel: () => void;
  /** Latest error from a `confirm()` call. Cleared on `cancel()` / next event. */
  error: string | null;
  /** True while `confirm()` is running. */
  busy: boolean;
}

/**
 * Subscribes to `tabularis://plugin-install` Tauri events and exposes the
 * pending install request to a confirmation modal. The hook intentionally
 * does NOT auto-install — every deep-link arrival requires an explicit
 * user click so a malicious URL can't trigger a silent install.
 */
export function useDeepLinkInstall(): UseDeepLinkInstallResult {
  const [pending, setPending] = useState<DeepLinkInstallRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cleanup: UnlistenFn | null = null;
    let mounted = true;

    // Live event listener for warm handoffs — a tabularis:// URL clicked
    // while the app is already running fires here.
    listen<DeepLinkInstallRequest>(EVENT_NAME, (event) => {
      if (!mounted) return;
      setError(null);
      setPending(event.payload);
    })
      .then((unlisten) => {
        if (mounted) {
          cleanup = unlisten;
        } else {
          unlisten();
        }
      })
      .catch((err) => {
        console.warn(`Failed to subscribe to ${EVENT_NAME}:`, err);
      });

    // Cold-start replay: when the OS launched Tabularis *because of* the
    // tabularis:// URL, the event was emitted before this listener existed.
    // The Rust side stashes it in app state; we drain it here.
    invoke<DeepLinkInstallRequest | null>("consume_pending_deep_link_install")
      .then((req) => {
        if (!mounted || !req) return;
        setError(null);
        setPending((current) => current ?? req);
      })
      .catch((err) => {
        console.warn("consume_pending_deep_link_install failed:", err);
      });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, []);

  const cancel = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  const confirm = useCallback(async (): Promise<boolean> => {
    if (!pending) return false;
    setBusy(true);
    setError(null);
    try {
      await invoke("install_plugin", {
        pluginId: pending.slug,
        version: pending.version ?? null,
      });
      // Tell anything observing the plugin catalogue (PluginsTab, drivers
      // list) to refresh. Components subscribe to this in their own effects.
      void emit("tabularis://plugin-installed", { slug: pending.slug });
      setPending(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [pending]);

  return { pending, confirm, cancel, error, busy };
}
