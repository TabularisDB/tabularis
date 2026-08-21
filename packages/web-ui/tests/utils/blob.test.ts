import { describe, it, expect } from "vitest";
import {
  isBlobType,
  extractBlobMetadata,
  extractImageDataUrl,
  formatBlobValue,
  mimeToExtension,
  parseBlobFileRef,
  extractBase64Payload,
  blobPayloadToBytes,
  blobHexToWireFormat,
  blobValueToEditableHex,
} from "../../src/utils/blob";

describe("blob utilities", () => {
  describe("isBlobType", () => {
    it("should identify MySQL BLOB types", () => {
      expect(isBlobType("BLOB")).toBe(true);
      expect(isBlobType("TINYBLOB")).toBe(true);
      expect(isBlobType("MEDIUMBLOB")).toBe(true);
      expect(isBlobType("LONGBLOB")).toBe(true);
    });

    it("should identify MySQL BINARY types", () => {
      expect(isBlobType("BINARY")).toBe(true);
      expect(isBlobType("VARBINARY")).toBe(true);
    });

    it("should identify PostgreSQL BYTEA type", () => {
      expect(isBlobType("BYTEA")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(isBlobType("blob")).toBe(true);
      expect(isBlobType("Blob")).toBe(true);
      expect(isBlobType("BLOB")).toBe(true);
    });

    it("should return false for non-BLOB types", () => {
      expect(isBlobType("VARCHAR")).toBe(false);
      expect(isBlobType("INTEGER")).toBe(false);
      expect(isBlobType("TEXT")).toBe(false);
      expect(isBlobType("GEOMETRY")).toBe(false);
    });

    it("should handle undefined and empty strings", () => {
      expect(isBlobType("")).toBe(false);
      expect(isBlobType(undefined as any)).toBe(false);
    });
  });

  describe("extractBlobMetadata", () => {
    // Helper: build a canonical wire format string as the backend would produce
    function makeBlobWire(
      totalSize: number,
      mimeType: string,
      data: string,
    ): string {
      return `BLOB:${totalSize}:${mimeType}:${data}`;
    }

    it("should extract metadata from the backend wire format (PNG, small blob)", () => {
      const rawData = "\x89PNG\r\n\x1a\n" + "A".repeat(100);
      const b64 = btoa(rawData);
      // The backend encodes raw bytes; compute the decoded byte count from base64
      // to match what the backend would set as <size>
      const decodedByteSize = Math.floor(
        (b64.replace(/=/g, "").length * 3) / 4,
      );
      const wire = makeBlobWire(decodedByteSize, "image/png", b64);
      const metadata = extractBlobMetadata(wire);

      expect(metadata).not.toBeNull();
      expect(metadata?.mimeType).toBe("image/png");
      expect(metadata?.isBase64).toBe(true);
      expect(metadata?.isTruncated).toBe(false);
      expect(metadata?.formattedSize).toContain("B");
    });

    it("should extract metadata from the backend wire format (PDF)", () => {
      const b64 = btoa("%PDF-1.7" + "A".repeat(100));
      const wire = makeBlobWire(b64.length, "application/pdf", b64);
      const metadata = extractBlobMetadata(wire);

      expect(metadata).not.toBeNull();
      expect(metadata?.mimeType).toBe("application/pdf");
    });

    it("should mark large blobs as truncated", () => {
      const previewB64 = btoa("\x89PNG\r\n\x1a\n" + "A".repeat(100));
      // Report 5 MB total but only send a small preview
      const wire = makeBlobWire(5_242_880, "image/png", previewB64);
      const metadata = extractBlobMetadata(wire);

      expect(metadata).not.toBeNull();
      expect(metadata?.size).toBe(5_242_880);
      expect(metadata?.formattedSize).toBe("5.00 MB");
      expect(metadata?.mimeType).toBe("image/png");
      expect(metadata?.isBase64).toBe(true);
      expect(metadata?.isTruncated).toBe(true);
    });

    it("should not mark small blobs as truncated when size matches data", () => {
      const b64 = btoa("hello world");
      const wire = makeBlobWire(11, "text/plain", b64);
      const metadata = extractBlobMetadata(wire);

      expect(metadata?.isTruncated).toBe(false);
    });

    it("should account for base64 padding at the preview boundary", () => {
      const bytes = Array.from({ length: 10_240 }, (_, index) => index % 256);
      const preview = btoa(String.fromCharCode(...bytes));

      expect(
        extractBlobMetadata(
          makeBlobWire(10_240, "application/octet-stream", preview),
        )?.isTruncated,
      ).toBe(false);
      expect(
        extractBlobMetadata(
          makeBlobWire(10_241, "application/octet-stream", preview),
        )?.isTruncated,
      ).toBe(true);
    });

    it("should handle null values", () => {
      expect(extractBlobMetadata(null)).toBeNull();
      expect(extractBlobMetadata(undefined)).toBeNull();
    });

    it("should handle plain-text blobs (UTF-8 decoded by backend)", () => {
      const plainText = "Hello, world!";
      const metadata = extractBlobMetadata(plainText);

      expect(metadata).not.toBeNull();
      expect(metadata?.mimeType).toBe("text/plain");
      expect(metadata?.isBase64).toBe(false);
      expect(metadata?.isTruncated).toBe(false);
    });
  });

  describe("formatBlobValue", () => {
    it("should format BLOB values with metadata", () => {
      const b64 = btoa("\x89PNG\r\n\x1a\n" + "A".repeat(100));
      const wire = `BLOB:${b64.length}:image/png:${b64}`;
      const formatted = formatBlobValue(wire, "BLOB");

      expect(formatted).toContain("image/png");
      expect(formatted).toMatch(/\(.*\)/);
    });

    it("should handle null BLOB values", () => {
      expect(formatBlobValue(null, "BLOB")).toBe("NULL");
      expect(formatBlobValue(undefined, "BLOB")).toBe("NULL");
    });

    it("should return raw value for non-BLOB types", () => {
      expect(formatBlobValue("test", "VARCHAR")).toBe("test");
      expect(formatBlobValue(123, "INTEGER")).toBe("123");
    });

    it("should format small generic binary values as compact hex", () => {
      const b64 = btoa("test");
      const wire = `BLOB:4:application/octet-stream:${b64}`;

      expect(formatBlobValue(wire, "BLOB")).toBe("0x74657374");
      expect(formatBlobValue(wire, "TINYBLOB")).toBe("0x74657374");
      expect(formatBlobValue(wire, "MEDIUMBLOB")).toBe("0x74657374");
      expect(formatBlobValue(wire, "LONGBLOB")).toBe("0x74657374");
    });

    it("should show all 16 bytes of a binary identifier", () => {
      const bytes = Array.from({ length: 16 }, (_, index) => index);
      const b64 = btoa(String.fromCharCode(...bytes));
      const wire = `BLOB:16:application/octet-stream:${b64}`;

      expect(formatBlobValue(wire, "BINARY(16)")).toBe(
        "0x000102030405060708090a0b0c0d0e0f",
      );
    });

    it("should show all 64 preview bytes without an ellipsis", () => {
      const bytes = Array.from({ length: 64 }, (_, index) => index);
      const b64 = btoa(String.fromCharCode(...bytes));
      const wire = `BLOB:64:application/octet-stream:${b64}`;

      const formatted = formatBlobValue(wire, "BLOB");
      expect(formatted).toHaveLength(130);
      expect(formatted.endsWith("…")).toBe(false);
    });

    it("should truncate the grid preview after 64 bytes", () => {
      const bytes = Array.from({ length: 65 }, (_, index) => index);
      const b64 = btoa(String.fromCharCode(...bytes));
      const wire = `BLOB:65:application/octet-stream:${b64}`;

      const formatted = formatBlobValue(wire, "BLOB");
      const expectedHex = bytes
        .slice(0, 64)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(formatted).toBe(`0x${expectedHex}…`);
    });

    it("should keep a 10 KiB generic binary value in hex preview mode", () => {
      const bytes = Array.from({ length: 10_240 }, (_, index) => index % 256);
      const b64 = btoa(String.fromCharCode(...bytes));
      const wire = `BLOB:10240:application/octet-stream:${b64}`;

      expect(formatBlobValue(wire, "BLOB")).toMatch(/^0x[0-9a-f]{128}…$/);
    });

    it("should keep download metadata above the 10 KiB inline limit", () => {
      const preview = String.fromCharCode(
        ...Array.from({ length: 64 }, (_, index) => index),
      );
      const wire = `BLOB:10241:application/octet-stream:${btoa(preview)}`;

      expect(formatBlobValue(wire, "BLOB")).toBe(
        "application/octet-stream (10.00 KB)",
      );
    });

    it("should retain MIME metadata for recognized file types", () => {
      const b64 = btoa("%PDF-1.7");
      const wire = `BLOB:8:application/pdf:${b64}`;

      expect(formatBlobValue(wire, "BLOB")).toBe("application/pdf (8 B)");
    });
  });

  describe("inline hex editing", () => {
    it("should convert a complete generic BLOB to editable uppercase hex", () => {
      const wire = `BLOB:4:application/octet-stream:${btoa("test")}`;

      expect(blobValueToEditableHex(wire)).toBe("74 65 73 74");
    });

    it("should edit recognized BLOBs while preserving their bytes", () => {
      expect(
        blobValueToEditableHex(`BLOB:4:application/pdf:${btoa("test")}`),
      ).toBe("74 65 73 74");
    });

    it("should reject truncated BLOBs for inline editing", () => {
      expect(
        blobValueToEditableHex(
          `BLOB:10241:application/octet-stream:${btoa("preview")}`,
        ),
      ).toBeNull();
    });

    it("should encode edited hex in the existing BLOB wire format", () => {
      const wire = blobHexToWireFormat("0x00 A5 ff");

      expect(wire).toBe("BLOB:3:application/octet-stream:AKX/");
      expect(blobHexToWireFormat("00 A5 ff", "application/pdf")).toBe(
        "BLOB:3:application/pdf:AKX/",
      );
    });

    it("should support an empty binary value", () => {
      expect(blobHexToWireFormat("")).toBe(
        "BLOB:0:application/octet-stream:",
      );
    });

    it("should reject odd-length and non-hex input", () => {
      expect(blobHexToWireFormat("ABC")).toBeNull();
      expect(blobHexToWireFormat("GG")).toBeNull();
    });
  });

  describe("extractImageDataUrl", () => {
    function makeBlobWire(
      totalSize: number,
      mimeType: string,
      data: string,
    ): string {
      return `BLOB:${totalSize}:${mimeType}:${data}`;
    }

    it("should return a data URL for image blobs", () => {
      const raw = "fake-png-data";
      const b64 = btoa(raw);
      const wire = makeBlobWire(raw.length, "image/png", b64);
      const dataUrl = extractImageDataUrl(wire);

      expect(dataUrl).not.toBeNull();
      expect(dataUrl).toBe(`data:image/png;base64,${b64}`);
    });

    it("should return null for non-image blobs", () => {
      const raw = "pdf-data";
      const b64 = btoa(raw);
      const wire = makeBlobWire(raw.length, "application/pdf", b64);

      expect(extractImageDataUrl(wire)).toBeNull();
    });

    it("should return null for null/undefined values", () => {
      expect(extractImageDataUrl(null)).toBeNull();
      expect(extractImageDataUrl(undefined)).toBeNull();
    });

    it("should return null for plain text (non-wire-format) values", () => {
      expect(extractImageDataUrl("just a string")).toBeNull();
    });

    it("should return null for truncated image blobs (file ref)", () => {
      const wire = "BLOB_FILE_REF:5242880:image/png:/tmp/blob.png";
      expect(extractImageDataUrl(wire)).toBeNull();
    });

    it("should return null for truncated BLOB wire format images", () => {
      // totalSize (5 MB) >> decoded base64 bytes → isTruncated = true
      const previewB64 = btoa("partial-image-data");
      const wire = makeBlobWire(5_242_880, "image/png", previewB64);
      expect(extractImageDataUrl(wire)).toBeNull();
    });

    it("should work with various image MIME types", () => {
      const types = ["image/jpeg", "image/gif", "image/webp", "image/bmp"];
      for (const mime of types) {
        const raw = "test";
        const b64 = btoa(raw);
        const wire = makeBlobWire(raw.length, mime, b64);
        const dataUrl = extractImageDataUrl(wire);
        expect(dataUrl).toBe(`data:${mime};base64,${b64}`);
      }
    });
  });

  describe("parseBlobFileRef", () => {
    it("should parse a valid BLOB_FILE_REF string", () => {
      const wire = "BLOB_FILE_REF:1024:image/png:/path/to/file.png";
      const result = parseBlobFileRef(wire);
      expect(result).not.toBeNull();
      expect(result?.size).toBe(1024);
      expect(result?.mimeType).toBe("image/png");
      expect(result?.filePath).toBe("/path/to/file.png");
    });

    it("should handle file paths containing colons (e.g. Windows paths)", () => {
      const wire = "BLOB_FILE_REF:512:image/jpeg:C:/Users/test/photo.jpg";
      const result = parseBlobFileRef(wire);
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("image/jpeg");
      expect(result?.filePath).toBe("C:/Users/test/photo.jpg");
    });

    it("should return null for non-file-ref strings", () => {
      const b64 = btoa("data");
      expect(parseBlobFileRef(`BLOB:4:image/png:${b64}`)).toBeNull();
      expect(parseBlobFileRef("hello world")).toBeNull();
      expect(parseBlobFileRef("")).toBeNull();
    });

    it("should return null for malformed file ref strings", () => {
      expect(parseBlobFileRef("BLOB_FILE_REF:missing-colons")).toBeNull();
    });

    it("should return null for null and undefined", () => {
      expect(parseBlobFileRef(null)).toBeNull();
      expect(parseBlobFileRef(undefined)).toBeNull();
    });
  });

  describe("extractBase64Payload", () => {
    it("should extract the base64 portion from a BLOB wire format string", () => {
      const b64 = btoa("hello world");
      const wire = `BLOB:11:text/plain:${b64}`;
      expect(extractBase64Payload(wire)).toBe(b64);
    });

    it("should return the string as-is for non-BLOB wire formats", () => {
      expect(extractBase64Payload("plain text")).toBe("plain text");
      expect(extractBase64Payload("BLOB_FILE_REF:1:image/png:/path")).toBe(
        "BLOB_FILE_REF:1:image/png:/path",
      );
    });

    it("should return the string as-is for malformed BLOB format", () => {
      expect(extractBase64Payload("BLOB:malformed")).toBe("BLOB:malformed");
    });

    it("should return an empty string for null and undefined", () => {
      expect(extractBase64Payload(null)).toBe("");
      expect(extractBase64Payload(undefined)).toBe("");
    });
  });

  describe("blobPayloadToBytes", () => {
    it("should decode a base64 payload to the original bytes", () => {
      const original = "hello world";
      const b64 = btoa(original);
      const bytes = blobPayloadToBytes(b64, true);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(bytes)).toBe(original);
    });

    it("should encode a plain-text payload as UTF-8 bytes", () => {
      const text = "hello world";
      const bytes = blobPayloadToBytes(text, false);
      expect(new TextDecoder().decode(bytes)).toBe(text);
    });

    it("should handle an empty payload", () => {
      expect(Array.from(blobPayloadToBytes("", true))).toEqual([]);
      expect(Array.from(blobPayloadToBytes("", false))).toEqual([]);
    });

    it("should correctly roundtrip through extractBase64Payload", () => {
      const original = "binary-like data \x00\x01\x02";
      const b64 = btoa(original);
      const wire = `BLOB:${original.length}:application/octet-stream:${b64}`;
      const payload = extractBase64Payload(wire);
      const bytes = blobPayloadToBytes(payload, true);
      expect(new TextDecoder("latin1").decode(bytes)).toBe(original);
    });
  });

  describe("mimeToExtension", () => {
    it("should map common image types", () => {
      expect(mimeToExtension("image/png")).toBe("png");
      expect(mimeToExtension("image/jpeg")).toBe("jpg");
      expect(mimeToExtension("image/gif")).toBe("gif");
      expect(mimeToExtension("image/webp")).toBe("webp");
      expect(mimeToExtension("image/x-icon")).toBe("ico");
    });

    it("should map document types", () => {
      expect(mimeToExtension("application/pdf")).toBe("pdf");
      expect(mimeToExtension("application/msword")).toBe("doc");
      expect(
        mimeToExtension(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toBe("docx");
    });

    it("should map archive types", () => {
      expect(mimeToExtension("application/zip")).toBe("zip");
      expect(mimeToExtension("application/gzip")).toBe("gz");
      expect(mimeToExtension("application/x-7z-compressed")).toBe("7z");
      expect(mimeToExtension("application/vnd.rar")).toBe("rar");
      expect(mimeToExtension("application/x-bzip2")).toBe("bz2");
      expect(mimeToExtension("application/x-xz")).toBe("xz");
    });

    it("should map audio/video types", () => {
      expect(mimeToExtension("video/mp4")).toBe("mp4");
      expect(mimeToExtension("video/webm")).toBe("webm");
      expect(mimeToExtension("video/quicktime")).toBe("mov");
      expect(mimeToExtension("video/avi")).toBe("avi");
      expect(mimeToExtension("audio/mpeg")).toBe("mp3");
      expect(mimeToExtension("audio/mp4")).toBe("m4a");
      expect(mimeToExtension("audio/flac")).toBe("flac");
    });

    it("should fall back gracefully for unknown types", () => {
      expect(mimeToExtension("application/octet-stream")).toBe("bin");
      expect(mimeToExtension("image/avif")).toBe("avif");
      // Unknown type falls back to subtype
      expect(mimeToExtension("text/something-custom")).toBe("somethingcustom");
    });
  });
});
