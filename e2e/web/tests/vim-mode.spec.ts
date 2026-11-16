import {expect, test} from '@playwright/test';
import path from 'node:path';
import {rpc} from './rpc';

test('Vim notebook cells preserve their content height and execute run shortcuts', async ({
    page,
}) => {
    await page.goto('/connections');
    const previous = await rpc<Record<string, unknown>>(page, 'get_config');
    const runtimeDir =
        process.env.TABULARIS_E2E_RUNTIME_DIR ?? path.resolve(import.meta.dirname, '../.runtime');
    const connection = await rpc<{id: string}>(page, 'save_connection', {
        name: 'Vim SQLite regression',
        params: {
            driver: 'sqlite',
            database: path.join(runtimeDir, 'tabularis-e2e.sqlite'),
            save_in_keychain: false,
        },
        environment: 'development',
    });
    try {
        await rpc(page, 'save_config', {config: {editorVimMode: true, aiEnabled: false}});
        await page.goto(`/connections/${connection.id}/editor`);
        await page.getByTitle('New Notebook', {exact: true}).click();
        const status = page.locator('[data-testid="vim-status-line"]:visible');
        await expect(status).toContainText('NORMAL');
        await page.evaluate(() => {
            const editor = window.__e2e_editor;
            editor.setValue(
                Array.from({length: 15}, (_, i) => `-- line ${i + 1}`).join('\n') +
                    '\nSELECT 42 AS vim_result;',
            );
            editor.focus();
        });
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const editor = window.__e2e_editor as typeof window.__e2e_editor & {
                        getContentHeight(): number;
                        getLayoutInfo(): {height: number};
                    };
                    return editor.getLayoutInfo().height >= editor.getContentHeight();
                }),
            )
            .toBe(true);
        await page.keyboard.press('i');
        await expect(status).toContainText('INSERT');
        await page.keyboard.press('Escape');
        await expect(status).toContainText('NORMAL');
        await page.keyboard.type(':');
        await expect(status.locator('input')).toBeVisible();
        await page.keyboard.press('Escape');
        const shortcut = await page.evaluate(() =>
            navigator.userAgent.includes('Macintosh') ? 'Meta+Enter' : 'Control+Enter',
        );
        await page.keyboard.press(shortcut);
        await expect(page.getByText('42', {exact: true}).first()).toBeVisible();
    } finally {
        await rpc(page, 'save_config', {
            config: {
                ...previous,
                editorVimMode: previous.editorVimMode ?? false,
                aiEnabled: previous.aiEnabled ?? false,
            },
        });
        await rpc(page, 'disconnect_connection', {connectionId: connection.id}).catch(
            () => undefined,
        );
        await rpc(page, 'delete_connection', {id: connection.id}).catch(() => undefined);
    }
});
