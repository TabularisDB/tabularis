import type { Theme, MonacoThemeDefinition } from "../types/theme";
export { getMonacoThemeId } from "../utils/themePackageIdentity";

// Out-of-band host state cannot be forged by author JSON properties. The weak
// association follows catalog objects and is discarded when they are replaced.
const resolvedEditors = new WeakMap<Theme, MonacoThemeDefinition>();

export function registerResolvedEditorTheme(theme: Theme, editor: MonacoThemeDefinition): void {
  resolvedEditors.set(theme, editor);
}

export function getResolvedEditorTheme(theme: Theme): MonacoThemeDefinition | undefined {
  return resolvedEditors.get(theme);
}
