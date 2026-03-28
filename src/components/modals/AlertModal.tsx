import { useTranslation } from "react-i18next";
import { AlertTriangle, Info, AlertCircle, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import type { AlertKind } from "../../contexts/AlertContext";

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  kind: AlertKind;
}

const iconConfig: Record<AlertKind, { Icon: typeof Info; bgClass: string; textClass: string }> = {
  error: { Icon: AlertCircle, bgClass: "bg-red-900/30", textClass: "text-red-400" },
  warning: { Icon: AlertTriangle, bgClass: "bg-yellow-900/30", textClass: "text-yellow-400" },
  info: { Icon: Info, bgClass: "bg-blue-900/30", textClass: "text-blue-400" },
};

export const AlertModal = ({ isOpen, onClose, title, message, kind }: AlertModalProps) => {
  const { t } = useTranslation();
  const { Icon, bgClass, textClass } = iconConfig[kind];

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className={`p-2 ${bgClass} rounded-lg`}>
              <Icon size={20} className={textClass} />
            </div>
            <h2 className="text-lg font-semibold text-primary">{title}</h2>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          <p className="text-sm text-secondary whitespace-pre-wrap break-words select-text">{message}</p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("common.ok", "OK")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
