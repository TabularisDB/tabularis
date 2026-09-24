import type { FullConfig } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const SESSION_COOKIE = "tabularis_session";

async function waitForLaunchUrl(filePath: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const value = (await fs.readFile(filePath, "utf8")).trim();
      if (value.length > 0) return value;
    } catch {
      // The fake browser opener creates the file after server bootstrap.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the Web UI launch URL at ${filePath}`);
}

function cookieValue(setCookie: string): string {
  const firstPair = setCookie.split(";", 1)[0];
  const separator = firstPair.indexOf("=");
  if (separator < 1 || firstPair.slice(0, separator) !== SESSION_COOKIE) {
    throw new Error("The bootstrap response did not issue a Tabularis session cookie");
  }
  return firstPair.slice(separator + 1);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const rootDir = path.resolve(import.meta.dirname, "../..");
  const runtimeDir = path.resolve(
    process.env.TABULARIS_E2E_RUNTIME_DIR ??
      path.join(rootDir, "web-ui-project/.runtime/e2e"),
  );
  const launchUrlFile =
    process.env.TABULARIS_E2E_LAUNCH_URL_FILE ??
    path.join(runtimeDir, "launch-url");
  const launchUrl = await waitForLaunchUrl(launchUrlFile);
  const response = await fetch(launchUrl, { redirect: "manual" });
  if (response.status !== 303) {
    throw new Error(`Web UI bootstrap failed with HTTP ${response.status}`);
  }
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("The bootstrap response omitted its session cookie");
  }

  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("The E2E project requires a base URL");
  }
  const origin = new URL(baseURL);
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(
    path.join(runtimeDir, "storage-state.json"),
    JSON.stringify(
      {
        cookies: [
          {
            name: SESSION_COOKIE,
            value: cookieValue(setCookie),
            domain: origin.hostname,
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Strict",
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
  );
}
