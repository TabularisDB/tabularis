import { createContext } from "react";
import type { ReactNode } from "react";

export interface PluginModalOptions {
  title: string;
  content: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

export interface PluginModalContextType {
  openModal: (options: PluginModalOptions) => void;
  closeModal: () => void;
}

export const PluginModalContext = createContext<PluginModalContextType | undefined>(undefined);
