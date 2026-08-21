import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { useDatabase } from "../../hooks/useDatabase";

/**
 * Thin, always-visible strip shown while the active connection is classified
 * as production, so the environment is obvious before anything is typed.
 */
export const ProductionBanner = () => {
  const { t } = useTranslation();
  const { activeConnectionId, connections } = useDatabase();
  const active = connections.find((c) => c.id === activeConnectionId);
  if (active?.environment !== "production") return null;

  return (
    <div className="flex items-center justify-center gap-1.5 px-3 py-0.5 bg-red-500/15 border-b border-red-500/30 text-red-400 text-[11px] font-bold uppercase tracking-widest select-none shrink-0">
      <TriangleAlert size={11} />
      {t("environment.banner", { name: active.name })}
    </div>
  );
};
