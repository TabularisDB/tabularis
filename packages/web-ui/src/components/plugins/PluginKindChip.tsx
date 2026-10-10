import { Palette, Plug } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PluginKind } from "../../utils/plugins";
import { Chip } from "../ui/Chip";

/**
 * Says what a registry entry is before anything else: an executable driver or a
 * declarative theme. Same chip geometry everywhere (cards, install dialogs).
 */
export function PluginKindChip({ kind }: { kind: PluginKind }) {
  const { t } = useTranslation();
  return kind === "theme" ? (
    <Chip tone="theme" icon={<Palette size={9} aria-hidden="true" />}>
      {t("settings.plugins.kindTheme")}
    </Chip>
  ) : (
    <Chip icon={<Plug size={9} aria-hidden="true" />}>
      {t("settings.plugins.kindDriver")}
    </Chip>
  );
}
