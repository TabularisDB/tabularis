const TEXT_TYPES = [
  "TEXT",
  "TINYTEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "NTEXT",
  "CLOB",
  "CHARACTER VARYING",
  "VARCHAR",
  "NVARCHAR",
  "CHARACTER",
  "CHAR",
  "NCHAR",
  "STRING",
];

export const LONG_TEXT_THRESHOLD = 80;

/**
 * Maximum number of characters rendered inline in a data-grid cell preview.
 *
 * Grid cells are CSS-truncated to ~300px, so anything past a few hundred
 * characters is never visible. Tokenizing/rendering megabyte-sized values
 * (e.g. large MySQL `JSON` columns) into the cell freezes the UI, even though
 * none of it can be read inline. Capping the preview keeps rendering cheap; the
 * full value stays reachable via the inline expander and the JSON viewer.
 */
export const CELL_PREVIEW_LIMIT = 300;

export interface CellPreview {
  /** The (possibly shortened) string safe to render inline. */
  text: string;
  /** Whether the source string was longer than the limit. */
  truncated: boolean;
}

/**
 * Shortens a display string to a cheap inline preview. Returns the original
 * string untouched (with `truncated: false`) when it is already within the
 * limit, so short cells incur no allocation.
 */
export function truncateCellPreview(
  text: string,
  limit: number = CELL_PREVIEW_LIMIT,
): CellPreview {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

// Substring match so parameterised forms like "VARCHAR(255)" or
// "CHARACTER VARYING(50)" still resolve as text.
export function isTextColumn(dataType: string | undefined): boolean {
  if (!dataType) return false;
  const normalized = dataType.toUpperCase();
  return TEXT_TYPES.some((type) => normalized.includes(type));
}

export function isLongTextValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length > LONG_TEXT_THRESHOLD) return true;
  return value.includes("\n");
}

export function isLongTextCellTarget(
  colType: string | undefined,
  value: unknown,
): boolean {
  if (!isTextColumn(colType)) return false;
  return isLongTextValue(value);
}

export function formatTextForEditor(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}
