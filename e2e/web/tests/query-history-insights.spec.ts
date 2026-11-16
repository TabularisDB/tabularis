import {expect, test} from '@playwright/test';
import path from 'node:path';
import {rpc} from './rpc';

interface Insights {
    coverage: {totalStoredExecutions: number; currentWindowExecutions: number};
    groups: Array<{callCount: number; failureCount: number}>;
}

test('Insights retains repeated real executions while the history list deduplicates them', async ({
    page,
}) => {
    await page.goto('/connections');
    const runtimeDir =
        process.env.TABULARIS_E2E_RUNTIME_DIR ?? path.resolve(import.meta.dirname, '../.runtime');
    const connection = await rpc<{id: string}>(page, 'save_connection', {
        name: 'Query Insights SQLite regression',
        params: {
            driver: 'sqlite',
            database: path.join(runtimeDir, 'tabularis-e2e.sqlite'),
            save_in_keychain: false,
        },
        environment: 'development',
    });
    try {
        await page.goto(`/connections/${connection.id}/editor`);
        await expect.poll(() => page.evaluate(() => Boolean(window.__e2e_editor))).toBe(true);
        const shortcut = await page.evaluate(() =>
            navigator.userAgent.includes('Macintosh') ? 'Meta+Enter' : 'Control+Enter',
        );
        for (let index = 1; index <= 3; index++) {
            await page.evaluate(() => {
                window.__e2e_editor.setValue('SELECT 42 AS insights_value;');
                window.__e2e_editor.focus();
            });
            await page.keyboard.press(shortcut);
            await expect
                .poll(
                    async () =>
                        (
                            await rpc<Insights>(page, 'get_query_history_insights', {
                                connectionId: connection.id,
                            })
                        ).coverage.totalStoredExecutions,
                )
                .toBe(index);
        }
        const history = await rpc<{entries: unknown[]}>(page, 'get_query_history', {
            connectionId: connection.id,
        });
        expect(history.entries).toHaveLength(1);
        const insights = await rpc<Insights>(page, 'get_query_history_insights', {
            connectionId: connection.id,
        });
        expect(insights.coverage.currentWindowExecutions).toBe(3);
        expect(insights.groups).toHaveLength(1);
        expect(insights.groups[0]).toMatchObject({callCount: 3, failureCount: 0});
        await page.getByRole('button', {name: 'History', exact: true}).click();
        await page.getByRole('button', {name: 'Insights', exact: true}).click();
        await expect(page.getByText('3 calls', {exact: true})).toBeVisible();
        await page.reload();
        await expect
            .poll(
                async () =>
                    (
                        await rpc<Insights>(page, 'get_query_history_insights', {
                            connectionId: connection.id,
                        })
                    ).coverage.totalStoredExecutions,
            )
            .toBe(3);
    } finally {
        await rpc(page, 'disconnect_connection', {connectionId: connection.id}).catch(
            () => undefined,
        );
        await rpc(page, 'delete_connection', {id: connection.id}).catch(() => undefined);
    }
});
