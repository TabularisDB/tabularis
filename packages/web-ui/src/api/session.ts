export interface WebTransportCapabilities {
  readonly rpc: boolean;
  readonly events: boolean;
  readonly uploads: boolean;
  readonly downloads: boolean;
  readonly pluginAssets: boolean;
}

export interface SessionNegotiation {
  readonly apiVersion: string;
  readonly serverVersion: string;
  readonly authenticated: boolean;
  readonly csrfToken: string;
  readonly capabilities: WebTransportCapabilities;
}
