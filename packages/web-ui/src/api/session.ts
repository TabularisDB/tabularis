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
  readonly profile: "debug" | "release";
  readonly commit: string | null;
}

export interface WebQueryResponsePolicy {
  readonly maxRowsPerPage: number;
  readonly maxResponseBytes: number;
  readonly streaming: boolean;
}

export type WebAuthorizationLevel =
  | "session"
  | "database"
  | "sensitive"
  | "local-admin";

export interface WebSessionAccessPolicy {
  readonly remote: boolean;
  readonly authorizationLevel: WebAuthorizationLevel;
  readonly highRiskCapabilities: boolean;
}

export interface SessionNegotiation {
  readonly apiVersion: string;
  readonly serverVersion: string;
  readonly serverBuild: ServerBuildInformation;
  readonly authenticated: boolean;
  readonly csrfToken: string;
  readonly access: WebSessionAccessPolicy;
  readonly capabilities: WebTransportCapabilities;
  readonly queryResponsePolicy: WebQueryResponsePolicy;
}
