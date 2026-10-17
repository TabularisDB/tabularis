import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus, Minus } from "lucide-react";
import type { TableColumn } from "../../types/editor";
import {
  applyPickedValues,
  getOperatorsForType,
  getPickedValues,
  isFilterComplete,
  isMatchCaseEnabled,
  isValuePickerSupported,
  NO_VALUE_OPS,
} from "../../utils/filterBar";
import type { DistinctValue, StructuredFilter, FilterOperator } from "../../utils/filterBar";
import { StyledSelect } from "./StyledSelect";
import { FilterValuePicker } from "./FilterValuePicker";

/** i18n keys for text-friendly operators (SQL tokens keep their raw labels). */
const OPERATOR_LABEL_KEYS: Partial<Record<FilterOperator, string>> = {
  contains: "toolbar.opContains",
  "starts with": "toolbar.opStartsWith",
  "ends with": "toolbar.opEndsWith",
  "is empty": "toolbar.opIsEmpty",
  "is not empty": "toolbar.opIsNotEmpty",
};

export interface FilterRowProps {
  filter: StructuredFilter;
  columns: TableColumn[];
  onChange: (updated: StructuredFilter) => void;
  onRemove: () => void;
  onApplySingle: (filter: StructuredFilter) => void;
  onDuplicate: (filter: StructuredFilter) => void;
  onEscape: () => void;
  isApplied: boolean;
  onTriggerApplied: () => void;
  /**
   * Loads the most frequent values of this row's column for the value picker.
   * The picker is only offered when this is set (table tabs).
   */
  onLoadValues?: (filter: StructuredFilter) => Promise<DistinctValue[]>;
  /** Identifies the connection and query whose values the picker displays. */
  valuePickerContextKey?: string;
  /**
   * Offers the match-case toggle for the literal text operators. Only a
   * PostgreSQL dialect can emit `ILIKE`, so other connections hide the control
   * instead of showing one that changes nothing.
   */
  supportsMatchCase?: boolean;
}

export const FilterRow = ({
  filter,
  columns,
  onChange,
  onRemove,
  onApplySingle,
  onDuplicate,
  onEscape,
  isApplied,
  onTriggerApplied,
  onLoadValues,
  valuePickerContextKey,
  supportsMatchCase,
}: FilterRowProps) => {
  const { t } = useTranslation();
  const selectedCol = columns.find((c) => c.name === filter.column);
  const operators = getOperatorsForType(selectedCol?.data_type ?? "");
  const enabled = filter.enabled !== false;

  const isBetween = filter.operator === "BETWEEN";
  const noValue = NO_VALUE_OPS.includes(filter.operator);
  const dataType = selectedCol?.data_type ?? "";
  const showValuePicker =
    !!onLoadValues && !!filter.column && !noValue && !isBetween && isValuePickerSupported(dataType);
  const isTextMatch =
    filter.operator === "contains" ||
    filter.operator === "starts with" ||
    filter.operator === "ends with";
  const showMatchCase = !!supportsMatchCase && isTextMatch;
  const matchCase = isMatchCaseEnabled(filter);

  const handleColumnChange = (col: string) => {
    const colMeta = columns.find((c) => c.name === col);
    const ops = getOperatorsForType(colMeta?.data_type ?? "");
    const op = ops.includes(filter.operator) ? filter.operator : ops[0];
    onChange({ ...filter, column: col, operator: op });
  };

  // Applied feedback only for rows that were actually sent
  const applySingle = () => {
    onApplySingle(filter);
    if (isFilterComplete(filter)) onTriggerApplied();
  };

  const handleValueKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySingle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
    }
  };

  const operatorLabel = (op: string) => {
    const key = OPERATOR_LABEL_KEYS[op as FilterOperator];
    return key ? t(key) : op;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary/40 transition-colors group">
      {/* Checkbox -- selected for Apply All */}
      <button
        onClick={() => onChange({ ...filter, enabled: !enabled })}
        title={enabled ? t("toolbar.deselectFromApplyAll") : t("toolbar.selectForApplyAll")}
        className={`shrink-0 w-4 h-4 rounded flex items-center justify-center border transition-all ${
          enabled
            ? "bg-accent-success/20 border-accent-success/70 text-accent-success"
            : "border-default/60 text-transparent hover:border-default"
        }`}
      >
        <Check size={10} strokeWidth={3} />
      </button>

      {/* Column */}
      <StyledSelect
        value={filter.column}
        onChange={handleColumnChange}
        options={columns.map((c) => c.name)}
        className="w-40"
      />

      {/* Operator */}
      <StyledSelect
        value={filter.operator}
        onChange={(op) => onChange({ ...filter, operator: op as FilterOperator })}
        options={operators}
        getOptionLabel={operatorLabel}
        className="w-36"
      />

      {/* Value */}
      {!noValue && !isBetween && (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
            onKeyDown={handleValueKeyDown}
            className="flex-1 min-w-0 bg-base border border-default rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-focus/60 transition-colors"
            placeholder={t("toolbar.valuePlaceholder")}
            autoComplete="off"
          />
          {showMatchCase && (
            <button
              type="button"
              onClick={() => onChange({ ...filter, matchCase: !matchCase })}
              aria-pressed={matchCase}
              aria-label={t("toolbar.matchCase")}
              title={t("toolbar.matchCaseHint")}
              className={`shrink-0 h-6 px-1.5 rounded border font-mono text-[10px] leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                matchCase
                  ? "bg-accent-primary/15 border-accent-primary/40 text-accent hover:bg-accent-primary/25"
                  : "bg-transparent border-default/60 text-muted hover:text-secondary hover:border-default"
              }`}
            >
              Aa
            </button>
          )}
          {showValuePicker && (
            <FilterValuePicker
              key={JSON.stringify([valuePickerContextKey, filter, dataType])}
              load={() => onLoadValues(filter)}
              selected={getPickedValues(filter)}
              onApply={(values) => onChange(applyPickedValues(filter, values, dataType))}
            />
          )}
        </div>
      )}
      {noValue && <div className="flex-1" />}
      {isBetween && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <input autoComplete="off"
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
            onKeyDown={handleValueKeyDown}
            className="flex-1 min-w-0 bg-base border border-default rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-focus/60 transition-colors"
            placeholder={t("toolbar.fromPlaceholder")}
          />
          <span className="text-[10px] text-muted shrink-0 font-mono uppercase tracking-wider">AND</span>
          <input autoComplete="off"
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={filter.value2 ?? ""}
            onChange={(e) => onChange({ ...filter, value2: e.target.value })}
            onKeyDown={handleValueKeyDown}
            className="flex-1 min-w-0 bg-base border border-default rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-focus/60 transition-colors"
            placeholder={t("toolbar.toPlaceholder")}
          />
        </div>
      )}

      {/* Apply -- applies only this row, does NOT close panel */}
      <button
        onClick={applySingle}
        className={`shrink-0 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
          isApplied
            ? "bg-accent-success/20 border-accent-success/50 text-accent-success"
            : "bg-accent-primary/15 border-accent-primary/40 text-accent hover:bg-accent-primary/25 hover:border-accent-primary/60"
        }`}
      >
        {isApplied ? t("toolbar.applied") : t("toolbar.apply")}
      </button>

      {/* Duplicate / Remove */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onDuplicate(filter)}
          title={t("toolbar.duplicateFilter")}
          className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-accent hover:bg-accent-primary/15 transition-colors"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={onRemove}
          title={t("toolbar.removeFilter")}
          className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-accent-error hover:bg-accent-error/10 transition-colors"
        >
          <Minus size={12} />
        </button>
      </div>
    </div>
  );
};
