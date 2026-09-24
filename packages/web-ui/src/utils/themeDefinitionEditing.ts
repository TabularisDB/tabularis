import type { Theme } from "../types/theme";
import type { ThemeDefinitionV1 } from "../types/themePackage";
import { parseThemeDefinition } from "./themePackageValidation";

/** Apply only edited leaves; unrelated author overrides and ordering survive. */
export function editThemeDefinition(source: string, previous: Theme, next: Theme): string {
  const definition = parseThemeDefinition(source);
  const before = JSON.stringify(definition);
  for (const group of ["bg", "surface", "text", "accent", "border", "semantic"] as const) {
    const changes: Record<string, string> = {};
    for (const key of Object.keys(next.colors[group])) {
      const old = previous.colors[group] as unknown as Record<string, string>;
      const value = (next.colors[group] as unknown as Record<string, string>)[key];
      if (value !== old[key]) changes[key] = value;
    }
    if (Object.keys(changes).length) definition.colors = { ...definition.colors, [group]: { ...definition.colors?.[group], ...changes } };
  }
  if (JSON.stringify(previous.typography.fontSize) !== JSON.stringify(next.typography.fontSize)
      || JSON.stringify(previous.layout.spacing) !== JSON.stringify(next.layout.spacing)
      || JSON.stringify(previous.taskbarIcon) !== JSON.stringify(next.taskbarIcon)) {
    throw new Error("This field is not supported by theme definition v1");
  }
  for (const slot of ["base", "mono"] as const) {
    if (previous.typography.fontFamily[slot] !== next.typography.fontFamily[slot]) {
      const names = next.typography.fontFamily[slot].split(",").map((name) => name.trim().replace(/^(["'])(.*)\1$/, "$2"));
      definition.typography = { fontFamily: { ...definition.typography?.fontFamily, [slot]: names } };
    }
  }
  for (const slot of ["sm", "base", "lg", "xl"] as const) {
    if (previous.layout.borderRadius[slot] !== next.layout.borderRadius[slot]) {
      const radius = next.layout.borderRadius[slot];
      if (!/^\d+(?:\.\d+)?px$/.test(radius)) throw new Error("Theme radii must use bounded pixel values");
      definition.layout = { borderRadius: { ...definition.layout?.borderRadius, [slot]: Number.parseFloat(radius) } };
    }
  }
  if (JSON.stringify(previous.monacoTheme) !== JSON.stringify(next.monacoTheme)) {
    if (!next.monacoTheme.inherit || next.monacoTheme.themeName) throw new Error("Named assets and disabled inheritance are not supported by theme v1");
    definition.mode = next.monacoTheme.base === "vs" ? "light" : next.monacoTheme.base === "hc-black" ? "high-contrast" : "dark";
    const rules: NonNullable<ThemeDefinitionV1["editor"]>["rules"] = next.monacoTheme.rules?.map((rule) => {
      if (rule.background !== undefined) throw new Error("Token backgrounds are not supported by theme v1");
      return { token: rule.token, ...(rule.foreground === undefined ? {} : { foreground: rule.foreground.startsWith("#") ? rule.foreground : `#${rule.foreground}` }), ...(rule.fontStyle === undefined ? {} : { fontStyle: rule.fontStyle }) };
    });
    definition.editor = { colors: next.monacoTheme.colors, rules };
  }
  if (JSON.stringify(definition) === before) return source;
  const updated = JSON.stringify(definition, null, 2);
  parseThemeDefinition(updated);
  return updated;
}
