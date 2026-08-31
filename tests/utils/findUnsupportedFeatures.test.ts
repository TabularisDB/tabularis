import { describe, it, expect } from "vitest";
import { findUnsupportedFeatures } from "../../src/utils/findUnsupportedFeatures";
import type { DriverCapabilities, PluginManifest } from "../../src/types/plugins";

/** Minimal manifest carrying only the capabilities under test. */
const makeManifest = (caps: Partial<DriverCapabilities>): PluginManifest => ({
  id: "postgresql",
  name: "PostgreSQL",
  version: "1.0.0",
  description: "",
  default_port: 5432,
  capabilities: {
    schemas: true,
    views: true,
    routines: false,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: true,
    ...caps,
  } as DriverCapabilities,
});

describe("findUnsupportedFeatures", () => {
  describe("flags a capability the plugin declares false", () => {
    it("flags a connection using SSL against supports_ssl: false", () => {
      const manifest = makeManifest({ supports_ssl: false });
      const gaps = findUnsupportedFeatures({ ssl_mode: "verify-ca" }, manifest);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].feature).toBe("ssl");
      expect(gaps[0].label).toContain("SSL");
    });

    it("flags a connection using a connection URI against connection_uri: false", () => {
      const manifest = makeManifest({ connection_uri: false });
      const gaps = findUnsupportedFeatures({ connection_uri: "postgres://host/db" }, manifest);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].feature).toBe("connection_uri");
    });

    it("flags a URI restorable from the keychain even when the field is empty", () => {
      // connection_uri_in_keychain marks a URI that's present at runtime.
      const manifest = makeManifest({ connection_uri: false });
      const gaps = findUnsupportedFeatures({ connection_uri_in_keychain: true }, manifest);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].feature).toBe("connection_uri");
    });
  });

  describe("returns empty for a fully-covered connection", () => {
    it("no gaps when SSL and URI are both supported", () => {
      const manifest = makeManifest({ supports_ssl: true, connection_uri: true });
      const gaps = findUnsupportedFeatures(
        { ssl_mode: "verify-ca", connection_uri: "postgres://host/db" },
        manifest,
      );
      expect(gaps).toEqual([]);
    });

    it("no gaps when the connection uses neither feature", () => {
      const manifest = makeManifest({ supports_ssl: false, connection_uri: false });
      const gaps = findUnsupportedFeatures({ host: "localhost", port: 5432 }, manifest);
      expect(gaps).toEqual([]);
    });

    it("does not flag SSL when ssl_mode is blank", () => {
      const manifest = makeManifest({ supports_ssl: false });
      const gaps = findUnsupportedFeatures({ ssl_mode: "   " }, manifest);
      expect(gaps).toEqual([]);
    });

    it("accepts the camelCase connectionUri alias as supported", () => {
      const manifest = makeManifest({ connection_uri: undefined, connectionUri: true });
      const gaps = findUnsupportedFeatures({ connection_uri: "postgres://host/db" }, manifest);
      expect(gaps).toEqual([]);
    });
  });

  describe("never flags app-level features", () => {
    // SSH tunneling, IAM auth, and Kubernetes port-forwarding are app-level
    // (test_connection rewrites params.port to the tunnel's local forwarded
    // port before the driver sees the connection). They must never appear as
    // gaps regardless of the manifest's capabilities.
    it("does not flag SSH-tunneling connections", () => {
      const manifest = makeManifest({ supports_ssl: false, connection_uri: false });
      // ssh_enabled / ssh_connection_id would be on the params, but the
      // function doesn't read them — and shouldn't. Confirm by passing an
      // otherwise-clean connection.
      const gaps = findUnsupportedFeatures({ host: "localhost", port: 5432 }, manifest);
      expect(gaps).toEqual([]);
    });

    it("does not flag IAM-auth or k8s-forwarding connections", () => {
      const manifest = makeManifest({ supports_ssl: false, connection_uri: false });
      const gaps = findUnsupportedFeatures({ host: "localhost", port: 5432 }, manifest);
      expect(gaps).toEqual([]);
    });
  });
});
