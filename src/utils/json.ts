/**
 * Utility functions for handling JSON data types in MySQL, PostgreSQL, and SQLite.
 */

const JSON_TYPES = ["JSON", "JSONB"];

/**
 * Returns true if the column data type is a JSON/JSONB type.
 */
export function isJsonColumn(dataType: string): boolean {
  if (!dataType) return false;
  return JSON_TYPES.includes(dataType.toUpperCase());
}

/**
 * Serializes a value for display in a JSON editor.
 * Objects/arrays are pretty-printed; primitives and strings are returned as-is.
 */
export function formatJsonForEditor(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  return String(value);
}

/**
 * Validates a JSON string. Returns null if valid, or an error message if invalid.
 */
export function validateJson(text: string): string | null {
  if (text.trim() === "") return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return e instanceof SyntaxError ? e.message : "Invalid JSON";
  }
}

/**
 * Parses a JSON editor value back to a structured value for submission.
 * Returns the parsed object/array/primitive, or the raw string if parsing fails.
 */
export function parseJsonEditorValue(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
