import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import type { QueryResult } from "../../types/editor";
import { resultToCsv, resultToJson } from "../../utils/notebookExport";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import { downloadTextFile } from "../../utils/fileDownloads";

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
  const platform = usePlatformCapabilities();

  const handleExportCsv = () =>
    downloadTextFile(platform, {
      fileName: "result.csv",
      contents: resultToCsv(result),
      mimeType: "text/csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });

  const handleExportJson = () =>
    downloadTextFile(platform, {
      fileName: "result.json",
      contents: resultToJson(result),
      mimeType: "application/json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

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
