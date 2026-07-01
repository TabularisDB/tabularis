import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, X } from "lucide-react";
import clsx from "clsx";

interface SelectProps {
  value: string | null;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  disabled?: boolean;
  className?: string;
  hasError?: boolean;
  searchable?: boolean;
  labels?: Record<string, string>;
  /** Overrides the trigger's size/spacing classes (default: `px-3 py-2 text-sm`).
   * Used to render a compact trigger, e.g. in the sidebar. */
  triggerClassName?: string;
  /** Optional icon rendered before the selected value inside the trigger. */
  leadingIcon?: ReactNode;
}

export const Select = ({
  value,
  options,
  onChange,
  placeholder = "Select option",
  searchPlaceholder = "Search...",
  noResultsLabel = "No results found",
  disabled = false,
  className,
  hasError = false,
  searchable = true,
  labels,
  triggerClassName,
  leadingIcon,
}: SelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getLabel = (val: string) => labels?.[val] ?? val;

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleScroll = () => updatePosition();
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);
      return () => {
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleScroll);
      };
    }
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (isOpen && searchable && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, searchable]);

  const filteredOptions = searchable
    ? options.filter((option) => getLabel(option).toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  const handleSelect = (option: string) => {
    onChange(option);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleToggle = () => {
    if (!disabled) {
      if (!isOpen) updatePosition();
      setIsOpen(!isOpen);
    }
  };

  const dropdown = isOpen && !disabled && (
    <div
      ref={dropdownRef}
      className="fixed z-[200] bg-elevated border border-strong rounded-lg shadow-xl max-h-60 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100"
      style={{ top: dropdownPosition.top, left: dropdownPosition.left, width: dropdownPosition.width }}
    >
      {searchable && (
        <div className="p-2 border-b border-default bg-elevated">
          <div className="flex items-center gap-2 bg-base border border-strong rounded px-2 py-1.5 focus-within:border-blue-500 transition-colors">
            <Search size={14} className="text-muted shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border-none text-sm text-primary focus:outline-none placeholder:text-muted"
              onKeyDown={(e) => {
                if (e.key === "Enter" && filteredOptions.length > 0) handleSelect(filteredOptions[0]);
                if (e.key === "Escape") setIsOpen(false);
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-muted hover:text-primary">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-y-auto flex-1 p-1 scrollbar-thin scrollbar-thumb-surface-tertiary scrollbar-track-transparent">
        {filteredOptions.length === 0 ? (
          <div className="p-3 text-sm text-muted text-center italic">{noResultsLabel}</div>
        ) : (
          filteredOptions.map((option) => (
            <button
              key={option}
              onClick={() => handleSelect(option)}
              className={clsx(
                "w-full text-left px-3 py-2 text-sm rounded transition-colors truncate",
                value === option
                  ? "bg-blue-600/10 text-blue-400 font-medium"
                  : "text-primary hover:bg-surface-secondary"
              )}
              title={getLabel(option)}
            >
              {getLabel(option)}
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className={clsx("relative", className)} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={clsx(
          "w-full bg-base border rounded text-primary flex items-center justify-between transition-colors",
          triggerClassName ?? "px-3 py-2 text-sm",
          disabled
            ? "opacity-50 cursor-not-allowed border-default"
            : hasError
              ? "border-red-500 hover:border-red-400"
              : "border-strong hover:border-blue-500 cursor-pointer",
          isOpen && !disabled && !hasError ? "border-blue-500 ring-1 ring-blue-500" : ""
        )}
      >
        <span className={clsx("flex items-center gap-1.5 min-w-0", !value && "text-muted", hasError && "text-red-400")}>
          {leadingIcon}
          <span className="truncate">{value ? getLabel(value) : placeholder}</span>
        </span>
        <ChevronDown
          size={14}
          className={clsx("shrink-0 ml-2", hasError ? "text-red-400" : "text-secondary")}
        />
      </button>

      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
};
