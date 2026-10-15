import type { TableColumn, PendingInsertion } from "../types/editor";

/**
 * Generates a unique temporary ID for a pending insertion
 */
export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Initializes the data of a new row with default values
 */
export function initializeNewRow(
  columns: TableColumn[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  columns.forEach((col) => {
    if (col.is_generated) {
      data[col.name] = null;
      return;
    }

    if (col.is_auto_increment) {
      data[col.name] = null; // Auto-increment handled by the DB
    } else if (col.is_nullable) {
      data[col.name] = null; // NULL by default
    } else {
      data[col.name] = ""; // Empty string for required fields
    }
  });

  return data;
}

/**
 * Validates a pending insertion by checking mandatory fields
 * @returns Column → error message map (empty if validation passes)
 */
export function validatePendingInsertion(
  insertion: PendingInsertion,
  columns: TableColumn[],
): Record<string, string> {
  const errors: Record<string, string> = {};

  columns.forEach((col) => {
    // Skip values managed by the database.
    if (col.is_auto_increment || col.is_generated) {
      return;
    }

    if (col.default_value) {
      return;
    }

    // Check required fields
    if (!col.is_nullable) {
      const value = insertion.data[col.name];
      if (value === null || value === undefined || value === "") {
        errors[col.name] = "Required field";
      }
    }
  });

  return errors;
}

/**
 * Converts a pending insertion into format for backend insert_record
 */
export function insertionToBackendData(
  insertion: PendingInsertion,
  columns: TableColumn[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  columns.forEach((col) => {
    const value = insertion.data[col.name];

    if (col.is_generated) {
      return;
    }

    // Skip auto-increment columns if no value provided (let DB generate it)
    if (
      col.is_auto_increment &&
      (value === null || value === undefined || value === "")
    ) {
      return;
    }

    // Skip columns with default value if no value provided (let DB use default)
    if (
      col.default_value &&
      (value === null || value === undefined || value === "")
    ) {
      return;
    }

    data[col.name] = value;
  });

  return data;
}

/**
 * Filters pending insertions by row selection
 */
export function filterInsertionsBySelection(
  pendingInsertions: Record<string, PendingInsertion>,
  selectedDisplayIndices: Set<number>,
): PendingInsertion[] {
  return Object.values(pendingInsertions).filter((insertion) =>
    selectedDisplayIndices.has(insertion.displayIndex),
  );
}
