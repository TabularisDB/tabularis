import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile, readTextFile } from "@tauri-apps/plugin-fs";
import { BookOpen } from "lucide-react";
import type { Tab, QueryResult } from "../../types/editor";
import type { NotebookCell, NotebookCellType } from "../../types/notebook";
import {
  updateCellInCells,
  addCellToCells,
  removeCellFromCells,
  moveCellInCells,
} from "../../utils/notebook";
import {
  serializeNotebook,
  deserializeNotebook,
} from "../../utils/notebookFile";
import { useDatabase } from "../../hooks/useDatabase";
import { isMultiDatabaseCapable } from "../../utils/database";
import { useSettings } from "../../hooks/useSettings";
import { useAlert } from "../../hooks/useAlert";
import { useKeybindings } from "../../hooks/useKeybindings";
import { NotebookToolbar } from "./NotebookToolbar";
import { NotebookCellWrapper } from "./NotebookCellWrapper";
import { AddCellButton } from "./AddCellButton";
import { useEffect } from "react";

interface NotebookViewProps {
  tab: Tab;
  updateTab: (id: string, partial: Partial<Tab>) => void;
  connectionId: string;
}

export function NotebookView({ tab, updateTab, connectionId }: NotebookViewProps) {
  const { t } = useTranslation();
  const { activeSchema, activeCapabilities, selectedDatabases } = useDatabase();
  const isMultiDb = isMultiDatabaseCapable(activeCapabilities) && selectedDatabases.length > 1;
  const effectiveSchema = tab.schema || activeSchema || (isMultiDb ? selectedDatabases[0] : null);
  const { settings } = useSettings();
  const { showAlert } = useAlert();
  const { matchesShortcut } = useKeybindings();
  const [isRunningAll, setIsRunningAll] = useState(false);
  const cellsRef = useRef(tab.notebookState?.cells ?? []);

  // Keep ref in sync
  cellsRef.current = tab.notebookState?.cells ?? [];

  const cells = tab.notebookState?.cells ?? [];

  const updateNotebook = useCallback(
    (cells: NotebookCell[]) => {
      updateTab(tab.id, { notebookState: { cells } });
    },
    [tab.id, updateTab],
  );

  const updateCell = useCallback(
    (cellId: string, partial: Partial<NotebookCell>) => {
      updateNotebook(updateCellInCells(cellsRef.current, cellId, partial));
    },
    [updateNotebook],
  );

  const addCell = useCallback(
    (type: NotebookCellType, afterIndex?: number) => {
      updateNotebook(addCellToCells(cellsRef.current, type, afterIndex));
    },
    [updateNotebook],
  );

  const deleteCell = useCallback(
    (cellId: string) => {
      updateNotebook(removeCellFromCells(cellsRef.current, cellId));
    },
    [updateNotebook],
  );

  const moveCell = useCallback(
    (cellId: string, direction: -1 | 1) => {
      updateNotebook(moveCellInCells(cellsRef.current, cellId, direction));
    },
    [updateNotebook],
  );

  const runCell = useCallback(
    async (cellId: string) => {
      const cell = cellsRef.current.find((c) => c.id === cellId);
      if (!cell || cell.type !== "sql" || !cell.content.trim()) return;

      updateCell(cellId, { isLoading: true, error: undefined, result: null });

      const pageSize =
        settings.resultPageSize && settings.resultPageSize > 0
          ? settings.resultPageSize
          : 100;

      const cellSchema = cell.schema || effectiveSchema;
      const start = performance.now();
      try {
        const res = await invoke<QueryResult>("execute_query", {
          connectionId,
          query: cell.content.trim(),
          limit: pageSize,
          page: 1,
          ...(cellSchema ? { schema: cellSchema } : {}),
        });
        const elapsed = performance.now() - start;
        updateCell(cellId, {
          result: res,
          executionTime: elapsed,
          isLoading: false,
          error: undefined,
        });
      } catch (e: unknown) {
        const elapsed = performance.now() - start;
        updateCell(cellId, {
          error: e instanceof Error ? e.message : String(e),
          executionTime: elapsed,
          isLoading: false,
          result: null,
        });
      }
    },
    [connectionId, effectiveSchema, settings.resultPageSize, updateCell],
  );

  const runAll = useCallback(async () => {
    setIsRunningAll(true);
    const sqlCells = cellsRef.current.filter(
      (c) => c.type === "sql" && c.content.trim(),
    );
    for (const cell of sqlCells) {
      await runCell(cell.id);
    }
    setIsRunningAll(false);
  }, [runCell]);

  const handleExport = useCallback(async () => {
    const notebook = serializeNotebook(tab.title, cellsRef.current);
    const safeName = tab.title.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = await save({
      defaultPath: `${safeName}.tabularis-notebook`,
      filters: [{ name: "Tabularis Notebook", extensions: ["tabularis-notebook"] }],
    });
    if (!filePath) return;

    const encoder = new TextEncoder();
    await writeFile(filePath, encoder.encode(JSON.stringify(notebook, null, 2)));
    showAlert(t("editor.notebook.exportSuccess"), { kind: "info" });
  }, [tab.title, showAlert, t]);

  const handleImport = useCallback(async () => {
    const filePath = await open({
      filters: [{ name: "Tabularis Notebook", extensions: ["tabularis-notebook"] }],
    });
    if (!filePath || typeof filePath !== "string") return;

    try {
      const content = await readTextFile(filePath);
      const { title, cells: importedCells } = deserializeNotebook(content);
      updateTab(tab.id, {
        title,
        notebookState: { cells: importedCells },
      });
      showAlert(t("editor.notebook.importSuccess"), { kind: "info" });
    } catch {
      showAlert(t("editor.notebook.invalidFile"), { kind: "error" });
    }
  }, [tab.id, updateTab, showAlert, t]);

  // Keyboard shortcut: Ctrl+Shift+Enter → Run All
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut(e, "notebook_run_all")) {
        e.preventDefault();
        runAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matchesShortcut, runAll]);

  // Empty state
  if (cells.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <NotebookToolbar
          onAddSqlCell={() => addCell("sql")}
          onAddMarkdownCell={() => addCell("markdown")}
          onRunAll={runAll}
          onExport={handleExport}
          onImport={handleImport}
          isRunning={isRunningAll}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted">
          <BookOpen size={32} className="opacity-40" />
          <p className="text-sm">{t("editor.notebook.emptyNotebook")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <NotebookToolbar
        onAddSqlCell={() => addCell("sql")}
        onAddMarkdownCell={() => addCell("markdown")}
        onRunAll={runAll}
        onExport={handleExport}
        onImport={handleImport}
        isRunning={isRunningAll}
      />
      <div className="flex-1 overflow-auto p-4 space-y-0">
        {cells.map((cell, index) => (
          <div key={`${cell.id}-${index}`}>
            <NotebookCellWrapper
              cell={cell}
              index={index}
              totalCells={cells.length}
              onUpdate={(partial) => updateCell(cell.id, partial)}
              onDelete={() => deleteCell(cell.id)}
              onMoveUp={() => moveCell(cell.id, -1)}
              onMoveDown={() => moveCell(cell.id, 1)}
              onRun={() => runCell(cell.id)}
              activeSchema={cell.schema || effectiveSchema || undefined}
              selectedDatabases={isMultiDb ? selectedDatabases : undefined}
              onSchemaChange={isMultiDb ? (schema) => updateCell(cell.id, { schema }) : undefined}
            />
            <AddCellButton
              onAddSql={() => addCell("sql", index)}
              onAddMarkdown={() => addCell("markdown", index)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
