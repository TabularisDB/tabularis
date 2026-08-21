import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useCreateSqliteDatabase } from "../../src/hooks/useCreateSqliteDatabase";

const mockInvoke = vi.mocked(invoke);
const mockSave = vi.mocked(save);

const connection = {
  id: "sqlite-1",
  name: "customers",
  params: {
    driver: "sqlite",
    database: "/tmp/customers.db",
  },
};

describe("useCreateSqliteDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSave.mockResolvedValue("/tmp/customers.db");
    mockInvoke.mockResolvedValue(connection);
  });

  it("creates a SQLite database from the selected save path", async () => {
    const { result } = renderHook(() => useCreateSqliteDatabase());

    let created: typeof connection | null = null;
    await act(async () => {
      created = await result.current.createSqliteDatabase();
    });

    expect(mockSave).toHaveBeenCalledWith({
      title: "connections.newSqliteDatabase.dialogTitle",
      defaultPath: "database.db",
      filters: [
        {
          name: "connections.newSqliteDatabase.fileType",
          extensions: ["db", "sqlite", "sqlite3"],
        },
      ],
    });
    expect(mockInvoke).toHaveBeenCalledWith("create_sqlite_database", {
      path: "/tmp/customers.db",
    });
    expect(created).toEqual(connection);
    expect(result.current.isCreating).toBe(false);
  });

  it("does nothing when the save dialog is cancelled", async () => {
    mockSave.mockResolvedValue(null);
    const { result } = renderHook(() => useCreateSqliteDatabase());

    let created: typeof connection | null = connection;
    await act(async () => {
      created = await result.current.createSqliteDatabase();
    });

    expect(created).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("prevents concurrent creation attempts", async () => {
    let resolvePath: ((path: string | null) => void) | undefined;
    mockSave.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePath = resolve;
        }),
    );
    const { result } = renderHook(() => useCreateSqliteDatabase());

    let firstAttempt!: Promise<typeof connection | null>;
    await act(async () => {
      firstAttempt = result.current.createSqliteDatabase();
    });

    await expect(result.current.createSqliteDatabase()).resolves.toBeNull();
    expect(mockSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePath?.("/tmp/customers.db");
      await firstAttempt;
    });
  });

  it("clears the loading state when creation fails", async () => {
    mockInvoke.mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() => useCreateSqliteDatabase());

    await act(async () => {
      await expect(result.current.createSqliteDatabase()).rejects.toThrow(
        "permission denied",
      );
    });

    expect(result.current.isCreating).toBe(false);
  });
});
