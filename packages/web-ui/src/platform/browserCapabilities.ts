import type { TabularisClient } from "../api/client";
import {
  createPlatformCapabilityNegotiation,
  UnsupportedPlatformCapabilityError,
  type AttentionLevel,
  type ChooseInputFileOptions,
  type ChooseSaveTargetOptions,
  type ChosenInputFile,
  type ChosenSaveTarget,
  type DownloadFileRequest,
  type NotificationOutcome,
  type OpenRouteRequest,
  type PlatformCapabilities,
  type PlatformCapabilityName,
  type PlatformCapabilityNegotiation,
  type PlatformNotification,
} from "./capabilities";

const BROWSER_CAPABILITY_NEGOTIATION = createPlatformCapabilityNegotiation(
  "browser",
  {
    chooseInputFile: {
      supported: false,
      adaptation: "unsupported",
      reason: "Browser file workflows require an operation-specific upload",
    },
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

export class BrowserPlatformCapabilities implements PlatformCapabilities {
  readonly negotiation: PlatformCapabilityNegotiation =
    BROWSER_CAPABILITY_NEGOTIATION;
  private readonly client: TabularisClient;

  constructor(client: TabularisClient) {
    this.client = client;
  }

  supports(capability: PlatformCapabilityName): boolean {
    return this.negotiation.capabilities[capability].supported;
  }

  chooseInputFile(
    _options?: ChooseInputFileOptions,
  ): Promise<ChosenInputFile | null> {
    void _options;
    return this.unsupported("chooseInputFile");
  }

  chooseSaveTarget(
    _options?: ChooseSaveTargetOptions,
  ): Promise<ChosenSaveTarget | null> {
    void _options;
    return this.unsupported("chooseSaveTarget");
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
    const blob = new Blob([bytes]);
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

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml";
    input.addEventListener(
      "change",
      () => resolve(input.files?.item(0) ?? null),
      { once: true },
    );
    input.click();
  });
}
