import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { X, AlertTriangle, Copy, Check, FolderOpen, RefreshCw, Loader2 } from "lucide-react";

interface PluginInstallErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginId: string;
  error: string;
  operation: "install" | "uninstall";
  /** Opens the plugins directory in the OS file manager for manual cleanup. */
  onOpenPluginsFolder?: () => void;
  /** Re-scans installed plugins + registry after manual changes, then closes. */
  onReload?: () => Promise<void> | void;
}

export const PluginInstallErrorModal = ({
  isOpen,
  onClose,
  pluginId,
  error,
  operation,
  onOpenPluginsFolder,
  onReload,
}: PluginInstallErrorModalProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [reloading, setReloading] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReload = async () => {
    if (!onReload) return;
    setReloading(true);
    try {
      await onReload();
      onClose();
    } finally {
      setReloading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-900/30 rounded-lg">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t(`settings.plugins.${operation}Error.title`)}
              </h2>
              <p className="text-xs text-secondary font-mono">{pluginId}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto">
          <p className="text-sm text-secondary">
            {t(`settings.plugins.${operation}Error.subtitle`)}
          </p>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-bold text-muted">
                {t("settings.plugins.installError.details")}
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={13} className="text-green-400" />
                    <span className="text-green-400">{t("settings.plugins.installError.copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    {t("settings.plugins.installError.copy")}
                  </>
                )}
              </button>
            </div>
            <pre className="w-full px-3 py-3 bg-base border border-strong rounded-lg text-xs text-red-300 font-mono whitespace-pre-wrap break-all overflow-y-auto max-h-[240px]">
              {error}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex items-center justify-between gap-3">
          <div>
            {onOpenPluginsFolder && (
              <button
                onClick={onOpenPluginsFolder}
                className="flex items-center gap-1.5 px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
              >
                <FolderOpen size={14} />
                {t("settings.plugins.openFolder")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onReload && (
              <button
                onClick={handleReload}
                disabled={reloading}
                className="flex items-center gap-1.5 px-4 py-2 text-secondary hover:text-primary disabled:opacity-50 transition-colors text-sm"
              >
                {reloading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {t("settings.plugins.installError.reload")}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
