import React, { useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  clamp,
  daysInMonth,
  formatDateTime,
  getMonthNames,
  parseDateTime,
  type DateInputMode,
  type ParsedDateTime,
} from "../../utils/dateInput";

interface SpinnerProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  width?: string;
}

/** Numeric spinner with up/down arrows */
const Spinner = ({
  value,
  min,
  max,
  onChange,
  width = "w-12",
}: SpinnerProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const increment = useCallback(() => {
    onChange(value >= max ? min : value + 1);
  }, [value, min, max, onChange]);

  const decrement = useCallback(() => {
    onChange(value <= min ? max : value - 1);
  }, [value, min, max, onChange]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) increment();
      else decrement();
    },
    [increment, decrement],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        increment();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        decrement();
      }
    },
    [increment, decrement],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const num = parseInt(e.target.value, 10);
      if (!isNaN(num)) onChange(clamp(num, min, max));
    },
    [min, max, onChange],
  );

  return (
    <div
      className={`flex items-center border border-strong rounded bg-base ${width}`}
    >
      <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
        ref={inputRef}
        type="number"
        min={min}
        max={max}
        value={String(value).padStart(2, "0")}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        className="flex-1 min-w-0 bg-transparent text-primary text-center text-sm font-mono outline-none px-1 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <div className="flex flex-col border-l border-strong">
        <button
          type="button"
          tabIndex={-1}
          onClick={increment}
          className="px-0.5 py-0 text-muted hover:text-primary hover:bg-surface-secondary transition-colors leading-none"
          style={{ lineHeight: 1 }}
        >
          <ChevronUp size={10} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={decrement}
          className="px-0.5 py-0 text-muted hover:text-primary hover:bg-surface-secondary transition-colors leading-none border-t border-strong"
          style={{ lineHeight: 1 }}
        >
          <ChevronDown size={10} />
        </button>
      </div>
    </div>
  );
};

interface SelectDropdownProps {
  value: number; // 1-based for day/month, actual for year
  options: { label: string; value: number }[];
  onChange: (v: number) => void;
  width?: string;
}

/** Simple native select styled to match the design */
const SelectDropdown = ({
  value,
  options,
  onChange,
  width = "w-28",
}: SelectDropdownProps) => {
  return (
    <div className={`relative ${width}`}>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full appearance-none bg-base border border-strong rounded text-primary text-sm font-mono px-2 py-0.5 pr-6 outline-none focus:border-blue-500 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
      />
    </div>
  );
};

export interface DateInputProps {
  value: string;
  mode: DateInputMode;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
}

/**
 * Date/datetime editor with day/month dropdowns and numeric spinners for year, hours, minutes, seconds.
 * Matches the visual design: day and month dropdowns on top row, time spinners on bottom row.
 */
export const DateInput = ({
  value,
  mode,
  onChange,
  onBlur,
  onKeyDown,
  inputRef,
  className = "",
}: DateInputProps) => {
  const dt = parseDateTime(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Propagate changes upward
  const update = useCallback(
    (partial: Partial<ParsedDateTime>) => {
      const current = parseDateTime(value);
      const next = { ...current, ...partial };
      // Clamp day to valid range after month/year change
      const maxDay = daysInMonth(next.month, next.year);
      if (next.day > maxDay) next.day = maxDay;
      onChange(formatDateTime(next, mode));
    },
    [value, mode, onChange],
  );

  // Expose a focusable element via inputRef (first focusable child)
  useEffect(() => {
    if (inputRef && containerRef.current) {
      const firstInput = containerRef.current.querySelector<HTMLInputElement>(
        "input, select",
      );
      if (firstInput && inputRef) {
        // We can't assign to inputRef.current directly (read-only), but we can
        // trigger focus so the parent's autoFocus logic works.
        firstInput.focus();
      }
    }
  }, [inputRef]);

  const monthNames = getMonthNames();

  const dayOptions = Array.from(
    { length: daysInMonth(dt.month, dt.year) },
    (_, i) => ({ label: String(i + 1).padStart(2, "0"), value: i + 1 }),
  );

  const monthOptions = monthNames.map((name, i) => ({
    label: name,
    value: i + 1,
  }));

  const showDate = mode === "date" || mode === "datetime";
  const showTime = mode === "time" || mode === "datetime";

  return (
    <div
      ref={containerRef}
      className={`inline-flex flex-col gap-1.5 p-2 bg-base border border-strong rounded-lg shadow-lg ${className}`}
      onBlur={(e) => {
        // Only fire onBlur when focus leaves the entire component
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          onBlur?.();
        }
      }}
      onKeyDown={onKeyDown}
    >
      {showDate && (
        <div className="flex items-center gap-1.5">
          {/* Day dropdown */}
          <SelectDropdown
            value={dt.day}
            options={dayOptions}
            onChange={(v) => update({ day: v })}
            width="w-14"
          />

          {/* Month dropdown */}
          <SelectDropdown
            value={dt.month}
            options={monthOptions}
            onChange={(v) => update({ month: v })}
            width="w-28"
          />

          {/* Year spinner */}
          <Spinner
            value={dt.year}
            min={1}
            max={9999}
            onChange={(v) => update({ year: v })}
            width="w-16"
          />
        </div>
      )}

      {showTime && (
        <div className="flex items-center gap-1">
          {/* Hours */}
          <Spinner
            value={dt.hours}
            min={0}
            max={23}
            onChange={(v) => update({ hours: v })}
          />
          <span className="text-muted text-sm font-mono">:</span>
          {/* Minutes */}
          <Spinner
            value={dt.minutes}
            min={0}
            max={59}
            onChange={(v) => update({ minutes: v })}
          />
          <span className="text-muted text-sm font-mono">:</span>
          {/* Seconds */}
          <Spinner
            value={dt.seconds}
            min={0}
            max={59}
            onChange={(v) => update({ seconds: v })}
          />
        </div>
      )}
    </div>
  );
};
