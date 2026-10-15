import { useTranslation } from "react-i18next";
import type { TimingLabels } from "../utils/formatTime";

export function useTimingLabels(): TimingLabels {
  const { t } = useTranslation();
  return {
    execution: t("editor.timing.execution"),
    fetch: t("editor.timing.fetch"),
    total: t("editor.timing.total"),
  };
}
