import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, LogOut, X } from "lucide-react";
import clsx from "clsx";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface TeamShareLeaveModalProps {
  isOpen: boolean;
  /** Whether the share is open right now: decides whether kept connections
   * get their credentials back. */
  unlocked: boolean;
  /** How many connections come from the share on this machine. */
  sharedCount: number;
  onConfirm: (keepConnections: boolean) => Promise<void>;
  onClose: () => void;
}

/**
 * Confirms leaving the team share and asks what to do with the shared
 * connections on this machine.
 *
 * Leaving never touches the vault on the share — teammates keep working —
 * but dropping the connections here is not undoable without joining again,
 * so it is never done on a single click.
 */
export const TeamShareLeaveModal = ({
  isOpen,
  unlocked,
  sharedCount,
  onConfirm,
  onClose,
}: TeamShareLeaveModalProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const [keep, setKeep] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);

  const handleClose = useCallback(() => {
    if (isLeaving) return;
    setKeep(true);
    onClose();
  }, [isLeaving, onClose]);

  useEscapeKey(isOpen, handleClose);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsLeaving(true);
    try {
      await onConfirm(keep);
      setKeep(true);
    } finally {
      setIsLeaving(false);
    }
  };

  const optionClass = (selected: boolean) =>
    clsx(
      "w-full text-left p-3 rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      selected
        ? "border-accent-primary/60 bg-accent-primary/10"
        : "border-strong bg-base hover:border-accent-primary/40",
    );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-error/15 rounded-lg">
              <LogOut size={20} className="text-accent-error" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-primary">
                {t("settings.teamShare.leaveTitle")}
              </h2>
              <p className="text-xs text-secondary">
                {t("settings.teamShare.leaveSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-secondary hover:text-primary transition-colors"
            aria-label={t("common.close")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-3 overflow-y-auto">
          <p className="text-sm text-secondary leading-relaxed">
            {t("settings.teamShare.leaveDescription", { count: sharedCount })}
          </p>

          <div role="radiogroup" aria-labelledby={titleId} className="space-y-2">
            <button
              type="button"
              role="radio"
              aria-checked={keep}
              onClick={() => setKeep(true)}
              className={optionClass(keep)}
            >
              <span className="block text-sm font-medium text-primary">
                {t("settings.teamShare.leaveKeep")}
              </span>
              <span className="block text-xs text-muted mt-0.5">
                {unlocked
                  ? t("settings.teamShare.leaveKeepUnlocked")
                  : t("settings.teamShare.leaveKeepLocked")}
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!keep}
              onClick={() => setKeep(false)}
              className={optionClass(!keep)}
            >
              <span className="block text-sm font-medium text-primary">
                {t("settings.teamShare.leaveRemove")}
              </span>
              <span className="block text-xs text-muted mt-0.5">
                {t("settings.teamShare.leaveRemoveHint")}
              </span>
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isLeaving}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isLeaving}
            className="px-4 py-2 bg-accent-error hover:bg-accent-error/90 disabled:opacity-50 text-on-accent-error rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {isLeaving && <Loader2 size={16} className="animate-spin" />}
            {t("settings.teamShare.leaveConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
};
