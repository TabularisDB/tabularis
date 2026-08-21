import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SshAskpassRequest } from "../types/askpass";

const REQUEST_EVENT = "ssh-askpass://request";
const DISMISS_EVENT = "ssh-askpass://dismiss";

export interface UseSshAskpassResult {
  /** Oldest pending prompt, shown one at a time. */
  current: SshAskpassRequest | null;
  /** Answer a secret/confirm prompt; `null` means the user cancelled. */
  respond: (id: number, response: string | null) => Promise<void>;
  /** Remove a prompt locally without answering (notify modals). */
  dismiss: (id: number) => void;
}

/**
 * Queue of SSH askpass prompts emitted by the backend while a system `ssh`
 * process is authenticating (key passphrases, security-key PINs, presence
 * notifications). Mounted once at the App level via `SshAskpassGate`.
 */
export function useSshAskpass(): UseSshAskpassResult {
  const [queue, setQueue] = useState<SshAskpassRequest[]>([]);

  useEffect(() => {
    const unlistenRequest = listen<SshAskpassRequest>(REQUEST_EVENT, (event) => {
      setQueue((prev) => [...prev, event.payload]);
    });
    // The backend dismisses prompts that timed out or whose security-key
    // notification was satisfied (key touched).
    const unlistenDismiss = listen<number>(DISMISS_EVENT, (event) => {
      setQueue((prev) => prev.filter((r) => r.id !== event.payload));
    });
    return () => {
      unlistenRequest.then((fn) => fn()).catch(() => {});
      unlistenDismiss.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const respond = useCallback(async (id: number, response: string | null) => {
    setQueue((prev) => prev.filter((r) => r.id !== id));
    await invoke("respond_ssh_askpass", { id, response });
  }, []);

  const dismiss = useCallback((id: number) => {
    setQueue((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { current: queue[0] ?? null, respond, dismiss };
}
