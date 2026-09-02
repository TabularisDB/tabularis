import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { OnMount } from "@monaco-editor/react";
import { SqlEditorWrapper } from "../ui/SqlEditorWrapper";
import { useSettings } from "../../hooks/useSettings";
import { NotebookAiButtons } from "./NotebookAiButtons";
import { CellSectionHeader } from "./CellSectionHeader";

interface SqlCellEditorProps {
  cellId: string;
  content: string;
  onContentChange: (content: string) => void;
  onRun: () => void;
  connectionId: string;
  schema?: string;
  collapsed?: boolean;
  onToggleCollapse: () => void;
}

export function SqlCellEditor({
  cellId,
  content,
  onContentChange,
  onRun,
  connectionId,
  schema,
  collapsed,
  onToggleCollapse,
}: SqlCellEditorProps) {
  const { settings } = useSettings();
  const { t } = useTranslation();
  const [editorHeight, setEditorHeight] = useState(60);
  const onMount: OnMount = useCallback((editor) => {
    const sync = () => setEditorHeight(Math.max(60, editor.getContentHeight()));
    editor.onDidContentSizeChange(sync);
    sync();
  }, []);

  return (
    <div>
      <CellSectionHeader
        label={t("editor.notebook.sectionQuery")}
        collapsed={!!collapsed}
        onToggle={onToggleCollapse}
        divider={false}
      />
      {!collapsed && (
        <div className="relative" style={{ height: editorHeight }}>
          <SqlEditorWrapper
            height="100%"
            initialValue={content}
            onChange={onContentChange}
            onRun={onRun}
            onMount={onMount}
            editorKey={`notebook-${cellId}`}
            options={{
              padding: { top: 8, bottom: 8 },
              lineNumbers: "off",
              scrollbar: { alwaysConsumeMouseWheel: false },
            }}
          />
          {settings.aiEnabled && (
            <NotebookAiButtons
              content={content}
              onInsert={onContentChange}
              connectionId={connectionId}
              schema={schema}
            />
          )}
        </div>
      )}
    </div>
  );
}
