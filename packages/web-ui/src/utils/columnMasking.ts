/**
 * Sensitive-column masking for the results grid (#485).
 *
 * Display-only protection against shoulder-surfing and screen shares: values
 * of matched columns render as a placeholder until explicitly revealed. Copy
 * and export paths are deliberately untouched — anonymization of data leaving
 * the app is a separate concern (#483).
 */

/** Rendered in place of a masked cell's real value. */
export const MASKED_PLACEHOLDER = "••••••";

/** Default column-name patterns, matched case-insensitively as substrings. */
export const DEFAULT_MASKING_PATTERNS = [
  "password",
  "passwd",
  "email",
  "phone",
  "ssn",
  "token",
  "secret",
  "api_key",
  "iban",
  "credit_card",
];

export interface ColumnMaskingOverride {
  /** `table.column` entries that are always masked for this connection. */
  include?: string[];
  /** `table.column` entries that are never masked (pattern false positives). */
  exclude?: string[];
}

export interface ColumnMaskingConfig {
  enabled: boolean;
  patterns: string[];
  /** Per-connection overrides, keyed by connection id. */
  overrides?: Record<string, ColumnMaskingOverride>;
}

/** Lowercased, trimmed, non-empty patterns. */
export function normalizeMaskingPatterns(patterns: string[]): string[] {
  return patterns
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

/** Case-insensitive substring match of the column name against the patterns. */
export function isSensitiveColumnName(
  colName: string,
  patterns: string[],
): boolean {
  const name = colName.toLowerCase();
  return normalizeMaskingPatterns(patterns).some((p) => name.includes(p));
}

/**
 * Whether a grid column should render masked.
 *
 * Precedence: a per-connection `exclude` entry always wins (false-positive
 * escape hatch), then a per-connection `include` entry, then the generic
 * name patterns. Overrides match the exact `table.column` pair, so they
 * apply to table browsing (where the table is known); ad-hoc query results
 * without a table fall back to the name patterns alone.
 */
export function isColumnMasked(
  colName: string,
  tableName: string | null | undefined,
  connectionId: string | null | undefined,
  config: ColumnMaskingConfig,
): boolean {
  if (!config.enabled) return false;

  const override = connectionId
    ? config.overrides?.[connectionId]
    : undefined;
  if (override && tableName) {
    const key = `${tableName}.${colName}`.toLowerCase();
    if (override.exclude?.some((e) => e.trim().toLowerCase() === key)) {
      return false;
    }
    if (override.include?.some((e) => e.trim().toLowerCase() === key)) {
      return true;
    }
  }

  return isSensitiveColumnName(colName, config.patterns);
}
