import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ListChecks, Loader2, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { calculateContextMenuPosition } from "../../utils/contextMenu";
import {
  filterDistinctValues,
  VALUE_PICKER_LIMIT,
} from "../../utils/filterBar";
import type { DistinctValue } from "../../utils/filterBar";
import { toErrorMessage } from "../../utils/errors";

const POPOVER_WIDTH = 288;
const POPOVER_HEIGHT = 360;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; values: DistinctValue[] };

export interface FilterValuePickerProps {
  /** Loads the column's most frequent values; called each time the picker opens. */
  load: () => Promise<DistinctValue[]>;
  /** Values already in the filter, ticked when they appear in the list. */
  selected: string[];
  /** Called with the ticked values, in list order. Never called on cancel. */
  onApply: (values: string[]) => void;
}

/**
 * Button + popover that lists a column's distinct values with their counts so
 * the user can tick one or several instead of typing them (issue #869).
 * Rendered in a portal: the filter rows scroll, which would clip it.
 */
export const FilterValuePicker = ({
  load,
  selected,
  onApply,
}: FilterValuePickerProps) => {
  const { t } = useTranslation();
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Bumped on every open/close so a slow load can't fill a closed or reopened picker.
  const requestId = useRef(0);
  const dialogId = useId();
  const titleId = useId();

  const close = useCallback((restoreFocus = false) => {
    requestId.current++;
    setPosition(undefined);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  const startLoad = useCallback(() => {
    const id = ++requestId.current;
    setState({ status: "loading" });
    load().then(
      (values) => {
        if (id !== requestId.current) return;
        const available = new Set(values.map((v) => v.value));
        setTicked(new Set(selected.filter((v) => available.has(v))));
        setState({ status: "ready", values });
      },
      (err: unknown) => {
        if (id !== requestId.current) return;
        setState({ status: "error", message: toErrorMessage(err) });
      },
    );
  }, [load, selected]);

  const open = () => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    setSearch("");
    setTicked(new Set());
    setPosition(
      calculateContextMenuPosition({
        clickX: rect.right - width,
        clickY: rect.bottom + 4,
        menuWidth: width,
        menuHeight: POPOVER_HEIGHT,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        margin: 8,
      }),
    );
    startLoad();
  };

  useEffect(() => {
    if (!position) return;
    searchRef.current?.focus();
    const outside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !popover.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      ) {
        close();
      }
    };
    const dismiss = () => close();
    const scroll = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !popover.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [position, close]);

  const values = useMemo(
    () => (state.status === "ready" ? state.values : []),
    [state],
  );
  const visible = useMemo(
    () => filterDistinctValues(values, search),
    [values, search],
  );

  const apply = () => {
    if (ticked.size === 0) return;
    onApply(values.filter((v) => ticked.has(v.value)).map((v) => v.value));
    close(true);
  };

  const toggle = (value: string) => {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      // React events bubble through portals: keep the filter panel open.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Enter" && event.target === searchRef.current) {
      event.preventDefault();
      apply();
    }
  };

  const label = t("toolbar.valuePicker.open");

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={!!position}
        aria-controls={position ? dialogId : undefined}
        onClick={() => (position ? close() : open())}
        className={clsx(
          "shrink-0 w-6 h-6 flex items-center justify-center rounded border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          position
            ? "border-accent-primary/50 bg-accent-primary/15 text-accent"
            : "border-default text-muted hover:text-accent hover:border-accent-primary/50",
        )}
      >
        <ListChecks size={12} />
      </button>
      {position &&
        createPortal(
          <div
            ref={popover}
            id={dialogId}
            role="dialog"
            aria-labelledby={titleId}
            style={position}
            className="fixed z-[200] flex flex-col w-72 max-w-[calc(100vw-16px)] max-h-[360px] rounded-lg border border-strong bg-elevated shadow-xl"
          >
            {/* Layout wrapper: catches Escape / Enter bubbling from the controls inside. */}
            <div
              role="presentation"
              onKeyDown={handleKeyDown}
              className="flex flex-col flex-1 min-h-0"
            >
              <div className="px-3 pt-2.5 pb-2 border-b border-default/60 space-y-2">
                <div
                  id={titleId}
                  className="text-xs font-medium text-secondary"
                >
                  {t("toolbar.valuePicker.title")}
                </div>
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("toolbar.valuePicker.search")}
                  placeholder={t("toolbar.valuePicker.search")}
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full bg-base border border-default rounded px-2 py-1 text-xs text-secondary font-mono focus:outline-none focus:border-focus/60 transition-colors"
                />
              </div>

              <div className="flex-1 min-h-[96px] overflow-y-auto py-1">
                {state.status === "loading" && (
                  <div
                    role="status"
                    className="flex items-center gap-2 px-3 py-3 text-xs text-muted"
                  >
                    <Loader2 size={12} className="animate-spin" />
                    {t("toolbar.valuePicker.loading")}
                  </div>
                )}
                {state.status === "error" && (
                  <div className="px-3 py-3 space-y-2">
                    <p
                      role="alert"
                      className="text-xs text-accent-error break-words"
                    >
                      {t("toolbar.valuePicker.error")}: {state.message}
                    </p>
                    <button
                      type="button"
                      onClick={startLoad}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted border border-default/70 hover:text-secondary hover:border-default transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <RefreshCw size={11} />
                      {t("toolbar.valuePicker.retry")}
                    </button>
                  </div>
                )}
                {state.status === "ready" && values.length === 0 && (
                  <p className="px-3 py-3 text-xs text-muted">
                    {t("toolbar.valuePicker.empty")}
                  </p>
                )}
                {state.status === "ready" &&
                  values.length > 0 &&
                  visible.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted">
                      {t("toolbar.valuePicker.noMatch")}
                    </p>
                  )}
                {visible.length > 0 && (
                  <ul>
                    {visible.map((v) => (
                      <li key={v.value}>
                        <label className="flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-surface-secondary/60">
                          <input
                            type="checkbox"
                            checked={ticked.has(v.value)}
                            onChange={() => toggle(v.value)}
                            className="shrink-0 accent-accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                          />
                          <span
                            className="flex-1 min-w-0 truncate font-mono text-secondary"
                            title={v.value}
                          >
                            {v.value === "" ? (
                              <span className="italic text-muted">''</span>
                            ) : (
                              v.value
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted">
                            {v.count.toLocaleString()}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center gap-2 px-3 py-2 border-t border-default/60 bg-base/40 rounded-b-lg">
                <span className="flex-1 min-w-0 text-[10px] text-muted truncate">
                  {values.length >= VALUE_PICKER_LIMIT &&
                    t("toolbar.valuePicker.limited", {
                      count: VALUE_PICKER_LIMIT,
                    })}
                </span>
                <button
                  type="button"
                  onClick={() => close(true)}
                  className="px-2.5 py-1 rounded text-xs text-muted border border-default/70 hover:text-secondary hover:border-default transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={ticked.size === 0}
                  className="px-2.5 py-1 rounded text-xs font-medium border transition-colors bg-accent-primary/20 border-accent-primary/50 text-accent hover:bg-accent-primary/30 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {ticked.size > 0
                    ? t("toolbar.valuePicker.use", { count: ticked.size })
                    : t("toolbar.valuePicker.useNone")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
