import { Network, Database, FolderOpen, Plug } from "lucide-react";
import { getLucideIconComponent, camelToKebab } from "./connectionIconPack";
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import type { PluginManifest } from "../types/plugins";
import type { SavedConnection } from "../contexts/DatabaseContext";
import { PostgreSQLIcon, MySQLIcon, SQLiteIcon } from "./driverIcons";

const FALLBACK_COLOR = "#64748b"; // slate-500

/**
 * Returns the hex color for a driver, falling back to a neutral gray.
 */
export function getDriverColor(manifest: PluginManifest | undefined | null): string {
  return manifest?.color || FALLBACK_COLOR;
}

/**
 * Returns a ReactNode icon for a driver.
 * Priority: brand SVG icon → lucide icon → generic fallback.
 */
export function getDriverIcon(manifest: PluginManifest | undefined | null, size = 14): ReactNode {
  const iconName = manifest?.icon || "";

  // Brand icons for built-in drivers
  switch (iconName) {
    case "postgres":
      return <PostgreSQLIcon size={size} />;
    case "mysql":
      return <MySQLIcon size={size} />;
    case "sqlite":
      return <SQLiteIcon size={size} />;
  }

  // Legacy lucide icon names
  switch (iconName) {
    case "network":
      return <Network size={size} />;
    case "database":
      return <Database size={size} />;
    case "folder-open":
      return <FolderOpen size={size} />;
    default:
      return <Plug size={size} />;
  }
}

/**
 * Returns an inline style object with backgroundColor set to the driver color.
 * Use this on elements that render a colored driver badge/dot.
 */
export function getDriverColorStyle(manifest: PluginManifest | undefined | null): { backgroundColor: string } {
  return { backgroundColor: getDriverColor(manifest) };
}

// Lazy because ConnectionIconImage transitively imports @tauri-apps/api/path,
// which we don't want to pull into the bundle until an image override is used.
const ConnectionIconImage = lazy(() =>
  import("../components/ConnectionIconImage").then(m => ({ default: m.ConnectionIconImage }))
);

/**
 * Returns the accent color for a connection, using the per-connection override
 * if present, otherwise falling back to the driver manifest color.
 */
export function getConnectionAccent(
  connection: Pick<SavedConnection, "appearance"> | undefined | null,
  manifest: PluginManifest | undefined | null,
): string {
  return connection?.appearance?.accentColor ?? getDriverColor(manifest);
}

/**
 * Returns a ReactNode icon for a connection, using the per-connection icon
 * override if present, otherwise falling back to the driver manifest icon.
 */
export function getConnectionIcon(
  connection: Pick<SavedConnection, "appearance"> | undefined | null,
  manifest: PluginManifest | undefined | null,
  size = 14,
): ReactNode {
  const ov = connection?.appearance?.icon;
  if (!ov) return getDriverIcon(manifest, size);
  switch (ov.type) {
    case "emoji":
      return <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>{ov.value}</span>;
    case "pack": {
      const Cmp = getLucideIconComponent(ov.id) ?? getLucideIconComponent(camelToKebab(ov.id));
      return Cmp
        ? <Suspense fallback={getDriverIcon(manifest, size)}><Cmp size={size} /></Suspense>
        : getDriverIcon(manifest, size);
    }
    case "image":
      return (
        <Suspense fallback={getDriverIcon(manifest, size)}>
          <ConnectionIconImage path={ov.path} size={size} fallback={getDriverIcon(manifest, size)} />
        </Suspense>
      );
  }
}
