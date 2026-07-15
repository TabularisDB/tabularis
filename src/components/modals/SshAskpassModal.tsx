import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, KeyRound, Loader2, X } from "lucide-react";
import type { SshAskpassRequest } from "../../types/askpass";

interface SshAskpassModalProps {
  isOpen: boolean;
  /** Cancels the prompt (secret/confirm) or hides the notification (notify). */
  onClose: () => void;
  request: SshAskpassRequest;
  /** Submit the user's answer; ignored for notify prompts. */
  onSubmit: (response: string) => void;
}

/**
 * Modal shown when a system `ssh` process asks for user input during
 * authentication: a key passphrase or security-key PIN (`secret`), a yes/no
 * question (`confirm`), or a "touch your security key" notification
 * (`notify`, auto-dismissed by the backend once satisfied).
 */
export const SshAskpassModal = ({
  isOpen,
  onClose,
  request,
  onSubmit,
}: SshAskpassModalProps) => {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isNotify = request.kind === "notify";
  const isSecret = request.kind === "secret";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // For confirm prompts ssh only checks the exit status; an empty answer
    // means "yes".
    onSubmit(isSecret ? value : "");
  };

  return (
    // Above every other modal (highest today is z-[130]): ssh prompts can
    // pop over the connection modals that triggered them.
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              {isNotify ? (
                <Fingerprint size={20} className="text-blue-400" />
              ) : (
                <KeyRound size={20} className="text-blue-400" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("sshAskpass.title")}
              </h2>
              <p className="text-xs text-secondary">{t("sshAskpass.subtitle")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-secondary leading-relaxed break-words">
            {request.prompt}
          </p>

          {isSecret && (
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none"
              placeholder={t("sshAskpass.placeholder")}
              autoFocus
            />
          )}

          {isNotify && (
            <div className="flex items-center gap-3 text-muted">
              <Loader2 size={20} className="animate-spin shrink-0" />
              <span className="text-sm">{t("sshAskpass.waiting")}</span>
            </div>
          )}

          {/* Footer */}
          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            {!isNotify && (
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {t("common.ok")}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
