import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, Pencil, Save } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import { useAlert } from "../../hooks/useAlert";
import { DEFAULT_SETTINGS } from "../../contexts/SettingsContext";
import { toErrorMessage } from "../../utils/errors";
import { PasswordInput } from "../ui/PasswordInput";
import {
  SettingSection,
  SettingRow,
  SettingButtonGroup,
  SettingNumberInput,
} from "./SettingControls";

interface BackupStatus {
  passwordSet: boolean;
  targetPasswordSet: boolean;
  lastBackupAt: string | null;
}

const INTERVAL_PRESETS = [360, 720, 1440, 10080];

const textInputClass =
  "w-64 px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors";

export function BackupTab() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { showAlert } = useAlert();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [password, setPassword] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [webdavUrl, setWebdavUrl] = useState(settings.backupWebdavUrl ?? "");
  const [webdavUsername, setWebdavUsername] = useState(
    settings.backupWebdavUsername ?? "",
  );
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingWebdav, setSavingWebdav] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [editingWebdavPassword, setEditingWebdavPassword] = useState(false);
  const [runningBackup, setRunningBackup] = useState(false);
  const target = settings.backupTarget ?? "local";
  const interval = settings.backupIntervalMinutes ?? 1440;
  const [customInterval, setCustomInterval] = useState(
    () => !INTERVAL_PRESETS.includes(interval),
  );
  const nextBackupAt =
    (settings.backupMode ?? "manual") === "interval" && status?.lastBackupAt
      ? new Date(
          new Date(status.lastBackupAt).getTime() + interval * 60_000,
        )
      : null;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await invoke<BackupStatus>("get_connections_backup_status"));
    } catch (e) {
      console.error("Failed to load backup status:", e);
    }
  }, []);

  // Status (stored credential, newest backup) is per target, so re-fetch it
  // when the user switches the destination.
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, target]);

  const handlePickDirectory = async () => {
    const selected = await open({ multiple: false, directory: true });
    if (typeof selected === "string") {
      await updateSetting("backupDirectory", selected);
      void refreshStatus();
    }
  };

  const handleSavePassword = async () => {
    setSavingPassword(true);
    try {
      await invoke("set_connections_backup_password", { password });
      setPassword("");
      setEditingPassword(false);
      await refreshStatus();
      showAlert(t("settings.backup.passwordSaved"));
    } catch (e) {
      showAlert(toErrorMessage(e));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSaveWebdavPassword = async () => {
    if (!webdavPassword) return;
    setSavingWebdav(true);
    try {
      await invoke("set_connections_backup_target_password", {
        targetId: "webdav",
        password: webdavPassword,
      });
      setWebdavPassword("");
      setEditingWebdavPassword(false);
      await refreshStatus();
      showAlert(t("settings.backup.webdavSaved"));
    } catch (e) {
      showAlert(toErrorMessage(e));
    } finally {
      setSavingWebdav(false);
    }
  };

  const handleBackupNow = async () => {
    setRunningBackup(true);
    try {
      const path = await invoke<string>("run_connections_backup");
      await refreshStatus();
      showAlert(t("settings.backup.backupDone", { path }));
    } catch (e) {
      showAlert(toErrorMessage(e));
    } finally {
      setRunningBackup(false);
    }
  };

  const configured =
    status?.passwordSet === true &&
    (target === "webdav"
      ? Boolean(settings.backupWebdavUrl) && status?.targetPasswordSet === true
      : Boolean(settings.backupDirectory));

  return (
    <div>
      <SettingSection title={t("settings.backup.destination")}>
        <SettingRow
          label={t("settings.backup.target")}
          description={t("settings.backup.targetDesc")}
        >
          <SettingButtonGroup<"local" | "webdav">
            value={target}
            onChange={(v) => {
              void updateSetting("backupTarget", v);
              void refreshStatus();
            }}
            options={[
              { value: "local", label: t("settings.backup.targetLocal") },
              { value: "webdav", label: "WebDAV" },
            ]}
          />
        </SettingRow>

        {target === "local" && (
          <SettingRow
            label={t("settings.backup.directory")}
            description={
              settings.backupDirectory || t("settings.backup.directoryDesc")
            }
          >
            <button
              onClick={() => void handlePickDirectory()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 transition-colors"
            >
              <FolderOpen size={14} />
              {t("settings.backup.chooseDirectory")}
            </button>
          </SettingRow>
        )}

        {target === "webdav" && (
          <>
            <SettingRow
              label={t("settings.backup.webdavUrl")}
              description={t("settings.backup.webdavUrlDesc")}
            >
              <input
                type="url"
                value={webdavUrl}
                onChange={(e) => setWebdavUrl(e.target.value)}
                onBlur={() =>
                  void updateSetting("backupWebdavUrl", webdavUrl.trim())
                }
                placeholder="https://cloud.example.com/remote.php/dav/files/user/backups"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                aria-label={t("settings.backup.webdavUrl")}
                className={textInputClass}
              />
            </SettingRow>
            <SettingRow
              label={t("settings.backup.webdavUsername")}
              description={t("settings.backup.webdavUsernameDesc")}
            >
              <input
                type="text"
                value={webdavUsername}
                onChange={(e) => setWebdavUsername(e.target.value)}
                onBlur={() =>
                  void updateSetting(
                    "backupWebdavUsername",
                    webdavUsername.trim(),
                  )
                }
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                aria-label={t("settings.backup.webdavUsername")}
                className={textInputClass}
              />
            </SettingRow>
            <SettingRow
              label={t("settings.backup.webdavPassword")}
              description={
                status?.targetPasswordSet && !editingWebdavPassword
                  ? t("settings.backup.webdavPasswordSetDesc")
                  : t("settings.backup.webdavPasswordDesc")
              }
            >
              {status?.targetPasswordSet && !editingWebdavPassword ? (
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="px-3 py-2 text-sm text-muted tracking-widest select-none"
                  >
                    ••••••••
                  </span>
                  <button
                    onClick={() => setEditingWebdavPassword(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 transition-colors"
                  >
                    <Pencil size={14} />
                    {t("settings.backup.changePassword")}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-48">
                    <PasswordInput
                      value={webdavPassword}
                      onChange={setWebdavPassword}
                      autoFocus={editingWebdavPassword}
                      aria-label={t("settings.backup.webdavPassword")}
                    />
                  </div>
                  <button
                    onClick={() => void handleSaveWebdavPassword()}
                    disabled={savingWebdav || !webdavPassword}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm transition-colors"
                  >
                    {savingWebdav ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    {t("common.save")}
                  </button>
                  {editingWebdavPassword && (
                    <button
                      onClick={() => {
                        setWebdavPassword("");
                        setEditingWebdavPassword(false);
                      }}
                      className="px-3 py-1.5 rounded-lg text-sm text-secondary hover:text-primary transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                  )}
                </div>
              )}
            </SettingRow>
          </>
        )}
      </SettingSection>

      <SettingSection title={t("settings.backup.title")}>
        <SettingRow
          label={t("settings.backup.mode")}
          description={t("settings.backup.modeDesc")}
        >
          <SettingButtonGroup<"manual" | "interval" | "onClose" | "onLaunch">
            value={settings.backupMode ?? "manual"}
            onChange={(v) => {
              if (v !== "manual" && !configured) {
                showAlert(t("settings.backup.configureFirst"));
                return;
              }
              void updateSetting("backupMode", v);
            }}
            options={[
              { value: "manual", label: t("settings.backup.modeManual") },
              { value: "interval", label: t("settings.backup.modeInterval") },
              { value: "onClose", label: t("settings.backup.modeOnClose") },
              { value: "onLaunch", label: t("settings.backup.modeOnLaunch") },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.backup.password")}
          description={
            status?.passwordSet
              ? editingPassword
                ? t("settings.backup.passwordReplaceDesc")
                : t("settings.backup.passwordSetDesc")
              : t("settings.backup.passwordDesc")
          }
        >
          {status?.passwordSet && !editingPassword ? (
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="px-3 py-2 text-sm text-muted tracking-widest select-none"
              >
                ••••••••
              </span>
              <button
                onClick={() => setEditingPassword(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 transition-colors"
              >
                <Pencil size={14} />
                {t("settings.backup.changePassword")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-48">
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  autoFocus={editingPassword}
                  aria-label={t("settings.backup.password")}
                />
              </div>
              <button
                onClick={() => void handleSavePassword()}
                disabled={savingPassword || !password}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm transition-colors"
              >
                {savingPassword ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {t("common.save")}
              </button>
              {editingPassword && (
                <button
                  onClick={() => {
                    setPassword("");
                    setEditingPassword(false);
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm text-secondary hover:text-primary transition-colors"
                >
                  {t("common.cancel")}
                </button>
              )}
            </div>
          )}
        </SettingRow>

        {(settings.backupMode ?? "manual") === "interval" && (
        <SettingRow
          label={t("settings.backup.interval")}
          description={t("settings.backup.intervalDesc")}
        >
          <div className="flex items-center gap-2">
            <SettingButtonGroup<number>
              value={customInterval ? -1 : interval}
              onChange={(v) => {
                if (v === -1) {
                  setCustomInterval(true);
                  return;
                }
                setCustomInterval(false);
                void updateSetting("backupIntervalMinutes", v);
              }}
              options={[
                { value: 360, label: t("settings.backup.every6h") },
                { value: 720, label: t("settings.backup.every12h") },
                { value: 1440, label: t("settings.backup.daily") },
                { value: 10080, label: t("settings.backup.weekly") },
                { value: -1, label: t("settings.backup.custom") },
              ]}
            />
            {customInterval && (
              <SettingNumberInput
                value={Math.max(1, Math.round(interval / 60))}
                onChange={(v) =>
                  updateSetting("backupIntervalMinutes", (v || 24) * 60)
                }
                min={1}
                max={720}
                suffix={t("settings.backup.hours")}
                fallback={24}
              />
            )}
          </div>
        </SettingRow>
        )}

        <SettingRow
          label={t("settings.backup.retention")}
          description={t("settings.backup.retentionDesc")}
        >
          <SettingNumberInput
            value={settings.backupRetention ?? DEFAULT_SETTINGS.backupRetention ?? 10}
            onChange={(v) =>
              updateSetting(
                "backupRetention",
                v || DEFAULT_SETTINGS.backupRetention || 10,
              )
            }
            min={1}
            max={100}
            suffix={t("settings.backup.files")}
            fallback={DEFAULT_SETTINGS.backupRetention ?? 10}
          />
        </SettingRow>
        <SettingRow
          label={t("settings.backup.backupNow")}
          description={
            (status?.lastBackupAt
              ? t("settings.backup.lastBackup", {
                  date: new Date(status.lastBackupAt).toLocaleString(),
                })
              : t("settings.backup.noBackupYet")) +
            (nextBackupAt
              ? ` — ${t("settings.backup.nextBackup", {
                  date: nextBackupAt.toLocaleString(),
                })}`
              : (settings.backupMode ?? "manual") === "interval"
                ? ` — ${t("settings.backup.nextBackupSoon")}`
                : "")
          }
        >
          <button
            onClick={() => void handleBackupNow()}
            disabled={runningBackup || !configured}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 disabled:opacity-50 transition-colors"
          >
            {runningBackup && <Loader2 size={14} className="animate-spin" />}
            {t("settings.backup.backupNow")}
          </button>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
