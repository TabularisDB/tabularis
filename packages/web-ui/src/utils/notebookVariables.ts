import type { NotebookCell } from "../types/notebook";
import type { QueryResult } from "../types/editor";

const CELL_REF_PATTERN = /\{\{cell_(\d+)\}\}/g;

export interface CellReference {
  match: string;
  cellIndex: number;
}

export function extractCellReferences(sql: string): CellReference[] {
  const refs: CellReference[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(CELL_REF_PATTERN.source, "g");
  while ((match = regex.exec(sql)) !== null) {
    refs.push({ match: match[0], cellIndex: Number(match[1]) - 1 });
  }
  return refs;
}

export function hasCellReferences(sql: string): boolean {
  return new RegExp(CELL_REF_PATTERN.source).test(sql);
}

/** Quote a column name as a SQL identifier, doubling embedded quotes. */
function quoteIdentifier(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

/**
 * Escape a value as a SQL string literal. Backslashes are doubled only for
 * dialects where `\` is an escape character inside strings (MySQL/MariaDB);
 * doubling them unconditionally would corrupt values on standard-conforming
 * databases like PostgreSQL or SQLite.
 */
function escapeStringLiteral(val: string, escapeBackslashes: boolean): string {
  let escaped = val;
  if (escapeBackslashes) escaped = escaped.replace(/\\/g, "\\\\");
  return escaped.replace(/'/g, "''");
}

/**
 * Serializing a result set is linear in its rows, and resolution runs on every
 * render of the notebook. Results are replaced wholesale rather than mutated,
 * so the rendered CTE stays valid for as long as the result object lives.
 */
const cteCache = new WeakMap<QueryResult, Map<string, string>>();

function resultToCte(
  result: QueryResult,
  alias: string,
  escapeBackslashes: boolean,
): string {
  const variantKey = `${escapeBackslashes ? 1 : 0}:${alias}`;
  let variants = cteCache.get(result);
  const cached = variants?.get(variantKey);
  if (cached !== undefined) return cached;

  let cte: string;
  if (result.rows.length === 0) {
    const emptyCols = result.columns
      .map((col) => `NULL AS ${quoteIdentifier(col)}`)
      .join(", ");
    cte = `${alias} AS (SELECT ${emptyCols} WHERE 1=0)`;
  } else {
    const selects = result.rows.map((row) => {
      const cols = result.columns
        .map((col, i) => {
          const val = row[i];
          const ident = quoteIdentifier(col);
          if (val === null || val === undefined) return `NULL AS ${ident}`;
          if (typeof val === "number" && Number.isFinite(val)) {
            return `${val} AS ${ident}`;
          }
          const escaped = escapeStringLiteral(String(val), escapeBackslashes);
          return `'${escaped}' AS ${ident}`;
        })
        .join(", ");
      return `SELECT ${cols}`;
    });
    cte = `${alias} AS (\n  ${selects.join("\n  UNION ALL\n  ")}\n)`;
  }

  if (!variants) {
    variants = new Map();
    cteCache.set(result, variants);
  }
  variants.set(variantKey, cte);
  return cte;
}

export interface ResolvedQuery {
  sql: string;
  unresolvedRefs: CellReference[];
}

/**
 * Find cell indices that need to be executed before the given SQL can run.
 * Returns indices of referenced cells that have no result (or have errors).
 * Returns them in sorted order (lowest index first) for sequential execution.
 */
export function findUnresolvedDependencies(
  sql: string,
  cells: NotebookCell[],
): number[] {
  const refs = extractCellReferences(sql);
  const indices = new Set<number>();
  for (const ref of refs) {
    const targetCell = cells[ref.cellIndex];
    if (
      !targetCell ||
      targetCell.type !== "sql" ||
      !targetCell.result ||
      targetCell.error
    ) {
      if (targetCell && targetCell.type === "sql") {
        indices.add(ref.cellIndex);
      }
    }
  }
  return Array.from(indices).sort((a, b) => a - b);
}

export interface ResolveVariablesOptions {
  /** Double backslashes in string literals (MySQL/MariaDB dialects). */
  escapeBackslashes?: boolean;
}

export function resolveQueryVariables(
  sql: string,
  cells: NotebookCell[],
  options?: ResolveVariablesOptions,
): ResolvedQuery {
  if (!hasCellReferences(sql)) return { sql, unresolvedRefs: [] };

  const unresolvedRefs: CellReference[] = [];
  const ctes: string[] = [];
  const seen = new Set<number>();
  let resolvedSql = sql.replace(new RegExp(CELL_REF_PATTERN.source, "g"), (match: string, number: string) => {
    const cellIndex = Number(number) - 1;
    const targetCell = cells[cellIndex];
    if (
      !targetCell ||
      targetCell.type !== "sql" ||
      !targetCell.result ||
      targetCell.error
    ) {
      unresolvedRefs.push({ match, cellIndex });
      return match;
    }

    const alias = `cell_${cellIndex + 1}`;
    if (!seen.has(cellIndex)) {
      seen.add(cellIndex);
      ctes.push(
        resultToCte(targetCell.result, alias, options?.escapeBackslashes ?? false),
      );
    }
    return alias;
  });

  if (ctes.length > 0) {
    resolvedSql = `WITH ${ctes.join(",\n")}\n${resolvedSql}`;
  }

  return { sql: resolvedSql, unresolvedRefs };
}
