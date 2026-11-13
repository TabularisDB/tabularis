export interface WebTransportCapabilities {
    readonly rpc: boolean;
    readonly events: boolean;
    readonly uploads: boolean;
    readonly downloads: boolean;
    readonly pluginAssets: boolean;
    readonly mcpHostConfiguration: boolean;
    readonly serverFileBrowser: boolean;
    readonly nativeUpdater: false;
}

export interface ServerBuildInformation {
    readonly target: string;
    readonly profile: 'debug' | 'release';
    readonly commit: string | null;
}

export interface WebQueryResponsePolicy {
    readonly maxRowsPerPage: number;
    readonly maxResponseBytes: number;
    readonly streaming: boolean;
}

export type WebAuthorizationLevel = 'session' | 'database' | 'sensitive' | 'local-admin';

export interface WebSessionAccessPolicy {
    readonly remote: boolean;
    readonly authorizationLevel: WebAuthorizationLevel;
    readonly highRiskCapabilities: boolean;
}

/** What the session may do with connections. The server enforces every flag; the UI only presents them. */
export interface ConnectionCapabilities {
    readonly managed: boolean;
    readonly canCreate: boolean;
    readonly canUpdate: boolean;
    readonly canDelete: boolean;
    readonly canDuplicate: boolean;
    readonly canImport: boolean;
    readonly canExport: boolean;
    readonly canTest: boolean;
    readonly canEditBranding: boolean;
    readonly canEditOrganization: boolean;
}

/** Desktop and standalone Web: nothing is restricted. */
export const STANDALONE_CONNECTION_CAPABILITIES: ConnectionCapabilities = {
    managed: false,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canDuplicate: true,
    canImport: true,
    canExport: true,
    canTest: true,
    canEditBranding: true,
    canEditOrganization: true,
};

/** Stable error code the server returns for every managed-mode denial. */
export const MANAGED_CONNECTION_DENIED_CODE = 'managed_connection_denied';

export interface SessionNegotiation {
    readonly apiVersion: string;
    readonly serverVersion: string;
    readonly serverBuild: ServerBuildInformation;
    readonly authenticated: boolean;
    readonly csrfToken: string;
    readonly access: WebSessionAccessPolicy;
    readonly capabilities: WebTransportCapabilities;
    /** Absent on servers that predate managed mode, which restrict nothing. */
    readonly connections?: ConnectionCapabilities;
    readonly queryResponsePolicy: WebQueryResponsePolicy;
}

export function resolveConnectionCapabilities(
    session: SessionNegotiation | null | undefined,
): ConnectionCapabilities {
    return session?.connections ?? STANDALONE_CONNECTION_CAPABILITIES;
}
