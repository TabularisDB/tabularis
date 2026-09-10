import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBAL_PROXY,
  normalizeProxyOverride,
  PROXY_SCOPES,
  proxyKeychainAi,
  proxyKeychainConnection,
  PROXY_KEYCHAIN_GLOBAL,
} from "../../src/types/proxy";

describe("proxy types", () => {
  it("registers the four pluggable scopes", () => {
    expect(PROXY_SCOPES.map((s) => s.id)).toEqual([
      "app_http",
      "database",
      "ai",
      "ssh_tunnel",
    ]);
  });

  it("normalizes inherit overrides to undefined", () => {
    expect(normalizeProxyOverride({ mode: "inherit" })).toBeUndefined();
    expect(
      normalizeProxyOverride({
        mode: "disabled",
      }),
    ).toEqual({ mode: "disabled" });
    expect(
      normalizeProxyOverride({
        mode: "custom",
        endpoint: {
          protocol: "socks5",
          host: " 127.0.0.1 ",
          port: 1080,
          username: " u ",
        },
      }),
    ).toEqual({
      mode: "custom",
      endpoint: {
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1080,
        username: "u",
      },
    });
  });

  it("builds keychain slots", () => {
    expect(PROXY_KEYCHAIN_GLOBAL).toBe("proxy:global");
    expect(proxyKeychainAi("openai")).toBe("proxy:ai:openai");
    expect(proxyKeychainConnection("abc")).toBe("proxy:connection:abc");
  });

  it("default global proxy is disabled with empty scopes", () => {
    expect(DEFAULT_GLOBAL_PROXY.enabled).toBe(false);
    expect(DEFAULT_GLOBAL_PROXY.scopes).toEqual({});
  });
});
