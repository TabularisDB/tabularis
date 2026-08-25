import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Upload,
  FileIcon,
  ImageIcon,
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import {
  extractBlobMetadata,
  extractImageDataUrl,
  mimeToExtension,
  parseBlobFileRef,
  parseBlobUploadRef,
  extractBase64Payload,
  blobPayloadToBytes,
  type BlobMetadata,
} from "../../utils/blob";

export interface BlobInputProps {
  value: unknown;
  dataType?: string;
  onChange: (value: unknown) => void;
  placeholder?: string;
  className?: string;
  connectionId?: string | null;
  tableName?: string | null;
  pkMap?: Record<string, unknown> | null;
  colName?: string | null;
  schema?: string | null;
}

function bytesToDataUrl(contents: Uint8Array, mimeType: string): Promise<string> {
  const bytes = new ArrayBuffer(contents.byteLength);
  new Uint8Array(bytes).set(contents);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to create a BLOB preview URL"));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(new Blob([bytes], { type: mimeType }));
  });
}

/**
 * BlobInput component for viewing and editing BLOB data.
 * Shows metadata (MIME type, size) and provides upload/download functionality.
 * For truncated BLOBs, download fetches the full data from the database and
 * saves it via the native OS file dialog.
 */
export const BlobInput = ({
  value,
  dataType,
  onChange,
  placeholder,
  className = "",
  connectionId,
  tableName,
  pkMap,
  colName,
  schema,
}: BlobInputProps) => {
  const { t } = useTranslation();
  const platform = usePlatformCapabilities();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metadata: BlobMetadata | null = extractBlobMetadata(value);
  const hasValue = value !== null && value !== undefined && value !== "";

  const isImage = metadata?.mimeType.startsWith("image/") ?? false;

  const canFetchFull =
    metadata?.isTruncated &&
    connectionId &&
    tableName &&
    pkMap &&
    Object.keys(pkMap).length > 0 &&
    colName;

  // Build a data URL for image preview from the BLOB wire format (non-file-ref, non-truncated)
  const imageDataUrl = useMemo(() => {
    if (!hasValue) return null;
    return extractImageDataUrl(value);
  }, [value, hasValue]);

  const imageReference = useMemo<string | null>(() => {
    const reference = parseBlobFileRef(value) ?? parseBlobUploadRef(value);
    return reference?.mimeType.startsWith("image/") ? String(value) : null;
  }, [value]);

  const [referencePreview, setReferencePreview] = useState<{
    reference: string;
    url: string | null;
  } | null>(null);
  useEffect(() => {
    if (!imageReference) return;
    let cancelled = false;
    platform
      .previewBlobReference(imageReference)
      .then((url) => {
        if (!cancelled) setReferencePreview({ reference: imageReference, url });
      })
      .catch(() => {
        if (!cancelled) setReferencePreview({ reference: imageReference, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [imageReference, platform]);
  const fileRefPreviewUrl =
    referencePreview?.reference === imageReference ? referencePreview.url : null;

  // For truncated images already in the DB, fetch the full blob and build a data: URL.
  // Same approach as handleDownload but in-memory instead of writing to disk.
  const databaseBlobRequest = useMemo(
    () =>
      isImage && canFetchFull && connectionId && tableName && colName && pkMap
        ? {
            connectionId,
            table: tableName,
            colName,
            pkMap,
            ...(schema ? { schema } : {}),
          }
        : null,
    [isImage, canFetchFull, connectionId, tableName, colName, pkMap, schema],
  );
  const databaseBlobKey = databaseBlobRequest
    ? JSON.stringify(databaseBlobRequest)
    : null;
  const [databasePreview, setDatabasePreview] = useState<{
    key: string;
    url: string | null;
  } | null>(null);
  useEffect(() => {
    if (!databaseBlobRequest || !databaseBlobKey) return;
    let cancelled = false;
    platform
      .fetchDatabaseBlob(databaseBlobRequest)
      .then(async ({ contents, mimeType }) => {
        const url = mimeType.startsWith("image/")
          ? await bytesToDataUrl(contents, mimeType)
          : null;
        if (!cancelled) setDatabasePreview({ key: databaseBlobKey, url });
      })
      .catch(() => {
        if (!cancelled) setDatabasePreview({ key: databaseBlobKey, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [databaseBlobKey, databaseBlobRequest, platform]);
  const dbPreviewUrl =
    databasePreview?.key === databaseBlobKey ? databasePreview.url : null;

  const effectiveImageDataUrl =
    imageDataUrl ?? fileRefPreviewUrl ?? dbPreviewUrl;

  const isDownloadDisabled =
    isDownloading || isUploading || (metadata?.isTruncated && !canFetchFull);

  const handleFileUpload = async () => {
    setError(null);
    setIsUploading(true);

    try {
      const reference = await platform.chooseBlob();
      if (reference) onChange(reference);
    } catch (err) {
      console.error("Failed to load file:", err);
      // Extract error message from Tauri error object
      const errorMessage =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : String(err);
      setError(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async () => {
    if (!hasValue || !metadata) return;

    if (metadata.isTruncated && !canFetchFull) return;

    setIsDownloading(true);
    try {
      const extension = mimeToExtension(metadata.mimeType);
      const isReference = Boolean(
        parseBlobFileRef(value) ?? parseBlobUploadRef(value),
      );
      const fetched = metadata.isTruncated && databaseBlobRequest
        ? await platform.fetchDatabaseBlob(databaseBlobRequest)
        : isReference
          ? await platform.fetchBlobReference(value)
          : {
              contents: blobPayloadToBytes(
                extractBase64Payload(value),
                metadata.isBase64,
              ),
              mimeType: metadata.mimeType,
            };
      await platform.downloadFile({
        fileName: `download.${extension}`,
        contents: fetched.contents,
        filters: [{ name: dataType || "BLOB", extensions: [extension] }],
      });
    } catch (error) {
      console.error("Failed to download file:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={className}>
      {hasValue && metadata ? (
        <div className="bg-surface-secondary border border-default rounded-lg overflow-hidden">
          {/* Image preview banner */}
          {effectiveImageDataUrl && (
            <div className="flex items-center justify-center bg-black/20 border-b border-default p-2 max-h-48 overflow-hidden">
              <img
                src={effectiveImageDataUrl}
                alt={t("blobInput.imagePreview")}
                className="max-h-44 max-w-full object-contain rounded"
                draggable={false}
              />
            </div>
          )}

          {/* Main row: icon + info + actions */}
          <div className="flex items-center gap-3 px-3 py-3">
            {/* Icon with background */}
            <div className="p-2 rounded-md bg-surface-tertiary flex-shrink-0">
              {isImage ? (
                <ImageIcon className="text-secondary" size={15} />
              ) : (
                <FileIcon className="text-secondary" size={15} />
              )}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-primary font-mono truncate leading-tight">
                {metadata.mimeType}
              </p>
              <p className="text-xs text-muted mt-0.5">
                {metadata.formattedSize}
                {dataType && (
                  <span className="ml-1.5 opacity-50">· {dataType}</span>
                )}
              </p>
            </div>

            {/* Action icons — visually separated with left border */}
            <div className="flex items-center gap-0.5 border-l border-default pl-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleFileUpload}
                disabled={isUploading}
                title={
                  isUploading
                    ? t("blobInput.uploading")
                    : t("blobInput.uploadFile")
                }
                className="p-1.5 rounded text-muted hover:text-secondary hover:bg-surface-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
              </button>

              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloadDisabled}
                title={
                  isDownloading
                    ? t("blobInput.downloading")
                    : isDownloadDisabled
                      ? t("blobInput.downloadDisabledTruncated")
                      : t("blobInput.download")
                }
                className="p-1.5 rounded text-muted hover:text-secondary hover:bg-surface-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isDownloading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
              </button>

              <div className="w-px h-3 bg-default mx-0.5" />

              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={isUploading}
                title={t("blobInput.delete")}
                className="p-1.5 rounded text-muted hover:text-red-400 hover:bg-red-900/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Truncated warning — footer */}
          {metadata.isTruncated && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/5 border-t border-amber-500/20">
              <AlertTriangle
                size={11}
                className="text-amber-500 flex-shrink-0"
              />
              <span className="text-xs text-amber-500/80">
                {t("blobInput.truncatedWarning")}
              </span>
            </div>
          )}

          {/* Error message footer */}
          {error && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-red-500/5 border-t border-red-500/20">
              <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />
              <span className="text-xs text-red-500/80">{error}</span>
            </div>
          )}
        </div>
      ) : (
        /* Empty state — whole card is clickable to upload */
        <div className="w-full">
          <button
            type="button"
            onClick={handleFileUpload}
            disabled={isUploading}
            className="w-full flex flex-col items-center gap-2.5 px-4 py-6 bg-surface-secondary border border-dashed border-default rounded-lg text-muted hover:text-secondary hover:border-strong hover:bg-surface-tertiary transition-colors disabled:cursor-not-allowed disabled:hover:text-muted disabled:hover:border-default disabled:hover:bg-surface-secondary"
          >
            <div className="p-2.5 rounded-full bg-surface-tertiary">
              {isUploading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Upload size={15} />
              )}
            </div>
            <span className="text-sm">
              {isUploading
                ? t("blobInput.uploading")
                : placeholder || t("blobInput.noData")}
            </span>
          </button>

          {/* Error message for empty state */}
          {error && (
            <div className="mt-2 flex items-start gap-1.5 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded-lg">
              <AlertTriangle
                size={13}
                className="text-red-500 flex-shrink-0 mt-0.5"
              />
              <span className="text-xs text-red-500/90 leading-relaxed">
                {error}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
