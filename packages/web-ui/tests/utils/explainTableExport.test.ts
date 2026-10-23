import {describe, expect, it, vi, beforeEach} from 'vitest';
import type {ExplainNode, ExplainPlan} from '@tabularis/explain';
import {
    formatExplainTableCsv,
    saveExplainTableCsv,
    EXPLAIN_TABLE_CSV_HEADERS,
} from '@/utils/explainTableExport';
import type {PlatformCapabilities} from '@/platform/capabilities';

function makeNode(overrides: Partial<ExplainNode> = {}): ExplainNode {
    return {
        id: 'node_0',
        node_type: 'Seq Scan',
        relation: null,
        startup_cost: null,
        total_cost: null,
        plan_rows: null,
        actual_rows: null,
        actual_time_ms: null,
        actual_loops: null,
        buffers_hit: null,
        buffers_read: null,
        filter: null,
        index_condition: null,
        join_type: null,
        hash_condition: null,
        extra: {},
        children: [],
        ...overrides,
    };
}

function makePlan(overrides: Partial<ExplainPlan> = {}): ExplainPlan {
    return {
        root: makeNode({}),
        planning_time_ms: null,
        execution_time_ms: null,
        original_query: 'SELECT 1',
        driver: 'postgres',
        has_analyze_data: false,
        raw_output: null,
        ...overrides,
    };
}

