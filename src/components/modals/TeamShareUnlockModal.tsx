import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Loader2, X } from "lucide-react";
import { toErrorMessage } from "../../utils/errors";
import type { TeamShareStatus } from "../../utils/teamShare";
import { vaultFolder } from "../../utils/teamShare";

interface TeamShareUnlockModalProps {
  isOpen: boolean;
  /** Configured share being unlocked, for the folder shown in the header. */
  status: TeamShareStatus | null;
  onUnlocked: (status: TeamShareStatus) => void;
  /** Dismiss and keep working without the shared credentials. */
  onClose: () => void;
}

/**
 * Asks for the master password that opens the team vault.
 *
 * The password is never stored, so this comes up on every launch. Dismissing
 * it is allowed: the app stays usable, only the shared connections do not.
 */
export const TeamShareUnlockModal = ({
  isOpen,
  status,
  onUnlocked,
  onClose,
}: TeamShareUnlockModalProps) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Clearing on the way out rather than in an effect on `isOpen`: the modal
  // stays mounted when closed, and a synchronous setState in an effect would
  // only cost an extra render. Declared above the early return so the Escape
  // handler can route through it and drop the typed password too.
  const handleClose = useCallback(() => {
    setPassword("");
    setError(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const handleUnlock = async () => {
    if (!password || isUnlocking) return;
    setIsUnlocking(true);
    setError(null);
    try {
      const next = await invoke<TeamShareStatus>("unlock_team_share", {
        masterPassword: password,
      });
      setPassword("");
      onUnlocked(next);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <KeyRound size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("settings.teamShare.unlockTitle")}
              </h2>
              <p className="text-xs text-secondary">
                {t("settings.teamShare.unlockSubtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-secondary hover:text-primary transition-colors"
            aria-label={t("common.close")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
            <p className="text-sm text-secondary leading-relaxed">
              {t("settings.teamShare.unlockDescription")}
            </p>
            {status?.path && (
              <p className="text-xs text-muted font-mono mt-2 break-all">
                {vaultFolder(status.path)}
              </p>
            )}
          </div>

          <div>
            <label
              className="text-xs uppercase font-bold text-muted mb-1 block"
              htmlFor="team-share-master-password"
            >
              {t("settings.teamShare.masterPassword")}
            </label>
            <input
              id="team-share-master-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleUnlock();
              }}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("settings.teamShare.continueLocked")}
          </button>
          <button
            onClick={() => void handleUnlock()}
            disabled={isUnlocking || !password}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {isUnlocking && <Loader2 size={16} className="animate-spin" />}
            {t("settings.teamShare.unlock")}
          </button>
        </div>
      </div>
    </div>
  );
};
