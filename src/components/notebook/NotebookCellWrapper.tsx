import { useState } from "react";
import type { NotebookCell } from "../../types/notebook";
import type { CellChartConfig } from "../../types/notebook";
import { restoreFromHistory, getHistorySize } from "../../utils/notebookHistory";
import { NotebookCellHeader } from "./NotebookCellHeader";
import { SqlCell } from "./SqlCell";
import { MarkdownCell } from "./MarkdownCell";
import { CellHistoryPanel } from "./CellHistoryPanel";

interface NotebookCellWrapperProps {
  cell: NotebookCell;
  index: number;
  totalCells: number;
  onUpdate: (partial: Partial<NotebookCell>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRun: () => void;
  connectionId: string;
  activeSchema?: string;
  selectedDatabases?: string[];
  onSchemaChange?: (schema: string) => void;
  isDragging?: boolean;
  dragHandleProps?: {
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
    draggable: boolean;
  };
}

export function NotebookCellWrapper({
  cell,
  index,
  totalCells,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onRun,
  connectionId,
  activeSchema,
  selectedDatabases,
  onSchemaChange,
  isDragging,
  dragHandleProps,
}: NotebookCellWrapperProps) {
  const [showHistory, setShowHistory] = useState(false);

  const handleChartConfigChange = (config: CellChartConfig | null) => {
    onUpdate({ chartConfig: config });
  };

  const handleResultHeightChange = (height: number) => {
    onUpdate({ resultHeight: height });
  };

  const handleRestoreHistory = (entryIndex: number) => {
    const partial = restoreFromHistory(cell, entryIndex);
    if (partial) {
      onUpdate(partial);
      setShowHistory(false);
    }
  };

  return (
    <div
      className={`bg-base border border-default rounded-lg overflow-hidden transition-opacity ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <NotebookCellHeader
        cellType={cell.type}
        index={index}
        totalCells={totalCells}
        isPreview={cell.isPreview}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={onDelete}
        onRun={cell.type === "sql" ? onRun : undefined}
        onTogglePreview={
          cell.type === "markdown"
            ? () => onUpdate({ isPreview: !cell.isPreview })
            : undefined
        }
        isLoading={cell.isLoading}
        activeSchema={activeSchema}
        selectedDatabases={selectedDatabases}
        onSchemaChange={onSchemaChange}
        dragHandleProps={dragHandleProps}
        isParallel={cell.isParallel}
        onToggleParallel={
          cell.type === "sql"
            ? () => onUpdate({ isParallel: !cell.isParallel })
            : undefined
        }
        historyCount={cell.type === "sql" ? getHistorySize(cell) : undefined}
        onToggleHistory={
          cell.type === "sql" ? () => setShowHistory((v) => !v) : undefined
        }
        isCollapsed={cell.isCollapsed}
        onToggleCollapse={() => onUpdate({ isCollapsed: !cell.isCollapsed })}
        cellName={cell.name}
        onNameChange={(name) => onUpdate({ name: name || undefined })}
        cellContent={cell.content}
      />

      {showHistory && cell.type === "sql" && (
        <CellHistoryPanel
          history={cell.history ?? []}
          onRestore={handleRestoreHistory}
          onClose={() => setShowHistory(false)}
        />
      )}

      {!cell.isCollapsed && cell.type === "sql" ? (
        <SqlCell
          cell={cell}
          onContentChange={(content) => onUpdate({ content })}
          onRun={onRun}
          onChartConfigChange={handleChartConfigChange}
          onResultHeightChange={handleResultHeightChange}
          connectionId={connectionId}
          schema={activeSchema}
        />
      ) : !cell.isCollapsed ? (
        <MarkdownCell
          cell={cell}
          onContentChange={(content) => onUpdate({ content })}
          onTogglePreview={() => onUpdate({ isPreview: !cell.isPreview })}
        />
      ) : null}
    </div>
  );
}
