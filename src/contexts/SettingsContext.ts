import { createContext } from "react";
import type { AppLanguage } from "../i18n/config";

export type { AppLanguage };
export type CopyFormat = "csv" | "json" | "sql-insert" | "markdown";
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
  /** IANA timezone name (e.g. "Asia/Tokyo") for rendering timestamps, or "auto" to follow the OS timezone. */
  displayTimezone?: string;
  fontFamily: string;
  fontSize: number;
  /** Colorize query result cell values by their data type. Default: false. */
  resultColorByType?: boolean;
  /** Per-type hex color overrides for result cell values (keys: number, string, date, boolean). */
  resultTypeColors?: Record<string, string>;
  /** Keep the result grid's column headers pinned to the top while scrolling. Default: true. */
  stickyColumnHeaders?: boolean;
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
  /** Whether copied CSV output includes a header row. Default: true. */
  csvIncludeHeaders?: boolean;
  /** Whether the row editor sidebar follows row selection. Default: true. */
  rowEditorFollowSelection?: boolean;
  /** What happens on double-click of a data cell: "inline" (edit in place), "sidebar" (open in row editor), "both" (inline + update sidebar). Default: "inline". */
  cellDoubleClickAction?: "inline" | "sidebar" | "both";
  activeExternalDrivers?: string[];
  /** Base URL of the Tabularium plugin registry. Defaults to the built-in instance when unset. */
  tabulariumRegistryUrl?: string;
  plugins?: Record<string, PluginConfig>;
  editorTheme?: string;
  editorFontFamily?: string;
  editorFontSize?: number;
  editorLineHeight?: number;
  editorTabSize?: number;
  editorWordWrap?: boolean;
  editorShowLineNumbers?: boolean;
  editorAcceptSuggestionOnEnter?: boolean;
  runStatementUnderCursor?: boolean;
  // SQL Formatter
  formatterKeywordCase?: "upper" | "lower" | "preserve";
  formatterIndentStyle?: "standard" | "tabularLeft" | "tabularRight";
  formatterTabWidth?: number;
  formatterUseTabs?: boolean;
  formatterFunctionCase?: "upper" | "lower" | "preserve";
  formatterLinesBetweenQueries?: number;
  formatterDenseOperators?: boolean;
  pingInterval?: number;
  queryHistoryMaxEntries?: number;
  showWelcome?: boolean;
  /** Reconnect to the last active connection on startup. Default: true. */
  autoConnectLastConnection?: boolean;
  /** Maximize the window on startup. Default: false. */
  startMaximized?: boolean;
  // AI / MCP safety
  aiAuditEnabled?: boolean;
  aiAuditMaxEntries?: number;
  aiSessionGapMinutes?: number;
  mcpReadonlyDefault?: boolean;
  mcpReadonlyConnections?: string[];
  mcpApprovalMode?: "off" | "writes_only" | "all";
  mcpApprovalTimeoutSeconds?: number;
  mcpPreflightExplain?: boolean;
  mcpApprovalAlwaysOnTop?: boolean;
  mcpApprovalNotifySound?: boolean;
  // Automatic connections backup
  /** When backups run: "manual" (default), "interval", "onClose" or "onLaunch". */
  backupMode?: "manual" | "interval" | "onClose" | "onLaunch";
  /** Directory the backup files are written to. */
  backupDirectory?: string;
  /** Minutes between automatic backups in interval mode. Default: 1440. */
  backupIntervalMinutes?: number;
  /** Number of backup files kept before rotation. Default: 10. */
  backupRetention?: number;
  /** Backup destination: "local" (default) or "webdav". */
  backupTarget?: "local" | "webdav";
  /** WebDAV collection URL the backups are uploaded into. */
  backupWebdavUrl?: string;
  /** WebDAV username; the password lives in the OS keychain. */
  backupWebdavUsername?: string;
}

export interface SettingsContextType {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  isLoading: boolean;
  isLanguageReady: boolean;
  isLanguageSettled: boolean;
}

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export const DEFAULT_SETTINGS: Settings = {
  resultPageSize: 500,
  language: "auto",
  displayTimezone: "auto",
  fontFamily: "System",
  fontSize: 14,
  resultColorByType: false,
  resultTypeColors: {},
  stickyColumnHeaders: true,
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
  csvIncludeHeaders: true,
  erDiagramDefaultLayout: "LR",
  editorFontFamily: "JetBrains Mono",
  editorFontSize: 14,
  editorLineHeight: 1.5,
  editorTabSize: 2,
  editorWordWrap: true,
  editorShowLineNumbers: true,
  editorAcceptSuggestionOnEnter: true,
  runStatementUnderCursor: true,
  formatterKeywordCase: "upper",
  formatterIndentStyle: "standard",
  formatterTabWidth: 2,
  formatterUseTabs: false,
  formatterFunctionCase: "preserve",
  formatterLinesBetweenQueries: 1,
  formatterDenseOperators: false,
  pingInterval: 30,
  queryHistoryMaxEntries: 500,
  autoConnectLastConnection: true,
  startMaximized: false,
  aiAuditEnabled: true,
  aiAuditMaxEntries: 5000,
  aiSessionGapMinutes: 10,
  mcpReadonlyDefault: false,
  mcpReadonlyConnections: [],
  mcpApprovalMode: "writes_only",
  mcpApprovalTimeoutSeconds: 120,
  mcpPreflightExplain: true,
  mcpApprovalAlwaysOnTop: true,
  mcpApprovalNotifySound: true,
  backupMode: "manual",
  backupDirectory: "",
  backupIntervalMinutes: 1440,
  backupRetention: 10,
};
