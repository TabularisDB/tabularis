/**
 * Table Toolbar Utilities
 * Pure functions for managing toolbar state and changes
 */

import { formatSqlIdentifier } from "./identifiers";

export interface TableToolbarState {
  filterInput: string;
  sortInput: string;
  limitInput: string;
}

export interface TableToolbarProps {
  initialFilter?: string;
  initialSort?: string;
  initialLimit?: number | null;
}

/**
 * Checks if toolbar values have changed compared to initial values
 */
export function haveToolbarValuesChanged(
  state: TableToolbarState,
  props: TableToolbarProps
): { filterChanged: boolean; sortChanged: boolean; limitChanged: boolean; hasChanges: boolean } {
  const limitVal = state.limitInput ? parseInt(state.limitInput, 10) : undefined;

  const filterChanged = (state.filterInput || "") !== (props.initialFilter || "");
  const sortChanged = (state.sortInput || "") !== (props.initialSort || "");
  const limitChanged = limitVal !== props.initialLimit;

  return {
    filterChanged,
    sortChanged,
    limitChanged,
    hasChanges: filterChanged || sortChanged || limitChanged,
  };
}

/**
 * Parses limit input string to number or undefined
 */
export function parseLimitInput(limitInput: string): number | undefined {
  if (!limitInput || limitInput.trim() === "") {
    return undefined;
  }
  const parsed = parseInt(limitInput, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Generates a stable key based on initial values for component reset
 */
export function generateToolbarStateKey(props: TableToolbarProps): string {
  return `${props.initialFilter}-${props.initialSort}-${props.initialLimit}`;
}

/**
 * Validates if a limit value is valid (positive integer)
 */
export function isValidLimit(value: string): boolean {
  if (!value || value.trim() === "") {
    return true; // Empty is valid (means no limit)
  }
  // Check if the entire string is a valid positive integer (no extra characters)
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return false;
  }
  const parsed = parseInt(trimmed, 10);
  return parsed > 0;
}

/**
 * Formats limit input for display (removes invalid characters)
 */
export function formatLimitInput(value: string): string {
  // Remove non-numeric characters except leading minus
  const cleaned = value.replace(/[^0-9]/g, "");
  return cleaned;
}

/**
 * Generates placeholder text for WHERE clause
 */
export function generateWherePlaceholder(column: string): string {
  return `${column} > 5 AND status = 'active'`;
}

/**
 * Generates placeholder text for ORDER BY clause
 */
export function generateOrderByPlaceholder(column: string): string {
  return `${column} DESC`;
}

/**
 * Quotes column names in ORDER BY input for PostgreSQL (e.g. `Status DESC` → `"Status" DESC`).
 */
export function formatSortClause(
  clause: string,
  driver?: string | null,
): string {
  if (!clause.trim() || driver !== "postgres") {
    return clause;
  }

  return clause
    .split(",")
    .map((term) => {
      const parts = term.trim().split(/\s+/);

      // Skip empty terms
      if (!parts[0]) return term.trim();

      // Already quoted, no need to format
      if (parts[0].startsWith('"') || parts[0].startsWith("`")) {
        return term.trim();
      }

      // Format the column identifier and preserve the direction (ASC/DESC) if present
      const col = formatSqlIdentifier(parts[0], driver);
      const dir = parts[1]?.toUpperCase();
      return dir ? `${col} ${dir}` : col;
    })
    .join(", ");
}