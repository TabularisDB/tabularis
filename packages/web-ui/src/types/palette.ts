export type PaletteIcon =
  | "command"
  | "copy"
  | "count"
  | "generate-sql"
  | "inspect"
  | "new-console"
  | "query"
  | "routine"
  | "table"
  | "trigger"
  | "view";

export interface PaletteAction {
  id: string;
  label: string;
  icon?: PaletteIcon;
  execute: () => void | Promise<void>;
}

export interface PaletteItem {
  id: string;
  title: string;
  description?: string;
  group?: string;
  badge?: string;
  keywords?: string[];
  icon?: PaletteIcon;
  relevance?: number;
  primaryAction: PaletteAction;
  actions?: PaletteAction[];
}
