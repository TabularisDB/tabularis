export const PLATFORM_CAPABILITY_NAMES = [
  "chooseInputFile",
  "chooseSaveTarget",
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

export interface DownloadFileRequest {
  readonly fileName: string;
  readonly contents: Uint8Array;
  readonly title?: string;
  readonly filters?: readonly PlatformFileFilter[];
}

export interface PlatformNotification {
  readonly title: string;
  readonly body?: string;
}

export type NotificationOutcome = "shown" | "permission-denied";

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
    };

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
  chooseConnectionIcon(connectionId: string): Promise<string | null>;
  resolveAppAsset(relativePath: string): Promise<string>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  downloadFile(request: DownloadFileRequest): Promise<boolean>;
  openExternalUrl(url: string): Promise<void>;
  notify(notification: PlatformNotification): Promise<NotificationOutcome>;
  openRoute(request: OpenRouteRequest): Promise<void>;
  closeRoute(): Promise<void>;
  requestAttention(level?: AttentionLevel): Promise<void>;
  restartApplication(): Promise<void>;
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
