import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, Users, X } from "lucide-react";
import { toErrorMessage } from "../../utils/errors";
import type { TeamShareStatus } from "../../utils/teamShare";
import { masterPasswordError } from "../../utils/teamShare";

interface TeamShareSetupModalProps {
  isOpen: boolean;
  onConfigured: (status: TeamShareStatus) => void;
  onClose: () => void;
}

/**
 * Points this machine at a team vault: an existing one, which the master
 * password must open, or a new one created in the chosen folder.
 *
 * The same dialog covers both because the backend cannot be told apart from
 * here — it looks at the folder and either joins or creates. The password is
 * asked twice so a typo cannot create a vault nobody can open.
 */
export const TeamShareSetupModal = ({
  isOpen,
  onConfigured,
  onClose,
}: TeamShareSetupModalProps) => {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  // Reset here rather than in an effect on `isOpen`: the modal stays mounted
  // when closed, and a synchronous setState in an effect would just cost an
  // extra render pass.
  const handleClose = () => {
    setPath("");
    setPassword("");
    setConfirmation("");
    setError(null);
    onClose();
  };

  const handleBrowse = async () => {
    const selected = await open({ multiple: false, directory: true });
    if (typeof selected === "string") {
      setPath(selected);
      setError(null);
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    const validationKey = masterPasswordError(password, confirmation);
    if (validationKey) {
      setError(t(validationKey));
      return;
    }
    if (!path.trim()) {
      setError(t("settings.teamShare.errorNoFolder"));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const status = await invoke<TeamShareStatus>("setup_team_share", {
        path: path.trim(),
        masterPassword: password,
      });
      setPassword("");
      setConfirmation("");
      onConfigured(status);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Users size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("settings.teamShare.setupTitle")}
              </h2>
              <p className="text-xs text-secondary">
                {t("settings.teamShare.setupSubtitle")}
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
              {t("settings.teamShare.setupDescription")}
            </p>
          </div>

          <div>
            <label
              className="text-xs uppercase font-bold text-muted mb-1 block"
              htmlFor="team-share-path"
            >
              {t("settings.teamShare.sharedFolder")}
            </label>
            <div className="flex gap-2">
              <input
                id="team-share-path"
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t("settings.teamShare.sharedFolderPlaceholder")}
                className="flex-1 min-w-0 px-3 py-2 bg-base border border-strong rounded-lg text-primary font-mono text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={() => void handleBrowse()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-base border border-strong text-sm text-secondary hover:text-blue-400 hover:border-blue-500/50 transition-colors shrink-0"
              >
                <FolderOpen size={14} />
                {t("settings.teamShare.browse")}
              </button>
            </div>
            <p className="text-xs text-muted mt-1">
              {t("settings.teamShare.sharedFolderHint")}
            </p>
          </div>

          <div>
            <label
              className="text-xs uppercase font-bold text-muted mb-1 block"
              htmlFor="team-share-setup-password"
            >
              {t("settings.teamShare.masterPassword")}
            </label>
            <input
              id="team-share-setup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label
              className="text-xs uppercase font-bold text-muted mb-1 block"
              htmlFor="team-share-setup-password-repeat"
            >
              {t("settings.teamShare.repeatMasterPassword")}
            </label>
            <input
              id="team-share-setup-password-repeat"
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none"
            />
          </div>

          <p className="text-xs text-muted">
            {t("settings.teamShare.masterPasswordWarning")}
          </p>

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
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {isSaving && <Loader2 size={16} className="animate-spin" />}
            {t("settings.teamShare.connect")}
          </button>
        </div>
      </div>
    </div>
  );
};
