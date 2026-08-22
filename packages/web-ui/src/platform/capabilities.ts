export const PLATFORM_CAPABILITY_NAMES = [
  "chooseInputFile",
  "chooseSaveTarget",
  "chooseServerPath",
  "confirm",
  "showMessage",
  "readClipboard",
  "writeClipboard",
  "downloadFile",
  "openExternalUrl",
  "notify",
  "openRoute",
  "closeRoute",
  "requestAttention",
  "restartApplication",
] as const;

export type PlatformCapabilityName =
  (typeof PLATFORM_CAPABILITY_NAMES)[number];
export type PlatformEnvironment = "tauri" | "browser";
export type CapabilityAdaptation = "native" | "adapted";

export type PlatformCapabilityAvailability =
  | {
      readonly supported: true;
      readonly adaptation: CapabilityAdaptation;
    }
  | {
      readonly supported: false;
      readonly adaptation: "unsupported";
      readonly reason: string;
    };

export interface PlatformCapabilityNegotiation {
  readonly environment: PlatformEnvironment;
  readonly capabilities: Readonly<
    Record<PlatformCapabilityName, PlatformCapabilityAvailability>
  >;
}

export interface PlatformFileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

export interface ChooseInputFileOptions {
  readonly title?: string;
  readonly filters?: readonly PlatformFileFilter[];
}

export interface ChosenInputFile {
  readonly name: string;
  /**
   * An opaque reference understood by the active platform adapter. Shared UI
   * code must not interpret this value as a server-side filesystem path.
   */
  readonly reference: string;
}

export interface ChooseSaveTargetOptions {
  readonly title?: string;
  readonly suggestedName?: string;
  readonly filters?: readonly PlatformFileFilter[];
}

export interface ChosenSaveTarget {
  /**
   * An opaque reference understood by the active platform adapter. Shared UI
   * code must not interpret this value as a server-side filesystem path.
   */
  readonly reference: string;
}

export interface ChooseServerPathOptions {
  readonly kind: "file" | "directory";
  readonly title?: string;
  readonly filters?: readonly PlatformFileFilter[];
}

export type PlatformDialogKind = "info" | "warning" | "error";

export interface PlatformDialogRequest {
  readonly message: string;
  readonly title?: string;
  readonly kind?: PlatformDialogKind;
}

export interface DownloadFileRequest {
  readonly fileName: string;
  readonly contents: Uint8Array;
  readonly mimeType?: string;
  readonly title?: string;
  readonly filters?: readonly PlatformFileFilter[];
}

export interface BlobRecordRequest {
  readonly connectionId: string;
  readonly table: string;
  readonly colName: string;
  readonly pkMap: Record<string, unknown>;
  readonly schema?: string;
  readonly database?: string;
}

export interface FetchedBlob {
  readonly contents: Uint8Array;
  readonly mimeType: string;
}

export interface PlatformNotification {
  readonly title: string;
  readonly body?: string;
  readonly sound?: string;
}

export type NotificationOutcome = "shown" | "permission-denied";

export interface RouteWindowOptions {
  readonly width?: number;
  readonly height?: number;
  readonly minWidth?: number;
  readonly minHeight?: number;
}

export type OpenRouteRequest =
  | {
      readonly route: string;
      readonly target: "current";
    }
  | {
      readonly route: string;
      readonly target: "new";
      readonly label: string;
      readonly title?: string;
      readonly window?: RouteWindowOptions;
    };

export interface OpenConnectionRouteRequest {
  readonly connectionId: string;
  readonly title?: string | null;
}

export type RouteEventHandler<T> = (payload: T) => void;
export type UnsubscribeRouteEvent = () => void;

export type AttentionLevel = "informational" | "critical";

export interface PlatformCapabilities {
  readonly negotiation: PlatformCapabilityNegotiation;

