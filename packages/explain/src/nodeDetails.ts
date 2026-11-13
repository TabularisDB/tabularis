import type {ExplainNode} from './types';
import type {ExplainNodeMetrics} from './metrics';
import type {ExplainDiagnostic} from './diagnostics';
import {formatCost, formatRows, formatTime} from './plan';

export type ExplainTranslator = (key: string, defaultValue?: string) => string;

export interface ExplainNodeDetailEntry {
    label: string;
    value: string;
}

export interface ExplainNodeDetailSection {
    title: string;
    titleKey: string;
    entries: ExplainNodeDetailEntry[];
}

export interface FormatExplainNodeDetailsOptions {
    hasAnalyzeData?: boolean;
    metrics?: ExplainNodeMetrics | null;
    diagnostics?: ExplainDiagnostic[];
    t?: ExplainTranslator;
    includeSectionHeaders?: boolean;
}

const DEFAULT_LABELS: Record<string, string> = {
    'editor.visualExplain.nodeType': 'Operation',
    'editor.visualExplain.relation': 'Table',
    'editor.visualExplain.cost': 'Cost',
    'editor.visualExplain.selfCost': 'Self Cost',
    'editor.visualExplain.estRows': 'Est. Rows',
    'editor.visualExplain.filter': 'Filter',
    'editor.visualExplain.indexCondition': 'Index Cond.',
    'editor.visualExplain.joinType': 'Join Type',
    'editor.visualExplain.hashCondition': 'Hash Cond.',
    'editor.visualExplain.actualRows': 'Actual Rows',
    'editor.visualExplain.rowsAllLoops': 'Rows (All Loops)',
    'editor.visualExplain.selfTime': 'Self Time',
    'editor.visualExplain.totalTime': 'Total Time',
    'editor.visualExplain.timePerLoop': 'Time per Loop',
    'editor.visualExplain.loops': 'Loops',
    'editor.visualExplain.buffersHit': 'Buffers Hit',
    'editor.visualExplain.buffersRead': 'Buffers Read',
    'editor.visualExplain.general': 'General',
    'editor.visualExplain.analyzeData': 'Analyze Data',
    'editor.visualExplain.extraDetails': 'Extra',
    'editor.visualExplain.diagnostics.title': 'Diagnostics',
};

/**
 * Build structured label/value sections for an EXPLAIN node matching
 * the display in the node details panel. Omit any metric or field
 * that is absent rather than fabricating placeholder values or zeros.
 */
