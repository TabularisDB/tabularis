import type {DriverCapabilities} from '@/types/plugins';
import {isDialect} from './sqlSplitter';
import {leadingKeyword} from './sqlSplitter/classify';

export type DmlPreviewKind = 'update' | 'delete';

export interface DmlPreviewContext {
    sql: string;
    connectionId: string;
    schema?: string | null;
    database?: string | null;
}

export interface DmlPreviewEcho {
    sourceSql: string;
    connectionId: string;
    schema?: string | null;
    database?: string | null;
}

export function supportsDmlPreview(capabilities?: DriverCapabilities | null): boolean {
    const extendsDialect = capabilities?.sql_syntax?.extends;
    const dialect = isDialect(extendsDialect) ? extendsDialect : capabilities?.sql_dialect;
    return dialect === 'postgres';
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

export function isPreviewStale(preview: DmlPreviewEcho, context: DmlPreviewContext): boolean {
    return (
        preview.sourceSql !== context.sql ||
        preview.connectionId !== context.connectionId ||
        (preview.schema ?? null) !== (context.schema ?? null) ||
        (preview.database ?? null) !== (context.database ?? null)
    );
}
