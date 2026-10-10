import type { TabularisClient } from "../api/client";
import type { GeneratedFile } from "../api/contract";
import type {
  PlatformCapabilities,
  PlatformFileFilter,
} from "../platform/capabilities";

interface TextDownloadRequest {
  fileName: string;
  contents: string;
  mimeType: string;
  title?: string;
  filters?: readonly PlatformFileFilter[];
}

export async function downloadGeneratedFile(
  client: TabularisClient,
  platform: PlatformCapabilities,
  file: GeneratedFile | null,
): Promise<boolean> {
  if (!file) return true;
  if (file.kind === "download") {
    await client.requestDownload(file.token);
    return true;
  }
  return downloadTextFile(platform, {
    fileName: file.fileName,
    contents: file.contents,
    mimeType: file.mimeType,
  });
}

export function downloadTextFile(
  platform: PlatformCapabilities,
  request: TextDownloadRequest,
): Promise<boolean> {
  return platform.downloadFile({
    fileName: request.fileName,
    contents: new TextEncoder().encode(request.contents),
    mimeType: request.mimeType,
    title: request.title,
    filters: request.filters,
  });
}
