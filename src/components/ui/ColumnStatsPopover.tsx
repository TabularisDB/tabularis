import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChartColumn, Filter, Loader2, RefreshCw, X } from "lucide-react";
import { calculateContextMenuPosition } from "../../utils/contextMenu";
import {
  COLUMN_STATS_TOP_VALUES_LIMIT,
  formatColumnStatValue,
  isColumnStatsAbort,
  percentOf,
} from "../../utils/columnStats";
import type { ColumnStats, ColumnStatsSupport } from "../../utils/columnStats";
import { toErrorMessage } from "../../utils/errors";

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 440;

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stats: ColumnStats };

export interface ColumnStatsPopoverProps {
  /** Viewport point the popover opens at (the header menu's position). */
  x: number;
  y: number;
  column: string;
  /** What is computed for this column; decides the notes shown. */
  support: ColumnStatsSupport;
  /** The column is masked in the grid (values are not computed). */
  masked?: boolean;
  /**
   * Loads the statistics. Called when the popover opens and on retry; the
   * signal is aborted when the popover closes, so no further query starts
   * and a late result is ignored.
   */
  load: (signal: AbortSignal) => Promise<ColumnStats>;
  /** Filters the table by a top value. The list is read-only without it. */
  onFilterByValue?: (value: string) => void;
  /**
   * The element that gets focus back when the popover is closed from inside
   * (Escape, the close button or Cancel): the column header it was opened
   * for, or the grid. An outside click leaves focus on what was clicked, and
   * a top value leaves it to the grid, which the filter re-renders.
   */
  returnFocusTo?: () => HTMLElement | null;
  onClose: () => void;
}

/**
 * Popover with a column's row, distinct and NULL counts, min / max and its
 * most frequent values (issue #1001). Opened from the data grid's column
 * header menu; the query only runs while it is open.
 */
