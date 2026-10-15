import { createContext } from "react";

export type ToastKind = "info" | "success" | "warning" | "error" | "update";

/** A clickable action rendered inline in a toast (e.g. "Undo", "Report an issue"). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Optional action when the toast message is clicked. */
  onClick?: () => void;
  title?: string;
  kind?: ToastKind;
  /** Auto-dismiss delay in ms. Pass 0 to keep the toast until dismissed. */
  duration?: number;
  /** Inline action buttons, e.g. [{ label: "Undo", onClick }]. */
  actions?: ToastAction[];
}

export interface ToastContextType {
  showToast: (message: string, options?: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});
