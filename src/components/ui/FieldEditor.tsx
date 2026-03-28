import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Ban, FileDigit } from "lucide-react";
import { GeometryInput } from "./GeometryInput";
import { BlobInput } from "./BlobInput";
import { DateInput } from "./DateInput";
import { JsonInput } from "./JsonInput";
import { isGeometricType, formatGeometricValue } from "../../utils/geometry";
import { isBlobColumn } from "../../utils/blob";
import { isJsonColumn } from "../../utils/json";
import { getDateInputMode } from "../../utils/dateInput";
import { USE_DEFAULT_SENTINEL } from "../../utils/dataGrid";

export interface FieldEditorProps {
  name: string;
  type?: string;
  characterMaximumLength?: number;
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
  className?: string;
  isInsertion?: boolean;
  isAutoIncrement?: boolean;
  hasDefault?: boolean;
  isNullable?: boolean;
  // Connection context forwarded to BlobInput for downloading truncated BLOBs
  connectionId?: string | null;
  tableName?: string | null;
  pkCol?: string | null;
  pkVal?: unknown;
  schema?: string | null;
}

/**
 * Reusable field editor component
 * Automatically selects the appropriate input type based on field type
 */
export const FieldEditor: React.FC<FieldEditorProps> = ({
  name,
  type,
  characterMaximumLength,
  value,
  onChange,
  placeholder,
  className = "",
  isInsertion = false,
  isAutoIncrement = false,
  hasDefault = false,
  isNullable = false,
  connectionId,
  tableName,
  pkCol,
  pkVal,
  schema,
}) => {
  const { t } = useTranslation();
  const isGeometric = type && isGeometricType(type);
  const isBlob = type && isBlobColumn(type, characterMaximumLength);
  const isJson = type && isJsonColumn(type);
  const dateMode = type ? getDateInputMode(type) : null;

  const defaultPlaceholder = placeholder || t("rowEditor.enterValue");

  // Determine if we should show quick action buttons
  const showQuickActions = isAutoIncrement || hasDefault || isNullable;

  // For geometric columns, format WKB to WKT for display (same as DataGrid)
  const displayValue = useMemo(() => {
    if (isGeometric && value !== null && value !== undefined && value !== "") {
      return formatGeometricValue(value);
    }
    return String(value ?? "");
  }, [isGeometric, value]);

  const inputElement = isBlob ? (
    <div className={`${className}`}>
      <BlobInput
        value={value}
        dataType={type}
        onChange={(newValue) => onChange(newValue)}
        placeholder={defaultPlaceholder}
        connectionId={connectionId}
        tableName={tableName}
        pkCol={pkCol}
        pkVal={pkVal}
        colName={name}
        schema={schema}
      />
    </div>
  ) : isGeometric ? (
    <div className={`bg-base border border-strong rounded-lg p-3 ${className}`}>
      <GeometryInput
        value={displayValue}
        dataType={type}
        onChange={(newValue) => onChange(newValue)}
        placeholder={defaultPlaceholder}
        className="w-full bg-transparent text-primary border-none outline-none p-0 m-0 font-mono"
      />
    </div>
  ) : isJson ? (
    <JsonInput
      value={value}
      onChange={(newValue) => onChange(newValue)}
      placeholder={defaultPlaceholder}
      className={className}
    />
  ) : dateMode ? (
    <DateInput
      value={String(value ?? "")}
      mode={dateMode}
      onChange={(newValue) => onChange(newValue)}
      className={className}
    />
  ) : (
    <textarea
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      placeholder={defaultPlaceholder}
      className={`w-full px-3 py-2 bg-base border border-strong rounded-lg text-primary font-mono resize-none min-h-[80px] focus:border-blue-500 focus:outline-none ${className}`}
    />
  );

  if (!showQuickActions) {
    return inputElement;
  }

  return (
    <div className="space-y-2">
      {inputElement}

      {/* Quick Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        {isAutoIncrement && isInsertion && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-2 py-1 text-xs bg-purple-900/20 text-purple-400 rounded border border-purple-900/50 hover:bg-purple-900/30 transition-colors flex items-center gap-1"
            title={t("dataGrid.setGenerate")}
          >
            <Sparkles size={12} />
            {t("dataGrid.setGenerate")}
          </button>
        )}
        {isNullable && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-2 py-1 text-xs bg-surface-secondary text-muted rounded border border-default hover:bg-surface-tertiary transition-colors flex items-center gap-1"
            title={t("dataGrid.setNull")}
          >
            <Ban size={12} />
            {t("dataGrid.setNull")}
          </button>
        )}
        {hasDefault && (
          <button
            type="button"
            onClick={() => onChange(isInsertion ? null : USE_DEFAULT_SENTINEL)}
            className="px-2 py-1 text-xs bg-blue-900/20 text-blue-400 rounded border border-blue-900/50 hover:bg-blue-900/30 transition-colors flex items-center gap-1"
            title={t("dataGrid.setDefault")}
          >
            <FileDigit size={12} />
            {t("dataGrid.setDefault")}
          </button>
        )}
        {!isBlob && (
          <button
            type="button"
            onClick={() => onChange(" ")}
            className="px-2 py-1 text-xs bg-surface-secondary text-secondary rounded border border-default hover:bg-surface-tertiary transition-colors"
            title={t("dataGrid.setEmpty")}
          >
            {t("dataGrid.setEmpty")}
          </button>
        )}
      </div>
    </div>
  );
};
