import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Ban } from "lucide-react";
import clsx from "clsx";
import {
  parseSetMembers,
  serializeSetMembers,
} from "../../utils/columnTypes";
import {
  DROPDOWN_MAX_HEIGHT,
  computeDropdownPosition,
  dropdownPositionStyle,
} from "../../utils/dropdownPosition";

export interface EnumSetInputProps {
  /**
   * Current value. For ENUM (`multiple` false) this is the single member or "".
   * For SET (`multiple` true) it is the MySQL storage form (members comma-joined,
   * e.g. "news,tech"). `null`/`undefined` means the column is NULL.
   */
  value: string | null | undefined;
  /** The allowed members, in declaration order. */
  options: string[];
  /** When true the control behaves as a SET (checkboxes, many members). */
  multiple?: boolean;
  isNullable?: boolean;
  /**
   * Emits the new value: for ENUM the picked member (or null); for SET the
   * comma-joined member string (or null when NULL is chosen).
   */
  onChange: (value: string | null) => void;
  /**
   * Layout:
   * - "grid": inline cell editor — auto-opens and commits on close.
   * - "inline": a form control (used in the row-detail sidebar).
   */
  variant?: "grid" | "inline";
  /** Open the dropdown as soon as the component mounts (grid inline-editing). */
  autoOpen?: boolean;
  /** Called after the dropdown closes without cancelling — the grid uses it to commit. */
  onClose?: () => void;
  /**
   * Commit a single picked value in the same event (ENUM only). The grid uses
   * this to avoid the stale-value lag of a change-then-close commit path.
   */
  onCommitValue?: (value: string | null) => void;
  /** Called when the user cancels (Escape) — the grid uses it to abort editing. */
  onCancel?: () => void;
  /** Lets the grid track the root element for focus management. */
  rootRef?: React.MutableRefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Dropdown editor for MySQL ENUM and SET columns, styled to match the shared
 * {@link Select} component. ENUM is a single-choice list; SET is multi-choice
 * (checkboxes) since a SET may hold zero or more of its allowed members at once,
 * serialized back to the comma-joined form MySQL expects in declared order.
 */
export const EnumSetInput = ({
  value,
  options,
  multiple = false,
  isNullable = false,
  onChange,
  variant = "inline",
  autoOpen = false,
  onClose,
  onCommitValue,
  onCancel,
  rootRef,
  className = "",
}: EnumSetInputProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(autoOpen);
  const [pos, setPos] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: DROPDOWN_MAX_HEIGHT,
    openUp: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  const isNull = value === null || value === undefined;
  const selected = useMemo(() => {
    if (isNull) return new Set<string>();
    if (multiple) return new Set(parseSetMembers(String(value)));
    return new Set(value === "" ? [] : [String(value)]);
  }, [value, isNull, multiple]);

  const setRootEl = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      if (rootRef) rootRef.current = el;
    },
    [rootRef],
  );

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPos(computeDropdownPosition(rect));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (!cancelledRef.current) onClose?.();
  }, [onClose]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setOpen(false);
    onCancel?.();
  }, [onCancel]);

  // Keep the portal dropdown anchored to the trigger.
  useEffect(() => {
    if (!open) return;
    updatePosition();
    const reposition = () => updatePosition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, updatePosition]);

  // A checkbox/portal popover can't rely on onBlur, so close on outside click.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open, close]);

  const pickSingle = useCallback(
    (member: string | null) => {
      // Prefer a synchronous single-event commit when the host provides one
      // (the grid): change-then-close would commit the stale previous value.
      if (onCommitValue) {
        setOpen(false);
        onCommitValue(member);
      } else {
        onChange(member);
        close();
      }
    },
    [onChange, onCommitValue, close],
  );

  const toggleMember = useCallback(
    (member: string) => {
      const next = new Set(selected);
      if (next.has(member)) next.delete(member);
      else next.add(member);
      onChange(serializeSetMembers(next, options));
    },
    [selected, options, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      } else if (e.key === "Enter" && variant === "grid") {
        // Let Enter activate a focused option button (its own click commits the
        // pick); only the root editor's Enter should close and commit.
        if (e.target !== containerRef.current) return;
        e.preventDefault();
        close();
      }
    },
    [cancel, close, variant],
  );

  const summary = isNull ? (
    <span className="text-muted italic">NULL</span>
  ) : selected.size === 0 ? (
    <span className="text-muted italic">
      {multiple ? t("dataGrid.emptySet") : ""}
    </span>
  ) : multiple ? (
    <span className="flex flex-wrap gap-1">
      {options
        .filter((v) => selected.has(v))
        .map((v) => (
          <span
            key={v}
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-600/15 text-blue-400 text-xs leading-tight"
          >
            {v}
          </span>
        ))}
    </span>
  ) : (
    <span className="truncate">{String(value)}</span>
  );

  // The panel hugs its content, so the trigger width is a minimum, not fixed.
  const { width: dropdownWidth, ...dropdownStyle } = dropdownPositionStyle(pos);

  const dropdown = open && (
    <div
      ref={dropdownRef}
      className="fixed z-[200] bg-elevated border border-strong rounded-lg shadow-xl overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-surface-tertiary scrollbar-track-transparent animate-in fade-in zoom-in-95 duration-100"
      style={{ ...dropdownStyle, minWidth: dropdownWidth }}
    >
      {isNullable && (
        <button
          type="button"
          onClick={() => (multiple ? onChange(null) : pickSingle(null))}
          className={clsx(
            "w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded transition-colors",
            isNull
              ? "bg-blue-600/10 text-blue-400 font-medium"
              : "text-muted hover:bg-surface-secondary",
          )}
        >
          <Ban size={14} className="shrink-0" />
          <span className="italic">NULL</span>
        </button>
      )}
      {options.map((member) => {
        const checked = !isNull && selected.has(member);
        return (
          <button
            key={member}
            type="button"
            onClick={() =>
              multiple ? toggleMember(member) : pickSingle(member)
            }
            className={clsx(
              "w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded transition-colors font-mono",
              checked && !multiple
                ? "bg-blue-600/10 text-blue-400 font-medium"
                : "text-primary hover:bg-surface-secondary",
            )}
            title={member}
          >
            {multiple && (
              <span
                className={clsx(
                  "shrink-0 w-4 h-4 rounded border flex items-center justify-center",
                  checked
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-strong",
                )}
              >
                {checked && <Check size={12} strokeWidth={3} />}
              </span>
            )}
            <span className="truncate">{member}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      ref={setRootEl}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={clsx(
        "outline-none",
        variant === "grid" ? "absolute inset-0" : "relative w-full",
        className,
      )}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) close();
          else {
            cancelledRef.current = false;
            updatePosition();
            setOpen(true);
          }
        }}
        className={clsx(
          "w-full flex items-center justify-between gap-2 text-left font-mono text-sm cursor-pointer transition-colors bg-base text-primary",
          variant === "grid"
            ? "h-full px-2 border-2"
            : "px-3 py-2 border rounded",
          open
            ? "border-blue-500"
            : "border-strong hover:border-blue-500",
          variant === "grid" ? "" : open ? "ring-1 ring-blue-500" : "",
        )}
      >
        <span className="flex-1 min-w-0 overflow-hidden">{summary}</span>
        <ChevronDown
          size={16}
          className={clsx(
            "shrink-0 text-secondary transition-transform",
            open ? "rotate-180" : "",
          )}
        />
      </button>
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
};
