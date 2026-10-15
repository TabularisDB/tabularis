/**
 * Utility functions for date/datetime input parsing and formatting
 */

// SQL date/datetime type names that should use the DateInput component
const DATE_TYPES = new Set([
  "date",
  "datetime",
  "timestamp",
  "timestamptz",
  "timestamp with time zone",
  "timestamp without time zone",
  "timestamp with local time zone",
]);

const TIME_TYPES = new Set(["time", "timetz", "time with time zone"]);

export type DateInputMode = "date" | "datetime" | "time";

/**
 * Returns the DateInput mode for a given SQL data type, or null if not a date/time type.
 */
export function getDateInputMode(dataType: string): DateInputMode | null {
  const lower = dataType.toLowerCase().trim();
  if (DATE_TYPES.has(lower)) {
    // datetime / timestamp include time component
    if (lower !== "date") return "datetime";
    return "date";
  }
  if (TIME_TYPES.has(lower)) return "time";
  return null;
}

export interface ParsedDateTime {
  day: number;
  month: number; // 1-based
  year: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function getMonthNames(): string[] {
  return MONTH_NAMES;
}

/**
 * Parses a date/datetime string (ISO 8601 or common SQL formats) into components.
 * Returns a default (today's date, midnight) if parsing fails.
 */
export function parseDateTime(value: string): ParsedDateTime {
  const now = new Date();
  const fallback: ParsedDateTime = {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    hours: 0,
    minutes: 0,
    seconds: 0,
  };

  if (!value || value.trim() === "") return fallback;

  // Match: YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS (with optional timezone/ms)
  const fullMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/,
  );
  if (fullMatch) {
    return {
      year: parseInt(fullMatch[1], 10),
      month: parseInt(fullMatch[2], 10),
      day: parseInt(fullMatch[3], 10),
      hours: parseInt(fullMatch[4], 10),
      minutes: parseInt(fullMatch[5], 10),
      seconds: parseInt(fullMatch[6], 10),
    };
  }

  // Match: YYYY-MM-DD HH:MM (no seconds)
  const noSecsMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/,
  );
  if (noSecsMatch) {
    return {
      year: parseInt(noSecsMatch[1], 10),
      month: parseInt(noSecsMatch[2], 10),
      day: parseInt(noSecsMatch[3], 10),
      hours: parseInt(noSecsMatch[4], 10),
      minutes: parseInt(noSecsMatch[5], 10),
      seconds: 0,
    };
  }

  // Match: YYYY-MM-DD only
  const dateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    return {
      year: parseInt(dateMatch[1], 10),
      month: parseInt(dateMatch[2], 10),
      day: parseInt(dateMatch[3], 10),
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  // Match: HH:MM:SS (time only)
  const timeMatch = value.match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (timeMatch) {
    return {
      ...fallback,
      hours: parseInt(timeMatch[1], 10),
      minutes: parseInt(timeMatch[2], 10),
      seconds: parseInt(timeMatch[3], 10),
    };
  }

  return fallback;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Formats parsed components back to a SQL-compatible string.
 */
export function formatDateTime(
  dt: ParsedDateTime,
  mode: DateInputMode,
): string {
  const datePart = `${dt.year}-${pad2(dt.month)}-${pad2(dt.day)}`;
  const timePart = `${pad2(dt.hours)}:${pad2(dt.minutes)}:${pad2(dt.seconds)}`;
  if (mode === "date") return datePart;
  if (mode === "time") return timePart;
  return `${datePart} ${timePart}`;
}

/**
 * Returns the number of days in a given month/year.
 */
export function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Clamps a numeric value between min and max (inclusive).
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
