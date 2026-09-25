import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, KeyRound, X } from "lucide-react";
import { Modal } from "../ui/Modal";

interface ConnectionPasswordModalProps {
  isOpen: boolean;
  /** Cancels the connection attempt. */
  onClose: () => void;
  connectionName: string;
  username?: string;
  /** Why the server rejected the previous password. */
  error?: string;
  onSubmit: (password: string) => void;
}

/**
 * Asks for a new password after the server rejected the stored one (missing,
 * wrong or rotated). The caller saves it once the connection succeeds.
 */
export const ConnectionPasswordModal = ({
  isOpen,
  onClose,
  connectionName,
  username,
  error,
  onSubmit,
}: ConnectionPasswordModalProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const inputId = useId();
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(password);
  };

  return (
    // Above the connection modals that can trigger a connect.
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-accent-primary/15 rounded-lg">
              <KeyRound size={20} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-primary">
                {t("connectionPassword.title")}
              </h2>
              <p className="text-xs text-secondary truncate">
                {username
                  ? t("connectionPassword.subtitleWithUser", {
                      name: connectionName,
                      user: username,
                    })
                  : t("connectionPassword.subtitle", { name: connectionName })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Content */}
          <div className="p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 text-xs text-accent-error bg-accent-error/10 border border-accent-error/30 rounded-lg p-3">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}
            <div className="space-y-1">
              <label
                htmlFor={inputId}
                className="text-xs uppercase font-bold text-muted"
              >
                {t("newConnection.password")}
              </label>
              <input
                id={inputId}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-focus focus:outline-none"
              />
            </div>
            <p className="text-xs text-muted leading-relaxed">
              {t("connectionPassword.savedOnSuccess")}
            </p>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors"
            >
              {t("connectionPassword.connect")}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
