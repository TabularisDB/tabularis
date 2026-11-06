import type {
    TableTransferCapabilities,
    TableTransferColumnMapping,
    TableTransferColumnPlan,
    TableTransferConflictMode,
    TableTransferPlan,
    TableTransferRequest,
    TableTransferResult,
} from '@/api/contract';

type TransferPair = TableTransferCapabilities['pairs'][number];

/** Plan issue codes the backend reports; each has a `tableTransfer.issue.<code>` string. */
export const TABLE_TRANSFER_ISSUE_CODES = [
    'targetReadOnly',
    'duplicateTargetTable',
    'sourceTableNotFound',
    'targetTableNotFound',
    'sourceEqualsTarget',
    'unknownSourceColumn',
    'unknownTargetColumn',
    'noTargetColumn',
    'duplicateTargetColumn',
    'targetColumnGenerated',
    'unsupportedSourceType',
    'unsupportedTargetType',
    'incompatibleTypes',
    'requiredTargetColumnUnmapped',
    'noColumnsMapped',
] as const;

export function canTransferFrom(pairs: TransferPair[], sourceDriver: string): boolean {
    return pairs.some((pair) => pair.source === sourceDriver);
}

export function isTransferPair(
    pairs: TransferPair[],
    sourceDriver: string,
    targetDriver: string,
): boolean {
    return pairs.some((pair) => pair.source === sourceDriver && pair.target === targetDriver);
}

export function issueMessageKey(code: string): string {
    return (TABLE_TRANSFER_ISSUE_CODES as readonly string[]).includes(code)
        ? `tableTransfer.issue.${code}`
        : 'tableTransfer.issue.unknown';
}

export interface TransferRequestInput {
    sourceConnectionId: string;
    sourceDatabase?: string;
    sourceSchema?: string;
    targetConnectionId: string;
    targetDatabase?: string;
    targetSchema?: string;
    sourceTable: string;
    targetTable: string;
    columns: TableTransferColumnMapping[];
    conflict?: TableTransferConflictMode;
    transferId?: string;
}

export function buildTransferRequest(input: TransferRequestInput): TableTransferRequest {
    return {
        sourceConnectionId: input.sourceConnectionId,
        ...(input.sourceDatabase ? {sourceDatabase: input.sourceDatabase} : {}),
        ...(input.sourceSchema ? {sourceSchema: input.sourceSchema} : {}),
        targetConnectionId: input.targetConnectionId,
        ...(input.targetDatabase ? {targetDatabase: input.targetDatabase} : {}),
        ...(input.targetSchema ? {targetSchema: input.targetSchema} : {}),
        tables: [
            {
                sourceTable: input.sourceTable,
                targetTable: input.targetTable,
                ...(input.columns.length > 0 ? {columns: input.columns} : {}),
            },
        ],
        ...(input.conflict ? {conflict: input.conflict} : {}),
        ...(input.transferId ? {transferId: input.transferId} : {}),
    };
}

/** Pins the mapping a plan resolved, so later edits change one column at a time. */
export function mappingsFromPlan(columns: TableTransferColumnPlan[]): TableTransferColumnMapping[] {
    return columns
        .filter((column) => column.skipped || column.targetColumn !== null)
        .map((column) => ({
            sourceColumn: column.sourceColumn,
            targetColumn: column.skipped ? null : column.targetColumn,
        }));
}

export function withMapping(
    mappings: TableTransferColumnMapping[],
    sourceColumn: string,
    targetColumn: string | null,
): TableTransferColumnMapping[] {
    const rest = mappings.filter((mapping) => mapping.sourceColumn !== sourceColumn);
    return [...rest, {sourceColumn, targetColumn}];
}

/** A missing plan counts as blocked: nothing may start without a reviewed plan. */
export function isPlanBlocked(plan: TableTransferPlan | null): boolean {
    if (!plan) return true;
    return plan.blocking || plan.issues.length > 0 || plan.tables.some((table) => table.blocking);
}

export interface TransferSummary {
    status: TableTransferResult['status'];
    rowsWritten: number;
    rowsSkipped: number;
    rowsFailed: number;
    /** True when rows were committed to a target that did not finish. */
    leavesCommittedRows: boolean;
}

export function summarizeResult(result: TableTransferResult): TransferSummary {
    const sum = (pick: (table: TableTransferResult['tables'][number]) => number) =>
        result.tables.reduce((total, table) => total + pick(table), 0);
    const rowsWritten = sum((table) => table.rowsWritten);
    return {
        status: result.status,
        rowsWritten,
        rowsSkipped: sum((table) => table.rowsSkipped),
        rowsFailed: sum((table) => table.rowsFailed),
        leavesCommittedRows: result.status !== 'completed' && rowsWritten > 0,
    };
}

/** Whole-number progress, held below 100 until the backend reports completion. */
export function progressPercent(processed: number, estimated: number | null): number | null {
    if (estimated === null || estimated <= 0) return null;
    return Math.min(99, Math.floor((processed * 100) / estimated));
}
