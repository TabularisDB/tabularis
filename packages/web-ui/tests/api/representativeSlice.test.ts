import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabularisClient } from "../../src/api/client";
import { TauriTransport } from "../../src/api/transports/tauriTransport";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(),
}));

const SOURCE_ROOT = join(process.cwd(), "packages/web-ui/src");
const MIGRATED_COMMANDS = new Set([
  "is_debug_mode",
  "get_connections",
  "test_connection",
  "get_tables",
  "execute_query",
  "cancel_query",
]);
const MIGRATED_EVENTS = new Set([
  "batch-statement-complete",
  "connection-test-progress",
]);

interface DirectTauriCall {
  api: "invoke" | "listen";
  name: string;
  file: string;
  line: number;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function findDirectTauriCalls(): DirectTauriCall[] {
  return sourceFiles(SOURCE_ROOT).flatMap((file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const calls: DirectTauriCall[] = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === "invoke" || node.expression.text === "listen")
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) {
          const names = node.expression.text === "invoke" ? MIGRATED_COMMANDS : MIGRATED_EVENTS;
          if (names.has(argument.text)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            calls.push({
              api: node.expression.text,
              name: argument.text,
              file: relative(process.cwd(), file),
              line: line + 1,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
    return calls;
  });
}

describe("WEB-013 representative transport slice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has no direct Tauri calls for migrated commands and events", () => {
    expect(findDirectTauriCalls()).toEqual([]);
  });

  it("preserves requests, responses, errors, cancellation, and events", async () => {
    const client = new TabularisClient(new TauriTransport());
    const queryResult = { columns: ["value"], rows: [[1]], affected_rows: 0 };

    vi.mocked(invoke)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce("Connection successful")
      .mockResolvedValueOnce([{ name: "users" }])
      .mockResolvedValueOnce(queryResult)
      .mockRejectedValueOnce(new Error("query failed"))
      .mockResolvedValueOnce(undefined);

    await expect(client.call("is_debug_mode", undefined)).resolves.toBe(true);
    await expect(client.call("get_connections", undefined)).resolves.toEqual([]);
    await expect(
      client.call("test_connection", {
        request: { params: { driver: "sqlite", database: "test.db" } },
      }),
    ).resolves.toBe("Connection successful");
    await expect(
      client.call("get_tables", { connectionId: "connection-1" }),
    ).resolves.toEqual([{ name: "users" }]);
    await expect(
      client.call("execute_query", {
        connectionId: "connection-1",
        query: "SELECT 1",
      }),
    ).resolves.toEqual(queryResult);
    await expect(
      client.call("execute_query", {
        connectionId: "connection-1",
        query: "INVALID",
      }),
    ).rejects.toThrow("query failed");
    await expect(
      client.call("cancel_query", { connectionId: "connection-1" }),
    ).resolves.toBeUndefined();

    const handler = vi.fn();
    const unlisten = vi.fn();
    let callback:
      | EventCallback<{
          batch_id: string;
          index: number;
          statement: { query: string; result: typeof queryResult; error: null };
        }>
      | undefined;
    vi.mocked(listen).mockImplementationOnce((_event, eventHandler) => {
      callback = eventHandler as typeof callback;
      return Promise.resolve(unlisten);
    });

    await expect(
      client.subscribe("batch-statement-complete", handler),
    ).resolves.toBe(unlisten);
    const payload = {
      batch_id: "batch-1",
      index: 0,
      statement: { query: "SELECT 1", result: queryResult, error: null },
    };
    callback?.({ event: "batch-statement-complete", id: 1, payload });
    expect(handler).toHaveBeenCalledWith(payload);
  });
});
