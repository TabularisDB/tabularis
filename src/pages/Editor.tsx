import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { reconstructTableQuery } from "../utils/editor";
import { serializePkKey, buildPkMap } from "../utils/dataGrid";
import { isMultiDatabaseCapable } from "../utils/database";
import { isReadonly } from "../utils/driverCapabilities";
import {
  useDangerousQueryGuard,
  DANGEROUS_QUERY_I18N,
} from "../hooks/useDangerousQueryGuard";
import {
  generateTempId,
  initializeNewRow,
  validatePendingInsertion,
  insertionToBackendData,
} from "../utils/pendingInsertions";
import { AiQueryModal } from "../components/modals/AiQueryModal";
import { AiExplainModal } from "../components/modals/AiExplainModal";
import { AiDropdownButton } from "../components/ui/AiDropdownButton";
import { VisualExplainModal } from "../components/modals/VisualExplainModal";
import {
  Play,
  Plus,
  Minus,
  Download,
  Square,
  ChevronDown,
  ChevronUp,
  Save,
  X,
  Database,
  Table as TableIcon,
  FileCode,
  Network,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  XCircle,
  Trash2,
  Check,
  BookOpen,
  Pencil,
  Hash,
  Loader2,
  Copy,
  FileText,
  FileJson,
  Maximize2,
  Minimize2,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { TableToolbar } from "../components/ui/TableToolbar";
import { DataGrid } from "../components/ui/DataGrid";
import { MultiResultPanel } from "../components/ui/MultiResultPanel";
import { ErrorDisplay } from "../components/ui/ErrorDisplay";
import { NewRowModal } from "../components/modals/NewRowModal";
import { QuerySelectionModal } from "../components/modals/QuerySelectionModal";
import { ConfirmModal } from "../components/modals/ConfirmModal";
import { ExplainSelectionModal } from "../components/modals/ExplainSelectionModal";
import { TabSwitcherModal } from "../components/modals/TabSwitcherModal";
import { QueryModal } from "../components/modals/QueryModal";
import { QueryParamsModal } from "../components/modals/QueryParamsModal";
import { ErrorModal } from "../components/modals/ErrorModal";
import { VisualQueryBuilder } from "../components/ui/VisualQueryBuilder";
import { ContextMenu } from "../components/ui/ContextMenu";
import {
  ExportProgressModal,
  type ExportStatus,
} from "../components/modals/ExportProgressModal";
import { splitQueries, extractTableName, getExplainableQueries, statementLabel } from "../utils/sql";
import {
  createResultEntries,
  updateResultEntry,
  removeResultEntry,
  removeOtherEntries,
  removeEntriesToRight,
  removeEntriesToLeft,
} from "../utils/multiResult";
import {
  extractQueryParams,
  interpolateQueryParams,
} from "../utils/queryParameters";
import { formatDuration } from "../utils/formatTime";
import {
  buildSyncPayload,
  applyAction,
  RESULTS_SYNC_EVENT,
  RESULTS_ACTION_EVENT,
  RESULTS_READY_EVENT,
  RESULTS_CLOSED_EVENT,
  type ResultsWindowActionHandlers,
  type ResultsReadyPayload,
  type ResultsActionEnvelope,
  type ResultsClosedPayload,
} from "../utils/resultsWindowSync";
import { SqlEditorWrapper } from "../components/ui/SqlEditorWrapper";
import { NotebookView } from "../components/notebook/NotebookView";
import { useSqlAutocompleteRegistration } from "../hooks/useSqlAutocompleteRegistration";
import { createNotebook, renameNotebook } from "../utils/notebookStore";
import { type OnMount, type Monaco } from "@monaco-editor/react";
import { save } from "@tauri-apps/plugin-dialog";
import { useAlert } from "../hooks/useAlert";
import { useDatabase } from "../hooks/useDatabase";
import { useDrivers } from "../hooks/useDrivers";
import { getConnectionAccent } from "../utils/driverUI";
import { useSavedQueries } from "../hooks/useSavedQueries";
import { useQueryHistory } from "../hooks/useQueryHistory";
import { useSettings } from "../hooks/useSettings";
import { useEditor } from "../hooks/useEditor";
import { useConnectionLayoutContext } from "../hooks/useConnectionLayoutContext";
import { useKeybindings } from "../hooks/useKeybindings";
import type {
  BatchStatementResult,
  QueryResult,
  Tab,
  PendingInsertion,
  TableColumn,
  ForeignKey,
} from "../types/editor";
import { buildForeignKeyFilterClause } from "../utils/foreignKeys";
import { formatSqlIdentifier } from "../utils/identifiers";
import { RelatedRecordsPanel } from "../components/ui/RelatedRecordsPanel";
import {
  getTabScrollState,
  getAdjacentTabIndex,
  resolveNextTabId,
  isFocusedPane,
} from "../utils/tabScroll";
import clsx from "clsx";

interface EditorState {
  initialQuery?: string;
  tableName?: string;
  queryName?: string;
  preventAutoRun?: boolean;
  readOnly?: boolean;
  materialized?: boolean;
  schema?: string;
  targetConnectionId?: string;
  title?: string;
}

interface ExportProgress {
  rows_processed: number;
}

const CHEVRON_SELECT_STYLE: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right center",
};

