import type {
  PlatformCapabilities,
  PlatformDialogKind,
  PlatformFileFilter,
} from "./capabilities";

interface ConfirmDialogOptions {
  readonly title?: string;
  readonly kind?: PlatformDialogKind;
}

export type PlatformConfirmDialog = (
  message: string,
  options?: ConfirmDialogOptions,
) => Promise<boolean>;

export function bindPlatformConfirm(
  platform: PlatformCapabilities,
): PlatformConfirmDialog {
  return (message, options) => confirmPlatformDialog(platform, message, options);
}

interface ServerPathDialogOptions {
  readonly multiple?: false;
  readonly title?: string;
  readonly directory?: boolean;
  readonly filters?: readonly PlatformFileFilter[];
}

interface SavePathDialogOptions {
  readonly title?: string;
  readonly defaultPath?: string;
  readonly filters?: readonly PlatformFileFilter[];
}

export async function choosePlatformServerPath(
  platform: PlatformCapabilities,
  options: ServerPathDialogOptions = {},
): Promise<string | null> {
  if (!platform.supports("chooseServerPath")) {
    const availability = platform.negotiation.capabilities.chooseServerPath;
    await platform.showMessage({
      message: availability.supported
        ? "Server path selection is unavailable"
        : availability.reason,
      kind: "info",
    });
    return null;
  }
  const selected = await platform.chooseServerPath({
    kind: options.directory ? "directory" : "file",
    ...(options.title ? { title: options.title } : {}),
    ...(options.filters ? { filters: options.filters } : {}),
  });
  return selected?.reference ?? null;
}

export async function choosePlatformSavePath(
  platform: PlatformCapabilities,
  options: SavePathDialogOptions = {},
): Promise<string | null> {
  if (!platform.supports("chooseSaveTarget")) {
    const availability = platform.negotiation.capabilities.chooseSaveTarget;
    await platform.showMessage({
      message: availability.supported
        ? "Save target selection is unavailable"
        : availability.reason,
      kind: "info",
    });
    return null;
  }
  const selected = await platform.chooseSaveTarget({
    ...(options.title ? { title: options.title } : {}),
    ...(options.defaultPath ? { suggestedName: options.defaultPath } : {}),
    ...(options.filters ? { filters: options.filters } : {}),
  });
  return selected?.reference ?? null;
}

export function confirmPlatformDialog(
  platform: PlatformCapabilities,
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> {
  return platform.confirm({
    message,
    ...(options?.title ? { title: options.title } : {}),
    ...(options?.kind ? { kind: options.kind } : {}),
  });
}
