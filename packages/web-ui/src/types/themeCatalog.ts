import type { Theme, MonacoThemeDefinition } from "./theme";
import type { ResolvedThemeContribution, ThemeContributionContext, ThemePackageManifestV1, ThemePackageMode } from "./themePackage";

export interface NativeThemeContribution extends ThemeContributionContext {
  readOnly: boolean;
  mode: ThemePackageMode;
  format: "legacy" | "v1";
  source: string;
  available: boolean;
  editor?: MonacoThemeDefinition | null;
}

/** Validated local archive, returned before the user confirms the install. */
export interface LocalThemePreview { digest: string; manifest: ThemePackageManifestV1; variants: NativeThemeContribution[] }
/** A committed package operation; warnings describe deferred cleanup only. */
export interface ThemeCommit { warnings: string[] }

export interface ThemeCatalogIssue { location: string; message: string }
export interface NativeThemeCatalog { themes: NativeThemeContribution[]; issues: string[] }
export interface CatalogTheme { entry: NativeThemeContribution; resolved: ResolvedThemeContribution }
export interface ResolvedThemeCatalog { themes: CatalogTheme[]; issues: ThemeCatalogIssue[] }
export interface ThemeSelection {
  theme: Theme;
  requestedId: string;
  missingId?: string;
  previewing: boolean;
}
