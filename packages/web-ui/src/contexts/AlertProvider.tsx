import { useState, useCallback } from "react";
import { AlertContext, type AlertKind } from "./AlertContext";
import { AlertModal } from "../components/modals/AlertModal";

interface AlertState {
  isOpen: boolean;
  message: string;
  title: string;
  kind: AlertKind;
  onClose?: () => void;
}

export const AlertProvider = ({ children }: { children: React.ReactNode }) => {
  const [alert, setAlert] = useState<AlertState>({
    isOpen: false,
    message: "",
    title: "",
    kind: "error",
  });

  const showAlert = useCallback((message: string, options?: { title?: string; kind?: AlertKind; onClose?: () => void }) => {
    setAlert({
      isOpen: true,
      message,
      title: options?.title ?? "",
      kind: options?.kind ?? "error",
      onClose: options?.onClose,
    });
  }, []);

  const handleClose = useCallback(() => {
    setAlert((prev) => {
      prev.onClose?.();
      return { ...prev, isOpen: false, onClose: undefined };
    });
  }, []);

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      <AlertModal
        isOpen={alert.isOpen}
        onClose={handleClose}
        title={alert.title}
        message={alert.message}
        kind={alert.kind}
      />
    </AlertContext.Provider>
  );
};
