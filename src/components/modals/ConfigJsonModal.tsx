import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FileJson, X, Loader2, RotateCcw } from "lucide-react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { loadMonacoTheme } from "../../themes/themeUtils";
import { Modal } from "../ui/Modal";
import { ConfirmModal } from "./ConfirmModal";

interface ConfigJsonModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConfigJsonModal = ({ isOpen, onClose }: ConfigJsonModalProps) => {
  const { t } = useTranslation();
  const editorTheme = useEditorTheme();
  const [jsonValue, setJsonValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setError(null);
    invoke<string>("get_config_json")
      .then((json) => setJsonValue(json))
      .catch((e) => setError(String(e)))
      .finally(() => setIsLoading(false));
  }, [isOpen]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    loadMonacoTheme(editorTheme, monaco);
  };

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    try {
      await invoke("save_config_json", { json: jsonValue });
      setShowRestartConfirm(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestartNow = () => {
    invoke("relaunch_app");
  };

  const handleRestartLater = () => {
    setShowRestartConfirm(false);
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose}>
        <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-default bg-base">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-900/30 rounded-lg">
                <FileJson size={20} className="text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-primary">
                  {t("settings.configJsonModal.title")}
                </h2>
                <p className="text-xs text-secondary">
                  {t("settings.editConfigJsonDesc")}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-secondary hover:text-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted">
                <Loader2 size={24} className="animate-spin mr-2" />
                {t("common.loading")}
              </div>
            ) : (
              <div className="flex-1 min-h-0" style={{ height: "500px" }}>
                <MonacoEditor
                  height="500px"
                  defaultLanguage="json"
                  theme={editorTheme.id}
                  value={jsonValue}
                  onChange={(val) => {
                    setJsonValue(val ?? "");
                    setError(null);
                  }}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    padding: { top: 12, bottom: 12 },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "on",
                    formatOnPaste: true,
                    tabSize: 2,
                  }}
                />
              </div>
            )}

            {error && (
              <div className="px-4 py-2 bg-red-900/20 border-t border-red-900/40 text-sm text-red-400">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-default bg-base/50 flex items-center justify-between gap-3">
            <p className="text-xs text-muted flex items-center gap-1.5">
              <RotateCcw size={12} />
              {t("settings.configJsonModal.restartRequired")}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || isLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {isSaving && <Loader2 size={14} className="animate-spin" />}
                {t("settings.configJsonModal.saveAndRestart")}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={showRestartConfirm}
        onClose={handleRestartLater}
        title={t("settings.configJsonModal.restartRequired")}
        message={t("settings.configJsonModal.restartMessage")}
        confirmLabel={t("settings.configJsonModal.restartNow")}
        confirmClassName="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        onConfirm={handleRestartNow}
      />
    </>
  );
};
