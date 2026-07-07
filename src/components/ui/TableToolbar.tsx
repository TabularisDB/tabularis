import React, { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Filter,
  ArrowUpDown,
  ListFilter,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { TableColumn } from "../../types/editor";
import {
  filterColumnSuggestions,
  getCurrentWordPrefix,
  replaceCurrentWord,
  buildStructuredFilterClause,
  buildSingleFilterClause,
  createEmptyFilter,
} from "../../utils/filterBar";
import type { StructuredFilter } from "../../utils/filterBar";
import { formatSqlIdentifier } from "../../utils/identifiers";
import { formatSortClause } from "../../utils/tableToolbar";
import { FilterRow } from "./FilterRow";
import { SlotAnchor } from "./SlotAnchor";
import { useDatabase } from "../../hooks/useDatabase";

interface TableToolbarProps {
  initialFilter?: string;
  initialSort?: string;
  initialLimit?: number | null;
  placeholderColumn: string;
  placeholderSort: string;
  defaultLimit: number;
  columnMetadata?: TableColumn[];
  onUpdate: (filter: string, sort: string, limit: number | undefined) => void;
}

interface TableToolbarInternalProps extends TableToolbarProps {
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  structuredFilters: StructuredFilter[];
  onStructuredFiltersChange: (filters: StructuredFilter[]) => void;
  appliedFilters: Record<string, boolean>;
  onTriggerApplied: (filterId: string) => void;
  onResetApplied: (filterId: string) => void;
  onResetAllApplied: () => void;
}

// ─── Internal toolbar ─────────────────────────────────────────────────────────

const TableToolbarInternal = ({
  initialFilter,
  initialSort,
  initialLimit,
  placeholderColumn,
  placeholderSort,
  defaultLimit,
  columnMetadata,
  panelOpen,
  onPanelOpenChange,
  structuredFilters,
  onStructuredFiltersChange,
  appliedFilters,
  onTriggerApplied,
  onResetApplied,
  onResetAllApplied,
  onUpdate,
}: TableToolbarInternalProps) => {
  const { t } = useTranslation();
  const { activeDriver } = useDatabase();
  const [filterInput, setFilterInput] = useState(initialFilter || "");
  const [sortInput, setSortInput] = useState(initialSort || "");
  const [limitInput, setLimitInput] = useState(
    initialLimit && initialLimit > 0 ? String(initialLimit) : ""
  );

  // Autocomplete state — WHERE
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<TableColumn[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const autocompleteMouseDown = useRef(false);

  // Autocomplete state — ORDER BY
  const [sortAcOpen, setSortAcOpen] = useState(false);
  const [sortAcItems, setSortAcItems] = useState<TableColumn[]>([]);
  const [sortAcIndex, setSortAcIndex] = useState(0);
  const sortInputRef = useRef<HTMLInputElement>(null);
  const sortAcMouseDown = useRef(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);

  const columns = columnMetadata ?? [];
  const hasColumns = columns.length > 0;
  const activeFilterCount = structuredFilters.filter((f) => f.enabled !== false).length;

  // ── helpers ──────────────────────────────────────────────────────────────────

  const getLimitVal = useCallback(
    (limit: string) => (limit ? parseInt(limit, 10) : undefined),
    []
  );

  const commitSql = useCallback(
    (filter: string, sort: string, limit: string) => {
      const limitVal = getLimitVal(limit);
      const filterChanged = (filter || "") !== (initialFilter || "");
      const sortChanged = (sort || "") !== (initialSort || "");
      const limitChanged = limitVal !== initialLimit;
      if (filterChanged || sortChanged || limitChanged) {
        onUpdate(filter, formatSortClause(sort, activeDriver), limitVal);
      }
    },
    [getLimitVal, initialFilter, initialSort, initialLimit, onUpdate, activeDriver]
  );

  // ── click outside to close panel ─────────────────────────────────────────────

  useEffect(() => {
    if (!panelOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        filtersButtonRef.current &&
        !filtersButtonRef.current.contains(target)
      ) {
        closePanel();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  // closePanel is stable enough; adding it would cause infinite re-registration
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  // ── panel helpers ─────────────────────────────────────────────────────────────

  const openPanel = () => {
    if (structuredFilters.length === 0 && hasColumns) {
      onStructuredFiltersChange([createEmptyFilter(columns)]);
    }
    onPanelOpenChange(true);
  };

  const closePanel = useCallback(() => {
    const clause = buildStructuredFilterClause(structuredFilters, activeDriver);
    setFilterInput(clause);
    onPanelOpenChange(false);
    onUpdate(clause, formatSortClause(sortInput, activeDriver), getLimitVal(limitInput));
  }, [structuredFilters, sortInput, limitInput, getLimitVal, onUpdate, onPanelOpenChange, activeDriver]);

  const togglePanel = () => {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  };

  // ── structured filter actions ─────────────────────────────────────────────────

  // Applies all enabled filters — does NOT close panel
  const handleApplyAll = useCallback(() => {
    const clause = buildStructuredFilterClause(structuredFilters, activeDriver);
    onUpdate(clause, formatSortClause(sortInput, activeDriver), getLimitVal(limitInput));
    structuredFilters.forEach((f) => {
      if (f.enabled !== false) {
        onTriggerApplied(f.id);
      } else {
        onResetApplied(f.id);
      }
    });
  }, [structuredFilters, sortInput, limitInput, getLimitVal, onUpdate, onTriggerApplied, onResetApplied, activeDriver]);

  // Applies only that single row's filter — resets Applied on all others
  const handleApplySingle = useCallback(
    (filter: StructuredFilter) => {
      onUpdate(
        buildSingleFilterClause(filter, activeDriver),
        formatSortClause(sortInput, activeDriver),
        getLimitVal(limitInput),
      );
      onResetAllApplied();
      onTriggerApplied(filter.id);
    },
    [sortInput, limitInput, getLimitVal, onUpdate, onResetAllApplied, onTriggerApplied, activeDriver]
  );

  const handleUnset = () => {
    onStructuredFiltersChange([]);
    onUpdate("", formatSortClause(sortInput, activeDriver), getLimitVal(limitInput));
  };

  const handleAddFilter = () => {
    if (!hasColumns) return;
    onStructuredFiltersChange([...structuredFilters, createEmptyFilter(columns)]);
  };

  const handleDuplicateFilter = (filter: StructuredFilter) => {
    const copy: StructuredFilter = {
      ...filter,
      id: `filter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    const idx = structuredFilters.findIndex((f) => f.id === filter.id);
    const next = [...structuredFilters];
    next.splice(idx === -1 ? structuredFilters.length : idx + 1, 0, copy);
    onStructuredFiltersChange(next);
  };

  const handleFilterChange = (index: number, updated: StructuredFilter) => {
    const next = [...structuredFilters];
    next[index] = updated;
    onStructuredFiltersChange(next);
    // Don't reset applied state when only the checkbox (enabled) changes
    const prev = structuredFilters[index];
    const onlyEnabledChanged =
      prev.column === updated.column &&
      prev.operator === updated.operator &&
      prev.value === updated.value &&
      prev.value2 === updated.value2;
    if (!onlyEnabledChanged) {
      onResetApplied(updated.id);
    }
  };

  const handleFilterRemove = (index: number) => {
    const removedId = structuredFilters[index].id;
    const next = structuredFilters.filter((_, i) => i !== index);
    onStructuredFiltersChange(next);
    onResetApplied(removedId);
  };

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      closePanel();
    }
  };

  // ── SQL autocomplete ─────────────────────────────────────────────────────────

  const handleWhereChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFilterInput(value);

    if (!hasColumns) return;
    const cursorPos = e.target.selectionStart ?? value.length;
    const prefix = getCurrentWordPrefix(value, cursorPos);

    if (prefix.length > 0) {
      const suggestions = filterColumnSuggestions(columns, prefix);
      setAutocompleteItems(suggestions);
      setAutocompleteIndex(0);
      setAutocompleteOpen(suggestions.length > 0);
    } else {
      setAutocompleteOpen(false);
    }
  };

  const acceptSuggestion = (col: TableColumn) => {
    const input = filterInputRef.current;
    const cursorPos = input?.selectionStart ?? filterInput.length;
    const replacement = formatSqlIdentifier(col.name, activeDriver);
    const newValue = replaceCurrentWord(filterInput, cursorPos, replacement);
    setFilterInput(newValue);
    setAutocompleteOpen(false);

    setTimeout(() => {
      if (input) {
        input.focus();
        const before = filterInput.slice(0, cursorPos);
        const wordMatch = before.match(/[a-zA-Z0-9_]+$/);
        const wordStart = wordMatch ? cursorPos - wordMatch[0].length : cursorPos;
        input.setSelectionRange(wordStart + replacement.length, wordStart + replacement.length);
      }
    }, 0);
  };

  const handleWhereKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (autocompleteOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((i) => Math.min(i + 1, autocompleteItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        acceptSuggestion(autocompleteItems[autocompleteIndex]);
        return;
      }
      if (e.key === "Escape") {
        setAutocompleteOpen(false);
        return;
      }
    }
    if (e.key === "Enter") {
      commitSql(filterInput, sortInput, limitInput);
    }
  };

  const handleWhereBlur = () => {
    if (autocompleteMouseDown.current) return;
    setAutocompleteOpen(false);
    commitSql(filterInput, sortInput, limitInput);
  };

  // ── ORDER BY autocomplete ────────────────────────────────────────────────────

  const handleSortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSortInput(value);
    if (!hasColumns) return;
    const cursorPos = e.target.selectionStart ?? value.length;
    const prefix = getCurrentWordPrefix(value, cursorPos);
    if (prefix.length > 0) {
      const suggestions = filterColumnSuggestions(columns, prefix);
      setSortAcItems(suggestions);
      setSortAcIndex(0);
      setSortAcOpen(suggestions.length > 0);
    } else {
      setSortAcOpen(false);
    }
  };

  const acceptSortSuggestion = (col: TableColumn) => {
    const input = sortInputRef.current;
    const cursorPos = input?.selectionStart ?? sortInput.length;
    const replacement = formatSqlIdentifier(col.name, activeDriver);
    const newValue = replaceCurrentWord(sortInput, cursorPos, replacement);
    setSortInput(newValue);
    setSortAcOpen(false);
    setTimeout(() => {
      if (input) {
        input.focus();
        const before = sortInput.slice(0, cursorPos);
        const wordMatch = before.match(/[a-zA-Z0-9_]+$/);
        const wordStart = wordMatch ? cursorPos - wordMatch[0].length : cursorPos;
        input.setSelectionRange(wordStart + replacement.length, wordStart + replacement.length);
      }
    }, 0);
  };

  const handleSortKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (sortAcOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSortAcIndex((i) => Math.min(i + 1, sortAcItems.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSortAcIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") { e.preventDefault(); acceptSortSuggestion(sortAcItems[sortAcIndex]); return; }
      if (e.key === "Escape") { setSortAcOpen(false); return; }
    }
    if (e.key === "Enter") {
      if (!panelOpen) { commitSql(filterInput, sortInput, limitInput); } else { handleApplyAll(); }
    }
  };

  // ── shared ORDER BY / LIMIT ─────────────────────────────────────────────────

  const handleSortBlur = () => {
    if (sortAcMouseDown.current) return;
    setSortAcOpen(false);
    if (!panelOpen) {
      commitSql(filterInput, sortInput, limitInput);
    } else {
      onUpdate(
        buildStructuredFilterClause(structuredFilters, activeDriver),
        formatSortClause(sortInput, activeDriver),
        getLimitVal(limitInput),
      );
    }
  };

  const handleLimitBlur = () => {
    if (!panelOpen) {
      commitSql(filterInput, sortInput, limitInput);
    } else {
      onUpdate(
        buildStructuredFilterClause(structuredFilters, activeDriver),
        formatSortClause(sortInput, activeDriver),
        getLimitVal(limitInput),
      );
    }
  };

  const handleSortLimitKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (!panelOpen) {
        commitSql(filterInput, sortInput, limitInput);
      } else {
        handleApplyAll();
      }
    }
  };

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      {/* Always-visible toolbar */}
      <div className="h-10 bg-elevated border-y border-default flex items-center px-2 gap-2">
        {/* Filters button */}
        {hasColumns && (
          <button
            ref={filtersButtonRef}
            onClick={togglePanel}
            title={t("toolbar.toggleFilterPanel")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-all shrink-0 ${
              panelOpen
                ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                : "text-muted border-default hover:text-blue-300 hover:border-blue-500/40"
            }`}
          >
            <SlidersHorizontal size={12} />
            <span>{t("toolbar.filters")}</span>
            {activeFilterCount > 0 && (
              <span className="px-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-semibold bg-blue-500/30 text-blue-300 leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        )}

        {/* WHERE input — hidden while panel is open */}
        {!panelOpen && (
          <div className="flex items-center gap-2 flex-1 bg-base border border-default rounded px-2 py-1 focus-within:border-blue-500/50 transition-colors relative">
            <Filter size={14} className="text-muted shrink-0" />
            <span className="text-xs text-blue-400 font-mono shrink-0">WHERE</span>
            <input
              ref={filterInputRef}
              type="text"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={filterInput}
              onChange={handleWhereChange}
              onBlur={handleWhereBlur}
              onKeyDown={handleWhereKeyDown}
              className="bg-transparent border-none outline-none text-xs text-secondary w-full placeholder:text-surface-tertiary font-mono"
              placeholder={`${placeholderColumn} > 5 AND status = 'active'`}
            />

            {autocompleteOpen && autocompleteItems.length > 0 && (
              <ul
                className="absolute left-0 top-full mt-1 z-50 bg-elevated border border-default rounded-lg shadow-xl min-w-52 max-h-52 overflow-y-auto"
                onMouseDown={() => { autocompleteMouseDown.current = true; }}
                onMouseUp={() => { autocompleteMouseDown.current = false; }}
              >
                {autocompleteItems.map((col, idx) => (
                  <li
                    key={col.name}
                    className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors first:rounded-t-lg last:rounded-b-lg ${
                      idx === autocompleteIndex
                        ? "bg-blue-600/25 text-blue-200"
                        : "text-secondary hover:bg-surface-secondary"
                    }`}
                    onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(col); }}
                  >
                    <span className="font-mono">{col.name}</span>
                    <span className="text-muted ml-4 text-[10px] uppercase tracking-wide">{col.data_type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* WHERE preview pill when panel is open */}
        {panelOpen && (
          <div className="flex items-center gap-1.5 flex-1 px-2 py-1 min-w-0">
            <Filter size={12} className="text-muted shrink-0" />
            <span className="text-xs text-muted font-mono truncate">
              {buildStructuredFilterClause(structuredFilters, activeDriver) || (
                <em className="not-italic opacity-50">{t("toolbar.noActiveFilters")}</em>
              )}
            </span>
          </div>
        )}

        {/* ORDER BY */}
        <div className="relative flex items-center gap-1.5 flex-1 bg-base border border-default rounded px-2 py-1 focus-within:border-blue-500/50 transition-colors">
          <ArrowUpDown size={14} className="text-muted shrink-0" />
          <span className="text-xs text-blue-400 font-mono shrink-0">ORDER BY</span>
          <input
            ref={sortInputRef}
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={sortInput}
            onChange={handleSortChange}
            onBlur={handleSortBlur}
            onKeyDown={handleSortKeyDown}
            className="bg-transparent border-none outline-none text-xs text-secondary w-full placeholder:text-surface-tertiary font-mono"
            placeholder={`${placeholderSort} DESC`}
          />

          {sortAcOpen && sortAcItems.length > 0 && (
            <ul
              className="absolute left-0 top-full mt-1 z-50 bg-elevated border border-default rounded-lg shadow-xl min-w-52 max-h-52 overflow-y-auto"
              onMouseDown={() => { sortAcMouseDown.current = true; }}
              onMouseUp={() => { sortAcMouseDown.current = false; }}
            >
              {sortAcItems.map((col, idx) => (
                <li
                  key={col.name}
                  className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors first:rounded-t-lg last:rounded-b-lg ${
                    idx === sortAcIndex
                      ? "bg-blue-600/25 text-blue-200"
                      : "text-secondary hover:bg-surface-secondary"
                  }`}
                  onMouseDown={(e) => { e.preventDefault(); acceptSortSuggestion(col); }}
                >
                  <span className="font-mono">{col.name}</span>
                  <span className="text-muted ml-4 text-[10px] uppercase tracking-wide">{col.data_type}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* LIMIT */}
        <div className="flex items-center gap-1.5 w-32 bg-base border border-default rounded px-2 py-1 focus-within:border-blue-500/50 transition-colors">
          <ListFilter size={14} className="text-muted shrink-0" />
          <span className="text-xs text-blue-400 font-mono shrink-0">LIMIT</span>
          <input
            type="number"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            onBlur={handleLimitBlur}
            onKeyDown={handleSortLimitKeyDown}
            className="bg-transparent border-none outline-none text-xs text-secondary w-full placeholder:text-surface-tertiary font-mono"
            placeholder={String(defaultLimit)}
          />
        </div>

        {/* Plugin extension slot */}
        <SlotAnchor
          name="data-grid.toolbar.actions"
          context={{}}
          className="flex items-center gap-1"
        />
      </div>

      {/* Overlay filter panel */}
      {panelOpen && (
        <div
          ref={panelRef}
          onKeyDown={handlePanelKeyDown}
          className="absolute top-full left-0 z-50 mt-1 w-full min-w-[560px] max-w-4xl bg-elevated border border-default/80 rounded-lg overflow-hidden"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-default/60 bg-base/40">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={13} className="text-muted" />
              <span className="text-xs font-medium text-secondary">{t("toolbar.filterConditions")}</span>
              {structuredFilters.length > 0 && (
                <span className="text-[10px] text-muted">
                  {t("toolbar.activeOf", { active: activeFilterCount, total: structuredFilters.length })}
                </span>
              )}
            </div>
            <button
              onClick={closePanel}
              title={t("toolbar.closePanelEsc")}
              className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-secondary hover:bg-surface-secondary transition-colors"
            >
              <X size={12} />
            </button>
          </div>

          {/* Filter rows */}
          <div className="divide-y divide-default/30">
            {structuredFilters.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-3">
                <span className="text-xs text-muted">{t("toolbar.noFilters")}</span>
                <button
                  onClick={handleAddFilter}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {t("toolbar.addFirstFilter")}
                </button>
              </div>
            ) : (
              structuredFilters.map((filter, idx) => (
                <FilterRow
                  key={filter.id}
                  filter={filter}
                  columns={columns}
                  onChange={(updated) => handleFilterChange(idx, updated)}
                  onRemove={() => handleFilterRemove(idx)}
                  onApplySingle={handleApplySingle}
                  onDuplicate={handleDuplicateFilter}
                  onEscape={closePanel}
                  isApplied={appliedFilters[filter.id] === true}
                  onTriggerApplied={() => onTriggerApplied(filter.id)}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-default/60 bg-base/40">
            <button
              onClick={handleUnset}
              className="px-2.5 py-1 rounded text-xs text-muted border border-default/70 hover:text-secondary hover:border-default transition-colors"
            >
              {t("toolbar.unset")}
            </button>

            <button
              onClick={closePanel}
              title={t("toolbar.switchToSql")}
              className="px-2.5 py-1 rounded text-xs text-muted border border-default/70 hover:text-blue-300 hover:border-blue-500/50 transition-colors"
            >
              {t("toolbar.sql")}
            </button>

            <button
              onClick={handleAddFilter}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-muted border border-dashed border-default/70 hover:text-blue-300 hover:border-blue-500/50 transition-colors"
            >
              <Plus size={11} />
              {t("toolbar.addFilter")}
            </button>

            <div className="flex-1" />

            {/* Apply All — does NOT close panel */}
            <button
              onClick={handleApplyAll}
              className="px-3 py-1 rounded text-xs font-medium border transition-colors bg-blue-600/20 border-blue-500/50 text-blue-300 hover:bg-blue-600/30 hover:border-blue-400/70"
            >
              {t("toolbar.applyAll")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Public wrapper — panel state and filters lifted here to survive key-driven remounts ─────

export const TableToolbar = (props: TableToolbarProps) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [structuredFilters, setStructuredFilters] = useState<StructuredFilter[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<Record<string, boolean>>({});

  const handleTriggerApplied = useCallback((filterId: string) => {
    setAppliedFilters((prev) => ({ ...prev, [filterId]: true }));
  }, []);

  const handleResetApplied = useCallback((filterId: string) => {
    setAppliedFilters((prev) => { const next = { ...prev }; delete next[filterId]; return next; });
  }, []);

  const handleResetAllApplied = useCallback(() => {
    setAppliedFilters({});
  }, []);

  const stateKey = `${props.initialFilter}-${props.initialSort}-${props.initialLimit}`;
  return (
    <TableToolbarInternal
      key={stateKey}
      {...props}
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      structuredFilters={structuredFilters}
      onStructuredFiltersChange={setStructuredFilters}
      appliedFilters={appliedFilters}
      onTriggerApplied={handleTriggerApplied}
      onResetApplied={handleResetApplied}
      onResetAllApplied={handleResetAllApplied}
    />
  );
};
