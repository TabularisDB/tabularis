import type {NotebookCell} from '@/types/notebook';
import {
    formatScalarResolutionText,
    resolveScalarReference,
    SCALAR_REF_PATTERN,
    type ScalarResolution,
} from './notebookScalarReferences';

interface MdastNode {
    type: string;
    value?: string;
    children?: MdastNode[];
    data?: {
        hName?: string;
        hProperties?: Record<string, unknown>;
    };
}

export interface RemarkScalarReferencesOptions {
    cells: NotebookCell[];
    formatPlaceholder?: (resolution: ScalarResolution) => string;
    outdatedLabel?: string;
    outdatedShort?: string;
}

const SKIP_NODE_TYPES = new Set(['code', 'inlineCode']);

function makeSpanNode(properties: Record<string, unknown>, children: MdastNode[]): MdastNode {
    return {
        type: 'scalarRef',
        data: {
            hName: 'span',
            hProperties: properties,
        },
        children,
    };
}

function buildReplacementNodes(
    resolution: ScalarResolution,
    formatPlaceholder: (resolution: ScalarResolution) => string,
    outdatedLabel: string,
    outdatedShort: string,
): MdastNode[] {
    if (resolution.kind === 'value') {
        if (!resolution.isStale) {
            return [{type: 'text', value: resolution.text}];
        }
        return [
            makeSpanNode(
                {
                    className: 'inline-flex items-baseline gap-1',
                    'data-scalar-ref': resolution.raw,
                    'data-scalar-state': 'stale',
                },
                [
                    {type: 'text', value: resolution.text},
                    makeSpanNode(
                        {
                            className:
                                'text-[11px] text-warning-text font-mono bg-surface-secondary px-1 rounded',
                            title: outdatedLabel,
                        },
                        [{type: 'text', value: `(${outdatedShort})`}],
                    ),
                ],
            ),
        ];
    }

    if (resolution.kind === 'null') {
        const nullBadge = makeSpanNode(
            {
                className:
                    'px-1 py-0.5 rounded text-xs font-mono bg-surface-secondary text-muted italic',
                'data-scalar-ref': resolution.raw,
                'data-scalar-state': 'null',
            },
            [{type: 'text', value: 'NULL'}],
        );

        if (!resolution.isStale) {
            return [nullBadge];
        }

        return [
            makeSpanNode(
                {
                    className: 'inline-flex items-baseline gap-1',
                    'data-scalar-ref': resolution.raw,
                    'data-scalar-state': 'null',
                },
                [
                    nullBadge,
                    makeSpanNode(
                        {
                            className:
                                'text-[11px] text-warning-text font-mono bg-surface-secondary px-1 rounded',
                            title: outdatedLabel,
                        },
                        [{type: 'text', value: `(${outdatedShort})`}],
                    ),
                ],
            ),
        ];
    }

    return [
        makeSpanNode(
            {
                className:
                    'inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-surface-secondary text-warning-text border border-default',
                'data-scalar-ref': resolution.raw,
                'data-scalar-state': resolution.kind,
            },
            [{type: 'text', value: formatPlaceholder(resolution)}],
        ),
    ];
}

function splitTextNode(
    value: string,
    cells: NotebookCell[],
    formatPlaceholder: (resolution: ScalarResolution) => string,
    outdatedLabel: string,
    outdatedShort: string,
): MdastNode[] | null {
    const regex = new RegExp(SCALAR_REF_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    const nodes: MdastNode[] = [];

    while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIndex) {
            nodes.push({type: 'text', value: value.slice(lastIndex, match.index)});
        }
        const resolution = resolveScalarReference(match[0], match[1], cells);
        nodes.push(
            ...buildReplacementNodes(resolution, formatPlaceholder, outdatedLabel, outdatedShort),
        );
        lastIndex = match.index + match[0].length;
    }

    if (nodes.length === 0) return null;

    if (lastIndex < value.length) {
        nodes.push({type: 'text', value: value.slice(lastIndex)});
    }
    return nodes;
}

function transformNode(
    node: MdastNode,
    cells: NotebookCell[],
    formatPlaceholder: (resolution: ScalarResolution) => string,
    outdatedLabel: string,
    outdatedShort: string,
): void {
    if (SKIP_NODE_TYPES.has(node.type) || !node.children) return;

    const nextChildren: MdastNode[] = [];
    let modified = false;

    for (const child of node.children) {
        if (child.type === 'text' && typeof child.value === 'string') {
            const replacement = splitTextNode(
                child.value,
                cells,
                formatPlaceholder,
                outdatedLabel,
                outdatedShort,
            );
            if (replacement) {
                nextChildren.push(...replacement);
                modified = true;
                continue;
            }
        } else {
            transformNode(child, cells, formatPlaceholder, outdatedLabel, outdatedShort);
        }
        nextChildren.push(child);
    }

    if (modified) {
        node.children = nextChildren;
    }
}

export function remarkScalarReferences(options: RemarkScalarReferencesOptions) {
    const {
        cells,
        formatPlaceholder = formatScalarResolutionText,
        outdatedLabel = 'Referenced cell query changed since last run',
        outdatedShort = 'outdated',
    } = options;

    return (tree: MdastNode) => {
        transformNode(tree, cells, formatPlaceholder, outdatedLabel, outdatedShort);
    };
}
