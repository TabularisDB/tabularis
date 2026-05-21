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
