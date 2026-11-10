// Attaches to the running session and runs a snippet file as the body of an
// async function, with `browser`, `$`, `$$` and the helpers from helpers.js in
// scope. Whatever the snippet returns is printed.
// Usage (from e2e/): node .drv-act.mjs <sid-file> <snippet.js>
import { attach } from "webdriverio";
import fs from "node:fs";
import path from "node:path";

const sid = fs.readFileSync(process.argv[2], "utf8").trim();
const browser = await attach({
  sessionId: sid,
  hostname: "127.0.0.1",
  port: 4444,
  path: "/",
  logLevel: "error",
  capabilities: {},
});
globalThis.browser = browser;
globalThis.$ = (s) => browser.$(s);
globalThis.$$ = (s) => browser.$$(s);

const helpers = fs.readFileSync(path.join(path.dirname(process.argv[2]), "helpers.js"), "utf8");
const code = helpers + "\n" + fs.readFileSync(process.argv[3], "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
try {
  const result = await new AsyncFunction(code)();
  if (result !== undefined) {
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 1));
  }
} catch (e) {
  console.error("ERR", e.message.split("\n")[0]);
  process.exit(1);
}
