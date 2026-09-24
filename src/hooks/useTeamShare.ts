import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TeamShareStatus } from "../utils/teamShare";

/**
 * Team-share status for screens that need to know whether a connection is
 * shared and whether the vault is open.
 *
 * Refreshes itself on `team-share-synced`, so a share done from the
 * connections screen and one done from settings stay in agreement.
 */
export function useTeamShare() {
  const [status, setStatus] = useState<TeamShareStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<TeamShareStatus>("get_team_share_status"));
    } catch (e) {
      console.error("Failed to load the team share status:", e);
    }
  }, []);

  // One effect for both the first read and the subscription: the state is only
  // ever set from the promise callback, never synchronously while the effect
  // body runs.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      invoke<TeamShareStatus>("get_team_share_status")
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch((e) => {
          console.error("Failed to load the team share status:", e);
        });
    };
    load();
    const unlisten = listen("team-share-synced", load);
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  /**
   * Move connections in or out of the share. One call for the whole
   * selection, so a multi-select costs a single write to the shared folder.
   */
  const setConnectionsShared = useCallback(
    async (connectionIds: string[], shared: boolean) => {
      const next = await invoke<TeamShareStatus>("set_connections_shared", {
        connectionIds,
        shared,
      });
      setStatus(next);
      return next;
    },
    [],
  );

  return { status, refresh, setConnectionsShared };
}
