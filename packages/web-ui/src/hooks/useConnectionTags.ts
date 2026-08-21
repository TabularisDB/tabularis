import { useCallback, useEffect, useState } from "react";
import type { ConnectionTag } from "../types/tags";
import { useTabularisClient } from "./useTabularisClient";

/**
 * Loads the connection tags and exposes CRUD helpers. Every mutation
 * re-fetches so all fields (including backend-normalized names) stay in sync.
 */
export function useConnectionTags() {
  const client = useTabularisClient();
  const [tags, setTags] = useState<ConnectionTag[]>([]);

  const refresh = useCallback(
    () =>
      client
        .call("list_connection_tags", undefined)
        .then(setTags)
        .catch((error: unknown) => {
          console.error("Failed to load connection tags:", error);
        }),
    [client],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTag = useCallback(
    async (name: string, color: string): Promise<ConnectionTag> => {
      const tag = await client.call("create_connection_tag", { name, color });
      await refresh();
      return tag;
    },
    [client, refresh],
  );

  const updateTag = useCallback(
    async (id: string, name: string, color: string) => {
      await client.call("update_connection_tag", { id, name, color });
      await refresh();
    },
    [client, refresh],
  );

  const deleteTag = useCallback(
    async (id: string) => {
      await client.call("delete_connection_tag", { id });
      await refresh();
    },
    [client, refresh],
  );

  return { tags, refresh, createTag, updateTag, deleteTag };
}
