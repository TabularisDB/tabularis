import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Lock,
  LockOpen,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import clsx from "clsx";
import { useAlert } from "../../hooks/useAlert";
import { useDatabase } from "../../hooks/useDatabase";
import { toErrorMessage } from "../../utils/errors";
import {
  syncChangeCount,
  teamSharePhase,
  type TeamShareStatus,
} from "../../utils/teamShare";
import { TeamShareSetupModal } from "../modals/TeamShareSetupModal";
import { TeamShareUnlockModal } from "../modals/TeamShareUnlockModal";
import { SettingRow, SettingSection } from "./SettingControls";

const buttonClass =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const primaryButtonClass =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const dangerButtonClass =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-red-400 hover:border-red-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Settings panel for the team share: point this machine at a shared vault,
 * unlock it, sync it, or leave it.
 *
 * Which connections go in the share is decided on the connections screen
 * instead, where they already are and can be multi-selected — a picker here
 * would be an unusable list for anyone with more than a handful of servers.
 */
export function TeamShareSection() {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const { loadConnections } = useDatabase();
  const [status, setStatus] = useState<TeamShareStatus | null>(null);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isUnlockOpen, setIsUnlockOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<TeamShareStatus>("get_team_share_status"));
    } catch (e) {
      console.error("Failed to load the team share status:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const phase = teamSharePhase(status);

  const applyStatus = useCallback(
    (next: TeamShareStatus) => {
      setStatus(next);
      void loadConnections();
    },
    [loadConnections],
  );

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      applyStatus(await invoke<TeamShareStatus>("sync_team_share"));
    } catch (e) {
      showAlert(toErrorMessage(e));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLock = async () => {
    try {
      applyStatus(await invoke<TeamShareStatus>("lock_team_share"));
    } catch (e) {
      showAlert(toErrorMessage(e));
    }
  };

  const handleDisable = async () => {
    try {
      applyStatus(
        await invoke<TeamShareStatus>("disable_team_share", {
          keepConnections: false,
        }),
      );
    } catch (e) {
      showAlert(toErrorMessage(e));
    }
  };

  const lastSyncCount = syncChangeCount(status?.lastSync ?? null);

  return (
    <SettingSection
      title={t("settings.teamShare.title")}
      description={t("settings.teamShare.description")}
    >
      <SettingRow
        label={t("settings.teamShare.vault")}
        description={t("settings.teamShare.vaultDesc")}
        vertical
      >
        <div className="rounded-lg border border-default bg-base px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <PhaseBadge phase={phase} />
            {status?.revision != null && (
              <span className="text-[11px] text-muted">
                {t("settings.teamShare.revision", { revision: status.revision })}
              </span>
            )}
          </div>
          <div
            className="font-mono text-sm text-primary break-all"
            data-testid="team-share-path"
          >
            {status?.path ?? t("settings.teamShare.notConfigured")}
          </div>
          {status?.updatedBy && status.updatedAt && (
            <div className="text-xs text-muted mt-1">
              {t("settings.teamShare.lastWrite", {
                who: status.updatedBy,
                when: status.updatedAt,
              })}
            </div>
          )}
        </div>

        {phase === "unreachable" && (
          <p className="mt-2 text-xs text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{t("settings.teamShare.unreachable")}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {phase === "disabled" ? (
            <button
              onClick={() => setIsSetupOpen(true)}
              className={primaryButtonClass}
            >
              <Users size={14} />
              {t("settings.teamShare.setUp")}
            </button>
          ) : (
            <>
              {status?.unlocked ? (
                <>
                  <button
                    onClick={() => void handleSync()}
                    disabled={isSyncing}
                    className={primaryButtonClass}
                  >
                    <RefreshCw
                      size={14}
                      className={clsx(isSyncing && "animate-spin")}
                    />
                    {t("settings.teamShare.syncNow")}
                  </button>
                  <button onClick={() => void handleLock()} className={buttonClass}>
                    <Lock size={14} />
                    {t("settings.teamShare.lock")}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsUnlockOpen(true)}
                  disabled={phase === "unreachable"}
                  className={primaryButtonClass}
                >
                  <LockOpen size={14} />
                  {t("settings.teamShare.unlock")}
                </button>
              )}
              <button onClick={() => void handleDisable()} className={dangerButtonClass}>
                <Trash2 size={14} />
                {t("settings.teamShare.disable")}
              </button>
            </>
          )}
        </div>

        {status?.lastSync && (
          <p className="mt-3 text-xs text-muted">
            {lastSyncCount === 0
              ? t("settings.teamShare.syncUpToDate")
              : t("settings.teamShare.syncSummary", {
                  pulled: status.lastSync.pulled,
                  pushed: status.lastSync.pushed,
                  conflicts: status.lastSync.conflicts,
                  removed: status.lastSync.removed,
                })}
          </p>
        )}
      </SettingRow>

      {status?.configured && (
        <SettingRow
          label={t("settings.teamShare.membership")}
          description={t("settings.teamShare.membershipDesc")}
          vertical
        >
          <p className="text-xs text-muted">
            {status.unlocked
              ? t("settings.teamShare.membershipHint", {
                  count: status.sharedConnectionIds.length,
                })
              : t("settings.teamShare.unlockToManage")}
          </p>
        </SettingRow>
      )}

      <TeamShareSetupModal
        isOpen={isSetupOpen}
        onConfigured={(next) => {
          applyStatus(next);
          setIsSetupOpen(false);
        }}
        onClose={() => setIsSetupOpen(false)}
      />
      <TeamShareUnlockModal
        isOpen={isUnlockOpen}
        status={status}
        onUnlocked={(next) => {
          applyStatus(next);
          setIsUnlockOpen(false);
        }}
        onClose={() => setIsUnlockOpen(false)}
      />
    </SettingSection>
  );
}

function PhaseBadge({ phase }: { phase: ReturnType<typeof teamSharePhase> }) {
  const { t } = useTranslation();
  const tone =
    phase === "unlocked"
      ? "text-green-400"
      : phase === "locked"
        ? "text-amber-400"
        : phase === "unreachable"
          ? "text-red-400"
          : "text-muted";
  return (
    <span className={clsx("text-[11px] uppercase tracking-wider", tone)}>
      {t(`settings.teamShare.phase.${phase}`)}
    </span>
  );
}

