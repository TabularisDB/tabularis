import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BROWSER_ROUTE_PATHS,
  BROWSER_ROUTES,
  WEB_UI_BASE_PATH,
} from "../src/routing";

const webUiRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(webUiRoot));
const require = createRequire(import.meta.url);
const viteCliPath = resolve(dirname(require.resolve("vite")), "../../bin/vite.js");
const directNavigationUrls = [
  BROWSER_ROUTES.root,
  BROWSER_ROUTES.connections,
  BROWSER_ROUTES.editor,
  BROWSER_ROUTES.settings,
  BROWSER_ROUTES.mcp,
  `${BROWSER_ROUTES.schemaDiagram}?connection=connection-1&database=main`,
  `${BROWSER_ROUTES.visualExplain}?connection=connection-1&query=select%201`,
  `${BROWSER_ROUTES.jsonViewer}?session=json-1`,
  BROWSER_ROUTES.taskManager,
  `${BROWSER_ROUTES.resultsWindow}?session=result-1`,
] as const;

let viteProcess: ChildProcess;
let origin: string;

const findAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const portServer = createServer();
    portServer.once("error", reject);
    portServer.listen(0, "127.0.0.1", () => {
      const address = portServer.address();
      if (!address || typeof address === "string") {
        portServer.close();
        reject(new Error("Unable to reserve a Vite test port"));
        return;
      }
      portServer.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });

beforeAll(async () => {
  const port = await findAvailablePort();
  origin = `http://127.0.0.1:${port}`;
  viteProcess = spawn(
    process.execPath,
    [
      viteCliPath,
      webUiRoot,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: repositoryRoot,
      stdio: "ignore",
    },
  );

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (viteProcess.exitCode !== null) {
      throw new Error(`Vite exited before startup with code ${viteProcess.exitCode}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Keep polling until Vite is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for the Vite routing test server");
}, 10_000);

afterAll(() => {
  viteProcess?.kill("SIGTERM");
});

describe("web UI routing", () => {
  it("uses one explicit root base path", () => {
    expect(WEB_UI_BASE_PATH).toBe("/");
  });

  it("tracks every supported browser route", () => {
    expect(BROWSER_ROUTE_PATHS).toEqual([
      "/",
      "/connections",
      "/editor",
      "/mcp",
      "/settings",
      "/schema-diagram",
      "/task-manager",
      "/visual-explain",
      "/json-viewer",
      "/results-window",
    ]);
  });

  it.each(directNavigationUrls)("serves the SPA shell for %s", async (url) => {
    const response = await fetch(`${origin}${url}`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain('<div id="root"></div>');
  });
});
