import {expect, test} from '@playwright/test';
import {rpc} from './rpc';

test('styles provider selectors and scrolls long account setup inside the host modal', async ({
    page,
}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/connections');
    const legacy = page
        .frameLocator('iframe[title="Plugin e2e-ui-extension"]')
        .getByTestId('e2e-ui-extension');
    await expect(legacy).toHaveText('E2E UI extension loaded');
    await page.getByRole('button', {name: 'Add Connection', exact: true}).first().click();
    await page.getByRole('button', {name: 'Connect to E2e Provider', exact: true}).click();
    const setupFrame = page.locator(
        'iframe[title="Plugin e2e-provider"][data-plugin-slot="connection-modal.setup"]',
    );
    const setup = setupFrame.contentFrame();
    // A short first state fits the modal: the frame is as tall as its content and has no scrollbar.
    await expect(setup.getByTestId('provider-account-loading')).toBeVisible();
    const scrolls = () =>
        setup.locator('html').evaluate((html) => html.scrollHeight > html.clientHeight);
    await expect.poll(scrolls).toBe(false);
    const shortHeight = (await setupFrame.boundingBox())?.height ?? 0;
    expect(shortHeight).toBeGreaterThan(0);
    expect(shortHeight).toBeLessThan(200);
    // The long form then takes the whole modal body instead of staying at the first height.
    await setup.getByTestId('provider-load-account').click();
    await expect(setup.getByTestId('provider-long-setup')).toBeVisible();
    await expect
        .poll(async () => (await setupFrame.boundingBox())?.height ?? 0)
        .toBeGreaterThan(400);
    await expect.poll(scrolls).toBe(true);
    const select = setup.getByRole('combobox', {name: 'Provider database'});
    await expect(select).toHaveCSS('width', /[3-9]\d\d(?:\.\d+)?px/);
    await select.click();
    const popup = setup.getByRole('listbox', {name: 'Provider database'});
    await expect(popup).toHaveCSS('position', 'fixed');
    const option = setup.getByRole('option', {name: 'Disposable database'});
    await expect(option).toBeInViewport();
    await option.click();
    await expect(setup.getByTestId('provider-database')).toHaveText('neondb');
    const bounds = await select.boundingBox();
    if (!bounds) throw new Error('Provider database selector has no visible bounds');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 1000);
    const footer = setup.getByTestId('provider-import-footer');
    await expect(footer).toBeInViewport();
    await footer.click();
    await expect(setup.getByTestId('provider-import-result')).toHaveText('import-ready');
    await expect(legacy).toHaveText('E2E UI extension loaded');
});

test('runs provider setup, connection RPC, workspace and native components through the sandbox', async ({
    page,
    browserName,
}) => {
    test.setTimeout(90_000);
    if (browserName === 'chromium') {
        const session = await page.context().newCDPSession(page);
        await session.send('Emulation.setCPUThrottlingRate', {rate: 4});
    }
    // Exercise stale/reordered guest echoes without slowing the user's keystrokes.
    await page.addInitScript(() => {
        const original = MessagePort.prototype.postMessage;
        let sequence = 0;
        MessagePort.prototype.postMessage = function (
            message: unknown,
            transfer?: Transferable[] | StructuredSerializeOptions,
        ) {
            const send = () =>
                original.call(this, message, Array.isArray(transfer) ? {transfer} : transfer);
            if (
                message &&
                typeof message === 'object' &&
                'method' in message &&
                message.method === 'ui.native.set'
            ) {
                window.setTimeout(send, [30, 5, 60][sequence++ % 3]);
            } else send();
        };
    });
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
        await expect(page).toHaveURL(new RegExp(`/connections/${connection.id}/editor`), {
            timeout: 15_000,
        });
        const service = page.frameLocator(
            'iframe[title="Plugin e2e-provider"][data-plugin-slot="explorer.services"]',
        );
        await service.getByTestId('provider-call').click();
        await expect(service.getByTestId('provider-result')).toContainText(connection.id);
        await expect(service.getByTestId('provider-result')).toContainText(
            'saved-provider.example',
        );
        await service.getByTestId('provider-open').click();
        const workspace = page.frameLocator(
            'iframe[title="Plugin e2e-provider"][data-plugin-slot="editor.workspace.content"][data-plugin-workspace="services"]',
        );
        await expect(workspace.getByTestId('provider-workspace')).toBeVisible();
        await expect(page.getByRole('region', {name: 'Provider result grid'})).toContainText(
            'native-grid-ok',
        );
        const editor = page.getByRole('region', {name: 'Provider source editor'});
        await expect(editor.locator('.monaco-editor')).toBeVisible();
        const editorBounds = await editor.boundingBox();
        expect(editorBounds?.height).toBeGreaterThan(300);
        await editor.locator('.view-lines').click();
        // Monaco follows the emulated browser platform (Desktop Safari advertises macOS).
        const selectAll = await page.evaluate(() =>
            navigator.userAgent.includes('Macintosh') ? 'Meta+A' : 'Control+A',
        );
        await page.keyboard.press(selectAll);
        await page.keyboard.type('const revision = 2;');
        await expect(workspace.getByTestId('provider-source')).toHaveText('const revision = 2;');
        await workspace.getByRole('combobox', {name: 'Provider source language'}).click();
        await workspace.getByRole('option', {name: 'TypeScript'}).click();
        await expect(
            workspace.getByRole('combobox', {name: 'Provider source language'}),
        ).toHaveValue('TypeScript');
        await expect(workspace.getByTestId('provider-source')).toHaveText('const revision = 2;');
        await expect(editor.locator('.view-lines')).toContainText('const revision = 2;');
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
