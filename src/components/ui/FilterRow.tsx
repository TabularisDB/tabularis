import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus, Minus } from "lucide-react";
import type { TableColumn } from "../../types/editor";
import { getOperatorsForType } from "../../utils/filterBar";
import type { StructuredFilter, FilterOperator } from "../../utils/filterBar";
import { StyledSelect } from "./StyledSelect";

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
}: FilterRowProps) => {
  const { t } = useTranslation();
  const selectedCol = columns.find((c) => c.name === filter.column);
  const operators = getOperatorsForType(selectedCol?.data_type ?? "");
  const enabled = filter.enabled !== false;

  const noValueOps: FilterOperator[] = ["IS NULL", "IS NOT NULL"];
  const isBetween = filter.operator === "BETWEEN";
  const noValue = noValueOps.includes(filter.operator);

  const handleColumnChange = (col: string) => {
    const colMeta = columns.find((c) => c.name === col);
    const ops = getOperatorsForType(colMeta?.data_type ?? "");
    const op = ops.includes(filter.operator) ? filter.operator : ops[0];
    onChange({ ...filter, column: col, operator: op });
  };

  const handleValueKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onApplySingle(filter);
      onTriggerApplied();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary/40 transition-colors group">
      {/* Checkbox -- selected for Apply All */}
      <button
        onClick={() => onChange({ ...filter, enabled: !enabled })}
        title={enabled ? t("toolbar.deselectFromApplyAll") : t("toolbar.selectForApplyAll")}
        className={`shrink-0 w-4 h-4 rounded flex items-center justify-center border transition-all ${
          enabled
            ? "bg-green-500/20 border-green-500/70 text-green-400"
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
        className="w-28"
      />

      {/* Value */}
      {!noValue && !isBetween && (
        <input
          type="text"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={filter.value}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          onKeyDown={handleValueKeyDown}
          className="flex-1 min-w-0 bg-base border border-default rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-blue-500/60 transition-colors"
          placeholder={t("toolbar.valuePlaceholder")}
          autoComplete="off"
        />
      )}
      {noValue && <div className="flex-1" />}
      {isBetween && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <input
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
            onKeyDown={handleValueKeyDown}
            className="flex-1 min-w-0 bg-base border border-default rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-blue-500/60 transition-colors"
            placeholder={t("toolbar.fromPlaceholder")}
          />
          <span className="text-[10px] text-muted shrink-0 font-mono uppercase tracking-wider">AND</span>
          <input
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={filter.value2 ?? ""}
            onChange={(e) => onChange({ ...filter, value2: e.target.value })}
            onKeyDown={handleValueKeyDown}
            className="flex-1 min-w-0 bg-base border border-default rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-blue-500/60 transition-colors"
            placeholder={t("toolbar.toPlaceholder")}
          />
        </div>
      )}

      {/* Apply -- applies only this row, does NOT close panel */}
      <button
        onClick={() => { onApplySingle(filter); onTriggerApplied(); }}
        className={`shrink-0 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
          isApplied
            ? "bg-green-600/20 border-green-500/50 text-green-400"
            : "bg-blue-600/15 border-blue-500/40 text-blue-300 hover:bg-blue-600/25 hover:border-blue-400/60"
        }`}
      >
        {isApplied ? t("toolbar.applied") : t("toolbar.apply")}
      </button>

      {/* Duplicate / Remove */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onDuplicate(filter)}
          title={t("toolbar.duplicateFilter")}
          className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-blue-300 hover:bg-blue-600/15 transition-colors"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={onRemove}
          title={t("toolbar.removeFilter")}
          className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Minus size={12} />
        </button>
      </div>
    </div>
  );
};
