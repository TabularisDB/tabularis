import {expect, test} from '@playwright/test';
import path from 'node:path';
import {rpc} from './rpc';

test('environment selection persists and an open menu does not consume Save', async ({page}) => {
    await page.goto('/connections');
    const runtimeDir =
        process.env.TABULARIS_E2E_RUNTIME_DIR ?? path.resolve(import.meta.dirname, '../.runtime');
    const connection = await rpc<{id: string}>(page, 'save_connection', {
        name: 'Environment dropdown regression',
        params: {
            driver: 'sqlite',
            database: path.join(runtimeDir, 'tabularis-e2e.sqlite'),
            save_in_keychain: false,
        },
        environment: 'development',
    });
    try {
        await page.reload();
        const edit = page
            .locator(`[data-connection-id="${connection.id}"]`)
            .getByTitle('Edit', {exact: true});
        await edit.click();
        const dialog = page
            .getByRole('group')
            .filter({has: page.getByRole('button', {name: 'Environment', exact: true})});
        const environment = dialog.getByRole('button', {name: 'Environment', exact: true});
        await environment.click();
        await dialog.getByRole('option', {name: 'Staging', exact: true}).click();
        await dialog.getByRole('button', {name: 'Save', exact: true}).click();
        await expect(dialog).not.toBeVisible();
        await expect
            .poll(
                async () =>
                    (
                        await rpc<Array<{id: string; environment: string}>>(page, 'get_connections')
                    ).find((c) => c.id === connection.id)?.environment,
            )
            .toBe('staging');
        await edit.click();
        await environment.click();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('listbox')).not.toBeVisible();
        await environment.click();
        await dialog.getByRole('button', {name: 'Save', exact: true}).click();
        await expect(dialog).not.toBeVisible();
    } finally {
        await rpc(page, 'delete_connection', {id: connection.id}).catch(() => undefined);
    }
});
