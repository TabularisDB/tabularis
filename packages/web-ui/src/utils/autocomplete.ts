import type {Monaco} from '@monaco-editor/react';
import type {TableInfo} from '@/contexts/DatabaseContext';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import type {TypedCommandCaller} from '@/api/contract';
import {getQuoteChar, quoteIdentifier, quoteIdentifierIfNeeded} from './identifiers';
import {getCurrentStatement, parseTablesFromQuery, type ParsedTableRef} from './sqlAnalysis';
import {
    analyzeSqlContext,
    findStatementScopeEnd,
    getKeywordRelevance,
    getSuggestionKinds,
} from './sqlContext';
import {maskNestedSqlBodies, parseDerivedTables} from './derivedTables';
import {dialectOptions, type QuoteRule} from './sqlSplitter';
import {resolveSqlSyntax, syntaxKeywords} from './sqlSyntax';

export type AutocompleteKeywordCase = 'match' | 'upper' | 'lower';

// Decide whether a keyword completion should be upper or lower case.
export function resolveKeywordCase(
    mode: AutocompleteKeywordCase | undefined,
    typedPrefix: string,
): 'upper' | 'lower' {
    if (mode === 'upper') return 'upper';
    if (mode === 'lower') return 'lower';

    const letters = typedPrefix.replace(/[^A-Za-z]/g, '');
    if (letters.length === 0) return 'upper';
    return letters === letters.toLowerCase() ? 'lower' : 'upper';
}

// Apply the keyword-case setting
export function applyKeywordCase(
    keyword: string,
    mode: AutocompleteKeywordCase | undefined,
    typedPrefix: string,
): string {
    return resolveKeywordCase(mode, typedPrefix) === 'lower'
        ? keyword.toLowerCase()
        : keyword.toUpperCase();
}

/**
 * In "match" mode the case is decided by the first typed letters. When the
 * list is opened with none yet (a trigger character such as " ", or Ctrl+Space
 * on an empty word), Monaco would only re-filter the items it already has as
 * the user types, keeping the fallback case. Marking that result incomplete
 * makes Monaco ask the provider again once there is a letter to match.
 */
export function needsKeywordCaseRetrigger(
    mode: AutocompleteKeywordCase | undefined,
    typedPrefix: string,
): boolean {
    return (mode ?? 'match') === 'match' && !/[A-Za-z]/.test(typedPrefix);
}

