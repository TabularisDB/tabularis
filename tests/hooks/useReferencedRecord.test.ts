import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

// quoteTableRef and the FK helpers are pure string utils — no mocks needed.
import {
  fetchReferencedRecord,
  type FetchReferencedRecordParams,
} from "../../src/hooks/useReferencedRecord";
import type { ForeignKey } from "../../src/types/schema";

const fk: ForeignKey = {
  name: "fk_users",
  column_name: "user_id",
  ref_table: "users",
  ref_column: "id",
};

const baseParams: Omit<FetchReferencedRecordParams, "database"> = {
  connectionId: "conn-1",
  fk,
  value: 42,
  driver: "postgres",
  schema: "public",
  sourceColumnType: "integer",
};

describe("fetchReferencedRecord database threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({ columns: [], rows: [], affected_rows: 0 });
  });

  it("passes the database override to execute_query when set", async () => {
    await fetchReferencedRecord({ ...baseParams, database: "analytics" });

    expect(invokeMock).toHaveBeenCalledWith(
      "execute_query",
      expect.objectContaining({ database: "analytics" }),
    );
  });

  it("omits database from execute_query when not set (backward-compatible)", async () => {
    await fetchReferencedRecord({ ...baseParams });

    const callArgs = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("database");
  });

  it("omits database when set to null", async () => {
    await fetchReferencedRecord({ ...baseParams, database: null });

    const callArgs = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("database");
  });

  it("omits database when set to empty string", async () => {
    await fetchReferencedRecord({ ...baseParams, database: "" });

    const callArgs = invokeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("database");
  });
});
