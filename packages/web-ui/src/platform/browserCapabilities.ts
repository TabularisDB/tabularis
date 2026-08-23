import type { TabularisClient } from "../api/client";
import {
  createPlatformCapabilityNegotiation,
  PlatformCapabilityPermissionError,
  UnsupportedPlatformCapabilityError,
  type AttentionLevel,
  type BlobRecordRequest,
  type ChooseInputFileOptions,
  type ChooseSaveTargetOptions,
  type ChooseServerPathOptions,
  type ChosenInputFile,
  type ChosenSaveTarget,
  type DownloadFileRequest,
  type FetchedBlob,
  type NotificationOutcome,
  type OpenConnectionRouteRequest,
  type OpenRouteRequest,
  type PlatformCapabilities,
  type PlatformCapabilityName,
  type PlatformDialogRequest,
  type PlatformCapabilityNegotiation,
  type PlatformNotification,
  type RouteEventHandler,
  type UnsubscribeRouteEvent,
} from "./capabilities";
import {
  blobPayloadToBytes,
  extractBase64Payload,
  extractBlobMetadata,
  parseBlobUploadRef,
} from "../utils/blob";
import {
  buildConnectionRoute,
  buildRouteWindowLabel,
} from "../routing";
import { publishBrowserCapabilityFallback } from "./browserFallbacks";
import {
  requestBrowserMessage,
  requestBrowserSaveTarget,
  requestBrowserServerPath,
} from "./browserDialogs";

function browserCapabilityNegotiation(
  serverFileBrowser: boolean,
): PlatformCapabilityNegotiation {
  return createPlatformCapabilityNegotiation("browser", {
    chooseInputFile: { supported: true, adaptation: "adapted" },
    chooseSaveTarget: serverFileBrowser
      ? { supported: true, adaptation: "adapted" }
      : {
          supported: false,
          adaptation: "unsupported",
          reason:
            "Server file browsing is disabled. Start Tabularis with --server-file-browser-root <PATH> to enable it.",
        },
    chooseServerPath: serverFileBrowser
      ? { supported: true, adaptation: "adapted" }
      : {
          supported: false,
          adaptation: "unsupported",
          reason:
            "Server file browsing is disabled. Start Tabularis with --server-file-browser-root <PATH> to enable it.",
        },
    confirm: { supported: true, adaptation: "adapted" },
    showMessage: { supported: true, adaptation: "adapted" },
    readClipboard: { supported: true, adaptation: "adapted" },
    writeClipboard: { supported: true, adaptation: "adapted" },
    downloadFile: { supported: true, adaptation: "adapted" },
    openExternalUrl: { supported: true, adaptation: "adapted" },
    notify: { supported: true, adaptation: "adapted" },
    openRoute: { supported: true, adaptation: "adapted" },
    closeRoute: { supported: true, adaptation: "adapted" },
    requestAttention: { supported: true, adaptation: "adapted" },
    restartApplication: {
      supported: false,
      adaptation: "unsupported",
      reason: "The browser cannot restart the Tabularis server",
    },
  });
}

type BrowserFilePicker = (accept?: string) => Promise<File | null>;

export class BrowserPlatformCapabilities implements PlatformCapabilities {
  readonly negotiation: PlatformCapabilityNegotiation;
  private readonly client: TabularisClient;
  private readonly filePicker: BrowserFilePicker;
  private readonly inputFiles = new Map<string, File>();

  constructor(
    client: TabularisClient,
    filePicker: BrowserFilePicker = pickFile,
    serverFileBrowser = false,
  ) {
    this.client = client;
    this.filePicker = filePicker;
    this.negotiation = browserCapabilityNegotiation(serverFileBrowser);
  }

  supports(capability: PlatformCapabilityName): boolean {
    return this.negotiation.capabilities[capability].supported;
  }

  async chooseInputFile(
    options?: ChooseInputFileOptions,
  ): Promise<ChosenInputFile | null> {
    const accept = options?.filters
      ?.flatMap(({ extensions }) => extensions.map((extension) => `.${extension}`))
      .join(",");
    const file = await this.filePicker(accept);
    if (!file) return null;
    const reference = `browser-file:${crypto.randomUUID()}`;
    this.inputFiles.set(reference, file);
    return { name: file.name, reference };
  }

