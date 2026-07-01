import type { NotebookCell } from "../../types/notebook";
import type { CellChartConfig } from "../../types/notebook";
import { SqlCellEditor } from "./SqlCellEditor";
import { SqlCellResult } from "./SqlCellResult";

interface SqlCellProps {
  cell: NotebookCell;
  onContentChange: (content: string) => void;
  onRun: () => void;
  onChartConfigChange?: (config: CellChartConfig | null) => void;
  onResultHeightChange?: (height: number) => void;
  onToggleQueryCollapse: () => void;
  onToggleResultCollapse: () => void;
  onToggleChartVisible: (visible: boolean) => void;
  connectionId: string;
  schema?: string;
}

export function SqlCell({
  cell,
  onContentChange,
  onRun,
  onChartConfigChange,
  onResultHeightChange,
  onToggleQueryCollapse,
  onToggleResultCollapse,
  onToggleChartVisible,
  connectionId,
  schema,
}: SqlCellProps) {
  return (
    <div>
      <SqlCellEditor
        cellId={cell.id}
        content={cell.content}
        onContentChange={onContentChange}
        onRun={onRun}
        connectionId={connectionId}
        schema={schema}
        collapsed={cell.isQueryCollapsed}
        onToggleCollapse={onToggleQueryCollapse}
      />
      <SqlCellResult
        result={cell.result ?? null}
        error={cell.error}
        executionTime={cell.executionTime}
        isLoading={cell.isLoading}
        chartConfig={cell.chartConfig}
        onChartConfigChange={onChartConfigChange}
        resultHeight={cell.resultHeight}
        onResultHeightChange={onResultHeightChange}
        isResultCollapsed={cell.isResultCollapsed}
        onToggleResultCollapse={onToggleResultCollapse}
        isChartVisible={cell.isChartVisible}
        onToggleChartVisible={onToggleChartVisible}
      />
    </div>
  );
}
