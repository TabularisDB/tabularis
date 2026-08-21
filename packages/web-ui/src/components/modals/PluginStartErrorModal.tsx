import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X, Copy, Check, Settings } from "lucide-react";
import { Modal } from "../ui/Modal";

interface PluginStartErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginId: string;
  error: string;
  onConfigureInterpreter?: () => void;
}

export const PluginStartErrorModal = ({
  isOpen,
  onClose,
  pluginId,
  error,
  onConfigureInterpreter,
}: PluginStartErrorModalProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfigure = () => {
    onClose();
    onConfigureInterpreter?.();
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
                {t("settings.plugins.startError.title")}
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
            {t("settings.plugins.startError.subtitle")}
          </p>

          {onConfigureInterpreter && (
            <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-3 flex items-start gap-3">
              <Settings size={15} className="text-blue-400 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-300">
                {t("settings.plugins.startError.interpreterHint")}
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-bold text-muted">
                {t("settings.plugins.startError.details")}
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={13} className="text-green-400" />
                    <span className="text-green-400">{t("settings.plugins.startError.copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    {t("settings.plugins.startError.copy")}
                  </>
                )}
              </button>
            </div>
            <pre className="w-full px-3 py-3 bg-base border border-strong rounded-lg text-xs text-red-300 font-mono whitespace-pre-wrap break-all overflow-y-auto max-h-[200px]">
              {error}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.close")}
          </button>
          {onConfigureInterpreter && (
            <button
              onClick={handleConfigure}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Settings size={14} />
              {t("settings.plugins.startError.configure")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
