import {expect, test, type Locator, type Page} from '@playwright/test';
import path from 'node:path';
import {rpc} from './rpc';

const runtimeDir =
    process.env.TABULARIS_E2E_RUNTIME_DIR ?? path.resolve(import.meta.dirname, '../.runtime');

// The breakpoints proposed in #1610 (`BREAKPOINTS` in packages/web-ui/src/utils/responsive.ts);
// import them from there once it lands. Compact is below `intermediate`.
const BREAKPOINTS = {intermediate: 768, wide: 1024} as const;

async function expectNoSidewaysScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the document scrolls sideways').toBeLessThanOrEqual(0);
}

// A panel squeezed into a strip beside a sidebar is on screen but cannot be worked with.
async function expectUsableWidth(page: Page, panel: Locator, name: string): Promise<void> {
    const box = await panel.boundingBox();
    const viewportWidth = page.viewportSize()?.width ?? 0;
    expect(box, `the ${name} is not rendered`).not.toBeNull();
    expect(box?.width ?? 0, `the ${name} is narrower than half the screen`).toBeGreaterThanOrEqual(
        viewportWidth / 2,
    );
}

async function press(control: Locator, hasTouch: boolean): Promise<void> {
    if (hasTouch) {
        await control.tap();
    } else {
        await control.click();
    }
}

test.beforeEach(async ({page}) => {
    // The community callout floats over the content until it is dismissed.
    await page.addLocatorHandler(
        page.getByRole('button', {name: 'Dismiss', exact: true}),
        async (dismiss) => {
            await dismiss.click();
        },
    );
});

test('the connections page fits the screen', async ({page}) => {
    await page.goto('/connections');
    await expect(page.getByRole('heading', {name: 'Connections', exact: true})).toBeInViewport();
    await expectNoSidewaysScroll(page);
});

test.describe('SQL editor', () => {
    let connectionId: string | undefined;

    test.beforeEach(async ({page}) => {
        await page.goto('/connections');
        const connection = await rpc<{id: string}>(page, 'save_connection', {
            name: 'Responsive SQLite smoke',
            params: {
                driver: 'sqlite',
                database: path.join(runtimeDir, 'tabularis-e2e.sqlite'),
                save_in_keychain: false,
            },
            environment: 'development',
        });
        connectionId = connection.id;
        await page.goto(`/connections/${connection.id}/editor`);
        await expect.poll(() => page.evaluate(() => Boolean(window.__e2e_editor))).toBe(true);
        await page.evaluate(() => window.__e2e_editor.setValue('SELECT 42 AS responsive_value;'));
    });

    test.afterEach(async ({page}) => {
        if (!connectionId) return;
        await rpc(page, 'disconnect_connection', {connectionId}).catch(() => undefined);
        await rpc(page, 'delete_connection', {id: connectionId}).catch(() => undefined);
        connectionId = undefined;
    });

    // Setup and query execution must work at every size, so this test has no expected failures.
    test('runs a query', async ({page, hasTouch}) => {
        await press(page.getByRole('button', {name: /^Run \(/}), hasTouch);
        await expect(page.getByRole('cell', {name: '42', exact: true})).toBeVisible();
    });

    test('the SQL editor is at least half the screen wide', async ({page}) => {
        const viewport = page.viewportSize() ?? {width: Infinity, height: Infinity};
        test.fail(
            viewport.width < BREAKPOINTS.intermediate,
            'In the compact layout the explorer keeps its desktop width and squeezes the SQL editor (#1582)',
        );
        await expectUsableWidth(page, page.locator('.monaco-editor').first(), 'SQL editor');
    });

    test('Run and the result are fully on screen', async ({page, hasTouch}) => {
        const viewport = page.viewportSize() ?? {width: Infinity, height: Infinity};
        test.fail(
            viewport.width < BREAKPOINTS.intermediate,
            'In the compact layout the explorer pushes Run and the result past the right edge (#1582)',
        );
        test.fail(viewport.height < 400, 'The result grid is cut off below the editor (#1586)');
        const run = page.getByRole('button', {name: /^Run \(/});
        await expect(run).toBeInViewport({ratio: 1});
        await press(run, hasTouch);

        await expect(
            page.getByRole('columnheader').filter({hasText: 'responsive_value'}),
        ).toBeInViewport({ratio: 1});
        await expect(page.getByRole('cell', {name: '42', exact: true})).toBeInViewport({
            ratio: 1,
        });
        await expectNoSidewaysScroll(page);
    });
});
