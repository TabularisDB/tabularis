import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { ToastKind } from "../../contexts/ToastContext";

export interface ToastItem {
  id: number;
  message: string;
  title?: string;
  kind: ToastKind;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

const kindConfig: Record<ToastKind, { Icon: typeof Info; iconClass: string; boxClass: string }> = {
  info: { Icon: Info, iconClass: "text-blue-400", boxClass: "bg-blue-900/30" },
  success: { Icon: CheckCircle2, iconClass: "text-green-400", boxClass: "bg-green-900/30" },
  warning: { Icon: AlertTriangle, iconClass: "text-yellow-400", boxClass: "bg-yellow-900/30" },
  error: { Icon: XCircle, iconClass: "text-red-400", boxClass: "bg-red-900/30" },
};

export const ToastContainer = ({ toasts, onDismiss }: ToastContainerProps) => {
  const { t } = useTranslation();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[120] flex flex-col items-end gap-2">
      {toasts.map((toast) => {
        const { Icon, iconClass, boxClass } = kindConfig[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className="animate-slide-in-right flex items-start gap-3 w-[340px] p-3 bg-elevated border border-strong rounded-lg shadow-2xl"
          >
            <div className={`p-1.5 rounded-lg shrink-0 ${boxClass}`}>
              <Icon size={16} className={iconClass} />
            </div>
            <div className="flex-1 min-w-0">
              {toast.title && (
                <div className="text-sm font-medium text-primary">{toast.title}</div>
              )}
              <div className="text-xs text-secondary leading-relaxed break-words">
                {toast.message}
              </div>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-secondary hover:text-primary transition-colors shrink-0"
              aria-label={t("common.close")}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
