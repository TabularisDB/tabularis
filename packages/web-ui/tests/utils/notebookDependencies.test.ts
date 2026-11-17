import {describe, expect, it} from 'vitest';
import {inspectCellDependencies} from '@/utils/notebookDependencies';
import {reorderCells} from '@/utils/notebookDnd';
import type {NotebookCell, NotebookParam} from '@/types/notebook';

function sql(id: string, content: string, extra: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...extra};
}

function markdown(id: string, content = '# Notes'): NotebookCell {
    return {id, type: 'markdown', content};
}

describe('inspectCellDependencies', () => {
    it('returns null for an unknown or Markdown cell', () => {
        const cells = [markdown('m'), sql('a', 'SELECT 1')];
        expect(inspectCellDependencies(cells, 'nope')).toBeNull();
        expect(inspectCellDependencies(cells, 'm')).toBeNull();
    });

    it('lists direct uses, used-by and identities with names and positions', () => {
        const cells = [
            sql('sales', 'SELECT * FROM orders', {name: 'Sales'}),
            sql('summary', 'SELECT sum(total) FROM {{cell_1}}', {name: 'Revenue summary'}),
            sql('chart', 'SELECT * FROM {{cell_2}}'),
        ];
        const summary = inspectCellDependencies(cells, 'summary')!;
        expect(summary.cell).toEqual({cellId: 'summary', cellIndex: 1, name: 'Revenue summary'});
        expect(summary.uses).toEqual([
            {
                kind: 'cell',
                target: {cellId: 'sales', cellIndex: 0, name: 'Sales'},
                disabled: false,
                occurrences: 1,
            },
        ]);
        expect(summary.usedBy).toEqual([{cellId: 'chart', cellIndex: 2}]);
        expect(summary.cycle).toBeNull();
    });

    it('only reports direct dependencies, not transitive ones', () => {
        const cells = [
            sql('a', 'SELECT 1'),
            sql('b', 'SELECT * FROM {{cell_1}}'),
            sql('c', 'SELECT * FROM {{cell_2}}'),
        ];
        const a = inspectCellDependencies(cells, 'a')!;
        expect(a.usedBy.map((c) => c.cellId)).toEqual(['b']);
        const c = inspectCellDependencies(cells, 'c')!;
        expect(c.uses).toHaveLength(1);
    });

    it('collapses repeated references and counts them', () => {
        const cells = [
            sql('a', 'SELECT 1'),
            sql(
                'b',
                'SELECT * FROM {{cell_1}} x JOIN {{cell_1}} y ON x.id = y.id WHERE @id > 0 AND @id < 9',
            ),
        ];
        const b = inspectCellDependencies(cells, 'b', [{name: 'id', value: '1'}])!;
        expect(b.uses).toHaveLength(1);
        expect(b.uses[0].occurrences).toBe(2);
        expect(b.params).toEqual([{name: 'id', defined: true, occurrences: 2}]);
        expect(inspectCellDependencies(cells, 'a')!.usedBy).toEqual([{cellId: 'b', cellIndex: 1}]);
    });

    it('accepts forward references to later SQL cells', () => {
        const cells = [sql('a', 'SELECT * FROM {{cell_2}}'), sql('b', 'SELECT 1')];
        const a = inspectCellDependencies(cells, 'a')!;
        expect(a.uses[0]).toMatchObject({kind: 'cell', target: {cellId: 'b', cellIndex: 1}});
        expect(inspectCellDependencies(cells, 'b')!.usedBy).toEqual([{cellId: 'a', cellIndex: 0}]);
    });

    it('marks missing, Markdown and self targets instead of listing them as valid', () => {
        const cells = [markdown('m'), sql('a', 'SELECT * FROM {{cell_1}}, {{cell_2}}, {{cell_9}}')];
        const a = inspectCellDependencies(cells, 'a')!;
        expect(a.uses).toEqual([
            {
                kind: 'invalid',
                target: {cellId: 'm', cellIndex: 0},
                reason: 'markdown',
                occurrences: 1,
            },
            {kind: 'invalid', target: {cellId: 'a', cellIndex: 1}, reason: 'self', occurrences: 1},
            {kind: 'missing', position: 9, occurrences: 1},
        ]);
        // A self-reference is not reported as a cycle or as its own consumer.
        expect(a.cycle).toBeNull();
        expect(a.usedBy).toEqual([]);
    });

    it('reports a deleted target as missing', () => {
        const before = [sql('a', 'SELECT 1'), sql('b', 'SELECT * FROM {{cell_2}}')];
        const after = before
            .filter((c) => c.id !== 'b')
            .concat(sql('c', 'SELECT * FROM {{cell_3}}'));
        expect(inspectCellDependencies(after, 'c')!.uses).toEqual([
            {kind: 'missing', position: 3, occurrences: 1},
        ]);
    });

    it('follows positions after reordering', () => {
        const cells = [
            sql('a', 'SELECT 1', {name: 'A'}),
            sql('b', 'SELECT 2', {name: 'B'}),
            sql('c', 'SELECT * FROM {{cell_1}}'),
        ];
        expect(inspectCellDependencies(cells, 'c')!.uses[0]).toMatchObject({target: {cellId: 'a'}});
        const reordered = reorderCells(cells, 0, 1);
        // `{{cell_1}}` is positional, so it now points at B.
        expect(inspectCellDependencies(reordered, 'c')!.uses[0]).toMatchObject({
            target: {cellId: 'b', cellIndex: 0, name: 'B'},
        });
        expect(inspectCellDependencies(reordered, 'a')!.usedBy).toEqual([]);
    });

    it('reflects renames and disabled targets', () => {
        const cells = [
            sql('a', 'SELECT 1', {name: 'Old', isDisabled: true}),
            sql('b', 'SELECT * FROM {{cell_1}}'),
        ];
        expect(inspectCellDependencies(cells, 'b')!.uses[0]).toMatchObject({
            target: {name: 'Old'},
            disabled: true,
        });
        const renamed = [{...cells[0], name: 'New'}, cells[1]];
        expect(inspectCellDependencies(renamed, 'b')!.uses[0]).toMatchObject({
            target: {name: 'New'},
        });
    });

    it('marks parameters the notebook does not define, and follows parameter changes', () => {
        const cells = [sql('a', 'SELECT * FROM t WHERE d >= @start_date AND r = ${region}')];
        const params: NotebookParam[] = [{name: 'start_date', value: '2026-01-01'}];
        expect(inspectCellDependencies(cells, 'a', params)!.params).toEqual([
            {name: 'start_date', defined: true, occurrences: 1},
            {name: 'region', defined: false, occurrences: 1},
        ]);
        const changed = [...params, {name: 'region', value: 'EU'}];
        expect(inspectCellDependencies(cells, 'a', changed)!.params.every((p) => p.defined)).toBe(
            true,
        );
    });

    it('detects a cycle through the selected cell', () => {
        const cells = [
            sql('a', 'SELECT * FROM {{cell_2}}', {name: 'A'}),
            sql('b', 'SELECT * FROM {{cell_1}}'),
        ];
        expect(inspectCellDependencies(cells, 'a')!.cycle?.map((c) => c.cellId)).toEqual([
            'a',
            'b',
            'a',
        ]);
    });

    it('detects a cycle further up the chain', () => {
        const cells = [
            sql('a', 'SELECT * FROM {{cell_2}}'),
            sql('b', 'SELECT * FROM {{cell_3}}'),
            sql('c', 'SELECT * FROM {{cell_2}}'),
        ];
        expect(inspectCellDependencies(cells, 'a')!.cycle?.map((c) => c.cellId)).toEqual([
            'b',
            'c',
            'b',
        ]);
        // A consumer outside the cycle does not see one in an unrelated cell.
        expect(inspectCellDependencies([sql('x', 'SELECT 1'), ...cells], 'x')!.cycle).toBeNull();
    });

    it('does not report a diamond as a cycle', () => {
        const cells = [
            sql('a', 'SELECT 1'),
            sql('b', 'SELECT * FROM {{cell_1}}'),
            sql('c', 'SELECT * FROM {{cell_1}}'),
            sql('d', 'SELECT * FROM {{cell_2}}, {{cell_3}}'),
        ];
        expect(inspectCellDependencies(cells, 'd')!.cycle).toBeNull();
    });
});
