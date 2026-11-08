/** Select through the host popup, whose options live outside plugin slot containers. */
export async function selectProviderOption(page, field, value, keyboard = false) {
    await field.click();
    const option = page.locator(`[data-plugin-select-menu] [data-value=${JSON.stringify(value)}]`);
    await option.waitFor();
    if (keyboard) {
        await field.fill((await option.innerText()).split('\n')[0]);
        await field.press('Enter');
    } else await option.click();
}

export async function providerOptions(page, field) {
    await field.click();
    await page.locator('[data-plugin-select-menu]').waitFor();
    const values = await page
        .locator('[data-plugin-select-menu] [role="option"]')
        .evaluateAll((options) => options.map((option) => option.getAttribute('data-value')));
    await field.press('Escape');
    return values;
}
