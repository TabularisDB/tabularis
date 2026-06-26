import type { Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import type { TableInfo } from "../contexts/DatabaseContext";
import { formatSqlIdentifier, getQuoteChar, quoteIdentifier } from "./identifiers";
import { getCurrentStatement, parseTablesFromQuery, type ParsedTableRef } from "./sqlAnalysis";

// Lightweight column cache with TTL and size limits
interface CachedColumns {
  data: Array<{ label: string; detail: string }>;
  timestamp: number;
  ttl: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const NEGATIVE_CACHE_TTL = 30 * 1000; // 30 s for empty results (structurally empty table/view)
const MAX_CACHE_ENTRIES = 50; // Limit total cached tables
const columnsCache = new Map<string, CachedColumns>();

// Pre-built keyword suggestions (reused, not recreated each time)
const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "OFFSET",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "JOIN", "LEFT JOIN",
  "RIGHT JOIN", "INNER JOIN", "OUTER JOIN", "ON", "AND", "OR", "NOT", "NULL",
  "IS", "IN", "BETWEEN", "LIKE", "AS", "DISTINCT", "COUNT", "SUM", "AVG",
  "MIN", "MAX", "HAVING", "CASE", "WHEN", "THEN", "ELSE", "END", "CREATE",
  "TABLE", "DROP", "ALTER", "INDEX", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES"
] as const;

// Cache cleanup to prevent unbounded growth
const cleanupCache = () => {
  if (columnsCache.size <= MAX_CACHE_ENTRIES) return;
  
  const now = Date.now();
  const entries = Array.from(columnsCache.entries());
  
  // Remove expired entries first
  for (const [key, value] of entries) {
    if (now - value.timestamp > CACHE_TTL) {
      columnsCache.delete(key);
    }
  }
  
  // If still over limit, remove oldest entries
  if (columnsCache.size > MAX_CACHE_ENTRIES) {
    const sorted = entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = sorted.slice(0, columnsCache.size - MAX_CACHE_ENTRIES);
    toRemove.forEach(([key]) => columnsCache.delete(key));
  }
};

const getTableColumns = async (connectionId: string, tableName: string, schema?: string | null) => {
  if (!connectionId || !tableName) return [];

  const cacheKey = schema ? `${connectionId}:${schema}:${tableName}` : `${connectionId}:${tableName}`;
  const cached = columnsCache.get(cacheKey);

  // Return cached data if valid
  if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
    return cached.data;
  }

  try {
    const cols = await invoke<Array<{ name: string; data_type: string }>>("get_columns", {
      connectionId,
      tableName,
      ...(schema ? { schema } : {}),
    });

    if (!Array.isArray(cols)) {
      console.warn(`get_columns returned non-array for table ${tableName}`, cols);
      return [];
    }

    // Store only essential data (no kind, insertText duplicates)
    const simpleCols = cols.map(c => ({
      label: c.name,
      detail: c.data_type,
    }));

    // Cache with a short TTL for empty results (structurally empty table/view) so we
    // don't re-issue get_columns on every trigger. Errors are not cached — they remain
    // transient and will retry on the next trigger.
    columnsCache.set(cacheKey, {
      data: simpleCols,
      timestamp: Date.now(),
      ttl: simpleCols.length > 0 ? CACHE_TTL : NEGATIVE_CACHE_TTL,
    });
    cleanupCache();
    return simpleCols;
  } catch (e) {
    console.error(`Failed to fetch columns for autocomplete: ${tableName}`, e);
    return [];
  }
};

// Clear cache for a specific connection (call on disconnect)
export const clearAutocompleteCache = (connectionId?: string) => {
  if (connectionId) {
    const keysToDelete = Array.from(columnsCache.keys())
      .filter(key => key.startsWith(`${connectionId}:`));
    keysToDelete.forEach(key => columnsCache.delete(key));
  } else {
    columnsCache.clear();
  }
};

let sqlCompletionProvider: { dispose: () => void } | null = null;

export const disposeSqlAutocomplete = (): void => {
  sqlCompletionProvider?.dispose();
  sqlCompletionProvider = null;
};

