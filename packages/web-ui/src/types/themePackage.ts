import type { Theme, ThemeColors, MonacoThemeDefinition } from "./theme";

/** Native-issued identity, never copied from author-supplied origin flags. */
export interface InstalledThemeIdentity {
  /** Lowercase SHA-256 of the native-canonicalized registry URL. */
  registryKey: string;
  packageName: string;
  variantId: string;
}

export type ThemePackageMode = "light" | "dark" | "high-contrast";

type SupportedColors = Omit<ThemeColors, "semantic"> & {
  semantic: Omit<ThemeColors["semantic"], "connectionActive" | "connectionInactive">;
};

export interface ThemeDefinitionV1 {
  /** Editor hint only; never used to select or fetch the validation schema. */
  $schema?: string;
  schemaVersion: 1;
  mode: ThemePackageMode;
  attribution?: string;
  colors?: { [K in keyof SupportedColors]?: Partial<SupportedColors[K]> };
  typography?: { fontFamily?: { base?: string[]; mono?: string[] } };
  layout?: { borderRadius?: Partial<Record<"sm" | "base" | "lg" | "xl", number>> };
  editor?: {
    colors?: Record<string, string>;
    rules?: Array<{ token: string; foreground?: string; fontStyle?: string }>;
  };
}

export interface ThemePackageManifestV1 {
  /** Editor hint only; never used to select or fetch the validation schema. */
  $schema?: string;
  /** Stable package identifier (slug). Without it, `name` is the identifier. */
  id?: string;
  /** Display name; free-form only when `id` is declared. */
  name: string;
  version: string;
  kind: "theme";
  min_runtime_version: string;
  theme_schema_version: 1;
  theme_variants: Array<{ id: string; name: string; file: string }>;
  /* Catalog metadata below is owned and validated by the Tabularium registry;
   * the host tolerates it without inspecting it. */
  description?: string;
  category?: string;
  tags?: string[];
  license?: string;
  icon?: string;
  screenshots?: Array<{ url: string; caption?: string; alt?: string }>;
  readme?: string;
  readmes?: Record<string, string>;
  documentation_url?: string;
  homepage?: string;
  support?: { email?: string; issues_url?: string };
}

/** Supplied by a trusted native catalog or the host's builtin adapter. */
export type ThemeContributionOrigin =
  | { kind: "builtin" }
  | { kind: "personal" }
  | { kind: "installed"; identity: InstalledThemeIdentity; packageVersion: string };

export interface ThemeContributionContext {
  id: string;
  name: string;
  revision: string;
  origin: ThemeContributionOrigin;
  author?: string;
}

export interface ResolvedThemeContribution {
  descriptor: ThemeContributionContext & { readOnly: boolean; mode: ThemePackageMode };
  theme: Theme;
  editor: MonacoThemeDefinition;
  source: { kind: "legacy"; value: Theme } | { kind: "v1"; value: ThemeDefinitionV1 };
}
