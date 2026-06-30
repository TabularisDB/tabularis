import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Download } from "lucide-react";
import type { QueryResult } from "../../types/editor";
import { resultToCsv, resultToJson } from "../../utils/notebookExport";

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

  const handleExportCsv = async () => {
    const filePath = await save({
      defaultPath: "result.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    const csv = resultToCsv(result);
    await writeTextFile(filePath, csv);
  };

  const handleExportJson = async () => {
    const filePath = await save({
      defaultPath: "result.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!filePath) return;
    const json = resultToJson(result);
    await writeTextFile(filePath, json);
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
          onClick={handleExportCsv}
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
          onClick={handleExportJson}
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
