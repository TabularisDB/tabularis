import {describe, expect, it} from 'vitest';
import type {NotebookCell, NotebookParam} from '@/types/notebook';
import {buildNotebookExecutionPlan, type NotebookRunRequest} from '@/utils/notebookExecutionPlan';
import {resolveParams} from '@/utils/notebookParams';

const result = {columns: ['n'], rows: [[1]], affected_rows: 0};
const sql = (id: string, content = 'SELECT 1', extra?: Partial<NotebookCell>): NotebookCell => ({
    id,
    type: 'sql',
    content,
    ...extra,
});

function build(
    cells: NotebookCell[],
    request: NotebookRunRequest = {mode: 'all'},
    params: NotebookParam[] = [],
) {
    return buildNotebookExecutionPlan({
        cells,
        request,
        prepare: (text) => resolveParams(text, params),
        canReuse: () => true,
    });
}

describe('buildNotebookExecutionPlan', () => {
    it('deduplicates a diamond (including repeated references) for a single cell', () => {
        const planned = build(
            [
                sql('a'),
                sql('b', 'SELECT * FROM {{cell_1}}'),
                sql('c', 'SELECT * FROM {{cell_1}}'),
                sql('d', 'SELECT * FROM {{cell_2}} JOIN {{cell_3}} ON 1=1 JOIN {{cell_2}} ON 1=1'),
            ],
            {mode: 'cell', cellId: 'd'},
        );
        expect(planned.kind).toBe('ready');
        if (planned.kind !== 'ready') return;
        expect(planned.plan.steps.map(({cell}) => cell.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(planned.plan.steps[3].prerequisites).toEqual([1, 2]);
    });

    it('runs the selected source, its downstream branch and only missing, failed or outdated inputs', () => {
        const cells = [
            sql('source', 'SELECT 1', {result}),
            sql('branch', 'SELECT * FROM @source JOIN {{cell_4}} ON 1=1', {result}),
            sql('end', 'SELECT * FROM {{cell_2}} JOIN {{cell_5}} ON 1=1 JOIN {{cell_7}} ON 1=1'),
            sql('failed', 'SELECT 4', {result, error: 'failed'}),
            sql('cached', 'SELECT 5', {result}),
            sql('unrelated'),
            sql('outdated', 'SELECT 7', {result}),
        ];
        const planned = buildNotebookExecutionPlan({
            cells,
            request: {mode: 'affected', cellId: 'source'},
            prepare: (text) => resolveParams(text, [{name: 'source', value: '{{cell_1}}'}]),
            canReuse: ({cell}) => cell.id !== 'outdated',
        });
        expect(planned.kind === 'ready' && planned.plan.steps.map(({cell}) => cell.id)).toEqual([
            'source',
            'failed',
            'branch',
            'outdated',
            'end',
        ]);
    });

    it('refreshes a cached intermediate when its own prerequisite must run', () => {
        const planned = build(
            [
                sql('source'),
                sql('cached', 'SELECT * FROM {{cell_1}}', {result}),
                sql('target', 'SELECT * FROM {{cell_2}}'),
            ],
            {mode: 'cell', cellId: 'target'},
        );
        expect(planned.kind === 'ready' && planned.plan.steps.map(({cell}) => cell.id)).toEqual([
            'source',
            'cached',
            'target',
        ]);
    });

    it('handles a forward reference and preserves order among ready independent cells', () => {
        const planned = build([
            sql('use', 'SELECT * FROM {{cell_3}}'),
            sql('independent'),
            sql('source'),
            sql('last'),
        ]);
        expect(planned.kind === 'ready' && planned.plan.steps.map(({cell}) => cell.id)).toEqual([
            'independent',
            'source',
            'use',
            'last',
        ]);
    });

    it.each([
        ['self', ['{{cell_1}}'], {kind: 'self', index: 0}],
        ['2-cell cycle', ['{{cell_2}}', '{{cell_1}}'], {kind: 'cycle', path: [0, 1, 0]}],
        [
            '3-cell cycle',
            ['{{cell_2}}', '{{cell_3}}', '{{cell_1}}'],
            {kind: 'cycle', path: [0, 1, 2, 0]},
        ],
        ['out of bounds', ['{{cell_12}}'], {kind: 'missing', index: 0, reference: '{{cell_12}}'}],
        ['index zero', ['{{cell_0}}'], {kind: 'missing', index: 0, reference: '{{cell_0}}'}],
    ])('reports %s before scheduling, even if prerequisites have results', (_name, refs, issue) => {
        const cells = refs.map((ref, i) => sql(String(i), `SELECT * FROM ${ref}`, {result}));
        expect(build(cells, {mode: 'cell', cellId: '0'})).toEqual({
            kind: 'invalid',
            targetCount: 1,
            issues: [issue],
        });
    });

    it('caps cycle paths while continuing to diagnose other invalid references', () => {
        const cells = Array.from({length: 200}, (_, i) =>
            sql(String(i), `SELECT * FROM {{cell_${i + 2}}}`),
        );
        cells[cells.length - 1].content = `SELECT * FROM ${cells
            .slice(0, -1)
            .map((_, i) => `{{cell_${i + 1}}}`)
            .join(' JOIN ')} JOIN {{cell_999}}`;
        const planned = build(cells, {mode: 'cell', cellId: '0'});

        expect(planned.kind).toBe('invalid');
        if (planned.kind !== 'invalid') return;
        const cycles = planned.issues.filter(({kind}) => kind === 'cycle');
        expect(cycles).toHaveLength(20);
        expect(cycles[0].path).toEqual([...cells.map((_, i) => i), 0]);
        expect(planned.issues.at(-1)).toEqual({
            kind: 'missing',
            index: 199,
            reference: '{{cell_999}}',
        });
    });

    it('reports a Markdown target, an empty SQL target and a disabled prerequisite together', () => {
        const cells = [
            sql('use', 'SELECT * FROM {{cell_2}} JOIN {{cell_3}} JOIN {{cell_4}}'),
            {id: 'notes', type: 'markdown' as const, content: '# Notes'},
            sql('blank', ' \n '),
            sql('off', 'SELECT 4', {isDisabled: true, result}),
        ];
        expect(build(cells)).toEqual({
            kind: 'invalid',
            targetCount: 2,
            issues: [
                {kind: 'missing', index: 0, reference: '{{cell_2}}'},
                {kind: 'missing', index: 0, reference: '{{cell_3}}'},
                {kind: 'disabled', index: 0, reference: '{{cell_4}}'},
            ],
        });
    });

    it('does not preflight a malformed unrelated branch for an affected run', () => {
        const planned = build(
            [
                sql('selected'),
                sql('unrelated', '{{cell_9}}'),
                sql('off', 'SELECT 3', {isDisabled: true}),
            ],
            {mode: 'affected', cellId: 'selected'},
        );
        expect(planned.kind === 'ready' && planned.plan.steps.map(({cell}) => cell.id)).toEqual([
            'selected',
        ]);
    });

    it('checks downstream consumers behind a disabled intermediate', () => {
        const cells = [
            sql('source'),
            sql('off', 'SELECT * FROM {{cell_1}}', {isDisabled: true}),
            sql('use', 'SELECT * FROM {{cell_2}}'),
        ];
        expect(build(cells, {mode: 'affected', cellId: 'source'})).toMatchObject({
            kind: 'invalid',
            issues: [{kind: 'disabled', index: 2, reference: '{{cell_2}}'}],
        });
    });

    it('does not schedule disabled, blank or Markdown cells individually', () => {
        const cells = [
            sql('off', 'SELECT 1', {isDisabled: true}),
            sql('blank', ''),
            {id: 'notes', type: 'markdown' as const, content: '# Notes'},
        ];
        for (const cellId of ['off', 'blank', 'notes', 'missing']) {
            expect(build(cells, {mode: 'cell', cellId})).toMatchObject({
                kind: 'ready',
                plan: {steps: [], skipped: 0},
            });
        }
        expect(build(cells)).toMatchObject({kind: 'ready', plan: {steps: [], skipped: 1}});
    });
});
