import type {NotebookCell} from '@/types/notebook';

export const SCALAR_REF_PATTERN = /\{\{value:((?:(?!\}\}).)*)\}\}/g;

export interface ParsedScalarReference {
    raw: string;
    target: string;
    column: string;
}

export type ScalarResolution =
    | {
          kind: 'value';
          raw: string;
          targetLabel: string;
          cellIndex: number;
          column: string;
          text: string;
          isStale: boolean;
      }
    | {
          kind: 'null';
          raw: string;
          targetLabel: string;
          cellIndex: number;
          column: string;
          isStale: boolean;
      }
    | {kind: 'notRun'; raw: string; targetLabel: string; cellIndex: number}
    | {kind: 'loading'; raw: string; targetLabel: string; cellIndex: number}
    | {kind: 'error'; raw: string; targetLabel: string; cellIndex: number; error: string}
    | {kind: 'noRows'; raw: string; targetLabel: string; cellIndex: number}
    | {kind: 'multipleRows'; raw: string; targetLabel: string; cellIndex: number; rowCount: number}
    | {kind: 'missingColumn'; raw: string; targetLabel: string; cellIndex: number; column: string}
    | {
          kind: 'ambiguousColumn';
          raw: string;
          targetLabel: string;
          cellIndex: number;
          column: string;
          count: number;
      }
    | {kind: 'missingCell'; raw: string; targetLabel: string}
    | {kind: 'ambiguousCell'; raw: string; targetLabel: string; count: number}
    | {kind: 'notSqlCell'; raw: string; targetLabel: string; cellIndex: number}
    | {kind: 'invalid'; raw: string};

export interface ScalarReferenceMatch {
    raw: string;
    inner: string;
    start: number;
    end: number;
}

export interface ScalarSuggestion {
    insertText: string;
    label: string;
    cellName?: string;
    preview?: string;
    isAlias?: boolean;
}

const QUOTE_CHARS = new Set(['"', "'", '`']);

function readQuotedSegment(
    input: string,
    startIndex: number,
): {value: string; nextIndex: number} | null {
    const quote = input[startIndex];
    let value = '';
    let i = startIndex + 1;
    while (i < input.length) {
        const ch = input[i];
        if (ch === '\\' && i + 1 < input.length) {
            value += input[i + 1];
            i += 2;
            continue;
        }
        if (ch === quote) {
            if (i + 1 < input.length && input[i + 1] === quote) {
                value += quote;
                i += 2;
                continue;
            }
            return {value, nextIndex: i + 1};
        }
        value += ch;
        i += 1;
    }
    return null;
}

export function parseScalarReference(raw: string, inner: string): ParsedScalarReference | null {
    const trimmed = inner.trim();
    if (!trimmed) return null;

    let target: string;
    let restStart: number;

    if (QUOTE_CHARS.has(trimmed[0])) {
        const quoted = readQuotedSegment(trimmed, 0);
        if (!quoted || !quoted.value.trim()) return null;
        target = quoted.value.trim();
        restStart = quoted.nextIndex;
        if (trimmed[restStart] !== '.') return null;
        restStart += 1;
    } else {
        const dotIndex = trimmed.indexOf('.');
        if (dotIndex <= 0) return null;
        target = trimmed.slice(0, dotIndex).trim();
        restStart = dotIndex + 1;
    }

    if (!target) return null;

    const positionalMatch = /^cell_(\d+)$/.exec(target);
    if (positionalMatch && Number(positionalMatch[1]) < 1) {
        return null;
    }

    const colPart = trimmed.slice(restStart);
    if (!colPart) return null;

    let column: string;
    if (QUOTE_CHARS.has(colPart[0])) {
        const quoted = readQuotedSegment(colPart, 0);
        if (!quoted || !quoted.value) return null;
        if (colPart.slice(quoted.nextIndex).trim().length > 0) return null;
        column = quoted.value;
    } else {
        column = colPart.trim();
        if (!column) return null;
    }

    return {raw, target, column};
}

export function extractScalarReferences(content: string): ScalarReferenceMatch[] {
    const matches: ScalarReferenceMatch[] = [];
    const regex = new RegExp(SCALAR_REF_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        matches.push({
            raw: match[0],
            inner: match[1],
            start: match.index,
            end: match.index + match[0].length,
        });
    }
    return matches;
}

