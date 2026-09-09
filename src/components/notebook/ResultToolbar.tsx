import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Download } from "lucide-react";
import type { QueryResult } from "../../types/editor";
import { resultToCsv, resultToJson } from "../../utils/notebookExport";
import { useAlert } from "../../hooks/useAlert";

interface ResultToolbarProps {
  result: QueryResult;
  executionTime?: number | null;
}

/**
 * Row-count / timing summary plus CSV/JSON export buttons, rendered inside the
 * result section header.
 */
export function ResultToolbar({ result, executionTime }: ResultToolbarProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlert();

  const handleExport = async (format: "csv" | "json") => {
    try {
      const filePath = await save({
        defaultPath: `result.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!filePath) return;
      const content = format === "csv" ? resultToCsv(result) : resultToJson(result);
      await writeTextFile(filePath, content);
      showAlert(t("editor.notebook.resultExportSuccess"), { kind: "info" });
    } catch (e) {
      console.error(`${format.toUpperCase()} export failed:`, e);
      showAlert(t("editor.notebook.exportError"), { kind: "error" });
    }
  };

  return (
    <>
      <span>
        {t("editor.notebook.cellResult", {
          count: result.rows.length,
          time: executionTime != null ? Math.round(executionTime) : "—",
        })}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => handleExport("csv")}
          className="p-1 text-muted hover:text-secondary hover:bg-surface-secondary rounded transition-colors"
          title={t("editor.notebook.exportCsv")}
        >
          <span className="flex items-center gap-0.5">
            <Download size={12} />
            <span className="text-[9px]">CSV</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => handleExport("json")}
          className="p-1 text-muted hover:text-secondary hover:bg-surface-secondary rounded transition-colors"
          title={t("editor.notebook.exportJson")}
        >
          <span className="flex items-center gap-0.5">
            <Download size={12} />
            <span className="text-[9px]">JSON</span>
          </span>
        </button>
      </div>
    </>
  );
}