export const Editor = () => {
  const { t } = useTranslation();
  const {
    activeConnectionId,
    connections,
    views,
    materializedViews,
    activeDriver,
    activeSchema,
    activeCapabilities,
    selectedDatabases,
    activeConnectionName,
    activeDatabaseName,
  } = useDatabase();
  const { allDrivers } = useDrivers();
  const { explorerConnectionId } = useConnectionLayoutContext();
  const { settings } = useSettings();
  const { saveQuery } = useSavedQueries();
  const { addEntry: addHistoryEntry } = useQueryHistory();
  const {
    tabs,
    activeTab,
    activeTabId,
    updateTab,
    updateResultEntry: patchResultEntry,
    addTab,
    setActiveTabId,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    closeTabsToLeft,
    closeTabsToRight,
  } = useEditor();
  const location = useLocation();
  const { matchesShortcut, isMac } = useKeybindings();
  const { showAlert } = useAlert();
  const navigate = useNavigate();

  const driverReadonly = isReadonly(activeCapabilities);
  const activeDialect = activeCapabilities?.sql_dialect;

  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabTitle, setEditingTabTitle] = useState("");

  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    message: string;
  }>({ isOpen: false, message: "" });

  const [exportState, setExportState] = useState<{
    isOpen: boolean;
    status: ExportStatus;
    rowsProcessed: number;
    fileName: string;
    errorMessage?: string;
  }>({
    isOpen: false,
    status: "exporting",
    rowsProcessed: 0,
    fileName: "",
  });

  const [activeFkQuery, setActiveFkQuery] = useState<{
    fk: ForeignKey;
    value: unknown;
    sourceColumnType?: string;
  } | null>(null);

  useEffect(() => {
    setActiveFkQuery(null);
  }, [activeTabId]);

  useEffect(() => {
    const unlisten = listen<ExportProgress>("export_progress", (event) => {
      setExportState((prev) => ({
        ...prev,
        rowsProcessed: event.payload.rows_processed,
      }));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const startTabRename = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    setEditingTabId(tabId);
    setEditingTabTitle(tab.title);
  }, []);

  const commitTabRename = useCallback(() => {
    const tabId = editingTabId;
    if (!tabId) return;
    setEditingTabId(null);
    const title = editingTabTitle.trim();
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab || !title || title === tab.title) return;
    updateTab(tabId, { title });
    // Persist the rename to the notebook file too (covers background tabs whose
    // NotebookView isn't mounted to sync the title automatically).
    if (tab.type === "notebook" && tab.notebookId && tab.connectionId) {
      renameNotebook(tab.notebookId, tab.connectionId, title).catch((e) =>
        console.error("Failed to rename notebook:", e),
      );
    }
  }, [editingTabId, editingTabTitle, updateTab]);

  const handleConvertToConsole = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;

      const effectiveSchema =
        activeCapabilities?.schemas === true ? tab.schema : undefined;
      const tabForQuery = { ...tab, schema: effectiveSchema };
      const query =
        tab.type === "table" && tab.activeTable
          ? reconstructTableQuery(tabForQuery, activeDriver ?? undefined)
          : tab.query;

      addTab({
        type: "console",
        title: `Console - ${tab.title}`,
        query: query,
        connectionId: tab.connectionId,
      });
    },
    [addTab, activeDriver, activeCapabilities?.schemas],
  );

  const [saveQueryModal, setSaveQueryModal] = useState<{
    isOpen: boolean;
    sql: string;
  }>({ isOpen: false, sql: "" });

  const [queryParamsModal, setQueryParamsModal] = useState<{
    isOpen: boolean;
    sql: string;
    parameters: string[];
    pendingPageNum: number;
    pendingTabId?: string;
    mode: "run" | "save";
    pendingMultiQueries?: string[];
  }>({
    isOpen: false,
    sql: "",
    parameters: [],
    pendingPageNum: 1,
    mode: "save",
  });

  const [showNewRowModal, setShowNewRowModal] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [editorHeight, setEditorHeight] = useState(300);
  const editorHeightRef = useRef(300);
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(false);
  // Ids of tabs whose results are detached into their own separate windows (one
  // window per tab). Each window keeps showing its tab even when the user
  // switches tabs in the main window.
  const [detachedTabIds, setDetachedTabIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Mirror of detachedTabIds for use inside callbacks/refs without re-creating
  // them or reading stale closures. Kept in sync alongside tabsRef below.
  const detachedTabIdsRef = useRef(detachedTabIds);
  const isDragging = useRef(false);
  const rafRef = useRef<number | null>(null);
  const editorsRef = useRef<Record<string, Parameters<OnMount>[0]>>({});
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);

  const [selectableQueries, setSelectableQueries] = useState<string[]>([]);
  const [isQuerySelectionModalOpen, setIsQuerySelectionModalOpen] =
    useState(false);
  const {
    pending: dangerousQuery,
    guardQuery: guardDangerousQuery,
    resolve: resolveDangerousQuery,
  } = useDangerousQueryGuard();
  const [isTabSwitcherOpen, setIsTabSwitcherOpen] = useState(false);
  const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const [isDbDropdownOpen, setIsDbDropdownOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isAiExplainModalOpen, setIsAiExplainModalOpen] = useState(false);
  const [isVisualExplainOpen, setIsVisualExplainOpen] = useState(false);
  const [visualExplainQuery, setVisualExplainQuery] = useState<string | null>(null);
  const [isExplainSelectionOpen, setIsExplainSelectionOpen] = useState(false);
  const [explainSelectableQueries, setExplainSelectableQueries] = useState<{ query: string; index: number }[]>([]);
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [tempPage, setTempPage] = useState("1");
  const [isCountLoading, setIsCountLoading] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const [copyFormat, setCopyFormat] = useState<"csv" | "json" | "sql-insert">(
    settings.copyFormat ?? "csv",
  );
  const [csvDelimiter, setCsvDelimiter] = useState(
    settings.csvDelimiter ?? ",",
  );
  const [csvIncludeHeaders, setCsvIncludeHeaders] = useState(
    settings.csvIncludeHeaders ?? true,
  );

  const activeTabType = activeTab?.type;
  const activeTabQuery = activeTab?.query;
  const isTableTab = activeTab?.type === "table";
  const isNotebookTab = activeTab?.type === "notebook";
  const isMultiDb =
    isMultiDatabaseCapable(activeCapabilities) && selectedDatabases.length > 1;
  const isEditorOpen =
    !isTableTab && (activeTab?.isEditorOpen ?? activeTab?.type !== "table");

  const handleCloseTab = useCallback(
    (tabId: string) => {
      delete editorsRef.current[tabId];
      closeTab(tabId);
    },
    [closeTab],
  );

  // Update window title when the active tab changes
  useEffect(() => {
    const updateTitle = async () => {
      try {
        let title = "tabularis";
        if (activeConnectionName && activeDatabaseName) {
          const schemaSuffix =
            activeSchema && activeCapabilities?.schemas === true
              ? `/${activeSchema}`
              : "";
          let dbDisplay: string;
          if (isMultiDb) {
            dbDisplay =
              activeTab?.schema ?? selectedDatabases[0] ?? activeDatabaseName;
          } else {
            dbDisplay = activeDatabaseName;
          }
          title = `tabularis - ${activeConnectionName} (${dbDisplay}${schemaSuffix})`;
        }
        await invoke("set_window_title", { title });
      } catch (e) {
        console.error("Failed to update window title", e);
      }
    };
    updateTitle();
  }, [
    activeTabId,
    activeTab?.schema,
    activeConnectionName,
    activeDatabaseName,
    activeSchema,
    activeCapabilities,
    isMultiDb,
    selectedDatabases,
  ]);

  // Define updateActiveTab first to be used in handleQueryChange
  const updateActiveTab = useCallback(
    (partial: Partial<Tab>) => {
      if (activeTabId) updateTab(activeTabId, partial);
    },
    [activeTabId, updateTab],
  );

  // Placeholder Logic - memoized to avoid recalculation on every render

  const placeholders = useMemo(
    () => ({
      column: activeTab?.result?.columns?.[0] || "id",
      sort: activeTab?.result?.columns?.[0] || "created_at",
    }),
    [activeTab?.result?.columns],
  );

  const dropdownQueries = useMemo(() => {
    if (activeTabType === "query_builder" && activeTabQuery) {
      return [activeTabQuery];
    }
    return selectableQueries;
  }, [activeTabType, activeTabQuery, selectableQueries]);

  const tabsRef = useRef<Tab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  // Last executed SQL per tab — used to preserve the loaded row count across
  // pagination of the SAME query while resetting it when the query changes.
  const lastRunQueryRef = useRef<Record<string, string>>({});
  // Stable refs for functions used inside Monaco actions (which capture closures at mount time)
  const runQueryRef = useRef<typeof runQuery>(null!);
  const runMultipleQueriesRef = useRef<typeof runMultipleQueries>(null!);
  const openExplainForQueryRef = useRef<(query: string) => void>(null!);
  const activeDialectRef = useRef<typeof activeDialect>(undefined);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el || !activeTabId) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    if (idx === -1) return;
    const tabEl = el.children[idx] as HTMLElement | undefined;
    tabEl?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs]);

  const updateScrollArrows = useCallback(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    const { canScrollLeft, canScrollRight } = getTabScrollState(el);
    setCanScrollLeft(canScrollLeft);
    setCanScrollRight(canScrollRight);
  }, []);

  const scrollTabs = useCallback(
    (direction: "left" | "right") => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
      const targetIndex = getAdjacentTabIndex(
        currentIndex,
        tabs.length,
        direction,
      );
      if (targetIndex === null) return;
      const targetTab = tabs[targetIndex];
      setActiveTabId(targetTab.id);
      const el = tabScrollRef.current;
      if (!el) return;
      const tabEl = el.children[targetIndex] as HTMLElement | undefined;
      tabEl?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    },
    [tabs, activeTabId, setActiveTabId],
  );
  const processingRef = useRef<string | null>(null);
  const pendingExecutionsRef = useRef<
    Record<string, { sql: string; page: number }>
  >({});

  const selectionHasPending = useMemo(() => {
    if (!activeTab) return false;
    const {
      pendingChanges,
      pendingDeletions,
      pendingInsertions,
      selectedRows,
      result,
      pkColumns,
    } = activeTab;
    const hasGlobalPending =
      (pendingChanges && Object.keys(pendingChanges).length > 0) ||
      (pendingDeletions && Object.keys(pendingDeletions).length > 0) ||
      (pendingInsertions && Object.keys(pendingInsertions).length > 0);

    if (!selectedRows || selectedRows.length === 0) return hasGlobalPending;

    const existingRowCount = result?.rows.length || 0;

    return selectedRows.some((rowIndex) => {
      // Check if this is an insertion row (displayIndex >= existingRowCount)
      if (rowIndex >= existingRowCount) {
        // This is an insertion row
        return pendingInsertions && Object.keys(pendingInsertions).length > 0;
      }

      // This is an existing row - check for changes/deletions
      if (!result || !pkColumns || pkColumns.length === 0) return false;
      const pkIndices = pkColumns.map((c) => result.columns.indexOf(c));
      if (pkIndices.some((i) => i === -1)) return false;

      const row = result.rows[rowIndex];
      if (!row) return false;
      const pkKey = serializePkKey(buildPkMap(pkColumns, row, pkIndices));
      return (
        (pendingChanges && pendingChanges[pkKey]) ||
        (pendingDeletions && pendingDeletions[pkKey])
      );
    });
  }, [activeTab]);

  const hasPendingChanges = useMemo(() => {
    return (
      (activeTab?.pendingChanges &&
        Object.keys(activeTab.pendingChanges).length > 0) ||
      (activeTab?.pendingDeletions &&
        Object.keys(activeTab.pendingDeletions).length > 0) ||
      (activeTab?.pendingInsertions &&
        Object.keys(activeTab.pendingInsertions).length > 0)
    );
  }, [
    activeTab?.pendingChanges,
    activeTab?.pendingDeletions,
    activeTab?.pendingInsertions,
  ]);

  useEffect(() => {
    tabsRef.current = tabs;
    activeTabIdRef.current = activeTabId;
    detachedTabIdsRef.current = detachedTabIds;
  }, [tabs, activeTabId, detachedTabIds]);

  useEffect(() => {
    updateScrollArrows();
  }, [tabs, updateScrollArrows]);

  const fetchPkColumn = useCallback(
    async (table: string, tabId?: string, tabSchema?: string) => {
      if (!activeConnectionId) return;
      const effectiveSchema = tabSchema ?? activeSchema;
      try {
        const [cols, fks] = await Promise.all([
          invoke<TableColumn[]>("get_columns", {
            connectionId: activeConnectionId,
            tableName: table,
            ...(effectiveSchema ? { schema: effectiveSchema } : {}),
          }),
          invoke<ForeignKey[]>("get_foreign_keys", {
            connectionId: activeConnectionId,
            tableName: table,
            ...(effectiveSchema ? { schema: effectiveSchema } : {}),
          }).catch((e) => {
            console.warn("Failed to fetch foreign keys:", e);
            return [] as ForeignKey[];
          }),
        ]);
        const pks = cols.filter((c) => c.is_pk).map((c) => c.name);
        const autoInc = cols
          .filter((c) => c.is_auto_increment)
          .map((c) => c.name);
        const defaultVal = cols
          .filter(
            (c) => c.default_value !== undefined && c.default_value !== null,
          )
          .map((c) => c.name);
        const nullable = cols.filter((c) => c.is_nullable).map((c) => c.name);
        const targetId = tabId || activeTabId;
        if (targetId)
          updateTab(targetId, {
            pkColumns: pks.length > 0 ? pks : null,
            autoIncrementColumns: autoInc,
            defaultValueColumns: defaultVal,
            nullableColumns: nullable,
            columnMetadata: cols,
            foreignKeys: fks,
          });
      } catch (e) {
        console.error("Failed to fetch PK:", e);
        // Even if PK fetch fails, set pkColumns to null to unblock the UI
        const targetId = tabId || activeTabId;
        if (targetId)
          updateTab(targetId, {
            pkColumns: null,
            autoIncrementColumns: [],
            defaultValueColumns: [],
            nullableColumns: [],
            columnMetadata: [],
            foreignKeys: [],
          });
      }
    },
    [activeConnectionId, activeTabId, updateTab, activeSchema],
  );

  const stopQuery = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      await invoke("cancel_query", { connectionId: activeConnectionId });
      updateActiveTab({ isLoading: false });
    } catch (e) {
      console.error("Failed to stop:", e);
    }
  }, [activeConnectionId, updateActiveTab]);

  const runQuery = useCallback(
    async (
      sql?: string,
      pageNum: number = 1,
      tabId?: string,
      paramsOverride?: Record<string, string>,
      filterOverride?: string,
      sortOverride?: string,
      limitOverride?: number,
      preservePendingChanges?: {
        pendingChanges?: Record<
          string,
          { pkOriginalValue: unknown; changes: Record<string, unknown> }
        >;
        pendingDeletions?: Record<string, unknown>;
        pendingInsertions?: Record<string, PendingInsertion>;
      },
    ) => {
      const targetTabId = tabId || activeTabIdRef.current;
      if (!activeConnectionId || !targetTabId) return;

      const targetTab = tabsRef.current.find((t) => t.id === targetTabId);
      if (!targetTab) return;

      // When the target tab's results live in a detached window, this run was
      // triggered from that window: don't touch main-window-only UI state
      // (results panel, params modal) — it belongs to whatever tab is active here.
      const isDetached = detachedTabIdsRef.current.has(targetTabId);

      let textToRun = sql?.trim() || targetTab?.query;
      // For Table Tabs, reconstruct query if filter/sort are present
      if (targetTab?.type === "table" && targetTab.activeTable) {
        const effectiveSchema =
          activeCapabilities?.schemas === true ? targetTab.schema : undefined;
        const tabForQuery = { ...targetTab, schema: effectiveSchema };
        textToRun = reconstructTableQuery(
          tabForQuery,
          activeDriver ?? undefined,
          {
            filterOverride:
              filterOverride !== undefined ? filterOverride : undefined,
            sortOverride: sortOverride !== undefined ? sortOverride : undefined,
            limitOverride:
              limitOverride !== undefined ? limitOverride : undefined,
            wrapLimitSubquery: true,
          },
        );
      }

      if (!textToRun || !textToRun.trim()) return;

      if (!(await guardDangerousQuery(textToRun))) return;

      // Check for parameters
      const params = extractQueryParams(textToRun);
      if (params.length > 0) {
        const storedParams = paramsOverride || targetTab.queryParams || {};
        const missingParams = params.filter(
          (p) => storedParams[p] === undefined || storedParams[p].trim() === "",
        );

        // If we have missing params
        if (missingParams.length > 0) {
          // The params modal lives in the main window; don't pop it for a run
          // triggered from a detached window (it would hijack the active tab).
          if (!isDetached) {
            setQueryParamsModal({
              isOpen: true,
              sql: textToRun,
              parameters: params,
              pendingPageNum: pageNum,
              pendingTabId: targetTabId,
              mode: "run",
            });
          }
          return;
        }

        // Interpolate parameters before execution
        textToRun = interpolateQueryParams(textToRun, storedParams);
      }

      // Automatically open the results panel when running a query — but only
      // for the main window; a detached run must not re-expand the main panel.
      if (!isDetached) {
        setIsResultsCollapsed(false);
      }

      // Preserve total_rows across page changes so the count doesn't disappear
      const previousTotalRows =
        targetTab?.result?.pagination?.total_rows ?? null;

      updateTab(targetTabId, {
        isLoading: true,
        error: "",
        result: null,
        executionTime: null,
        page: pageNum,
        // Clear multi-result state when running a single query
        results: undefined,
        activeResultId: undefined,
        // Clear pending changes and selection when running a new query (unless preserving)
        pendingChanges: preservePendingChanges?.pendingChanges,
        pendingDeletions: preservePendingChanges?.pendingDeletions,
        pendingInsertions: preservePendingChanges?.pendingInsertions,
        selectedRows: [],
      });

      const shouldRecordHistory =
        targetTab?.type === "console" || targetTab?.type === "query_builder";

      const schema = targetTab?.schema ?? activeSchema;
      // For history: fall back to activeDatabaseName for multi-db connections
      // where schema may not be set on the tab
      const historyDb = schema
        || (isMultiDb ? activeDatabaseName : undefined)
        || undefined;

      try {
        const start = performance.now();
        // Use settings.resultPageSize for Page Size (pagination), ignoring the "Total Limit" input which is handled in SQL
        // Fallback to 100 if settings not loaded yet
        const pageSize =
          settings.resultPageSize && settings.resultPageSize > 0
            ? settings.resultPageSize
            : 100;
        const res = await invoke<QueryResult>("execute_query", {
          connectionId: activeConnectionId,
          query: textToRun,
          limit: pageSize,
          page: pageNum,
          ...(schema ? { schema } : {}),
        });
        const end = performance.now();

        // Fetch PK column if this is a table tab OR if the query references a table
        const currentTab = tabsRef.current.find((t) => t.id === targetTabId);
        let tableName = currentTab?.activeTable;

        // If not a table tab, try to extract table name from the query
        if (!tableName && textToRun) {
          const extracted = extractTableName(textToRun);
          // Reject views and materialized views — they are not row-editable
          // (materialized views only accept REFRESH, not INSERT/UPDATE/DELETE).
          if (
            extracted &&
            !views.some((v) => v.name === extracted) &&
            !materializedViews.some((v) => v.name === extracted)
          ) {
            tableName = extracted;
          }
        }

        const isSameQuery = lastRunQueryRef.current[targetTabId] === textToRun;
        lastRunQueryRef.current[targetTabId] = textToRun;
        const resultWithCount =
          res.pagination &&
          res.pagination.total_rows === null &&
          previousTotalRows !== null &&
          isSameQuery
            ? {
                ...res,
                pagination: {
                  ...res.pagination,
                  total_rows: previousTotalRows,
                },
              }
            : res;

        updateTab(targetTabId, {
          result: resultWithCount,
          executionTime: end - start,
          isLoading: false,
          activeTable: tableName || null,
        });

        if (tableName) {
          // Fetch column metadata in the background; tab updates when ready
          fetchPkColumn(tableName, targetTabId, targetTab?.schema ?? undefined);
        } else {
          updateTab(targetTabId, { pkColumns: null });
        }

        if (shouldRecordHistory) {
          addHistoryEntry(
            textToRun,
            end - start,
            "success",
            res.pagination?.total_rows ?? null,
            null,
            historyDb,
          );
        }
      } catch (err) {
        updateTab(targetTabId, {
          error: typeof err === "string" ? err : t("editor.queryFailed"),
          isLoading: false,
        });

        if (shouldRecordHistory) {
          addHistoryEntry(
            textToRun,
            null,
            "error",
            null,
            typeof err === "string" ? err : t("editor.queryFailed"),
            historyDb,
          );
        }
      }
    },
    [
      activeConnectionId,
      updateTab,
      settings.resultPageSize,
      fetchPkColumn,
      t,
      activeDriver,
      activeSchema,
      activeCapabilities?.schemas,
      views,
      materializedViews,
      isMultiDb,
      activeDatabaseName,
      addHistoryEntry,
      guardDangerousQuery,
    ],
  );

  const runMultipleQueries = useCallback(
    async (queries: string[], paramsOverride?: Record<string, string>) => {
      const targetTabId = activeTabIdRef.current;
      if (!activeConnectionId || !targetTabId) return;

      const targetTab = tabsRef.current.find((t) => t.id === targetTabId);
      if (!targetTab) return;

      if (!(await guardDangerousQuery(queries))) return;

      // Collect all unique parameters across all queries
      const allParams = [
        ...new Set(queries.flatMap((q) => extractQueryParams(q))),
      ];
      if (allParams.length > 0) {
        const storedParams =
          paramsOverride || targetTab.queryParams || {};
        const missingParams = allParams.filter(
          (p) =>
            storedParams[p] === undefined || storedParams[p].trim() === "",
        );
        if (missingParams.length > 0) {
          setQueryParamsModal({
            isOpen: true,
            sql: queries.join(";\n"),
            parameters: allParams,
            pendingPageNum: 1,
            pendingTabId: targetTabId,
            mode: "run",
            pendingMultiQueries: queries,
          });
          return;
        }
        // Interpolate all queries with the stored params
        queries = queries.map((q) => interpolateQueryParams(q, storedParams));
      }

      const pageSize =
        settings.resultPageSize && settings.resultPageSize > 0
          ? settings.resultPageSize
          : 100;
      const schema = targetTab?.schema ?? activeSchema;
      const historyDb = schema
        || (isMultiDb ? activeDatabaseName : undefined)
        || undefined;

      const entries = createResultEntries(targetTabId, queries);

      setIsResultsCollapsed(false);
      updateTab(targetTabId, {
        results: entries,
        activeResultId: entries[0].id,
        result: null,
        error: "",
        isLoading: true,
        executionTime: null,
      });

      const shouldRecordHistory =
        targetTab?.type === "console" || targetTab?.type === "query_builder";

      // Resolves a single result tab the moment its statement finishes:
      // records history and patches that entry in place (no whole-array
      // rewrite) so the UI shows per-statement status in real time instead of
      // waiting for the entire batch.
      const applied = new Set<number>();
      const applyStatement = (index: number, item: BatchStatementResult) => {
        const entry = entries[index];
        if (!entry) return;
        const execTime = item?.execution_time_ms ?? null;
        if (item?.error) {
          if (shouldRecordHistory) {
            addHistoryEntry(
              entry.query,
              execTime,
              "error",
              null,
              item.error,
              historyDb,
            );
          }
          patchResultEntry(targetTabId, entry.id, {
            error: item.error,
            executionTime: execTime,
            isLoading: false,
          });
          return;
        }
        const res = item?.result ?? null;
        const tableName = extractTableName(entry.query) ?? null;
        if (shouldRecordHistory) {
          addHistoryEntry(
            entry.query,
            execTime,
            "success",
            res?.pagination?.total_rows ?? null,
            null,
            historyDb,
          );
        }
        patchResultEntry(targetTabId, entry.id, {
          result: res,
          executionTime: execTime,
          isLoading: false,
          activeTable: tableName,
        });
      };

      // A unique id ties the live events to this run, so a listener ignores
      // events from any other batch executing concurrently.
      const batchId = `batch-${targetTabId}-${performance.now()}`;
      // Registered before `invoke` so no early statement event is missed.
      const unlisten = await listen<{
        batch_id: string;
        index: number;
        statement: BatchStatementResult;
      }>("batch-statement-complete", (event) => {
        const p = event.payload;
        if (p.batch_id !== batchId || applied.has(p.index)) return;
        applied.add(p.index);
        applyStatement(p.index, p.statement);
      });

      // Run the whole script on a single pooled connection so statements
      // can share session state (SET @var, LAST_INSERT_ID(), transactions,
      // TEMP TABLE).
      const batchStart = performance.now();
      let batchResults: BatchStatementResult[];
      try {
        batchResults = await invoke<BatchStatementResult[]>(
          "execute_query_batch",
          {
            connectionId: activeConnectionId,
            queries: entries.map((e) => e.query),
            limit: pageSize,
            page: 1,
            batchId,
            ...(schema ? { schema } : {}),
          },
        );
      } catch (err) {
        unlisten();
        // Batch-level failure (e.g. connection acquisition, cancellation):
        // mark only the entries that haven't already resolved via a live event
        // as failed, so statements that completed first keep their results.
        const fallbackElapsed = performance.now() - batchStart;
        const message = typeof err === "string" ? err : t("editor.queryFailed");
        entries.forEach((entry, idx) => {
          if (applied.has(idx)) return;
          if (shouldRecordHistory) {
            addHistoryEntry(
              entry.query,
              fallbackElapsed,
              "error",
              null,
              message,
              historyDb,
            );
          }
          patchResultEntry(targetTabId, entry.id, {
            error: message,
            executionTime: fallbackElapsed,
            isLoading: false,
          });
        });
        updateTab(targetTabId, { isLoading: false });
        return;
      }

      unlisten();

      // Reconcile any statement whose live event was missed (dropped/raced),
      // then clear the tab-level loading flag.
      batchResults.forEach((item, idx) => {
        if (applied.has(idx)) return;
        applied.add(idx);
        applyStatement(idx, item);
      });
      updateTab(targetTabId, { isLoading: false });
    },
    [activeConnectionId, updateTab, patchResultEntry, settings.resultPageSize, activeSchema, t, isMultiDb, activeDatabaseName, addHistoryEntry, guardDangerousQuery],
  );

  // Auto-run entry point for navigation-initiated executions (sidebar "open
  // and run" flows). Multi-statement scripts — e.g. a routine invocation with
  // OUT session variables (SET / CALL / SELECT) — must go through the batch
  // path so every statement shares one connection and session state survives;
  // a single statement keeps the plain runQuery path.
  const runAutoQuery = useCallback(
    (sql: string, page: number, tabId: string) => {
      const statements = splitQueries(sql, activeDialect);
      if (statements.length > 1) {
        runMultipleQueries(statements);
      } else {
        runQuery(sql, page, tabId);
      }
    },
    [activeDialect, runMultipleQueries, runQuery],
  );

  const runResultEntryPage = useCallback(
    async (entryId: string, pageNum: number, tabIdArg?: string) => {
      const targetTabId = tabIdArg ?? activeTabIdRef.current;
      if (!activeConnectionId || !targetTabId) return;

      const currentTab = tabsRef.current.find((t) => t.id === targetTabId);
      const entry = currentTab?.results?.find((r) => r.id === entryId);
      if (!entry) return;

      const pageSize =
        settings.resultPageSize && settings.resultPageSize > 0
          ? settings.resultPageSize
          : 100;
      const schema = currentTab?.schema ?? activeSchema;

      // Mark this entry as loading
      if (currentTab?.results) {
        updateTab(targetTabId, {
          results: updateResultEntry(currentTab.results, entryId, {
            isLoading: true,
          }),
        });
      }

      try {
        const start = performance.now();
        const res = await invoke<QueryResult>("execute_query", {
          connectionId: activeConnectionId,
          query: entry.query,
          limit: pageSize,
          page: pageNum,
          ...(schema ? { schema } : {}),
        });
        const end = performance.now();

        const latestTab = tabsRef.current.find((t) => t.id === targetTabId);
        if (latestTab?.results) {
          const previousTotalRows =
            entry.result?.pagination?.total_rows ?? null;
          const resultWithCount =
            res.pagination &&
            res.pagination.total_rows === null &&
            previousTotalRows !== null
              ? {
                  ...res,
                  pagination: {
                    ...res.pagination,
                    total_rows: previousTotalRows,
                  },
                }
              : res;

          updateTab(targetTabId, {
            results: updateResultEntry(latestTab.results, entryId, {
              result: resultWithCount,
              executionTime: end - start,
              isLoading: false,
              page: pageNum,
            }),
          });
        }
      } catch (err) {
        const latestTab = tabsRef.current.find((t) => t.id === targetTabId);
        if (latestTab?.results) {
          updateTab(targetTabId, {
            results: updateResultEntry(latestTab.results, entryId, {
              error:
                typeof err === "string" ? err : t("editor.queryFailed"),
              isLoading: false,
            }),
          });
        }
      }
    },
    [activeConnectionId, updateTab, settings.resultPageSize, activeSchema, t],
  );

  const loadCount = useCallback(
    async (tabIdArg?: string) => {
      const tab = tabIdArg
        ? tabsRef.current.find((t) => t.id === tabIdArg)
        : activeTab;
      if (!tab?.result?.pagination || !activeConnectionId) return;
      // Count the reconstructed filtered query, not tab.query (which omits the
      // filter box's WHERE); LIMIT is dropped so it can't cap the count.
      const countTarget =
        tab.type === "table" && tab.activeTable
          ? reconstructTableQuery(
              {
                ...tab,
                schema:
                  activeCapabilities?.schemas === true ? tab.schema : undefined,
              },
              activeDriver ?? undefined,
              { sortOverride: null, limitOverride: null },
            )
          : tab.query;
      // setIsCountLoading drives the spinner in the main window only; skip it for
      // a count triggered from a detached window (its own window owns its spinner).
      const isDetached = detachedTabIdsRef.current.has(tab.id);
      if (!isDetached) setIsCountLoading(true);
      try {
        const total = await invoke<number>("count_query", {
          connectionId: activeConnectionId,
          query: countTarget,
          schema: tab.schema ?? activeSchema,
        });
        const latest = tabsRef.current.find((t) => t.id === tab.id) ?? tab;
        if (!latest.result?.pagination) return;
        updateTab(tab.id, {
          result: {
            ...latest.result,
            pagination: { ...latest.result.pagination, total_rows: total },
          },
        });
      } finally {
        if (!isDetached) setIsCountLoading(false);
      }
    },
    [
      activeTab,
      activeConnectionId,
      activeSchema,
      activeDriver,
      activeCapabilities?.schemas,
      updateTab,
    ],
  );

  // --- Detached results windows (one per detached tab) ---
  const handleDetachResults = useCallback(async () => {
    if (!activeTab) return;
    const tabId = activeTab.id;
    try {
      await invoke("open_results_window", {
        tabId,
        title: `${activeTab.title} — Query Results`,
      });
      setDetachedTabIds((prev) => new Set(prev).add(tabId));
    } catch (e) {
      console.error("Failed to detach results", e);
    }
  }, [activeTab]);

  const handleReattachResults = useCallback(async (tabId: string) => {
    try {
      await invoke("close_results_window", { tabId });
    } catch (e) {
      console.error("Failed to close results window", e);
    }
    setDetachedTabIds((prev) => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  // Push each detached tab's result state to its window whenever the tabs
  // change (every detached tab is re-synced; its window filters by tabId).
  useEffect(() => {
    if (detachedTabIds.size === 0) return;
    for (const id of detachedTabIds) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        emit(
          RESULTS_SYNC_EVENT,
          buildSyncPayload(tab, {
            connectionId: activeConnectionId,
            copyFormat,
            csvDelimiter,
            csvIncludeHeaders,
          }),
        );
      }
    }
  }, [
    tabs,
    detachedTabIds,
    activeConnectionId,
    copyFormat,
    csvDelimiter,
    csvIncludeHeaders,
  ]);

  // If a detached tab is closed in the main window, close its orphaned window.
  // Closing the window emits RESULTS_CLOSED_EVENT, whose listener owns pruning
  // detachedTabIds — so this effect stays side-effect-only (no setState here).
  useEffect(() => {
    for (const id of detachedTabIds) {
      if (!tabs.some((t) => t.id === id)) {
        invoke("close_results_window", { tabId: id }).catch(() => {});
      }
    }
  }, [tabs, detachedTabIds]);

  // Respond to the detached windows' handshakes and forwarded actions. The main
  // window owns all query/DB logic, so actions map onto the existing handlers
  // targeting the tab named in each event (not necessarily the active one).
  //
  // Registered unconditionally (no detachedTabIds.size gate): a freshly opened
  // window emits its ready handshake as soon as it boots, and listen() registers
  // asynchronously — gating behind the first detach races that emit and can leave
  // the window stuck on "Loading…". Each handler self-guards (action via
  // detachedTabIdsRef, ready via the tabsRef lookup, closed via prev.has).
  useEffect(() => {
    const emitSyncFor = (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (tab) {
        emit(
          RESULTS_SYNC_EVENT,
          buildSyncPayload(tab, {
            connectionId: activeConnectionId,
            copyFormat,
            csvDelimiter,
            csvIncludeHeaders,
          }),
        );
      }
    };

    const makeHandlers = (tabId: string): ResultsWindowActionHandlers => {
      const tabResults = () => {
        const tab = tabsRef.current.find((t) => t.id === tabId);
        return tab && tab.results ? tab : null;
      };
      return {
        onRunQueryPage: (query, page) => runQuery(query, page, tabId),
        onPageChange: (entryId, page) => runResultEntryPage(entryId, page, tabId),
        onRerunEntry: (entryId) => runResultEntryPage(entryId, 1, tabId),
        onLoadCount: () => loadCount(tabId),
        onSelectResult: (entryId) =>
          updateTab(tabId, { activeResultId: entryId }),
        onCloseEntry: (entryId) => {
          const tab = tabResults();
          if (!tab) return;
          const { results: newResults, nextActiveId } = removeResultEntry(
            tab.results!,
            entryId,
            tab.activeResultId,
          );
          if (newResults.length === 0) {
            updateTab(tab.id, { results: undefined, activeResultId: undefined });
          } else {
            updateTab(tab.id, {
              results: newResults,
              activeResultId: nextActiveId,
            });
          }
        },
        onCloseOtherEntries: (entryId) => {
          const tab = tabResults();
          if (!tab) return;
          const { results: newResults, nextActiveId } = removeOtherEntries(
            tab.results!,
            entryId,
          );
          updateTab(tab.id, {
            results: newResults,
            activeResultId: nextActiveId,
          });
        },
        onCloseEntriesToRight: (entryId) => {
          const tab = tabResults();
          if (!tab) return;
          const { results: newResults, nextActiveId } = removeEntriesToRight(
            tab.results!,
            entryId,
            tab.activeResultId,
          );
          updateTab(tab.id, {
            results: newResults,
            activeResultId: nextActiveId,
          });
        },
        onCloseEntriesToLeft: (entryId) => {
          const tab = tabResults();
          if (!tab) return;
          const { results: newResults, nextActiveId } = removeEntriesToLeft(
            tab.results!,
            entryId,
            tab.activeResultId,
          );
          updateTab(tab.id, {
            results: newResults,
            activeResultId: nextActiveId,
          });
        },
        onCloseAllEntries: () =>
          updateTab(tabId, { results: undefined, activeResultId: undefined }),
        onRenameEntry: (entryId, label) => {
          const tab = tabResults();
          if (!tab) return;
          updateTab(tab.id, {
            results: updateResultEntry(tab.results!, entryId, { label }),
          });
        },
      };
    };

    const readyP = listen<ResultsReadyPayload>(RESULTS_READY_EVENT, (event) =>
      emitSyncFor(event.payload.tabId),
    );
    const actionP = listen<ResultsActionEnvelope>(
      RESULTS_ACTION_EVENT,
      (event) => {
        // Only honor actions for tabs we actually have detached — defense in
        // depth against events arriving for a reattached/unknown tab.
        const { tabId, action } = event.payload;
        if (!detachedTabIdsRef.current.has(tabId)) return;
        applyAction(action, makeHandlers(tabId));
      },
    );
    const closedP = listen<ResultsClosedPayload>(
      RESULTS_CLOSED_EVENT,
      (event) => {
        const closedId = event.payload.tabId;
        setDetachedTabIds((prev) => {
          if (!prev.has(closedId)) return prev;
          const next = new Set(prev);
          next.delete(closedId);
          return next;
        });
      },
    );

    return () => {
      readyP.then((u) => u());
      actionP.then((u) => u());
      closedP.then((u) => u());
    };
  }, [
    activeConnectionId,
    copyFormat,
    csvDelimiter,
    csvIncludeHeaders,
    runQuery,
    runResultEntryPage,
    loadCount,
    updateTab,
  ]);

  const handleRunButton = useCallback(() => {
    if (!activeTab) return;

    // Table Tab: run query with filter/sort/limit from activeTab
    if (activeTab.type === "table") {
      runQuery(undefined, 1);
      return;
    }

    // Visual Query Builder: run the generated SQL directly
    if (activeTab.type === "query_builder") {
      if (activeTab.query && activeTab.query.trim()) {
        runQuery(activeTab.query, 1);
      }
      return;
    }

    // Monaco Editor: handle selection and multi-query
    if (!editorsRef.current[activeTab.id]) {
      // Fallback: use saved query when editor ref is not available (e.g. after tab restore)
      if (activeTab.query?.trim()) {
        const queries = splitQueries(activeTab.query, activeDialect);
        if (queries.length <= 1) runQuery(queries[0] || activeTab.query, 1);
        else {
          setSelectableQueries(queries);
          setIsQuerySelectionModalOpen(true);
        }
      }
      return;
    }
    const editor = editorsRef.current[activeTab.id];
    const selection = editor.getSelection();
    const selectedText = selection
      ? editor.getModel()?.getValueInRange(selection)
      : undefined;

    if (selectedText && selection && !selection.isEmpty()) {
      const selectedQueries = splitQueries(selectedText, activeDialect);
      if (selectedQueries.length > 1) {
        runMultipleQueries(selectedQueries);
      } else {
        runQuery(selectedQueries[0] || selectedText, 1);
      }
      return;
    }

    const fullText = editor.getValue();
    if (!fullText.trim()) return;

    const queries = splitQueries(fullText, activeDialect);
    if (queries.length <= 1) runQuery(queries[0] || fullText, 1);
    else {
      setSelectableQueries(queries);
      setIsQuerySelectionModalOpen(true);
    }
  }, [activeTab, activeDialect, runQuery, runMultipleQueries]);

  const openExplainForQuery = useCallback((query: string) => {
    setVisualExplainQuery(query);
    setIsVisualExplainOpen(true);
  }, []);

  const handleExplainButton = useCallback(() => {
    if (!activeTab || !activeConnectionId) return;

    // Get text: selection first, then full editor content, then saved query
    const editor = editorsRef.current[activeTab.id];
    let text = "";
    if (editor) {
      const selection = editor.getSelection();
      const selectedText = selection && !selection.isEmpty()
        ? editor.getModel()?.getValueInRange(selection)
        : undefined;
      text = (selectedText || editor.getValue()).trim();
    } else {
      text = (activeTab.query ?? "").trim();
    }

    if (!text) return;

    const explainable = getExplainableQueries(text, activeDialect);
    if (explainable.length === 0) {
      // No explainable queries — open modal with full text so it shows the error
      openExplainForQuery(text);
    } else if (explainable.length === 1) {
      openExplainForQuery(explainable[0].query);
    } else {
      setExplainSelectableQueries(explainable);
      setIsExplainSelectionOpen(true);
    }
  }, [activeTab, activeConnectionId, activeDialect, openExplainForQuery]);

  // Keep stable refs in sync for Monaco actions (closure-captured at mount time)
  runQueryRef.current = runQuery;
  runMultipleQueriesRef.current = runMultipleQueries;
  openExplainForQueryRef.current = openExplainForQuery;
  activeDialectRef.current = activeDialect;

  // Global Ctrl/Command+F5 shortcut for Run
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "F5") {
        e.preventDefault();
        handleRunButton();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRunButton]);

  // Global Ctrl+Tab shortcut: open tab switcher and advance to next tab circularly.
  // In split mode only the focused pane (explorerConnectionId) handles the shortcut.
  useEffect(() => {
    const focused = isFocusedPane(explorerConnectionId, activeConnectionId);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focused || !e.ctrlKey || e.key !== "Tab") return;
      e.preventDefault();
      setIsTabSwitcherOpen(true);
      const nextId = resolveNextTabId(tabsRef.current, activeTabIdRef.current);
      if (nextId !== null) setActiveTabId(nextId);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!focused || e.key !== "Control") return;
      setIsTabSwitcherOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [explorerConnectionId, activeConnectionId, setActiveTabId]);

  // Cmd/Ctrl+T: new console tab; Cmd/Ctrl+Right: next page; Cmd/Ctrl+Left: prev page
  useEffect(() => {
    const focused = isFocusedPane(explorerConnectionId, activeConnectionId);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focused) return;

      if (matchesShortcut(e, "close_tab")) {
        e.preventDefault();
        const currentTabId = activeTabIdRef.current;
        if (currentTabId) handleCloseTab(currentTabId);
        return;
      }

      if (matchesShortcut(e, "new_tab")) {
        e.preventDefault();
        addTab({ type: "console" });
        return;
      }

      if (matchesShortcut(e, "next_page")) {
        const tab = tabsRef.current.find(
          (t) => t.id === activeTabIdRef.current,
        );
        if (tab?.result?.pagination?.has_more) {
          e.preventDefault();
          runQuery(tab.query, (tab.result.pagination.page ?? 1) + 1);
        }
        return;
      }

      if (matchesShortcut(e, "prev_page")) {
        const tab = tabsRef.current.find(
          (t) => t.id === activeTabIdRef.current,
        );
        if (tab?.result?.pagination && tab.result.pagination.page > 1) {
          e.preventDefault();
          runQuery(tab.query, tab.result.pagination.page - 1);
        }
        return;
      }

      if (matchesShortcut(e, "refresh_table")) {
        e.preventDefault();
        const tab = tabsRef.current.find(
          (t) => t.id === activeTabIdRef.current,
        );
        if (tab?.activeTable) {
          runQuery(tab.query, tab.page);
        }
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    explorerConnectionId,
    activeConnectionId,
    matchesShortcut,
    addTab,
    handleCloseTab,
    runQuery,
  ]);

  const handleRefresh = useCallback(() => {
    const currentTab = tabsRef.current.find(
      (t) => t.id === activeTabIdRef.current,
    );
    if (currentTab?.activeTable && activeConnectionId)
      runQuery(currentTab.query, currentTab.page);
  }, [activeConnectionId, runQuery]);

  const handleToolbarUpdate = useCallback(
    (filter: string, sort: string, limit: number | undefined) => {
      if (!activeTabIdRef.current) return;

      updateTab(activeTabIdRef.current, {
        filterClause: filter,
        sortClause: sort,
        limitClause: limit,
      });

      // Pass values directly to runQuery to avoid race conditions with ref updates
      runQuery(undefined, 1, undefined, undefined, filter, sort, limit);
    },
    [updateTab, runQuery],
  );

  const handleForeignKeyShowPanel = useCallback(
    (fk: ForeignKey, value: unknown) => {
      const currentTab = tabsRef.current.find(
        (tb) => tb.id === activeTabIdRef.current,
      );
      if (!currentTab || !activeConnectionId) return;

      const sourceType = currentTab.columnMetadata?.find(
        (c) => c.name === fk.column_name,
      )?.data_type;

      setActiveFkQuery({
        fk,
        value,
        sourceColumnType: sourceType,
      });
    },
    [activeConnectionId],
  );

  const handleForeignKeyNavigate = useCallback(
    (fk: ForeignKey, value: unknown) => {
      const currentTab = tabsRef.current.find(
        (tb) => tb.id === activeTabIdRef.current,
      );
      if (!currentTab || !activeConnectionId) return;

      const sourceType = currentTab.columnMetadata?.find(
        (c) => c.name === fk.column_name,
      )?.data_type;
      const filterClause = buildForeignKeyFilterClause(
        fk,
        value,
        activeDriver ?? null,
        sourceType,
      );

      const targetSchema = activeCapabilities?.schemas
        ? currentTab.schema
        : undefined;

      const newTabId = addTab({
        type: "table",
        activeTable: fk.ref_table,
        schema: targetSchema,
        filterClause,
        // Reset clauses that may linger on an existing dedup'd tab
        sortClause: "",
        limitClause: undefined,
        // Drop any stale results so the new query renders fresh
        result: null,
      });
      if (!newTabId) return;

      updateTab(newTabId, {
        filterClause,
        sortClause: "",
        limitClause: undefined,
      });

      // Defer to next tick: addTab uses setTabs (async), and runQuery resolves
      // the target tab via tabsRef which is only refreshed by the
      // tabs-tracking effect after React commits. Running synchronously here
      // misses the freshly created tab and bails out early.
      setTimeout(() => {
        runQuery(undefined, 1, newTabId, undefined, filterClause, "", undefined);
      }, 0);
    },
    [
      activeConnectionId,
      activeDriver,
      activeCapabilities?.schemas,
      addTab,
      updateTab,
      runQuery,
    ],
  );

  const handleSort = useCallback(
    (colName: string) => {
      if (!activeTab) return;

      const currentSort = activeTab.sortClause || "";
      const parts = currentSort.trim().split(/\s+/);

      let newSort = "";

      const sortCol = parts[0]?.replace(/^["`]|["`]$/g, "") ?? "";

      // Check if we are currently sorting by this column
      if (sortCol === colName && parts.length <= 2) {
        const currentDir = parts[1]?.toUpperCase();

        if (!currentDir || currentDir === "ASC") {
          // ASC -> DESC
          newSort = `${formatSqlIdentifier(colName, activeDriver)} DESC`;
        } else {
          // DESC -> None (Clear)
          newSort = "";
        }
      } else {
        // New column -> ASC
        newSort = `${formatSqlIdentifier(colName, activeDriver)} ASC`;
      }

      handleToolbarUpdate(
        activeTab.filterClause || "",
        newSort,
        activeTab.limitClause,
      );
    },
    [activeTab, activeDriver, handleToolbarUpdate],
  );

  const handlePendingChange = useCallback(
    (pkVal: unknown, colName: string, value: unknown) => {
      if (!activeTabIdRef.current) return;
      const tabId = activeTabIdRef.current;

      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab) return;

      const pkKey = serializePkKey(pkVal as Record<string, unknown>);
      const currentPending = currentTab.pendingChanges || {};
      const rowEntry = currentPending[pkKey] || {
        pkOriginalValue: pkVal,
        changes: {},
      };

      // Create new changes object
      const newChanges = { ...rowEntry.changes };

      if (value === undefined) {
        // Remove change
        delete newChanges[colName];
      } else {
        // Update change
        newChanges[colName] = value;
      }

      const newPending = { ...currentPending };

      // If no changes left for this row, remove the row entry
      if (Object.keys(newChanges).length === 0) {
        delete newPending[pkKey];
      } else {
        newPending[pkKey] = {
          ...rowEntry,
          changes: newChanges,
        };
      }

      updateTab(tabId, { pendingChanges: newPending });
    },
    [updateTab],
  );

  const handleSelectionChange = useCallback(
    (indices: Set<number>) => {
      if (!activeTabIdRef.current) return;
      updateTab(activeTabIdRef.current, { selectedRows: Array.from(indices) });
    },
    [updateTab],
  );

  const handleDeleteRows = useCallback(() => {
    if (
      !activeTab ||
      !activeTab.selectedRows ||
      activeTab.selectedRows.length === 0
    )
      return;

    const existingRowCount = activeTab.result?.rows.length || 0;
    const currentPendingInsertions = activeTab.pendingInsertions || {};
    const currentPendingDeletions = activeTab.pendingDeletions || {};

    const newPendingDeletions = { ...currentPendingDeletions };
    const newPendingInsertions = { ...currentPendingInsertions };

    // Separate selected rows into existing rows and new rows
    const insertionTempIds = Object.keys(currentPendingInsertions);

    activeTab.selectedRows.forEach((rowIndex) => {
      if (rowIndex < existingRowCount) {
        // Existing row - add to pending deletions
        if (activeTab.result && activeTab.pkColumns && activeTab.pkColumns.length > 0) {
          const pkCols = activeTab.pkColumns;
          const pkIndices = pkCols.map((c) => activeTab.result!.columns.indexOf(c));
          if (pkIndices.every((i) => i !== -1)) {
            const row = activeTab.result.rows[rowIndex];
            if (row) {
              const pkMapVal = buildPkMap(pkCols, row, pkIndices);
              const pkKey = serializePkKey(pkMapVal);
              newPendingDeletions[pkKey] = pkMapVal;
            }
          }
        }
      } else {
        // New row (insertion) - remove directly from pendingInsertions
        const insertionArrayIndex = rowIndex - existingRowCount;
        if (
          insertionArrayIndex >= 0 &&
          insertionArrayIndex < insertionTempIds.length
        ) {
          const tempId = insertionTempIds[insertionArrayIndex];
          delete newPendingInsertions[tempId];
        }
      }
    });

    updateActiveTab({
      pendingDeletions: newPendingDeletions,
      pendingInsertions: newPendingInsertions,
      selectedRows: [],
    });
  }, [activeTab, updateActiveTab]);

  const handlePendingInsertionChange = useCallback(
    (tempId: string, colName: string, value: unknown) => {
      if (!activeTabIdRef.current) return;
      const tabId = activeTabIdRef.current;

      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab) return;

      const currentPendingInsertions = currentTab.pendingInsertions || {};
      const insertion = currentPendingInsertions[tempId];
      if (!insertion) return;

      const newData = { ...insertion.data };
      if (value === undefined) {
        delete newData[colName];
      } else {
        newData[colName] = value;
      }

      const newPendingInsertions = {
        ...currentPendingInsertions,
        [tempId]: {
          ...insertion,
          data: newData,
        },
      };

      updateTab(tabId, { pendingInsertions: newPendingInsertions });
    },
    [updateTab],
  );

  const handleDiscardInsertion = useCallback(
    (tempId: string) => {
      if (!activeTabIdRef.current) return;
      const tabId = activeTabIdRef.current;
      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab?.pendingInsertions) return;

      const newPendingInsertions = { ...currentTab.pendingInsertions };
      delete newPendingInsertions[tempId];

      updateTab(tabId, { pendingInsertions: newPendingInsertions });
    },
    [updateTab],
  );

  const handleRevertDeletion = useCallback(
    (pkVal: unknown) => {
      if (!activeTabIdRef.current) return;
      const tabId = activeTabIdRef.current;
      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab?.pendingDeletions) return;

      const pkKey = serializePkKey(pkVal as Record<string, unknown>);
      const newPendingDeletions = { ...currentTab.pendingDeletions };
      delete newPendingDeletions[pkKey];

      updateTab(tabId, {
        pendingDeletions:
          Object.keys(newPendingDeletions).length > 0
            ? newPendingDeletions
            : undefined,
      });
    },
    [updateTab],
  );

  const handleMarkForDeletion = useCallback(
    (pkVal: unknown) => {
      if (!activeTabIdRef.current) return;
      const tabId = activeTabIdRef.current;
      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab) return;

      const pkKey = serializePkKey(pkVal as Record<string, unknown>);
      const currentPendingDeletions = currentTab.pendingDeletions || {};
      const newPendingDeletions = {
        ...currentPendingDeletions,
        [pkKey]: pkVal,
      };

      updateTab(tabId, { pendingDeletions: newPendingDeletions });
    },
    [updateTab],
  );

  const handleMarkMultipleForDeletion = useCallback(
    (pkVals: unknown[]) => {
      if (!activeTabIdRef.current) return;
      const tabId = activeTabIdRef.current;
      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab) return;

      const newPendingDeletions = { ...(currentTab.pendingDeletions || {}) };
      for (const pkVal of pkVals) {
        newPendingDeletions[serializePkKey(pkVal as Record<string, unknown>)] = pkVal;
      }

      updateTab(tabId, { pendingDeletions: newPendingDeletions });
    },
    [updateTab],
  );

  const handleDuplicateRow = useCallback(
    (rowData: Record<string, unknown>) => {
      if (!activeTabIdRef.current) return;
      const tabId = activeTabIdRef.current;
      const currentTab = tabsRef.current.find((t) => t.id === tabId);
      if (!currentTab) return;

      const autoIncrementCols = currentTab.autoIncrementColumns ?? [];
      const data: Record<string, unknown> = { ...rowData };
      autoIncrementCols.forEach((col) => {
        data[col] = null;
      });

      const tempId = generateTempId();
      const currentPendingInsertions = currentTab.pendingInsertions || {};
      const existingRowCount = currentTab.result?.rows.length || 0;
      const insertionCount = Object.keys(currentPendingInsertions).length;
      const displayIndex = existingRowCount + insertionCount;

      updateTab(tabId, {
        pendingInsertions: {
          ...currentPendingInsertions,
          [tempId]: { tempId, data, displayIndex },
        },
      });
    },
    [updateTab],
  );

  const handleNewRow = useCallback(async () => {
    if (
      !activeTabIdRef.current ||
      !activeConnectionId ||
      !activeTab?.activeTable
    ) {
      console.warn("Cannot create new row: missing required context", {
        tabId: activeTabIdRef.current,
        connectionId: activeConnectionId,
        table: activeTab?.activeTable,
      });
      return;
    }

    try {
      // Fetch table columns
      const columns = await invoke<TableColumn[]>("get_columns", {
        connectionId: activeConnectionId,
        tableName: activeTab.activeTable,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });

      if (!columns || columns.length === 0) {
        throw new Error("No columns found for table");
      }

      // Generate temp ID and initialize data
      const tempId = generateTempId();
      const data = initializeNewRow(columns);

      const currentPendingInsertions = activeTab.pendingInsertions || {};
      const existingRowCount = activeTab.result?.rows.length || 0;
      const insertionCount = Object.keys(currentPendingInsertions).length;

      // displayIndex will be calculated in DataGrid (existingRowCount + insertionIndex)
      const displayIndex = existingRowCount + insertionCount;

      const newPendingInsertions = {
        ...currentPendingInsertions,
        [tempId]: {
          tempId,
          data,
          displayIndex,
        },
      };

      const updates: Partial<Tab> = {
        pendingInsertions: newPendingInsertions,
      };

      // If activeTab.result is missing (e.g. empty table initially), initialize it
      // so DataGrid receives columns and can render the new row
      if (!activeTab.result) {
        updates.result = {
          columns: columns.map((c) => c.name),
          rows: [],
          affected_rows: 0,
          pagination: {
            page: 1,
            page_size: settings.resultPageSize || 100,
            total_rows: null,
            has_more: false,
          },
        };
      } else if (
        !activeTab.result.columns ||
        activeTab.result.columns.length === 0
      ) {
        // If result exists but has no columns, update it with columns
        updates.result = {
          ...activeTab.result,
          columns: columns.map((c) => c.name),
        };
      }

      // Ensure pkColumns and autoIncrementColumns are set
      if (!activeTab.pkColumns || activeTab.pkColumns.length === 0) {
        const pks = columns.filter((c) => c.is_pk).map((c) => c.name);
        if (pks.length > 0) {
          updates.pkColumns = pks;
        }
      }

      if (!activeTab.autoIncrementColumns) {
        const autoInc = columns
          .filter((c) => c.is_auto_increment)
          .map((c) => c.name);
        updates.autoIncrementColumns = autoInc;
      }

      if (!activeTab.defaultValueColumns) {
        const defaultVal = columns
          .filter(
            (c) => c.default_value !== undefined && c.default_value !== null,
          )
          .map((c) => c.name);
        updates.defaultValueColumns = defaultVal;
      }

      if (!activeTab.nullableColumns) {
        const nullable = columns
          .filter((c) => c.is_nullable)
          .map((c) => c.name);
        updates.nullableColumns = nullable;
      }

      if (!activeTab.columnMetadata) {
        updates.columnMetadata = columns;
      }

      updateTab(activeTabIdRef.current, updates);
    } catch (err) {
      console.error("Failed to create new row:", err);
      showAlert(t("editor.failedCreateRow") + String(err), {
        title: t("general.error"),
        kind: "error",
      });
    }
  }, [
    activeConnectionId,
    activeTab,
    updateTab,
    t,
    settings.resultPageSize,
    activeSchema,
    showAlert,
  ]);

  const handleSubmitChanges = useCallback(async () => {
    if (!activeTab || !activeTab.activeTable || !activeConnectionId) return;

    // pkColumns is required for updates/deletions but not for insertions-only
    const hasPkColumns = !!(activeTab.pkColumns && activeTab.pkColumns.length > 0);

    const {
      pendingChanges,
      pendingDeletions,
      pendingInsertions,
      activeTable,
      pkColumns,
      selectedRows,
    } = activeTab;
    const updates: { pkVal: Record<string, unknown>; colName: string; newVal: unknown }[] = [];
    const deletions: Record<string, unknown>[] = [];
    const insertions: { tempId: string; data: Record<string, unknown> }[] = [];

    // Filter pending changes by selected rows IF there is a selection AND applyToAll is false
    const hasSelection = !applyToAll && selectedRows && selectedRows.length > 0;
    const selectedPkSet = new Set<string>();

    if (hasSelection && activeTab.result && hasPkColumns && pkColumns) {
      const pkIndices = pkColumns.map((c) => activeTab.result!.columns.indexOf(c));
      if (pkIndices.every((i) => i !== -1)) {
        selectedRows.forEach((rowIndex) => {
          const row = activeTab.result!.rows[rowIndex];
          if (row) selectedPkSet.add(serializePkKey(buildPkMap(pkColumns, row, pkIndices)));
        });
      }
    }

    if (hasPkColumns && pkColumns && pendingChanges) {
      for (const [pkKey, rowData] of Object.entries(pendingChanges)) {
        // Apply filter if selection exists (and applyToAll is false)
        if (hasSelection && !selectedPkSet.has(pkKey)) continue;

        const { pkOriginalValue, changes } = rowData;
        for (const [colName, newVal] of Object.entries(changes)) {
          updates.push({ pkVal: pkOriginalValue as Record<string, unknown>, colName, newVal });
        }
      }
    }

    if (hasPkColumns && pkColumns && pendingDeletions) {
      for (const [pkKey, pkVal] of Object.entries(pendingDeletions)) {
        // Apply filter if selection exists (and applyToAll is false)
        if (hasSelection && !selectedPkSet.has(pkKey)) continue;
        deletions.push(pkVal as Record<string, unknown>);
      }
    }

    // Process insertions
    if (pendingInsertions && Object.keys(pendingInsertions).length > 0) {
      try {
        // Fetch columns for validation
        const columns = await invoke<TableColumn[]>("get_columns", {
          connectionId: activeConnectionId,
          tableName: activeTable,
          ...(activeSchema ? { schema: activeSchema } : {}),
        });

        const selectedDisplayIndices = new Set<number>();

        if (hasSelection && selectedRows) {
          // Convert selectedRows to displayIndices
          // Insertion rows are displayed AFTER existing rows
          selectedRows.forEach((rowIndex) => {
            selectedDisplayIndices.add(rowIndex);
          });
        }

        // Filter and validate insertions
        // Insertion rows have displayIndex = existingRowCount + insertionIndex
        const existingRowCount = activeTab.result?.rows.length || 0;
        let insertionIndex = 0;
        for (const [tempId, insertion] of Object.entries(pendingInsertions)) {
          // Check if this insertion is selected (if filtering by selection)
          const insertionDisplayIndex = existingRowCount + insertionIndex;
          if (
            hasSelection &&
            !selectedDisplayIndices.has(insertionDisplayIndex)
          ) {
            insertionIndex++;
            continue;
          }

          // Validate insertion
          const errors = validatePendingInsertion(insertion, columns);
          if (Object.keys(errors).length > 0) {
            // Skip invalid insertions (optionally show error to user)
            console.warn(`Skipping invalid insertion ${tempId}:`, errors);
            insertionIndex++;
            continue;
          }

          // Convert to backend format (auto-increment columns are automatically excluded)
          const backendData = insertionToBackendData(insertion, columns);

          insertions.push({ tempId, data: backendData });
          insertionIndex++;
        }
      } catch (err) {
        console.error("Failed to process insertions:", err);
        showAlert(t("editor.failedProcessInsertions") + String(err), {
          title: t("common.error"),
          kind: "error",
        });
        return;
      }
    }

    if (
      updates.length === 0 &&
      deletions.length === 0 &&
      insertions.length === 0
    )
      return;

    updateActiveTab({ isLoading: true });

    try {
      const promises = [];

      const databaseParam =
        isMultiDatabaseCapable(activeCapabilities) && activeTab?.schema
          ? { database: activeTab.schema }
          : {};

      // Deletions
      if (deletions.length > 0) {
        promises.push(
          ...deletions.map((pkMap) =>
            invoke("delete_record", {
              connectionId: activeConnectionId,
              table: activeTable,
              pkMap,
              ...(activeSchema ? { schema: activeSchema } : {}),
              ...databaseParam,
            }),
          ),
        );
      }

      // Updates
      if (updates.length > 0) {
        promises.push(
          ...updates.map((u) =>
            invoke("update_record", {
              connectionId: activeConnectionId,
              table: activeTable,
              pkMap: u.pkVal,
              colName: u.colName,
              newVal: u.newVal,
              ...(activeSchema ? { schema: activeSchema } : {}),
              ...databaseParam,
            }),
          ),
        );
      }

      // Insertions
      if (insertions.length > 0) {
        promises.push(
          ...insertions.map((insertion) =>
            invoke("insert_record", {
              connectionId: activeConnectionId,
              table: activeTable,
              data: insertion.data,
              ...(activeSchema ? { schema: activeSchema } : {}),
              ...databaseParam,
            }),
          ),
        );
      }

      await Promise.all(promises);

      // Remove processed changes from state
      const newPendingChanges = { ...(pendingChanges || {}) };
      const newPendingDeletions = { ...(pendingDeletions || {}) };
      const newPendingInsertions = { ...(pendingInsertions || {}) };

      // Partial cleanup - remove only processed changes
      updates.forEach((u) => delete newPendingChanges[serializePkKey(u.pkVal)]);
      deletions.forEach((d) => delete newPendingDeletions[serializePkKey(d as Record<string, unknown>)]);
      insertions.forEach((i) => delete newPendingInsertions[i.tempId]);

      // Cleanup empty change objects
      Object.keys(newPendingChanges).forEach((key) => {
        if (Object.keys(newPendingChanges[key]?.changes || {}).length === 0)
          delete newPendingChanges[key];
      });

      const remainingChanges =
        Object.keys(newPendingChanges).length > 0
          ? newPendingChanges
          : undefined;
      const remainingDeletions =
        Object.keys(newPendingDeletions).length > 0
          ? newPendingDeletions
          : undefined;
      const remainingInsertions =
        Object.keys(newPendingInsertions).length > 0
          ? newPendingInsertions
          : undefined;

      // Refresh query preserving remaining pending changes
      runQuery(
        activeTab.query,
        activeTab.page,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          pendingChanges: remainingChanges,
          pendingDeletions: remainingDeletions,
          pendingInsertions: remainingInsertions,
        },
      );
    } catch (e) {
      console.error("Batch update failed", e);
      updateActiveTab({ isLoading: false });
      showAlert(t("dataGrid.updateFailed") + String(e), {
        title: t("common.error"),
        kind: "error",
      });
    }
  }, [
    activeTab,
    activeConnectionId,
    updateActiveTab,
    runQuery,
    t,
    applyToAll,
    activeSchema,
    activeCapabilities,
    showAlert,
  ]);

  // Cmd/Ctrl+S: commit the active tab's pending grid changes (like TablePlus).
  useEffect(() => {
    const focused = isFocusedPane(explorerConnectionId, activeConnectionId);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focused) return;
      if (matchesShortcut(e, "save_grid_changes")) {
        e.preventDefault();
        if (hasPendingChanges) handleSubmitChanges();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    explorerConnectionId,
    activeConnectionId,
    matchesShortcut,
    hasPendingChanges,
    handleSubmitChanges,
  ]);

  const handleParamsSubmit = useCallback(
    (values: Record<string, string>) => {
      const { pendingTabId, mode, sql, pendingPageNum, pendingMultiQueries } =
        queryParamsModal;
      if (!pendingTabId) return;

      // Update tab with new params (merge with existing)
      const currentTab = tabsRef.current.find((t) => t.id === pendingTabId);
      const newParams = { ...(currentTab?.queryParams || {}), ...values };

      updateTab(pendingTabId, { queryParams: newParams });

      // Close modal
      setQueryParamsModal((prev) => ({ ...prev, isOpen: false }));

      // If mode was run, execute query immediately
      if (mode === "run") {
        if (pendingMultiQueries) {
          runMultipleQueries(pendingMultiQueries, newParams);
        } else {
          runQuery(sql, pendingPageNum, pendingTabId, newParams);
        }
      }
    },
    [queryParamsModal, updateTab, runQuery, runMultipleQueries],
  );

  const handleEditParams = useCallback(() => {
    if (!activeTab || !activeTab.query) return;

    const params = extractQueryParams(activeTab.query);
    if (params.length === 0) return;

    setQueryParamsModal({
      isOpen: true,
      sql: activeTab.query,
      parameters: params,
      pendingPageNum: 1,
      pendingTabId: activeTab.id,
      mode: "save",
    });
  }, [activeTab]);

  const handleRollbackChanges = useCallback(() => {
    if (!activeTab) return;
    const {
      selectedRows,
      result,
      pkColumns,
      pendingChanges,
      pendingDeletions,
      pendingInsertions,
    } = activeTab;

    // If applyToAll is true OR no selection, rollback everything
    if (applyToAll || !selectedRows || selectedRows.length === 0) {
      updateActiveTab({
        pendingChanges: undefined,
        pendingDeletions: undefined,
        pendingInsertions: undefined,
      });
      return;
    }

    // Filter rollback by selection
    const selectedPkSet = new Set<string>();
    const selectedDisplayIndices = new Set<number>();

    // Add all selected row indices to the set
    selectedRows.forEach((rowIndex) => {
      selectedDisplayIndices.add(rowIndex);
    });

    // For existing rows, also collect their PK values
    if (result && pkColumns && pkColumns.length > 0) {
      const pkIndices = pkColumns.map((c) => result.columns.indexOf(c));
      if (pkIndices.every((i) => i !== -1)) {
        selectedRows.forEach((rowIndex) => {
          const row = result.rows[rowIndex];
          if (row) selectedPkSet.add(serializePkKey(buildPkMap(pkColumns, row, pkIndices)));
        });
      }
    }

    const newPendingChanges = { ...(pendingChanges || {}) };
    const newPendingDeletions = { ...(pendingDeletions || {}) };
    const newPendingInsertions = { ...(pendingInsertions || {}) };

    // Rollback changes and deletions (for existing rows)
    selectedPkSet.forEach((pk) => {
      delete newPendingChanges[pk];
      delete newPendingDeletions[pk];
    });

    // Rollback insertions (for new rows)
    // Insertion rows are displayed AFTER existing rows, so their displayIndex = existingRowCount + insertionIndex
    const existingRowCount = result?.rows.length || 0;
    let insertionIndex = 0;
    for (const tempId of Object.keys(newPendingInsertions)) {
      const insertionDisplayIndex = existingRowCount + insertionIndex;
      if (selectedDisplayIndices.has(insertionDisplayIndex)) {
        delete newPendingInsertions[tempId];
      }
      insertionIndex++;
    }

    updateActiveTab({
      pendingChanges:
        Object.keys(newPendingChanges).length > 0
          ? newPendingChanges
          : undefined,
      pendingDeletions:
        Object.keys(newPendingDeletions).length > 0
          ? newPendingDeletions
          : undefined,
      pendingInsertions:
        Object.keys(newPendingInsertions).length > 0
          ? newPendingInsertions
          : undefined,
    });
  }, [activeTab, updateActiveTab, applyToAll]);

  const handleEditorMount = (
    editor: Parameters<OnMount>[0],
    monaco: Monaco,
    tabId: string,
  ) => {
    editorsRef.current[tabId] = editor;
    setMonacoInstance(monaco);
    // Focus the editor when a console tab is opened (Ctrl+T / new console)
    const mountedTab = tabsRef.current.find((t) => t.id === tabId);
    if (mountedTab?.type === "console") editor.focus();
    editor.addAction({
      id: "run-selection",
      label: "Execute Selection",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.5,
      run: (ed) => {
        const selection = ed.getSelection();
        const selectedText = selection && !selection.isEmpty()
          ? ed.getModel()?.getValueInRange(selection)
          : undefined;
        const text = (selectedText || ed.getValue()).trim();
        if (!text) return;
        const queries = splitQueries(text, activeDialectRef.current);
        if (queries.length > 1) {
          runMultipleQueriesRef.current(queries);
        } else {
          runQueryRef.current(queries[0] || text, 1);
        }
      },
    });
    editor.addAction({
      id: "explain-selection",
      label: t("editor.visualExplain.contextMenuExplain"),
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.6,
      run: (ed) => {
        const selection = ed.getSelection();
        const selectedText = selection && !selection.isEmpty()
          ? ed.getModel()?.getValueInRange(selection)
          : undefined;
        const text = (selectedText || ed.getValue()).trim();
        if (!text) return;
        const explainable = getExplainableQueries(text, activeDialectRef.current);
        if (explainable.length === 0) {
          openExplainForQueryRef.current(text);
        } else if (explainable.length === 1) {
          openExplainForQueryRef.current(explainable[0].query);
        } else {
          setExplainSelectableQueries(explainable);
          setIsExplainSelectionOpen(true);
        }
      },
    });
  };

  useSqlAutocompleteRegistration(activeConnectionId, {
    monaco: monacoInstance,
    schema: activeSchema,
    enabled: !isNotebookTab,
  });

  useEffect(() => {
    const state = location.state as EditorState;
    if (activeConnectionId) {
      if (state?.initialQuery !== undefined) {
        if (
          state.targetConnectionId &&
          state.targetConnectionId !== activeConnectionId
        )
          return;

        const queryKey = `${state.initialQuery}-${state.tableName}-${state.queryName}-${state.schema}-${state.title}`;

        if (processingRef.current === queryKey) {
          // If re-navigating to the same definition with readOnly, patch any
          // existing tab that was opened without the flag (e.g. before the fix).
          if (state.readOnly) {
            const title = state.queryName || state.tableName || "";
            const existing = tabsRef.current.find(
              (t) => t.connectionId === activeConnectionId && t.title === title,
            );
            if (existing) updateTab(existing.id, { readOnly: true });
          }
          return;
        }
        processingRef.current = queryKey;

        const {
          initialQuery: sql,
          tableName: table,
          queryName,
          preventAutoRun,
          readOnly: navReadOnly,
          materialized: navMaterialized,
          schema: navSchema,
          title: navTitle,
        } = state;
        const tabId = addTab({
          type: table ? "table" : "console",
          title: navTitle || queryName || table || t("sidebar.newConsole"),
          query: sql,
          activeTable: table,
          schema: navSchema,
          readOnly: navReadOnly,
          materialized: navMaterialized,
        });

        if (tabId && !preventAutoRun) {
          // Queue execution only if not prevented
          pendingExecutionsRef.current[tabId] = { sql: sql || "", page: 1 };

          // Try immediate execution if tab exists (reused)
          const existingTab = tabsRef.current.find((t) => t.id === tabId);
          if (existingTab) {
            runAutoQuery(sql || "", 1, tabId);
            delete pendingExecutionsRef.current[tabId];
          }
        }

        navigate(location.pathname, { replace: true, state: {} });
        setTimeout(() => {
          processingRef.current = null;
        }, 500);
      }
    }
  }, [
    location.state,
    location.pathname,
    activeConnectionId,
    addTab,
    updateTab,
    navigate,
    runAutoQuery,
    t,
  ]);

  // Process pending executions when tabs are created/updated
  useEffect(() => {
    Object.keys(pendingExecutionsRef.current).forEach((tabId) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        const { sql, page } = pendingExecutionsRef.current[tabId];
        runAutoQuery(sql, page, tabId);
        delete pendingExecutionsRef.current[tabId];
      }
    });
  }, [tabs, runAutoQuery]);

  const startResize = () => {
    isDragging.current = true;
    document.body.style.cursor = "row-resize";

    // Overlay prevents CodeMirror from capturing mouse events during drag
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;cursor:row-resize";
    document.body.appendChild(overlay);

    const panels = document.querySelectorAll<HTMLElement>("[data-editor-panel]");

    const handleResize = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newHeight = e.clientY - 50;
      if (newHeight > 100 && newHeight < window.innerHeight - 150) {
        editorHeightRef.current = newHeight;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          panels.forEach((el) => {
            el.style.height = `${newHeight}px`;
          });
        });
      }
    };
    const stopResize = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      overlay.remove();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setEditorHeight(editorHeightRef.current);
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResize);
    };
    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResize);
  };

  const cancelExport = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      await invoke("cancel_export", { connectionId: activeConnectionId });
      setExportState((prev) => ({
        ...prev,
        isOpen: false,
      }));
    } catch (e) {
      console.error("Failed to cancel export", e);
    }
  }, [activeConnectionId]);

  const closeExportModal = useCallback(() => {
    setExportState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleExportCommon = async (format: "csv" | "json") => {
    if (!activeTab || !activeConnectionId) return;

    const effectiveSchema =
      activeCapabilities?.schemas === true ? activeTab.schema : undefined;
    const tabForQuery = { ...activeTab, schema: effectiveSchema };
    const query =
      activeTab.type === "table" && activeTab.activeTable
        ? reconstructTableQuery(tabForQuery, activeDriver ?? undefined)
        : activeTab.query;

    if (!query || !query.trim()) return;

    try {
      const filePath = await save({
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
        defaultPath: `result_${Date.now()}.${format}`,
      });

      if (!filePath) return;

      setExportState({
        isOpen: true,
        status: "exporting",
        rowsProcessed: 0,
        fileName: filePath.split(/[/\\]/).pop() || filePath, // Show only filename
      });
      setExportMenuOpen(false);

      // On multi-database connections (e.g. MySQL) scope the export to the
      // selected database so the query runs against the database the user is
      // viewing rather than the connection's primary database. The tab may not
      // carry its own schema (e.g. a console query), so fall back to the active
      // database — mirroring how execute_query resolves the schema.
      const targetDatabase = activeTab?.schema ?? activeSchema ?? undefined;
      const databaseParam =
        isMultiDatabaseCapable(activeCapabilities) && targetDatabase
          ? { database: targetDatabase }
          : {};

      await invoke("export_query_to_file", {
        connectionId: activeConnectionId,
        query,
        filePath,
        format,
        csvDelimiter: format === "csv" ? csvDelimiter : undefined,
        ...databaseParam,
      });

      // Success: update modal state instead of showing toast
      setExportState((prev) => ({
        ...prev,
        status: "completed",
      }));
    } catch (e) {
      // Error: update modal state
      setExportState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: String(e),
      }));
    }
  };

  const handleExportCSV = () => handleExportCommon("csv");
  const handleExportJSON = () => handleExportCommon("json");

  const handleRunDropdownToggle = useCallback(() => {
    if (!isRunDropdownOpen) {
      // Monaco Editor: split queries from editor
      if (activeTab?.type !== "query_builder" && activeTab) {
        const editor = editorsRef.current[activeTab.id];
        if (editor) {
          const selection = editor.getSelection();
          const selectedText = selection
            ? editor.getModel()?.getValueInRange(selection)
            : undefined;

          if (selectedText && selection && !selection.isEmpty()) {
            const queries = splitQueries(selectedText, activeDialect);
            setSelectableQueries(queries);
          } else {
            const text = editor.getValue();
            const queries = splitQueries(text, activeDialect);
            setSelectableQueries(queries);
          }
        } else if (activeTab.query?.trim()) {
          // Fallback: use saved query when editor ref is not available
          const queries = splitQueries(activeTab.query, activeDialect);
          setSelectableQueries(queries);
        }
      }
    }
    setIsRunDropdownOpen((prev) => !prev);
  }, [isRunDropdownOpen, activeTab, activeDialect]);

  if (!activeTab) {
    return (
      <div className="flex flex-col h-full bg-base items-center justify-center text-muted">
        <Database size={48} className="mb-4 opacity-20" />
        {activeConnectionId ? (
          <div className="text-center">
            <p className="mb-4">{t("editor.noTabs")}</p>
            <button
              onClick={() => addTab({ type: "console" })}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              {t("editor.newConsole")}
            </button>
          </div>
        ) : (
          <p>{t("editor.noActiveSession")}</p>
        )}
      </div>
    );
  }

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const tabBarAccent = activeConnectionId
    ? getConnectionAccent(
        activeConnection,
        allDrivers.find((d) => d.id === activeDriver),
      )
    : null;
  // Active-tab accents (indicator line, loading bar, rename border) follow the
  // connection color when present, falling back to the default blue otherwise.
  const tabAccentColor = tabBarAccent ?? "#3b82f6";

  return (
    <div className="flex flex-col h-full bg-base">
      {/* Tab Bar — tinted with the active connection's accent color */}
      <div
        className="flex items-center bg-elevated border-b border-default h-9 shrink-0"
        style={
          tabBarAccent
            ? {
                // Vertical accent wash (stronger at top) + accent-tinted bottom
                // border so the bar reads as part of the active connection.
                backgroundImage: `linear-gradient(${tabBarAccent}30, ${tabBarAccent}20)`,
                borderBottomColor: `${tabBarAccent}50`,
              }
            : undefined
        }
      >
        <button
          onClick={() => scrollTabs("left")}
          disabled={!canScrollLeft}
          className="flex items-center justify-center w-7 h-full text-muted border-r border-default shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:text-primary hover:enabled:bg-surface-secondary"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => scrollTabs("right")}
          disabled={!canScrollRight}
          className="flex items-center justify-center w-7 h-full text-muted border-r border-default shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:text-primary hover:enabled:bg-surface-secondary"
        >
          <ChevronRight size={14} />
        </button>
        <div
          ref={tabScrollRef}
          onScroll={updateScrollArrows}
          className="flex flex-1 overflow-x-auto no-scrollbar h-full"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  handleCloseTab(tab.id);
                }
              }}
              className={clsx(
                "flex items-center gap-2 px-3 h-full border-r border-default cursor-pointer min-w-[140px] max-w-[220px] text-xs transition-all duration-150 group relative select-none",
                activeTabId === tab.id
                  ? "bg-base text-primary font-medium"
                  : "text-muted hover:bg-[var(--tab-hover)] hover:text-secondary",
              )}
              style={
                activeTabId === tab.id
                  ? {
                      // Active tab keeps the content background (so it reads as
                      // connected to the pane below) but carries a soft accent
                      // body, stronger at the top, tinted by the connection.
                      backgroundImage: `linear-gradient(${tabAccentColor}30, ${tabAccentColor}20)`,
                    }
                  : // Inactive tabs pick up a soft accent wash on hover instead of
                    // a flat neutral grey, keeping the strip tied to the connection.
                    ({ "--tab-hover": `${tabAccentColor}33` } as React.CSSProperties)
              }
            >
              {activeTabId === tab.id && (
                <div
                  className="absolute top-0 left-0 right-0 h-[2px] rounded-b-sm"
                  style={{
                    backgroundColor: `${tabAccentColor}cc`,
                    boxShadow: `0 0 5px ${tabAccentColor}59`,
                  }}
                />
              )}
              {tab.type === "table" ? (
                <TableIcon size={12} className="text-accent shrink-0" />
              ) : tab.type === "query_builder" ? (
                <Network size={12} className="text-accent-secondary shrink-0" />
              ) : tab.type === "notebook" ? (
                <BookOpen size={12} className="text-orange-400 shrink-0" />
              ) : (
                <FileCode size={12} className="text-accent-secondary shrink-0" />
              )}
              {editingTabId === tab.id ? (
                <input
                  type="text"
                  value={editingTabTitle}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditingTabTitle(e.target.value)}
                  onBlur={commitTabRename}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitTabRename();
                    if (e.key === "Escape") setEditingTabId(null);
                  }}
                  className="flex-1 min-w-0 bg-surface-secondary border rounded px-1 py-0.5 text-xs text-primary focus:outline-none"
                  style={{ borderColor: `${tabAccentColor}80` }}
                />
              ) : (
                <span
                  className="truncate flex-1 flex items-center gap-1"
                  onDoubleClick={
                    tab.type === "notebook"
                      ? (e) => {
                          e.stopPropagation();
                          startTabRename(tab.id);
                        }
                      : undefined
                  }
                >
                  <span className="truncate">{tab.title}</span>
                  {tab.type === "console" && isMultiDb && (
                    <span className="text-muted shrink-0">
                      ({tab.schema || selectedDatabases[0]})
                    </span>
                  )}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                className={clsx(
                  "p-0.5 rounded hover:bg-surface-secondary hover:text-primary hover:scale-110 transition-all duration-150 shrink-0",
                  activeTabId === tab.id
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={12} />
              </button>
              {tab.isLoading && (
                <div
                  className="absolute bottom-0 left-0 h-0.5 w-full animate-pulse"
                  style={{
                    backgroundImage: `linear-gradient(90deg, transparent, ${tabAccentColor}, transparent)`,
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() =>
            addTab({
              type: "console",
              ...(isMultiDb ? { schema: selectedDatabases[0] } : {}),
            })
          }
          className="flex items-center justify-center w-9 h-full text-muted hover:text-primary hover:bg-surface-secondary border-l border-default transition-colors shrink-0"
          title={t("editor.newConsole")}
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => addTab({ type: "query_builder" })}
          className="flex items-center justify-center w-9 h-full text-purple-500 hover:text-primary hover:bg-surface-secondary border-l border-default transition-colors shrink-0"
          title={t("editor.newVisualQuery")}
        >
          <Network size={16} />
        </button>
        <button
          onClick={async () => {
            if (!activeConnectionId) return;
            const title = "Notebook";
            const { notebookId } = await createNotebook(title, activeConnectionId);
            addTab({
              type: "notebook",
              notebookId,
              ...(isMultiDb ? { schema: selectedDatabases[0] } : {}),
            });
          }}
          className="flex items-center justify-center w-9 h-full text-orange-400 hover:text-primary hover:bg-surface-secondary border-l border-default transition-colors shrink-0"
          title={t("editor.newNotebook")}
        >
          <BookOpen size={16} />
        </button>
      </div>

      {/* Toolbar — hidden for notebook tabs */}
      {!isNotebookTab && <div className="flex items-center py-2 pl-2 pr-3 border-b border-default bg-elevated gap-2 h-[50px]">
        {!activeTab.readOnly && activeTab.isLoading ? (
          <button
            onClick={stopQuery}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-sm font-medium"
          >
            <Square size={16} fill="currentColor" /> {t("editor.stop")}
          </button>
        ) : !activeTab.readOnly ? (
          <div className="flex items-center rounded bg-green-700 relative">
            <button
              onClick={handleRunButton}
              disabled={!activeConnectionId}
              aria-label={`${t("editor.run")} (${isMac ? "Cmd+Enter" : "Ctrl+Enter"})`}
              aria-keyshortcuts={isMac ? "Meta+Enter" : "Control+Enter"}
              title={`${t("editor.run")} (${isMac ? "Cmd+Enter" : "Ctrl+Enter"})`}
              className={clsx(
                "flex items-center gap-2 px-3 py-1.5 text-white text-sm font-medium disabled:opacity-50 hover:bg-green-600",
                isTableTab ? "rounded" : "rounded-l",
              )}
            >
              <Play size={16} fill="currentColor" /> {t("editor.run")}
            </button>
            {!isTableTab && (
              <>
                <div className="h-5 w-[1px] bg-green-800"></div>
                <button
                  onClick={handleRunDropdownToggle}
                  disabled={!activeConnectionId}
                  className="px-1.5 py-1.5 text-white rounded-r hover:bg-green-600 disabled:opacity-50"
                >
                  <ChevronDown size={14} />
                </button>

                {isRunDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsRunDropdownOpen(false)}
                    />
                    <div className="absolute top-full left-0 mt-1 w-80 bg-surface-secondary border border-strong rounded shadow-xl z-50 flex flex-col py-1 max-h-80 overflow-y-auto">
                      {dropdownQueries.length === 0 ? (
                        <div className="px-4 py-2 text-xs text-muted italic">
                          {t("editor.noValidQueries")}
                        </div>
                      ) : (
                        dropdownQueries.map((q, i) => {
                          const label = statementLabel(q);
                          return (
                          <div
                            key={i}
                            className="flex items-center border-b border-strong/50 last:border-0 hover:bg-surface-tertiary/50 transition-colors group"
                          >
                            <button
                              onClick={() => {
                                runQuery(q, 1);
                                setIsRunDropdownOpen(false);
                              }}
                              className="text-left px-4 py-2 text-xs font-mono text-secondary hover:text-white flex-1 truncate"
                              title={q}
                            >
                              {label}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsRunDropdownOpen(false);
                                setSaveQueryModal({ isOpen: true, sql: q });
                              }}
                              className="p-2 text-muted hover:text-white hover:bg-surface transition-colors mr-1 rounded shrink-0 opacity-0 group-hover:opacity-100"
                              title={t("editor.saveThisQuery")}
                            >
                              <Save size={14} />
                            </button>
                          </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        ) : null}

        {/* Params Button */}
        {!isTableTab && (
          <button
            onClick={handleEditParams}
            disabled={
              !activeTab?.query ||
              extractQueryParams(activeTab.query).length === 0
            }
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary hover:bg-surface text-primary rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed border border-strong"
            title={t("editor.queryParameters")}
          >
            <span className="font-mono text-xs font-bold border border-muted text-secondary rounded px-1.5 py-0.5">
              P
            </span>
            {t("editor.parameters")}
          </button>
        )}

        <div className="relative ml-auto">
          <button
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            disabled={!activeTab.result || activeTab.result.rows.length === 0}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            className={clsx(
              "flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              exportMenuOpen
                ? "bg-blue-500/15 border-blue-500/40 text-blue-400"
                : "bg-surface-secondary enabled:hover:bg-blue-500/15 enabled:hover:border-blue-500/40 enabled:hover:text-blue-400 text-primary border-strong",
            )}
          >
            <Download size={16} />
            {t("editor.export")}
            <ChevronDown
              size={14}
              className={clsx(
                "transition-transform opacity-70",
                exportMenuOpen && "rotate-180",
              )}
            />
          </button>
          {exportMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setExportMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute top-full right-0 mt-1 w-44 bg-elevated border border-strong rounded-md shadow-xl z-50 flex flex-col py-1 overflow-hidden"
              >
                <button
                  role="menuitem"
                  onClick={handleExportCSV}
                  className="flex items-center gap-2.5 text-left px-3 py-2 text-sm text-secondary hover:bg-blue-500/15 hover:text-blue-400 transition-colors"
                >
                  <FileText size={14} className="shrink-0 opacity-80" />
                  <span className="flex-1">CSV</span>
                  <span className="text-xs text-muted">.csv</span>
                </button>
                <button
                  role="menuitem"
                  onClick={handleExportJSON}
                  className="flex items-center gap-2.5 text-left px-3 py-2 text-sm text-secondary hover:bg-blue-500/15 hover:text-blue-400 transition-colors"
                >
                  <FileJson size={14} className="shrink-0 opacity-80" />
                  <span className="flex-1">JSON</span>
                  <span className="text-xs text-muted">.json</span>
                </button>
              </div>
            </>
          )}
        </div>
        {!isTableTab && isMultiDb && activeTab.type !== "query_builder" ? (
          <div className="relative ml-2">
            <button
              onClick={() => setIsDbDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 px-2 py-1 bg-surface-secondary border border-strong rounded text-xs text-primary hover:bg-surface transition-colors h-[30px]"
              title={t("editor.activeDatabase")}
            >
              <Database size={12} className="text-muted shrink-0" />
              <span className="max-w-[120px] truncate">
                {activeTab.schema || selectedDatabases[0]}
              </span>
              <ChevronDown size={12} className="text-muted shrink-0" />
            </button>
            {isDbDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsDbDropdownOpen(false)}
                />
                <div className="absolute top-full right-0 mt-1 min-w-[140px] max-h-[280px] overflow-y-auto bg-surface-secondary border border-strong rounded shadow-xl z-50 flex flex-col py-1">
                  {selectedDatabases.map((db) => (
                    <button
                      key={db}
                      onClick={() => {
                        updateActiveTab({ schema: db });
                        setIsDbDropdownOpen(false);
                      }}
                      className={clsx(
                        "text-left px-3 py-1.5 text-xs hover:bg-surface transition-colors flex items-center gap-2",
                        (activeTab.schema || selectedDatabases[0]) === db
                          ? "text-white font-medium"
                          : "text-secondary",
                      )}
                    >
                      <Database size={11} className="text-muted shrink-0" />
                      {db}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted ml-2">
            {activeConnectionId
              ? t("editor.connected")
              : t("editor.disconnected")}
          </span>
        )}
      </div>}

      {/* Render all non-table tabs to prevent Monaco remounting */}
      {tabs.map((tab) => {
        if (tab.type === "table") return null;

        const isActive = tab.id === activeTabId;

        // Notebook tabs get full-height rendering
        if (tab.type === "notebook") {
          return (
            <div
              key={tab.id}
              style={{ display: isActive ? "flex" : "none" }}
              className="flex-1 flex flex-col min-h-0 overflow-hidden"
            >
              <NotebookView
                tab={tab}
                updateTab={updateTab}
                connectionId={activeConnectionId || ""}
                isActive={isActive}
              />
            </div>
          );
        }

        const isVisible = isActive && !isTableTab && isEditorOpen;

        return (
          <div
            key={tab.id}
            data-editor-panel
            style={{
              height: isResultsCollapsed ? "calc(100vh - 109px)" : editorHeight,
              display: isVisible ? "block" : "none",
            }}
            className="relative"
          >
            {tab.type === "query_builder" ? (
              <VisualQueryBuilder />
            ) : (
              <SqlEditorWrapper
                height="100%"
                initialValue={tab.query}
                onChange={(val) => {
                  if (isActive) updateTab(tab.id, { query: val });
                }}
                onRun={handleRunButton}
                onMount={
                  isActive
                    ? (editor, monaco) =>
                        handleEditorMount(editor, monaco, tab.id)
                    : undefined
                }
                editorKey={tab.id}
                options={{
                  padding: { top: 16, bottom: 40 },
                }}
              />
            )}

            {/* Editor overlay buttons — bottom-right */}
            {tab.type !== "query_builder" && (
              <div className="absolute bottom-2 right-6 z-10 flex items-center gap-1">
                {/* Visual Explain — hidden for read-only definition tabs */}
                {!tab.readOnly && (
                <button
                  onClick={handleExplainButton}
                  disabled={!activeConnectionId || !tab.query?.trim()}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted hover:text-green-300 bg-elevated/80 hover:bg-green-900/40 border border-default hover:border-green-500/40 transition-all disabled:opacity-30 disabled:pointer-events-none backdrop-blur-sm"
                  title={t("editor.visualExplain.title")}
                >
                  <Network size={12} />
                  {t("editor.visualExplain.buttonShort")}
                </button>
                )}
                {/* AI dropdown — only if AI enabled */}
                {settings.aiEnabled && (
                  <AiDropdownButton
                    onGenerate={() => setIsAiModalOpen(true)}
                    onExplain={() => setIsAiExplainModalOpen(true)}
                    disableAll={!activeConnectionId}
                    disableExplain={!tab.query?.trim()}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Resize Bar & Results Panel */}
      {!isNotebookTab && (isTableTab || !isResultsCollapsed) ? (
        <>
          {isTableTab ? (
            <TableToolbar
              initialFilter={activeTab?.filterClause}
              initialSort={activeTab?.sortClause}
              initialLimit={activeTab?.limitClause}
              placeholderColumn={placeholders.column}
              placeholderSort={placeholders.sort}
              defaultLimit={settings.resultPageSize || 100}
              columnMetadata={activeTab?.columnMetadata}
              onUpdate={handleToolbarUpdate}
            />
          ) : (
            <div
              onMouseDown={isEditorOpen ? startResize : undefined}
              className={clsx(
                "h-6 bg-elevated border-y border-default flex items-center justify-end px-2 relative",
                isEditorOpen ? "cursor-row-resize" : "",
              )}
            >
              <div
                className="flex items-center gap-0.5"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Detach results into a separate window */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDetachResults();
                  }}
                  disabled={detachedTabIds.has(activeTab.id)}
                  className="text-muted hover:text-secondary transition-colors p-1 hover:bg-surface-secondary rounded disabled:opacity-30 disabled:pointer-events-none"
                  title={t("editor.results.detach")}
                >
                  <ExternalLink size={14} />
                </button>
                {/* Minimize (collapse the results panel) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsResultsCollapsed(true);
                  }}
                  className="text-muted hover:text-secondary transition-colors p-1 hover:bg-surface-secondary rounded"
                  title={t("editor.results.minimize")}
                >
                  <Minus size={14} />
                </button>
                {/* Maximize results (hide editor) / restore */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    updateActiveTab({ isEditorOpen: !isEditorOpen });
                  }}
                  className="text-muted hover:text-secondary transition-colors p-1 hover:bg-surface-secondary rounded"
                  title={
                    isEditorOpen
                      ? t("editor.results.maximize")
                      : t("editor.results.restore")
                  }
                >
                  {isEditorOpen ? (
                    <Maximize2 size={14} />
                  ) : (
                    <Minimize2 size={14} />
                  )}
                </button>
                {/* Close (collapse the results panel, keeps the data) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsResultsCollapsed(true);
                  }}
                  className="text-muted hover:text-red-400 transition-colors p-1 hover:bg-surface-secondary rounded"
                  title={t("editor.results.close")}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Results Panel */}
          <div className="flex-1 overflow-hidden bg-elevated flex flex-col min-h-0">
            {detachedTabIds.has(activeTab.id) ? (
              <div className="flex flex-col items-center justify-center h-full text-muted gap-3">
                <ExternalLink size={28} className="opacity-60" />
                <p className="text-sm">{t("editor.results.detached")}</p>
                <button
                  onClick={() => handleReattachResults(activeTab.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-secondary hover:text-primary bg-surface-secondary hover:bg-surface-tertiary border border-default rounded transition-colors"
                >
                  <Minimize2 size={14} />
                  {t("editor.results.reattach")}
                </button>
              </div>
            ) : activeTab.results && activeTab.results.length > 0 ? (
              <MultiResultPanel
                results={activeTab.results}
                activeResultId={activeTab.activeResultId}
                tabId={activeTab.id}
                connectionId={activeConnectionId}
                copyFormat={copyFormat}
                csvDelimiter={csvDelimiter}
                csvIncludeHeaders={csvIncludeHeaders}
                onSelectResult={(entryId) =>
                  updateTab(activeTab.id, { activeResultId: entryId })
                }
                onRerunEntry={(entryId) => runResultEntryPage(entryId, 1)}
                onPageChange={runResultEntryPage}
                onCloseEntry={(entryId) => {
                  const { results: newResults, nextActiveId } =
                    removeResultEntry(
                      activeTab.results!,
                      entryId,
                      activeTab.activeResultId,
                    );
                  if (newResults.length === 0) {
                    updateTab(activeTab.id, {
                      results: undefined,
                      activeResultId: undefined,
                    });
                  } else {
                    updateTab(activeTab.id, {
                      results: newResults,
                      activeResultId: nextActiveId,
                    });
                  }
                }}
                onCloseOtherEntries={(entryId) => {
                  const { results: newResults, nextActiveId } =
                    removeOtherEntries(activeTab.results!, entryId);
                  updateTab(activeTab.id, {
                    results: newResults,
                    activeResultId: nextActiveId,
                  });
                }}
                onCloseEntriesToRight={(entryId) => {
                  const { results: newResults, nextActiveId } =
                    removeEntriesToRight(
                      activeTab.results!,
                      entryId,
                      activeTab.activeResultId,
                    );
                  updateTab(activeTab.id, {
                    results: newResults,
                    activeResultId: nextActiveId,
                  });
                }}
                onCloseEntriesToLeft={(entryId) => {
                  const { results: newResults, nextActiveId } =
                    removeEntriesToLeft(
                      activeTab.results!,
                      entryId,
                      activeTab.activeResultId,
                    );
                  updateTab(activeTab.id, {
                    results: newResults,
                    activeResultId: nextActiveId,
                  });
                }}
                onCloseAllEntries={() => {
                  updateTab(activeTab.id, {
                    results: undefined,
                    activeResultId: undefined,
                  });
                }}
                onRenameEntry={(entryId, label) => {
                  updateTab(activeTab.id, {
                    results: updateResultEntry(
                      activeTab.results!,
                      entryId,
                      { label },
                    ),
                  });
                }}
              />
            ) : activeTab.isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-muted">
                <div className="w-12 h-12 border-4 border-surface-secondary border-t-blue-500 rounded-full animate-spin mb-4"></div>
                <p className="text-sm">{t("editor.executingQuery")}</p>
              </div>
            ) : activeTab.error ? (
              <ErrorDisplay error={activeTab.error} t={t} />
            ) : activeTab.result &&
              activeTab.result.columns.length === 0 &&
              !(
                activeTab.pendingInsertions &&
                Object.keys(activeTab.pendingInsertions).length > 0
              ) ? (
              // Non-SELECT statement (INSERT/UPDATE/DELETE/DDL): no result set,
              // so surface an explicit success message instead of an empty grid.
              <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-center px-4">
                <CheckCircle2 size={32} className="text-green-500" />
                <p className="text-sm font-medium text-primary">
                  {t("editor.queryExecuted")}
                </p>
                <p className="text-xs text-secondary flex items-center gap-2">
                  {activeTab.result.affected_rows > 0 && (
                    <span>
                      {t("editor.rowsAffected", {
                        count: activeTab.result.affected_rows,
                      })}
                    </span>
                  )}
                  {activeTab.executionTime !== null && (
                    <span className="text-muted font-mono">
                      ({formatDuration(activeTab.executionTime)})
                    </span>
                  )}
                </p>
              </div>
            ) : activeTab.result ||
              (activeTab.pendingInsertions &&
                Object.keys(activeTab.pendingInsertions).length > 0) ? (
              <div className="flex-1 min-h-0 flex flex-col">
                {activeTab.result && (
                  <div className="p-2 bg-elevated text-xs text-secondary border-b border-default flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                      <span>
                        {t("editor.rowsRetrieved", {
                          count: activeTab.result.rows.length,
                        })}{" "}
                        {activeTab.executionTime !== null && (
                          <span className="text-muted ml-2 font-mono">
                            ({formatDuration(activeTab.executionTime)})
                          </span>
                        )}
                      </span>

                      {activeTab.result.pagination?.has_more && (
                        <span className="px-2 py-0.5 bg-accent-warning/15 text-accent-warning rounded text-[10px] font-semibold uppercase tracking-wide border border-accent-warning/50">
                          {t("editor.autoPaginated")}
                        </span>
                      )}
                    </div>

                    {/* Pagination Controls */}
                    {activeTab.result.pagination && (
                      <div className="flex items-center gap-1 bg-surface-secondary rounded border border-strong">
                        <button
                          disabled={
                            activeTab.result.pagination.page === 1 ||
                            activeTab.isLoading
                          }
                          onClick={() => runQuery(activeTab.query, 1)}
                          className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          title="First Page"
                        >
                          <ChevronsLeft size={14} />
                        </button>
                        <button
                          disabled={
                            activeTab.result.pagination.page === 1 ||
                            activeTab.isLoading
                          }
                          onClick={() =>
                            runQuery(
                              activeTab.query,
                              activeTab.result!.pagination!.page - 1,
                            )
                          }
                          className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                          title="Previous Page"
                        >
                          <ChevronLeft size={14} />
                        </button>

                        <div
                          className="px-3 text-secondary text-xs font-medium cursor-pointer hover:bg-surface-tertiary transition-colors min-w-[80px] text-center py-1"
                          onClick={() => {
                            setIsEditingPage(true);
                            setTempPage(
                              String(activeTab.result!.pagination!.page),
                            );
                          }}
                          title={t("editor.jumpToPage")}
                        >
                          {isEditingPage ? (
                            <input
                              autoFocus
                              type="text"
                              className="w-full bg-transparent text-center focus:outline-none text-white p-0 m-0 border-none h-full"
                              value={tempPage}
                              onChange={(e) => setTempPage(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const newPage = parseInt(tempPage);
                                  const totalRows =
                                    activeTab.result!.pagination!.total_rows;
                                  if (!isNaN(newPage) && newPage >= 1) {
                                    if (
                                      totalRows === null ||
                                      newPage <=
                                        Math.ceil(
                                          totalRows /
                                            activeTab.result!.pagination!
                                              .page_size,
                                        )
                                    ) {
                                      runQuery(activeTab.query, newPage);
                                    }
                                  }
                                  setIsEditingPage(false);
                                } else if (e.key === "Escape") {
                                  setIsEditingPage(false);
                                }
                                e.stopPropagation();
                              }}
                              onBlur={() => setIsEditingPage(false)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <>
                              {activeTab.result.pagination.total_rows !== null
                                ? t("editor.pageOf", {
                                    current: activeTab.result.pagination.page,
                                    total: Math.ceil(
                                      activeTab.result.pagination.total_rows /
                                        activeTab.result.pagination.page_size,
                                    ),
                                  })
                                : t("editor.page", {
                                    current: activeTab.result.pagination.page,
                                  })}
                            </>
                          )}
                        </div>

                        {activeTab.result.pagination.total_rows === null ? (
                          <button
                            disabled={isCountLoading || activeTab.isLoading}
                            onClick={() => loadCount()}
                            className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                            title={t("editor.loadRowCount")}
                          >
                            {isCountLoading ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Hash size={14} />
                            )}
                          </button>
                        ) : (
                          <span className="px-2 py-1 text-secondary text-xs font-medium border-l border-strong whitespace-nowrap">
                            {t("editor.rowCount", {
                              total:
                                activeTab.result.pagination.total_rows.toLocaleString(),
                            })}
                          </span>
                        )}

                        <button
                          disabled={
                            !activeTab.result.pagination.has_more ||
                            activeTab.isLoading
                          }
                          onClick={() =>
                            runQuery(
                              activeTab.query,
                              activeTab.result!.pagination!.page + 1,
                            )
                          }
                          className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                          title="Next Page"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          disabled={
                            activeTab.result.pagination.total_rows === null ||
                            activeTab.isLoading
                          }
                          onClick={() =>
                            runQuery(
                              activeTab.query,
                              Math.ceil(
                                activeTab.result!.pagination!.total_rows! /
                                  activeTab.result!.pagination!.page_size,
                              ),
                            )
                          }
                          className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                          title="Last Page"
                        >
                          <ChevronsRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Data Manipulation Toolbar (Below Header) */}
                {activeTab.activeTable && activeTab.result && (
                  <div className="p-1 px-2 bg-elevated border-b border-default flex items-center gap-2">
                    {!driverReadonly && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleNewRow}
                          disabled={!!activeTab.materialized}
                          className="flex items-center justify-center w-7 h-7 text-secondary hover:text-green-400 hover:bg-surface-secondary rounded transition-colors disabled:opacity-30"
                          title={t("editor.newRow")}
                        >
                          <Plus size={16} />
                        </button>
                        <button
                          onClick={handleDeleteRows}
                          disabled={
                            !!activeTab.materialized ||
                            !activeTab.selectedRows ||
                            activeTab.selectedRows.length === 0
                          }
                          className="flex items-center justify-center w-7 h-7 text-secondary hover:text-red-400 hover:bg-surface-secondary rounded transition-colors disabled:opacity-30"
                          title={t("dataGrid.deleteRow")}
                        >
                          <Minus size={16} />
                        </button>
                      </div>
                    )}

                    <div className="w-[1px] h-4 bg-surface-secondary mx-1"></div>

                    <div className="flex items-center gap-1 text-secondary">
                      <Copy size={13} className="shrink-0" />
                      <select
                        value={copyFormat}
                        onChange={(e) =>
                          setCopyFormat(e.target.value as "csv" | "json" | "sql-insert")
                        }
                        className="bg-transparent border-none text-[11px] text-secondary hover:text-primary focus:outline-none cursor-pointer appearance-none pr-3 font-medium uppercase tracking-wide"
                        title={t("settings.copyFormat")}
                        style={CHEVRON_SELECT_STYLE}
                      >
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                        <option value="sql-insert">SQL INSERT</option>
                      </select>
                      {copyFormat === "csv" && (
                        <select
                          value={csvDelimiter}
                          onChange={(e) => setCsvDelimiter(e.target.value)}
                          className="bg-transparent border-none text-[11px] text-secondary hover:text-primary focus:outline-none cursor-pointer appearance-none pr-3 font-medium tracking-wide"
                          title={t("settings.csvDelimiter")}
                          style={CHEVRON_SELECT_STYLE}
                        >
                          <option value=",">
                            {t("settings.delimiterComma")}
                          </option>
                          <option value=";">
                            {t("settings.delimiterSemicolon")}
                          </option>
                          <option value={"\t"}>
                            {t("settings.delimiterTab")}
                          </option>
                          <option value="|">
                            {t("settings.delimiterPipe")}
                          </option>
                        </select>
                      )}
                      {copyFormat === "csv" && (
                        <label
                          className="flex items-center gap-1 cursor-pointer select-none text-[11px] text-secondary hover:text-primary"
                          title={t("settings.csvIncludeHeaders")}
                        >
                          <input
                            type="checkbox"
                            checked={csvIncludeHeaders}
                            onChange={(e) =>
                              setCsvIncludeHeaders(e.target.checked)
                            }
                            className="w-3 h-3 cursor-pointer accent-blue-500"
                          />
                          <span className="font-medium tracking-wide">
                            {t("settings.csvHeaders")}
                          </span>
                        </label>
                      )}
                    </div>

                    {/* Separator */}
                    {hasPendingChanges && (
                      <div className="w-[1px] h-4 bg-surface-secondary mx-1"></div>
                    )}

                    {hasPendingChanges && (
                      <div className="ml-auto flex items-center my-1 bg-surface-secondary/30 border border-default rounded-xl overflow-hidden cursor-pointer">
                        <label className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none group hover:bg-surface-secondary transition-colors">
                          <input
                            type="checkbox"
                            checked={applyToAll}
                            onChange={(e) => setApplyToAll(e.target.checked)}
                            className="w-4 h-4 cursor-pointer accent-primary"
                          />
                          <span className="text-sm text-primary font-medium">
                            {t("editor.applyToAll")}
                          </span>
                        </label>
                        <div className="w-px self-stretch bg-default"></div>
                        <button
                          onClick={handleSubmitChanges}
                          disabled={!applyToAll && !selectionHasPending}
                          className="flex items-center gap-1.5 px-4 py-2 text-accent-success hover:bg-surface-secondary transition-colors text-sm font-medium disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                          title={t("editor.submitChanges")}
                        >
                          <Check size={15} />
                          <span>Submit</span>
                        </button>
                        <div className="w-px self-stretch bg-default"></div>
                        <button
                          onClick={handleRollbackChanges}
                          disabled={!applyToAll && !selectionHasPending}
                          className="flex items-center gap-1.5 px-4 py-2 text-secondary hover:text-primary hover:bg-surface-secondary transition-colors text-sm font-medium disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer"
                          title={t("editor.rollbackChanges")}
                        >
                          <ArrowLeftToLine size={15} />
                          <span>Rollback</span>
                        </button>
                        <div className="w-px self-stretch bg-default"></div>
                        <span className="px-4 py-2 text-sm font-medium text-accent-primary select-none hover:bg-surface-secondary transition-colors">
                          {Object.keys(activeTab.pendingChanges || {}).length +
                            Object.keys(activeTab.pendingDeletions || {})
                              .length +
                            Object.keys(activeTab.pendingInsertions || {})
                              .length}{" "}
                          pending
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <DataGrid
                      key={`${activeTab.id}-${activeTab.sortClause || "none"}-${activeTab.filterClause || "none"}-${activeTab.result?.rows.length || 0}-${Object.keys(activeTab.pendingInsertions || {}).length}`}
                      columns={activeTab.result?.columns || []}
                      data={activeTab.result?.rows || []}
                      tableName={activeTab.activeTable}
                      pkColumns={activeTab.pkColumns}
                      autoIncrementColumns={activeTab.autoIncrementColumns}
                      defaultValueColumns={activeTab.defaultValueColumns}
                      nullableColumns={activeTab.nullableColumns}
                      columnMetadata={activeTab.columnMetadata}
                      foreignKeys={activeTab.foreignKeys}
                      onForeignKeyNavigate={handleForeignKeyNavigate}
                      onForeignKeyShowPanel={handleForeignKeyShowPanel}
                      onForeignKeyHidePanel={() => setActiveFkQuery(null)}
                      connectionId={activeConnectionId}
                      onRefresh={handleRefresh}
                      pendingChanges={activeTab.pendingChanges}
                      pendingDeletions={activeTab.pendingDeletions}
                      pendingInsertions={activeTab.pendingInsertions}
                      onPendingChange={handlePendingChange}
                      onPendingInsertionChange={handlePendingInsertionChange}
                      onDiscardInsertion={handleDiscardInsertion}
                      onRevertDeletion={handleRevertDeletion}
                      onMarkForDeletion={handleMarkForDeletion}
                      onMarkMultipleForDeletion={handleMarkMultipleForDeletion}
                      onDuplicateRow={handleDuplicateRow}
                      selectedRows={new Set(activeTab.selectedRows || [])}
                      onSelectionChange={handleSelectionChange}
                      copyFormat={copyFormat}
                      csvDelimiter={csvDelimiter}
                      csvIncludeHeaders={csvIncludeHeaders}
                      sortClause={activeTab.sortClause}
                      onSort={
                        activeTab.type === "table" &&
                        (activeTab.result?.rows.length ?? 0) > 0
                          ? handleSort
                          : undefined
                      }
                      readonly={driverReadonly || !!activeTab.materialized}
                    />
                  </div>
                  {activeFkQuery && activeConnectionId && (
                    <RelatedRecordsPanel
                      activeFkQuery={activeFkQuery}
                      connectionId={activeConnectionId}
                      driver={activeDriver}
                      schema={activeSchema}
                      onClose={() => setActiveFkQuery(null)}
                      onNavigateToTab={handleForeignKeyNavigate}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-surface-tertiary text-sm">
                {activeTab.type === "table"
                  ? t("editor.tableRunPrompt")
                  : t("editor.executePrompt")}
              </div>
            )}
          </div>
        </>
      ) : (
        // Show Results Button (when collapsed)
        <div className="h-10 bg-elevated border-t border-default flex items-center justify-end px-2">
          <button
            onClick={() => setIsResultsCollapsed(false)}
            className="text-muted hover:text-secondary transition-colors p-1 hover:bg-surface-secondary rounded"
            title="Show Results Panel"
          >
            <ChevronUp size={16} />
          </button>
        </div>
      )}

      {activeTab.activeTable && (
        <NewRowModal
          isOpen={showNewRowModal}
          onClose={() => setShowNewRowModal(false)}
          tableName={activeTab.activeTable}
          onSaveSuccess={handleRefresh}
        />
      )}
      <QuerySelectionModal
        isOpen={isQuerySelectionModalOpen}
        queries={selectableQueries}
        onSelect={(q) => {
          runQuery(q, 1);
          setIsQuerySelectionModalOpen(false);
        }}
        onRunAll={(queries) => {
          runMultipleQueries(queries);
          setIsQuerySelectionModalOpen(false);
        }}
        onRunSelected={(queries) => {
          runMultipleQueries(queries);
          setIsQuerySelectionModalOpen(false);
        }}
        onClose={() => setIsQuerySelectionModalOpen(false)}
      />
      <ConfirmModal
        isOpen={!!dangerousQuery}
        onClose={() => resolveDangerousQuery(false)}
        onConfirm={() => resolveDangerousQuery(true)}
        title={t(
          dangerousQuery
            ? DANGEROUS_QUERY_I18N[dangerousQuery.kind].title
            : "editor.dangerousQueryTitle",
        )}
        message={t(
          dangerousQuery
            ? DANGEROUS_QUERY_I18N[dangerousQuery.kind].message
            : "editor.dangerousQueryMessage",
        )}
        sql={dangerousQuery?.sql}
        confirmLabel={t("editor.dangerousQueryConfirm")}
        variant="danger"
        confirmDelaySeconds={5}
      />
      <TabSwitcherModal
        isOpen={isTabSwitcherOpen}
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={(tabId) => {
          setActiveTabId(tabId);
          setIsTabSwitcherOpen(false);
        }}
        onClose={(tabId) => handleCloseTab(tabId)}
        onDismiss={() => setIsTabSwitcherOpen(false)}
      />
      {saveQueryModal.isOpen && (
        <QueryModal
          isOpen={saveQueryModal.isOpen}
          onClose={() =>
            setSaveQueryModal({ ...saveQueryModal, isOpen: false })
          }
          initialSql={saveQueryModal.sql}
          initialDatabase={activeTab?.schema ?? activeSchema ?? activeDatabaseName}
          databases={isMultiDb ? selectedDatabases : undefined}
          onSave={async (name, sql, database) => await saveQuery(name, sql, database ?? activeTab?.schema ?? activeSchema ?? activeDatabaseName)}
          title={t("editor.saveQuery")}
        />
      )}
      <AiQueryModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        onInsert={(q) => {
          updateActiveTab({ query: q });
          runQuery(q, 1);
        }}
      />
      <AiExplainModal
        isOpen={isAiExplainModalOpen}
        onClose={() => setIsAiExplainModalOpen(false)}
        query={activeTab.query}
      />
      <VisualExplainModal
        isOpen={isVisualExplainOpen}
        onClose={() => {
          setIsVisualExplainOpen(false);
          setVisualExplainQuery(null);
        }}
        query={visualExplainQuery ?? activeTab?.query ?? ""}
        connectionId={activeConnectionId ?? ""}
        schema={activeTab?.schema ?? activeSchema ?? undefined}
      />
      <ExplainSelectionModal
        isOpen={isExplainSelectionOpen}
        queries={explainSelectableQueries}
        onSelect={(q) => {
          setIsExplainSelectionOpen(false);
          openExplainForQuery(q);
        }}
        onClose={() => setIsExplainSelectionOpen(false)}
      />
      {tabContextMenu && (
        <ContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          onClose={() => setTabContextMenu(null)}
          items={[
            ...(tabs.find((t) => t.id === tabContextMenu.tabId)?.type ===
            "notebook"
              ? [
                  {
                    label: t("sidebar.notebooks.rename"),
                    icon: Pencil,
                    action: () => startTabRename(tabContextMenu.tabId),
                  },
                ]
              : []),
            ...(!["console", "notebook", "query_builder"].includes(
              tabs.find((t) => t.id === tabContextMenu.tabId)?.type ?? "",
            )
              ? [
                  {
                    label: t("editor.convertToConsole"),
                    icon: FileCode,
                    action: () => handleConvertToConsole(tabContextMenu.tabId),
                  },
                ]
              : []),
            {
              label: t("editor.closeTab"),
              icon: X,
              action: () => handleCloseTab(tabContextMenu.tabId),
            },
            {
              label: t("editor.closeOthers"),
              icon: XCircle,
              action: () => closeOtherTabs(tabContextMenu.tabId),
            },
            {
              label: t("editor.closeRight"),
              icon: ArrowRightToLine,
              action: () => closeTabsToRight(tabContextMenu.tabId),
            },
            {
              label: t("editor.closeLeft"),
              icon: ArrowLeftToLine,
              action: () => closeTabsToLeft(tabContextMenu.tabId),
            },
            {
              label: t("editor.closeAll"),
              icon: Trash2,
              danger: true,
              action: () => closeAllTabs(),
            },
          ]}
        />
      )}
      <ErrorModal
        isOpen={errorModal.isOpen}
        onClose={() => setErrorModal({ isOpen: false, message: "" })}
        message={errorModal.message}
      />
      <ExportProgressModal
        isOpen={exportState.isOpen}
        status={exportState.status}
        rowsProcessed={exportState.rowsProcessed}
        fileName={exportState.fileName}
        errorMessage={exportState.errorMessage}
        onCancel={cancelExport}
        onClose={closeExportModal}
      />
      <QueryParamsModal
        isOpen={queryParamsModal.isOpen}
        onClose={() =>
          setQueryParamsModal((prev) => ({ ...prev, isOpen: false }))
        }
        onSubmit={handleParamsSubmit}
        parameters={queryParamsModal.parameters}
        initialValues={
          tabsRef.current.find((t) => t.id === queryParamsModal.pendingTabId)
            ?.queryParams || {}
        }
        mode={queryParamsModal.mode}
      />
    </div>
  );
};
