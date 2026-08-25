import { useCallback, useMemo, useRef, useState } from "react";
import { ToastContext, type ToastOptions } from "./ToastContext";
import { ToastContainer, type ToastItem } from "../components/ui/ToastContainer";

const DEFAULT_DURATION_MS = 6000;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    const id = nextIdRef.current++;
    setToasts((prev) => [
      ...prev,
      { id, message, title: options?.title, kind: options?.kind ?? "info" },
    ]);
    const duration = options?.duration ?? DEFAULT_DURATION_MS;
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
  }, [dismissToast]);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};
