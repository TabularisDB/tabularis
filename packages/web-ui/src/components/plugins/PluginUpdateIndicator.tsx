import { ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Chip } from "../ui/Chip";

interface PluginUpdateIndicatorProps {
  /** Version the update would install; shown instead of the generic label when known. */
  version?: string | null;
}

/**
 * Static "update available" pill rendered in the tag row of connection and
 * plugin cards; its parent supplies the accessible label, the tooltip and
 * (optionally) the link. Same shape and tone as the update counters in the
 * sidebar and the settings navigation, so the cue is recognisable everywhere.
 */
export function PluginUpdateIndicator({ version }: PluginUpdateIndicatorProps) {
  const { t } = useTranslation();
  return (
    <Chip tone="update" shape="pill" icon={<ArrowUp size={9} aria-hidden="true" />} className="tabular-nums">
      {version ? `v${version}` : t("update.badges.tag")}
    </Chip>
  );
}
