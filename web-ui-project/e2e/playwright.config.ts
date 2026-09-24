import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");
const port = Number.parseInt(process.env.TABULARIS_E2E_PORT ?? "18080", 10);
const baseURL = `http://127.0.0.1:${port}`;
const runtimeDir = path.resolve(
  process.env.TABULARIS_E2E_RUNTIME_DIR ??
    path.join(rootDir, "web-ui-project/.runtime/e2e"),
);
const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: path.join(rootDir, "web-ui-project/e2e/tests"),
  outputDir: path.join(runtimeDir, "test-results"),
  globalSetup: path.join(rootDir, "web-ui-project/e2e/global-setup.ts"),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: path.join(runtimeDir, "report"), open: "never" }]]
    : "list",
  use: {
    baseURL,
    storageState: path.join(runtimeDir, "storage-state.json"),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },
  webServer: {
    command: "bash web-ui-project/e2e/start-server.sh",
    cwd: rootDir,
    url: `${baseURL}/healthz`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath
          ? { executablePath: chromiumExecutablePath }
          : undefined,
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
