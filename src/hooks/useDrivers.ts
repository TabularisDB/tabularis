import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";
import { createAsyncResource } from "../utils/asyncResource";

import type { InstalledPluginInfo, PluginManifest } from "../types/plugins";
import { useSettings } from "./useSettings";

const FALLBACK_DRIVERS: PluginManifest[] = [
  {
    id: "postgres",
    name: "PostgreSQL",
    version: "1.0.0",
    description: "PostgreSQL databases",
    default_port: 5432,
    is_builtin: true,
    default_username: "postgres",
    color: "#3b82f6",
    icon: "postgres",
    settings: [
      {
        key: "poolMaxSize",
        label: "Pool Max Size",
        type: "number",
        default: 10,
        description: "Maximum number of PostgreSQL connections kept in the pool.",
      },
    ],
    capabilities: {
      schemas: true,
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example: "postgres://user:pass@localhost:5432/db",
      identifier_quote: '"',
      alter_primary_key: true,
      auto_increment_keyword: "",
      serial_type: "SERIAL",
      inline_pk: false,
      alter_column: true,
      create_foreign_keys: true,
      supports_ssl: true,
      sql_dialect: "postgres",
    },
  },
  {
    id: "mysql",
    name: "MySQL",
    version: "1.0.0",
    description: "MySQL and MariaDB databases",
    default_port: 3306,
    is_builtin: true,
    default_username: "root",
    color: "#f97316",
    icon: "mysql",
    settings: [
      {
        key: "maxAllowedPacket",
        label: "Max Allowed Packet",
        type: "number",
        default: 1073741824,
        description: "Maximum packet size used by the MySQL connector.",
      },
      {
        key: "socketTimeout",
        label: "Socket Timeout",
        type: "number",
        default: 600000,
        description: "Socket timeout in milliseconds.",
      },
      {
        key: "connectTimeout",
        label: "Connect Timeout",
        type: "number",
        default: 60000,
        description: "Connection timeout in milliseconds.",
      },
      {
        key: "timezone",
        label: "Timezone",
        type: "string",
        default: "SYSTEM",
        description: "Session timezone sent to MySQL after connect.",
      },
    ],
    capabilities: {
      schemas: false,
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example: "mysql://user:pass@localhost:3306/db",
      identifier_quote: "`",
      alter_primary_key: true,
      auto_increment_keyword: "AUTO_INCREMENT",
      serial_type: "",
      inline_pk: false,
      alter_column: true,
      create_foreign_keys: true,
      supports_ssl: true,
      sql_dialect: "mysql",
    },
  },
  {
    id: "sqlite",
    name: "SQLite",
    version: "1.0.0",
    description: "SQLite file-based databases",
    default_port: null,
    is_builtin: true,
    default_username: "",
    color: "#06b6d4",
    icon: "sqlite",
    capabilities: {
      schemas: false,
      views: true,
      routines: false,
      file_based: true,
      folder_based: false,
      connection_string: false,
      identifier_quote: '"',
      alter_primary_key: true,
      auto_increment_keyword: "AUTOINCREMENT",
      serial_type: "",
      inline_pk: true,
      alter_column: false,
      create_foreign_keys: false,
      sql_dialect: "sqlite",
    },
  },
];

const driverResource = createAsyncResource<{
  allDrivers: PluginManifest[];
  installedPlugins: InstalledPluginInfo[];
}>({ allDrivers: FALLBACK_DRIVERS, installedPlugins: [] }, async () => {
  const [allDrivers, installedPlugins] = await Promise.all([
    invoke<PluginManifest[]>("get_registered_drivers"),
    invoke<InstalledPluginInfo[]>("get_installed_plugins"),
  ]);
  return { allDrivers, installedPlugins };
});

let subscribers = 0;
let stopListening: (() => void) | undefined;

function subscribeDrivers(listener: () => void): () => void {
  const unsubscribe = driverResource.subscribe(listener);
  if (++subscribers === 1) {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("tabularis://plugin-activated", () => {
      void driverResource.refresh();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error: unknown) => {
      console.warn("Failed to subscribe to plugin activation:", error);
    });
    stopListening = () => {
      disposed = true;
      unlisten?.();
    };
  }
  return () => {
    unsubscribe();
    if (--subscribers === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}

export function useDrivers(): {
  drivers: PluginManifest[];
  allDrivers: PluginManifest[];
  installedPlugins: InstalledPluginInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { data, loading, error } = useSyncExternalStore(subscribeDrivers, driverResource.getSnapshot);
  const { settings } = useSettings();
  useEffect(() => { void driverResource.load(); }, []);
  const activeExt = settings.activeExternalDrivers;
  // Match the backend: an absent preference enables installed external drivers.
  const drivers = data.allDrivers.filter(
    (driver) => driver.is_builtin === true || activeExt == null || activeExt.includes(driver.id),
  );
  return { ...data, drivers, loading, error, refresh: driverResource.refresh };
}