// Lightweight column cache with TTL and size limits
interface CachedColumns {
    data: Array<{label: string; detail: string}>;
    timestamp: number;
    ttl: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const NEGATIVE_CACHE_TTL = 30 * 1000; // 30 s for empty results (structurally empty table/view)
const MAX_CACHE_ENTRIES = 50; // Limit total cached tables
const columnsCache = new Map<string, CachedColumns>();

// Pre-built keyword suggestions (reused, not recreated each time)
const SQL_KEYWORDS = [
    'SELECT',
    'FROM',
    'WHERE',
    'GROUP BY',
    'ORDER BY',
    'LIMIT',
    'OFFSET',
    'INSERT',
    'INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE',
    'JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'INNER JOIN',
    'OUTER JOIN',
    'ON',
    'AND',
    'OR',
    'NOT',
    'NULL',
    'IS',
    'IN',
    'BETWEEN',
    'LIKE',
    'AS',
    'DISTINCT',
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'HAVING',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'CREATE',
    'TABLE',
    'DROP',
    'ALTER',
    'INDEX',
    'PRIMARY KEY',
    'FOREIGN KEY',
    'REFERENCES',
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

const getTableColumns = async (
    client: TypedCommandCaller,
    connectionId: string,
    tableName: string,
    schema?: string | null,
) => {
    if (!connectionId || !tableName) return [];

    const cacheKey = schema
        ? `${connectionId}:${schema}:${tableName}`
        : `${connectionId}:${tableName}`;
    const cached = columnsCache.get(cacheKey);

    // Return cached data if valid
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
        return cached.data;
    }

    try {
        const cols = await client.call('get_columns', {
            connectionId,
            tableName,
            ...(schema ? {schema} : {}),
        });

        if (!Array.isArray(cols)) {
            console.warn(`get_columns returned non-array for table ${tableName}`, cols);
            return [];
        }

        // Store only essential data (no kind, insertText duplicates)
        const simpleCols = cols.map((c) => ({
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
        const keysToDelete = Array.from(columnsCache.keys()).filter((key) =>
            key.startsWith(`${connectionId}:`),
        );
        keysToDelete.forEach((key) => columnsCache.delete(key));
    } else {
        columnsCache.clear();
    }
};

type DriverRef = string | PluginManifest | DriverCapabilities | null | undefined;

/**
 * The string-literal quote rules of the driver's dialect: the resolved
 * `sql_syntax` of a manifest or capabilities object, the MySQL preset for the
 * bare `mysql` / `mariadb` ids, otherwise standard single-quoted strings. On
 * MySQL that adds double-quoted strings and backslash escapes. A rule that
 * opens with the identifier quote itself is dropped, so a MySQL-dialect plugin
 * that quotes identifiers with `"` (ANSI_QUOTES) still reads `"` as one.
 */
function stringLiteralRules(driver: DriverRef, quoteChar: string): readonly QuoteRule[] {
    const options =
        typeof driver === 'object' && driver !== null
            ? resolveSqlSyntax(driver).options
            : dialectOptions(driver === 'mysql' || driver === 'mariadb' ? 'mysql' : 'generic');
    return options.quotes.filter((rule) => rule.kind === 'string' && rule.open !== quoteChar);
}

/**
 * Returns the 0-based index of the identifier quote the line text ends inside
 * of (the user typed an opening quote and has not closed it yet), or -1.
 * Quotes inside string literals are ignored, following the driver's dialect
 * (see `stringLiteralRules`), and `[` pairs with `]` for drivers that quote
 * with brackets.
 */
export function findOpenIdentifierQuote(
    text: string,
    quoteChar: string,
    driver?: DriverRef,
): number {
    const closingQuote = quoteChar === '[' ? ']' : quoteChar;
    const literalRules = stringLiteralRules(driver, quoteChar);
    let open = -1;
    let literal: QuoteRule | null = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (literal) {
            if (literal.escape && ch === literal.escape) {
                // `'it\'s'` on MySQL: the escaped character never closes the string.
                i++;
            } else if (text.startsWith(literal.close, i)) {
                const after = i + literal.close.length;
                // A doubled closing quote is an escaped quote inside the string.
                if (literal.doubleClose && text.startsWith(literal.close, after)) {
                    i = after + literal.close.length - 1;
                } else {
                    i = after - 1;
                    literal = null;
                }
            }
        } else if (open >= 0) {
            if (ch !== closingQuote) continue;
            // A doubled closing quote is an escaped quote inside the name.
            if (closingQuote === quoteChar && text[i + 1] === closingQuote) i++;
            else open = -1;
        } else {
            const rule = literalRules.find((r) => text.startsWith(r.open, i));
            if (rule) {
                literal = rule;
                i += rule.open.length - 1;
            } else if (ch === quoteChar) {
                open = i;
            }
        }
    }
    return open;
}

let sqlCompletionProvider: {dispose: () => void} | null = null;

export const disposeSqlAutocomplete = (): void => {
    sqlCompletionProvider?.dispose();
    sqlCompletionProvider = null;
};

export const registerSqlAutocomplete = (
    monaco: Monaco,
    connectionId: string | null,
    tables: TableInfo[],
    schema?: string | null,
    driver?: string | PluginManifest | DriverCapabilities | null,
    client?: TypedCommandCaller,
    keywordCase: AutocompleteKeywordCase = 'match',
) => {
    // Declared `sql_syntax` keywords and functions join the shared list.
    const keywords = syntaxKeywords(
        SQL_KEYWORDS,
        resolveSqlSyntax(typeof driver === 'object' ? driver : null),
    );
    const provider = monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' '],
        provideCompletionItems: async (
            model: {
                getWordUntilPosition: (position: {lineNumber: number; column: number}) => {
                    word?: string;
                    startColumn: number;
                    endColumn: number;
                };
                getValueInRange: (range: {
                    startLineNumber: number;
                    startColumn: number;
                    endLineNumber: number;
                    endColumn: number;
                }) => string;
                getValue: () => string;
                getOffsetAt: (position: {lineNumber: number; column: number}) => number;
            },
            position: {lineNumber: number; column: number},
        ) => {
            if (!connectionId || !client) return {suggestions: []};

            const wordUntil = model.getWordUntilPosition(position);
            const typedPrefix = wordUntil.word ?? '';

            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: wordUntil.startColumn,
                endColumn: wordUntil.endColumn,
            };

            // Get text until cursor position
            const textUntilPosition = model.getValueInRange({
                startLineNumber: position.lineNumber,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
            });

            // Identifiers are inserted quoted with the dialect's quote only when they
            // need it (`global-conf_modulos` -> `` `global-conf_modulos` `` on MySQL),
            // while label and filter text stay unquoted so `glo` still matches.
            //
            // When the user has already typed an opening quote, Monaco may auto-close
            // it so the cursor sits inside a pair (`"|"`); the user may also have
            // deleted the closing one (`"|`) or typed part of the name (`` `global-co| ``).
            // Inserting a freshly quoted identifier into the word range would then
            // double the opening quote (`""AccountEventLog"`) or leave it dangling. So
            // when the cursor is inside an opened quote, expand the range to swallow it
            // (and the closing quote if present) and emit a fully-quoted identifier —
            // yielding a canonical result for 0, 1 or 2 surrounding quotes alike.
            const quoteChar = getQuoteChar(driver);
            const openQuoteIndex = findOpenIdentifierQuote(textUntilPosition, quoteChar, driver);
            const openQuoteColumn = openQuoteIndex >= 0 ? openQuoteIndex + 1 : null;
            // The text before the identifier being typed, without its opening quote
            // and partial name, so clause analysis and the dot matchers see the same
            // input as for an unquoted name (`FROM ` rather than `FROM \`glo`).
            const textBeforeIdentifier =
                openQuoteIndex >= 0
                    ? textUntilPosition.slice(0, openQuoteIndex)
                    : textUntilPosition;
            const charAt = (column: number): string =>
                column < 1
                    ? ''
                    : model.getValueInRange({
                          startLineNumber: position.lineNumber,
                          startColumn: column,
                          endLineNumber: position.lineNumber,
                          endColumn: column + 1,
                      });
            const closingQuote = quoteChar === '[' ? ']' : quoteChar;
            const buildIdentifierInsert = (
                name: string,
                baseRange: {
                    startLineNumber: number;
                    endLineNumber: number;
                    startColumn: number;
                    endColumn: number;
                },
            ): {
                insertText: string;
                range: {
                    startLineNumber: number;
                    endLineNumber: number;
                    startColumn: number;
                    endColumn: number;
                };
                filterText?: string;
            } => {
                if (openQuoteColumn !== null && openQuoteColumn < baseRange.startColumn) {
                    const swallowsClosing = charAt(baseRange.endColumn) === closingQuote;
                    const insertText = quoteIdentifier(name, driver);
                    return {
                        insertText,
                        // The range now starts at the opening quote, so Monaco filters
                        // items against the leading quote; match it by giving filterText
                        // the same quoted form, otherwise every suggestion gets filtered out.
                        filterText: insertText,
                        range: {
                            ...baseRange,
                            startColumn: openQuoteColumn,
                            endColumn: swallowsClosing
                                ? baseRange.endColumn + 1
                                : baseRange.endColumn,
                        },
                    };
                }
                const insertText = quoteIdentifierIfNeeded(name, driver);
                if (insertText === name) return {insertText, range: baseRange};
                // Monaco's word stops at a hyphen, so after typing `global-co` only `co`
                // is in the word range. Swallow the typed lead-in when it starts the name,
                // otherwise the quoted name lands after it (`global-\`global-conf_modulos\``).
                const leadIn =
                    textUntilPosition.slice(0, baseRange.startColumn - 1).match(/[\w$-]+$/)?.[0] ??
                    '';
                const typed = textUntilPosition.slice(baseRange.startColumn - 1);
                const swallowsLeadIn =
                    leadIn !== '' && name.toLowerCase().startsWith((leadIn + typed).toLowerCase());
                return {
                    insertText,
                    // Filter on the bare name so typing `glo` still matches.
                    filterText: name,
                    range: swallowsLeadIn
                        ? {...baseRange, startColumn: baseRange.startColumn - leadIn.length}
                        : baseRange,
                };
            };

            // Clause-aware context: figure out where the cursor sits so only the
            // relevant suggestion kinds are offered (and nothing inside strings or
            // comments).
            const fullTextUntilPosition = model.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
            });
            const sqlContext = analyzeSqlContext(
                fullTextUntilPosition.slice(
                    0,
                    fullTextUntilPosition.length -
                        (textUntilPosition.length - textBeforeIdentifier.length),
                ),
            );
            if (sqlContext.inString || sqlContext.inComment) {
                return {suggestions: []};
            }
            const suggestionKinds = getSuggestionKinds(sqlContext.clause);

