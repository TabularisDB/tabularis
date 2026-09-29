import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTableQueryTemplates } from "../../src/utils/tableQueryTemplates";

const invokeMock = vi.mocked(invoke);

describe("loadTableQueryTemplates", () => {
  beforeEach(() => { invokeMock.mockReset(); });

  it("requests all four previews without executing SQL", async () => {
    invokeMock.mockResolvedValue("driver SQL");
    const result = await loadTableQueryTemplates("connection", "orders", undefined, ["id"]);
    expect(result).toEqual({ "select-all": "driver SQL", "select-fields": "driver SQL", update: "driver SQL", delete: "driver SQL" });
    expect(invokeMock).toHaveBeenCalledTimes(4);
    for (const [kind, columns, limit] of [
      ["select", [], null], ["select", ["id"], 100], ["update", ["id"], null], ["delete", [], null],
    ]) {
      expect(invokeMock).toHaveBeenCalledWith("get_table_query_template", {
        connectionId: "connection", request: { table: "orders", schema: null, kind, columns, limit },
      });
    }
  });

  it("forwards an explicit database override to every RPC call", async () => {
    invokeMock.mockResolvedValue("driver SQL");
    await loadTableQueryTemplates("connection", "orders", "sales", ["id"], "analytics");
    expect(invokeMock).toHaveBeenCalledWith("get_table_query_template", {
      connectionId: "connection",
      request: { table: "orders", schema: "sales", kind: "select", columns: [], limit: null },
      database: "analytics",
    });
  });

  it("keeps null as the explicit fallback signal and propagates failures", async () => {
    invokeMock.mockResolvedValue(null);
    expect((await loadTableQueryTemplates("c", "t", "s", []))["select-fields"]).toBeNull();
    invokeMock.mockRejectedValue(new Error("permission denied"));
    await expect(loadTableQueryTemplates("c", "t", "s", [])).rejects.toThrow("permission denied");
  });
});