export function scalarValueToString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

export function isCellOutputStale(cell: NotebookCell): boolean {
    if (!cell.result || cell.error) return false;
    if (!cell.history || cell.history.length === 0) return false;
    return cell.content.trim() !== cell.history[0].query;
}

function findColumnIndex(
    columns: string[],
    columnName: string,
): {kind: 'found'; index: number} | {kind: 'missing'} | {kind: 'ambiguous'; count: number} {
    const exactMatches: number[] = [];
    for (let i = 0; i < columns.length; i += 1) {
        if (columns[i] === columnName) exactMatches.push(i);
    }
    if (exactMatches.length === 1) return {kind: 'found', index: exactMatches[0]};
    if (exactMatches.length > 1) return {kind: 'ambiguous', count: exactMatches.length};

    const lower = columnName.toLowerCase();
    const ciMatches: number[] = [];
    for (let i = 0; i < columns.length; i += 1) {
        if (columns[i].toLowerCase() === lower) ciMatches.push(i);
    }
    if (ciMatches.length === 1) return {kind: 'found', index: ciMatches[0]};
    if (ciMatches.length > 1) return {kind: 'ambiguous', count: ciMatches.length};
    return {kind: 'missing'};
}

export function resolveScalarReference(
    raw: string,
    inner: string,
    cells: NotebookCell[],
): ScalarResolution {
    const parsed = parseScalarReference(raw, inner);
    if (!parsed) {
        return {kind: 'invalid', raw};
    }

    const {target, column} = parsed;
    let cellIndex = -1;
    let targetLabel = target;

    const positionalMatch = /^cell_(\d+)$/.exec(target);
    if (positionalMatch) {
        const cellNum = Number(positionalMatch[1]);
        cellIndex = cellNum - 1;
        targetLabel = `Cell ${cellNum}`;
        if (cellIndex < 0 || cellIndex >= cells.length) {
            return {kind: 'missingCell', raw, targetLabel};
        }
    } else {
        const matchedIndices: number[] = [];
        for (let i = 0; i < cells.length; i += 1) {
            if (cells[i].name?.trim() === target) {
                matchedIndices.push(i);
            }
        }
        if (matchedIndices.length === 0) {
            return {kind: 'missingCell', raw, targetLabel};
        }
        if (matchedIndices.length > 1) {
            return {kind: 'ambiguousCell', raw, targetLabel, count: matchedIndices.length};
        }
        cellIndex = matchedIndices[0];
        targetLabel = target;
    }

    const targetCell = cells[cellIndex];
    if (targetCell.type !== 'sql') {
        return {kind: 'notSqlCell', raw, targetLabel, cellIndex};
    }

    if (targetCell.error) {
        return {kind: 'error', raw, targetLabel, cellIndex, error: targetCell.error};
    }

    if (!targetCell.result) {
        if (targetCell.isLoading) {
            return {kind: 'loading', raw, targetLabel, cellIndex};
        }
        return {kind: 'notRun', raw, targetLabel, cellIndex};
    }

    const {columns, rows} = targetCell.result;
    if (rows.length === 0) {
        return {kind: 'noRows', raw, targetLabel, cellIndex};
    }
    if (rows.length > 1) {
        return {kind: 'multipleRows', raw, targetLabel, cellIndex, rowCount: rows.length};
    }

    const colMatch = findColumnIndex(columns, column);
    if (colMatch.kind === 'missing') {
        return {kind: 'missingColumn', raw, targetLabel, cellIndex, column};
    }
    if (colMatch.kind === 'ambiguous') {
        return {
            kind: 'ambiguousColumn',
            raw,
            targetLabel,
            cellIndex,
            column,
            count: colMatch.count,
        };
    }

    const isStale = isCellOutputStale(targetCell);
    const value = rows[0][colMatch.index];
    if (value === null || value === undefined) {
        return {kind: 'null', raw, targetLabel, cellIndex, column, isStale};
    }

    return {
        kind: 'value',
        raw,
        targetLabel,
        cellIndex,
        column,
        text: scalarValueToString(value),
        isStale,
    };
}

