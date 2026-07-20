import { AlertTriangle, Database, Loader2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogueDriver } from "../../../utils/connectionCatalogue";

export type InstallStatus = "idle" | "installing" | "error";

interface InstallGateProps {
  driver: CatalogueDriver;
  status: InstallStatus;
  error?: string;
  onInstall: (slug: string, version: string) => void;
  onBack: () => void;
}

const PARADIGM_ACCENT: Record<string, string> = {
  sql: "#3b82f6",
  nosql: "#10b981",
  document: "#10b981",
  "key-value": "#14b8a6",
  vector: "#a855f7",
  graph: "#f59e0b",
  timeseries: "#ec4899",
};

function accentFor(driver: CatalogueDriver): string {
  return driver.color || PARADIGM_ACCENT[driver.paradigms[0] ?? ""] || "#64748b";
}

function renderIcon(driver: CatalogueDriver) {
  const icon = driver.icon ?? "";
  if (/^https?:\/\//.test(icon) || icon.startsWith("data:")) {
    return <img src={icon} alt="" className="h-8 w-8 rounded object-contain" />;
  }
  return <Database size={26} />;
}

export function InstallGate({ driver, status, error, onInstall, onBack }: InstallGateProps) {
  const { t } = useTranslation();
  const accent = accentFor(driver);
  const unsupported = !driver.platformSupported;
  const installing = status === "installing";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <span
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ backgroundColor: `${accent}1f`, color: accent } as CSSProperties}
      >
        {renderIcon(driver)}
      </span>

      <div className="space-y-1">
        <h3 className="text-lg font-semibold capitalize text-primary">{driver.name}</h3>
        {driver.paradigms.length > 0 && (
          <p className="text-xs capitalize text-muted">{driver.paradigms.join(" · ")}</p>
        )}
      </div>

      {unsupported ? (
        <div className="flex max-w-sm flex-col items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              {t("connectionCatalogue.noReleaseTitle", {
                defaultValue: "No installable release for your platform yet.",
              })}
            </span>
          </div>
          <p className="text-xs text-muted">
            {t("connectionCatalogue.noReleaseBody", {
              defaultValue:
                "This driver has no downloadable build for your OS/architecture. Check the registry for an updated release.",
            })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <p className="max-w-sm text-sm text-secondary">
            {t("connectionCatalogue.notInstalled", {
              defaultValue: "This driver isn't installed yet. Install it to configure a connection.",
            })}
          </p>
          {status === "error" && error && (
            <p className="max-w-sm break-words text-xs text-red-400">{error}</p>
          )}
          <button
            type="button"
            onClick={() => onInstall(driver.slug, driver.latestVersion)}
            disabled={installing}
            className="mt-1 flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {installing && <Loader2 size={14} className="animate-spin" />}
            {installing
              ? t("connectionCatalogue.installingVersion", {
                  version: driver.latestVersion,
                  defaultValue: "Installing v{{version}}…",
                })
              : status === "error"
                ? t("connectionCatalogue.retryInstall", { defaultValue: "Retry install" })
                : t("connectionCatalogue.installVersion", {
                    version: driver.latestVersion,
                    defaultValue: "Install v{{version}}",
                  })}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-1 cursor-pointer text-xs text-muted hover:text-primary"
      >
        ← {t("newConnection.changeDatabase", { defaultValue: "Change database" })}
      </button>
    </div>
  );
}
