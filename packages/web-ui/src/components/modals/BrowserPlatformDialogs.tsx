import { useCallback, useEffect, useMemo, useState } from "react";
import { File, Folder, FolderOpen, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerDirectoryListing, ServerPathEntry } from "../../api/contract";
import { useAlert } from "../../hooks/useAlert";
import { useTabularisClient } from "../../hooks/useTabularisClient";
import {
  subscribeBrowserMessageRequests,
  subscribeBrowserServerPathRequests,
  type BrowserServerPathRequest,
} from "../../platform/browserDialogs";
import { toErrorMessage } from "../../utils/errors";

export function BrowserPlatformDialogs() {
  const { t } = useTranslation();
  const client = useTabularisClient();
  const { showAlert } = useAlert();
  const [request, setRequest] = useState<BrowserServerPathRequest | null>(null);
  const [listing, setListing] = useState<ServerDirectoryListing | null>(null);
  const [selected, setSelected] = useState<ServerPathEntry | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      setSelected(null);
      try {
        setListing(
          await client.call("list_server_directory", path ? { path } : {}),
        );
      } catch (loadError) {
        setError(toErrorMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  const openRequest = useCallback(
    (nextRequest: BrowserServerPathRequest) => {
      setRequest(nextRequest);
      setListing(null);
      setSelected(null);
      setFileName(
        nextRequest.options.mode === "save"
          ? (nextRequest.options.suggestedName?.split(/[\\/]/).at(-1) ?? "")
          : "",
      );
      setError(null);
      void loadDirectory();
    },
    [loadDirectory],
  );

  useEffect(
    () => subscribeBrowserServerPathRequests(openRequest),
    [openRequest],
  );

  useEffect(
    () =>
      subscribeBrowserMessageRequests(({ request: message, resolve }) => {
        showAlert(message.message, {
          title: message.title,
          kind: message.kind ?? "info",
          onClose: resolve,
        });
      }),
    [showAlert],
  );

  const visibleEntries = useMemo(() => {
    if (!request || !listing) return [];
    const extensions = request.options.filters
      ?.flatMap((filter) => filter.extensions)
      .map((extension) => extension.toLowerCase());
    return listing.entries.filter((entry) => {
      if (entry.kind === "directory" || !extensions?.length) return true;
      const extension = entry.name.split(".").at(-1)?.toLowerCase();
      return extension ? extensions.includes(extension) : false;
    });
  }, [listing, request]);

  const close = useCallback(() => {
    request?.resolve(null);
    setRequest(null);
  }, [request]);

  const choose = useCallback(async () => {
    if (!request) return;
    if (request.options.mode === "save") {
      const directory =
        selected?.kind === "directory" ? selected.path : listing?.path;
      if (!directory || !fileName.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const result = await client.call("resolve_server_save_target", {
          directory,
          fileName: fileName.trim(),
        });
        request.resolve({ reference: result.path });
        setRequest(null);
      } catch (saveError) {
        setError(toErrorMessage(saveError));
      } finally {
        setLoading(false);
      }
      return;
    }
    const path =
      request.options.kind === "directory"
        ? selected?.kind === "directory"
          ? selected.path
          : listing?.path
        : selected?.kind === "file"
          ? selected.path
          : null;
    if (!path) return;
    request.resolve({ reference: path });
    setRequest(null);
  }, [client, fileName, listing, request, selected]);

  const handleEntryDoubleClick = useCallback(
    (entry: ServerPathEntry) => {
      if (entry.kind === "directory") {
        void loadDirectory(entry.path);
        return;
      }
      if (
        request?.options.mode === "open" &&
        request.options.kind === "file"
      ) {
        request.resolve({ reference: entry.path });
        setRequest(null);
      }
    },
    [loadDirectory, request],
  );

  useEffect(() => {
    if (!request) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, request]);

  if (!request) return null;

  const canChoose =
    request.options.mode === "save"
      ? Boolean(fileName.trim()) &&
        (selected?.kind === "directory" || Boolean(listing?.path))
      : request.options.kind === "directory"
        ? selected?.kind === "directory" || Boolean(listing?.path)
        : selected?.kind === "file";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-[700px] flex-col overflow-hidden rounded-xl border border-strong bg-elevated shadow-2xl">
        <div className="flex items-center justify-between border-b border-default bg-base p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-900/30 p-2">
              <FolderOpen size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {request.options.title ?? t("serverFilePicker.title")}
              </h2>
              <p className="text-xs text-secondary">
                {t("serverFilePicker.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            className="text-secondary transition-colors hover:text-primary"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex min-h-[380px] flex-col gap-3 overflow-hidden p-6">
          <div className="flex items-center gap-2 rounded-lg border border-strong bg-base px-3 py-2 font-mono text-xs text-secondary">
            <button
              type="button"
              disabled={!listing || (listing.path === null && !listing.parent)}
              onClick={() => void loadDirectory(listing?.parent ?? undefined)}
              className="font-sans text-blue-400 transition-colors hover:text-blue-300 disabled:text-muted"
            >
              {t("common.back")}
            </button>
            <span className="truncate">{listing?.path ?? t("serverFilePicker.roots")}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-default bg-base">
            {loading ? (
              <div className="flex h-full min-h-64 items-center justify-center text-muted">
                <Loader2 size={24} className="mr-2 animate-spin" />
                {t("common.loading")}
              </div>
            ) : error ? (
              <div className="p-4 text-sm text-red-400">{error}</div>
            ) : visibleEntries.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted">
                {t("serverFilePicker.empty")}
              </div>
            ) : (
              visibleEntries.map((entry) => {
                const isSelected = selected?.path === entry.path;
                return (
                  <button
                    type="button"
                    key={entry.path}
                    onClick={() => setSelected(entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    className={`flex w-full items-center gap-3 border-b border-default px-3 py-2 text-left text-sm transition-colors last:border-b-0 ${
                      isSelected
                        ? "bg-blue-900/30 text-primary"
                        : "text-secondary hover:bg-surface-secondary hover:text-primary"
                    }`}
                  >
                    {entry.kind === "directory" ? (
                      <Folder size={17} className="shrink-0 text-blue-400" />
                    ) : (
                      <File size={17} className="shrink-0 text-muted" />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </button>
                );
              })
            )}
          </div>

          {request.options.mode === "save" && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-muted">
                {t("serverFilePicker.fileName")}
              </label>
              <input
                type="text"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                autoFocus
                className="w-full rounded-lg border border-strong bg-base px-3 py-2 text-primary focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-default bg-base/50 p-4">
          <button
            type="button"
            onClick={close}
            className="px-4 py-2 text-sm text-secondary transition-colors hover:text-primary"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void choose()}
            disabled={!canChoose || loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("serverFilePicker.select")}
          </button>
        </div>
      </div>
    </div>
  );
}
