import {expect, test} from '@playwright/test';
import path from 'node:path';
import {rpc} from './rpc';

interface InlineTestEditor {
    setValue(value: string): void;
    getValue(): string;
    focus(): void;
    updateOptions(options: {quickSuggestions: boolean; suggestOnTriggerCharacters: boolean}): void;
    trigger(source: string, action: string, payload: unknown): void;
}

declare global {
    interface Window {
        __e2e_editor: InlineTestEditor;
    }
}

test('inline suggestions accept as one undoable text insertion without executing SQL', async ({
    page,
    browserName,
}) => {
    await page.goto('/connections');
    const previous = await rpc<Record<string, unknown>>(page, 'get_config');
    const runtimeDir =
        process.env.TABULARIS_E2E_RUNTIME_DIR ?? path.resolve(import.meta.dirname, '../.runtime');
    const connection = await rpc<{id: string}>(page, 'save_connection', {
        name: `AI inline ${browserName}`,
        params: {
            driver: 'sqlite',
            database:
                process.env.TABULARIS_E2E_SQLITE_PATH ??
                path.join(runtimeDir, 'tabularis-e2e.sqlite'),
            save_in_keychain: false,
        },
        environment: 'development',
    });
    let executions = 0;
    page.on('request', (request) => {
        if (/\/rpc\/(?:execute_(?:query|batch)|run_query)/.test(request.url())) executions++;
    });
    // The provider is a text fixture: no model, API key or paid request is needed.
    await page.route('**/rpc/complete_ai_inline', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ok: true, data: '1 AS ai_inline;'}),
        }),
    );
    try {
        await rpc(page, 'save_config', {
            config: {
                aiEnabled: true,
                aiInlineCompletionEnabled: true,
                aiProvider: 'ollama',
                aiModel: 'inline-fixture',
            },
        });
        await page.goto(`/connections/${encodeURIComponent(connection.id)}/editor`);
        await expect.poll(() => page.evaluate(() => Boolean(window.__e2e_editor))).toBe(true);
        await page.evaluate(() => {
            const editor = window.__e2e_editor;
            editor.updateOptions({quickSuggestions: false, suggestOnTriggerCharacters: false});
            editor.setValue('');
            editor.focus();
        });
        await page.keyboard.type('SELECT ');
        const ghost = page.locator('.ghost-text-decoration').first();
        await expect(ghost).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(ghost).not.toBeVisible();
        await page.evaluate(() =>
            window.__e2e_editor.trigger('e2e', 'editor.action.inlineSuggest.trigger', undefined),
        );
        await expect(ghost).toBeVisible();
        const before = executions;
        await page.keyboard.press('Tab');
        await expect
            .poll(() => page.evaluate(() => window.__e2e_editor.getValue()))
            .toBe('SELECT 1 AS ai_inline;');
        await page.keyboard.press('ControlOrMeta+z');
        await expect
            .poll(() => page.evaluate(() => window.__e2e_editor.getValue()))
            .toBe('SELECT ');
        expect(executions).toBe(before);
    } finally {
        await rpc(page, 'save_config', {
            config: {
                ...previous,
                aiEnabled: previous.aiEnabled ?? false,
                aiInlineCompletionEnabled: previous.aiInlineCompletionEnabled ?? false,
            },
        });
        await rpc(page, 'disconnect_connection', {connectionId: connection.id}).catch(
            () => undefined,
        );
        await rpc(page, 'delete_connection', {id: connection.id}).catch(() => undefined);
    }
});
