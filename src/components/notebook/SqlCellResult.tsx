import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DataGrid } from "../ui/DataGrid";
import { ErrorDisplay } from "../ui/ErrorDisplay";
import type { QueryResult } from "../../types/editor";
import type { CellChartConfig } from "../../types/notebook";
import { canRenderChart, buildDefaultChartConfig } from "../../utils/notebookChart";
import { ResultToolbar } from "./ResultToolbar";
import { ResizeHandle } from "./ResizeHandle";
import { CellChart } from "./CellChart";

interface SqlCellResultProps {
  result: QueryResult | null;
  error?: string;
  executionTime?: number | null;
  isLoading?: boolean;
  chartConfig?: CellChartConfig | null;
  onChartConfigChange?: (config: CellChartConfig | null) => void;
  resultHeight?: number;
  onResultHeightChange?: (height: number) => void;
}

export function SqlCellResult({
  result,
  error,
  executionTime,
  isLoading,
  chartConfig,
  onChartConfigChange,
  resultHeight,
  onResultHeightChange,
}: SqlCellResultProps) {
  const { t } = useTranslation();
  const [showChart, setShowChart] = useState(!!chartConfig);
  const height = resultHeight ?? 300;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-4">
        <div className="w-4 h-4 border-2 border-surface-secondary border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs text-muted">{t("editor.executingQuery")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-h-[120px] overflow-auto">
        <ErrorDisplay error={error} t={t} />
      </div>
    );
  }

  if (!result) return null;

  const chartCapable = canRenderChart(result);

  const handleToggleChart = () => {
    if (!showChart && !chartConfig && chartCapable) {
      const defaultConfig = buildDefaultChartConfig(result);
      if (defaultConfig && onChartConfigChange) {
        onChartConfigChange(defaultConfig);
      }
    }
    setShowChart((v) => !v);
  };

  return (
    <div className="border-t border-default">
      <ResultToolbar
        result={result}
        executionTime={executionTime}
        showChart={showChart}
        onToggleChart={handleToggleChart}
        canChart={chartCapable}
      />
      <div style={{ height }} className="overflow-hidden">
        <DataGrid
          columns={result.columns}
          data={result.rows}
          tableName={null}
          pkColumns={null}
          readonly
        />
      </div>
      <ResizeHandle
        onResize={(h) => onResultHeightChange?.(h)}
        minHeight={100}
        maxHeight={800}
      />
      {showChart && chartConfig && onChartConfigChange && (
        <CellChart
          result={result}
          config={chartConfig}
          onConfigChange={onChartConfigChange}
        />
      )}
    </div>
  );
}
