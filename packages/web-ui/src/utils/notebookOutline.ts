import type {NotebookCell} from '@/types/notebook';
import {findDisabledPrerequisites} from './notebookRunAll';

export type SqlCellExecutionStatus =
    'idle' | 'running' | 'disabled' | 'blocked' | 'failed' | 'has_output';

export interface OutlineEntry {
    level: number;
    text: string;
    cellId: string;
    cellIndex: number;
    cellType: 'sql' | 'markdown';
    status?: SqlCellExecutionStatus;
}

const HEADING_REGEX = /^(#{1,3})\s+(.+)$/;

/**
 * Derive runtime execution status for a SQL cell in outline.
 * Precedence:
 * 1. running when isLoading is true
 * 2. disabled when the cell itself is disabled
 * 3. blocked when a prerequisite it needs (pass `cells`) is disabled
 * 4. failed when error is present
 * 5. has_output when result is non-null
 * 6. idle otherwise
 */
export function getSqlCellExecutionStatus(
    cell: Pick<NotebookCell, 'isLoading' | 'error' | 'result' | 'isDisabled'> &
        Partial<Pick<NotebookCell, 'content'>>,
    cells?: NotebookCell[],
): SqlCellExecutionStatus {
    if (cell.isLoading) {
        return 'running';
    }
    if (cell.isDisabled) {
        return 'disabled';
    }
    if (cells && cell.content && findDisabledPrerequisites(cell.content, cells).length > 0) {
        return 'blocked';
    }
    if (cell.error) {
        return 'failed';
    }
    if (cell.result !== null && cell.result !== undefined) {
        return 'has_output';
    }
    return 'idle';
}

/** Return cells that have content but no name (candidates for AI naming). */
export function getUnnamedCellsWithContent(cells: NotebookCell[]): NotebookCell[] {
    return cells.filter((c) => !c.name && c.content.trim());
}

/** Extract outline entries from all cells for TOC rendering. */
export function extractOutline(cells: NotebookCell[]): OutlineEntry[] {
    const entries: OutlineEntry[] = [];

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];

        if (cell.type === 'sql') {
            entries.push({
                level: 1,
                text: cell.name || `SQL #${i + 1}`,
                cellId: cell.id,
                cellIndex: i,
                cellType: 'sql',
                status: getSqlCellExecutionStatus(cell, cells),
            });
            continue;
        }

        // Markdown cell: use name if set, otherwise extract headings
        if (cell.type === 'markdown') {
            if (cell.name) {
                entries.push({
                    level: 1,
                    text: cell.name,
                    cellId: cell.id,
                    cellIndex: i,
                    cellType: 'markdown',
                });
                continue;
            }

            if (!cell.content.trim()) {
                entries.push({
                    level: 1,
                    text: `MD #${i + 1}`,
                    cellId: cell.id,
                    cellIndex: i,
                    cellType: 'markdown',
                });
                continue;
            }

            const lines = cell.content.split('\n');
            let hasHeading = false;
            for (const line of lines) {
                const match = line.match(HEADING_REGEX);
                if (match) {
                    hasHeading = true;
                    entries.push({
                        level: match[1].length,
                        text: match[2].trim(),
                        cellId: cell.id,
                        cellIndex: i,
                        cellType: 'markdown',
                    });
                }
            }

            // If markdown cell has content but no headings, show fallback
            if (!hasHeading) {
                entries.push({
                    level: 1,
                    text: `MD #${i + 1}`,
                    cellId: cell.id,
                    cellIndex: i,
                    cellType: 'markdown',
                });
            }
        }
    }

    return entries;
}

/** Filter outline entries case-insensitively by their displayed text, trimming the search query. */
export function filterOutlineEntries(entries: OutlineEntry[], query: string): OutlineEntry[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
        return entries;
    }
    return entries.filter((entry) => entry.text.toLowerCase().includes(trimmed));
}
