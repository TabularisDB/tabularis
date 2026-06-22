import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Modal } from "../ui/Modal";
import { X, AlertTriangle, Copy, Check } from "lucide-react";

interface PluginInstallErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  pluginId: string;
  error: string;
}

export const PluginInstallErrorModal = ({
  isOpen,
  onClose,
  pluginId,
  error,
}: PluginInstallErrorModalProps) => {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
                {t({ message: "Installation Failed", context: "settings" })}
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
            {t`An error occurred while installing the plugin. See the details below.`}
          </p>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-bold text-muted">
                {t({ message: "Error Details", context: "settings.plugins.installError.details" })}
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={13} className="text-green-400" />
                    <span className="text-green-400">{t`Copied!`}</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    {t`Copy`}
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
        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t`Close`}
          </button>
        </div>
      </div>
    </Modal>
  );
};
