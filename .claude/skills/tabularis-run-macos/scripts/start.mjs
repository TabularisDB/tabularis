// Opens a WebDriver session on the app binary and saves its id.
// Usage (from e2e/): node .drv-start.mjs <binary> <sid-file>
import { remote } from "webdriverio";
import fs from "node:fs";

const browser = await remote({
  hostname: "127.0.0.1",
  port: 4444,
  path: "/",
  logLevel: "error",
  // The window appears only after the app's async setup; keep retrying.
  connectionRetryCount: 30,
  connectionRetryTimeout: 60000,
  capabilities: { "tauri:options": { binary: process.argv[2] } },
});
fs.writeFileSync(process.argv[3], browser.sessionId);
console.log("session", browser.sessionId);
