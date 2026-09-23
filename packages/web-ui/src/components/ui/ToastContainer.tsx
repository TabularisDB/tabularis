import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { ToastAction, ToastKind } from "../../contexts/ToastContext";

export interface ToastItem {
  id: number;
  message: string;
  title?: string;
  kind: ToastKind;
  actions?: ToastAction[];
  onClick?: () => void;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

const kindConfig: Record<ToastKind, { Icon: typeof Info; accent: string }> = {
  info: { Icon: Info, accent: "var(--accent-info)" },
  success: { Icon: CheckCircle2, accent: "var(--accent-success)" },
  warning: { Icon: AlertTriangle, accent: "var(--accent-warning)" },
  error: { Icon: XCircle, accent: "var(--accent-error)" },
  // Same accent as the update badges so the toast and the counters match.
  update: { Icon: ArrowUpCircle, accent: "var(--accent-primary)" },
};

export const ToastContainer = ({ toasts, onDismiss }: ToastContainerProps) => {
  const { t } = useTranslation();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[120] flex flex-col items-end gap-2">
      {toasts.map((toast) => {
        const { Icon, accent } = kindConfig[toast.kind];
        const MessageContainer = toast.onClick ? "button" : "div";
        return (
          <div
            key={toast.id}
            role="status"
            className="animate-slide-in-right flex items-start gap-3 w-[340px] p-3 bg-elevated border border-strong rounded-lg shadow-2xl"
          >
            <div
              className="p-1.5 rounded-lg shrink-0"
              style={{
                backgroundColor: `color-mix(in srgb, ${accent} 14%, var(--bg-elevated))`,
                color: `color-mix(in srgb, ${accent} 35%, CanvasText)`,
              }}
            >
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <MessageContainer
                className={
                  toast.onClick
                    ? "w-full text-left cursor-pointer rounded focus-visible:outline focus-visible:outline-focus"
                    : undefined
                }
                onClick={
                  toast.onClick
                    ? () => {
                        toast.onClick?.();
                        onDismiss(toast.id);
                      }
                    : undefined
                }
              >
                {toast.title && (
                  <span
                    className="block text-sm font-medium text-primary"
                    style={{
                      color:
                        "color-mix(in srgb, var(--text-primary) 80%, CanvasText)",
                    }}
                  >
                    {toast.title}
                  </span>
                )}
                <span
                  className="block text-xs text-secondary leading-relaxed break-words"
                  style={{
                    color:
                      "color-mix(in srgb, var(--text-secondary) 80%, CanvasText)",
                  }}
                >
                  {toast.message}
                </span>
              </MessageContainer>
              {toast.actions && toast.actions.length > 0 && (
                <div className="flex items-center gap-3 mt-1.5">
                  {toast.actions.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        action.onClick();
                        onDismiss(toast.id);
                      }}
                      className="text-xs font-medium hover:underline underline-offset-2 rounded focus-visible:outline focus-visible:outline-focus"
                      style={{
                        color:
                          "color-mix(in srgb, var(--accent-primary) 35%, CanvasText)",
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
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
