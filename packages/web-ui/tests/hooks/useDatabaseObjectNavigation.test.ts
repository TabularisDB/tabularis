import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAlert } from "../../src/hooks/useAlert";
import { useDatabaseObjectNavigation } from "../../src/hooks/useDatabaseObjectNavigation";

const navigateMock = vi.hoisted(() => vi.fn());
const showAlertMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../../src/hooks/useAlert", () => ({
  useAlert: vi.fn(() => ({ showAlert: showAlertMock })),
}));

describe("useDatabaseObjectNavigation", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    showAlertMock.mockReset();
    vi.mocked(invoke).mockReset();
    vi.mocked(useAlert).mockReturnValue({ showAlert: showAlertMock });
  });

  it("should adapt scoped object requests to editor navigation", () => {
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation("connection-b", "postgres"),
    );

    act(() => {
      result.current!.open("orders", "sales");
      result.current!.count("orders", "sales");
    });

    expect(navigateMock).toHaveBeenNthCalledWith(1, "/editor", {
      state: {
        kind: "table",
        initialQuery: 'SELECT * FROM "sales"."orders"',
        tableName: "orders",
        schema: "sales",
        targetConnectionId: "connection-b",
      },
    });
    expect(navigateMock).toHaveBeenNthCalledWith(2, "/editor", {
      state: {
        kind: "console",
        initialQuery:
          'SELECT COUNT(*) as count FROM "sales"."orders"',
        schema: "sales",
        targetConnectionId: "connection-b",
      },
    });
  });

  it("should offer no navigation without a connection", () => {
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation(null, "postgres"),
    );

    expect(result.current).toBeNull();
  });

  it("should navigate views identically to tables", () => {
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation("connection-b", "postgres"),
    );

    act(() => {
      result.current!.open("active_orders", "sales", {
        materialized: true,
      });
    });

    expect(navigateMock).toHaveBeenCalledWith("/editor", {
      state: {
        kind: "table",
        initialQuery: 'SELECT * FROM "sales"."active_orders"',
        tableName: "active_orders",
        materialized: true,
        schema: "sales",
        targetConnectionId: "connection-b",
      },
    });
  });

  it("should open a named console that does not run on its own", () => {
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation("connection-b", "postgres"),
    );

    act(() => {
      result.current!.newConsole("orders", "sales");
    });

    expect(navigateMock).toHaveBeenCalledWith("/editor", {
      state: {
        kind: "console",
        initialQuery: 'SELECT * FROM "sales"."orders"',
        queryName: "orders",
        preventAutoRun: true,
        schema: "sales",
        targetConnectionId: "connection-b",
      },
    });
  });

  it("should open an already loaded definition without fetching it again", () => {
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation("connection-b", "postgres"),
    );

    act(() => {
      result.current!.openDefinition(
        "CREATE VIEW active_orders AS SELECT 1",
        "active_orders Definition",
        "sales",
      );
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/editor", {
      state: {
        kind: "definition",
        initialQuery: "CREATE VIEW active_orders AS SELECT 1",
        queryName: "active_orders Definition",
        schema: "sales",
        targetConnectionId: "connection-b",
      },
    });
  });

  it("should fetch a routine definition and open it as editable", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      "CREATE FUNCTION refresh_orders",
    );
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation("connection-b", "postgres"),
    );

    await act(async () => {
      result.current!.openRoutineDefinition(
        { name: "refresh_orders", routine_type: "FUNCTION" },
        "sales",
      );
    });

    expect(invoke).toHaveBeenCalledWith("get_routine_definition", {
      connectionId: "connection-b",
      routineName: "refresh_orders",
      routineType: "FUNCTION",
      schema: "sales",
    });
    expect(navigateMock).toHaveBeenCalledWith("/editor", {
      state: {
        kind: "definition",
        initialQuery: "CREATE FUNCTION refresh_orders",
        queryName: "refresh_orders Definition",
        schema: "sales",
        targetConnectionId: "connection-b",
      },
    });
  });

  it("should fetch a trigger definition and open it read-only", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("CREATE TRIGGER audit_orders");
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation("connection-b", "postgres"),
    );

    await act(async () => {
      result.current!.openTriggerDefinition(
        {
          name: "audit_orders",
          table_name: "orders",
          event: "INSERT",
          timing: "AFTER",
        },
        "sales",
      );
    });

    expect(invoke).toHaveBeenCalledWith("get_trigger_definition", {
      connectionId: "connection-b",
      triggerName: "audit_orders",
      tableName: "orders",
      schema: "sales",
    });
    expect(navigateMock).toHaveBeenCalledWith("/editor", {
      state: {
        kind: "definition",
        initialQuery: "CREATE TRIGGER audit_orders",
        queryName: "audit_orders Definition",
        readOnly: true,
        schema: "sales",
        targetConnectionId: "connection-b",
      },
    });
  });

  it("should surface a failed definition load instead of navigating", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("connection lost"));
    const { result } = renderHook(() =>
      useDatabaseObjectNavigation("connection-b", "postgres"),
    );

    await act(async () => {
      result.current!.openRoutineDefinition(
        { name: "refresh_orders", routine_type: "FUNCTION" },
        "sales",
      );
    });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(showAlertMock).toHaveBeenCalledWith(
      expect.stringContaining("connection lost"),
      { kind: "error" },
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
