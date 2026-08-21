import { invoke } from "@tauri-apps/api/core";
import {
  open as openDialog,
  save as saveDialog,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { UserAttentionType, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  PLATFORM_CAPABILITY_NAMES,
  createPlatformCapabilityNegotiation,
  requirePlatformCapability,
  type AttentionLevel,
  type ChooseInputFileOptions,
  type ChooseSaveTargetOptions,
  type ChosenInputFile,
  type ChosenSaveTarget,
  type DownloadFileRequest,
  type NotificationOutcome,
  type OpenRouteRequest,
  type PlatformCapabilities,
  type PlatformCapabilityNegotiation,
  type PlatformNotification,
} from "./capabilities";

export interface TauriPlatformOperations {
  chooseInputPath(
    options?: ChooseInputFileOptions,
  ): Promise<string | string[] | null>;
  chooseSavePath(options?: ChooseSaveTargetOptions): Promise<string | null>;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  writeFileContents(reference: string, contents: Uint8Array): Promise<void>;
  openUrl(url: string): Promise<void>;
  isNotificationPermissionGranted(): Promise<boolean>;
  requestNotificationPermission(): Promise<string>;
  sendNotification(notification: PlatformNotification): void;
  openRoute(request: OpenRouteRequest): Promise<void>;
  closeRoute(): Promise<void>;
  requestAttention(level: AttentionLevel): Promise<void>;
  restartApplication(): Promise<void>;
}

const toDialogFilters = (
  filters: ChooseInputFileOptions["filters"],
) =>
  filters?.map(({ name, extensions }) => ({
    name,
    extensions: [...extensions],
  }));

const openTauriRoute = async (request: OpenRouteRequest): Promise<void> => {
  if (request.target === "current") {
    globalThis.location.assign(request.route);
    return;
  }

  const existingWindow = await WebviewWindow.getByLabel(request.label);
  if (existingWindow) {
    await existingWindow.show();
    await existingWindow.unminimize();
    await existingWindow.setFocus();
    return;
  }

  const routeWindow = new WebviewWindow(request.label, {
    url: request.route,
    ...(request.title ? { title: request.title } : {}),
  });

  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      reject(
        error instanceof Error
          ? error
          : new Error(`Failed to open route: ${String(error)}`),
      );
    };

    void routeWindow.once("tauri://created", () => resolve()).catch(fail);
    void routeWindow
      .once<unknown>("tauri://error", ({ payload }) => fail(payload))
      .catch(fail);
  });
};

const defaultTauriOperations: TauriPlatformOperations = {
  chooseInputPath: (options) => {
    const dialogOptions: OpenDialogOptions = {
      multiple: false,
      directory: false,
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.filters
        ? { filters: toDialogFilters(options.filters) }
        : {}),
    };
    return openDialog(dialogOptions);
  },
  chooseSavePath: (options) => {
    const dialogOptions: SaveDialogOptions = {
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.suggestedName
        ? { defaultPath: options.suggestedName }
        : {}),
      ...(options?.filters
        ? { filters: toDialogFilters(options.filters) }
        : {}),
    };
    return saveDialog(dialogOptions);
  },
  readClipboardText: readText,
  writeClipboardText: writeText,
  writeFileContents: writeFile,
  openUrl,
  isNotificationPermissionGranted: isPermissionGranted,
  requestNotificationPermission: requestPermission,
  sendNotification,
  openRoute: openTauriRoute,
  closeRoute: () => getCurrentWindow().close(),
  requestAttention: (level) =>
    getCurrentWindow().requestUserAttention(
      level === "critical"
        ? UserAttentionType.Critical
        : UserAttentionType.Informational,
    ),
  restartApplication: () => invoke<void>("relaunch_app"),
};

const nativeCapabilityAvailability = Object.fromEntries(
  PLATFORM_CAPABILITY_NAMES.map((capability) => [
    capability,
    { supported: true, adaptation: "native" } as const,
  ]),
);

export const TAURI_PLATFORM_CAPABILITY_NEGOTIATION =
  createPlatformCapabilityNegotiation(
    "tauri",
    nativeCapabilityAvailability,
  );

const selectedFileName = (reference: string): string => {
  const segments = reference.split(/[\\/]/);
  return segments.at(-1) || reference;
};

export class TauriPlatformCapabilities implements PlatformCapabilities {
  readonly negotiation: PlatformCapabilityNegotiation;
  private readonly operations: TauriPlatformOperations;

  constructor(
    operations: TauriPlatformOperations = defaultTauriOperations,
    negotiation: PlatformCapabilityNegotiation =
      TAURI_PLATFORM_CAPABILITY_NEGOTIATION,
  ) {
    this.operations = operations;
    this.negotiation = negotiation;
  }

  supports(
    capability: keyof PlatformCapabilityNegotiation["capabilities"],
  ): boolean {
    return this.negotiation.capabilities[capability].supported;
  }

  async chooseInputFile(
    options?: ChooseInputFileOptions,
  ): Promise<ChosenInputFile | null> {
    this.require("chooseInputFile");
    const selected = await this.operations.chooseInputPath(options);
    const reference = Array.isArray(selected) ? selected[0] : selected;
    return reference
      ? { name: selectedFileName(reference), reference }
      : null;
  }

  async chooseSaveTarget(
    options?: ChooseSaveTargetOptions,
  ): Promise<ChosenSaveTarget | null> {
    this.require("chooseSaveTarget");
    const reference = await this.operations.chooseSavePath(options);
    return reference ? { reference } : null;
  }

  async readClipboard(): Promise<string> {
    this.require("readClipboard");
    return this.operations.readClipboardText();
  }

  async writeClipboard(text: string): Promise<void> {
    this.require("writeClipboard");
    await this.operations.writeClipboardText(text);
  }

  async downloadFile(request: DownloadFileRequest): Promise<boolean> {
    this.require("downloadFile");
    const reference = await this.operations.chooseSavePath({
      title: request.title,
      suggestedName: request.fileName,
      filters: request.filters,
    });
    if (!reference) return false;

    await this.operations.writeFileContents(reference, request.contents);
    return true;
  }

  async openExternalUrl(url: string): Promise<void> {
    this.require("openExternalUrl");
    await this.operations.openUrl(url);
  }

  async notify(
    notification: PlatformNotification,
  ): Promise<NotificationOutcome> {
    this.require("notify");
    let permissionGranted =
      await this.operations.isNotificationPermissionGranted();
    if (!permissionGranted) {
      permissionGranted =
        (await this.operations.requestNotificationPermission()) === "granted";
    }
    if (!permissionGranted) return "permission-denied";

    this.operations.sendNotification(notification);
    return "shown";
  }

  async openRoute(request: OpenRouteRequest): Promise<void> {
    this.require("openRoute");
    await this.operations.openRoute(request);
  }

  async closeRoute(): Promise<void> {
    this.require("closeRoute");
    await this.operations.closeRoute();
  }

  async requestAttention(
    level: AttentionLevel = "informational",
  ): Promise<void> {
    this.require("requestAttention");
    await this.operations.requestAttention(level);
  }

  async restartApplication(): Promise<void> {
    this.require("restartApplication");
    await this.operations.restartApplication();
  }

  private require(
    capability: keyof PlatformCapabilityNegotiation["capabilities"],
  ): void {
    requirePlatformCapability(this.negotiation, capability);
  }
}
