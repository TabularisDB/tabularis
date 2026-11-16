/** Account operations are independent of saved database connections and require local-admin access. */
export type PluginAccountRequest = {pluginId: string} & (
    | {operation: 'connect'; secrets: Record<string, string>}
    | {operation: 'fields' | 'disconnect'}
    | {operation: 'call' | 'prepare'; method: string; args: Record<string, unknown>}
    | {operation: 'import'; args: Record<string, unknown>}
);

export interface PluginAccountImportResult {
    id: string;
    name: string;
    warnings: string[];
}

/** The host stores credentials and imports connections without exposing their secret values. */
export interface UsePluginAccountReturn {
    /** Saved connections belonging to this provider, without credentials. */
    connections: ReadonlyArray<{id: string; name: string}>;
    openConnection: (connectionId: string, sourceConnectionId?: string) => Promise<void>;
    callConnection: <T = unknown>(
        connectionId: string,
        method: string,
        args?: Record<string, unknown>,
    ) => Promise<T>;
    /** Metadata and interactive authentication setup; no stored account credentials are forwarded. */
    prepare: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
    connect: (secrets: Record<string, string>) => Promise<void>;
    secretFields: () => Promise<string[]>;
    disconnect: () => Promise<void>;
    call: <T = unknown>(method: string, args?: Record<string, unknown>) => Promise<T>;
    importConnection: (args: Record<string, unknown>) => Promise<PluginAccountImportResult>;
}
