import { describe, it, expect } from "vitest";
import {
  parseConnectionString,
  toConnectionParams,
  looksLikeConnectionString,
  getSupportedConnectionStringProtocols,
  type ParsedConnectionString,
  type ConnectionStringDriver,
} from "../../src/utils/connectionStringParser";

function createRemoteDriver(
  id: string,
  example: string,
): ConnectionStringDriver {
  return {
    id,
    capabilities: {
      schemas: id === "postgres",
      views: true,
      routines: true,
      file_based: false,
      folder_based: false,
      connection_string: true,
      connection_string_example: example,
      identifier_quote: id === "mysql" ? "`" : '"',
      alter_primary_key: true,
    },
  };
}

// Mirrors the real builtin driver capabilities (postgres:// and mysql://
// examples) so alias coverage below exercises the alias expansion, not the
// example-derived protocol.
const CAPABILITY_DRIVERS: ConnectionStringDriver[] = [
  createRemoteDriver("postgres", "postgres://user:pass@localhost:5432/db"),
  createRemoteDriver("mysql", "mysql://user:pass@localhost:3306/db"),
  {
    id: "sqlite",
    capabilities: {
      schemas: false,
      views: true,
      routines: false,
      file_based: true,
      folder_based: false,
      connection_string: false,
      identifier_quote: '"',
      alter_primary_key: true,
    },
  },
];

