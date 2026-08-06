import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionTag } from "../types/tags";

/**
 * Loads the connection tags and exposes CRUD helpers. Every mutation
 * re-fetches so all fields (including backend-normalized names) stay in sync.
 */
export function useConnectionTags() {
  const [tags, setTags] = useState<ConnectionTag[]>([]);

  const refresh = useCallback(
    () =>
      invoke<ConnectionTag[]>("list_connection_tags")
        .then(setTags)
        .catch((e: unknown) => {
          console.error("Failed to load connection tags:", e);
        }),
    [],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTag = useCallback(
    async (name: string, color: string): Promise<ConnectionTag> => {
      const tag = await invoke<ConnectionTag>("create_connection_tag", {
        name,
        color,
      });
      await refresh();
      return tag;
    },
    [refresh],
  );

  const updateTag = useCallback(
    async (id: string, name: string, color: string) => {
      await invoke("update_connection_tag", { id, name, color });
      await refresh();
    },
    [refresh],
  );

  const deleteTag = useCallback(
    async (id: string) => {
      await invoke("delete_connection_tag", { id });
      await refresh();
    },
    [refresh],
  );

  return { tags, refresh, createTag, updateTag, deleteTag };
}
