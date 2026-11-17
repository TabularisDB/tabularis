import {describe, expect, it} from 'vitest';
import type {TableTransferColumnPlan, TableTransferPlan, TableTransferResult} from '@/api/contract';
import {
    TABLE_TRANSFER_ISSUE_CODES,
    buildTransferRequest,
    canTransferFrom,
    isPlanBlocked,
    isTransferPair,
    issueMessageKey,
    mappingsFromPlan,
    progressPercent,
    summarizeResult,
    withMapping,
} from '@/utils/tableRowTransfer';
import en from '@/i18n/locales/en.json';

const pairs = [
    {source: 'postgres', target: 'postgres'},
    {source: 'postgres', target: 'sqlite'},
];

const column = (overrides: Partial<TableTransferColumnPlan>): TableTransferColumnPlan => ({
    sourceColumn: 'id',
    sourceType: 'integer',
    targetColumn: 'id',
    targetType: 'INTEGER',
    rule: 'exact',
    skipped: false,
    issue: null,
    ...overrides,
});

const plan = (overrides: Partial<TableTransferPlan> = {}): TableTransferPlan => ({
    tables: [
        {
            sourceTable: 'customers',
            targetTable: 'customers',
            columns: [column({})],
            issues: [],
            blocking: false,
            estimatedRows: 10,
        },
    ],
    issues: [],
    blocking: false,
    ...overrides,
});

describe('capability matrix helpers', () => {
    it('reads supported pairs from the backend matrix, never from driver names', () => {
        expect(canTransferFrom(pairs, 'postgres')).toBe(true);
        expect(canTransferFrom(pairs, 'sqlite')).toBe(false);
        expect(canTransferFrom(pairs, 'my-plugin')).toBe(false);
        expect(isTransferPair(pairs, 'postgres', 'sqlite')).toBe(true);
        expect(isTransferPair(pairs, 'sqlite', 'postgres')).toBe(false);
        expect(isTransferPair([], 'postgres', 'postgres')).toBe(false);
    });
});

describe('buildTransferRequest', () => {
    it('omits empty optionals and sends explicit mappings only when present', () => {
        const request = buildTransferRequest({
            sourceConnectionId: 'a',
            sourceSchema: 'public',
            targetConnectionId: 'b',
            sourceTable: 'customers',
            targetTable: 'customers',
            columns: [],
        });
        expect(request).toEqual({
            sourceConnectionId: 'a',
            sourceSchema: 'public',
            targetConnectionId: 'b',
            tables: [{sourceTable: 'customers', targetTable: 'customers'}],
        });
    });

    it('carries mapping, conflict mode and transfer id', () => {
        const request = buildTransferRequest({
            sourceConnectionId: 'a',
            sourceDatabase: 'app',
            targetConnectionId: 'b',
            targetDatabase: 'copy',
            targetSchema: 'staging',
            sourceTable: 's',
            targetTable: 't',
            columns: [{sourceColumn: 'x', targetColumn: null}],
            conflict: 'skip',
            transferId: 'job-1',
        });
        expect(request.conflict).toBe('skip');
        expect(request.transferId).toBe('job-1');
        expect(request.targetDatabase).toBe('copy');
        expect(request.tables[0].columns).toEqual([{sourceColumn: 'x', targetColumn: null}]);
    });
});

describe('column mapping edits', () => {
    it('pins resolved mappings and keeps explicit skips', () => {
        const mappings = mappingsFromPlan([
            column({}),
            column({sourceColumn: 'note', targetColumn: null, skipped: true, rule: null}),
            column({
                sourceColumn: 'ghost',
                targetColumn: null,
                issue: 'noTargetColumn',
                rule: null,
            }),
        ]);
        expect(mappings).toEqual([
            {sourceColumn: 'id', targetColumn: 'id'},
            {sourceColumn: 'note', targetColumn: null},
        ]);
    });

    it('replaces the mapping of one source column', () => {
        const next = withMapping(
            [
                {sourceColumn: 'a', targetColumn: 'x'},
                {sourceColumn: 'b', targetColumn: 'y'},
            ],
            'a',
            null,
        );
        expect(next).toContainEqual({sourceColumn: 'a', targetColumn: null});
        expect(next).toContainEqual({sourceColumn: 'b', targetColumn: 'y'});
        expect(next).toHaveLength(2);
    });
});

describe('isPlanBlocked', () => {
    it('blocks without a plan and on any blocking issue', () => {
        expect(isPlanBlocked(null)).toBe(true);
        expect(isPlanBlocked(plan())).toBe(false);
        expect(isPlanBlocked(plan({blocking: true}))).toBe(true);
        expect(isPlanBlocked(plan({issues: [{code: 'targetReadOnly'}]}))).toBe(true);
        const table = plan().tables[0];
        expect(isPlanBlocked(plan({tables: [{...table, blocking: true}]}))).toBe(true);
    });
});

describe('summarizeResult', () => {
    const result = (
        status: TableTransferResult['status'],
        rowsWritten: number,
    ): TableTransferResult => ({
        transferId: 't',
        status,
        tables: [
            {
                sourceTable: 's',
                targetTable: 't',
                status,
                rowsRead: rowsWritten + 5,
                rowsWritten,
                rowsSkipped: 2,
                rowsFailed: 5,
                error: null,
            },
        ],
    });

    it('reports committed work that remains after an unfinished transfer', () => {
        expect(summarizeResult(result('cancelled', 500)).leavesCommittedRows).toBe(true);
        expect(summarizeResult(result('failed', 0)).leavesCommittedRows).toBe(false);
        expect(summarizeResult(result('completed', 500)).leavesCommittedRows).toBe(false);
        expect(summarizeResult(result('failed', 1000))).toMatchObject({
            rowsWritten: 1000,
            rowsSkipped: 2,
            rowsFailed: 5,
        });
    });
});

describe('progressPercent', () => {
    it('needs an estimate and never reaches 100 before completion', () => {
        expect(progressPercent(10, null)).toBeNull();
        expect(progressPercent(10, 0)).toBeNull();
        expect(progressPercent(50, 200)).toBe(25);
        expect(progressPercent(500, 200)).toBe(99);
    });
});

describe('issue messages', () => {
    it('has an English string for every backend issue code', () => {
        const issues = en.tableRowTransfer.issue as Record<string, string>;
        for (const code of TABLE_TRANSFER_ISSUE_CODES) {
            expect(issues[code], code).toBeTruthy();
            expect(issueMessageKey(code)).toBe(`tableRowTransfer.issue.${code}`);
        }
        expect(issueMessageKey('somethingNew')).toBe('tableRowTransfer.issue.unknown');
    });
});
