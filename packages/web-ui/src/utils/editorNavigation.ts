import type { NavigateFunction } from "react-router-dom";

import type {
  EditorNavigationIntent,
  EditorNavigationRequest,
} from "../types/editor";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Route state is only ever written by `openEditor` below, so this checks the
 * fields the editor cannot run without and lets the optional ones fall away.
 */
function parseEditorNavigationRequest(
  value: unknown,
): EditorNavigationRequest | null {
  if (!isRecord(value) || typeof value.initialQuery !== "string") {
    return null;
  }

  const {
    initialQuery,
    kind,
    materialized,
    preventAutoRun,
    queryName,
    readOnly,
    schema,
    tableName,
    targetConnectionId,
    title,
  } = value;
  const base = {
    initialQuery,
    ...(typeof schema === "string" && { schema }),
    ...(typeof targetConnectionId === "string" && {
      targetConnectionId,
    }),
  };

  switch (kind) {
    case "table":
      if (typeof tableName !== "string") return null;
      return {
        kind: "table",
        tableName,
        ...(materialized === true && { materialized: true }),
        ...(typeof title === "string" && { title }),
        ...base,
      };
    case "console":
      return {
        kind: "console",
        ...(typeof queryName === "string" && { queryName }),
        ...(preventAutoRun === true && { preventAutoRun: true }),
        ...base,
      };
    case "definition":
      if (typeof queryName !== "string") return null;
      return {
        kind: "definition",
        queryName,
        ...(readOnly === true && { readOnly: true }),
        ...base,
      };
    default:
      return null;
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unsupported editor navigation request: ${String(value)}`,
  );
}

/** Identifies a request regardless of the order its fields were built in. */
function navigationKey(request: EditorNavigationRequest): string {
  return JSON.stringify(
    Object.entries(request).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function createEditorNavigationIntent(
  request: EditorNavigationRequest,
  defaultConsoleTitle: string,
): EditorNavigationIntent {
  switch (request.kind) {
    case "table":
      return {
        targetConnectionId: request.targetConnectionId,
        key: navigationKey(request),
        addTabInput: {
          type: "table",
          title: request.title ?? request.tableName,
          query: request.initialQuery,
          activeTable: request.tableName,
          schema: request.schema,
          materialized: request.materialized,
        },
        execution: {
          autoRun: true,
          patchReadOnlyOnDuplicate: false,
        },
      };
    case "console":
      return {
        targetConnectionId: request.targetConnectionId,
        key: navigationKey(request),
        addTabInput: {
          type: "console",
          title: request.queryName ?? defaultConsoleTitle,
          query: request.initialQuery,
          activeTable: null,
          schema: request.schema,
        },
        execution: {
          autoRun: !request.preventAutoRun,
          patchReadOnlyOnDuplicate: false,
        },
      };
    case "definition":
      return {
        targetConnectionId: request.targetConnectionId,
        key: navigationKey(request),
        addTabInput: {
          type: "console",
          title: request.queryName,
          query: request.initialQuery,
          activeTable: null,
          schema: request.schema,
          readOnly: request.readOnly,
        },
        execution: {
          autoRun: false,
          patchReadOnlyOnDuplicate: !!request.readOnly,
        },
      };
    default:
      return assertNever(request);
  }
}

export function parseEditorNavigationIntent(
  value: unknown,
  defaultConsoleTitle: string,
): EditorNavigationIntent | null {
  const request = parseEditorNavigationRequest(value);
  return request
    ? createEditorNavigationIntent(request, defaultConsoleTitle)
    : null;
}

export function openEditor(
  navigate: NavigateFunction,
  request: EditorNavigationRequest,
): void {
  navigate("/editor", { state: request });
}