  chooseSaveTarget(
    options: ChooseSaveTargetOptions = {},
  ): Promise<ChosenSaveTarget | null> {
    if (!this.supports("chooseSaveTarget")) {
      return this.unsupported("chooseSaveTarget");
    }
    return requestBrowserSaveTarget(options);
  }

  chooseServerPath(
    options: ChooseServerPathOptions,
  ): Promise<ChosenSaveTarget | null> {
    if (!this.supports("chooseServerPath")) {
      return this.unsupported("chooseServerPath");
    }
    return requestBrowserServerPath(options);
  }

  confirm(request: PlatformDialogRequest): Promise<boolean> {
    return Promise.resolve(window.confirm(dialogText(request)));
  }

  showMessage(request: PlatformDialogRequest): Promise<void> {
    return requestBrowserMessage(request);
  }

  async readInputFile(reference: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.readInputBlob(reference)).arrayBuffer());
  }

  readInputBlob(reference: string): Promise<Blob> {
    const file = this.inputFiles.get(reference);
    if (!file) {
      return Promise.reject(new Error("Invalid or expired browser file reference"));
    }
    this.inputFiles.delete(reference);
    return Promise.resolve(file);
  }

  async chooseConnectionIcon(connectionId: string): Promise<string | null> {
    const file = await pickImageFile();
    if (!file) return null;
    const uploadToken = await this.client.uploadConnectionIcon(file);
    return this.client.call("save_connection_icon", {
      connectionId,
      uploadToken,
    });
  }

  async chooseBlob(): Promise<string | null> {
    const file = await pickFile();
    return file ? this.client.uploadBlob(file) : null;
  }

  previewBlobReference(value: unknown): Promise<string | null> {
    const reference = parseBlobUploadRef(value);
    if (!reference?.mimeType.startsWith("image/")) return Promise.resolve(null);
    return Promise.resolve(this.client.uploadedBlobUrl(reference.token));
  }

  async fetchBlobReference(value: unknown): Promise<FetchedBlob> {
    const reference = parseBlobUploadRef(value);
    if (!reference) throw new Error("Invalid browser BLOB upload reference");
    const blob = await this.client.readUploadedBlob(reference.token);
    return {
      contents: new Uint8Array(await blob.arrayBuffer()),
      mimeType: reference.mimeType || blob.type || "application/octet-stream",
    };
  }

  async fetchDatabaseBlob(request: BlobRecordRequest): Promise<FetchedBlob> {
    const response = await this.client.call("fetch_blob", request);
    if (response.kind === "download") {
      const blob = await this.client.consumeBlobDownload(response.token);
      return {
        contents: new Uint8Array(await blob.arrayBuffer()),
        mimeType: response.mimeType || blob.type || "application/octet-stream",
      };
    }
    const metadata = extractBlobMetadata(response.wireValue);
    if (!metadata) throw new Error("The backend returned invalid BLOB metadata");
    return {
      contents: blobPayloadToBytes(
        extractBase64Payload(response.wireValue),
        metadata.isBase64,
      ),
      mimeType: metadata.mimeType,
    };
  }

  resolveAppAsset(relativePath: string): Promise<string> {
    const match = relativePath.match(/^connection-icons\/([^/\\]+)$/);
    if (!match) {
      return Promise.reject(new Error("Invalid application asset path"));
    }
    return Promise.resolve(
      `/api/v1/assets/connection-icons/${encodeURIComponent(match[1])}`,
    );
  }

  async readClipboard(): Promise<string> {
    try {
      if (!navigator.clipboard?.readText) {
        throw new DOMException("Clipboard access is unavailable", "NotAllowedError");
      }
      return await navigator.clipboard.readText();
    } catch (error) {
      throw new PlatformCapabilityPermissionError(
        "readClipboard",
        "browser",
        error,
      );
    }
  }

  async writeClipboard(text: string): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new DOMException("Clipboard access is unavailable", "NotAllowedError");
      }
      await navigator.clipboard.writeText(text);
    } catch (error) {
      throw new PlatformCapabilityPermissionError(
        "writeClipboard",
        "browser",
        error,
      );
    }
  }

  async downloadFile(request: DownloadFileRequest): Promise<boolean> {
    const bytes = new ArrayBuffer(request.contents.byteLength);
    new Uint8Array(bytes).set(request.contents);
    const blob = new Blob([bytes], {
      type: request.mimeType ?? "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = request.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  }

  async openExternalUrl(url: string): Promise<void> {
    const externalUrl = normalizeExternalUrl(url);
    const opened = window.open(
      externalUrl.href,
      "_blank",
      "noopener,noreferrer",
    );
    if (!opened) {
      publishBrowserCapabilityFallback({
        kind: "external-url",
        url: externalUrl.href,
      });
    }
  }

  async notify(
    notification: PlatformNotification,
  ): Promise<NotificationOutcome> {
    try {
      if (typeof Notification === "undefined") {
        publishBrowserCapabilityFallback({
          kind: "notification",
          ...notification,
        });
        return "permission-denied";
      }
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if (Notification.permission === "granted") {
        new Notification(notification.title, { body: notification.body });
        return "shown";
      }
    } catch {
      // The in-app fallback below preserves the notification outcome.
    }

    publishBrowserCapabilityFallback({
      kind: "notification",
      ...notification,
    });
    return "permission-denied";
  }

  async openRoute(request: OpenRouteRequest): Promise<void> {
    if (request.target === "current") {
      window.location.assign(request.route);
    } else {
      window.open(request.route, "_blank", "noopener,noreferrer");
    }
  }

  async openConnectionRoute(
    request: OpenConnectionRouteRequest,
  ): Promise<void> {
    await this.openRoute({
      route: buildConnectionRoute(request.connectionId),
      target: "new",
      label: buildRouteWindowLabel("connection-window", request.connectionId),
      title: request.title ? `tabularis - ${request.title}` : "tabularis",
    });
  }

  async publishRouteEvent<T>(event: string, payload: T): Promise<void> {
    const channel = new BroadcastChannel(routeEventChannelName(event));
    channel.postMessage(payload);
    channel.close();
  }

  async subscribeRouteEvent<T>(
    event: string,
    handler: RouteEventHandler<T>,
  ): Promise<UnsubscribeRouteEvent> {
    const channel = new BroadcastChannel(routeEventChannelName(event));
    const listener = ({ data }: MessageEvent<T>) => handler(data);
    channel.addEventListener("message", listener);
    return () => {
      channel.removeEventListener("message", listener);
      channel.close();
    };
  }

  async closeRoute(): Promise<void> {
    window.close();
  }

  async requestAttention(_level: AttentionLevel = "informational"): Promise<void> {
    void _level;
    window.focus();
  }

  restartApplication(): Promise<void> {
    return this.unsupported("restartApplication");
  }

  private unsupported<T>(capability: PlatformCapabilityName): Promise<T> {
    const availability = this.negotiation.capabilities[capability];
    return Promise.reject(
      new UnsupportedPlatformCapabilityError(
        capability,
        "browser",
        availability.supported ? undefined : availability.reason,
      ),
    );
  }
}

function dialogText(request: PlatformDialogRequest): string {
  return request.title
    ? `${request.title}\n\n${request.message}`
    : request.message;
}

function normalizeExternalUrl(value: string): URL {
  const url = new URL(value);
  if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`);
  }
  return url;
}

function routeEventChannelName(event: string): string {
  return `tabularis-route:${event}`;
}

function pickImageFile(): Promise<File | null> {
  return pickFile(
    ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml",
  );
}

function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      input.remove();
      resolve(input.files?.item(0) ?? null);
    };
    const handleWindowFocus = () => {
      window.setTimeout(finish, 0);
    };

    input.type = "file";
    input.hidden = true;
    if (accept) input.accept = accept;
    input.addEventListener("change", finish, { once: true });
    window.addEventListener("focus", handleWindowFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
