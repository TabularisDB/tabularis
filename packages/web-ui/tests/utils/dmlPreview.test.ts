import {describe, expect, it} from 'vitest';
import {
    canShowPreviewAction,
    isPreviewStale,
    previewableStatementKind,
    supportsDmlPreview,
} from '@/utils/dmlPreview';

describe('dmlPreview', () => {
    it('offers the action only for the PostgreSQL dialect', () => {
        expect(supportsDmlPreview({sql_dialect: 'postgres'})).toBe(true);
        expect(supportsDmlPreview({sql_dialect: 'mysql'})).toBe(false);
        expect(supportsDmlPreview({sql_dialect: 'sqlite'})).toBe(false);
        expect(supportsDmlPreview({})).toBe(false);
        expect(supportsDmlPreview(null)).toBe(false);
        expect(
            supportsDmlPreview({
                sql_dialect: 'mysql',
                sql_syntax: {extends: 'postgres'},
            }),
        ).toBe(true);
    });

    it('classifies a single UPDATE or DELETE and ignores leading comments', () => {
        expect(previewableStatementKind("UPDATE orders SET status = 'paid' WHERE id = 1")).toBe(
            'update',
        );
        expect(previewableStatementKind('DELETE FROM orders WHERE id = 1')).toBe('delete');
        expect(
            previewableStatementKind("-- repair\nUPDATE orders SET status = 'paid' WHERE id = 1"),
        ).toBe('update');
        expect(
            previewableStatementKind('WITH cte AS (SELECT 1) UPDATE orders SET status = 1'),
        ).toBe(null);
        expect(previewableStatementKind('SELECT * FROM orders')).toBe(null);
        expect(previewableStatementKind('INSERT INTO orders VALUES (1)')).toBe(null);
    });

    it('hides the action when the dialect or the statement is unsupported', () => {
        const sql = "UPDATE orders SET status = 'paid' WHERE id = 1";
        expect(canShowPreviewAction({sql_dialect: 'postgres'}, sql)).toBe(true);
        expect(canShowPreviewAction({sql_dialect: 'postgres'}, 'SELECT 1')).toBe(false);
        expect(canShowPreviewAction({sql_dialect: 'mysql'}, sql)).toBe(false);
    });

    it('marks a preview stale when the source or the connection context changes', () => {
        const preview = {
            sourceSql: "UPDATE orders SET status = 'paid' WHERE id = 1",
            connectionId: 'c1',
            schema: 'public',
            database: 'shop',
        };
        const context = {
            sql: preview.sourceSql,
            connectionId: 'c1',
            schema: 'public',
            database: 'shop',
        };
        expect(isPreviewStale(preview, context)).toBe(false);
        expect(isPreviewStale(preview, {...context, sql: preview.sourceSql + ' '})).toBe(true);
        expect(isPreviewStale(preview, {...context, connectionId: 'c2'})).toBe(true);
        expect(isPreviewStale(preview, {...context, schema: 'other'})).toBe(true);
        expect(isPreviewStale(preview, {...context, database: null})).toBe(true);
        expect(isPreviewStale({...preview, schema: null}, {...context, schema: undefined})).toBe(
            false,
        );
    });
});
