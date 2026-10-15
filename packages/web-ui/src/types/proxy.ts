/** Shared proxy configuration types (mirrors Rust `proxy::types`). */

export type ProxyProtocol = "http" | "socks5";
export type ProxyMode = "inherit" | "custom" | "disabled";

export type ProxyScopeId = "app_http" | "database" | "ai" | "ssh_tunnel";

export interface ProxyEndpoint {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
}

export interface ProxyOverride {
  mode: ProxyMode;
  endpoint?: ProxyEndpoint;
}

export interface GlobalProxySettings {
  enabled: boolean;
  endpoint?: ProxyEndpoint;
  /** Missing key ⇒ false (opt-in per scope). */
  scopes: Partial<Record<ProxyScopeId, boolean>>;
}

export interface ProxyScopeMeta {
  id: ProxyScopeId;
  labelKey: string;
  descriptionKey: string;
}

/** Pluggable scope registry — keep in sync with `proxy::registry` in Rust. */
export const PROXY_SCOPES: readonly ProxyScopeMeta[] = [
  {
    id: "app_http",
    labelKey: "settings.network.scopes.appHttp",
    descriptionKey: "settings.network.scopes.appHttpDesc",
  },
  {
    id: "database",
    labelKey: "settings.network.scopes.database",
    descriptionKey: "settings.network.scopes.databaseDesc",
  },
  {
    id: "ai",
    labelKey: "settings.network.scopes.ai",
    descriptionKey: "settings.network.scopes.aiDesc",
  },
  {
    id: "ssh_tunnel",
    labelKey: "settings.network.scopes.sshTunnel",
    descriptionKey: "settings.network.scopes.sshTunnelDesc",
  },
] as const;

export const PROXY_KEYCHAIN_GLOBAL = "proxy:global";

export function proxyKeychainAi(provider: string): string {
  return `proxy:ai:${provider}`;
}

export function proxyKeychainConnection(connectionId: string): string {
  return `proxy:connection:${connectionId}`;
}

export const DEFAULT_PROXY_ENDPOINT: ProxyEndpoint = {
  protocol: "http",
  host: "",
  port: 7890,
};

export const DEFAULT_GLOBAL_PROXY: GlobalProxySettings = {
  enabled: false,
  endpoint: { ...DEFAULT_PROXY_ENDPOINT },
  scopes: {},
};

/** Clamp UI/persisted proxy ports to integers in 0..=65535 (0 = unset). */
export function clampProxyPort(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) {
    return 0;
  }
  return Math.min(65535, n);
}

export function defaultProxyOverride(
  mode: ProxyMode = "inherit",
): ProxyOverride {
  return {
    mode,
    endpoint:
      mode === "custom" ? { ...DEFAULT_PROXY_ENDPOINT } : undefined,
  };
}

/** Drop inherit-with-no-endpoint so nothing extra is persisted.
 * Invalid custom overrides (blank host / bad port) are also dropped. */
export function normalizeProxyOverride(
  override: ProxyOverride | undefined | null,
): ProxyOverride | undefined {
  if (!override || override.mode === "inherit") {
    return undefined;
  }
  if (override.mode === "disabled") {
    return { mode: "disabled" };
  }
  const host = override.endpoint?.host?.trim() ?? "";
  const port = clampProxyPort(override.endpoint?.port);
  if (!host || port < 1) {
    return undefined;
  }
  return {
    mode: "custom",
    endpoint: {
      protocol: override.endpoint?.protocol || "http",
      host,
      port,
      username: override.endpoint?.username?.trim() || undefined,
    },
  };
}
