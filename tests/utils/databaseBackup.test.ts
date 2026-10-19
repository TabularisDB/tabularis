import { describe, it, expect } from "vitest";
import {
  formatDatabaseBackupFileName,
  parseDatabaseBackupFileName,
  selectDatabaseBackupsToPrune,
  isDriverDumpCapable,
  computeNextRun,
  validateDatabaseBackupPlan,
  sanitizeFileNameComponent,
} from "../../src/utils/databaseBackup";
import type { DatabaseBackupPlan } from "../../src/types/databaseBackup";
import type { SavedConnection } from "../../src/contexts/DatabaseContext";

describe("databaseBackup utils", () => {
  describe("file naming and parsing", () => {
    it("formats and parses standard database backup file names", () => {
      const fixedDate = new Date(2026, 9, 19, 14, 30, 45); // Oct 19, 2026 14:30:45
      const fileName = formatDatabaseBackupFileName("conn_1", "production_db", fixedDate);

      expect(fileName).toBe("tabularis-db-backup-conn_1-production_db-20261019-143045.sql");

      const parsed = parseDatabaseBackupFileName(fileName);
      expect(parsed).not.toBeNull();
      expect(parsed?.connectionSlug).toBe("conn_1");
      expect(parsed?.databaseSlug).toBe("production_db");
      expect(parsed?.timestamp.getFullYear()).toBe(2026);
      expect(parsed?.timestamp.getMonth()).toBe(9);
      expect(parsed?.timestamp.getDate()).toBe(19);
      expect(parsed?.timestamp.getHours()).toBe(14);
      expect(parsed?.timestamp.getMinutes()).toBe(30);
      expect(parsed?.timestamp.getSeconds()).toBe(45);
    });

    it("formats file name when database name is empty", () => {
      const fixedDate = new Date(2026, 9, 19, 14, 30, 45);
      const fileName = formatDatabaseBackupFileName("sqlite_main", null, fixedDate);

      expect(fileName).toBe("tabularis-db-backup-sqlite_main-20261019-143045.sql");

      const parsed = parseDatabaseBackupFileName(fileName);
      expect(parsed).not.toBeNull();
      expect(parsed?.connectionSlug).toBe("sqlite_main");
      expect(parsed?.databaseSlug).toBeUndefined();
    });

    it("rejects non-backup or foreign files", () => {
      expect(parseDatabaseBackupFileName("tabularis-backup-20261019-120000.json")).toBeNull();
      expect(parseDatabaseBackupFileName("notes.sql")).toBeNull();
      expect(parseDatabaseBackupFileName("tabularis-db-backup-invalid.sql")).toBeNull();
    });

    it("sanitizes unsafe characters in file name components", () => {
      expect(sanitizeFileNameComponent("my db/test:123")).toBe("my_db_test_123");
      expect(sanitizeFileNameComponent("..//..//etc")).toBe("etc");
    });
  });

  describe("retention pruning", () => {
    it("prunes oldest successful backups beyond retention limit", () => {
      const fileNames = [
        "tabularis-db-backup-c1-db1-20261015-120000.sql",
        "tabularis-db-backup-c1-db1-20261016-120000.sql",
        "tabularis-db-backup-c1-db1-20261017-120000.sql",
        "tabularis-db-backup-c1-db1-20261018-120000.sql",
        "tabularis-db-backup-c1-db1-20261019-120000.sql",
      ];

      // Retention = 3 -> Should prune 2 oldest files (Oct 15 and Oct 16)
      const toPrune = selectDatabaseBackupsToPrune(fileNames, "c1", "db1", 3);
      expect(toPrune).toEqual([
        "tabularis-db-backup-c1-db1-20261015-120000.sql",
        "tabularis-db-backup-c1-db1-20261016-120000.sql",
      ]);
    });

    it("does not prune files when under retention limit", () => {
      const fileNames = [
        "tabularis-db-backup-c1-db1-20261018-120000.sql",
        "tabularis-db-backup-c1-db1-20261019-120000.sql",
      ];
      expect(selectDatabaseBackupsToPrune(fileNames, "c1", "db1", 5)).toEqual([]);
    });

    it("acceptance criterion: failed runs do not prune the last good backup", () => {
      // Suppose we have exactly 1 good backup on disk
      const existingGoodBackups = ["tabularis-db-backup-c1-db1-20261019-020000.sql"];

      // If a run fails and produces no new file, or fails midway, existing backups must not be pruned
      const pruned = selectDatabaseBackupsToPrune(existingGoodBackups, "c1", "db1", 1);
      expect(pruned).toEqual([]);
      expect(existingGoodBackups).toHaveLength(1);
    });

    it("never prunes backups of other connections or databases", () => {
      const fileNames = [
        "tabularis-db-backup-c1-db1-20261015-120000.sql",
        "tabularis-db-backup-c2-otherdb-20261014-120000.sql",
        "tabularis-db-backup-c1-db2-20261014-120000.sql",
        "tabularis-db-backup-c1-db1-20261016-120000.sql",
      ];

      // Only c1 / db1 backups should be considered
      const toPrune = selectDatabaseBackupsToPrune(fileNames, "c1", "db1", 1);
      expect(toPrune).toEqual(["tabularis-db-backup-c1-db1-20261015-120000.sql"]);
    });
  });

  describe("driver dump capability inspection", () => {
    it("recognizes built-in relational drivers as dump capable", () => {
      expect(isDriverDumpCapable("postgres").capable).toBe(true);
      expect(isDriverDumpCapable("postgresql").capable).toBe(true);
      expect(isDriverDumpCapable("mysql").capable).toBe(true);
      expect(isDriverDumpCapable("sqlite").capable).toBe(true);
    });

    it("recognizes plugin drivers with relational dialect and table management as capable", () => {
      const pluginManifest = {
        id: "custom-pg-plugin",
        name: "Custom Postgres",
        capabilities: {
          schemas: true,
          views: true,
          routines: true,
          file_based: false,
          folder_based: false,
          identifier_quote: '"',
          alter_primary_key: true,
          sql_dialect: "postgres" as const,
          manage_tables: true,
        },
      };
      expect(isDriverDumpCapable("custom-pg-plugin", pluginManifest).capable).toBe(true);
    });

    it("rejects in-memory drivers with clear explanation", () => {
      const inMemoryDriver = {
        id: "duckdb-mem",
        name: "DuckDB In-Memory",
        capabilities: {
          schemas: false,
          views: true,
          routines: false,
          file_based: true,
          folder_based: false,
          in_memory: true,
          identifier_quote: '"',
          alter_primary_key: false,
        },
      };
      const result = isDriverDumpCapable("duckdb-mem", inMemoryDriver);
      expect(result.capable).toBe(false);
      expect(result.reason).toContain("In-memory databases");
    });

    it("rejects API-based drivers without connection requirement", () => {
      const apiDriver = {
        id: "rest-api",
        name: "Public API",
        capabilities: {
          schemas: false,
          views: false,
          routines: false,
          file_based: false,
          folder_based: false,
          no_connection_required: true,
          identifier_quote: '"',
          alter_primary_key: false,
        },
      };
      const result = isDriverDumpCapable("rest-api", apiDriver);
      expect(result.capable).toBe(false);
      expect(result.reason).toContain("API-based");
    });

    it("rejects folder-based non-relational drivers", () => {
      const folderDriver = {
        id: "csv-folder",
        name: "CSV Folder",
        capabilities: {
          schemas: false,
          views: false,
          routines: false,
          file_based: false,
          folder_based: true,
          identifier_quote: '"',
          alter_primary_key: false,
        },
      };
      const result = isDriverDumpCapable("csv-folder", folderDriver);
      expect(result.capable).toBe(false);
      expect(result.reason).toContain("Folder-based");
    });
  });

  describe("IANA timezone and next run computation", () => {
    it("computes next run for today when scheduled time is in the future", () => {
      // 10:00 UTC, scheduled for 15:00 UTC
      const now = new Date(Date.UTC(2026, 9, 19, 10, 0, 0));
      const nextRun = computeNextRun("15:00", "UTC", now, null);

      expect(nextRun.getUTCFullYear()).toBe(2026);
      expect(nextRun.getUTCMonth()).toBe(9);
      expect(nextRun.getUTCDate()).toBe(19);
      expect(nextRun.getUTCHours()).toBe(15);
      expect(nextRun.getUTCMinutes()).toBe(0);
    });

    it("computes next run for tomorrow when scheduled time has already passed today", () => {
      // 18:00 UTC, scheduled for 15:00 UTC
      const now = new Date(Date.UTC(2026, 9, 19, 18, 0, 0));
      const nextRun = computeNextRun("15:00", "UTC", now, null);

      expect(nextRun.getUTCFullYear()).toBe(2026);
      expect(nextRun.getUTCMonth()).toBe(9);
      expect(nextRun.getUTCDate()).toBe(20); // advanced to Oct 20
      expect(nextRun.getUTCHours()).toBe(15);
      expect(nextRun.getUTCMinutes()).toBe(0);
    });

    it("computes next run for tomorrow if today has already executed", () => {
      const now = new Date(Date.UTC(2026, 9, 19, 12, 0, 0));
      const lastRunAt = "2026-10-19T10:00:00Z";
      const nextRun = computeNextRun("15:00", "UTC", now, lastRunAt);

      expect(nextRun.getUTCDate()).toBe(20);
    });

    it("handles IANA timezone offset correctly (America/New_York is UTC-4 in daylight savings)", () => {
      // 06:00 UTC on Oct 19 is 02:00 EDT in New York
      // Target time is 04:00 New York EDT (which is 08:00 UTC)
      const now = new Date(Date.UTC(2026, 9, 19, 6, 0, 0));
      const nextRun = computeNextRun("04:00", "America/New_York", now, null);

      // Verify that nextRun is in the future
      expect(nextRun.getTime()).toBeGreaterThan(now.getTime());
      // In America/New_York, 04:00 EDT = 08:00 UTC
      expect(nextRun.getUTCHours()).toBe(8);
      expect(nextRun.getUTCMinutes()).toBe(0);
    });

    it("handles invalid or unknown timezones by falling back to UTC without throwing", () => {
      const now = new Date(Date.UTC(2026, 9, 19, 10, 0, 0));
      const nextRun = computeNextRun("14:00", "Invalid/Timezone", now, null);
      expect(nextRun).toBeInstanceOf(Date);
      expect(isNaN(nextRun.getTime())).toBe(false);
    });
  });

  describe("plan validation", () => {
    const validPlan: DatabaseBackupPlan = {
      enabled: true,
      connectionId: "conn-1",
      database: "prod_db",
      time: "02:00",
      timezone: "UTC",
      destinationDirectory: "/backups/db",
      retention: 7,
      includeStructure: true,
      includeData: true,
    };

    const validConnection: SavedConnection = {
      id: "conn-1",
      name: "Prod DB",
      params: {
        driver: "postgres",
        database: "prod_db",
      },
    };

    it("validates a complete, sound backup plan", () => {
      const res = validateDatabaseBackupPlan(validPlan, validConnection);
      expect(res.isValid).toBe(true);
      expect(res.errorKey).toBeUndefined();
    });

    it("allows disabled plans even if fields are empty", () => {
      const disabledPlan: DatabaseBackupPlan = {
        ...validPlan,
        enabled: false,
        connectionId: "",
        destinationDirectory: "",
      };
      expect(validateDatabaseBackupPlan(disabledPlan).isValid).toBe(true);
    });

    it("requires a connection when plan is enabled", () => {
      const plan = { ...validPlan, connectionId: "" };
      const res = validateDatabaseBackupPlan(plan);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorNoConnection");
    });

    it("requires a destination directory when plan is enabled", () => {
      const plan = { ...validPlan, destinationDirectory: "" };
      const res = validateDatabaseBackupPlan(plan);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorNoDirectory");
    });

    it("rejects invalid time format", () => {
      const plan = { ...validPlan, time: "25:99" };
      const res = validateDatabaseBackupPlan(plan);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorInvalidTime");
    });

    it("rejects retention < 1", () => {
      const plan = { ...validPlan, retention: 0 };
      const res = validateDatabaseBackupPlan(plan);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorInvalidRetention");
    });

    it("rejects connection with unsupported driver", () => {
      const inMemoryConn: SavedConnection = {
        id: "conn-mem",
        name: "Mem DB",
        params: {
          driver: "mem-driver",
          database: "temp",
        },
      };
      const inMemCaps = {
        in_memory: true,
        schemas: false,
        views: false,
        routines: false,
        file_based: true,
        folder_based: false,
        identifier_quote: '"',
        alter_primary_key: false,
      };
      const res = validateDatabaseBackupPlan(validPlan, inMemoryConn, inMemCaps);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorUnsupportedDriver");
    });
  });
});
