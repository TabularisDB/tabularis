import { createContext } from "react";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  title?: string;
  kind?: ToastKind;
  /** Auto-dismiss delay in ms. Pass 0 to keep the toast until dismissed. */
  duration?: number;
}

export interface ToastContextType {
  showToast: (message: string, options?: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});
