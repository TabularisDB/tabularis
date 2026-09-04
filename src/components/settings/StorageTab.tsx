import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  FolderOpen,
  FolderSync,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import clsx from "clsx";
import { useAlert } from "../../hooks/useAlert";
import { toErrorMessage } from "../../utils/errors";
import {
  defaultModeFor,
  pendingPathOf,
  type NewFolderMode,
  type StorageLocationInfo,
  type StorageLocationInspection,
} from "../../utils/storageLocation";
import { SettingSection, SettingRow } from "./SettingControls";

const buttonClass =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-secondary disabled:hover:border-strong";

const primaryButtonClass =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

interface PendingChoice {
  path: string;
  inspection: StorageLocationInspection;
  mode: NewFolderMode;
}

export function StorageTab() {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const [info, setInfo] = useState<StorageLocationInfo | null>(null);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const [applying, setApplying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInfo(await invoke<StorageLocationInfo>("get_storage_location"));
    } catch (e) {
      console.error("Failed to load storage location:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lockedByEnv = info?.source === "env";

  const handlePickFolder = async () => {
    const selected = await open({ multiple: false, directory: true });
    if (typeof selected !== "string") return;
    try {
      const inspection = await invoke<StorageLocationInspection>(
        "inspect_storage_location",
        { path: selected },
      );
      setPending({ path: selected, inspection, mode: defaultModeFor(inspection) });
    } catch (e) {
      showAlert(toErrorMessage(e));
    }
  };

  const handleApply = async () => {
    if (!pending) return;
    setApplying(true);
    try {
      const next = await invoke<StorageLocationInfo>("set_storage_location", {
        path: pending.path,
        copyData: pending.mode === "copy",
      });
      setInfo(next);
      setPending(null);
    } catch (e) {
      showAlert(toErrorMessage(e));
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    try {
      setInfo(await invoke<StorageLocationInfo>("reset_storage_location"));
      setPending(null);
    } catch (e) {
      showAlert(toErrorMessage(e));
    }
  };

  const handleOpenFolder = async () => {
    try {
      await invoke("open_storage_location");
    } catch (e) {
      showAlert(toErrorMessage(e));
    }
  };

  const pendingPath = info ? pendingPathOf(info) : null;
  const sourceLabel =
    info?.source === "env"
      ? t("settings.storage.sourceEnv")
      : info?.source === "custom"
        ? t("settings.storage.sourceCustom")
        : t("settings.storage.sourceDefault");
  const canReset =
    !lockedByEnv && (info?.customPath !== null || info?.source === "custom");

  return (
    <div>
      <SettingSection title={t("settings.storage.locations")}>
        <SettingRow
          label={t("settings.storage.dataFolder")}
          description={t("settings.storage.dataFolderDesc")}
          vertical
        >
          <div className="rounded-lg border border-default bg-base px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] uppercase tracking-wider text-muted">
                {sourceLabel}
              </span>
            </div>
            <div
              className="font-mono text-sm text-primary break-all"
              data-testid="storage-current-path"
            >
              {info?.currentPath ?? "…"}
            </div>
          </div>

          {lockedByEnv && (
            <p className="mt-2 text-xs text-muted">{t("settings.storage.envHint")}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              onClick={() => void handlePickFolder()}
              disabled={!info || lockedByEnv}
              className={buttonClass}
            >
              <FolderSync size={14} />
              {t("settings.storage.changeFolder")}
            </button>
            <button onClick={() => void handleOpenFolder()} className={buttonClass}>
              <FolderOpen size={14} />
              {t("settings.storage.openFolder")}
            </button>
            {canReset && (
              <button onClick={() => void handleReset()} className={buttonClass}>
                <RotateCcw size={14} />
                {t("settings.storage.resetToDefault")}
              </button>
            )}
          </div>

          <p className="mt-3 text-xs text-muted flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
            <span>{t("settings.storage.concurrencyWarning")}</span>
          </p>
        </SettingRow>

        {pending && (
          <div className="mt-2 rounded-lg border border-blue-500/40 bg-blue-500/5 p-4">
            <div className="text-xs uppercase tracking-wider text-muted mb-1">
              {t("settings.storage.newFolder")}
            </div>
            <div className="font-mono text-sm text-primary break-all mb-3">
              {pending.path}
            </div>

            <div className="space-y-2">
              {pending.inspection.hasTabularisData && (
                <ModeOption
                  checked={pending.mode === "existing"}
                  onSelect={() => setPending({ ...pending, mode: "existing" })}
                  label={t("settings.storage.modeExisting")}
                  description={t("settings.storage.modeExistingDesc")}
                />
              )}
              <ModeOption
                checked={pending.mode === "copy"}
                onSelect={() => setPending({ ...pending, mode: "copy" })}
                label={t("settings.storage.modeCopy")}
                description={t("settings.storage.modeCopyDesc")}
              />
              {!pending.inspection.hasTabularisData && (
                <ModeOption
                  checked={pending.mode === "empty"}
                  onSelect={() => setPending({ ...pending, mode: "empty" })}
                  label={t("settings.storage.modeEmpty")}
                />
              )}
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => void handleApply()}
                disabled={applying}
                className={primaryButtonClass}
              >
                {applying && <Loader2 size={14} className="animate-spin" />}
                {t("settings.storage.apply")}
              </button>
              <button
                onClick={() => setPending(null)}
                disabled={applying}
                className={buttonClass}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}

        {pendingPath && (
          <div
            className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3"
            role="status"
          >
            <div className="min-w-0">
              <div className="text-sm text-primary font-medium">
                {t("settings.storage.restartRequired")}
              </div>
              <div className="text-xs text-muted mt-0.5 break-all">
                {t("settings.storage.restartRequiredDesc", { path: pendingPath })}
              </div>
            </div>
            <button
              onClick={() => void invoke("relaunch_app")}
              className={clsx(primaryButtonClass, "shrink-0")}
            >
              <RefreshCw size={14} />
              {t("settings.storage.restartNow")}
            </button>
          </div>
        )}

        <SettingRow
          label={t("settings.storage.envVar")}
          description={t("settings.storage.envVarDesc")}
          vertical
        >
          <pre className="rounded-lg border border-default bg-base px-3 py-2 font-mono text-xs text-secondary overflow-x-auto">
            {t("settings.storage.envVarExample")}
          </pre>
        </SettingRow>
      </SettingSection>
    </div>
  );
}

interface ModeOptionProps {
  checked: boolean;
  onSelect: () => void;
  label: string;
  description?: string;
}

function ModeOption({ checked, onSelect, label, description }: ModeOptionProps) {
  return (
    <label
      className={clsx(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors",
        checked
          ? "border-blue-500/60 bg-blue-500/10"
          : "border-default hover:border-strong",
      )}
    >
      <input
        type="radio"
        name="storage-new-folder-mode"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 accent-blue-500"
      />
      <span className="min-w-0">
        <span className="block text-sm text-primary">{label}</span>
        {description && (
          <span className="block text-xs text-muted mt-0.5">{description}</span>
        )}
      </span>
    </label>
  );
}
