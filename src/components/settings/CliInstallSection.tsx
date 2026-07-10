import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Loader2, Terminal, Trash2 } from "lucide-react";
import { SettingRow, SettingSection } from "./SettingControls";
import {
  binDirFromLink,
  isForceableInstallError,
  pathExportLine,
  type CliInstallStatus,
} from "../../utils/cli";

export function CliInstallSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CliInstallStatus | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canForce, setCanForce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<CliInstallStatus>("get_cli_install_status")
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.supported) {
    return null;
  }

  const install = async (force: boolean) => {
    setIsInstalling(true);
    setError(null);
    try {
      const next = await invoke<CliInstallStatus>("install_cli_shortcut", {
        force,
      });
      setStatus(next);
      setCanForce(false);
    } catch (e) {
      const message = String(e);
      setError(message);
      setCanForce(!force && isForceableInstallError(message));
    } finally {
      setIsInstalling(false);
    }
  };

  const remove = async () => {
    setIsInstalling(true);
    setError(null);
    setCanForce(false);
    try {
      const next = await invoke<CliInstallStatus>("remove_cli_shortcut");
      setStatus(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsInstalling(false);
    }
  };

  const binDir = status.linkPath ? binDirFromLink(status.linkPath) : null;

  return (
    <SettingSection
      title={t("settings.cli.title")}
      icon={<Terminal size={14} className="text-muted" />}
    >
      <SettingRow
        label={t("settings.cli.install")}
        description={t("settings.cli.installDesc")}
      >
        {status.installed ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-green-500">
              <CheckCircle2 size={16} />
              {t("settings.cli.installed")}
            </div>
            {status.removable && (
              <button
                onClick={remove}
                disabled={isInstalling}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
              >
                {isInstalling ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                {t("settings.cli.removeButton")}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => install(false)}
            disabled={isInstalling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/15 border border-blue-500/25 text-blue-400 hover:bg-blue-500/25 disabled:opacity-50 transition-colors"
          >
            {isInstalling ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Terminal size={14} />
            )}
            {t("settings.cli.installButton")}
          </button>
        )}
      </SettingRow>

      {status.installed && status.linkPath && (
        <div className="text-xs text-muted font-mono pb-3">
          {status.linkPath}
        </div>
      )}

      {status.installed && !status.inPath && binDir && (
        <div className="bg-yellow-900/20 border border-yellow-900/50 text-yellow-400 px-4 py-3 rounded-lg text-xs mb-3">
          <div className="mb-1">
            {t("settings.cli.notInPath", { dir: binDir })}
          </div>
          <code className="font-mono select-all">{pathExportLine(binDir)}</code>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-900/50 text-red-400 px-4 py-3 rounded-lg text-xs mb-3 space-y-2">
          <div className="whitespace-pre-wrap break-all">{error}</div>
          {canForce && (
            <button
              onClick={() => install(true)}
              disabled={isInstalling}
              className="px-3 py-1.5 rounded-md font-medium bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
            >
              {t("settings.cli.replaceButton")}
            </button>
          )}
        </div>
      )}
    </SettingSection>
  );
}
