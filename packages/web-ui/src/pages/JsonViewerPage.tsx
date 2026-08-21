import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { JsonInput } from "../components/ui/JsonInput";

interface SessionDto {
  value: unknown;
  original_value: unknown;
  col_name: string;
  read_only: boolean;
}

export const JsonViewerPage = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";

  const [session, setSession] = useState<SessionDto | null>(null);
  const [currentValue, setCurrentValue] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    invoke<SessionDto>("get_json_viewer_session", { sessionId })
      .then((data) => {
        setSession(data);
        setCurrentValue(data.value);
      })
      .catch((e) => setError(String(e)));
  }, [sessionId]);

  const handleClose = useCallback(async () => {
    await getCurrentWindow().close();
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await invoke("complete_json_viewer_session", {
        sessionId,
        value: currentValue,
      });
    } catch (e) {
      setError(String(e));
      return;
    }
    await getCurrentWindow().close();
  }, [sessionId, currentValue]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const showSave = session && !session.read_only;
  const displayError = error ?? (!sessionId ? "No session ID provided" : null);

  return (
    <div className="w-screen h-screen flex flex-col bg-base text-primary">
      <div className="flex-1 min-h-0 p-4">
        {displayError ? (
          <p className="text-red-400 text-sm">{displayError}</p>
        ) : session ? (
          <JsonInput
            value={currentValue}
            originalValue={session.original_value}
            onChange={setCurrentValue}
            readOnly={session.read_only}
            className="h-full"
            disableExpand
            fillHeight
          />
        ) : (
          <p className="text-muted text-sm">{t("common.loading")}</p>
        )}
      </div>

      <div className="p-4 border-t border-default bg-elevated/50 flex justify-end gap-3 shrink-0">
        {showSave ? (
          <>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {t("jsonViewer.save")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("jsonViewer.close")}
          </button>
        )}
      </div>
    </div>
  );
};
