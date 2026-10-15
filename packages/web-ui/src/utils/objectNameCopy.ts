import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import { quoteIdentifier, quoteTableRef } from "./identifiers";

export type ObjectNameCopyFormat = "name" | "quoted" | "qualified";

export function formatObjectNameForCopy(
  name: string,
  format: ObjectNameCopyFormat,
  driver: string | PluginManifest | DriverCapabilities | null | undefined,
  schema?: string,
): string {
  if (format === "name") return name;
  if (format === "quoted") return quoteIdentifier(name, driver);
  return quoteTableRef(name, driver, schema);
}
