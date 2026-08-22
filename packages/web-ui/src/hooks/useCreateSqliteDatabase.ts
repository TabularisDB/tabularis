import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { usePlatformCapabilities } from "./usePlatformCapabilities";
import { choosePlatformSavePath } from "../platform/dialogs";
import type { SavedConnection } from "../contexts/DatabaseContext";

export function useCreateSqliteDatabase() {
  const { t } = useTranslation();
  const platform = usePlatformCapabilities();
  const inFlightRef = useRef(false);
  const [isCreating, setIsCreating] = useState(false);

  const createSqliteDatabase = async (): Promise<SavedConnection | null> => {
    if (inFlightRef.current) return null;

    inFlightRef.current = true;
    setIsCreating(true);
    try {
      const path = await choosePlatformSavePath(platform, {
        title: t("connections.newSqliteDatabase.dialogTitle"),
        defaultPath: "database.db",
        filters: [
          {
            name: t("connections.newSqliteDatabase.fileType"),
            extensions: ["db", "sqlite", "sqlite3"],
          },
        ],
      });
      if (!path) return null;

      return await invoke<SavedConnection>("create_sqlite_database", { path });
    } finally {
      inFlightRef.current = false;
      setIsCreating(false);
    }
  };

  return { createSqliteDatabase, isCreating };
}
