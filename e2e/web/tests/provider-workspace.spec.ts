import {expect, test} from '@playwright/test';
import {rpc} from './rpc';

test('runs provider setup, connection RPC, workspace and native components through the sandbox', async ({
    page,
}) => {
    test.setTimeout(90_000);
    await page.goto('/connections');
    const setup = page.frameLocator('iframe[title="Plugin e2e-provider"]');
    await setup.getByTestId('provider-prepare').click();
    await expect(setup.getByTestId('provider-result')).toContainText('account-setup');

    const connection = await rpc<{id: string}>(page, 'save_connection', {
        name: 'Sandbox provider fixture',
        params: {
            driver: 'e2e-provider',
            host: 'saved-provider.example',
            database: 'fixture',
            save_in_keychain: false,
        },
    });
    try {
        await page.reload();
        await page.getByText('Sandbox provider fixture', {exact: true}).dblclick();
        await expect(page).toHaveURL(new RegExp(`/connections/${connection.id}/editor`));
        const service = page.locator('iframe[title="Plugin e2e-provider"]').first().contentFrame();
        await service.getByTestId('provider-call').click();
        await expect(service.getByTestId('provider-result')).toContainText(connection.id);
        await expect(service.getByTestId('provider-result')).toContainText(
            'saved-provider.example',
        );
        await service.getByTestId('provider-open').click();
        const workspace = page.locator('iframe[title="Plugin e2e-provider"]').nth(1).contentFrame();
        await expect(workspace.getByTestId('provider-workspace')).toBeVisible();
        await expect(page.getByRole('region', {name: 'Provider result grid'})).toContainText(
            'native-grid-ok',
        );
        const editor = page.getByRole('region', {name: 'Provider source editor'});
        await expect(editor.locator('.monaco-editor')).toBeVisible();
        await editor.locator('.view-lines').click();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type('const revision = 2;');
        await expect(workspace.getByTestId('provider-source')).toHaveText('const revision = 2;');
        await workspace.getByTestId('provider-publish').click();
        await expect(service.getByTestId('provider-result')).toHaveText('event:sibling-refresh-ok');
        await workspace.getByTestId('provider-modal').click();
        await workspace.getByTestId('provider-confirm').click();
        await expect(workspace.getByTestId('provider-confirm')).not.toBeVisible();
        await service.getByTestId('provider-open-other').click();
        await expect(workspace.getByTestId('provider-workspace')).not.toBeVisible();
        await service.getByTestId('provider-open').click();
        await expect(workspace.getByTestId('provider-source')).toHaveText('const revision = 2;');
        await expect(page.locator('iframe[title="Plugin e2e-provider"]')).toHaveCount(3);
        const frame = page.locator('iframe[title="Plugin e2e-provider"]').last();
        await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    } finally {
        await rpc(page, 'disconnect_connection', {connectionId: connection.id}).catch(
            () => undefined,
        );
        await rpc(page, 'delete_connection', {id: connection.id}).catch(() => undefined);
    }
});
