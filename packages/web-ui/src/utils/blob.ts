/**
 * Utility functions for handling BLOB data types.
 * MIME detection is performed exclusively on the backend via the `infer` crate.
 * All blob values arrive from the backend in the canonical wire format:
 *   "BLOB:<total_size_bytes>:<mime_type>:<base64_data>"
 */

/**
 * Maximum column length (in bytes) below which a BINARY/VARBINARY column is
 * rendered as plain text instead of as a BLOB. Columns with
 * character_maximum_length <= this threshold are treated as text fields
 * (e.g. UUIDs stored as VARBINARY(36)). Columns without a known length are
 * always rendered as BLOBs.
 */
export const BLOB_TEXT_LENGTH_THRESHOLD = 65_535;

/**
 * Returns true if the value is in the canonical BLOB wire format
 * ("BLOB:..." or "BLOB_FILE_REF:...") produced by the backend.
 */
export function isBlobWireFormat(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const s = String(value);
  return s.startsWith("BLOB:") || s.startsWith("BLOB_FILE_REF:");
}

/**
 * Checks if a data type is a BLOB/binary type.
 * Supports MySQL, PostgreSQL, and SQLite binary types.
 */
export function isBlobType(dataType: string): boolean {
  if (!dataType) {
    return false;
  }

  const normalizedType = dataType.toUpperCase();

  const binaryTypes = [
    "BLOB",
    "TINYBLOB",
    "MEDIUMBLOB",
    "LONGBLOB",
    "BINARY",
    "VARBINARY",
    "BYTEA", // PostgreSQL
  ];

  return binaryTypes.some((type) => normalizedType.includes(type));
}

/**
 * Returns true if a column should be rendered as a BLOB (binary data viewer)
 * rather than as plain text.
 *
 * BINARY/VARBINARY columns whose character_maximum_length is known and does
 * not exceed BLOB_TEXT_LENGTH_THRESHOLD are treated as text fields so that
 * small fixed-size values (e.g. UUIDs stored as VARBINARY(36)) remain readable.
 * Columns without a known length (undefined) are always treated as BLOBs.
 */
export function isBlobColumn(
  dataType: string,
  characterMaximumLength?: number,
): boolean {
  if (!isBlobType(dataType)) {
    return false;
  }

  const normalizedType = dataType.toUpperCase();
  const isVariableOrFixedBinary =
    normalizedType.includes("VARBINARY") || normalizedType === "BINARY";

  if (
    isVariableOrFixedBinary &&
    characterMaximumLength !== undefined &&
    characterMaximumLength <= BLOB_TEXT_LENGTH_THRESHOLD
  ) {
    return false;
  }

  return true;
}

/**
 * Formats a byte size into a human-readable string.
 */
function formatBlobSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const size = bytes / Math.pow(k, i);

  if (i === 0) {
    return `${size} ${units[i]}`;
  }

  return `${size.toFixed(2)} ${units[i]}`;
}

export interface BlobMetadata {
  mimeType: string;
  size: number;
  formattedSize: string;
  isBase64: boolean;
  isTruncated?: boolean;
}

/**
 * Extracts BLOB metadata from a value produced by the backend.
 *
 * Expected wire formats:
 *   - "BLOB:<size_bytes>:<mime_type>:<base64_data>"
 *   - "BLOB_FILE_REF:<size>:<mime>:<filepath>"
 *
 * Returns null for null/undefined values.
 * Returns a text/plain metadata object for plain-text strings that are not
 * in the BLOB wire format (e.g. BLOBs that contained valid UTF-8 text and
 * were returned as-is by the backend).
 */
