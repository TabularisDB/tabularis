import schema from "../schemas/theme-definition-v1.json";
import type { ThemeDefinitionV1, ThemePackageMode } from "../types/themePackage";
import { parseBoundedJsoncTheme, parseThemeDefinition, THEME_INPUT_LIMITS } from "./themePackageValidation";

export type VsCodeDiagnosticCode = "unsupportedKey" | "unsupportedColor" | "unsupportedScope" | "scopeApproximation" | "unsupportedStyle" | "ignoredInclude" | "ignoredSemanticTokens" | "unsupportedReference" | "unsupportedSetting" | "tokenAlphaFlattened" | "modeApproximation" | "diagnosticsTruncated";
export interface VsCodeThemeDiagnostic { code: VsCodeDiagnosticCode; path: string }
export interface VsCodeThemeConversion { definition: ThemeDefinitionV1; name?: string; diagnostics: VsCodeThemeDiagnostic[]; mappedColors: number; mappedRules: number }
export interface VsCodeThemeOptions { mode?: ThemePackageMode; attribution?: string }

export class VsCodeThemeImportError extends Error {
  readonly code: "unrecognized" | "modeRequired" | "includeOnly" | "noSupportedData" | "invalidColor" | "invalidRules";
  constructor(code: VsCodeThemeImportError["code"]) {
    super(`VS Code theme conversion: ${code}`);
    this.code = code;
  }
}

