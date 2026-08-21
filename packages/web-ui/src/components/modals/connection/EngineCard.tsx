import clsx from "clsx";
import { Database, Download, MonitorOff, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { PluginManifest } from "../../../types/plugins";
import type { CatalogueDriver, EngineGroup } from "../../../utils/connectionCatalogue";
import { labelForParadigm } from "../../../utils/connectionCatalogue";
import { getDriverIcon, isUrlIcon } from "../../../utils/driverUI";
import { RegistryDriverIcon } from "../../RegistryDriverIcon";

interface EngineCardProps {
  group: EngineGroup;
  onSelect: (group: EngineGroup) => void;
}

/** Pleasant accent per data-model family, used when a driver declares no color. */
const PARADIGM_ACCENT: Record<string, string> = {
  sql: "#3b82f6",
  nosql: "#10b981",
  document: "#10b981",
  "key-value": "#14b8a6",
  vector: "#a855f7",
  graph: "#f59e0b",
  timeseries: "#ec4899",
  relational: "#3b82f6",
  other: "#64748b",
};

function accentFor(group: EngineGroup, rep: CatalogueDriver): string {
  return rep.color || PARADIGM_ACCENT[group.primaryParadigm] || "#64748b";
}

function renderIcon(rep: CatalogueDriver) {
  const icon = rep.icon ?? "";
  if (isUrlIcon(icon)) {
    return <RegistryDriverIcon src={icon} size={24} fallback={<Database size={20} />} />;
  }
  if (rep.isBuiltin) {
    return getDriverIcon({ icon, color: rep.color ?? undefined } as PluginManifest, 22);
  }
  return <Database size={20} />;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function EngineCard({ group, onSelect }: EngineCardProps) {
  const { t } = useTranslation();
  const rep = group.drivers.find((d) => d.isBuiltin) ?? group.drivers[0];
  const accent = accentFor(group, rep);
  const driverCount = group.drivers.length;
  const unsupported = !group.platformSupported;

  return (
    <button
      type="button"
      aria-label={t("connectionCatalogue.connectTo", {
        name: group.displayName,
        defaultValue: "Connect to {{name}}",
      })}
      onClick={() => onSelect(group)}
      style={{ "--accent": accent } as CSSProperties}
      className={clsx(
        "group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border p-3 text-left",
        "border-default bg-surface-secondary transition-all duration-150",
        "hover:-translate-y-px hover:border-[var(--accent)] hover:bg-surface hover:shadow-md hover:shadow-black/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50",
      )}
    >
      {/* accent rail */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: accent }}
      />

      {/* header row: icon · name · status */}
      <span className="flex w-full items-center gap-2.5">
        {/* icon tile — dimmed instead of the whole card so the text stays readable */}
        <span
          className={clsx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            unsupported && "opacity-50 grayscale",
          )}
          style={{ backgroundColor: `${accent}1f`, color: accent }}
        >
          {renderIcon(rep)}
        </span>

        {/* name wraps (up to 2 lines) instead of truncating; icon stays glued to the last word */}
        <span
          className="line-clamp-2 min-w-0 flex-1 font-semibold leading-snug text-primary [overflow-wrap:anywhere]"
          title={group.displayName}
        >
          {group.displayName}
          {group.verified && (
            <span
              className="ml-1.5 inline-flex translate-y-px items-center align-baseline text-blue-400"
              title={t("connectionCatalogue.verified", { defaultValue: "Verified" })}
            >
              <ShieldCheck size={13} aria-hidden />
              <span className="sr-only">{t("connectionCatalogue.verified", { defaultValue: "Verified" })}</span>
            </span>
          )}
        </span>

        {/* trailing status */}
        {group.installed ? (
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t("connectionCatalogue.installed", { defaultValue: "Installed" })}
          </span>
        ) : unsupported ? (
          <span
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-400"
            title={t("connectionCatalogue.unavailableOnPlatform", { defaultValue: "Unavailable on your platform" })}
          >
            <MonitorOff size={10} aria-hidden />
            {t("connectionCatalogue.unavailable", { defaultValue: "Unavailable" })}
          </span>
        ) : (
          <span className="shrink-0 whitespace-nowrap rounded-full border border-default px-2 py-0.5 text-[10px] font-medium text-muted transition-colors group-hover:border-[var(--accent)] group-hover:text-primary">
            {t("connectionCatalogue.install", { defaultValue: "Install" })}
          </span>
        )}
      </span>

      {/* meta row, full card width: paradigm (+n) · drivers · downloads */}
      <span className="block w-full truncate text-[11px] text-muted">
        {labelForParadigm(group.primaryParadigm)}
        {group.secondaryParadigms.length > 0 && (
          <span className="text-muted/70"> +{group.secondaryParadigms.length}</span>
        )}
        {driverCount > 1 && (
          <span className="text-muted/70">
            {" · "}
            {t("connectionCatalogue.driverCount", { count: driverCount, defaultValue: "{{count}} drivers" })}
          </span>
        )}
        {group.downloads != null && (
          <span className="text-muted/70">
            {" · "}
            <Download size={10} className="inline -translate-y-px" aria-hidden />
            {formatCount(group.downloads)}
          </span>
        )}
      </span>
    </button>
  );
}
