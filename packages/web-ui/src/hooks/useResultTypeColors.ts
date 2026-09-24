import { useEffect } from "react";
import { useSettings } from "./useSettings";
import { useTheme } from "./useTheme";
import type { ResultValueType } from "../utils/dataGrid";

const TYPES: ResultValueType[] = ["number", "string", "date", "boolean"];

export function useResultTypeColors(): void {
  const { settings } = useSettings();
  const { currentTheme } = useTheme();

  const colorByType = settings.resultColorByType ?? false;
  const overrides = settings.resultTypeColors;

  useEffect(() => {
    const root = document.documentElement;

    if (!colorByType) {
      for (const type of TYPES) {
        root.style.removeProperty(`--rcell-${type}`);
      }
      return;
    }

    for (const type of TYPES) {
      const color = overrides?.[type] || currentTheme.colors.semantic[type];
      root.style.setProperty(`--rcell-${type}`, color);
    }
  }, [colorByType, overrides, currentTheme]);
}
