import type {ReactNode, ComponentType} from 'react';

export interface PluginModalOptions {
    title: string;
    content: ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface PluginConfig {
    interpreter?: string;
    settings?: Record<string, unknown>;
}

export interface ThemeColors {
    bg: {
        base: string;
        elevated: string;
        overlay: string;
        input: string;
        tooltip: string;
    };
    surface: {
        primary: string;
        secondary: string;
        tertiary: string;
        hover: string;
        active: string;
        disabled: string;
    };
    text: {
        primary: string;
        secondary: string;
        muted: string;
        disabled: string;
        accent: string;
        inverse: string;
    };
    accent: {
        primary: string;
        secondary: string;
        success: string;
        warning: string;
        error: string;
        info: string;
    };
    border: {
        subtle: string;
        default: string;
        strong: string;
        focus: string;
    };
    semantic: {
        string: string;
        number: string;
        boolean: string;
        date: string;
        null: string;
        primaryKey: string;
        foreignKey: string;
        index: string;
        connectionActive: string;
        connectionInactive: string;
        modified: string;
        deleted: string;
        new: string;
    };
}

export interface PluginQueryResult {
    columns: string[];
    rows: unknown[][];
}

export interface UsePluginQueryReturn {
    executeQuery: (query: string) => Promise<PluginQueryResult>;
    loading: boolean;
    error: string | null;
}

export interface UsePluginConnectionReturn {
    connectionId: string | null;
    driver: string | null;
    schema: string | null;
}

export interface UsePluginToastReturn {
    showInfo: (text: string) => Promise<void>;
    showError: (text: string) => Promise<void>;
    showWarning: (text: string) => Promise<void>;
}

export interface UsePluginSettingReturn {
    getSetting: <T = unknown>(key: string, defaultValue?: T) => T;
    setSetting: (key: string, value: unknown) => void;
    setSettings: (updates: Record<string, unknown>) => void;
}

export interface UsePluginModalReturn {
    openModal: (options: PluginModalOptions) => void;
    closeModal: () => void;
}

export interface UsePluginThemeReturn {
    themeId: string | null;
    themeName: string | null;
    isDark: boolean;
    colors: ThemeColors | null;
}

/**
 * Minimal i18next-compatible translator signature.
 * Plugins should treat this as read-only.
 */
export type PluginTranslator = (key: string, options?: Record<string, unknown>) => string;

/**
 * The full host API surface injected by Tabularis at runtime as
 * `window.__TABULARIS_API__`. Plugin code should not use this directly —
 * import the named hooks/helpers from `@tabularis/plugin-api` instead.
 */
export interface TabularisHostApi {
    PluginResourceList: ComponentType<PluginResourceListProps>;
    PluginCodeEditor: ComponentType<PluginCodeEditorProps>;
    PluginExplorerSection: ComponentType<PluginExplorerSectionProps>;
    PluginDataGrid: ComponentType<PluginDataGridProps>;
    PluginConnectionAction: ComponentType<PluginConnectionActionProps>;
    PluginWorkspaceShell: ComponentType<PluginWorkspaceShellProps>;
    usePluginWorkspace: (pluginId: string) => UsePluginWorkspaceReturn;
    usePluginAccount: (pluginId: string) => UsePluginAccountReturn;
    usePluginRpc: (pluginId: string, connectionId?: string) => UsePluginRpcReturn;
    usePluginQuery: () => UsePluginQueryReturn;
    usePluginConnection: () => UsePluginConnectionReturn;
    usePluginToast: () => UsePluginToastReturn;
    usePluginSetting: (pluginId: string) => UsePluginSettingReturn;
    usePluginTranslation: (pluginId: string) => PluginTranslator;
    usePluginModal: () => UsePluginModalReturn;
    usePluginTheme: () => UsePluginThemeReturn;
    openUrl: (url: string) => Promise<void>;
}

/** Connection-scoped calls to a trusted plugin process. Secrets are write-only from UI code. */
export interface UsePluginRpcReturn {
    call: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
    saveSecrets: (secrets: Record<string, string>) => Promise<void>;
    secretFields: () => Promise<string[]>;
    deleteSecrets: () => Promise<void>;
}

/** Host-rendered entry point for a provider's connection tools. */
export interface PluginConnectionActionProps {
    providerName: string;
    label: string;
    description?: string;
    icon?: ReactNode;
    brandColor?: string;
    disabled?: boolean;
    onClick: () => void;
}

/** A persistent connection-bound editor workspace. Never put credentials in its ID or title. */
export interface OpenPluginWorkspaceOptions {
    id: string;
    title: string;
    /** Must match the currently active connection in the slot and editor. */
    connectionId?: string;
}

export interface UsePluginWorkspaceReturn {
    openWorkspace: (options: OpenPluginWorkspaceOptions) => string;
}

/** Native-themed layout for a provider workspace; data and navigation stay plugin-owned. */
export interface PluginWorkspaceShellProps {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    brandColor?: string;
    tabs?: ReadonlyArray<{id: string; label: string; icon?: ReactNode}>;
    activeTab?: string;
    onTabChange?: (id: string) => void;
    children: ReactNode;
    actions?: ReactNode;
}

/** Connection services rendered as native Explorer rows, each opening its own editor tab. */
export interface PluginExplorerSectionProps {
    pluginId: string;
    providerName: string;
    connectionId?: string;
    icon?: ReactNode;
    items: ReadonlyArray<{id: string; label: string; icon?: string}>;
    disabled?: boolean;
}

/** Read-only provider results rendered by the host's native data grid. */
export interface PluginDataGridProps {
    columns: string[];
    rows: unknown[][];
    connectionId?: string | null;
    label?: string;
    /** Fill the available editor area instead of sizing to a short dataset. */
    fill?: boolean;
}

/** Account metadata and connection imports; stored secret values never return to UI code. */
export interface PluginAccountImportResult {
    id: string;
    name: string;
    warnings: string[];
}

export interface UsePluginAccountReturn {
    connect: (secrets: Record<string, string>) => Promise<void>;
    secretFields: () => Promise<string[]>;
    disconnect: () => Promise<void>;
    call: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
    importConnection: (args: Record<string, unknown>) => Promise<PluginAccountImportResult>;
}

export interface PluginResourceListProps {
    items: ReadonlyArray<{id: string; title: string; subtitle?: string; status?: string}>;
    onOpen: (id: string) => void;
    emptyMessage: string;
    label?: string;
}

export interface PluginCodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    language?: 'javascript' | 'json' | 'plaintext';
    readOnly?: boolean;
    label?: string;
}