describe("connectionStringParser", () => {
  describe("parseConnectionString", () => {
    it("should parse MySQL connection string", () => {
      const result = parseConnectionString(
        "mysql://root:password@localhost:3306/mydb",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("mysql");
        expect(result.params.host).toBe("localhost");
        expect(result.params.port).toBe(3306);
        expect(result.params.username).toBe("root");
        expect(result.params.password).toBe("password");
        expect(result.params.database).toBe("mydb");
      }
    });

    it("should parse MySQL connection string without port", () => {
      const result = parseConnectionString(
        "mysql://root@localhost/mydb",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("mysql");
        expect(result.params.host).toBe("localhost");
        expect(result.params.port).toBeUndefined();
        expect(result.params.username).toBe("root");
        expect(result.params.password).toBeUndefined();
        expect(result.params.database).toBe("mydb");
      }
    });

    it("should parse MySQL connection string without credentials", () => {
      const result = parseConnectionString(
        "mysql://localhost/mydb",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("mysql");
        expect(result.params.host).toBe("localhost");
        expect(result.params.username).toBeUndefined();
        expect(result.params.password).toBeUndefined();
        expect(result.params.database).toBe("mydb");
      }
    });

    it("should parse PostgreSQL connection string", () => {
      const result = parseConnectionString(
        "postgres://user:pass@db.example.com:5432/mydb",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("postgres");
        expect(result.params.host).toBe("db.example.com");
        expect(result.params.port).toBe(5432);
        expect(result.params.username).toBe("user");
        expect(result.params.password).toBe("pass");
        expect(result.params.database).toBe("mydb");
      }
    });

    it("should parse postgresql:// as postgres via protocol alias", () => {
      const result = parseConnectionString(
        "postgresql://user:pass@localhost:5432/mydb",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("postgres");
        expect(result.params.host).toBe("localhost");
        expect(result.params.port).toBe(5432);
        expect(result.params.username).toBe("user");
        expect(result.params.password).toBe("pass");
        expect(result.params.database).toBe("mydb");
      }
    });

    it("should parse mariadb:// as mysql via protocol alias", () => {
      const result = parseConnectionString(
        "mariadb://user@host/db",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("mysql");
      }
    });

    it("should resolve aliases against builtin drivers when no drivers are provided", () => {
      const postgresql = parseConnectionString(
        "postgresql://user@host/db",
      );
      expect(postgresql.success).toBe(true);
      if (postgresql.success) {
        expect(postgresql.params.driver).toBe("postgres");
      }

      const mariadb = parseConnectionString("mariadb://user@host/db");
      expect(mariadb.success).toBe(true);
      if (mariadb.success) {
        expect(mariadb.params.driver).toBe("mysql");
      }
    });

    it("should parse sqlite3:// as sqlite via protocol alias", () => {
      const result = parseConnectionString(
        "sqlite3:///path/to/database.db",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("sqlite");
        expect(result.params.database).toBe("path/to/database.db");
      }
    });

    it("should not let an alias override an explicitly registered protocol", () => {
      const drivers: ConnectionStringDriver[] = [
        createRemoteDriver("mysql", "mysql://user:pass@localhost:3306/db"),
        createRemoteDriver(
          "mariadb-plugin",
          "mariadb://user:pass@localhost:3306/db",
        ),
      ];

      const result = parseConnectionString("mariadb://user@host/db", drivers);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("mariadb-plugin");
      }
    });

    it("should parse SQLite connection string", () => {
      const result = parseConnectionString(
        "sqlite:///path/to/database.db",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("sqlite");
        expect(result.params.database).toBe("path/to/database.db");
        expect(result.params.host).toBeUndefined();
        expect(result.params.port).toBeUndefined();
      }
    });

    it("should parse SQLite with absolute path", () => {
      const result = parseConnectionString(
        "sqlite:////absolute/path/db.sqlite",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("sqlite");
        expect(result.params.database).toBe("/absolute/path/db.sqlite");
      }
    });

    it("should decode URL-encoded characters in credentials", () => {
      const result = parseConnectionString(
        "mysql://user%40domain:password%23123@host/db",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.username).toBe("user@domain");
        expect(result.params.password).toBe("password#123");
      }
    });

    it("should decode URL-encoded characters in database name", () => {
      const result = parseConnectionString(
        "mysql://localhost/my%20database",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.database).toBe("my database");
      }
    });

    it("should handle IPv4 addresses", () => {
      const result = parseConnectionString(
        "mysql://user@192.168.1.100:3306/db",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.host).toBe("192.168.1.100");
      }
    });

    it("should handle connection string with query parameters", () => {
      const result = parseConnectionString(
        "mysql://user:pass@localhost:3306/db?ssl_mode=require",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.database).toBe("db");
      }
    });

    it("should fail for empty string", () => {
      const result = parseConnectionString("", CAPABILITY_DRIVERS);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Connection string is empty");
      }
    });

    it("should fail for whitespace-only string", () => {
      const result = parseConnectionString("   ", CAPABILITY_DRIVERS);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Connection string is empty");
      }
    });

    it("should fail for invalid URL format", () => {
      const result = parseConnectionString(
        "not-a-valid-url",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid connection string format");
      }
    });

    it("should fail for unsupported driver", () => {
      const result = parseConnectionString(
        "oracle://user@host/db",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Unsupported database driver");
      }
    });

    it("should fail for SQLite without path", () => {
      const result = parseConnectionString("sqlite://", CAPABILITY_DRIVERS);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("must include a database path");
      }
    });

    it("should fail for remote database without database name", () => {
      const result = parseConnectionString(
        "mysql://user@localhost",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Database name is required");
      }
    });

    it("should parse database name for capability-driven multi-database drivers", () => {
      const result = parseConnectionString(
        "postgresql://user:pass@db.example.com:5432/analytics",
        CAPABILITY_DRIVERS,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.params.driver).toBe("postgres");
        expect(result.params.database).toBe("analytics");
      }
    });
  });

  describe("toConnectionParams", () => {
    it("should convert parsed result to ConnectionParams", () => {
      const parsed: ParsedConnectionString = {
        driver: "mysql",
        host: "localhost",
        port: 3306,
        username: "root",
        password: "pass",
        database: "mydb",
      };

      const params = toConnectionParams(parsed);
      expect(params.driver).toBe("mysql");
      expect(params.host).toBe("localhost");
      expect(params.port).toBe(3306);
      expect(params.username).toBe("root");
      expect(params.password).toBe("pass");
      expect(params.database).toBe("mydb");
    });

    it("should handle optional fields", () => {
      const parsed: ParsedConnectionString = {
        driver: "sqlite",
        database: "/path/to/db.sqlite",
      };

      const params = toConnectionParams(parsed);
      expect(params.driver).toBe("sqlite");
      expect(params.database).toBe("/path/to/db.sqlite");
      expect(params.host).toBeUndefined();
      expect(params.port).toBeUndefined();
      expect(params.username).toBeUndefined();
      expect(params.password).toBeUndefined();
    });
  });

  describe("looksLikeConnectionString", () => {
    it("should return true for mysql://", () => {
      expect(
        looksLikeConnectionString("mysql://user@host/db", CAPABILITY_DRIVERS),
      ).toBe(true);
    });

    it("should return true for mariadb://", () => {
      expect(
        looksLikeConnectionString("mariadb://user@host/db", CAPABILITY_DRIVERS),
      ).toBe(true);
    });

    it("should return true for postgres://", () => {
      expect(
        looksLikeConnectionString(
          "postgres://user@host/db",
          CAPABILITY_DRIVERS,
        ),
      ).toBe(true);
    });

    it("should return true for postgresql://", () => {
      expect(
        looksLikeConnectionString(
          "postgresql://user@host/db",
          CAPABILITY_DRIVERS,
        ),
      ).toBe(true);
    });

    it("should return true for sqlite://", () => {
      expect(
        looksLikeConnectionString("sqlite:///path/to/db", CAPABILITY_DRIVERS),
      ).toBe(true);
    });

    it("should return false for empty string", () => {
      expect(looksLikeConnectionString("", CAPABILITY_DRIVERS)).toBe(false);
    });

    it("should return false for regular string", () => {
      expect(looksLikeConnectionString("localhost", CAPABILITY_DRIVERS)).toBe(
        false,
      );
    });

    it("should return false for arbitrary URL", () => {
      expect(
        looksLikeConnectionString("https://example.com", CAPABILITY_DRIVERS),
      ).toBe(false);
    });

    it("should accept aliases for drivers whose example uses the canonical protocol", () => {
      const realisticDrivers: ConnectionStringDriver[] = [
        createRemoteDriver("postgres", "postgres://user:pass@localhost:5432/db"),
      ];

      expect(
        looksLikeConnectionString(
          "postgresql://user@host/db",
          realisticDrivers,
        ),
      ).toBe(true);
    });

    it("should use provided driver capabilities to validate protocols", () => {
      const restrictedDrivers: ConnectionStringDriver[] = [
        createRemoteDriver(
          "postgres",
          "postgresql://user:pass@localhost:5432/db",
        ),
      ];

      expect(
        looksLikeConnectionString(
          "postgresql://user@host/db",
          restrictedDrivers,
        ),
      ).toBe(true);
      expect(
        looksLikeConnectionString("mysql://user@host/db", restrictedDrivers),
      ).toBe(false);
    });

    it("should return true for sqlite3:// alias", () => {
      expect(
        looksLikeConnectionString("sqlite3:///path/to/db", CAPABILITY_DRIVERS),
      ).toBe(true);
    });

    it("should be case insensitive for protocol", () => {
      expect(
        looksLikeConnectionString("MYSQL://user@host/db", CAPABILITY_DRIVERS),
      ).toBe(true);
      expect(
        looksLikeConnectionString(
          "PostgreSQL://user@host/db",
          CAPABILITY_DRIVERS,
        ),
      ).toBe(true);
    });
  });

  describe("getSupportedConnectionStringProtocols", () => {
    it("should include aliases alongside canonical protocols", () => {
      const protocols = getSupportedConnectionStringProtocols(
        CAPABILITY_DRIVERS,
      );
      expect(protocols).toContain("postgres");
      expect(protocols).toContain("postgresql");
      expect(protocols).toContain("mysql");
      expect(protocols).toContain("mariadb");
      expect(protocols).toContain("sqlite");
      expect(protocols).toContain("sqlite3");
    });

    it("should include aliases for builtin drivers when no drivers are provided", () => {
      const protocols = getSupportedConnectionStringProtocols();
      expect(protocols).toContain("postgresql");
      expect(protocols).toContain("mariadb");
    });
  });
});
