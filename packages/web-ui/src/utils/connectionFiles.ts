import type { TabularisClient } from "../api/client";
import type {
  ConnectionImportFile,
  GeneratedFile,
} from "../api/contract";
import type {
  ChosenInputFile,
  PlatformCapabilities,
} from "../platform/capabilities";

const CONNECTION_IMPORT_PURPOSE = "connection-import";

export async function prepareConnectionImportFile(
  client: TabularisClient,
  platform: PlatformCapabilities,
  file: ChosenInputFile,
  preparedContents?: Uint8Array,
): Promise<ConnectionImportFile> {
  if (platform.negotiation.environment === "tauri") {
    return { kind: "serverPath", path: file.reference };
  }

  const contents =
    preparedContents ?? (await platform.readInputFile(file.reference));
  const metadata = await client.uploadFile({
    contents: new Blob([copyToArrayBuffer(contents)], {
      type: "application/octet-stream",
    }),
    fileName: file.name,
    purpose: CONNECTION_IMPORT_PURPOSE,
  });
  return { kind: "upload", token: metadata.token };
}

export async function saveGeneratedFile(
  client: TabularisClient,
  platform: PlatformCapabilities,
  generated: GeneratedFile,
): Promise<boolean> {
  const contents =
    generated.kind === "inline"
      ? new TextEncoder().encode(generated.contents)
      : new Uint8Array(
          await (await client.consumeDownload(generated.token)).arrayBuffer(),
        );

  return platform.downloadFile({
    fileName: generated.fileName,
    mimeType: generated.mimeType,
    contents,
  });
}

function copyToArrayBuffer(contents: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(contents.byteLength);
  new Uint8Array(copy).set(contents);
  return copy;
}
