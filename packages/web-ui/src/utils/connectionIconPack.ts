import dynamicIconImports from "lucide-react/dynamicIconImports";
import type { LucideIcon } from "lucide-react";
import { lazy, type LazyExoticComponent } from "react";

type IconLoader = () => Promise<{ default: LucideIcon }>;

// All icon names available in lucide-react. Static keys, lazy-loaded values.
export const ALL_ICON_NAMES: string[] = Object.keys(dynamicIconImports).sort();

// Cache so we don't re-create lazy components per render.
const cache = new Map<string, LazyExoticComponent<LucideIcon>>();

export function getLucideIconComponent(name: string): LazyExoticComponent<LucideIcon> | null {
  if (!(name in dynamicIconImports)) return null;
  let cmp = cache.get(name);
  if (!cmp) {
    const loader = dynamicIconImports[name as keyof typeof dynamicIconImports] as IconLoader;
    cmp = lazy(loader);
    cache.set(name, cmp);
  }
  return cmp;
}

export function camelToKebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

// Legacy named export kept for any code still referencing it.
// Maps the previous 30-icon kebab-case ids to themselves (lucide uses kebab-case in dynamicIconImports).
// If callers used camelCase (e.g. "shieldCheck"), translate that here.
export const CONNECTION_ICON_PACK = new Proxy({} as Record<string, LazyExoticComponent<LucideIcon>>, {
  get(_target, key) {
    if (typeof key !== "string") return undefined;
    return getLucideIconComponent(key) ?? getLucideIconComponent(camelToKebab(key)) ?? undefined;
  },
});

export type ConnectionIconPackId = string;
