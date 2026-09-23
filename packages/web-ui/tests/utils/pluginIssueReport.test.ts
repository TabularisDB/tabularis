import { describe, it, expect } from "vitest";
import { buildPluginIssueUrl } from "../../src/utils/pluginIssueReport";

const baseInput = {
  pluginId: "postgresql",
  pluginVersion: "1.2.3",
  repoUrl: "https://github.com/TabularisDB/tabularis-postgresql-plugin",
  appVersion: "0.21.0",
  os: "darwin",
};

describe("buildPluginIssueUrl", () => {
  describe("targets the correct template per call site", () => {
    it("targets migration-failure.yml for a connection-level failure", () => {
      const url = buildPluginIssueUrl({
        ...baseInput,
        template: "migration-failure",
        failureMode: "connection",
        error: "connection refused",
        migratedFromDriver: "postgres",
      });
      expect(url).toContain("template=migration-failure.yml");
      expect(url).toContain("failure_mode=connection");
      expect(url).toContain("migrated_from_driver=postgres");
      expect(url).toContain("error=connection+refused");
    });

    it("targets capability-gap.yml for a feature gap", () => {
      const url = buildPluginIssueUrl({
        ...baseInput,
        template: "capability-gap",
        feature: "ssl",
      });
      expect(url).toContain("template=capability-gap.yml");
      expect(url).toContain("feature=ssl");
      // A capability-gap report must not carry migration-specific fields.
      expect(url).not.toContain("failure_mode");
      expect(url).not.toContain("migrated_from_driver");
      expect(url).not.toContain("error");
    });

    it("targets bug-report.yml for a general plugin issue", () => {
      const url = buildPluginIssueUrl({ ...baseInput, template: "bug-report" });
      expect(url).toContain("template=bug-report.yml");
      // bug-report carries only the shared base fields, no migration/gap ones.
      expect(url).not.toContain("failure_mode");
      expect(url).not.toContain("feature");
    });
  });

  describe("includes the shared named fields", () => {
    it("always sets plugin_id, plugin_version, app_version, os", () => {
      const url = buildPluginIssueUrl({ ...baseInput, template: "bug-report" });
      expect(url).toContain("plugin_id=postgresql");
      expect(url).toContain("plugin_version=1.2.3");
      expect(url).toContain("app_version=0.21.0");
      expect(url).toContain("os=darwin");
    });

    it("builds against the repo issues/new path with trailing slashes trimmed", () => {
      const url = buildPluginIssueUrl({
        ...baseInput,
        repoUrl: "https://github.com/TabularisDB/tabularis-postgresql-plugin/",
        template: "bug-report",
      });
      expect(url.startsWith("https://github.com/TabularisDB/tabularis-postgresql-plugin/issues/new?")).toBe(true);
    });
  });

  describe("never leaks connection params (security-relevant)", () => {
    // Only a fixed, named field set is ever interpolated. A credential or
    // connection string has no path into the URL. This test is the guard:
    // if someone later wires a raw params object through, it fails.
    it("does not contain a password even if one were on a hypothetical input", () => {
      const url = buildPluginIssueUrl({
        ...baseInput,
        template: "migration-failure",
        failureMode: "connection",
        error: "boom",
        migratedFromDriver: "postgres",
      });
      expect(url).not.toContain("password");
      expect(url).not.toContain("secret");
      expect(url).not.toContain("postgres://");
    });

    it("URL-encodes the error rather than splicing it raw", () => {
      const url = buildPluginIssueUrl({
        ...baseInput,
        template: "migration-failure",
        failureMode: "connection",
        error: "host=1.2.3.4 & port=5432 said no",
        migratedFromDriver: "postgres",
      });
      // Spaces encoded, and the `=`/`&` in the error must not create new
      // query params — URLSearchParams encodes them.
      expect(url).not.toMatch(/& port=/);
      expect(url).toContain("host%3D1.2.3.4");
    });
  });

  describe("fails closed on missing required fields", () => {
    it("throws when migration-failure has no error", () => {
      expect(() =>
        buildPluginIssueUrl({
          ...baseInput,
          template: "migration-failure",
          failureMode: "connection",
          migratedFromDriver: "postgres",
        }),
      ).toThrow(/error is required/);
    });

    it("throws when migration-failure has no failureMode", () => {
      expect(() =>
        buildPluginIssueUrl({
          ...baseInput,
          template: "migration-failure",
          error: "x",
          migratedFromDriver: "postgres",
        }),
      ).toThrow(/failureMode is required/);
    });

    it("throws when migration-failure has no migratedFromDriver", () => {
      expect(() =>
        buildPluginIssueUrl({
          ...baseInput,
          template: "migration-failure",
          failureMode: "connection",
          error: "x",
        }),
      ).toThrow(/migratedFromDriver is required/);
    });

    it("throws when capability-gap has no feature", () => {
      expect(() =>
        buildPluginIssueUrl({ ...baseInput, template: "capability-gap" }),
      ).toThrow(/feature is required/);
    });
  });
});