export const ColumnStatsPopover = ({
  x,
  y,
  column,
  support,
  masked = false,
  load,
  onFilterByValue,
  returnFocusTo,
  onClose,
}: ColumnStatsPopoverProps) => {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const popover = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // One load per open (and per retry). Unmounting aborts it, so closing the
  // popover starts no further query and ignores a late result.
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (stats) => {
        if (!controller.signal.aborted) setState({ status: "ready", stats });
      },
      (err: unknown) => {
        if (controller.signal.aborted || isColumnStatsAbort(err)) return;
        setState({ status: "error", message: toErrorMessage(err) });
      },
    );
    return () => controller.abort();
  }, [load, attempt]);

  const position = useMemo(() => {
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    return calculateContextMenuPosition({
      clickX: x,
      clickY: y,
      menuWidth: width,
      menuHeight: Math.min(POPOVER_HEIGHT, window.innerHeight - 16),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: 8,
    });
  }, [x, y]);

  const close = useCallback(
    (restoreFocus = false) => {
      onClose();
      if (restoreFocus) returnFocusTo?.()?.focus();
    },
    [onClose, returnFocusTo],
  );

  useEffect(() => {
    popover.current?.focus();
  }, []);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !popover.current?.contains(event.target)
      ) {
        close();
      }
    };
    const dismiss = () => close();
    const scroll = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !popover.current?.contains(event.target)
      ) {
        close();
      }
    };
    // On the dialog itself, so Escape closes it whether focus is on the
    // dialog (as right after it opens) or on a control inside it. Stopped
    // here so the grid doesn't also handle it (e.g. clearing the selection).
    const dialog = popover.current;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    dialog?.addEventListener("keydown", escape);
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      dialog?.removeEventListener("keydown", escape);
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [close]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  const pickValue = (value: string) => {
    onFilterByValue?.(value);
    close();
  };

  const formatPercent = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const renderStats = (stats: ColumnStats) => {
    const nonNull = stats.rowCount - stats.nullCount;
    // A plugin may compute the value stats over a sample (issue #1137): a
    // sample with no repeats says nothing about the whole column, and the
    // top value shares are relative to the sample.
    const sampleSize = stats.sampleSize ?? null;
    const allUnique =
      sampleSize === null &&
      stats.distinctCount !== null &&
      nonNull > 0 &&
      stats.distinctCount === nonNull;
    const valuesNote = masked
      ? t("dataGrid.columnStats.maskedNote")
      : t("dataGrid.columnStats.unsupportedNote");

    return (
      <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-2.5 text-xs">
          <dt className="text-muted">{t("dataGrid.columnStats.rows")}</dt>
          <dd className="text-right tabular-nums text-primary">
            {stats.rowCount.toLocaleString()}
          </dd>

          {stats.distinctCount !== null && (
            <>
              <dt className="text-muted">{t("dataGrid.columnStats.distinct")}</dt>
              <dd className="flex items-center justify-end gap-1.5 tabular-nums text-primary">
                {allUnique && (
                  <span className="px-1.5 rounded bg-accent-success/15 text-accent-success text-[10px] font-medium">
                    {t("dataGrid.columnStats.unique")}
                  </span>
                )}
                {stats.distinctCount.toLocaleString()}
              </dd>
            </>
          )}

          <dt className="text-muted">{t("dataGrid.columnStats.nulls")}</dt>
          <dd className="text-right tabular-nums text-primary">
            {stats.nullCount.toLocaleString()}
            {stats.rowCount > 0 && (
              <span className="ml-1.5 text-muted">
                ({formatPercent(percentOf(stats.nullCount, stats.rowCount))}%)
              </span>
            )}
          </dd>

          {support.minMax &&
            (["min", "max"] as const).map((key) => {
              const value = stats[key];
              const text = formatColumnStatValue(value);
              return (
                <div key={key} className="contents">
                  <dt className="text-muted">
                    {t(`dataGrid.columnStats.${key}`)}
                  </dt>
                  <dd
                    className="min-w-0 truncate text-right font-mono text-primary"
                    title={text}
                  >
                    {value === null || value === undefined ? (
                      <span className="italic text-muted">NULL</span>
                    ) : (
                      text
                    )}
                  </dd>
                </div>
              );
            })}
        </dl>

        {stats.filtered && (
          <p className="flex items-center gap-1.5 px-3 pb-2 text-[11px] text-muted">
            <Filter size={11} className="shrink-0" />
            {t("dataGrid.columnStats.filtered")}
          </p>
        )}

        {sampleSize !== null && (
          <p className="px-3 pb-2 text-[11px] text-muted">
            {t("dataGrid.columnStats.sampled", {
              size: sampleSize.toLocaleString(),
            })}
          </p>
        )}

        <div className="border-t border-default/60 px-3 pt-2 pb-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {t("dataGrid.columnStats.topValues", {
              count: COLUMN_STATS_TOP_VALUES_LIMIT,
            })}
          </div>
        </div>
        {stats.topValues === null ? (
          <p className="px-3 pb-2.5 text-xs text-muted">{valuesNote}</p>
        ) : stats.topValues.length === 0 ? (
          <p className="px-3 pb-2.5 text-xs text-muted">
            {stats.rowCount === 0
              ? t("dataGrid.columnStats.noRows")
              : t("dataGrid.columnStats.onlyNulls")}
          </p>
        ) : (
          <ul className="pb-1">
            {stats.topValues.map((v) => {
              const share = percentOf(v.count, sampleSize ?? stats.rowCount);
              const content = (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0.5 left-0 rounded-r bg-accent-primary/10"
                    style={{ width: `${Math.max(share, 1)}%` }}
                  />
                  <span
                    className="relative flex-1 min-w-0 truncate font-mono text-secondary"
                    title={v.value}
                  >
                    {v.value === "" ? (
                      <span className="italic text-muted">''</span>
                    ) : (
                      v.value
                    )}
                  </span>
                  <span className="relative shrink-0 tabular-nums text-muted">
                    {v.count.toLocaleString()}
                  </span>
                </>
              );
              return (
                <li key={v.value}>
                  {onFilterByValue ? (
                    <button
                      type="button"
                      onClick={() => pickValue(v.value)}
                      title={t("dataGrid.columnStats.filterBy", {
                        value: v.value,
                      })}
                      className={`relative flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-surface-secondary/60 ${FOCUS_RING}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="relative flex items-center gap-2 px-3 py-1 text-xs">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  };

  return createPortal(
    <div
      ref={popover}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={position}
      className="fixed z-[200] flex flex-col w-80 max-w-[calc(100vw-16px)] max-h-[440px] rounded-lg border border-strong bg-elevated shadow-xl focus:outline-none"
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-default/60">
          <ChartColumn size={14} className="shrink-0 text-accent" />
          <div className="flex-1 min-w-0">
            <div id={titleId} className="text-xs font-medium text-secondary">
              {t("dataGrid.columnStats.title")}
            </div>
            <div
              className="truncate font-mono text-[11px] text-muted"
              title={column}
            >
              {column}
            </div>
          </div>
          <button
            type="button"
            onClick={() => close(true)}
            aria-label={t("dataGrid.columnStats.close")}
            title={t("dataGrid.columnStats.close")}
            className={`shrink-0 p-1 rounded text-muted hover:text-primary transition-colors ${FOCUS_RING}`}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-[96px] overflow-y-auto">
          {state.status === "loading" && (
            <div className="flex items-center gap-2 px-3 py-3">
              <div
                role="status"
                className="flex flex-1 items-center gap-2 text-xs text-muted"
              >
                <Loader2 size={12} className="animate-spin" />
                {t("dataGrid.columnStats.loading")}
              </div>
              <button
                type="button"
                onClick={() => close(true)}
                className={`px-2.5 py-1 rounded text-xs text-muted border border-default/70 hover:text-secondary hover:border-default transition-colors ${FOCUS_RING}`}
              >
                {t("common.cancel")}
              </button>
            </div>
          )}
          {state.status === "error" && (
            <div className="px-3 py-3 space-y-2">
              <p role="alert" className="text-xs text-accent-error break-words">
                {t("dataGrid.columnStats.error")}: {state.message}
              </p>
              <button
                type="button"
                onClick={retry}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted border border-default/70 hover:text-secondary hover:border-default transition-colors ${FOCUS_RING}`}
              >
                <RefreshCw size={11} />
                {t("dataGrid.columnStats.retry")}
              </button>
            </div>
          )}
          {state.status === "ready" && renderStats(state.stats)}
        </div>

        {state.status === "ready" &&
          onFilterByValue &&
          !!state.stats.topValues?.length && (
            <div className="px-3 py-1.5 border-t border-default/60 bg-base/40 rounded-b-lg text-[10px] text-muted">
              {t("dataGrid.columnStats.clickToFilter")}
            </div>
          )}
      </div>
    </div>,
    document.body,
  );
};
