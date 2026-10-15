import frozenBases from "../schemas/theme-bases-v1.json";
import type { Theme, MonacoThemeDefinition } from "../types/theme";
import type { ThemeContributionContext, ThemePackageMode, ResolvedThemeContribution } from "../types/themePackage";
import { generateMonacoTheme, getMonacoThemeDefinition } from "../themes/themeUtils";
import { registerResolvedEditorTheme } from "../themes/themeRuntime";
import { createInstalledThemeId } from "./themePackageIdentity";
import { parseThemeDefinition } from "./themePackageValidation";
import { flattenThemeColor, lightenThemeColor, withThemeAlpha } from "./themeColor";

type TokenRule = NonNullable<MonacoThemeDefinition["rules"]>[number];
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);

function materializeRules(rules: TokenRule[]): TokenRule[] {
  // Monaco allocates a color ID for every raw rule, even overwritten rules.
  // Coalesce ordered updates per token before its 8/9-bit color IDs overflow.
  // Missing leaves inherit the preceding update; explicit empty styles reset.
  const merged = new Map<string, TokenRule>();
  for (const rule of rules) merged.set(rule.token, { ...merged.get(rule.token), ...rule });
  return [...merged.values()];
}

function assertContext(context: ThemeContributionContext): void {
  if (!context.id || !context.name || !context.revision) throw new Error("Incomplete host theme context");
  if (context.origin.kind === "installed" && context.id !== createInstalledThemeId(context.origin.identity)) {
    throw new Error("Installed theme identity does not match host context");
  }
}

function finalize(
  theme: Theme, editor: MonacoThemeDefinition, context: ThemeContributionContext,
  mode: ThemePackageMode, source: ResolvedThemeContribution["source"],
): ResolvedThemeContribution {
  assertContext(context);
  const readOnly = context.origin.kind !== "personal";
  theme.id = context.id;
  theme.name = context.name;
  theme.isPreset = context.origin.kind === "builtin";
  theme.isReadOnly = readOnly;
  if (context.author !== undefined) theme.author = context.author;
  if (context.origin.kind === "installed") theme.version = context.origin.packageVersion;
  registerResolvedEditorTheme(theme, editor);
  return { descriptor: { ...structuredClone(context), readOnly, mode }, theme, editor, source };
}

/** Compatibility adapter preserves complete visual data and original wire data. */
export function resolveLegacyTheme(theme: Theme, context: ThemeContributionContext): ResolvedThemeContribution {
  const copy = structuredClone(theme);
  const editor = structuredClone(getMonacoThemeDefinition(theme));
  const mode = theme.monacoTheme.base === "vs" ? "light" : theme.monacoTheme.base === "hc-black" ? "high-contrast" : "dark";
  return finalize(copy, editor, context, mode, { kind: "legacy", value: structuredClone(theme) });
}

/** Same resolver for bundled, installed and new personal v1 definitions. */
export function resolveThemeDefinition(source: string, context: ThemeContributionContext): ResolvedThemeContribution {
  const definition = parseThemeDefinition(source);
  const theme = structuredClone(frozenBases[definition.mode]) as Theme;
  const colors = definition.colors;
  theme.colors = {
    bg: { ...theme.colors.bg, ...colors?.bg },
    surface: { ...theme.colors.surface, ...colors?.surface },
    text: { ...theme.colors.text, ...colors?.text },
    accent: { ...theme.colors.accent, ...colors?.accent },
    border: { ...theme.colors.border, ...colors?.border },
    semantic: { ...theme.colors.semantic, ...colors?.semantic },
  };
  const families = definition.typography?.fontFamily;
  for (const slot of ["base", "mono"] as const) {
    if (families?.[slot]) {
      theme.typography.fontFamily[slot] = families[slot].map((name) =>
        GENERIC_FAMILIES.has(name.toLowerCase()) ? name : `"${name}"`,
      ).join(", ");
    }
  }
  for (const slot of ["sm", "base", "lg", "xl"] as const) {
    const radius = definition.layout?.borderRadius?.[slot];
    if (radius !== undefined) theme.layout.borderRadius[slot] = `${radius}px`;
  }
  theme.monacoTheme = {
    base: definition.mode === "light" ? "vs" : definition.mode === "high-contrast" ? "hc-black" : "vs-dark",
    inherit: true,
  };
  const generated = generateMonacoTheme(theme);
  const generatedColors = { ...generated.colors };
  // Monaco parses hexadecimal colors only; the CSS keyword falls back to red.
  // Normalize v1 defaults before author overrides, leaving legacy snapshots intact.
  for (const [key, color] of Object.entries(generatedColors)) {
    if (color === "transparent") generatedColors[key] = "#00000000";
  }
  // Preserve the legacy six-digit defaults, but compose alpha numerically for
  // v1 input. The compatibility adapter deliberately retains legacy output.
  const alphaDefaults: Array<[string, string, number]> = [
    ["editor.inactiveSelectionBackground", theme.colors.surface.active, 0x80],
    ["editor.selectionHighlightBackground", theme.colors.accent.primary, 0x30],
    ["editor.wordHighlightBackground", theme.colors.accent.secondary, 0x30],
    ["editor.wordHighlightStrongBackground", theme.colors.accent.primary, 0x40],
    ["editor.findMatchBackground", theme.colors.accent.warning, 0x40],
    ["editor.findMatchHighlightBackground", theme.colors.accent.warning, 0x30],
    ["inputValidation.errorBackground", theme.colors.accent.error, 0x20],
    ["inputValidation.warningBackground", theme.colors.accent.warning, 0x20],
    ["inputValidation.infoBackground", theme.colors.accent.info, 0x20],
    ["scrollbarSlider.background", theme.colors.surface.tertiary, 0x80],
    ["scrollbarSlider.hoverBackground", theme.colors.surface.tertiary, 0x99],
  ];
  for (const [key, color, alpha] of alphaDefaults) generatedColors[key] = withThemeAlpha(color, alpha / 255);
  generatedColors["button.hoverBackground"] = lightenThemeColor(theme.colors.accent.primary, 0.1);
  const editorColors = { ...generatedColors, ...definition.editor?.colors };
  const appBackground = flattenThemeColor(theme.colors.bg.base, frozenBases[definition.mode].colors.bg.base);
  const editorBackground = flattenThemeColor(editorColors["editor.background"], appBackground);
  const defaultForeground = editorColors["editor.foreground"];
  // Monaco strips token alpha, so v1 explicitly flattens opacity against its
  // effective base background. Source values stay intact; selection highlights
  // do not recomposite these materialized token colors. Legacy is unchanged.
  const alphaDefault: TokenRule[] = defaultForeground.length === 9
    ? [{ token: "", foreground: flattenThemeColor(defaultForeground, editorBackground).slice(1) }] : [];
  const editor: MonacoThemeDefinition = {
    ...generated,
    colors: editorColors,
    rules: materializeRules([...alphaDefault, ...(generated.rules ?? []), ...(definition.editor?.rules?.map((rule) => ({
      ...rule,
      ...(rule.foreground === undefined ? {} : { foreground: rule.foreground.slice(1) }),
    })) ?? [])]).map((rule) => rule.foreground?.length === 8
      ? { ...rule, foreground: flattenThemeColor(`#${rule.foreground}`, editorBackground).slice(1) } : rule),
  };
  theme.monacoTheme = editor;
  return finalize(theme, editor, context, definition.mode, { kind: "v1", value: definition });
}
