import { expect, test } from "@playwright/test";
import path from "node:path";

import { rpc } from "./rpc";

interface ConnectionParameters {
  driver: string;
  database: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  ssl_mode?: string;
  save_in_keychain?: boolean;
}

interface SavedConnection {
  id: string;
  name: string;
  params: ConnectionParameters;
}

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  affected_rows: number;
  truncated: boolean;
}

interface DriverManifest {
  id: string;
  name: string;
  is_builtin: boolean;
}

interface DatabaseFixture {
  name: "sqlite" | "postgres" | "mysql";
  params: ConnectionParameters;
  identityQuery: string;
  expectedIdentity: string;
}

const rootDir = path.resolve(import.meta.dirname, "../../..");
const runtimeDir = path.resolve(
  process.env.TABULARIS_E2E_RUNTIME_DIR ??
    path.join(rootDir, "web-ui-project/.runtime/e2e"),
);
const databasePassword = process.env.TABULARIS_E2E_DATABASE_PASSWORD ?? "tabularis-e2e";

const databaseFixtures: DatabaseFixture[] = [
  {
    name: "sqlite",
    params: {
      driver: "sqlite",
      database:
        process.env.TABULARIS_E2E_SQLITE_PATH ??
        path.join(runtimeDir, "tabularis-e2e.sqlite"),
      save_in_keychain: false,
    },
    identityQuery: "SELECT sqlite_version()",
    expectedIdentity: ".",
  },
  {
    name: "postgres",
    params: {
      driver: "postgres",
      host: process.env.TABULARIS_E2E_POSTGRES_HOST ?? "127.0.0.1",
      port: Number.parseInt(process.env.TABULARIS_E2E_POSTGRES_PORT ?? "45432", 10),
      username: process.env.TABULARIS_E2E_POSTGRES_USER ?? "postgres",
      password: databasePassword,
      database: process.env.TABULARIS_E2E_POSTGRES_DATABASE ?? "tabularis_e2e",
      ssl_mode: "disable",
      save_in_keychain: false,
    },
    identityQuery: "SELECT current_database()",
    expectedIdentity: process.env.TABULARIS_E2E_POSTGRES_DATABASE ?? "tabularis_e2e",
  },
  {
    name: "mysql",
    params: {
      driver: "mysql",
      host: process.env.TABULARIS_E2E_MYSQL_HOST ?? "127.0.0.1",
      port: Number.parseInt(process.env.TABULARIS_E2E_MYSQL_PORT ?? "43306", 10),
      username: process.env.TABULARIS_E2E_MYSQL_USER ?? "root",
      password: databasePassword,
      database: process.env.TABULARIS_E2E_MYSQL_DATABASE ?? "tabularis_e2e",
      save_in_keychain: false,
    },
    identityQuery: "SELECT DATABASE()",
    expectedIdentity: process.env.TABULARIS_E2E_MYSQL_DATABASE ?? "tabularis_e2e",
  },
];

async function saveConnection(
  page: Parameters<typeof rpc>[0],
  name: string,
  params: ConnectionParameters,
): Promise<SavedConnection> {
  return rpc<SavedConnection>(page, "save_connection", {
    name,
    params,
    environment: "development",
  });
}

async function execute(
  page: Parameters<typeof rpc>[0],
  connectionId: string,
  query: string,
): Promise<QueryResult> {
  return rpc<QueryResult>(page, "execute_query", {
    connectionId,
    query,
    limit: 100,
    page: 1,
  });
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/connections");
  await expect(page.locator("body")).toBeVisible();
});

test("serves the shared UI and loads an authenticated UI extension", async ({ page }) => {
  await expect(page.locator('[data-testid="e2e-ui-extension"]')).toHaveText(
    "E2E UI extension loaded",
    { timeout: 15_000 },
  );

  const drivers = await rpc<DriverManifest[]>(page, "get_registered_drivers");
  expect(drivers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "e2e-driver", is_builtin: false }),
      expect.objectContaining({ id: "e2e-ui-extension", is_builtin: false }),
    ]),
  );
});

for (const fixture of databaseFixtures) {
  test(`executes a real ${fixture.name} connection and query workflow`, async ({
    page,
    browserName,
  }) => {
    const connection = await saveConnection(
      page,
      `E2E ${fixture.name} ${browserName}`,
      fixture.params,
    );

    try {
      await expect(
        rpc<string>(page, "test_connection", {
          request: { params: fixture.params, connection_id: connection.id },
        }),
      ).resolves.toContain("Connection successful");

      const identity = await execute(page, connection.id, fixture.identityQuery);
      expect(String(identity.rows[0]?.[0])).toContain(fixture.expectedIdentity);

      await execute(
        page,
        connection.id,
        "CREATE TABLE IF NOT EXISTS tabularis_web_e2e (id INTEGER PRIMARY KEY, value VARCHAR(64))",
      );
      await execute(page, connection.id, "DELETE FROM tabularis_web_e2e");
      const marker = `${fixture.name}-${browserName}`;
      await execute(
        page,
        connection.id,
        `INSERT INTO tabularis_web_e2e (id, value) VALUES (1, '${marker}')`,
      );
      const result = await execute(
        page,
        connection.id,
        "SELECT value FROM tabularis_web_e2e WHERE id = 1",
      );
      expect(result.rows).toEqual([[marker]]);
      expect(result.truncated).toBe(false);
    } finally {
      await rpc(page, "disconnect_connection", { connectionId: connection.id }).catch(() => undefined);
      // Headless Linux runners may not provide a Secret Service daemon; the
      // isolated runtime is deleted after the suite, so cleanup is best-effort.
      await rpc(page, "delete_connection", { id: connection.id }).catch(() => undefined);
    }
  });
}

test("executes a query through an external JSON-RPC driver plugin", async ({
  page,
  browserName,
}) => {
  const params: ConnectionParameters = {
    driver: "e2e-driver",
    database: "fixture",
    save_in_keychain: false,
  };
  const connection = await saveConnection(page, `E2E plugin ${browserName}`, params);

  try {
    await expect(
      rpc<string>(page, "test_connection", {
        request: { params, connection_id: connection.id },
      }),
    ).resolves.toContain("Connection successful");
    const result = await execute(page, connection.id, "SELECT plugin_fixture");
    expect(result.columns).toEqual(["fixture"]);
    expect(result.rows).toEqual([["driver-plugin-ok"]]);
  } finally {
    await rpc(page, "disconnect_connection", { connectionId: connection.id }).catch(() => undefined);
    await rpc(page, "delete_connection", { id: connection.id }).catch(() => undefined);
  }
});
