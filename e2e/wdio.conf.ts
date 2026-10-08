// WebDriverIO config for native macOS E2E tests against the real tabularis app.
//
// Architecture: `tauri-wd` (tauri-webdriver-automation CLI) runs a W3C WebDriver
// server on :4444. WebDriverIO connects to it as a remote driver. The
// `tauri:options.binary` capability points at the built Tauri *debug* binary,
// which has the in-app `tauri-plugin-webdriver-automation` server compiled in
// (only when built with `--features e2e-testing`). The debug binary loads the
// frontend from tabularis's devUrl (http://localhost:5173), so Vite must be
// running before the app launches.
//
// This exercises the REAL WKWebView + REAL Tauri IPC — the only mode that can
// catch the PR #822 frontend->backend database-routing bug class.

import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Resolve the binary path absolutely from this config file's location so it's
// correct regardless of which working directory `tauri-wd` (which launches the
// app) or the wdio worker runs from. In CI, tauri-wd starts from the repo root
// while wdio runs from e2e/ — a relative path would resolve differently for
// each. This config lives at e2e/wdio.conf.ts, so the binary is two dirs up
// then into src-tauri/target/debug.
const __dirname = dirname(fileURLToPath(import.meta.url));
const appBinary = resolve(__dirname, "..", "src-tauri", "target", "debug", "tabularis");

export const config = {
  runner: "local",
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        // Built via: pnpm tauri build --debug --no-bundle -- --features e2e-testing
        binary: appBinary,
      },
    },
  ],
  logLevel: "info",
  port: 4444,
  path: "/",
  strictSelectors: false,
  // The real app's window materializes slower than the spike's (heavy async
  // .setup() init runs before the WKWebView appears). WebDriverIO's default
  // session-init retries give up after ~1.5s (3 x 0.5s) — too short for the
  // real app, which produced "no window" and failed. Bump the connection
  // retry count so the getWindowHandle check keeps retrying for ~30s.
  connectionRetryTimeout: 60000,
  connectionRetryCount: 30,
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },
  reporters: ["spec"],
  // Reset state before each app session: clear saved connections AND re-seed the
  // adversarial fixtures. Each spec must start with a clean DB so prior-run
  // side effects (edits, trigger drops/creates) don't leak.
  beforeSession: async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { execSync } = await import("node:child_process");
    const dir = path.join(process.env.HOME || "", "Library/Application Support/tabularis");
    const connFile = path.join(dir, "connections.dev.json");
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(connFile, '{"groups": [], "connections": []}');
    } catch {
      // Best effort — the app may create the dir on first save.
    }
    // Re-seed the adversarial fixtures (idempotent via ON CONFLICT DO UPDATE)
    if (process.env.PGUSER) {
      try {
        const seedScript = path.join(__dirname, "..", "tests", "fixtures", "seed_postgres_e2e.sh");
        execSync(`bash ${seedScript}`, { env: { ...process.env } });
      } catch (e) {
          console.error("Failed to re-seed: " + e);
        }
    }
  },
};