  supports(capability: PlatformCapabilityName): boolean;
  chooseInputFile(
    options?: ChooseInputFileOptions,
  ): Promise<ChosenInputFile | null>;
  chooseSaveTarget(
    options?: ChooseSaveTargetOptions,
  ): Promise<ChosenSaveTarget | null>;
  chooseServerPath(
    options: ChooseServerPathOptions,
  ): Promise<ChosenSaveTarget | null>;
  confirm(request: PlatformDialogRequest): Promise<boolean>;
  showMessage(request: PlatformDialogRequest): Promise<void>;
  readInputFile(reference: string): Promise<Uint8Array>;
  readInputBlob(reference: string): Promise<Blob>;
  chooseConnectionIcon(connectionId: string): Promise<string | null>;
  chooseBlob(): Promise<string | null>;
  previewBlobReference(value: unknown): Promise<string | null>;
  fetchBlobReference(value: unknown): Promise<FetchedBlob>;
  fetchDatabaseBlob(request: BlobRecordRequest): Promise<FetchedBlob>;
  resolveAppAsset(relativePath: string): Promise<string>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  downloadFile(request: DownloadFileRequest): Promise<boolean>;
  openExternalUrl(url: string): Promise<void>;
  notify(notification: PlatformNotification): Promise<NotificationOutcome>;
  openRoute(request: OpenRouteRequest): Promise<void>;
  openConnectionRoute(request: OpenConnectionRouteRequest): Promise<void>;
  publishRouteEvent<T>(event: string, payload: T): Promise<void>;
  subscribeRouteEvent<T>(
    event: string,
    handler: RouteEventHandler<T>,
  ): Promise<UnsubscribeRouteEvent>;
  closeRoute(): Promise<void>;
  requestAttention(level?: AttentionLevel): Promise<void>;
  restartApplication(): Promise<void>;
}

export class PlatformCapabilityPermissionError extends Error {
  readonly code = "PLATFORM_CAPABILITY_PERMISSION_DENIED";
  readonly capability: PlatformCapabilityName;
  readonly environment: PlatformEnvironment;

  constructor(
    capability: PlatformCapabilityName,
    environment: PlatformEnvironment,
    cause?: unknown,
  ) {
    super(`${capability} permission was denied in ${environment}`, { cause });
    this.name = "PlatformCapabilityPermissionError";
    this.capability = capability;
    this.environment = environment;
  }
}

export class UnsupportedPlatformCapabilityError extends Error {
  readonly code = "PLATFORM_CAPABILITY_UNSUPPORTED";
  readonly capability: PlatformCapabilityName;
  readonly environment: PlatformEnvironment;

  constructor(
    capability: PlatformCapabilityName,
    environment: PlatformEnvironment,
    reason?: string,
  ) {
    super(
      reason
        ? `${capability} is not supported in ${environment}: ${reason}`
        : `${capability} is not supported in ${environment}`,
    );
    this.name = "UnsupportedPlatformCapabilityError";
    this.capability = capability;
    this.environment = environment;
  }
}

export function createPlatformCapabilityNegotiation(
  environment: PlatformEnvironment,
  capabilities: Partial<
    Record<PlatformCapabilityName, PlatformCapabilityAvailability>
  >,
): PlatformCapabilityNegotiation {
  return {
    environment,
    capabilities: Object.fromEntries(
      PLATFORM_CAPABILITY_NAMES.map((capability) => [
        capability,
        capabilities[capability] ?? {
          supported: false,
          adaptation: "unsupported",
          reason: "The active platform did not advertise this capability",
        },
      ]),
    ) as Record<PlatformCapabilityName, PlatformCapabilityAvailability>,
  };
}

export function requirePlatformCapability(
  negotiation: PlatformCapabilityNegotiation,
  capability: PlatformCapabilityName,
): void {
  const availability = negotiation.capabilities[capability];
  if (!availability.supported) {
    throw new UnsupportedPlatformCapabilityError(
      capability,
      negotiation.environment,
      availability.reason,
    );
  }
}