describe('explainTableExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('formatExplainTableCsv', () => {
        const HEADER =
            'index,depth,node_type,relation,startup_cost,total_cost,est_rows,actual_rows,self_time_ms,estimate_gap,filter';

        /** Records of a CSV whose fields contain no line breaks. */
        function records(csv: string): string[] {
            expect(csv.endsWith('\r\n')).toBe(true);
            return csv.slice(0, -2).split('\r\n');
        }

        it('exports header with separate numeric cost columns and depth field', () => {
            const plan = makePlan({
                root: makeNode({id: 'root', node_type: 'Result'}),
            });

            const lines = records(formatExplainTableCsv(plan));

            expect(lines[0]).toBe(HEADER);
            expect(EXPLAIN_TABLE_CSV_HEADERS).toHaveLength(11);
            expect(EXPLAIN_TABLE_CSV_HEADERS).not.toContain('cost');
        });

        it('ends every record, the last one included, with CRLF', () => {
            const child = makeNode({id: 'child', node_type: 'Seq Scan'});
            const plan = makePlan({
                root: makeNode({id: 'root', node_type: 'Limit', children: [child]}),
            });

            const csv = formatExplainTableCsv(plan);

            expect(csv).toBe(`${HEADER}\r\n1,0,Limit,,,,,,,,\r\n2,1,Seq Scan,,,,,,,,\r\n`);
            // No bare LF outside the CRLF pairs.
            expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
        });

        it('preserves tree pre-order and depth across collapsed and nested branches', () => {
            // Simulate a tree where child and grandchild exist.
            // Even if UI collapses them, formatExplainTableCsv must include every node in pre-order.
            const grandchild = makeNode({
                id: 'grandchild',
                node_type: 'Index Scan',
                relation: 'users_pkey',
                total_cost: 8.5,
                plan_rows: 1,
            });
            const child = makeNode({
                id: 'child',
                node_type: 'Nested Loop',
                total_cost: 50.0,
                plan_rows: 10,
                children: [grandchild],
            });
            const root = makeNode({
                id: 'root',
                node_type: 'Limit',
                total_cost: 60.0,
                plan_rows: 5,
                children: [child],
            });
            const plan = makePlan({root});

            const lines = records(formatExplainTableCsv(plan));

            expect(lines).toHaveLength(4); // 1 header + 3 nodes
            // Root (depth 0)
            expect(lines[1]).toBe('1,0,Limit,,,60,5,,,,');
            // Child (depth 1)
            expect(lines[2]).toBe('2,1,Nested Loop,,,50,10,,,,');
            // Grandchild (depth 2)
            expect(lines[3]).toBe('3,2,Index Scan,users_pkey,,8.5,1,,,,');
        });

        it('leaves unavailable metrics empty rather than converting them to zero for estimates-only plans', () => {
            const root = makeNode({
                id: 'root',
                node_type: 'Seq Scan',
                relation: 'orders',
                startup_cost: 0.0,
                total_cost: 150.25,
                plan_rows: 1200,
                actual_rows: null,
                actual_time_ms: null,
                filter: null,
            });
            const plan = makePlan({root, has_analyze_data: false});

            const rows = records(formatExplainTableCsv(plan));

            expect(rows[1]).toBe('1,0,Seq Scan,orders,0,150.25,1200,,,,');
            const cols = rows[1].split(',');
            expect(cols).toHaveLength(11);
            // A real startup cost of 0 is kept as 0.
            expect(cols[4]).toBe('0');
            // actual_rows is index 7, self_time_ms is index 8, estimate_gap is index 9
            expect(cols[7]).toBe(''); // NOT "0"
            expect(cols[8]).toBe(''); // NOT "0"
            expect(cols[9]).toBe(''); // NOT "0"
        });

        it('leaves both cost columns empty when the driver reports no cost', () => {
            const root = makeNode({
                id: 'root',
                node_type: 'SCAN users',
                startup_cost: null,
                total_cost: null,
                plan_rows: null,
            });
            const plan = makePlan({root, driver: 'sqlite'});

            const cols = records(formatExplainTableCsv(plan))[1].split(',');

            expect(cols[4]).toBe(''); // startup_cost
            expect(cols[5]).toBe(''); // total_cost
            expect(cols[6]).toBe(''); // est_rows
        });

        it('fills total_cost alone when there is no startup cost', () => {
            const root = makeNode({
                id: 'root',
                node_type: 'Table scan',
                relation: 'users',
                startup_cost: null,
                total_cost: 12.75,
                plan_rows: 40,
            });
            const plan = makePlan({root, driver: 'mysql'});

            const cols = records(formatExplainTableCsv(plan))[1].split(',');

            expect(cols[4]).toBe('');
            expect(cols[5]).toBe('12.75');
        });

        it('writes non-finite costs as empty cells', () => {
            const root = makeNode({
                id: 'root',
                startup_cost: Number.NaN,
                total_cost: Number.POSITIVE_INFINITY,
            });

            const cols = records(formatExplainTableCsv(makePlan({root})))[1].split(',');

            expect(cols[4]).toBe('');
            expect(cols[5]).toBe('');
        });

        it.each([
            [1e21, '1000000000000000000000'],
            [1.2345e25, '12345000000000000000000000'],
            [-2.5e22, '-25000000000000000000000'],
            [1.5e-7, '0.00000015'],
            [1.234e-10, '0.0000000001234'],
            [123456.789, '123456.789'],
            [0.1, '0.1'],
        ])('writes the cost %s without exponent notation', (cost, expected) => {
            const root = makeNode({id: 'root', startup_cost: cost, total_cost: cost});

            const cols = records(formatExplainTableCsv(makePlan({root})))[1].split(',');

            expect(cols[4]).toBe(expected);
            expect(cols[5]).toBe(expected);
        });

        it('keeps every digit of a large cost the database reported', () => {
            // 2^53 + 2 is exactly representable; String() gives 9007199254740994.
            const root = makeNode({id: 'root', total_cost: 2 ** 53 + 2, plan_rows: 1e22});

            const cols = records(formatExplainTableCsv(makePlan({root})))[1].split(',');

            expect(cols[5]).toBe('9007199254740994');
            expect(cols[6]).toBe('10000000000000000000000');
        });

        it('leaves the estimate gap empty when estimates or actual rows are missing', () => {
            const noEstimate = makeNode({
                id: 'no_estimate',
                plan_rows: null,
                actual_rows: 10,
            });
            const zeroActual = makeNode({
                id: 'zero_actual',
                plan_rows: 10,
                actual_rows: 0,
            });
            const root = makeNode({
                id: 'root',
                node_type: 'Append',
                plan_rows: 20,
                actual_rows: null,
                children: [noEstimate, zeroActual],
            });
            const plan = makePlan({root, has_analyze_data: true});

            const lines = records(formatExplainTableCsv(plan));

            expect(lines.slice(1).map((line) => line.split(',')[9])).toEqual(['', '', '']);
        });

        it('formats analyzed plans with plain numbers for costs, self time and estimate gap', () => {
            const scanNode = makeNode({
                id: 'scan',
                node_type: 'Seq Scan',
                relation: 'customers',
                startup_cost: 0,
                total_cost: 80,
                plan_rows: 100,
                actual_rows: 300,
                actual_time_ms: 15.456,
                actual_loops: 1,
                filter: 'active = true',
            });
            const root = makeNode({
                id: 'root',
                node_type: 'Sort',
                startup_cost: 100,
                total_cost: 120,
                plan_rows: 100,
                actual_rows: 300,
                actual_time_ms: 20.0,
                actual_loops: 1,
                children: [scanNode],
            });
            const plan = makePlan({root, has_analyze_data: true});

            const lines = records(formatExplainTableCsv(plan));

            // Root self time: 20 - 15.456 = 4.544 ms. Gap: 300 / 100 = 3.
            expect(lines[1]).toBe('1,0,Sort,,100,120,100,300,4.544,3,');
            expect(lines[2]).toBe('2,1,Seq Scan,customers,0,80,100,300,15.456,3,active = true');
        });

        it('writes an overestimate as the same gap factor, rounded without float noise', () => {
            // 100 estimated, 30 actual: 1 / 0.3 = 3.3333333333333335
            const root = makeNode({
                id: 'root',
                total_cost: 10,
                plan_rows: 100,
                actual_rows: 30,
                actual_time_ms: 1,
                actual_loops: 1,
            });
            const plan = makePlan({root, has_analyze_data: true});

            const cols = records(formatExplainTableCsv(plan))[1].split(',');

            expect(cols[9]).toBe('3.333');
            expect(Number(cols[9])).toBeCloseTo(3.333, 3);
            expect(cols[9]).not.toContain('x');
        });

        it('properly quotes fields per RFC 4180 when containing commas, quotes, and newlines', () => {
            const root = makeNode({
                id: 'root',
                node_type: 'Custom "Join", Strategy',
                relation: 'users, accounts',
                total_cost: 10,
                plan_rows: 5,
                filter: '(status = "active" AND type = \'admin\')\nORDER BY id',
            });
            const plan = makePlan({root});

            const csv = formatExplainTableCsv(plan);

            // Column 2 (node_type): contains commas and quotes -> wrapped in quotes, double quotes doubled
            expect(csv).toContain('"Custom ""Join"", Strategy"');
            // Column 3 (relation): contains comma -> wrapped in quotes
            expect(csv).toContain('"users, accounts"');
            // filter: contains quotes and newline -> wrapped in quotes, internal quotes doubled
            expect(csv).toContain('"(status = ""active"" AND type = \'admin\')\nORDER BY id"\r\n');
        });

        it('supports custom delimiter such as semicolon', () => {
            const root = makeNode({
                id: 'root',
                node_type: 'Seq Scan',
                relation: 'users',
                startup_cost: 0,
                total_cost: 50,
                plan_rows: 100,
            });
            const plan = makePlan({root});

            const lines = records(formatExplainTableCsv(plan, {delimiter: ';'}));
            expect(lines[0]).toBe(HEADER.replace(/,/g, ';'));
            expect(lines[1]).toBe('1;0;Seq Scan;users;0;50;100;;;;');
        });
    });

    describe('saveExplainTableCsv', () => {
        it('returns false when the user cancels the download', async () => {
            const downloadFile = vi.fn().mockResolvedValue(false);
            const platform = {downloadFile} as unknown as PlatformCapabilities;

            const result = await saveExplainTableCsv(platform, makePlan());

            expect(result).toBe(false);
            expect(downloadFile).toHaveBeenCalledWith(
                expect.objectContaining({
                    fileName: 'explain-plan.csv',
                    filters: [{name: 'CSV', extensions: ['csv']}],
                }),
            );
        });

        it('downloads the formatted CSV under the given file name', async () => {
            const downloadFile = vi.fn().mockResolvedValue(true);
            const platform = {downloadFile} as unknown as PlatformCapabilities;
            const plan = makePlan({
                root: makeNode({id: 'root', node_type: 'Limit', total_cost: 10}),
            });

            const result = await saveExplainTableCsv(platform, plan, undefined, 'custom.csv');

            expect(result).toBe(true);
            const request = downloadFile.mock.calls[0][0];
            expect(request.fileName).toBe('custom.csv');
            expect(request.mimeType).toBe('text/csv');
            expect(new TextDecoder().decode(request.contents)).toContain('index,depth,node_type');
        });
    });
});
