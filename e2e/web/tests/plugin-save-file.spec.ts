import {readFile} from 'node:fs/promises';
import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/connections');
    await expect(
        page.frameLocator('iframe[title="Plugin e2e-save-file"]').getByTestId('e2e-save-file'),
    ).toHaveAttribute('data-status', 'idle', {timeout: 15_000});
});

test('saves a file from a sandboxed plugin after the user confirms it in the host', async ({
    page,
}) => {
    const button = page
        .frameLocator('iframe[title="Plugin e2e-save-file"]')
        .getByTestId('e2e-save-file');

    await button.click();
    const dialog = page.getByRole('dialog', {name: 'Save a file from a plugin'});
    // The host keeps only the base name of the suggested path.
    await expect(dialog).toContainText('e2e-saved.txt');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', {name: 'Download'}).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('e2e-saved.txt');
    expect(await readFile(await file.path(), 'utf8')).toBe('saved by a sandboxed plugin');
    await expect(button).toHaveAttribute('data-status', 'saved');
});

test('does not download when focus moves to the plugin after host input', async ({page}) => {
    const frame = page.frameLocator('iframe[title="Plugin e2e-save-file"]');
    const trigger = frame.getByTestId('e2e-save-on-focus');
    await trigger.click();
    await expect(trigger).toHaveAttribute('data-status', 'armed');

    // Input in the host activates the window, then the host moves focus to the
    // frame, as the command palette does when it restores focus on close.
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.locator('body').click({position: {x: 2, y: 2}});
    await page
        .locator('iframe[title="Plugin e2e-save-file"]')
        .evaluate((element) => (element as HTMLIFrameElement).focus());

    const dialog = page.getByRole('dialog', {name: 'Save a file from a plugin'});
    await expect(dialog).toContainText('e2e-focus.txt');
    expect(downloads).toBe(0);
    await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(trigger).toHaveAttribute('data-status', 'cancelled');
    await expect(dialog).toBeHidden();
    expect(downloads).toBe(0);
});
