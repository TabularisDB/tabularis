import { createContext } from "react";

export type AlertKind = "error" | "info" | "warning";

export interface AlertOptions {
  title?: string;
  kind?: AlertKind;
}

export interface AlertContextType {
  showAlert: (message: string, options?: AlertOptions) => void;
}

export const AlertContext = createContext<AlertContextType>({
  showAlert: () => {},
});
