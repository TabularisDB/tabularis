import React, { useState, useRef, useCallback, useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Filter,
  ArrowUpDown,
  ListFilter,
  Plus,
  SlidersHorizontal,
  X,
  RefreshCw,
} from "lucide-react";
import type { AutoRefreshInterval, TableColumn } from "../../types/editor";
import { AUTO_REFRESH_INTERVALS, normalizeAutoRefreshInterval } from "../../utils/autoRefresh";
import {
  filterColumnSuggestions,
  getCurrentWordPrefix,
  replaceCurrentWord,
  buildStructuredFilterClause,
  buildSingleFilterClause,
  createEmptyFilter,
  buildDistinctValuesQuery,
  buildValuePickerWhere,
  parseDistinctValues,
} from "../../utils/filterBar";
import type { StructuredFilter, FilterCombinator, DistinctValue } from "../../utils/filterBar";
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
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  autoRefreshIntervalMs?: AutoRefreshInterval;
  onAutoRefreshChange?: (interval: AutoRefreshInterval) => void;
  autoRefreshPaused?: boolean;
  /** Why auto-refresh is paused; only read while `autoRefreshPaused` is true. */
  autoRefreshPausedReason?: "editing" | "selection";
  /** Table (and schema) shown in the grid; the value picker counts its rows. */
  tableName?: string | null;
  tableSchema?: string | null;
  /**
   * Runs a read-only query against the tab's connection. Enables the filter
   * value picker (issue #869) together with `tableName`.
   */
  onRunQuery?: (sql: string) => Promise<{ rows: unknown[][] }>;
}

