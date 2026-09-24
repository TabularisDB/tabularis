import { useCallback, useEffect, useState } from "react";
import type { SshAskpassRequest } from "../types/askpass";
import { useTabularisClient } from "./useTabularisClient";

const REQUEST_EVENT = "ssh-askpass://request" as const;
const DISMISS_EVENT = "ssh-askpass://dismiss" as const;

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
  const client = useTabularisClient();
  const [queue, setQueue] = useState<SshAskpassRequest[]>([]);

  useEffect(() => {
    const unlistenRequest = client.subscribe(REQUEST_EVENT, (payload) => {
      setQueue((prev) => [...prev, payload]);
    });
    // The backend dismisses prompts that timed out or whose security-key
    // notification was satisfied (key touched).
    const unlistenDismiss = client.subscribe(DISMISS_EVENT, (id) => {
      setQueue((prev) => prev.filter((request) => request.id !== id));
    });
    return () => {
      unlistenRequest.then((fn) => fn()).catch(() => {});
      unlistenDismiss.then((fn) => fn()).catch(() => {});
    };
  }, [client]);

  const respond = useCallback(async (id: number, response: string | null) => {
    setQueue((prev) => prev.filter((request) => request.id !== id));
    await client.call("respond_ssh_askpass", { id, response });
  }, [client]);

  const dismiss = useCallback((id: number) => {
    setQueue((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { current: queue[0] ?? null, respond, dismiss };
}
