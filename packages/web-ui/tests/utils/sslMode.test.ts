import { describe, expect, it } from "vitest";
import {
  isLocalDatabaseHost,
  shouldShowUnverifiedSslHint,
  sslModeVerifiesCertificate,
  suggestedVerifyingSslMode,
} from "../../src/utils/sslMode";

describe("sslMode", () => {
  describe("isLocalDatabaseHost", () => {
    it.each([
      undefined,
      null,
      "",
      "   ",
      "localhost",
      "LOCALHOST",
      " localhost ",
      "127.0.0.1",
      "::1",
      "[::1]",
      "/var/run/postgresql",
      "/tmp/.s.PGSQL.5432",
      "@abstract-socket",
      "\\\\.\\pipe\\MySQL",
      "\\\\?\\pipe\\MySQL",
    ])("treats %j as local", (host) => {
      expect(isLocalDatabaseHost(host)).toBe(true);
    });

    it.each([
      "db.example.com",
      "10.0.0.8",
      "localhost.example.com",
      "::2",
      "0.0.0.0",
      "127.0.0.2",
    ])("treats %j as remote", (host) => {
      expect(isLocalDatabaseHost(host)).toBe(false);
    });
  });

  describe("sslModeVerifiesCertificate", () => {
    it("treats postgres verify modes as verifying", () => {
      expect(sslModeVerifiesCertificate("verify-ca", "postgres")).toBe(true);
      expect(sslModeVerifiesCertificate("VERIFY-FULL", "postgres")).toBe(true);
      expect(sslModeVerifiesCertificate("require", "postgres")).toBe(false);
      expect(sslModeVerifiesCertificate("prefer", "postgres")).toBe(false);
      expect(sslModeVerifiesCertificate("disable", "postgres")).toBe(false);
    });

    it("treats mysql verify modes, including importer spellings, as verifying", () => {
      expect(sslModeVerifiesCertificate("verify_ca", "mysql")).toBe(true);
      expect(sslModeVerifiesCertificate("verify_identity", "mysql")).toBe(true);
      expect(sslModeVerifiesCertificate("verify-ca", "mysql")).toBe(true);
      expect(sslModeVerifiesCertificate("verify-full", "mysql")).toBe(true);
      expect(sslModeVerifiesCertificate("required", "mysql")).toBe(false);
      expect(sslModeVerifiesCertificate("preferred", "mysql")).toBe(false);
      expect(sslModeVerifiesCertificate("disabled", "mysql")).toBe(false);
    });
  });

  describe("suggestedVerifyingSslMode", () => {
    it("suggests verify-full for postgres and verify_identity for mysql", () => {
      expect(suggestedVerifyingSslMode("postgres")).toBe("verify-full");
      expect(suggestedVerifyingSslMode("mysql")).toBe("verify_identity");
    });
  });

  describe("shouldShowUnverifiedSslHint", () => {
    it("shows the hint for a remote host whose mode does not verify", () => {
      expect(shouldShowUnverifiedSslHint("db.example.com", "prefer", "postgres")).toBe(true);
      expect(shouldShowUnverifiedSslHint("db.example.com", "require", "postgres")).toBe(true);
      expect(shouldShowUnverifiedSslHint("db.example.com", "disable", "postgres")).toBe(true);
      expect(shouldShowUnverifiedSslHint("db.example.com", "required", "mysql")).toBe(true);
      expect(shouldShowUnverifiedSslHint("db.example.com", "preferred", "mysql")).toBe(true);
      expect(shouldShowUnverifiedSslHint("db.example.com", "disabled", "mysql")).toBe(true);
    });

    it("hides the hint for local hosts, sockets, and verifying modes", () => {
      expect(shouldShowUnverifiedSslHint("localhost", "prefer", "postgres")).toBe(false);
      expect(shouldShowUnverifiedSslHint("127.0.0.1", "required", "mysql")).toBe(false);
      expect(shouldShowUnverifiedSslHint("::1", "require", "postgres")).toBe(false);
      expect(shouldShowUnverifiedSslHint("/var/run/postgresql", "prefer", "postgres")).toBe(false);
      expect(shouldShowUnverifiedSslHint("", "required", "mysql")).toBe(false);
      expect(shouldShowUnverifiedSslHint("db.example.com", "verify-full", "postgres")).toBe(false);
      expect(shouldShowUnverifiedSslHint("db.example.com", "verify-ca", "postgres")).toBe(false);
      expect(shouldShowUnverifiedSslHint("db.example.com", "verify_identity", "mysql")).toBe(false);
      expect(shouldShowUnverifiedSslHint("db.example.com", "verify_ca", "mysql")).toBe(false);
      expect(shouldShowUnverifiedSslHint("db.example.com", "verify-full", "mysql")).toBe(false);
    });
  });
});
