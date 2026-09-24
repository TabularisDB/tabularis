import type { PluginInstallRequest } from "../api/pluginLifecycle";
import { BROWSER_ROUTES } from "../routing";

const PLUGIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function buildPluginInstallRoute(
  request: PluginInstallRequest,
): string {
  const normalized = normalizePluginInstallRequest(request);
  if (!normalized) throw new Error("Invalid plugin install route request");

  const search = new URLSearchParams();
  if (normalized.version) search.set("version", normalized.version);
  if (normalized.registry) search.set("registry", normalized.registry);
  const query = search.toString();
  const path = BROWSER_ROUTES.pluginInstall.replace(
    ":slug",
    encodeURIComponent(normalized.slug),
  );
  return query ? `${path}?${query}` : path;
}

export function parsePluginInstallRoute(
  slug: string | undefined,
  search: URLSearchParams,
): PluginInstallRequest | null {
  return normalizePluginInstallRequest({
    slug: slug ?? "",
    version: search.get("version"),
    registry: search.get("registry"),
  });
}

function normalizePluginInstallRequest(
  request: PluginInstallRequest,
): PluginInstallRequest | null {
  if (!PLUGIN_SLUG_PATTERN.test(request.slug)) return null;

  const registry = normalizeRegistryUrl(request.registry);
  if (request.registry && !registry) return null;

  return {
    slug: request.slug,
    version: request.version?.trim() || null,
    registry,
  };
}

function normalizeRegistryUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