export function getExplainNodeDetailSections(
    node: ExplainNode,
    options: {
        hasAnalyzeData?: boolean;
        metrics?: ExplainNodeMetrics | null;
        diagnostics?: ExplainDiagnostic[];
        t?: ExplainTranslator;
    } = {},
): ExplainNodeDetailSection[] {
    const {hasAnalyzeData = false, metrics = null, diagnostics = [], t} = options;
    const tr = (key: string, fallback?: string): string => {
        if (t) {
            return t(key, fallback ?? DEFAULT_LABELS[key] ?? key);
        }
        return fallback ?? DEFAULT_LABELS[key] ?? key;
    };

    const generalEntries: ExplainNodeDetailEntry[] = [
        {label: tr('editor.visualExplain.nodeType', 'Operation'), value: node.node_type},
        ...(node.relation
            ? [{label: tr('editor.visualExplain.relation', 'Table'), value: node.relation}]
            : []),
        ...(node.startup_cost != null && node.total_cost != null
            ? [
                  {
                      label: tr('editor.visualExplain.cost', 'Cost'),
                      value: `${formatCost(node.startup_cost)} - ${formatCost(node.total_cost)}`,
                  },
              ]
            : node.total_cost != null
              ? [
                    {
                        label: tr('editor.visualExplain.cost', 'Cost'),
                        value: formatCost(node.total_cost),
                    },
                ]
              : []),
        ...(metrics?.exclusiveCost != null
            ? [
                  {
                      label: tr('editor.visualExplain.selfCost', 'Self Cost'),
                      value: formatCost(metrics.exclusiveCost),
                  },
              ]
            : []),
        ...(node.plan_rows != null
            ? [
                  {
                      label: tr('editor.visualExplain.estRows', 'Est. Rows'),
                      value: formatRows(node.plan_rows),
                  },
              ]
            : []),
        ...(node.filter
            ? [{label: tr('editor.visualExplain.filter', 'Filter'), value: node.filter}]
            : []),
        ...(node.index_condition
            ? [
                  {
                      label: tr('editor.visualExplain.indexCondition', 'Index Cond.'),
                      value: node.index_condition,
                  },
              ]
            : []),
        ...(node.join_type
            ? [{label: tr('editor.visualExplain.joinType', 'Join Type'), value: node.join_type}]
            : []),
        ...(node.hash_condition
            ? [
                  {
                      label: tr('editor.visualExplain.hashCondition', 'Hash Cond.'),
                      value: node.hash_condition,
                  },
              ]
            : []),
    ];

    const analyzeEntries: ExplainNodeDetailEntry[] = hasAnalyzeData
        ? [
              ...(node.actual_rows != null
                  ? [
                        {
                            label: tr('editor.visualExplain.actualRows', 'Actual Rows'),
                            value: formatRows(node.actual_rows),
                        },
                    ]
                  : []),
              ...(metrics?.totalRows != null && node.actual_loops != null && node.actual_loops > 1
                  ? [
                        {
                            label: tr('editor.visualExplain.rowsAllLoops', 'Rows (All Loops)'),
                            value: formatRows(metrics.totalRows),
                        },
                    ]
                  : []),
              ...(metrics?.exclusiveTimeMs != null
                  ? [
                        {
                            label: tr('editor.visualExplain.selfTime', 'Self Time'),
                            value:
                                metrics.timeShare != null
                                    ? `${formatTime(metrics.exclusiveTimeMs)} (${Math.round(metrics.timeShare * 100)}%)`
                                    : formatTime(metrics.exclusiveTimeMs),
                        },
                    ]
                  : []),
              ...(metrics?.inclusiveTimeMs != null
                  ? [
                        {
                            label: tr('editor.visualExplain.totalTime', 'Total Time'),
                            value: formatTime(metrics.inclusiveTimeMs),
                        },
                    ]
                  : []),
              ...(node.actual_time_ms != null
                  ? [
                        {
                            label: tr('editor.visualExplain.timePerLoop', 'Time per Loop'),
                            value: formatTime(node.actual_time_ms),
                        },
                    ]
                  : []),
              ...(node.actual_loops != null
                  ? [
                        {
                            label: tr('editor.visualExplain.loops', 'Loops'),
                            value: String(node.actual_loops),
                        },
                    ]
                  : []),
              ...(node.buffers_hit != null
                  ? [
                        {
                            label: tr('editor.visualExplain.buffersHit', 'Buffers Hit'),
                            value: String(node.buffers_hit),
                        },
                    ]
                  : []),
              ...(node.buffers_read != null
                  ? [
                        {
                            label: tr('editor.visualExplain.buffersRead', 'Buffers Read'),
                            value: String(node.buffers_read),
                        },
                    ]
                  : []),
          ]
        : [];

    const extraEntries: ExplainNodeDetailEntry[] = Object.entries(node.extra ?? {}).map(
        ([key, value]) => ({
            label: key,
            value: typeof value === 'string' ? value : JSON.stringify(value),
        }),
    );

    const sections: ExplainNodeDetailSection[] = [];

    if (generalEntries.length > 0) {
        sections.push({
            title: tr('editor.visualExplain.general', 'General'),
            titleKey: 'editor.visualExplain.general',
            entries: generalEntries,
        });
    }

    if (analyzeEntries.length > 0) {
        sections.push({
            title: tr('editor.visualExplain.analyzeData', 'Analyze Data'),
            titleKey: 'editor.visualExplain.analyzeData',
            entries: analyzeEntries,
        });
    }

    if (extraEntries.length > 0) {
        sections.push({
            title: tr('editor.visualExplain.extraDetails', 'Extra'),
            titleKey: 'editor.visualExplain.extraDetails',
            entries: extraEntries,
        });
    }

    if (diagnostics && diagnostics.length > 0) {
        const diagEntries: ExplainNodeDetailEntry[] = diagnostics.map((d) => ({
            label: tr(d.labelKey, d.kind),
            value: d.value
                ? `${tr(d.descriptionKey, d.kind)} (${d.value})`
                : tr(d.descriptionKey, d.kind),
        }));
        sections.push({
            title: tr('editor.visualExplain.diagnostics.title', 'Diagnostics'),
            titleKey: 'editor.visualExplain.diagnostics.title',
            entries: diagEntries,
        });
    }

    return sections;
}

/**
 * Format the displayed details and metrics of an EXPLAIN node into
 * stable, human-readable plain text suitable for clipboard sharing.
 * Omit unavailable metrics rather than inventing zeros.
 */
export function formatExplainNodeDetails(
    node: ExplainNode,
    options: FormatExplainNodeDetailsOptions = {},
): string {
    const sections = getExplainNodeDetailSections(node, options);
    const parts: string[] = [];

    for (const section of sections) {
        if (section.entries.length === 0) continue;
        const lines = section.entries.map((entry) => `${entry.label}: ${entry.value}`);
        if (options.includeSectionHeaders || section.titleKey !== 'editor.visualExplain.general') {
            parts.push(`${section.title}:\n${lines.join('\n')}`);
        } else {
            parts.push(lines.join('\n'));
        }
    }

    return parts.join('\n\n');
}
