import {readFile} from 'node:fs/promises';
import {expect, test} from '@playwright/test';

test('saves a file from a sandboxed plugin through the host', async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await page.goto('/connections');
    const button = page
        .frameLocator('iframe[title="Plugin e2e-save-file"]')
        .getByTestId('e2e-save-file');
    await expect(button).toHaveAttribute('data-status', 'idle', {timeout: 15_000});

    const download = page.waitForEvent('download');
    await button.click();
    const file = await download;
    // The host keeps only the base name of the suggested path.
    expect(file.suggestedFilename()).toBe('e2e-saved.txt');
    expect(await readFile(await file.path(), 'utf8')).toBe('saved by a sandboxed plugin');
    await expect(button).toHaveAttribute('data-status', 'saved');
});
