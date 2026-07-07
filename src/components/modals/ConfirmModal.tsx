import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { SqlPreview } from "../ui/SqlPreview";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  /** Optional SQL shown in a read-only preview below the message. */
  sql?: string;
  confirmLabel?: string;
  confirmClassName?: string;
  onConfirm: () => void;
  variant?: "danger" | "warning" | "info";
  /**
   * When set, the confirm button stays disabled for this many seconds after the
   * modal opens, showing a countdown. Gives the user a beat to actually read the
   * message before confirming a destructive action.
   */
  confirmDelaySeconds?: number;
}

export const ConfirmModal = ({
  isOpen,
  onClose,
  title,
  message,
  sql,
  confirmLabel,
  confirmClassName,
  onConfirm,
  variant = "danger",
  confirmDelaySeconds,
}: ConfirmModalProps) => {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(confirmDelaySeconds ?? 0);

  // Reset the countdown whenever the modal transitions to open — done during
  // render (React's recommended pattern) rather than in an effect.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    setRemaining(isOpen ? (confirmDelaySeconds ?? 0) : 0);
  }

  useEffect(() => {
    if (!isOpen || !confirmDelaySeconds) return;
    const interval = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, confirmDelaySeconds]);

  const isCountingDown = remaining > 0;

  const variantStyles = {
    danger: {
      icon: <AlertTriangle size={20} className="text-red-400" />,
      iconBg: "bg-red-900/30",
      button: "bg-red-600 hover:bg-red-500",
    },
    warning: {
      icon: <AlertTriangle size={20} className="text-amber-400" />,
      iconBg: "bg-amber-900/30",
      button: "bg-amber-600 hover:bg-amber-500",
    },
    info: {
      icon: <AlertTriangle size={20} className="text-blue-400" />,
      iconBg: "bg-blue-900/30",
      button: "bg-blue-600 hover:bg-blue-500",
    },
  };

  const currentVariant = variantStyles[variant];

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className={`p-2 ${currentVariant.iconBg} rounded-lg`}>
              {currentVariant.icon}
            </div>
            <h2 className="text-lg font-semibold text-primary">{title}</h2>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-secondary leading-relaxed">{message}</p>
          {sql && <SqlPreview sql={sql} height="120px" />}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={isCountingDown}
            className={`${
              confirmClassName ??
              `px-4 py-2 ${currentVariant.button} text-white rounded-lg text-sm font-medium transition-colors`
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isCountingDown
              ? `${confirmLabel ?? (variant === "danger" ? t("common.delete") : t("common.ok"))} (${remaining})`
              : (confirmLabel ?? (variant === "danger" ? t("common.delete") : t("common.ok")))}
          </button>
        </div>
      </div>
    </Modal>
  );
};
