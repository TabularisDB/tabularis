import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Lock, Loader2 } from "lucide-react";

interface ImportPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  error?: string | null;
}

export const ImportPasswordModal = ({
  isOpen,
  onClose,
  onSubmit,
  error,
}: ImportPasswordModalProps) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setPassword("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!password) return;
    setLoading(true);
    try {
      await onSubmit(password);
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-900/30 rounded-lg">
              <Lock size={20} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("connections.importPasswordModal.title")}
              </h2>
              <p className="text-xs text-secondary">
                {t("connections.importPasswordModal.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs uppercase font-bold text-muted mb-1 block">
              {t("connections.importPasswordModal.password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !password}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {t("connections.importPasswordModal.unlock")}
          </button>
        </div>
      </div>
    </div>
  );
};
