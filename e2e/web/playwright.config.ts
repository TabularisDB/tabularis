import {defineConfig, devices} from '@playwright/test';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '../..');
const port = Number.parseInt(process.env.TABULARIS_E2E_PORT ?? '18080', 10);
const baseURL = `http://127.0.0.1:${port}`;
const runtimeDir = path.resolve(
    process.env.TABULARIS_E2E_RUNTIME_DIR ?? path.join(rootDir, 'e2e/web/.runtime'),
);
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromiumLaunchOptions = chromiumExecutablePath
    ? {executablePath: chromiumExecutablePath}
    : undefined;
// Compact and touch projects run only the responsive specs; the desktop projects run everything.
const responsiveSpecs = '**/responsive.spec.ts';

export default defineConfig({
    testDir: path.join(rootDir, 'e2e/web/tests'),
    outputDir: path.join(runtimeDir, 'test-results'),
    globalSetup: path.join(rootDir, 'e2e/web/global-setup.ts'),
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
        ? [['line'], ['html', {outputFolder: path.join(runtimeDir, 'report'), open: 'never'}]]
        : 'list',
    use: {
        baseURL,
        storageState: path.join(runtimeDir, 'storage-state.json'),
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: process.env.CI ? 'retain-on-failure' : 'off',
    },
    webServer: {
        command: 'bash e2e/web/start-server.sh',
        cwd: rootDir,
        url: `${baseURL}/healthz`,
        timeout: 120_000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
    },
    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome'], launchOptions: chromiumLaunchOptions},
        },
        {
            name: 'firefox',
            use: {...devices['Desktop Firefox']},
        },
        {
            name: 'webkit',
            use: {...devices['Desktop Safari']},
        },
        {
            name: 'phone-chromium',
            testMatch: responsiveSpecs,
            use: {...devices['Pixel 7'], launchOptions: chromiumLaunchOptions},
        },
        {
            name: 'phone-webkit',
            testMatch: responsiveSpecs,
            use: {...devices['iPhone 13']},
        },
        {
            name: 'phone-narrow-webkit',
            testMatch: responsiveSpecs,
            use: {...devices['iPhone SE']},
        },
        {
            name: 'phone-landscape-chromium',
            testMatch: responsiveSpecs,
            use: {...devices['Pixel 7 landscape'], launchOptions: chromiumLaunchOptions},
        },
        {
            name: 'tablet-chromium',
            testMatch: responsiveSpecs,
            use: {
                ...devices['Desktop Chrome'],
                viewport: {width: 768, height: 1024},
                hasTouch: true,
                isMobile: true,
                launchOptions: chromiumLaunchOptions,
            },
        },
    ],
});
