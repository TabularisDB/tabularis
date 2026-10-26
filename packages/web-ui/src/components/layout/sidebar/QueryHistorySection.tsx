import {useState, useMemo, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {
    Search,
    Trash2,
    Loader2,
    Database,
    AlertTriangle,
    X,
    ChevronDown,
    Pause,
} from 'lucide-react';
import {groupByDate, formatHistoryTime} from '@/utils/dateGroups';
import {SqlHighlight} from '@/components/ui/SqlHighlight';
import {formatSqlPreview} from '@/utils/sqlHighlight';
import {useSettings} from '@/hooks/useSettings';
import {
    filterQueryHistoryEntries,
    getQueryHistoryDatabaseChoices,
    isQueryHistoryDatabaseFilterAvailable,
    isQueryHistoryFilterActive,
    queryHistoryDatabaseFilterFor,
    validateQueryHistoryDateRange,
    QUERY_HISTORY_OUTCOME_OPTIONS,
    QUERY_HISTORY_TIME_RANGE_OPTIONS,
    type QueryHistoryDatabaseFilter,
    type QueryHistoryDateRangeError,
    type QueryHistoryOutcomeFilter,
    type QueryHistoryTimeRange,
} from '@/utils/queryHistoryFilter';
import type {QueryHistoryEntry, QueryHistoryRecoveryNotice} from '@/types/queryHistory';

interface QueryHistorySectionProps {
    entries: QueryHistoryEntry[];
    isLoading: boolean;
    isPaused?: boolean;
    onTogglePaused?: () => void;
    recoveryNotice: QueryHistoryRecoveryNotice | null;
    onDismissRecoveryNotice: () => void;
    onDoubleClick: (entry: QueryHistoryEntry) => void;
    onContextMenu: (e: React.MouseEvent, entry: QueryHistoryEntry) => void;
    onClearAll: () => void;
}

const selectClassName =
    'w-full appearance-none bg-surface-secondary border border-default rounded px-1.5 pr-5 py-1 text-[11px] text-primary focus:outline-none focus:border-focus/50 cursor-pointer';

const dateInputClassName =
    'w-full min-w-0 bg-surface-secondary border border-default rounded px-1.5 py-1 text-[11px] text-primary focus:outline-none focus:border-focus/50';

const RANGE_ERROR_LABEL_KEYS: Record<QueryHistoryDateRangeError, string> = {
    invalidFrom: 'sidebar.historyDateRangeInvalidFrom',
    invalidTo: 'sidebar.historyDateRangeInvalidTo',
    inverted: 'sidebar.historyDateRangeInverted',
};

const OUTCOME_LABEL_KEYS: Record<QueryHistoryOutcomeFilter, string> = {
    any: 'sidebar.historyOutcomeAny',
    succeeded: 'sidebar.historyOutcomeSucceeded',
    failed: 'sidebar.historyOutcomeFailed',
};

const TIME_RANGE_LABEL_KEYS: Record<QueryHistoryTimeRange, string> = {
    all: 'sidebar.historyTimeAll',
    lastHour: 'sidebar.historyTimeLastHour',
    today: 'sidebar.historyTimeToday',
    last7Days: 'sidebar.historyTimeLast7Days',
    last30Days: 'sidebar.historyTimeLast30Days',
    custom: 'sidebar.historyTimeCustom',
};

export function QueryHistorySection({
    entries,
    isLoading,
    isPaused = false,
    onTogglePaused,
    recoveryNotice,
    onDismissRecoveryNotice,
    onDoubleClick,
    onContextMenu,
    onClearAll,
}: QueryHistorySectionProps) {
    const {t} = useTranslation();
    const {settings} = useSettings();
    const pauseToggleRef = useRef<HTMLButtonElement>(null);

    // Session-only: search and the new filters reset when the section unmounts
    // (same as the existing search field; nothing is persisted).
    const [search, setSearch] = useState('');
    const [outcome, setOutcome] = useState<QueryHistoryOutcomeFilter>('any');
    const [timeRange, setTimeRange] = useState<QueryHistoryTimeRange>('all');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [database, setDatabase] = useState<QueryHistoryDatabaseFilter>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // "custom" is a mode of the time-range select, not a second filter: the
    // From/To inputs only exist while it is selected.
    const isCustomRange = timeRange === 'custom';

    const rangeError = validateQueryHistoryDateRange(from, to);

    const databaseChoices = useMemo(() => getQueryHistoryDatabaseChoices(entries), [entries]);
    // A database that is no longer among the loaded entries (another connection's
    // history, or its last entry was deleted) falls back to "All databases".
    if (!isQueryHistoryDatabaseFilterAvailable(database, databaseChoices)) {
        setDatabase('all');
    }

    const filterActive = isQueryHistoryFilterActive({
        search,
        outcome,
        timeRange,
        database,
        from,
        to,
    });

    const filteredEntries = useMemo(
        () =>
            filterQueryHistoryEntries(entries, {
                search,
                outcome,
                timeRange,
                database,
                from,
                to,
                timeZone: settings.displayTimezone,
            }),
        [entries, search, outcome, timeRange, database, from, to, settings.displayTimezone],
    );

    const groupedEntries = useMemo(
        () => groupByDate(filteredEntries, (e) => e.executedAt, settings.displayTimezone),
        [filteredEntries, settings.displayTimezone],
    );

    const formatDuration = (ms: number | null): string => {
        if (ms === null) return '';
        if (ms < 1000) return `${Math.round(ms)}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    // A toggle with a constant name: the pressed state, not the label, says
    // whether capture is paused (#1212).
    const pauseToggleButton = onTogglePaused ? (
        <button
            ref={pauseToggleRef}
            type="button"
            onClick={onTogglePaused}
            aria-pressed={isPaused}
            className={`p-1 rounded transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                isPaused
                    ? 'text-accent-warning bg-accent-warning/15 hover:bg-accent-warning/25'
                    : 'text-muted hover:text-primary'
            }`}
            title={t('sidebar.pauseHistoryCapture')}
            aria-label={t('sidebar.pauseHistoryCapture')}
        >
            <Pause size={13} />
        </button>
    ) : null;

    // The banner's resume link disappears with the banner, so hand focus to the
    // toggle, which then reads as not pressed.
    const resumeFromBanner = () => {
        onTogglePaused?.();
        pauseToggleRef.current?.focus();
    };

    // The live region stays mounted and only its text changes: some screen
    // readers skip a status region inserted together with its content.
    const pausedBanner = (
        <div
            className={
                isPaused
                    ? 'mx-2 mb-1.5 px-2.5 py-1.5 bg-accent-warning/10 border border-accent-warning/40 rounded flex items-center justify-between gap-2 text-[11px] text-accent-warning'
                    : 'sr-only'
            }
        >
            <div className="flex items-center gap-1.5 min-w-0">
                {isPaused && <Pause size={12} className="shrink-0 text-accent-warning" />}
                <span role="status" className="truncate">
                    {isPaused ? t('sidebar.historyCapturePausedNotice') : ''}
                </span>
            </div>
            {isPaused && onTogglePaused && (
                <button
                    type="button"
                    onClick={resumeFromBanner}
                    className="shrink-0 font-medium underline hover:text-accent-warning/80 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                    {t('sidebar.resumeHistoryCapture')}
                </button>
            )}
        </div>
    );

    const recoveryBanner = recoveryNotice ? (
        <div className="m-2 p-2.5 bg-accent-warning/10 border border-accent-warning/40 rounded text-[11px] text-accent-warning leading-snug">
            <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-accent-warning" />
                <div className="flex-1 min-w-0">
                    <div className="font-semibold mb-1">{t('sidebar.historyRecoveredTitle')}</div>
                    <div className="text-accent-warning/80">
                        {t('sidebar.historyRecoveredBody')}
                    </div>
                    <div
                        className="mt-1 font-mono text-[10px] text-accent-warning/70 break-all"
                        title={recoveryNotice.backupPath}
                    >
                        {recoveryNotice.backupPath}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onDismissRecoveryNotice}
                    className="shrink-0 text-accent-warning/60 hover:text-accent-warning transition-colors"
                    title={t('sidebar.historyRecoveredDismiss')}
                    aria-label={t('sidebar.historyRecoveredDismiss')}
                >
                    <X size={12} />
                </button>
            </div>
        </div>
    ) : null;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-20 text-muted gap-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">{t('sidebar.loadingSchema')}</span>
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div>
                {recoveryBanner}
                {onTogglePaused && (
                    <div className="px-2 pb-1.5 flex items-center justify-end">
                        {pauseToggleButton}
                    </div>
                )}
                {pausedBanner}
                <div className="text-center p-4 text-xs text-muted italic">
                    {t('sidebar.noQueryHistory')}
                </div>
            </div>
        );
    }

    return (
        <div>
            {recoveryBanner}
            {/* Header with search, pause/resume, and clear */}
            <div className="px-2 pb-1.5 flex items-center gap-1">
                <div className="relative flex-1">
                    <Search
                        size={12}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                        autoCorrect="off"
                        autoCapitalize="off"
                        autoComplete="off"
                        spellCheck={false}
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('sidebar.searchHistory')}
                        className="w-full pl-6 pr-2 py-1 text-xs bg-surface-secondary border border-default rounded text-primary placeholder:text-muted focus:outline-none focus:border-focus/50"
                    />
                </div>
                {pauseToggleButton}
                <button
                    type="button"
                    onClick={onClearAll}
                    className="p-1 text-muted hover:text-accent-error transition-colors shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                    title={t('sidebar.clearAllHistory')}
                    aria-label={t('sidebar.clearAllHistory')}
                >
                    <Trash2 size={13} />
                </button>
            </div>
            {pausedBanner}

            {/* Database filter (session-only, same as search) */}
            <div className="px-2 pb-1.5">
                <div className="relative min-w-0">
                    <select
                        value={database}
                        onChange={(e) => setDatabase(e.target.value as QueryHistoryDatabaseFilter)}
                        aria-label={t('sidebar.historyDatabaseFilter')}
                        className={selectClassName}
                    >
                        <option value="all">{t('sidebar.historyDatabaseAll')}</option>
                        {databaseChoices.databases.map((name) => (
                            <option key={name} value={queryHistoryDatabaseFilterFor(name)}>
                                {name}
                            </option>
                        ))}
                        {databaseChoices.hasUnrecorded && (
                            <option value="none">{t('sidebar.historyDatabaseNone')}</option>
                        )}
                    </select>
                    <ChevronDown
                        size={10}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                </div>
            </div>

            {/* Outcome + time filters (session-only, same as search) */}
            <div className="px-2 pb-1.5 flex items-center gap-1">
                <div className="relative flex-1 min-w-0">
                    <select
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value as QueryHistoryOutcomeFilter)}
                        aria-label={t('sidebar.historyOutcomeFilter')}
                        className={selectClassName}
                    >
                        {QUERY_HISTORY_OUTCOME_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                                {t(OUTCOME_LABEL_KEYS[value])}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        size={10}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                </div>
                <div className="relative flex-1 min-w-0">
                    <select
                        value={timeRange}
                        onChange={(e) => {
                            const next = e.target.value as QueryHistoryTimeRange;
                            setTimeRange(next);
                            // Presets must not stack on top of dates the user can no
                            // longer see: from/to only exist in the custom mode.
                            if (next !== 'custom') {
                                setFrom('');
                                setTo('');
                            }
                        }}
                        aria-label={t('sidebar.historyTimeRangeFilter')}
                        className={selectClassName}
                    >
                        {QUERY_HISTORY_TIME_RANGE_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                                {t(TIME_RANGE_LABEL_KEYS[value])}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        size={10}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                </div>
            </div>

            {/* Custom date range (session-only, same as the filters above): the
                inputs only exist while the custom mode is selected. */}
            {isCustomRange && (
                <div className="px-2 pb-1.5 flex items-center gap-1">
                    {/* Each pair is a label wrapping its input, so a click on the
                        text focuses the field, not just the input itself. */}
                    <label className="flex-1 min-w-0 flex items-center gap-1">
                        <span className="text-[10px] text-muted shrink-0">
                            {t('sidebar.historyDateFrom')}
                        </span>
                        <input
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                            aria-label={t('sidebar.historyDateFrom')}
                            className={dateInputClassName}
                        />
                    </label>
                    <label className="flex-1 min-w-0 flex items-center gap-1">
                        <span className="text-[10px] text-muted shrink-0">
                            {t('sidebar.historyDateTo')}
                        </span>
                        <input
                            type="date"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            aria-label={t('sidebar.historyDateTo')}
                            className={dateInputClassName}
                        />
                    </label>
                </div>
            )}

            {/* Explain a custom range that cannot be applied instead of widening it */}
            {isCustomRange && rangeError && (
                <div role="alert" className="px-3 pb-1 text-[10px] text-accent-warning">
                    {t(RANGE_ERROR_LABEL_KEYS[rangeError])}
                </div>
            )}

            {/* Filtered / total counter whenever any filter is active */}
            {filterActive && (
                <div className="px-3 pb-1 flex items-center justify-between gap-2 text-[10px] text-muted">
                    <span>
                        {filteredEntries.length} / {entries.length}
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            setSearch('');
                            setOutcome('any');
                            setTimeRange('all');
                            setDatabase('all');
                            setFrom('');
                            setTo('');
                        }}
                        className="shrink-0 underline hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                    >
                        {t('sidebar.historyClearFilters')}
                    </button>
                </div>
            )}

            {/* Grouped entries */}
            {groupedEntries.length === 0 ? (
                <div className="text-center p-2 text-xs text-muted italic">
                    {t('sidebar.noHistorySearchResults')}
                </div>
            ) : (
                groupedEntries.map(([groupKey, items]) => (
                    <div key={groupKey}>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase text-muted tracking-wider">
                            {t(`sidebar.${groupKey}`)}
                        </div>
                        {items.map((entry) => (
                            <button
                                type="button"
                                key={entry.id}
                                aria-pressed={selectedId === entry.id}
                                onClick={() => setSelectedId(entry.id)}
                                onDoubleClick={() => onDoubleClick(entry)}
                                onKeyDown={(e) => {
                                    // Enter opens the entry like a double click; Space keeps selecting it.
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        setSelectedId(entry.id);
                                        onDoubleClick(entry);
                                    }
                                }}
                                onContextMenu={(e) => onContextMenu(e, entry)}
                                className={`block w-full text-left pl-3 pr-3 py-1.5 cursor-pointer group transition-colors border-b border-default/30 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                                    selectedId === entry.id
                                        ? entry.status === 'error'
                                            ? 'bg-accent-error/15'
                                            : 'bg-surface-secondary'
                                        : entry.status === 'error'
                                          ? 'hover:bg-accent-error/10'
                                          : 'hover:bg-surface-secondary'
                                }`}
                                title={
                                    entry.database ? `[${entry.database}] ${entry.sql}` : entry.sql
                                }
                            >
                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <div className="flex items-center gap-1 text-[10px] text-muted min-w-0">
                                        <span>
                                            {formatHistoryTime(
                                                entry.executedAt,
                                                settings.displayTimezone,
                                            )}
                                        </span>
                                        {entry.executionTimeMs !== null && (
                                            <span className="text-muted/60">
                                                {formatDuration(entry.executionTimeMs)}
                                            </span>
                                        )}
                                    </div>
                                    {entry.database && (
                                        <div className="flex items-center gap-0.5 text-[10px] text-muted shrink-0">
                                            <Database size={9} className="shrink-0" />
                                            <span className="truncate max-w-[80px]">
                                                {entry.database}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                {entry.status === 'error' ? (
                                    <pre
                                        className="text-[11px] leading-[1.4] font-mono whitespace-pre-wrap break-all text-accent-error/70 overflow-hidden"
                                        style={{
                                            display: '-webkit-box',
                                            WebkitLineClamp: 3,
                                            WebkitBoxOrient: 'vertical',
                                        }}
                                    >
                                        {formatSqlPreview(entry.sql)}
                                    </pre>
                                ) : (
                                    <SqlHighlight sql={entry.sql} />
                                )}
                            </button>
                        ))}
                    </div>
                ))
            )}
        </div>
    );
}
