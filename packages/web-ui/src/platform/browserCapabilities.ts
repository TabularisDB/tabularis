import type { TabularisClient } from "../api/client";
import {
  createPlatformCapabilityNegotiation,
  UnsupportedPlatformCapabilityError,
  type AttentionLevel,
  type BlobRecordRequest,
  type ChooseInputFileOptions,
  type ChooseSaveTargetOptions,
  type ChosenInputFile,
  type ChosenSaveTarget,
  type DownloadFileRequest,
  type FetchedBlob,
  type NotificationOutcome,
  type OpenConnectionRouteRequest,
  type OpenRouteRequest,
  type PlatformCapabilities,
  type PlatformCapabilityName,
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

const BROWSER_CAPABILITY_NEGOTIATION = createPlatformCapabilityNegotiation(
  "browser",
  {
    chooseInputFile: { supported: true, adaptation: "adapted" },
    chooseSaveTarget: {
      supported: false,
      adaptation: "unsupported",
      reason: "Browsers download files instead of exposing writable paths",
    },
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
  },
);

type BrowserFilePicker = (accept?: string) => Promise<File | null>;

export class BrowserPlatformCapabilities implements PlatformCapabilities {
  readonly negotiation: PlatformCapabilityNegotiation =
    BROWSER_CAPABILITY_NEGOTIATION;
  private readonly client: TabularisClient;
  private readonly filePicker: BrowserFilePicker;
  private readonly inputFiles = new Map<string, File>();

  constructor(client: TabularisClient, filePicker: BrowserFilePicker = pickFile) {
    this.client = client;
    this.filePicker = filePicker;
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
    _options?: ChooseSaveTargetOptions,
  ): Promise<ChosenSaveTarget | null> {
    void _options;
    return this.unsupported("chooseSaveTarget");
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

  readClipboard(): Promise<string> {
    return navigator.clipboard.readText();
  }

  writeClipboard(text: string): Promise<void> {
    return navigator.clipboard.writeText(text);
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
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async notify(
    notification: PlatformNotification,
  ): Promise<NotificationOutcome> {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") return "permission-denied";
    new Notification(notification.title, { body: notification.body });
    return "shown";
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
    input.type = "file";
    if (accept) input.accept = accept;
    input.addEventListener(
      "change",
      () => resolve(input.files?.item(0) ?? null),
      { once: true },
    );
    input.click();
  });
}
