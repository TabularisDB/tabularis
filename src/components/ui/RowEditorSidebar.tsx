import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { FieldEditor } from "./FieldEditor";
import { SlotAnchor } from "./SlotAnchor";
import { useRowEditor } from "../../hooks/useRowEditor";
import { useRowEditorResize } from "../../hooks/useRowEditorResize";

interface RowEditorSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  rowData: Record<string, unknown>;
  originalRowData?: Record<string, unknown>;
  rowIndex: number;
  isInsertion: boolean;
  columns: Array<{ name: string; type?: string; characterMaximumLength?: number }>;
  autoIncrementColumns?: string[];
  defaultValueColumns?: string[];
  nullableColumns?: string[];
  onChange: (colName: string, value: unknown) => void;
  focusField?: string;
  detectJsonInTextColumns?: boolean;
  connectionId?: string | null;
  tableName?: string | null;
  pkColumn?: string | null;
  schema?: string | null;
}

export const RowEditorSidebar = ({
  isOpen,
  onClose,
  rowData,
  originalRowData,
  rowIndex,
  isInsertion,
  columns,
  autoIncrementColumns,
  defaultValueColumns,
  nullableColumns,
  onChange,
  focusField,
  detectJsonInTextColumns = false,
  connectionId,
  tableName,
  pkColumn,
  schema,
}: RowEditorSidebarProps) => {
  const { t } = useTranslation();
  const { width, startResize } = useRowEditorResize();
  const { editedData, updateField } = useRowEditor({
    initialData: rowData,
    onChange: (fieldName, value) => onChange(fieldName, value),
  });

  // Refs to track field containers for scrolling
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});
  
  // Scroll to and focus the specified field when sidebar opens
  useEffect(() => {
    if (isOpen && focusField && fieldRefs.current[focusField]) {
      // Wait for the sidebar animation to complete
      setTimeout(() => {
        const fieldElement = fieldRefs.current[focusField];
        if (fieldElement) {
          // Scroll the field into view
          fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Focus the input inside the field
          const input = fieldElement.querySelector('input, textarea') as HTMLElement;
          if (input) {
            input.focus();
          }
        }
      }, 150); // Wait for slide-in animation
    }
  }, [isOpen, focusField]);

  if (!isOpen) return null;

  return (
    <>
      {/* Sidebar */}
      <div
        className="fixed right-0 top-0 bottom-0 bg-elevated border-l border-strong shadow-2xl z-[1001] flex flex-col animate-slide-in-right"
        style={{ width: `${width}px` }}
      >
        {/* Drag handle */}
        <button
          type="button"
          onMouseDown={startResize}
          aria-label={t("rowEditor.resize", {
            defaultValue: "Resize sidebar",
          })}
          title={t("rowEditor.resize", { defaultValue: "Resize sidebar" })}
          className="absolute top-0 bottom-0 -left-1 w-2 cursor-col-resize group/resize z-10"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-default group-hover/resize:bg-blue-500 group-hover/resize:w-0.5 transition-all"
          />
        </button>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div>
            <h2 className="text-lg font-semibold text-primary">
              {t("rowEditor.title")}
            </h2>
            <p className="text-xs text-secondary mt-0.5">
              {t("rowEditor.subtitle", { row: rowIndex + 1 })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SlotAnchor
              name="row-editor-sidebar.header.actions"
              context={{
                connectionId,
                tableName,
                schema,
                rowData,
                rowIndex,
                isInsertion,
              }}
              className="flex items-center gap-1"
            />
            <button
              onClick={onClose}
              className="text-secondary hover:text-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {columns.map((column) => {
            const value = editedData[column.name];

            return (
              <div 
                key={column.name} 
                className="space-y-2"
                ref={(el) => {
                  fieldRefs.current[column.name] = el;
                }}
              >
                <label className="block text-xs font-bold text-muted">
                  {column.name}
                  {column.type && (
                    <span className="ml-2 normal-case font-normal">
                      ({column.type})
                    </span>
                  )}
                </label>
                
                <FieldEditor
                  name={column.name}
                  type={column.type}
                  characterMaximumLength={column.characterMaximumLength}
                  value={value}
                  originalValue={originalRowData?.[column.name]}
                  detectJsonInTextColumns={detectJsonInTextColumns}
                  onChange={(newValue) => updateField(column.name, newValue)}
                  placeholder={t("rowEditor.enterValue")}
                  isInsertion={isInsertion}
                  isAutoIncrement={autoIncrementColumns?.includes(column.name)}
                  hasDefault={defaultValueColumns?.includes(column.name)}
                  isNullable={nullableColumns?.includes(column.name)}
                  connectionId={connectionId}
                  tableName={tableName}
                  pkCol={pkColumn}
                  pkVal={pkColumn ? rowData[pkColumn] : undefined}
                  schema={schema}
                />
                <SlotAnchor
                  name="row-editor-sidebar.field.after"
                  context={{
                    connectionId,
                    tableName,
                    schema,
                    columnName: column.name,
                    rowData: editedData,
                    rowIndex,
                    isInsertion,
                    onFieldChange: (value: unknown) => updateField(column.name, value),
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