export function formatScalarResolutionText(resolution: ScalarResolution): string {
    switch (resolution.kind) {
        case 'value':
            return resolution.isStale ? `${resolution.text} (outdated)` : resolution.text;
        case 'null':
            return resolution.isStale ? 'NULL (outdated)' : 'NULL';
        case 'notRun':
            return `[${resolution.targetLabel}: not run]`;
        case 'loading':
            return `[${resolution.targetLabel}: running…]`;
        case 'error':
            return `[${resolution.targetLabel}: error]`;
        case 'noRows':
            return `[${resolution.targetLabel}: no rows]`;
        case 'multipleRows':
            return `[${resolution.targetLabel}: ${resolution.rowCount} rows (expected 1)]`;
        case 'missingColumn':
            return `[${resolution.targetLabel}: missing column "${resolution.column}"]`;
        case 'ambiguousColumn':
            return `[${resolution.targetLabel}: ambiguous column "${resolution.column}"]`;
        case 'missingCell':
            return `[${resolution.targetLabel}: not found]`;
        case 'ambiguousCell':
            return `[${resolution.targetLabel}: ambiguous cell name]`;
        case 'notSqlCell':
            return `[${resolution.targetLabel}: not a SQL cell]`;
        case 'invalid':
            return `[invalid reference: ${resolution.raw}]`;
    }
}

function formatReferenceToken(token: string): string {
    if (/[\s."'`}]/u.test(token)) {
        return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return token;
}

export function buildScalarSuggestions(cells: NotebookCell[]): ScalarSuggestion[] {
    const suggestions: ScalarSuggestion[] = [];
    const nameCounts = new Map<string, number>();

    for (const cell of cells) {
        const trimmedName = cell.name?.trim();
        if (trimmedName) {
            nameCounts.set(trimmedName, (nameCounts.get(trimmedName) ?? 0) + 1);
        }
    }

    cells.forEach((cell, index) => {
        if (cell.type !== 'sql') return;

        const positionalTarget = `cell_${index + 1}`;
        const trimmedName = cell.name?.trim();
        const hasUniqueAlias =
            Boolean(trimmedName) &&
            nameCounts.get(trimmedName!) === 1 &&
            !/^cell_\d+$/.test(trimmedName!);

        const columns = cell.result?.columns ?? [];
        const uniqueColumns = Array.from(new Set(columns));

        const getColumnPreview = (col: string): string | undefined => {
            if (!cell.result || cell.result.rows.length !== 1) return undefined;
            const colMatch = findColumnIndex(cell.result.columns, col);
            if (colMatch.kind !== 'found') return undefined;
            const rawVal = cell.result.rows[0][colMatch.index];
            if (rawVal === null || rawVal === undefined) return 'NULL';
            const text = scalarValueToString(rawVal);
            return text.length > 36 ? `${text.slice(0, 33)}...` : text;
        };

        if (uniqueColumns.length > 0) {
            for (const col of uniqueColumns) {
                const formattedCol = formatReferenceToken(col);
                const preview = getColumnPreview(col);
                suggestions.push({
                    insertText: `{{value:${positionalTarget}.${formattedCol}}}`,
                    label: `${positionalTarget}.${formattedCol}`,
                    cellName: trimmedName || undefined,
                    preview,
                });

                if (hasUniqueAlias && trimmedName) {
                    const formattedAlias = formatReferenceToken(trimmedName);
                    suggestions.push({
                        insertText: `{{value:${formattedAlias}.${formattedCol}}}`,
                        label: `${formattedAlias}.${formattedCol}`,
                        cellName: `Cell ${index + 1}`,
                        preview,
                        isAlias: true,
                    });
                }
            }
        } else {
            suggestions.push({
                insertText: `{{value:${positionalTarget}.`,
                label: `${positionalTarget}.<column>`,
                cellName: trimmedName || undefined,
            });

            if (hasUniqueAlias && trimmedName) {
                const formattedAlias = formatReferenceToken(trimmedName);
                suggestions.push({
                    insertText: `{{value:${formattedAlias}.`,
                    label: `${formattedAlias}.<column>`,
                    cellName: `Cell ${index + 1}`,
                    isAlias: true,
                });
            }
        }
    });

    return suggestions;
}
