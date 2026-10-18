import type { Dialect } from "./sqlSplitter";

/**
 * Extra autocomplete keywords and functions per SQL dialect, offered on top
 * of the shared keyword list. Dialects without an entry get the shared list
 * only.
 */
const DIALECT_KEYWORDS: Readonly<Partial<Record<Dialect, readonly string[]>>> = {
  // GoogleSQL (BigQuery): query syntax, scripting, types and common functions.
  bigquery: [
    // Query syntax
    "QUALIFY", "PIVOT", "UNPIVOT", "TABLESAMPLE SYSTEM", "UNNEST", "WITH OFFSET",
    "EXCEPT", "REPLACE", "WINDOW", "OVER", "PARTITION BY", "CLUSTER BY", "OPTIONS",
    "FOR SYSTEM_TIME AS OF", "IGNORE NULLS", "RESPECT NULLS", "UNION ALL",
    "UNION DISTINCT", "INTERSECT DISTINCT", "EXCEPT DISTINCT", "MERGE",
    "WHEN MATCHED", "WHEN NOT MATCHED", "WHEN NOT MATCHED BY SOURCE",
    "CREATE OR REPLACE TABLE", "CREATE TEMP TABLE", "CREATE TEMP FUNCTION",
    "CREATE OR REPLACE PROCEDURE", "CREATE SCHEMA", "RETURNS", "LANGUAGE js",
    "EXPORT DATA", "LOAD DATA", "ASSERT",
    // Scripting
    "DECLARE", "BEGIN", "BEGIN TRANSACTION", "COMMIT TRANSACTION",
    "ROLLBACK TRANSACTION", "EXCEPTION WHEN ERROR THEN", "ELSEIF", "END IF",
    "LOOP", "END LOOP", "WHILE", "END WHILE", "REPEAT", "UNTIL", "END REPEAT",
    "FOR", "DO", "END FOR", "END CASE", "LEAVE", "BREAK", "CONTINUE", "ITERATE",
    "RETURN", "CALL", "EXECUTE IMMEDIATE", "RAISE USING MESSAGE",
    // Types
    "INT64", "FLOAT64", "NUMERIC", "BIGNUMERIC", "BOOL", "STRING", "BYTES",
    "DATE", "DATETIME", "TIME", "TIMESTAMP", "INTERVAL", "GEOGRAPHY", "JSON",
    "STRUCT", "ARRAY", "RANGE",
    // Conversion and conditional functions
    "SAFE_CAST", "SAFE.", "SAFE_DIVIDE", "IF", "IFNULL", "COALESCE", "NULLIF",
    // Aggregate and approximate functions
    "COUNTIF", "ARRAY_AGG", "STRING_AGG", "LOGICAL_AND", "LOGICAL_OR",
    "ANY_VALUE", "APPROX_COUNT_DISTINCT", "APPROX_QUANTILES", "APPROX_TOP_COUNT",
    "APPROX_TOP_SUM",
    // Window functions
    "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD", "FIRST_VALUE",
    "LAST_VALUE", "NTILE", "PERCENTILE_CONT",
    // Arrays and strings
    "ARRAY_LENGTH", "ARRAY_CONCAT", "ARRAY_TO_STRING", "GENERATE_ARRAY",
    "GENERATE_DATE_ARRAY", "SPLIT", "FORMAT", "STARTS_WITH", "ENDS_WITH",
    "CONTAINS_SUBSTR", "REGEXP_CONTAINS", "REGEXP_EXTRACT", "REGEXP_EXTRACT_ALL",
    "REGEXP_REPLACE", "REGEXP_INSTR", "FARM_FINGERPRINT", "GENERATE_UUID",
    // JSON
    "JSON_VALUE", "JSON_QUERY", "JSON_VALUE_ARRAY", "JSON_QUERY_ARRAY",
    "JSON_EXTRACT", "JSON_EXTRACT_SCALAR", "PARSE_JSON", "TO_JSON",
    "TO_JSON_STRING",
    // Date and time
    "CURRENT_DATE", "CURRENT_DATETIME", "CURRENT_TIMESTAMP", "EXTRACT",
    "DATE_TRUNC", "DATE_ADD", "DATE_SUB", "DATE_DIFF", "DATETIME_TRUNC",
    "DATETIME_DIFF", "TIMESTAMP_TRUNC", "TIMESTAMP_ADD", "TIMESTAMP_SUB",
    "TIMESTAMP_DIFF", "FORMAT_DATE", "FORMAT_TIMESTAMP", "PARSE_DATE",
    "PARSE_TIMESTAMP", "UNIX_SECONDS", "UNIX_MILLIS", "TIMESTAMP_SECONDS",
    "TIMESTAMP_MILLIS", "LAST_DAY",
    // Geography
    "ST_GEOGPOINT", "ST_GEOGFROMTEXT", "ST_ASTEXT", "ST_DISTANCE", "ST_DWITHIN",
    "ST_CONTAINS", "ST_INTERSECTS", "ST_AREA", "ST_LENGTH", "ST_BUFFER",
  ],
};

/**
 * Autocomplete keywords for `dialect`: the shared `base` list followed by the
 * dialect's extras, without duplicates. Unknown dialects get `base` as is.
 */
export function getDialectKeywords(
  base: readonly string[],
  dialect: string | null | undefined,
): readonly string[] {
  const extra =
    dialect && Object.hasOwn(DIALECT_KEYWORDS, dialect)
      ? DIALECT_KEYWORDS[dialect as Dialect]
      : undefined;
  if (!extra) return base;
  const seen = new Set(base);
  return [...base, ...extra.filter((kw) => !seen.has(kw))];
}