export const registerSqlAutocomplete = (
  monaco: Monaco,
  connectionId: string | null,
  tables: TableInfo[],
  schema?: string | null,
  driver?: string | null,
) => {
  const provider = monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    provideCompletionItems: async (model: { getWordUntilPosition: (position: { lineNumber: number; column: number }) => { startColumn: number; endColumn: number }; getValueInRange: (range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => string; getValue: () => string; getOffsetAt: (position: { lineNumber: number; column: number }) => number }, position: { lineNumber: number; column: number }) => {
      if (!connectionId) return { suggestions: [] };

      const wordUntil = model.getWordUntilPosition(position);

      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordUntil.startColumn,
        endColumn: wordUntil.endColumn,
      };

      // When the user has already typed an opening quote, Monaco auto-closes it
      // so the cursor sits inside a pair (`"|"`); the user may also have deleted
      // the closing one (`"|`). Inserting a freshly quoted identifier into the
      // word range would then double the opening quote (`""AccountEventLog"`) or
      // leave it dangling. So when an opening quote precedes the replacement
      // range, expand the range to swallow it (and the closing quote if present)
      // and emit a fully-quoted identifier — yielding a canonical result for 0, 1
      // or 2 surrounding quotes alike.
      const quoteChar = getQuoteChar(driver);
      const charAt = (column: number): string =>
        column < 1
          ? ""
          : model.getValueInRange({
              startLineNumber: position.lineNumber,
              startColumn: column,
              endLineNumber: position.lineNumber,
              endColumn: column + 1,
            });
      const buildIdentifierInsert = (
        name: string,
        baseRange: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number },
      ): {
        insertText: string;
        range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
        filterText?: string;
      } => {
        if (baseRange.startColumn <= 1 || charAt(baseRange.startColumn - 1) !== quoteChar) {
          return { insertText: formatSqlIdentifier(name, driver), range: baseRange };
        }
        const swallowsClosing = charAt(baseRange.endColumn) === quoteChar;
        const insertText = quoteIdentifier(name, driver);
        return {
          insertText,
          // The range now starts at the opening quote, so Monaco filters items
          // against the leading quote; match it by giving filterText the same
          // quoted form, otherwise every suggestion gets filtered out.
          filterText: insertText,
          range: {
            ...baseRange,
            startColumn: baseRange.startColumn - 1,
            endColumn: swallowsClosing ? baseRange.endColumn + 1 : baseRange.endColumn,
          },
        };
      };

      // Get text until cursor position
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      // Get current statement context
      const currentStatement = getCurrentStatement(model, position);
      const tableAliases = parseTablesFromQuery(currentStatement);


      // ============================================
      // 1. DOT TRIGGER (table.column, alias.column, or db.table.column)
      // ============================================
      // Try qualified (db.table.) first, then simple (table.)
      const qualifiedDotMatch = textUntilPosition.match(/`?([a-zA-Z0-9_]+)`?\.`?([a-zA-Z0-9_]+)`?\.([a-zA-Z0-9_]*)$/);
      const simpleDotMatch = qualifiedDotMatch ? null : textUntilPosition.match(/(?:["'`])?([a-zA-Z0-9_]+)(?:["'`])?\.([a-zA-Z0-9_]*)$/);

      if (qualifiedDotMatch || simpleDotMatch) {
        let dotTables: TableInfo[] = [];
        let partialColumn: string;

        if (qualifiedDotMatch) {
          const dbName = qualifiedDotMatch[1].toLowerCase();
          const tblName = qualifiedDotMatch[2].toLowerCase();
          partialColumn = qualifiedDotMatch[3];
          const found = tables.find(t => t.name.toLowerCase() === tblName && t.schema?.toLowerCase() === dbName);
          dotTables = found ? [found] : [{ name: tblName, schema: dbName }];
        } else {
          const typedName = simpleDotMatch![1].toLowerCase();
          partialColumn = simpleDotMatch![2];
          // Resolve via alias map (carries schema when FROM used qualified ref)
          const aliasRef: ParsedTableRef | undefined = tableAliases?.get(typedName);
          if (aliasRef) {
            const found = tables.find(t =>
              t.name.toLowerCase() === aliasRef.name.toLowerCase() &&
              (!aliasRef.schema || t.schema?.toLowerCase() === aliasRef.schema.toLowerCase())
            );
            dotTables = found ? [found] : [{ name: aliasRef.name, schema: aliasRef.schema }];
          } else {
            // Unqualified: collect every loaded table with this name across all schemas
            const matches = tables.filter(t => t.name.toLowerCase() === typedName);
            dotTables = matches.length > 0 ? matches : [{ name: typedName }];
          }
        }

        const colArrays = await Promise.all(
          dotTables.map(t => getTableColumns(connectionId, t.name, t.schema ?? schema))
        );
        const seen = new Set<string>();
        const columns = colArrays.flat().filter(c => (seen.has(c.label) ? false : (seen.add(c.label), true)));

        if (columns.length > 0) {
          const columnRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column - partialColumn.length,
            endColumn: position.column,
          };
          return {
            suggestions: columns.map(c => ({
              label: c.label,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: c.detail,
              ...buildIdentifierInsert(c.label, columnRange),
              sortText: `0_${c.label}`,
            })),
          };
        }

        return { suggestions: [] };
      }

      // ============================================
      // 2. CONTEXT-AWARE COLUMN SUGGESTIONS
      // ============================================
      const contextColumnSuggestions: Array<{
        label: string;
        kind: number;
        detail: string;
        insertText: string;
        range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
        sortText: string;
        filterText?: string;
      }> = [];
      
      if (tableAliases && tableAliases.size > 0) {
        // Deduplicate parsed refs by (schema, name) — multiple aliases can point to the same table
        const seenRefs = new Set<string>();
        const uniqueRefs = Array.from(tableAliases.values()).filter(ref => {
          const key = `${ref.schema ?? ''}:${ref.name}`;
          return seenRefs.has(key) ? false : (seenRefs.add(key), true);
        });

        // For qualified refs (schema known) find the exact table; for unqualified refs
        // expand to ALL loaded tables with that name so every selected DB is covered.
        const matchingTables: TableInfo[] = uniqueRefs.flatMap(ref => {
          if (ref.schema) {
            const found = tables.find(t =>
              t.name.toLowerCase() === ref.name.toLowerCase() &&
              t.schema?.toLowerCase() === ref.schema!.toLowerCase()
            );
            return found ? [found] : [ref as TableInfo];
          }
          const found = tables.filter(t => t.name.toLowerCase() === ref.name.toLowerCase());
          return found.length > 0 ? found : [ref as TableInfo];
        });

        // Limit parallel fetches to prevent memory spikes
        const MAX_PARALLEL_FETCHES = 5;
        if (matchingTables.length > MAX_PARALLEL_FETCHES) {
          matchingTables.splice(MAX_PARALLEL_FETCHES);
        }

        const results = await Promise.all(
          matchingTables.map(t => getTableColumns(connectionId, t.name, t.schema ?? schema))
        );

        const seenColumns = new Set<string>();

        matchingTables.forEach((table, idx) => {
          const columns = results[idx];
          columns.forEach(col => {
            if (!seenColumns.has(col.label)) {
              seenColumns.add(col.label);

              // Find alias for this table (if any)
              let aliasHint = "";
              for (const [alias, ref] of tableAliases.entries()) {
                if (ref.name.toLowerCase() === table.name.toLowerCase() && alias !== table.name.toLowerCase()) {
                  aliasHint = ` (${alias})`;
                  break;
                }
              }

              contextColumnSuggestions.push({
                label: col.label,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.detail} — ${table.name}${aliasHint}`,
                ...buildIdentifierInsert(col.label, range),
                sortText: `0_${col.label}`,
              });
            }
          });
        });
      }

      // ============================================
      // 3. KEYWORD SUGGESTIONS
      // ============================================
      const colLabels = new Set(contextColumnSuggestions.map(s => s.label.toUpperCase()));
      const keywordSuggestions = SQL_KEYWORDS
        .filter(kw => !colLabels.has(kw))
        .map((kw) => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          sortText: `2_${kw}`
        }));

      // ============================================
      // 4. TABLE SUGGESTIONS
      // ============================================
      const tableSuggestions = tables.map((t) => ({
        label: t.name,
        kind: monaco.languages.CompletionItemKind.Class,
        detail: "Table",
        ...buildIdentifierInsert(t.name, range),
        sortText: `1_${t.name}`
      }));

      return {
        suggestions: [
          ...contextColumnSuggestions,
          ...tableSuggestions,
          ...keywordSuggestions,
        ],
      };
    },
  });

  sqlCompletionProvider?.dispose();
  sqlCompletionProvider = provider;
  return provider;
};
