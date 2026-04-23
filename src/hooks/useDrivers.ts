import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

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
    },
  },
  {
    id: "sqlserver",
    name: "SQL Server",
    version: "0.1.0",
    description: "Microsoft SQL Server (read-only preview)",
    default_port: 1433,
    is_builtin: true,
    default_username: "sa",
    color: "#cc2927",
    icon: "database",
    capabilities: {
      schemas: true,
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example:
        "server=localhost,1433;database=master;user id=sa;password=...;encrypt=true",
      identifier_quote: '"',
      alter_primary_key: true,
      auto_increment_keyword: "IDENTITY(1,1)",
      serial_type: "",
      inline_pk: false,
      alter_column: false,
      create_foreign_keys: false,
      manage_tables: false,
      readonly: true,
    },
  },
];

export function useDrivers(): {
  drivers: PluginManifest[];
  allDrivers: PluginManifest[];
  installedPlugins: InstalledPluginInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [allDrivers, setAllDrivers] =
    useState<PluginManifest[]>(FALLBACK_DRIVERS);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useSettings();

  const load = useCallback(() => {
    Promise.all([
      invoke<PluginManifest[]>("get_registered_drivers"),
      invoke<InstalledPluginInfo[]>("get_installed_plugins"),
    ])
      .then(([drivers, installed]) => {
        setAllDrivers(drivers);
        setInstalledPlugins(installed);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const activeExt = settings.activeExternalDrivers || [];
  const active = allDrivers.filter(
    (d) => d.is_builtin === true || activeExt.includes(d.id),
  );

  return { drivers: active, allDrivers, installedPlugins, loading, error, refresh };
}