            // Get current statement context. When the cursor sits inside a
            // subquery/CTE body, context columns must come from that scope's own
            // FROM list, so the scoped refs are parsed separately. Outer refs stay
            // resolvable through the merged map so correlated references
            // (`WHERE o.user_id = u.id`) keep completing via the dot trigger.
            const currentStatement = getCurrentStatement(model, position);
            const sourceText = model.getValue();
            const cursorOffset = Math.min(sourceText.length, model.getOffsetAt(position));
            const derivedTables = parseDerivedTables(sourceText, cursorOffset);
            const derivedByName = new Map(derivedTables.map((t) => [t.name.toLowerCase(), t]));
            const outerAliases = parseTablesFromQuery(maskNestedSqlBodies(currentStatement));
            let scopedAliases = outerAliases;
            if (sqlContext.statementStart > 0) {
                const fullText = model.getValue();
                const scopeEnd = findStatementScopeEnd(fullText, fullTextUntilPosition.length);
                scopedAliases = parseTablesFromQuery(
                    maskNestedSqlBodies(fullText.slice(sqlContext.statementStart, scopeEnd)),
                );
            }
            const tableAliases =
                scopedAliases === outerAliases
                    ? outerAliases
                    : new Map([...(outerAliases ?? []), ...(scopedAliases ?? [])]);