export function extractBlobMetadata(value: unknown): BlobMetadata | null {
  if (value === null || value === undefined) {
    return null;
  }

  const stringValue = String(value);

  // Handle BLOB_FILE_REF format: "BLOB_FILE_REF:<size>:<mime>:<filepath>"
  if (stringValue.startsWith("BLOB_FILE_REF:")) {
    const firstColon = 14; // right after "BLOB_FILE_REF:"
    const secondColon = stringValue.indexOf(":", firstColon);
    const thirdColon = stringValue.indexOf(":", secondColon + 1);
    if (secondColon !== -1 && thirdColon !== -1) {
      const size = parseInt(stringValue.substring(firstColon, secondColon), 10);
      const mimeType = stringValue.substring(secondColon + 1, thirdColon);

      return {
        mimeType,
        size,
        formattedSize: formatBlobSize(size),
        isBase64: false, // It's a file reference, not base64
        isTruncated: false, // File refs are never truncated
      };
    }
  }

  // Canonical wire format: "BLOB:<size>:<mime_type>:<base64_data>"
  // Parse by colon positions instead of regex to avoid allocating a copy of
  // the (potentially huge) base64 payload — only the length is needed here.
  if (stringValue.startsWith("BLOB:")) {
    const firstColon = 5; // right after "BLOB:"
    const secondColon = stringValue.indexOf(":", firstColon);
    const thirdColon = stringValue.indexOf(":", secondColon + 1);
    if (secondColon !== -1 && thirdColon !== -1) {
      const size = parseInt(stringValue.substring(firstColon, secondColon), 10);
      const mimeType = stringValue.substring(secondColon + 1, thirdColon);
      const base64Start = thirdColon + 1;
      const base64Length = stringValue.length - base64Start;
      const padding = stringValue.endsWith("==")
        ? 2
        : stringValue.endsWith("=")
          ? 1
          : 0;
      const decodedByteLength = Math.floor((base64Length * 3) / 4) - padding;
      const isTruncated = size > decodedByteLength;

      return {
        mimeType,
        size,
        formattedSize: formatBlobSize(size),
        isBase64: true,
        isTruncated,
      };
    }
  }

  // Plain-text blob (backend returned UTF-8 decoded content directly)
  const size = new Blob([stringValue]).size;

  return {
    mimeType: "text/plain",
    size,
    formattedSize: formatBlobSize(size),
    isBase64: false,
    isTruncated: false,
  };
}

/**
 * Parses a BLOB_FILE_REF wire format string.
 * Expected format: "BLOB_FILE_REF:<size>:<mime>:<filepath>"
 * Returns null if the value is not in this format or is malformed.
 */
export function parseBlobFileRef(
  value: unknown,
): { size: number; mimeType: string; filePath: string } | null {
  const stringValue = String(value ?? "");
  if (!stringValue.startsWith("BLOB_FILE_REF:")) {
    return null;
  }
  const firstColon = 14; // right after "BLOB_FILE_REF:"
  const secondColon = stringValue.indexOf(":", firstColon);
  const thirdColon = stringValue.indexOf(":", secondColon + 1);
  if (secondColon === -1 || thirdColon === -1) {
    return null;
  }
  const size = parseInt(stringValue.substring(firstColon, secondColon), 10);
  const mimeType = stringValue.substring(secondColon + 1, thirdColon);
  const filePath = stringValue.substring(thirdColon + 1);
  return { size, mimeType, filePath };
}

/**
 * Maps a MIME type string to a file extension.
 */
export function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/x-icon": "ico",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/gzip": "gz",
    "application/x-tar": "tar",
    "application/x-7z-compressed": "7z",
    "application/vnd.rar": "rar",
    "application/x-rar-compressed": "rar",
    "application/x-bzip2": "bz2",
    "application/x-xz": "xz",
    "application/json": "json",
    "application/xml": "xml",
    "application/octet-stream": "bin",
    "application/x-sqlite3": "sqlite",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "video/x-matroska": "mkv",
    "video/quicktime": "mov",
    "video/avi": "avi",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "text/plain": "txt",
    "text/html": "html",
    "text/csv": "csv",
    "font/woff": "woff",
    "font/woff2": "woff2",
    "font/ttf": "ttf",
    "font/otf": "otf",
  };
  return (
    map[mimeType] ?? mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") ?? "bin"
  );
}

/**
 * Extracts a data URL for image preview from a BLOB wire format value.
 * Returns null if the value is not an image or not in base64 wire format.
 */