// Deliberately small, documented workbench-to-application mapping. Everything
// else is either a registered Monaco color or receives a conversion diagnostic.
const APPLICATION_COLORS = {
  "editor.background": ["bg", "base"], "editor.foreground": ["text", "primary"],
  "sideBar.background": ["surface", "primary"], "sideBar.foreground": ["text", "secondary"],
  "panel.background": ["bg", "elevated"], "input.background": ["bg", "input"],
  "list.hoverBackground": ["surface", "hover"], "editor.selectionBackground": ["surface", "active"],
  "focusBorder": ["border", "focus"], "panel.border": ["border", "default"],
  "button.background": ["accent", "primary"], "button.foreground": ["text", "inverse"],
  "errorForeground": ["accent", "error"], "editorWarning.foreground": ["accent", "warning"],
  "editorInfo.foreground": ["accent", "info"],
} as const;
const SCOPES: ReadonlyArray<readonly [string, string]> = [
  ["punctuation.definition.string", "string.quote.sql"], ["keyword.operator", "operator.sql"],
  ["constant.numeric", "number.sql"], ["constant.language", "predefined.sql"],
  ["storage.type", "predefined.sql"], ["support.type", "predefined.sql"], ["support.function", "predefined.sql"],
  ["punctuation.separator", "delimiter.sql"], ["punctuation.terminator", "delimiter.sql"],
  ["entity.name", "identifier.sql"], ["variable", "identifier.sql"], ["comment", "comment.sql"],
  ["string", "string.sql"], ["keyword", "keyword.sql"], ["invalid", "invalid.sql"],
];
const STYLES = new Set(["italic", "bold", "underline", "strikethrough"]);
const ROOT_KEYS = new Set(["$schema", "name", "type", "colors", "tokenColors", "semanticTokenColors", "semanticHighlighting", "include", "author"]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function color(value: unknown): string {
  if (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) throw new VsCodeThemeImportError("invalidColor");
  return value.length === 4 || value.length === 5 ? `#${[...value.slice(1)].map((part) => part + part).join("")}` : value;
}

/** Pure, bounded conversion: no includes, network access, VSIX or code execution. */
export function convertVsCodeTheme(source: string, options: VsCodeThemeOptions = {}): VsCodeThemeConversion {
  const input = record(parseBoundedJsoncTheme(source));
  if (!input) throw new VsCodeThemeImportError("unrecognized");
  const colors = record(input.colors);
  const tokens = input.tokenColors;
  if (!colors && !Array.isArray(tokens)) {
    throw new VsCodeThemeImportError(typeof input.include === "string" ? "includeOnly" : "unrecognized");
  }
  const diagnostics: VsCodeThemeDiagnostic[] = [];
  const diagnostic = (code: VsCodeDiagnosticCode, path: string) => {
    if (diagnostics.length < 128) diagnostics.push({ code, path: path.length > 256 ? `${path.slice(0, 255)}…` : path });
    else if (diagnostics.length === 128) diagnostics.push({ code: "diagnosticsTruncated", path: "" });
  };
  for (const key of Object.keys(input)) if (!ROOT_KEYS.has(key)) diagnostic("unsupportedKey", key);
  if (input.include !== undefined) diagnostic("ignoredInclude", "include");
  for (const key of ["semanticTokenColors", "semanticHighlighting"]) if (input[key] !== undefined) diagnostic("ignoredSemanticTokens", key);
  const inferred: ThemePackageMode | undefined = input.type === "light" ? "light" : input.type === "dark" ? "dark" : input.type === "hc" || input.type === "hcDark" ? "high-contrast" : undefined;
  const mode = options.mode ?? inferred;
  if (!mode) throw new VsCodeThemeImportError("modeRequired");
  if (input.type !== undefined && (!inferred || (options.mode && options.mode !== inferred))) diagnostic("modeApproximation", "type");
  const definition: ThemeDefinitionV1 = { schemaVersion: 1, mode };
  const attribution = options.attribution ?? (typeof input.author === "string" ? input.author : undefined);
  if (attribution !== undefined) definition.attribution = attribution;
  const editor: NonNullable<ThemeDefinitionV1["editor"]> = { colors: {}, rules: [] };
  let mappedColors = 0;
  for (const [key, value] of Object.entries(colors ?? {})) {
    const app = Object.hasOwn(APPLICATION_COLORS, key) ? APPLICATION_COLORS[key as keyof typeof APPLICATION_COLORS] : undefined;
    const monaco = Object.hasOwn(schema.properties.editor.properties.colors.properties, key);
    if (!app && !monaco) { diagnostic("unsupportedColor", `colors.${key}`); continue; }
    const hex = color(value);
    if (app) {
      const [group, leaf] = app;
      definition.colors = { ...definition.colors, [group]: { ...definition.colors?.[group], [leaf]: hex } };
    }
    if (monaco) editor.colors![key] = hex;
    if (key === "editor.foreground" && hex.length === 9) diagnostic("tokenAlphaFlattened", `colors.${key}`);
    ++mappedColors;
  }
  if (typeof tokens === "string") diagnostic("unsupportedReference", "tokenColors");
  else if (tokens !== undefined && !Array.isArray(tokens)) throw new VsCodeThemeImportError("invalidRules");
  let mappedRules = 0;
  for (const [index, token] of (Array.isArray(tokens) ? tokens : []).entries()) {
    const rule = record(token);
    const settings = record(rule?.settings);
    if (!rule || !settings) throw new VsCodeThemeImportError("invalidRules");
    const path = `tokenColors[${index}]`;
    for (const key of Object.keys(rule)) if (!["name", "scope", "settings"].includes(key)) diagnostic("unsupportedKey", `${path}.${key}`);
    for (const key of Object.keys(settings)) if (!["foreground", "fontStyle"].includes(key)) diagnostic("unsupportedSetting", `${path}.settings.${key}`);
    const foreground = settings.foreground === undefined ? undefined : color(settings.foreground);
    if (foreground?.length === 9) diagnostic("tokenAlphaFlattened", `${path}.settings.foreground`);
    let fontStyle: string | undefined;
    if (settings.fontStyle !== undefined) {
      if (typeof settings.fontStyle !== "string") throw new VsCodeThemeImportError("invalidRules");
      const styles = settings.fontStyle.trim() ? settings.fontStyle.trim().split(/\s+/) : [];
      for (const style of styles) if (!STYLES.has(style)) diagnostic("unsupportedStyle", `${path}.settings.fontStyle:${style}`);
      fontStyle = styles.length === 0 || styles.some((style) => STYLES.has(style)) ? [...new Set(styles.filter((style) => STYLES.has(style)))].join(" ") : undefined;
    }
    const scopes = rule.scope === undefined ? [""] : typeof rule.scope === "string" ? rule.scope.split(",", THEME_INPUT_LIMITS.tokenRules + 1) : rule.scope;
    if (!Array.isArray(scopes) || scopes.length > THEME_INPUT_LIMITS.tokenRules || scopes.some((scope) => typeof scope !== "string")) throw new VsCodeThemeImportError("invalidRules");
    for (const raw of scopes as string[]) {
      const scope = raw.trim();
      const mapping = scope === "" ? ["", ""] : /^[\w.-]+$/.test(scope) ? SCOPES.find(([prefix]) => scope === prefix || scope.startsWith(`${prefix}.`)) : undefined;
      if (!mapping) { diagnostic("unsupportedScope", `${path}.scope:${scope}`); continue; }
      if (scope !== mapping[0]) diagnostic("scopeApproximation", `${path}.scope:${scope}`);
      if (foreground === undefined && fontStyle === undefined) continue;
      if (mappedRules >= THEME_INPUT_LIMITS.tokenRules) throw new VsCodeThemeImportError("invalidRules");
      editor.rules!.push({ token: mapping[1], ...(foreground === undefined ? {} : { foreground }), ...(fontStyle === undefined ? {} : { fontStyle }) });
      ++mappedRules;
    }
  }
  if (mappedColors + mappedRules === 0) throw new VsCodeThemeImportError("noSupportedData");
  definition.editor = editor;
  // Reuse the host schema, including output budgets and the SQL token allowlist.
  const validated = parseThemeDefinition(JSON.stringify(definition));
  return { definition: validated, name: typeof input.name === "string" ? input.name : undefined, diagnostics, mappedColors, mappedRules };
}
