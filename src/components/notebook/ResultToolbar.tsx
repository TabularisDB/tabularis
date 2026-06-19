import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Download, BarChart3, X } from "lucide-react";
import type { QueryResult } from "../../types/editor";
import { resultToCsv, resultToJson } from "../../utils/notebookExport";

interface ResultToolbarProps {
  result: QueryResult;
  executionTime?: number | null;
  showChart: boolean;
  onToggleChart: () => void;
  canChart: boolean;
}

export function ResultToolbar({
  result,
  executionTime,
  showChart,
  onToggleChart,
  canChart,
}: ResultToolbarProps) {
  const { t } = useLingui();

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
    <div className="px-3 py-1 bg-elevated text-xs text-muted flex items-center gap-2">
      <span>
        {plural(result.rows.length, {
          one: `# row · ${executionTime != null ? Math.round(executionTime) : "—"}ms`,
          other: `# rows · ${executionTime != null ? Math.round(executionTime) : "—"}ms`,
        })}
      </span>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5">
        {canChart && (
          <button
            type="button"
            onClick={onToggleChart}
            className={`p-1 rounded transition-colors ${
              showChart
                ? "text-blue-400 bg-blue-500/15"
                : "text-muted hover:text-secondary hover:bg-surface-secondary"
            }`}
            title={t`Toggle Chart`}
          >
            {showChart ? <X size={12} /> : <BarChart3 size={12} />}
          </button>
        )}
        <button
          type="button"
          onClick={handleExportCsv}
          className="p-1 text-muted hover:text-secondary hover:bg-surface-secondary rounded transition-colors"
          title={t`Export as CSV`}
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
          title={t`Export as JSON`}
        >
          <span className="flex items-center gap-0.5">
            <Download size={12} />
            <span className="text-[9px]">JSON</span>
          </span>
        </button>
      </div>
    </div>
  );
}
