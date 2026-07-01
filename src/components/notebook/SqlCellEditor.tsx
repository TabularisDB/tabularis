import { useTranslation } from "react-i18next";
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

  return (
    <div>
      <CellSectionHeader
        label={t("editor.notebook.sectionQuery")}
        collapsed={!!collapsed}
        onToggle={onToggleCollapse}
        divider={false}
      />
      {!collapsed && (
        <div className="h-[150px] relative">
          <SqlEditorWrapper
            height="100%"
            initialValue={content}
            onChange={onContentChange}
            onRun={onRun}
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