            // ============================================
            // 1. DOT TRIGGER (table.column, alias.column, or db.table.column)
            // ============================================
            // Try qualified (db.table.) first, then simple (table.)
            const qualifiedDotMatch = textBeforeIdentifier.match(
                /`?([a-zA-Z0-9_]+)`?\.`?([a-zA-Z0-9_]+)`?\.([a-zA-Z0-9_]*)$/,
            );
            // Parse quoted aliases first: the unquoted pattern would otherwise
            // incorrectly extract only the final word of "My CTE".
            const quotedDotMatch = qualifiedDotMatch
                ? null
                : textBeforeIdentifier.match(
                      /(?:"((?:[^"]|"")*)"|`((?:[^`]|``)*)`|\[((?:[^\]]|\]\])*)\])\.([a-zA-Z0-9_]*)$/,
                  );
            const simpleDotMatch =
                qualifiedDotMatch || quotedDotMatch
                    ? null
                    : textBeforeIdentifier.match(
                          /(?:["'`])?([a-zA-Z0-9_]+)(?:["'`])?\.([a-zA-Z0-9_]*)$/,
                      );
            if (qualifiedDotMatch || simpleDotMatch || quotedDotMatch) {
                const quotedAlias = quotedDotMatch
                    ? (quotedDotMatch[1] ?? quotedDotMatch[2] ?? quotedDotMatch[3] ?? '')
                          .replace(/""/g, '"')
                          .replace(/``/g, '`')
                          .replace(/\]\]/g, ']')
                    : '';
                // In a table operand, `namespace.partial` refers to a table rather than
                // a column. Resolve this before the regular table/alias dot path so
                // `FROM Ops.Add` does not request columns for a table named `Ops`. The
                // namespace may itself be quoted (`` `my-db`.glo ``); only the table part
                // is inserted, quoted on its own.
                if ((simpleDotMatch || quotedDotMatch) && suggestionKinds.tables) {
                    const namespace = (simpleDotMatch?.[1] ?? quotedAlias).toLowerCase();
                    const partialTable = simpleDotMatch?.[2] ?? quotedDotMatch?.[4] ?? '';
                    const namespaceTables = tables.filter(
                        (table) => table.schema?.toLowerCase() === namespace,
                    );

                    if (namespaceTables.length > 0) {
                        const tableRange = {
                            startLineNumber: position.lineNumber,
                            endLineNumber: position.lineNumber,
                            startColumn: position.column - partialTable.length,
                            endColumn: position.column,
                        };
                        return {
                            suggestions: namespaceTables.map((table) => ({
                                label: table.name,
                                kind: monaco.languages.CompletionItemKind.Class,
                                detail: `Table · ${table.schema}`,
                                ...buildIdentifierInsert(table.name, tableRange),
                                sortText: `1_${table.name}`,
                            })),
                        };
                    }
                }

                let dotTables: TableInfo[] = [];
                let partialColumn: string;

                if (qualifiedDotMatch) {
                    const dbName = qualifiedDotMatch[1].toLowerCase();
                    const tblName = qualifiedDotMatch[2].toLowerCase();
                    partialColumn = qualifiedDotMatch[3];
                    const found = tables.find(
                        (t) =>
                            t.name.toLowerCase() === tblName && t.schema?.toLowerCase() === dbName,
                    );
                    dotTables = found ? [found] : [{name: tblName, schema: dbName}];
                } else {
                    const typedName = (simpleDotMatch?.[1] ?? quotedAlias).toLowerCase();
                    partialColumn = simpleDotMatch?.[2] ?? quotedDotMatch?.[4] ?? '';
                    // Virtual relations belong to this SQL statement, not the server.
                    // Resolve them before asking get_columns for a physical table.
                    const aliasRef: ParsedTableRef | undefined = tableAliases?.get(typedName);
                    // A FROM alias wins over a same-named CTE (or one in an earlier statement).
                    const virtualTable = aliasRef
                        ? derivedByName.get(aliasRef.name.toLowerCase())
                        : derivedByName.get(typedName);
                    if (virtualTable) {
                        const columnRange = {
                            startLineNumber: position.lineNumber,
                            endLineNumber: position.lineNumber,
                            startColumn: position.column - partialColumn.length,
                            endColumn: position.column,
                        };
                        return {
                            suggestions: virtualTable.columns.map((c) => ({
                                label: c.name,
                                kind: monaco.languages.CompletionItemKind.Field,
                                detail: `${virtualTable.kind} ${virtualTable.name}`,
                                ...buildIdentifierInsert(c.name, columnRange),
                                sortText: `0_${c.name}`,
                            })),
                        };
                    }
                    if (aliasRef) {
                        const found = tables.find(
                            (t) =>
                                t.name.toLowerCase() === aliasRef.name.toLowerCase() &&
                                (!aliasRef.schema ||
                                    t.schema?.toLowerCase() === aliasRef.schema.toLowerCase()),
                        );
                        dotTables = found
                            ? [found]
                            : [{name: aliasRef.name, schema: aliasRef.schema}];
                    } else {
                        // Unqualified: collect every loaded table with this name across all schemas
                        const matches = tables.filter((t) => t.name.toLowerCase() === typedName);
                        dotTables = matches.length > 0 ? matches : [{name: typedName}];
                    }
                }

                const colArrays = await Promise.all(
                    dotTables.map((t) =>
                        getTableColumns(client, connectionId, t.name, t.schema ?? schema),
                    ),
                );
                const seen = new Set<string>();
                const columns = colArrays
                    .flat()
                    .filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)));

                if (columns.length > 0) {
                    const columnRange = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: position.column - partialColumn.length,
                        endColumn: position.column,
                    };
                    return {
                        suggestions: columns.map((c) => ({
                            label: c.label,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: c.detail,
                            ...buildIdentifierInsert(c.label, columnRange),
                            sortText: `0_${c.label}`,
                        })),
                    };
                }

                return {suggestions: []};
            }

            // ============================================
            // 2. CONTEXT-AWARE COLUMN SUGGESTIONS
            // ============================================
            const contextColumnSuggestions: Array<{
                label: string;
                kind: number;
                detail: string;
                insertText: string;
                range: {
                    startLineNumber: number;
                    endLineNumber: number;
                    startColumn: number;
                    endColumn: number;
                };
                sortText: string;
                filterText?: string;
            }> = [];

            // CTEs in the FROM list and derived FROM subqueries are local
            // column sources. Derived FROM subqueries have no physical-table ref
            // after their bodies are masked, so collect them directly.
            if (suggestionKinds.columns) {
                const seenVirtual = new Set<string>();
                for (const virtual of derivedTables) {
                    const referenced =
                        virtual.kind === 'Derived table' ||
                        Array.from(scopedAliases?.values() ?? []).some(
                            (ref) => ref.name.toLowerCase() === virtual.name.toLowerCase(),
                        );
                    if (!referenced) continue;
                    for (const col of virtual.columns) {
                        if (seenVirtual.has(col.name.toLowerCase())) continue;
                        seenVirtual.add(col.name.toLowerCase());
                        contextColumnSuggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${virtual.kind} ${virtual.name}`,
                            ...buildIdentifierInsert(col.name, range),
                            sortText: `0_${col.name}`,
                        });
                    }
                }
            }

            if (suggestionKinds.columns && scopedAliases && scopedAliases.size > 0) {
                // Deduplicate parsed refs by (schema, name) — multiple aliases can point to the same table
                const seenRefs = new Set<string>();
                const uniqueRefs = Array.from(scopedAliases.values()).filter((ref) => {
                    if (derivedByName.has(ref.name.toLowerCase())) return false;
                    const key = `${ref.schema ?? ''}:${ref.name}`;
                    return seenRefs.has(key) ? false : (seenRefs.add(key), true);
                });

                // For qualified refs (schema known) find the exact table; for unqualified refs
                // expand to ALL loaded tables with that name so every selected DB is covered.
                const matchingTables: TableInfo[] = uniqueRefs.flatMap((ref) => {
                    if (ref.schema) {
                        const found = tables.find(
                            (t) =>
                                t.name.toLowerCase() === ref.name.toLowerCase() &&
                                t.schema?.toLowerCase() === ref.schema!.toLowerCase(),
                        );
                        return found ? [found] : [ref as TableInfo];
                    }
                    const found = tables.filter(
                        (t) => t.name.toLowerCase() === ref.name.toLowerCase(),
                    );
                    return found.length > 0 ? found : [ref as TableInfo];
                });

                // The nearest table (the one being joined in ON, the primary FROM table
                // in WHERE, ...) goes first: it wins the label dedupe below for shared
                // column names such as `id`, and it is never dropped by the fetch cap.
                const nearestRef = sqlContext.lastTableRef?.toLowerCase();
                const isNearestTable = (table: TableInfo): boolean =>
                    Boolean(
                        nearestRef &&
                        (table.name.toLowerCase() === nearestRef ||
                            Array.from(scopedAliases.entries()).some(
                                ([alias, ref]) =>
                                    alias.toLowerCase() === nearestRef &&
                                    ref.name.toLowerCase() === table.name.toLowerCase() &&
                                    (!ref.schema ||
                                        !table.schema ||
                                        ref.schema.toLowerCase() === table.schema.toLowerCase()),
                            )),
                    );
                const nearestTables = new Set(matchingTables.filter(isNearestTable));
                matchingTables.sort(
                    (a, b) => Number(nearestTables.has(b)) - Number(nearestTables.has(a)),
                );

                // Limit parallel fetches to prevent memory spikes
                const MAX_PARALLEL_FETCHES = 5;
                if (matchingTables.length > MAX_PARALLEL_FETCHES) {
                    matchingTables.splice(MAX_PARALLEL_FETCHES);
                }

                const results = await Promise.all(
                    matchingTables.map((t) =>
                        getTableColumns(client, connectionId, t.name, t.schema ?? schema),
                    ),
                );

                const seenColumns = new Set(contextColumnSuggestions.map((col) => col.label));

                matchingTables.forEach((table, idx) => {
                    const columns = results[idx];
                    const isNearest = nearestTables.has(table);
                    const sortPrefix =
                        matchingTables.length > 1 ? (isNearest ? '0_0_' : '0_1_') : '0_';

                    columns.forEach((col) => {
                        if (!seenColumns.has(col.label)) {
                            seenColumns.add(col.label);

                            // Find alias for this table (if any)
                            let aliasHint = '';
                            for (const [alias, ref] of scopedAliases.entries()) {
                                if (
                                    ref.name.toLowerCase() === table.name.toLowerCase() &&
                                    alias !== table.name.toLowerCase()
                                ) {
                                    aliasHint = ` (${alias})`;
                                    break;
                                }
                            }

                            contextColumnSuggestions.push({
                                label: col.label,
                                kind: monaco.languages.CompletionItemKind.Field,
                                detail: `${col.detail} — ${table.name}${aliasHint}`,
                                ...buildIdentifierInsert(col.label, range),
                                sortText: `${sortPrefix}${col.label}`,
                            });
                        }
                    });
                });
            }

            // ============================================
            // 3. KEYWORD SUGGESTIONS
            // ============================================
            // Keywords irrelevant in the current clause are dropped (WHEN outside
            // CASE, ...); likely continuations get a higher rank (`2_0_`) so a
            // short prefix + Enter picks the right one (e.g. "wh" after FROM →
            // WHERE, not WHEN). Inside an opened identifier quote only names fit.
            const colLabels = new Set(contextColumnSuggestions.map((s) => s.label.toUpperCase()));
            const offerKeywords = suggestionKinds.keywords && openQuoteColumn === null;
            const keywordSuggestions = offerKeywords
                ? keywords
                      .filter((kw) => !colLabels.has(kw))
                      .map((kw) => ({kw, relevance: getKeywordRelevance(sqlContext.clause, kw)}))
                      .filter(({relevance}) => relevance !== 'hidden')
                      .map(({kw, relevance}) => {
                          // Only the displayed/inserted text is re-cased; filtering,
                          // relevance and sortText keep using the canonical uppercase kw.
                          const text = applyKeywordCase(kw, keywordCase, typedPrefix);
                          return {
                              label: text,
                              kind: monaco.languages.CompletionItemKind.Keyword,
                              insertText: text,
                              range,
                              sortText: relevance === 'high' ? `2_0_${kw}` : `2_1_${kw}`,
                          };
                      })
                : [];

            // ============================================
            // 4. TABLE SUGGESTIONS
            // ============================================
            const tableSuggestions = suggestionKinds.tables
                ? tables.map((t) => ({
                      label: t.name,
                      kind: monaco.languages.CompletionItemKind.Class,
                      detail: 'Table',
                      ...buildIdentifierInsert(t.name, range),
                      sortText: `1_${t.name}`,
                  }))
                : [];

            return {
                suggestions: [
                    ...contextColumnSuggestions,
                    ...tableSuggestions,
                    ...keywordSuggestions,
                ],
                // See needsKeywordCaseRetrigger: re-query on the first typed letter.
                ...(keywordSuggestions.length > 0 &&
                needsKeywordCaseRetrigger(keywordCase, typedPrefix)
                    ? {incomplete: true}
                    : {}),
            };
        },
    });

    sqlCompletionProvider?.dispose();
    sqlCompletionProvider = provider;
    return provider;
};
