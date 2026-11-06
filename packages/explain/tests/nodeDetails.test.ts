import {describe, expect, it} from 'vitest';
import type {ExplainNode} from '../src/types';
import type {ExplainNodeMetrics} from '../src/metrics';
import type {ExplainDiagnostic} from '../src/diagnostics';
import {formatExplainNodeDetails, getExplainNodeDetailSections} from '../src/nodeDetails';

describe('formatExplainNodeDetails', () => {
    it('formats estimated-only plan node with stable labels and omits absent metrics', () => {
        const node: ExplainNode = {
            id: 'node-1',
            node_type: 'Seq Scan',
            relation: 'users',
            startup_cost: 0.0,
            total_cost: 35.5,
            plan_rows: 2500,
            filter: "(status = 'active')",
            children: [],
            extra: {},
        };

        const text = formatExplainNodeDetails(node, {hasAnalyzeData: false});

        expect(text).toBe(
            [
                'Operation: Seq Scan',
                'Table: users',
                'Cost: 0.00 - 35.5',
                'Est. Rows: 2.5K',
                "Filter: (status = 'active')",
            ].join('\n'),
        );
        // Does not fabricate zeros or include analyze fields when hasAnalyzeData is false
        expect(text).not.toContain('Actual Rows');
        expect(text).not.toContain('Self Time');
        expect(text).not.toContain('Loops');
    });

    it('formats analyzed plan node with runtime timing, loops, and buffers', () => {
        const node: ExplainNode = {
            id: 'node-2',
            node_type: 'Index Scan',
            relation: 'orders',
            startup_cost: 0.42,
            total_cost: 8.44,
            plan_rows: 10,
            actual_rows: 5,
            actual_loops: 2,
            actual_time_ms: 1.25,
            buffers_hit: 128,
            buffers_read: 4,
            index_condition: '(id = 42)',
            children: [],
            extra: {},
        };

        const metrics: ExplainNodeMetrics = {
            nodeId: 'node-2',
            exclusiveTimeMs: 2.5,
            inclusiveTimeMs: 2.5,
            timeShare: 0.25,
            exclusiveCost: 8.02,
            costShare: 0.8,
            totalRows: 10,
            rowShare: 0.1,
            maxLoops: 2,
            isBottleneck: false,
        };

        const text = formatExplainNodeDetails(node, {
            hasAnalyzeData: true,
            metrics,
        });

        expect(text).toContain('Operation: Index Scan');
        expect(text).toContain('Table: orders');
        expect(text).toContain('Cost: 0.42 - 8.4');
        expect(text).toContain('Self Cost: 8.0');
        expect(text).toContain('Est. Rows: 10');
        expect(text).toContain('Index Cond.: (id = 42)');
        expect(text).toContain('Analyze Data:');
        expect(text).toContain('Actual Rows: 5');
        expect(text).toContain('Rows (All Loops): 10');
        expect(text).toContain('Self Time: 2.50 ms (25%)');
        expect(text).toContain('Total Time: 2.50 ms');
        expect(text).toContain('Time per Loop: 1.25 ms');
        expect(text).toContain('Loops: 2');
        expect(text).toContain('Buffers Hit: 128');
        expect(text).toContain('Buffers Read: 4');
    });

    it('omits unavailable metrics rather than inventing zeros or placeholders', () => {
        const node: ExplainNode = {
            id: 'node-3',
            node_type: 'Result',
            total_cost: 0.01,
            children: [],
            extra: {},
        };

        const text = formatExplainNodeDetails(node, {hasAnalyzeData: false});

        expect(text).toBe('Operation: Result\nCost: 0.01');
        expect(text).not.toContain('Table:');
        expect(text).not.toContain('Est. Rows:');
        expect(text).not.toContain('Filter:');
        expect(text).not.toContain('Actual Rows:');
    });

    it('handles Unicode, Cyrillic, CJK and emoji correctly', () => {
        const node: ExplainNode = {
            id: 'node-unicode',
            node_type: 'Seq Scan',
            relation: 'таблица_заказов_顧客',
            filter: "(категория = '🚀 VIP')",
            children: [],
            extra: {
                примечание: 'Быстрый поиск ⚡',
            },
        };

        const text = formatExplainNodeDetails(node, {hasAnalyzeData: false});

        expect(text).toContain('Table: таблица_заказов_顧客');
        expect(text).toContain("Filter: (категория = '🚀 VIP')");
        expect(text).toContain('примечание: Быстрый поиск ⚡');
    });

    it('translates labels when custom translator is supplied', () => {
        const node: ExplainNode = {
            id: 'node-trans',
            node_type: 'Hash Join',
            join_type: 'Inner',
            children: [],
            extra: {},
        };

        const translations: Record<string, string> = {
            'editor.visualExplain.nodeType': 'Тип операции',
            'editor.visualExplain.joinType': 'Тип соединения',
        };

        const text = formatExplainNodeDetails(node, {
            hasAnalyzeData: false,
            t: (key, fallback) => translations[key] ?? fallback ?? key,
        });

        expect(text).toContain('Тип операции: Hash Join');
        expect(text).toContain('Тип соединения: Inner');
    });

    it('includes diagnostics when diagnostics are attached to the node', () => {
        const node: ExplainNode = {
            id: 'node-diag',
            node_type: 'Seq Scan',
            relation: 'huge_table',
            children: [],
            extra: {},
        };

        const diagnostics: ExplainDiagnostic[] = [
            {
                kind: 'hotspot',
                severity: 'critical',
                labelKey: 'editor.visualExplain.diagnostics.hotspot.label',
                descriptionKey: 'editor.visualExplain.diagnostics.hotspot.desc',
                value: '42.5%',
            },
        ];

        const text = formatExplainNodeDetails(node, {
            hasAnalyzeData: false,
            diagnostics,
            t: (key) =>
                key === 'editor.visualExplain.diagnostics.title'
                    ? 'Diagnostics'
                    : key.includes('label')
                      ? 'Execution Hotspot'
                      : key.includes('desc')
                        ? 'Consumes a large share of total time'
                        : key,
        });

        expect(text).toContain('Diagnostics:');
        expect(text).toContain('Execution Hotspot: Consumes a large share of total time (42.5%)');
    });

    it('respects includeSectionHeaders: true', () => {
        const node: ExplainNode = {
            id: 'node-headers',
            node_type: 'Sort',
            children: [],
            extra: {},
        };

        const text = formatExplainNodeDetails(node, {
            hasAnalyzeData: false,
            includeSectionHeaders: true,
        });

        expect(text).toBe('General:\nOperation: Sort');
    });
});

describe('getExplainNodeDetailSections', () => {
    it('returns empty sections for empty node properties', () => {
        const node: ExplainNode = {
            id: 'node-minimal',
            node_type: 'CustomOp',
            children: [],
            extra: {},
        };

        const sections = getExplainNodeDetailSections(node, {hasAnalyzeData: false});
        expect(sections).toHaveLength(1);
        expect(sections[0].title).toBe('General');
        expect(sections[0].entries).toEqual([{label: 'Operation', value: 'CustomOp'}]);
    });
});
