import type {DriverCapabilities} from '@/types/plugins';
import {leadingKeyword} from './sqlSplitter/classify';

export type DmlPreviewKind = 'update' | 'delete';

export function supportsDmlPreview(capabilities?: DriverCapabilities | null): boolean {
    // Matches the backend, which checks `sql_dialect` only.
    return capabilities?.sql_dialect === 'postgres';
}

export function previewableStatementKind(sql: string): DmlPreviewKind | null {
    const keyword = leadingKeyword(sql);
    if (keyword === 'UPDATE') return 'update';
    if (keyword === 'DELETE') return 'delete';
    return null;
}

export function canShowPreviewAction(
    capabilities: DriverCapabilities | null | undefined,
    sql: string,
): boolean {
    return supportsDmlPreview(capabilities) && previewableStatementKind(sql) !== null;
}
