import { useTranslation } from "react-i18next";
import { DataGrid } from "../ui/DataGrid";
import { ErrorDisplay } from "../ui/ErrorDisplay";
import type { QueryResult } from "../../types/editor";
import type { CellChartConfig } from "../../types/notebook";
import { canRenderChart, buildDefaultChartConfig } from "../../utils/notebookChart";
import { ResultToolbar } from "./ResultToolbar";
import { ResizeHandle } from "./ResizeHandle";
import { CellChart } from "./CellChart";
import { CellSectionHeader } from "./CellSectionHeader";

interface SqlCellResultProps {
  result: QueryResult | null;
  error?: string;
  executionTime?: number | null;
  isLoading?: boolean;
  chartConfig?: CellChartConfig | null;
  onChartConfigChange?: (config: CellChartConfig | null) => void;
  resultHeight?: number;
  onResultHeightChange?: (height: number) => void;
  isResultCollapsed?: boolean;
  onToggleResultCollapse: () => void;
  isChartVisible?: boolean;
  onToggleChartVisible: (visible: boolean) => void;
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
  isResultCollapsed,
  onToggleResultCollapse,
  isChartVisible,
  onToggleChartVisible,
}: SqlCellResultProps) {
  const { t } = useTranslation();
  const height = resultHeight ?? 300;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-4 border-t border-default">
        <div className="w-4 h-4 border-2 border-surface-secondary border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs text-muted">{t("editor.executingQuery")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-h-[120px] overflow-auto border-t border-default">
        <ErrorDisplay error={error} t={t} />
      </div>
    );
  }

  if (!result) return null;

  const chartCapable = canRenderChart(result);
  // Charts default to visible when a config was previously saved, preserving
  // the behaviour from before per-section visibility was persisted.
  const chartVisible = isChartVisible ?? !!chartConfig;

  const handleToggleChart = () => {
    const next = !chartVisible;
    if (next && !chartConfig && chartCapable) {
      const defaultConfig = buildDefaultChartConfig(result);
      if (defaultConfig && onChartConfigChange) {
        onChartConfigChange(defaultConfig);
      }
    }
    onToggleChartVisible(next);
  };

  return (
    <>
      <CellSectionHeader
        label={t("editor.notebook.sectionResults")}
        collapsed={!!isResultCollapsed}
        onToggle={onToggleResultCollapse}
      >
        <ResultToolbar result={result} executionTime={executionTime} />
      </CellSectionHeader>
      {!isResultCollapsed && (
        <>
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
        </>
      )}

      {chartCapable && (
        <CellSectionHeader
          label={t("editor.notebook.sectionChart")}
          collapsed={!chartVisible}
          onToggle={handleToggleChart}
        />
      )}
      {chartCapable && chartVisible && chartConfig && onChartConfigChange && (
        <CellChart
          result={result}
          config={chartConfig}
          onConfigChange={onChartConfigChange}
        />
      )}
    </>
  );
}
