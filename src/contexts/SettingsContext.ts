import { createContext } from "react";
import type { AppLanguage } from "../i18n/config";

export type { AppLanguage };
export type CopyFormat = "csv" | "json" | "sql-insert";
export type AiProvider =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "custom-openai"
  | "minimax";
export type ERDiagramLayout = "LR" | "TB";

export interface PluginConfig {
  interpreter?: string;
  settings?: Record<string, unknown>;
}

export interface Settings {
  resultPageSize: number; // Changed from queryLimit to match backend config
  language: AppLanguage;
  fontFamily: string;
  fontSize: number;
  aiEnabled: boolean;
  aiProvider: AiProvider | null;
  aiModel: string | null;
  aiCustomModels?: Record<string, string[]>;
  aiOllamaPort?: number;
  aiCustomOpenaiUrl?: string;
  aiCustomOpenaiModel?: string;
  autoCheckUpdatesOnStartup?: boolean;
  loggingEnabled?: boolean;
  maxLogEntries?: number;
  erDiagramDefaultLayout?: ERDiagramLayout;
  copyFormat?: CopyFormat;
  csvDelimiter?: string;
  activeExternalDrivers?: string[];
  plugins?: Record<string, PluginConfig>;
  editorTheme?: string;
  editorFontFamily?: string;
  editorFontSize?: number;
  editorLineHeight?: number;
  editorTabSize?: number;
  editorWordWrap?: boolean;
  editorShowLineNumbers?: boolean;
  editorAcceptSuggestionOnEnter?: boolean;
  pingInterval?: number;
  queryHistoryMaxEntries?: number;
  showWelcome?: boolean;
  // AI / MCP safety
  aiAuditEnabled?: boolean;
  aiAuditMaxEntries?: number;
  aiSessionGapMinutes?: number;
  mcpReadonlyDefault?: boolean;
  mcpReadonlyConnections?: string[];
  mcpApprovalMode?: "off" | "writes_only" | "all";
  mcpApprovalTimeoutSeconds?: number;
  mcpPreflightExplain?: boolean;
}

export interface SettingsContextType {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  isLoading: boolean;
}

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export const DEFAULT_SETTINGS: Settings = {
  resultPageSize: 500,
  language: "auto",
  fontFamily: "System",
  fontSize: 14,
  aiEnabled: false,
  aiProvider: null,
  aiModel: null,
  aiCustomModels: undefined,
  aiOllamaPort: 11434,
  aiCustomOpenaiUrl: "",
  aiCustomOpenaiModel: "",
  loggingEnabled: true,
  maxLogEntries: 1000,
  copyFormat: "csv",
  csvDelimiter: ",",
  erDiagramDefaultLayout: "LR",
  editorFontFamily: "JetBrains Mono",
  editorFontSize: 14,
  editorLineHeight: 1.5,
  editorTabSize: 2,
  editorWordWrap: true,
  editorShowLineNumbers: true,
  editorAcceptSuggestionOnEnter: true,
  pingInterval: 30,
  queryHistoryMaxEntries: 500,
  aiAuditEnabled: true,
  aiAuditMaxEntries: 5000,
  aiSessionGapMinutes: 10,
  mcpReadonlyDefault: false,
  mcpReadonlyConnections: [],
  mcpApprovalMode: "writes_only",
  mcpApprovalTimeoutSeconds: 120,
  mcpPreflightExplain: true,
};
