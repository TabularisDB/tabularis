import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import {
  computeDropdownPosition,
  dropdownPositionStyle,
  VIEWPORT_MARGIN,
  type DropdownPosition,
} from "../../utils/dropdownPosition";

const PAGE_SIZE_PRESETS = [50, 100, 200, 500, 1000, 5000];
const MENU_WIDTH = 200;

interface PageSizeSelectorProps {
  /** Current page size; 0 means pagination is off (all rows fetched). */
  value: number;
  /** Page size from the global settings, marked as default in the menu. */
  defaultSize: number;
  disabled?: boolean;
  onChange: (size: number) => void;
}

/**
 * Compact rows-per-page picker for a result grid's pagination bar. Offers
 * preset sizes, a custom value, and "All" (pagination off); selecting a value
 * overrides the global Result Page Size for the current tab only.
 */
export function PageSizeSelector({
  value,
  defaultSize,
  disabled = false,
  onChange,
}: PageSizeSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Right-align the menu to the trigger: the bar sits at the pane's right
      // edge, so a left-anchored panel would overflow the viewport.
      setPosition(
        computeDropdownPosition({
          top: rect.top,
          bottom: rect.bottom,
          left: Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
          width: MENU_WIDTH,
        }),
      );
    }
    setIsOpen(!isOpen);
  };

  const handleSelect = (size: number) => {
    setIsOpen(false);
    setCustomValue("");
    if (size !== value) onChange(size);
  };

  const handleCustomCommit = () => {
    const parsed = parseInt(customValue, 10);
    if (!isNaN(parsed) && parsed > 0) handleSelect(parsed);
  };

  const presets = PAGE_SIZE_PRESETS.includes(defaultSize)
    ? PAGE_SIZE_PRESETS
    : [...PAGE_SIZE_PRESETS, defaultSize].sort((a, b) => a - b);

  const optionClass = (isActive: boolean) =>
    clsx(
      "w-full text-left px-3 py-1.5 text-xs rounded transition-colors flex items-center justify-between gap-2",
      isActive
        ? "bg-blue-600/10 text-blue-400 font-medium"
        : "text-primary hover:bg-surface-secondary",
    );

  const menu = isOpen && !disabled && position && (
    <div
      ref={menuRef}
      className="fixed z-[200] bg-elevated border border-strong rounded-lg shadow-xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      style={dropdownPositionStyle(position)}
    >
      <div className="overflow-y-auto flex-1 p-1 scrollbar-thin scrollbar-thumb-surface-tertiary scrollbar-track-transparent">
        {presets.map((size) => (
          <button
            key={size}
            onClick={() => handleSelect(size)}
            className={optionClass(value === size)}
          >
            <span>{size.toLocaleString()}</span>
            {size === defaultSize && (
              <span className="text-muted text-[10px]">
                {t("pagination.defaultPageSize")}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => handleSelect(0)}
          className={optionClass(value === 0)}
          title={t("pagination.allRowsHint")}
        >
          <span>{t("pagination.allRows")}</span>
          <span className="text-accent-warning text-[10px] truncate">
            {t("pagination.allRowsHint")}
          </span>
        </button>
      </div>
      <div className="p-1 border-t border-default">
        <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
          type="text"
          inputMode="numeric"
          placeholder={t("pagination.customPageSize")}
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCustomCommit();
            if (e.key === "Escape") setIsOpen(false);
            e.stopPropagation();
          }}
          className="w-full bg-base border border-strong rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-blue-500 placeholder:text-muted"
        />
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        disabled={disabled}
        onClick={handleToggle}
        className="flex items-center gap-0.5 px-1.5 py-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs font-medium whitespace-nowrap"
        title={t("pagination.pageSize")}
        aria-label={t("pagination.pageSize")}
      >
        {value === 0 ? t("pagination.allRows") : value.toLocaleString()}
        <ChevronDown size={12} />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