export function extractImageDataUrl(value: unknown): string | null {
  const metadata = extractBlobMetadata(value);
  if (
    !metadata ||
    !metadata.isBase64 ||
    !metadata.mimeType.startsWith("image/") ||
    metadata.isTruncated
  ) {
    return null;
  }
  const stringValue = String(value);
  if (!stringValue.startsWith("BLOB:")) return null;
  const firstColon = 5;
  const secondColon = stringValue.indexOf(":", firstColon);
  const thirdColon = stringValue.indexOf(":", secondColon + 1);
  if (thirdColon === -1) return null;
  const base64Payload = stringValue.substring(thirdColon + 1);
  if (!base64Payload) return null;
  return `data:${metadata.mimeType};base64,${base64Payload}`;
}

/**
 * Extracts the raw base64 payload from a BLOB wire format string.
 * For "BLOB:<size>:<mime>:<base64>" returns the base64 portion.
 * For any other format returns the string value as-is.
 */
export function extractBase64Payload(value: unknown): string {
  const stringValue = String(value ?? "");
  if (!stringValue.startsWith("BLOB:")) {
    return stringValue;
  }
  const firstColon = 5;
  const secondColon = stringValue.indexOf(":", firstColon);
  const thirdColon =
    secondColon !== -1 ? stringValue.indexOf(":", secondColon + 1) : -1;
  if (secondColon === -1 || thirdColon === -1) {
    return stringValue;
  }
  return stringValue.substring(thirdColon + 1);
}

/**
 * Converts a blob payload to raw bytes.
 * If isBase64 is true, decodes from base64; otherwise encodes as UTF-8.
 */
export function blobPayloadToBytes(payload: string, isBase64: boolean): Uint8Array {
  if (isBase64) {
    const binaryString = atob(payload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  return new TextEncoder().encode(payload);
}

const BLOB_INLINE_HEX_LIMIT_BYTES = 10 * 1024;
const BLOB_HEX_PREVIEW_BYTES = 64;

function bytesToHex(bytes: Uint8Array, separator = ""): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join(separator);
}

export function blobValueToEditableHex(value: unknown): string | null {
  const metadata = extractBlobMetadata(value);
  if (
    !metadata ||
    !metadata.isBase64 ||
    metadata.isTruncated ||
    metadata.size > BLOB_INLINE_HEX_LIMIT_BYTES
  ) {
    return null;
  }

  try {
    const payload = extractBase64Payload(value);
    const bytes = blobPayloadToBytes(payload, true);
    return bytesToHex(bytes, " ").toUpperCase();
  } catch {
    return null;
  }
}

export function blobHexToWireFormat(
  hexValue: string,
  mimeType = "application/octet-stream",
): string | null {
  let normalized = hexValue.trim();
  if (normalized.startsWith("0x") || normalized.startsWith("0X")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\s/g, "");

  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(normalized)) {
    return null;
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `BLOB:${bytes.length}:${mimeType}:${btoa(binary)}`;
}

function formatBlobHexPreview(
  value: unknown,
  metadata: BlobMetadata,
): string | null {
  if (
    metadata.mimeType !== "application/octet-stream" ||
    !metadata.isBase64 ||
    metadata.isTruncated ||
    metadata.size > BLOB_INLINE_HEX_LIMIT_BYTES
  ) {
    return null;
  }

  try {
    const payload = extractBase64Payload(value);
    const bytes = blobPayloadToBytes(payload, true);
    const preview = bytes.slice(0, BLOB_HEX_PREVIEW_BYTES);
    const hex = bytesToHex(preview);
    const suffix = bytes.length > BLOB_HEX_PREVIEW_BYTES ? "…" : "";
    return `0x${hex}${suffix}`;
  } catch {
    return null;
  }
}

/**
 * Formats a BLOB value for display in the DataGrid.
 * Small generic binary values use a compact hex preview. Recognized file types
 * and blobs that require fetching retain their MIME type and size metadata.
 */
export function formatBlobValue(value: unknown, dataType: string): string {
  if (!isBlobType(dataType)) {
    return String(value ?? "");
  }

  const metadata = extractBlobMetadata(value);

  if (!metadata) {
    return "NULL";
  }

  return (
    formatBlobHexPreview(value, metadata) ??
    `${metadata.mimeType} (${metadata.formattedSize})`
  );
}
