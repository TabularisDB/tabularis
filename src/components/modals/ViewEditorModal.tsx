import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Eye, AlertCircle, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../../hooks/useAlert";
import { SqlEditorWrapper } from "../ui/SqlEditorWrapper";
import { useDatabase } from "../../hooks/useDatabase";
import { Modal } from "../ui/Modal";

interface ViewEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  viewName?: string;
  isNewView?: boolean;
  onSuccess?: () => void;
}

export const ViewEditorModal = ({
  isOpen,
  onClose,
  connectionId,
  viewName,
  isNewView = false,
  onSuccess,
}: ViewEditorModalProps) => {
  const { t } = useTranslation();
  const { activeSchema } = useDatabase();
  const { showAlert } = useAlert();
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState("");
  const [originalDefinition, setOriginalDefinition] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<{
    columns: string[];
    rows: unknown[][];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadViewDefinition = useCallback(async (vName: string) => {
    setLoading(true);
    setError(null);
    try {
      const def = await invoke<string>("get_view_definition", {
        connectionId,
        viewName: vName,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });
      // Extract just the SELECT part for editing
      let selectPart = def;
      if (def.toUpperCase().includes(" AS ")) {
        const asIndex = def.toUpperCase().indexOf(" AS ");
        selectPart = def.substring(asIndex + 4).trim();
      }
      setDefinition(selectPart);
      setOriginalDefinition(selectPart);
    } catch (e) {
      setError(t("views.failLoadDefinition") + String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, t, activeSchema]);

  useEffect(() => {
    if (isOpen) {
      if (isNewView) {
        setName("");
        setDefinition("SELECT * FROM ");
        setOriginalDefinition("");
        setError(null);
        setPreviewResult(null);
      } else if (viewName) {
        setName(viewName);
        loadViewDefinition(viewName);
      }
    }
  }, [isOpen, viewName, isNewView, loadViewDefinition]);

  const handlePreview = async () => {
    if (!definition.trim()) return;

    setPreviewLoading(true);
    setError(null);
    try {
      const result = await invoke<{
        columns: string[];
        rows: unknown[][];
        affected_rows: number;
      }>("execute_query", {
        connectionId,
        query: definition,
        limit: 10,
        page: 1,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });
      setPreviewResult({
        columns: result.columns,
        rows: result.rows,
      });
    } catch (e) {
      setError(t("views.previewError") + String(e));
      setPreviewResult(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showAlert(t("views.nameRequired"), { kind: "error" });
      return;
    }

    if (!definition.trim()) {
      showAlert(t("views.definitionRequired"), { kind: "error" });
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isNewView) {
        await invoke("create_view", {
          connectionId,
          viewName: name,
          definition,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });
        showAlert(t("views.createSuccess"), { kind: "info" });
      } else {
        // Check if definition changed
        if (definition !== originalDefinition) {
          const confirmed = await ask(
            t("views.confirmAlter", { view: name }),
            { title: t("views.alterView"), kind: "warning" }
          );
          if (!confirmed) {
            setSaving(false);
            return;
          }
        }

        await invoke("alter_view", {
          connectionId,
          viewName: name,
          definition,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });
        showAlert(t("views.alterSuccess"), { kind: "info" });
      }

      onSuccess?.();
      onClose();
    } catch (e) {
      setError(t("views.saveError") + String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[800px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-900/30 rounded-lg">
              <Eye size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {isNewView ? t("views.createView") : t("views.editView")}
              </h2>
              <p className="text-xs text-secondary">
                {isNewView
                  ? t("views.createSubtitle")
                  : t("views.editSubtitle", { name })}
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
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-400 px-4 py-3 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="text-sm">{error}</div>
            </div>
          )}

          {/* View Name */}
          <div>
            <label htmlFor="view-name" className="text-xs uppercase font-bold text-muted mb-1 block">
              {t("views.viewName")}
            </label>
            <input
              id="view-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isNewView || loading}
              className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary focus:border-blue-500 focus:outline-none disabled:opacity-50"
              placeholder={t("views.viewNamePlaceholder")}
              autoFocus={isNewView}
            />
          </div>

          {/* View Definition */}
          <div>
            <label className="text-xs uppercase font-bold text-muted mb-1 block">
              {t("views.viewDefinition")}
            </label>
            <div className="border border-strong rounded-lg overflow-hidden h-48">
              <SqlEditorWrapper
                initialValue={definition}
                onChange={setDefinition}
                onRun={handlePreview}
                height="100%"
                options={{
                  readOnly: loading,
                }}
              />
            </div>
          </div>

          {/* Preview Section */}
          <div className="border border-default rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-3 bg-base border-b border-default">
              <span className="text-sm font-medium text-primary">
                {t("views.preview")}
              </span>
              <button
                onClick={handlePreview}
                disabled={previewLoading || !definition.trim()}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {previewLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                {t("views.runPreview")}
              </button>
            </div>

            {previewResult && (
              <div className="max-h-48 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-secondary sticky top-0">
                    <tr>
                      {previewResult.columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left text-muted font-medium border-b border-default"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewResult.rows.slice(0, 5).map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-default/50 hover:bg-surface-secondary/50"
                      >
                        {row.map((cell, cellIdx) => (
                          <td
                            key={cellIdx}
                            className="px-3 py-2 text-secondary truncate max-w-[150px]"
                          >
                            {cell === null
                              ? "NULL"
                              : String(cell).substring(0, 50)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewResult.rows.length > 5 && (
                  <div className="p-2 text-center text-xs text-muted">
                    {t("views.moreRows", { count: previewResult.rows.length - 5 })}
                  </div>
                )}
              </div>
            )}

            {!previewResult && !previewLoading && (
              <div className="p-8 text-center text-muted text-sm">
                {t("views.previewEmpty")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading || !name.trim() || !definition.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {isNewView ? t("views.create") : t("views.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
};
