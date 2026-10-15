import type { CatalogTheme } from "../types/themeCatalog";
import type { ThemeDefinitionV1, ThemePackageManifestV1 } from "../types/themePackage";
import { parseThemeDefinition, parseThemePackageManifest } from "./themePackageValidation";
import { resolveThemeDefinition } from "./themeResolver";
import { createThemeArchive } from "./themeArchive";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Refuse a lossy legacy conversion instead of advertising a faithful export. */
export function materializePackageDefinition(contribution: CatalogTheme): ThemeDefinitionV1 {
  if (contribution.entry.format === "v1") return parseThemeDefinition(contribution.entry.source);
  const { theme } = contribution.resolved;
  // Compare intended transparency with the v1 hex-only defaults. Do not mutate
  // the legacy source or snapshot when repairing this unsupported CSS keyword.
  const editor = {
    ...contribution.resolved.editor,
    colors: Object.fromEntries(Object.entries(contribution.resolved.editor.colors ?? {}).map(([key, color]) => [key, color === "transparent" ? "#00000000" : color])),
  };
  const context = { id: "theme:export-preview", name: contribution.entry.name, revision: "export", origin: { kind: "personal" as const } };
  const defaults = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: contribution.entry.mode }), context).theme;
  if (editor.inherit === false) throw new Error("Legacy editor inherit=false cannot be represented; use standalone JSON export.");
  const semantic = Object.fromEntries(Object.entries(theme.colors.semantic).filter(([key]) => !["connectionActive", "connectionInactive", "connection_active", "connection_inactive"].includes(key)));
  const colors = { ...theme.colors, semantic };
  const fontFamily = Object.fromEntries((["base", "mono"] as const).map((key) => [key, theme.typography.fontFamily[key].split(",").map((family) => family.trim().replace(/^(['"])(.*)\1$/, "$2"))]));
  const borderRadius = Object.fromEntries(Object.entries(theme.layout.borderRadius).flatMap(([key, value]) => {
    // Preserve identical frozen rem/zero values by inheritance, not an assumed
    // browser root font-size conversion.
    if (value === defaults.layout.borderRadius[key as keyof typeof defaults.layout.borderRadius]) return [];
    if (!/^\d+(?:\.\d+)?px$/.test(value)) throw new Error(`Unsupported legacy radius ${key}: ${value}; use standalone JSON export.`);
    return [[key, Number(value.slice(0, -2))]];
  }));
  const rules = (editor.rules ?? []).map((rule, index) => {
    if (rule.background !== undefined) throw new Error(`Legacy editor rule ${index} has a background not supported by declarative themes; use standalone JSON export.`);
    return { token: rule.token, ...(rule.foreground ? { foreground: `#${rule.foreground.replace(/^#/, "")}` } : {}), ...(rule.fontStyle !== undefined ? { fontStyle: rule.fontStyle } : {}) };
  });
  const application = { schemaVersion: 1, mode: contribution.entry.mode, colors, typography: { fontFamily }, layout: { borderRadius } };
  const generated = resolveThemeDefinition(JSON.stringify(application), context).editor;
  const editorColors = Object.fromEntries(Object.entries(editor.colors ?? {}).filter(([key, value]) => generated.colors?.[key] !== value));
  const definition = parseThemeDefinition(JSON.stringify({ ...application, editor: { colors: editorColors, rules } }));
  const resolved = resolveThemeDefinition(JSON.stringify(definition), context);
  if (canonical(resolved.editor) !== canonical(editor)) throw new Error("Legacy editor defaults/rules differ from the declarative resolver; use standalone JSON export to preserve exact appearance.");
  // V1 intentionally does not expose font-size/spacing overrides.
  if (canonical(resolved.theme.typography.fontSize) !== canonical(theme.typography.fontSize) || canonical(resolved.theme.layout.spacing) !== canonical(theme.layout.spacing)) throw new Error("Legacy font sizes or spacing cannot be represented; use standalone JSON export.");
  return definition;
}

export function exportThemePackage(contribution: CatalogTheme, manifest: ThemePackageManifestV1, licenseText: string): Uint8Array {
  const validated = parseThemePackageManifest(JSON.stringify(manifest));
  if (validated.theme_variants.length !== 1) throw new Error("Single-theme export requires one variant; use the author tool for multiple variants.");
  const definition = materializePackageDefinition(contribution);
  return createThemeArchive(new Map([
    [".tabularium", JSON.stringify(validated, null, 2) + "\n"],
    [validated.theme_variants[0].file, JSON.stringify(definition, null, 2) + "\n"],
    ["README.md", `# ${contribution.entry.name}\n\nExported from Tabularis. Review attribution and obtain redistribution rights before publication.\n`],
    ["LICENSE.txt", licenseText],
  ]));
}
