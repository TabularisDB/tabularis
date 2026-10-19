import { describe, it, expect } from "vitest";
import {
  formatDatabaseBackupFileName,
  parseDatabaseBackupFileName,
  selectDatabaseBackupsToPrune,
  isDriverDumpCapable,
  computeNextRun,
  isBackupDue,
  validateDatabaseBackupPlan,
  sanitizeFileNameComponent,
} from "../../src/utils/databaseBackup";
import type { DatabaseBackupPlan } from "../../src/types/databaseBackup";
import type { SavedConnection } from "../../src/contexts/DatabaseContext";

describe("databaseBackup utils", () => {
  describe("file naming and parsing", () => {
    it("formats and parses standard database backup file names with double-dash delimiters", () => {
      const fixedDate = new Date(2026, 9, 19, 14, 30, 45); // Oct 19, 2026 14:30:45
      const fileName = formatDatabaseBackupFileName("conn_1", "production_db", fixedDate);

      expect(fileName).toBe("tabularis-db-backup-conn_1--production_db--20261019-143045.sql");

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

      expect(fileName).toBe("tabularis-db-backup-sqlite_main--_all_--20261019-143045.sql");

      const parsed = parseDatabaseBackupFileName(fileName);
      expect(parsed).not.toBeNull();
      expect(parsed?.connectionSlug).toBe("sqlite_main");
      expect(parsed?.databaseSlug).toBeUndefined();
    });

    it("supports parsing legacy single-dash file names for backwards compatibility", () => {
      const legacyFileName = "tabularis-db-backup-conn1-prod_db-20261019-143045.sql";
      const parsed = parseDatabaseBackupFileName(legacyFileName);
      expect(parsed).not.toBeNull();
      expect(parsed?.connectionSlug).toBe("conn1");
      expect(parsed?.databaseSlug).toBe("prod_db");
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
        "tabularis-db-backup-c1--db1--20261015-120000.sql",
        "tabularis-db-backup-c1--db1--20261016-120000.sql",
        "tabularis-db-backup-c1--db1--20261017-120000.sql",
        "tabularis-db-backup-c1--db1--20261018-120000.sql",
        "tabularis-db-backup-c1--db1--20261019-120000.sql",
      ];

      // Retention = 3 -> Should prune 2 oldest files (Oct 15 and Oct 16)
      const toPrune = selectDatabaseBackupsToPrune(fileNames, "c1", "db1", 3);
      expect(toPrune).toEqual([
        "tabularis-db-backup-c1--db1--20261015-120000.sql",
        "tabularis-db-backup-c1--db1--20261016-120000.sql",
      ]);
    });

    it("does not prune files when under retention limit", () => {
      const fileNames = [
        "tabularis-db-backup-c1--db1--20261018-120000.sql",
        "tabularis-db-backup-c1--db1--20261019-120000.sql",
      ];
      expect(selectDatabaseBackupsToPrune(fileNames, "c1", "db1", 5)).toEqual([]);
    });

    it("acceptance criterion: failed runs do not prune the last good backup", () => {
      const existingGoodBackups = ["tabularis-db-backup-c1--db1--20261019-020000.sql"];
      const pruned = selectDatabaseBackupsToPrune(existingGoodBackups, "c1", "db1", 1);
      expect(pruned).toEqual([]);
      expect(existingGoodBackups).toHaveLength(1);
    });

    it("never prunes backups of other connections or databases or prefix collisions", () => {
      const fileNames = [
        // Target: connection "c1" with database "db1"
        "tabularis-db-backup-c1--db1--20261015-120000.sql",
        "tabularis-db-backup-c1--db1--20261016-120000.sql",
        // Different connection: "c2"
        "tabularis-db-backup-c2--otherdb--20261014-120000.sql",
        // Same connection, different database: "db2"
        "tabularis-db-backup-c1--db2--20261014-120000.sql",
        // Prefix connection name: "c1_staging"
        "tabularis-db-backup-c1_staging--_all_--20261014-120000.sql",
      ];

      const toPrune = selectDatabaseBackupsToPrune(fileNames, "c1", "db1", 1);
      expect(toPrune).toEqual(["tabularis-db-backup-c1--db1--20261015-120000.sql"]);
    });

    it("no-database plan does not prune database plans or prefix connection plans", () => {
      const fileNames = [
        "tabularis-db-backup-c1--_all_--20261015-120000.sql",
        "tabularis-db-backup-c1--_all_--20261016-120000.sql",
        "tabularis-db-backup-c1--mydb--20261015-120000.sql",
        "tabularis-db-backup-c1_staging--_all_--20261015-120000.sql",
      ];

      const toPrune = selectDatabaseBackupsToPrune(fileNames, "c1", null, 1);
      expect(toPrune).toEqual(["tabularis-db-backup-c1--_all_--20261015-120000.sql"]);
      expect(toPrune).not.toContain("tabularis-db-backup-c1--mydb--20261015-120000.sql");
      expect(toPrune).not.toContain("tabularis-db-backup-c1_staging--_all_--20261015-120000.sql");
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

    it("rejects non-relational drivers when manage_tables is undefined", () => {
      const unknownDriver = {
        id: "redis-cache",
        name: "Redis Cache",
        capabilities: {
          schemas: false,
          views: false,
          routines: false,
          file_based: false,
          folder_based: false,
          identifier_quote: '"',
          alter_primary_key: false,
        },
      };
      expect(isDriverDumpCapable("redis-cache", unknownDriver).capable).toBe(false);
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

  describe("IANA timezone, next run computation, and isBackupDue", () => {
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

    it("advances next run to tomorrow when today's scheduled time has already passed", () => {
      // 16:00 UTC, scheduled for 15:00 UTC
      const now = new Date(Date.UTC(2026, 9, 19, 16, 0, 0));
      const nextRun = computeNextRun("15:00", "UTC", now, null);

      expect(nextRun.getUTCDate()).toBe(20);
      expect(nextRun.getUTCHours()).toBe(15);
    });

    it("advances next run to tomorrow when today has already been executed", () => {
      // 10:00 UTC, scheduled for 15:00 UTC, but executed earlier today
      const now = new Date(Date.UTC(2026, 9, 19, 10, 0, 0));
      const lastRunAt = "2026-10-19T02:00:00Z";
      const nextRun = computeNextRun("15:00", "UTC", now, lastRunAt);

      expect(nextRun.getUTCDate()).toBe(20);
      expect(nextRun.getUTCHours()).toBe(15);
    });

    it("correctly identifies when backup is due via isBackupDue", () => {
      // 13:59 UTC, target 14:00 UTC -> not due
      const before = new Date(Date.UTC(2026, 9, 19, 13, 59, 0));
      expect(isBackupDue("14:00", "UTC", before, null)).toBe(false);

      // 14:00 UTC, target 14:00 UTC -> due
      const at = new Date(Date.UTC(2026, 9, 19, 14, 0, 0));
      expect(isBackupDue("14:00", "UTC", at, null)).toBe(true);

      // 14:15 UTC, target 14:00 UTC -> due if not yet executed today
      const after = new Date(Date.UTC(2026, 9, 19, 14, 15, 0));
      expect(isBackupDue("14:00", "UTC", after, null)).toBe(true);

      // 14:15 UTC -> NOT due if already succeeded today
      const succeededToday = "2026-10-19T14:01:00Z";
      expect(isBackupDue("14:00", "UTC", after, succeededToday)).toBe(false);

      // 14:15 UTC -> IS due if last success was yesterday
      const succeededYesterday = "2026-10-18T14:00:00Z";
      expect(isBackupDue("14:00", "UTC", after, succeededYesterday)).toBe(true);
    });
  });

  describe("plan validation", () => {
    const validPlan: DatabaseBackupPlan = {
      enabled: true,
      connectionId: "conn_pg",
      database: "production",
      time: "02:00",
      timezone: "UTC",
      destinationDirectory: "/backups",
      retention: 7,
      includeStructure: true,
      includeData: true,
    };

    const mockConn: SavedConnection = {
      id: "conn_pg",
      name: "Production PG",
      params: {
        driver: "postgres",
        host: "localhost",
        port: 5432,
        user: "postgres",
        database: { Single: "production" },
      },
    };

    it("accepts valid plan for capable driver", () => {
      expect(validateDatabaseBackupPlan(validPlan, mockConn).isValid).toBe(true);
    });

    it("rejects plan without connection", () => {
      const invalid = { ...validPlan, connectionId: "" };
      const res = validateDatabaseBackupPlan(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorNoConnection");
    });

    it("rejects plan without destination directory", () => {
      const invalid = { ...validPlan, destinationDirectory: "" };
      const res = validateDatabaseBackupPlan(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorNoDirectory");
    });

    it("rejects plan with invalid retention", () => {
      const invalid = { ...validPlan, retention: 0 };
      const res = validateDatabaseBackupPlan(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorInvalidRetention");
    });

    it("rejects plan with invalid time format", () => {
      const invalid = { ...validPlan, time: "25:70" };
      const res = validateDatabaseBackupPlan(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errorKey).toBe("settings.backup.databaseBackupErrorInvalidTime");
    });

    it("always validates disabled plans as valid", () => {
      const disabledPlan: DatabaseBackupPlan = {
        ...validPlan,
        enabled: false,
        connectionId: "",
        destinationDirectory: "",
      };
      expect(validateDatabaseBackupPlan(disabledPlan).isValid).toBe(true);
    });
  });
});
