import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { Modal } from "../ui/Modal";

interface ErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
}

export const ErrorModal = ({ isOpen, onClose, message }: ErrorModalProps) => {
  const { t } = useTranslation();

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[520px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-error/15 rounded-lg">
              <AlertTriangle size={20} className="text-accent-error" />
            </div>
            <h2 className="text-lg font-semibold text-primary">
              {t("common.error")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <p className="text-sm text-secondary break-words">{message}</p>
        </div>

        <div className="p-4 border-t border-default bg-base/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-inverse rounded-lg text-sm font-medium transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