interface TableToolbarInternalProps extends TableToolbarProps {
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  structuredFilters: StructuredFilter[];
  onStructuredFiltersChange: (filters: StructuredFilter[]) => void;
  combinator: FilterCombinator;
  onCombinatorChange: (combinator: FilterCombinator) => void;
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
  combinator,
  onCombinatorChange,
  appliedFilters,
  onTriggerApplied,
  onResetApplied,
  onResetAllApplied,
  onUpdate,
  onRefresh,
  refreshDisabled,
  autoRefreshIntervalMs = 0,
  onAutoRefreshChange,
  autoRefreshPaused,
  autoRefreshPausedReason = "editing",
  tableName,
  tableSchema,
  onRunQuery,
}: TableToolbarInternalProps) => {
  const { t } = useTranslation();
  const { activeDriver, activeCapabilities } = useDatabase();
  const autoRefreshActive = autoRefreshIntervalMs > 0;
  // Capability-driven when available (issue #614): a postgres-compatible
  // driver registered under a different id (e.g. a standalone PostgreSQL
  // plugin) is quoted the same as the builtin "postgres" driver.
  const quotingDriver = activeCapabilities ?? activeDriver;
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

  const whereListId = useId();
  const sortListId = useId();

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
        onUpdate(filter, formatSortClause(sort, quotingDriver), limitVal);
      }
    },
    [getLimitVal, initialFilter, initialSort, initialLimit, onUpdate, quotingDriver]
  );

  // ── panel helpers ─────────────────────────────────────────────────────────────

  const openPanel = () => {
    if (structuredFilters.length === 0 && hasColumns) {
      onStructuredFiltersChange([createEmptyFilter(columns)]);
    }
    onPanelOpenChange(true);
  };

  const closePanel = useCallback(() => {
    const clause = buildStructuredFilterClause(structuredFilters, quotingDriver, combinator);
    setFilterInput(clause);
    onPanelOpenChange(false);
    onUpdate(clause, formatSortClause(sortInput, quotingDriver), getLimitVal(limitInput));
  }, [structuredFilters, combinator, sortInput, limitInput, getLimitVal, onUpdate, onPanelOpenChange, quotingDriver]);

  const handleCombinatorChange = (next: FilterCombinator) => {
    if (next === combinator) return;
    onCombinatorChange(next);
    onResetAllApplied();
  };

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
    const clause = buildStructuredFilterClause(structuredFilters, quotingDriver, combinator);
    onUpdate(clause, formatSortClause(sortInput, quotingDriver), getLimitVal(limitInput));
    structuredFilters.forEach((f) => {
      if (f.enabled !== false) {
        onTriggerApplied(f.id);
      } else {
        onResetApplied(f.id);
      }
    });
  }, [structuredFilters, combinator, sortInput, limitInput, getLimitVal, onUpdate, onTriggerApplied, onResetApplied, quotingDriver]);

  // Loads the value picker list for one row: its column's most frequent
  // values, narrowed by the other rows of the panel (issue #869).
  const loadValuesFor = useCallback(
    async (filter: StructuredFilter): Promise<DistinctValue[]> => {
      if (!onRunQuery || !tableName) return [];
      const sql = buildDistinctValuesQuery({
        table: tableName,
        schema: tableSchema,
        column: filter.column,
        driver: quotingDriver,
        where: buildValuePickerWhere(structuredFilters, filter.id, quotingDriver, combinator),
      });
      const result = await onRunQuery(sql);
      return parseDistinctValues(result.rows);
    },
    [onRunQuery, tableName, tableSchema, quotingDriver, structuredFilters, combinator]
  );
  const canPickValues = !!onRunQuery && !!tableName;

  // Applies only that single row's filter — resets Applied on all others
  const handleApplySingle = useCallback(
    (filter: StructuredFilter) => {
      onUpdate(
        buildSingleFilterClause(filter, quotingDriver),
        formatSortClause(sortInput, quotingDriver),
        getLimitVal(limitInput),
      );
      onResetAllApplied();
      onTriggerApplied(filter.id);
    },
    [sortInput, limitInput, getLimitVal, onUpdate, onResetAllApplied, onTriggerApplied, quotingDriver]
  );

  const handleUnset = () => {
    onStructuredFiltersChange([]);
    onUpdate("", formatSortClause(sortInput, quotingDriver), getLimitVal(limitInput));
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
    const replacement = formatSqlIdentifier(col.name, quotingDriver);
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
    const replacement = formatSqlIdentifier(col.name, quotingDriver);
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
        buildStructuredFilterClause(structuredFilters, quotingDriver, combinator),
        formatSortClause(sortInput, quotingDriver),
        getLimitVal(limitInput),
      );
    }
  };

  const handleLimitBlur = () => {
    if (!panelOpen) {
      commitSql(filterInput, sortInput, limitInput);
    } else {
      onUpdate(
        buildStructuredFilterClause(structuredFilters, quotingDriver, combinator),
        formatSortClause(sortInput, quotingDriver),
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
    // Size container so controls collapse in narrow split panes. The explicit
    // z-index keeps the autocomplete dropdowns above the grid below (a
    // container creates a stacking context that would otherwise paint under
    // later siblings).
    <div className="@container relative z-30">
      {/* Always-visible toolbar */}
      <div className="h-10 bg-elevated border-y border-default flex items-center px-2 gap-2">
        {/* Filters button */}
        {hasColumns && (
          <button
            onClick={togglePanel}
            title={t("toolbar.toggleFilterPanel")}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-all shrink-0 ${
              panelOpen
                ? "bg-accent-primary/20 border-accent-primary/50 text-accent"
                : "text-muted border-default hover:text-accent hover:border-accent-primary/40"
            }`}
          >
            <SlidersHorizontal size={12} />
            <span className="hidden @[520px]:inline">{t("toolbar.filters")}</span>
            {activeFilterCount > 0 && (
              <span className="px-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-semibold bg-accent-primary/30 text-accent leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        )}

        {/* WHERE input — hidden while panel is open */}
        {!panelOpen && (
          <div className="flex items-center gap-2 flex-1 bg-base border border-default rounded px-2 py-1 focus-within:border-focus/50 transition-colors relative">
            <Filter size={14} className="text-muted shrink-0" />
            <span className="hidden @[440px]:inline text-xs text-accent font-mono shrink-0">WHERE</span>
            <input autoComplete="off"
              ref={filterInputRef}
              type="text"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={filterInput}
              onChange={handleWhereChange}
              onBlur={handleWhereBlur}
              onKeyDown={handleWhereKeyDown}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={autocompleteOpen && autocompleteItems.length > 0}
              aria-controls={autocompleteOpen && autocompleteItems.length > 0 ? whereListId : undefined}
              aria-activedescendant={autocompleteOpen && autocompleteItems.length > 0 ? `${whereListId}-${autocompleteIndex}` : undefined}
              className="bg-transparent border-none outline-none text-xs text-secondary w-full placeholder:text-surface-tertiary font-mono"
              placeholder={`${placeholderColumn} > 5 AND status = 'active'`}
            />

            {autocompleteOpen && autocompleteItems.length > 0 && (
              <ul
                id={whereListId}
                role="listbox"
                tabIndex={-1}
                className="absolute left-0 top-full mt-1 z-50 bg-elevated border border-default rounded-lg shadow-xl min-w-52 max-h-52 overflow-y-auto"
                onMouseDown={() => { autocompleteMouseDown.current = true; }}
                onMouseUp={() => { autocompleteMouseDown.current = false; }}
              >
                {autocompleteItems.map((col, idx) => (
                  <li
                    key={col.name}
                    id={`${whereListId}-${idx}`}
                    role="option"
                    aria-selected={idx === autocompleteIndex}
                    className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors first:rounded-t-lg last:rounded-b-lg ${
                      idx === autocompleteIndex
                        ? "bg-accent-primary/25 text-accent"
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
              {buildStructuredFilterClause(structuredFilters, quotingDriver, combinator) || (
                <em className="not-italic opacity-50">{t("toolbar.noActiveFilters")}</em>
              )}
            </span>
          </div>
        )}

        {/* ORDER BY */}
        <div className="relative flex items-center gap-1.5 flex-1 bg-base border border-default rounded px-2 py-1 focus-within:border-focus/50 transition-colors">
          <ArrowUpDown size={14} className="text-muted shrink-0" />
          <span className="hidden @[440px]:inline text-xs text-accent font-mono shrink-0">ORDER BY</span>
          <input autoComplete="off"
            ref={sortInputRef}
            type="text"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={sortInput}
            onChange={handleSortChange}
            onBlur={handleSortBlur}
            onKeyDown={handleSortKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={sortAcOpen && sortAcItems.length > 0}
            aria-controls={sortAcOpen && sortAcItems.length > 0 ? sortListId : undefined}
            aria-activedescendant={sortAcOpen && sortAcItems.length > 0 ? `${sortListId}-${sortAcIndex}` : undefined}
            className="bg-transparent border-none outline-none text-xs text-secondary w-full placeholder:text-surface-tertiary font-mono"
            placeholder={`${placeholderSort} DESC`}
          />

          {sortAcOpen && sortAcItems.length > 0 && (
            <ul
              id={sortListId}
              role="listbox"
              tabIndex={-1}
              className="absolute left-0 top-full mt-1 z-50 bg-elevated border border-default rounded-lg shadow-xl min-w-52 max-h-52 overflow-y-auto"
              onMouseDown={() => { sortAcMouseDown.current = true; }}
              onMouseUp={() => { sortAcMouseDown.current = false; }}
            >
              {sortAcItems.map((col, idx) => (
                <li
                  key={col.name}
                  id={`${sortListId}-${idx}`}
                  role="option"
                  aria-selected={idx === sortAcIndex}
                  className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer transition-colors first:rounded-t-lg last:rounded-b-lg ${
                    idx === sortAcIndex
                      ? "bg-accent-primary/25 text-accent"
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
        <div className="flex items-center gap-1.5 w-20 @[560px]:w-32 bg-base border border-default rounded px-2 py-1 focus-within:border-focus/50 transition-colors shrink-0">
          <ListFilter size={14} className="text-muted shrink-0" />
          <span className="hidden @[440px]:inline text-xs text-accent font-mono shrink-0">LIMIT</span>
          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
            type="number"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            onBlur={handleLimitBlur}
            onKeyDown={handleSortLimitKeyDown}
            className="bg-transparent border-none outline-none text-xs text-secondary w-full placeholder:text-surface-tertiary font-mono"
            placeholder={String(defaultLimit)}
          />
        </div>

        {/* Manual refresh + auto-refresh interval */}
        {onAutoRefreshChange && (
          <div className="flex items-center gap-1.5 shrink-0 text-xs text-secondary">
            <button type="button" onClick={onRefresh} disabled={refreshDisabled}
              aria-label={t("toolbar.autoRefresh.refresh")}
              title={t("toolbar.autoRefresh.refresh")}
              className={`p-1 rounded hover:text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                autoRefreshActive ? "text-accent" : "text-muted"
              }`}>
              <RefreshCw size={14} />
            </button>
            <label className="flex items-center gap-1.5">
              <span className={`hidden @[800px]:inline ${autoRefreshActive ? "text-accent" : ""}`}>
                {t("toolbar.autoRefresh.label")}
              </span>
              <select aria-label={t("toolbar.autoRefresh.label")}
                value={autoRefreshIntervalMs}
                onChange={(event) => onAutoRefreshChange(normalizeAutoRefreshInterval(Number(event.target.value)))}
                data-active={autoRefreshActive || undefined}
                className={`bg-base border rounded px-1 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                  autoRefreshActive
                    ? "border-accent-primary/50 text-accent font-medium"
                    : "border-default text-secondary"
                }`}>
                {AUTO_REFRESH_INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {interval ? t("toolbar.autoRefresh.seconds", { seconds: interval / 1000 }) : t("toolbar.autoRefresh.off")}
                  </option>
                ))}
              </select>
            </label>
            {/* Always mounted so screen readers announce text changes reliably. */}
            <span role="status" className="text-muted">
              {autoRefreshPaused
                ? t(autoRefreshPausedReason === "selection"
                  ? "toolbar.autoRefresh.pausedSelection"
                  : "toolbar.autoRefresh.paused")
                : ""}
            </span>
          </div>
        )}
        {/* Plugin extension slot */}
        <SlotAnchor
          name="data-grid.toolbar.actions"
          context={{}}
          className="flex items-center gap-1"
        />
      </div>

      {/* Inline filter panel — pushes the grid down so results stay visible */}
      {panelOpen && (
        // Layout wrapper: onKeyDown only catches Escape bubbling from the
        // filter controls inside, which carry the semantics.
        <div
          role="presentation"
          onKeyDown={handlePanelKeyDown}
          className="w-full bg-elevated border-b border-default/80"
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
            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label={t("toolbar.matchMode")}
                className="flex items-center rounded border border-default/60 overflow-hidden"
              >
                {(["AND", "OR"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={combinator === mode}
                    onClick={() => handleCombinatorChange(mode)}
                    className={`px-2 py-0.5 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                      combinator === mode
                        ? "bg-accent-primary/20 text-accent"
                        : "text-muted hover:text-secondary hover:bg-surface-secondary"
                    }`}
                  >
                    {mode === "AND" ? t("toolbar.matchAll") : t("toolbar.matchAny")}
                  </button>
                ))}
              </div>
              <button
                onClick={closePanel}
                title={t("toolbar.closePanelEsc")}
                className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-secondary hover:bg-surface-secondary transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Filter rows — scroll horizontally when the pane is narrower than a row */}
          <div className="divide-y divide-default/30 overflow-x-auto overflow-y-auto max-h-[40vh]">
            {structuredFilters.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-3">
                <span className="text-xs text-muted">{t("toolbar.noFilters")}</span>
                <button
                  onClick={handleAddFilter}
                  className="text-xs text-accent transition-colors"
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
                  onLoadValues={canPickValues ? loadValuesFor : undefined}
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
              className="px-2.5 py-1 rounded text-xs text-muted border border-default/70 hover:text-accent hover:border-accent-primary/50 transition-colors"
            >
              {t("toolbar.sql")}
            </button>

            <button
              onClick={handleAddFilter}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-muted border border-dashed border-default/70 hover:text-accent hover:border-accent-primary/50 transition-colors"
            >
              <Plus size={11} />
              {t("toolbar.addFilter")}
            </button>

            <div className="flex-1" />

            {/* Apply All — does NOT close panel */}
            <button
              onClick={handleApplyAll}
              className="px-3 py-1 rounded text-xs font-medium border transition-colors bg-accent-primary/20 border-accent-primary/50 text-accent hover:bg-accent-primary/30 hover:border-accent-primary/70"
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
  const [combinator, setCombinator] = useState<FilterCombinator>("AND");
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
      combinator={combinator}
      onCombinatorChange={setCombinator}
      appliedFilters={appliedFilters}
      onTriggerApplied={handleTriggerApplied}
      onResetApplied={handleResetApplied}
      onResetAllApplied={handleResetAllApplied}
    />
  );
};
