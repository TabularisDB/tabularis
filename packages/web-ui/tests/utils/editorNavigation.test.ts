import { describe, expect, it, vi } from "vitest";

import type { EditorNavigationRequest } from "../../src/types/editor";
import {
  openEditor,
  parseEditorNavigationIntent,
} from "../../src/utils/editorNavigation";

describe("parseEditorNavigationIntent", () => {
  it("should map table navigation to a complete add-tab input and execution policy", () => {
    expect(
      parseEditorNavigationIntent(
        {
          kind: "table",
          initialQuery: 'SELECT * FROM "users"',
          tableName: "users",
          schema: "public",
          materialized: true,
          title: "users (analytics)",
          targetConnectionId: "connection-b",
        },
        "New console",
      ),
    ).toEqual({
      targetConnectionId: "connection-b",
      key: expect.any(String),
      addTabInput: {
        type: "table",
        title: "users (analytics)",
        query: 'SELECT * FROM "users"',
        activeTable: "users",
        schema: "public",
        materialized: true,
      },
      execution: {
        autoRun: true,
        patchReadOnlyOnDuplicate: false,
      },
    });
  });

  it("should key equal requests alike regardless of field order", () => {
    const key = (state: unknown) =>
      parseEditorNavigationIntent(state, "New console")?.key;

    expect(
      key({
        kind: "table",
        initialQuery: "SELECT 1",
        tableName: "users",
        schema: "public",
      }),
    ).toBe(
      key({
        schema: "public",
        tableName: "users",
        initialQuery: "SELECT 1",
        kind: "table",
      }),
    );
  });

  it("should key requests differing only by schema apart", () => {
    const key = (schema: string) =>
      parseEditorNavigationIntent(
        {
          kind: "table",
          initialQuery: "SELECT 1",
          tableName: "users",
          schema,
        },
        "New console",
      )?.key;

    expect(key("public")).not.toBe(key("analytics"));
  });

  it.each<{
    request: EditorNavigationRequest;
    expectedAutoRun: boolean;
    expectedReadOnlyPatch: boolean;
  }>([
    {
      request: {
        kind: "console",
        initialQuery: "SELECT COUNT(*) FROM users",
        preventAutoRun: true,
      },
      expectedAutoRun: false,
      expectedReadOnlyPatch: false,
    },
    {
      request: {
        kind: "definition",
        initialQuery: "CREATE FUNCTION refresh_users()",
        queryName: "refresh_users Definition",
        readOnly: true,
      },
      expectedAutoRun: false,
      expectedReadOnlyPatch: true,
    },
  ])(
    "should derive execution policy for $request.kind navigation",
    ({ request, expectedAutoRun, expectedReadOnlyPatch }) => {
      const intent = parseEditorNavigationIntent(
        request,
        "New console",
      );

      expect(intent?.execution).toEqual({
        autoRun: expectedAutoRun,
        patchReadOnlyOnDuplicate: expectedReadOnlyPatch,
      });
      expect(intent?.addTabInput.query).toBe(request.initialQuery);
    },
  );

  it.each([
    null,
    {},
    { initialQuery: "SELECT 1" },
    { kind: "table", initialQuery: "SELECT 1" },
    { kind: "console" },
    { kind: "definition", initialQuery: "SELECT 1" },
  ])("should reject invalid route state %#", (state) => {
    expect(
      parseEditorNavigationIntent(state, "New console"),
    ).toBeNull();
  });

  it("should ignore unrelated fields on internally produced route state", () => {
    const intent = parseEditorNavigationIntent(
      {
        kind: "table",
        initialQuery: 'SELECT * FROM "users"',
        tableName: "users",
        schema: "public",
        unrelated: "ignored",
      },
      "New console",
    );

    expect(intent?.addTabInput.activeTable).toBe("users");
  });
});

describe("openEditor", () => {
  it("should navigate with the typed request as route state", () => {
    const navigate = vi.fn();
    const request: EditorNavigationRequest = {
      kind: "console",
      initialQuery: "SELECT 1",
      targetConnectionId: "connection-b",
    };

    openEditor(navigate, request);

    expect(navigate).toHaveBeenCalledWith("/editor", {
      state: request,
    });
  });
});
