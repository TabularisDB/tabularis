import type {NotebookCell, NotebookCellType, NotebookState} from '@/types/notebook';

export function generateCellId(): string {
    return `cell_${Math.random().toString(36).substring(2, 9)}`;
}

export function createEmptyCell(type: NotebookCellType): NotebookCell {
    return {
        id: generateCellId(),
        type,
        content: '',
        result: null,
        error: undefined,
        executionTime: null,
        isLoading: false,
        isPreview: type === 'markdown' ? false : undefined,
    };
}

export function createDefaultNotebookState(): NotebookState {
    return {
        cells: [createEmptyCell('sql')],
    };
}

export function updateCellInCells(
    cells: NotebookCell[],
    cellId: string,
    partial: Partial<NotebookCell>,
): NotebookCell[] {
    return cells.map((c) => (c.id === cellId ? {...c, ...partial} : c));
}

export function addCellToCells(
    cells: NotebookCell[],
    type: NotebookCellType,
    afterIndex?: number,
): NotebookCell[] {
    const newCell = createEmptyCell(type);
    const result = [...cells];
    const insertAt = afterIndex !== undefined ? afterIndex + 1 : result.length;
    result.splice(insertAt, 0, newCell);
    return result;
}

/**
 * A document-only copy of `cell` with a fresh id: same type, content, name,
 * schema and display/chart configuration, but no result, error, execution
 * time, loading state or execution history. Markdown copies start in edit
 * mode and every copy starts expanded. The query plan starts closed: an open
 * plan fetches EXPLAIN as soon as it mounts, and duplicating must not run
 * anything against the database. Nothing is shared with the original.
 */
export function duplicateCell(cell: NotebookCell): NotebookCell {
    const {chartConfig} = cell;
    return {
        ...cell,
        id: generateCellId(),
        chartConfig: chartConfig
            ? {...chartConfig, valueColumns: [...chartConfig.valueColumns]}
            : chartConfig,
        result: null,
        error: undefined,
        executionTime: null,
        isLoading: false,
        history: undefined,
        isCollapsed: false,
        isQueryPlanVisible: false,
        isPreview: cell.type === 'markdown' ? false : cell.isPreview,
    };
}

/**
 * Append a copy of the cell `cellId` (see {@link duplicateCell}) after the last
 * cell. Existing cells keep their positions, so position-based `{{cell_N}}`
 * references are unaffected. Returns `cells` unchanged when the id is unknown.
 */
export function duplicateCellToEnd(cells: NotebookCell[], cellId: string): NotebookCell[] {
    const source = cells.find((c) => c.id === cellId);
    if (!source) return cells;
    const copy = duplicateCell(source);
    while (cells.some((c) => c.id === copy.id)) copy.id = generateCellId();
    return [...cells, copy];
}

export function removeCellFromCells(cells: NotebookCell[], cellId: string): NotebookCell[] {
    return cells.filter((c) => c.id !== cellId);
}

/** Whether an SQL cell currently displays a result, an error or an execution time. */
function hasCellOutput(cell: NotebookCell): boolean {
    return cell.type === 'sql' && (!!cell.result || !!cell.error || cell.executionTime != null);
}

export function hasCellOutputs(cells: NotebookCell[]): boolean {
    return cells.some(hasCellOutput);
}

/**
 * Drop the live output (result, error, execution time) of every SQL cell.
 * Everything else is kept, including content, parameters, chart configuration
 * and the per-cell execution history. Cells without output are returned as is.
 */
export function clearCellOutputs(cells: NotebookCell[]): NotebookCell[] {
    return cells.map((cell) =>
        hasCellOutput(cell) ? {...cell, result: null, error: undefined, executionTime: null} : cell,
    );
}

export function moveCellInCells(
    cells: NotebookCell[],
    cellId: string,
    direction: -1 | 1,
): NotebookCell[] {
    const idx = cells.findIndex((c) => c.id === cellId);
    if (idx === -1) return cells;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= cells.length) return cells;
    const result = [...cells];
    [result[idx], result[newIdx]] = [result[newIdx], result[idx]];
    return result;
}

export function extractSqlFromCells(cells: NotebookCell[]): string {
    return cells
        .filter((c) => c.type === 'sql' && c.content.trim())
        .map((c) => c.content.trim())
        .join('\n\n');
}
