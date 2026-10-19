import type { DatabaseBackupPlan, DriverDumpCapability } from "../types/databaseBackup";
import type { DriverCapabilities, PluginManifest } from "../types/plugins";
import type { SavedConnection } from "../contexts/DatabaseContext";

export const DATABASE_BACKUP_PREFIX = "tabularis-db-backup-";
export const DATABASE_BACKUP_SUFFIX = ".sql";
export const TIMESTAMP_REGEX = /(\d{8}-\d{6})$/;

export const COMMON_IANA_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/**
 * Normalizes an identifier string so it is safe to use in file names on all OSes.
 */
export function sanitizeFileNameComponent(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Checks whether a driver supports database dumps based on its capabilities.
 * Built-in drivers (PostgreSQL, MySQL, SQLite) and plugin drivers with relational
 * table support are capable; purely in-memory, folder-based, or non-relational
 * drivers return an explanatory reason.
 */
export function isDriverDumpCapable(
  driverId: string | null | undefined,
  capabilities?: DriverCapabilities | PluginManifest | null,
): DriverDumpCapability {
  if (!driverId) {
    return { capable: false, reason: "No database driver selected." };
  }

  const caps: DriverCapabilities | undefined =
    capabilities && "capabilities" in capabilities
      ? (capabilities.capabilities as DriverCapabilities)
      : (capabilities as DriverCapabilities | undefined);

  if (caps?.no_connection_required) {
    return {
      capable: false,
      reason: "API-based connections do not support SQL database dumps.",
    };
  }

  if (caps?.in_memory || caps?.inMemory) {
    return {
      capable: false,
      reason: "In-memory databases live only in memory and cannot be scheduled for dumps.",
    };
  }

  if (caps?.folder_based) {
    return {
      capable: false,
      reason: "Folder-based document/file stores do not support standard SQL dumps.",
    };
  }

  // Built-in drivers and standard SQL dialects
  const normalizedId = driverId.toLowerCase();
  const dialect = caps?.sql_dialect?.toLowerCase();

  const isBuiltinRelational =
    normalizedId === "postgres" ||
    normalizedId === "postgresql" ||
    normalizedId === "mysql" ||
    normalizedId === "mariadb" ||
    normalizedId === "sqlite";

  const isDialectRelational =
    dialect === "postgres" ||
    dialect === "mysql" ||
    dialect === "sqlite";

  if (isBuiltinRelational || isDialectRelational || caps?.manage_tables !== false) {
    return { capable: true };
  }

  return {
    capable: false,
    reason: `Driver "${driverId}" does not advertise SQL dump capabilities.`,
  };
}

/**
 * Formats a timestamp into YYYYMMDD-HHMMSS format.
 */
export function formatBackupTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${m}${d}-${h}${min}${s}`;
}

/**
 * Generates the standardized file name for a scheduled database backup.
 */
export function formatDatabaseBackupFileName(
  connectionId: string,
  databaseName?: string | null,
  date: Date = new Date(),
): string {
  const safeConn = sanitizeFileNameComponent(connectionId) || "connection";
  const safeDb = databaseName ? sanitizeFileNameComponent(databaseName) : "";
  const dbPart = safeDb ? `-${safeDb}` : "";
  const timestamp = formatBackupTimestamp(date);
  return `${DATABASE_BACKUP_PREFIX}${safeConn}${dbPart}-${timestamp}${DATABASE_BACKUP_SUFFIX}`;
}

/**
 * Parses timestamp and components from a backup file name.
 */
export function parseDatabaseBackupFileName(fileName: string): {
  connectionSlug: string;
  databaseSlug?: string;
  timestamp: Date;
} | null {
  if (!fileName.startsWith(DATABASE_BACKUP_PREFIX) || !fileName.endsWith(DATABASE_BACKUP_SUFFIX)) {
    return null;
  }

  const stem = fileName.slice(
    DATABASE_BACKUP_PREFIX.length,
    fileName.length - DATABASE_BACKUP_SUFFIX.length,
  );

  const match = stem.match(TIMESTAMP_REGEX);
  if (!match) return null;

  const stampStr = match[1]; // YYYYMMDD-HHMMSS
  const prefix = stem.slice(0, stem.length - stampStr.length - 1); // remove trailing '-'

  const year = parseInt(stampStr.slice(0, 4), 10);
  const month = parseInt(stampStr.slice(4, 6), 10) - 1;
  const day = parseInt(stampStr.slice(6, 8), 10);
  const hour = parseInt(stampStr.slice(9, 11), 10);
  const minute = parseInt(stampStr.slice(11, 13), 10);
  const second = parseInt(stampStr.slice(13, 15), 10);

  const timestamp = new Date(year, month, day, hour, minute, second);
  if (isNaN(timestamp.getTime())) return null;

  const parts = prefix.split("-");
  const connectionSlug = parts[0] || "";
  const databaseSlug = parts.length > 1 ? parts.slice(1).join("-") : undefined;

  return { connectionSlug, databaseSlug, timestamp };
}

/**
 * Selects backup file names that exceed the retention count for a specific
 * connection and database, sorted oldest first. Only valid backups matching the
 * plan are considered. Failed/foreign files are never returned or pruned.
 */
export function selectDatabaseBackupsToPrune(
  fileNames: string[],
  connectionId: string,
  databaseName: string | null | undefined,
  retention: number,
): string[] {
  if (retention <= 0) return [];

  const safeConn = sanitizeFileNameComponent(connectionId);
  const safeDb = databaseName ? sanitizeFileNameComponent(databaseName) : undefined;

  // Filter files that belong to this specific plan
  const matchingFiles = fileNames
    .map((name) => {
      const parsed = parseDatabaseBackupFileName(name);
      return parsed ? { name, ...parsed } : null;
    })
    .filter((item): item is NonNullable<typeof item> => {
      if (!item) return false;
      if (item.connectionSlug !== safeConn) return false;
      if (safeDb) {
        return item.databaseSlug === safeDb;
      }
      return true;
    });

  // Sort chronologically ascending (oldest first)
  matchingFiles.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (matchingFiles.length <= retention) {
    return [];
  }

  const excessCount = matchingFiles.length - retention;
  return matchingFiles.slice(0, excessCount).map((f) => f.name);
}

/**
 * Computes the next scheduled execution time for a daily plan in the specified
 * IANA timezone, handling day transitions and timezone boundaries.
 */
export function computeNextRun(
  dailyTime: string, // "HH:mm"
  timezone: string,
  now: Date = new Date(),
  lastRunAt?: string | null,
): Date {
  const [hourStr, minuteStr] = (dailyTime || "02:00").split(":");
  const targetHour = parseInt(hourStr ?? "2", 10) || 0;
  const targetMinute = parseInt(minuteStr ?? "0", 10) || 0;

  // Validate timezone or fall back to system
  let tz = timezone || "local";
  if (tz === "local") {
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      tz = "UTC";
    }
  }

  // Get current wall clock in the target IANA timezone
  let parts: Intl.DateTimeFormatPart[];
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    parts = formatter.formatToParts(now);
  } catch {
    // If timezone is unknown or invalid, fall back to UTC
    tz = "UTC";
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    parts = formatter.formatToParts(now);
  }

  const getPart = (type: string) => {
    const p = parts.find((pt) => pt.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };

  const currentYear = getPart("year");
  const currentMonth = getPart("month"); // 1-12
  const currentDay = getPart("day");
  const currentHour = getPart("hour") % 24;
  const currentMinute = getPart("minute");

  // Determine whether today's time has already passed
  const isPastToday =
    currentHour > targetHour ||
    (currentHour === targetHour && currentMinute >= targetMinute);

  // Check if today was already executed in this timezone
  let alreadyRunToday = false;
  if (lastRunAt) {
    try {
      const lastRunDate = new Date(lastRunAt);
      if (!isNaN(lastRunDate.getTime())) {
        const lastParts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour12: false,
        }).formatToParts(lastRunDate);
        const lYear = parseInt(lastParts.find((p) => p.type === "year")?.value || "0", 10);
        const lMonth = parseInt(lastParts.find((p) => p.type === "month")?.value || "0", 10);
        const lDay = parseInt(lastParts.find((p) => p.type === "day")?.value || "0", 10);
        if (lYear === currentYear && lMonth === currentMonth && lDay === currentDay) {
          alreadyRunToday = true;
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // Construct target date
  let runYear = currentYear;
  let runMonth = currentMonth;
  let runDay = currentDay;

  if (isPastToday || alreadyRunToday) {
    // Advance to next day
    const nextDayDate = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay + 1));
    runYear = nextDayDate.getUTCFullYear();
    runMonth = nextDayDate.getUTCMonth() + 1;
    runDay = nextDayDate.getUTCDate();
  }

  // We convert the wall-clock components in `tz` back to a UTC Date instant.
  // Approximation by calculating the offset of `tz` at the target date:
  const pad = (n: number) => n.toString().padStart(2, "0");
  const isoString = `${runYear}-${pad(runMonth)}-${pad(runDay)}T${pad(targetHour)}:${pad(targetMinute)}:00`;

  // Use Intl to find exact offset at that target instant
  const targetUtcEstimate = new Date(`${isoString}Z`);
  const offsetDiffMinutes = getTimezoneOffsetMinutes(tz, targetUtcEstimate);
  const finalTimeMs = targetUtcEstimate.getTime() - offsetDiffMinutes * 60_000;

  return new Date(finalTimeMs);
}

/**
 * Calculates the offset in minutes between UTC and a specified timezone at a given instant.
 */
function getTimezoneOffsetMinutes(timeZone: string, date: Date): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => {
      const p = parts.find((pt) => pt.type === type);
      return p ? parseInt(p.value, 10) : 0;
    };
    const y = getPart("year");
    const m = getPart("month");
    const d = getPart("day");
    const h = getPart("hour") % 24;
    const min = getPart("minute");
    const s = getPart("second");

    const asUtc = Date.UTC(y, m - 1, d, h, min, s);
    return Math.round((asUtc - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * Validates a database backup plan.
 */
export function validateDatabaseBackupPlan(
  plan: DatabaseBackupPlan,
  connection?: SavedConnection | null,
  capabilities?: DriverCapabilities | PluginManifest | null,
): { isValid: boolean; errorKey?: string } {
  if (!plan.enabled) {
    return { isValid: true };
  }

  if (!plan.connectionId) {
    return { isValid: false, errorKey: "settings.backup.databaseBackupErrorNoConnection" };
  }

  if (!plan.destinationDirectory) {
    return { isValid: false, errorKey: "settings.backup.databaseBackupErrorNoDirectory" };
  }

  if (plan.retention < 1) {
    return { isValid: false, errorKey: "settings.backup.databaseBackupErrorInvalidRetention" };
  }

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(plan.time)) {
    return { isValid: false, errorKey: "settings.backup.databaseBackupErrorInvalidTime" };
  }

  if (connection) {
    const capability = isDriverDumpCapable(connection.params.driver, capabilities);
    if (!capability.capable) {
      return { isValid: false, errorKey: "settings.backup.databaseBackupErrorUnsupportedDriver" };
    }
  }

  return { isValid: true };
}
